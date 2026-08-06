function legacyCopyText(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

/** Copy text through the native desktop shell, modern browser API, or legacy browser fallback. */
export async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Clipboard is unavailable outside a browser window.");
  }

  if (window.desktopBridge?.copyText) {
    await window.desktopBridge.copyText(value);
    return;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (clipboardError) {
      if (legacyCopyText(value)) return;
      throw clipboardError;
    }
  }

  if (!legacyCopyText(value)) {
    throw new Error("Clipboard access was denied by this browser.");
  }
}
