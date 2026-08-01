import type { ProjectResourcesMetric } from "@cafecode/client-runtime";
import { describe, expect, it } from "vitest";

import {
  buildProjectResourceSparklinePath,
  formatProjectResourcePercent,
  shouldRenderProjectResourceCard,
} from "./ProjectResourcesPanel.model.ts";

const available = (utilizationPercent: number): ProjectResourcesMetric => ({
  status: "available",
  utilizationPercent,
  detail: null,
});

describe("ProjectResourcesPanel model", () => {
  it("keeps measured zero distinct from unavailable", () => {
    expect(formatProjectResourcePercent(available(0))).toBe("0%");
    expect(
      formatProjectResourcePercent({
        status: "unavailable",
        utilizationPercent: null,
        detail: "Unavailable.",
      }),
    ).toBe("Unavailable");
    expect(buildProjectResourceSparklinePath([0])).toBe("M 0.00 24.00 L 0.00 24.00");
  });

  it("breaks graph paths at unavailable samples instead of drawing zeroes", () => {
    expect(buildProjectResourceSparklinePath([25, null, 75])).toBe(
      "M 0.00 18.00 L 0.00 18.00M 100.00 6.00 L 100.00 6.00",
    );
  });

  it("treats malformed available values and invalid chart geometry as unavailable", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 101]) {
      expect(formatProjectResourcePercent(available(value))).toBe("Unavailable");
      expect(shouldRenderProjectResourceCard(available(value), true)).toBe(false);
      expect(buildProjectResourceSparklinePath([25, value, 75])).toBe(
        "M 0.00 18.00 L 0.00 18.00M 100.00 6.00 L 100.00 6.00",
      );
    }
    expect(buildProjectResourceSparklinePath([50], Number.NaN, 24)).toBe("");
    expect(buildProjectResourceSparklinePath([50], 100, -1)).toBe("");
  });

  it("removes non-available cards only when the hide option is engaged", () => {
    const unavailable: ProjectResourcesMetric = {
      status: "unavailable",
      utilizationPercent: null,
      detail: "Unavailable.",
    };
    const warming: ProjectResourcesMetric = {
      status: "warming",
      utilizationPercent: null,
      detail: "Collecting a baseline.",
    };

    expect(shouldRenderProjectResourceCard(unavailable, false)).toBe(true);
    expect(shouldRenderProjectResourceCard(unavailable, true)).toBe(false);
    expect(shouldRenderProjectResourceCard(warming, true)).toBe(false);
    expect(shouldRenderProjectResourceCard(available(0), true)).toBe(true);
  });
});
