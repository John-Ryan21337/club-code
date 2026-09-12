import { ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  configureIdleThreadGuard,
  IDLE_THREAD_GUARD_DEFAULT_HOURS,
  IDLE_THREAD_GUARD_DEFAULT_PROMPT,
  IDLE_THREAD_GUARD_MAX_HOURS,
  IDLE_THREAD_GUARD_MIN_HOURS,
  IDLE_THREAD_GUARD_PROMPT_MAX_CHARS,
  idleThreadGuardDefaultPromptForLanguage,
  idleThreadGuardScopeKey,
  isIdleThreadGuardSupported,
  migrateStoredIdleThreadGuardBuiltInPrompt,
  type IdleThreadGuardScope,
  useIdleThreadGuardState,
} from "../../idleThreadGuard";
import { cn } from "../../lib/utils";
import { useUiLocalization } from "../../uiLocalization";
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
  disabled: disabledForThread,
}: {
  readonly scope: IdleThreadGuardScope | null;
  readonly scopeKey: string;
  readonly disabled: boolean;
}) {
  const { language, t } = useUiLocalization();
  const supported = isIdleThreadGuardSupported();
  const disabled = disabledForThread || !supported;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const state = useIdleThreadGuardState();
  const config = state.configs[scopeKey];
  const defaultPrompt = idleThreadGuardDefaultPromptForLanguage(language);
  const localizedSavedPrompt = migrateStoredIdleThreadGuardBuiltInPrompt(
    config?.prompt ?? IDLE_THREAD_GUARD_DEFAULT_PROMPT,
    language,
  );
  const [expanded, setExpanded] = useState(false);
  const [draftHours, setDraftHours] = useState(
    String(config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS),
  );
  const [draftPrompt, setDraftPrompt] = useState(localizedSavedPrompt);
  const persistedPromptRef = useRef(config?.prompt ?? IDLE_THREAD_GUARD_DEFAULT_PROMPT);
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
    Boolean(config?.awaitingActivityAfterDispatchAt) ||
    parsedHours !== (config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS) ||
    draftPrompt !== (config?.prompt ?? IDLE_THREAD_GUARD_DEFAULT_PROMPT);

  useEffect(() => {
    setDraftHours(String(config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS));
    const persistedPrompt = config?.prompt ?? IDLE_THREAD_GUARD_DEFAULT_PROMPT;
    const persistedPromptChanged = persistedPromptRef.current !== persistedPrompt;
    persistedPromptRef.current = persistedPrompt;
    setDraftPrompt((current) =>
      persistedPromptChanged
        ? localizedSavedPrompt
        : migrateStoredIdleThreadGuardBuiltInPrompt(current, language),
    );
  }, [config?.idleHours, config?.prompt, language, localizedSavedPrompt]);

  const save = async (nextEnabled = enabled) => {
    if (!scope) return;
    if (nextEnabled && (!validHours || !validPrompt)) return;
    setSaving(true);
    const saved = await configureIdleThreadGuard(scope, {
      enabled: nextEnabled,
      idleHours: nextEnabled ? parsedHours : (config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS),
      prompt: nextEnabled ? draftPrompt : (config?.prompt ?? defaultPrompt),
    });
    setSaving(false);
    setSaveError(!saved);
  };

  const status = !supported
    ? t("Unavailable in this browser", "このブラウザーでは利用できません")
    : disabled
      ? t("Unavailable for this thread", "このスレッドでは利用できません")
      : !enabled
        ? t("Off", "オフ")
        : config?.lastError
          ? t("Paused after an unacknowledged request", "未確認のリクエスト後に一時停止中")
          : config?.awaitingAcknowledgement
            ? t("Status request acknowledgement pending", "状況確認リクエストの応答を待っています")
            : config?.awaitingActivityAfterDispatchAt
              ? t(
                  "Status requested; waiting for new activity",
                  "状況を確認済み。新しいアクティビティを待機中",
                )
              : t(
                  `Armed after ${config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS}h of silence`,
                  `${config?.idleHours ?? IDLE_THREAD_GUARD_DEFAULT_HOURS}時間の無通信後に作動します`,
                );

  return (
    <div
      className="mb-2 w-full min-w-0 text-xs"
      data-idle-thread-guard-control="true"
      data-idle-thread-guard-expanded={expanded ? "true" : "false"}
    >
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger
          type="button"
          aria-label={t(
            `${expanded ? "Collapse" : "Expand"} Idle Thread Guard controls`,
            `Idle Thread Guard の操作を${expanded ? "折りたたむ" : "展開する"}`,
          )}
          className={cn(
            "flex min-h-11 w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl border px-3 py-2 text-left shadow-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            enabled
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
              : "border-red-500/50 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300",
          )}
          data-idle-thread-guard-visual-state={enabled ? "active" : "off"}
        >
          <span className="shrink-0 font-medium">
            {t("Idle Thread Guard", "アイドルスレッドガード")}
          </span>
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
              <span className="font-semibold">
                {t("Paid-usage warning:", "有料利用に関する警告：")}
              </span>{" "}
              {t(
                "Never configure an Idle Thread Guard aggressively. A status request can consume tokens while a provider is silently doing long-running work. Cafe Code enforces a hard one-hour minimum; use 2–48 hours or higher when practical.",
                "Idle Thread Guard を短い間隔で設定しないでください。プロバイダーが長時間処理を無言で続けている間にも、状況確認はトークンを消費する可能性があります。Cafe Code は最小1時間を強制します。可能なら2～48時間以上を使用してください。",
              )}
            </div>
            <p className="text-muted-foreground">
              {t(
                "The Guard watches only a running turn. New thread or session activity resets its deadline. After an acknowledged status request, it waits for newer activity and another full idle period. If acknowledgement is unknown, resave the settings to try again.",
                "ガードは実行中のターンだけを監視します。新しいスレッドまたはセッションの動作があると、待機時間を数え直します。状況確認リクエストの受領を確認した後は、新しい動作と次の待機時間が過ぎるまで待ちます。受領を確認できない場合は、設定を保存し直して再試行してください。",
              )}
            </p>
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-border/60 p-2">
              <div>
                <div className="font-medium">
                  {t("Enable for this thread", "このスレッドで有効にする")}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {t("Opt-in; Off by default.", "任意設定。初期状態はオフです。")}
                </div>
              </div>
              <Switch
                checked={enabled}
                disabled={disabled || saving || !scope}
                aria-label={t(
                  "Enable Idle Thread Guard for this thread",
                  "このスレッドで Idle Thread Guard を有効にする",
                )}
                onCheckedChange={(checked) => save(Boolean(checked))}
              />
            </div>
            <label className="mt-2 block font-medium" htmlFor={hoursId}>
              {t("Idle hours", "アイドル時間")}
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
              {t(
                `Whole hours only, ${IDLE_THREAD_GUARD_MIN_HOURS}–${IDLE_THREAD_GUARD_MAX_HOURS}. Values below one hour are never accepted.`,
                `整数の時間のみ、${IDLE_THREAD_GUARD_MIN_HOURS}～${IDLE_THREAD_GUARD_MAX_HOURS}。1時間未満の値は受け付けません。`,
              )}
            </p>
            <label className="mt-2 block font-medium" htmlFor={promptId}>
              {t("Status request", "状況確認メッセージ")}
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
                {t(
                  "The status request was not acknowledged. Resave the Guard settings to try again.",
                  "状況確認リクエストの受領を確認できませんでした。ガード設定を保存し直して再試行してください。",
                )}
              </p>
            ) : null}
            {saveError ? (
              <p role="status" className="mt-2 text-destructive">
                {t(
                  "Guard settings were not saved. Try again.",
                  "ガード設定を保存できませんでした。もう一度お試しください。",
                )}
              </p>
            ) : null}
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={disabled || saving || !scope || !changed || !validHours || !validPrompt}
                onClick={() => save()}
              >
                {t("Save Guard settings", "ガード設定を保存")}
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
