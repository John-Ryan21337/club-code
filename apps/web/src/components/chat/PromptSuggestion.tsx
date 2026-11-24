import type { EnvironmentId, ThreadId, TurnId } from "@cafecode/contracts";
import { useEffect, useState } from "react";
import { requireEnvironmentConnection } from "../../environments/runtime";
import { Button } from "../ui/button";

/** The parent keys this component by environment, thread, turn, and provider selection. */
export function PromptSuggestion(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  turnId: TurnId;
  eligible: boolean;
  onAccept: (suggestion: string) => boolean;
}) {
  const { environmentId, threadId, turnId, eligible } = props;
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!eligible || dismissed) return;
    let cancelled = false;
    // Let queued messages and immediate typing settle before starting paid work.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await requireEnvironmentConnection(
            environmentId,
          ).client.server.suggestNextPrompt({ threadId, turnId });
          if (!cancelled) setSuggestion(result.suggestion);
        } catch {
          // Suggestions are optional. Provider failures must not block the composer.
        }
      })();
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [environmentId, threadId, turnId, eligible, dismissed]);

  if (!eligible || !suggestion || dismissed) return null;
  return (
    <div
      className="mb-2 flex min-w-0 items-start gap-2 rounded-xl border border-border/60 bg-muted/30 p-2.5"
      role="group"
      aria-label="Suggested next prompt"
    >
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs text-muted-foreground">Suggested next prompt</p>
        <p className="whitespace-pre-wrap break-words text-sm">{suggestion}</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-1"
          onClick={() => {
            if (props.onAccept(suggestion)) setDismissed(true);
          }}
        >
          Use suggestion
        </Button>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label="Dismiss suggestion"
        onClick={() => setDismissed(true)}
      >
        Dismiss
      </Button>
    </div>
  );
}
