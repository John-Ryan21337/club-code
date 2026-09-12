import "../../index.css";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ClientSettings,
  type LocalApi,
  type ServerConfig,
} from "@cafecode/contracts";
import type { AmbientImageAsset } from "@cafecode/contracts/settings";
import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetLocalApiForTests } from "../../localApi";
import { AppAtomRegistryProvider, resetAppAtomRegistryForTests } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { AmbientImageSettingsSection } from "./AmbientImageSettings";

/**
 * Real-DOM coverage for the ambient image settings section.
 *
 * Everything here is synthetic: the `File` objects are built in the test (no
 * user file ever touches this suite, and no OS picker is opened — the hidden
 * inputs are driven directly), and the Cafe HTTP surface is a fake backend that
 * answers upload/delete over a stubbed `fetch` while `updateClientSettings` is
 * a mock that keeps one in-memory settings document.
 *
 * What is *not* synthetic is the sequencing under test: uploads, the confirmed
 * settings write and the follow-up deletes are recorded in call order, because
 * the ordering is the contract. Uploading writes bytes before anything
 * references them, and the server refuses to delete bytes the settings document
 * still references — so a settings write that is fired and forgotten either
 * strands bytes nothing points at or reports a success that never happened.
 */
const assetIdFor = (hexSeed: string, extension: "png" | "gif") =>
  `sha256-${hexSeed.repeat(64).slice(0, 64)}.${extension}`;

const assetFor = (hexSeed: string, extension: "png" | "gif" = "png"): AmbientImageAsset => {
  const id = assetIdFor(hexSeed, extension);
  return {
    id,
    url: `/api/ambient-media/image/${id}`,
    mimeType: extension === "gif" ? "image/gif" : "image/png",
    width: 64,
    height: 64,
    sizeBytes: 1024,
  } as AmbientImageAsset;
};

const firstAsset = assetFor("a");
const secondAsset = assetFor("b");
const existingAsset = assetFor("c");

/** Synthetic bytes only — never a real user file. */
const syntheticFile = (name: string, type: string) =>
  new File([new Uint8Array([1, 2, 3, 4])], name, { type });

const uploadedAssetFor = (fileName: string): AmbientImageAsset => {
  if (fileName.startsWith("first")) return firstAsset;
  if (fileName.startsWith("second")) return secondAsset;
  throw new Error(`No synthetic asset is mapped to ${fileName}`);
};

function createServerConfig(clientSettings: ClientSettings): ServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.make("environment-local"),
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-session-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    systemPromptPath: "/repo/project/.t3code-system-prompt.md",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: false,
      otlpTracesUrl: "",
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
    clientSettings,
  } as ServerConfig;
}

interface FakeBackendOptions {
  /** Reject the settings write, as a failed/rejected backend round trip would. */
  readonly failSave?: boolean;
  /** Fail every DELETE, as a storage error on the server would. */
  readonly failDelete?: boolean;
}

/**
 * Fake Cafe backend: one in-memory client settings document plus the set of
 * stored ambient image ids. The DELETE handler re-reads that document and
 * answers 409 while the id is still referenced, mirroring the real route's
 * request-time check.
 */
function installFakeBackend(initial: Partial<ClientSettings>, options: FakeBackendOptions = {}) {
  let saved: ClientSettings = { ...DEFAULT_CLIENT_SETTINGS, ...initial };
  const stored = new Set<string>(
    [
      ...(saved.ambientImageCycleAssets ?? []),
      ...(saved.ambientImageAsset ? [saved.ambientImageAsset] : []),
    ].map((asset) => asset.id),
  );
  const calls: string[] = [];

  setServerConfigSnapshot(createServerConfig(saved));

  const updateClientSettings = vi
    .fn<LocalApi["server"]["updateClientSettings"]>()
    .mockImplementation(async (patch) => {
      calls.push("save");
      if (options.failSave) throw new Error("Settings write rejected.");
      saved = { ...saved, ...patch } as ClientSettings;
      return saved;
    });

  window.nativeApi = {
    persistence: {
      getClientSettings: vi.fn().mockResolvedValue(null),
      setClientSettings: vi.fn().mockResolvedValue(undefined),
    },
    server: { updateClientSettings },
  } as unknown as LocalApi;

  const ambientFetch = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input), window.location.origin);
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/ambient-media/image" && method === "POST") {
      const file = init?.body as File;
      const asset = uploadedAssetFor(file.name);
      calls.push(`upload:${file.name}`);
      stored.add(asset.id);
      return new Response(JSON.stringify({ ambientImage: asset }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname.startsWith("/api/ambient-media/image/") && method === "DELETE") {
      const id = url.pathname.slice("/api/ambient-media/image/".length);
      calls.push(`delete:${id}`);
      if (options.failDelete) {
        return new Response("Ambient image could not be removed.", { status: 500 });
      }
      const referenced =
        saved.ambientImageAsset?.id === id ||
        (saved.ambientImageCycleAssets ?? []).some((asset) => asset.id === id);
      if (referenced) {
        return new Response("Ambient image is still in use.", { status: 409 });
      }
      stored.delete(id);
      return new Response(JSON.stringify({ removed: true }), { status: 200 });
    }
    // Thumbnail <img> loads go to the browser, not here; anything else is a bug.
    throw new Error(`Unhandled fetch ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", ambientFetch);

  return {
    calls,
    updateClientSettings,
    storedIds: () => [...stored],
    savedSettings: () => saved,
  };
}

let mounted: { unmount: () => void } | null = null;

const renderSection = async () => {
  mounted = await render(
    <AppAtomRegistryProvider>
      <AmbientImageSettingsSection />
    </AppAtomRegistryProvider>,
  );
};

const inputFor = (testId: string) =>
  document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;

/** Drive the hidden file input the way a picker would, with synthetic files. */
const selectFiles = (files: readonly File[]) => {
  const input = inputFor("ambient-image-file-input");
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

/**
 * Folder selections carry `webkitRelativePath`, which is read-only on a real
 * `File` and empty on one built from `DataTransfer`. Defining `files` directly
 * is the only way to reproduce a directory selection without an OS picker.
 */
const selectFolder = (
  entries: readonly { readonly file: File; readonly relativePath: string }[],
) => {
  const input = inputFor("ambient-image-folder-input");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: entries.map(({ file, relativePath }) => {
      Object.defineProperty(file, "webkitRelativePath", {
        configurable: true,
        value: relativePath,
      });
      return file;
    }),
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const noticeText = () =>
  document.querySelector('[data-testid="ambient-image-notice"]')?.textContent ?? null;
const errorText = () =>
  document.querySelector('[data-testid="ambient-image-error"]')?.textContent ?? null;
/** The "Remove" button that sits under a given library thumbnail. */
const removeButtonFor = (asset: AmbientImageAsset) => {
  const thumbnail = document.querySelector(`[aria-label="Show ambient image ${asset.id}"]`);
  const remove = thumbnail?.parentElement?.querySelectorAll("button")[1];
  if (!remove) throw new Error(`No remove button for ${asset.id}`);
  return remove;
};

const thumbnailIds = () =>
  [...document.querySelectorAll('[data-testid="ambient-image-grid"] img')].map((image) =>
    new URL((image as HTMLImageElement).src, window.location.href).pathname.split("/").pop(),
  );

describe("AmbientImageSettingsSection", () => {
  beforeEach(async () => {
    resetAppAtomRegistryForTests();
    resetServerStateForTests();
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    mounted?.unmount();
    mounted = null;
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "nativeApi");
    document.body.innerHTML = "";
    resetServerStateForTests();
    resetAppAtomRegistryForTests();
    await __resetLocalApiForTests();
  });

  it("saves the library only after every upload is confirmed, and says so", async () => {
    const backend = installFakeBackend({});
    await renderSection();

    selectFiles([
      syntheticFile("first.png", "image/png"),
      syntheticFile("second.png", "image/png"),
    ]);

    await vi.waitFor(() => expect(noticeText()).toBe("Added 2 images."));
    expect(errorText()).toBeNull();
    // Order is the contract: bytes first, then one confirmed settings write.
    expect(backend.calls).toEqual(["upload:first.png", "upload:second.png", "save"]);
    expect(backend.updateClientSettings).toHaveBeenCalledWith({
      ambientImageCycleAssets: [firstAsset, secondAsset],
      ambientImageAsset: firstAsset,
    });
    expect(backend.savedSettings().ambientImageCycleAssets.map((asset) => asset.id)).toEqual([
      firstAsset.id,
      secondAsset.id,
    ]);
    expect(thumbnailIds()).toEqual([firstAsset.id, secondAsset.id]);
  });

  it("never reports success when the library save fails, and hands the bytes back", async () => {
    const backend = installFakeBackend({}, { failSave: true });
    await renderSection();

    selectFiles([syntheticFile("first.png", "image/png")]);

    await vi.waitFor(() => expect(errorText()).toContain("Settings write rejected."));
    // The failure is the whole point: a fire-and-forget write would have shown
    // the thumbnail and no error, leaving bytes nothing references.
    expect(errorText()).toContain("The uploaded files were discarded.");
    expect(noticeText()).toBeNull();
    expect(document.querySelector('[data-testid="ambient-image-grid"]')).toBeNull();
    expect(backend.calls).toEqual(["upload:first.png", "save", `delete:${firstAsset.id}`]);
    expect(backend.storedIds()).toEqual([]);
  });

  it("admits it when the bytes from a failed save could not be handed back", async () => {
    const backend = installFakeBackend({}, { failSave: true, failDelete: true });
    await renderSection();

    selectFiles([syntheticFile("first.png", "image/png")]);

    await vi.waitFor(() =>
      expect(errorText()).toContain("1 uploaded file is still stored on the server."),
    );
    expect(noticeText()).toBeNull();
    expect(backend.storedIds()).toEqual([firstAsset.id]);
  });

  it("replaces the rotation from a folder and prunes the replaced files after the save", async () => {
    const backend = installFakeBackend({
      ambientImageCycleAssets: [existingAsset],
      ambientImageAsset: existingAsset,
    });
    await renderSection();

    selectFolder([
      // Deliberately out of order: the selection is sorted before upload.
      { file: syntheticFile("second.png", "image/png"), relativePath: "wallpapers/second.png" },
      { file: syntheticFile("first.png", "image/png"), relativePath: "wallpapers/first.png" },
      { file: syntheticFile("notes.txt", "text/plain"), relativePath: "wallpapers/notes.txt" },
    ]);

    await vi.waitFor(() =>
      expect(noticeText()).toBe("Added 2 images; skipped 1 unsupported files."),
    );
    expect(errorText()).toBeNull();
    // The replaced file is deleted only after the settings write is confirmed,
    // because the server refuses to delete a still-referenced id.
    expect(backend.calls).toEqual([
      "upload:first.png",
      "upload:second.png",
      "save",
      `delete:${existingAsset.id}`,
    ]);
    expect(backend.storedIds()).toEqual([firstAsset.id, secondAsset.id]);
    expect(backend.savedSettings().ambientImageCycleEnabled).toBe(true);
    expect(thumbnailIds()).toEqual([firstAsset.id, secondAsset.id]);
  });

  it("drops the reference before deleting and warns when the file survives", async () => {
    const backend = installFakeBackend(
      {
        ambientImageCycleAssets: [firstAsset, secondAsset],
        ambientImageAsset: firstAsset,
        ambientImageCycleEnabled: true,
      },
      { failDelete: true },
    );
    await renderSection();

    await userEvent.click(removeButtonFor(firstAsset));

    await vi.waitFor(() =>
      expect(noticeText()).toBe(
        "Removed from the library, but its file is still stored on the server.",
      ),
    );
    expect(errorText()).toBeNull();
    expect(backend.calls).toEqual(["save", `delete:${firstAsset.id}`]);
    expect(backend.savedSettings().ambientImageCycleAssets.map((asset) => asset.id)).toEqual([
      secondAsset.id,
    ]);
    expect(backend.savedSettings().ambientImageAsset?.id).toBe(secondAsset.id);
    expect(backend.savedSettings().ambientImageCycleEnabled).toBe(false);
    expect(backend.storedIds()).toEqual([firstAsset.id, secondAsset.id]);
    expect(thumbnailIds()).toEqual([secondAsset.id]);
  });

  it("issues no delete when the removal's settings write fails", async () => {
    const backend = installFakeBackend(
      { ambientImageCycleAssets: [firstAsset, secondAsset], ambientImageAsset: firstAsset },
      { failSave: true },
    );
    await renderSection();

    await userEvent.click(removeButtonFor(firstAsset));

    await vi.waitFor(() => expect(errorText()).toBe("Settings write rejected."));
    expect(noticeText()).toBeNull();
    expect(backend.calls).toEqual(["save"]);
    expect(backend.storedIds()).toEqual([firstAsset.id, secondAsset.id]);
    expect(thumbnailIds()).toEqual([firstAsset.id, secondAsset.id]);
  });
});
