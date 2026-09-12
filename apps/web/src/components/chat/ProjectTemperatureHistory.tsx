import type { ServerSystemTemperatureTelemetry } from "@cafecode/contracts";
import { ThermometerIcon } from "lucide-react";

import { TelemetryCard } from "./ProjectTelemetryCard";
import type { ProjectTelemetryHistoryPoint } from "./ProjectTelemetryGraph.model";
import {
  TEMPERATURE_CATEGORIES,
  normalizeTemperatureHistory,
  projectTemperatureCategories,
} from "./ProjectTemperatureHistory.model";

const categoryLabels = {
  cpu: "CPU",
  gpu: "GPU",
  memory: "RAM",
  vram: "VRAM",
  storage: "Storage",
  ambient: "Ambient",
  other: "Other",
} as const;

export function ProjectTemperatureHistory({
  telemetry,
  history,
}: {
  readonly telemetry: ServerSystemTemperatureTelemetry | undefined;
  readonly history: readonly ProjectTelemetryHistoryPoint[];
}) {
  const categories = projectTemperatureCategories(telemetry);
  return (
    <details className="mt-2 rounded-lg border border-border/50 bg-card/70 text-xs">
      <summary className="min-h-9 cursor-pointer px-3 py-2 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
        Temperature histories
      </summary>
      <div className="px-2 pb-2">
        <p className="px-1 pb-2 text-muted-foreground">
          Hottest reported sensor in each category. Graph scale: −20 to 120 °C.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {TEMPERATURE_CATEGORIES.map((kind) => {
            const current = categories[kind];
            return (
              <TelemetryCard
                key={kind}
                icon={ThermometerIcon}
                label={`${categoryLabels[kind]} temperature`}
                value={
                  current.celsius === null
                    ? "Unavailable"
                    : `${current.celsius.toLocaleString(undefined, { maximumFractionDigits: 1 })} °C`
                }
                detail={
                  current.count === 0
                    ? "No measured sensor in this category."
                    : `Hottest of ${current.count} reported sensor${current.count === 1 ? "" : "s"}.`
                }
                title="Graph scale: −20 to 120 °C. Values outside this scale use the graph edge; labels show the measured value."
                color="var(--cafe-project-telemetry-temperature, #dc2626)"
                measurement="temperature"
                history={normalizeTemperatureHistory(
                  history.map((point) => point.temperatures[kind]),
                )}
              />
            );
          })}
        </div>
      </div>
    </details>
  );
}
