import * as Schema from "effect/Schema";

const ShortText = Schema.String.check(Schema.isMaxLength(4000));
const JobId = Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/));
export const ResearchModel = Schema.Literals(["o4-mini-deep-research", "o3-deep-research"]);
export const ResearchAction = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("configure"),
    key: Schema.String.check(Schema.isPattern(/^sk-[A-Za-z0-9_-]{16,512}$/)),
  }),
  Schema.Struct({ action: Schema.Literal("remove-key") }),
  Schema.Struct({ action: Schema.Literal("list"), scope: ShortText }),
  Schema.Struct({
    action: Schema.Literal("prepare"),
    id: JobId,
    scope: ShortText,
    prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(30000)),
  }),
  Schema.Struct({
    action: Schema.Literal("start"),
    id: JobId,
    model: ResearchModel,
    maxToolCalls: Schema.Literals([10, 25, 50]),
    scope: ShortText,
    period: ShortText,
    format: ShortText,
  }),
  Schema.Struct({
    action: Schema.Literals(["poll", "cancel", "delete", "resolve-unknown"]),
    id: JobId,
  }),
]);
export type ResearchAction = typeof ResearchAction.Type;
export interface ResearchJob {
  id: string;
  scope: string;
  prompt: string;
  createdAt: string;
  status:
    | "draft"
    | "starting"
    | "queued"
    | "in_progress"
    | "completed"
    | "incomplete"
    | "failed"
    | "cancelled"
    | "unknown";
  model?: typeof ResearchModel.Type;
  maxToolCalls?: number;
  brief?: string;
  responseId?: string;
  report?: string;
  sources?: Array<{ title: string; url: string }>;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  error?: string;
}
export interface ResearchState {
  configured: boolean;
  jobs: ResearchJob[];
}
