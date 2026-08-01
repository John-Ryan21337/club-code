import { describe, expect, it, vi } from "vitest";

import {
  MAX_ATMOSPHERE_DPR,
  MAX_ATMOSPHERE_CANVAS_PIXELS,
  MAX_ATMOSPHERE_FRAME_DELTA_SECONDS,
  MAX_ATMOSPHERE_PARTICLES_BY_KIND,
  MAX_MATRIX_TOKEN_WIDTH_PX,
  MATRIX_2CH_AA_TOKENS,
  MATRIX_2CH_ENRICHED_GLYPHS,
  MATRIX_JAPANESE_CODING_AI_TERMS,
  MATRIX_JAPANESE_GLYPHS,
  MATRIX_MAX_UNIFORM_RAINBOW_SPEED,
  MATRIX_RAINBOW_CYCLE_MS,
  MATRIX_ROMAN_GLYPHS,
  advanceAtmosphereSceneInPlace,
  applyMatrixWorkVocabularyInPlace,
  calculateAtmosphereParticleCount,
  clampAtmosphereDpr,
  clampFallingEffectDensity,
  clampMatrixColorCycleSpeed,
  fitAtmosphereDpr,
  createAtmosphereScene,
  createMatrixColorAnimationState,
  createSeededRandom,
  drawAtmosphereScene,
  resolveAtmosphereColor,
  resolveMatrixAtmosphereColor,
  resolveMatrixAtmosphereColorFrame,
  resolveMatrixStreamColor,
  shouldAnimateAtmosphere,
} from "./windowAtmosphere";
import {
  EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL,
  type LocalMediaAudioSignal,
} from "./localMediaAudioSignal";

function audioSignal(overrides: Partial<LocalMediaAudioSignal> = {}): LocalMediaAudioSignal {
  return {
    ...EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL,
    ...overrides,
  };
}

describe("window atmosphere", () => {
  it("builds deterministic scenes from a seeded random source", () => {
    const first = createAtmosphereScene("snow", 1_280, 720, createSeededRandom(42));
    const second = createAtmosphereScene("snow", 1_280, 720, createSeededRandom(42));
    const different = createAtmosphereScene("snow", 1_280, 720, createSeededRandom(43));

    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
  });

  it("bounds DPR and density-scaled particle counts", () => {
    expect(clampAtmosphereDpr(0)).toBe(1);
    expect(clampAtmosphereDpr(1.5)).toBe(1.5);
    expect(clampAtmosphereDpr(8)).toBe(MAX_ATMOSPHERE_DPR);
    expect(fitAtmosphereDpr(8, 1_000, 1_000)).toBe(MAX_ATMOSPHERE_DPR);
    expect(fitAtmosphereDpr(2, 8_000, 4_000) ** 2 * 8_000 * 4_000).toBeLessThanOrEqual(
      MAX_ATMOSPHERE_CANVAS_PIXELS,
    );

    expect(calculateAtmosphereParticleCount("snow", 0, 720)).toBe(0);
    expect(calculateAtmosphereParticleCount("snow", 1_280, 720, 0.5)).toBe(33);
    expect(calculateAtmosphereParticleCount("snow", 1_280, 720, 2.5)).toBe(165);
    expect(calculateAtmosphereParticleCount("snow", 20_000, 20_000, 2.5)).toBe(
      MAX_ATMOSPHERE_PARTICLES_BY_KIND.snow,
    );
    expect(calculateAtmosphereParticleCount("rain", 20_000, 20_000, 2.5)).toBe(
      MAX_ATMOSPHERE_PARTICLES_BY_KIND.rain,
    );
    expect(calculateAtmosphereParticleCount("matrix", 20_000, 20_000, 2.5)).toBe(
      MAX_ATMOSPHERE_PARTICLES_BY_KIND.matrix,
    );
    expect(clampFallingEffectDensity(Number.NaN)).toBe(1);
    expect(clampFallingEffectDensity(99)).toBe(2.5);
  });

  it("deterministically applies the Japanese ratio, including authoritative endpoints", () => {
    const romanOnly = createAtmosphereScene("matrix", 20_000, 720, createSeededRandom(7), 1, 0);
    const japaneseOnly = createAtmosphereScene("matrix", 20_000, 720, createSeededRandom(7), 1, 1);
    const mixed = createAtmosphereScene("matrix", 20_000, 720, createSeededRandom(7));
    const repeatedMixed = createAtmosphereScene("matrix", 20_000, 720, createSeededRandom(7));

    expect(romanOnly.particles).toHaveLength(MAX_ATMOSPHERE_PARTICLES_BY_KIND.matrix);
    expect(romanOnly.particles.every((particle) => particle.glyphs === MATRIX_ROMAN_GLYPHS)).toBe(
      true,
    );
    expect(romanOnly.particles.every((particle) => particle.matrixToken === null)).toBe(true);
    expect(romanOnly.particles.every((particle) => particle.matrixLanguage === "english")).toBe(
      true,
    );
    expect(
      japaneseOnly.particles.every((particle) => particle.glyphs === MATRIX_JAPANESE_GLYPHS),
    ).toBe(true);
    expect(japaneseOnly.particles.every((particle) => particle.matrixLanguage === "japanese")).toBe(
      true,
    );
    expect(mixed).toEqual(repeatedMixed);
    expect(mixed.particles.some((particle) => particle.glyphs === MATRIX_ROMAN_GLYPHS)).toBe(true);
    expect(mixed.particles.some((particle) => particle.glyphs === MATRIX_JAPANESE_GLYPHS)).toBe(
      true,
    );
  });

  it("keeps the reviewed Japanese coding and AI vocabulary in the decorative pool", () => {
    expect(MATRIX_JAPANESE_CODING_AI_TERMS).toEqual([
      "電脳",
      "機械",
      "知能",
      "学習",
      "推論",
      "生成",
      "言語",
      "符号",
      "解析",
      "演算",
      "回路",
      "未来",
      "創造",
      "対話",
      "探索",
      "深層",
      "神経",
      "仮想",
      "現実",
      "夢",
      "夜",
      "光",
      "影",
      "零",
      "無限",
    ]);
    for (const term of MATRIX_JAPANESE_CODING_AI_TERMS) {
      expect(MATRIX_JAPANESE_GLYPHS).toContain(term);
    }
    expect(MATRIX_JAPANESE_GLYPHS).not.toMatch(/\s/u);
  });

  it("uses the language ratio for opt-in work terms and refreshes them without moving columns", () => {
    const englishOnly = createAtmosphereScene(
      "matrix",
      20_000,
      720,
      createSeededRandom(17),
      1,
      0,
      false,
      { english: ["BUILD"], japanese: ["構築"] },
    );
    const japaneseOnly = createAtmosphereScene(
      "matrix",
      20_000,
      720,
      createSeededRandom(17),
      1,
      1,
      false,
      { english: ["BUILD"], japanese: ["構築"] },
    );

    expect(
      englishOnly.particles
        .map((particle) => particle.matrixWorkToken)
        .filter((token): token is string => token !== null),
    ).toEqual(expect.arrayContaining(["BUILD"]));
    expect(englishOnly.particles.some((particle) => particle.matrixWorkToken === "構築")).toBe(
      false,
    );
    expect(
      japaneseOnly.particles
        .map((particle) => particle.matrixWorkToken)
        .filter((token): token is string => token !== null),
    ).toEqual(expect.arrayContaining(["構築"]));
    expect(japaneseOnly.particles.some((particle) => particle.matrixWorkToken === "BUILD")).toBe(
      false,
    );

    const positions = englishOnly.particles.map(({ x, y }) => ({ x, y }));
    applyMatrixWorkVocabularyInPlace(
      englishOnly,
      { english: ["TEST"], japanese: ["試験"] },
      () => 0,
    );
    expect(englishOnly.particles.every((particle) => particle.matrixWorkToken === "TEST")).toBe(
      true,
    );
    expect(englishOnly.particles.map(({ x, y }) => ({ x, y }))).toEqual(positions);
  });

  it("keeps 2ch enrichment off by default and preserves reviewed cat AA tokens intact", () => {
    expect(MATRIX_2CH_AA_TOKENS).toEqual([
      "∧＿∧",
      "( ´∀｀)",
      "(・∀・)",
      "(=ﾟωﾟ)ﾉ",
      "（´・ω・｀）",
      "∧∧",
      "(,,ﾟДﾟ)",
    ]);
    const withoutEnrichment = createAtmosphereScene(
      "matrix",
      20_000,
      720,
      createSeededRandom(9),
      1,
      1,
      false,
    );
    const enriched = createAtmosphereScene(
      "matrix",
      20_000,
      720,
      createSeededRandom(9),
      1,
      1,
      true,
    );
    const ratioDisablesEnrichment = createAtmosphereScene(
      "matrix",
      20_000,
      720,
      createSeededRandom(9),
      1,
      0,
      true,
    );
    const selectedTokens = enriched.particles
      .map((particle) => particle.matrixToken)
      .filter((token): token is (typeof MATRIX_2CH_AA_TOKENS)[number] => token !== null);

    expect(
      withoutEnrichment.particles.every((particle) => particle.glyphs === MATRIX_JAPANESE_GLYPHS),
    ).toBe(true);
    expect(withoutEnrichment.particles.every((particle) => particle.matrixToken === null)).toBe(
      true,
    );
    expect(
      enriched.particles.every((particle) => particle.glyphs === MATRIX_2CH_ENRICHED_GLYPHS),
    ).toBe(true);
    expect(selectedTokens.length).toBeGreaterThan(0);
    expect(selectedTokens.every((token) => MATRIX_2CH_AA_TOKENS.includes(token))).toBe(true);
    expect(
      ratioDisablesEnrichment.particles.every(
        (particle) => particle.glyphs === MATRIX_ROMAN_GLYPHS,
      ),
    ).toBe(true);
    expect(
      ratioDisablesEnrichment.particles.every((particle) => particle.matrixToken === null),
    ).toBe(true);

    const fillText = vi.fn();
    const context = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D;
    drawAtmosphereScene(context, enriched, "#4ade80", 0.35);
    const renderedText = fillText.mock.calls.map(([text]) => text);
    for (const token of selectedTokens) {
      expect(renderedText).toContain(token);
    }
    expect(renderedText.filter((text) => MATRIX_2CH_AA_TOKENS.includes(text)).length).toBe(
      selectedTokens.length,
    );
    expect(fillText.mock.calls.every((call) => call[3] === MAX_MATRIX_TOKEN_WIDTH_PX)).toBe(true);
  });

  it("caps long frame gaps and applies the speed multiplier", () => {
    const scene = createAtmosphereScene("rain", 800, 600, createSeededRandom(7));
    const particle = scene.particles[0]!;
    particle.y = 0;
    const initialY = particle.y;
    const velocityY = particle.velocityY;

    advanceAtmosphereSceneInPlace(scene, 30, 2);

    expect(particle.y - initialY).toBeCloseTo(velocityY * MAX_ATMOSPHERE_FRAME_DELTA_SECONDS * 2);
  });

  it("resolves conservative automatic colors while preserving explicit colors", () => {
    expect(resolveAtmosphereColor("snow", "auto", true)).toBe("#f8fafc");
    expect(resolveAtmosphereColor("rain", "auto", false)).toBe("#0369a1");
    expect(resolveAtmosphereColor("matrix", "auto", true)).toBe("#4ade80");
    expect(resolveAtmosphereColor("matrix", "#123abc", true)).toBe("#123abc");
  });

  it("keeps fixed color backward-compatible and cycles rainbow on the existing frame clock", () => {
    const state = createMatrixColorAnimationState();
    const noSignal = audioSignal();

    expect(resolveMatrixAtmosphereColor("fixed", "#123abc", true, 100, noSignal, state)).toBe(
      "#123abc",
    );
    expect(resolveMatrixAtmosphereColor("rainbow", "auto", true, 0, noSignal, state)).toBe(
      "hsl(0.0 88.0% 62.0%)",
    );
    expect(
      resolveMatrixAtmosphereColor(
        "rainbow",
        "auto",
        true,
        MATRIX_RAINBOW_CYCLE_MS / 2,
        noSignal,
        state,
      ),
    ).toBe("hsl(180.0 88.0% 62.0%)");
  });

  it("scales Matrix hue motion independently from falling motion up to a bounded shimmer rate", () => {
    const noSignal = audioSignal();
    const timestamp = MATRIX_RAINBOW_CYCLE_MS / 8;

    expect(
      resolveMatrixAtmosphereColor(
        "rainbow",
        "auto",
        true,
        timestamp,
        noSignal,
        createMatrixColorAnimationState(),
      ),
    ).toBe("hsl(45.0 88.0% 62.0%)");
    expect(
      resolveMatrixAtmosphereColor(
        "rainbow",
        "auto",
        true,
        timestamp,
        noSignal,
        createMatrixColorAnimationState(),
        4,
      ),
    ).toBe("hsl(180.0 88.0% 62.0%)");
    expect(
      resolveMatrixAtmosphereColor(
        "rainbow",
        "auto",
        true,
        MATRIX_RAINBOW_CYCLE_MS / (64 * 2),
        noSignal,
        createMatrixColorAnimationState(),
        64,
      ),
    ).toBe("hsl(180.0 88.0% 62.0%)");
    expect(
      resolveMatrixAtmosphereColorFrame(
        "rainbow",
        "auto",
        true,
        MATRIX_RAINBOW_CYCLE_MS / (64 * 2),
        noSignal,
        createMatrixColorAnimationState(),
        64,
      ).perStream,
    ).toBe(true);
    expect(
      resolveMatrixAtmosphereColorFrame(
        "rainbow",
        "auto",
        true,
        MATRIX_RAINBOW_CYCLE_MS / (MATRIX_MAX_UNIFORM_RAINBOW_SPEED * 2),
        noSignal,
        createMatrixColorAnimationState(),
        MATRIX_MAX_UNIFORM_RAINBOW_SPEED,
      ).perStream,
    ).toBe(false);
    expect(clampMatrixColorCycleSpeed(Number.NaN)).toBe(1);
    expect(clampMatrixColorCycleSpeed(0)).toBe(0.25);
    expect(clampMatrixColorCycleSpeed(1_000)).toBe(64);
  });

  it("scales music-reactive continuous hue drift without multiplying beat impulses", () => {
    const signal = audioSignal({
      active: true,
      level: 0.1,
      bass: 0.1,
      mid: 0.05,
      treble: 0.02,
      beat: 0,
      sampledAt: 1_000,
    });
    const hueDeltaAt = (cycleSpeed: number): number => {
      const state = createMatrixColorAnimationState();
      const first = resolveMatrixAtmosphereColorFrame(
        "music-reactive",
        "auto",
        true,
        1_000,
        signal,
        state,
        cycleSpeed,
      );
      const second = resolveMatrixAtmosphereColorFrame(
        "music-reactive",
        "auto",
        true,
        1_100,
        signal,
        state,
        cycleSpeed,
      );
      return (second.baseHue! - first.baseHue! + 360) % 360;
    };

    expect(hueDeltaAt(4)).toBeCloseTo(hueDeltaAt(1) * 4);
  });

  it("caps high-speed music hue motion after applying the shimmer multiplier", () => {
    const signal = audioSignal({
      active: true,
      level: 1,
      bass: 1,
      mid: 1,
      treble: 1,
      beat: 0,
      sampledAt: 1_000,
    });
    const state = createMatrixColorAnimationState();
    const first = resolveMatrixAtmosphereColorFrame(
      "music-reactive",
      "auto",
      true,
      1_000,
      signal,
      state,
      64,
    );
    const second = resolveMatrixAtmosphereColorFrame(
      "music-reactive",
      "auto",
      true,
      1_100,
      signal,
      state,
      64,
    );
    const hueDelta = (second.baseHue! - first.baseHue! + 360) % 360;

    expect(hueDelta).toBeLessThanOrEqual(11.000_001);
  });

  it("gives Rainbow Extra streams deterministic independent hue phases", () => {
    const scene = createAtmosphereScene("matrix", 640, 480, createSeededRandom(19));
    const firstParticle = scene.particles[0]!;
    const secondParticle = scene.particles[1]!;
    const state = createMatrixColorAnimationState();
    const frame = resolveMatrixAtmosphereColorFrame(
      "rainbow-extra",
      "auto",
      true,
      4_500,
      audioSignal(),
      state,
    );
    const repeated = resolveMatrixAtmosphereColorFrame(
      "rainbow-extra",
      "auto",
      true,
      4_500,
      audioSignal(),
      createMatrixColorAnimationState(),
    );

    expect(frame.perStream).toBe(true);
    expect(resolveMatrixStreamColor(frame, firstParticle)).toBe(
      resolveMatrixStreamColor(repeated, firstParticle),
    );
    expect(resolveMatrixStreamColor(frame, firstParticle)).not.toBe(
      resolveMatrixStreamColor(frame, secondParticle),
    );
    const uniform = resolveMatrixAtmosphereColorFrame(
      "rainbow",
      "auto",
      true,
      4_500,
      audioSignal(),
      createMatrixColorAnimationState(),
    );
    expect(resolveMatrixStreamColor(uniform, firstParticle)).toBe(uniform.color);
    expect(resolveMatrixStreamColor(uniform, secondParticle)).toBe(uniform.color);
  });

  it("reacts only to fresh non-quiet approved audio features and caps palette motion", () => {
    const state = createMatrixColorAnimationState();
    expect(
      resolveMatrixAtmosphereColor(
        "music-reactive",
        "#123abc",
        true,
        2_000,
        audioSignal({ active: true, level: 1, bass: 1, sampledAt: 100 }),
        state,
      ),
    ).toBe("#123abc");
    expect(
      resolveMatrixAtmosphereColor(
        "music-reactive",
        "#123abc",
        true,
        2_000,
        audioSignal({ active: true, sampledAt: 2_000 }),
        state,
      ),
    ).toBe("#123abc");

    const first = resolveMatrixAtmosphereColor(
      "music-reactive",
      "auto",
      true,
      3_000,
      audioSignal({
        active: true,
        level: 0.1,
        bass: 0.1,
        mid: 0.05,
        treble: 0.02,
        sampledAt: 3_000,
      }),
      state,
    );
    const second = resolveMatrixAtmosphereColor(
      "music-reactive",
      "auto",
      true,
      3_100,
      audioSignal({
        active: true,
        level: 1,
        bass: 1,
        mid: 0.8,
        treble: 0.6,
        sampledAt: 3_100,
      }),
      state,
    );
    const firstHue = Number(/^hsl\(([\d.]+)/.exec(first)?.[1]);
    const secondHue = Number(/^hsl\(([\d.]+)/.exec(second)?.[1]);
    const hueDelta = Math.abs(((secondHue - firstHue + 540) % 360) - 180);
    expect(Number.isFinite(firstHue)).toBe(true);
    expect(hueDelta).toBeLessThanOrEqual(11.1);
  });

  it("cycles uniform and per-stream reactive palettes with bands and one-shot beats", () => {
    const signal = audioSignal({
      active: true,
      level: 0.65,
      bass: 0.8,
      mid: 0.5,
      treble: 0.25,
      beat: 0.9,
      sampledAt: 1_000,
    });
    const uniformState = createMatrixColorAnimationState();
    const first = resolveMatrixAtmosphereColorFrame(
      "music-reactive",
      "auto",
      true,
      1_000,
      signal,
      uniformState,
    );
    const second = resolveMatrixAtmosphereColorFrame(
      "music-reactive",
      "auto",
      true,
      1_016,
      signal,
      uniformState,
    );
    const nextBeat = resolveMatrixAtmosphereColorFrame(
      "music-reactive",
      "auto",
      true,
      1_033,
      { ...signal, sampledAt: 1_033 },
      uniformState,
    );
    expect(first.color).not.toBe(second.color);
    expect(nextBeat.baseHue! - second.baseHue!).toBeGreaterThan(10);

    const extra = resolveMatrixAtmosphereColorFrame(
      "music-reactive-extra",
      "auto",
      true,
      1_000,
      signal,
      createMatrixColorAnimationState(),
    );
    const scene = createAtmosphereScene("matrix", 640, 480, createSeededRandom(23));
    expect(extra.perStream).toBe(true);
    expect(resolveMatrixStreamColor(extra, scene.particles[0]!)).not.toBe(
      resolveMatrixStreamColor(extra, scene.particles[1]!),
    );

    const stale = resolveMatrixAtmosphereColorFrame(
      "music-reactive-extra",
      "#123abc",
      true,
      2_000,
      signal,
      uniformState,
    );
    expect(stale).toMatchObject({ color: "#123abc", perStream: false, baseHue: null });
  });

  it("stops for reduced motion and pauses in the background unless explicitly allowed", () => {
    const foreground = {
      enabled: true,
      reducedMotion: false,
      documentVisible: true,
      windowFocused: true,
      continueBackgroundAnimations: false,
    };

    expect(shouldAnimateAtmosphere(foreground)).toBe(true);
    expect(shouldAnimateAtmosphere({ ...foreground, enabled: false })).toBe(false);
    expect(shouldAnimateAtmosphere({ ...foreground, reducedMotion: true })).toBe(false);
    expect(shouldAnimateAtmosphere({ ...foreground, windowFocused: false })).toBe(false);
    expect(
      shouldAnimateAtmosphere({
        ...foreground,
        documentVisible: false,
        windowFocused: false,
        continueBackgroundAnimations: true,
      }),
    ).toBe(true);
    expect(
      shouldAnimateAtmosphere({
        ...foreground,
        reducedMotion: true,
        continueBackgroundAnimations: true,
      }),
    ).toBe(false);
  });
});
