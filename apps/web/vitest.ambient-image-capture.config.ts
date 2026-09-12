import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig, type UserConfig } from "vitest/config";

import browserConfig from "./vitest.browser.config";

/**
 * Media-capture harness for `docs/pr-assets/ambient-images/`.
 *
 * This is deliberately *not* on the test path (`vitest.browser.config.ts` only
 * globs `src/components/**\/*.browser.tsx`): it renders the real
 * `AmbientImageSettingsSection` and the real `AmbientImageLayer` inside a mock
 * app shell, writes PNG stills and records a WebM of the interaction.
 *
 * Everything the capture "uploads" is synthetic. The ambient-media route is
 * answered here by a middleware that generates a labelled gradient from the
 * requested content-addressed id; no user file and no real Cafe backend is
 * involved. See `docs/pr-assets/ambient-images/README.md`.
 */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const videoDir = fileURLToPath(
  new URL("../../docs/pr-assets/ambient-images/raw-video", import.meta.url),
);
mkdirSync(videoDir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
};

const pngChunk = (type: string, payload: Uint8Array) => {
  const body = new Uint8Array(type.length + payload.length);
  body.set(
    [...type].map((character) => character.charCodeAt(0)),
    0,
  );
  body.set(payload, type.length);
  const chunk = new Uint8Array(body.length + 8);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(body, 4);
  view.setUint32(chunk.length - 4, crc32(body));
  return chunk;
};

/**
 * Minimal truecolour PNG encoder. The pattern is derived from the requested
 * asset id so each synthetic image is visually distinct and reproducible.
 */
const syntheticPng = (id: string, width = 960, height = 600) => {
  let seed = 0;
  for (const character of id) seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  const hue = seed % 360;
  const raw = new Uint8Array((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      const diagonal = ((x + y) % 160) / 160;
      const angle = ((hue + diagonal * 120) * Math.PI) / 180;
      const stripe = (x + y) % 160 < 12 ? 0.55 : 1;
      raw[offset++] = Math.round((Math.sin(angle) * 0.5 + 0.5) * 210 * stripe) + 20;
      raw[offset++] = Math.round((Math.sin(angle + 2.1) * 0.5 + 0.5) * 210 * stripe) + 20;
      raw[offset++] = Math.round((Math.sin(angle + 4.2) * 0.5 + 0.5) * 210 * stripe) + 20;
    }
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  const chunks = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
    pngChunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) {
    png.set(chunk, cursor);
    cursor += chunk.length;
  }
  return png;
};

const captureConfig: UserConfig = mergeConfig(
  browserConfig,
  defineConfig({
    plugins: [
      {
        name: "cafe-synthetic-ambient-media",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const [path] = (request.url ?? "").split("?");
            if (!path?.startsWith("/api/ambient-media/image/")) return next();
            const png = syntheticPng(path.slice("/api/ambient-media/image/".length));
            response.setHeader("content-type", "image/png");
            response.setHeader("cache-control", "no-store");
            response.end(Buffer.from(png));
          });
        },
      },
    ],
    server: { fs: { allow: [repoRoot] } },
    test: {
      browser: {
        viewport: { width: 1280, height: 800 },
        provider: playwright({
          contextOptions: {
            viewport: { width: 1280, height: 800 },
            recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
          },
        }),
      },
    },
  }),
);

// `mergeConfig` concatenates arrays, so the test glob has to be replaced
// outright: merging would keep `src/components/**\/*.browser.tsx` and run the
// whole browser suite alongside the capture.
captureConfig.test = {
  ...captureConfig.test,
  include: ["src/components/ambient/ambientImageMedia.capture.tsx"],
};

export default captureConfig;
