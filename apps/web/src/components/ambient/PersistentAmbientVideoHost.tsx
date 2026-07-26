import { Component, type ErrorInfo, type ReactNode } from "react";

import { AmbientVideoWorkspace } from "./AmbientVideoWorkspace";

const AMBIENT_VIDEO_LOG_SCOPE = "[AMBIENT_VIDEO]";

/**
 * Fail-closed containment for the shell-owned ambient player.
 *
 * The router shell mounts this host above the router's root route, which is
 * also above every route error boundary React would otherwise reach. Without a
 * local boundary an ambient render failure escapes to the React root, React
 * unmounts the entire renderer, and the user is left with a blank window and no
 * recovery affordance. The player is decorative, so a failure hides it and
 * records one bounded diagnostic instead of taking the app down with it.
 *
 * Recovery is deliberately the documented renderer-reload boundary rather than
 * an automatic retry: everything that can throw here is a deterministic
 * function of the same render inputs, so re-rendering would only crash again.
 */
class AmbientVideoRenderFailureBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  constructor(props: { readonly children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    // Renderer-local diagnostic only. The ambient player never renders provider
    // output, prompts, or credentials, so the error plus the React component
    // stack is enough to identify the failing subtree.
    console.error(
      `${AMBIENT_VIDEO_LOG_SCOPE} ambient player render failed; hiding player`,
      error,
      info.componentStack,
    );
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Stable shell-level owner for the ambient player.
 *
 * Route content, selected projects, selected threads, Settings, the pairing
 * surface, and the root error/reset view all render as siblings below the
 * router shell that mounts this host. They can change freely without moving or
 * remounting the iframe.
 */
export function PersistentAmbientVideoHost() {
  return (
    <AmbientVideoRenderFailureBoundary>
      <div data-testid="persistent-ambient-video-host">
        <AmbientVideoWorkspace />
      </div>
    </AmbientVideoRenderFailureBoundary>
  );
}
