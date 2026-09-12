import * as Schema from "effect/Schema";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampProjectTelemetryPanelGeometry,
  defaultProjectTelemetryPanelGeometry,
  type ProjectTelemetryPanelGeometry,
} from "./ProjectTelemetryGraph.geometry";

export const PROJECT_TELEMETRY_PANEL_STORAGE_KEY = "cafe-code:project-telemetry-panel:v1";
const coordinate = Schema.Number.check(
  Schema.isBetween({ minimum: -1_000_000, maximum: 1_000_000 }),
);
const dimension = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }));
const geometrySchema = Schema.NullOr(
  Schema.Struct({ x: coordinate, y: coordinate, width: dimension, height: dimension }),
);
function readStoredGeometry(): ProjectTelemetryPanelGeometry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROJECT_TELEMETRY_PANEL_STORAGE_KEY);
    if (raw === null || raw.length > 4096) return null;
    return Schema.decodeSync(Schema.fromJsonString(geometrySchema))(raw);
  } catch {
    return null;
  }
}

function useStoredGeometry() {
  const [stored, setValue] = useState(readStoredGeometry);
  const setStored = useCallback((value: ProjectTelemetryPanelGeometry | null) => {
    // Keep the controls usable when persistence is denied or full. Storage
    // effects must stay outside React's deferred state updater execution.
    setValue(value);
    try {
      if (value === null) window.localStorage.removeItem(PROJECT_TELEMETRY_PANEL_STORAGE_KEY);
      else window.localStorage.setItem(PROJECT_TELEMETRY_PANEL_STORAGE_KEY, JSON.stringify(value));
    } catch {
      /* The current panel retains its in-memory geometry. */
    }
  }, []);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === PROJECT_TELEMETRY_PANEL_STORAGE_KEY)
        setValue(readStoredGeometry());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return [stored, setStored] as const;
}

type InteractionKind = "move" | "resize";
interface PointerInteraction {
  readonly kind: InteractionKind;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly geometry: ProjectTelemetryPanelGeometry;
}

/** Geometry stays local; moving the panel does not replace the telemetry poll owner. */
export function useTelemetryPanelLayout() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  });
  const [stored, setStored] = useStoredGeometry();
  const [live, setLive] = useState<ProjectTelemetryPanelGeometry | null>(null);
  const interaction = useRef<PointerInteraction | null>(null);
  const pending = useRef<ProjectTelemetryPanelGeometry | null>(null);
  const frame = useRef(0);
  const geometry = clampProjectTelemetryPanelGeometry(
    live ?? stored ?? defaultProjectTelemetryPanelGeometry(bounds),
    bounds,
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const rect = container.getBoundingClientRect();
      const width = container.clientWidth || rect.width || window.innerWidth;
      const height = container.clientHeight || rect.height || window.innerHeight;
      setBounds((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const finish = useCallback(() => {
    interaction.current = null;
    window.cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (pending.current !== null)
      setStored(clampProjectTelemetryPanelGeometry(pending.current, bounds));
    pending.current = null;
    setLive(null);
  }, [bounds, setStored]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = interaction.current;
      if (active === null || active.pointerId !== event.pointerId) return;
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      pending.current = clampProjectTelemetryPanelGeometry(
        active.kind === "move"
          ? { ...active.geometry, x: active.geometry.x + dx, y: active.geometry.y + dy }
          : {
              ...active.geometry,
              width: active.geometry.width + dx,
              height: active.geometry.height + dy,
            },
        bounds,
      );
      if (frame.current !== 0) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0;
        setLive(pending.current);
      });
    };
    const end = (event: PointerEvent) => {
      if (interaction.current?.pointerId === event.pointerId) finish();
    };
    const blur = () => {
      if (interaction.current !== null) finish();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", blur);
    return () => {
      window.cancelAnimationFrame(frame.current);
      frame.current = 0;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", blur);
    };
  }, [bounds, finish]);

  const begin = (kind: InteractionKind, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus();
    interaction.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      geometry,
    };
    pending.current = null;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Window listeners still finish the owned interaction. */
    }
  };
  const adjustWithKeyboard = (kind: InteractionKind, key: string, fine: boolean): boolean => {
    const step = fine ? 1 : 8;
    const delta =
      key === "ArrowLeft"
        ? { x: -step, y: 0 }
        : key === "ArrowRight"
          ? { x: step, y: 0 }
          : key === "ArrowUp"
            ? { x: 0, y: -step }
            : key === "ArrowDown"
              ? { x: 0, y: step }
              : null;
    if (delta === null) return false;
    setStored(
      clampProjectTelemetryPanelGeometry(
        kind === "move"
          ? { ...geometry, x: geometry.x + delta.x, y: geometry.y + delta.y }
          : { ...geometry, width: geometry.width + delta.x, height: geometry.height + delta.y },
        bounds,
      ),
    );
    return true;
  };
  return {
    containerRef,
    geometry,
    isNarrow: bounds.width < 900,
    begin,
    finish,
    adjustWithKeyboard,
    reset: () => setStored(null),
  };
}
