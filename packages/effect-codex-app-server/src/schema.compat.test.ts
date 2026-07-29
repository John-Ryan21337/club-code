import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import * as CodexSchema from "./schema.ts";

it("decodes the Codex 0.146 enterprise plan without treating it as an unknown account", () => {
  const decoded = Schema.decodeUnknownSync(CodexSchema.V2GetAccountResponse)({
    account: {
      type: "chatgpt",
      email: "operator@example.invalid",
      planType: "ent26",
    },
    requiresOpenaiAuth: true,
  });

  assert.equal(decoded.account?.type, "chatgpt");
  if (decoded.account?.type === "chatgpt") {
    assert.equal(decoded.account.planType, "ent26");
  }
});

it("encodes the stable thread pin filter and metadata update", () => {
  assert.deepEqual(Schema.encodeSync(CodexSchema.V2ThreadListParams)({ isPinned: true }), {
    isPinned: true,
  });
  assert.deepEqual(
    Schema.encodeSync(CodexSchema.V2ThreadMetadataUpdateParams)({
      threadId: "0199f60f-45af-7000-8000-000000000001",
      isPinned: false,
    }),
    {
      threadId: "0199f60f-45af-7000-8000-000000000001",
      isPinned: false,
    },
  );
});

it("decodes 0.146 app-tool and remote-skill presentation metadata", () => {
  const tool = Schema.decodeUnknownSync(CodexSchema.V2AppsReadResponse__AppToolSummary)({
    description: "Reads a remote workspace.",
    disabledReason: null,
    isEnabled: true,
    isReadOnly: true,
    name: "workspace_read",
    title: "Workspace read",
  });
  const skillInterface = Schema.decodeUnknownSync(CodexSchema.V2SkillsListResponse__SkillInterface)(
    {
      displayName: "Remote skill",
      iconSmallUrl: "https://example.invalid/small.png",
      iconLargeUrl: "https://example.invalid/large.png",
    },
  );

  assert.equal(tool.isEnabled, true);
  assert.equal(tool.isReadOnly, true);
  assert.equal(skillInterface.iconSmallUrl, "https://example.invalid/small.png");
  assert.equal(skillInterface.iconLargeUrl, "https://example.invalid/large.png");
});

it("decodes the 0.146 managed configuration requirements while tolerating older sparse payloads", () => {
  const current = Schema.decodeUnknownSync(
    CodexSchema.V2ConfigRequirementsReadResponse__ConfigRequirements,
  )({
    allowLoginShell: false,
    browserUse: {
      disableAutoReview: true,
    },
    checkForUpdateOnStartup: false,
    featureRequirements: {
      in_app_updates: false,
    },
    feedback: {
      enabled: false,
    },
    logDir: "C:/managed/logs",
    modelCatalogJson: "C:/managed/models.json",
    sqliteHome: "C:/managed/sqlite",
    windowsSandboxPrivateDesktop: true,
  });
  const legacy = Schema.decodeUnknownSync(
    CodexSchema.V2ConfigRequirementsReadResponse__ConfigRequirements,
  )({});

  assert.equal(current.allowLoginShell, false);
  assert.equal(current.browserUse?.disableAutoReview, true);
  assert.equal(current.featureRequirements?.["in_app_updates"], false);
  assert.deepEqual(legacy, {});
});
