import { useEffect, useId, useRef, useState } from "react";

import type { AutoNudgeMode } from "~/autoNudger";
import {
  MAX_AUTO_NUDGE_MAX_MINUTES,
  MAX_AUTO_NUDGE_MAX_ROUNDS,
  MIN_AUTO_NUDGE_MAX_MINUTES,
  MIN_AUTO_NUDGE_MAX_ROUNDS,
} from "@cafecode/contracts";
import type {
  BackgroundAutoNudgeLedgerEntry,
  BackgroundAutoNudgeStatus,
} from "~/backgroundAutoNudger";
import { Button } from "../ui/button";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
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
  readonly backgroundDispatchSupported: boolean;
  readonly backgroundOwnedByThisThread: boolean;
  readonly backgroundStatus: BackgroundAutoNudgeStatus;
  readonly backgroundRounds: number;
  readonly backgroundMaxRounds: number;
  readonly backgroundMaxMinutes: number;
  readonly backgroundReason: string | null;
  readonly backgroundLedger: readonly BackgroundAutoNudgeLedgerEntry[];
  /**
   * Opaque identity for the exact environment/thread pair. This deliberately
   * resets an unsaved draft even when two threads have identical saved text.
   */
  readonly promptScopeKey: string;
  readonly persistedPrompt: string;
  readonly promptMaxLength: number;
  readonly promptSaving: boolean;
  readonly onSavePrompt: (prompt: string) => Promise<void> | void;
  readonly onModeChange: (mode: AutoNudgeMode) => void;
  readonly onBackgroundChange: (enabled: boolean) => void;
  readonly onPauseBackground: () => void;
  readonly onResumeBackground: () => void;
  readonly onStop: () => void;
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
  }, [props.persistedPrompt, props.promptScopeKey]);
  const isActive = props.mode !== "off";
  const promptSaving = props.promptSaving || localSavePending;
  const promptChanged = draftPrompt !== props.persistedPrompt;
  const promptIsBlank = draftPrompt.trim().length === 0;
  const promptIsTooLong = draftPrompt.length > props.promptMaxLength;
  const promptIsValid = !promptIsTooLong && (!isActive || !promptIsBlank);
  const promptStatus = saveFailed
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
  const status = props.arming
    ? "Saving mode"
    : props.backgroundOwnedByThisThread
      ? "Foreground paused while background owns this thread"
      : props.disabled
        ? "Unavailable for this thread"
        : props.countdownSeconds === null
          ? isActive
            ? "Armed for the next safely settled turn"
            : "Off"
          : `Next nudge in ${props.countdownSeconds}s`;

  const savePrompt = async () => {
    if (!promptChanged || !promptIsValid || promptSaving) return;
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
          Mode and prompt are saved only for this thread. Background continuation is opt-in and
          stops at {props.backgroundMaxRounds} rounds or {props.backgroundMaxMinutes} minutes. Stop
          blocks future handoffs but cannot retract a prompt already handed to a provider.
        </p>
        {props.backgroundOwnedByThisThread ? (
          <div className="mt-1 text-muted-foreground" aria-live="polite">
            Background {props.backgroundStatus} · {props.backgroundRounds}/
            {props.backgroundMaxRounds} rounds
            {props.backgroundReason ? ` · ${props.backgroundReason}` : ""}
          </div>
        ) : props.backgroundEnabled ? (
          <div className="mt-1 text-muted-foreground">
            Another thread owns background continuation. Turn this on here to transfer ownership.
          </div>
        ) : null}
        {!props.backgroundDispatchSupported ? (
          <div className="mt-1 text-muted-foreground" role="status">
            Automatic dispatch is unavailable in this browser because it cannot safely coordinate
            multiple windows.
          </div>
        ) : null}
        {props.backgroundLedger.length > 0 ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-muted-foreground">
              Automation ledger for this thread
            </summary>
            <ol className="mt-1 max-h-48 list-decimal space-y-0.5 overflow-y-auto pl-4 text-muted-foreground">
              {props.backgroundLedger.map((entry) => (
                <li key={entry.id}>
                  {entry.detail}
                  {entry.messageId ? ` Message ${entry.messageId}.` : ""}
                  {entry.terminalTurnKey ? ` Terminal ${entry.terminalTurnKey}.` : ""}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Select
          value={props.mode}
          disabled={props.disabled}
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
            checked={props.backgroundOwnedByThisThread}
            disabled={props.disabled || props.mode === "off" || !props.backgroundDispatchSupported}
            aria-label="Continue this thread in background"
            onCheckedChange={(checked) => props.onBackgroundChange(Boolean(checked))}
          />
          Continue this thread in background
        </label>
        <label className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
          Rounds
          <NumberField
            value={props.backgroundMaxRounds}
            min={MIN_AUTO_NUDGE_MAX_ROUNDS}
            max={MAX_AUTO_NUDGE_MAX_ROUNDS}
            step={1}
            size="sm"
            className="w-24"
            disabled={props.disabled}
            onValueChange={(value) => {
              if (value !== null && Number.isFinite(value)) {
                props.onMaxRoundsChange(
                  Math.round(
                    Math.min(MAX_AUTO_NUDGE_MAX_ROUNDS, Math.max(MIN_AUTO_NUDGE_MAX_ROUNDS, value)),
                  ),
                );
              }
            }}
          >
            <NumberFieldGroup>
              <NumberFieldDecrement aria-label="Decrease Auto Nudge round cap" />
              <NumberFieldInput aria-label="Auto Nudge maximum rounds for this thread" />
              <NumberFieldIncrement aria-label="Increase Auto Nudge round cap" />
            </NumberFieldGroup>
          </NumberField>
        </label>
        <label className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
          Minutes
          <NumberField
            value={props.backgroundMaxMinutes}
            min={MIN_AUTO_NUDGE_MAX_MINUTES}
            max={MAX_AUTO_NUDGE_MAX_MINUTES}
            step={5}
            size="sm"
            className="w-24"
            disabled={props.disabled}
            onValueChange={(value) => {
              if (value !== null && Number.isFinite(value)) {
                props.onMaxMinutesChange(
                  Math.round(
                    Math.min(
                      MAX_AUTO_NUDGE_MAX_MINUTES,
                      Math.max(MIN_AUTO_NUDGE_MAX_MINUTES, value),
                    ),
                  ),
                );
              }
            }}
          >
            <NumberFieldGroup>
              <NumberFieldDecrement aria-label="Decrease Auto Nudge time cap" />
              <NumberFieldInput aria-label="Auto Nudge maximum minutes for this thread" />
              <NumberFieldIncrement aria-label="Increase Auto Nudge time cap" />
            </NumberFieldGroup>
          </NumberField>
        </label>
        {props.backgroundOwnedByThisThread && props.backgroundStatus === "active" ? (
          <Button type="button" size="sm" variant="outline" onClick={props.onPauseBackground}>
            Pause
          </Button>
        ) : null}
        {props.backgroundOwnedByThisThread && props.backgroundStatus === "paused" ? (
          <Button type="button" size="sm" variant="outline" onClick={props.onResumeBackground}>
            Resume
          </Button>
        ) : null}
        {props.backgroundOwnedByThisThread && props.backgroundStatus === "exhausted" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => props.onBackgroundChange(true)}
          >
            Start new bounded run
          </Button>
        ) : null}
        {isActive || props.arming || props.backgroundOwnedByThisThread ? (
          <Button type="button" size="sm" variant="outline" onClick={props.onStop}>
            Stop
          </Button>
        ) : null}
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
          disabled={promptSaving}
          aria-describedby={`${promptHelpId} ${promptStatusId}`}
          aria-invalid={promptChanged && !promptIsValid ? true : undefined}
          onChange={(event) => {
            setDraftPrompt(event.currentTarget.value);
            setSaveFailed(false);
          }}
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p id={promptHelpId} className="text-muted-foreground">
            {props.mode === "off"
              ? "Auto Nudge is off. Saving this text does not enable it."
              : "This text is used only by this thread."}{" "}
            {draftPrompt.length}/{props.promptMaxLength}
          </p>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!promptChanged || !promptIsValid || promptSaving}
          >
            {promptSaving ? "Saving prompt…" : "Save prompt"}
          </Button>
        </div>
      </form>
    </div>
  );
}
