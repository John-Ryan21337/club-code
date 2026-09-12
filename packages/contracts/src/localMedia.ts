import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DESKTOP_LOCAL_MEDIA_TITLE_MAX_LENGTH = 256;
export const DESKTOP_LOCAL_MEDIA_REASON_MAX_LENGTH = 512;
export const DESKTOP_LOCAL_MEDIA_SESSION_ID_MAX_LENGTH = 128;
export const DESKTOP_LOCAL_MEDIA_URL_MAX_LENGTH = 256;
export const MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS = 64;
export const MAX_DESKTOP_LOCAL_MEDIA_QUEUE_BYTES = 64 * 1024 * 1024 * 1024;

const DesktopLocalMediaTitleSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DESKTOP_LOCAL_MEDIA_TITLE_MAX_LENGTH),
);
const DesktopLocalMediaReasonTextSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DESKTOP_LOCAL_MEDIA_REASON_MAX_LENGTH),
);
const DesktopLocalMediaSessionIdSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DESKTOP_LOCAL_MEDIA_SESSION_ID_MAX_LENGTH),
  Schema.isPattern(/^[A-Za-z0-9_-]{32,128}$/),
);
const DesktopLocalMediaPlaybackUrlSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DESKTOP_LOCAL_MEDIA_URL_MAX_LENGTH),
  Schema.isPattern(/^cafecode-media:\/\/stream\/[A-Za-z0-9_-]{32,128}$/),
);
const DesktopLocalMediaEngineVersionSchema = Schema.NullOr(
  TrimmedNonEmptyString.check(Schema.isMaxLength(DESKTOP_LOCAL_MEDIA_TITLE_MAX_LENGTH)),
);

export const DesktopLocalMediaKindSchema = Schema.Literals(["audio", "video"]);
export type DesktopLocalMediaKind = typeof DesktopLocalMediaKindSchema.Type;

export const DesktopLocalMediaEngineSchema = Schema.Struct({
  label: Schema.Literal("VLC"),
  version: DesktopLocalMediaEngineVersionSchema,
  reason: Schema.NullOr(DesktopLocalMediaReasonTextSchema),
});
export type DesktopLocalMediaEngine = typeof DesktopLocalMediaEngineSchema.Type;

export const DesktopLocalMediaCapabilitySchema = Schema.Union([
  Schema.Struct({
    available: Schema.Literal(true),
    engine: Schema.Struct({
      label: Schema.Literal("VLC"),
      version: DesktopLocalMediaEngineVersionSchema,
      reason: Schema.Null,
    }),
  }),
  Schema.Struct({
    available: Schema.Literal(false),
    engine: Schema.Struct({
      label: Schema.Literal("VLC"),
      version: DesktopLocalMediaEngineVersionSchema,
      reason: DesktopLocalMediaReasonTextSchema,
    }),
  }),
]);
export type DesktopLocalMediaCapability = typeof DesktopLocalMediaCapabilitySchema.Type;

export const DesktopLocalMediaSelectionSchema = Schema.Struct({
  sessionId: DesktopLocalMediaSessionIdSchema,
  kind: DesktopLocalMediaKindSchema,
  displayTitle: DesktopLocalMediaTitleSchema,
  playbackUrl: DesktopLocalMediaPlaybackUrlSchema,
  currentIndex: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS - 1 }),
  ),
  totalItems: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS }),
  ),
  engine: Schema.Struct({
    label: Schema.Literal("VLC"),
    version: DesktopLocalMediaEngineVersionSchema,
    reason: Schema.Null,
  }),
}).check(
  Schema.makeFilter((selection) =>
    selection.currentIndex < selection.totalItems
      ? undefined
      : "currentIndex must identify an item in the bounded queue",
  ),
);
export type DesktopLocalMediaSelection = typeof DesktopLocalMediaSelectionSchema.Type;

export const DesktopLocalMediaNavigationDirectionSchema = Schema.Literals(["previous", "next"]);
export type DesktopLocalMediaNavigationDirection =
  typeof DesktopLocalMediaNavigationDirectionSchema.Type;

export const DesktopLocalMediaNavigateInputSchema = Schema.Struct({
  sessionId: DesktopLocalMediaSessionIdSchema,
  direction: DesktopLocalMediaNavigationDirectionSchema,
});
export type DesktopLocalMediaNavigateInput = typeof DesktopLocalMediaNavigateInputSchema.Type;

export const DesktopLocalMediaReleaseInputSchema = Schema.Struct({
  sessionId: DesktopLocalMediaSessionIdSchema,
});
export type DesktopLocalMediaReleaseInput = typeof DesktopLocalMediaReleaseInputSchema.Type;
