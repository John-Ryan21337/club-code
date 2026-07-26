import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import * as path from "node:path";

import {
  type BundledAmbientAssetManifest,
  decodeBundledAmbientAssetManifest,
} from "./bundled-ambient-asset-manifest.ts";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_LICENSE_EVIDENCE_BYTES = 256 * 1024;
const MAX_SCANNED_FILES = 256;

export type BundledAmbientAssetValidationIssueCode =
  | "hash-mismatch"
  | "invalid-manifest"
  | "manifest-not-regular"
  | "manifest-too-large"
  | "missing-file"
  | "not-regular-file"
  | "path-escape"
  | "size-mismatch"
  | "symlink"
  | "unexpected-entry"
  | "unlisted-file";

export interface BundledAmbientAssetValidationIssue {
  readonly code: BundledAmbientAssetValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface BundledAmbientAssetValidationResult {
  readonly manifest: BundledAmbientAssetManifest | null;
  readonly issues: ReadonlyArray<BundledAmbientAssetValidationIssue>;
}

export class BundledAmbientAssetValidationError extends Error {
  readonly issues: ReadonlyArray<BundledAmbientAssetValidationIssue>;

  constructor(issues: ReadonlyArray<BundledAmbientAssetValidationIssue>) {
    super(issues.map((issue) => `${issue.code} ${issue.path}: ${issue.message}`).join("\n"));
    this.name = "BundledAmbientAssetValidationError";
    this.issues = issues;
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortAndDedupeIssues(
  issues: ReadonlyArray<BundledAmbientAssetValidationIssue>,
): ReadonlyArray<BundledAmbientAssetValidationIssue> {
  const unique = new Map<string, BundledAmbientAssetValidationIssue>();
  for (const issue of issues) {
    unique.set(`${issue.code}\0${issue.path}\0${issue.message}`, issue);
  }
  return [...unique.values()].toSorted(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      compareStrings(left.code, right.code) ||
      compareStrings(left.message, right.message),
  );
}

async function inspectContainedRegularFile(
  root: string,
  rootRealPath: string,
  manifestRelativePath: string,
  issues: Array<BundledAmbientAssetValidationIssue>,
): Promise<{ readonly absolutePath: string; readonly size: number } | null> {
  const segments = manifestRelativePath.split("/");
  let candidate = root;
  let finalStat: Stats | undefined;

  for (const segment of segments) {
    candidate = path.join(candidate, segment);
    if (!isContainedPath(root, candidate)) {
      issues.push({
        code: "path-escape",
        path: manifestRelativePath,
        message: "resolved outside the manifest directory",
      });
      return null;
    }

    try {
      finalStat = await lstat(candidate);
    } catch (cause) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "ENOENT"
      ) {
        issues.push({
          code: "missing-file",
          path: manifestRelativePath,
          message: "does not exist",
        });
      } else {
        issues.push({
          code: "not-regular-file",
          path: manifestRelativePath,
          message: "could not be inspected",
        });
      }
      return null;
    }

    if (finalStat.isSymbolicLink()) {
      issues.push({
        code: "symlink",
        path: manifestRelativePath,
        message: "contains a symbolic link or reparse-point hop",
      });
      return null;
    }
  }

  if (!finalStat?.isFile()) {
    issues.push({
      code: "not-regular-file",
      path: manifestRelativePath,
      message: "must resolve to a regular file",
    });
    return null;
  }

  let candidateRealPath: string;
  try {
    candidateRealPath = await realpath(candidate);
  } catch {
    issues.push({
      code: "not-regular-file",
      path: manifestRelativePath,
      message: "could not be resolved",
    });
    return null;
  }
  if (!isContainedPath(rootRealPath, candidateRealPath)) {
    issues.push({
      code: "path-escape",
      path: manifestRelativePath,
      message: "resolved outside the real manifest directory",
    });
    return null;
  }

  return { absolutePath: candidate, size: finalStat.size };
}

async function listBundledFiles(
  root: string,
  topLevelDirectory: "licenses" | "media",
  issues: Array<BundledAmbientAssetValidationIssue>,
): Promise<ReadonlyArray<string>> {
  const files: string[] = [];
  const pending: string[] = [topLevelDirectory];
  let scannedEntries = 0;
  while (pending.length > 0) {
    const relativeDirectory = pending.pop()!;
    let entries;
    try {
      entries = await readdir(path.join(root, ...relativeDirectory.split("/")), {
        withFileTypes: true,
      });
    } catch (cause) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "ENOENT"
      ) {
        continue;
      }
      issues.push({
        code: "unexpected-entry",
        path: relativeDirectory,
        message: "could not enumerate the bundled asset directory",
      });
      continue;
    }

    for (const entry of entries.toSorted((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      scannedEntries += 1;
      if (scannedEntries > MAX_SCANNED_FILES) {
        issues.push({
          code: "unexpected-entry",
          path: topLevelDirectory,
          message: `contains more than ${MAX_SCANNED_FILES} entries`,
        });
        return files;
      }
      if (entry.isSymbolicLink()) {
        issues.push({
          code: "symlink",
          path: relativePath,
          message: "bundled asset directories may not contain symbolic links or reparse points",
        });
      } else if (entry.isDirectory()) {
        pending.push(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        issues.push({
          code: "unexpected-entry",
          path: relativePath,
          message: "must be a regular file or directory",
        });
      }
    }
  }
  return files.toSorted();
}

async function readManifest(
  manifestPath: string,
  issues: Array<BundledAmbientAssetValidationIssue>,
): Promise<BundledAmbientAssetManifest | null> {
  let stat;
  try {
    stat = await lstat(manifestPath);
  } catch {
    issues.push({
      code: "missing-file",
      path: "manifest.json",
      message: "manifest does not exist",
    });
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    issues.push({
      code: "manifest-not-regular",
      path: "manifest.json",
      message: "manifest must be a regular, non-symlink file",
    });
    return null;
  }
  if (stat.size > MAX_MANIFEST_BYTES) {
    issues.push({
      code: "manifest-too-large",
      path: "manifest.json",
      message: `manifest exceeds ${MAX_MANIFEST_BYTES} bytes`,
    });
    return null;
  }

  let input: unknown;
  try {
    input = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    issues.push({
      code: "invalid-manifest",
      path: "manifest.json",
      message: "manifest must contain valid JSON",
    });
    return null;
  }

  try {
    return decodeBundledAmbientAssetManifest(input);
  } catch {
    issues.push({
      code: "invalid-manifest",
      path: "manifest.json",
      message: "manifest does not satisfy the bundled ambient asset schema",
    });
    return null;
  }
}

export async function inspectBundledAmbientAssetManifest(
  manifestPath: string,
): Promise<BundledAmbientAssetValidationResult> {
  const issues: BundledAmbientAssetValidationIssue[] = [];
  const manifest = await readManifest(manifestPath, issues);
  if (!manifest) return { manifest: null, issues: sortAndDedupeIssues(issues) };

  const root = path.resolve(path.dirname(manifestPath));
  const rootRealPath = await realpath(root);
  const declaredFiles = new Set<string>();

  for (const asset of manifest.assets) {
    declaredFiles.add(asset.file);
    declaredFiles.add(asset.license.evidencePath);

    const mediaFile = await inspectContainedRegularFile(root, rootRealPath, asset.file, issues);
    if (mediaFile) {
      if (mediaFile.size !== asset.encodedBytes) {
        issues.push({
          code: "size-mismatch",
          path: asset.file,
          message: `expected ${asset.encodedBytes} bytes but found ${mediaFile.size}`,
        });
      } else {
        const bytes = await readFile(mediaFile.absolutePath);
        const actualSha256 = createHash("sha256").update(bytes).digest("hex");
        if (actualSha256 !== asset.sha256) {
          issues.push({
            code: "hash-mismatch",
            path: asset.file,
            message: `expected ${asset.sha256} but found ${actualSha256}`,
          });
        }
      }
    }

    const evidenceFile = await inspectContainedRegularFile(
      root,
      rootRealPath,
      asset.license.evidencePath,
      issues,
    );
    if (
      evidenceFile &&
      (evidenceFile.size === 0 || evidenceFile.size > MAX_LICENSE_EVIDENCE_BYTES)
    ) {
      issues.push({
        code: "size-mismatch",
        path: asset.license.evidencePath,
        message: `license evidence must contain 1 to ${MAX_LICENSE_EVIDENCE_BYTES} bytes`,
      });
    }
  }

  for (const directory of ["licenses", "media"] as const) {
    for (const bundledFile of await listBundledFiles(root, directory, issues)) {
      if (!declaredFiles.has(bundledFile)) {
        issues.push({
          code: "unlisted-file",
          path: bundledFile,
          message: "is not declared by manifest.json",
        });
      }
    }
  }

  return { manifest, issues: sortAndDedupeIssues(issues) };
}

export async function validateBundledAmbientAssetManifest(
  manifestPath: string,
): Promise<BundledAmbientAssetManifest> {
  const result = await inspectBundledAmbientAssetManifest(manifestPath);
  if (!result.manifest || result.issues.length > 0) {
    throw new BundledAmbientAssetValidationError(result.issues);
  }
  return result.manifest;
}
