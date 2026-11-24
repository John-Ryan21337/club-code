import * as fs from "node:fs";
import * as path from "node:path";
import { validateReleaseGitStorage } from "../../scripts/release-path-policy.mjs";

export function resolveReleaseRoot(input: {
  dirname: string;
  executablePath: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appImage?: string;
}): string {
  if (!input.isPackaged) return path.resolve(input.dirname, "../../..");
  if (input.platform === "linux" && input.appImage) return path.dirname(input.appImage);
  if (input.platform === "darwin") {
    const root = path.resolve(path.dirname(input.executablePath), "../../..");
    // Keep mutable state outside the signed bundle and out of shared Applications folders.
    // Packaged migration still requires a dedicated writable release directory.
    if (path.basename(root).toLowerCase() === "applications") {
      throw new Error(
        "Place Club Code in its own writable release folder inside Applications before starting it.",
      );
    }
    return root;
  }
  return path.dirname(input.executablePath);
}

export function prepareReleaseStorage(input: {
  root: string;
  homeDirectory: string;
  env: NodeJS.ProcessEnv;
}) {
  const root = fs.realpathSync(input.root);
  validateReleaseGitStorage(root);
  const baseDir = path.join(root, ".club-runtime");
  const env = input.env;
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (upper.startsWith("CAFE_CODE_") || upper === "T3_CODE_HOME") {
      if (key !== upper) {
        if (env[upper] !== undefined && env[upper] !== env[key]) {
          throw new Error(`Conflicting ${upper} overrides are not supported.`);
        }
        const value = env[key];
        delete env[key];
        env[upper] = value;
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
        "XDG_CACHE_HOME",
      ].includes(upper)
    ) {
      delete env[key];
    }
  }
  if (fs.existsSync(path.join(baseDir, "migration-in-progress.json"))) {
    throw new Error(
      "Club Code data migration is in progress. Finish migration before starting the application.",
    );
  }
  const contained = (target: string) => {
    const relative = path.relative(root, target);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  for (const name of [
    "CAFE_CODE_RELEASE_ROOT",
    "CAFE_CODE_HOME",
    "CAFE_CODE_BACKUPS_DIR",
    "CAFE_CODE_MANAGED_RUNTIME_ROOT",
    "CAFE_CODE_BUNDLED_NODE_DIR",
    "CAFE_CODE_BUNDLED_NPM_PATH",
    "CAFE_CODE_STARTUP_PROFILE_DIR",
    "CAFE_CODE_STARTUP_PROFILE_STOP_FILE",
    "T3_CODE_HOME",
  ]) {
    const value = env[name]?.trim();
    if (value && (!path.isAbsolute(value) || !contained(path.resolve(value)))) {
      throw new Error(`Club Code requires ${name} inside its release folder.`);
    }
  }
  if (env.CAFE_CODE_RELEASE_ROOT && path.resolve(env.CAFE_CODE_RELEASE_ROOT) !== root) {
    throw new Error("Club Code release folder does not match this application.");
  }
  if (env.CAFE_CODE_HOME && path.resolve(env.CAFE_CODE_HOME) !== baseDir) {
    throw new Error("Club Code data must use .club-runtime inside its release folder.");
  }
  const backupsDir = path.join(root, "backups");
  if (env.CAFE_CODE_BACKUPS_DIR && path.resolve(env.CAFE_CODE_BACKUPS_DIR) !== backupsDir) {
    throw new Error("Club Code backups must use the backups folder in its release folder.");
  }
  if (env.T3_CODE_HOME && path.relative(baseDir, path.resolve(env.T3_CODE_HOME)) !== "") {
    throw new Error("Club Code data must use .club-runtime inside its release folder.");
  }
  const stateDir = path.join(baseDir, env.CAFE_CODE_DESKTOP_DEV === "true" ? "dev" : "userdata");
  if (
    !fs.existsSync(path.join(stateDir, "state.sqlite")) &&
    fs.existsSync(path.join(input.homeDirectory, ".cafe-code", "userdata", "state.sqlite"))
  ) {
    throw new Error(
      "Existing Club Code data needs migration. Close Club Code and run scripts/migrate-release-state.mjs from this release folder.",
    );
  }
  const directories = {
    baseDir,
    backups: backupsDir,
    stateDir,
    temp: path.join(baseDir, "temp"),
    logs: path.join(stateDir, "logs"),
    crashDumps: path.join(baseDir, "crash-dumps"),
    cache: path.join(baseDir, "cache"),
    managed: path.join(baseDir, "managed"),
    corepack: path.join(baseDir, "cache", "corepack"),
    yarn: path.join(baseDir, "cache", "yarn"),
    npm: path.join(baseDir, "cache", "npm"),
    updates: path.join(baseDir, "cache", "updates"),
  };
  // Check each existing ancestor before creating a directory through it.
  for (const target of [
    ...Object.values(directories),
    path.join(directories.corepack, "package.json"),
    ...[
      env.CAFE_CODE_BUNDLED_NODE_DIR,
      env.CAFE_CODE_BUNDLED_NPM_PATH,
      env.CAFE_CODE_STARTUP_PROFILE_DIR,
      env.CAFE_CODE_STARTUP_PROFILE_STOP_FILE,
    ].filter((value): value is string => Boolean(value)),
  ]) {
    let ancestor = path.resolve(target);
    while (!fs.existsSync(ancestor)) {
      try {
        if (fs.lstatSync(ancestor).isSymbolicLink()) {
          throw new Error("Club Code storage cannot use an unresolved link.");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      ancestor = path.dirname(ancestor);
    }
    if (!contained(fs.realpathSync(ancestor)))
      throw new Error("Club Code storage cannot link outside its release folder.");
  }
  const corepackBoundary = path.join(directories.corepack, "package.json");
  if (fs.existsSync(corepackBoundary)) {
    try {
      const info = fs.statSync(corepackBoundary);
      if (!info.isFile() || info.size > 65_536) throw new Error();
      const config = JSON.parse(fs.readFileSync(corepackBoundary, "utf8"));
      if (
        !config ||
        typeof config !== "object" ||
        Array.isArray(config) ||
        (config.type !== undefined && config.type !== "commonjs")
      )
        throw new Error();
    } catch {
      throw new Error("Corepack cache package.json must use CommonJS.");
    }
  }
  try {
    for (const directory of Object.values(directories))
      fs.mkdirSync(directory, { recursive: true });
    const probe = path.join(baseDir, `.write-check-${process.pid}`);
    fs.writeFileSync(probe, "", { flag: "wx", mode: 0o600 });
    fs.unlinkSync(probe);
    if (!fs.existsSync(corepackBoundary)) {
      fs.writeFileSync(corepackBoundary, '{"type":"commonjs"}\n', { flag: "wx", mode: 0o600 });
    }
  } catch {
    throw new Error(
      "Club Code cannot write to its release folder. Move the release to a writable folder.",
    );
  }
  Object.assign(env, {
    CAFE_CODE_RELEASE_ROOT: root,
    CAFE_CODE_HOME: baseDir,
    CAFE_CODE_BACKUPS_DIR: directories.backups,
    CAFE_CODE_MANAGED_RUNTIME_ROOT: directories.managed,
    TEMP: directories.temp,
    TMP: directories.temp,
    TMPDIR: directories.temp,
    XDG_CACHE_HOME: directories.cache,
    COREPACK_HOME: directories.corepack,
    YARN_ENABLE_GLOBAL_CACHE: "false",
    YARN_CACHE_FOLDER: directories.yarn,
    npm_config_cache: directories.npm,
  });
  return directories;
}
