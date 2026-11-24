const MAX_EXPLANATION_CHARS = 8_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Read only the native safety classification and finding, never continuation instructions. */
export function readCodexSafetyBlock(value: unknown): { explanation?: string } | undefined {
  const detail = record(value);
  const error = record(detail?.error) ?? record(record(detail?.turn)?.error) ?? detail;
  if (error?.codexErrorInfo !== "misalignmentPolicyViolation") return undefined;
  const explanation = record(error.misalignment)?.detailedExplanation;
  const text = typeof explanation === "string" ? explanation.trim() : "";
  return {
    ...(text
      ? {
          explanation:
            text.length > MAX_EXPLANATION_CHARS
              ? `${text.slice(0, MAX_EXPLANATION_CHARS)}\n[Provider finding truncated.]`
              : text,
        }
      : {}),
  };
}

export function codexSafetyBlockMessage(message: string, detail: unknown): string {
  if (!readCodexSafetyBlock(detail)) return message;
  // Session errors also appear in summaries outside this thread. Keep findings in its work log.
  return "Codex ended this task after a provider safety review. Review this thread's safety finding and the preceding actions. Repeating the prompt does not clear this block.";
}
