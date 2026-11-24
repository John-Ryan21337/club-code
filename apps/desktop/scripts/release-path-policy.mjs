import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function isWithin(root, candidate) {
  const suffix = relative(root, candidate);
  return (
    suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`))
  );
}

export function assertReleasePath(root, candidate, name = "Club Code storage") {
  const canonicalRoot = realpathSync(root);
  if (!isAbsolute(candidate) || !isWithin(canonicalRoot, resolve(candidate))) {
    throw new Error(`${name} must be inside the Club Code release folder.`);
  }
  let existing = resolve(candidate);
  while (!existsSync(existing)) {
    // A dangling link is still a filesystem entry. Never create through it.
    try {
      if (lstatSync(existing).isSymbolicLink()) {
        throw new Error(`${name} has an unresolved link in the release folder.`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    existing = dirname(existing);
  }
  if (!isWithin(canonicalRoot, realpathSync(existing))) {
    throw new Error(`${name} resolves outside the release folder.`);
  }
  return resolve(candidate);
}

function boundedGitText(path) {
  if (statSync(path).size > 64 * 1024) throw new Error("Git path metadata is too large.");
  return readFileSync(path, "utf8").trim();
}

export function validateReleaseGitStorage(root) {
  const canonicalRoot = realpathSync(root);
  const gitEntry = join(canonicalRoot, ".git");
  try {
    // Packaged releases do not need Git metadata.
    try {
      lstatSync(gitEntry);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    assertReleasePath(canonicalRoot, gitEntry, "Git metadata");
    let gitDir = gitEntry;
    if (!statSync(gitEntry).isDirectory()) {
      const pointer = /^gitdir: ([^\r\n]+)$/u.exec(boundedGitText(gitEntry));
      if (!pointer) throw new Error("Git directory pointer is invalid.");
      gitDir = assertReleasePath(
        canonicalRoot,
        resolve(canonicalRoot, pointer[1]),
        "Git directory",
      );
    }
    let commonDir = gitDir;
    const commonPointer = join(gitDir, "commondir");
    assertReleasePath(canonicalRoot, commonPointer, "Git common directory pointer");
    if (existsSync(commonPointer)) {
      const pointer = boundedGitText(commonPointer);
      if (!pointer || /[\r\n]/u.test(pointer))
        throw new Error("Git common directory pointer is invalid.");
      commonDir = assertReleasePath(
        canonicalRoot,
        resolve(gitDir, pointer),
        "Git common directory",
      );
    }
    const checkedObjects = new Set();
    const checkObjects = (objectsDir) => {
      const localObjects = assertReleasePath(canonicalRoot, objectsDir, "Git objects");
      if (checkedObjects.has(localObjects)) return;
      if (checkedObjects.size >= 32)
        throw new Error("Git object alternates exceed the release limit.");
      checkedObjects.add(localObjects);
      const alternates = join(localObjects, "info", "alternates");
      assertReleasePath(canonicalRoot, alternates, "Git alternates");
      if (!existsSync(alternates)) return;
      for (const pointer of boundedGitText(alternates).split(/\r?\n/u).filter(Boolean)) {
        // Git permits C-style quoting. Refuse ambiguous forms instead of decoding differently.
        if (pointer.startsWith('"')) throw new Error("Quoted Git alternates are unsupported.");
        checkObjects(resolve(localObjects, pointer));
      }
    };
    checkObjects(join(commonDir, "objects"));
  } catch {
    throw new Error(
      "Club Code requires Git metadata inside the release folder. Use a standalone checkout instead of an external worktree or object store.",
    );
  }
}
