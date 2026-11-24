import {
  assertReleasePath,
  validateReleaseGitStorage as validateGitStorage,
} from "./release-path-policy.mjs";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const releaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export { assertReleasePath };
export function validateReleaseGitStorage(root = releaseRoot) {
  return validateGitStorage(root);
}

export function buildReleaseRuntimeEnv(environment, root = releaseRoot) {
  const canonicalRoot = realpathSync(root);
  validateReleaseGitStorage(canonicalRoot);
  const runtimeHome = join(canonicalRoot, ".club-runtime");
  const result = { ...environment };
  // Windows child processes deduplicate names without case sensitivity. Remove
  // inherited spelling variants before setting app-owned paths.
  for (const key of Object.keys(result)) {
    const upper = key.toUpperCase();
    if (upper.startsWith("CAFE_CODE_") || upper === "T3_CODE_HOME") {
      if (key !== upper) {
        if (result[upper] !== undefined && result[upper] !== result[key]) {
          throw new Error(`Conflicting ${upper} overrides are not supported.`);
        }
        result[upper] = result[key];
        delete result[key];
      }
    } else if (
      [
        "TEMP",
        "TMP",
        "TMPDIR",
        "COREPACK_HOME",
        "YARN_ENABLE_GLOBAL_CACHE",
        "YARN_CACHE_FOLDER",
        "NPM_CONFIG_CACHE",
      ].includes(upper)
    ) {
      delete result[key];
    }
  }
  const paths = {
    CAFE_CODE_RELEASE_ROOT: canonicalRoot,
    CAFE_CODE_HOME: runtimeHome,
    CAFE_CODE_BACKUPS_DIR: join(canonicalRoot, "backups"),
    CAFE_CODE_MANAGED_RUNTIME_ROOT: join(runtimeHome, "managed"),
  };
  for (const name of [
    ...Object.keys(paths),
    "CAFE_CODE_BUNDLED_NODE_DIR",
    "CAFE_CODE_BUNDLED_NPM_PATH",
    "T3_CODE_HOME",
  ]) {
    const value = result[name]?.trim();
    if (!value) continue;
    assertReleasePath(canonicalRoot, value, name);
    if (
      (name === "CAFE_CODE_HOME" || name === "T3_CODE_HOME") &&
      relative(runtimeHome, resolve(value)) !== ""
    ) {
      throw new Error(`${name} must use the release folder's .club-runtime directory.`);
    }
    if (name === "CAFE_CODE_RELEASE_ROOT" && relative(canonicalRoot, resolve(value)) !== "") {
      throw new Error("CAFE_CODE_RELEASE_ROOT must identify this Club Code release folder.");
    }
    if (
      name === "CAFE_CODE_BACKUPS_DIR" &&
      relative(join(canonicalRoot, "backups"), resolve(value)) !== ""
    ) {
      throw new Error("CAFE_CODE_BACKUPS_DIR must use the release folder's backups directory.");
    }
    if (name in paths) paths[name] = resolve(value);
  }
  Object.assign(result, paths, {
    TEMP: join(runtimeHome, "temp"),
    TMP: join(runtimeHome, "temp"),
    TMPDIR: join(runtimeHome, "temp"),
    COREPACK_HOME: join(runtimeHome, "cache", "corepack"),
    YARN_ENABLE_GLOBAL_CACHE: "false",
    YARN_CACHE_FOLDER: join(runtimeHome, "cache", "yarn"),
    npm_config_cache: join(runtimeHome, "cache", "npm"),
  });
  // Check each existing ancestor before creating directories through links.
  for (const candidate of [
    runtimeHome,
    result.TEMP,
    result.CAFE_CODE_MANAGED_RUNTIME_ROOT,
    result.COREPACK_HOME,
    result.YARN_CACHE_FOLDER,
    result.npm_config_cache,
  ]) {
    assertReleasePath(canonicalRoot, candidate, "Club Code runtime storage");
  }
  return result;
}

export function prepareReleaseCorepackCache(root, corepackHome) {
  const directory = assertReleasePath(root, corepackHome, "Corepack cache");
  const boundary = assertReleasePath(
    root,
    join(directory, "package.json"),
    "Corepack package boundary",
  );
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(boundary, '{"type":"commonjs"}\n', { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  try {
    if (!statSync(boundary).isFile() || statSync(boundary).size > 64 * 1024) throw new Error();
    const config = JSON.parse(readFileSync(boundary, "utf8"));
    if (
      typeof config !== "object" ||
      config === null ||
      Array.isArray(config) ||
      (config.type !== undefined && config.type !== "commonjs")
    )
      throw new Error();
  } catch {
    throw new Error(
      "Corepack cache package.json must use CommonJS. Fix that file before starting Club Code.",
    );
  }
}

export function prepareReleaseRuntime(
  environment = process.env,
  root = releaseRoot,
  legacyHome = join(homedir(), ".cafe-code"),
) {
  const result = buildReleaseRuntimeEnv(environment, root);
  if (existsSync(join(result.CAFE_CODE_HOME, "migration-in-progress.json"))) {
    throw new Error(
      "Club Code storage migration is incomplete. Run node scripts/migrate-release-state.mjs before starting Club Code.",
    );
  }
  if (
    !existsSync(join(result.CAFE_CODE_HOME, "userdata", "state.sqlite")) &&
    existsSync(join(legacyHome, "userdata", "state.sqlite"))
  ) {
    throw new Error(
      "Existing Club Code data needs migration. Close Club Code, then run node scripts/migrate-release-state.mjs before starting this release.",
    );
  }
  for (const directory of [
    result.CAFE_CODE_HOME,
    result.CAFE_CODE_BACKUPS_DIR,
    result.TEMP,
    result.CAFE_CODE_MANAGED_RUNTIME_ROOT,
    result.COREPACK_HOME,
    result.YARN_CACHE_FOLDER,
    result.npm_config_cache,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  // Corepack's Yarn bundles use CommonJS, even when the release is an ES module package.
  prepareReleaseCorepackCache(root, result.COREPACK_HOME);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = prepareReleaseRuntime();
  const names = [
    "CAFE_CODE_RELEASE_ROOT",
    "CAFE_CODE_HOME",
    "CAFE_CODE_BACKUPS_DIR",
    "CAFE_CODE_MANAGED_RUNTIME_ROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "COREPACK_HOME",
    "YARN_ENABLE_GLOBAL_CACHE",
    "YARN_CACHE_FOLDER",
    "npm_config_cache",
  ];
  const managed = Object.fromEntries(names.map((name) => [name, result[name]]));
  process.stdout.write(JSON.stringify(managed));
}
