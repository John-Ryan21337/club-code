import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { SidebarInset } from "~/components/ui/sidebar";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { usePrimaryEnvironmentId } from "../environments/primary";
import {
  selectEnvironmentState,
  selectProjectsAcrossEnvironments,
  selectThreadExistsByRef,
  useStore,
} from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef } from "../threadRoutes";
import { resolveMeetingPrivacyRouteDisposition } from "../meetingPrivacy";
import { useUiStateStore } from "../uiStateStore";

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const routeMatchesPrimaryEnvironment =
    threadRef !== null &&
    primaryEnvironmentId !== null &&
    threadRef.environmentId === primaryEnvironmentId;
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const meetingPrivacyEnabled = useUiStateStore((state) => state.meetingPrivacyEnabled);
  const meetingPrivacyHiddenProjectKeys = useUiStateStore(
    (state) => state.meetingPrivacyHiddenProjectKeys,
  );
  const meetingPrivacyHiddenProjectKeySet = useMemo(
    () => new Set(meetingPrivacyHiddenProjectKeys),
    [meetingPrivacyHiddenProjectKeys],
  );
  const routeProject = useMemo(
    () =>
      serverThread
        ? (projects.find(
            (project) =>
              project.environmentId === serverThread.environmentId &&
              project.id === serverThread.projectId,
          ) ?? null)
        : null,
    [projects, serverThread],
  );
  // Fail closed: a direct link or deep link must render nothing until the
  // project identity behind the thread is known. Otherwise a hidden project's
  // chat view flashes for the frames before the project list arrives.
  const meetingPrivacyRouteDisposition = resolveMeetingPrivacyRouteDisposition({
    enabled: meetingPrivacyEnabled,
    hiddenProjectKeys: meetingPrivacyHiddenProjectKeySet,
    project: routeProject,
  });
  const routeProjectHiddenForMeeting = meetingPrivacyRouteDisposition === "redirect";
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const meetingPrivacyProjectResolutionPending =
    meetingPrivacyEnabled &&
    meetingPrivacyHiddenProjectKeys.length > 0 &&
    routeThreadExists &&
    meetingPrivacyRouteDisposition === "pending";
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (threadRef !== null && primaryEnvironmentId !== null && !routeMatchesPrimaryEnvironment) {
      void navigate({ to: "/", replace: true });
    }
  }, [navigate, primaryEnvironmentId, routeMatchesPrimaryEnvironment, threadRef]);

  useEffect(() => {
    if (!routeProjectHiddenForMeeting) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [navigate, routeProjectHiddenForMeeting]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (
    !threadRef ||
    !routeMatchesPrimaryEnvironment ||
    !bootstrapComplete ||
    !routeThreadExists ||
    routeProjectHiddenForMeeting ||
    meetingPrivacyProjectResolutionPending
  ) {
    return null;
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <ChatView
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
        routeKind="server"
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: ChatThreadRouteView,
});
