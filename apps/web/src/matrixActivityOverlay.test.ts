import {
  EnvironmentId,
  EventId,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@cafecode/contracts";
import {
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
} from "@cafecode/contracts/settings";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MATRIX_ACTIVITY_ROUTE_TTL_MS,
  MATRIX_ACTIVITY_DEPTH_ROUTE_SEGMENTS,
  MATRIX_ACTIVITY_LINK_PULSE_MS,
  MATRIX_ACTIVITY_MAX_CORRELATION_MS,
  MATRIX_ACTIVITY_MIN_PACKETS_PER_LINK,
  MATRIX_ACTIVITY_PACKET_COUNT,
  MATRIX_ACTIVITY_PACKET_TRAIL_PROGRESS,
  MATRIX_ACTIVITY_TERMINAL_FADE_MS,
  MATRIX_ACTIVITY_TTL_MS,
  MAX_MATRIX_ACTIVITY_ENCODED_CHARS,
  MAX_MATRIX_ACTIVITY_DEPTH_LINE_WIDTH,
  MAX_MATRIX_ACTIVITY_DEPTH_PACKET_RADIUS,
  MAX_MATRIX_ACTIVITY_EVENTS,
  MAX_MATRIX_ACTIVITY_LINKS,
  MAX_MATRIX_ACTIVITY_PACKET_DRAWS,
  MAX_MATRIX_ACTIVITY_TELEMETRY_GLYPHS,
  MAX_MATRIX_ACTIVITY_TELEMETRY_RINGS,
  createMatrixActivityWalkAttachmentRoute,
  createMatrixActivityAnimationState,
  createMatrixHexRoute,
  createMatrixTunnelRoute,
  decodeMatrixActivityEvents,
  deriveMatrixActivityEvents,
  drawMatrixActivityAnimation,
  encodeMatrixActivityEvents,
  matrixHexRoutePointAt,
  resolveMatrixActivityPacketCount,
  resolveMatrixActivityPacketProgress,
  resolveMatrixActivityRouteDepthScale,
  resolveMatrixActivityTelemetryLabel,
  resolveMatrixActivityTerm,
  resolveMatrixActivityTrailIntervals,
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
  readonly maxWidth?: number;
  readonly style: string | RecordedGradient;
  readonly text?: string;
  readonly x?: number;
  readonly y?: number;
}

function createRecordingContext(): {
  readonly context: CanvasRenderingContext2D;
  readonly arcRadii: number[];
  readonly draws: RecordedCanvasDraw[];
  readonly gradients: RecordedGradient[];
  readonly rotations: number[];
  readonly translations: Array<readonly [number, number]>;
} {
  const arcRadii: number[] = [];
  const draws: RecordedCanvasDraw[] = [];
  const gradients: RecordedGradient[] = [];
  const rotations: number[] = [];
  const translations: Array<readonly [number, number]> = [];
  const context = {
    arc: vi.fn((_x: number, _y: number, radius: number) => {
      arcRadii.push(radius);
    }),
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
      x: number,
      y: number,
      maxWidth?: number,
    ) {
      draws.push({
        alpha: this.globalAlpha,
        kind: "text",
        lineWidth: this.lineWidth,
        style: this.fillStyle,
        text,
        x,
        y,
        ...(maxWidth === undefined ? {} : { maxWidth }),
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
    rotate: vi.fn((angle: number) => {
      rotations.push(angle);
    }),
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
    translate: vi.fn((x: number, y: number) => {
      translations.push([x, y]);
    }),
  } as unknown as CanvasRenderingContext2D;
  return { context, arcRadii, draws, gradients, rotations, translations };
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
      activity(
        "agent-started",
        "2026-07-23T12:00:00.210Z",
        {
          itemType: "collab_agent_tool_call",
          itemId: "tool-agent",
          observed: {
            providerObserved: true,
            activityType: "agent",
          },
        },
        "tool.started",
      ),
      activity(
        "agent-completed",
        "2026-07-23T12:00:00.220Z",
        {
          itemType: "collab_agent_tool_call",
          itemId: "tool-agent",
          observed: {
            providerObserved: true,
            activityType: "agent",
          },
        },
        "tool.completed",
      ),
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

    expect(events.map((event) => event.category)).toEqual([
      "network",
      "database",
      "build",
      "agent",
      "agent",
    ]);
    const encoded = encodeMatrixActivityEvents(events);
    expect(encoded).not.toMatch(
      /curl|password|example|token|hunter2|SELECT|secret|credential|tool-network|tool-agent|turn-matrix/iu,
    );
    expect(decodeMatrixActivityEvents(encoded)).toEqual(events);
    expect(decodeMatrixActivityEvents("[".repeat(MAX_MATRIX_ACTIVITY_ENCODED_CHARS + 1))).toEqual(
      [],
    );
  });

  it("attests an unclassified lifecycle start only from one exact matching completion", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const turnId = TurnId.make("turn-live-command");
    const started = activity(
      "live-command-started",
      new Date(now - 100).toISOString(),
      {
        itemType: "command_execution",
        itemId: "live-command-item",
      },
      "tool.started",
      turnId,
    );
    const completed = activity(
      "live-command-completed",
      new Date(now - 50).toISOString(),
      {
        itemType: "command_execution",
        itemId: "live-command-item",
        data: {
          command:
            "powershell.exe -Command '$null | corepack yarn workspace @cafecode/web typecheck'",
        },
        observed: { providerObserved: true, activityType: "build" },
      },
      "tool.completed",
      turnId,
    );
    const events = deriveMatrixActivityEvents([started, completed]);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.category)).toEqual(["build", "build"]);
    expect(events[0]?.relationHashes).toEqual(events[1]?.relationHashes);
    expect(JSON.stringify(events)).not.toMatch(/live-command|powershell|corepack|typecheck/iu);

    const animation = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(animation, events, now, 160, false);
    expect(animation.linkCount).toBe(1);
    expect(animation.links[0]).toMatchObject({ category: "build" });

    const crossTurn = deriveMatrixActivityEvents([
      started,
      activity(
        "cross-turn-completed",
        new Date(now - 40).toISOString(),
        {
          itemType: "command_execution",
          itemId: "live-command-item",
          observed: { providerObserved: true, activityType: "build" },
        },
        "tool.completed",
        TurnId.make("turn-other-command"),
      ),
    ]);
    expect(crossTurn).toHaveLength(1);

    const crossType = deriveMatrixActivityEvents([
      started,
      activity(
        "cross-type-completed",
        new Date(now - 30).toISOString(),
        {
          itemType: "dynamic_tool_call",
          itemId: "live-command-item",
          observed: { providerObserved: true, activityType: "build" },
        },
        "tool.completed",
        turnId,
      ),
    ]);
    expect(crossType).toHaveLength(1);

    const postCompletionStart = deriveMatrixActivityEvents([
      completed,
      activity(
        "post-completion-start",
        new Date(now - 25).toISOString(),
        {
          itemType: "command_execution",
          itemId: "live-command-item",
        },
        "tool.started",
        turnId,
      ),
    ]);
    expect(postCompletionStart).toHaveLength(1);

    const reversedAtEqualTimestamp = deriveMatrixActivityEvents([
      activity(
        "equal-time-completion-first",
        new Date(now - 20).toISOString(),
        {
          itemType: "command_execution",
          itemId: "equal-time-item",
          observed: { providerObserved: true, activityType: "build" },
        },
        "tool.completed",
        turnId,
      ),
      activity(
        "equal-time-start-second",
        new Date(now - 20).toISOString(),
        {
          itemType: "command_execution",
          itemId: "equal-time-item",
        },
        "tool.started",
        turnId,
      ),
    ]);
    expect(reversedAtEqualTimestamp).toHaveLength(1);

    const unclassifiedUpdate = deriveMatrixActivityEvents([
      activity(
        "unclassified-update",
        new Date(now - 75).toISOString(),
        {
          itemType: "command_execution",
          itemId: "live-command-item",
        },
        "tool.updated",
        turnId,
      ),
      completed,
    ]);
    expect(unclassifiedUpdate).toHaveLength(1);

    const staleStart = deriveMatrixActivityEvents([
      activity(
        "stale-start",
        new Date(now - MATRIX_ACTIVITY_MAX_CORRELATION_MS - 1_000).toISOString(),
        {
          itemType: "command_execution",
          itemId: "live-command-item",
        },
        "tool.started",
        turnId,
      ),
      completed,
    ]);
    expect(staleStart).toHaveLength(1);

    const duplicateCompletion = deriveMatrixActivityEvents([
      started,
      completed,
      activity(
        "duplicate-completion",
        new Date(now - 10).toISOString(),
        {
          itemType: "command_execution",
          itemId: "live-command-item",
          observed: { providerObserved: true, activityType: "build" },
        },
        "tool.completed",
        turnId,
      ),
    ]);
    expect(duplicateCompletion).toHaveLength(2);

    const conflicting = deriveMatrixActivityEvents([
      started,
      activity(
        "conflicting-build",
        new Date(now - 25).toISOString(),
        {
          itemType: "command_execution",
          itemId: "live-command-item",
          observed: { providerObserved: true, activityType: "build" },
        },
        "tool.updated",
        turnId,
      ),
      activity(
        "conflicting-database",
        new Date(now - 20).toISOString(),
        {
          itemType: "command_execution",
          itemId: "live-command-item",
          observed: { providerObserved: true, activityType: "database" },
        },
        "tool.completed",
        turnId,
      ),
    ]);
    expect(conflicting.map((event) => event.category)).toEqual(["build", "database"]);
    const conflictingAnimation = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(conflictingAnimation, conflicting, now, 160, false);
    expect(conflictingAnimation.linkCount).toBe(0);

    const malformedAttestation = deriveMatrixActivityEvents([
      started,
      activity(
        "malformed-attestation",
        new Date(now - 15).toISOString(),
        {
          itemType: "command_execution",
          itemId: "live-command-item",
          observed: { providerObserved: true, activityType: "not-a-category" },
        },
        "tool.updated",
        turnId,
      ),
      completed,
    ]);
    expect(malformedAttestation).toHaveLength(1);
    expect(malformedAttestation[0]?.anchorSeed).toBe(
      deriveMatrixActivityEvents([completed])[0]?.anchorSeed,
    );
  });

  it("draws one honest verified route for a lone canonical agent dispatch", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const loneDispatch = activity(
      "provider-agent-dispatch-completed",
      new Date(now - 25).toISOString(),
      {
        itemType: "collab_agent_tool_call",
        itemId: "private-provider-agent-item",
        observed: { providerObserved: true, activityType: "agent" },
        data: {
          task: "private delegated work",
          agentName: "private agent name",
        },
      },
      "tool.completed",
      TurnId.make("private-provider-agent-turn"),
    );
    const events = deriveMatrixActivityEvents([loneDispatch]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: "agent",
      verifiedAgentDispatch: {
        operationAnchorSeed: expect.any(Number),
        relationHash: expect.any(Number),
      },
    });
    const encoded = encodeMatrixActivityEvents(events);
    expect(encoded).not.toMatch(/private|provider|agent-item|agent-turn|delegated|agent name/iu);
    expect(decodeMatrixActivityEvents(encoded)).toEqual(events);

    const animation = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(animation, events, now, 160, false);
    expect(animation.linkCount).toBe(1);
    expect(animation.pulseCount).toBe(2);
    expect(animation.links[0]).toMatchObject({ category: "agent" });
    expect(
      animation.pulses.slice(0, animation.pulseCount).map((pulse) => pulse.semanticRole),
    ).toEqual(["category", "operation"]);

    const paired = deriveMatrixActivityEvents([
      activity(
        "provider-agent-dispatch-started",
        new Date(now - 50).toISOString(),
        {
          itemType: "collab_agent_tool_call",
          itemId: "private-provider-agent-item",
          observed: { providerObserved: true, activityType: "agent" },
        },
        "tool.started",
        TurnId.make("private-provider-agent-turn"),
      ),
      loneDispatch,
    ]);
    expect(paired).toHaveLength(2);
    expect(paired.every((event) => event.verifiedAgentDispatch === undefined)).toBe(true);
    const pairedAnimation = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(pairedAnimation, paired, now, 160, false);
    expect(pairedAnimation.linkCount).toBe(1);
    expect(pairedAnimation.links[0]).toMatchObject({ category: "agent" });

    for (const ineligible of [
      activity(
        "agent-start-only",
        new Date(now - 10).toISOString(),
        {
          itemType: "collab_agent_tool_call",
          itemId: "agent-start-only-item",
          observed: { providerObserved: true, activityType: "agent" },
        },
        "tool.started",
      ),
      activity("agent-not-attested", new Date(now - 9).toISOString(), {
        itemType: "collab_agent_tool_call",
        itemId: "agent-not-attested-item",
      }),
      activity("agent-wrong-item-type", new Date(now - 8).toISOString(), {
        itemType: "command_execution",
        itemId: "agent-wrong-item-type-item",
        observed: { providerObserved: true, activityType: "agent" },
      }),
      activity(
        "agent-without-turn",
        new Date(now - 7).toISOString(),
        {
          itemType: "collab_agent_tool_call",
          itemId: "agent-without-turn-item",
          observed: { providerObserved: true, activityType: "agent" },
        },
        "tool.completed",
        null,
      ),
    ]) {
      expect(deriveMatrixActivityEvents([ineligible])[0]?.verifiedAgentDispatch).toBeUndefined();
    }

    expect(decodeMatrixActivityEvents(JSON.stringify([[1, 0, now, [], [2, 3]]]))).toEqual([]);
    expect(decodeMatrixActivityEvents(JSON.stringify([[1, 3, now, [], [2, -1]]]))).toEqual([]);
  });

  it("keeps single-event dispatch routes inside the existing event and link caps", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const events = Array.from({ length: MAX_MATRIX_ACTIVITY_EVENTS + 10 }, (_, index) => ({
      anchorSeed: index * 2,
      category: "agent" as const,
      observedAtMs: now - index,
      relationHashes: [],
      verifiedAgentDispatch: {
        operationAnchorSeed: index * 2 + 1,
        relationHash: index + 1,
      },
    }));
    const decoded = decodeMatrixActivityEvents(encodeMatrixActivityEvents(events));
    expect(decoded).toHaveLength(MAX_MATRIX_ACTIVITY_EVENTS);

    const animation = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(animation, decoded, now, 256, false);
    expect(animation.linkCount).toBe(MAX_MATRIX_ACTIVITY_LINKS);
    expect(animation.pulseCount).toBeLessThanOrEqual(MAX_MATRIX_ACTIVITY_EVENTS);
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
      activity("agent-filter", "2026-07-23T12:00:00.300Z", {
        itemType: "collab_agent_tool_call",
        itemId: "agent-filter-tool",
        observed: { providerObserved: true, activityType: "agent" },
      }),
    ];

    expect(
      deriveMatrixActivityEvents(activities, {
        network: true,
        database: false,
        build: true,
        agent: false,
      }).map((event) => event.category),
    ).toEqual(["network", "build"]);
    expect(
      encodeMatrixActivityEvents(
        deriveMatrixActivityEvents(activities, {
          network: false,
          database: false,
          build: false,
          agent: false,
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
        agent: false,
      }),
    ).toEqual([]);
    expect(deriveMatrixActivityEvents(activities).map((event) => event.category)).toEqual([
      "network",
      "database",
      "build",
      "agent",
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
          { network: false, database: false, build: false, agent: false },
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
        { network: false, database: false, build: false, agent: false },
      ),
    ).toBe("[]");
    expect(selectMatrixActivityEventsKey(state, null)).toBe("");
  });

  it("retains a selected-thread verified route across more than 160 newer qualifying activities", () => {
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
          itemType: "web_search",
          itemId: `unrelated-tool-${index}`,
        },
        "tool.updated",
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

    expect(events).toHaveLength(MAX_MATRIX_ACTIVITY_EVENTS);
    expect(events.filter((event) => event.category === "build")).toHaveLength(2);
    expect(animation.linkCount).toBe(1);
    expect(animation.links[0]).toMatchObject({ category: "build" });
  });

  it("does not let expired route pairs crowd fresh activity out of the bounded payload", () => {
    const environmentId = EnvironmentId.make("environment-expired-lifecycle");
    const threadId = ThreadId.make("thread-expired-lifecycle");
    const now = Date.parse("2026-07-23T12:10:00.000Z");
    const expiredPairs = Array.from({ length: MAX_MATRIX_ACTIVITY_LINKS }, (_, index) => {
      const startedAt = now - 12 * 60 * 60 * 1_000 + index * 1_000;
      const itemId = `expired-lifecycle-tool-${index}`;
      return [
        activity(
          `expired-lifecycle-start-${index}`,
          new Date(startedAt).toISOString(),
          { itemType: "build", itemId },
          "tool.started",
        ),
        activity(`expired-lifecycle-completed-${index}`, new Date(startedAt + 100).toISOString(), {
          itemType: "build",
          itemId,
        }),
      ];
    }).flat();
    const fresh = activity(
      "fresh-standalone-after-expired-lifecycles",
      new Date(now - 10).toISOString(),
      { itemType: "web_search", itemId: "fresh-network-tool" },
    );
    const retained = [...expiredPairs, fresh];
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
      selectMatrixActivityEventsKey(
        state,
        { environmentId, threadId },
        { network: true, database: true, build: true, agent: true },
        { nowMs: now, requestedTtlMs: 30_000 },
      ),
    );
    const animation = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(animation, events, now, 160, false, 30_000);

    expect(events).toHaveLength(MAX_MATRIX_ACTIVITY_EVENTS);
    expect(events).toContainEqual(
      expect.objectContaining({ category: "network", observedAtMs: now - 10 }),
    );
    expect(animation.linkCount).toBe(0);
    expect(animation.pulseCount).toBe(1);
    expect(animation.pulses[0]).toMatchObject({ category: "network", semanticRole: "category" });
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

    updateMatrixActivityAnimationInPlace(
      state,
      events,
      now + DEFAULT_MATRIX_ACTIVITY_ROUTE_TTL_MS,
      160,
      false,
    );
    expect(state.pulseCount).toBe(0);
    expect(state.linkCount).toBe(0);
  });

  it("uses only the bounded requested TTL to retain an already verified exact route", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const events = deriveMatrixActivityEvents([
      activity("retained-start", "2026-07-23T12:00:00.800Z", {
        itemType: "web_search",
        itemId: "retained-exact-route",
      }),
      activity("retained-complete", "2026-07-23T12:00:01.000Z", {
        requestKind: "fetch",
        itemId: "retained-exact-route",
      }),
    ]);
    const state = createMatrixActivityAnimationState();
    const minimumTtlMs = MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS * 1_000;
    const maximumTtlMs = MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS * 1_000;
    const standaloneEvent = deriveMatrixActivityEvents([
      activity("standalone", "2026-07-23T12:00:01.000Z", {
        itemType: "web_search",
        itemId: "unpaired-provider-event",
      }),
    ]);

    expect(MATRIX_ACTIVITY_TTL_MS).toBe(8_000);
    expect(DEFAULT_MATRIX_ACTIVITY_ROUTE_TTL_MS).toBe(
      DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS * 1_000,
    );
    updateMatrixActivityAnimationInPlace(
      state,
      standaloneEvent,
      now + MATRIX_ACTIVITY_TTL_MS,
      160,
      false,
      maximumTtlMs,
    );
    expect(state.pulseCount).toBe(0);
    expect(state.linkCount).toBe(0);

    updateMatrixActivityAnimationInPlace(
      state,
      events,
      now + minimumTtlMs,
      160,
      false,
      minimumTtlMs,
    );
    expect(state.pulseCount).toBe(0);
    expect(state.linkCount).toBe(0);

    updateMatrixActivityAnimationInPlace(
      state,
      events,
      now + minimumTtlMs,
      160,
      false,
      maximumTtlMs,
    );
    expect(state.linkCount).toBe(1);
    expect(state.links[0]!.intensity).toBe(1);

    updateMatrixActivityAnimationInPlace(
      state,
      events,
      now + maximumTtlMs,
      160,
      false,
      Number.MAX_SAFE_INTEGER,
    );
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

    expect(
      recording.draws.filter((draw) => draw.kind === "text" && draw.maxWidth === 144),
    ).toHaveLength(3);
    // Two base routes, repeated packet trails, and one circle per unique endpoint.
    expect(recording.draws.filter((draw) => draw.kind === "stroke")).toHaveLength(
      2 + 2 * MATRIX_ACTIVITY_PACKET_COUNT + 3,
    );
    expect(recording.draws.every((draw) => draw.alpha === 0.61)).toBe(true);
  });

  it("fades Walk connectors with their lifecycle anchors and drops completed anchors", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const events = [
      {
        anchorSeed: 0,
        category: "network" as const,
        observedAtMs: now,
        relationHashes: [11],
      },
      {
        anchorSeed: 1,
        category: "network" as const,
        observedAtMs: now,
        relationHashes: [11],
      },
    ];
    const scene = createAtmosphereScene(
      "matrix",
      640,
      480,
      createSeededRandom(831),
      undefined,
      0,
      false,
      { english: [], japanese: [] },
      "walk-forward",
      30,
      4,
    );
    const state = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(state, events, now, scene.particles.length, false);
    expect(state.linkCount).toBe(1);
    const link = state.links[0]!;
    const from = scene.particles[link.fromAnchorIndex]!;
    const to = scene.particles[link.toAnchorIndex]!;
    from.matrixLifecycleOpacity = 0.25;
    to.matrixLifecycleOpacity = 0.25;

    const fading = createRecordingContext();
    drawMatrixActivityAnimation(
      fading.context,
      scene,
      state,
      0.6,
      "matrix",
      UNIFORM_MATRIX_FRAME,
      "walk-forward",
    );
    expect(fading.draws.length).toBeGreaterThan(0);
    expect(fading.draws.every((draw) => draw.alpha === 0.15)).toBe(true);

    from.matrixLifecycleOpacity = 0;
    to.matrixLifecycleOpacity = 0;
    const completed = createRecordingContext();
    drawMatrixActivityAnimation(
      completed.context,
      scene,
      state,
      0.6,
      "matrix",
      UNIFORM_MATRIX_FRAME,
      "walk-forward",
    );
    expect(completed.draws).toEqual([]);
  });

  it("labels correlated falling strings with fixed safe English/Japanese category pairs", () => {
    expect(resolveMatrixActivityTerm("network", "category", "english")).toBe("NETWORK");
    expect(resolveMatrixActivityTerm("network", "operation", "japanese")).toBe("取得");
    expect(resolveMatrixActivityTerm("database", "category", "japanese")).toBe("データベース");
    expect(resolveMatrixActivityTerm("database", "operation", "english")).toBe("QUERY");
    expect(resolveMatrixActivityTerm("build", "category", "english")).toBe("BUILD");
    expect(resolveMatrixActivityTerm("build", "operation", "japanese")).toBe("コンパイル");
    expect(resolveMatrixActivityTerm("agent", "category", "english")).toBe("AGENT");
    expect(resolveMatrixActivityTerm("agent", "operation", "japanese")).toBe("委任");
  });

  it("uses exact bounded operation labels for verified telemetry rings without claiming rate", () => {
    expect(resolveMatrixActivityTelemetryLabel("network", "english")).toBe("FETCH • VERIFIED •");
    expect(resolveMatrixActivityTelemetryLabel("database", "japanese")).toBe("照会 • VERIFIED •");
    expect(resolveMatrixActivityTelemetryLabel("build", null)).toBe("COMPILE • VERIFIED •");
    expect(resolveMatrixActivityTelemetryLabel("agent", null)).toBe("DISPATCH • VERIFIED •");
    for (const category of ["network", "database", "build", "agent"] as const) {
      for (const language of ["english", "japanese", null] as const) {
        const label = resolveMatrixActivityTelemetryLabel(category, language);
        expect(label.length).toBeLessThanOrEqual(MAX_MATRIX_ACTIVITY_TELEMETRY_GLYPHS);
        expect(label).not.toMatch(/(?:B\/?S|BPS|BYTE|KB|MB|GB|RATE|THROUGHPUT|\/S)/u);
      }
    }
  });

  it("draws circular text only around verified linked operation endpoints", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const linkedEvents = deriveMatrixActivityEvents([
      activity("ring-start", "2026-07-23T12:00:00.800Z", {
        itemType: "build",
        itemId: "ring-build",
      }),
      activity("ring-complete", "2026-07-23T12:00:01.000Z", {
        requestKind: "compile",
        itemId: "ring-build",
      }),
    ]);
    const scene = createAtmosphereScene("matrix", 640, 480, createSeededRandom(55), undefined, 0);
    const linkedState = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(
      linkedState,
      linkedEvents,
      now,
      scene.particles.length,
      false,
    );
    const linked = createRecordingContext();
    drawMatrixActivityAnimation(
      linked.context,
      scene,
      linkedState,
      0.64,
      "random",
      UNIFORM_MATRIX_FRAME,
    );

    const operationPulse = linkedState.pulses.find((pulse) => pulse.semanticRole === "operation")!;
    const operationParticle = scene.particles[operationPulse.anchorIndex]!;
    const label = resolveMatrixActivityTelemetryLabel(
      operationPulse.category,
      operationParticle.matrixLanguage,
    );
    const ringGlyphs = linked.draws.filter(
      (draw) => draw.kind === "text" && draw.maxWidth === undefined,
    );
    expect(ringGlyphs.map((draw) => draw.text).join("")).toBe(label);
    expect(ringGlyphs).toHaveLength(label.length);
    expect(linked.translations).toEqual([[operationParticle.x, operationParticle.y]]);
    expect(linked.rotations).toHaveLength(label.length - 1);
    expect(linked.rotations.every((angle) => angle === (Math.PI * 2) / label.length)).toBe(true);
    expect(linked.context.save).toHaveBeenCalledTimes(2);
    expect(linked.context.restore).toHaveBeenCalledTimes(2);
    const expectedPaint = `hsl(${operationPulse.linkColorHue!.toFixed(1)} 86% 62%)`;
    expect(ringGlyphs.every((draw) => draw.style === expectedPaint)).toBe(true);
    expect(ringGlyphs.every((draw) => draw.alpha === 0.64)).toBe(true);

    const standaloneState = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(
      standaloneState,
      [
        {
          anchorSeed: 3,
          category: "network",
          observedAtMs: now,
          relationHashes: [73],
        },
      ],
      now,
      scene.particles.length,
      false,
    );
    const standalone = createRecordingContext();
    drawMatrixActivityAnimation(
      standalone.context,
      scene,
      standaloneState,
      0.64,
      "random",
      UNIFORM_MATRIX_FRAME,
    );
    expect(standalone.translations).toEqual([]);
    expect(standalone.rotations).toEqual([]);
    expect(
      standalone.draws.filter((draw) => draw.kind === "text" && draw.maxWidth === undefined),
    ).toEqual([]);

    // Rendering must not treat a role/hue pair as sufficient evidence: only
    // the current bounded link topology can authorize VERIFIED lettering.
    const unverifiedOperationState = createMatrixActivityAnimationState();
    unverifiedOperationState.pulses.push({
      anchorIndex: 4,
      category: "build",
      intensity: 1,
      linkColorHue: 45,
      semanticRole: "operation",
    });
    unverifiedOperationState.pulseCount = 1;
    const unverifiedOperation = createRecordingContext();
    drawMatrixActivityAnimation(
      unverifiedOperation.context,
      scene,
      unverifiedOperationState,
      0.64,
      "random",
      UNIFORM_MATRIX_FRAME,
    );
    expect(unverifiedOperation.translations).toEqual([]);
    expect(
      unverifiedOperation.draws.filter(
        (draw) => draw.kind === "text" && draw.maxWidth === undefined,
      ),
    ).toEqual([]);
  });

  it("bounds hostile pulse and link counters by their populated capped arrays", () => {
    const scene = createAtmosphereScene("matrix", 800, 600, createSeededRandom(101), undefined, 0);
    const hostileLinks = createMatrixActivityAnimationState();
    hostileLinks.pulses.push({
      anchorIndex: 0,
      category: "build",
      intensity: 1,
      linkColorHue: 45,
      semanticRole: "operation",
    });
    hostileLinks.links.push({
      fromAnchorIndex: 1,
      toAnchorIndex: 0,
      operationAnchorIndex: 0,
      category: "build",
      intensity: 1,
      linePulse: 1,
      colorHue: 45,
      packetProgress: 0,
    });
    hostileLinks.pulseCount = 1;
    hostileLinks.linkCount = Number.MAX_SAFE_INTEGER;
    const linkRecording = createRecordingContext();

    expect(() =>
      drawMatrixActivityAnimation(
        linkRecording.context,
        scene,
        hostileLinks,
        0.64,
        "random",
        UNIFORM_MATRIX_FRAME,
      ),
    ).not.toThrow();
    expect(linkRecording.translations).toHaveLength(1);

    const hostilePulses = createMatrixActivityAnimationState();
    hostilePulses.pulses.push({
      anchorIndex: 0,
      category: "build",
      intensity: 1,
      linkColorHue: null,
      semanticRole: "category",
    });
    hostilePulses.pulseCount = Number.MAX_SAFE_INTEGER;
    const pulseRecording = createRecordingContext();

    expect(() =>
      drawMatrixActivityAnimation(
        pulseRecording.context,
        scene,
        hostilePulses,
        0.64,
        "random",
        UNIFORM_MATRIX_FRAME,
      ),
    ).not.toThrow();
    expect(
      pulseRecording.draws.filter((draw) => draw.kind === "text" && draw.maxWidth === 144),
    ).toHaveLength(1);
  });

  it("caps circular telemetry work independently from the bounded pulse count", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const scene = createAtmosphereScene("matrix", 800, 600, createSeededRandom(71), undefined, 0);
    const state = createMatrixActivityAnimationState();
    const eligibleCount = Math.min(
      Math.floor(scene.particles.length / 2),
      Math.floor(MAX_MATRIX_ACTIVITY_EVENTS / 2),
      MAX_MATRIX_ACTIVITY_LINKS,
      MAX_MATRIX_ACTIVITY_TELEMETRY_RINGS + 4,
    );
    expect(eligibleCount).toBeGreaterThan(MAX_MATRIX_ACTIVITY_TELEMETRY_RINGS);
    const events = Array.from({ length: eligibleCount }, (_, index) => {
      const category = index % 2 === 0 ? ("database" as const) : ("build" as const);
      const relationHash = index + 1;
      return [
        {
          anchorSeed: index * 2,
          category,
          observedAtMs: now - 100,
          relationHashes: [relationHash],
        },
        {
          anchorSeed: index * 2 + 1,
          category,
          observedAtMs: now,
          relationHashes: [relationHash],
        },
      ];
    }).flat();
    updateMatrixActivityAnimationInPlace(state, events, now, scene.particles.length, false);
    expect(state.linkCount).toBe(eligibleCount);
    const recording = createRecordingContext();
    drawMatrixActivityAnimation(
      recording.context,
      scene,
      state,
      0.8,
      "random",
      UNIFORM_MATRIX_FRAME,
    );

    const ringGlyphs = recording.draws.filter(
      (draw) => draw.kind === "text" && draw.maxWidth === undefined,
    );
    expect(recording.translations).toHaveLength(MAX_MATRIX_ACTIVITY_TELEMETRY_RINGS);
    expect(ringGlyphs.length).toBeLessThanOrEqual(
      MAX_MATRIX_ACTIVITY_TELEMETRY_RINGS * MAX_MATRIX_ACTIVITY_TELEMETRY_GLYPHS,
    );
    expect(recording.context.save).toHaveBeenCalledTimes(1 + MAX_MATRIX_ACTIVITY_TELEMETRY_RINGS);
    expect(recording.context.restore).toHaveBeenCalledTimes(
      1 + MAX_MATRIX_ACTIVITY_TELEMETRY_RINGS,
    );
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

  it("routes Warp activity links through the exact tunnel center", () => {
    const from = { x: 40, y: 80 };
    const to = { x: 360, y: 180 };
    const center = { x: 200, y: 120 };
    const route = createMatrixTunnelRoute(from, to, center);

    expect(route.points).toEqual([from, center, to]);
    expect(matrixHexRoutePointAt(route, 0)).toEqual(from);
    expect(matrixHexRoutePointAt(route, 1)).toEqual(to);
    expect(route.totalLength).toBe(
      Math.hypot(center.x - from.x, center.y - from.y) +
        Math.hypot(to.x - center.x, to.y - center.y),
    );
  });

  it("narrows Warp at its center and mirrors bounded route depth", () => {
    expect(resolveMatrixActivityRouteDepthScale("flat", 0.75, 4, 0.4)).toBe(1);
    expect(resolveMatrixActivityRouteDepthScale("walk-forward", 0, 0.1, 9)).toBe(0.4);
    expect(resolveMatrixActivityRouteDepthScale("walk-forward", 1, 0.1, 9)).toBe(4);
    expect(resolveMatrixActivityRouteDepthScale("walk-reverse", 0, 9, 0.1)).toBe(4);
    expect(resolveMatrixActivityRouteDepthScale("walk-reverse", 1, 9, 0.1)).toBe(0.4);
    expect(resolveMatrixActivityRouteDepthScale("tunnel", 0.37, 1.2, 1.3, 0.37)).toBe(0.4);
  });

  it("attaches Walk routes to each differently scaled glyph edge", () => {
    const centerRoute = createMatrixHexRoute({ x: 0, y: 40 }, { x: 200, y: 40 });
    const attached = createMatrixActivityWalkAttachmentRoute(centerRoute, 20, 80);

    expect(attached.points[0]).toEqual({ x: 9, y: 40 });
    expect(attached.points.at(-1)).toEqual({ x: 164, y: 40 });
    expect(attached.totalLength).toBe(155);

    const bounded = createMatrixActivityWalkAttachmentRoute(centerRoute, 1_000, 1_000);
    expect(bounded.points[0]).toEqual({ x: 70, y: 40 });
    expect(bounded.points.at(-1)).toEqual({ x: 130, y: 40 });
    expect(bounded.totalLength).toBe(60);
  });

  it("flares depth routes and packets while preserving Flat's exact single stroke", () => {
    const scene = createAtmosphereScene("matrix", 400, 240, createSeededRandom(712), 1, 0);
    const from = scene.particles[0]!;
    const to = scene.particles[1]!;
    from.x = 60;
    from.y = 0;
    from.size = 3;
    from.matrixLifecycleProgress = 0;
    to.x = 340;
    to.y = scene.height;
    to.size = 90;
    to.matrixLifecycleProgress = 1;
    const state = createMatrixActivityAnimationState();
    state.links.push({
      fromAnchorIndex: 0,
      toAnchorIndex: 1,
      operationAnchorIndex: 1,
      category: "build",
      intensity: 1,
      linePulse: 1,
      colorHue: 42,
      packetProgress: 0.91,
    });
    state.linkCount = 1;
    state.reducedMotion = true;

    const flat = createRecordingContext();
    drawMatrixActivityAnimation(
      flat.context,
      scene,
      state,
      0.8,
      "random",
      UNIFORM_MATRIX_FRAME,
      "flat",
    );
    const flatStrokes = flat.draws.filter((draw) => draw.kind === "stroke");
    expect(flatStrokes).toHaveLength(1);
    expect(flatStrokes[0]!.lineWidth).toBe(1.5);

    const walk = createRecordingContext();
    drawMatrixActivityAnimation(
      walk.context,
      scene,
      state,
      0.8,
      "random",
      UNIFORM_MATRIX_FRAME,
      "walk-forward",
      12,
      24,
    );
    const walkStrokes = walk.draws.filter((draw) => draw.kind === "stroke");
    expect(walkStrokes).toHaveLength(MATRIX_ACTIVITY_DEPTH_ROUTE_SEGMENTS);
    expect(walkStrokes[0]!.lineWidth).toBeCloseTo(1.5 * 1.0625);
    expect(walkStrokes.at(-1)!.lineWidth).toBeCloseTo(1.5 * 1.9375);
    expect(
      walkStrokes.every(
        (draw) => draw.lineWidth > 0 && draw.lineWidth <= MAX_MATRIX_ACTIVITY_DEPTH_LINE_WIDTH,
      ),
    ).toBe(true);

    const reverseWalk = createRecordingContext();
    drawMatrixActivityAnimation(
      reverseWalk.context,
      scene,
      state,
      0.8,
      "random",
      UNIFORM_MATRIX_FRAME,
      "walk-reverse",
      12,
      24,
    );
    const reverseWalkStrokes = reverseWalk.draws.filter((draw) => draw.kind === "stroke");
    expect(reverseWalkStrokes).toHaveLength(MATRIX_ACTIVITY_DEPTH_ROUTE_SEGMENTS);
    expect(reverseWalkStrokes[0]!.lineWidth).toBeCloseTo(1.5 * 1.9375);
    expect(reverseWalkStrokes.at(-1)!.lineWidth).toBeCloseTo(1.5 * 1.0625);

    const equalEndpoints = createRecordingContext();
    drawMatrixActivityAnimation(
      equalEndpoints.context,
      scene,
      state,
      0.8,
      "random",
      UNIFORM_MATRIX_FRAME,
      "walk-forward",
      17.25,
      17.25,
    );
    expect(
      equalEndpoints.draws
        .filter((draw) => draw.kind === "stroke")
        .every((draw) => draw.lineWidth === 1.5),
    ).toBe(true);

    state.reducedMotion = false;
    const movingWalk = createRecordingContext();
    drawMatrixActivityAnimation(
      movingWalk.context,
      scene,
      state,
      0.8,
      "random",
      UNIFORM_MATRIX_FRAME,
      "walk-forward",
      12,
      24,
    );
    expect(movingWalk.arcRadii).toHaveLength(MATRIX_ACTIVITY_PACKET_COUNT);
    const expectedPacketRadii = Array.from(
      { length: MATRIX_ACTIVITY_PACKET_COUNT },
      (_, packetIndex) => {
        const progress = resolveMatrixActivityPacketProgress(
          state.links[0]!.packetProgress,
          packetIndex,
          MATRIX_ACTIVITY_PACKET_COUNT,
        );
        return 2.4 * (1 + progress);
      },
    );
    for (let index = 0; index < expectedPacketRadii.length; index += 1) {
      expect(movingWalk.arcRadii[index]).toBeCloseTo(expectedPacketRadii[index]!, 10);
    }
    expect(
      movingWalk.draws.filter((draw) => draw.kind === "stroke")[
        MATRIX_ACTIVITY_DEPTH_ROUTE_SEGMENTS
      ]!.lineWidth,
    ).toBeCloseTo(2.25 * 1.85);
    expect(
      movingWalk.arcRadii.every(
        (radius) => radius > 0 && radius <= MAX_MATRIX_ACTIVITY_DEPTH_PACKET_RADIUS,
      ),
    ).toBe(true);
  });

  it("keeps a verified connector visible in every perspective mode", () => {
    const scene = createAtmosphereScene("matrix", 400, 240, createSeededRandom(713), 1, 0);
    const from = scene.particles[0]!;
    const to = scene.particles[1]!;
    from.x = 60;
    from.y = 0;
    to.x = 340;
    to.y = scene.height;
    const state = createMatrixActivityAnimationState();
    state.links.push({
      fromAnchorIndex: 0,
      toAnchorIndex: 1,
      operationAnchorIndex: 1,
      category: "network",
      intensity: 1,
      linePulse: 1,
      colorHue: 184,
      packetProgress: 0,
    });
    state.linkCount = 1;
    state.reducedMotion = true;

    for (const motionMode of [
      "flat",
      "forward",
      "reverse",
      "tunnel",
      "walk-forward",
      "walk-reverse",
    ] as const) {
      const recording = createRecordingContext();
      drawMatrixActivityAnimation(
        recording.context,
        scene,
        state,
        0.8,
        "random",
        UNIFORM_MATRIX_FRAME,
        motionMode,
        12,
        32,
      );

      const connectorStrokes = recording.draws.filter((draw) => draw.kind === "stroke");
      expect(connectorStrokes, motionMode).toHaveLength(
        motionMode === "flat" ? 1 : MATRIX_ACTIVITY_DEPTH_ROUTE_SEGMENTS,
      );
      expect(
        connectorStrokes.every(
          (draw) =>
            Number.isFinite(draw.lineWidth) &&
            draw.lineWidth > 0 &&
            draw.lineWidth <= MAX_MATRIX_ACTIVITY_DEPTH_LINE_WIDTH,
        ),
        motionMode,
      ).toBe(true);
    }
  });

  it("renders a Warp route narrowest around its center plane", () => {
    const scene = createAtmosphereScene("matrix", 400, 240, createSeededRandom(991), 1, 0);
    const from = scene.particles[0]!;
    const to = scene.particles[1]!;
    from.x = 40;
    from.y = 0;
    to.x = 360;
    to.y = scene.height;
    const state = createMatrixActivityAnimationState();
    state.links.push({
      fromAnchorIndex: 0,
      toAnchorIndex: 1,
      operationAnchorIndex: 1,
      category: "network",
      intensity: 1,
      linePulse: 1,
      colorHue: 184,
      packetProgress: 0,
    });
    state.linkCount = 1;
    state.reducedMotion = true;

    const recording = createRecordingContext();
    drawMatrixActivityAnimation(
      recording.context,
      scene,
      state,
      0.8,
      "random",
      UNIFORM_MATRIX_FRAME,
      "tunnel",
    );
    const widths = recording.draws
      .filter((draw) => draw.kind === "stroke")
      .map((draw) => draw.lineWidth);
    expect(widths).toHaveLength(MATRIX_ACTIVITY_DEPTH_ROUTE_SEGMENTS);
    const narrowest = Math.min(...widths);
    expect(narrowest).toBeLessThan(widths[0]!);
    expect(narrowest).toBeLessThan(widths.at(-1)!);
  });

  it("staggers packets distinctly and preserves a full trail across the cyclic route boundary", () => {
    const packetProgresses = Array.from({ length: MATRIX_ACTIVITY_PACKET_COUNT }, (_, index) =>
      resolveMatrixActivityPacketProgress(0.94, index, MATRIX_ACTIVITY_PACKET_COUNT),
    );

    expect(new Set(packetProgresses.map((progress) => progress.toFixed(6))).size).toBe(
      MATRIX_ACTIVITY_PACKET_COUNT,
    );
    expect(packetProgresses[0]).toBeCloseTo(0.94);
    expect(packetProgresses[1]).toBeCloseTo(0.273333);
    expect(packetProgresses[2]).toBeCloseTo(0.606667);

    const wrapped = resolveMatrixActivityTrailIntervals(0.05);
    expect(wrapped).toHaveLength(2);
    expect(wrapped[0]!.startProgress).toBeCloseTo(0.93);
    expect(wrapped[0]!.endProgress).toBe(1);
    expect(wrapped[1]!.startProgress).toBe(0);
    expect(wrapped[1]!.endProgress).toBeCloseTo(0.05);
    expect(
      wrapped.reduce((total, interval) => total + interval.endProgress - interval.startProgress, 0),
    ).toBeCloseTo(MATRIX_ACTIVITY_PACKET_TRAIL_PROGRESS);
    const ordinary = resolveMatrixActivityTrailIntervals(0.5);
    expect(ordinary).toHaveLength(1);
    expect(ordinary[0]!.startProgress).toBeCloseTo(0.38);
    expect(ordinary[0]!.endProgress).toBe(0.5);
    const exactBoundary = resolveMatrixActivityTrailIntervals(0);
    expect(exactBoundary).toHaveLength(1);
    expect(exactBoundary[0]!.startProgress).toBeCloseTo(0.88);
    expect(exactBoundary[0]!.endProgress).toBe(1);
  });

  it("keeps repeated packet instances within the Pi-class frame budget", () => {
    expect(resolveMatrixActivityPacketCount(0)).toBe(0);
    expect(resolveMatrixActivityPacketCount(1)).toBe(MATRIX_ACTIVITY_PACKET_COUNT);
    expect(resolveMatrixActivityPacketCount(10)).toBe(MATRIX_ACTIVITY_PACKET_COUNT);
    expect(resolveMatrixActivityPacketCount(11)).toBe(MATRIX_ACTIVITY_MIN_PACKETS_PER_LINK);
    expect(resolveMatrixActivityPacketCount(MAX_MATRIX_ACTIVITY_LINKS)).toBe(
      MATRIX_ACTIVITY_MIN_PACKETS_PER_LINK,
    );
    for (let linkCount = 1; linkCount <= MAX_MATRIX_ACTIVITY_LINKS; linkCount += 1) {
      expect(linkCount * resolveMatrixActivityPacketCount(linkCount)).toBeLessThanOrEqual(
        MAX_MATRIX_ACTIVITY_PACKET_DRAWS,
      );
    }

    const scene = createAtmosphereScene("matrix", 640, 480, createSeededRandom(97), undefined, 0);
    expect(scene.particles.length).toBeGreaterThan(1);
    const state = createMatrixActivityAnimationState();
    const packetCount = resolveMatrixActivityPacketCount(MAX_MATRIX_ACTIVITY_LINKS);
    for (let index = 0; index < MAX_MATRIX_ACTIVITY_LINKS; index += 1) {
      state.links.push({
        fromAnchorIndex: 0,
        toAnchorIndex: 1,
        operationAnchorIndex: 0,
        category: "network",
        intensity: 1,
        linePulse: 1,
        colorHue: index,
        packetProgress: 0.1,
      });
    }
    state.linkCount = MAX_MATRIX_ACTIVITY_LINKS;
    const recording = createRecordingContext();
    drawMatrixActivityAnimation(
      recording.context,
      scene,
      state,
      0.8,
      "random",
      UNIFORM_MATRIX_FRAME,
    );
    expect(recording.draws.filter((draw) => draw.kind === "fill")).toHaveLength(
      MAX_MATRIX_ACTIVITY_LINKS * packetCount,
    );
    expect(recording.draws.filter((draw) => draw.kind === "fill").length).toBeLessThanOrEqual(
      MAX_MATRIX_ACTIVITY_PACKET_DRAWS,
    );
    // At progress 0.1, the first packet on every route contributes two
    // contiguous trail intervals (end -> 1, then 0 -> packet) instead of
    // snapping to a shortened trail at the origin.
    expect(recording.draws.filter((draw) => draw.kind === "stroke")).toHaveLength(
      MAX_MATRIX_ACTIVITY_LINKS * (packetCount + 2),
    );
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
      completedAt + DEFAULT_MATRIX_ACTIVITY_ROUTE_TTL_MS - MATRIX_ACTIVITY_TERMINAL_FADE_MS,
      20,
      false,
    );
    expect(state.links[0]!.intensity).toBe(1);
    updateMatrixActivityAnimationInPlace(
      state,
      events,
      completedAt + DEFAULT_MATRIX_ACTIVITY_ROUTE_TTL_MS - MATRIX_ACTIVITY_TERMINAL_FADE_MS / 2,
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
    const reducedRingGlyphs = reduced.draws.filter(
      (draw) => draw.kind === "text" && draw.maxWidth === undefined,
    );
    const laterReduced = createRecordingContext();
    updateMatrixActivityAnimationInPlace(
      state,
      events,
      now + MATRIX_ACTIVITY_LINK_PULSE_MS / 2,
      20,
      true,
    );
    drawMatrixActivityAnimation(
      laterReduced.context,
      scene,
      state,
      0.73,
      "random",
      UNIFORM_MATRIX_FRAME,
    );
    expect(laterReduced.translations).toEqual(reduced.translations);
    expect(laterReduced.rotations).toEqual(reduced.rotations);
    expect(
      laterReduced.draws
        .filter((draw) => draw.kind === "text" && draw.maxWidth === undefined)
        .map((draw) => draw.text),
    ).toEqual(reducedRingGlyphs.map((draw) => draw.text));

    const moving = createRecordingContext();
    updateMatrixActivityAnimationInPlace(state, events, now, scene.particles.length, false);
    drawMatrixActivityAnimation(moving.context, scene, state, 0.73, "random", UNIFORM_MATRIX_FRAME);
    expect(moving.draws.every((draw) => draw.style === randomColor)).toBe(true);
    expect(moving.draws.every((draw) => draw.alpha === 0.73)).toBe(true);
    expect(moving.draws.filter((draw) => draw.kind === "fill")).toHaveLength(
      MATRIX_ACTIVITY_PACKET_COUNT,
    );
    const movingStrokes = moving.draws.filter((draw) => draw.kind === "stroke");
    expect(movingStrokes).toHaveLength(1 + MATRIX_ACTIVITY_PACKET_COUNT + 2);
    expect(
      movingStrokes
        .slice(1, 1 + MATRIX_ACTIVITY_PACKET_COUNT)
        .every((draw) => draw.lineWidth > movingStrokes[0]!.lineWidth),
    ).toBe(true);
    expect(
      movingStrokes.slice(1 + MATRIX_ACTIVITY_PACKET_COUNT).map((draw) => draw.lineWidth),
    ).toEqual([1.75, 1.75]);
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
    expect(gradientPaintDraws.map((draw) => draw.kind)).toEqual([
      "stroke",
      "stroke",
      "fill",
      "stroke",
      "fill",
      "stroke",
      "fill",
    ]);
    expect(gradientPaintDraws.every((draw) => draw.alpha === 0.66)).toBe(true);
    const operationParticle = scene.particles[link.operationAnchorIndex]!;
    const operationPaint = resolveMatrixStreamColor(PER_STREAM_MATRIX_FRAME, operationParticle);
    const ringGlyphs = recording.draws.filter(
      (draw) => draw.kind === "text" && draw.maxWidth === undefined,
    );
    expect(ringGlyphs).toHaveLength(
      resolveMatrixActivityTelemetryLabel("network", operationParticle.matrixLanguage).length,
    );
    expect(ringGlyphs.every((draw) => draw.style === operationPaint)).toBe(true);
    expect(ringGlyphs.every((draw) => draw.alpha === 0.66)).toBe(true);
    expect(
      recording.draws
        .filter((draw) => draw.kind === "stroke" || draw.kind === "text")
        .map((draw) => draw.style),
    ).toEqual(expect.arrayContaining([fromColor, toColor]));
    expect(recording.draws.every((draw) => draw.style !== "#ffffff")).toBe(true);
  });

  it.each([
    ["network", "web_search"],
    ["database", "dynamic_tool_call"],
    ["agent", "collab_agent_tool_call"],
  ] as const)(
    "renders a real selected-thread %s lifecycle through the complete canvas path",
    (category, itemType) => {
      const environmentId = EnvironmentId.make("environment-render-integration");
      const threadId = ThreadId.make("thread-render-integration");
      const now = Date.parse("2026-07-23T12:00:01.000Z");
      const lifecycle = [
        activity(
          "integration-start",
          "2026-07-23T12:00:00.800Z",
          {
            itemType,
            itemId: `integration-${category}`,
            observed: { providerObserved: true, activityType: category },
          },
          "tool.started",
        ),
        activity(
          "integration-complete",
          "2026-07-23T12:00:01.000Z",
          {
            itemType,
            itemId: `integration-${category}`,
            observed: { providerObserved: true, activityType: category },
          },
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
      expect(events.every((event) => event.category === category)).toBe(true);
      expect(animation.linkCount).toBe(1);
      expect(recording.draws.filter((draw) => draw.kind === "stroke")).toHaveLength(
        1 + MATRIX_ACTIVITY_PACKET_COUNT + 2,
      );
      expect(recording.draws.filter((draw) => draw.kind === "fill")).toHaveLength(
        MATRIX_ACTIVITY_PACKET_COUNT,
      );
      expect(recording.draws.every((draw) => draw.alpha === 0.5)).toBe(true);
      expect(recording.draws.every((draw) => draw.style === UNIFORM_MATRIX_FRAME.color)).toBe(true);
    },
  );
});
