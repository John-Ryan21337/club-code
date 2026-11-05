import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@cafecode/contracts";
import { getProviderOptionDescriptors } from "@cafecode/shared/model";
import { ZapIcon } from "lucide-react";
import { memo, useId } from "react";
import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { normalizeComposerSpeedDescriptors } from "./modelSpeedOptions";

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
  const descriptors = normalizeComposerSpeedDescriptors(
    getProviderOptionDescriptors({ caps, selections: props.modelOptions }),
    props.modelOptions,
  );
  const tierDescriptor = descriptors.find(
    (option) => option.id === "serviceTier" && option.type === "select",
  );
  const descriptor = descriptors.find(
    (option) => option.id === "fastMode" && option.type === "boolean",
  );
  if (!descriptor && !tierDescriptor) return null;
  const value = descriptor?.currentValue === true;
  const state = value === true ? "On" : "Off";
  const help =
    props.provider === "claudeAgent"
      ? "Request faster responses. Claude subscriptions use paid usage credits, outside included plan limits. Account access is required. Changes apply on your next send."
      : "Request faster responses. Codex Fast uses more allowance or credits. Account access is required. Changes apply on your next send.";

  const persistSpeed = (tier: string) => {
    if (
      tierDescriptor?.type === "select" &&
      !tierDescriptor.options.some((option) => option.id === tier)
    )
      return;
    if (!tierDescriptor && tier === "ultrafast") return;
    setProviderModelOptions(
      props.threadTarget,
      props.provider,
      [
        ...(props.modelOptions ?? []).filter(
          (option) => option.id !== "fastMode" && option.id !== "serviceTier",
        ),
        ...(tierDescriptor
          ? [{ id: "serviceTier", value: tier }]
          : [{ id: "fastMode", value: tier === "priority" }]),
      ],
      { instanceId: props.providerInstanceId, model: props.model, persistSticky: true },
    );
  };
  const speedMenu = (primary: boolean) => (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={
              primary
                ? `Speed: ${tierDescriptor?.currentValue === "ultrafast" ? "Ultra Fast" : tierDescriptor?.currentValue === "priority" ? "Fast" : "Standard"}`
                : "Speed options"
            }
            className="h-8 shrink-0 gap-1 px-2 text-muted-foreground"
          />
        }
      >
        {primary ? (
          <>
            <ZapIcon aria-hidden="true" className="size-4" />
            <span>
              {tierDescriptor?.currentValue === "ultrafast"
                ? "Ultra Fast"
                : tierDescriptor?.currentValue === "priority"
                  ? "Fast"
                  : "Standard"}
            </span>
          </>
        ) : (
          <span aria-hidden="true">▾</span>
        )}
      </MenuTrigger>
      <MenuPopup align="start">
        <p className="max-w-72 px-2 py-1.5 text-xs text-muted-foreground">
          Fast and Ultra Fast use more allowance or credits. Native account and model access are
          required. Changes apply on your next send.
        </p>
        <MenuRadioGroup
          value={
            tierDescriptor ? String(tierDescriptor.currentValue) : value ? "priority" : "default"
          }
          onValueChange={persistSpeed}
        >
          <MenuRadioItem value="default">Standard (default)</MenuRadioItem>
          <MenuRadioItem
            value="priority"
            disabled={
              tierDescriptor?.type === "select" &&
              !tierDescriptor.options.some((option) => option.id === "priority")
            }
          >
            Fast
          </MenuRadioItem>
          <MenuRadioItem
            value="ultrafast"
            disabled={
              tierDescriptor?.type !== "select" ||
              !tierDescriptor.options.some((option) => option.id === "ultrafast")
            }
          >
            Ultra Fast
            {tierDescriptor?.type === "select" &&
            tierDescriptor.options.some((option) => option.id === "ultrafast")
              ? ""
              : " (unavailable for this account or model)"}
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
  if (tierDescriptor) return speedMenu(true);
  return (
    <>
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
              onClick={() => persistSpeed(value ? "default" : "priority")}
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
      {props.provider === "codex" ? speedMenu(false) : null}
    </>
  );
});
