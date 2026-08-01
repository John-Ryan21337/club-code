export const COWORK_REPLICA_STATUS_PAGE_LIMIT = 50;
export const COWORK_REPLICA_STATUS_MAX_ENTRIES = 200;
export const COWORK_REPLICA_STATUS_MAX_PAGES = 4;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/;
const MAX_PATH_CHARS = 4_096;
const MAX_PATH_SEGMENT_CHARS = 255;

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

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).toSorted();
  const canonical = expected.toSorted();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    fail(`${label} has an unsupported shape`);
  }
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

function hasControlCodeUnit(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
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
    hasControlCodeUnit(value)
  ) {
    fail("relativePath is invalid");
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment.length > MAX_PATH_SEGMENT_CHARS ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" "),
    )
  ) {
    fail("relativePath is invalid");
  }
  return value;
}

function revision(value: unknown, label: string): CoworkReplicaRevisionView {
  const candidate = record(value, label);
  exactKeys(candidate, ["revisionId", "contentSha256", "auditRef"], label);
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
  if (!Array.isArray(value) || value.length > COWORK_REPLICA_STATUS_PAGE_LIMIT) {
    fail(`${label} is invalid`);
  }
  const seen = new Set<string>();
  return Object.freeze(
    value.map((item, index) => {
      const decoded = revision(item, `${label}[${index}]`);
      if (seen.has(decoded.revisionId)) fail(`${label} contains a duplicate revision`);
      seen.add(decoded.revisionId);
      return decoded;
    }),
  );
}

function decodeEntry(value: unknown, projectRevision: number): CoworkReplicaStatusEntry {
  const candidate = record(value, "entry");
  exactKeys(
    candidate,
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
    const rawHead = record(candidate.head, "head");
    exactKeys(rawHead, ["kind", "revisionId", "contentSha256", "auditRef"], "head");
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

  if (
    !Array.isArray(candidate.conflictRefs) ||
    candidate.conflictRefs.length > COWORK_REPLICA_STATUS_PAGE_LIMIT
  ) {
    fail("conflictRefs is invalid");
  }
  const conflictRefs = candidate.conflictRefs.map((item, index) =>
    sha256(item, `conflictRefs[${index}]`),
  );
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
  if (!Array.isArray(candidate.operatorAttention) || candidate.operatorAttention.length > 8) {
    fail("operatorAttention is invalid");
  }
  const operatorAttention = candidate.operatorAttention.map((item) => {
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
  if ((conflictRefs.length > 0 || materialization === "failed") && operatorAttention.length === 0) {
    fail("conflicts and failures require explicit operator attention");
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
  const candidate = record(value, "status page");
  exactKeys(
    candidate,
    ["sharedProjectId", "projectRevision", "entries", "nextCursor"],
    "status page",
  );
  const sharedProjectId = boundedIdentifier(candidate.sharedProjectId, "sharedProjectId");
  if (sharedProjectId !== expectedProjectId) fail("status page belongs to another project");
  const projectRevision = nonNegativeSafeInteger(candidate.projectRevision, "projectRevision");
  if (
    !Array.isArray(candidate.entries) ||
    candidate.entries.length > COWORK_REPLICA_STATUS_PAGE_LIMIT
  ) {
    fail("entries page is invalid");
  }
  const nextCursor = cursor(candidate.nextCursor);
  if (candidate.entries.length === 0 && nextCursor !== null) {
    fail("empty status page cannot continue pagination");
  }
  const entries = candidate.entries.map((entry) => decodeEntry(entry, projectRevision));
  const paths = entries.map((entry) => entry.relativePath);
  if (new Set(paths).size !== paths.length) fail("status page contains duplicate paths");
  const sorted = paths.toSorted((left, right) => left.localeCompare(right));
  if (paths.some((path, index) => path !== sorted[index]))
    fail("status page is not canonically ordered");

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
  const entries = [...current.entries, ...page.entries];
  if (entries.length > COWORK_REPLICA_STATUS_MAX_ENTRIES)
    fail("status view exceeds its entry bound");
  const sorted = entries.toSorted((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  if (entries.some((entry, index) => entry.relativePath !== sorted[index]?.relativePath)) {
    fail("paginated status is not canonically ordered");
  }
  return Object.freeze({
    sharedProjectId: current.sharedProjectId,
    projectRevision: current.projectRevision,
    entries: Object.freeze(entries),
    nextCursor: page.nextCursor,
    consumedCursors: Object.freeze([...current.consumedCursors, requestedCursor]),
  });
}
