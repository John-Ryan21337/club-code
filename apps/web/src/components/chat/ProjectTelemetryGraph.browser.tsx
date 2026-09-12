import "../../index.css";

import {
  EnvironmentId,
  ProjectId,
  type ServerProjectSystemTelemetryResult,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { StrictMode, useState } from "react";
import { page, userEvent } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProjectTelemetryGraph } from "./ProjectTelemetryGraph";
import { PROJECT_TELEMETRY_PANEL_STORAGE_KEY } from "./useTelemetryPanelLayout";

const environmentA = EnvironmentId.make("environment-telemetry-a");
const environmentB = EnvironmentId.make("environment-telemetry-b");
const projectA = ProjectId.make("project-telemetry-a");
const projectB = ProjectId.make("project-telemetry-b");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function telemetryFixture(input: {
  readonly projectId: ProjectId;
  readonly cpuPercent?: number;
  readonly freeBytes?: number;
  readonly minimumSampleIntervalMs?: number;
}): ServerProjectSystemTelemetryResult {
  const freeBytes = input.freeBytes ?? 3 * 1024 ** 3;
  return {
    projectId: input.projectId,
    sampledAt: DateTime.makeUnsafe("2026-07-26T12:00:00.000Z"),
    minimumSampleIntervalMs: input.minimumSampleIntervalMs ?? 1_000,
    platform: "linux",
    architecture: "arm64",
    cpu: {
      status: "available",
      utilizationPercent: input.cpuPercent ?? 42,
      logicalProcessorCount: 8,
      detail: null,
    },
    memory: {
      status: "available",
      totalBytes: 8 * 1024 ** 3,
      usedBytes: 6 * 1024 ** 3,
      availableBytes: 2 * 1024 ** 3,
      utilizationPercent: 75,
      detail: null,
    },
    projectVolume: {
      status: "available",
      totalBytes: 10 * 1024 ** 3,
      usedBytes: 7 * 1024 ** 3,
      availableBytes: freeBytes,
      utilizationPercent: 70,
      projectVolumeOnly: true,
      detail: null,
    },
  };
}

describe("ProjectTelemetryGraph", () => {
  beforeEach(async () => {
    window.localStorage.removeItem(PROJECT_TELEMETRY_PANEL_STORAGE_KEY);
    await page.viewport(800, 600);
  });

  it("persists keyboard and pointer geometry, restores within bounds, and resets without new polls", async () => {
    await page.viewport(1200, 800);
    const readTelemetry = vi.fn(async () => telemetryFixture({ projectId: projectA }));
    const panelAt = (width: number, height: number) => (
      <div className="relative" style={{ width, height }}>
        <ProjectTelemetryGraph
          environmentId={environmentA}
          projectId={projectA}
          readTelemetry={readTelemetry}
          pollIntervalMs={Number.MAX_SAFE_INTEGER}
        />
      </div>
    );
    const mounted = await render(panelAt(900, 520));
    try {
      const panel = page.getByRole("complementary", { name: "Selected project system telemetry" });
      await vi.waitFor(() => expect(panel.element().style.left).toBe("540px"));
      const move = page.getByRole("button", { name: "Move project resource graphs" });
      move.element().focus();
      await userEvent.keyboard("{ArrowLeft}{ArrowDown}");
      await vi.waitFor(() => expect(panel.element().style.left).toBe("532px"));
      expect(panel.element().style.top).toBe("16px");
      page.getByRole("button", { name: "Resize project resource graphs" }).element().focus();
      await userEvent.keyboard("{ArrowRight}{ArrowDown}");
      await vi.waitFor(() => expect(panel.element().style.width).toBe("360px"));
      expect(panel.element().style.height).toBe("408px");
      const handle = move.element();
      Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() });
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          isPrimary: true,
          button: 0,
          pointerId: 17,
          clientX: 600,
          clientY: 80,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 17, clientX: 568, clientY: 104 }),
      );
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 17 }));
      await vi.waitFor(() => expect(panel.element().style.left).toBe("500px"));
      expect(
        JSON.parse(localStorage.getItem(PROJECT_TELEMETRY_PANEL_STORAGE_KEY) ?? "null"),
      ).toEqual({ x: 500, y: 40, width: 360, height: 408 });
      expect(readTelemetry).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.unmount();
    }
    const restored = await render(panelAt(420, 300));
    try {
      await page.getByLabelText("Expand Resources").click();
      const panel = page.getByRole("complementary", { name: "Selected project system telemetry" });
      await vi.waitFor(() => expect(panel.element().style.height).toBe("284px"));
      expect(panel.element().style.left).toBe("52px");
      expect(panel.element().style.top).toBe("8px");
      await page.getByRole("button", { name: "Reset resource graph position and size" }).click();
      await vi.waitFor(() =>
        expect(localStorage.getItem(PROJECT_TELEMETRY_PANEL_STORAGE_KEY)).toBeNull(),
      );
      expect(panel.element().style.width).toBe("352px");
      expect(panel.element().style.left).toBe("60px");
    } finally {
      await restored.unmount();
    }
  });

  it("hides only unavailable graphs and preserves measurements and the existing poll", async () => {
    const readTelemetry = vi.fn(async () => telemetryFixture({ projectId: projectA }));
    function Harness() {
      const [hidden, setHidden] = useState(false);
      return (
        <ProjectTelemetryGraph
          environmentId={environmentA}
          projectId={projectA}
          readTelemetry={readTelemetry}
          pollIntervalMs={Number.MAX_SAFE_INTEGER}
          hideUnavailableGraphs={hidden}
          onHideUnavailableGraphsChange={setHidden}
        />
      );
    }
    const mounted = await render(<Harness />);
    try {
      await page.getByLabelText("Expand Resources").click();
      await expect.element(page.getByLabelText(/^Host GPU: Unavailable/)).toBeVisible();
      const toggle = page.getByRole("switch", { name: "Hide unavailable resource graphs" });
      await toggle.click();
      await expect.element(toggle).toBeChecked();
      await expect.element(page.getByLabelText(/^Host GPU: Unavailable/)).not.toBeInTheDocument();
      await expect.element(page.getByLabelText(/^Host CPU: 42%/)).toBeVisible();
      expect(document.body.textContent).not.toContain("GPU adapter histories");
      expect(document.body.textContent).not.toContain("Temperature histories");
      await toggle.click();
      await expect.element(page.getByLabelText(/^Host GPU: Unavailable/)).toBeVisible();
      expect(readTelemetry).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.unmount();
    }
  });

  it("keeps GPU identity through disappearance and reordered samples", async () => {
    const adapter = (index: number, utilizationPercent: number) => ({
      index,
      name: `Adapter ${index}`,
      utilizationPercent,
      memoryTotalBytes: 8192,
      memoryUsedBytes: 2048,
      memoryUtilizationPercent: 25,
      temperatureCelsius: 60,
    });
    const sample = (
      adapters: ReturnType<typeof adapter>[],
    ): ServerProjectSystemTelemetryResult => ({
      ...telemetryFixture({ projectId: projectA, minimumSampleIntervalMs: 250 }),
      gpu: { status: "available", reason: null, detail: null, adapters },
    });
    const missing = deferred<ServerProjectSystemTelemetryResult>();
    const returned = deferred<ServerProjectSystemTelemetryResult>();
    const final = sample([adapter(7, 90), adapter(2, 30)]);
    const readTelemetry = vi
      .fn()
      .mockResolvedValueOnce(sample([adapter(2, 20), adapter(7, 70)]))
      .mockImplementationOnce(() => missing.promise)
      .mockImplementationOnce(() => returned.promise)
      .mockResolvedValue(final);
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        projectId={projectA}
        pollIntervalMs={250}
        readTelemetry={readTelemetry}
      />,
    );
    try {
      await page.getByLabelText("Expand Resources").click();
      await page.getByText("GPU adapter histories", { exact: true }).click();
      await expect
        .element(
          page.getByRole("group", {
            name: "GPU 3: 20%. Measured adapter utilization.",
            exact: true,
          }),
        )
        .toBeVisible();
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(2));
      missing.resolve(sample([adapter(7, 80)]));
      await expect
        .element(
          page.getByRole("group", {
            name: "GPU 3: 20%. Measured adapter utilization.",
            exact: true,
          }),
        )
        .not.toBeInTheDocument();
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(3));
      returned.resolve(final);
      await expect
        .element(
          page.getByRole("group", {
            name: "GPU 3: 30%. Measured adapter utilization.",
            exact: true,
          }),
        )
        .toBeVisible();
      const path = page
        .getByRole("img", { name: "GPU 3 utilization history", exact: true })
        .element()
        .querySelectorAll("path")[1]
        ?.getAttribute("d");
      expect(path?.match(/M/g)).toHaveLength(2);
      const gpu8 = page
        .getByRole("img", { name: "GPU 8 utilization history", exact: true })
        .element()
        .querySelectorAll("path")[1]
        ?.getAttribute("d");
      expect(gpu8?.match(/M/g)).toHaveLength(1);
    } finally {
      await mounted.unmount();
    }
  });

  it("shows hottest category histories and clears them when the selected project changes", async () => {
    const readTelemetry = vi.fn(async (_environmentId, projectId) => ({
      ...telemetryFixture({ projectId }),
      ...(projectId === projectA
        ? {
            temperatures: {
              version: 1 as const,
              status: "available" as const,
              reason: null,
              detail: null,
              sensors: [
                {
                  kind: "cpu" as const,
                  label: "Core 1",
                  source: "linux-hwmon" as const,
                  temperatureCelsius: 40,
                },
                {
                  kind: "cpu" as const,
                  label: "Core 2",
                  source: "linux-hwmon" as const,
                  temperatureCelsius: 60,
                },
                {
                  kind: "gpu" as const,
                  label: "GPU",
                  source: "nvidia-smi" as const,
                  temperatureCelsius: 0,
                },
              ],
            },
          }
        : {}),
    }));
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        projectId={projectA}
        readTelemetry={readTelemetry}
      />,
    );
    try {
      await page.getByLabelText("Expand Resources").click();
      await page.getByText("Temperature histories", { exact: true }).click();
      await expect
        .element(page.getByLabelText("CPU temperature: 60 °C. Hottest of 2 reported sensors."))
        .toBeVisible();
      await expect
        .element(page.getByLabelText("GPU temperature: 0 °C. Hottest of 1 reported sensor."))
        .toBeVisible();
      await expect
        .element(
          page.getByLabelText(
            "RAM temperature: Unavailable. No measured sensor in this category.",
            { exact: true },
          ),
        )
        .toBeVisible();
      const cpuGraph = page.getByRole("img", { name: "CPU temperature history" }).element();
      expect(cpuGraph.querySelector("circle")).not.toBeNull();
      const panel = page.getByLabelText("Selected project system telemetry").element();
      expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight - 16);
      const cpuCard = page
        .getByLabelText("CPU temperature: 60 °C. Hottest of 2 reported sensors.")
        .element();
      cpuCard.scrollIntoView({ block: "nearest" });
      expect(cpuCard.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        panel.getBoundingClientRect().top,
      );
      expect(cpuCard.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        panel.getBoundingClientRect().bottom,
      );
      await mounted.rerender(
        <ProjectTelemetryGraph
          environmentId={environmentA}
          projectId={projectB}
          readTelemetry={readTelemetry}
        />,
      );
      await expect
        .element(
          page.getByLabelText("CPU temperature: Unavailable. No measured sensor in this category."),
        )
        .toBeVisible();
      expect(
        page
          .getByRole("img", { name: "CPU temperature history" })
          .element()
          .querySelector("circle"),
      ).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it("shows reported temperatures and explains missing host sensors without inventing values", async () => {
    const measurement: ServerProjectSystemTelemetryResult = {
      ...telemetryFixture({ projectId: projectA }),
      temperatures: {
        version: 1,
        status: "available",
        reason: null,
        detail: null,
        sensors: [
          { kind: "gpu", label: "NVIDIA Test GPU", source: "nvidia-smi", temperatureCelsius: 61.5 },
        ],
        hostSensorProbe: {
          status: "unavailable",
          reason: "provider-missing",
          detail: "Host sensor provider is unavailable.",
        },
      },
    };
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        projectId={projectA}
        readTelemetry={async () => measurement}
      />,
    );
    try {
      await page.getByLabelText("Expand Resources").click();
      await page.getByText("Host temperatures (1)").click();
      await expect.element(page.getByText("NVIDIA Test GPU", { exact: true })).toBeVisible();
      await expect
        .element(
          page.getByLabelText("Measured host temperatures").getByText("61.5 °C", { exact: true }),
        )
        .toBeVisible();
      await expect.element(page.getByText("Host sensor provider is unavailable.")).toBeVisible();
    } finally {
      await mounted.unmount();
    }
  });

  it("removes old temperature values when the next telemetry request fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectNext!: (error: Error) => void;
    const nextRead = new Promise<ServerProjectSystemTelemetryResult>((_resolve, reject) => {
      rejectNext = reject;
    });
    const readTelemetry = vi
      .fn()
      .mockResolvedValueOnce({
        ...telemetryFixture({ projectId: projectA, minimumSampleIntervalMs: 250 }),
        temperatures: {
          version: 1,
          status: "available",
          reason: null,
          detail: null,
          sensors: [
            { kind: "cpu", label: "CPU package", source: "linux-hwmon", temperatureCelsius: 55.5 },
          ],
        },
      })
      .mockImplementation(() => nextRead);
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        projectId={projectA}
        readTelemetry={readTelemetry}
        pollIntervalMs={250}
      />,
    );
    try {
      await page.getByLabelText("Expand Resources").click();
      await page.getByText("Host temperatures (1)").click();
      await expect
        .element(
          page.getByLabelText("Measured host temperatures").getByText("55.5 °C", { exact: true }),
        )
        .toBeVisible();
      await page.getByText("Temperature histories", { exact: true }).click();
      await expect
        .element(page.getByLabelText("CPU temperature: 55.5 °C. Hottest of 1 reported sensor."))
        .toBeVisible();
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(2));
      rejectNext(new Error("synthetic request failure"));
      await expect.element(page.getByText("Host temperatures — unavailable")).toBeVisible();
      await expect.element(page.getByText("55.5 °C", { exact: true })).not.toBeInTheDocument();
      await expect
        .element(
          page.getByLabelText("CPU temperature: Unavailable. No measured sensor in this category."),
        )
        .toBeVisible();
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.unmount();
      errorLog.mockRestore();
    }
  });

  it("renders measured GPU utilization and combined VRAM from the telemetry response", async () => {
    const measurement: ServerProjectSystemTelemetryResult = {
      ...telemetryFixture({ projectId: projectA }),
      gpu: {
        status: "available",
        reason: null,
        detail: null,
        adapters: [
          {
            index: 0,
            name: "NVIDIA Test GPU",
            utilizationPercent: 62,
            memoryTotalBytes: 8 * 1024 ** 3,
            memoryUsedBytes: 2 * 1024 ** 3,
            memoryUtilizationPercent: 25,
          },
        ],
      },
    };
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        projectId={projectA}
        readTelemetry={async () => measurement}
      />,
    );
    try {
      await page.getByLabelText("Expand Resources").click();
      await expect
        .element(page.getByLabelText(/GPU: 62%.*Peak across 1 GPU adapter/))
        .toBeVisible();
      await expect.element(page.getByLabelText(/^Host VRAM: 25%.*6 GiB available/)).toBeVisible();
    } finally {
      await mounted.unmount();
    }
  });

  it("renders selected-project disk free space and honest unavailable GPU fields", async () => {
    const first = deferred<ServerProjectSystemTelemetryResult>();
    const readTelemetry = vi.fn(() => first.promise);
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        projectId={projectA}
        projectName="Cafe workspace"
        readTelemetry={readTelemetry}
      />,
    );

    try {
      expect(
        document
          .querySelector('button[aria-label="Expand Resources"]')
          ?.hasAttribute("aria-controls"),
      ).toBe(false);
      await page.getByLabelText("Expand Resources").click();
      const collapseButton = document.querySelector(
        'button[aria-label="Collapse project resource graphs"]',
      );
      expect(document.getElementById(collapseButton?.getAttribute("aria-controls") ?? "")).not.toBe(
        null,
      );
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(1));
      await expect.element(page.getByLabelText(/GPU: Waiting/i)).toBeVisible();
      await expect.element(page.getByLabelText(/VRAM: Waiting/i)).toBeVisible();
      first.resolve(telemetryFixture({ projectId: projectA }));
      await expect.element(page.getByText("3 GiB free · selected project volume")).toBeVisible();
      await expect
        .element(page.getByLabelText(/GPU: Unavailable.*unavailable from this backend/i))
        .toBeVisible();
      await expect
        .element(page.getByLabelText(/VRAM: Unavailable.*unavailable from this backend/i))
        .toBeVisible();
      await expect
        .element(page.getByText(/Host metrics: selected environment.*selected project volume/i))
        .toBeVisible();
      expect(readTelemetry).toHaveBeenCalledExactlyOnceWith(environmentA, projectA);
      const panel = document.querySelector('[aria-label="Selected project system telemetry"]');
      expect(panel?.getAttribute("data-project-id")).toBe(projectA);
    } finally {
      await mounted.unmount();
    }
  });

  it("launches one request under StrictMode and stops future polling while collapsed", async () => {
    const first = deferred<ServerProjectSystemTelemetryResult>();
    const readTelemetry = vi.fn(() => first.promise);
    const mounted = await render(
      <StrictMode>
        <ProjectTelemetryGraph
          environmentId={environmentA}
          pollIntervalMs={250}
          projectId={projectA}
          readTelemetry={readTelemetry}
        />
      </StrictMode>,
    );

    try {
      await page.getByLabelText("Expand Resources").click();
      await vi.waitFor(() =>
        expect(document.activeElement?.getAttribute("aria-label")).toBe(
          "Collapse project resource graphs",
        ),
      );
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(1));
      first.resolve(telemetryFixture({ projectId: projectA, minimumSampleIntervalMs: 250 }));
      await expect.element(page.getByText("3 GiB free · selected project volume")).toBeVisible();
      await page.getByLabelText("Collapse project resource graphs").click();
      await vi.waitFor(() =>
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Expand Resources"),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(readTelemetry).toHaveBeenCalledTimes(1);

      await page.getByLabelText("Expand Resources").click();
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(2));
    } finally {
      await mounted.unmount();
    }
  });

  it("lets an old request finish before polling a newly selected environment and project", async () => {
    const requestA = deferred<ServerProjectSystemTelemetryResult>();
    const requestB = deferred<ServerProjectSystemTelemetryResult>();
    const readTelemetry = vi.fn((environmentId: EnvironmentId, projectId: ProjectId) => {
      if (environmentId === environmentA && projectId === projectA) return requestA.promise;
      if (environmentId === environmentB && projectId === projectB) return requestB.promise;
      throw new Error("Unexpected telemetry target.");
    });
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        projectId={projectA}
        readTelemetry={readTelemetry}
      />,
    );

    try {
      await page.getByLabelText("Expand Resources").click();
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(1));
      await mounted.rerender(
        <ProjectTelemetryGraph
          environmentId={environmentB}
          projectId={projectB}
          projectName="Second workspace"
          readTelemetry={readTelemetry}
        />,
      );
      expect(readTelemetry).toHaveBeenCalledTimes(1);

      requestA.resolve(telemetryFixture({ projectId: projectA, freeBytes: 1 * 1024 ** 3 }));
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(2));
      expect(readTelemetry).toHaveBeenLastCalledWith(environmentB, projectB);
      expect(document.body.textContent).not.toContain("1 GiB free · selected project volume");

      requestB.resolve(telemetryFixture({ projectId: projectB, freeBytes: 5 * 1024 ** 3 }));
      await expect.element(page.getByText("5 GiB free · selected project volume")).toBeVisible();
      const panel = document.querySelector('[aria-label="Selected project system telemetry"]');
      expect(panel?.getAttribute("data-project-id")).toBe(projectB);
    } finally {
      await mounted.unmount();
    }
  });

  it("does not schedule another request after unmount while one read finishes", async () => {
    const pending = deferred<ServerProjectSystemTelemetryResult>();
    const readTelemetry = vi.fn(() => pending.promise);
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        pollIntervalMs={250}
        projectId={projectA}
        readTelemetry={readTelemetry}
      />,
    );

    await page.getByLabelText("Expand Resources").click();
    await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(1));
    await mounted.unmount();
    pending.resolve(telemetryFixture({ projectId: projectA, minimumSampleIntervalMs: 250 }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(readTelemetry).toHaveBeenCalledTimes(1);
  });

  it("bounds the movable overlay while preserving the full message timeline height", async () => {
    await page.viewport(1_200, 800);
    const readTelemetry = vi.fn(async () => telemetryFixture({ projectId: projectA }));
    const mounted = await render(
      <div className="relative flex h-[500px] flex-col">
        <ProjectTelemetryGraph
          environmentId={environmentA}
          projectId={projectA}
          readTelemetry={readTelemetry}
        />
        <div className="min-h-0 flex-1" data-testid="telemetry-timeline-space" />
      </div>,
    );

    try {
      await expect.element(page.getByLabelText("Collapse project resource graphs")).toBeVisible();
      const panel = document.querySelector('[aria-label="Selected project system telemetry"]');
      const timeline = document.querySelector('[data-testid="telemetry-timeline-space"]');
      expect(panel?.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        timeline?.getBoundingClientRect().bottom ?? 0,
      );
      expect(timeline?.getBoundingClientRect().height).toBe(500);
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(1));
    } finally {
      await mounted.unmount();
      await page.viewport(800, 600);
    }
  });

  it("lets an in-flight read drain while hidden, then resumes automatically", async () => {
    const pending = deferred<ServerProjectSystemTelemetryResult>();
    const readTelemetry = vi
      .fn()
      .mockResolvedValueOnce(
        telemetryFixture({ projectId: projectA, minimumSampleIntervalMs: 250 }),
      )
      .mockImplementation(() => pending.promise);
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        pollIntervalMs={250}
        projectId={projectA}
        readTelemetry={readTelemetry}
      />,
    );

    try {
      await page.getByLabelText("Expand Resources").click();
      await expect.element(page.getByLabelText(/Host CPU: 42%/i)).toBeVisible();
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(2));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      pending.resolve(telemetryFixture({ projectId: projectA, minimumSampleIntervalMs: 250 }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(readTelemetry).toHaveBeenCalledTimes(2);

      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => {
        const paths = document.querySelectorAll(
          'svg[aria-label="Host CPU utilization history"] path',
        );
        expect(paths[1]?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
      });
    } finally {
      await mounted.unmount();
      if (originalVisibility)
        Object.defineProperty(document, "visibilityState", originalVisibility);
      else Reflect.deleteProperty(document, "visibilityState");
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });

  it("captures synchronous RPC failures without unsafe diagnostics or timer overflow", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const readTelemetry = vi.fn(() => {
      throw { _tag: "ProjectLookupFailed", message: "sensitive backend detail" };
    });
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        pollIntervalMs={Number.MAX_SAFE_INTEGER}
        projectId={projectA}
        readTelemetry={readTelemetry}
      />,
    );

    try {
      await page.getByLabelText("Expand Resources").click();
      await expect
        .element(page.getByLabelText(/CPU: Unavailable. Telemetry unavailable/i))
        .toBeVisible();
      expect(diagnostic).toHaveBeenCalledWith(
        "[PROJECT_TELEMETRY] read failed",
        "ProjectLookupFailed",
      );
      expect(document.body.textContent).not.toContain("sensitive backend detail");

      const unsafeError = Object.assign(new Error("sensitive path"), {
        name: "Unsafe\nC:\\workspace",
      });
      const unsafeRead = vi.fn(() => {
        throw unsafeError;
      });
      await mounted.rerender(
        <ProjectTelemetryGraph
          environmentId={environmentA}
          pollIntervalMs={Number.MAX_SAFE_INTEGER}
          projectId={projectA}
          readTelemetry={unsafeRead}
        />,
      );
      await vi.waitFor(() =>
        expect(diagnostic).toHaveBeenLastCalledWith("[PROJECT_TELEMETRY] read failed", "Error"),
      );

      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(readTelemetry).toHaveBeenCalledTimes(1);
      expect(unsafeRead).toHaveBeenCalledTimes(1);
    } finally {
      diagnostic.mockRestore();
      await mounted.unmount();
    }
  });

  it("replaces stale values with an explicit outage state after a successful sample", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = deferred<void>();
    const readTelemetry = vi
      .fn()
      .mockResolvedValueOnce(
        telemetryFixture({ projectId: projectA, minimumSampleIntervalMs: 250 }),
      )
      .mockImplementation(async () => {
        await failure.promise;
        throw { _tag: "TelemetryOffline" };
      });
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        pollIntervalMs={250}
        projectId={projectA}
        readTelemetry={readTelemetry}
      />,
    );

    try {
      await page.getByLabelText("Expand Resources").click();
      await expect.element(page.getByLabelText(/Host CPU: 42%/i)).toBeVisible();
      failure.resolve(undefined);
      await expect
        .element(page.getByLabelText(/Host CPU: Unavailable. Telemetry unavailable/i))
        .toBeVisible();
      await expect
        .element(page.getByLabelText(/Host GPU: Unavailable. Telemetry unavailable/i))
        .toBeVisible();
      expect(document.body.textContent).toContain("last successful");
    } finally {
      failure.resolve(undefined);
      await mounted.unmount();
      diagnostic.mockRestore();
    }
  });
});

it("keeps geometry controls usable when local persistence is unavailable", async () => {
  await page.viewport(1000, 700);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage unavailable", "QuotaExceededError");
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const mounted = await render(
    <div className="relative h-[500px]">
      <ProjectTelemetryGraph
        environmentId={environmentA}
        projectId={projectA}
        readTelemetry={async () => telemetryFixture({ projectId: projectA })}
      />
    </div>,
  );
  try {
    const panel = page.getByRole("complementary", { name: "Selected project system telemetry" });
    await expect.element(panel).toBeVisible();
    const before = panel.element().getBoundingClientRect().left;
    page.getByRole("button", { name: "Move project resource graphs" }).element().focus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    await expect.poll(() => panel.element().getBoundingClientRect().left).toBe(before - 16);
    await page.getByRole("button", { name: "Reset resource graph position and size" }).click();
    await expect.poll(() => panel.element().getBoundingClientRect().left).toBe(before);
  } finally {
    await mounted.unmount();
    write.mockRestore();
    log.mockRestore();
  }
});
