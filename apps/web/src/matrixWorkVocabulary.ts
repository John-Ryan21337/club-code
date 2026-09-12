import type { OrchestrationThreadActivity, ScopedThreadRef } from "@cafecode/contracts";

import type { AppState } from "./store";

export const MAX_MATRIX_WORK_TERMS_PER_LANGUAGE = 32;
export const MAX_MATRIX_WORK_FILENAME_CHARS = 32;
const MAX_STRUCTURED_NODES = 256;
const MAX_ACTIVITY_TAIL_STRUCTURED_NODES = 4096;
const MAX_ENCODED_VOCABULARY_CHARACTERS = 8_192;

export interface MatrixWorkVocabulary {
  readonly english: readonly string[];
  readonly japanese: readonly string[];
}

const EMPTY_VOCABULARY: MatrixWorkVocabulary = {
  english: [],
  japanese: [],
};

const PATH_KEYS = new Set([
  "path",
  "filePath",
  "file_path",
  "relativePath",
  "relative_path",
  "filename",
  "newPath",
  "new_path",
  "oldPath",
  "old_path",
]);

/**
 * Item types that represent real tool work and may therefore contribute file
 * basenames. Sub-agent work reaches the parent thread as these same ordinary
 * item types, so this is what lets delegated activity name the rain. Item
 * types carrying no file identity of their own (`web_search`, `image_view`,
 * `context_compaction`) and unclassified provider output are deliberately
 * absent.
 */
const FILE_BEARING_WORK_ITEM_TYPES = new Set([
  "file_change",
  "command_execution",
  "mcp_tool_call",
  "dynamic_tool_call",
  "collab_agent_tool_call",
]);

const SENSITIVE_FILE_PATTERN =
  /(?:^|[._-])(?:auth|cookie|credential|private|password|passwd|secret|session|token)(?:[._-]|$)/iu;
const SENSITIVE_EXTENSION_PATTERN = /\.(?:env|key|p12|pfx|pem)$/iu;
const HIGH_ENTROPY_STEM_PATTERN = /(?:^|[._-])[a-f0-9]{24,}(?:[._-]|$)/iu;
const SAFE_AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,23}$/u;
const URL_SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,}$/u;

const CONCEPTS = [
  { pattern: /\b(?:audit|review)\b/iu, english: "AUDIT", japanese: "監査" },
  { pattern: /\b(?:repair|fix|debug)\b/iu, english: "REPAIR", japanese: "修正" },
  { pattern: /\b(?:test|vitest|spec)\b/iu, english: "TEST", japanese: "試験" },
  { pattern: /\b(?:typecheck|types?)\b/iu, english: "TYPES", japanese: "型検査" },
  { pattern: /\b(?:lint|format|prettier|oxlint)\b/iu, english: "CLEAN", japanese: "整形" },
  { pattern: /\b(?:build|bundle|compile)\b/iu, english: "BUILD", japanese: "構築" },
  { pattern: /\b(?:search|find)\b/iu, english: "SEARCH", japanese: "検索" },
  {
    pattern: /\b(?:database|sqlite|sql|query)\b/iu,
    english: "DATABASE",
    japanese: "データベース",
  },
  { pattern: /\b(?:browser|portal|ocr)\b/iu, english: "BROWSER", japanese: "画面認識" },
  {
    pattern: /\b(?:youtube|spotify|vlc|media|audio|video)\b/iu,
    english: "MEDIA",
    japanese: "映像音響",
  },
  { pattern: /\b(?:matrix|atmosphere|effect)\b/iu, english: "MATRIX", japanese: "電脳雨" },
  { pattern: /\b(?:git|commit|branch|worktree)\b/iu, english: "GIT", japanese: "履歴" },
  { pattern: /\b(?:plan|roadmap)\b/iu, english: "PLAN", japanese: "計画" },
  { pattern: /\b(?:cache|compact|context)\b/iu, english: "CONTEXT", japanese: "文脈圧縮" },
] as const;

const ENGLISH_FIXED_VOCABULARY_TERMS = new Set<string>([
  ...CONCEPTS.map((concept) => concept.english),
  "AGENT",
  "WRITE",
  "READ",
  "RUN",
  "DELEGATE",
  "ERROR",
  "WORK",
]);

const JAPANESE_FIXED_VOCABULARY_TERMS = new Set<string>([
  ...CONCEPTS.map((concept) => concept.japanese),
  "エージェント",
  "分担",
  "書込",
  "読込",
  "実行",
  "エラー",
  "作業",
]);
const ALL_FIXED_VOCABULARY_TERMS = new Set([
  ...ENGLISH_FIXED_VOCABULARY_TERMS,
  ...JAPANESE_FIXED_VOCABULARY_TERMS,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UNSAFE_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isSafeOwnRecordKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !UNSAFE_RECORD_KEYS.has(value);
}

function ownDataProperty(record: unknown, key: string): unknown {
  if (!isRecord(record)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isMatrixThreadActivity(value: unknown): value is OrchestrationThreadActivity {
  if (!isRecord(value)) return false;
  const kind = ownDataProperty(value, "kind");
  return typeof kind === "string";
}

function pushBounded(target: string[], seen: Set<string>, value: string) {
  if (
    value.length === 0 ||
    seen.has(value) ||
    target.length >= MAX_MATRIX_WORK_TERMS_PER_LANGUAGE
  ) {
    return;
  }
  seen.add(value);
  target.push(value);
}

function safeFileName(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4_096) return null;
  const normalized = value.trim().replaceAll("\\", "/");
  const name = normalized.split("/").findLast((segment) => segment.length > 0) ?? "";
  if (
    name.length < 2 ||
    name.length > 96 ||
    name.startsWith(".") ||
    !/^[\p{L}\p{N}][\p{L}\p{N}._@+-]*$/u.test(name) ||
    SENSITIVE_FILE_PATTERN.test(name) ||
    SENSITIVE_EXTENSION_PATTERN.test(name) ||
    HIGH_ENTROPY_STEM_PATTERN.test(name) ||
    isLikelyHighEntropyFileName(name)
  ) {
    return null;
  }
  return name.length <= MAX_MATRIX_WORK_FILENAME_CHARS
    ? name
    : `${name.slice(0, MAX_MATRIX_WORK_FILENAME_CHARS - 1)}…`;
}

/**
 * File-like identifiers are the only dynamic Matrix terms. Do not turn a
 * random URL-safe bearer/session fragment into decorative text merely because
 * it happened to be used as a file name. Requiring upper/lower/digit mix
 * avoids rejecting ordinary long source names while catching typical opaque
 * IDs that are not hexadecimal hashes.
 */
function isLikelyHighEntropyFileName(name: string): boolean {
  const segments = name.split(".");
  const stems = segments.length > 1 ? segments.slice(0, -1) : segments;
  return stems.some(
    (stem) =>
      URL_SAFE_TOKEN_PATTERN.test(stem) &&
      /[a-z]/u.test(stem) &&
      /[A-Z]/u.test(stem) &&
      /\d/u.test(stem),
  );
}

function isSafeTruncatedFileName(value: string): boolean {
  if (value.length !== MAX_MATRIX_WORK_FILENAME_CHARS || !value.endsWith("…")) {
    return false;
  }
  const visiblePrefix = value.slice(0, -1);
  return safeFileName(visiblePrefix) === visiblePrefix;
}

function isSafeDecodedTerm(value: unknown, language: "english" | "japanese"): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_MATRIX_WORK_FILENAME_CHARS
  ) {
    return false;
  }
  const fixedTerms =
    language === "english" ? ENGLISH_FIXED_VOCABULARY_TERMS : JAPANESE_FIXED_VOCABULARY_TERMS;
  return (
    fixedTerms.has(value) ||
    (!ALL_FIXED_VOCABULARY_TERMS.has(value) &&
      (safeFileName(value) === value || isSafeTruncatedFileName(value)))
  );
}

/** Bound total work as well as depth; do not invoke getters or follow cycles. */
function visitStructuredRecords(
  value: unknown,
  visit: (record: Record<string, unknown>) => void,
  budget: { remaining: number },
) {
  const pending = [{ value, depth: 0 }];
  const seen = new Set<object>();
  for (
    let count = 0;
    count < MAX_STRUCTURED_NODES && pending.length > 0 && budget.remaining > 0;
    count += 1
  ) {
    budget.remaining -= 1;
    const current = pending.pop()!;
    if (typeof current.value !== "object" || current.value === null || seen.has(current.value))
      continue;
    seen.add(current.value);
    if (!Array.isArray(current.value)) visit(current.value as Record<string, unknown>);
    if (current.depth >= 5) continue;
    let entries = 0;
    for (const key in current.value) {
      if (!Object.hasOwn(current.value, key)) continue;
      if (entries++ >= (Array.isArray(current.value) ? 32 : 64)) break;
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      const nested: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
      if (typeof nested === "object" && nested !== null && pending.length < MAX_STRUCTURED_NODES) {
        pending.push({ value: nested, depth: current.depth + 1 });
      }
    }
  }
}

function collectExplicitFileNames(
  value: unknown,
  target: string[],
  seen: Set<string>,
  budget: { remaining: number },
): void {
  visitStructuredRecords(
    value,
    (record) => {
      for (const key of PATH_KEYS) {
        const name = safeFileName(ownDataProperty(record, key));
        if (name) pushBounded(target, seen, name);
      }
    },
    budget,
  );
}

function classificationText(activity: OrchestrationThreadActivity): string {
  const payload = ownDataProperty(activity, "payload");
  const observed = ownDataProperty(payload, "observed");
  const providerObserved = ownDataProperty(observed, "providerObserved") === true;
  return [
    ownDataProperty(activity, "kind"),
    ownDataProperty(payload, "itemType"),
    ownDataProperty(payload, "requestKind"),
    ownDataProperty(payload, "requestType"),
    // Only explicitly provider-observed structured fields participate.
    // Free-form title/detail can contain prompts, commands, SQL, URLs, or
    // output and are never inspected.
    providerObserved ? ownDataProperty(observed, "operation") : null,
    providerObserved ? ownDataProperty(observed, "activityType") : null,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.slice(0, 256))
    .map((value) => value.replace(/[._/-]+/gu, " "))
    .join(" ");
}

function explicitAgentActivityKind(
  value: unknown,
  budget: { remaining: number },
): "started" | "interacted" | "interrupted" | null {
  let result: "started" | "interacted" | "interrupted" | null = null;
  visitStructuredRecords(
    value,
    (record) => {
      if (result !== null) return;
      const path = ownDataProperty(record, "agentPath");
      const kind = ownDataProperty(record, "kind");
      if (typeof path !== "string" || path.length > 4_096) return;
      const name = path
        .trim()
        .replaceAll("\\", "/")
        .split("/")
        .findLast((segment) => segment.length > 0);
      if (
        name &&
        SAFE_AGENT_NAME_PATTERN.test(name) &&
        !SENSITIVE_FILE_PATTERN.test(name) &&
        (kind === "started" || kind === "interacted" || kind === "interrupted")
      )
        result = kind;
    },
    budget,
  );
  return result;
}

export function deriveMatrixWorkVocabulary(
  activities: readonly OrchestrationThreadActivity[],
): MatrixWorkVocabulary {
  if (activities.length === 0) return EMPTY_VOCABULARY;

  const english: string[] = [];
  const japanese: string[] = [];
  const englishSeen = new Set<string>();
  const japaneseSeen = new Set<string>();
  const recent = activities.slice(-160);
  // Store updates can contain many individually bounded payloads. Share this
  // limit across the complete tail so they cannot multiply main-thread work.
  const traversalBudget = { remaining: MAX_ACTIVITY_TAIL_STRUCTURED_NODES };

  for (const activity of recent) {
    if (!isMatrixThreadActivity(activity)) continue;
    const payload = ownDataProperty(activity, "payload");
    const data = ownDataProperty(payload, "data");
    const classification = classificationText(activity);
    let classified = false;

    for (const concept of CONCEPTS) {
      if (!concept.pattern.test(classification)) continue;
      pushBounded(english, englishSeen, concept.english);
      pushBounded(japanese, japaneseSeen, concept.japanese);
      classified = true;
    }

    const itemType = ownDataProperty(payload, "itemType");
    const requestKind = ownDataProperty(payload, "requestKind");
    const requestType = ownDataProperty(payload, "requestType");
    const fileChangeActivity = itemType === "file_change" || requestKind === "file-change";
    const fileReadActivity = requestKind === "file-read" || requestType === "file_read_approval";
    const toolWorkActivity =
      (typeof itemType === "string" && FILE_BEARING_WORK_ITEM_TYPES.has(itemType)) ||
      requestKind === "command";
    if (fileChangeActivity) {
      pushBounded(english, englishSeen, "WRITE");
      pushBounded(japanese, japaneseSeen, "書込");
      classified = true;
    }
    if (fileReadActivity) {
      pushBounded(english, englishSeen, "READ");
      pushBounded(japanese, japaneseSeen, "読込");
      classified = true;
    }
    if (itemType === "command_execution" || requestKind === "command") {
      pushBounded(english, englishSeen, "RUN");
      pushBounded(japanese, japaneseSeen, "実行");
      classified = true;
    }
    if (itemType === "collab_agent_tool_call") {
      const agentKind = explicitAgentActivityKind(data, traversalBudget);
      pushBounded(english, englishSeen, "AGENT");
      pushBounded(japanese, japaneseSeen, "エージェント");
      if (agentKind === "started") {
        pushBounded(english, englishSeen, "DELEGATE");
        pushBounded(japanese, japaneseSeen, "分担");
      }
      classified = true;
    }
    if (ownDataProperty(activity, "tone") === "error") {
      pushBounded(english, englishSeen, "ERROR");
      pushBounded(japanese, japaneseSeen, "エラー");
      classified = true;
    }

    // Every agent working in the thread contributes file vocabulary, not just
    // the orchestrator's own file-change/file-read activities. Codex aggregates
    // a sub-agent's `item/*` notifications onto the initiating parent turn, so
    // delegated work arrives here as an ordinary tool/command item. Gating this
    // on file-change/file-read therefore discarded the majority of referenced
    // files and left the rain narrow while sub-agents were busy.
    //
    // Only recognised tool-work item types participate. An unclassified item is
    // provider output Cafe could not attribute to a known tool, so its paths
    // stay out rather than letting arbitrary output name the rain. This also
    // still reads only the structured PATH_KEYS allowlist through
    // `safeFileName`, so free-form command, prompt, and output text remains
    // uninspected and only filtered basenames can surface. This is best-effort
    // filtering: an ordinary-looking filename can still reveal private work.
    if (payload && (fileChangeActivity || fileReadActivity || toolWorkActivity)) {
      if (
        english.length < MAX_MATRIX_WORK_TERMS_PER_LANGUAGE ||
        japanese.length < MAX_MATRIX_WORK_TERMS_PER_LANGUAGE
      ) {
        const names: string[] = [];
        collectExplicitFileNames(data, names, new Set(), traversalBudget);
        for (const name of names) {
          pushBounded(english, englishSeen, name);
          pushBounded(japanese, japaneseSeen, name);
        }
      }
    }
    const kind = ownDataProperty(activity, "kind");
    if (!classified && typeof kind === "string" && kind.startsWith("task.")) {
      pushBounded(english, englishSeen, "WORK");
      pushBounded(japanese, japaneseSeen, "作業");
    }
  }

  return { english, japanese };
}

export function encodeMatrixWorkVocabulary(vocabulary: MatrixWorkVocabulary): string {
  return JSON.stringify([vocabulary.english, vocabulary.japanese]);
}

export function decodeMatrixWorkVocabulary(value: string): MatrixWorkVocabulary {
  if (!value || value.length > MAX_ENCODED_VOCABULARY_CHARACTERS) return EMPTY_VOCABULARY;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !Array.isArray(parsed[0]) ||
      !Array.isArray(parsed[1])
    ) {
      return EMPTY_VOCABULARY;
    }
    return {
      english: [
        ...new Set(parsed[0].filter((term): term is string => isSafeDecodedTerm(term, "english"))),
      ].slice(0, MAX_MATRIX_WORK_TERMS_PER_LANGUAGE),
      japanese: [
        ...new Set(parsed[1].filter((term): term is string => isSafeDecodedTerm(term, "japanese"))),
      ].slice(0, MAX_MATRIX_WORK_TERMS_PER_LANGUAGE),
    };
  } catch {
    return EMPTY_VOCABULARY;
  }
}

/**
 * Derives work terms only from the explicitly routed thread. Background work
 * must never leak into the selected thread's Matrix vocabulary.
 */
export function selectMatrixWorkVocabularyKey(
  state: AppState,
  selectedThreadRef: ScopedThreadRef | null = null,
): string {
  if (!isRecord(state) || !isRecord(selectedThreadRef)) return "";
  const environmentId = ownDataProperty(selectedThreadRef, "environmentId");
  const threadId = ownDataProperty(selectedThreadRef, "threadId");
  if (!isSafeOwnRecordKey(environmentId) || !isSafeOwnRecordKey(threadId)) return "";

  const environmentStateById = ownDataProperty(state, "environmentStateById");
  const environment = ownDataProperty(environmentStateById, environmentId);
  if (!isRecord(environment)) return "";
  const activityIdsByThreadId = ownDataProperty(environment, "activityIdsByThreadId");
  const activityByThreadId = ownDataProperty(environment, "activityByThreadId");
  const ids = ownDataProperty(activityIdsByThreadId, threadId);
  const byId = ownDataProperty(activityByThreadId, threadId);
  if (!Array.isArray(ids) || !isRecord(byId)) return "";

  const activities = ids.slice(-160).flatMap((id) => {
    if (!isSafeOwnRecordKey(id)) return [];
    const activity = ownDataProperty(byId, id);
    return isMatrixThreadActivity(activity) ? [activity] : [];
  });

  return encodeMatrixWorkVocabulary(deriveMatrixWorkVocabulary(activities));
}
