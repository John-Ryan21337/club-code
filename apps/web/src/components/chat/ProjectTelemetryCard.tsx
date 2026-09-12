import type { ComponentType } from "react";
import { buildTelemetrySparklinePath } from "./ProjectTelemetryGraph.model";

function TelemetrySparkline(props: {
  readonly label: string;
  readonly color: string;
  readonly values: readonly (number | null)[];
  readonly measurement: "utilization" | "temperature";
}) {
  const path = buildTelemetrySparklinePath(props.values);
  const historyLabel =
    props.measurement === "temperature" ? props.label : `${props.label} utilization`;
  const latestIndex = props.values.findLastIndex((value) => value !== null);
  const latest = latestIndex < 0 ? null : (props.values[latestIndex] ?? null);
  const latestX =
    latestIndex < 0 || props.values.length === 1
      ? 0
      : (latestIndex * 100) / (props.values.length - 1);
  const latestY = latest === null ? null : 24 - (Math.max(0, Math.min(100, latest)) / 100) * 24;

  return (
    <svg
      aria-label={`${historyLabel} history`}
      className="h-7 w-full overflow-visible"
      role="img"
      viewBox="0 0 100 24"
    >
      <title>{`${historyLabel} bounded recent history`}</title>
      <path d="M 0 6 H 100 M 0 12 H 100 M 0 18 H 100" stroke="currentColor" opacity="0.09" />
      {path ? (
        <path
          d={path}
          fill="none"
          stroke={props.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          style={{ filter: `drop-shadow(0 0 2px ${props.color})` }}
        />
      ) : null}
      {latestY !== null ? <circle cx={latestX} cy={latestY} fill={props.color} r="1.8" /> : null}
    </svg>
  );
}

export function TelemetryCard(props: {
  readonly hidden?: boolean;
  readonly icon: ComponentType<{ className?: string }>;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly title?: string | undefined;
  readonly color: string;
  readonly history: readonly (number | null)[];
  readonly measurement?: "utilization" | "temperature";
}) {
  if (props.hidden) return null;
  const Icon = props.icon;
  return (
    <div
      aria-label={`${props.label}: ${props.value}. ${props.detail}`}
      className="min-w-0 rounded-lg border border-border/60 bg-background/45 px-2 py-1.5 shadow-inner shadow-black/10"
      role="group"
      title={props.title ?? props.detail}
    >
      <div
        className={
          props.measurement === "temperature"
            ? "flex flex-wrap items-center gap-x-1.5 gap-y-1"
            : "flex items-center gap-1.5"
        }
      >
        <Icon className="size-3 shrink-0" />
        <span
          className={
            props.measurement === "temperature"
              ? "min-w-0 flex-1 text-xs font-medium text-muted-foreground"
              : "truncate text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground"
          }
        >
          {props.label}
        </span>
        <span
          className={`${props.measurement === "temperature" ? "w-full text-right" : "ml-auto"} shrink-0 text-xs font-semibold text-foreground`}
        >
          {props.value}
        </span>
      </div>
      <TelemetrySparkline
        color={props.color}
        label={props.label}
        values={props.history}
        measurement={props.measurement ?? "utilization"}
      />
      <div className="truncate text-xs text-muted-foreground">{props.detail}</div>
    </div>
  );
}
