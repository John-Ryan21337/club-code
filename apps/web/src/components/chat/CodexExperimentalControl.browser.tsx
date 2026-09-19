import "../../index.css";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@cafecode/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CodexExperimentalControl } from "./CodexExperimentalControl";

const harness = vi.hoisted(() => ({
  request: vi.fn(),
  connection: {} as unknown,
  listener: (() => {}) as () => void,
  peerState: "connected",
  channel: { onmessage: null as ((event: { data: string }) => void) | null },
}));
vi.mock("../../uiLocalization", () => ({
  useUiLocalization: () => ({ t: (english: string) => english }),
}));
vi.mock("../../environments/runtime", () => ({
  readEnvironmentConnection: () => harness.connection,
  requireEnvironmentConnection: () => harness.connection,
  subscribeEnvironmentConnections: (listener: () => void) => {
    harness.listener = listener;
    return () => {};
  },
}));
const props = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("t-1"),
  providerInstanceId: ProviderInstanceId.make("codex-1"),
};
const stopTrack = vi.fn();
const closePeer = vi.fn();
const track = { stop: stopTrack, enabled: true, addEventListener: vi.fn() };
const stream = {
  getTracks: () => [track],
  getAudioTracks: () => [track],
} as unknown as MediaStream;
const microphone = vi.fn();
let savedMediaDevices: PropertyDescriptor | undefined;

beforeEach(() => {
  harness.request.mockReset();
  stopTrack.mockClear();
  closePeer.mockClear();
  microphone.mockReset();
  track.enabled = true;
  harness.peerState = "connected";
  harness.channel = { onmessage: null };
  harness.connection = { client: { server: { codexExperimental: harness.request } } };
  harness.request.mockImplementation(async ({ action }) =>
    action.kind === "voiceStart"
      ? { kind: "voiceStart", answerSdp: "synthetic-answer" }
      : { kind: action.kind },
  );
  microphone.mockResolvedValue(stream);
  savedMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: microphone },
  });
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      get connectionState() {
        return harness.peerState;
      }
      localDescription = { sdp: "synthetic-offer" };
      addTrack() {}
      createDataChannel() {
        return harness.channel;
      }
      async createOffer() {
        return {};
      }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      close() {
        closePeer();
      }
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (savedMediaDevices) Object.defineProperty(navigator, "mediaDevices", savedMediaDevices);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

it("releases the microphone when a startup RPC never returns", async () => {
  harness.request.mockImplementation(({ action }) =>
    action.kind === "voiceStart" ? new Promise(() => {}) : Promise.resolve({ kind: action.kind }),
  );
  const screen = await render(<CodexExperimentalControl {...props} />);
  await page.getByText("Codex experimental controls", { exact: true }).click();
  await page.getByRole("checkbox").click();
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  await vi.waitFor(() => expect(harness.request).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(30_000);
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(closePeer).toHaveBeenCalledOnce();
  vi.useRealTimers();
  await screen.unmount();
});

it("releases capture on a thread change without relying on a parent remount", async () => {
  const screen = await render(<CodexExperimentalControl {...props} />);
  await page.getByText("Codex experimental controls", { exact: true }).click();
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Mute microphone", exact: true }))
    .toBeVisible();
  await screen.rerender(<CodexExperimentalControl {...props} threadId={ThreadId.make("t-2")} />);
  expect(stopTrack).toHaveBeenCalledOnce();
  await screen.unmount();
});

it("requires opt-in, captures only on Start, and releases tracks immediately on Stop", async () => {
  const screen = await render(<CodexExperimentalControl {...props} />);
  await page.getByText("Codex experimental controls", { exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Start voice", exact: true }))
    .toBeDisabled();
  await page.getByRole("checkbox").click();
  expect(microphone).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Mute microphone", exact: true }))
    .toBeVisible();
  expect(microphone).toHaveBeenCalledWith({ audio: true });
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  expect(track.enabled).toBe(false);
  await page.getByRole("button", { name: "Unmute microphone", exact: true }).click();
  expect(track.enabled).toBe(true);
  await page.getByRole("button", { name: "Stop voice", exact: true }).click();
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(closePeer).toHaveBeenCalledOnce();
  expect(harness.request).toHaveBeenLastCalledWith(
    expect.objectContaining({
      threadId: props.threadId,
      action: expect.objectContaining({ kind: "voiceStop" }),
    }),
  );
  await screen.unmount();
});

it("does not claim a live connection before WebRTC connects", async () => {
  harness.peerState = "new";
  const screen = await render(<CodexExperimentalControl {...props} />);
  await page.getByText("Codex experimental controls", { exact: true }).click();
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("Connecting voice");
  await expect
    .element(page.getByRole("button", { name: "Mute microphone", exact: true }))
    .not.toBeInTheDocument();
  await screen.unmount();
  expect(stopTrack).toHaveBeenCalledOnce();
});

it("reads pinned v3 transcript items and stops on provider errors without displaying their payload", async () => {
  const screen = await render(<CodexExperimentalControl {...props} />);
  await page.getByText("Codex experimental controls", { exact: true }).click();
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Mute microphone", exact: true }))
    .toBeVisible();
  harness.channel.onmessage?.({
    data: JSON.stringify({
      type: "input_transcript.added",
      item: { text: "Synthetic question. " },
    }),
  });
  harness.channel.onmessage?.({
    data: JSON.stringify({ type: "output_transcript.added", item: { text: "Synthetic answer." } }),
  });
  await expect
    .element(page.getByText("Synthetic question. Synthetic answer.", { exact: true }))
    .toBeVisible();
  harness.channel.onmessage?.({ data: JSON.stringify({ type: "error", message: "private SDP" }) });
  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect.element(page.getByText("private SDP")).not.toBeInTheDocument();
  expect(stopTrack).toHaveBeenCalledOnce();
  await screen.unmount();
});

it("does not open a microphone when the native permission grant is refused", async () => {
  vi.stubGlobal("desktopBridge", { requestMicrophoneAccess: async () => false });
  const screen = await render(<CodexExperimentalControl {...props} />);
  await page.getByText("Codex experimental controls", { exact: true }).click();
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  await expect.element(page.getByRole("alert")).toBeVisible();
  expect(microphone).not.toHaveBeenCalled();
  await screen.unmount();
});

it("stops permission results arriving after cancellation without starting a provider session", async () => {
  let resolve!: (value: MediaStream) => void;
  microphone.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const screen = await render(<CodexExperimentalControl {...props} />);
  await page.getByText("Codex experimental controls", { exact: true }).click();
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  await page.getByRole("button", { name: "Stop voice", exact: true }).click();
  resolve(stream);
  await vi.waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
  expect(harness.request.mock.calls.some(([input]) => input.action.kind === "voiceStart")).toBe(
    false,
  );
  await screen.unmount();
});

it("stops active capture when the connection is replaced", async () => {
  const screen = await render(<CodexExperimentalControl {...props} />);
  await page.getByText("Codex experimental controls", { exact: true }).click();
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Mute microphone", exact: true }))
    .toBeVisible();
  harness.connection = {};
  harness.listener();
  await vi.waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
  await expect
    .element(page.getByRole("button", { name: "Start voice", exact: true }))
    .toBeVisible();
  await screen.unmount();
});
