import { AsyncUserInputQuestions, type OrchestrationThreadActivity } from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { useState } from "react";
import { useUiLocalization } from "../../uiLocalization";
import { Button } from "../ui/button";

const isQuestions = Schema.is(AsyncUserInputQuestions);

export function AsyncQuestionsPanel({
  activities,
  disabled,
  onAddAnswer,
}: {
  readonly activities: readonly OrchestrationThreadActivity[] | undefined;
  readonly disabled: boolean;
  readonly onAddAnswer: (text: string) => boolean;
}) {
  const { t } = useUiLocalization();
  // State belongs to this thread's mounted panel, never to a provider request.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const groups = (activities ?? []).filter(
    (activity) => activity.kind === "user-input.async-requested",
  );
  const seen = new Set<string>();
  const questions = groups
    .slice(-20)
    .flatMap((activity) => {
      const payload = activity.payload;
      if (
        !payload ||
        typeof payload !== "object" ||
        !("questions" in payload) ||
        !isQuestions(payload.questions)
      )
        return [];
      return payload.questions.map((question, index) => ({
        title: question.title,
        options: question.options,
        // Provider item identity remains stable across snapshot reconciliation.
        key: JSON.stringify([
          activity.turnId,
          "itemId" in payload ? payload.itemId : activity.id,
          index,
        ]),
      }));
    })
    .filter((question) => {
      if (added.has(question.key) || seen.has(question.key)) return false;
      seen.add(question.key);
      return true;
    });
  if (!questions.length) return null;

  return (
    <details className="mb-2 rounded-xl border border-border bg-card p-3" open>
      <summary className="cursor-pointer text-sm font-medium">
        {t("Optional questions", "任意の質問")} ({questions.length})
      </summary>
      <p className="my-2 text-xs text-muted-foreground">
        {t(
          "The agent can continue. Add an answer to your prompt, then send it when ready.",
          "エージェントは作業を続けられます。回答をプロンプトに追加し、準備ができたら送信してください。",
        )}
      </p>
      <div className="grid max-h-[min(24rem,40vh)] gap-3 overflow-y-auto">
        {questions.map((question) => (
          <fieldset key={question.key} className="min-w-0 space-y-2" disabled={disabled}>
            <legend className="whitespace-pre-wrap break-words text-sm">{question.title}</legend>
            <div className="flex flex-wrap gap-2">
              {[...new Set(question.options ?? [])].map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-8 min-w-[calc(2rem*2.414)] max-w-full whitespace-normal break-words py-1"
                  aria-pressed={answers[question.key] === option}
                  onClick={() => setAnswers((current) => ({ ...current, [question.key]: option }))}
                >
                  {option}
                </Button>
              ))}
            </div>
            <textarea
              aria-label={t("Answer", "回答") + ": " + question.title}
              className="min-h-16 w-full resize-y rounded-lg border border-input bg-background p-2 text-sm"
              maxLength={4_000}
              value={answers[question.key] ?? ""}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [question.key]: event.target.value }))
              }
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-auto min-h-8 max-w-full whitespace-normal break-words"
              disabled={disabled || !answers[question.key]?.trim()}
              onClick={() => {
                const answer = answers[question.key]?.trim();
                if (answer && onAddAnswer(`${question.title}\n${answer}`)) {
                  setAdded((current) => new Set([...current, question.key]));
                }
              }}
            >
              {t("Add answer to prompt", "回答をプロンプトに追加")}
            </Button>
          </fieldset>
        ))}
      </div>
    </details>
  );
}
