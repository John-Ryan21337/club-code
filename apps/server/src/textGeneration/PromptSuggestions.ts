import type {
  OrchestrationThread,
  OrchestrationThreadShell,
  ThreadId,
  TurnId,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { TextGenerationShape } from "./TextGeneration.ts";

type Result = { suggestion: string | null };
const empty: Result = { suggestion: null };
const caches = new WeakMap<
  TextGenerationShape,
  { busy: number; results: Map<string, { contextHash: string; result: Result }> }
>();

export function canSuggestNextPrompt(thread: OrchestrationThreadShell, turnId: TurnId): boolean {
  return (
    thread.latestTurn?.turnId === turnId &&
    thread.latestTurn.state === "completed" &&
    thread.archivedAt === null &&
    thread.deletedAt === null &&
    thread.interactionMode !== "plan" &&
    thread.manualFollowUpCount === 0 &&
    thread.autoNudge.mode === "off" &&
    !thread.hasPendingApprovals &&
    !thread.hasPendingUserInput &&
    !thread.hasActionableProposedPlan &&
    thread.session?.status === "ready" &&
    thread.session.activeTurnId === null
  );
}

function detailIsCurrent(thread: OrchestrationThread, turnId: TurnId): boolean {
  return (
    thread.latestTurn?.turnId === turnId &&
    thread.latestTurn.state === "completed" &&
    thread.archivedAt === null &&
    thread.deletedAt === null &&
    thread.interactionMode !== "plan" &&
    thread.autoNudge.mode === "off" &&
    thread.manualFollowUps.length === 0 &&
    thread.goal?.status !== "active" &&
    thread.session?.status === "ready" &&
    thread.session.activeTurnId === null
  );
}

export function nextPromptContext(thread: OrchestrationThread): string | null {
  const messages = thread.messages.filter((message) => message.role !== "system").slice(-6);
  const last = messages.at(-1);
  if (
    !last ||
    last.role !== "assistant" ||
    last.streaming ||
    !last.text.trim() ||
    last.turnId !== thread.latestTurn?.turnId
  )
    return null;
  return JSON.stringify(messages.map(({ role, text }) => ({ role, text: text.slice(-2000) })));
}

/** A bounded cache belongs to the backend service, shared by all connected windows. */
export function suggestNextPrompt(input: {
  threadId: ThreadId;
  turnId: TurnId;
  cwd: string;
  textGeneration: TextGenerationShape;
  enabled: Effect.Effect<boolean, unknown>;
  readShell: () => Effect.Effect<Option.Option<OrchestrationThreadShell>, unknown>;
  readThread: () => Effect.Effect<Option.Option<OrchestrationThread>, unknown>;
}): Effect.Effect<Result> {
  return Effect.gen(function* () {
    if (!(yield* input.enabled)) return empty;
    const shell = yield* input.readShell();
    if (
      Option.isNone(shell) ||
      shell.value.id !== input.threadId ||
      !canSuggestNextPrompt(shell.value, input.turnId)
    )
      return empty;
    const generation = input.textGeneration.generateNextPrompt;
    if (!generation) return empty;
    const detail = yield* input.readThread();
    if (
      Option.isNone(detail) ||
      detail.value.id !== input.threadId ||
      !detailIsCurrent(detail.value, input.turnId) ||
      JSON.stringify(detail.value.modelSelection) !== JSON.stringify(shell.value.modelSelection)
    )
      return empty;
    const context = nextPromptContext(detail.value);
    if (!context || !(yield* input.enabled)) return empty;
    const contextHash = yield* Effect.promise(async () => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(context));
      return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    });
    let cache = caches.get(input.textGeneration);
    if (!cache) {
      cache = { busy: 0, results: new Map() };
      caches.set(input.textGeneration, cache);
    }
    const key = JSON.stringify([input.threadId, input.turnId, shell.value.modelSelection]);
    const cached = cache.results.get(key);
    if (cached) return cached.contextHash === contextHash ? cached.result : empty;
    if (cache.busy >= 2) return empty;
    // Reserve before I/O. Failed requests and reconnects must not repeat paid work.
    cache.results.set(key, { contextHash, result: empty });
    if (cache.results.size > 128) cache.results.delete(cache.results.keys().next().value!);
    cache.busy++;
    const currentCache = cache;
    return yield* Effect.gen(function* () {
      const before = yield* input.readShell();
      if (
        !(yield* input.enabled) ||
        Option.isNone(before) ||
        !canSuggestNextPrompt(before.value, input.turnId) ||
        JSON.stringify(before.value.modelSelection) !== JSON.stringify(shell.value.modelSelection)
      )
        return empty;
      const result = yield* generation({
        cwd: input.cwd,
        context,
        modelSelection: shell.value.modelSelection,
      });
      const latest = yield* input.readShell();
      const latestDetail = yield* input.readThread();
      if (
        !(yield* input.enabled) ||
        Option.isNone(latest) ||
        Option.isNone(latestDetail) ||
        latestDetail.value.id !== input.threadId ||
        !detailIsCurrent(latestDetail.value, input.turnId) ||
        JSON.stringify(latestDetail.value.modelSelection) !==
          JSON.stringify(shell.value.modelSelection) ||
        nextPromptContext(latestDetail.value) !== context ||
        !canSuggestNextPrompt(latest.value, input.turnId) ||
        JSON.stringify(latest.value.modelSelection) !== JSON.stringify(shell.value.modelSelection)
      )
        return empty;
      const suggestion = result.suggestion.trim();
      const response = suggestion.length > 0 && suggestion.length <= 500 ? { suggestion } : empty;
      currentCache.results.set(key, { contextHash, result: response });
      return response;
    }).pipe(
      Effect.timeout("30 seconds"),
      Effect.ensuring(
        Effect.sync(() => {
          currentCache.busy--;
        }),
      ),
    );
  }).pipe(Effect.catchCause(() => Effect.succeed(empty)));
}
