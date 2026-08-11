import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";

import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { resolveAmbientVideoEnvironmentScope } from "../ambientVideoEnvironmentScope";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";
import { useStore } from "../store";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import { AmbientVideoWorkspace } from "./ambient/AmbientVideoWorkspace";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;
export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const activeDraftSession = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const routeEnvironmentId = useMemo(() => {
    if (routeTarget?.kind === "server") {
      return routeTarget.threadRef.environmentId;
    }
    return activeDraftSession?.environmentId ?? null;
  }, [activeDraftSession?.environmentId, routeTarget]);
  const retainedRouteEnvironmentIdRef = useRef<typeof routeEnvironmentId>(null);
  const settingsRouteActive = pathname === "/settings" || pathname.startsWith("/settings/");
  const environmentScope = resolveAmbientVideoEnvironmentScope({
    routeEnvironmentId,
    retainedRouteEnvironmentId: retainedRouteEnvironmentIdRef.current,
    activeEnvironmentId,
    settingsRouteActive,
  });
  const navigationSidebarOpen = useUiStateStore((state) => state.navigationSidebarOpen);
  const setNavigationSidebarOpen = useUiStateStore((state) => state.setNavigationSidebarOpen);

  useLayoutEffect(() => {
    retainedRouteEnvironmentIdRef.current = environmentScope.retainedRouteEnvironmentId;
  }, [environmentScope.retainedRouteEnvironmentId]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowKeyUp = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowBlur = () => {
      clearShortcutModifierState();
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("keyup", onWindowKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        void navigate({ to: "/settings" });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider
      className="relative z-10 h-dvh! min-h-0!"
      open={navigationSidebarOpen}
      onOpenChange={setNavigationSidebarOpen}
    >
      <Sidebar
        side="left"
        collapsible="icon"
        className="cafe-thread-sidebar border-r border-border bg-card text-foreground"
        resizable={{
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      {/*
       * Settings remains inside the same environment-scoped workspace so its
       * player iframe survives route changes. Changing to an unrelated saved
       * environment deliberately remounts the streaming player instead of
       * carrying an iframe's playback/controller state across server identities.
       */}
      <AmbientVideoWorkspace
        environmentScopeKey={environmentScope.scopeKey}
        retainPlayerWithoutAnchor={settingsRouteActive}
      >
        {children}
      </AmbientVideoWorkspace>
    </SidebarProvider>
  );
}
