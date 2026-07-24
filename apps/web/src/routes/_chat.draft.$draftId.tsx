import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { createThreadSelectorAcrossEnvironments } from "../storeSelectors";
import { selectEnvironmentState, selectProjectsAcrossEnvironments, useStore } from "../store";
import { buildThreadRouteParams } from "../threadRoutes";
import { resolveMeetingPrivacyRouteDisposition } from "../meetingPrivacy";
import { useUiStateStore } from "../uiStateStore";

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const environmentBootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, draftSession?.environmentId ?? null).bootstrapComplete,
  );
  const meetingPrivacyEnabled = useUiStateStore((state) => state.meetingPrivacyEnabled);
  const meetingPrivacyHiddenProjectKeys = useUiStateStore(
    (state) => state.meetingPrivacyHiddenProjectKeys,
  );
  const meetingPrivacyHiddenProjectKeySet = useMemo(
    () => new Set(meetingPrivacyHiddenProjectKeys),
    [meetingPrivacyHiddenProjectKeys],
  );
  const draftProject = useMemo(
    () =>
      draftSession
        ? (projects.find(
            (project) =>
              project.environmentId === draftSession.environmentId &&
              project.id === draftSession.projectId,
          ) ?? null)
        : null,
    [draftSession, projects],
  );
  const meetingPrivacyRouteDisposition = resolveMeetingPrivacyRouteDisposition({
    enabled: meetingPrivacyEnabled,
    hiddenProjectKeys: meetingPrivacyHiddenProjectKeySet,
    project: draftProject,
  });
  const draftProjectHiddenForMeeting = meetingPrivacyRouteDisposition === "redirect";
  const meetingPrivacyProjectResolutionPending =
    draftSession !== null && meetingPrivacyRouteDisposition === "pending";
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);
  const canonicalThreadRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverThreadStarted
          ? draftSession.promotedTo
          : null
        : serverThread
          ? {
              environmentId: serverThread.environmentId,
              threadId: serverThread.id,
            }
          : null,
    [draftSession?.promotedTo, serverThread, serverThreadStarted],
  );

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
    });
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  useEffect(() => {
    if (
      !draftProjectHiddenForMeeting &&
      !(meetingPrivacyProjectResolutionPending && environmentBootstrapComplete)
    ) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [
    draftProjectHiddenForMeeting,
    environmentBootstrapComplete,
    meetingPrivacyProjectResolutionPending,
    navigate,
  ]);

  if (draftProjectHiddenForMeeting || meetingPrivacyProjectResolutionPending) {
    return null;
  }

  if (canonicalThreadRef) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
    return null;
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <ChatView
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatThreadRouteView,
});
