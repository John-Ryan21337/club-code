import {
  MAX_AUTO_NUDGE_MAX_MINUTES,
  MAX_AUTO_NUDGE_MAX_ROUNDS,
  MIN_AUTO_NUDGE_MAX_MINUTES,
  MIN_AUTO_NUDGE_MAX_ROUNDS,
} from "@cafecode/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { AutoNudgeMode } from "~/autoNudger";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

const AUTO_NUDGE_MODE_LABELS: Readonly<Record<AutoNudgeMode, string>> = {
  off: "Off",
  "hardcore-fanout": "Hardcore fan out",
  "steady-progress": "Steady progress",
};

function parseBoundedInteger(raw: string, minimum: number, maximum: number): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export interface AutoNudgeControlProps {
  readonly mode: AutoNudgeMode;
  readonly countdownSeconds: number | null;
  readonly disabled: boolean;
  readonly arming: boolean;
  readonly backgroundEnabled: boolean;
  readonly roundsDispatched: number;
  readonly maxRounds: number;
  readonly maxMinutes: number;
  readonly globallySuppressed: boolean;
  /**
   * Opaque identity for the exact environment/thread pair. This deliberately
   * resets an unsaved draft even when two threads have identical saved text.
   */
  readonly promptScopeKey: string;
  readonly persistedPrompt: string;
  readonly promptMaxLength: number;
  readonly promptSaving: boolean;
  readonly promptEditable: boolean;
  readonly onSavePrompt: (prompt: string) => Promise<void> | void;
  readonly limitsSaving: boolean;
  readonly onSaveLimits: (maxRounds: number, maxMinutes: number) => Promise<void> | void;
  readonly onModeChange: (mode: AutoNudgeMode) => void;
  readonly onBackgroundChange: (enabled: boolean) => void;
  readonly onStop: () => void;
  readonly onEmergencyStopAll: () => void;
  readonly onAllowAutoNudgeAgain: () => void;
}

export function AutoNudgeControl(props: AutoNudgeControlProps) {
  // An exact environment/thread change replaces the old disclosure and draft
  // state synchronously, before the replacement scope can paint.
  return <ThreadScopedAutoNudgeControl key={props.promptScopeKey} {...props} />;
}

function ThreadScopedAutoNudgeControl(props: AutoNudgeControlProps) {
  const promptFieldId = useId();
  const promptHelpId = useId();
  const promptStatusId = useId();
  const limitsHelpId = useId();
  const limitsStatusId = useId();
  const maxRoundsFieldId = useId();
  const maxMinutesFieldId = useId();
  const summaryStateId = useId();
  const summaryStatusId = useId();
  const [expanded, setExpanded] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(props.persistedPrompt);
  const [draftMaxRounds, setDraftMaxRounds] = useState(String(props.maxRounds));
  const [draftMaxMinutes, setDraftMaxMinutes] = useState(String(props.maxMinutes));
  const [localSavePending, setLocalSavePending] = useState(false);
  const [localLimitsSavePending, setLocalLimitsSavePending] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [limitsSaveFailed, setLimitsSaveFailed] = useState(false);
  const mountedRef = useRef(false);
  const promptScopeRef = useRef(props.promptScopeKey);
  const saveAttemptRef = useRef(0);
  const limitsSaveAttemptRef = useRef(0);
  promptScopeRef.current = props.promptScopeKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveAttemptRef.current += 1;
      limitsSaveAttemptRef.current += 1;
    };
  }, []);

  useEffect(() => {
    saveAttemptRef.current += 1;
    setDraftPrompt(props.persistedPrompt);
    setLocalSavePending(false);
    setSaveFailed(false);
  }, [props.persistedPrompt, props.promptEditable, props.promptScopeKey]);
  useEffect(() => {
    limitsSaveAttemptRef.current += 1;
    setDraftMaxRounds(String(props.maxRounds));
    setDraftMaxMinutes(String(props.maxMinutes));
    setLocalLimitsSavePending(false);
    setLimitsSaveFailed(false);
  }, [props.maxMinutes, props.maxRounds, props.promptEditable, props.promptScopeKey]);
  const isActive = props.mode !== "off";
  const promptSaving = props.promptSaving || localSavePending;
  const limitsSaving = props.limitsSaving || localLimitsSavePending;
  const configurationSaving = props.arming || promptSaving || limitsSaving;
  const promptInputDisabled = !props.promptEditable || configurationSaving;
  const promptChanged = draftPrompt !== props.persistedPrompt;
  const promptIsBlank = draftPrompt.trim().length === 0;
  const promptIsTooLong = draftPrompt.length > props.promptMaxLength;
  const promptIsValid = !promptIsTooLong && (!isActive || !promptIsBlank);
  const promptStatus = !props.promptEditable
    ? "Prompt unavailable for this thread"
    : saveFailed
      ? "Prompt could not be saved. Try again."
      : promptSaving
        ? "Saving prompt"
        : isActive && promptIsBlank
          ? "Prompt cannot be empty"
          : promptIsTooLong
            ? `Prompt exceeds the ${props.promptMaxLength}-character limit`
            : promptChanged
              ? "Unsaved changes"
              : "Saved";
  const parsedMaxRounds = parseBoundedInteger(
    draftMaxRounds,
    MIN_AUTO_NUDGE_MAX_ROUNDS,
    MAX_AUTO_NUDGE_MAX_ROUNDS,
  );
  const parsedMaxMinutes = parseBoundedInteger(
    draftMaxMinutes,
    MIN_AUTO_NUDGE_MAX_MINUTES,
    MAX_AUTO_NUDGE_MAX_MINUTES,
  );
  const limitsChanged =
    parsedMaxRounds !== null &&
    parsedMaxMinutes !== null &&
    (parsedMaxRounds !== props.maxRounds || parsedMaxMinutes !== props.maxMinutes);
  const limitsAreValid = parsedMaxRounds !== null && parsedMaxMinutes !== null;
  const limitsStatus = !props.promptEditable
    ? "Limits unavailable for this thread"
    : limitsSaveFailed
      ? "Limits could not be saved. Try again."
      : limitsSaving
        ? "Saving limits"
        : !limitsAreValid
          ? "Enter whole numbers within the allowed ranges"
          : limitsChanged
            ? "Unsaved limit changes"
            : "Limits saved";
  const status = props.globallySuppressed
    ? "Emergency stop is active"
    : props.arming
      ? "Saving this thread"
      : props.disabled
        ? "Unavailable for this thread"
        : props.countdownSeconds === null
          ? isActive
            ? "Armed for the next safely settled turn"
            : "Off"
          : `Next nudge in ${props.countdownSeconds}s`;
  const visualState =
    !isActive || props.globallySuppressed
      ? ("off" as const)
      : props.backgroundEnabled
        ? ("background" as const)
        : ("active" as const);
  const stopAvailable = isActive || props.arming || props.backgroundEnabled;
  const visualStateDescription =
    visualState === "off"
      ? "Auto Nudge is off."
      : visualState === "background"
        ? "Auto Nudge is on with background continuation."
        : "Auto Nudge is on.";

  const savePrompt = async () => {
    if (!props.promptEditable || !promptChanged || !promptIsValid || configurationSaving) return;
    const scopeAtSave = props.promptScopeKey;
    const attempt = saveAttemptRef.current + 1;
    saveAttemptRef.current = attempt;
    setLocalSavePending(true);
    setSaveFailed(false);
    try {
      await props.onSavePrompt(draftPrompt);
    } catch {
      if (
        mountedRef.current &&
        promptScopeRef.current === scopeAtSave &&
        saveAttemptRef.current === attempt
      ) {
        setSaveFailed(true);
      }
    } finally {
      if (
        mountedRef.current &&
        promptScopeRef.current === scopeAtSave &&
        saveAttemptRef.current === attempt
      ) {
        setLocalSavePending(false);
      }
    }
  };

  const saveLimits = async () => {
    if (
      !props.promptEditable ||
      !limitsChanged ||
      parsedMaxRounds === null ||
      parsedMaxMinutes === null ||
      configurationSaving
    ) {
      return;
    }
    const scopeAtSave = props.promptScopeKey;
    const attempt = limitsSaveAttemptRef.current + 1;
    limitsSaveAttemptRef.current = attempt;
    setLocalLimitsSavePending(true);
    setLimitsSaveFailed(false);
    try {
      await props.onSaveLimits(parsedMaxRounds, parsedMaxMinutes);
    } catch {
      if (
        mountedRef.current &&
        promptScopeRef.current === scopeAtSave &&
        limitsSaveAttemptRef.current === attempt
      ) {
        setLimitsSaveFailed(true);
      }
    } finally {
      if (
        mountedRef.current &&
        promptScopeRef.current === scopeAtSave &&
        limitsSaveAttemptRef.current === attempt
      ) {
        setLocalLimitsSavePending(false);
      }
    }
  };

  return (
    <div
      className={cn("mb-2 text-xs", !expanded && "mx-auto w-full min-w-0 max-w-3xl")}
      data-auto-nudge-control="true"
      data-auto-nudge-expanded={expanded ? "true" : "false"}
    >
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex min-w-0 items-center justify-end gap-1.5">
          <CollapsibleTrigger
            type="button"
            aria-describedby={`${summaryStateId} ${summaryStatusId}`}
            aria-label={`${expanded ? "Collapse" : "Expand"} Auto Nudge controls`}
            className={cn(
              "relative flex min-h-11 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-xl border px-3 py-2 text-left shadow-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
              visualState === "off" &&
                "border-red-500/50 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300",
              visualState === "active" &&
                "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300",
              visualState === "background" &&
                "border-cyan-400/60 bg-transparent text-emerald-700 dark:text-emerald-200",
            )}
            data-auto-nudge-disclosure="true"
            data-auto-nudge-visual-state={visualState}
          >
            {visualState === "background" ? (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-cyan-500/20"
                  data-auto-nudge-background-base="true"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-emerald-500/30 motion-safe:animate-pulse motion-reduce:animate-none"
                  data-auto-nudge-background-animation="true"
                />
              </>
            ) : null}
            <span id={summaryStateId} className="sr-only">
              {visualStateDescription}
            </span>
            <span className="relative z-10 shrink-0 font-medium">Auto Nudge</span>
            <span
              id={summaryStatusId}
              className="relative z-10 min-w-0 flex-1 truncate opacity-85"
              aria-live="polite"
            >
              {status}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "relative z-10 size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          {stopAvailable ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 shrink-0 px-2.5 sm:px-3"
              onClick={props.onStop}
            >
              Stop this thread
            </Button>
          ) : null}
        </div>
        <CollapsibleContent className="motion-reduce:transition-none">
          <div
            className="mt-1 max-h-[min(60dvh,32rem)] overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-card/90 px-3 py-2 shadow-sm sm:max-h-[min(70dvh,36rem)]"
            data-auto-nudge-details="true"
          >
            <div
              className="mb-2 rounded-lg border border-amber-500/60 bg-amber-500/10 px-2.5 py-2 text-amber-950 dark:text-amber-100"
              data-auto-nudge-cost-warning="true"
              role="note"
            >
              <span className="font-semibold">Paid-usage warning:</span> Auto Nudge can rapidly
              consume provider tokens, credits, and paid usage. You are responsible for provider
              charges; Club Code cannot reimburse them. Use conservative round/time caps, monitor
              active runs (including through the phone web UI), and use a carefully scoped prompt or
              skill for this exact thread. Leave it unattended only if you accept the cost risk.
            </div>
            <p className="text-muted-foreground">
              Auto Nudge does not send on an idle-time or repeating schedule. It can hand off once
              only after this exact thread reaches a new completed turn and its accepted operator
              queue is empty; the five-second countdown is a safety debounce, not authority. Mode,
              prompt, and limits are saved only for this thread. Background continuation is opt-in
              and stops at {props.maxRounds} rounds or {props.maxMinutes} minutes. Stop this thread
              blocks only its future handoffs; Emergency Stop all blocks every thread. Neither
              action can retract a prompt already handed to a provider.
            </p>
            {props.backgroundEnabled ? (
              <div className="mt-1 text-muted-foreground">
                Background continuation is enabled for this thread - {props.roundsDispatched}/
                {props.maxRounds} rounds dispatched.
              </div>
            ) : null}
            {props.globallySuppressed ? (
              <div className="mt-1 text-destructive" role="status">
                Emergency Stop all is blocking Auto Nudge in every thread. Saved prompts and limits
                remain, but every thread is being forced Off until you explicitly allow Auto Nudge
                again.
              </div>
            ) : null}
            <div className="mt-2 flex w-full flex-wrap items-center gap-2">
              <Select
                value={props.mode}
                disabled={props.disabled || props.arming || props.globallySuppressed}
                onValueChange={(value) => {
                  if (
                    value === "off" ||
                    value === "hardcore-fanout" ||
                    value === "steady-progress"
                  ) {
                    props.onModeChange(value);
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Auto nudge mode"
                  className="max-w-full sm:max-w-48"
                >
                  <span className="flex-1 truncate">{AUTO_NUDGE_MODE_LABELS[props.mode]}</span>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="hardcore-fanout">Hardcore fan out</SelectItem>
                  <SelectItem value="steady-progress">Steady progress</SelectItem>
                </SelectPopup>
              </Select>
              <label className="flex min-w-0 items-center gap-2 text-muted-foreground sm:whitespace-nowrap">
                <Switch
                  checked={props.backgroundEnabled}
                  disabled={
                    props.disabled ||
                    props.arming ||
                    props.globallySuppressed ||
                    props.mode === "off"
                  }
                  aria-label="Continue this thread in background"
                  onCheckedChange={(checked) => props.onBackgroundChange(Boolean(checked))}
                />
                Continue this thread in background
              </label>
              {props.globallySuppressed ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={props.onAllowAutoNudgeAgain}
                >
                  Allow Auto Nudge again
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive-outline"
                  onClick={props.onEmergencyStopAll}
                >
                  Emergency Stop all
                </Button>
              )}
            </div>
            <form
              className="mt-2 w-full border-t border-border/50 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                void savePrompt();
              }}
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                <label className="font-medium text-foreground" htmlFor={promptFieldId}>
                  Prompt for this thread
                </label>
                <span
                  id={promptStatusId}
                  className={saveFailed ? "text-destructive" : "text-muted-foreground"}
                  role="status"
                  aria-live="polite"
                >
                  {promptStatus}
                </span>
              </div>
              <Textarea
                id={promptFieldId}
                size="sm"
                rows={3}
                value={draftPrompt}
                maxLength={props.promptMaxLength}
                disabled={promptInputDisabled}
                aria-describedby={`${promptHelpId} ${promptStatusId}`}
                aria-invalid={
                  props.promptEditable && promptChanged && !promptIsValid ? true : undefined
                }
                onChange={(event) => {
                  setDraftPrompt(event.currentTarget.value);
                  setSaveFailed(false);
                }}
              />
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p id={promptHelpId} className="text-muted-foreground">
                  {!props.promptEditable
                    ? "Open a persisted thread to edit its prompt."
                    : props.mode === "off"
                      ? "Auto Nudge is off. Saving this text does not enable it."
                      : "This text is used only by this thread."}{" "}
                  {draftPrompt.length}/{props.promptMaxLength}
                </p>
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={
                    !props.promptEditable || !promptChanged || !promptIsValid || configurationSaving
                  }
                >
                  {promptSaving ? "Saving prompt…" : "Save prompt"}
                </Button>
              </div>
            </form>
            <form
              className="mt-2 w-full border-t border-border/50 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                void saveLimits();
              }}
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                <span className="font-medium text-foreground">Limits for this thread</span>
                <span
                  id={limitsStatusId}
                  className={limitsSaveFailed ? "text-destructive" : "text-muted-foreground"}
                  role="status"
                  aria-live="polite"
                >
                  {limitsStatus}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-muted-foreground" htmlFor={maxRoundsFieldId}>
                  Maximum rounds
                  <Input
                    nativeInput
                    id={maxRoundsFieldId}
                    type="number"
                    inputMode="numeric"
                    min={MIN_AUTO_NUDGE_MAX_ROUNDS}
                    max={MAX_AUTO_NUDGE_MAX_ROUNDS}
                    step={1}
                    size="sm"
                    value={draftMaxRounds}
                    disabled={!props.promptEditable || configurationSaving}
                    aria-describedby={`${limitsHelpId} ${limitsStatusId}`}
                    aria-invalid={
                      props.promptEditable && parsedMaxRounds === null ? true : undefined
                    }
                    onChange={(event) => {
                      setDraftMaxRounds(event.currentTarget.value);
                      setLimitsSaveFailed(false);
                    }}
                  />
                </label>
                <label className="grid gap-1 text-muted-foreground" htmlFor={maxMinutesFieldId}>
                  Maximum minutes
                  <Input
                    nativeInput
                    id={maxMinutesFieldId}
                    type="number"
                    inputMode="numeric"
                    min={MIN_AUTO_NUDGE_MAX_MINUTES}
                    max={MAX_AUTO_NUDGE_MAX_MINUTES}
                    step={1}
                    size="sm"
                    value={draftMaxMinutes}
                    disabled={!props.promptEditable || configurationSaving}
                    aria-describedby={`${limitsHelpId} ${limitsStatusId}`}
                    aria-invalid={
                      props.promptEditable && parsedMaxMinutes === null ? true : undefined
                    }
                    onChange={(event) => {
                      setDraftMaxMinutes(event.currentTarget.value);
                      setLimitsSaveFailed(false);
                    }}
                  />
                </label>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p id={limitsHelpId} className="text-muted-foreground">
                  Whole numbers only: {MIN_AUTO_NUDGE_MAX_ROUNDS}-{MAX_AUTO_NUDGE_MAX_ROUNDS} rounds
                  and {MIN_AUTO_NUDGE_MAX_MINUTES}-{MAX_AUTO_NUDGE_MAX_MINUTES} minutes. Saving
                  replaces only this thread's revision-checked authority.
                </p>
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={!props.promptEditable || !limitsChanged || configurationSaving}
                >
                  {limitsSaving ? "Saving limits..." : "Save limits"}
                </Button>
              </div>
            </form>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
