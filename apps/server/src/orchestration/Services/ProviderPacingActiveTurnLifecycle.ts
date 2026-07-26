import type {
  EnvironmentId,
  OrchestrationSessionStatus,
  ServerProvider,
  ThreadId,
} from "@cafecode/contracts";
import * as Context from "effect/Context";

export interface ProviderPacingProjectedSessionInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly status: OrchestrationSessionStatus;
}

export interface ProviderPacingAcceptedLaunchInput {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider;
  readonly threadId: ThreadId;
}

export interface ProviderPacingActiveTurnLifecycleShape {
  /**
   * Records backend-projected session truth. A lease is released only after
   * the session leaves both `starting` and `running`.
   */
  readonly noteProjectedSession: (input: ProviderPacingProjectedSessionInput) => void;

  /**
   * Transfers an accepted launch into thread-scoped active-work accounting
   * before the short-lived provider send acknowledgement completes.
   */
  readonly adoptAcceptedLaunch: (input: ProviderPacingAcceptedLaunchInput) => boolean;

  /**
   * Adopts work that was already running when pacing started or when a
   * provider runtime event arrived before the send acknowledgement.
   */
  readonly adoptObservedRunning: (input: ProviderPacingAcceptedLaunchInput) => boolean;

  /**
   * Releases local accounting for a thread that was deleted or is otherwise
   * no longer projected by the backend. This cannot signal provider work.
   */
  readonly forgetThread: (environmentId: EnvironmentId, threadId: ThreadId) => boolean;

  readonly getCounts: () => {
    readonly trackedSessions: number;
    readonly activeLeases: number;
  };

  /**
   * Releases accounting leases only. The lifecycle owns no provider process,
   * turn handle, cancellation token, or interrupt capability.
   */
  readonly dispose: () => void;
}

export class ProviderPacingActiveTurnLifecycle extends Context.Service<
  ProviderPacingActiveTurnLifecycle,
  ProviderPacingActiveTurnLifecycleShape
>()("cafecode/orchestration/Services/ProviderPacingActiveTurnLifecycle") {}
