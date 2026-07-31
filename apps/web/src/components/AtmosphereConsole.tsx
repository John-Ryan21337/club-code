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

import {
  type AtmosphereCommand,
  decodeAtmosphereCommandProposal,
  parseAtmosphereCommands,
} from "../atmosphereCommandParser";
import { requestAtmosphereControl } from "../atmosphereControlBus";
import {
  AtmosphereLmStudioError,
  interpretAtmosphereCommandWithLmStudio,
} from "../atmosphereLmStudio";
import { parseYouTubeSource } from "../ambientVideo";
import { parseSpotifySource } from "../spotify";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { useServerProviders } from "../rpc/serverState";
import { cn } from "../lib/utils";

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
  providerMode: Schema.optional(Schema.Literals(["local", "lm-studio", "codex", "claudeAgent"])),
  providerInstanceId: Schema.optional(Schema.String),
  providerModel: Schema.optional(Schema.String),
  geometry: GeometrySchema,
});
type Preferences = typeof PreferencesSchema.Type;

const DEFAULT_PREFERENCES: Preferences = {
  open: true,
  anchor: "custom",
  lmStudioEnabled: false,
  providerMode: "local",
  geometry: {
    x: 448,
    y: 428.5,
    width: 530,
    height: 398.5,
  },
};

type AtmosphereProviderMode = "local" | "lm-studio" | "codex" | "claudeAgent";

function lightweightModelScore(slug: string): number {
  const value = slug.toLowerCase();
  if (value.includes("haiku") || value.includes("flash")) return 0;
  if (value.includes("nano") || value.includes("mini") || value.includes("light")) return 1;
  if (value.includes("fast")) return 2;
  return 10;
}

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
  const enabled = useSettings((settings) => settings.atmosphereConsoleEnabled);
  return enabled ? <AtmosphereConsoleContent /> : null;
}

function AtmosphereConsoleContent() {
  const settings = useSettings();
  const serverProviders = useServerProviders();
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
  const providerMode: AtmosphereProviderMode =
    preferences.providerMode ?? (preferences.lmStudioEnabled ? "lm-studio" : "local");
  const selectedProvider =
    serverProviders.find(
      (provider) =>
        provider.instanceId === preferences.providerInstanceId &&
        provider.driver === providerMode &&
        provider.enabled &&
        provider.installed,
    ) ??
    serverProviders.find(
      (provider) => provider.driver === providerMode && provider.enabled && provider.installed,
    ) ??
    null;
  const selectedProviderModels = (selectedProvider?.models ?? []).toSorted(
    (left, right) =>
      lightweightModelScore(left.slug) - lightweightModelScore(right.slug) ||
      left.name.localeCompare(right.name),
  );
  const selectedProviderModel =
    selectedProviderModels.find((model) => model.slug === preferences.providerModel) ??
    selectedProviderModels[0] ??
    null;

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
      let interpreterLabel = "Zero-token";
      if (commands.length === 0 && providerMode === "lm-studio") {
        commands = await interpretAtmosphereCommandWithLmStudio(request);
        interpreterLabel = "Local LM Studio";
      } else if (
        commands.length === 0 &&
        (providerMode === "codex" || providerMode === "claudeAgent")
      ) {
        if (!selectedProvider || !selectedProviderModel) {
          setStatus(
            `No ready ${providerMode === "codex" ? "Codex" : "Claude"} model is available.`,
          );
          return;
        }
        const generated =
          await getPrimaryEnvironmentConnection().client.server.interpretAtmosphereCommand({
            request,
            modelSelection: {
              instanceId: selectedProvider.instanceId,
              model: selectedProviderModel.slug,
            },
          });
        commands = [...decodeAtmosphereCommandProposal(generated.proposal, request)];
        interpreterLabel = `${providerMode === "codex" ? "Codex" : "Claude"} · ${
          selectedProviderModel.shortName ?? selectedProviderModel.name
        }`;
      }
      if (commands.length === 0) {
        setStatus(
          providerMode !== "local"
            ? "That request did not map to a safe atmosphere control."
            : "I could not map that locally. Reword it or choose a model fallback.",
        );
        return;
      }
      const result = await applyCommands(commands);
      setStatus(`${interpreterLabel}: ${result}`);
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
        className="cafe-atmosphere-console fixed z-[85] grid size-10 place-items-center rounded-full border border-border/70 bg-transparent text-primary [-webkit-app-region:no-drag] hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      className="cafe-atmosphere-console fixed z-[85] flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-transparent text-foreground [-webkit-app-region:no-drag]"
      data-atmosphere-console-anchor={preferences.anchor}
      data-atmosphere-console-surface="true"
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
          className="h-6 max-w-28 rounded border border-border bg-transparent px-1 text-[10px]"
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
          className="touch-none cursor-move rounded p-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 rounded-md border border-border/60 bg-transparent px-2 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[10px]">
            <BotIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">Interpreter</span>
          </span>
          <select
            aria-label="Atmosphere command interpreter"
            className="h-7 min-w-0 rounded border border-border bg-transparent px-1 text-[10px]"
            value={providerMode}
            onChange={(event) => {
              const next = event.currentTarget.value as AtmosphereProviderMode;
              setPreferences((current) => ({
                ...current,
                providerMode: next,
                lmStudioEnabled: next === "lm-studio",
                providerInstanceId: undefined,
                providerModel: undefined,
              }));
            }}
          >
            <option value="local">Local parser · zero tokens</option>
            <option value="lm-studio">LM Studio · local</option>
            <option value="codex">Codex · lightweight first</option>
            <option value="claudeAgent">Claude · Haiku/fast first</option>
          </select>
          {providerMode === "codex" || providerMode === "claudeAgent" ? (
            <>
              <span className="text-[10px] text-muted-foreground">Model</span>
              <select
                aria-label="Atmosphere interpreter model"
                className="h-7 min-w-0 rounded border border-border bg-transparent px-1 text-[10px]"
                value={selectedProviderModel?.slug ?? ""}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    providerInstanceId: selectedProvider?.instanceId,
                    providerModel: event.currentTarget.value,
                  }))
                }
              >
                {selectedProviderModels.length === 0 ? (
                  <option value="">No ready models</option>
                ) : null}
                {selectedProviderModels.map((model, index) => (
                  <option key={model.slug} value={model.slug}>
                    {index === 0 && lightweightModelScore(model.slug) < 10 ? "Recommended · " : ""}
                    {model.shortName ?? model.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
        <p
          aria-live="polite"
          className={cn(
            "min-h-8 overflow-auto rounded-md bg-transparent px-2 py-1.5 text-[10px] leading-4 text-muted-foreground",
            busy && "animate-pulse",
          )}
          role="status"
        >
          {status}
        </p>
        <p className="mt-auto text-[9px] leading-3 text-muted-foreground/80">
          The selected interpreter receives only this control sentence—no chat, files, or project
          context. Codex and Claude may consume paid provider usage; LM Studio remains local.
        </p>
      </form>

      <button
        type="button"
        aria-label="Resize atmosphere console"
        className="absolute right-0 bottom-0 touch-none cursor-nwse-resize rounded-tl p-1 text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
