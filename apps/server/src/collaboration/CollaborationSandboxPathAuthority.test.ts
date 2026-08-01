import { SharedReplicaRelativePath } from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CollaborationSandboxPathError,
  makeCollaborationSandboxPathAuthority,
} from "./CollaborationSandboxPathAuthority.ts";

const decodePath = Schema.decodeUnknownSync(SharedReplicaRelativePath);

describe("CollaborationSandboxPathAuthority", () => {
  it("accepts existing and future descendants of the canonical workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "club-code-file-sandbox-"));
    try {
      await mkdir(join(root, "safe"));
      await writeFile(join(root, "safe", "existing.txt"), "safe");
      const authority = await Effect.runPromise(makeCollaborationSandboxPathAuthority(root));
      await Effect.runPromise(authority.assertContained(decodePath("safe/existing.txt")));
      await Effect.runPromise(authority.assertContained(decodePath("safe/future/file.txt")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects symlink or junction escapes before metadata admission", async () => {
    const root = await mkdtemp(join(tmpdir(), "club-code-file-sandbox-root-"));
    const outside = await mkdtemp(join(tmpdir(), "club-code-file-sandbox-outside-"));
    try {
      let linked = true;
      try {
        await symlink(
          outside,
          join(root, "escape"),
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch (error) {
        if (
          process.platform === "win32" &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EPERM"
        ) {
          linked = false;
        } else {
          throw error;
        }
      }
      if (!linked) return;
      const authority = await Effect.runPromise(makeCollaborationSandboxPathAuthority(root));
      const error = await Effect.runPromise(
        authority.assertContained(decodePath("escape/stolen.txt")).pipe(Effect.flip),
      );
      assert.instanceOf(error, CollaborationSandboxPathError);
      assert.equal(error.reason, "link-or-reparse-point");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("must be rechecked by a materializer and detects a link introduced after admission", async () => {
    const root = await mkdtemp(join(tmpdir(), "club-code-file-sandbox-recheck-"));
    const outside = await mkdtemp(join(tmpdir(), "club-code-file-sandbox-recheck-outside-"));
    try {
      await mkdir(join(root, "future"));
      const authority = await Effect.runPromise(makeCollaborationSandboxPathAuthority(root));
      const relativePath = decodePath("future/value.txt");
      await Effect.runPromise(authority.assertContained(relativePath));
      await rm(join(root, "future"), { recursive: true, force: true });
      try {
        await symlink(
          outside,
          join(root, "future"),
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch (error) {
        if (
          process.platform === "win32" &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EPERM"
        ) {
          return;
        }
        throw error;
      }
      const error = await Effect.runPromise(
        authority.assertContained(relativePath).pipe(Effect.flip),
      );
      assert.equal(error.reason, "link-or-reparse-point");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
