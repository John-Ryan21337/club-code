export const COMPLETION_ALERT_MAX_FILES = 8;
export const COMPLETION_ALERT_MAX_BYTES = 5 * 1024 * 1024;
export const COMPLETION_ALERT_MAX_DURATION_SECONDS = 15;

const DATABASE_NAME = "cafe-code-completion-alerts";
const STORE_NAME = "files";
const DATABASE_VERSION = 1;

export interface CompletionAlertFileMetadata {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly durationSeconds: number;
  readonly addedAt: number;
}

interface CompletionAlertFileRecord extends CompletionAlertFileMetadata {
  readonly blob: Blob;
}

type DecodeDuration = (data: ArrayBuffer) => Promise<number>;

function isSupportedAudioFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    mime === "audio/mpeg" ||
    mime === "audio/mp3" ||
    mime === "audio/wav" ||
    mime === "audio/wave" ||
    mime === "audio/x-wav" ||
    name.endsWith(".mp3") ||
    name.endsWith(".wav")
  );
}

async function defaultDecodeDuration(data: ArrayBuffer): Promise<number> {
  const Context = window.AudioContext;
  if (!Context) throw new Error("This browser cannot decode local audio files.");
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(data.slice(0));
    return buffer.duration;
  } finally {
    await context.close();
  }
}

export async function inspectCompletionAlertFile(
  file: File,
  decodeDuration: DecodeDuration = defaultDecodeDuration,
): Promise<number> {
  if (!isSupportedAudioFile(file)) {
    throw new Error(`${file.name}: choose an MP3 or WAV file.`);
  }
  if (file.size === 0 || file.size > COMPLETION_ALERT_MAX_BYTES) {
    throw new Error(`${file.name}: files must be non-empty and no larger than 5 MiB.`);
  }
  let duration: number;
  try {
    duration = await decodeDuration(await file.arrayBuffer());
  } catch {
    throw new Error(`${file.name}: the audio could not be decoded.`);
  }
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > COMPLETION_ALERT_MAX_DURATION_SECONDS
  ) {
    throw new Error(`${file.name}: audio must be 15 seconds or shorter.`);
  }
  return duration;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Local completion alert storage is unavailable."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Could not open local alert storage.")),
      { once: true },
    );
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result!: T;
      request.addEventListener("success", () => {
        result = request.result;
      });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Local alert storage failed.")),
        { once: true },
      );
      transaction.addEventListener("complete", () => resolve(result), { once: true });
      transaction.addEventListener(
        "abort",
        () => reject(transaction.error ?? new Error("Local alert storage was interrupted.")),
        { once: true },
      );
      transaction.addEventListener(
        "error",
        () => reject(transaction.error ?? new Error("Local alert storage failed.")),
        { once: true },
      );
    });
  } finally {
    database.close();
  }
}

function toMetadata(record: CompletionAlertFileRecord): CompletionAlertFileMetadata {
  const { blob: _blob, ...metadata } = record;
  return metadata;
}

export async function listCompletionAlertFiles(): Promise<readonly CompletionAlertFileMetadata[]> {
  const records = await withStore<CompletionAlertFileRecord[]>("readonly", (store) =>
    store.getAll(),
  );
  return records
    .toSorted((left, right) => left.addedAt - right.addedAt || left.id.localeCompare(right.id))
    .map(toMetadata);
}

export async function addCompletionAlertFiles(
  files: readonly File[],
  decodeDuration: DecodeDuration = defaultDecodeDuration,
): Promise<readonly CompletionAlertFileMetadata[]> {
  const existing = await listCompletionAlertFiles();
  if (files.length === 0) return existing;
  if (existing.length + files.length > COMPLETION_ALERT_MAX_FILES) {
    throw new Error(`Keep at most ${COMPLETION_ALERT_MAX_FILES} custom completion alert files.`);
  }

  const inspected = await Promise.all(
    files.map(
      async (file, index): Promise<CompletionAlertFileRecord> => ({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType:
          file.type || (file.name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg"),
        size: file.size,
        durationSeconds: await inspectCompletionAlertFile(file, decodeDuration),
        addedAt: Date.now() + index,
        blob: file,
      }),
    ),
  );

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (const record of inspected) store.add(record);
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener(
        "error",
        () =>
          reject(transaction.error ?? new Error("Could not save local completion alert files.")),
        { once: true },
      );
      transaction.addEventListener(
        "abort",
        () =>
          reject(
            transaction.error ?? new Error("Saving local completion alert files was interrupted."),
          ),
        { once: true },
      );
    });
  } finally {
    database.close();
  }
  return [...existing, ...inspected.map(toMetadata)];
}

export async function removeCompletionAlertFile(id: string): Promise<void> {
  await withStore<undefined>("readwrite", (store) => store.delete(id));
}

export async function getCompletionAlertFile(id: string): Promise<Blob | null> {
  const record = await withStore<CompletionAlertFileRecord | undefined>("readonly", (store) =>
    store.get(id),
  );
  return record?.blob ?? null;
}

let cycleIndex = 0;

export async function getNextCompletionAlertFile(): Promise<Blob | null> {
  const files = await listCompletionAlertFiles();
  if (files.length === 0) {
    cycleIndex = 0;
    return null;
  }
  const selected = files[cycleIndex % files.length]!;
  cycleIndex = (cycleIndex + 1) % files.length;
  return getCompletionAlertFile(selected.id);
}

export function resetCompletionAlertFileCycleForTest(): void {
  cycleIndex = 0;
}
