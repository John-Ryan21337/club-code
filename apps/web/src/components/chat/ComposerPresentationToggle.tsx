import { MonitorIcon, SmartphoneIcon } from "lucide-react";
import { memo, type PointerEventHandler } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

export const ComposerPresentationToggle = memo(function ComposerPresentationToggle({
  mobileOptimized,
  viewportMobile,
  onToggle,
  disabled = false,
}: {
  mobileOptimized: boolean;
  viewportMobile: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const effectiveMobile = mobileOptimized || viewportMobile;
  const label = mobileOptimized
    ? viewportMobile
      ? "Turn off Mobile optimized presentation for this screen"
      : "Switch to desktop presentation"
    : viewportMobile
      ? "Mobile layout is active for this screen; switch to Mobile optimized presentation"
      : "Switch to Mobile optimized presentation";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={mobileOptimized}
            disabled={disabled}
            className={cn(
              // Keep the target genuinely touch-sized even when a wide desktop
              // viewport would normally shrink toolbar buttons at `sm`.
              "size-11 min-h-11 min-w-11 shrink-0 sm:size-11",
              mobileOptimized
                ? "bg-primary/12 text-primary hover:bg-primary/18"
                : "text-muted-foreground/70 hover:text-foreground/80",
            )}
            data-effective-mobile-layout={effectiveMobile ? "true" : "false"}
            data-mobile-presentation-source={
              mobileOptimized ? "operator" : viewportMobile ? "viewport" : "responsive"
            }
            data-testid="composer-presentation-toggle"
            onClick={onToggle}
            onPointerDown={preventPointerFocus}
            size="icon-xl"
            type="button"
            variant="ghost"
          />
        }
      >
        {mobileOptimized ? (
          <MonitorIcon aria-hidden="true" className="size-5" />
        ) : (
          <SmartphoneIcon aria-hidden="true" className="size-5" />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-72 whitespace-normal leading-tight">
        {label}
      </TooltipPopup>
    </Tooltip>
  );
});
