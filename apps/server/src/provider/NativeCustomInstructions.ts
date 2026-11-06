/** Keep user-supplied guidance separate from the native provider preset. */
export function composeNativeCustomInstructions(
  custom: string | undefined,
  nativeInstructions?: string | undefined,
): string | undefined {
  const trimmed = custom?.trim();
  if (!trimmed) return undefined;
  const wrapped = `<user-instructions>\n${trimmed}\n</user-instructions>`;
  return nativeInstructions ? `${nativeInstructions}\n\n${wrapped}` : wrapped;
}
