import { MicroscopeIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { useUiLocalization } from "../../uiLocalization";
import { Button } from "../ui/button";
import { Popover, PopoverTrigger, PopoverPopup } from "../ui/popover";

export function ComposerResearchButton({
  enabled,
  disabled = false,
  preserveComposerFocusOnPointerDown = false,
  onToggle,
  workflow = "agent",
  onWorkflowChange,
  onOpenApi,
}: {
  readonly enabled: boolean;
  readonly disabled?: boolean;
  readonly preserveComposerFocusOnPointerDown?: boolean;
  readonly onToggle: () => void;
  readonly workflow?: "agent" | "api";
  readonly onWorkflowChange?: (workflow: "agent" | "api") => void;
  readonly onOpenApi?: () => void;
}) {
  const { t } = useUiLocalization();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className={cn(
              "shrink-0",
              enabled
                ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                : "text-muted-foreground/70 hover:text-foreground/80",
            )}
            disabled={disabled}
            aria-label={t("Deep research", "詳細な調査")}
            aria-pressed={enabled}
            title={t(
              workflow === "api"
                ? "Deep research for the next message: OpenAI API. Review scope before paid research starts."
                : "Deep research for the next message: selected agent. Clarify scope, check sources, and write a cited report.",
              workflow === "api"
                ? "次のメッセージを OpenAI API で調査します。有料調査の開始前に範囲を確認します。"
                : "次のメッセージを選択中のエージェントで調査します。範囲を確認し、情報源を調べ、出典付きの報告を作成します。",
            )}
            onPointerDown={
              preserveComposerFocusOnPointerDown ? (event) => event.preventDefault() : undefined
            }
            onClick={onToggle}
          >
            <MicroscopeIcon aria-hidden="true" className="size-4" />
          </Button>
        }
      />
      <PopoverPopup side="top" align="start" className="w-72 max-w-[calc(100vw-2rem)]">
        <div className="space-y-2 text-sm">
          <p className="font-medium">
            {t("Deep research · Next message", "詳細な調査・次のメッセージ")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              "Choose a workflow. The icon turns off after you submit the topic.",
              "方法を選んでください。テーマの送信後、アイコンはオフに戻ります。",
            )}
          </p>
          <Button
            type="button"
            variant={enabled && workflow === "agent" ? "secondary" : "outline"}
            className="w-full"
            onClick={() => {
              onWorkflowChange?.("agent");
              if (!enabled) onToggle();
              setOpen(false);
            }}
          >
            {t("Use selected agent", "選択中のエージェントを使用")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t(
              "Clarifies scope, uses its search tools, and writes a cited report. Uses your agent's plan and tokens.",
              "範囲を確認し、検索ツールで調査し、出典付きの報告を作成します。エージェントの契約とトークンを使用します。",
            )}
          </p>
          <Button
            type="button"
            variant={enabled && workflow === "api" ? "secondary" : "outline"}
            className="w-full"
            onClick={() => {
              onWorkflowChange?.("api");
              if (!enabled) onToggle();
              setOpen(false);
            }}
          >
            {t("Use OpenAI API", "OpenAI API を使用")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t(
              "Review scope before starting dedicated Deep Research. Requires a separate API key and API billing.",
              "専用の Deep Research を開始する前に範囲を確認します。別の API キーと API 課金が必要です。",
            )}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              onOpenApi?.();
              setOpen(false);
            }}
          >
            {t("API setup and saved reports", "API 設定と保存した報告")}
          </Button>
          {enabled && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                onToggle();
                setOpen(false);
              }}
            >
              {t("Turn research off", "調査をオフにする")}
            </Button>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
