import { describe, expect, it } from "vitest";

import { resolveAmbientImagePresetPresentation } from "./AmbientImagePanel";

describe("ambient image preset coexistence", () => {
  it("stacks the image 12px above a same-corner preset video", () => {
    expect(
      resolveAmbientImagePresetPresentation({
        pane: { width: 1_200, height: 900 },
        requestedSize: "medium",
        requestedPlacement: "bottom-left",
        aspectRatio: 1,
        stackedVideoSize: "medium",
      }),
    ).toEqual({
      width: 260,
      placement: "bottom-left",
      bottom: 298,
    });
  });

  it("steps down the image size when the requested same-corner stack is too tall", () => {
    expect(
      resolveAmbientImagePresetPresentation({
        pane: { width: 800, height: 500 },
        requestedSize: "large",
        requestedPlacement: "bottom-right",
        aspectRatio: 1,
        stackedVideoSize: "medium",
      }),
    ).toEqual({
      width: 180,
      placement: "bottom-right",
      bottom: 298,
    });
  });

  it("uses the free corner when even the smallest stack cannot stay reachable", () => {
    expect(
      resolveAmbientImagePresetPresentation({
        pane: { width: 700, height: 400 },
        requestedSize: "large",
        requestedPlacement: "bottom-left",
        aspectRatio: 1,
        stackedVideoSize: "medium",
      }),
    ).toEqual({
      width: 360,
      placement: "bottom-right",
      bottom: 12,
    });
  });

  it("does not reserve stack space when the floating video is hidden at narrow widths", () => {
    expect(
      resolveAmbientImagePresetPresentation({
        pane: { width: 639, height: 500 },
        requestedSize: "medium",
        requestedPlacement: "bottom-left",
        aspectRatio: 1,
        stackedVideoSize: "medium",
      }),
    ).toEqual({
      width: 260,
      placement: "bottom-left",
      bottom: 12,
    });
  });
});
