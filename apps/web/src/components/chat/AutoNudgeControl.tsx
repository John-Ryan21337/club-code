import { useEffect, useId, useRef, useState } from "react";

import type { AutoNudgeMode } from "~/autoNudger";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

const AUTO_NUDGE_MODE_LABELS: Readonly<Record<AutoNudgeMode, string>> = {
  off: "Off",
  "hardcore-fanout": "Hardcore fan out",
  "steady-progress": "Steady progress",
};

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
  readonly onModeChange: (mode: AutoNudgeMode) => void;
  readonly onBackgroundChange: (enabled: boolean) => void;
  readonly onStop: () => void;
  readonly onEmergencyStopAll: () => void;
  readonly onAllowAutoNudgeAgain: () => void;
}

export function AutoNudgeControl(props: AutoNudgeControlProps) {
  const promptFieldId = useId();
  const promptHelpId = useId();
  const promptStatusId = useId();
  const [draftPrompt, setDraftPrompt] = useState(props.persistedPrompt);
  const [localSavePending, setLocalSavePending] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const promptScopeRef = useRef(props.promptScopeKey);
  const saveAttemptRef = useRef(0);
  promptScopeRef.current = props.promptScopeKey;

  useEffect(() => {
    saveAttemptRef.current += 1;
    setDraftPrompt(props.persistedPrompt);
    setLocalSavePending(false);
    setSaveFailed(false);
  }, [props.persistedPrompt, props.promptEditable, props.promptScopeKey]);
  const isActive = props.mode !== "off";
  const promptSaving = props.promptSaving || localSavePending;
  const promptInputDisabled = !props.promptEditable || promptSaving;
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

  const savePrompt = async () => {
    if (!props.promptEditable || !promptChanged || !promptIsValid || promptSaving) return;
    const scopeAtSave = props.promptScopeKey;
    const attempt = saveAttemptRef.current + 1;
    saveAttemptRef.current = attempt;
    setLocalSavePending(true);
    setSaveFailed(false);
    try {
      await props.onSavePrompt(draftPrompt);
    } catch {
      if (promptScopeRef.current === scopeAtSave && saveAttemptRef.current === attempt) {
        setSaveFailed(true);
      }
    } finally {
      if (promptScopeRef.current === scopeAtSave && saveAttemptRef.current === attempt) {
        setLocalSavePending(false);
      }
    }
  };

  return (
    <div
      className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/80 px-3 py-2 text-xs shadow-sm"
      data-auto-nudge-control="true"
    >
      <div className="min-w-0">
        <div className="font-medium text-foreground" aria-live="polite">
          Auto nudge - {status}
        </div>
        <p className="mt-0.5 text-muted-foreground">
          Mode, prompt, and limits are saved only for this thread. Background continuation is opt-in
          and stops at {props.maxRounds} rounds or {props.maxMinutes} minutes. Stop this thread
          blocks only its future handoffs; Emergency Stop all blocks every thread. Neither action
          can retract a prompt already handed to a provider.
        </p>
        {props.backgroundEnabled ? (
          <div className="mt-1 text-muted-foreground">
            Background continuation is enabled for this thread - {props.roundsDispatched}/
            {props.maxRounds} rounds dispatched.
          </div>
        ) : null}
        {props.globallySuppressed ? (
          <div className="mt-1 text-destructive" role="status">
            Emergency Stop all is blocking Auto Nudge in every thread. Saved thread settings remain
            in place, but no automatic handoff is allowed until you explicitly allow Auto Nudge
            again.
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Select
          value={props.mode}
          disabled={props.disabled || props.arming || props.globallySuppressed}
          onValueChange={(value) => {
            if (value === "off" || value === "hardcore-fanout" || value === "steady-progress") {
              props.onModeChange(value);
            }
          }}
        >
          <SelectTrigger size="sm" aria-label="Auto nudge mode" className="max-w-48">
            <span className="flex-1 truncate">{AUTO_NUDGE_MODE_LABELS[props.mode]}</span>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            <SelectItem value="off">Off</SelectItem>
            <SelectItem value="hardcore-fanout">Hardcore fan out</SelectItem>
            <SelectItem value="steady-progress">Steady progress</SelectItem>
          </SelectPopup>
        </Select>
        <label className="flex items-center gap-2 whitespace-nowrap text-muted-foreground">
          <Switch
            checked={props.backgroundEnabled}
            disabled={
              props.disabled || props.arming || props.globallySuppressed || props.mode === "off"
            }
            aria-label="Continue this thread in background"
            onCheckedChange={(checked) => props.onBackgroundChange(Boolean(checked))}
          />
          Continue this thread in background
        </label>
        {isActive || props.arming || props.backgroundEnabled ? (
          <Button type="button" size="sm" variant="outline" onClick={props.onStop}>
            Stop this thread
          </Button>
        ) : null}
        {props.globallySuppressed ? (
          <Button type="button" size="sm" variant="outline" onClick={props.onAllowAutoNudgeAgain}>
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
        className="order-last w-full border-t border-border/50 pt-2"
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
          aria-invalid={props.promptEditable && promptChanged && !promptIsValid ? true : undefined}
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
            disabled={!props.promptEditable || !promptChanged || !promptIsValid || promptSaving}
          >
            {promptSaving ? "Saving prompt…" : "Save prompt"}
          </Button>
        </div>
      </form>
    </div>
  );
}
