export const COWORK_REPLICA_STATUS_PAGE_LIMIT = 50;
export const COWORK_REPLICA_STATUS_MAX_ENTRIES = 200;
export const COWORK_REPLICA_STATUS_MAX_PAGES = 4;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/;
const MAX_PATH_CHARS = 4_096;
const MAX_PATH_UTF8_BYTES = 4_096;
const MAX_PATH_SEGMENT_CHARS = 255;
const MAX_PATH_SEGMENT_UTF8_BYTES = 255;
const WINDOWS_RESERVED_FILE_STEM =
  /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/iu;

export type CoworkReplicaMaterialization =
  | "current"
  | "not-materialized"
  | "pending"
  | "recovery-preserved"
  | "failed";

export type CoworkReplicaOperatorAttention =
  | "conflict-needs-resolution"
  | "database-fork-needs-selection"
  | "head-tombstoned"
  | "materialization-failed"
  | "recovery-copy-preserved";

export interface CoworkReplicaRevisionView {
  readonly revisionId: string;
  readonly contentSha256: string | null;
  readonly auditRef: string;
}

export interface CoworkReplicaStatusEntry {
  readonly relativePath: string;
  readonly manifestRevision: number;
  readonly head: (CoworkReplicaRevisionView & { readonly kind: "version" | "tombstone" }) | null;
  readonly forks: readonly CoworkReplicaRevisionView[];
  readonly recoverableTombstones: readonly CoworkReplicaRevisionView[];
  readonly conflictRefs: readonly string[];
  readonly materialization: CoworkReplicaMaterialization;
  readonly operatorAttention: readonly CoworkReplicaOperatorAttention[];
}

export interface CoworkReplicaStatusPage {
  readonly sharedProjectId: string;
  readonly projectRevision: number;
  readonly entries: readonly CoworkReplicaStatusEntry[];
  readonly nextCursor: string | null;
}

export interface CoworkReplicaStatusView {
  readonly sharedProjectId: string;
  readonly projectRevision: number;
  readonly entries: readonly CoworkReplicaStatusEntry[];
  readonly nextCursor: string | null;
  readonly consumedCursors: readonly string[];
}

export class CoworkReplicaStatusPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoworkReplicaStatusPayloadError";
  }
}

function fail(message: string): never {
  throw new CoworkReplicaStatusPayloadError(message);
}

function record(
  value: unknown,
  expected: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }

  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(`${label} could not be inspected safely`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail(`${label} has an unsupported shape`);
  }
  const actual = (ownKeys as string[]).toSorted(compareCodeUnits);
  const canonical = expected.toSorted();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    fail(`${label} has an unsupported shape`);
  }

  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) {
      fail(`${label}.${key} must be a data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function arrayValues(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(`${label} could not be inspected safely`);
  }
  if (prototype !== Array.prototype) fail(`${label} must be a plain array`);
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : -1;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    fail(`${label} is invalid`);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string")) {
    fail(`${label} has an unsupported shape`);
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) {
      fail(`${label}[${index}] must be a data property`);
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function boundedIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

export function decodeCoworkSharedProjectId(value: unknown): string {
  return boundedIdentifier(value, "shared project id");
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${label} is invalid`);
  }
  return value as number;
}

function hasForbiddenPathCodeUnit(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalRelativePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_CHARS ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    hasForbiddenPathCodeUnit(value) ||
    new TextEncoder().encode(value).byteLength > MAX_PATH_UTF8_BYTES
  ) {
    fail("relativePath is invalid");
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment.length > MAX_PATH_SEGMENT_CHARS ||
        new TextEncoder().encode(segment).byteLength > MAX_PATH_SEGMENT_UTF8_BYTES ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        WINDOWS_RESERVED_FILE_STEM.test(segment.split(".", 1)[0] ?? ""),
    )
  ) {
    fail("relativePath is invalid");
  }
  return value;
}

function portablePathKey(value: string): string {
  return value.normalize("NFKC").toUpperCase().toLowerCase().normalize("NFC");
}

function revision(value: unknown, label: string): CoworkReplicaRevisionView {
  const candidate = record(value, ["revisionId", "contentSha256", "auditRef"], label);
  const contentSha256 = candidate.contentSha256;
  if (
    contentSha256 !== null &&
    (typeof contentSha256 !== "string" || !SHA256_PATTERN.test(contentSha256))
  ) {
    fail(`${label}.contentSha256 is invalid`);
  }
  return Object.freeze({
    revisionId: sha256(candidate.revisionId, `${label}.revisionId`),
    contentSha256,
    auditRef: sha256(candidate.auditRef, `${label}.auditRef`),
  });
}

function uniqueRevisions(value: unknown, label: string): readonly CoworkReplicaRevisionView[] {
  const values = arrayValues(value, COWORK_REPLICA_STATUS_PAGE_LIMIT, label);
  const seen = new Set<string>();
  return Object.freeze(
    values.map((item, index) => {
      const decoded = revision(item, `${label}[${index}]`);
      if (seen.has(decoded.revisionId)) fail(`${label} contains a duplicate revision`);
      seen.add(decoded.revisionId);
      return decoded;
    }),
  );
}

function decodeEntry(value: unknown, projectRevision: number): CoworkReplicaStatusEntry {
  const candidate = record(
    value,
    [
      "relativePath",
      "manifestRevision",
      "head",
      "forks",
      "recoverableTombstones",
      "conflictRefs",
      "materialization",
      "operatorAttention",
    ],
    "entry",
  );
  const manifestRevision = nonNegativeSafeInteger(candidate.manifestRevision, "manifestRevision");
  if (manifestRevision > projectRevision) fail("entry revision exceeds project revision");

  let head: CoworkReplicaStatusEntry["head"] = null;
  if (candidate.head !== null) {
    const rawHead = record(
      candidate.head,
      ["kind", "revisionId", "contentSha256", "auditRef"],
      "head",
    );
    if (rawHead.kind !== "version" && rawHead.kind !== "tombstone") fail("head kind is invalid");
    const decoded = revision(
      {
        revisionId: rawHead.revisionId,
        contentSha256: rawHead.contentSha256,
        auditRef: rawHead.auditRef,
      },
      "head",
    );
    if (rawHead.kind === "tombstone" && decoded.contentSha256 !== null) {
      fail("tombstone head must not expose a content hash");
    }
    if (rawHead.kind === "version" && decoded.contentSha256 === null) {
      fail("version head must expose a content hash");
    }
    head = Object.freeze({ ...decoded, kind: rawHead.kind });
  }

  const forks = uniqueRevisions(candidate.forks, "forks");
  if (forks.some((fork) => fork.contentSha256 === null)) fail("forks require content hashes");
  const recoverableTombstones = uniqueRevisions(
    candidate.recoverableTombstones,
    "recoverableTombstones",
  );
  if (recoverableTombstones.some((tombstone) => tombstone.contentSha256 !== null)) {
    fail("recoverable tombstones must not expose content hashes");
  }
  const allRevisionIds = [
    ...(head ? [head.revisionId] : []),
    ...forks.map((item) => item.revisionId),
    ...recoverableTombstones.map((item) => item.revisionId),
  ];
  if (new Set(allRevisionIds).size !== allRevisionIds.length) {
    fail("entry contains a duplicate revision identity");
  }

  const rawConflictRefs = arrayValues(
    candidate.conflictRefs,
    COWORK_REPLICA_STATUS_PAGE_LIMIT,
    "conflictRefs",
  );
  const conflictRefs = rawConflictRefs.map((item, index) => sha256(item, `conflictRefs[${index}]`));
  if (new Set(conflictRefs).size !== conflictRefs.length) fail("conflictRefs contains duplicates");

  const materialization = candidate.materialization;
  if (
    materialization !== "current" &&
    materialization !== "not-materialized" &&
    materialization !== "pending" &&
    materialization !== "recovery-preserved" &&
    materialization !== "failed"
  ) {
    fail("materialization is invalid");
  }
  const rawOperatorAttention = arrayValues(candidate.operatorAttention, 8, "operatorAttention");
  const operatorAttention = rawOperatorAttention.map((item) => {
    if (
      item !== "conflict-needs-resolution" &&
      item !== "database-fork-needs-selection" &&
      item !== "head-tombstoned" &&
      item !== "materialization-failed" &&
      item !== "recovery-copy-preserved"
    ) {
      fail("operatorAttention contains an invalid reason");
    }
    return item;
  });
  if (new Set(operatorAttention).size !== operatorAttention.length) {
    fail("operatorAttention contains duplicates");
  }
  const hasConflictAttention = operatorAttention.some(
    (reason) =>
      reason === "conflict-needs-resolution" || reason === "database-fork-needs-selection",
  );
  if ((conflictRefs.length > 0 || forks.length > 0) && !hasConflictAttention) {
    fail("conflicts and forks require matching operator attention");
  }
  if (forks.length > 0 && conflictRefs.length === 0) {
    fail("forks require conflict audit references");
  }
  if (materialization === "failed" && !operatorAttention.includes("materialization-failed")) {
    fail("failed materialization requires matching operator attention");
  }
  if (
    materialization === "recovery-preserved" &&
    !operatorAttention.includes("recovery-copy-preserved")
  ) {
    fail("preserved recovery requires matching operator attention");
  }
  if (operatorAttention.includes("conflict-needs-resolution") && conflictRefs.length === 0) {
    fail("conflict attention requires conflict evidence");
  }
  if (
    operatorAttention.includes("database-fork-needs-selection") &&
    (forks.length === 0 || conflictRefs.length === 0)
  ) {
    fail("database fork attention requires fork and conflict evidence");
  }
  if (
    operatorAttention.includes("head-tombstoned") &&
    (head === null || head.kind !== "tombstone")
  ) {
    fail("tombstone attention requires a tombstone head");
  }
  if (operatorAttention.includes("materialization-failed") && materialization !== "failed") {
    fail("materialization attention requires a failed materialization");
  }
  if (
    operatorAttention.includes("recovery-copy-preserved") &&
    materialization !== "recovery-preserved"
  ) {
    fail("recovery attention requires a preserved recovery copy");
  }

  return Object.freeze({
    relativePath: canonicalRelativePath(candidate.relativePath),
    manifestRevision,
    head,
    forks,
    recoverableTombstones,
    conflictRefs: Object.freeze(conflictRefs),
    materialization,
    operatorAttention: Object.freeze(operatorAttention),
  });
}

function assertUniqueEvidence(entries: readonly CoworkReplicaStatusEntry[], label: string): void {
  const revisionIds = new Set<string>();
  const conflictRefs = new Set<string>();
  for (const entry of entries) {
    const revisions = [
      ...(entry.head ? [entry.head] : []),
      ...entry.forks,
      ...entry.recoverableTombstones,
    ];
    for (const item of revisions) {
      if (revisionIds.has(item.revisionId)) {
        fail(`${label} contains a duplicate revision identity`);
      }
      revisionIds.add(item.revisionId);
    }
    for (const conflictRef of entry.conflictRefs) {
      if (conflictRefs.has(conflictRef)) fail(`${label} contains a duplicate conflict reference`);
      conflictRefs.add(conflictRef);
    }
  }
}

function cursor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !CURSOR_PATTERN.test(value)) fail("nextCursor is invalid");
  return value;
}

export function decodeCoworkReplicaStatusPage(
  value: unknown,
  expectedProjectId: string,
): CoworkReplicaStatusPage {
  boundedIdentifier(expectedProjectId, "expected project id");
  const candidate = record(
    value,
    ["sharedProjectId", "projectRevision", "entries", "nextCursor"],
    "status page",
  );
  const sharedProjectId = boundedIdentifier(candidate.sharedProjectId, "sharedProjectId");
  if (sharedProjectId !== expectedProjectId) fail("status page belongs to another project");
  const projectRevision = nonNegativeSafeInteger(candidate.projectRevision, "projectRevision");
  const rawEntries = arrayValues(
    candidate.entries,
    COWORK_REPLICA_STATUS_PAGE_LIMIT,
    "entries page",
  );
  const nextCursor = cursor(candidate.nextCursor);
  if (rawEntries.length === 0 && nextCursor !== null) {
    fail("empty status page cannot continue pagination");
  }
  const entries = rawEntries.map((entry) => decodeEntry(entry, projectRevision));
  const paths = entries.map((entry) => entry.relativePath);
  if (new Set(paths).size !== paths.length) fail("status page contains duplicate paths");
  const portablePaths = paths.map(portablePathKey);
  if (new Set(portablePaths).size !== portablePaths.length) {
    fail("status page contains portable path aliases");
  }
  const sorted = paths.toSorted(compareCodeUnits);
  if (paths.some((path, index) => path !== sorted[index]))
    fail("status page is not canonically ordered");
  assertUniqueEvidence(entries, "status page");

  return Object.freeze({
    sharedProjectId,
    projectRevision,
    entries: Object.freeze(entries),
    nextCursor,
  });
}

export function beginCoworkReplicaStatusView(
  page: CoworkReplicaStatusPage,
): CoworkReplicaStatusView {
  return Object.freeze({
    ...page,
    entries: Object.freeze([...page.entries]),
    consumedCursors: Object.freeze([]),
  });
}

export function appendCoworkReplicaStatusPage(
  current: CoworkReplicaStatusView,
  page: CoworkReplicaStatusPage,
  requestedCursor: string,
): CoworkReplicaStatusView {
  if (current.sharedProjectId !== page.sharedProjectId) fail("project changed during pagination");
  if (current.projectRevision !== page.projectRevision)
    fail("project revision changed during pagination");
  if (current.nextCursor !== requestedCursor) fail("response cursor does not match the request");
  if (current.consumedCursors.includes(requestedCursor)) fail("cursor was already consumed");
  if (
    page.nextCursor !== null &&
    (page.nextCursor === requestedCursor || current.consumedCursors.includes(page.nextCursor))
  ) {
    fail("pagination cursor did not advance");
  }
  if (
    current.consumedCursors.length + 1 >= COWORK_REPLICA_STATUS_MAX_PAGES &&
    page.nextCursor !== null
  ) {
    fail("status view exceeds its page bound");
  }
  const existingPaths = new Set(current.entries.map((entry) => entry.relativePath));
  if (page.entries.some((entry) => existingPaths.has(entry.relativePath))) {
    fail("pagination repeated or mutated a path");
  }
  const existingPortablePaths = new Set(
    current.entries.map((entry) => portablePathKey(entry.relativePath)),
  );
  if (
    page.entries.some((entry) => existingPortablePaths.has(portablePathKey(entry.relativePath)))
  ) {
    fail("pagination repeated a portable path alias");
  }
  const entries = [...current.entries, ...page.entries];
  if (entries.length > COWORK_REPLICA_STATUS_MAX_ENTRIES)
    fail("status view exceeds its entry bound");
  const sorted = entries.toSorted((left, right) =>
    compareCodeUnits(left.relativePath, right.relativePath),
  );
  if (entries.some((entry, index) => entry.relativePath !== sorted[index]?.relativePath)) {
    fail("paginated status is not canonically ordered");
  }
  assertUniqueEvidence(entries, "paginated status");
  return Object.freeze({
    sharedProjectId: current.sharedProjectId,
    projectRevision: current.projectRevision,
    entries: Object.freeze(entries),
    nextCursor: page.nextCursor,
    consumedCursors: Object.freeze([...current.consumedCursors, requestedCursor]),
  });
}
