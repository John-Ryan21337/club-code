import path from "node:path";

import englishData from "@tesseract.js-data/eng";
import japaneseData from "@tesseract.js-data/jpn";
import {
  EMBEDDED_BROWSER_MAX_SNAPSHOT_TEXT_CHARS,
  EMBEDDED_BROWSER_OCR_MAX_INPUT_EDGE,
  EMBEDDED_BROWSER_OCR_MAX_INPUT_PIXELS,
  EMBEDDED_BROWSER_OCR_MAX_PNG_BYTES,
} from "@cafecode/contracts";
import Tesseract from "tesseract.js";

type OcrLanguage = "eng" | "jpn";

const languagePaths: Readonly<Record<OcrLanguage, string>> = {
  eng: englishData.langPath,
  jpn: japaneseData.langPath,
};

function fail(): never {
  process.exitCode = 1;
  throw new Error("Invalid bounded OCR worker input.");
}

async function readBoundedStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const rawChunk of process.stdin) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      total += chunk.byteLength;
      if (total > EMBEDDED_BROWSER_OCR_MAX_PNG_BYTES) fail();
      chunks.push(chunk);
    }
    if (total < 1) fail();
    const png = Buffer.concat(chunks, total);
    for (const chunk of chunks) chunk.fill(0);
    chunks.length = 0;
    return png;
  } catch (error) {
    for (const chunk of chunks) chunk.fill(0);
    throw error;
  }
}

async function main(): Promise<void> {
  const language = process.argv[2] === "jpn" ? "jpn" : process.argv[2] === "eng" ? "eng" : fail();
  const width = Number(process.argv[3]);
  const height = Number(process.argv[4]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > EMBEDDED_BROWSER_OCR_MAX_INPUT_EDGE ||
    height > EMBEDDED_BROWSER_OCR_MAX_INPUT_EDGE ||
    width * height > EMBEDDED_BROWSER_OCR_MAX_INPUT_PIXELS
  ) {
    fail();
  }
  const languagePath = languagePaths[language];
  if (!path.isAbsolute(languagePath) || /^https?:/iu.test(languagePath)) fail();

  const png = await readBoundedStdin();
  let worker: Tesseract.Worker | undefined;
  try {
    worker = await Tesseract.createWorker(language, Tesseract.OEM.LSTM_ONLY, {
      langPath: languagePath,
      gzip: true,
      cacheMethod: "none",
      logger: () => undefined,
      errorHandler: () => undefined,
    });
    const recognized = await worker.recognize(png, {}, { text: true });
    const text =
      typeof recognized.data.text === "string"
        ? recognized.data.text.slice(0, EMBEDDED_BROWSER_MAX_SNAPSHOT_TEXT_CHARS + 1)
        : "";
    const confidence = Number.isFinite(recognized.data.confidence) ? recognized.data.confidence : 0;
    process.stdout.write(JSON.stringify({ text, confidence }));
  } finally {
    png.fill(0);
    await worker?.terminate().catch(() => undefined);
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
