import type {
  CodexExperimentalInput,
  CodexExperimentalResult,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
} from "@cafecode/contracts";
import { useEffect, useRef, useState } from "react";
import {
  readEnvironmentConnection,
  requireEnvironmentConnection,
  subscribeEnvironmentConnections,
} from "../../environments/runtime";
import { useUiLocalization } from "../../uiLocalization";
import { Button } from "../ui/button";

type VoiceResource = {
  key: string;
  stream?: MediaStream;
  peer?: RTCPeerConnection;
  timer?: ReturnType<typeof setInterval>;
  request: (action: CodexExperimentalInput["action"]) => Promise<CodexExperimentalResult>;
};

export function CodexExperimentalControl({
  environmentId,
  threadId,
  providerInstanceId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
}) {
  const { t } = useUiLocalization();
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<"off" | "starting" | "live">("off");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<CodexExperimentalResult | null>(null);
  const [transcript, setTranscript] = useState("");
  const resource = useRef<VoiceResource | null>(null);
  const generation = useRef(0);
  const statusBusy = useRef(false);
  const audio = useRef<HTMLAudioElement>(null);

  const stop = () => {
    const current = resource.current;
    resource.current = null;
    generation.current += 1;
    if (current) {
      current.stream?.getTracks().forEach((track) => track.stop());
      current.peer?.close();
      if (current.timer) clearInterval(current.timer);
      void current.request({ kind: "voiceStop", sessionKey: current.key }).catch(() => {});
    }
    if (audio.current) {
      audio.current.pause();
      audio.current.srcObject = null;
    }
    setPhase("off");
    setMuted(false);
    setTranscript("");
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    let connection = readEnvironmentConnection(environmentId);
    const unsubscribe = subscribeEnvironmentConnections(() => {
      const next = readEnvironmentConnection(environmentId);
      if (next !== connection) {
        connection = next;
        stopRef.current();
        setStatus(null);
      }
    });
    const hide = () => {
      if (document.hidden) stopRef.current();
    };
    document.addEventListener("visibilitychange", hide);
    const leave = () => stopRef.current();
    window.addEventListener("pagehide", leave);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      stopRef.current();
    };
  }, [environmentId, threadId, providerInstanceId]);

  const start = async () => {
    if (!enabled || resource.current || document.hidden) return;
    const version = ++generation.current;
    setError(false);
    setTranscript("");
    setPhase("starting");
    try {
      const connection = requireEnvironmentConnection(environmentId);
      const current: VoiceResource = {
        key: crypto.randomUUID(),
        request: (action) =>
          connection.client.server.codexExperimental({ threadId, providerInstanceId, action }),
      };
      resource.current = current;
      if (window.desktopBridge) {
        if (
          !window.desktopBridge.requestMicrophoneAccess ||
          !(await window.desktopBridge.requestMicrophoneAccess())
        )
          throw new Error("Microphone access is unavailable");
        if (resource.current !== current || version !== generation.current) return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (
        resource.current !== current ||
        version !== generation.current ||
        connection !== readEnvironmentConnection(environmentId)
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      current.stream = stream;
      let leaseDeadline = Date.now() + 30_000;
      let connected = false;
      let renewing = false;
      // This local deadline also applies if RPC hangs or the server disappears.
      current.timer = setInterval(() => {
        if (resource.current !== current) return;
        if (Date.now() >= leaseDeadline) {
          setError(true);
          stop();
          return;
        }
        if (!connected || renewing) return;
        renewing = true;
        void current
          .request({ kind: "voiceRenew", sessionKey: current.key })
          .then((result) => {
            if (result.kind !== "voiceRenew") throw new Error("Unexpected renewal response");
            if (resource.current === current) leaseDeadline = Date.now() + 25_000;
          })
          .catch(() => {
            if (resource.current === current) {
              setError(true);
              stop();
            }
          })
          .finally(() => {
            renewing = false;
          });
      }, 5_000);
      const peer = new RTCPeerConnection();
      current.peer = peer;
      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
        track.addEventListener(
          "ended",
          () => {
            if (resource.current === current) stop();
          },
          { once: true },
        );
      }
      peer.ontrack = (event) => {
        if (resource.current !== current || !audio.current) return;
        audio.current.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.current.play().catch(() => {});
      };
      const updateConnectionState = () => {
        if (resource.current === current && peer.connectionState === "connected") {
          connected = true;
          setPhase("live");
        }
        if (
          resource.current === current &&
          (peer.connectionState === "failed" ||
            peer.connectionState === "closed" ||
            peer.connectionState === "disconnected")
        ) {
          setError(true);
          stop();
        }
      };
      peer.onconnectionstatechange = updateConnectionState;
      const channel = peer.createDataChannel("oai-events");
      channel.onmessage = (event) => {
        if (
          resource.current !== current ||
          typeof event.data !== "string" ||
          event.data.length > 65_536
        )
          return;
        try {
          const data = JSON.parse(event.data) as {
            type?: unknown;
            delta?: unknown;
            item?: { text?: unknown } | null;
          };
          if (data.type === "error") {
            setError(true);
            stop();
            return;
          }
          // Pinned v3 (FramelessBidi) emits transcript items, not v1 deltas.
          if (data.type === "input_transcript.added" || data.type === "output_transcript.added") {
            const delta = data.item?.text;
            if (typeof delta === "string") setTranscript((text) => (text + delta).slice(-8_192));
            return;
          }
          if (
            typeof data.type !== "string" ||
            !/^(response\.(output_)?audio_transcript\.delta|conversation\.item\.input_audio_transcription\.delta)$/.test(
              data.type,
            )
          )
            return;
          if (typeof data.delta === "string")
            setTranscript((text) => (text + data.delta).slice(-8_192));
        } catch {
          /* Ignore non-transcript and malformed realtime events. */
        }
      };
      await peer.setLocalDescription(await peer.createOffer());
      if (resource.current !== current || version !== generation.current) return;
      const result = await current.request({
        kind: "voiceStart",
        sessionKey: current.key,
        offerSdp: peer.localDescription?.sdp ?? "",
      });
      if (
        resource.current !== current ||
        version !== generation.current ||
        connection !== readEnvironmentConnection(environmentId)
      ) {
        void current.request({ kind: "voiceStop", sessionKey: current.key }).catch(() => {});
        return;
      }
      if (result.kind !== "voiceStart") throw new Error("Unexpected voice response");
      await peer.setRemoteDescription({ type: "answer", sdp: result.answerSdp });
      if (resource.current !== current || version !== generation.current) return;
      updateConnectionState();
    } catch {
      if (version === generation.current) {
        setError(true);
        stop();
      }
    }
  };
  const readStatus = async (kind: "memoryStatus" | "verificationStatus") => {
    if (!enabled || statusBusy.current) return;
    statusBusy.current = true;
    const version = generation.current;
    try {
      const connection = requireEnvironmentConnection(environmentId);
      const result = await connection.client.server.codexExperimental({
        threadId,
        providerInstanceId,
        action: { kind },
      });
      if (
        version === generation.current &&
        connection === readEnvironmentConnection(environmentId)
      ) {
        setStatus(result);
        setError(false);
      }
    } catch {
      if (version === generation.current) setError(true);
    } finally {
      statusBusy.current = false;
    }
  };
  return (
    <details className="mb-2 rounded-xl border border-border p-3">
      <summary className="cursor-pointer text-sm">
        {t("Codex experimental controls", "Codexの実験的な機能")}
      </summary>
      <label className="my-2 flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            if (!e.target.checked) {
              stop();
              setStatus(null);
            }
          }}
        />
        {t("Enable experimental controls for this view", "この画面で実験的な機能を有効にする")}
      </label>
      <p className="mb-2 text-xs text-muted-foreground">
        {t(
          "Voice sends microphone audio to Codex and can run tools with this thread's current permissions. Stop or leave this view to end capture. Provider access is required.",
          "音声モードはマイクの音声をCodexに送信し、このスレッドの現在の権限でツールを実行できます。停止するか、この画面を離れると録音が終了します。プロバイダーへのアクセスが必要です。",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {phase === "off" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-auto min-h-8 max-w-full whitespace-normal break-words"
            disabled={!enabled}
            onClick={() => void start()}
          >
            {t("Start voice", "音声を開始")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-auto min-h-8 max-w-full whitespace-normal break-words"
            onClick={stop}
          >
            {t("Stop voice", "音声を停止")}
          </Button>
        )}
        {phase === "live" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-auto min-h-8 max-w-full whitespace-normal break-words"
            aria-pressed={muted}
            onClick={() => {
              resource.current?.stream?.getAudioTracks().forEach((track) => {
                track.enabled = muted;
              });
              setMuted(!muted);
            }}
          >
            {muted
              ? t("Unmute microphone", "マイクのミュートを解除")
              : t("Mute microphone", "マイクをミュート")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-auto min-h-8 max-w-full whitespace-normal break-words"
          disabled={!enabled}
          onClick={() => void readStatus("memoryStatus")}
        >
          {t("Read memory status", "メモリの状態を確認")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-auto min-h-8 max-w-full whitespace-normal break-words"
          disabled={!enabled}
          onClick={() => void readStatus("verificationStatus")}
        >
          {t("Check native verification", "ネイティブ認証を確認")}
        </Button>
      </div>
      <audio
        ref={audio}
        controls
        className={phase === "off" ? "hidden" : "mt-2 max-w-full"}
        aria-label={t("Codex voice output", "Codexの音声出力")}
      />
      {phase !== "off" && (
        <p role="status" className="mt-2 text-xs">
          {phase === "starting"
            ? t("Connecting voice…", "音声に接続中…")
            : muted
              ? t(
                  "Voice connected. Microphone muted.",
                  "音声接続中。マイクはミュートされています。",
                )
              : t("Voice connected. Microphone on.", "音声接続中。マイクはオンです。")}
        </p>
      )}
      {transcript && (
        <p className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-sm">
          {transcript}
        </p>
      )}
      {status?.kind === "memoryStatus" && (
        <p className="mt-2 text-xs">
          {t("Consolidated threads", "統合済みスレッド")}: {status.consolidatedThreads}.{" "}
          {status.ready
            ? t("Memory is ready.", "メモリは準備完了です。")
            : t("Memory is not ready.", "メモリは準備中です。")}
        </p>
      )}
      {status?.kind === "verificationStatus" && (
        <p className="mt-2 text-xs">
          {status.available
            ? t("Native verification is available.", "ネイティブ認証を利用できます。")
            : t(
                "Native verification is unavailable. Touch ID requires a supported Mac and an enrolled credential.",
                "ネイティブ認証は利用できません。Touch IDには対応するMacと登録済みの認証情報が必要です。",
              )}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t(
            "The operation failed. Check microphone permission, the Codex session, and experimental feature settings.",
            "操作に失敗しました。マイクの権限、Codexセッション、実験的な機能の設定を確認してください。",
          )}
        </p>
      )}
    </details>
  );
}
