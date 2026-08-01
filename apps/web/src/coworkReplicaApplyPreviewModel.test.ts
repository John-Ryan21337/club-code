import { describe, expect, it } from "vitest";

import {
  appendCoworkReplicaApplyPreviewPage,
  beginCoworkReplicaApplyPreviewView,
  CoworkReplicaApplyPreviewPayloadError,
  decodeCoworkReplicaApplyApprovalResponse,
  decodeCoworkReplicaApplyPreviewPage,
  makeCoworkReplicaApplyApprovalCommand,
} from "./coworkReplicaApplyPreviewModel";

const hashes = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(64, "0"));

function applyEntry(relativePath = "src/shared.ts") {
  return {
    relativePath,
    action: "apply-version",
    outcome: "materialize-if-base-matches",
    expectedBaseSha256: hashes[10],
    contentSha256: hashes[11],
    byteCount: 128,
    databaseSnapshotSha256: null,
    conflictRef: null,
  };
}

function summary(overrides: Record<string, number> = {}) {
  return {
    publishVersionCount: 0,
    applyVersionCount: 1,
    tombstoneCount: 0,
    databaseSnapshotCount: 0,
    skippedSidecarCount: 0,
    conflictCount: 0,
    noOverwriteCount: 0,
    totalEntryCount: 1,
    totalBytes: 128,
    ...overrides,
  };
}

function plan(entries: unknown[] = [applyEntry()], nextCursor: string | null = null) {
  return {
    sharedProjectId: "project-one",
    deviceId: "device-one",
    membershipEpoch: 7,
    manifestRevision: 19,
    manifestHeadSha256: hashes[0],
    baseManifestSha256: hashes[1],
    fence: 23,
    planToken: hashes[2],
    planSha256: hashes[3],
    summary: summary(),
    entries,
    nextCursor,
  };
}

describe("cowork replica apply preview model", () => {
  it("decodes a deeply immutable, authority-bound complete plan", () => {
    const decoded = beginCoworkReplicaApplyPreviewView(
      decodeCoworkReplicaApplyPreviewPage(plan(), "project-one"),
    );
    expect(decoded).toMatchObject({
      sharedProjectId: "project-one",
      deviceId: "device-one",
      membershipEpoch: 7,
      manifestRevision: 19,
      fence: 23,
      planToken: hashes[2],
      planSha256: hashes[3],
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.entries)).toBe(true);
    expect(Object.isFrozen(decoded.entries[0])).toBe(true);
    expect(Object.isFrozen(decoded.summary)).toBe(true);
  });

  it("accepts explicit conflict, tombstone, database snapshot, skipped sidecar, and no-overwrite outcomes", () => {
    const entries = [
      {
        ...applyEntry("data/account.db"),
        action: "database-snapshot",
        outcome: "immutable-snapshot-only",
        expectedBaseSha256: null,
        databaseSnapshotSha256: hashes[11],
      },
      {
        ...applyEntry("data/account.db-shm"),
        action: "skip-volatile-sidecar",
        outcome: "skipped-volatile-sidecar",
        expectedBaseSha256: null,
        contentSha256: null,
        byteCount: 0,
      },
      {
        ...applyEntry("data/account.db-wal"),
        action: "skip-volatile-sidecar",
        outcome: "skipped-volatile-sidecar",
        expectedBaseSha256: null,
        contentSha256: null,
        byteCount: 0,
      },
      {
        ...applyEntry("old.txt"),
        action: "apply-tombstone",
        outcome: "delete-if-base-matches",
        contentSha256: null,
        byteCount: 0,
      },
      {
        ...applyEntry("shared.txt"),
        action: "preserve-conflict",
        outcome: "preserve-local-and-record-conflict",
        conflictRef: hashes[12],
      },
      {
        ...applyEntry("untracked.txt"),
        action: "no-overwrite",
        outcome: "preserve-local-no-overwrite",
      },
    ];
    const payload = {
      ...plan(entries),
      summary: summary({
        applyVersionCount: 0,
        tombstoneCount: 1,
        databaseSnapshotCount: 1,
        skippedSidecarCount: 2,
        conflictCount: 1,
        noOverwriteCount: 1,
        totalEntryCount: 6,
        totalBytes: 128 * 3,
      }),
    };
    const decoded = beginCoworkReplicaApplyPreviewView(
      decodeCoworkReplicaApplyPreviewPage(payload, "project-one"),
    );
    expect(decoded.entries.map((entry) => entry.action)).toEqual([
      "database-snapshot",
      "skip-volatile-sidecar",
      "skip-volatile-sidecar",
      "apply-tombstone",
      "preserve-conflict",
      "no-overwrite",
    ]);
  });

  it.each([
    ["foreign project", { ...plan(), sharedProjectId: "project-two" }],
    ["foreign absolute path", { ...plan(), entries: [applyEntry("C:\\private\\secret.ts")] }],
    ["private transport field", { ...plan(), workspaceRoot: "/private/project" }],
    ["unbounded prose", { ...plan(), entries: [{ ...applyEntry(), reason: "provider output" }] }],
    ["invalid membership epoch", { ...plan(), membershipEpoch: 0 }],
    ["invalid fence", { ...plan(), fence: 0 }],
    ["uppercase hash", { ...plan(), planToken: "A".repeat(64) }],
    ["unbalanced summary", { ...plan(), summary: summary({ totalEntryCount: 2 }) }],
    ["live WAL apply", { ...plan(), entries: [applyEntry("data/account.db-wal")] }],
    [
      "uppercase live journal apply",
      { ...plan(), entries: [applyEntry("data/ACCOUNT.DB-JOURNAL")] },
    ],
    [
      "tombstone content",
      {
        ...plan(),
        entries: [
          { ...applyEntry(), action: "apply-tombstone", outcome: "delete-if-base-matches" },
        ],
      },
    ],
    [
      "database snapshot mismatch",
      {
        ...plan(),
        entries: [
          {
            ...applyEntry("data/account.db"),
            action: "database-snapshot",
            outcome: "immutable-snapshot-only",
            expectedBaseSha256: null,
            databaseSnapshotSha256: hashes[13],
          },
        ],
      },
    ],
    [
      "conflict without audit ref",
      {
        ...plan(),
        entries: [
          {
            ...applyEntry(),
            action: "preserve-conflict",
            outcome: "preserve-local-and-record-conflict",
          },
        ],
      },
    ],
  ])("rejects %s", (_label, payload) => {
    expect(() => decodeCoworkReplicaApplyPreviewPage(payload, "project-one")).toThrow(
      CoworkReplicaApplyPreviewPayloadError,
    );
  });

  it("rejects inherited, accessor, symbolic, sparse, and subclassed transport values", () => {
    const inherited = Object.assign(Object.create({ secret: "value" }), plan());
    expect(() => decodeCoworkReplicaApplyPreviewPage(inherited, "project-one")).toThrow(
      /plain object/,
    );
    const accessor = plan();
    Object.defineProperty(accessor, "planToken", { enumerable: true, get: () => hashes[2] });
    expect(() => decodeCoworkReplicaApplyPreviewPage(accessor, "project-one")).toThrow(
      /data property/,
    );
    const symbolic = plan() as ReturnType<typeof plan> & { [key: symbol]: string };
    symbolic[Symbol("credential")] = "secret";
    expect(() => decodeCoworkReplicaApplyPreviewPage(symbolic, "project-one")).toThrow(
      /unsupported shape/,
    );
    const sparse = Array(1);
    expect(() =>
      decodeCoworkReplicaApplyPreviewPage({ ...plan(), entries: sparse }, "project-one"),
    ).toThrow(/unsupported shape|data property/);
    class PreviewEntries extends Array<unknown> {}
    expect(() =>
      decodeCoworkReplicaApplyPreviewPage(
        { ...plan(), entries: new PreviewEntries() },
        "project-one",
      ),
    ).toThrow(/plain array/);
  });

  it("snapshots mutable pages and entries", () => {
    const rawEntry = applyEntry();
    const rawPlan = plan([rawEntry]);
    const decoded = decodeCoworkReplicaApplyPreviewPage(rawPlan, "project-one");
    rawEntry.relativePath = "src/changed.ts";
    rawPlan.entries.push(applyEntry("src/late.ts"));
    expect(decoded.entries).toHaveLength(1);
    expect(decoded.entries[0]?.relativePath).toBe("src/shared.ts");
  });

  it("enforces immutable binding, exact cursors, global order, and complete summary across pages", () => {
    const firstPayload = {
      ...plan([applyEntry("a.ts")], "next"),
      summary: summary({ applyVersionCount: 2, totalEntryCount: 2, totalBytes: 256 }),
    };
    const secondPayload = {
      ...plan([applyEntry("b.ts")]),
      summary: firstPayload.summary,
    };
    const first = beginCoworkReplicaApplyPreviewView(
      decodeCoworkReplicaApplyPreviewPage(firstPayload, "project-one"),
    );
    const second = decodeCoworkReplicaApplyPreviewPage(secondPayload, "project-one");
    const complete = appendCoworkReplicaApplyPreviewPage(first, second, "next");
    expect(complete.entries).toHaveLength(2);
    expect(() => appendCoworkReplicaApplyPreviewPage(first, second, "wrong")).toThrow(
      /response cursor/,
    );
    expect(() =>
      appendCoworkReplicaApplyPreviewPage(
        first,
        decodeCoworkReplicaApplyPreviewPage({ ...secondPayload, fence: 24 }, "project-one"),
        "next",
      ),
    ).toThrow(/authority changed/);
    expect(() =>
      appendCoworkReplicaApplyPreviewPage(
        first,
        decodeCoworkReplicaApplyPreviewPage(
          { ...secondPayload, entries: [applyEntry("a.ts")] },
          "project-one",
        ),
        "next",
      ),
    ).toThrow(/repeated a path/);
  });

  it("rejects partial pages that already exceed the immutable summary", () => {
    const payload = {
      ...plan([applyEntry("a.ts"), applyEntry("b.ts")], "next"),
      summary: summary(),
    };
    expect(() =>
      beginCoworkReplicaApplyPreviewView(
        decodeCoworkReplicaApplyPreviewPage(payload, "project-one"),
      ),
    ).toThrow(/exceeds (?:its )?summary/);
  });

  it("rejects duplicate conflict audit evidence across the plan", () => {
    const conflict = (relativePath: string) => ({
      ...applyEntry(relativePath),
      action: "preserve-conflict",
      outcome: "preserve-local-and-record-conflict",
      conflictRef: hashes[12],
    });
    const payload = {
      ...plan([conflict("a.ts"), conflict("b.ts")]),
      summary: summary({
        applyVersionCount: 0,
        conflictCount: 2,
        totalEntryCount: 2,
        totalBytes: 256,
      }),
    };
    expect(() =>
      beginCoworkReplicaApplyPreviewView(
        decodeCoworkReplicaApplyPreviewPage(payload, "project-one"),
      ),
    ).toThrow(/duplicate conflict evidence/);
  });

  it("creates one immutable exact command only from a complete plan", () => {
    const incompletePayload = {
      ...plan([applyEntry("a.ts")], "next"),
      summary: summary({ applyVersionCount: 2, totalEntryCount: 2, totalBytes: 256 }),
    };
    const incomplete = beginCoworkReplicaApplyPreviewView(
      decodeCoworkReplicaApplyPreviewPage(incompletePayload, "project-one"),
    );
    expect(() => makeCoworkReplicaApplyApprovalCommand(incomplete, "command-one")).toThrow(
      /complete immutable plan/,
    );

    const complete = beginCoworkReplicaApplyPreviewView(
      decodeCoworkReplicaApplyPreviewPage(plan(), "project-one"),
    );
    const command = makeCoworkReplicaApplyApprovalCommand(complete, "command-one");
    expect(command).toMatchObject({
      type: "collaboration.replica.apply-plan.approve",
      commandId: "command-one",
      planToken: hashes[2],
      fence: 23,
    });
    expect(Object.isFrozen(command)).toBe(true);
  });

  it("accepts only exact immutable receipts and fixed terminal responses", () => {
    const complete = beginCoworkReplicaApplyPreviewView(
      decodeCoworkReplicaApplyPreviewPage(plan(), "project-one"),
    );
    const command = makeCoworkReplicaApplyApprovalCommand(complete, "command-one");
    const receipt = {
      status: "accepted",
      commandId: command.commandId,
      sharedProjectId: command.sharedProjectId,
      deviceId: command.deviceId,
      membershipEpoch: command.membershipEpoch,
      manifestRevision: command.manifestRevision,
      manifestHeadSha256: command.manifestHeadSha256,
      baseManifestSha256: command.baseManifestSha256,
      fence: command.fence,
      planToken: command.planToken,
      planSha256: command.planSha256,
    };
    expect(decodeCoworkReplicaApplyApprovalResponse(receipt, command)).toMatchObject({
      status: "accepted",
      commandId: "command-one",
    });
    expect(
      decodeCoworkReplicaApplyApprovalResponse({ status: "authority-changed" }, command),
    ).toEqual({ status: "authority-changed" });
    expect(() =>
      decodeCoworkReplicaApplyApprovalResponse({ ...receipt, commandId: "command-two" }, command),
    ).toThrow(/does not match/);
    expect(() =>
      decodeCoworkReplicaApplyApprovalResponse({ ...receipt, applied: true }, command),
    ).toThrow(/unsupported shape/);
  });
});
