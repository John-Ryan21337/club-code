import { EyeIcon, ShieldCheckIcon, ShieldIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { meetingPrivacyProjectKey } from "../../meetingPrivacy";
import type { Project } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function MeetingPrivacyControls({ projects }: { readonly projects: readonly Project[] }) {
  const [managerOpen, setManagerOpen] = useState(false);
  const enabled = useUiStateStore((state) => state.meetingPrivacyEnabled);
  const hiddenProjectKeys = useUiStateStore((state) => state.meetingPrivacyHiddenProjectKeys);
  const setEnabled = useUiStateStore((state) => state.setMeetingPrivacyEnabled);
  const setProjectHidden = useUiStateStore((state) => state.setProjectMeetingPrivacyHidden);
  const clearHiddenProjects = useUiStateStore((state) => state.clearMeetingPrivacyHiddenProjects);
  const hiddenProjects = useMemo(() => {
    const hiddenKeys = new Set(hiddenProjectKeys);
    return projects
      .filter((project) => hiddenKeys.has(meetingPrivacyProjectKey(project)))
      .toSorted(
        (left, right) =>
          left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
          left.cwd.localeCompare(right.cwd, undefined, { sensitivity: "base" }),
      );
  }, [hiddenProjectKeys, projects]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={enabled ? "Turn off meeting privacy" : "Turn on meeting privacy"}
              aria-pressed={enabled}
              className={`inline-flex size-5 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground ${
                enabled ? "bg-primary/12 text-primary" : "text-muted-foreground/60"
              }`}
              onClick={() => setEnabled(!enabled)}
            />
          }
        >
          {enabled ? <ShieldCheckIcon className="size-3.5" /> : <ShieldIcon className="size-3.5" />}
        </TooltipTrigger>
        <TooltipPopup side="right">
          {enabled ? "Meeting privacy is on" : "Meeting privacy is off"}
        </TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Manage meeting privacy"
              className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setManagerOpen(true)}
            />
          }
        >
          <EyeIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Manage meeting privacy</TooltipPopup>
      </Tooltip>

      <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
        {managerOpen ? (
          <DialogPopup className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Meeting privacy</DialogTitle>
              <DialogDescription>
                Hidden folders stay connected and keep running. This device only removes them and
                their threads from presentation surfaces while Meeting Privacy is on.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-3">
              {hiddenProjects.length > 0 ? (
                <div className="space-y-2">
                  {hiddenProjects.map((project) => {
                    const projectKey = meetingPrivacyProjectKey(project);
                    return (
                      <div
                        key={projectKey}
                        className="flex min-w-0 items-center gap-3 rounded-md border border-border/70 bg-card/30 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{project.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {project.cwd}
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setProjectHidden(projectKey, false)}
                        >
                          Unhide
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  No project folders are selected. Right-click a project and choose “Hide during
                  meetings.”
                </p>
              )}
              {hiddenProjectKeys.length > hiddenProjects.length ? (
                <p className="text-xs text-muted-foreground">
                  The hidden list also contains folders from environments that are not currently
                  connected. Clear the list to reveal those folders when they reconnect.
                </p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              {hiddenProjectKeys.length > 0 ? (
                <Button type="button" variant="outline" onClick={clearHiddenProjects}>
                  Unhide all
                </Button>
              ) : null}
              <Button type="button" onClick={() => setManagerOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogPopup>
        ) : null}
      </Dialog>
    </>
  );
}
