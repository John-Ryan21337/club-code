import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Exit from "effect/Exit";
import type * as Electron from "electron";
import { beforeEach, vi } from "vitest";

const {
  handleMock,
  onBeforeRequestMock,
  registerFileProtocolMock,
  registerSchemesAsPrivilegedMock,
  unhandleMock,
  unregisterProtocolMock,
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  onBeforeRequestMock: vi.fn(),
  registerFileProtocolMock: vi.fn(),
  registerSchemesAsPrivilegedMock: vi.fn(),
  unhandleMock: vi.fn(),
  unregisterProtocolMock: vi.fn(),
}));

vi.mock("electron", () => ({
  protocol: {
    handle: handleMock,
    registerFileProtocol: registerFileProtocolMock,
    registerSchemesAsPrivileged: registerSchemesAsPrivilegedMock,
    unhandle: unhandleMock,
    unregisterProtocol: unregisterProtocolMock,
  },
  session: {
    defaultSession: {
      webRequest: {
        onBeforeRequest: onBeforeRequestMock,
      },
    },
  },
}));

import * as ElectronProtocol from "./ElectronProtocol.ts";

describe("ElectronProtocol", () => {
  beforeEach(() => {
    registerFileProtocolMock.mockReset();
    registerSchemesAsPrivilegedMock.mockReset();
    handleMock.mockReset();
    onBeforeRequestMock.mockReset();
    unhandleMock.mockReset();
    unregisterProtocolMock.mockReset();
  });

  it("normalizes safe desktop protocol pathnames", () => {
    assert.equal(
      Option.getOrNull(ElectronProtocol.normalizeDesktopProtocolPathname("/settings/./general")),
      "settings/general",
    );
    assert.isTrue(Option.isNone(ElectronProtocol.normalizeDesktopProtocolPathname("/../secret")));
  });

  it.effect("registers desktop scheme privileges through a layer", () =>
    Effect.scoped(
      Layer.build(ElectronProtocol.layerSchemePrivileges).pipe(
        Effect.andThen(
          Effect.sync(() => {
            assert.deepEqual(registerSchemesAsPrivilegedMock.mock.calls, [
              [
                [
                  {
                    scheme: "cafecode",
                    privileges: {
                      standard: true,
                      secure: true,
                      supportFetchAPI: true,
                      corsEnabled: true,
                    },
                  },
                  {
                    scheme: "cafecode-media",
                    privileges: {
                      standard: true,
                      secure: true,
                      supportFetchAPI: true,
                      corsEnabled: true,
                      stream: true,
                    },
                  },
                ],
              ],
            ]);
          }),
        ),
      ),
    ),
  );

  it.effect("scopes response protocols and rejects requests from the wrong webContents", () =>
    Effect.gen(function* () {
      let capturedHandler: ((request: Request) => Promise<Response> | Response) | undefined;
      let capturedAuthorization:
        | ((
            details: { url: string; webContentsId?: number },
            callback: (response: { cancel: boolean }) => void,
          ) => void)
        | undefined;
      handleMock.mockImplementation((_scheme, handler) => {
        capturedHandler = handler;
      });
      onBeforeRequestMock.mockImplementation((_filter, listener) => {
        if (listener) capturedAuthorization = listener;
      });

      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
          yield* electronProtocol.registerResponseProtocol({
            scheme: "cafecode-media",
            handler: () =>
              Effect.succeed(
                new Response("stream", {
                  headers: { "Cache-Control": "no-store" },
                }),
              ),
            authorizeRequest: (_url, webContentsId) => webContentsId === 42,
          });

          assert.isDefined(capturedHandler);
          assert.isDefined(capturedAuthorization);
          let wrongOwner: { cancel: boolean } | undefined;
          capturedAuthorization?.(
            { url: "cafecode-media://stream/session", webContentsId: 7 },
            (result) => {
              wrongOwner = result;
            },
          );
          assert.deepEqual(wrongOwner, { cancel: true });
          return yield* Effect.promise(() =>
            Promise.resolve(
              capturedHandler?.(new Request("cafecode-media://stream/session")) ??
                new Response(null, { status: 500 }),
            ),
          );
        }),
      );

      assert.equal(yield* Effect.promise(() => response.text()), "stream");
      assert.deepEqual(unhandleMock.mock.calls, [["cafecode-media"]]);
      assert.equal(onBeforeRequestMock.mock.calls.at(-1)?.[1], null);
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it.effect("rolls back a protocol handler when authorization setup fails", () =>
    Effect.gen(function* () {
      handleMock.mockImplementation(() => undefined);
      onBeforeRequestMock.mockImplementation(() => {
        throw new Error("authorization setup failed");
      });

      const registration = Effect.scoped(
        Effect.gen(function* () {
          const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
          yield* electronProtocol.registerResponseProtocol({
            scheme: "cafecode-media",
            handler: () => Effect.succeed(new Response(null)),
            authorizeRequest: () => true,
          });
        }),
      );
      const exit = yield* Effect.exit(registration);

      assert.isTrue(Exit.isFailure(exit));
      assert.deepEqual(unhandleMock.mock.calls, [["cafecode-media"]]);
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it.effect("scopes registered file protocols", () =>
    Effect.gen(function* () {
      let capturedHandler:
        | ((
            request: Electron.ProtocolRequest,
            callback: (response: Electron.ProtocolResponse) => void,
          ) => void)
        | undefined;

      registerFileProtocolMock.mockImplementation((_scheme, handler) => {
        capturedHandler = handler;
        return true;
      });

      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
          yield* electronProtocol.registerFileProtocol({
            scheme: "cafecode",
            handler: () => Effect.succeed({ path: "/app/index.html" }),
          });

          assert.isDefined(capturedHandler);
          return yield* Effect.callback<Electron.ProtocolResponse>((resume) => {
            capturedHandler?.({ url: "cafecode://app/" } as Electron.ProtocolRequest, (response) =>
              resume(Effect.succeed(response)),
            );
          });
        }),
      );

      assert.deepEqual(response, { path: "/app/index.html" });
      assert.deepEqual(
        registerFileProtocolMock.mock.calls.map((call) => call[0]),
        ["cafecode"],
      );
      assert.deepEqual(unregisterProtocolMock.mock.calls, [["cafecode"]]);
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );
});
