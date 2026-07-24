import { EventId, type OrchestrationThreadActivity } from "@cafecode/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  MATRIX_ACTIVITY_LINK_PULSE_MS,
  MATRIX_ACTIVITY_TTL_MS,
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
  updateMatrixActivityAnimationInPlace,
} from "./matrixActivityOverlay";
import {
  createAtmosphereScene,
  createSeededRandom,
  type MatrixColorFrame,
} from "./windowAtmosphere";

function activity(
  id: string,
  createdAt: string,
  payload: Record<string, unknown>,
  kind = "tool.completed",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "tool",
    kind,
    summary: "This summary is never projected",
    payload,
    turnId: null,
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
      /curl|password|example|token|hunter2|SELECT|secret|credential|tool-network/iu,
    );
    expect(decodeMatrixActivityEvents(encoded)).toEqual(events);
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

  it("pulsates real link lines without animation state and keeps reduced motion static", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
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

    const reducedMotionSamples = [0, MATRIX_ACTIVITY_LINK_PULSE_MS / 2].map((offset) => {
      updateMatrixActivityAnimationInPlace(state, events, now + offset, 20, true);
      return state.links[0]!.linePulse;
    });
    expect(reducedMotionSamples).toEqual([1, 1]);
    expect(state.links[0]!.intensity).toBeLessThan(0.18);
  });

  it("keeps reduced-motion routes dim and static and switches random/matrix colors", () => {
    const now = Date.parse("2026-07-23T12:00:01.000Z");
    const events = deriveMatrixActivityEvents([
      activity("start", "2026-07-23T12:00:00.700Z", {
        itemType: "build",
        itemId: "shared-build",
      }),
      activity("finish", "2026-07-23T12:00:00.900Z", {
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
    expect(state.links[0]!.intensity).toBeLessThan(0.18);

    const scene = createAtmosphereScene("matrix", 640, 480, createSeededRandom(31), undefined, 0);
    const strokes: string[] = [];
    const fills: string[] = [];
    const terms: string[] = [];
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clip: vi.fn(),
      fill: vi.fn(function (this: { fillStyle: string }) {
        fills.push(this.fillStyle);
      }),
      fillStyle: "",
      fillText: vi.fn((term: string) => {
        terms.push(term);
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
      stroke: vi.fn(function (this: { strokeStyle: string }) {
        strokes.push(this.strokeStyle);
      }),
      strokeStyle: "",
      textAlign: "",
      textBaseline: "",
    } as unknown as CanvasRenderingContext2D;

    drawMatrixActivityAnimation(context, scene, state, 0.8, "random", UNIFORM_MATRIX_FRAME);
    expect(strokes.length).toBeGreaterThan(0);
    expect(fills).not.toContain("#ffffff");
    strokes.length = 0;
    fills.length = 0;

    updateMatrixActivityAnimationInPlace(state, events, now, scene.particles.length, false);
    drawMatrixActivityAnimation(context, scene, state, 0.8, "random", UNIFORM_MATRIX_FRAME);
    expect(strokes.some((color) => color.startsWith("hsl("))).toBe(true);
    expect(fills).toContain("#ffffff");
    expect(terms).toContain("BUILD");
    expect(terms).toContain("COMPILE");

    strokes.length = 0;
    drawMatrixActivityAnimation(context, scene, state, 0.8, "matrix", UNIFORM_MATRIX_FRAME);
    expect(strokes).toContain(UNIFORM_MATRIX_FRAME.color);
    expect(strokes).toContain("#ffffff");
  });
});
