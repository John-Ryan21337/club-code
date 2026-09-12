/**
 * Atmosphere Console.
 *
 * A movable, resizable, minimizable panel that accepts a bounded local command
 * grammar for the falling-effect settings this build installs. The console is
 * closed by default and is opened from the Appearance settings panel; opening
 * it renders a panel and nothing else, so no effect turns on without a command.
 *
 * The local grammar runs first. Explicit LM Studio fallback can interpret unknown
 * wording through fixed loopback endpoints; no shell or `eval` is used.
 * Settings are saved to the primary Cafe server, which can be remote.
 * Commands are recognized by `atmosphereCommandParser` and
 * written through `server.updateClientSettings`, whose confirmed result is what
 * the status line reports.
 */
import type { EnvironmentId } from "@cafecode/contracts";
import {
  GripHorizontalIcon,
  Maximize2Icon,
  MinusIcon,
  RotateCcwIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  MAX_ATMOSPHERE_COMMAND_LENGTH,
  describeAtmosphereRefusal,
  parseAtmosphereCommands,
} from "../atmosphereCommandParser";
import { buildAtmospherePatch, describeConfirmedAtmosphere } from "../atmosphereConsoleCommands";
import {
  AtmosphereLmStudioError,
  interpretAtmosphereCommandWithLmStudio,
} from "../atmosphereLmStudio";
import { AtmosphereProviderError, interpretAtmosphereWithProvider } from "../atmosphereProvider";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import {
  type AtmosphereConsoleGeometry as Geometry,
  type AtmosphereConsolePreferences,
  useAtmosphereConsolePreferences,
} from "../atmosphereConsolePreferences";
import { getClientSettings } from "../hooks/useSettings";
import { getDesktopTitlebarInset, getWindowControlsOverlay } from "../lib/windowControlsOverlay";
import { applyClientSettingsUpdated, getServerConfig, useServerConfig } from "../rpc/serverState";

const MIN_WIDTH = 296;
const MIN_HEIGHT = 208;
const DEFAULT_WIDTH = 372;
const DEFAULT_HEIGHT = 308;
const VIEWPORT_MARGIN = 12;
const KEYBOARD_STEP = 8;
const MINIMIZED_HEIGHT = 36;

const IDLE_STATUS =
  "Local commands only. Try: snow · motion warp · density 60% · 日本語 70% · reset.";
const ENVIRONMENT_CHANGED_STATUS =
  "The primary environment changed. Check Appearance on the previous server for any command already sent.";
const CONNECTION_CHANGED_STATUS =
  "The connection changed. Check Appearance before sending another command.";
const UNAVAILABLE_STATUS =
  "This server has not enabled the window atmosphere capability. Nothing was applied.";
const WRITE_FAILED_STATUS =
  "The server did not confirm the change. Check Appearance before sending another command.";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Keeps the panel inside the viewport at every size and on every resize. */
function clampGeometry(geometry: Geometry): Geometry {
  if (typeof window === "undefined") return geometry;
  const marginX = Math.min(VIEWPORT_MARGIN, window.innerWidth / 2);
  const marginY = Math.min(VIEWPORT_MARGIN, window.innerHeight / 2);
  const top = Math.min(window.innerHeight - marginY, getDesktopTitlebarInset() + marginY);
  const availableWidth = Math.max(1, window.innerWidth - marginX * 2);
  const availableHeight = Math.max(1, window.innerHeight - top - marginY);
  const width = clamp(
    Number.isFinite(geometry.width) ? geometry.width : DEFAULT_WIDTH,
    Math.min(MIN_WIDTH, availableWidth),
    availableWidth,
  );
  const height = clamp(
    Number.isFinite(geometry.height) ? geometry.height : DEFAULT_HEIGHT,
    Math.min(MIN_HEIGHT, availableHeight),
    availableHeight,
  );
  return {
    x: clamp(
      Number.isFinite(geometry.x) ? geometry.x : VIEWPORT_MARGIN,
      marginX,
      Math.max(marginX, window.innerWidth - width - marginX),
    ),
    y: clamp(
      Number.isFinite(geometry.y) ? geometry.y : VIEWPORT_MARGIN,
      top,
      Math.max(top, window.innerHeight - height - marginY),
    ),
    width,
    height,
  };
}

function defaultGeometry(): Geometry {
  if (typeof window === "undefined") {
    return {
      x: VIEWPORT_MARGIN,
      y: VIEWPORT_MARGIN,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    };
  }
  return clampGeometry({
    x: window.innerWidth - DEFAULT_WIDTH - VIEWPORT_MARGIN,
    y: window.innerHeight - DEFAULT_HEIGHT - VIEWPORT_MARGIN,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
}

interface PointerInteraction {
  readonly kind: "move" | "resize";
  readonly pointerId: number;
  readonly target: HTMLButtonElement;
  readonly startX: number;
  readonly startY: number;
  readonly geometry: Geometry;
}

export function AtmosphereConsole() {
  const [preferences, setPreferences] = useAtmosphereConsolePreferences();
  if (!preferences.open) return null;
  return <AtmosphereConsolePanel preferences={preferences} setPreferences={setPreferences} />;
}

function AtmosphereConsolePanel({
  preferences,
  setPreferences,
}: {
  readonly preferences: AtmosphereConsolePreferences;
  readonly setPreferences: (
    value:
      | AtmosphereConsolePreferences
      | ((current: AtmosphereConsolePreferences) => AtmosphereConsolePreferences),
  ) => void;
}) {
  const serverConfig = useServerConfig();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const atmosphereAvailable = serverConfig?.ambientExperienceCapabilities.atmosphere === true;

  const [input, setInput] = useState("");
  const [status, setStatus] = useState(IDLE_STATUS);
  const [busy, setBusy] = useState(false);
  const [interpreter, setInterpreter] = useState<"local" | "lm-studio" | "provider">("local");
  const [instanceId, setInstanceId] = useState("");
  const [model, setModel] = useState("");
  const providers = (serverConfig?.providers ?? []).filter(
    (entry) => entry.driver === "claudeAgent" || entry.driver === "codex",
  );
  const selectedProvider = providers.find((entry) => entry.instanceId === instanceId);
  const [liveGeometry, setLiveGeometry] = useState<Geometry | null>(null);

  const panelRef = useRef<HTMLElement | null>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const pendingGeometryRef = useRef<Geometry | null>(null);
  const animationFrameRef = useRef(0);
  const mountedRef = useRef(true);
  /** Bumped whenever a request is superseded, so a late ack cannot land. */
  const requestGenerationRef = useRef(0);
  const pendingRequestRef = useRef<number | null>(null);
  const interpreterAbortRef = useRef<AbortController | null>(null);
  const inputConnectionRef = useRef<ReturnType<typeof getPrimaryEnvironmentConnection> | null>(
    null,
  );
  const providerConnectionRef = useRef<ReturnType<typeof getPrimaryEnvironmentConnection> | null>(
    null,
  );
  const environmentRef = useRef<EnvironmentId | null | undefined>(undefined);

  const storedGeometry = preferences.geometry;
  const geometry = clampGeometry(liveGeometry ?? storedGeometry ?? defaultGeometry());

  const releaseInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    interactionRef.current = null;
    if (interaction?.target.hasPointerCapture(interaction.pointerId)) {
      interaction.target.releasePointerCapture(interaction.pointerId);
    }
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      interpreterAbortRef.current?.abort();
      // Ignore this component's late confirmation; a sent server write can still finish.
      requestGenerationRef.current += 1;
    };
  }, []);

  const writeGeometry = useCallback(
    (next: Geometry) => {
      setPreferences((current) => ({
        ...current,
        geometry: clampGeometry(next),
      }));
    },
    [setPreferences],
  );

  // Keep the stored rectangle inside the viewport when the window changes size.
  useEffect(() => {
    const onResize = () => {
      setPreferences((current) => ({
        ...current,
        geometry: clampGeometry(current.geometry ?? defaultGeometry()),
      }));
    };
    const overlay = getWindowControlsOverlay();
    overlay?.addEventListener("geometrychange", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      overlay?.removeEventListener("geometrychange", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, [setPreferences]);

  // Discard pending work when the primary environment changes underneath us.
  useEffect(() => {
    const previous = environmentRef.current;
    environmentRef.current = primaryEnvironmentId;
    if (previous === undefined || previous === primaryEnvironmentId) return;
    requestGenerationRef.current += 1;
    interpreterAbortRef.current?.abort();
    pendingRequestRef.current = null;
    setBusy(false);
    setInput("");
    setInstanceId("");
    setModel("");
    setInterpreter("local");
    inputConnectionRef.current = null;
    providerConnectionRef.current = null;
    setStatus(ENVIRONMENT_CHANGED_STATUS);
  }, [primaryEnvironmentId]);

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
        if (pendingGeometryRef.current) setLiveGeometry(pendingGeometryRef.current);
      });
    };
    const finishCurrent = () => {
      releaseInteraction();
      const next = pendingGeometryRef.current;
      pendingGeometryRef.current = null;
      setLiveGeometry(null);
      if (next) writeGeometry(next);
    };
    const finish = (event: PointerEvent) => {
      if (interactionRef.current?.pointerId === event.pointerId) finishCurrent();
    };
    const finishOnBlur = () => {
      if (interactionRef.current) finishCurrent();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finishOnBlur);
    return () => {
      releaseInteraction();
      pendingGeometryRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finishOnBlur);
    };
  }, [releaseInteraction, writeGeometry]);

  const beginInteraction = (
    kind: PointerInteraction["kind"],
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const panel = panelRef.current;
    if (!panel || event.button !== 0) return;
    releaseInteraction();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = panel.getBoundingClientRect();
    const startGeometry = clampGeometry({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: preferences.minimized ? geometry.height : rect.height,
    });
    pendingGeometryRef.current = startGeometry;
    setLiveGeometry(startGeometry);
    interactionRef.current = {
      kind,
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      geometry: startGeometry,
    };
  };

  const nudge = (
    kind: PointerInteraction["kind"],
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const horizontal =
      event.key === "ArrowLeft" ? -KEYBOARD_STEP : event.key === "ArrowRight" ? KEYBOARD_STEP : 0;
    const vertical =
      event.key === "ArrowUp" ? -KEYBOARD_STEP : event.key === "ArrowDown" ? KEYBOARD_STEP : 0;
    writeGeometry(
      kind === "move"
        ? { ...geometry, x: geometry.x + horizontal, y: geometry.y + vertical }
        : {
            ...geometry,
            width: geometry.width + horizontal,
            height: geometry.height + vertical,
          },
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pendingRequestRef.current !== null) return;

    const parsed = parseAtmosphereCommands(input);
    const useLocalModel =
      interpreter === "lm-studio" &&
      parsed.commands.length === 0 &&
      parsed.issues.every((issue) => issue.reason === "unknown");
    const useProvider =
      interpreter === "provider" &&
      parsed.commands.length === 0 &&
      parsed.issues.every((issue) => issue.reason === "unknown");
    if (parsed.commands.length === 0 && !useLocalModel && !useProvider) {
      setStatus(describeAtmosphereRefusal(parsed.issues));
      return;
    }
    if (!atmosphereAvailable) {
      setStatus(UNAVAILABLE_STATUS);
      return;
    }

    const generation = ++requestGenerationRef.current;
    pendingRequestRef.current = generation;
    const interpreterAbort = new AbortController();
    interpreterAbortRef.current = interpreterAbort;
    const isCurrent = () => mountedRef.current && requestGenerationRef.current === generation;
    setBusy(true);
    setStatus("Applying…");
    try {
      const connection = getPrimaryEnvironmentConnection();
      if (connection.environmentId !== primaryEnvironmentId) {
        setStatus(ENVIRONMENT_CHANGED_STATUS);
        return;
      }
      let commands = parsed.commands;
      let providerIsCurrent: (() => boolean) | undefined;
      if (useProvider) {
        if (
          inputConnectionRef.current !== connection ||
          providerConnectionRef.current !== connection
        ) {
          setInput("");
          setInstanceId("");
          setModel("");
          inputConnectionRef.current = null;
          providerConnectionRef.current = null;
          setStatus(CONNECTION_CHANGED_STATUS);
          return;
        }
        if (!selectedProvider || !model) throw new AtmosphereProviderError();
        setStatus("Interpreting with the selected provider…");
        const proposal = await interpretAtmosphereWithProvider(
          input,
          selectedProvider,
          model,
          connection.client.server,
          getServerConfig,
          () => isCurrent() && getPrimaryEnvironmentConnection() === connection,
        );
        commands = proposal.commands;
        providerIsCurrent = proposal.isCurrent;
        if (!isCurrent()) return;
        if (getPrimaryEnvironmentConnection() !== connection) {
          setStatus(CONNECTION_CHANGED_STATUS);
          return;
        }
      }
      if (useLocalModel) {
        setStatus("Interpreting with local LM Studio…");
        commands = await interpretAtmosphereCommandWithLmStudio(input, interpreterAbort.signal);
        if (!isCurrent()) return;
        if (getPrimaryEnvironmentConnection() !== connection) {
          setStatus(CONNECTION_CHANGED_STATUS);
          return;
        }
        if (commands.length === 0) {
          setStatus("LM Studio did not return a supported command batch. Nothing changed.");
          return;
        }
        setStatus("Applying…");
      }
      if (getServerConfig()?.ambientExperienceCapabilities.atmosphere !== true) {
        setStatus(UNAVAILABLE_STATUS);
        return;
      }
      if (providerIsCurrent && !providerIsCurrent()) throw new AtmosphereProviderError();
      const confirmed = await connection.client.server.updateClientSettings(
        buildAtmospherePatch(commands, getClientSettings()),
      );
      if (!isCurrent()) return;
      if (getPrimaryEnvironmentConnection() !== connection) {
        setStatus(CONNECTION_CHANGED_STATUS);
        return;
      }
      applyClientSettingsUpdated(confirmed);
      setStatus(describeConfirmedAtmosphere(commands, confirmed));
      setInput("");
      inputConnectionRef.current = null;
    } catch (error) {
      if (!isCurrent()) return;
      setStatus(
        error instanceof AtmosphereLmStudioError || error instanceof AtmosphereProviderError
          ? error.message
          : WRITE_FAILED_STATUS,
      );
    } finally {
      interpreterAbort.abort();
      if (interpreterAbortRef.current === interpreterAbort) interpreterAbortRef.current = null;
      if (pendingRequestRef.current === generation) pendingRequestRef.current = null;
      if (isCurrent()) setBusy(false);
    }
  };

  const style: CSSProperties = {
    left: geometry.x,
    top: geometry.y,
    width: geometry.width,
    height: preferences.minimized ? MINIMIZED_HEIGHT : geometry.height,
  };

  return (
    <section
      ref={panelRef}
      aria-label="Atmosphere console"
      data-testid="atmosphere-console"
      data-atmosphere-console-minimized={preferences.minimized ? "true" : "false"}
      className="cafe-atmosphere-console fixed z-[45] flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background/95 text-foreground shadow-lg backdrop-blur [-webkit-app-region:no-drag]"
      style={style}
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border/70 px-2">
        <SparklesIcon aria-hidden="true" className="size-3.5 text-primary" />
        <h2 className="mr-auto truncate text-xs font-medium">Atmosphere console</h2>
        <button
          type="button"
          aria-label="Move atmosphere console"
          className="touch-none cursor-move rounded p-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event) => beginInteraction("move", event)}
          onKeyDown={(event) => nudge("move", event)}
        >
          <GripHorizontalIcon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Reset atmosphere console position"
          className="rounded p-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            releaseInteraction();
            pendingGeometryRef.current = null;
            setLiveGeometry(null);
            setPreferences((current) => ({
              ...current,
              minimized: false,
              geometry: null,
            }));
          }}
        >
          <RotateCcwIcon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={
            preferences.minimized ? "Restore atmosphere console" : "Minimize atmosphere console"
          }
          className="rounded p-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            releaseInteraction();
            pendingGeometryRef.current = null;
            setLiveGeometry(null);
            setPreferences((current) => ({
              ...current,
              minimized: !current.minimized,
            }));
          }}
        >
          {preferences.minimized ? (
            <Maximize2Icon className="size-3.5" />
          ) : (
            <MinusIcon className="size-3.5" />
          )}
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

      {preferences.minimized ? null : (
        <>
          <form
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 [&>*]:shrink-0"
            onSubmit={(event) => void submit(event)}
          >
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground" htmlFor="atmosphere-interpreter">
                Interpreter
              </label>
              <select
                id="atmosphere-interpreter"
                aria-label="Atmosphere interpreter"
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1 text-xs"
                value={interpreter}
                disabled={busy}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const next = value === "lm-studio" || value === "provider" ? value : "local";
                  setInterpreter(next);
                  setStatus(
                    next === "local"
                      ? IDLE_STATUS
                      : next === "provider"
                        ? "Choose a Claude instance and model. Unknown wording uses that account's quota. Codex interpretation is not supported."
                        : "Unrecognized wording goes to LM Studio at 127.0.0.1:1234, using its first listed model. Only the typed request is sent.",
                  );
                }}
              >
                <option value="local">Local grammar — no model</option>
                <option value="lm-studio">LM Studio fallback</option>
                <option value="provider">Claude provider fallback</option>
              </select>
            </div>
            {interpreter === "provider" ? (
              <>
                <label className="grid gap-1 text-[11px]">
                  Provider instance
                  <select
                    aria-label="Atmosphere provider instance"
                    className="h-7 min-w-0 rounded-md border border-input bg-background px-1 text-xs"
                    value={instanceId}
                    disabled={busy}
                    onChange={(event) => {
                      try {
                        providerConnectionRef.current = getPrimaryEnvironmentConnection();
                      } catch {
                        providerConnectionRef.current = null;
                      }
                      setInstanceId(event.currentTarget.value);
                      setModel("");
                    }}
                  >
                    <option value="">Choose an instance</option>
                    {providers.map((entry) => (
                      <option
                        key={entry.instanceId}
                        value={entry.instanceId}
                        disabled={!entry.enabled || !entry.installed}
                      >
                        {entry.instanceId}
                        {entry.driver === "codex" ? " — unsupported" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[11px]">
                  Model
                  <select
                    aria-label="Atmosphere provider model"
                    className="h-7 min-w-0 rounded-md border border-input bg-background px-1 text-xs"
                    value={model}
                    disabled={busy || selectedProvider?.driver !== "claudeAgent"}
                    onChange={(event) => setModel(event.currentTarget.value)}
                  >
                    <option value="">Choose a model</option>
                    {(selectedProvider?.driver === "claudeAgent"
                      ? selectedProvider.models
                      : []
                    ).map((entry) => (
                      <option key={entry.slug} value={entry.slug}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-[10px] break-words text-muted-foreground">
                  {selectedProvider?.driver === "codex"
                    ? "Codex interpretation is unsupported in this build."
                    : `Observed account: ${selectedProvider?.auth.email ?? selectedProvider?.auth.label ?? "not reported"}. Provider use may incur charges.`}
                </p>
              </>
            ) : null}
            <label className="text-[11px] text-muted-foreground" htmlFor="atmosphere-command">
              Falling-effect command
            </label>
            <div className="flex gap-1.5">
              <input
                id="atmosphere-command"
                autoComplete="off"
                disabled={busy}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                maxLength={MAX_ATMOSPHERE_COMMAND_LENGTH}
                placeholder="matrix, motion warp, 日本語 70%"
                value={input}
                onChange={(event) => {
                  let connection: ReturnType<typeof getPrimaryEnvironmentConnection> | null = null;
                  try {
                    connection = getPrimaryEnvironmentConnection();
                  } catch {
                    /* The submit path reports unavailable connections. */
                  }
                  if (
                    inputConnectionRef.current !== null &&
                    inputConnectionRef.current !== connection
                  ) {
                    inputConnectionRef.current = null;
                    setInput("");
                    setStatus(CONNECTION_CHANGED_STATUS);
                    return;
                  }
                  inputConnectionRef.current = event.currentTarget.value ? connection : null;
                  setInput(event.currentTarget.value);
                }}
              />
              <button
                type="submit"
                disabled={busy || input.trim().length === 0}
                className="h-8 rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Applying…" : "Apply"}
              </button>
            </div>
            <p
              aria-live="polite"
              role="status"
              data-testid="atmosphere-console-status"
              className="min-h-8 overflow-auto rounded-md border border-border/50 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground"
            >
              {status}
            </p>
          </form>
          <p className="shrink-0 px-2 pb-2 text-[9px] leading-3 text-muted-foreground/80">
            {interpreter === "provider"
              ? "Unknown wording goes to the selected Claude account. Tools are disabled. Only validated commands are saved. No project or chat text is sent."
              : interpreter === "lm-studio"
                ? "Unknown wording goes to LM Studio. Validated commands are saved to the primary Cafe server. No shell is used. At most four commands per request."
                : "Commands are parsed locally, then saved to the primary Cafe server. No model or shell is used. At most four commands per request."}
          </p>
        </>
      )}

      {preferences.minimized ? null : (
        <button
          type="button"
          aria-label="Resize atmosphere console"
          className="absolute right-0 bottom-0 touch-none cursor-nwse-resize rounded-tl p-1 text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event) => beginInteraction("resize", event)}
          onKeyDown={(event) => nudge("resize", event)}
        >
          <Maximize2Icon className="size-3" />
        </button>
      )}
    </section>
  );
}
