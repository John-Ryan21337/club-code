import type {
  EnvironmentId,
  ResearchAction,
  ResearchJob,
  ResearchState,
} from "@cafecode/contracts";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { researchRequest } from "../../researchApi";
import { randomUUID } from "../../lib/utils";
import { useUiLocalization } from "../../uiLocalization";
import { ResearchReport } from "./ResearchReport";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";

export interface NativeResearchHandle {
  open(): void;
  prepare(prompt: string): Promise<void>;
}
const running = (job: ResearchJob) => ["queued", "in_progress"].includes(job.status);
const fieldClass = "w-full rounded-md border bg-background p-2 text-sm";

export function NativeResearchPanel({
  environmentId,
  scope,
  ref,
}: {
  environmentId: EnvironmentId;
  scope: string;
  ref: Ref<NativeResearchHandle>;
}) {
  const { t } = useUiLocalization();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ResearchState>({ configured: false, jobs: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [boundaries, setBoundaries] = useState("");
  const [period, setPeriod] = useState("");
  const [format, setFormat] = useState("");
  const [model, setModel] = useState<"o4-mini-deep-research" | "o3-deep-research">(
    "o4-mini-deep-research",
  );
  const [maxToolCalls, setMaxToolCalls] = useState<10 | 25 | 50>(25);
  const pending = useRef<{ prompt: string; id: string } | null>(null);
  const job = state.jobs.find((entry) => entry.id === selected);

  const request = useCallback(
    async (action: ResearchAction) => {
      const result = await researchRequest(environmentId, action);
      setState(result);
      return result;
    },
    [environmentId],
  );
  const run = useCallback(
    async (action: ResearchAction) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setError("");
      try {
        await request(action);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Research request failed.");
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [request],
  );

  useImperativeHandle(
    ref,
    () => ({
      open: () => setOpen(true),
      prepare: async (prompt) => {
        if (lock.current) throw new Error("Wait for the current research request to finish.");
        lock.current = true;
        setBusy(true);
        setError("");
        setOpen(true);
        if (pending.current?.prompt !== prompt) pending.current = { prompt, id: randomUUID() };
        const id = pending.current.id;
        try {
          await request({ action: "prepare", id, scope, prompt });
          setSelected(id);
          setBoundaries("");
          setPeriod("");
          setFormat("");
          pending.current = null;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not save the research topic.");
          throw cause;
        } finally {
          lock.current = false;
          setBusy(false);
        }
      },
    }),
    [request, scope],
  );

  useEffect(() => {
    if (!open) {
      setKey("");
      return;
    }
    if (!lock.current) void run({ action: "list", scope: "*" });
  }, [open, run]);
  useEffect(() => {
    if (!open || busy || !job || !running(job)) return;
    const timer = setTimeout(() => {
      void run({ action: "poll", id: job.id });
    }, 5000);
    return () => clearTimeout(timer);
  }, [open, busy, job, run]);

  const download = () => {
    if (!job?.report) return;
    const sources =
      job.sources?.map((source) => `- ${source.title}: ${source.url}`).join("\n") ?? "";
    const url = URL.createObjectURL(
      new Blob([`${job.report}\n\nSources\n${sources}\n`], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `research-${job.id}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="max-w-3xl">
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <DialogTitle>{t("OpenAI API research", "OpenAI API 調査")}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t(
              "Uses a separate OpenAI API key and API billing. Research runs at OpenAI and continues when this panel closes. Only the reviewed brief is sent. Saved reports are available here.",
              "別の OpenAI API キーと API 課金を使用します。パネルを閉じても OpenAI で調査は続きます。確認した調査内容だけを送信します。保存した報告はここで開けます。",
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              "OpenAI stores the brief and response. This server saves reports for all server owners. Deleting a saved run removes only the server copy.",
              "OpenAI は調査内容と回答を保存します。このサーバーの報告は、すべてのサーバー所有者が利用できます。調査の削除はサーバー上のコピーだけに適用されます。",
            )}
          </p>
          <details open={!state.configured}>
            <summary className="cursor-pointer text-sm font-medium">
              {state.configured
                ? t("API key saved · Setup", "API キー保存済み・設定")
                : t("Set up an API key", "API キーを設定")}
            </summary>
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                {t(
                  "The key is stored on this Club Code server and is never returned to the browser. All server owners can use it. Your ChatGPT subscription does not cover API usage.",
                  "キーはこの Club Code サーバーに保存し、ブラウザーには返しません。サーバーの所有者が使用できます。ChatGPT の契約に API 使用料は含まれません。",
                )}
              </p>
              <label className="block text-sm">
                {t("OpenAI API key", "OpenAI API キー")}
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="sk-…"
                  maxLength={515}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !key.trim()}
                  onClick={() => {
                    const value = key.trim();
                    setKey("");
                    void run({ action: "configure", key: value });
                  }}
                >
                  {t("Save key", "キーを保存")}
                </Button>
                {state.configured && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run({ action: "remove-key" })}
                  >
                    {t("Remove key", "キーを削除")}
                  </Button>
                )}
                <a
                  className="self-center text-xs underline"
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Open API settings", "API 設定を開く")}
                </a>
              </div>
            </div>
          </details>
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
          <label className="block text-sm">
            {t("Saved research", "保存した調査")}
            <select
              className={fieldClass}
              value={selected ?? ""}
              disabled={busy}
              onChange={(e) => {
                setSelected(e.target.value);
                setBoundaries("");
                setPeriod("");
                setFormat("");
              }}
            >
              <option value="">{t("Select a research run", "調査を選択")}</option>
              {state.jobs.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.prompt.slice(0, 80)} · {entry.status}
                </option>
              ))}
            </select>
          </label>
          {!job && (
            <p className="text-sm text-muted-foreground">
              {t(
                "Choose OpenAI API from the research icon, then submit a topic in the prompt area. You can review its scope before research starts.",
                "調査アイコンで OpenAI API を選び、入力欄からテーマを送信してください。調査を始める前に範囲を確認できます。",
              )}
            </p>
          )}
          {job && (
            <div className="space-y-4">
              <p className="whitespace-pre-wrap break-words text-sm font-medium">{job.prompt}</p>
              <p role="status" className="text-sm">
                {t("Status", "状態")}: {job.status}
                {busy ? " …" : ""}
              </p>
              {job.error && (
                <p role="alert" className="text-sm text-destructive">
                  {job.error}
                </p>
              )}
              {job.status === "draft" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Clarify the scope before starting. These fields are optional when the topic already answers them. Blank fields use the defaults shown below.",
                      "開始する前に範囲を確認してください。テーマに記載済みなら入力は不要です。空欄には以下の既定値を使用します。",
                    )}
                  </p>
                  <label className="block text-sm">
                    {t(
                      "What should the research cover or exclude? Which location?",
                      "調査する内容、除外する内容、地域は？",
                    )}
                    <textarea
                      className={fieldClass}
                      value={boundaries}
                      onChange={(e) => setBoundaries(e.target.value)}
                      maxLength={4000}
                      placeholder={t(
                        "Use the topic's scope and state assumptions.",
                        "テーマの範囲を使い、前提を明記します。",
                      )}
                    />
                  </label>
                  <label className="block text-sm">
                    {t("Which time period matters?", "対象の期間は？")}
                    <input
                      className={fieldClass}
                      value={period}
                      onChange={(e) => setPeriod(e.target.value)}
                      maxLength={4000}
                      placeholder={t("Current information, with dates.", "日付を含む最新の情報。")}
                    />
                  </label>
                  <label className="block text-sm">
                    {t("What result and sources would help you?", "必要な結果と情報源は？")}
                    <textarea
                      className={fieldClass}
                      value={format}
                      onChange={(e) => setFormat(e.target.value)}
                      maxLength={4000}
                      placeholder={t(
                        "A clear report with primary sources and linked citations.",
                        "一次情報と出典リンクを含む明確な報告。",
                      )}
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="min-w-0 flex-1 text-sm">
                      {t("Research model", "調査モデル")}
                      <select
                        className={fieldClass}
                        value={model}
                        onChange={(e) => setModel(e.target.value as typeof model)}
                      >
                        <option>o4-mini-deep-research</option>
                        <option>o3-deep-research</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      {t("Maximum tool calls", "ツール呼び出し上限")}
                      <select
                        className={fieldClass}
                        value={maxToolCalls}
                        onChange={(e) =>
                          setMaxToolCalls(Number(e.target.value) as typeof maxToolCalls)
                        }
                      >
                        <option>10</option>
                        <option>25</option>
                        <option>50</option>
                      </select>
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "Starting sends the topic and these answers to OpenAI. API charges apply. The tool-call limit is not a price cap. Output is limited to 16,000 tokens, including reasoning.",
                      "開始するとテーマと回答を OpenAI に送ります。API 使用料がかかります。ツールの上限は料金の上限ではありません。推論を含む出力は16,000トークンまでです。",
                    )}
                  </p>
                  <Button
                    type="button"
                    disabled={busy || !state.configured}
                    onClick={() =>
                      void run({
                        action: "start",
                        id: job.id,
                        model,
                        maxToolCalls,
                        scope: boundaries,
                        period,
                        format,
                      })
                    }
                  >
                    {t("Start paid API research", "有料 API 調査を開始")}
                  </Button>
                </>
              )}
              {job.brief && (
                <details>
                  <summary className="cursor-pointer text-sm">
                    {t("Reviewed brief", "確認した調査内容")}
                  </summary>
                  <p className="whitespace-pre-wrap break-words text-sm">{job.brief}</p>
                </details>
              )}
              <div className="flex flex-wrap gap-2">
                {job.status === "unknown" && job.responseId && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run({ action: "poll", id: job.id })}
                  >
                    {t("Check saved run status", "保存した調査の状態を確認")}
                  </Button>
                )}
                {job.status === "unknown" && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run({ action: "resolve-unknown", id: job.id })}
                  >
                    {t(
                      "I checked OpenAI: close uncertain run locally",
                      "OpenAI を確認済み：不明な調査をローカルで閉じる",
                    )}
                  </Button>
                )}
                {running(job) && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run({ action: "cancel", id: job.id })}
                  >
                    {t("Cancel research", "調査を中止")}
                  </Button>
                )}
                {job.report && (
                  <Button type="button" variant="outline" onClick={download}>
                    {t("Download report", "報告をダウンロード")}
                  </Button>
                )}
                {!["starting", "unknown", "queued", "in_progress"].includes(job.status) && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run({ action: "delete", id: job.id })}
                  >
                    {t("Delete saved run", "保存した調査を削除")}
                  </Button>
                )}
              </div>
              {job.usage && (
                <p className="text-xs text-muted-foreground">
                  {t("API tokens", "API トークン")}: {job.usage.totalTokens.toLocaleString()} (
                  {job.usage.inputTokens.toLocaleString()} {t("input", "入力")},{" "}
                  {job.usage.outputTokens.toLocaleString()} {t("output", "出力")})
                </p>
              )}
              {job.report && (
                <div className="min-w-0 overflow-x-auto">
                  <ResearchReport text={job.report} />
                </div>
              )}
              {!!job.sources?.length && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">{t("Sources", "情報源")}</p>
                  {job.sources.map((source) => (
                    <a
                      className="block break-words text-primary underline"
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
