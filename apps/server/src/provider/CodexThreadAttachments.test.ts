import { AuthSessionId, type AuthClientSession } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import { CodexAppServerRequestError } from "effect-codex-app-server/errors";
import type { CodexAppServerClientShape } from "effect-codex-app-server/client";
import { expect, it, vi } from "vitest";
import { runCodexThreadAttachments, withCodexAttachmentOwner } from "./CodexThreadAttachments.ts";

const sessionId = AuthSessionId.make("owner-1");
const owner = {
  sessionId,
  role: "owner",
  expiresAt: DateTime.makeUnsafe(Date.now() + 60_000),
} as AuthClientSession;

it.each(
  (
    [
      [],
      [{ ...owner, role: "client" }],
      [{ ...owner, expiresAt: DateTime.makeUnsafe(0) }],
      [{ ...owner, sessionId: AuthSessionId.make("someone-else") }],
    ] satisfies AuthClientSession[][]
  ).map((sessions) => ({ sessions })),
)("denies absent, paired, expired, or other owner authority", async ({ sessions }) => {
  const perform = vi.fn(() => "private result");
  await expect(
    Effect.runPromise(
      withCodexAttachmentOwner({
        sessionId,
        listSessions: Effect.succeed(sessions),
        operation: Effect.sync(perform),
      }),
    ),
  ).rejects.toMatchObject({
    _tag: "CodexThreadAttachmentsError",
    detail: "An active owner session is required.",
  });
  expect(perform).not.toHaveBeenCalled();
});

it("rechecks authority after the provider returns", async () => {
  let sessions = [owner];
  const stopVoice = vi.fn();
  await expect(
    Effect.runPromise(
      withCodexAttachmentOwner({
        sessionId,
        listSessions: Effect.sync(() => sessions),
        operation: Effect.sync(() => {
          sessions = [];
          return "private result";
        }),
        onInvalidated: Effect.sync(stopVoice),
      }),
    ),
  ).rejects.toThrow();
  expect(stopVoice).toHaveBeenCalledOnce();
});

it("uses only the resolved native thread, bounded pages, and stable removal identity", async () => {
  const request = vi.fn(() => Effect.succeed({ data: [], nextCursor: "next" }));
  const client = { request } as unknown as Pick<CodexAppServerClientShape, "request">;
  expect(
    await Effect.runPromise(
      runCodexThreadAttachments(client, "native-thread", { kind: "list", cursor: "cursor" }),
    ),
  ).toEqual({ data: [], nextCursor: "next" });
  expect(request).toHaveBeenCalledWith("thread/attachment/list", {
    threadId: "native-thread",
    limit: 20,
    cursor: "cursor",
  });
  await Effect.runPromise(
    runCodexThreadAttachments(client, "native-thread", {
      kind: "remove",
      attachmentType: "note",
      identityKey: "key",
    }),
  );
  expect(request).toHaveBeenLastCalledWith("thread/attachment/remove", {
    threadId: "native-thread",
    attachmentType: "note",
    identityKey: "key",
  });
});

it("rejects invalid JSON before mutation and refuses oversized provider records", async () => {
  const request = vi.fn(() =>
    Effect.succeed({
      data: [
        {
          id: "a",
          attachmentType: "note",
          identityKey: "key",
          payload: "x".repeat(16_384),
          createdAt: 0,
        },
      ],
      nextCursor: null,
    }),
  );
  const client = { request } as unknown as Pick<CodexAppServerClientShape, "request">;
  await expect(
    Effect.runPromise(
      runCodexThreadAttachments(client, "native", {
        kind: "add",
        attachmentType: "note",
        identityKey: "key",
        payloadJson: "{",
      }),
    ),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  await expect(
    Effect.runPromise(runCodexThreadAttachments(client, "native", { kind: "list" })),
  ).rejects.toThrow();
});

it("preserves existing attachment responses without pretending to overwrite them", async () => {
  const request = vi.fn(() =>
    Effect.succeed({
      outcome: "existing",
      attachment: {
        id: "a",
        attachmentType: "note",
        identityKey: "key",
        payload: { text: "saved" },
        createdAt: 0,
      },
    }),
  );
  const client = { request } as unknown as Pick<CodexAppServerClientShape, "request">;
  const result = await Effect.runPromise(
    runCodexThreadAttachments(client, "native", {
      kind: "add",
      attachmentType: "note",
      identityKey: "key",
      payloadJson: '{"text":"new"}',
    }),
  );
  expect(result.data[0]?.payloadJson).toBe('{"text":"saved"}');
});

it("keeps private provider failures and malformed payloads out of error diagnostics", async () => {
  const client = {
    request: () =>
      Effect.fail(
        new CodexAppServerRequestError({
          code: -32000,
          errorMessage: "private-provider-content",
          data: { token: "private-provider-content" },
        }),
      ),
  } as unknown as Pick<CodexAppServerClientShape, "request">;
  const operations = [
    runCodexThreadAttachments(client, "native", { kind: "list" }),
    runCodexThreadAttachments(client, "native", {
      kind: "add",
      attachmentType: "note",
      identityKey: "key",
      payloadJson: '{"private-provider-content":',
    }),
  ];
  for (const operation of operations) {
    const result = await Effect.runPromise(Effect.exit(operation));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result))
      expect(Cause.pretty(result.cause)).not.toContain("private-provider-content");
  }
});
