import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { SidebarTriggerWithUnreadDot } from "./sidebar/unseenCompletions";
import { isElectron } from "../env";
import { cn } from "~/lib/utils";
import { MonitorIcon, SmartphoneIcon } from "lucide-react";
import { Button } from "./ui/button";
import { usePresentationProfiles } from "../presentationProfiles";

export function NoActiveThreadState() {
  const presentation = usePresentationProfiles();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "border-b border-border px-3 sm:px-5",
            isElectron
              ? "drag-region flex h-[52px] items-center wco:h-[env(titlebar-area-height)]"
              : "py-2 sm:py-3",
          )}
        >
          {isElectron ? (
            <span className="text-xs text-muted-foreground/50 wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
              No active thread
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <SidebarTriggerWithUnreadDot className="md:hidden" />
              <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
                No active thread
              </span>
            </div>
          )}
        </header>

        <Empty className="flex-1">
          <div className="w-full max-w-lg rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-xl">Pick a thread to continue</EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                Select an existing thread or create a new one to get started.
              </EmptyDescription>
              <div
                className="mt-5 flex flex-wrap justify-center gap-2"
                aria-label="Workspace profile"
              >
                <Button
                  size="sm"
                  variant={presentation.activeMode === "desktop" ? "default" : "outline"}
                  disabled={presentation.busy || presentation.desktopProfile === null}
                  onClick={() => void presentation.switchTo("desktop")}
                >
                  <MonitorIcon aria-hidden="true" />
                  {presentation.desktopProfile?.name ?? "Desktop Profile"}
                </Button>
                <Button
                  size="sm"
                  variant={presentation.activeMode === "mobile" ? "default" : "outline"}
                  disabled={presentation.busy || presentation.mobileProfile === null}
                  onClick={() => void presentation.switchTo("mobile")}
                >
                  <SmartphoneIcon aria-hidden="true" />
                  {presentation.mobileProfile?.name ?? "Mobile Profile"}
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
