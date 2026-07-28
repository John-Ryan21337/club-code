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

const AUTO_NUDGE_MODE_LABELS: Readonly<Record<AutoNudgeMode, string>> = {
  off: "Off",
  "hardcore-fanout": "Hardcore fan out",
  "steady-progress": "Steady progress",
};

export function AutoNudgeControl(props: {
  mode: AutoNudgeMode;
  countdownSeconds: number | null;
  disabled: boolean;
  arming: boolean;
  backgroundEnabled: boolean;
  backgroundDispatchSupported: boolean;
  backgroundOwnedByThisThread: boolean;
  backgroundStatus: BackgroundAutoNudgeStatus;
  backgroundRounds: number;
  backgroundMaxRounds: number;
  backgroundMaxMinutes: number;
  backgroundReason: string | null;
  backgroundLedger: readonly BackgroundAutoNudgeLedgerEntry[];
  onModeChange: (mode: AutoNudgeMode) => void;
  onMaxRoundsChange: (rounds: number) => void;
  onMaxMinutesChange: (minutes: number) => void;
  onBackgroundChange: (enabled: boolean) => void;
  onPauseBackground: () => void;
  onResumeBackground: () => void;
  onStop: () => void;
}) {
  const isActive = props.mode !== "off";
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
          Mode is saved for this thread only. Background continuation is opt-in, owns one thread,
          and stops at {props.backgroundMaxRounds} rounds or {props.backgroundMaxMinutes} minutes.
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
        {isActive || props.arming ? (
          <Button type="button" size="sm" variant="outline" onClick={props.onStop}>
            Stop
          </Button>
        ) : null}
      </div>
    </div>
  );
}
