import { afterEach, describe, expect, it, vi } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as fsAsync from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { ServerConfig } from "../config.ts";
import { SqliteBackup } from "./NodeSqliteClient.ts";
import {
  AutomaticDatabaseBackupLive,
  backupDatabaseConnection,
  resolveBackupRoot,
  runAutomaticDatabaseBackup,
  restoreSnapshot,
  verifySnapshot,
} from "./AutomaticDatabaseBackup.ts";

vi.mock("node:fs/promises", { spy: true });

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "club-backup-"));
  roots.push(root);
  const dbPath = path.join(root, "state.sqlite");
  const database = new DatabaseSync(dbPath);
  database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
  database.prepare("INSERT INTO threads VALUES (?, ?)").run("one", "Protected thread");
  return { root, dbPath, database, backupRoot: path.join(root, "backups") };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("automatic database backups", () => {
  it("disables backups for ordinary server storage without guessing a release folder", () => {
    expect(resolveBackupRoot(path.join(os.homedir(), ".cafe-code"), {})).toBeNull();
    expect(resolveBackupRoot(".club-runtime", {})).toBeNull();
  });

  it("binds inferred and explicit backup locations to the release storage folder", () => {
    const releaseRoot = path.resolve("release");
    const baseDir = path.join(releaseRoot, ".club-runtime");
    const backupRoot = path.join(releaseRoot, "backups");
    expect(resolveBackupRoot(baseDir, {})).toBe(backupRoot);
    expect(
      resolveBackupRoot(baseDir, {
        CAFE_CODE_RELEASE_ROOT: releaseRoot,
        CAFE_CODE_BACKUPS_DIR: backupRoot,
      }),
    ).toBe(backupRoot);
    expect(() => resolveBackupRoot(baseDir, { CAFE_CODE_RELEASE_ROOT: "relative" })).toThrow(
      "does not match",
    );
    expect(() =>
      resolveBackupRoot(baseDir, { CAFE_CODE_RELEASE_ROOT: path.join(releaseRoot, "other") }),
    ).toThrow("does not match");
    expect(() =>
      resolveBackupRoot(baseDir, { CAFE_CODE_BACKUPS_DIR: path.join(releaseRoot, "other") }),
    ).toThrow("must use the release folder");
    expect(() =>
      resolveBackupRoot(path.join(releaseRoot, ".cafe-code"), {
        CAFE_CODE_BACKUPS_DIR: backupRoot,
      }),
    ).toThrow("not bound to a release folder");
  });

  it.each([undefined, "relative-invalid-release"])(
    "keeps server startup usable with release configuration %s and makes no backup writes",
    async (releaseRoot) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "club-backup-startup-"));
      roots.push(root);
      vi.stubEnv("CAFE_CODE_RELEASE_ROOT", releaseRoot);
      vi.stubEnv("CAFE_CODE_BACKUPS_DIR", undefined);
      const backupTo = vi.fn(() => Effect.succeed(1));
      await Effect.runPromise(
        Effect.scoped(
          Layer.build(
            AutomaticDatabaseBackupLive.pipe(
              Layer.provide(Layer.succeed(SqliteBackup, { backupTo })),
              Layer.provide(ServerConfig.layerTest(root, path.join(root, ".cafe-code"))),
              Layer.provide(NodeServices.layer),
            ),
          ),
        ),
      );
      expect(backupTo).not.toHaveBeenCalled();
      expect(fs.readdirSync(root)).toEqual([".cafe-code"]);
    },
  );

  it("rejects redirected backup directories before deleting partials or copying the database", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "club-backup-redirect-"));
    roots.push(root);
    const target = path.join(root, "redirected");
    const backupRoot = path.join(root, "backups");
    fs.mkdirSync(target);
    const partial = path.join(target, "club-code-state-20261104-080000Z.sqlite.partial");
    fs.writeFileSync(partial, "preserved");
    fs.symlinkSync(target, backupRoot, process.platform === "win32" ? "junction" : "dir");
    const backupTo = vi.fn(async () => 1);
    await expect(runAutomaticDatabaseBackup({ backupRoot, backupTo })).rejects.toThrow(
      "must not redirect",
    );
    expect(backupTo).not.toHaveBeenCalled();
    expect(fs.readFileSync(partial, "utf8")).toBe("preserved");
  });

  it("creates a readable backup and does not repeat it before the interval", async () => {
    const input = fixture();
    const now = new Date("2026-11-05T08:00:00.000Z");
    let calls = 0;
    const backupTo = (destination: string) => {
      calls += 1;
      return backupDatabaseConnection(input.database, destination);
    };

    const first = await runAutomaticDatabaseBackup({ ...input, now, backupTo });
    expect(first.status).toBe("created");
    expect(first.path).toBeDefined();
    const restoreRoot = path.join(input.root, "restored");
    fs.mkdirSync(restoreRoot);
    await restoreSnapshot(first.path!, restoreRoot);
    const restored = new DatabaseSync(path.join(restoreRoot, "state.sqlite"), { readOnly: true });
    expect(restored.prepare("SELECT title FROM threads WHERE id = 'one'").get()).toEqual({
      title: "Protected thread",
    });
    restored.close();

    const second = await runAutomaticDatabaseBackup({
      ...input,
      now: new Date(now.getTime() + 60_000),
      backupTo,
    });
    expect(second).toEqual({ status: "not-due" });
    expect(calls).toBe(1);
    input.database.close();
  });

  it("keeps three used days across gaps and refreshes the same day without adding a slot", async () => {
    const input = fixture();
    const stateRoot = path.join(input.root, "userdata");
    fs.mkdirSync(path.join(stateRoot, "attachments"), { recursive: true });
    fs.mkdirSync(path.join(stateRoot, "worktrees"));
    fs.writeFileSync(path.join(stateRoot, "worktrees", "project.txt"), "excluded");
    fs.writeFileSync(path.join(stateRoot, "attachments", "image.png"), "image bytes");
    fs.writeFileSync(path.join(stateRoot, "settings.json"), '{"theme":"dark"}');
    const backupTo = (destination: string) => backupDatabaseConnection(input.database, destination);
    try {
      for (const day of ["2026-01-01", "2026-02-01", "2026-05-01", "2026-08-01"]) {
        await runAutomaticDatabaseBackup({
          ...input,
          stateRoot,
          backupTo,
          now: new Date(day + "T12:00:00"),
        });
      }
      expect(fs.readdirSync(input.backupRoot)).toHaveLength(3);
      expect(fs.readdirSync(input.backupRoot).some((n) => n.includes("2026-01-01"))).toBe(false);
      const latest = await runAutomaticDatabaseBackup({
        ...input,
        stateRoot,
        backupTo,
        now: new Date("2026-08-01T14:00:00"),
      });
      expect(fs.readdirSync(input.backupRoot)).toHaveLength(3);
      const manifest = await verifySnapshot(latest.path!);
      expect(manifest.files.map((f) => f.path)).toEqual([
        "state.sqlite",
        "attachments/image.png",
        "settings.json",
      ]);
      const recovered = path.join(input.root, "recovered");
      fs.mkdirSync(recovered);
      await restoreSnapshot(latest.path!, recovered);
      expect(fs.readFileSync(path.join(recovered, "attachments", "image.png"), "utf8")).toBe(
        "image bytes",
      );
      expect(fs.readFileSync(path.join(recovered, "settings.json"), "utf8")).toBe(
        '{"theme":"dark"}',
      );
      const before = fs.readdirSync(input.backupRoot);
      await expect(
        runAutomaticDatabaseBackup({
          ...input,
          stateRoot,
          now: new Date("2026-09-01T12:00:00"),
          backupTo: async () => {
            throw new Error("disk full");
          },
        }),
      ).rejects.toThrow("disk full");
      expect(fs.readdirSync(input.backupRoot)).toEqual(before);
    } finally {
      input.database.close();
    }
  });

  it("counts legacy automatic points in retention and preserves manual backups", async () => {
    const input = fixture();
    fs.mkdirSync(input.backupRoot);
    for (const day of ["01", "02", "03"]) {
      const file = path.join(input.backupRoot, "club-code-state-202601" + day + "-120000Z.sqlite");
      fs.writeFileSync(file, "legacy");
      fs.utimesSync(
        file,
        new Date("2026-01-" + day + "T12:00:00"),
        new Date("2026-01-" + day + "T12:00:00"),
      );
    }
    fs.writeFileSync(path.join(input.backupRoot, "pre-upgrade.sqlite"), "manual");
    try {
      await runAutomaticDatabaseBackup({
        ...input,
        now: new Date("2026-01-04T12:00:00"),
        backupTo: (destination) => backupDatabaseConnection(input.database, destination),
      });
      expect(fs.readdirSync(input.backupRoot)).toHaveLength(4);
      expect(
        fs.existsSync(path.join(input.backupRoot, "club-code-state-20260101-120000Z.sqlite")),
      ).toBe(false);
      expect(fs.readFileSync(path.join(input.backupRoot, "pre-upgrade.sqlite"), "utf8")).toBe(
        "manual",
      );
    } finally {
      input.database.close();
    }
  });

  it("includes private provider state but excludes runtime locks and shared provider aliases", async () => {
    const input = fixture();
    const stateRoot = path.join(input.root, "userdata");
    const privateHome = path.join(input.root, "codex-homes", "codex");
    const shared = path.join(input.root, "shared-provider");
    fs.mkdirSync(stateRoot);
    fs.mkdirSync(path.join(privateHome, "memories"), { recursive: true });
    fs.mkdirSync(path.join(privateHome, "thread-writer-locks"));
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(shared, "external-session.json"), "provider owned");
    fs.symlinkSync(
      shared,
      path.join(privateHome, "sessions"),
      process.platform === "win32" ? "junction" : "dir",
    );
    fs.writeFileSync(path.join(privateHome, "auth.json"), '{"fixture":"private-auth"}');
    fs.writeFileSync(path.join(privateHome, "memories", "note.md"), "private memory");
    fs.writeFileSync(path.join(privateHome, ".sqlite-maintenance.lock"), "lock");
    fs.writeFileSync(path.join(privateHome, "thread-writer-locks", "thread.lock"), "lock");
    fs.writeFileSync(path.join(privateHome, "config.toml"), "shared-copy-fixture");
    try {
      const snapshot = await runAutomaticDatabaseBackup({
        ...input,
        stateRoot,
        backupTo: (destination) => backupDatabaseConnection(input.database, destination),
      });
      const manifest = await verifySnapshot(snapshot.path!);
      expect(manifest.files.map((file) => file.path)).toEqual([
        "state.sqlite",
        "__club-private/codex-homes/codex/auth.json",
        "__club-private/codex-homes/codex/memories/note.md",
      ]);
      const destination = path.join(input.root, "recovered-private");
      fs.mkdirSync(destination);
      await restoreSnapshot(snapshot.path!, destination);
      expect(
        fs.readFileSync(
          path.join(destination, "__club-private", "codex-homes", "codex", "auth.json"),
          "utf8",
        ),
      ).toBe('{"fixture":"private-auth"}');
    } finally {
      input.database.close();
    }
  });

  it("allows the next backup attempt after failed staging cleanup", async () => {
    const input = fixture();
    const remove = vi
      .mocked(fsAsync.rm)
      .mockRejectedValueOnce(new Error("cleanup temporarily unavailable"));
    try {
      await expect(
        runAutomaticDatabaseBackup({
          ...input,
          backupTo: async () => {
            throw new Error("copy failed");
          },
        }),
      ).rejects.toThrow("cleanup temporarily unavailable");
      remove.mockRestore();
      const next = await runAutomaticDatabaseBackup({
        ...input,
        backupTo: (destination) => backupDatabaseConnection(input.database, destination),
      });
      expect(next.status).toBe("created");
      await expect(verifySnapshot(next.path!)).resolves.toMatchObject({ version: 1 });
    } finally {
      remove.mockRestore();
      input.database.close();
    }
  });

  it("rejects damaged backup payloads before writing a restore", async () => {
    const input = fixture();
    try {
      const snapshot = await runAutomaticDatabaseBackup({
        ...input,
        backupTo: (destination) => backupDatabaseConnection(input.database, destination),
      });
      fs.writeFileSync(path.join(snapshot.path!, "000000.gz"), "damaged");
      const target = path.join(input.root, "recover");
      fs.mkdirSync(target);
      await expect(restoreSnapshot(snapshot.path!, target)).rejects.toThrow();
      expect(fs.readdirSync(target)).toEqual([]);
    } finally {
      input.database.close();
    }
  });
});
