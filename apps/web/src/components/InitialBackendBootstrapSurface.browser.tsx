import "../index.css";

import {
  DEFAULT_THREAD_AUTO_NUDGE_SUMMARY,
  EnvironmentId,
  type OrchestrationShellSnapshot,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@cafecode/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  resetPrimaryEnvironmentDescriptorForTests,
  writePrimaryEnvironmentDescriptor,
} from "../environments/primary";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import {
  recordWsConnectionAttempt,
  recordWsConnectionErrored,
  recordWsConnectionOpened,
  resetWsConnectionStateForTests,
} from "../rpc/wsConnectionState";
import { useStore } from "../store";
import {
  InitialBackendBootstrapSurface,
  resolveWebUiConnectionSetupUrl,
} from "./InitialBackendBootstrapSurface";

const TEST_ENVIRONMENT_ID = EnvironmentId.make("environment-bootstrap-surface");
const TEST_PROJECT_ID = ProjectId.make("project-bootstrap-surface");
const TEST_THREAD_ID = ThreadId.make("thread-bootstrap-surface");
const NOW_ISO = "2026-03-04T12:00:00.000Z";

function createShellSnapshot(): OrchestrationShellSnapshot {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: TEST_PROJECT_ID,
        title: "Bootstrap project",
        workspaceRoot: "/repo/bootstrap-project",
        additionalWorkspaceRoots: [],
        repositoryIdentity: null,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5",
        },
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      },
    ],
    threads: [
      {
        id: TEST_THREAD_ID,
        projectId: TEST_PROJECT_ID,
        title: "Bootstrap thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        archivedAt: null,
        deletedAt: null,
        session: {
          threadId: TEST_THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
        autoNudge: DEFAULT_THREAD_AUTO_NUDGE_SUMMARY,
        manualFollowUpCount: 0,
      },
    ],
    updatedAt: NOW_ISO,
  };
}

describe("InitialBackendBootstrapSurface", () => {
  it("derives the packaged HTTP setup URL from a secure Web UI URL", () => {
    expect(
      resolveWebUiConnectionSetupUrl({
        hostname: "192.168.1.107",
        port: "3775",
        protocol: "https:",
      }),
    ).toBe("http://192.168.1.107:3773/");
    expect(
      resolveWebUiConnectionSetupUrl({
        hostname: "192.168.1.107",
        port: "3773",
        protocol: "http:",
      }),
    ).toBe(null);
  });

  beforeEach(() => {
    resetWsConnectionStateForTests();
    resetPrimaryEnvironmentDescriptorForTests();
    writePrimaryEnvironmentDescriptor({
      environmentId: TEST_ENVIRONMENT_ID,
      label: "Bootstrap environment",
      platform: {
        os: "darwin",
        arch: "arm64",
      },
      serverVersion: "0.0.0-test",
      capabilities: {
        repositoryIdentity: true,
      },
    });
    useStore.setState({
      activeEnvironmentId: TEST_ENVIRONMENT_ID,
      environmentStateById: {},
    });
  });

  afterEach(() => {
    resetWsConnectionStateForTests();
    Reflect.deleteProperty(window, "desktopBridge");
    resetPrimaryEnvironmentDescriptorForTests();
    document.body.innerHTML = "";
    useStore.setState({
      activeEnvironmentId: null,
      environmentStateById: {},
    });
  });

  it("shows startup loading until the primary shell snapshot is applied", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <AppAtomRegistryProvider>
        <InitialBackendBootstrapSurface>
          <div data-testid="bootstrapped-workspace">Workspace loaded</div>
        </InitialBackendBootstrapSurface>
      </AppAtomRegistryProvider>,
      {
        container: host,
      },
    );

    try {
      expect(document.querySelector('[data-testid="initial-backend-bootstrap-loading"]')).not.toBe(
        null,
      );
      expect(document.body.textContent).toContain("Connecting to workspace");
      expect(document.querySelector('[data-testid="bootstrapped-workspace"]')).toBe(null);

      useStore.getState().syncServerShellSnapshot(createShellSnapshot(), TEST_ENVIRONMENT_ID);

      await vi.waitFor(
        () => {
          expect(document.querySelector('[data-testid="initial-backend-bootstrap-loading"]')).toBe(
            null,
          );
          expect(document.querySelector('[data-testid="bootstrapped-workspace"]')).not.toBe(null);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("publishes route-independent WebSocket readiness without connection details", async () => {
    const publishDebugSnapshot = vi.fn().mockResolvedValue(undefined);
    window.desktopBridge = {
      getDebugEndpointState: vi.fn().mockResolvedValue({ enabled: true, url: null }),
      publishDebugSnapshot,
    } as unknown as NonNullable<typeof window.desktopBridge>;
    recordWsConnectionOpened();
    useStore.getState().syncServerShellSnapshot(createShellSnapshot(), TEST_ENVIRONMENT_ID);

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <AppAtomRegistryProvider>
        <InitialBackendBootstrapSurface>
          <div>Workspace loaded</div>
        </InitialBackendBootstrapSurface>
      </AppAtomRegistryProvider>,
      { container: host },
    );

    try {
      await vi.waitFor(() => expect(publishDebugSnapshot).toHaveBeenCalled(), {
        timeout: 8_000,
        interval: 16,
      });
      const snapshot = publishDebugSnapshot.mock.calls.at(-1)?.[0];
      expect(snapshot).toMatchObject({
        source: "InitialBackendBootstrapSurface",
        diagnostics: { localApi: { available: true } },
        connection: {
          bootstrapComplete: true,
          phase: "connected",
          hasConnected: true,
          connected: true,
        },
      });
      expect(JSON.stringify(snapshot)).not.toMatch(/socket|url|error|environment/i);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("shows recovery actions when the first WebSocket connection fails", async () => {
    recordWsConnectionAttempt("wss://192.168.1.107:3775/ws");
    recordWsConnectionErrored("Unable to connect to the Club Code server WebSocket.");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <AppAtomRegistryProvider>
        <InitialBackendBootstrapSurface>
          <div>Workspace loaded</div>
        </InitialBackendBootstrapSurface>
      </AppAtomRegistryProvider>,
      { container: host },
    );

    try {
      expect(document.body.textContent).toContain("Waiting for the workspace to respond.");
      expect(document.body.textContent).toContain("Reload app");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
