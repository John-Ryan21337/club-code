import { MAX_AMBIENT_IMAGE_FILE_BYTES } from "@cafecode/contracts/settings";

export const tinyPng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  ),
);

export const tinyGif = Uint8Array.from(
  Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
);

export const gifWithEncodedSize = (sizeBytes: number, fillByte = 0x61): Uint8Array => {
  const prefix = tinyGif.subarray(0, tinyGif.byteLength - 1);
  if (sizeBytes < tinyGif.byteLength + 5) {
    throw new Error("Padded GIF fixture must have room for a comment extension.");
  }

  const bytes = new Uint8Array(sizeBytes);
  bytes.set(prefix);
  let offset = prefix.byteLength;
  bytes[offset++] = 0x21;
  bytes[offset++] = 0xfe;

  // A GIF data sub-block contributes one length byte plus 1..255 data bytes.
  // Avoid leaving a one-byte remainder, which cannot form a valid sub-block.
  let subBlockBudget = sizeBytes - offset - 2;
  while (subBlockBudget > 0) {
    let blockBytes = Math.min(256, subBlockBudget);
    if (subBlockBudget - blockBytes === 1) blockBytes -= 1;
    if (blockBytes < 2) throw new Error("Invalid padded GIF fixture budget.");
    bytes[offset++] = blockBytes - 1;
    bytes.fill(fillByte, offset, offset + blockBytes - 1);
    offset += blockBytes - 1;
    subBlockBudget -= blockBytes;
  }
  bytes[offset++] = 0;
  bytes[offset++] = 0x3b;
  if (offset !== sizeBytes) throw new Error("Padded GIF fixture has the wrong encoded size.");
  return bytes;
};

export const oversizedGif = (): Uint8Array => gifWithEncodedSize(MAX_AMBIENT_IMAGE_FILE_BYTES + 1);

export const tinyWebp = Uint8Array.from(
  Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"),
);

export const tinyJpeg = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
    "base64",
  ),
);
