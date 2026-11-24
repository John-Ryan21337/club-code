import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { CheckpointRef, ThreadId } from "@cafecode/contracts";

import {
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../attachmentStore.ts";
import { CheckpointStore } from "../checkpointing/Services/CheckpointStore.ts";
import { ServerConfig } from "../config.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";

export const deleteThreadAttachments = Effect.fn("deleteThreadAttachments")(function* (
  threadId: ThreadId,
) {
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    yield* Effect.logWarning("skipping hard-delete attachment cleanup for unsafe thread id", {
      threadId,
    });
    return;
  }

  const entries = yield* fileSystem
    .readDirectory(config.attachmentsDir, { recursive: false })
    .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)));

  yield* Effect.forEach(
    entries,
    (entry) =>
      Effect.gen(function* () {
        const relativePath = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
        if (relativePath.length === 0 || relativePath.includes("/")) {
          return;
        }
        const attachmentId = parseAttachmentIdFromRelativePath(relativePath);
        if (!attachmentId) {
          return;
        }
        const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
        if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
          return;
        }
        yield* fileSystem.remove(path.join(config.attachmentsDir, relativePath), {
          force: true,
        });
      }),
    { concurrency: 1 },
  );
});

const loadThreadHardDeleteMetadata = Effect.fn("loadThreadHardDeleteMetadata")(function* (
  threadId: ThreadId,
) {
  const sql = yield* SqlClient.SqlClient;
  const [threadRow] = yield* sql<{
    readonly worktreePath: string | null;
    readonly workspaceRoot: string | null;
  }>`
    SELECT
      thread.worktree_path AS "worktreePath",
      project.workspace_root AS "workspaceRoot"
    FROM projection_threads AS thread
    LEFT JOIN projection_projects AS project
      ON project.project_id = thread.project_id
    WHERE thread.thread_id = ${threadId}
    LIMIT 1
  `;

  const checkpointRows = yield* sql<{ readonly checkpointRef: string }>`
    SELECT DISTINCT checkpoint_ref AS "checkpointRef"
    FROM projection_turns
    WHERE thread_id = ${threadId}
      AND checkpoint_ref IS NOT NULL
  `;

  return {
    cwd: threadRow?.worktreePath ?? threadRow?.workspaceRoot ?? null,
    worktreePath: threadRow?.worktreePath ?? null,
    workspaceRoot: threadRow?.workspaceRoot ?? null,
    checkpointRefs: checkpointRows.map((row) => CheckpointRef.make(row.checkpointRef)),
  };
});

const cleanupOrphanedManagedWorktree = Effect.fn("cleanupOrphanedManagedWorktree")(
  function* (metadata: {
    readonly worktreePath: string | null;
    readonly workspaceRoot: string | null;
  }) {
    if (!metadata.worktreePath || !metadata.workspaceRoot) return;

    const sql = yield* SqlClient.SqlClient;
    const config = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target = path.resolve(metadata.worktreePath);
    const root = path.resolve(config.worktreesDir);
    const relative = path.relative(root, target);
    if (
      relative.length === 0 ||
      path.isAbsolute(relative) ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`)
    ) {
      return;
    }

    const exists = yield* fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return;

    const canonical = yield* Effect.all({
      root: fileSystem.realPath(root),
      target: fileSystem.realPath(target),
      targetInfo: fileSystem.stat(target),
    }).pipe(Effect.option);
    if (Option.isNone(canonical)) {
      yield* Effect.logWarning("could not validate an orphaned worktree path");
      return;
    }
    const canonicalRelative = path.relative(canonical.value.root, canonical.value.target);
    if (
      canonicalRelative.length === 0 ||
      path.isAbsolute(canonicalRelative) ||
      canonicalRelative === ".." ||
      canonicalRelative.startsWith(`..${path.sep}`)
    ) {
      return;
    }

    const referencedPaths = yield* sql<{ readonly worktreePath: string }>`
    SELECT worktree_path AS "worktreePath"
    FROM projection_threads
    WHERE worktree_path IS NOT NULL
  `;
    for (const row of referencedPaths) {
      const reference = yield* Effect.all({
        path: fileSystem.realPath(row.worktreePath),
        info: fileSystem.stat(row.worktreePath),
      }).pipe(Effect.option);
      // An unreadable reference can still name this directory through an alias.
      // Preserve the worktree until every remaining reference can be checked.
      if (Option.isNone(reference)) return;
      const targetInfo = canonical.value.targetInfo;
      const referenceInfo = reference.value.info;
      const sameIdentity =
        targetInfo.dev === referenceInfo.dev &&
        Option.isSome(targetInfo.ino) &&
        Option.isSome(referenceInfo.ino) &&
        targetInfo.ino.value !== 0 &&
        targetInfo.ino.value === referenceInfo.ino.value;
      if (
        sameIdentity ||
        path.relative(canonical.value.target, reference.value.path).length === 0
      ) {
        return;
      }
    }

    const driver = yield* Effect.serviceOption(GitVcsDriver);
    if (Option.isNone(driver)) {
      yield* Effect.logWarning("could not remove an orphaned worktree because Git is unavailable");
      return;
    }
    yield* driver.value
      .removeWorktree({
        cwd: metadata.workspaceRoot,
        path: target,
        force: false,
      })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("preserved an orphaned worktree that Git could not remove safely", {
            worktreePath: target,
            cause,
          }),
        ),
      );
  },
);

const deleteThreadCheckpointRefs = Effect.fn("deleteThreadCheckpointRefs")(function* (
  threadId: ThreadId,
) {
  const checkpointStore = yield* CheckpointStore;
  const metadata = yield* loadThreadHardDeleteMetadata(threadId);
  if (!metadata.cwd || metadata.checkpointRefs.length === 0) {
    return;
  }
  yield* checkpointStore
    .deleteCheckpointRefs({
      cwd: metadata.cwd,
      checkpointRefs: metadata.checkpointRefs,
    })
    .pipe(
      Effect.catch((cause) =>
        Effect.logWarning("failed to delete thread checkpoint refs during hard delete", {
          threadId,
          cwd: metadata.cwd,
          cause,
        }),
      ),
    );
});

export const hardDeleteThreadLocalData = Effect.fn("hardDeleteThreadLocalData")(function* (input: {
  readonly threadId: ThreadId;
}) {
  const sql = yield* SqlClient.SqlClient;
  const metadata = yield* loadThreadHardDeleteMetadata(input.threadId);

  yield* deleteThreadCheckpointRefs(input.threadId);
  yield* deleteThreadAttachments(input.threadId);

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        DELETE FROM provider_session_runtime
        WHERE thread_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM projection_thread_sessions
        WHERE thread_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM projection_thread_goals
        WHERE thread_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM projection_pending_approvals
        WHERE thread_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM projection_thread_activities
        WHERE thread_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM projection_thread_messages
        WHERE thread_id = ${input.threadId}
      `;
      yield* sql`
        UPDATE projection_thread_proposed_plans
        SET implementation_thread_id = NULL
        WHERE implementation_thread_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM projection_thread_proposed_plans
        WHERE thread_id = ${input.threadId}
      `;
      yield* sql`
        UPDATE projection_turns
        SET
          source_proposed_plan_thread_id = NULL,
          source_proposed_plan_id = NULL
        WHERE source_proposed_plan_thread_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM projection_turns
        WHERE thread_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM checkpoint_diff_blobs
        WHERE thread_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM orchestration_command_receipts
        WHERE aggregate_kind = 'thread'
          AND aggregate_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM orchestration_events
        WHERE aggregate_kind = 'thread'
          AND stream_id = ${input.threadId}
      `;
      yield* sql`
        DELETE FROM projection_threads
        WHERE thread_id = ${input.threadId}
      `;
    }),
  );

  yield* cleanupOrphanedManagedWorktree(metadata);

  return { deleted: true };
});
