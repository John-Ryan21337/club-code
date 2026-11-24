import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  assertReleasePath,
  buildReleaseRuntimeEnv,
  prepareReleaseRuntime,
  prepareReleaseCorepackCache,
  validateReleaseGitStorage,
} from "./release-runtime.mjs";

const fixtures = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "club-release-runtime-"));
  fixtures.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("release runtime storage", () => {
  it("runs cached CommonJS bundles below an ES module release without changing existing metadata", () => {
    const root = fixture();
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    const environment = prepareReleaseRuntime({}, root, fixture());
    const cache = environment.COREPACK_HOME;
    const boundary = join(cache, "package.json");
    assert.equal(JSON.parse(readFileSync(boundary, "utf8")).type, "commonjs");
    const probe = join(cache, "probe.js");
    writeFileSync(
      probe,
      'const { format } = require("node:util"); process.stdout.write(format("%s", "commonjs-ok"));',
    );
    assert.equal(
      execFileSync(process.execPath, [probe], {
        timeout: 5000,
        windowsHide: true,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      "commonjs-ok",
    );
    const existing = '{ "name": "preserve-existing-cache", "type": "commonjs" }\n';
    writeFileSync(boundary, existing);
    prepareReleaseCorepackCache(root, cache);
    assert.equal(readFileSync(boundary, "utf8"), existing);
  });

  it("refuses conflicting or malformed Corepack boundaries without overwriting them", () => {
    const root = fixture();
    const cache = join(root, "cache");
    mkdirSync(cache);
    const boundary = join(cache, "package.json");
    for (const existing of ['{"type":"module"}', "{invalid", "[]"]) {
      writeFileSync(boundary, existing);
      assert.throws(() => prepareReleaseCorepackCache(root, cache), /must use CommonJS/);
      assert.equal(readFileSync(boundary, "utf8"), existing);
    }
  });
  it("requires migration before the headless launcher can open an empty replacement profile", () => {
    const root = fixture();
    const legacyHome = fixture();
    mkdirSync(join(legacyHome, "userdata"));
    writeFileSync(join(legacyHome, "userdata", "state.sqlite"), "fixture");
    assert.throws(() => prepareReleaseRuntime({}, root, legacyHome), /needs migration/);
    mkdirSync(join(root, ".club-runtime", "userdata"), { recursive: true });
    writeFileSync(join(root, ".club-runtime", "userdata", "state.sqlite"), "fixture");
    assert.equal(
      prepareReleaseRuntime({}, root, legacyHome).CAFE_CODE_HOME,
      join(root, ".club-runtime"),
    );
    writeFileSync(join(root, ".club-runtime", "migration-in-progress.json"), "{}");
    assert.throws(() => prepareReleaseRuntime({}, root, legacyHome), /incomplete/);
  });

  it("checks explicit log paths against junctions and sibling prefix collisions", () => {
    const root = fixture();
    const outside = fixture();
    assert.equal(assertReleasePath(root, join(root, "logs")), join(root, "logs"));
    assert.throws(() => assertReleasePath(root, `${root}-other`), /inside/);
    symlinkSync(outside, join(root, "logs"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => assertReleasePath(root, join(root, "logs", "new")), /outside/);
  });
  it("keeps application state, temporary files, and package caches inside each release", () => {
    const root = fixture();
    const result = buildReleaseRuntimeEnv({ TEMP: "external", PATH: "system-tools" }, root);
    assert.equal(result.CAFE_CODE_HOME, join(root, ".club-runtime"));
    assert.equal(result.TEMP, join(root, ".club-runtime", "temp"));
    assert.equal(result.TMP, result.TEMP);
    assert.equal(result.TMPDIR, result.TEMP);
    assert.equal(result.CAFE_CODE_MANAGED_RUNTIME_ROOT, join(root, ".club-runtime", "managed"));
    assert.equal(result.YARN_ENABLE_GLOBAL_CACHE, "false");
    assert.equal(result.npm_config_cache, join(root, ".club-runtime", "cache", "npm"));
    assert.equal(result.PATH, "system-tools");
  });

  it("rejects external and ambiguous app-owned overrides", () => {
    const root = fixture();
    const outside = fixture();
    for (const name of [
      "CAFE_CODE_HOME",
      "CAFE_CODE_RELEASE_ROOT",
      "T3_CODE_HOME",
      "CAFE_CODE_MANAGED_RUNTIME_ROOT",
      "CAFE_CODE_BUNDLED_NODE_DIR",
      "CAFE_CODE_BUNDLED_NPM_PATH",
    ]) {
      assert.throws(() => buildReleaseRuntimeEnv({ [name]: outside }, root), /release folder/);
      assert.throws(() => buildReleaseRuntimeEnv({ [name]: "relative" }, root), /release folder/);
    }
  });

  it("cannot escape through case variants in inherited Windows environment names", () => {
    const root = fixture();
    assert.throws(
      () => buildReleaseRuntimeEnv({ cafe_code_home: fixture() }, root),
      /release folder/,
    );
    const result = buildReleaseRuntimeEnv({ NPM_CONFIG_CACHE: "external", Temp: "external" }, root);
    assert.equal(result.NPM_CONFIG_CACHE, undefined);
    assert.equal(result.Temp, undefined);
    assert.equal(result.npm_config_cache, join(root, ".club-runtime", "cache", "npm"));
  });

  it("rejects runtime junctions that escape the release", () => {
    const root = fixture();
    const outside = fixture();
    symlinkSync(
      outside,
      join(root, ".club-runtime"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(() => buildReleaseRuntimeEnv({}, root), /outside the release/);
  });

  it("accepts local managed overrides and rejects linked cache ancestors", () => {
    const root = fixture();
    const outside = fixture();
    const managed = join(root, "managed-tools");
    assert.equal(
      buildReleaseRuntimeEnv({ CAFE_CODE_MANAGED_RUNTIME_ROOT: managed }, root)
        .CAFE_CODE_MANAGED_RUNTIME_ROOT,
      managed,
    );
    mkdirSync(join(root, ".club-runtime"));
    symlinkSync(
      outside,
      join(root, ".club-runtime", "cache"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(() => buildReleaseRuntimeEnv({}, root), /outside the release/);
  });
});

describe("release Git storage", () => {
  it("permits packaged releases without Git and standalone local Git metadata", () => {
    const root = fixture();
    validateReleaseGitStorage(root);
    mkdirSync(join(root, ".git", "objects"), { recursive: true });
    validateReleaseGitStorage(root);
  });

  it("permits internal Git pointers and rejects external pointers", () => {
    const root = fixture();
    const outside = fixture();
    mkdirSync(join(root, "metadata", "objects"), { recursive: true });
    writeFileSync(join(root, ".git"), "gitdir: metadata\n");
    validateReleaseGitStorage(root);
    writeFileSync(join(root, ".git"), `gitdir: ${outside}\n`);
    assert.throws(() => validateReleaseGitStorage(root), /standalone checkout/);
  });

  it("permits an internal common directory and rejects an external common directory", () => {
    const root = fixture();
    const outside = fixture();
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "common", "objects"), { recursive: true });
    writeFileSync(join(root, ".git", "commondir"), "../common\n");
    validateReleaseGitStorage(root);
    writeFileSync(join(root, ".git", "commondir"), outside);
    assert.throws(() => validateReleaseGitStorage(root), /standalone checkout/);
  });

  it("checks object alternate chains including nested external stores", () => {
    const root = fixture();
    const outside = fixture();
    const objects = join(root, ".git", "objects");
    const alternateObjects = join(root, "shared-objects");
    mkdirSync(join(objects, "info"), { recursive: true });
    mkdirSync(join(alternateObjects, "info"), { recursive: true });
    writeFileSync(join(objects, "info", "alternates"), "../../shared-objects\n");
    validateReleaseGitStorage(root);
    writeFileSync(join(alternateObjects, "info", "alternates"), outside);
    assert.throws(() => validateReleaseGitStorage(root), /standalone checkout/);
  });
});
