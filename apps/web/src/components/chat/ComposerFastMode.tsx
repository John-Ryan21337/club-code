import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@cafecode/contracts";
import {
  getProviderOptionBooleanSelectionValue,
  getProviderOptionDescriptors,
} from "@cafecode/shared/model";
import { ZapIcon } from "lucide-react";
import { memo, useId } from "react";
import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const ComposerFastMode = memo(function ComposerFastMode(props: {
  provider: ProviderDriverKind;
  providerInstanceId: ProviderInstanceId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  threadTarget: ScopedThreadRef | DraftId;
}) {
  const helpId = useId();
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const caps = getProviderModelCapabilities(props.models, props.model, props.provider);
  const descriptor = getProviderOptionDescriptors({ caps, selections: props.modelOptions }).find(
    (option) => option.id === "fastMode" && option.type === "boolean",
  );
  if (!descriptor) return null;
  const value = getProviderOptionBooleanSelectionValue(props.modelOptions, "fastMode") === true;
  const state = value === true ? "On" : "Off";
  const help =
    props.provider === "claudeAgent"
      ? "Request faster responses. Claude subscriptions use paid usage credits, outside included plan limits. Account access is required. Changes apply on your next send."
      : "Request faster responses. Codex Fast uses more allowance or credits. Account access is required. Changes apply on your next send.";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Fast mode: ${state}`}
            aria-pressed={value === true}
            aria-describedby={helpId}
            data-composer-fast-mode="true"
            className={cn(
              "h-8 shrink-0 gap-1 px-2 text-muted-foreground",
              value === true && "text-amber-700 dark:text-amber-300",
            )}
            onClick={() =>
              setProviderModelOptions(
                props.threadTarget,
                props.provider,
                [
                  ...(props.modelOptions ?? []).filter((option) => option.id !== "fastMode"),
                  { id: "fastMode", value: value !== true },
                ],
                { instanceId: props.providerInstanceId, model: props.model, persistSticky: true },
              )
            }
          />
        }
      >
        <ZapIcon aria-hidden="true" className="size-4" />
        <span>Fast: {state}</span>
        <span id={helpId} className="sr-only">
          {help} Fast mode is off unless you turn it on. The provider can fall back to standard
          speed.
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-72">
        {help} The provider can fall back to standard speed.
      </TooltipPopup>
    </Tooltip>
  );
});
