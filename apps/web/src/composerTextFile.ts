import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@cafecode/contracts";

export const COMPOSER_TEXT_FILE_MAX_BYTES = 256 * 1024;

const TEXT_FILE_NAME_MAX_CHARS = 255;

function isUnsafePlainTextCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x08 ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f)
  );
}

function isUnsafeFileNameCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0x5b ||
    codePoint === 0x5d
  );
}

export interface ComposerTextFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function readComposerTextFileBytes(file: ComposerTextFile): Promise<Uint8Array> {
  if (typeof FileReader === "function" && typeof Blob === "function" && file instanceof Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener(
        "error",
        () => reject(reader.error ?? new Error("Could not read text file.")),
        { once: true },
      );
      reader.addEventListener(
        "load",
        () => {
          if (!(reader.result instanceof ArrayBuffer)) {
            reject(new Error("Text file reader returned an unexpected result."));
            return;
          }
          resolve(new Uint8Array(reader.result));
        },
        { once: true },
      );
      reader.readAsArrayBuffer(file);
    });
  }
  return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

export function normalizeComposerTextFileName(name: string): string {
  const baseName = name.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const normalized = Array.from(baseName.normalize("NFC"), (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && isUnsafeFileNameCodePoint(codePoint) ? " " : character;
  })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(normalized).slice(0, TEXT_FILE_NAME_MAX_CHARS).join("") || "attachment.txt";
}

export function isComposerTextFile(file: Pick<ComposerTextFile, "name" | "type">): boolean {
  const mimeType = file.type.trim().toLowerCase();
  const mimeEssence = mimeType.split(";", 1)[0]?.trim();
  return mimeEssence === "text/plain" || file.name.trim().toLowerCase().endsWith(".txt");
}

export function decodeComposerTextFile(bytes: Uint8Array): string {
  let decoded: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    if ((bytes.byteLength - 2) % 2 !== 0) {
      throw new TypeError("Malformed UTF-16 text.");
    }
    decoded = new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    if ((bytes.byteLength - 2) % 2 !== 0) {
      throw new TypeError("Malformed UTF-16 text.");
    }
    decoded = new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
  } else {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  if (
    Array.from(decoded).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && isUnsafePlainTextCodePoint(codePoint);
    })
  ) {
    throw new TypeError("Plain-text files cannot contain binary control characters.");
  }
  return decoded;
}

export async function readComposerTextFile(file: ComposerTextFile): Promise<string> {
  const safeName = normalizeComposerTextFileName(file.name);
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error(`Could not determine a safe size for '${safeName}'.`);
  }
  if (file.size === 0) {
    throw new Error(`'${safeName}' is empty.`);
  }
  if (file.size > COMPOSER_TEXT_FILE_MAX_BYTES) {
    throw new Error(
      `'${safeName}' exceeds the ${Math.floor(
        COMPOSER_TEXT_FILE_MAX_BYTES / 1024,
      )} KiB text-file limit.`,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readComposerTextFileBytes(file);
  } catch {
    throw new Error(`Could not read '${safeName}'.`);
  }
  if (bytes.byteLength === 0) {
    throw new Error(`'${safeName}' is empty.`);
  }
  if (bytes.byteLength > COMPOSER_TEXT_FILE_MAX_BYTES) {
    throw new Error(
      `'${safeName}' exceeds the ${Math.floor(
        COMPOSER_TEXT_FILE_MAX_BYTES / 1024,
      )} KiB text-file limit.`,
    );
  }

  try {
    const decoded = decodeComposerTextFile(bytes);
    if (decoded.length === 0) {
      throw new TypeError("The text file contains only an encoding marker.");
    }
    return decoded;
  } catch {
    throw new Error(`'${safeName}' is not valid UTF-8 or BOM-marked UTF-16 plain text.`);
  }
}

export function formatComposerTextFile(name: string, text: string): string {
  const safeName = normalizeComposerTextFileName(name);
  return `[Attached text file: ${safeName}]\n${text}\n[End attached text file: ${safeName}]`;
}

export function appendComposerTextFile(input: {
  readonly prompt: string;
  readonly name: string;
  readonly text: string;
  readonly maxChars?: number;
}): string | null {
  const block = formatComposerTextFile(input.name, input.text);
  const separator = input.prompt.length > 0 ? "\n\n" : "";
  const nextPrompt = `${input.prompt}${separator}${block}`;
  if (nextPrompt.length > (input.maxChars ?? PROVIDER_SEND_TURN_MAX_INPUT_CHARS)) {
    return null;
  }
  return nextPrompt;
}
