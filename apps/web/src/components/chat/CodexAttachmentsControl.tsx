import type {
  CodexThreadAttachmentsInput,
  CodexThreadAttachmentsResult,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
} from "@cafecode/contracts";
import { useEffect, useRef, useState } from "react";
import {
  readEnvironmentConnection,
  requireEnvironmentConnection,
  subscribeEnvironmentConnections,
} from "../../environments/runtime";
import { useUiLocalization } from "../../uiLocalization";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function CodexAttachmentsControl({
  environmentId,
  threadId,
  providerInstanceId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
}) {
  const { t } = useUiLocalization();
  const [page, setPage] = useState<CodexThreadAttachmentsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [attachmentType, setType] = useState("note");
  const [identityKey, setKey] = useState("");
  const [payloadJson, setPayload] = useState('{"text":""}');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    pending.current = false;
    setBusy(false);
    setPage(null);
    setError(false);
    setRemoveId(null);
    let connection = readEnvironmentConnection(environmentId);
    const unsubscribe = subscribeEnvironmentConnections(() => {
      const next = readEnvironmentConnection(environmentId);
      if (next !== connection) {
        connection = next;
        generation.current += 1;
        pending.current = false;
        setBusy(false);
        setPage(null);
        setError(false);
        setRemoveId(null);
      }
    });
    return () => {
      generation.current += 1;
      unsubscribe();
    };
  }, [environmentId, threadId, providerInstanceId]);

  const run = async (action: CodexThreadAttachmentsInput["action"]) => {
    if (pending.current) return;
    pending.current = true;
    const requestGeneration = generation.current;
    setBusy(true);
    setError(false);
    try {
      const connection = requireEnvironmentConnection(environmentId);
      const result = await connection.client.server.codexThreadAttachments({
        threadId,
        providerInstanceId,
        action,
      });
      if (
        requestGeneration !== generation.current ||
        connection !== readEnvironmentConnection(environmentId)
      )
        return;
      // Mutations require an explicit new read; do not imply a partial response is a full list.
      setPage(action.kind === "list" ? result : null);
      setRemoveId(null);
    } catch {
      if (requestGeneration === generation.current) setError(true);
    } finally {
      if (requestGeneration === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  let validJson = false;
  try {
    JSON.parse(payloadJson);
    validJson = true;
  } catch {
    /* The editor may contain incomplete JSON. */
  }

  return (
    <details className="@container mb-2 rounded-xl border border-border p-3">
      <summary className="cursor-pointer text-sm">
        {t("Codex attachments", "Codexの添付レコード")}
      </summary>
      <p className="my-2 text-xs text-muted-foreground">
        {t(
          "Manage records stored on this Codex thread. Records do not automatically add files or text to prompts.",
          "このCodexスレッドに保存されたレコードを管理します。ファイルやテキストはプロンプトに自動追加されません。",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-8 max-w-full whitespace-normal break-words"
          disabled={busy}
          onClick={() => void run({ kind: "list" })}
        >
          {t("Read attachments", "添付レコードを読む")}
        </Button>
        {page?.nextCursor && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8 max-w-full whitespace-normal break-words"
            disabled={busy}
            onClick={() => void run({ kind: "list", cursor: page.nextCursor! })}
          >
            {t("Next page", "次のページ")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="my-2 text-xs text-destructive">
          {t(
            "Request failed. Check the owner session, Codex version, and record limits, then retry.",
            "操作に失敗しました。所有者セッション、Codexのバージョン、レコードの制限を確認して再試行してください。",
          )}
        </p>
      )}
      {page && (
        <div className="my-2 max-h-64 space-y-2 overflow-y-auto">
          {page.data.length === 0 && (
            <p className="text-xs">
              {t("No attachments on this page.", "このページに添付レコードはありません。")}
            </p>
          )}
          {page.data.map((record) => (
            <article key={record.id} className="rounded-lg border p-2">
              <p className="break-words text-xs font-medium">
                {record.attachmentType}: {record.identityKey}
              </p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">
                {record.payloadJson}
              </pre>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-8 max-w-full whitespace-normal break-words"
                disabled={busy}
                onClick={() => {
                  if (removeId !== record.id) {
                    setRemoveId(record.id);
                    return;
                  }
                  void run({
                    kind: "remove",
                    attachmentType: record.attachmentType,
                    identityKey: record.identityKey,
                  });
                }}
              >
                {removeId === record.id
                  ? t("Confirm removal", "削除を確認")
                  : t("Remove record", "レコードを削除")}
              </Button>
            </article>
          ))}
        </div>
      )}
      <fieldset
        className="mt-3 grid min-w-0 gap-2 @min-[28rem]:grid-cols-[1fr_2.414fr]"
        disabled={busy}
      >
        <label className="text-xs">
          {t("Type", "種類")}
          <Input maxLength={256} value={attachmentType} onChange={(e) => setType(e.target.value)} />
        </label>
        <label className="text-xs">
          {t("Unique key", "一意のキー")}
          <Input maxLength={256} value={identityKey} onChange={(e) => setKey(e.target.value)} />
        </label>
        <label className="text-xs @min-[28rem]:col-span-2">
          {t("Record content (JSON)", "レコードの内容（JSON）")}
          <textarea
            className="min-h-16 w-full rounded-lg border bg-background p-2 font-mono text-xs"
            maxLength={16_384}
            value={payloadJson}
            onChange={(e) => setPayload(e.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-auto min-h-8 whitespace-normal"
          disabled={busy || !validJson || !attachmentType.trim() || !identityKey.trim()}
          onClick={() => void run({ kind: "add", attachmentType, identityKey, payloadJson })}
        >
          {t("Save record", "レコードを保存")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t(
            "An existing type and key keep the saved record. Read again after saving or removing.",
            "種類とキーが既存のものと同じ場合、保存済みの内容は保持されます。保存や削除の後は再度読み込んでください。",
          )}
        </p>
      </fieldset>
    </details>
  );
}
