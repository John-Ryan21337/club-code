import { describe, expect, it } from "vitest";

import {
  MAX_AMBIENT_IMAGE_CYCLE_TOTAL_BYTES,
  prepareAmbientImageDirectory,
} from "./ambientImageCycle";

function image(name: string, type = "image/png", size = 1, relativePath?: string): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { configurable: true, value: size });
  if (relativePath) Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

describe("prepareAmbientImageDirectory", () => {
  it("accepts supported assets in stable directory order", () => {
    const result = prepareAmbientImageDirectory([
      image("two.gif", "image/gif", 2, "set/two.gif"),
      image("one.jpg", "image/jpeg", 1, "set/one.jpg"),
      image("notes.txt", "text/plain"),
    ]);
    expect(result.files.map((file) => file.name)).toEqual(["one.jpg", "two.gif"]);
    expect(result.skippedUnsupported).toBe(1);
  });

  it("uses the original normalized path to break case-folding ties", () => {
    const lower = image("lower.png", "image/png", 1, "set/a.png");
    const upper = image("upper.png", "image/png", 1, "set/A.png");
    expect(prepareAmbientImageDirectory([lower, upper]).files.map((file) => file.name)).toEqual([
      "upper.png",
      "lower.png",
    ]);
    expect(prepareAmbientImageDirectory([upper, lower]).files.map((file) => file.name)).toEqual([
      "upper.png",
      "lower.png",
    ]);
  });

  it("fails closed for oversized counts and byte budgets", () => {
    expect(() =>
      prepareAmbientImageDirectory(Array.from({ length: 25 }, (_, index) => image(`${index}.png`))),
    ).toThrow(/at most 24 supported/);
    expect(() =>
      prepareAmbientImageDirectory(
        Array.from({ length: 24 }, (_, index) =>
          image(`${index}.png`, "image/png", MAX_AMBIENT_IMAGE_CYCLE_TOTAL_BYTES / 20),
        ),
      ),
    ).toThrow(/80 MiB total/);
  });
});
