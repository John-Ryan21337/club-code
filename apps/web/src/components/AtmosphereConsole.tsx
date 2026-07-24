import {
  MAX_AMBIENT_OPACITY,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_SPEED,
  MIN_AMBIENT_OPACITY,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_SPEED,
} from "@cafecode/contracts/settings";
import * as Schema from "effect/Schema";
import { BotIcon, GripHorizontalIcon, Maximize2Icon, SparklesIcon, XIcon } from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { type AtmosphereCommand, parseAtmosphereCommands } from "../atmosphereCommandParser";
import { requestAtmosphereControl } from "../atmosphereControlBus";
import {
  AtmosphereLmStudioError,
  interpretAtmosphereCommandWithLmStudio,
} from "../atmosphereLmStudio";
import { parseYouTubeSource } from "../ambientVideo";
import { parseSpotifySource } from "../spotify";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { cn } from "../lib/utils";
import { Switch } from "./ui/switch";

const STORAGE_KEY = "club-code:atmosphere-console:v1";
const MIN_WIDTH = 292;
const MIN_HEIGHT = 188;
const DEFAULT_WIDTH = 348;
const DEFAULT_HEIGHT = 236;
const VIEWPORT_MARGIN = 12;

const AnchorSchema = Schema.Literals([
  "bottom-left",
  "bottom-right",
  "top-left",
  "top-right",
  "custom",
]);
type Anchor = typeof AnchorSchema.Type;

const GeometrySchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
type Geometry = typeof GeometrySchema.Type;

const PreferencesSchema = Schema.Struct({
  open: Schema.Boolean,
  anchor: AnchorSchema,
  lmStudioEnabled: Schema.Boolean,
  geometry: GeometrySchema,
});
type Preferences = typeof PreferencesSchema.Type;

const DEFAULT_PREFERENCES: Preferences = {
  open: true,
  anchor: "bottom-left",
  lmStudioEnabled: false,
  geometry: {
    x: VIEWPORT_MARGIN,
    y: 280,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  },
};

interface PointerInteraction {
  readonly kind: "move" | "resize";
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly geometry: Geometry;
}

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key];
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function valueFromPercent(percent: number, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * (percent / 100);
}

function clampGeometry(geometry: Geometry): Geometry {
  if (typeof window === "undefined") return geometry;
  const width = clamp(
    Number.isFinite(geometry.width) ? geometry.width : DEFAULT_WIDTH,
    MIN_WIDTH,
    Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2),
  );
  const height = clamp(
    Number.isFinite(geometry.height) ? geometry.height : DEFAULT_HEIGHT,
    MIN_HEIGHT,
    Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2),
  );
  return {
    x: clamp(
      Number.isFinite(geometry.x) ? geometry.x : VIEWPORT_MARGIN,
      VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
    ),
    y: clamp(
      Number.isFinite(geometry.y) ? geometry.y : VIEWPORT_MARGIN,
      VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN),
    ),
    width,
    height,
  };
}

function anchoredStyle(anchor: Exclude<Anchor, "custom">): CSSProperties {
  const vertical = anchor.startsWith("top")
    ? { top: VIEWPORT_MARGIN }
    : { bottom: VIEWPORT_MARGIN };
  const horizontal = anchor.endsWith("left")
    ? { left: VIEWPORT_MARGIN }
    : { right: VIEWPORT_MARGIN };
  return { ...vertical, ...horizontal, width: DEFAULT_WIDTH, maxHeight: "min(420px, 70vh)" };
}

function anchoredLauncherStyle(anchor: Exclude<Anchor, "custom">): CSSProperties {
  const vertical = anchor.startsWith("top")
    ? { top: VIEWPORT_MARGIN }
    : { bottom: VIEWPORT_MARGIN };
  return anchor.endsWith("left")
    ? { ...vertical, left: VIEWPORT_MARGIN }
    : { ...vertical, right: VIEWPORT_MARGIN };
}

function describeCommand(command: AtmosphereCommand): string {
  switch (command.kind) {
    case "set-effect":
      return command.effect === "off" ? "Falling effects off." : `${command.effect} enabled.`;
    case "adjust-effect":
      return `${command.property} ${command.direction}d.`;
    case "set-effect-value":
      return `${command.property} set to ${command.percent}%.`;
    case "set-effect-color":
      return `Effect color set to ${command.color}.`;
    case "set-2ch":
      return command.enabled ? "2ch enrichment enabled." : "2ch enrichment disabled.";
    case "play-url":
      return "Ambient media loaded.";
    case "media-transport":
      return `${command.action} requested.`;
    case "visualizer":
      return `${command.action} visualizer requested.`;
  }
}

export function AtmosphereConsole() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [preferences, setPreferences] = useLocalStorage(
    STORAGE_KEY,
    DEFAULT_PREFERENCES,
    PreferencesSchema,
  );
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(
    "Local commands use zero model tokens. LM Studio fallback is optional.",
  );
  const [busy, setBusy] = useState(false);
  const [liveGeometry, setLiveGeometry] = useState<Geometry | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const pendingGeometryRef = useRef<Geometry | null>(null);
  const animationFrameRef = useRef(0);

  const updateGeometry = useCallback(
    (geometry: Geometry) => {
      setPreferences((current) => ({
        ...current,
        anchor: "custom",
        geometry: clampGeometry(geometry),
      }));
    },
    [setPreferences],
  );

  useEffect(() => {
    const onResize = () => {
      if (preferences.anchor !== "custom") return;
      updateGeometry(preferences.geometry);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [preferences.anchor, preferences.geometry, updateGeometry]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || event.pointerId !== interaction.pointerId) return;
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      pendingGeometryRef.current = clampGeometry(
        interaction.kind === "move"
          ? {
              ...interaction.geometry,
              x: interaction.geometry.x + deltaX,
              y: interaction.geometry.y + deltaY,
            }
          : {
              ...interaction.geometry,
              width: interaction.geometry.width + deltaX,
              height: interaction.geometry.height + deltaY,
            },
      );
      if (animationFrameRef.current !== 0) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = 0;
        if (pendingGeometryRef.current) {
          setLiveGeometry(pendingGeometryRef.current);
        }
      });
    };
    const finishCurrent = () => {
      interactionRef.current = null;
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
      const geometry = pendingGeometryRef.current;
      pendingGeometryRef.current = null;
      if (geometry) {
        updateGeometry(geometry);
      }
      setLiveGeometry(null);
    };
    const finish = (event: PointerEvent) => {
      if (interactionRef.current?.pointerId === event.pointerId) {
        finishCurrent();
      }
    };
    const finishOnBlur = () => {
      if (interactionRef.current) finishCurrent();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finishOnBlur);
    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finishOnBlur);
    };
  }, [updateGeometry]);

  const beginInteraction = (
    kind: PointerInteraction["kind"],
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = panel.getBoundingClientRect();
    const geometry = clampGeometry({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
    setPreferences((current) => ({ ...current, anchor: "custom", geometry }));
    pendingGeometryRef.current = geometry;
    setLiveGeometry(geometry);
    interactionRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      geometry,
    };
  };

  const applyCommands = async (commands: readonly AtmosphereCommand[]): Promise<string> => {
    const patch: Partial<Mutable<typeof settings>> = {};
    const messages: string[] = [];
    const currentNumber = <K extends keyof typeof settings>(key: K): number => {
      const patched = patch[key];
      return typeof patched === "number" ? patched : (settings[key] as number);
    };
    for (const command of commands) {
      switch (command.kind) {
        case "set-effect":
          if (command.effect === "off") {
            patch.fallingEffectsEnabled = false;
          } else {
            patch.fallingEffectsEnabled = true;
            patch.fallingEffectKind = command.effect;
          }
          messages.push(describeCommand(command));
          break;
        case "adjust-effect": {
          const direction = command.direction === "increase" ? 1 : -1;
          if (command.property === "density") {
            patch.fallingEffectDensity = clamp(
              currentNumber("fallingEffectDensity") + direction * 0.25,
              MIN_FALLING_EFFECT_DENSITY,
              MAX_FALLING_EFFECT_DENSITY,
            );
          } else if (command.property === "speed") {
            patch.fallingEffectSpeed = clamp(
              currentNumber("fallingEffectSpeed") + direction * 0.25,
              MIN_FALLING_EFFECT_SPEED,
              MAX_FALLING_EFFECT_SPEED,
            );
          } else {
            patch.fallingEffectOpacity = clamp(
              currentNumber("fallingEffectOpacity") + direction * 0.1,
              MIN_AMBIENT_OPACITY,
              MAX_AMBIENT_OPACITY,
            );
          }
          messages.push(describeCommand(command));
          break;
        }
        case "set-effect-value":
          if (command.property === "density") {
            patch.fallingEffectDensity = valueFromPercent(
              command.percent,
              MIN_FALLING_EFFECT_DENSITY,
              MAX_FALLING_EFFECT_DENSITY,
            );
          } else if (command.property === "speed") {
            patch.fallingEffectSpeed = valueFromPercent(
              command.percent,
              MIN_FALLING_EFFECT_SPEED,
              MAX_FALLING_EFFECT_SPEED,
            );
          } else if (command.property === "opacity") {
            patch.fallingEffectOpacity = valueFromPercent(
              command.percent,
              MIN_AMBIENT_OPACITY,
              MAX_AMBIENT_OPACITY,
            );
          } else {
            patch.fallingEffectJapaneseRatio = command.percent / 100;
          }
          messages.push(describeCommand(command));
          break;
        case "set-effect-color":
          patch.fallingEffectColor = command.color;
          messages.push(describeCommand(command));
          break;
        case "set-2ch":
          patch.fallingEffect2chEnriched = command.enabled;
          messages.push(describeCommand(command));
          break;
        case "play-url": {
          const source = parseYouTubeSource(command.url) ?? parseSpotifySource(command.url);
          if (source === null) {
            messages.push("That media URL is not supported.");
          } else {
            patch.ambientVideoSource = source;
            patch.ambientVideoEnabled = true;
            messages.push(describeCommand(command));
          }
          break;
        }
        case "media-transport": {
          const result = await requestAtmosphereControl({
            kind: "media",
            action: command.action,
          });
          messages.push(result.message);
          break;
        }
        case "visualizer": {
          const result = await requestAtmosphereControl({
            kind: "visualizer",
            action: command.action,
          });
          messages.push(result.message);
          break;
        }
      }
    }
    if (Object.keys(patch).length > 0) {
      updateSettings(patch);
    }
    return messages.join(" ");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const request = input.trim();
    if (!request || busy) return;
    setBusy(true);
    try {
      let commands = parseAtmosphereCommands(request);
      let usedLmStudio = false;
      if (commands.length === 0 && preferences.lmStudioEnabled) {
        commands = await interpretAtmosphereCommandWithLmStudio(request);
        usedLmStudio = true;
      }
      if (commands.length === 0) {
        setStatus(
          preferences.lmStudioEnabled
            ? "That request did not map to a safe atmosphere control."
            : "I could not map that locally. Reword it or enable LM Studio fallback.",
        );
        return;
      }
      const result = await applyCommands(commands);
      setStatus(`${usedLmStudio ? "Local LM Studio: " : "Zero-token: "}${result}`);
      setInput("");
    } catch (error) {
      setStatus(
        error instanceof AtmosphereLmStudioError
          ? error.message
          : "The atmosphere command could not be applied.",
      );
    } finally {
      setBusy(false);
    }
  };

  const selectAnchor = (anchor: Anchor) => {
    interactionRef.current = null;
    pendingGeometryRef.current = null;
    setLiveGeometry(null);
    if (anchor === "custom") {
      const rect = panelRef.current?.getBoundingClientRect();
      setPreferences((current) => ({
        ...current,
        anchor,
        geometry: clampGeometry(
          rect
            ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
            : current.geometry,
        ),
      }));
      return;
    }
    setPreferences((current) => ({ ...current, anchor }));
  };

  if (!preferences.open) {
    const launcherStyle =
      preferences.anchor === "custom"
        ? {
            left: clampGeometry(preferences.geometry).x,
            top: clampGeometry(preferences.geometry).y,
          }
        : anchoredLauncherStyle(preferences.anchor);
    return (
      <button
        type="button"
        aria-label="Open atmosphere console"
        className="fixed z-[85] grid size-10 place-items-center rounded-full border border-border/80 bg-card/95 text-primary shadow-xl backdrop-blur-md [-webkit-app-region:no-drag] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={launcherStyle}
        onClick={() => setPreferences((current) => ({ ...current, open: true }))}
      >
        <SparklesIcon className="size-4" />
      </button>
    );
  }

  const geometry = clampGeometry(liveGeometry ?? preferences.geometry);
  const style: CSSProperties =
    preferences.anchor === "custom"
      ? {
          left: geometry.x,
          top: geometry.y,
          width: geometry.width,
          height: geometry.height,
        }
      : anchoredStyle(preferences.anchor);

  return (
    <section
      ref={panelRef}
      aria-label="Atmosphere console"
      className="fixed z-[85] flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card/95 text-card-foreground shadow-2xl backdrop-blur-xl [-webkit-app-region:no-drag]"
      data-atmosphere-console-anchor={preferences.anchor}
      style={style}
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border/70 px-2">
        <SparklesIcon aria-hidden="true" className="size-3.5 text-primary" />
        <h2 className="mr-auto truncate text-xs font-medium">Atmosphere console</h2>
        <label className="sr-only" htmlFor="atmosphere-console-anchor">
          Console position
        </label>
        <select
          id="atmosphere-console-anchor"
          aria-label="Console position"
          className="h-6 max-w-28 rounded border border-border bg-background px-1 text-[10px]"
          value={preferences.anchor}
          onChange={(event) => selectAnchor(event.currentTarget.value as Anchor)}
        >
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-right">Bottom right</option>
          <option value="top-left">Top left</option>
          <option value="top-right">Top right</option>
          <option value="custom">Custom</option>
        </select>
        <button
          type="button"
          aria-label="Move atmosphere console"
          className="cursor-move rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event) => beginInteraction("move", event)}
          onKeyDown={(event) => {
            if (!event.key.startsWith("Arrow")) return;
            event.preventDefault();
            const current = clampGeometry(preferences.geometry);
            updateGeometry({
              ...current,
              x: current.x + (event.key === "ArrowLeft" ? -8 : event.key === "ArrowRight" ? 8 : 0),
              y: current.y + (event.key === "ArrowUp" ? -8 : event.key === "ArrowDown" ? 8 : 0),
            });
          }}
        >
          <GripHorizontalIcon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Close atmosphere console"
          className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setPreferences((current) => ({ ...current, open: false }))}
        >
          <XIcon className="size-3.5" />
        </button>
      </header>

      <form
        className="flex min-h-0 flex-1 flex-col gap-2 p-2"
        onSubmit={(event) => void submit(event)}
      >
        <label className="text-[11px] text-muted-foreground" htmlFor="atmosphere-command">
          Tell Club Code what to change
        </label>
        <div className="flex gap-1.5">
          <input
            id="atmosphere-command"
            autoComplete="off"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            maxLength={500}
            placeholder="Snow, 70% Japanese, next song…"
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="h-8 rounded-md bg-primary px-2.5 text-primary-foreground text-xs hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Working…" : "Apply"}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/45 px-2 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[10px]">
            <BotIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">LM Studio fallback · 127.0.0.1 only</span>
          </span>
          <Switch
            checked={preferences.lmStudioEnabled}
            aria-label="Use local LM Studio for unrecognized atmosphere commands"
            onCheckedChange={(checked) =>
              setPreferences((current) => ({
                ...current,
                lmStudioEnabled: Boolean(checked),
              }))
            }
          />
        </div>
        <p
          aria-live="polite"
          className={cn(
            "min-h-8 overflow-auto rounded-md bg-muted/55 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground",
            busy && "animate-pulse",
          )}
          role="status"
        >
          {status}
        </p>
        <p className="mt-auto text-[9px] leading-3 text-muted-foreground/80">
          LM Studio receives only this control sentence—no chat, files, project context, or paid
          provider session.
        </p>
      </form>

      <button
        type="button"
        aria-label="Resize atmosphere console"
        className="absolute right-0 bottom-0 cursor-nwse-resize rounded-tl p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={(event) => beginInteraction("resize", event)}
        onKeyDown={(event) => {
          if (!event.key.startsWith("Arrow")) return;
          event.preventDefault();
          const current = clampGeometry(preferences.geometry);
          updateGeometry({
            ...current,
            width:
              current.width + (event.key === "ArrowLeft" ? -8 : event.key === "ArrowRight" ? 8 : 0),
            height:
              current.height + (event.key === "ArrowUp" ? -8 : event.key === "ArrowDown" ? 8 : 0),
          });
        }}
      >
        <Maximize2Icon className="size-3" />
      </button>
    </section>
  );
}
