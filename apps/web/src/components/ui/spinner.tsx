import { useUiLocalization } from "../../uiLocalization";
import { Loader2Icon } from "lucide-react";
import { cn } from "~/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2Icon>) {
  const { t: localizeUiLabel } = useUiLocalization();

  return (
    <Loader2Icon
      aria-label={localizeUiLabel("Loading")}
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
