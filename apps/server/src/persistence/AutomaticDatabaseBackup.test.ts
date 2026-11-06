import { afterEach, describe, expect, it, vi } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ServerConfig } from "../config.ts";
import { SqliteBackup } from "./NodeSqliteClient.ts";
import {
  AutomaticDatabaseBackupLive,
  backupDatabaseConnection,
  resolveBackupRoot,
  runAutomaticDatabaseBackup,
} from "./AutomaticDatabaseBackup.ts";

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
    const restored = new DatabaseSync(first.path!, { readOnly: true });
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

  it("removes only service-owned partial files", async () => {
    const input = fixture();
    fs.mkdirSync(input.backupRoot, { recursive: true });
    fs.writeFileSync(
      path.join(input.backupRoot, "club-code-state-20261104-080000Z.sqlite.partial"),
      "x",
    );
    fs.writeFileSync(path.join(input.backupRoot, "keep-me.partial"), "personal");

    await runAutomaticDatabaseBackup({
      ...input,
      now: new Date("2026-11-05T08:00:00.000Z"),
      backupTo: (destination) => backupDatabaseConnection(input.database, destination),
    });

    expect(
      fs.existsSync(path.join(input.backupRoot, "club-code-state-20261104-080000Z.sqlite.partial")),
    ).toBe(false);
    expect(fs.readFileSync(path.join(input.backupRoot, "keep-me.partial"), "utf8")).toBe(
      "personal",
    );
    input.database.close();
  });
});
