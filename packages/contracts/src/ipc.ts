import type {
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  VcsCreateRefInput,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsPullInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  VcsStatusInput,
  VcsStatusResult,
  VcsWorkingTreeDiffInput,
  VcsWorkingTreeDiffResult,
  VcsCreateRefResult,
} from "./git.ts";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem.ts";
import type {
  WorkspaceObservatoryActivityInput,
  WorkspaceObservatoryActivityResult,
  WorkspaceObservatoryDatabaseInput,
  WorkspaceObservatoryDatabaseResult,
  WorkspaceObservatoryFileInput,
  WorkspaceObservatoryFileResult,
  WorkspaceObservatoryRowsResult,
  WorkspaceObservatoryTableInput,
  WorkspaceObservatoryTableResult,
  WorkspaceObservatoryTreeInput,
  WorkspaceObservatoryTreeResult,
} from "./workspaceObservatory.ts";
import type {
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import type { ProviderInstanceId } from "./providerInstance.ts";
import type {
  EmbeddedBrowserActionResult,
  EmbeddedBrowserClickInput,
  EmbeddedBrowserHistoryActionInput,
  EmbeddedBrowserNavigateInput,
  EmbeddedBrowserOpenInput,
  EmbeddedBrowserSetBoundsInput,
  EmbeddedBrowserShareInput,
  EmbeddedBrowserSnapshot,
  EmbeddedBrowserSnapshotInput,
  EmbeddedBrowserState,
  EmbeddedBrowserTabInput,
  EmbeddedBrowserTypeInput,
} from "./embeddedBrowser.ts";
import type {
  ServerConfig,
  ServerOpenSystemPromptFileResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerProviderLoginInput,
  ServerProviderLoginResult,
  ServerProviderUpdateInput,
  ServerProviderRuntimeRestartInput,
  ServerProviderRuntimeRestartResult,
  ServerProviderUpdatedPayload,
  ServerRemoveKeybindingResult,
  ServerRuntimeLayerDiagnosticsInput,
  ServerRuntimeLayerDiagnosticsResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerTraceDiagnosticsResult,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import type { ServerRemoveKeybindingInput, ServerUpsertKeybindingInput } from "./server.ts";
import type {
  ServerProjectSystemTelemetryInput,
  ServerProjectSystemTelemetryResult,
} from "./systemTelemetry.ts";
import * as Schema from "effect/Schema";
import type {
  ClientOrchestrationCommand,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationThreadTurnActivityPage,
  OrchestrationThreadTurnActivityPageInput,
  OrchestrationThreadTurnWorkLogPresenceInput,
  OrchestrationThreadTurnWorkLogPresenceResult,
  ProviderJournalMessageRepairInput,
  ProviderJournalMessageRepairResult,
  ProviderThreadAssistantMessagesRepairInput,
  ProviderThreadAssistantMessagesRepairResult,
  ThreadHardDeleteInput,
  ThreadHardDeleteResult,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadStreamItem,
} from "./orchestration.ts";
import { AdvertisedEndpoint } from "./remoteAccess.ts";
import { EditorId } from "./editor.ts";
import type {
  ClientSettings,
  ClientSettingsPatch,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings.ts";
import { PowerSaveBlockerMode } from "./settings.ts";
import type {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";
import { EnvironmentId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  children?: readonly ContextMenuItem<T>[];
}

export interface ContextMenuItemSchemaType {
  readonly id: string;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly children?: readonly ContextMenuItemSchemaType[];
}

export const ContextMenuItemSchema: Schema.Codec<ContextMenuItemSchemaType> = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  destructive: Schema.optionalKey(Schema.Boolean),
  disabled: Schema.optionalKey(Schema.Boolean),
  children: Schema.optionalKey(
    Schema.Array(
      Schema.suspend((): Schema.Codec<ContextMenuItemSchemaType> => ContextMenuItemSchema),
    ),
  ),
});

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";
export type DesktopUpdateChannel = "latest" | "nightly";
export type DesktopUpdateInstallMode = "in-app" | "manual";
export type DesktopAppStageLabel = "Alpha" | "Dev" | "Nightly";

export const DesktopUpdateStatusSchema = Schema.Literals([
  "disabled",
  "idle",
  "checking",
  "up-to-date",
  "available",
  "downloading",
  "downloaded",
  "error",
]);
export const DesktopRuntimeArchSchema = Schema.Literals(["arm64", "x64", "other"]);
export const DesktopThemeSchema = Schema.Literals(["light", "dark", "system"]);
export const DesktopUpdateChannelSchema = Schema.Literals(["latest", "nightly"]);
export const DesktopUpdateInstallModeSchema = Schema.Literals(["in-app", "manual"]);
export const DesktopAppStageLabelSchema = Schema.Literals(["Alpha", "Dev", "Nightly"]);

export interface DesktopAppBranding {
  baseName: string;
  stageLabel: DesktopAppStageLabel;
  displayName: string;
}

export const DesktopAppBrandingSchema = Schema.Struct({
  baseName: Schema.String,
  stageLabel: DesktopAppStageLabelSchema,
  displayName: Schema.String,
});

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export const DesktopRuntimeInfoSchema = Schema.Struct({
  hostArch: DesktopRuntimeArchSchema,
  appArch: DesktopRuntimeArchSchema,
  runningUnderArm64Translation: Schema.Boolean,
});

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  channel: DesktopUpdateChannel;
  installMode: DesktopUpdateInstallMode;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export const DesktopUpdateStateSchema = Schema.Struct({
  enabled: Schema.Boolean,
  status: DesktopUpdateStatusSchema,
  channel: DesktopUpdateChannelSchema,
  installMode: DesktopUpdateInstallModeSchema,
  currentVersion: Schema.String,
  hostArch: DesktopRuntimeArchSchema,
  appArch: DesktopRuntimeArchSchema,
  runningUnderArm64Translation: Schema.Boolean,
  availableVersion: Schema.NullOr(Schema.String),
  downloadedVersion: Schema.NullOr(Schema.String),
  downloadPercent: Schema.NullOr(Schema.Number),
  checkedAt: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  errorContext: Schema.NullOr(Schema.Literals(["check", "download", "install"])),
  canRetry: Schema.Boolean,
});

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export const DesktopUpdateActionResultSchema = Schema.Struct({
  accepted: Schema.Boolean,
  completed: Schema.Boolean,
  state: DesktopUpdateStateSchema,
});

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export const DesktopUpdateCheckResultSchema = Schema.Struct({
  checked: Schema.Boolean,
  state: DesktopUpdateStateSchema,
});

export type DesktopSourceUpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "behind"
  | "ahead"
  | "diverged"
  | "ignored"
  | "unavailable"
  | "error";

export type DesktopSourceUpdateTrackedBranch = "main" | "dev";

export const DesktopSourceUpdateStatusSchema = Schema.Literals([
  "idle",
  "checking",
  "current",
  "behind",
  "ahead",
  "diverged",
  "ignored",
  "unavailable",
  "error",
]);
export const DesktopSourceUpdateTrackedBranchSchema = Schema.Literals(["main", "dev"]);

export interface DesktopSourceUpdateState {
  status: DesktopSourceUpdateStatus;
  branch: string | null;
  trackedBranch: DesktopSourceUpdateTrackedBranch | null;
  runtimeHash: string | null;
  localHash: string | null;
  remoteHash: string | null;
  mergeBaseHash: string | null;
  dirty: boolean | null;
  checkedAt: string | null;
  message: string | null;
}

export const DesktopSourceUpdateStateSchema = Schema.Struct({
  status: DesktopSourceUpdateStatusSchema,
  branch: Schema.NullOr(Schema.String),
  trackedBranch: Schema.NullOr(DesktopSourceUpdateTrackedBranchSchema),
  runtimeHash: Schema.NullOr(Schema.String),
  localHash: Schema.NullOr(Schema.String),
  remoteHash: Schema.NullOr(Schema.String),
  mergeBaseHash: Schema.NullOr(Schema.String),
  dirty: Schema.NullOr(Schema.Boolean),
  checkedAt: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
});

export interface DesktopEnvironmentBootstrap {
  label: string;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
}

export const DesktopEnvironmentBootstrapSchema = Schema.Struct({
  label: Schema.String,
  httpBaseUrl: Schema.NullOr(Schema.String),
  wsBaseUrl: Schema.NullOr(Schema.String),
  bootstrapToken: Schema.optionalKey(Schema.String),
});

export type DesktopServerExposureMode = "local-only" | "network-accessible";

export const DesktopServerExposureModeSchema = Schema.Literals([
  "local-only",
  "network-accessible",
]);

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  httpsEnabled: boolean;
  endpointUrl: string | null;
  advertisedHost: string | null;
}

export const DesktopServerExposureStateSchema = Schema.Struct({
  mode: DesktopServerExposureModeSchema,
  httpsEnabled: Schema.Boolean,
  endpointUrl: Schema.NullOr(Schema.String),
  advertisedHost: Schema.NullOr(Schema.String),
});

export const MIN_DESKTOP_WINDOW_OPACITY = 0.65;
export const MAX_DESKTOP_WINDOW_OPACITY = 1;
export const DEFAULT_DESKTOP_WINDOW_OPACITY = 0.84;

export const DesktopWindowOpacityValueSchema = Schema.Number.check(
  Schema.isBetween({
    minimum: MIN_DESKTOP_WINDOW_OPACITY,
    maximum: MAX_DESKTOP_WINDOW_OPACITY,
  }),
);
export type DesktopWindowOpacityValue = typeof DesktopWindowOpacityValueSchema.Type;

export const DesktopWindowOpacityPreferenceSchema = Schema.Struct({
  enabled: Schema.Boolean,
  opacity: DesktopWindowOpacityValueSchema,
});
export type DesktopWindowOpacityPreference = typeof DesktopWindowOpacityPreferenceSchema.Type;

export const DesktopWindowOpacityReasonSchema = Schema.NullOr(
  Schema.Literals([
    "unsupported-platform",
    "release-not-validated",
    "apply-failed",
    "persistence-failed",
    "safe-reset-failed",
  ]),
);
export type DesktopWindowOpacityReason = typeof DesktopWindowOpacityReasonSchema.Type;

/**
 * Desktop-local opacity state. `opacity` remembers the slider preference while
 * `effectiveOpacity` is the value confirmed for the live BrowserWindows.
 * A null value means a failed rollback/reset left the live registry unknown.
 */
export const DesktopWindowOpacityStateSchema = Schema.Struct({
  supported: Schema.Boolean,
  enabled: Schema.Boolean,
  opacity: DesktopWindowOpacityValueSchema,
  effectiveOpacity: Schema.NullOr(DesktopWindowOpacityValueSchema),
  reason: DesktopWindowOpacityReasonSchema,
});
export type DesktopWindowOpacityState = typeof DesktopWindowOpacityStateSchema.Type;

export interface PickFolderOptions {
  initialPath?: string | null;
}

export const PickFolderOptionsSchema = Schema.Struct({
  initialPath: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const DesktopPowerSaveBlockerStateSchema = Schema.Struct({
  mode: PowerSaveBlockerMode,
  chatsRunning: Schema.Boolean,
});
export type DesktopPowerSaveBlockerState = typeof DesktopPowerSaveBlockerStateSchema.Type;

export const DESKTOP_LOCAL_MEDIA_TITLE_MAX_LENGTH = 256;
export const DESKTOP_LOCAL_MEDIA_REASON_MAX_LENGTH = 512;
export const DESKTOP_LOCAL_MEDIA_SESSION_ID_MAX_LENGTH = 128;
export const DESKTOP_LOCAL_MEDIA_URL_MAX_LENGTH = 256;
export const MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS = 64;
export const MAX_DESKTOP_LOCAL_MEDIA_QUEUE_BYTES = 64 * 1024 * 1024 * 1024;

const DesktopLocalMediaTitleSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DESKTOP_LOCAL_MEDIA_TITLE_MAX_LENGTH),
);
const DesktopLocalMediaReasonTextSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DESKTOP_LOCAL_MEDIA_REASON_MAX_LENGTH),
);
const DesktopLocalMediaSessionIdSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DESKTOP_LOCAL_MEDIA_SESSION_ID_MAX_LENGTH),
  Schema.isPattern(/^[A-Za-z0-9_-]{32,128}$/),
);
const DesktopLocalMediaPlaybackUrlSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DESKTOP_LOCAL_MEDIA_URL_MAX_LENGTH),
  Schema.isPattern(/^cafecode-media:\/\/stream\/[A-Za-z0-9_-]{32,128}$/),
);
const DesktopLocalMediaEngineVersionSchema = Schema.NullOr(
  TrimmedNonEmptyString.check(Schema.isMaxLength(DESKTOP_LOCAL_MEDIA_TITLE_MAX_LENGTH)),
);

export const DesktopLocalMediaKindSchema = Schema.Literals(["audio", "video"]);
export type DesktopLocalMediaKind = typeof DesktopLocalMediaKindSchema.Type;

export const DesktopLocalMediaEngineSchema = Schema.Struct({
  label: Schema.Literal("VLC"),
  version: DesktopLocalMediaEngineVersionSchema,
  reason: Schema.NullOr(DesktopLocalMediaReasonTextSchema),
});
export type DesktopLocalMediaEngine = typeof DesktopLocalMediaEngineSchema.Type;

export const DesktopLocalMediaCapabilitySchema = Schema.Union([
  Schema.Struct({
    available: Schema.Literal(true),
    engine: Schema.Struct({
      label: Schema.Literal("VLC"),
      version: DesktopLocalMediaEngineVersionSchema,
      reason: Schema.Null,
    }),
  }),
  Schema.Struct({
    available: Schema.Literal(false),
    engine: Schema.Struct({
      label: Schema.Literal("VLC"),
      version: DesktopLocalMediaEngineVersionSchema,
      reason: DesktopLocalMediaReasonTextSchema,
    }),
  }),
]);
export type DesktopLocalMediaCapability = typeof DesktopLocalMediaCapabilitySchema.Type;

export const DesktopLocalMediaSelectionSchema = Schema.Struct({
  sessionId: DesktopLocalMediaSessionIdSchema,
  kind: DesktopLocalMediaKindSchema,
  displayTitle: DesktopLocalMediaTitleSchema,
  playbackUrl: DesktopLocalMediaPlaybackUrlSchema,
  currentIndex: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS - 1 }),
  ),
  totalItems: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS }),
  ),
  engine: Schema.Struct({
    label: Schema.Literal("VLC"),
    version: DesktopLocalMediaEngineVersionSchema,
    reason: Schema.Null,
  }),
}).check(
  Schema.makeFilter((selection) =>
    selection.currentIndex < selection.totalItems
      ? undefined
      : "currentIndex must identify an item in the bounded queue",
  ),
);
export type DesktopLocalMediaSelection = typeof DesktopLocalMediaSelectionSchema.Type;

export const DesktopLocalMediaNavigationDirectionSchema = Schema.Literals(["previous", "next"]);
export type DesktopLocalMediaNavigationDirection =
  typeof DesktopLocalMediaNavigationDirectionSchema.Type;

export const DesktopLocalMediaNavigateInputSchema = Schema.Struct({
  sessionId: DesktopLocalMediaSessionIdSchema,
  direction: DesktopLocalMediaNavigationDirectionSchema,
});
export type DesktopLocalMediaNavigateInput = typeof DesktopLocalMediaNavigateInputSchema.Type;

export const DesktopLocalMediaReleaseInputSchema = Schema.Struct({
  sessionId: DesktopLocalMediaSessionIdSchema,
});
export type DesktopLocalMediaReleaseInput = typeof DesktopLocalMediaReleaseInputSchema.Type;

export const PersistedSavedEnvironmentRecordSchema = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  wsBaseUrl: Schema.String,
  httpBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
});
export type PersistedSavedEnvironmentRecord = typeof PersistedSavedEnvironmentRecordSchema.Type;

export const DesktopDebugEndpointStateSchema = Schema.Struct({
  enabled: Schema.Boolean,
  url: Schema.NullOr(Schema.String),
});
export type DesktopDebugEndpointState = typeof DesktopDebugEndpointStateSchema.Type;

export const DesktopRendererDebugSnapshotSchema = Schema.Record(Schema.String, Schema.Unknown);
export type DesktopRendererDebugSnapshot = typeof DesktopRendererDebugSnapshotSchema.Type;

export const CompletionSpeechLanguageSchema = Schema.Literals(["en", "ja"]);
export type CompletionSpeechLanguage = typeof CompletionSpeechLanguageSchema.Type;

export const CompletionSpeechGenderSchema = Schema.Literals(["female", "male"]);
export type CompletionSpeechGender = typeof CompletionSpeechGenderSchema.Type;

const DesktopCompletionSpeechTextSchema = Schema.String.check(Schema.isMaxLength(512));

export const DesktopCompletionSpeechVoiceSchema = Schema.Struct({
  name: DesktopCompletionSpeechTextSchema,
  language: CompletionSpeechLanguageSchema,
  culture: DesktopCompletionSpeechTextSchema,
  gender: CompletionSpeechGenderSchema,
});
export type DesktopCompletionSpeechVoice = typeof DesktopCompletionSpeechVoiceSchema.Type;

export const DesktopCompletionSpeechCapabilitySchema = Schema.Struct({
  available: Schema.Boolean,
  engine: Schema.Literal("Windows System.Speech"),
  voices: Schema.Array(DesktopCompletionSpeechVoiceSchema).check(Schema.isMaxLength(128)),
  reason: Schema.NullOr(DesktopCompletionSpeechTextSchema),
});
export type DesktopCompletionSpeechCapability = typeof DesktopCompletionSpeechCapabilitySchema.Type;

export const DesktopCompletionSpeechSynthesizeInputSchema = Schema.Struct({
  language: CompletionSpeechLanguageSchema,
  gender: CompletionSpeechGenderSchema,
});
export type DesktopCompletionSpeechSynthesizeInput =
  typeof DesktopCompletionSpeechSynthesizeInputSchema.Type;

export const DesktopCompletionSpeechClipSchema = Schema.Struct({
  language: CompletionSpeechLanguageSchema,
  requestedGender: CompletionSpeechGenderSchema,
  voice: DesktopCompletionSpeechVoiceSchema,
  // A fixed, very short phrase produces a small PCM WAV. The main process
  // enforces the decoded byte bound before encoding this renderer payload.
  wavBase64: Schema.String.check(Schema.isMaxLength(1_500_000)),
});
export type DesktopCompletionSpeechClip = typeof DesktopCompletionSpeechClipSchema.Type;

export const DesktopCompletionSpeechSynthesizeResultSchema = Schema.Struct({
  clip: Schema.NullOr(DesktopCompletionSpeechClipSchema),
  reason: Schema.NullOr(DesktopCompletionSpeechTextSchema),
});
export type DesktopCompletionSpeechSynthesizeResult =
  typeof DesktopCompletionSpeechSynthesizeResultSchema.Type;

export interface DesktopBridge {
  getAppBranding: () => DesktopAppBranding | null;
  getLocalEnvironmentBootstrap: () => DesktopEnvironmentBootstrap | null;
  getDebugEndpointState: () => Promise<DesktopDebugEndpointState>;
  publishDebugSnapshot: (snapshot: DesktopRendererDebugSnapshot) => Promise<void>;
  getClientSettings: () => Promise<ClientSettings | null>;
  setClientSettings: (settings: ClientSettings) => Promise<void>;
  setPowerSaveBlockerState: (state: DesktopPowerSaveBlockerState) => Promise<void>;
  getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
  setSavedEnvironmentRegistry: (
    records: readonly PersistedSavedEnvironmentRecord[],
  ) => Promise<void>;
  getSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<string | null>;
  setSavedEnvironmentSecret: (environmentId: EnvironmentId, secret: string) => Promise<boolean>;
  removeSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<void>;
  getServerExposureState: () => Promise<DesktopServerExposureState>;
  setServerExposureMode: (mode: DesktopServerExposureMode) => Promise<DesktopServerExposureState>;
  setServerHttpsEnabled: (enabled: boolean) => Promise<DesktopServerExposureState>;
  getAdvertisedEndpoints: () => Promise<readonly AdvertisedEndpoint[]>;
  getWindowOpacityState: () => Promise<DesktopWindowOpacityState>;
  setWindowOpacityPreference: (
    preference: DesktopWindowOpacityPreference,
  ) => Promise<DesktopWindowOpacityState>;
  getCompletionSpeechCapability?: () => Promise<DesktopCompletionSpeechCapability>;
  synthesizeCompletionSpeech?: (
    input: DesktopCompletionSpeechSynthesizeInput,
  ) => Promise<DesktopCompletionSpeechSynthesizeResult>;
  pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
  getLocalMediaCapability: () => Promise<DesktopLocalMediaCapability>;
  pickLocalMedia: () => Promise<DesktopLocalMediaSelection | null>;
  navigateLocalMedia?: (
    input: DesktopLocalMediaNavigateInput,
  ) => Promise<DesktopLocalMediaSelection | null>;
  releaseLocalMedia: (input: DesktopLocalMediaReleaseInput) => Promise<boolean>;
  openEmbeddedBrowser: (input?: EmbeddedBrowserOpenInput) => Promise<EmbeddedBrowserState>;
  closeEmbeddedBrowser: (input: EmbeddedBrowserTabInput) => Promise<EmbeddedBrowserState>;
  setEmbeddedBrowserBounds: (input: EmbeddedBrowserSetBoundsInput) => Promise<EmbeddedBrowserState>;
  shareEmbeddedBrowser: (input: EmbeddedBrowserShareInput) => Promise<EmbeddedBrowserActionResult>;
  navigateEmbeddedBrowser: (
    input: EmbeddedBrowserNavigateInput,
  ) => Promise<EmbeddedBrowserActionResult>;
  controlEmbeddedBrowserHistory: (
    input: EmbeddedBrowserHistoryActionInput,
  ) => Promise<EmbeddedBrowserActionResult>;
  snapshotEmbeddedBrowser: (
    input: EmbeddedBrowserSnapshotInput,
  ) => Promise<EmbeddedBrowserSnapshot | null>;
  clickEmbeddedBrowser: (input: EmbeddedBrowserClickInput) => Promise<EmbeddedBrowserActionResult>;
  typeInEmbeddedBrowser: (input: EmbeddedBrowserTypeInput) => Promise<EmbeddedBrowserActionResult>;
  onEmbeddedBrowserState: (listener: (state: EmbeddedBrowserState) => void) => () => void;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  openPath: (path: string) => Promise<boolean>;
  revealPath: (path: string) => Promise<boolean>;
  copyText?: (text: string) => Promise<void>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  setUpdateChannel: (channel: DesktopUpdateChannel) => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
  getSourceUpdateState: () => Promise<DesktopSourceUpdateState>;
  checkSourceUpdate: () => Promise<DesktopSourceUpdateState>;
  onSourceUpdateState: (listener: (state: DesktopSourceUpdateState) => void) => () => void;
}

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * These capabilities describe the desktop/browser host that the user is
 * currently running: dialogs, editor/external-link opening, context menus, and
 * app-level settings/config access. They must not be used as a proxy for
 * "whatever environment the user is targeting", because in a multi-environment
 * world the local shell and a selected backend environment are distinct
 * concepts.
 */
export interface LocalApi {
  dialogs: {
    pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openTerminal: (cwd: string) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    openPath: (path: string) => Promise<void>;
    revealPath: (path: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
    getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
    setSavedEnvironmentRegistry: (
      records: readonly PersistedSavedEnvironmentRecord[],
    ) => Promise<void>;
    getSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<string | null>;
    setSavedEnvironmentSecret: (environmentId: EnvironmentId, secret: string) => Promise<boolean>;
    removeSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<void>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    /**
     * Refresh provider snapshots. When `input.instanceId` is supplied only that
     * configured instance is probed; otherwise every configured instance is
     * refreshed (legacy untargeted refresh).
     */
    refreshProviders: (input?: {
      readonly instanceId?: ProviderInstanceId;
    }) => Promise<ServerProviderUpdatedPayload>;
    loginProvider: (input: ServerProviderLoginInput) => Promise<ServerProviderLoginResult>;
    updateProvider: (input: ServerProviderUpdateInput) => Promise<ServerProviderUpdatedPayload>;
    restartProviderRuntime: (
      input: ServerProviderRuntimeRestartInput,
    ) => Promise<ServerProviderRuntimeRestartResult>;
    openSystemPromptFile: () => Promise<ServerOpenSystemPromptFileResult>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    removeKeybinding: (input: ServerRemoveKeybindingInput) => Promise<ServerRemoveKeybindingResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
    getClientSettings: () => Promise<ClientSettings>;
    updateClientSettings: (patch: ClientSettingsPatch) => Promise<ClientSettings>;
    discoverSourceControl: () => Promise<SourceControlDiscoveryResult>;
    getTraceDiagnostics: () => Promise<ServerTraceDiagnosticsResult>;
    getProcessDiagnostics: () => Promise<ServerProcessDiagnosticsResult>;
    getProcessResourceHistory: (
      input: ServerProcessResourceHistoryInput,
    ) => Promise<ServerProcessResourceHistoryResult>;
    getRuntimeLayerDiagnostics: (
      input?: ServerRuntimeLayerDiagnosticsInput,
    ) => Promise<ServerRuntimeLayerDiagnosticsResult>;
    signalProcess: (input: ServerSignalProcessInput) => Promise<ServerSignalProcessResult>;
  };
}

/**
 * APIs bound to a specific backend environment connection.
 *
 * These operations must always be routed with explicit environment context.
 * They represent remote stateful capabilities such as orchestration, project,
 * VCS, and provider operations. In multi-environment mode, each environment gets
 * its own instance of this surface, and callers should resolve it by
 * `environmentId` rather than reaching through the local desktop bridge.
 */
export interface EnvironmentApi {
  systemTelemetry: {
    /**
     * Read aggregate host resource metrics and only the filesystem volume
     * containing the server-authoritative workspace root for this project.
     * Callers cannot supply a path, interface, address, or traffic filter.
     */
    readProject: (
      input: ServerProjectSystemTelemetryInput,
    ) => Promise<ServerProjectSystemTelemetryResult>;
  };
  projects: {
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
  filesystem: {
    browse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  };
  /** Optional while a saved environment is connected to an older Cafe server. */
  workspaceObservatory?: {
    tree: (input: WorkspaceObservatoryTreeInput) => Promise<WorkspaceObservatoryTreeResult>;
    readFile: (input: WorkspaceObservatoryFileInput) => Promise<WorkspaceObservatoryFileResult>;
    databases: (
      input: WorkspaceObservatoryTreeInput,
    ) => Promise<readonly WorkspaceObservatoryDatabaseResult[]>;
    tables: (
      input: WorkspaceObservatoryDatabaseInput,
    ) => Promise<readonly WorkspaceObservatoryTableResult[]>;
    rows: (input: WorkspaceObservatoryTableInput) => Promise<WorkspaceObservatoryRowsResult>;
    activity: (
      input: WorkspaceObservatoryActivityInput,
    ) => Promise<WorkspaceObservatoryActivityResult>;
  };
  sourceControl: {
    lookupRepository: (
      input: SourceControlRepositoryLookupInput,
    ) => Promise<SourceControlRepositoryInfo>;
    cloneRepository: (
      input: SourceControlCloneRepositoryInput,
    ) => Promise<SourceControlCloneRepositoryResult>;
  };
  vcs: {
    listRefs: (input: VcsListRefsInput) => Promise<VcsListRefsResult>;
    createWorktree: (input: VcsCreateWorktreeInput) => Promise<VcsCreateWorktreeResult>;
    removeWorktree: (input: VcsRemoveWorktreeInput) => Promise<void>;
    createRef: (input: VcsCreateRefInput) => Promise<VcsCreateRefResult>;
    switchRef: (input: VcsSwitchRefInput) => Promise<VcsSwitchRefResult>;
    init: (input: VcsInitInput) => Promise<void>;
    pull: (input: VcsPullInput) => Promise<VcsPullResult>;
    refreshStatus: (input: VcsStatusInput) => Promise<VcsStatusResult>;
    workingTreeDiff: (input: VcsWorkingTreeDiffInput) => Promise<VcsWorkingTreeDiffResult>;
    onStatus: (
      input: VcsStatusInput,
      callback: (status: VcsStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  git: {
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
  };
  orchestration: {
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getArchivedShellSnapshot: () => Promise<OrchestrationShellSnapshot>;
    getDeletedShellSnapshot: () => Promise<OrchestrationShellSnapshot>;
    getThreadTurnActivityPage: (
      input: OrchestrationThreadTurnActivityPageInput,
    ) => Promise<OrchestrationThreadTurnActivityPage>;
    getThreadTurnWorkLogPresence: (
      input: OrchestrationThreadTurnWorkLogPresenceInput,
    ) => Promise<OrchestrationThreadTurnWorkLogPresenceResult>;
    hardDeleteThread: (input: ThreadHardDeleteInput) => Promise<ThreadHardDeleteResult>;
    repairAssistantMessageFromProviderJournal: (
      input: ProviderJournalMessageRepairInput,
    ) => Promise<ProviderJournalMessageRepairResult>;
    repairThreadAssistantMessages: (
      input: ProviderThreadAssistantMessagesRepairInput,
    ) => Promise<ProviderThreadAssistantMessagesRepairResult>;
    subscribeShell: (
      callback: (event: OrchestrationShellStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    subscribeThread: (
      input: OrchestrationSubscribeThreadInput,
      callback: (event: OrchestrationThreadStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
}
