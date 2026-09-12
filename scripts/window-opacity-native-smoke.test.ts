import { describe, expect, it } from "vitest";

import {
  channelDistance,
  evaluateSmokeSteps,
  expectedBlend,
  isHostUnobservable,
  parseWindowOpacitySmokeArgs,
  selectLiveCaptureSource,
  validateRequiredSmokeSteps,
} from "./window-opacity-native-smoke.ts";

const blend = (opacity: number) => expectedBlend(opacity);

describe("parseWindowOpacitySmokeArgs", () => {
  it("defaults to the documented probe opacity and the provided output directory", () => {
    const options = parseWindowOpacitySmokeArgs([], "/tmp/out");
    expect(options.opacity).toBe(0.65);
    expect(options.outDir).toContain("out");
  });

  it("rejects an opacity outside the usable band and unknown arguments", () => {
    expect(() => parseWindowOpacitySmokeArgs(["--opacity", "0"], "/tmp/out")).toThrow();
    expect(() => parseWindowOpacitySmokeArgs(["--opacity", "2"], "/tmp/out")).toThrow();
    expect(() => parseWindowOpacitySmokeArgs(["--opacity", "1"], "/tmp/out")).toThrow();
    expect(() => parseWindowOpacitySmokeArgs(["--unknown"], "/tmp/out")).toThrow();
  });
});

it("rejects missing native observations even when compositor samples could pass", () => {
  expect(validateRequiredSmokeSteps([], 0.65)).toHaveLength(8);
  expect(
    validateRequiredSmokeSteps(
      [{ step: "startup-before-show", requested: 0.65, getOpacity: Number.NaN }],
      0.65,
    ),
  ).toContain("startup-before-show: missing, duplicate, or invalid native observation");
});

describe("expectedBlend", () => {
  it("describes a blue probe over a red backdrop", () => {
    expect(expectedBlend(1)).toEqual({ r: 0, g: 0, b: 255 });
    expect(expectedBlend(0.65)).toEqual({ r: 89, g: 0, b: 166 });
    expect(channelDistance({ r: 90, g: 2, b: 160 }, expectedBlend(0.65))).toBe(6);
  });
});

describe("selectLiveCaptureSource", () => {
  it("ignores a backend that returns the same frame for both probe states", () => {
    const stale = { r: 25, g: 139, b: 142 };
    expect(
      selectLiveCaptureSource(
        { step: "compositor-translucent", sample: stale },
        { step: "compositor-opaque-reset", sample: stale },
      ),
    ).toBeNull();
  });

  it("falls back to the GDI backend when only it observed a change", () => {
    const stale = { r: 25, g: 139, b: 142 };
    const live = selectLiveCaptureSource(
      { step: "compositor-translucent", sample: stale, gdiSample: blend(0.65) },
      { step: "compositor-opaque-reset", sample: stale, gdiSample: blend(1) },
    );
    expect(live?.source).toBe("gdi");
    expect(live?.translucent).toEqual(blend(0.65));
  });

  it("treats a capture error object as no sample", () => {
    expect(
      selectLiveCaptureSource(
        { step: "compositor-translucent", gdiSample: { error: "gdi capture failed: 1" } },
        { step: "compositor-opaque-reset", gdiSample: blend(1) },
      ),
    ).toBeNull();
  });
});

describe("evaluateSmokeSteps", () => {
  const liveSteps = [
    { step: "startup-before-show", requested: 0.65, getOpacity: 0.65 },
    { step: "compositor-translucent", requested: 0.65, getOpacity: 0.65, gdiSample: blend(0.65) },
    { step: "compositor-opaque-reset", requested: 1, getOpacity: 1, gdiSample: blend(1) },
    { step: "clamp-above-one", requested: 1.5, getOpacity: 1 },
    { step: "clamp-below-zero", requested: -1, getOpacity: 0 },
  ];

  it("passes when getOpacity matches and the composited pixels match the blend", () => {
    expect(evaluateSmokeSteps(liveSteps, 0.65)).toEqual([]);
  });

  it("reports a native value that does not match the requested opacity", () => {
    const failures = evaluateSmokeSteps(
      [...liveSteps, { step: "reapply-runtime", requested: 0.65, getOpacity: 1 }],
      0.65,
    );
    expect(failures).toEqual(["reapply-runtime: getOpacity 1 is not 0.65"]);
  });

  it("reports a window that stayed opaque on screen even though getOpacity agreed", () => {
    const failures = evaluateSmokeSteps(
      [
        { step: "compositor-translucent", requested: 0.65, getOpacity: 0.65, gdiSample: blend(1) },
        { step: "compositor-opaque-reset", requested: 1, getOpacity: 1, gdiSample: blend(0.65) },
      ],
      0.65,
    );
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("compositor-translucent (gdi)");
  });

  it("reports missing compositor evidence rather than silently passing", () => {
    const stale = { r: 25, g: 139, b: 142 };
    const failures = evaluateSmokeSteps(
      [
        { step: "compositor-translucent", requested: 0.65, getOpacity: 0.65, sample: stale },
        { step: "compositor-opaque-reset", requested: 1, getOpacity: 1, sample: stale },
      ],
      0.65,
    );
    expect(failures).toEqual([
      "compositor: no screen-capture backend returned two distinct frames, so this host produced no compositor evidence",
    ]);
  });
});

describe("isHostUnobservable", () => {
  const stale = { r: 25, g: 139, b: 142 };

  it("is true when an opaque control window never reaches any capture backend", () => {
    expect(
      isHostUnobservable([
        {
          step: "capture-liveness-backdrop",
          baseline: { desktopCapturer: stale, gdi: { r: 0, g: 0, b: 0 } },
          sample: stale,
          gdiSample: { r: 0, g: 0, b: 0 },
        },
      ]),
    ).toBe(true);
  });

  it("is false once a backend shows the opaque control window", () => {
    expect(
      isHostUnobservable([
        {
          step: "capture-liveness-backdrop",
          baseline: { desktopCapturer: stale, gdi: { r: 0, g: 0, b: 0 } },
          sample: { r: 255, g: 0, b: 0 },
          gdiSample: { r: 0, g: 0, b: 0 },
        },
      ]),
    ).toBe(false);
  });

  it("is false when no liveness step was recorded at all", () => {
    expect(isHostUnobservable([{ step: "startup-before-show", getOpacity: 0.65 }])).toBe(false);
  });
});
