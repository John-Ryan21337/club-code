import "../../index.css";

import type { ProjectResourcesTelemetryClient } from "@cafecode/client-runtime";
import { ProjectId, type ServerProjectSystemTelemetryResult } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { StrictMode } from "react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProjectResourcesPanel } from "./ProjectResourcesPanel.tsx";

const projectA = ProjectId.make("project-resources-a");
const projectB = ProjectId.make("project-resources-b");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function telemetryFixture(
  input: {
    readonly projectId?: ProjectId;
    readonly cpuPercent?: number;
    readonly memoryPercent?: number;
    readonly cpuStatus?: "available" | "warming" | "unavailable";
    readonly memoryAvailable?: boolean;
    readonly minimumSampleIntervalMs?: number;
    readonly sampledAtIso?: string;
  } = {},
): ServerProjectSystemTelemetryResult {
  const cpuStatus = input.cpuStatus ?? "available";
  const memoryAvailable = input.memoryAvailable ?? true;
  const memoryPercent = input.memoryPercent ?? 50;
  return {
    projectId: input.projectId ?? projectA,
    sampledAt: DateTime.makeUnsafe(input.sampledAtIso ?? new Date().toISOString()),
    minimumSampleIntervalMs: input.minimumSampleIntervalMs ?? 250,
    platform: "linux",
    architecture: "x64",
    cpu:
      cpuStatus === "available"
        ? {
            status: "available",
            utilizationPercent: input.cpuPercent ?? 25,
            logicalProcessorCount: 8,
            detail: null,
          }
        : cpuStatus === "warming"
          ? {
              status: "warming",
              utilizationPercent: null,
              logicalProcessorCount: 8,
              detail: "Collecting a CPU baseline.",
            }
          : {
              status: "unavailable",
              utilizationPercent: null,
              logicalProcessorCount: 0,
              detail: "CPU telemetry is unavailable.",
            },
    memory: memoryAvailable
      ? {
          status: "available",
          totalBytes: 10_000,
          usedBytes: memoryPercent * 100,
          availableBytes: (100 - memoryPercent) * 100,
          utilizationPercent: memoryPercent,
          detail: null,
        }
      : {
          status: "unavailable",
          totalBytes: null,
          usedBytes: null,
          availableBytes: null,
          utilizationPercent: null,
          detail: "Memory telemetry is unavailable.",
        },
    projectVolume: {
      status: "unavailable",
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      utilizationPercent: null,
      projectVolumeOnly: true,
      detail: "Project-volume telemetry is unavailable.",
    },
  };
}

const clientFrom = (
  readProjectResources: ProjectResourcesTelemetryClient["readProjectResources"],
): ProjectResourcesTelemetryClient => ({ readProjectResources });

describe("ProjectResourcesPanel", () => {
  it("never draws an unavailable measurement and removes its card when hiding is engaged", async () => {
    const client = clientFrom(
      vi.fn(async () => {
        const telemetry = telemetryFixture({ cpuStatus: "unavailable" });
        return {
          ...telemetry,
          cpu: { ...telemetry.cpu, detail: "C:\\Users\\operator\\private-probe-error" },
        };
      }),
    );
    const mounted = await render(
      <ProjectResourcesPanel client={client} projectId={projectA} projectName="Cafe workspace" />,
    );

    try {
      await expect.element(page.getByLabelText(/Host CPU: Unavailable/i)).toBeVisible();
      await expect.element(page.getByLabelText(/Host RAM: 50%/i)).toBeVisible();
      expect(document.querySelector('[data-project-resource-graph="cpu"]')).toBeNull();
      expect(document.querySelector('[data-project-resource-graph="memory"]')).not.toBeNull();
      expect(document.body.textContent).not.toContain("private-probe-error");

      await page.getByRole("switch", { name: "Hide unavailable resource metrics" }).click();
      expect(document.querySelector('[data-project-resource-card="cpu"]')).toBeNull();
      expect(document.querySelector('[data-project-resource-card="memory"]')).not.toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it("renders measured zeroes as data with real graph paths", async () => {
    const client = clientFrom(
      vi.fn(async () => telemetryFixture({ cpuPercent: 0, memoryPercent: 0 })),
    );
    const mounted = await render(
      <ProjectResourcesPanel client={client} hideUnavailableGraphs={true} projectId={projectA} />,
    );

    try {
      await expect.element(page.getByLabelText(/Host CPU: 0%/i)).toBeVisible();
      await expect.element(page.getByLabelText(/Host RAM: 0%/i)).toBeVisible();
      expect(
        document.querySelector('[data-project-resource-graph="cpu"] path[d^="M 0.00 24.00"]'),
      ).not.toBeNull();
      expect(
        document.querySelector('[data-project-resource-graph="memory"] path[d^="M 0.00 24.00"]'),
      ).not.toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it("replaces successful values with graph-free outage truth after a read error", async () => {
    const onReadFailure = vi.fn();
    const readProjectResources = vi
      .fn<ProjectResourcesTelemetryClient["readProjectResources"]>()
      .mockResolvedValueOnce(telemetryFixture())
      .mockRejectedValueOnce(Object.assign(new Error("secret detail"), { name: "NetworkFailure" }));
    const mounted = await render(
      <ProjectResourcesPanel
        client={clientFrom(readProjectResources)}
        onReadFailure={onReadFailure}
        pollIntervalMs={250}
        projectId={projectA}
      />,
    );

    try {
      await expect.element(page.getByLabelText(/Host CPU: 25%/i)).toBeVisible();
      await vi.waitFor(() => expect(readProjectResources).toHaveBeenCalledTimes(2));
      await expect.element(page.getByLabelText(/Host CPU: Unavailable/i)).toBeVisible();
      await expect.element(page.getByLabelText(/Host RAM: Unavailable/i)).toBeVisible();
      expect(document.querySelectorAll("[data-project-resource-graph]")).toHaveLength(0);
      expect(onReadFailure).toHaveBeenCalledExactlyOnceWith("TelemetryReadFailure");
      expect(document.body.textContent).not.toContain("secret detail");
    } finally {
      await mounted.unmount();
    }
  });

  it("rejects malformed client results and never renders transport detail text", async () => {
    const onReadFailure = vi.fn();
    const readProjectResources = vi
      .fn<ProjectResourcesTelemetryClient["readProjectResources"]>()
      .mockResolvedValueOnce({
        ...telemetryFixture({ cpuStatus: "unavailable" }),
        sampledAt: new Date().toISOString(),
        cpu: {
          status: "unavailable",
          utilizationPercent: null,
          logicalProcessorCount: 0,
          detail: "C:\\Users\\operator\\secret-probe-error",
        },
      });
    const mounted = await render(
      <ProjectResourcesPanel
        client={clientFrom(readProjectResources)}
        onReadFailure={onReadFailure}
        projectId={projectA}
      />,
    );

    try {
      await expect.element(page.getByLabelText(/Host CPU: Unavailable/i)).toBeVisible();
      await vi.waitFor(() =>
        expect(onReadFailure).toHaveBeenCalledExactlyOnceWith("TelemetryResponseInvalid"),
      );
      expect(document.body.textContent).not.toContain("secret-probe-error");
      expect(document.querySelectorAll("[data-project-resource-graph]")).toHaveLength(0);
    } finally {
      await mounted.unmount();
    }
  });

  it("rejects stale and far-future samples instead of presenting them as current", async () => {
    const nowMs = Date.parse("2026-08-01T12:00:00.000Z");
    for (const sampledAtMs of [nowMs - 5_000, nowMs + 60_001]) {
      const readProjectResources = vi
        .fn<ProjectResourcesTelemetryClient["readProjectResources"]>()
        .mockResolvedValueOnce(
          telemetryFixture({ sampledAtIso: new Date(sampledAtMs).toISOString() }),
        );
      const onReadFailure = vi.fn();
      const mounted = await render(
        <ProjectResourcesPanel
          client={clientFrom(readProjectResources)}
          now={() => nowMs}
          onReadFailure={onReadFailure}
          projectId={projectA}
          staleAfterMs={1_000}
        />,
      );

      try {
        await expect.element(page.getByLabelText(/Host CPU: Unavailable/i)).toBeVisible();
        await vi.waitFor(() =>
          expect(onReadFailure).toHaveBeenCalledExactlyOnceWith("TelemetryResponseInvalid"),
        );
        expect(document.querySelectorAll("[data-project-resource-graph]")).toHaveLength(0);
      } finally {
        await mounted.unmount();
      }
    }
  });

  it("admits one read under StrictMode and aborts it on unmount", async () => {
    const pending = deferred<ServerProjectSystemTelemetryResult>();
    let signal: AbortSignal | null = null;
    const onReadFailure = vi.fn();
    const readProjectResources = vi.fn((request: { readonly signal: AbortSignal }) => {
      signal = request.signal;
      return pending.promise;
    });
    const mounted = await render(
      <StrictMode>
        <ProjectResourcesPanel
          client={clientFrom(readProjectResources)}
          onReadFailure={onReadFailure}
          pollIntervalMs={250}
          projectId={projectA}
          requestTimeoutMs={250}
        />
      </StrictMode>,
    );

    await vi.waitFor(() => expect(readProjectResources).toHaveBeenCalledTimes(1));
    await mounted.unmount();
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(onReadFailure).not.toHaveBeenCalled();
    expect(readProjectResources).toHaveBeenCalledTimes(1);
    pending.resolve(telemetryFixture());
  });

  it("does not overlap polls when a timed-out client ignores cancellation", async () => {
    const pending = deferred<ServerProjectSystemTelemetryResult>();
    let signal: AbortSignal | null = null;
    const readProjectResources = vi.fn((request: { readonly signal: AbortSignal }) => {
      signal = request.signal;
      return pending.promise;
    });
    const onReadFailure = vi.fn();
    const mounted = await render(
      <ProjectResourcesPanel
        client={clientFrom(readProjectResources)}
        onReadFailure={onReadFailure}
        pollIntervalMs={250}
        projectId={projectA}
        requestTimeoutMs={250}
      />,
    );

    try {
      await vi.waitFor(() => expect(readProjectResources).toHaveBeenCalledTimes(1));
      await expect
        .element(page.getByLabelText(/Host CPU: Unavailable. CPU telemetry unavailable/i))
        .toBeVisible();
      expect((signal as AbortSignal | null)?.aborted).toBe(true);
      expect(onReadFailure).toHaveBeenCalledExactlyOnceWith("TelemetryReadTimeout");
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(readProjectResources).toHaveBeenCalledTimes(1);
      pending.resolve(telemetryFixture());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.querySelectorAll("[data-project-resource-graph]")).toHaveLength(0);
    } finally {
      await mounted.unmount();
    }
  });

  it("quarantines an abort-ignoring old target until it settles, then admits the new target", async () => {
    const oldRead = deferred<ServerProjectSystemTelemetryResult>();
    const readProjectResources = vi.fn(({ projectId }) =>
      projectId === projectA
        ? oldRead.promise
        : Promise.resolve(telemetryFixture({ projectId: projectB, cpuPercent: 80 })),
    );
    const mounted = await render(
      <ProjectResourcesPanel client={clientFrom(readProjectResources)} projectId={projectA} />,
    );

    try {
      await vi.waitFor(() => expect(readProjectResources).toHaveBeenCalledTimes(1));
      await mounted.rerender(
        <ProjectResourcesPanel client={clientFrom(readProjectResources)} projectId={projectB} />,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(readProjectResources).toHaveBeenCalledTimes(1);
      oldRead.resolve(telemetryFixture({ projectId: projectA }));
      await vi.waitFor(() => expect(readProjectResources).toHaveBeenCalledTimes(2));
      await expect.element(page.getByLabelText(/Host CPU: 80%/i)).toBeVisible();
    } finally {
      await mounted.unmount();
    }
  });

  it("preserves the last controlled hide value when returning to uncontrolled mode", async () => {
    const client = clientFrom(vi.fn(async () => telemetryFixture({ cpuStatus: "unavailable" })));
    const mounted = await render(
      <ProjectResourcesPanel client={client} hideUnavailableGraphs={true} projectId={projectA} />,
    );

    try {
      await vi.waitFor(() =>
        expect(document.querySelector('[data-project-resource-card="cpu"]')).toBeNull(),
      );
      await mounted.rerender(
        <ProjectResourcesPanel
          client={client}
          hideUnavailableGraphs={false}
          projectId={projectA}
        />,
      );
      await vi.waitFor(() =>
        expect(document.querySelector('[data-project-resource-card="cpu"]')).not.toBeNull(),
      );
      await mounted.rerender(<ProjectResourcesPanel client={client} projectId={projectA} />);
      expect(document.querySelector('[data-project-resource-card="cpu"]')).not.toBeNull();
      await page.getByRole("switch", { name: "Hide unavailable resource metrics" }).click();
      expect(document.querySelector('[data-project-resource-card="cpu"]')).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it("aborts the old target and never renders a mismatched project response", async () => {
    const projectARead = deferred<ServerProjectSystemTelemetryResult>();
    const projectBRead = deferred<ServerProjectSystemTelemetryResult>();
    let oldSignal: AbortSignal | null = null;
    const readProjectResources = vi.fn(({ projectId, signal }) => {
      if (projectId === projectA) {
        oldSignal = signal;
        signal.addEventListener(
          "abort",
          () => projectARead.reject(new DOMException("", "AbortError")),
          {
            once: true,
          },
        );
        return projectARead.promise;
      }
      return projectBRead.promise;
    });
    const mounted = await render(
      <ProjectResourcesPanel client={clientFrom(readProjectResources)} projectId={projectA} />,
    );

    try {
      await vi.waitFor(() => expect(readProjectResources).toHaveBeenCalledTimes(1));
      await mounted.rerender(
        <ProjectResourcesPanel client={clientFrom(readProjectResources)} projectId={projectB} />,
      );
      await vi.waitFor(() => expect(readProjectResources).toHaveBeenCalledTimes(2));
      expect((oldSignal as AbortSignal | null)?.aborted).toBe(true);

      projectBRead.resolve(telemetryFixture({ projectId: projectB, cpuPercent: 70 }));
      await expect.element(page.getByLabelText(/Host CPU: 70%/i)).toBeVisible();
      expect(
        document.querySelector('[aria-label="Project resources"]')?.getAttribute("data-project-id"),
      ).toBe(projectB);
    } finally {
      await mounted.unmount();
    }
  });
});
