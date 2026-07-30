import {
  EnvironmentId,
  EventId,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@cafecode/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  MATRIX_ACTIVITY_LINK_PULSE_MS,
  MATRIX_ACTIVITY_MAX_CORRELATION_MS,
  MATRIX_ACTIVITY_TERMINAL_FADE_MS,
  MATRIX_ACTIVITY_TTL_MS,
  MAX_MATRIX_ACTIVITY_ENCODED_CHARS,
  MAX_MATRIX_ACTIVITY_EVENTS,
  MAX_MATRIX_ACTIVITY_LINKS,
  createMatrixActivityAnimationState,
  createMatrixHexRoute,
  decodeMatrixActivityEvents,
  deriveMatrixActivityEvents,
  drawMatrixActivityAnimation,
  encodeMatrixActivityEvents,
  matrixHexRoutePointAt,
  resolveMatrixActivityTerm,
  selectMatrixActivityEventsKey,
  updateMatrixActivityAnimationInPlace,
} from "./matrixActivityOverlay";
import type { AppState } from "./store";
import {
  createAtmosphereScene,
  createSeededRandom,
  resolveMatrixStreamColor,
  type MatrixColorFrame,
} from "./windowAtmosphere";

function activity(
  id: string,
  createdAt: string,
  payload: Record<string, unknown>,
  kind = "tool.completed",
  turnId: TurnId | null = TurnId.make("turn-matrix-activity"),
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "tool",
    kind,
    summary: "This summary is never projected",
    payload,
    turnId,
    createdAt,
  };
}

function angleClass(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return ((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 360) % 180;
}

const UNIFORM_MATRIX_FRAME: MatrixColorFrame = {
  color: "hsl(90.0 88.0% 62.0%)",
  perStream: false,
  baseHue: 90,
  saturation: 88,
  lightness: 62,
};

const PER_STREAM_MATRIX_FRAME: MatrixColorFrame = {
  color: "hsl(210.0 88.0% 62.0%)",
  perStream: true,
  baseHue: 210,
  saturation: 88,
  lightness: 62,
};

interface RecordedGradient {
  readonly coordinates: readonly [number, number, number, number];
  readonly stops: Array<readonly [number, string]>;
  addColorStop(offset: number, color: string): void;
}

interface RecordedCanvasDraw {
  readonly alpha: number;
  readonly kind: "fill" | "stroke" | "text";
  readonly lineWidth: number;
  readonly style: string | RecordedGradient;
  readonly text?: string;
}

function createRecordingContext(): {
  readonly context: CanvasRenderingContext2D;
  readonly draws: RecordedCanvasDraw[];
  readonly gradients: RecordedGradient[];
} {
  const draws: RecordedCanvasDraw[] = [];
  const gradients: RecordedGradient[] = [];
  const context = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clip: vi.fn(),
    createLinearGradient: vi.fn((x0: number, y0: number, x1: number, y1: number) => {
      const gradient: RecordedGradient = {
        coordinates: [x0, y0, x1, y1],
        stops: [],
        addColorStop(offset, color) {
          this.stops.push([offset, color]);
        },
      };
      gradients.push(gradient);
      return gradient;
    }),
    fill: vi.fn(
      function (this: {
        fillStyle: string | RecordedGradient;
        globalAlpha: number;
        lineWidth: number;
      }) {
        draws.push({
          alpha: this.globalAlpha,
          kind: "fill",
          lineWidth: this.lineWidth,
          style: this.fillStyle,
        });
      },
    ),
    fillStyle: "",
    fillText: vi.fn(function (
      this: {
        fillStyle: string | RecordedGradient;
        globalAlpha: number;
        lineWidth: number;
      },
      text: string,
    ) {
      draws.push({
        alpha: this.globalAlpha,
        kind: "text",
        lineWidth: this.lineWidth,
        style: this.fillStyle,
        text,
      });
    }),
    font: "",
    globalAlpha: 1,
    lineCap: "",
    lineTo: vi.fn(),
    lineWidth: 1,
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(
      function (this: {
        globalAlpha: number;
        lineWidth: number;
        strokeStyle: string | RecordedGradient;
      }) {
        draws.push({
          alpha: this.globalAlpha,
          kind: "stroke",
          lineWidth: this.lineWidth,
          style: this.strokeStyle,
        });
      },
    ),
    strokeStyle: "",
    textAlign: "",
    textBaseline: "",
  } as unknown as CanvasRenderingContext2D;
  return { context, draws, gradients };
}

describe("Matrix provider activity overlay", () => {
  it("accepts production provider lifecycle categories and retains no sensitive source text", () => {
    const events = deriveMatrixActivityEvents([
      activity("network-1", "2026-07-23T12:00:00.000Z", {
        itemType: "web_search",
        itemId: "tool-network",
        detail: "curl https://user:password@example.test/private?token=hunter2",
      }),
      activity("database-1", "2026-07-23T12:00:00.100Z", {
        itemType: "command_execution",
        itemId: "tool-database",
        title: "SQLite database query",
        detail: "SELECT secret_value FROM credentials",
        observed: {
          providerObserved: true,
          operation: "query",
        },
      }),
      activity("build-1", "2026-07-23T12:00:00.200Z", {
        itemType: "command_execution",
        itemId: "tool-build",
        title: "Compile bundle",
        observed: {
          providerObserved: true,
          operation: "compile",
        },
      }),
      activity("freeform-only", "2026-07-23T12:00:00.250Z", {
        itemType: "command_execution",
        itemId: "must-not-classify",
        title: "build database network",
        detail: "SELECT secret FROM private_url",
      }),
      activity("false-attestation", "2026-07-23T12:00:00.260Z", {
        itemType: "command_execution",
        itemId: "must-not-classify-false",
        observed: { providerObserved: false, activityType: "build" },
      }),
      activity("missing-attestation", "2026-07-23T12:00:00.270Z", {
        itemType: "command_execution",
        itemId: "must-not-classify-missing",
        observed: { activityType: "database" },
      }),
      activity("conflicting-attestation", "2026-07-23T12:00:00.280Z", {
        itemType: "web_search",
        itemId: "must-not-classify-conflict",
        observed: { providerObserved: true, activityType: "database" },
      }),
      activity("operation-phrase", "2026-07-23T12:00:00.285Z", {
        itemType: "command_execution",
        itemId: "must-not-classify-operation-phrase",
        observed: { providerObserved: true, operation: "please network now" },
      }),
      activity("request-phrase", "2026-07-23T12:00:00.290Z", {
        itemType: "command_execution",
        itemId: "must-not-classify-request-phrase",
        requestType: "build operation",
      }),
      activity(
        "fake-1",
        "2026-07-23T12:00:00.300Z",
        { title: "build database network", itemId: "fake" },
        "runtime.note",
      ),
    ]);

    expect(events.map((event) => event.category)).toEqual(["network", "database", "build"]);
    const encoded = encodeMatrixActivityEvents(events);
    expect(encoded).not.toMatch(
      /curl|password|example|token|hunter2|SELECT|secret|credential|tool-network|turn-matrix/iu,
    );
    expect(decodeMatrixActivityEvents(encoded)).toEqual(events);
    expect(decodeMatrixActivityEvents("[".repeat(MAX_MATRIX_ACTIVITY_ENCODED_CHARS + 1))).toEqual(
      [],
    );
  });

  it("filters activity categories before encoding and permits all inputs to be unchecked", () => {
    const activities = [
      activity("network-filter", "2026-07-23T12:00:00.000Z", {
        itemType: "web_search",
        itemId: "network-filter-tool",
      }),
      activity("database-filter", "2026-07-23T12:00:00.100Z", {
        itemType: "command_execution",
        itemId: "database-filter-tool",
        observed: { providerObserved: true, activityType: "database" },
      }),
      activity("build-filter", "2026-07-23T12:00:00.200Z", {
        itemType: "command_execution",
        itemId: "build-filter-tool",
        observed: { providerObserved: true, activityType: "build" },
      }),
    ];

    expect(
      deriveMatrixActivityEvents(activities, {
        network: true,
        database: false,
        build: true,
      }).map((event) => event.category),
    ).toEqual(["network", "build"]);
    expect(
      encodeMatrixActivityEvents(
        deriveMatrixActivityEvents(activities, {
          network: false,
          database: false,
          build: false,
        }),
      ),
    ).toBe("[]");
    const unreadableActivities = new Proxy(activities, {
      get() {
        throw new Error("disabled inputs must not inspect retained activity");
      },
    });
    expect(
      deriveMatrixActivityEvents(unreadableActivities, {
        network: false,
        database: false,
        build: false,
      }),
    ).toEqual([]);
    expect(deriveMatrixActivityEvents(activities).map((event) => event.category)).toEqual([
      "network",
      "database",
      "build",
    ]);
  });

  it("selects only the routed thread and preserves its ready-state completion tail", () => {
    const selectedEnvironmentId = EnvironmentId.make("environment-selected");
    const activeEnvironmentId = EnvironmentId.make("environment-active-elsewhere");
    const selectedThreadId = ThreadId.make("thread-selected");
    const backgroundThreadId = ThreadId.make("thread-background");
    const selected = activity("selected", "2026-07-23T12:00:00.000Z", {
      itemType: "web_search",
      itemId: "selected-tool",
    });
    const background = activity("background", "2026-07-23T12:00:00.100Z", {
      itemType: "command_execution",
      itemId: "background-tool",
      observed: { providerObserved: true, activityType: "build" },
    });
    const collision = activity("collision", "2026-07-23T12:00:00.200Z", {
      itemType: "command_execution",
      itemId: "collision-tool",
      observed: { providerObserved: true, activityType: "database" },
    });
    const state = {
      activeEnvironmentId,
      environmentStateById: {
        [selectedEnvironmentId]: {
          activityIdsByThreadId: {
            [selectedThreadId]: [selected.id],
            [backgroundThreadId]: [background.id],
          },
          activityByThreadId: {
            [selectedThreadId]: { [selected.id]: selected },
            [backgroundThreadId]: { [background.id]: background },
          },
          threadSessionById: {
            [selectedThreadId]: { status: "ready" },
            [backgroundThreadId]: { status: "running" },
          },
        },
        [activeEnvironmentId]: {
          activityIdsByThreadId: { [selectedThreadId]: [collision.id] },
          activityByThreadId: { [selectedThreadId]: { [collision.id]: collision } },
        },
      },
    } as unknown as AppState;

    const events = decodeMatrixActivityEvents(
      selectMatrixActivityEventsKey(state, {
        environmentId: selectedEnvironmentId,
        threadId: selectedThreadId,
      }),
    );

    expect(events.map((event) => event.category)).toEqual(["network"]);
    expect(
      decodeMatrixActivityEvents(
        selectMatrixActivityEventsKey(
          state,
          {
            environmentId: selectedEnvironmentId,
            threadId: selectedThreadId,
          },
          { network: false, database: false, build: false },
        ),
      ),
    ).toEqual([]);
    const unreadableState = new Proxy({} as AppState, {
      getOwnPropertyDescriptor() {
        throw new Error("disabled inputs must not inspect routed thread state");
      },
    });
    expect(
      selectMatrixActivityEventsKey(
        unreadableState,
        {
          environmentId: selectedEnvironmentId,
          threadId: selectedThreadId,
        },
        { network: false, database: false, build: false },
      ),
    ).toBe("[]");
    expect(selectMatrixActivityEventsKey(state, null)).toBe("");
  });

  it("correlates a selected-thread lifecycle across more than 160 unrelated retained rows", () => {
    const environmentId = EnvironmentId.make("environment-long-lifecycle");
    const threadId = ThreadId.make("thread-long-lifecycle");
    const now = Date.parse("2026-07-23T12:10:00.000Z");
    const start = activity(
      "long-lifecycle-start",
      new Date(now - 60_000).toISOString(),
      {
        itemType: "command_execution",
        itemId: "long-lifecycle-tool",
        observed: { providerObserved: true, activityType: "build" },
      },
      "tool.started",
    );
    const unrelated = Array.from({ length: 200 }, (_, index) =>
      activity(
        `unrelated-${index}`,
        new Date(now - 59_000 + index).toISOString(),
        {
          detail: `unclassified provider row ${index}`,
          itemId: `unrelated-tool-${index}`,
        },
        "runtime.note",
      ),
    );
    const completed = activity("long-lifecycle-completed", new Date(now).toISOString(), {
      itemType: "command_execution",
      itemId: "long-lifecycle-tool",
      observed: { providerObserved: true, activityType: "build" },
    });
    const retained = [start, ...unrelated, completed];
    const state = {
      environmentStateById: {
        [environmentId]: {
          activityIdsByThreadId: {
            [threadId]: retained.map((entry) => entry.id),
          },
          activityByThreadId: {
            [threadId]: Object.fromEntries(retained.map((entry) => [entry.id, entry])),
          },
        },
      },
    } as unknown as AppState;

    const events = decodeMatrixActivityEvents(
      selectMatrixActivityEventsKey(state, { environmentId, threadId }),
    );
    const animation = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(animation, events, now, 160, false);

    expect(events).toHaveLength(2);
    expect(animation.linkCount).toBe(1);
    expect(animation.links[0]).toMatchObject({ category: "build" });
  });

  it("fails closed for prototype-key routes and malformed route state", () => {
    const environmentId = EnvironmentId.make("environment-safe");
    const threadId = ThreadId.make("thread-safe");
    const state = {
      environmentStateById: {
        [environmentId]: {
          activityIdsByThreadId: {},
          activityByThreadId: {},
        },
      },
    } as unknown as AppState;

    for (const prototypeKey of ["__proto__", "constructor"] as const) {
      expect(
        selectMatrixActivityEventsKey(state, {
          environmentId: EnvironmentId.make(prototypeKey),
          threadId,
        }),
      ).toBe("");
      expect(
        selectMatrixActivityEventsKey(state, {
          environmentId,
          threadId: ThreadId.make(prototypeKey),
        }),
      ).toBe("");
    }

    const inheritedRoute = Object.create({
      environmentId,
      threadId,
    }) as { environmentId: EnvironmentId; threadId: ThreadId };
    expect(selectMatrixActivityEventsKey(state, inheritedRoute)).toBe("");
    expect(selectMatrixActivityEventsKey(null as unknown as AppState, inheritedRoute)).toBe("");
  });

  it("scopes exact relation hashes to one provider turn and fails closed without a turn", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const firstTurn = TurnId.make("turn-first");
    const secondTurn = TurnId.make("turn-second");
    const crossTurn = deriveMatrixActivityEvents([
      activity(
        "turn-a",
        new Date(now - 100).toISOString(),
        { itemType: "build", itemId: "provider-reused-id" },
        "tool.started",
        firstTurn,
      ),
      activity(
        "turn-b",
        new Date(now - 50).toISOString(),
        { itemType: "build", itemId: "provider-reused-id" },
        "tool.completed",
        secondTurn,
      ),
    ]);
    expect(crossTurn[0]?.relationHashes).not.toEqual(crossTurn[1]?.relationHashes);

    const state = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(state, crossTurn, now, 160, false);
    expect(state.linkCount).toBe(0);

    const unscoped = deriveMatrixActivityEvents([
      activity(
        "turnless",
        new Date(now - 25).toISOString(),
        { itemType: "build", itemId: "provider-item" },
        "tool.completed",
        null,
      ),
    ]);
    expect(unscoped[0]?.relationHashes).toEqual([]);
  });

  it("uses unambiguous exact relation identities without trimming provider IDs", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const delimiterAmbiguity = deriveMatrixActivityEvents([
      activity(
        "delimiter-a",
        new Date(now - 100).toISOString(),
        { itemType: "build", itemId: "x:tool:y" },
        "tool.started",
        TurnId.make("a"),
      ),
      activity(
        "delimiter-b",
        new Date(now - 50).toISOString(),
        { itemType: "build", itemId: "y" },
        "tool.completed",
        TurnId.make("a:tool:x"),
      ),
    ]);
    expect(delimiterAmbiguity[0]?.relationHashes).not.toEqual(
      delimiterAmbiguity[1]?.relationHashes,
    );

    const exactIdentity = deriveMatrixActivityEvents([
      activity(
        "exact-a",
        new Date(now - 40).toISOString(),
        { itemType: "build", itemId: "provider-item" },
        "tool.started",
      ),
      activity(
        "exact-b",
        new Date(now - 20).toISOString(),
        { itemType: "build", itemId: " provider-item " },
        "tool.completed",
      ),
    ]);
    expect(exactIdentity[0]?.relationHashes).toHaveLength(1);
    expect(exactIdentity[1]?.relationHashes).toEqual([]);

    const animation = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(animation, delimiterAmbiguity, now, 160, false);
    expect(animation.linkCount).toBe(0);
    updateMatrixActivityAnimationInPlace(animation, exactIdentity, now, 160, false);
    expect(animation.linkCount).toBe(0);
  });

  it("draws links only for explicit shared relations and bounds expiry/rate", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const unrelated = deriveMatrixActivityEvents([
      activity("a", "2026-07-23T12:00:00.900Z", {
        itemType: "build",
        itemId: "tool-a",
      }),
      activity("b", "2026-07-23T12:00:00.950Z", {
        requestKind: "compile",
        itemId: "tool-b",
      }),
    ]);
    const state = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(state, unrelated, now, 20, false);
    expect(state.pulseCount).toBe(2);
    expect(state.linkCount).toBe(0);
    expect(state.pulses.slice(0, state.pulseCount).map((pulse) => pulse.semanticRole)).toEqual([
      "category",
      "category",
    ]);

    const weaklyRelated = deriveMatrixActivityEvents([
      activity("agent-a", "2026-07-23T12:00:00.900Z", {
        itemType: "build",
        observed: {
          providerObserved: true,
          agentId: "shared-agent",
          operation: "compile",
        },
      }),
      activity("agent-b", "2026-07-23T12:00:00.950Z", {
        itemType: "build",
        observed: {
          providerObserved: true,
          agentId: "shared-agent",
          operation: "compile",
        },
      }),
    ]);
    updateMatrixActivityAnimationInPlace(state, weaklyRelated, now, 160, false);
    expect(state.linkCount).toBe(0);

    const crossCategory = deriveMatrixActivityEvents([
      activity("cross-a", "2026-07-23T12:00:00.900Z", {
        itemType: "build",
        itemId: "shared-cross-category-tool",
      }),
      activity("cross-b", "2026-07-23T12:00:00.950Z", {
        itemType: "web_search",
        itemId: "shared-cross-category-tool",
      }),
    ]);
    updateMatrixActivityAnimationInPlace(state, crossCategory, now, 160, false);
    expect(state.linkCount).toBe(0);

    const related = deriveMatrixActivityEvents(
      Array.from({ length: 40 }, (_, index) =>
        activity(`related-${index}`, new Date(now - 100 + index).toISOString(), {
          requestType: "compile",
          itemId: "shared-build-tool",
        }),
      ),
    );
    updateMatrixActivityAnimationInPlace(state, related, now, 160, false);
    expect(related).toHaveLength(MAX_MATRIX_ACTIVITY_EVENTS);
    expect(state.linkCount).toBeLessThanOrEqual(MAX_MATRIX_ACTIVITY_LINKS);
    expect(
      state.pulses.slice(0, state.pulseCount).some((pulse) => pulse.semanticRole === "operation"),
    ).toBe(true);
    const expiresAtBoundary = deriveMatrixActivityEvents([
      activity("expiry-boundary", new Date(now).toISOString(), {
        requestType: "compile",
        itemId: "expiry-tool",
      }),
    ]);
    updateMatrixActivityAnimationInPlace(
      state,
      expiresAtBoundary,
      now + MATRIX_ACTIVITY_TTL_MS,
      160,
      false,
    );
    expect(state.pulseCount).toBe(0);
    expect(state.linkCount).toBe(0);
  });

  it("correlates a 24-hour lifecycle but rejects older evidence and expires from the newest event", () => {
    const now = Date.parse("2026-07-23T12:10:00.000Z");
    const events = deriveMatrixActivityEvents([
      activity(
        "long-build-start",
        new Date(now - MATRIX_ACTIVITY_MAX_CORRELATION_MS).toISOString(),
        {
          itemType: "command_execution",
          itemId: "long-build-tool",
          observed: { providerObserved: true, activityType: "build" },
        },
        "tool.started",
      ),
      activity("interleaved-network", new Date(now - 30_000).toISOString(), {
        itemType: "web_search",
        itemId: "long-build-tool",
      }),
      activity("long-build-complete", new Date(now).toISOString(), {
        itemType: "command_execution",
        itemId: "long-build-tool",
        observed: { providerObserved: true, activityType: "build" },
      }),
    ]);
    const state = createMatrixActivityAnimationState();

    updateMatrixActivityAnimationInPlace(state, events, now, 160, false);
    expect(state.linkCount).toBe(1);
    expect(state.links[0]).toMatchObject({ category: "build" });
    expect(state.pulseCount).toBe(2);
    expect(
      state.pulses
        .slice(0, state.pulseCount)
        .map((pulse) => pulse.semanticRole)
        .toSorted(),
    ).toEqual(["category", "operation"]);

    const overLimit = deriveMatrixActivityEvents([
      activity(
        "over-limit-start",
        new Date(now - MATRIX_ACTIVITY_MAX_CORRELATION_MS - 1).toISOString(),
        {
          itemType: "command_execution",
          itemId: "over-limit-build-tool",
          observed: { providerObserved: true, activityType: "build" },
        },
        "tool.started",
      ),
      activity("over-limit-complete", new Date(now).toISOString(), {
        itemType: "command_execution",
        itemId: "over-limit-build-tool",
        observed: { providerObserved: true, activityType: "build" },
      }),
    ]);
    updateMatrixActivityAnimationInPlace(state, overLimit, now, 160, false);
    expect(state.linkCount).toBe(0);

    updateMatrixActivityAnimationInPlace(state, events, now + MATRIX_ACTIVITY_TTL_MS, 160, false);
    expect(state.pulseCount).toBe(0);
    expect(state.linkCount).toBe(0);
  });

  it("keeps only the newest lifecycle link with an unambiguous category-to-operation pair", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const events = deriveMatrixActivityEvents([
      activity(
        "chain-start",
        new Date(now - 300).toISOString(),
        { itemType: "build", itemId: "one-build-chain" },
        "tool.started",
      ),
      activity(
        "chain-update",
        new Date(now - 200).toISOString(),
        { itemType: "build", itemId: "one-build-chain" },
        "tool.updated",
      ),
      activity("chain-complete", new Date(now - 100).toISOString(), {
        itemType: "build",
        itemId: "one-build-chain",
      }),
    ]);
    const state = createMatrixActivityAnimationState();

    updateMatrixActivityAnimationInPlace(state, events, now, 160, false);

    expect(state.linkCount).toBe(1);
    const link = state.links[0]!;
    const fromPulse = state.pulses
      .slice(0, state.pulseCount)
      .find((pulse) => pulse.anchorIndex === link.fromAnchorIndex);
    const toPulse = state.pulses
      .slice(0, state.pulseCount)
      .find((pulse) => pulse.anchorIndex === link.toAnchorIndex);
    expect(fromPulse).toMatchObject({ category: "build", semanticRole: "category" });
    expect(toPulse).toMatchObject({ category: "build", semanticRole: "operation" });
  });

  it("draws a shared linked endpoint once instead of overpainting it for every route", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const events = [
      {
        anchorSeed: 0,
        category: "network" as const,
        observedAtMs: now - 200,
        relationHashes: [11, 22],
      },
      {
        anchorSeed: 1,
        category: "network" as const,
        observedAtMs: now - 100,
        relationHashes: [11],
      },
      {
        anchorSeed: 2,
        category: "network" as const,
        observedAtMs: now,
        relationHashes: [22],
      },
    ];
    const scene = createAtmosphereScene("matrix", 640, 480, createSeededRandom(83), undefined, 0);
    const state = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(state, events, now, scene.particles.length, false);

    expect(state.linkCount).toBe(2);
    expect(state.pulseCount).toBe(3);
    const recording = createRecordingContext();
    drawMatrixActivityAnimation(
      recording.context,
      scene,
      state,
      0.61,
      "matrix",
      UNIFORM_MATRIX_FRAME,
    );

    expect(recording.draws.filter((draw) => draw.kind === "text")).toHaveLength(3);
    // Two base routes, two packet trails, and one circle per unique endpoint.
    expect(recording.draws.filter((draw) => draw.kind === "stroke")).toHaveLength(7);
    expect(recording.draws.every((draw) => draw.alpha === 0.61)).toBe(true);
  });

  it("labels correlated falling strings with fixed safe English/Japanese category pairs", () => {
    expect(resolveMatrixActivityTerm("network", "category", "english")).toBe("NETWORK");
    expect(resolveMatrixActivityTerm("network", "operation", "japanese")).toBe("取得");
    expect(resolveMatrixActivityTerm("database", "category", "japanese")).toBe("データベース");
    expect(resolveMatrixActivityTerm("database", "operation", "english")).toBe("QUERY");
    expect(resolveMatrixActivityTerm("build", "category", "english")).toBe("BUILD");
    expect(resolveMatrixActivityTerm("build", "operation", "japanese")).toBe("コンパイル");
  });

  it("uses only 0°/±60° axial segments and advances packets by total route length", () => {
    for (const [from, to] of [
      [
        { x: 10, y: 10 },
        { x: 170, y: 70 },
      ],
      [
        { x: 90, y: 10 },
        { x: 105, y: 170 },
      ],
      [
        { x: 170, y: 170 },
        { x: 20, y: 40 },
      ],
    ] as const) {
      const route = createMatrixHexRoute(from, to);
      for (let index = 1; index < route.points.length; index += 1) {
        const angle = angleClass(route.points[index - 1]!, route.points[index]!);
        expect([0, 60, 120].some((allowed) => Math.abs(angle - allowed) < 0.001)).toBe(true);
      }
      const quarter = matrixHexRoutePointAt(route, 0.25);
      const threeQuarters = matrixHexRoutePointAt(route, 0.75);
      expect(quarter).not.toEqual(threeQuarters);
      expect(matrixHexRoutePointAt(route, 0)).toEqual(from);
      expect(matrixHexRoutePointAt(route, 1)).toEqual(to);
    }
  });

  it("keeps links fully visible until a short terminal fade and makes reduced motion static", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const completedAt = Date.parse("2026-07-23T12:00:00.900Z");
    const events = deriveMatrixActivityEvents([
      activity("pulse-start", "2026-07-23T12:00:00.700Z", {
        itemType: "web_search",
        itemId: "shared-network-tool",
      }),
      activity("pulse-finish", "2026-07-23T12:00:00.900Z", {
        requestKind: "fetch",
        itemId: "shared-network-tool",
      }),
    ]);
    const state = createMatrixActivityAnimationState();
    const normalMotionSamples = Array.from({ length: 9 }, (_, index) => {
      updateMatrixActivityAnimationInPlace(
        state,
        events,
        now + (index * MATRIX_ACTIVITY_LINK_PULSE_MS) / 8,
        20,
        false,
      );
      return state.links[0]!.linePulse;
    });
    expect(Math.max(...normalMotionSamples) - Math.min(...normalMotionSamples)).toBeGreaterThan(
      0.2,
    );
    expect(normalMotionSamples.every((sample) => sample >= 0.22 && sample <= 1)).toBe(true);

    updateMatrixActivityAnimationInPlace(
      state,
      events,
      completedAt + MATRIX_ACTIVITY_TTL_MS - MATRIX_ACTIVITY_TERMINAL_FADE_MS,
      20,
      false,
    );
    expect(state.links[0]!.intensity).toBe(1);
    updateMatrixActivityAnimationInPlace(
      state,
      events,
      completedAt + MATRIX_ACTIVITY_TTL_MS - MATRIX_ACTIVITY_TERMINAL_FADE_MS / 2,
      20,
      false,
    );
    expect(state.links[0]!.intensity).toBeCloseTo(0.5);

    const reducedMotionSamples = [0, MATRIX_ACTIVITY_LINK_PULSE_MS / 2].map((offset) => {
      updateMatrixActivityAnimationInPlace(state, events, now + offset, 20, true);
      return state.links[0]!.linePulse;
    });
    expect(reducedMotionSamples).toEqual([1, 1]);
    expect(state.links[0]!.intensity).toBe(1);
  });

  it("uses one random link hue at glyph-head opacity for the route, packet, and endpoints", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const events = deriveMatrixActivityEvents([
      activity("start", "2026-07-23T12:00:00.800Z", {
        itemType: "build",
        itemId: "shared-build",
      }),
      activity("finish", "2026-07-23T12:00:01.000Z", {
        requestKind: "compile",
        itemId: "shared-build",
      }),
    ]);
    const state = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(state, events, now, 20, false);
    const movingProgress = state.links[0]!.packetProgress;
    updateMatrixActivityAnimationInPlace(state, events, now + 200, 20, false);
    expect(state.links[0]!.packetProgress).not.toBe(movingProgress);
    updateMatrixActivityAnimationInPlace(state, events, now, 20, true);
    expect(state.reducedMotion).toBe(true);
    expect(state.links[0]!.packetProgress).toBe(0);
    expect(state.links[0]!.intensity).toBe(1);

    const scene = createAtmosphereScene("matrix", 640, 480, createSeededRandom(31), undefined, 0);
    const reduced = createRecordingContext();
    drawMatrixActivityAnimation(
      reduced.context,
      scene,
      state,
      0.73,
      "random",
      UNIFORM_MATRIX_FRAME,
    );
    const randomColor = `hsl(${state.links[0]!.colorHue.toFixed(1)} 86% 62%)`;
    expect(reduced.draws.every((draw) => draw.style === randomColor)).toBe(true);
    expect(reduced.draws.every((draw) => draw.alpha === 0.73)).toBe(true);
    expect(reduced.draws.filter((draw) => draw.kind === "fill")).toHaveLength(0);
    const reducedStrokes = reduced.draws.filter((draw) => draw.kind === "stroke");
    expect(reducedStrokes).toHaveLength(3);
    expect(reducedStrokes.map((draw) => draw.lineWidth)).toEqual([1.5, 1.75, 1.75]);

    const moving = createRecordingContext();
    updateMatrixActivityAnimationInPlace(state, events, now, scene.particles.length, false);
    drawMatrixActivityAnimation(moving.context, scene, state, 0.73, "random", UNIFORM_MATRIX_FRAME);
    expect(moving.draws.every((draw) => draw.style === randomColor)).toBe(true);
    expect(moving.draws.every((draw) => draw.alpha === 0.73)).toBe(true);
    expect(moving.draws.filter((draw) => draw.kind === "fill")).toHaveLength(1);
    const movingStrokes = moving.draws.filter((draw) => draw.kind === "stroke");
    expect(movingStrokes).toHaveLength(4);
    expect(movingStrokes[1]!.lineWidth).toBeGreaterThan(movingStrokes[0]!.lineWidth);
    expect(movingStrokes.slice(2).map((draw) => draw.lineWidth)).toEqual([1.75, 1.75]);
    expect(moving.draws.filter((draw) => draw.kind === "text").map((draw) => draw.text)).toEqual(
      expect.arrayContaining(["BUILD", "COMPILE"]),
    );
  });

  it("uses current endpoint glyph colors as one live Matrix gradient and packet paint", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const events = [
      {
        anchorSeed: 0,
        category: "network" as const,
        observedAtMs: now - 200,
        relationHashes: [71],
      },
      {
        anchorSeed: 1,
        category: "network" as const,
        observedAtMs: now,
        relationHashes: [71],
      },
    ];
    const scene = createAtmosphereScene("matrix", 640, 480, createSeededRandom(91), undefined, 0);
    const state = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(state, events, now, scene.particles.length, false);
    expect(state.linkCount).toBe(1);
    const link = state.links[0]!;
    const from = scene.particles[link.fromAnchorIndex]!;
    const to = scene.particles[link.toAnchorIndex]!;
    const fromColor = resolveMatrixStreamColor(PER_STREAM_MATRIX_FRAME, from);
    const toColor = resolveMatrixStreamColor(PER_STREAM_MATRIX_FRAME, to);
    expect(fromColor).not.toBe(toColor);

    const recording = createRecordingContext();
    drawMatrixActivityAnimation(
      recording.context,
      scene,
      state,
      0.66,
      "matrix",
      PER_STREAM_MATRIX_FRAME,
    );

    expect(recording.gradients).toHaveLength(1);
    expect(recording.gradients[0]!.stops).toEqual([
      [0, fromColor],
      [1, toColor],
    ]);
    const gradientPaintDraws = recording.draws.filter(
      (draw) => draw.style === recording.gradients[0],
    );
    expect(gradientPaintDraws.map((draw) => draw.kind)).toEqual(["stroke", "stroke", "fill"]);
    expect(gradientPaintDraws.every((draw) => draw.alpha === 0.66)).toBe(true);
    expect(
      recording.draws
        .filter((draw) => draw.kind === "stroke" || draw.kind === "text")
        .map((draw) => draw.style),
    ).toEqual(expect.arrayContaining([fromColor, toColor]));
    expect(recording.draws.every((draw) => draw.style !== "#ffffff")).toBe(true);
  });

  it("renders a selected-thread lifecycle through selector, codec, animation, and canvas", () => {
    const environmentId = EnvironmentId.make("environment-render-integration");
    const threadId = ThreadId.make("thread-render-integration");
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const lifecycle = [
      activity(
        "integration-start",
        "2026-07-23T12:00:00.800Z",
        { itemType: "build", itemId: "integration-build" },
        "tool.started",
      ),
      activity(
        "integration-complete",
        "2026-07-23T12:00:01.000Z",
        { itemType: "build", itemId: "integration-build" },
        "tool.completed",
      ),
    ];
    const appState = {
      environmentStateById: {
        [environmentId]: {
          activityIdsByThreadId: { [threadId]: lifecycle.map((entry) => entry.id) },
          activityByThreadId: {
            [threadId]: Object.fromEntries(lifecycle.map((entry) => [entry.id, entry])),
          },
        },
      },
    } as unknown as AppState;
    const events = decodeMatrixActivityEvents(
      selectMatrixActivityEventsKey(appState, { environmentId, threadId }),
    );
    const scene = createAtmosphereScene("matrix", 640, 480, createSeededRandom(17), undefined, 0);
    const animation = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(animation, events, now, scene.particles.length, false);
    const recording = createRecordingContext();
    drawMatrixActivityAnimation(
      recording.context,
      scene,
      animation,
      0.5,
      "matrix",
      UNIFORM_MATRIX_FRAME,
    );

    expect(events).toHaveLength(2);
    expect(animation.linkCount).toBe(1);
    expect(recording.draws.filter((draw) => draw.kind === "stroke")).toHaveLength(4);
    expect(recording.draws.filter((draw) => draw.kind === "fill")).toHaveLength(1);
    expect(recording.draws.every((draw) => draw.alpha === 0.5)).toBe(true);
    expect(recording.draws.every((draw) => draw.style === UNIFORM_MATRIX_FRAME.color)).toBe(true);
  });
});
