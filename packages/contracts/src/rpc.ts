import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { ExternalLauncherError, LaunchEditorInput, LaunchTerminalInput } from "./editor.ts";
import { AuthAccessStreamEvent } from "./auth.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import {
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitCommandError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  TextGenerationError,
  VcsPullInput,
  GitPullRequestRefInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  VcsStatusInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
  VcsWorkingTreeDiffInput,
  VcsWorkingTreeDiffResult,
} from "./git.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import {
  ClientOrchestrationCommand,
  ModelSelection,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerProviderLoginError,
  ServerProviderLoginInput,
  ServerProviderLoginResult,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerProviderRuntimeRestartError,
  ServerProviderRuntimeRestartInput,
  ServerProviderRuntimeRestartResult,
  ServerLifecycleStreamEvent,
  ServerOpenSystemPromptFileResult,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerProviderUpdatedPayload,
  ServerSystemPromptFileError,
  ServerTraceDiagnosticsResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerRuntimeLayerDiagnosticsInput,
  ServerRuntimeLayerDiagnosticsResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import {
  ServerProjectSystemTelemetryError,
  ServerProjectSystemTelemetryInput,
  ServerProjectSystemTelemetryResult,
} from "./systemTelemetry.ts";
import {
  ClientSettingsError,
  ClientSettingsPatch,
  ClientSettingsSchema,
  ServerSettings,
  ServerSettingsError,
  ServerSettingsPatch,
} from "./settings.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";
import { UsageStatsGetResult, UsageStatsSnapshot } from "./usageStats.ts";
import {
  AgentBrowserCompleteInputSchema,
  AgentBrowserCompleteResultSchema,
  AgentBrowserRpcError,
  AgentBrowserGrantInputSchema,
  AgentBrowserGrantStateSchema,
  AgentBrowserPollResultSchema,
  AgentBrowserRevokeInputSchema,
  AgentBrowserSessionContextSchema,
} from "./embeddedBrowser.ts";
import { VcsError } from "./vcs.ts";
import {
  WorkspaceObservatoryActivityInput,
  WorkspaceObservatoryActivityResult,
  WorkspaceObservatoryDatabaseInput,
  WorkspaceObservatoryDatabaseResult,
  WorkspaceObservatoryError,
  WorkspaceObservatoryFileInput,
  WorkspaceObservatoryFileResult,
  WorkspaceObservatoryRowsResult,
  WorkspaceObservatoryTableInput,
  WorkspaceObservatoryTableResult,
  WorkspaceObservatoryTreeInput,
  WorkspaceObservatoryTreeResult,
  WORKSPACE_OBSERVATORY_LIMITS,
} from "./workspaceObservatory.ts";

export const WS_METHODS = {
  agentBrowserGrant: "agentBrowser.grant",
  agentBrowserRevoke: "agentBrowser.revoke",
  agentBrowserPoll: "agentBrowser.poll",
  agentBrowserComplete: "agentBrowser.complete",
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",
  shellOpenTerminal: "shell.openTerminal",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",

  // Read-only, environment-scoped workspace inspection. These intentionally
  // do not share the general filesystem browser's path semantics.
  workspaceObservatoryTree: "workspaceObservatory.tree",
  workspaceObservatoryReadFile: "workspaceObservatory.readFile",
  workspaceObservatoryDatabases: "workspaceObservatory.databases",
  workspaceObservatoryTables: "workspaceObservatory.tables",
  workspaceObservatoryRows: "workspaceObservatory.rows",
  workspaceObservatoryActivity: "workspaceObservatory.activity",

  // VCS methods
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsWorkingTreeDiff: "vcs.workingTreeDiff",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  // Git workflow methods
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverLoginProvider: "server.loginProvider",
  serverUpdateProvider: "server.updateProvider",
  serverRestartProviderRuntime: "server.restartProviderRuntime",
  serverOpenSystemPromptFile: "server.openSystemPromptFile",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverGetClientSettings: "server.getClientSettings",
  serverUpdateClientSettings: "server.updateClientSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetProjectSystemTelemetry: "server.getProjectSystemTelemetry",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverGetRuntimeLayerDiagnostics: "server.getRuntimeLayerDiagnostics",
  serverSignalProcess: "server.signalProcess",
  serverInterpretAtmosphereCommand: "server.interpretAtmosphereCommand",

  // Usage stats
  usageStatsGet: "usageStats.get",

  // Source control methods
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",

  // Streaming subscriptions
  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeUsageStats: "subscribeUsageStats",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([ClientSettingsError, KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerInterpretAtmosphereCommandRpc = Rpc.make(
  WS_METHODS.serverInterpretAtmosphereCommand,
  {
    payload: Schema.Struct({
      request: Schema.String.check(Schema.isMaxLength(500)),
      modelSelection: ModelSelection,
    }),
    success: Schema.Struct({ proposal: Schema.Unknown }),
    error: TextGenerationError,
  },
);

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    /**
     * When supplied, only refresh this specific provider instance. When
     * omitted, refresh all configured instances — the legacy `refresh()`
     * behaviour retained for transports that still dispatch untargeted
     * refreshes.
     */
    instanceId: Schema.optional(ProviderInstanceId),
    /**
     * Refresh only account/rate-limit usage metadata. This avoids invoking a
     * provider's heavier install/auth/model discovery path for a small widget.
     * It is valid only with `instanceId`.
     */
    usageOnly: Schema.optional(Schema.Boolean),
  }),
  success: ServerProviderUpdatedPayload,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: ServerProviderUpdateError,
});

export const WsServerLoginProviderRpc = Rpc.make(WS_METHODS.serverLoginProvider, {
  payload: ServerProviderLoginInput,
  success: ServerProviderLoginResult,
  error: ServerProviderLoginError,
});

export const WsServerRestartProviderRuntimeRpc = Rpc.make(WS_METHODS.serverRestartProviderRuntime, {
  payload: ServerProviderRuntimeRestartInput,
  success: ServerProviderRuntimeRestartResult,
  error: ServerProviderRuntimeRestartError,
});

export const WsServerOpenSystemPromptFileRpc = Rpc.make(WS_METHODS.serverOpenSystemPromptFile, {
  payload: Schema.Struct({}),
  success: ServerOpenSystemPromptFileResult,
  error: ServerSystemPromptFileError,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerGetClientSettingsRpc = Rpc.make(WS_METHODS.serverGetClientSettings, {
  payload: Schema.Struct({}),
  success: ClientSettingsSchema,
  error: ClientSettingsError,
});

export const WsServerUpdateClientSettingsRpc = Rpc.make(WS_METHODS.serverUpdateClientSettings, {
  payload: Schema.Struct({ patch: ClientSettingsPatch }),
  success: ClientSettingsSchema,
  error: ClientSettingsError,
});

export const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
});

export const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
});

export const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
});

export const WsServerGetProjectSystemTelemetryRpc = Rpc.make(
  WS_METHODS.serverGetProjectSystemTelemetry,
  {
    payload: ServerProjectSystemTelemetryInput,
    success: ServerProjectSystemTelemetryResult,
    error: ServerProjectSystemTelemetryError,
  },
);

export const WsServerGetProcessResourceHistoryRpc = Rpc.make(
  WS_METHODS.serverGetProcessResourceHistory,
  {
    payload: ServerProcessResourceHistoryInput,
    success: ServerProcessResourceHistoryResult,
  },
);

export const WsServerGetRuntimeLayerDiagnosticsRpc = Rpc.make(
  WS_METHODS.serverGetRuntimeLayerDiagnostics,
  {
    payload: ServerRuntimeLayerDiagnosticsInput,
    success: ServerRuntimeLayerDiagnosticsResult,
  },
);

export const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
});

export const WsSourceControlLookupRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlLookupRepository,
  {
    payload: SourceControlRepositoryLookupInput,
    success: SourceControlRepositoryInfo,
    error: SourceControlRepositoryError,
  },
);

export const WsSourceControlCloneRepositoryRpc = Rpc.make(WS_METHODS.sourceControlCloneRepository, {
  payload: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  error: SourceControlRepositoryError,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: ExternalLauncherError,
});

export const WsShellOpenTerminalRpc = Rpc.make(WS_METHODS.shellOpenTerminal, {
  payload: LaunchTerminalInput,
  error: ExternalLauncherError,
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: FilesystemBrowseError,
});

export const WsWorkspaceObservatoryTreeRpc = Rpc.make(WS_METHODS.workspaceObservatoryTree, {
  payload: WorkspaceObservatoryTreeInput,
  success: WorkspaceObservatoryTreeResult,
  error: WorkspaceObservatoryError,
});
export const WsWorkspaceObservatoryReadFileRpc = Rpc.make(WS_METHODS.workspaceObservatoryReadFile, {
  payload: WorkspaceObservatoryFileInput,
  success: WorkspaceObservatoryFileResult,
  error: WorkspaceObservatoryError,
});
export const WsWorkspaceObservatoryDatabasesRpc = Rpc.make(
  WS_METHODS.workspaceObservatoryDatabases,
  {
    payload: WorkspaceObservatoryTreeInput,
    success: Schema.Array(WorkspaceObservatoryDatabaseResult).check(
      Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.databases),
    ),
    error: WorkspaceObservatoryError,
  },
);
export const WsWorkspaceObservatoryTablesRpc = Rpc.make(WS_METHODS.workspaceObservatoryTables, {
  payload: WorkspaceObservatoryDatabaseInput,
  success: Schema.Array(WorkspaceObservatoryTableResult).check(
    Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.databaseTables),
  ),
  error: WorkspaceObservatoryError,
});
export const WsWorkspaceObservatoryRowsRpc = Rpc.make(WS_METHODS.workspaceObservatoryRows, {
  payload: WorkspaceObservatoryTableInput,
  success: WorkspaceObservatoryRowsResult,
  error: WorkspaceObservatoryError,
});
export const WsWorkspaceObservatoryActivityRpc = Rpc.make(WS_METHODS.workspaceObservatoryActivity, {
  payload: WorkspaceObservatoryActivityInput,
  success: WorkspaceObservatoryActivityResult,
  error: WorkspaceObservatoryError,
});

export const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusInput,
  success: VcsStatusStreamEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: GitCommandError,
});

export const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: VcsStatusInput,
  success: VcsStatusResult,
  error: GitManagerServiceError,
});

export const WsVcsWorkingTreeDiffRpc = Rpc.make(WS_METHODS.vcsWorkingTreeDiff, {
  payload: VcsWorkingTreeDiffInput,
  success: VcsWorkingTreeDiffResult,
  error: GitManagerServiceError,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: GitManagerServiceError,
});

export const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: GitCommandError,
});

export const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  payload: VcsCreateWorktreeInput,
  success: VcsCreateWorktreeResult,
  error: GitCommandError,
});

export const WsVcsRemoveWorktreeRpc = Rpc.make(WS_METHODS.vcsRemoveWorktree, {
  payload: VcsRemoveWorktreeInput,
  error: GitCommandError,
});

export const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: GitCommandError,
});

export const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: GitCommandError,
});

export const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: VcsError,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: OrchestrationReplayEventsError,
});

export const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationRpcSchemas.getArchivedShellSnapshot.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationGetDeletedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getDeletedShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getDeletedShellSnapshot.input,
    success: OrchestrationRpcSchemas.getDeletedShellSnapshot.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationHardDeleteThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.hardDeleteThread,
  {
    payload: OrchestrationRpcSchemas.hardDeleteThread.input,
    success: OrchestrationRpcSchemas.hardDeleteThread.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationRepairAssistantMessageFromProviderJournalRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.repairAssistantMessageFromProviderJournal,
  {
    payload: OrchestrationRpcSchemas.repairAssistantMessageFromProviderJournal.input,
    success: OrchestrationRpcSchemas.repairAssistantMessageFromProviderJournal.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationRepairThreadAssistantMessagesRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.repairThreadAssistantMessages,
  {
    payload: OrchestrationRpcSchemas.repairThreadAssistantMessages.input,
    success: OrchestrationRpcSchemas.repairThreadAssistantMessages.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationGetThreadTurnActivityPageRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getThreadTurnActivityPage,
  {
    payload: OrchestrationRpcSchemas.getThreadTurnActivityPage.input,
    success: OrchestrationRpcSchemas.getThreadTurnActivityPage.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationGetThreadTurnWorkLogPresenceRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getThreadTurnWorkLogPresence,
  {
    payload: OrchestrationRpcSchemas.getThreadTurnWorkLogPresence.input,
    success: OrchestrationRpcSchemas.getThreadTurnWorkLogPresence.output,
    error: OrchestrationGetSnapshotError,
  },
);

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: OrchestrationGetSnapshotError,
  stream: true,
});

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationRpcSchemas.subscribeThread.output,
    error: OrchestrationGetSnapshotError,
    stream: true,
  },
);

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([ClientSettingsError, KeybindingsConfigError, ServerSettingsError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  stream: true,
});

export const WsUsageStatsGetRpc = Rpc.make(WS_METHODS.usageStatsGet, {
  payload: Schema.Struct({}),
  success: UsageStatsGetResult,
});

export const WsAgentBrowserGrantRpc = Rpc.make(WS_METHODS.agentBrowserGrant, {
  payload: AgentBrowserGrantInputSchema,
  success: AgentBrowserGrantStateSchema,
  error: AgentBrowserRpcError,
});

export const WsAgentBrowserRevokeRpc = Rpc.make(WS_METHODS.agentBrowserRevoke, {
  payload: AgentBrowserRevokeInputSchema,
  success: AgentBrowserGrantStateSchema,
  error: AgentBrowserRpcError,
});

export const WsAgentBrowserPollRpc = Rpc.make(WS_METHODS.agentBrowserPoll, {
  payload: AgentBrowserSessionContextSchema,
  success: AgentBrowserPollResultSchema,
  error: AgentBrowserRpcError,
});

export const WsAgentBrowserCompleteRpc = Rpc.make(WS_METHODS.agentBrowserComplete, {
  payload: AgentBrowserCompleteInputSchema,
  success: AgentBrowserCompleteResultSchema,
  error: AgentBrowserRpcError,
});

export const WsSubscribeUsageStatsRpc = Rpc.make(WS_METHODS.subscribeUsageStats, {
  payload: Schema.Struct({}),
  success: UsageStatsSnapshot,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsAgentBrowserGrantRpc,
  WsAgentBrowserRevokeRpc,
  WsAgentBrowserPollRpc,
  WsAgentBrowserCompleteRpc,
  WsServerGetConfigRpc,
  WsServerInterpretAtmosphereCommandRpc,
  WsServerRefreshProvidersRpc,
  WsServerLoginProviderRpc,
  WsServerUpdateProviderRpc,
  WsServerRestartProviderRuntimeRpc,
  WsServerOpenSystemPromptFileRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerGetClientSettingsRpc,
  WsServerUpdateClientSettingsRpc,
  WsServerDiscoverSourceControlRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetProjectSystemTelemetryRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerGetRuntimeLayerDiagnosticsRpc,
  WsServerSignalProcessRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsShellOpenTerminalRpc,
  WsFilesystemBrowseRpc,
  WsWorkspaceObservatoryTreeRpc,
  WsWorkspaceObservatoryReadFileRpc,
  WsWorkspaceObservatoryDatabasesRpc,
  WsWorkspaceObservatoryTablesRpc,
  WsWorkspaceObservatoryRowsRpc,
  WsWorkspaceObservatoryActivityRpc,
  WsSubscribeVcsStatusRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsVcsWorkingTreeDiffRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsUsageStatsGetRpc,
  WsSubscribeUsageStatsRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationGetDeletedShellSnapshotRpc,
  WsOrchestrationHardDeleteThreadRpc,
  WsOrchestrationRepairAssistantMessageFromProviderJournalRpc,
  WsOrchestrationRepairThreadAssistantMessagesRpc,
  WsOrchestrationGetThreadTurnActivityPageRpc,
  WsOrchestrationGetThreadTurnWorkLogPresenceRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
);
