import type { ServerSystemTemperatureTelemetry } from "@cafecode/contracts";

export function ProjectTemperatureReadings({
  telemetry,
}: {
  readonly telemetry: ServerSystemTemperatureTelemetry | undefined;
}) {
  const sensors = telemetry?.status === "available" ? telemetry.sensors : [];
  return (
    <details className="mt-2 rounded-lg border border-border/50 bg-card/70 text-xs">
      <summary className="min-h-9 cursor-pointer px-3 py-2 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
        Host temperatures {sensors.length > 0 ? `(${sensors.length})` : "— unavailable"}
      </summary>
      <div className="max-h-40 overflow-y-auto px-3 pb-3">
        {sensors.length > 0 ? (
          <dl
            className="grid grid-cols-[minmax(0,2.414fr)_minmax(0,1fr)] gap-x-2 gap-y-2"
            aria-label="Measured host temperatures"
          >
            {sensors.map((sensor, index) => (
              <div
                key={`${sensor.source}:${sensor.kind}:${sensor.label}:${index}`}
                className="contents"
              >
                <dt className="min-w-0 break-words" title={sensor.source}>
                  {sensor.label}
                </dt>
                <dd className="text-right font-mono tabular-nums">
                  {sensor.temperatureCelsius.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}{" "}
                  °C
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground">
            {telemetry?.detail ?? "No measured temperatures are available from this backend."}
          </p>
        )}
        {telemetry?.status === "available" &&
        telemetry.hostSensorProbe?.status === "unavailable" ? (
          <p className="mt-2 text-muted-foreground">{telemetry.hostSensorProbe.detail}</p>
        ) : null}
      </div>
    </details>
  );
}
