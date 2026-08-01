import type { SharedReplicaRelativePath } from "@cafecode/contracts";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class CollaborationSandboxPathError extends Data.TaggedError(
  "CollaborationSandboxPathError",
)<{
  readonly reason: "root-unavailable" | "outside-sandbox" | "link-or-reparse-point";
}> {}

export interface CollaborationSandboxPathAuthorityShape {
  /**
   * Revalidates an already schema-canonical relative path against the current
   * filesystem. The eventual file materializer must call this again directly
   * before opening or replacing a path so a metadata admission cannot become a
   * filesystem TOCTOU capability.
   */
  readonly assertContained: (
    relativePath: SharedReplicaRelativePath,
  ) => Effect.Effect<void, CollaborationSandboxPathError>;
}

export class CollaborationSandboxPathAuthority extends Context.Service<
  CollaborationSandboxPathAuthority,
  CollaborationSandboxPathAuthorityShape
>()("cafecode/collaboration/CollaborationSandboxPathAuthority") {}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))
  );
}

export function makeCollaborationSandboxPathAuthority(
  workspaceRoot: string,
): Effect.Effect<CollaborationSandboxPathAuthorityShape, CollaborationSandboxPathError> {
  return Effect.tryPromise({
    try: async () => {
      const canonicalRoot = await realpath(workspaceRoot);
      const rootStats = await lstat(canonicalRoot);
      if (!rootStats.isDirectory()) throw new Error("sandbox root is not a directory");

      return {
        assertContained: (relativePath) =>
          Effect.tryPromise({
            try: async () => {
              const segments = relativePath.split("/");
              const lexicalCandidate = resolve(canonicalRoot, ...segments);
              if (!isContained(canonicalRoot, lexicalCandidate)) {
                throw new CollaborationSandboxPathError({ reason: "outside-sandbox" });
              }

              let cursor = canonicalRoot;
              for (const segment of segments) {
                cursor = resolve(cursor, segment);
                try {
                  const stats = await lstat(cursor);
                  // Node reports Windows junctions and ordinary symlinks here.
                  // realpath containment below also rejects other reparse-point
                  // redirects whose target leaves the trusted workspace root.
                  if (stats.isSymbolicLink()) {
                    throw new CollaborationSandboxPathError({
                      reason: "link-or-reparse-point",
                    });
                  }
                  const canonicalCursor = await realpath(cursor);
                  if (!isContained(canonicalRoot, canonicalCursor)) {
                    throw new CollaborationSandboxPathError({
                      reason: "link-or-reparse-point",
                    });
                  }
                } catch (error) {
                  if (error instanceof CollaborationSandboxPathError) throw error;
                  if (
                    typeof error === "object" &&
                    error !== null &&
                    "code" in error &&
                    error.code === "ENOENT"
                  ) {
                    // A new path is allowed after its nearest existing ancestor
                    // has been proven contained. Materialization must recheck.
                    break;
                  }
                  throw error;
                }
              }
            },
            catch: (error) =>
              error instanceof CollaborationSandboxPathError
                ? error
                : new CollaborationSandboxPathError({ reason: "root-unavailable" }),
          }),
      } satisfies CollaborationSandboxPathAuthorityShape;
    },
    catch: () => new CollaborationSandboxPathError({ reason: "root-unavailable" }),
  });
}

export const CollaborationSandboxPathAuthorityLive = (workspaceRoot: string) =>
  Layer.effect(
    CollaborationSandboxPathAuthority,
    makeCollaborationSandboxPathAuthority(workspaceRoot),
  );
