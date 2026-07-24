import type { OrchestrationThreadActivity } from "@cafecode/contracts";

import type { AppState } from "./store";

export const MAX_MATRIX_WORK_TERMS_PER_LANGUAGE = 32;
export const MAX_MATRIX_WORK_FILENAME_CHARS = 32;

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

const SENSITIVE_FILE_PATTERN =
  /(?:^|[._-])(?:auth|cookie|credential|private|password|passwd|secret|session|token)(?:[._-]|$)/iu;
const SENSITIVE_EXTENSION_PATTERN = /\.(?:env|key|p12|pfx|pem)$/iu;
const HIGH_ENTROPY_STEM_PATTERN = /(?:^|[._-])[a-f0-9]{24,}(?:[._-]|$)/iu;
const SAFE_AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,23}$/u;
const URL_SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,}$/u;

const CONCEPTS = [
  { pattern: /\baudit|review\b/iu, english: "AUDIT", japanese: "監査" },
  { pattern: /\brepair|fix|debug\b/iu, english: "REPAIR", japanese: "修正" },
  { pattern: /\btest|vitest|spec\b/iu, english: "TEST", japanese: "試験" },
  { pattern: /\btypecheck|types?\b/iu, english: "TYPES", japanese: "型検査" },
  { pattern: /\blint|format|prettier|oxlint\b/iu, english: "CLEAN", japanese: "整形" },
  { pattern: /\bbuild|bundle|compile\b/iu, english: "BUILD", japanese: "構築" },
  { pattern: /\bsearch|find\b/iu, english: "SEARCH", japanese: "検索" },
  {
    pattern: /\bdatabase|sqlite|\bsql\b|\bquery\b/iu,
    english: "DATABASE",
    japanese: "データベース",
  },
  { pattern: /\bbrowser|portal|\bocr\b/iu, english: "BROWSER", japanese: "画面認識" },
  {
    pattern: /\byoutube|spotify|\bvlc\b|media|audio|video\b/iu,
    english: "MEDIA",
    japanese: "映像音響",
  },
  { pattern: /\bmatrix|atmosphere|effect\b/iu, english: "MATRIX", japanese: "電脳雨" },
  { pattern: /\bgit|commit|branch|worktree\b/iu, english: "GIT", japanese: "履歴" },
  { pattern: /\bplan|roadmap\b/iu, english: "PLAN", japanese: "計画" },
  { pattern: /\bcache|compact|context\b/iu, english: "CONTEXT", japanese: "文脈圧縮" },
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
  if (typeof value !== "string") return null;
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
    (!ALL_FIXED_VOCABULARY_TERMS.has(value) && safeFileName(value) === value)
  );
}

function collectExplicitFileNames(
  value: unknown,
  target: string[],
  seen: Set<string>,
  depth = 0,
): void {
  if (depth > 5 || target.length >= MAX_MATRIX_WORK_TERMS_PER_LANGUAGE) return;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 32)) {
      collectExplicitFileNames(entry, target, seen, depth + 1);
    }
    return;
  }
  const record = isRecord(value) ? value : null;
  if (!record) return;

  for (const [key, nested] of Object.entries(record).slice(0, 64)) {
    if (PATH_KEYS.has(key)) {
      const name = safeFileName(nested);
      if (name) pushBounded(target, seen, name);
      continue;
    }
    if (typeof nested === "object" && nested !== null) {
      collectExplicitFileNames(nested, target, seen, depth + 1);
    }
  }
}

function classificationText(activity: OrchestrationThreadActivity): string {
  const payload = isRecord(activity.payload) ? activity.payload : null;
  const observed = isRecord(payload?.observed) ? payload.observed : null;
  return [
    activity.kind,
    payload?.itemType,
    payload?.requestKind,
    payload?.requestType,
    // Only explicitly provider-observed structured fields participate.
    // Free-form title/detail can contain prompts, commands, SQL, URLs, or
    // output and are never inspected.
    observed?.providerObserved === true ? observed.operation : null,
    observed?.providerObserved === true ? observed.activityType : null,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.slice(0, 256))
    .map((value) => value.replace(/[._/-]+/gu, " "))
    .join(" ");
}

function explicitAgentActivityKind(
  value: unknown,
  depth = 0,
): "started" | "interacted" | "interrupted" | null {
  if (depth > 4 || !isRecord(value)) return null;
  const path = value.agentPath;
  const kind = value.kind;
  if (typeof path === "string" && typeof kind === "string") {
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
    ) {
      return kind;
    }
  }
  for (const nested of Object.values(value).slice(0, 64)) {
    if (typeof nested !== "object" || nested === null) continue;
    const nestedKind = explicitAgentActivityKind(nested, depth + 1);
    if (nestedKind) return nestedKind;
  }
  return null;
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

  for (const activity of recent) {
    const payload = isRecord(activity.payload) ? activity.payload : null;
    const classification = classificationText(activity);
    let classified = false;

    for (const concept of CONCEPTS) {
      if (!concept.pattern.test(classification)) continue;
      pushBounded(english, englishSeen, concept.english);
      pushBounded(japanese, japaneseSeen, concept.japanese);
      classified = true;
    }

    const itemType = typeof payload?.itemType === "string" ? payload.itemType : "";
    const requestKind = typeof payload?.requestKind === "string" ? payload.requestKind : "";
    const requestType = typeof payload?.requestType === "string" ? payload.requestType : "";
    const fileChangeActivity = itemType === "file_change" || requestKind === "file-change";
    const fileReadActivity = requestKind === "file-read" || requestType === "file_read_approval";
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
      const agentKind = explicitAgentActivityKind(payload?.data);
      pushBounded(english, englishSeen, "AGENT");
      pushBounded(japanese, japaneseSeen, "エージェント");
      if (agentKind === "started") {
        pushBounded(english, englishSeen, "DELEGATE");
        pushBounded(japanese, japaneseSeen, "分担");
      }
      classified = true;
    }
    if (activity.tone === "error") {
      pushBounded(english, englishSeen, "ERROR");
      pushBounded(japanese, japaneseSeen, "エラー");
      classified = true;
    }

    if (payload && (fileChangeActivity || fileReadActivity)) {
      collectExplicitFileNames(payload.data, english, englishSeen);
      collectExplicitFileNames(payload.data, japanese, japaneseSeen);
    }
    if (!classified && activity.kind.startsWith("task.")) {
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
  if (!value) return EMPTY_VOCABULARY;
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

export function selectMatrixWorkVocabularyKey(state: AppState): string {
  const environmentId = state.activeEnvironmentId;
  if (!environmentId) return "";
  const environment = state.environmentStateById[environmentId];
  if (!environment) return "";

  const activities = environment.threadIds
    .filter((threadId) => environment.threadSessionById[threadId]?.status === "running")
    .flatMap((threadId) => {
      const ids = environment.activityIdsByThreadId[threadId] ?? [];
      const byId = environment.activityByThreadId[threadId] ?? {};
      return ids.slice(-80).flatMap((id) => {
        const activity = byId[id];
        return activity ? [activity] : [];
      });
    })
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-160);

  return encodeMatrixWorkVocabulary(deriveMatrixWorkVocabulary(activities));
}
