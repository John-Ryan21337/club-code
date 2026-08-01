export const COWORK_REPLICA_APPLY_PREVIEW_PAGE_LIMIT = 50;
export const COWORK_REPLICA_APPLY_PREVIEW_MAX_ENTRIES = 200;
export const COWORK_REPLICA_APPLY_PREVIEW_MAX_PAGES = 4;
export const COWORK_REPLICA_APPLY_PREVIEW_MAX_BYTES = 1_099_511_627_776;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/;
const MAX_PATH_CHARS = 4_096;
const MAX_PATH_UTF8_BYTES = 4_096;
const MAX_PATH_SEGMENT_CHARS = 255;
const MAX_PATH_SEGMENT_UTF8_BYTES = 255;
const WINDOWS_RESERVED_FILE_STEM =
  /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/iu;

export type CoworkReplicaApplyAction =
  | "publish-version"
  | "apply-version"
  | "apply-tombstone"
  | "database-snapshot"
  | "skip-volatile-sidecar"
  | "preserve-conflict"
  | "no-overwrite";

export type CoworkReplicaApplyOutcome =
  | "publish-if-head-matches"
  | "materialize-if-base-matches"
  | "delete-if-base-matches"
  | "immutable-snapshot-only"
  | "skipped-volatile-sidecar"
  | "preserve-local-and-record-conflict"
  | "preserve-local-no-overwrite";

export interface CoworkReplicaApplyPreviewEntry {
  readonly relativePath: string;
  readonly action: CoworkReplicaApplyAction;
  readonly outcome: CoworkReplicaApplyOutcome;
  readonly expectedBaseSha256: string | null;
  readonly contentSha256: string | null;
  readonly byteCount: number;
  readonly databaseSnapshotSha256: string | null;
  readonly conflictRef: string | null;
}

export interface CoworkReplicaApplyPreviewSummary {
  readonly publishVersionCount: number;
  readonly applyVersionCount: number;
  readonly tombstoneCount: number;
  readonly databaseSnapshotCount: number;
  readonly skippedSidecarCount: number;
  readonly conflictCount: number;
  readonly noOverwriteCount: number;
  readonly totalEntryCount: number;
  readonly totalBytes: number;
}

export interface CoworkReplicaApplyPlanBinding {
  readonly sharedProjectId: string;
  readonly deviceId: string;
  readonly membershipEpoch: number;
  readonly manifestRevision: number;
  readonly manifestHeadSha256: string;
  readonly baseManifestSha256: string;
  readonly fence: number;
  readonly planToken: string;
  readonly planSha256: string;
}

export interface CoworkReplicaApplyPreviewPage extends CoworkReplicaApplyPlanBinding {
  readonly summary: CoworkReplicaApplyPreviewSummary;
  readonly entries: readonly CoworkReplicaApplyPreviewEntry[];
  readonly nextCursor: string | null;
}

export interface CoworkReplicaApplyPreviewView extends CoworkReplicaApplyPreviewPage {
  readonly consumedCursors: readonly string[];
}

export interface CoworkReplicaApplyApprovalCommand extends CoworkReplicaApplyPlanBinding {
  readonly type: "collaboration.replica.apply-plan.approve";
  readonly commandId: string;
}

export interface CoworkReplicaApplyApprovalReceipt extends CoworkReplicaApplyPlanBinding {
  readonly status: "accepted" | "replayed";
  readonly commandId: string;
}

export type CoworkReplicaApplyApprovalResponse =
  | CoworkReplicaApplyApprovalReceipt
  | { readonly status: "authority-changed" | "rejected" };

export class CoworkReplicaApplyPreviewPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoworkReplicaApplyPreviewPayloadError";
  }
}

function fail(message: string): never {
  throw new CoworkReplicaApplyPreviewPayloadError(message);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object`);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) fail(`${label} has an unsupported shape`);
  const actual = (keys as string[]).toSorted(compareCodeUnits);
  const canonical = expected.toSorted(compareCodeUnits);
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    fail(`${label} has an unsupported shape`);
  }
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) fail(`${label}.${key} must be a data property`);
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function arrayValues(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
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
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) fail(`${label} is invalid`);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string")) {
    fail(`${label} has an unsupported shape`);
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) fail(`${label}[${index}] must be a data property`);
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) fail(`${label} is invalid`);
  return value;
}

export function decodeCoworkReplicaApplyProjectId(value: unknown): string {
  return identifier(value, "shared project id");
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail(`${label} is invalid`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(`${label} is invalid`);
  }
  return value as number;
}

function nullableHash(value: unknown, label: string): string | null {
  return value === null ? null : hash(value, label);
}

function hasForbiddenPathCodeUnit(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

function relativePath(value: unknown): string {
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

function isVolatileDatabaseSidecar(path: string): boolean {
  const folded = path.toLowerCase();
  return (
    folded.endsWith("-wal") ||
    folded.endsWith("-shm") ||
    folded.endsWith("-journal") ||
    folded.endsWith(".db-wal") ||
    folded.endsWith(".db-shm") ||
    folded.endsWith(".db-journal")
  );
}

const actionOutcome: Record<CoworkReplicaApplyAction, CoworkReplicaApplyOutcome> = {
  "publish-version": "publish-if-head-matches",
  "apply-version": "materialize-if-base-matches",
  "apply-tombstone": "delete-if-base-matches",
  "database-snapshot": "immutable-snapshot-only",
  "skip-volatile-sidecar": "skipped-volatile-sidecar",
  "preserve-conflict": "preserve-local-and-record-conflict",
  "no-overwrite": "preserve-local-no-overwrite",
};

const actions = Object.keys(actionOutcome) as CoworkReplicaApplyAction[];

function decodeEntry(value: unknown): CoworkReplicaApplyPreviewEntry {
  const candidate = record(
    value,
    [
      "relativePath",
      "action",
      "outcome",
      "expectedBaseSha256",
      "contentSha256",
      "byteCount",
      "databaseSnapshotSha256",
      "conflictRef",
    ],
    "preview entry",
  );
  if (typeof candidate.action !== "string" || !actions.includes(candidate.action as never)) {
    fail("preview entry action is invalid");
  }
  const action = candidate.action as CoworkReplicaApplyAction;
  if (candidate.outcome !== actionOutcome[action])
    fail("preview entry outcome does not match action");
  const path = relativePath(candidate.relativePath);
  if (action !== "skip-volatile-sidecar" && isVolatileDatabaseSidecar(path)) {
    fail("volatile database sidecars can only be skipped");
  }
  const expectedBaseSha256 = nullableHash(candidate.expectedBaseSha256, "expectedBaseSha256");
  const contentSha256 = nullableHash(candidate.contentSha256, "contentSha256");
  const databaseSnapshotSha256 = nullableHash(
    candidate.databaseSnapshotSha256,
    "databaseSnapshotSha256",
  );
  const conflictRef = nullableHash(candidate.conflictRef, "conflictRef");
  const byteCount = integer(
    candidate.byteCount,
    "byteCount",
    0,
    COWORK_REPLICA_APPLY_PREVIEW_MAX_BYTES,
  );

  if (action === "apply-tombstone") {
    if (expectedBaseSha256 === null || contentSha256 !== null || byteCount !== 0) {
      fail("tombstone entry evidence is inconsistent");
    }
  } else if (action === "skip-volatile-sidecar") {
    if (
      !isVolatileDatabaseSidecar(path) ||
      expectedBaseSha256 !== null ||
      contentSha256 !== null ||
      databaseSnapshotSha256 !== null ||
      conflictRef !== null ||
      byteCount !== 0
    ) {
      fail("volatile sidecar entry evidence is inconsistent");
    }
  } else if (contentSha256 === null || byteCount === 0) {
    fail("content action requires bounded content evidence");
  }

  if (action === "database-snapshot") {
    if (databaseSnapshotSha256 === null || databaseSnapshotSha256 !== contentSha256) {
      fail("database snapshot requires matching immutable snapshot evidence");
    }
  } else if (databaseSnapshotSha256 !== null) {
    fail("non-database entry cannot expose database snapshot evidence");
  }
  if (action === "preserve-conflict") {
    if (conflictRef === null || expectedBaseSha256 === null) {
      fail("conflict entry requires base and audit evidence");
    }
  } else if (conflictRef !== null) {
    fail("non-conflict entry cannot expose conflict evidence");
  }
  if ((action === "apply-version" || action === "no-overwrite") && expectedBaseSha256 === null) {
    fail("materialization entry requires an expected base hash");
  }

  return Object.freeze({
    relativePath: path,
    action,
    outcome: actionOutcome[action],
    expectedBaseSha256,
    contentSha256,
    byteCount,
    databaseSnapshotSha256,
    conflictRef,
  });
}

function decodeSummary(value: unknown): CoworkReplicaApplyPreviewSummary {
  const fields = [
    "publishVersionCount",
    "applyVersionCount",
    "tombstoneCount",
    "databaseSnapshotCount",
    "skippedSidecarCount",
    "conflictCount",
    "noOverwriteCount",
    "totalEntryCount",
    "totalBytes",
  ] as const;
  const candidate = record(value, fields, "preview summary");
  const decoded = Object.fromEntries(
    fields.map((field) => [
      field,
      integer(
        candidate[field],
        `summary.${field}`,
        0,
        field === "totalBytes"
          ? COWORK_REPLICA_APPLY_PREVIEW_MAX_BYTES
          : COWORK_REPLICA_APPLY_PREVIEW_MAX_ENTRIES,
      ),
    ]),
  ) as unknown as CoworkReplicaApplyPreviewSummary;
  const categorized =
    decoded.publishVersionCount +
    decoded.applyVersionCount +
    decoded.tombstoneCount +
    decoded.databaseSnapshotCount +
    decoded.skippedSidecarCount +
    decoded.conflictCount +
    decoded.noOverwriteCount;
  if (categorized !== decoded.totalEntryCount) fail("preview summary counts do not balance");
  return Object.freeze(decoded);
}

function decodeBinding(
  candidate: Readonly<Record<string, unknown>>,
  expectedProjectId: string,
): CoworkReplicaApplyPlanBinding {
  const sharedProjectId = identifier(candidate.sharedProjectId, "sharedProjectId");
  if (sharedProjectId !== expectedProjectId) fail("preview belongs to another project");
  return Object.freeze({
    sharedProjectId,
    deviceId: identifier(candidate.deviceId, "deviceId"),
    membershipEpoch: integer(candidate.membershipEpoch, "membershipEpoch", 1),
    manifestRevision: integer(candidate.manifestRevision, "manifestRevision"),
    manifestHeadSha256: hash(candidate.manifestHeadSha256, "manifestHeadSha256"),
    baseManifestSha256: hash(candidate.baseManifestSha256, "baseManifestSha256"),
    fence: integer(candidate.fence, "fence", 1),
    planToken: hash(candidate.planToken, "planToken"),
    planSha256: hash(candidate.planSha256, "planSha256"),
  });
}

const bindingFields = [
  "sharedProjectId",
  "deviceId",
  "membershipEpoch",
  "manifestRevision",
  "manifestHeadSha256",
  "baseManifestSha256",
  "fence",
  "planToken",
  "planSha256",
] as const;

export function decodeCoworkReplicaApplyPreviewPage(
  value: unknown,
  expectedProjectId: string,
): CoworkReplicaApplyPreviewPage {
  identifier(expectedProjectId, "expected project id");
  const candidate = record(
    value,
    [...bindingFields, "summary", "entries", "nextCursor"],
    "apply preview page",
  );
  const binding = decodeBinding(candidate, expectedProjectId);
  const summary = decodeSummary(candidate.summary);
  const rawEntries = arrayValues(
    candidate.entries,
    COWORK_REPLICA_APPLY_PREVIEW_PAGE_LIMIT,
    "preview entries",
  );
  const entries = rawEntries.map(decodeEntry);
  const paths = entries.map((entry) => entry.relativePath);
  if (new Set(paths).size !== paths.length) fail("preview page contains duplicate paths");
  if (new Set(paths.map(portablePathKey)).size !== paths.length) {
    fail("preview page contains portable path aliases");
  }
  const sorted = paths.toSorted(compareCodeUnits);
  if (paths.some((path, index) => path !== sorted[index])) fail("preview page is not ordered");
  let nextCursor: string | null = null;
  if (candidate.nextCursor !== null) {
    if (typeof candidate.nextCursor !== "string" || !CURSOR_PATTERN.test(candidate.nextCursor)) {
      fail("nextCursor is invalid");
    }
    nextCursor = candidate.nextCursor;
  }
  if (entries.length === 0 && nextCursor !== null) fail("empty preview page cannot continue");
  if (entries.length > summary.totalEntryCount) fail("preview page exceeds its summary");
  return Object.freeze({ ...binding, summary, entries: Object.freeze(entries), nextCursor });
}

function sameBinding(left: CoworkReplicaApplyPlanBinding, right: CoworkReplicaApplyPlanBinding) {
  return bindingFields.every((field) => left[field] === right[field]);
}

function countEntries(entries: readonly CoworkReplicaApplyPreviewEntry[]) {
  const count = (action: CoworkReplicaApplyAction) =>
    entries.filter((entry) => entry.action === action).length;
  return {
    publishVersionCount: count("publish-version"),
    applyVersionCount: count("apply-version"),
    tombstoneCount: count("apply-tombstone"),
    databaseSnapshotCount: count("database-snapshot"),
    skippedSidecarCount: count("skip-volatile-sidecar"),
    conflictCount: count("preserve-conflict"),
    noOverwriteCount: count("no-overwrite"),
    totalEntryCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.byteCount, 0),
  };
}

function assertCompleteSummary(view: CoworkReplicaApplyPreviewView): void {
  const actual = countEntries(view.entries);
  for (const field of Object.keys(actual) as (keyof CoworkReplicaApplyPreviewSummary)[]) {
    if (actual[field] > view.summary[field]) fail(`preview exceeds summary ${field}`);
  }
  const conflictRefs = view.entries.flatMap((entry) =>
    entry.conflictRef === null ? [] : [entry.conflictRef],
  );
  if (new Set(conflictRefs).size !== conflictRefs.length) {
    fail("preview contains duplicate conflict evidence");
  }
  if (view.nextCursor !== null) return;
  for (const field of Object.keys(actual) as (keyof CoworkReplicaApplyPreviewSummary)[]) {
    if (actual[field] !== view.summary[field]) fail(`complete preview summary ${field} is stale`);
  }
}

export function beginCoworkReplicaApplyPreviewView(
  page: CoworkReplicaApplyPreviewPage,
): CoworkReplicaApplyPreviewView {
  const view = Object.freeze({
    ...page,
    entries: Object.freeze([...page.entries]),
    consumedCursors: Object.freeze([]),
  });
  assertCompleteSummary(view);
  return view;
}

export function appendCoworkReplicaApplyPreviewPage(
  current: CoworkReplicaApplyPreviewView,
  page: CoworkReplicaApplyPreviewPage,
  requestedCursor: string,
): CoworkReplicaApplyPreviewView {
  if (!sameBinding(current, page)) fail("plan authority changed during pagination");
  if (JSON.stringify(current.summary) !== JSON.stringify(page.summary)) {
    fail("plan summary changed during pagination");
  }
  if (current.nextCursor !== requestedCursor) fail("response cursor does not match request");
  if (current.consumedCursors.includes(requestedCursor)) fail("cursor was already consumed");
  if (
    page.nextCursor === requestedCursor ||
    current.consumedCursors.includes(page.nextCursor ?? "")
  ) {
    fail("pagination cursor did not advance");
  }
  if (
    current.consumedCursors.length + 1 >= COWORK_REPLICA_APPLY_PREVIEW_MAX_PAGES &&
    page.nextCursor !== null
  ) {
    fail("preview exceeds its page bound");
  }
  const entries = [...current.entries, ...page.entries];
  if (entries.length > COWORK_REPLICA_APPLY_PREVIEW_MAX_ENTRIES)
    fail("preview exceeds entry bound");
  const paths = entries.map((entry) => entry.relativePath);
  if (
    new Set(paths).size !== paths.length ||
    new Set(paths.map(portablePathKey)).size !== paths.length
  ) {
    fail("preview pagination repeated a path");
  }
  const sorted = paths.toSorted(compareCodeUnits);
  if (paths.some((path, index) => path !== sorted[index]))
    fail("preview pagination is not ordered");
  const view = Object.freeze({
    ...page,
    entries: Object.freeze(entries),
    consumedCursors: Object.freeze([...current.consumedCursors, requestedCursor]),
  });
  assertCompleteSummary(view);
  return view;
}

export function makeCoworkReplicaApplyApprovalCommand(
  view: CoworkReplicaApplyPreviewView,
  commandIdValue: unknown,
): CoworkReplicaApplyApprovalCommand {
  if (view.nextCursor !== null || view.entries.length !== view.summary.totalEntryCount) {
    fail("the complete immutable plan must be loaded before approval");
  }
  assertCompleteSummary(view);
  return Object.freeze({
    type: "collaboration.replica.apply-plan.approve",
    commandId: identifier(commandIdValue, "commandId"),
    ...Object.fromEntries(bindingFields.map((field) => [field, view[field]])),
  }) as unknown as CoworkReplicaApplyApprovalCommand;
}

export function decodeCoworkReplicaApplyApprovalResponse(
  value: unknown,
  command: CoworkReplicaApplyApprovalCommand,
): CoworkReplicaApplyApprovalResponse {
  if (typeof value !== "object" || value === null) fail("approval response is invalid");
  let statusDescriptor: PropertyDescriptor | undefined;
  try {
    statusDescriptor = Object.getOwnPropertyDescriptor(value, "status");
  } catch {
    fail("approval response could not be inspected safely");
  }
  const status = statusDescriptor && "value" in statusDescriptor ? statusDescriptor.value : null;
  if (status === "authority-changed" || status === "rejected") {
    const terminal = record(value, ["status"], "approval response");
    return Object.freeze({ status: terminal.status as "authority-changed" | "rejected" });
  }
  if (status !== "accepted" && status !== "replayed") fail("approval response status is invalid");
  const candidate = record(value, ["status", "commandId", ...bindingFields], "approval receipt");
  const receipt = Object.freeze({
    status,
    commandId: identifier(candidate.commandId, "receipt commandId"),
    ...decodeBinding(candidate, command.sharedProjectId),
  }) as CoworkReplicaApplyApprovalReceipt;
  if (receipt.commandId !== command.commandId || !sameBinding(receipt, command)) {
    fail("approval receipt does not match the immutable command");
  }
  return receipt;
}
