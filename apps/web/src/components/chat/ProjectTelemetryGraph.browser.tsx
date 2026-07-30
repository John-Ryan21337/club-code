import "../../index.css";

import {
  EnvironmentId,
  ProjectId,
  type ServerProjectSystemTelemetryResult,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { StrictMode } from "react";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { matrixColorFrameStore } from "../../matrixColorFrameStore";
import {
  ProjectTelemetryGraph,
  PROJECT_TELEMETRY_PANEL_STORAGE_KEY,
} from "./ProjectTelemetryGraph";

const environmentA = EnvironmentId.make("environment-telemetry-a");
const environmentB = EnvironmentId.make("environment-telemetry-b");
const projectA = ProjectId.make("project-telemetry-a");
const projectB = ProjectId.make("project-telemetry-b");
let matrixPaletteOwner: object;

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
    network: {
      status: "available",
      receiveBytesPerSecond: 1024 ** 2,
      transmitBytesPerSecond: 256 * 1024,
      detail: null,
    },
    gpu: {
      status: "unavailable",
      adapters: [],
      reason: "unsupported",
      detail: "GPU telemetry is unavailable from this backend.",
    },
    temperatures: {
      version: 1,
      status: "available",
      sensors: [
        { kind: "cpu", label: "CPU Package", temperatureCelsius: 62, source: "linux-hwmon" },
        { kind: "gpu", label: "GPU Core", temperatureCelsius: 48, source: "nvidia-smi" },
        { kind: "memory", label: "DIMM", temperatureCelsius: 39, source: "linux-hwmon" },
        { kind: "vram", label: "GPU Memory", temperatureCelsius: 70, source: "linux-hwmon" },
        { kind: "storage", label: "NVMe", temperatureCelsius: 42, source: "linux-hwmon" },
        { kind: "ambient", label: "System", temperatureCelsius: 26, source: "linux-hwmon" },
        { kind: "other", label: "Chipset", temperatureCelsius: 45, source: "linux-hwmon" },
      ],
      reason: null,
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
    await page.viewport(800, 600);
    window.localStorage.removeItem(PROJECT_TELEMETRY_PANEL_STORAGE_KEY);
    matrixPaletteOwner = {};
    matrixColorFrameStore.claim(matrixPaletteOwner);
    matrixColorFrameStore.publish(
      matrixPaletteOwner,
      {
        color: "#4ade80",
        perStream: false,
        baseHue: null,
        saturation: null,
        lightness: null,
      },
      "frozen",
    );
  });

  afterEach(() => matrixColorFrameStore.release(matrixPaletteOwner));

  it("uses transparent surfaces and moves every graph stroke with the Matrix frame", async () => {
    await page.viewport(1_200, 800);
    const telemetry = telemetryFixture({ projectId: projectA });
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        projectId={projectA}
        readTelemetry={vi.fn(async () => ({
          ...telemetry,
          gpu: {
            status: "available" as const,
            adapters: [
              {
                index: 0,
                name: "GPU 0",
                utilizationPercent: 50,
                memoryTotalBytes: 8 * 1024 ** 3,
                memoryUsedBytes: 2 * 1024 ** 3,
                memoryUtilizationPercent: 25,
              },
            ],
            reason: null,
            detail: null,
          },
        }))}
      />,
    );
    let unmounted = false;

    try {
      await expect.element(page.getByLabelText(/Host CPU: 42%/i)).toBeVisible();
      const panel = document.querySelector<HTMLElement>('[data-project-telemetry-panel="true"]');
      expect(panel).not.toBeNull();
      expect(getComputedStyle(panel!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      const cards = [...document.querySelectorAll<HTMLElement>("[data-project-telemetry-card]")];
      expect(cards).toHaveLength(13);
      expect(
        cards.every((card) => getComputedStyle(card).backgroundColor === "rgba(0, 0, 0, 0)"),
      ).toBe(true);
      const resizeControl = page.getByLabelText("Resize project resource graphs");
      await resizeControl.hover();
      expect(getComputedStyle(resizeControl.element()).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(panel?.dataset.matrixPaletteColor).toBe("#4ade80");
      expect(panel?.dataset.matrixPaletteMotion).toBe("frozen");

      const series = [...document.querySelectorAll<SVGElement>("[data-project-telemetry-series]")];
      expect(series).toHaveLength(13);
      const firstStrokes = series.map((svg) => {
        const paths = [...svg.querySelectorAll("path")];
        expect(paths).toHaveLength(2);
        expect(paths.every((path) => path.getAttribute("stroke")?.startsWith("var("))).toBe(true);
        return getComputedStyle(paths[1]!).stroke;
      });
      expect(new Set(firstStrokes).size).toBe(13);

      matrixColorFrameStore.publish(
        matrixPaletteOwner,
        {
          color: "hsl(220.0 88.0% 62.0%)",
          perStream: true,
          baseHue: 220,
          saturation: 88,
          lightness: 62,
        },
        "animated",
      );

      await vi.waitFor(() =>
        expect(panel?.dataset.matrixPaletteColor).toBe("hsl(220.0 88.0% 62.0%)"),
      );
      expect(panel?.dataset.matrixPaletteMotion).toBe("animated");
      const nextStrokes = series.map(
        (svg) => getComputedStyle(svg.querySelectorAll("path")[1]!).stroke,
      );
      expect(new Set(nextStrokes).size).toBe(13);
      nextStrokes.forEach((stroke, index) => expect(stroke).not.toBe(firstStrokes[index]));

      await page.getByLabelText("Collapse project resource graphs").click();
      const collapsed = document.querySelector<HTMLElement>(
        '[data-project-telemetry-collapsed="true"]',
      );
      expect(collapsed).not.toBeNull();
      expect(getComputedStyle(collapsed!).backgroundColor).toBe("rgba(0, 0, 0, 0)");

      const collapsedCpuColor = panel!.style.getPropertyValue("--cafe-project-telemetry-cpu");
      matrixColorFrameStore.publish(
        matrixPaletteOwner,
        {
          color: "hsl(280.0 88.0% 62.0%)",
          perStream: true,
          baseHue: 280,
          saturation: 88,
          lightness: 62,
        },
        "animated",
      );
      expect(panel?.dataset.matrixPaletteColor).toBe("hsl(220.0 88.0% 62.0%)");
      expect(panel?.style.getPropertyValue("--cafe-project-telemetry-cpu")).toBe(collapsedCpuColor);

      await page.getByLabelText("Expand Resources").click();
      const resumedPanel = document.querySelector<HTMLElement>(
        '[data-project-telemetry-panel="true"]',
      );
      await vi.waitFor(() =>
        expect(resumedPanel?.dataset.matrixPaletteColor).toBe("hsl(280.0 88.0% 62.0%)"),
      );
      const unmountedCpuColor = resumedPanel!.style.getPropertyValue(
        "--cafe-project-telemetry-cpu",
      );
      await mounted.unmount();
      unmounted = true;
      matrixColorFrameStore.publish(
        matrixPaletteOwner,
        {
          color: "hsl(320.0 88.0% 62.0%)",
          perStream: true,
          baseHue: 320,
          saturation: 88,
          lightness: 62,
        },
        "animated",
      );
      expect(resumedPanel?.dataset.matrixPaletteColor).toBe("hsl(280.0 88.0% 62.0%)");
      expect(resumedPanel?.style.getPropertyValue("--cafe-project-telemetry-cpu")).toBe(
        unmountedCpuColor,
      );
    } finally {
      if (!unmounted) await mounted.unmount();
      await page.viewport(800, 600);
    }
  });

  it("renders every GPU adapter in stable index order with its own VRAM and temperature", async () => {
    await page.viewport(1_200, 800);
    const gibibyte = 1024 ** 3;
    const telemetry = telemetryFixture({ projectId: projectA });
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        pollIntervalMs={Number.MAX_SAFE_INTEGER}
        projectId={projectA}
        readTelemetry={vi.fn(async () => ({
          ...telemetry,
          gpu: {
            status: "available" as const,
            adapters: [
              {
                index: 1,
                name: "NVIDIA GeForce RTX 3090 B",
                utilizationPercent: 7,
                memoryTotalBytes: 24 * gibibyte,
                memoryUsedBytes: 4 * gibibyte,
                memoryUtilizationPercent: 100 / 6,
              },
              {
                index: 0,
                name: "NVIDIA GeForce RTX 3090 A",
                utilizationPercent: 24,
                memoryTotalBytes: 24 * gibibyte,
                memoryUsedBytes: 6 * gibibyte,
                memoryUtilizationPercent: 25,
                temperatureCelsius: 49,
              },
            ],
            reason: null,
            detail: null,
          },
        }))}
      />,
    );

    try {
      await expect.element(page.getByLabelText(/Host CPU: 42%/i)).toBeVisible();
      await expect.element(page.getByLabelText(/Host RAM: 75%/i)).toBeVisible();
      await expect.element(page.getByLabelText(/Project disk: 70%/i)).toBeVisible();
      await expect.element(page.getByLabelText(/Host network:/i)).toBeVisible();
      await expect
        .element(
          page.getByLabelText(
            /GPU 1: 24%\. NVIDIA GeForce RTX 3090 A.*49°C.*selected environment/i,
          ),
        )
        .toBeVisible();
      await expect
        .element(page.getByLabelText(/GPU 1 VRAM: 6 GiB \/ 24 GiB\. 18 GiB free.*25% used/i))
        .toBeVisible();
      await expect
        .element(
          page.getByLabelText(/GPU 2: 7%\. NVIDIA GeForce RTX 3090 B.*temperature unavailable/i),
        )
        .toBeVisible();
      await expect
        .element(page.getByLabelText(/GPU 2 VRAM: 4 GiB \/ 24 GiB\. 20 GiB free.*17% used/i))
        .toBeVisible();

      const cardLabels = [
        ...document.querySelectorAll<HTMLElement>("[data-project-telemetry-card]"),
      ].map((card) => card.dataset.projectTelemetryCard);
      expect(cardLabels.slice(4, 8)).toEqual(["GPU 1", "GPU 1 VRAM", "GPU 2", "GPU 2 VRAM"]);
    } finally {
      await mounted.unmount();
      await page.viewport(800, 600);
    }
  });

  it("stays collapsed on a narrow/mobile anchor until explicitly expanded", async () => {
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
      await expect
        .element(page.getByLabelText(/Host network:.*1 MiB\/s.*256 KiB\/s/i))
        .toBeVisible();
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
          // Keep the next legitimate expanded poll outside the interaction window so a
          // loaded browser worker cannot race it against the collapse click.
          pollIntervalMs={5_000}
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

  it("uses a bounded overlay without reserving any message-timeline height", async () => {
    await page.viewport(1_200, 800);
    const readTelemetry = vi.fn(async () => telemetryFixture({ projectId: projectA }));
    const mounted = await render(
      <div
        className="relative flex h-[500px] w-[900px] flex-col"
        data-testid="telemetry-chat-anchor"
      >
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
      const anchor = document.querySelector<HTMLElement>('[data-testid="telemetry-chat-anchor"]')!;
      const slot = document.querySelector<HTMLElement>('[data-project-telemetry-slot="true"]')!;
      const panel = document.querySelector<HTMLElement>(
        '[aria-label="Selected project system telemetry"]',
      )!;
      const timeline = document.querySelector<HTMLElement>(
        '[data-testid="telemetry-timeline-space"]',
      )!;
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const timelineRect = timeline.getBoundingClientRect();

      expect(slot.dataset.projectTelemetryPositioning).toBe("overlay");
      expect(getComputedStyle(slot).position).toBe("absolute");
      expect(timelineRect.top).toBe(anchorRect.top);
      expect(timelineRect.height).toBe(anchorRect.height);
      expect(panelRect.left).toBeGreaterThanOrEqual(anchorRect.left);
      expect(panelRect.top).toBeGreaterThanOrEqual(anchorRect.top);
      expect(panelRect.right).toBeLessThanOrEqual(anchorRect.right);
      expect(panelRect.bottom).toBeLessThanOrEqual(anchorRect.bottom);
      await vi.waitFor(() => expect(readTelemetry).toHaveBeenCalledTimes(1));
    } finally {
      await mounted.unmount();
      await page.viewport(800, 600);
    }
  });

  it("persists pointer and keyboard geometry while clamping a restored panel", async () => {
    await page.viewport(1_200, 800);
    const readTelemetry = vi.fn(async () => telemetryFixture({ projectId: projectA }));
    const renderPanel = (width: number, height: number) => (
      <div className="relative" style={{ width, height }}>
        <ProjectTelemetryGraph
          environmentId={environmentA}
          projectId={projectA}
          readTelemetry={readTelemetry}
        />
      </div>
    );
    const mounted = await render(renderPanel(900, 520));

    try {
      const panel = page.getByRole("complementary", {
        name: "Selected project system telemetry",
      });
      await expect.element(panel).toBeVisible();
      await vi.waitFor(() => expect(panel.element().style.left).toBe("540px"));

      const move = page.getByRole("button", { name: "Move project resource graphs" });
      move.element().focus();
      await userEvent.keyboard("{ArrowLeft}{ArrowDown}");
      await vi.waitFor(() => {
        expect(panel.element().style.left).toBe("532px");
        expect(panel.element().style.top).toBe("16px");
      });

      const resize = page.getByRole("button", { name: "Resize project resource graphs" });
      resize.element().focus();
      await userEvent.keyboard("{ArrowRight}{ArrowDown}");
      await vi.waitFor(() => {
        expect(panel.element().style.width).toBe("360px");
        expect(panel.element().style.height).toBe("408px");
      });

      const moveElement = move.element();
      Object.defineProperty(moveElement, "setPointerCapture", { value: vi.fn() });
      const leftBeforePointerDrag = panel.element().getBoundingClientRect().left;
      moveElement.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 17,
          clientX: 600,
          clientY: 80,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 17,
          clientX: 568,
          clientY: 104,
        }),
      );
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 17 }));
      await vi.waitFor(() =>
        expect(panel.element().getBoundingClientRect().left).toBeLessThan(leftBeforePointerDrag),
      );

      const persisted = JSON.parse(
        window.localStorage.getItem(PROJECT_TELEMETRY_PANEL_STORAGE_KEY) ?? "null",
      ) as { x: number; y: number; width: number; height: number } | null;
      expect(persisted).toMatchObject({
        width: 360,
        height: 408,
      });
      expect(persisted?.x).toBeLessThan(532);
      expect(persisted?.y).toBeGreaterThan(16);

      await mounted.unmount();
      const restored = await render(renderPanel(420, 300));
      try {
        await expect.element(page.getByLabelText("Expand Resources")).toBeVisible();
        await page.getByLabelText("Expand Resources").click();
        const restoredPanel = page.getByRole("complementary", {
          name: "Selected project system telemetry",
        });
        await expect.element(restoredPanel).toBeVisible();
        await vi.waitFor(() => {
          const panelRect = restoredPanel.element().getBoundingClientRect();
          const anchorRect = restoredPanel.element().parentElement!.getBoundingClientRect();
          expect(panelRect.left).toBeGreaterThanOrEqual(anchorRect.left);
          expect(panelRect.top).toBeGreaterThanOrEqual(anchorRect.top);
          expect(panelRect.right).toBeLessThanOrEqual(anchorRect.right);
          expect(panelRect.bottom).toBeLessThanOrEqual(anchorRect.bottom);
        });
        expect(restoredPanel.element().style.width).toBe("360px");
        expect(restoredPanel.element().style.height).toBe("284px");
      } finally {
        await restored.unmount();
      }
    } finally {
      if (document.querySelector('[data-project-telemetry-slot="true"]')) {
        await mounted.unmount();
      }
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
      const panel = document.querySelector<HTMLElement>('[data-project-telemetry-panel="true"]')!;
      const visibleCpuColor = panel.style.getPropertyValue("--cafe-project-telemetry-cpu");
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.waitFor(() => expect(panel.dataset.matrixPaletteActive).toBe("false"));
      matrixColorFrameStore.publish(
        matrixPaletteOwner,
        {
          color: "hsl(260.0 88.0% 62.0%)",
          perStream: true,
          baseHue: 260,
          saturation: 88,
          lightness: 62,
        },
        "animated",
      );
      expect(panel.style.getPropertyValue("--cafe-project-telemetry-cpu")).toBe(visibleCpuColor);
      expect(panel.dataset.matrixPaletteColor).toBe("#4ade80");
      pending.resolve(telemetryFixture({ projectId: projectA, minimumSampleIntervalMs: 250 }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(readTelemetry).toHaveBeenCalledTimes(2);

      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.waitFor(() => expect(panel.dataset.matrixPaletteActive).toBe("true"));
      await vi.waitFor(() =>
        expect(panel.dataset.matrixPaletteColor).toBe("hsl(260.0 88.0% 62.0%)"),
      );
      expect(panel.style.getPropertyValue("--cafe-project-telemetry-cpu")).not.toBe(
        visibleCpuColor,
      );
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
    const readTelemetry = vi
      .fn()
      .mockResolvedValueOnce(
        telemetryFixture({ projectId: projectA, minimumSampleIntervalMs: 250 }),
      )
      .mockRejectedValue({ _tag: "TelemetryOffline" });
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
      await expect
        .element(page.getByLabelText(/Host CPU: Unavailable. Telemetry unavailable/i))
        .toBeVisible();
      await expect
        .element(page.getByLabelText(/Host GPU: Unavailable. Telemetry unavailable/i))
        .toBeVisible();
      expect(document.body.textContent).toContain("last successful");
    } finally {
      diagnostic.mockRestore();
      await mounted.unmount();
    }
  });

  it("renders unsupported temperature classes explicitly unavailable without estimates", async () => {
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        pollIntervalMs={Number.MAX_SAFE_INTEGER}
        projectId={projectA}
        readTelemetry={vi.fn(async () => ({
          ...telemetryFixture({ projectId: projectA }),
          temperatures: {
            version: 1 as const,
            status: "available" as const,
            sensors: [
              {
                kind: "gpu" as const,
                label: "NVIDIA GPU 0",
                temperatureCelsius: 48,
                source: "nvidia-smi" as const,
              },
            ],
            hostSensorProbe: {
              status: "unavailable" as const,
              reason: "provider-missing" as const,
              detail:
                "Libre Hardware Monitor or Open Hardware Monitor WMI is not available. Install and run a supported sensor provider to expose measured host temperatures.",
            },
            reason: null,
            detail: null,
          },
        }))}
      />,
    );
    try {
      await page.getByLabelText("Expand Resources").click();
      await expect.element(page.getByLabelText(/^GPU temp: 48°C/i)).toBeVisible();
      await expect
        .element(page.getByLabelText(/^RAM temp: Unavailable.*Libre Hardware Monitor/i))
        .toBeVisible();
      await expect.element(page.getByLabelText(/^VRAM temp: Unavailable/i)).toBeVisible();
      await expect.element(page.getByLabelText(/^Disk temp: Unavailable/i)).toBeVisible();
      await expect.element(page.getByLabelText(/^Case \/ ambient: Unavailable/i)).toBeVisible();
    } finally {
      await mounted.unmount();
    }
  });

  it("hides unavailable graphs while retaining diagnostic cards", async () => {
    await page.viewport(1_200, 800);
    const onChange = vi.fn();
    const mounted = await render(
      <ProjectTelemetryGraph
        environmentId={environmentA}
        hideUnavailableGraphs
        onHideUnavailableGraphsChange={onChange}
        pollIntervalMs={Number.MAX_SAFE_INTEGER}
        projectId={projectA}
        readTelemetry={vi.fn(async () => telemetryFixture({ projectId: projectA }))}
      />,
    );
    try {
      await expect.element(page.getByLabelText(/Host CPU: 42%/i)).toBeVisible();
      await expect.element(page.getByLabelText(/Host GPU: Unavailable/i)).toBeVisible();
      const cpuCard = document.querySelector('[data-project-telemetry-card="Host CPU"]');
      const gpuCard = document.querySelector('[data-project-telemetry-card="Host GPU"]');
      expect(cpuCard?.querySelector("[data-project-telemetry-series]")).not.toBeNull();
      expect(gpuCard?.querySelector("[data-project-telemetry-series]")).toBeNull();
      expect(gpuCard?.querySelector('[role="img"]')).toBeNull();
      expect(gpuCard?.children).toHaveLength(2);
      const toggle = page.getByRole("switch", { name: "Hide unavailable resource graphs" });
      await expect.element(toggle).toBeChecked();
      await toggle.click();
      expect(onChange).toHaveBeenCalledWith(false);
    } finally {
      await mounted.unmount();
    }
  });
});
