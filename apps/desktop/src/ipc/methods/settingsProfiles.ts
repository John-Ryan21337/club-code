import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Random from "effect/Random";
import * as Semaphore from "effect/Semaphore";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

// A fixed, local file. The renderer cannot choose a filesystem path.
const ProfileDocument = Schema.String.check(
  Schema.isMaxLength(2 * 1024 * 1024),
  Schema.makeFilter((raw) => {
    try {
      const value = JSON.parse(raw);
      return (
        Number.isInteger(value.version) &&
        value.version >= 1 &&
        value.version <= 5 &&
        Array.isArray(value.profiles) &&
        value.profiles.length <= 32
      );
    } catch {
      return false;
    }
  }),
);
const profileWrites = Semaphore.makeUnsafe(1);
function isFutureProfileDocument(raw: string): boolean {
  try {
    return JSON.parse(raw)?.version > 5;
  } catch {
    return false;
  }
}

export const getSettingsProfileLibrary = makeIpcMethod({
  channel: "desktop:get-settings-profile-library",
  payload: Schema.Void,
  result: Schema.NullOr(ProfileDocument),
  handler: Effect.fn("desktop.profiles.read")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(environment.stateDir, "settings-profiles.json");
    if (!(yield* fs.exists(file))) return null;
    const raw = yield* fs.readFileString(file);
    if (Schema.is(ProfileDocument)(raw)) return raw;
    if (isFutureProfileDocument(raw))
      return yield* Effect.fail(new Error("This profile library requires a newer app version."));
    const previousFile = `${file}.previous`;
    if (yield* fs.exists(previousFile)) {
      const previous = yield* fs.readFileString(previousFile);
      if (Schema.is(ProfileDocument)(previous)) return previous;
    }
    return yield* Effect.fail(
      new Error("The profile library and its previous copy could not be read."),
    );
  }),
});

export const setSettingsProfileLibrary = makeIpcMethod({
  channel: "desktop:set-settings-profile-library",
  payload: ProfileDocument,
  result: Schema.Void,
  handler: Effect.fn("desktop.profiles.write")(function* (document) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(environment.stateDir, "settings-profiles.json");
    const temporary = `${file}.${yield* Random.nextUUIDv4}.tmp`;
    yield* fs.makeDirectory(environment.stateDir, { recursive: true });
    if (yield* fs.exists(file)) {
      const previous = yield* fs.readFileString(file);
      if (previous === document) return;
      if (isFutureProfileDocument(previous))
        return yield* Effect.fail(new Error("This profile library requires a newer app version."));
      yield* fs.writeFileString(
        `${file}.${Schema.is(ProfileDocument)(previous) ? "previous" : "damaged"}`,
        previous,
        { mode: 0o600 },
      );
    }
    yield* fs.writeFileString(temporary, document, { mode: 0o600 });
    yield* fs
      .rename(temporary, file)
      .pipe(Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)));
  }, profileWrites.withPermits(1)),
});
