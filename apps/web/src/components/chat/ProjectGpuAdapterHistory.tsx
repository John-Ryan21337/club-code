import type { ServerSystemGpuTelemetry } from "@cafecode/contracts";
import { GaugeIcon, MemoryStickIcon, ThermometerIcon } from "lucide-react";

import { TelemetryCard } from "./ProjectTelemetryCard";
import {
  formatTelemetryBytes,
  type ProjectTelemetryHistoryPoint,
} from "./ProjectTelemetryGraph.model";
import { normalizeTemperatureHistory } from "./ProjectTemperatureHistory.model";
import { gpuAdapterHistory, projectGpuAdapterDetails } from "./ProjectGpuAdapterHistory.model";

export function ProjectGpuAdapterHistory({
  telemetry,
  history,
  hideUnavailable = false,
}: {
  readonly telemetry: ServerSystemGpuTelemetry | undefined;
  readonly history: readonly ProjectTelemetryHistoryPoint[];
  readonly hideUnavailable?: boolean;
}) {
  const adapters = projectGpuAdapterDetails(telemetry);
  if (hideUnavailable && adapters.length === 0) return null;
  return (
    <details className="mt-2 rounded-lg border border-border/50 bg-card/70 text-xs">
      <summary className="min-h-9 cursor-pointer px-3 py-2 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
        GPU adapter histories
      </summary>
      <div className="space-y-3 px-2 pb-2">
        {adapters.length === 0 ? (
          <p className="px-1 text-muted-foreground">No measured GPU adapters are available.</p>
        ) : (
          adapters.map((adapter) => {
            const label = `GPU ${adapter.index + 1}`;
            return (
              <section key={adapter.key} aria-label={`${label}: ${adapter.name}`}>
                <h4 className="mb-1 break-words px-1 font-medium">
                  {label} · {adapter.name}
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <TelemetryCard
                    label={label}
                    icon={GaugeIcon}
                    color="var(--cafe-project-telemetry-gpu, #d97706)"
                    value={`${Math.round(adapter.utilizationPercent)}%`}
                    detail="Measured adapter utilization."
                    history={gpuAdapterHistory(history, adapter.key, "utilizationPercent")}
                  />
                  <TelemetryCard
                    label={`${label} VRAM`}
                    hidden={hideUnavailable && adapter.memoryUtilizationPercent === null}
                    icon={MemoryStickIcon}
                    color="var(--cafe-project-telemetry-vram, #7c3aed)"
                    value={
                      adapter.memoryUtilizationPercent === null
                        ? "Unavailable"
                        : `${Math.round(adapter.memoryUtilizationPercent)}%`
                    }
                    detail={
                      adapter.memoryAvailableBytes === null
                        ? "Adapter memory is unavailable."
                        : `${formatTelemetryBytes(adapter.memoryAvailableBytes)} available.`
                    }
                    history={gpuAdapterHistory(history, adapter.key, "memoryUtilizationPercent")}
                  />
                  <TelemetryCard
                    label={`${label} temperature`}
                    hidden={hideUnavailable && adapter.temperatureCelsius === null}
                    icon={ThermometerIcon}
                    color="var(--cafe-project-telemetry-temperature, #dc2626)"
                    measurement="temperature"
                    value={
                      adapter.temperatureCelsius === null
                        ? "Unavailable"
                        : `${adapter.temperatureCelsius.toLocaleString(undefined, { maximumFractionDigits: 1 })} °C`
                    }
                    detail={
                      adapter.temperatureCelsius === null
                        ? "Adapter temperature is unavailable."
                        : "Measured adapter temperature. Graph scale: −20 to 120 °C."
                    }
                    title="Values outside the graph scale use its edge; labels show the measured temperature."
                    history={normalizeTemperatureHistory(
                      gpuAdapterHistory(history, adapter.key, "temperatureCelsius"),
                    )}
                  />
                </div>
              </section>
            );
          })
        )}
      </div>
    </details>
  );
}
