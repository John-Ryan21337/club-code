import { ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import {
  configureIdleThreadGuard,
  IDLE_THREAD_GUARD_DEFAULT_HOURS,
  IDLE_THREAD_GUARD_DEFAULT_PROMPT,
  IDLE_THREAD_GUARD_MAX_HOURS,
  IDLE_THREAD_GUARD_MIN_HOURS,
  IDLE_THREAD_GUARD_PROMPT_MAX_CHARS,
  idleThreadGuardScopeKey,
  type IdleThreadGuardScope,
  useIdleThreadGuardState,
} from "../../idleThreadGuard";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

export function IdleThreadGuardControl({
  scope,
  disabled,
}: {
  readonly scope: IdleThreadGuardScope | null;
  readonly disabled: boolean;
}) {
  const scopeKey = scope ? idleThreadGuardScopeKey(scope) : "unavailable";
  return (
    <ThreadScopedIdleThreadGuardControl
      key={scopeKey}
      scope={scope}
      scopeKey={scopeKey}
      disabled={disabled}
    />
  );
}

function ThreadScopedIdleThreadGuardControl({
  scope,
  scopeKey,
  disabled,
}: {
  readonly scope: IdleThreadGuardScope | null;
  readonly scopeKey: string;
  readonly disabled: boolean;
}) {
  const state = useIdleThreadGuardState();
  const config = state.configs[scopeKey];
  const [expanded, setExpanded] = useState(false);
  const [draftHours, setDraftHours] = useState(
    String(config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS),
  );
  const [draftPrompt, setDraftPrompt] = useState(
    config?.prompt ?? IDLE_THREAD_GUARD_DEFAULT_PROMPT,
  );
  const hoursId = useId();
  const promptId = useId();
  const enabled = config?.enabled ?? false;
  const parsedHours = /^\d+$/.test(draftHours) ? Number(draftHours) : Number.NaN;
  const validHours =
    Number.isSafeInteger(parsedHours) &&
    parsedHours >= IDLE_THREAD_GUARD_MIN_HOURS &&
    parsedHours <= IDLE_THREAD_GUARD_MAX_HOURS;
  const validPrompt =
    draftPrompt.trim().length > 0 && draftPrompt.length <= IDLE_THREAD_GUARD_PROMPT_MAX_CHARS;
  const changed =
    parsedHours !== (config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS) ||
    draftPrompt !== (config?.prompt ?? IDLE_THREAD_GUARD_DEFAULT_PROMPT);

  useEffect(() => {
    setDraftHours(String(config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS));
    setDraftPrompt(config?.prompt ?? IDLE_THREAD_GUARD_DEFAULT_PROMPT);
  }, [config?.idleHours, config?.prompt]);

  const save = (nextEnabled = enabled) => {
    if (!scope) return;
    if (!nextEnabled) {
      configureIdleThreadGuard(scope, {
        enabled: false,
        idleHours: config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS,
        prompt: config?.prompt ?? IDLE_THREAD_GUARD_DEFAULT_PROMPT,
      });
      return;
    }
    if (!validHours || !validPrompt) return;
    configureIdleThreadGuard(scope, {
      enabled: nextEnabled,
      idleHours: parsedHours,
      prompt: draftPrompt,
    });
  };

  const status = disabled
    ? "Unavailable for this thread"
    : !enabled
      ? "Off"
      : config?.lastError
        ? "Paused after an unacknowledged request"
        : config?.awaitingActivityAfterDispatchAt
          ? "Status requested; waiting for new activity"
          : `Armed after ${config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS}h of silence`;

  return (
    <div
      className="mb-2 w-full min-w-0 text-xs"
      data-idle-thread-guard-control="true"
      data-idle-thread-guard-expanded={expanded ? "true" : "false"}
    >
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} Idle Thread Guard controls`}
          className={cn(
            "flex min-h-11 w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl border px-3 py-2 text-left shadow-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            enabled
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
              : "border-red-500/50 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300",
          )}
          data-idle-thread-guard-visual-state={enabled ? "active" : "off"}
        >
          <span className="shrink-0 font-medium">Idle Thread Guard</span>
          <span className="min-w-0 flex-1 truncate opacity-85" aria-live="polite">
            {status}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="motion-reduce:transition-none">
          <div className="mt-1 max-h-[min(60dvh,32rem)] overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-card/90 px-3 py-2 shadow-sm sm:max-h-[min(70dvh,36rem)]">
            <div
              className="mb-2 rounded-lg border border-amber-500/60 bg-amber-500/10 px-2.5 py-2 text-amber-950 dark:text-amber-100"
              role="note"
            >
              <span className="font-semibold">Paid-usage warning:</span> never set an idle guard
              aggressively. A status request can consume tokens while a provider is silently doing
              long-running work. Club Code enforces a hard one-hour minimum; use 2–48 hours or
              higher when practical.
            </div>
            <p className="text-muted-foreground">
              This is separate from Auto Nudge. It watches only a currently running turn. Any new
              transcript text, tool activity, or session update resets its deadline, so it may never
              fire. It sends at most one status request per idle episode and waits for newer
              activity before it can re-arm.
            </p>
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-border/60 p-2">
              <div>
                <div className="font-medium">Enable for this thread</div>
                <div className="text-[10px] text-muted-foreground">Opt-in; Off by default.</div>
              </div>
              <Switch
                checked={enabled}
                disabled={disabled || !scope}
                aria-label="Enable Idle Thread Guard for this thread"
                onCheckedChange={(checked) => save(Boolean(checked))}
              />
            </div>
            <label className="mt-2 block font-medium" htmlFor={hoursId}>
              Idle hours
            </label>
            <Input
              id={hoursId}
              type="number"
              min={IDLE_THREAD_GUARD_MIN_HOURS}
              max={IDLE_THREAD_GUARD_MAX_HOURS}
              step={1}
              inputMode="numeric"
              value={draftHours}
              disabled={disabled}
              aria-invalid={!validHours}
              onChange={(event) => setDraftHours(event.currentTarget.value)}
            />
            <p
              className={cn(
                "mt-1 text-[10px]",
                validHours ? "text-muted-foreground" : "text-destructive",
              )}
            >
              Whole hours only, {IDLE_THREAD_GUARD_MIN_HOURS}–{IDLE_THREAD_GUARD_MAX_HOURS}. Values
              below one hour are never accepted.
            </p>
            <label className="mt-2 block font-medium" htmlFor={promptId}>
              Status request
            </label>
            <Textarea
              id={promptId}
              rows={3}
              maxLength={IDLE_THREAD_GUARD_PROMPT_MAX_CHARS}
              value={draftPrompt}
              disabled={disabled}
              aria-invalid={!validPrompt}
              onChange={(event) => setDraftPrompt(event.currentTarget.value)}
            />
            {config?.lastError ? (
              <p className="mt-2 text-destructive" role="status">
                {config.lastError}
              </p>
            ) : null}
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={disabled || !scope || !changed || !validHours || !validPrompt}
                onClick={() => save()}
              >
                Save Guard settings
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
