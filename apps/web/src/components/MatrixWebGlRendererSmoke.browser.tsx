import { expect, test } from "vitest";

import { createMatrixWebGl2Renderer } from "../matrixWebGlRenderer";

test("executes the Matrix glyph shader and produces transparent-alpha coverage", () => {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  expect(gl).not.toBeNull();
  if (gl === null) return;

  const selection = createMatrixWebGl2Renderer(canvas, ["A"], {
    acquireContext: () => gl,
    createCanvas: () => document.createElement("canvas"),
    maxDevicePixelRatio: 1,
  });
  expect(selection.kind).toBe("webgl2");
  if (selection.kind !== "webgl2") return;

  const result = selection.renderer.render({
    width: 200,
    height: 100,
    devicePixelRatio: 1,
    glyphs: [
      {
        glyph: "A",
        x: 100,
        y: 50,
        fontSizePx: 48,
        scale: 1,
        opacity: 0.8,
        color: { red: 0, green: 1, blue: 0, alpha: 1 },
      },
    ],
  });
  expect(result.status).toBe("rendered");
  gl.finish();

  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let coveredPixels = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index]! > 0) coveredPixels += 1;
  }
  expect(coveredPixels).toBeGreaterThan(20);
  selection.renderer.dispose();
});
