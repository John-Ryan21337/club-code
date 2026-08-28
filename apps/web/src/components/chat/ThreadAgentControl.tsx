import {
  CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID,
  DEFAULT_CODEX_SUBAGENT_THREAD_LIMIT,
  MAX_CODEX_SUBAGENT_THREAD_LIMIT,
  MIN_CODEX_SUBAGENT_THREAD_LIMIT,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
} from "@cafecode/contracts";
import { createModelSelection, resolveCodexSubagentThreadLimit } from "@cafecode/shared/model";
import { ChevronDownIcon, UsersRoundIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CODEX_SUBAGENT_THREAD_LIMIT;
  return Math.min(
    MAX_CODEX_SUBAGENT_THREAD_LIMIT,
    Math.max(MIN_CODEX_SUBAGENT_THREAD_LIMIT, Math.trunc(value)),
  );
}

function withLimit(
  options: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  limit: number,
): ReadonlyArray<ProviderOptionSelection> {
  return [
    ...(options ?? []).filter((option) => option.id !== CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID),
    { id: CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID, value: String(limit) },
  ];
}

export const ThreadAgentControl = memo(function ThreadAgentControl(props: {
  compact?: boolean;
  provider: ProviderDriverKind;
  providerInstanceId: ProviderInstanceId;
  model: string;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  threadTarget: ScopedThreadRef | DraftId;
  onPersistModelSelection?: (selection: ModelSelection) => Promise<void> | void;
}) {
  const currentLimit = useMemo(
    () =>
      resolveCodexSubagentThreadLimit(
        createModelSelection(props.providerInstanceId, props.model, props.modelOptions),
      ),
    [props.model, props.modelOptions, props.providerInstanceId],
  );
  const [draft, setDraft] = useState(String(currentLimit));
  const [saving, setSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);

  useEffect(() => {
    if (!saving) setDraft(String(currentLimit));
  }, [currentLimit, saving]);

  if (props.provider !== "codex") return null;

  const save = async () => {
    if (saveInFlightRef.current) return;
    const nextLimit = clampLimit(Number(draft));
    if (nextLimit === currentLimit) {
      setDraft(String(nextLimit));
      return;
    }
    const nextOptions = withLimit(props.modelOptions, nextLimit);
    saveInFlightRef.current = true;
    setDraft(String(nextLimit));
    setProviderModelOptions(props.threadTarget, props.provider, nextOptions, {
      instanceId: props.providerInstanceId,
      model: props.model,
      // This control belongs to this exact thread. It must not silently alter
      // the global/new-thread sticky model defaults.
      persistSticky: false,
    });
    if (props.onPersistModelSelection) setSaving(true);
    try {
      await props.onPersistModelSelection?.(
        createModelSelection(props.providerInstanceId, props.model, nextOptions),
      );
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  const label = `Codex workers for this thread: ${currentLimit}`;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={label}
            className={cn(
              "h-8 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground",
              props.compact && "w-8 px-0",
            )}
            data-thread-agent-control="true"
          />
        }
      >
        <UsersRoundIcon aria-hidden="true" className="size-4" />
        <Tooltip>
          <TooltipTrigger
            render={<span className={cn("tabular-nums", props.compact && "sr-only")} />}
          >
            {currentLimit}
          </TooltipTrigger>
          <TooltipPopup side="top">{label}</TooltipPopup>
        </Tooltip>
        <ChevronDownIcon aria-hidden="true" className={cn("size-3", props.compact && "hidden")} />
      </PopoverTrigger>
      <PopoverPopup align="start" side="top" className="w-80 p-3">
        <div className="space-y-3" data-thread-agent-settings="true">
          <div>
            <h3 className="text-sm font-semibold">Codex workers for this thread</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Set the maximum number of spawned Codex worker threads beside this thread's
              coordinator. This is a ceiling, not a target.
            </p>
          </div>
          <label htmlFor="thread-codex-worker-limit" className="block text-xs font-medium">
            Worker limit
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="thread-codex-worker-limit"
              nativeInput
              type="number"
              inputMode="numeric"
              min={MIN_CODEX_SUBAGENT_THREAD_LIMIT}
              max={MAX_CODEX_SUBAGENT_THREAD_LIMIT}
              step={1}
              value={draft}
              disabled={saving}
              aria-describedby="thread-codex-worker-help thread-codex-worker-warning"
              onChange={(event) => setDraft(event.currentTarget.value)}
              onBlur={() => void save()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
            />
            <span className="shrink-0 text-xs text-muted-foreground">1-128</span>
          </div>
          <p id="thread-codex-worker-help" className="text-xs text-muted-foreground">
            Saved on this exact thread. Active work is not interrupted. A changed limit takes effect
            when Club Code next creates or safely reconnects this thread's Codex session.
          </p>
          <p
            id="thread-codex-worker-warning"
            className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-950 dark:text-amber-100"
            role="note"
          >
            Higher limits can sharply increase token use, provider charges, CPU use, memory use, and
            disk use. Use large fan-out only for bounded, independent work.
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
