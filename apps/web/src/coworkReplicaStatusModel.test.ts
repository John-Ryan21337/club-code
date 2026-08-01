import { describe, expect, it } from "vitest";

import {
  appendCoworkReplicaStatusPage,
  beginCoworkReplicaStatusView,
  CoworkReplicaStatusPayloadError,
  decodeCoworkReplicaStatusPage,
} from "./coworkReplicaStatusModel";

const hashes = Array.from({ length: 12 }, (_, index) => index.toString(16).padStart(64, "0"));

function entry(relativePath: string, revision = 9) {
  return {
    relativePath,
    manifestRevision: revision,
    head: {
      kind: "version",
      revisionId: hashes[0],
      contentSha256: hashes[1],
      auditRef: hashes[2],
    },
    forks: [],
    recoverableTombstones: [],
    conflictRefs: [],
    materialization: "current",
    operatorAttention: [],
  };
}

function page(entries: unknown[], nextCursor: string | null = null, projectRevision = 9) {
  return {
    sharedProjectId: "project-one",
    projectRevision,
    entries,
    nextCursor,
  };
}

describe("cowork replica status model", () => {
  it("accepts a bounded, project-scoped page and returns immutable data", () => {
    const decoded = decodeCoworkReplicaStatusPage(
      page([
        {
          ...entry("data/account.db"),
          forks: [{ revisionId: hashes[3], contentSha256: hashes[4], auditRef: hashes[5] }],
          recoverableTombstones: [
            { revisionId: hashes[6], contentSha256: null, auditRef: hashes[7] },
          ],
          conflictRefs: [hashes[8]],
          materialization: "recovery-preserved",
          operatorAttention: ["database-fork-needs-selection", "recovery-copy-preserved"],
        },
      ]),
      "project-one",
    );

    expect(decoded.entries[0]).toMatchObject({
      relativePath: "data/account.db",
      manifestRevision: 9,
      materialization: "recovery-preserved",
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.entries)).toBe(true);
    expect(Object.isFrozen(decoded.entries[0])).toBe(true);
  });

  it.each([
    ["foreign project", { ...page([]), sharedProjectId: "project-two" }],
    ["absolute POSIX path", page([entry("/private/source.ts")])],
    ["absolute Windows path", page([entry("C:\\private\\source.ts")])],
    ["parent traversal", page([entry("src/../secret")])],
    ["reserved Windows device", page([entry("src/CON.txt")])],
    ["unpaired surrogate", page([entry("src/\ud800.txt")])],
    ["oversized UTF-8 segment", page([entry(`src/${"界".repeat(86)}`)])],
    ["private field", { ...page([]), absolutePath: "/private/source.ts" }],
    ["file body field", page([{ ...entry("src/main.ts"), fileBody: "secret" }])],
    ["credentials field", page([{ ...entry("src/main.ts"), credential: "secret" }])],
    ["invalid cursor", page([], "cursor with spaces")],
    ["future entry revision", page([entry("src/main.ts", 10)])],
    [
      "tombstone with content",
      page([
        {
          ...entry("src/main.ts"),
          head: {
            kind: "tombstone",
            revisionId: hashes[0],
            contentSha256: hashes[1],
            auditRef: hashes[2],
          },
        },
      ]),
    ],
    ["unacknowledged conflict", page([{ ...entry("src/main.ts"), conflictRefs: [hashes[8]] }])],
    [
      "unbounded attention text",
      page([{ ...entry("src/main.ts"), operatorAttention: ["provider output: secret"] }]),
    ],
  ])("rejects %s payloads", (_label, payload) => {
    expect(() => decodeCoworkReplicaStatusPage(payload, "project-one")).toThrow(
      CoworkReplicaStatusPayloadError,
    );
  });

  it("rejects duplicate paths, revisions, conflicts, and attention reasons", () => {
    expect(() =>
      decodeCoworkReplicaStatusPage(
        page([entry("src/main.ts"), entry("src/main.ts")]),
        "project-one",
      ),
    ).toThrow(/duplicate paths/);
    expect(() =>
      decodeCoworkReplicaStatusPage(
        page([
          {
            ...entry("src/main.ts"),
            forks: [{ revisionId: hashes[0], contentSha256: hashes[3], auditRef: hashes[4] }],
          },
        ]),
        "project-one",
      ),
    ).toThrow(/duplicate revision identity/);
    expect(() =>
      decodeCoworkReplicaStatusPage(
        page([
          {
            ...entry("src/main.ts"),
            conflictRefs: [hashes[8], hashes[8]],
            operatorAttention: ["conflict-needs-resolution"],
          },
        ]),
        "project-one",
      ),
    ).toThrow(/conflictRefs contains duplicates/);
    expect(() =>
      decodeCoworkReplicaStatusPage(
        page([entry("README.md"), { ...entry("readme.md"), head: null }]),
        "project-one",
      ),
    ).toThrow(/portable path aliases/);
  });

  it("rejects inherited, symbolic, accessor, sparse, and subclassed payload shapes", () => {
    const inherited = Object.assign(Object.create({ privatePath: "/private/source.ts" }), page([]));
    expect(() => decodeCoworkReplicaStatusPage(inherited, "project-one")).toThrow(/plain object/);

    const symbolic = page([]) as ReturnType<typeof page> & { [key: symbol]: string };
    symbolic[Symbol("credential")] = "secret";
    expect(() => decodeCoworkReplicaStatusPage(symbolic, "project-one")).toThrow(
      /unsupported shape/,
    );

    const accessor = page([]);
    Object.defineProperty(accessor, "entries", {
      enumerable: true,
      get: () => [],
    });
    expect(() => decodeCoworkReplicaStatusPage(accessor, "project-one")).toThrow(/data property/);

    const sparseEntries = Array(1);
    expect(() => decodeCoworkReplicaStatusPage(page(sparseEntries), "project-one")).toThrow(
      /unsupported shape|data property/,
    );

    class StatusEntries extends Array<unknown> {}
    expect(() => decodeCoworkReplicaStatusPage(page(new StatusEntries()), "project-one")).toThrow(
      /plain array/,
    );
  });

  it("requires evidence-specific attention and rejects revision reuse across paths", () => {
    expect(() =>
      decodeCoworkReplicaStatusPage(
        page([
          {
            ...entry("src/main.ts"),
            forks: [{ revisionId: hashes[3], contentSha256: hashes[4], auditRef: hashes[5] }],
          },
        ]),
        "project-one",
      ),
    ).toThrow(/conflicts and forks require matching/);
    expect(() =>
      decodeCoworkReplicaStatusPage(
        page([
          {
            ...entry("src/main.ts"),
            materialization: "failed",
            operatorAttention: ["conflict-needs-resolution"],
          },
        ]),
        "project-one",
      ),
    ).toThrow(/failed materialization requires matching/);
    expect(() =>
      decodeCoworkReplicaStatusPage(
        page([entry("a.ts"), { ...entry("b.ts"), manifestRevision: 8 }]),
        "project-one",
      ),
    ).toThrow(/duplicate revision identity/);

    const first = {
      ...entry("a.ts"),
      conflictRefs: [hashes[8]],
      operatorAttention: ["conflict-needs-resolution"],
    };
    const second = {
      ...entry("b.ts"),
      head: {
        kind: "version",
        revisionId: hashes[3],
        contentSha256: hashes[4],
        auditRef: hashes[5],
      },
      conflictRefs: [hashes[8]],
      operatorAttention: ["conflict-needs-resolution"],
    };
    expect(() => decodeCoworkReplicaStatusPage(page([first, second]), "project-one")).toThrow(
      /duplicate conflict reference/,
    );
  });

  it("snapshots mutable transport data into a deeply immutable view", () => {
    const rawEntry = entry("src/main.ts");
    const rawPage = page([rawEntry]);
    const decoded = decodeCoworkReplicaStatusPage(rawPage, "project-one");
    rawEntry.relativePath = "src/changed.ts";
    rawEntry.head.revisionId = hashes[9];
    rawPage.entries.push(entry("src/late.ts"));

    expect(decoded.entries).toHaveLength(1);
    expect(decoded.entries[0]?.relativePath).toBe("src/main.ts");
    expect(decoded.entries[0]?.head?.revisionId).toBe(hashes[0]);
    expect(Object.isFrozen(decoded.entries[0]?.head)).toBe(true);
  });

  it("enforces stable pagination revision, cursor, uniqueness, ordering, and bounds", () => {
    const first = beginCoworkReplicaStatusView(
      decodeCoworkReplicaStatusPage(page([entry("a.ts")], "next"), "project-one"),
    );
    const second = decodeCoworkReplicaStatusPage(
      page([{ ...entry("b.ts"), head: null }], null),
      "project-one",
    );
    expect(appendCoworkReplicaStatusPage(first, second, "next").entries).toHaveLength(2);
    expect(() => appendCoworkReplicaStatusPage(first, second, "wrong")).toThrow(/response cursor/);
    expect(() =>
      appendCoworkReplicaStatusPage(
        first,
        decodeCoworkReplicaStatusPage(page([entry("a.ts")], null), "project-one"),
        "next",
      ),
    ).toThrow(/repeated or mutated/);
    expect(() =>
      appendCoworkReplicaStatusPage(
        first,
        decodeCoworkReplicaStatusPage(
          page([{ ...entry("b.ts"), head: null }], null, 10),
          "project-one",
        ),
        "next",
      ),
    ).toThrow(/revision changed/);
    expect(() =>
      appendCoworkReplicaStatusPage(
        first,
        decodeCoworkReplicaStatusPage(
          page([{ ...entry("b.ts"), head: null }], "next"),
          "project-one",
        ),
        "next",
      ),
    ).toThrow(/cursor did not advance/);

    const portableFirst = beginCoworkReplicaStatusView(
      decodeCoworkReplicaStatusPage(page([entry("README.md")], "portable"), "project-one"),
    );
    const portableSecond = decodeCoworkReplicaStatusPage(
      page([{ ...entry("readme.md"), head: null }]),
      "project-one",
    );
    expect(() => appendCoworkReplicaStatusPage(portableFirst, portableSecond, "portable")).toThrow(
      /portable path alias/,
    );
  });
});
