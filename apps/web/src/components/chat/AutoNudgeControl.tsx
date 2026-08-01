import {
  MAX_AUTO_NUDGE_MAX_ROUNDS,
  migrateStoredAutoNudgeBuiltInPrompt,
  MIN_AUTO_NUDGE_MAX_ROUNDS,
} from "@cafecode/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { AutoNudgeMode } from "~/autoNudger";
import { cn } from "~/lib/utils";
import { useUiLocalization } from "~/uiLocalization";
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

const AUTO_NUDGE_MODE_LABELS_JA: Readonly<Record<AutoNudgeMode, string>> = {
  off: "オフ",
  "hardcore-fanout": "ハードコア・ファンアウト",
  "steady-progress": "着実に進行",
};

function parseBoundedInteger(raw: string, minimum: number, maximum: number): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export interface AutoNudgeControlProps {
  readonly mode: AutoNudgeMode;
  readonly disabled: boolean;
  readonly arming: boolean;
  readonly backgroundEnabled: boolean;
  readonly roundsDispatched: number;
  readonly maxRounds: number;
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
  readonly onSaveLimits: (maxRounds: number) => Promise<void> | void;
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
  const { language, t } = useUiLocalization();
  const promptFieldId = useId();
  const promptHelpId = useId();
  const promptStatusId = useId();
  const limitsHelpId = useId();
  const limitsStatusId = useId();
  const maxRoundsFieldId = useId();
  const summaryStateId = useId();
  const summaryStatusId = useId();
  const [expanded, setExpanded] = useState(false);
  const localizedPersistedPrompt = migrateStoredAutoNudgeBuiltInPrompt(
    props.mode,
    props.persistedPrompt,
    language,
  );
  const [draftPrompt, setDraftPrompt] = useState(localizedPersistedPrompt);
  const [draftMaxRounds, setDraftMaxRounds] = useState(String(props.maxRounds));
  const [localSavePending, setLocalSavePending] = useState(false);
  const [localLimitsSavePending, setLocalLimitsSavePending] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [limitsSaveFailed, setLimitsSaveFailed] = useState(false);
  const mountedRef = useRef(false);
  const promptScopeRef = useRef(props.promptScopeKey);
  const persistedPromptRef = useRef(props.persistedPrompt);
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
    const persistedPromptChanged = persistedPromptRef.current !== props.persistedPrompt;
    persistedPromptRef.current = props.persistedPrompt;
    setDraftPrompt((current) =>
      persistedPromptChanged
        ? localizedPersistedPrompt
        : migrateStoredAutoNudgeBuiltInPrompt(props.mode, current, language),
    );
    setLocalSavePending(false);
    setSaveFailed(false);
  }, [language, localizedPersistedPrompt, props.mode, props.persistedPrompt, props.promptEditable]);
  useEffect(() => {
    limitsSaveAttemptRef.current += 1;
    setDraftMaxRounds(String(props.maxRounds));
    setLocalLimitsSavePending(false);
    setLimitsSaveFailed(false);
  }, [props.maxRounds, props.promptEditable, props.promptScopeKey]);
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
    ? t("Prompt unavailable for this thread", "このスレッドではプロンプトを利用できません")
    : saveFailed
      ? t(
          "Prompt could not be saved. Try again.",
          "プロンプトを保存できませんでした。もう一度お試しください。",
        )
      : promptSaving
        ? t("Saving prompt", "プロンプトを保存中")
        : isActive && promptIsBlank
          ? t("Prompt cannot be empty", "プロンプトは空にできません")
          : promptIsTooLong
            ? t(
                `Prompt exceeds the ${props.promptMaxLength}-character limit`,
                `プロンプトが${props.promptMaxLength}文字の上限を超えています`,
              )
            : promptChanged
              ? t("Unsaved changes", "未保存の変更")
              : t("Saved", "保存済み");
  const parsedMaxRounds = parseBoundedInteger(
    draftMaxRounds,
    MIN_AUTO_NUDGE_MAX_ROUNDS,
    MAX_AUTO_NUDGE_MAX_ROUNDS,
  );
  const limitsChanged = parsedMaxRounds !== null && parsedMaxRounds !== props.maxRounds;
  const limitsAreValid = parsedMaxRounds !== null;
  const limitsStatus = !props.promptEditable
    ? t("Round cap unavailable for this thread", "このスレッドではラウンド上限を利用できません")
    : limitsSaveFailed
      ? t(
          "Round cap could not be saved. Try again.",
          "ラウンド上限を保存できませんでした。もう一度お試しください。",
        )
      : limitsSaving
        ? t("Saving round cap", "ラウンド上限を保存中")
        : !limitsAreValid
          ? t("Enter a whole number within the allowed range", "許可範囲内の整数を入力してください")
          : limitsChanged
            ? t("Unsaved round-cap change", "ラウンド上限の変更は未保存です")
            : t("Round cap saved", "ラウンド上限を保存しました");
  const status = props.globallySuppressed
    ? t("Emergency stop is active", "緊急停止が有効です")
    : props.arming
      ? t("Saving this thread", "このスレッドを保存中")
      : props.disabled
        ? t("Unavailable for this thread", "このスレッドでは利用できません")
        : isActive
          ? t(
              "Armed for the next newly completed response",
              "次に新しく完了する応答に対して作動します",
            )
          : t("Off", "オフ");
  const visualState =
    !isActive || props.globallySuppressed
      ? ("off" as const)
      : props.backgroundEnabled
        ? ("background" as const)
        : ("active" as const);
  const stopAvailable = isActive || props.arming || props.backgroundEnabled;
  const visualStateDescription =
    visualState === "off"
      ? t("Auto Nudge is off.", "Auto Nudge はオフです。")
      : visualState === "background"
        ? t(
            "Auto Nudge is on with background continuation.",
            "Auto Nudge はバックグラウンド継続付きでオンです。",
          )
        : t("Auto Nudge is on.", "Auto Nudge はオンです。");

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
      await props.onSaveLimits(parsedMaxRounds);
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
      className={cn("mb-2 w-full min-w-0 text-xs", !expanded && "mx-auto max-w-3xl")}
      data-auto-nudge-control="true"
      data-auto-nudge-expanded={expanded ? "true" : "false"}
    >
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex min-w-0 items-center justify-end gap-1.5">
          <CollapsibleTrigger
            type="button"
            aria-describedby={`${summaryStateId} ${summaryStatusId}`}
            aria-label={t(
              `${expanded ? "Collapse" : "Expand"} Auto Nudge controls`,
              `Auto Nudge の操作を${expanded ? "折りたたむ" : "展開する"}`,
            )}
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
            <span className="relative z-10 shrink-0 font-medium">
              {t("Auto Nudge", "自動ナッジ")}
            </span>
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
              {t("Stop this thread", "このスレッドを停止")}
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
              <span className="font-semibold">
                {t("Paid-usage warning:", "有料利用に関する警告：")}
              </span>{" "}
              {t(
                "Auto Nudge can rapidly consume provider tokens, credits, and paid usage. You are responsible for provider charges; Club Code cannot reimburse them. Use a conservative round cap, monitor active runs (including through the phone web UI), and use a carefully scoped prompt or skill for this exact thread. Leave it unattended only if you accept the cost risk.",
                "Auto Nudge はプロバイダーのトークン、クレジット、有料利用枠を急速に消費する可能性があります。プロバイダー料金は利用者の責任であり、Club Code は補償できません。控えめなラウンド上限を使用し、電話の Web UI を含め実行中の処理を監視し、このスレッドだけを対象にした慎重なプロンプトまたはスキルを使用してください。費用リスクを受け入れる場合に限り無人で実行してください。",
              )}
            </div>
            <p className="text-muted-foreground">
              {t(
                `Auto Nudge does not send on an idle-time or repeating schedule. It can hand off once only when this exact thread generates a new completed response and its accepted operator queue is empty. Mode, prompt, and limits are saved only for this thread. Background continuation is opt-in and stops at ${props.maxRounds} rounds. Stop this thread blocks only its future handoffs; Emergency Stop all blocks every thread. Neither action can retract a prompt already handed to a provider.`,
                `Auto Nudge はアイドル時間や反復タイマーでは送信しません。このスレッドが新しい完了応答を生成し、受理済みのオペレーターキューが空のときだけ1回引き継ぎます。モード、プロンプト、上限はこのスレッドだけに保存されます。バックグラウンド継続は任意で、${props.maxRounds}ラウンドで停止します。「このスレッドを停止」は今後の引き継ぎだけを止め、「すべて緊急停止」は全スレッドを止めます。すでにプロバイダーへ渡したプロンプトは取り消せません。`,
              )}
            </p>
            {props.backgroundEnabled ? (
              <div className="mt-1 text-muted-foreground">
                {t(
                  `Background continuation is enabled for this thread - ${props.roundsDispatched}/${props.maxRounds} rounds dispatched.`,
                  `このスレッドではバックグラウンド継続が有効です — ${props.roundsDispatched}/${props.maxRounds}ラウンドを送信済みです。`,
                )}
              </div>
            ) : null}
            {props.globallySuppressed ? (
              <div className="mt-1 text-destructive" role="status">
                {t(
                  "Emergency Stop all is blocking Auto Nudge in every thread. Saved prompts and limits remain, but every thread is being forced Off until you explicitly allow Auto Nudge again.",
                  "「すべて緊急停止」が全スレッドの Auto Nudge を遮断しています。保存済みのプロンプトと上限は保持されますが、Auto Nudge を明示的に再許可するまで全スレッドが強制的にオフになります。",
                )}
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
                  aria-label={t("Auto nudge mode", "Auto Nudge モード")}
                  className="max-w-full sm:max-w-48"
                >
                  <span className="flex-1 truncate">
                    {t(
                      AUTO_NUDGE_MODE_LABELS[props.mode] ?? "Off",
                      AUTO_NUDGE_MODE_LABELS_JA[props.mode] ?? "オフ",
                    )}
                  </span>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem value="off">{t("Off", "オフ")}</SelectItem>
                  <SelectItem value="hardcore-fanout">
                    {t("Hardcore fan out", "ハードコア・ファンアウト")}
                  </SelectItem>
                  <SelectItem value="steady-progress">
                    {t("Steady progress", "着実に進行")}
                  </SelectItem>
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
                  aria-label={t(
                    "Continue this thread in background",
                    "このスレッドをバックグラウンドで継続",
                  )}
                  onCheckedChange={(checked) => props.onBackgroundChange(Boolean(checked))}
                />
                {t("Continue this thread in background", "このスレッドをバックグラウンドで継続")}
              </label>
              {props.globallySuppressed ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={props.onAllowAutoNudgeAgain}
                >
                  {t("Allow Auto Nudge again", "Auto Nudge を再許可")}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive-outline"
                  onClick={props.onEmergencyStopAll}
                >
                  {t("Emergency Stop all", "すべて緊急停止")}
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
                  {t("Prompt for this thread", "このスレッドのプロンプト")}
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
                    ? t(
                        "Open a persisted thread to edit its prompt.",
                        "保存済みスレッドを開いてプロンプトを編集してください。",
                      )
                    : props.mode === "off"
                      ? t(
                          "Auto Nudge is off. Saving this text does not enable it.",
                          "Auto Nudge はオフです。この文章を保存しても有効にはなりません。",
                        )
                      : t(
                          "This text is used only by this thread.",
                          "この文章はこのスレッドだけで使用されます。",
                        )}{" "}
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
                  {promptSaving
                    ? t("Saving prompt…", "プロンプトを保存中…")
                    : t("Save prompt", "プロンプトを保存")}
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
                <span className="font-medium text-foreground">
                  {t("Round cap for this thread", "このスレッドのラウンド上限")}
                </span>
                <span
                  id={limitsStatusId}
                  className={limitsSaveFailed ? "text-destructive" : "text-muted-foreground"}
                  role="status"
                  aria-live="polite"
                >
                  {limitsStatus}
                </span>
              </div>
              <div className="grid gap-2">
                <label className="grid gap-1 text-muted-foreground" htmlFor={maxRoundsFieldId}>
                  {t("Maximum rounds", "最大ラウンド数")}
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
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p id={limitsHelpId} className="text-muted-foreground">
                  {t(
                    `Whole numbers only: ${MIN_AUTO_NUDGE_MAX_ROUNDS}-${MAX_AUTO_NUDGE_MAX_ROUNDS} rounds. Saving replaces only this thread's revision-checked authority.`,
                    `整数のみ：${MIN_AUTO_NUDGE_MAX_ROUNDS}～${MAX_AUTO_NUDGE_MAX_ROUNDS}ラウンド。保存すると、このスレッドのリビジョン確認済み権限だけが置き換わります。`,
                  )}
                </p>
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={!props.promptEditable || !limitsChanged || configurationSaving}
                >
                  {limitsSaving
                    ? t("Saving round cap...", "ラウンド上限を保存中…")
                    : t("Save round cap", "ラウンド上限を保存")}
                </Button>
              </div>
            </form>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
