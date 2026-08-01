import type { UiLanguagePreference } from "@cafecode/contracts/settings";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";

import { useSettings } from "./hooks/useSettings";
import {
  isKnownEnglishUiText,
  localizeUiText,
  type ResolvedUiLanguage,
  resolveUiLanguage,
} from "./uiLocalizationCore";

export { localizeUiText, resolveSystemUiLanguage, resolveUiLanguage } from "./uiLocalizationCore";
export type { ResolvedUiLanguage } from "./uiLocalizationCore";

type UiLocalizationContextValue = {
  readonly preference: UiLanguagePreference;
  readonly language: ResolvedUiLanguage;
  readonly t: (english: string, japanese?: string) => string;
};

type LocalizationSource = { readonly english: string; rendered: string };

const SOURCE_TEXT_BY_NODE = new WeakMap<Text, LocalizationSource>();
const SOURCE_ATTRIBUTES_BY_ELEMENT = new WeakMap<Element, Map<string, LocalizationSource>>();

const UiLocalizationContext = createContext<UiLocalizationContextValue>({
  preference: "system",
  language: "en",
  t: (english) => english,
});

function replacePreservingWhitespace(value: string, replacement: string): string {
  const start = value.search(/\S/);
  if (start < 0) return value;
  const end = value.search(/\s+$/);
  return `${value.slice(0, start)}${replacement}${end < 0 ? "" : value.slice(end)}`;
}

function textIsOperatorContent(node: Text): boolean {
  return Boolean(
    node.parentElement?.closest(
      'textarea, input, pre, code, [contenteditable="true"], [data-message-id], [data-chat-copy-region], [data-no-ui-localize="true"]',
    ),
  );
}

function localizeTextNode(node: Text, language: ResolvedUiLanguage): void {
  if (textIsOperatorContent(node)) return;
  const trimmed = node.data.trim();
  let source = SOURCE_TEXT_BY_NODE.get(node);
  if (isKnownEnglishUiText(trimmed)) {
    source = { english: trimmed, rendered: node.data };
    SOURCE_TEXT_BY_NODE.set(node, source);
  } else if (source && node.data !== source.rendered) {
    // React reused this text node for dynamic/operator-derived content. Forget
    // the old UI label rather than overwriting the new value on every mutation.
    SOURCE_TEXT_BY_NODE.delete(node);
    return;
  }
  if (!source) return;
  const translated = localizeUiText(source.english, language);
  const next = replacePreservingWhitespace(node.data, translated);
  source.rendered = next;
  if (next !== node.data) node.data = next;
}

const LOCALIZED_ATTRIBUTES = ["aria-label", "title", "placeholder"] as const;

function localizeElementAttributes(element: Element, language: ResolvedUiLanguage): void {
  if (element.closest('[data-message-id], [data-chat-copy-region], [data-no-ui-localize="true"]')) {
    return;
  }
  for (const attribute of LOCALIZED_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const trimmed = value.trim();
    let sources = SOURCE_ATTRIBUTES_BY_ELEMENT.get(element);
    if (isKnownEnglishUiText(trimmed)) {
      sources ??= new Map<string, LocalizationSource>();
      sources.set(attribute, { english: trimmed, rendered: value });
      SOURCE_ATTRIBUTES_BY_ELEMENT.set(element, sources);
    }
    const source = sources?.get(attribute);
    if (!source) continue;
    if (!isKnownEnglishUiText(trimmed) && value !== source.rendered) {
      sources?.delete(attribute);
      continue;
    }
    const translated = localizeUiText(source.english, language);
    source.rendered = translated;
    if (translated !== value) element.setAttribute(attribute, translated);
  }
}

function localizeTree(root: Node, language: ResolvedUiLanguage): void {
  if (root.nodeType === Node.TEXT_NODE) {
    localizeTextNode(root as Text, language);
    return;
  }
  if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return;
  if (root instanceof Element) localizeElementAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node as Text, language);
    else localizeElementAttributes(node as Element, language);
    node = walker.nextNode();
  }
}

function useLegacyUiLocalizationBridge(language: ResolvedUiLanguage): void {
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    localizeTree(root, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          localizeTextNode(mutation.target as Text, language);
          continue;
        }
        if (mutation.type === "attributes") {
          localizeElementAttributes(mutation.target as Element, language);
          continue;
        }
        for (const addedNode of mutation.addedNodes) localizeTree(addedNode, language);
      }
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: [...LOCALIZED_ATTRIBUTES],
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [language]);
}

export function UiLocalizationProvider({ children }: { readonly children: ReactNode }) {
  const preference = useSettings((settings) => settings.uiLanguage);
  const language = resolveUiLanguage(preference);
  const t = useCallback(
    (english: string, japanese?: string) => localizeUiText(english, language, japanese),
    [language],
  );
  const value = useMemo(() => ({ preference, language, t }), [language, preference, t]);

  useEffect(() => {
    document.documentElement.lang = language === "ja" ? "ja" : "en";
    document.documentElement.dataset.uiLanguage = language;
  }, [language]);
  useLegacyUiLocalizationBridge(language);

  return <UiLocalizationContext.Provider value={value}>{children}</UiLocalizationContext.Provider>;
}

export function useUiLocalization(): UiLocalizationContextValue {
  return useContext(UiLocalizationContext);
}
