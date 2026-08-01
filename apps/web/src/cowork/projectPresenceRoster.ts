import type {
  CollaborationPresenceDelta,
  CollaborationPresenceRosterEntry,
  CollaborationPresenceSnapshot,
  CollaborationPresenceUpdate,
  SharedProjectId,
} from "@cafecode/contracts";
import {
  COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT,
  COLLABORATION_PRESENCE_ROSTER_MAX,
} from "@cafecode/contracts";

export interface ProjectPresenceSubscriptionClient {
  readonly subscribe: (input: {
    readonly sharedProjectId: SharedProjectId;
    readonly rosterLimit: number;
    readonly onUpdate: (update: CollaborationPresenceUpdate) => void;
    readonly onError: () => void;
  }) => () => void;
}

export interface ProjectPresenceParticipant {
  readonly userId: string;
  readonly state: "online" | "away" | "offline";
  readonly capabilities: ReadonlyArray<"operator-chat" | "shared-context">;
}

export interface ProjectPresenceRosterState {
  readonly status: "loading" | "ready" | "resync-required" | "unavailable";
  readonly version: number;
  readonly participants: ReadonlyArray<ProjectPresenceParticipant>;
  readonly overflowCount: number;
}

interface ActiveSubscription {
  readonly sharedProjectId: SharedProjectId;
  closed: boolean;
  unsubscribe: (() => void) | null;
}

const loadingState = (): ProjectPresenceRosterState => ({
  status: "loading",
  version: 0,
  participants: [],
  overflowCount: 0,
});

function emptyState(
  status: Extract<ProjectPresenceRosterState["status"], "resync-required" | "unavailable">,
  version: number,
): ProjectPresenceRosterState {
  return { status, version, participants: [], overflowCount: 0 };
}

function aggregate(entries: ReadonlyArray<CollaborationPresenceRosterEntry>, limit: number) {
  const byUser = new Map<string, ProjectPresenceParticipant>();
  for (const entry of entries.slice(0, COLLABORATION_PRESENCE_ROSTER_MAX)) {
    const previous = byUser.get(entry.userId);
    const state =
      previous?.state === "online" || entry.state === "online"
        ? "online"
        : previous?.state === "away" || entry.state === "away"
          ? "away"
          : "offline";
    const capabilities = new Set([...(previous?.capabilities ?? []), ...entry.capabilities]);
    byUser.set(entry.userId, {
      userId: entry.userId,
      state,
      capabilities: [...capabilities].toSorted() as ProjectPresenceParticipant["capabilities"],
    });
  }
  const participants = [...byUser.values()].toSorted((a, b) => a.userId.localeCompare(b.userId));
  return {
    participants: participants.slice(0, limit),
    overflowCount: Math.max(0, participants.length - limit),
  };
}

export class ProjectPresenceRosterModel {
  #entries = new Map<string, CollaborationPresenceRosterEntry>();
  #state: ProjectPresenceRosterState = loadingState();
  #active: ActiveSubscription | null = null;
  #hasSnapshot = false;
  #listeners = new Set<() => void>();

  constructor(
    readonly client: ProjectPresenceSubscriptionClient | null,
    readonly rosterLimit = COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT,
  ) {
    if (
      !Number.isSafeInteger(rosterLimit) ||
      rosterLimit < 1 ||
      rosterLimit > COLLABORATION_PRESENCE_ROSTER_MAX
    ) {
      throw new Error("invalid presence roster limit");
    }
  }

  readonly getSnapshot = (): ProjectPresenceRosterState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  start(sharedProjectId: SharedProjectId): void {
    this.stop();
    this.#entries.clear();
    this.#hasSnapshot = false;
    this.#setState(loadingState());

    if (!this.client) {
      this.#setState(emptyState("unavailable", 0));
      return;
    }

    const active: ActiveSubscription = { sharedProjectId, closed: false, unsubscribe: null };
    this.#active = active;

    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = this.client.subscribe({
        sharedProjectId,
        rosterLimit: this.rosterLimit,
        onUpdate: (update) => {
          if (this.#isActive(active)) this.#apply(active, update);
        },
        onError: () => {
          if (this.#isActive(active)) this.#fail(active);
        },
      });
    } catch {
      this.#fail(active);
      return;
    }

    if (!this.#isActive(active)) {
      this.#invokeUnsubscribe(unsubscribe);
      return;
    }
    active.unsubscribe = unsubscribe;
  }

  stop(): void {
    const active = this.#active;
    if (!active) return;
    this.#close(active);
  }

  #apply(active: ActiveSubscription, update: CollaborationPresenceUpdate): void {
    if (update.kind === "snapshot") {
      this.#applySnapshot(active, update.snapshot);
    } else {
      this.#applyDelta(active, update.delta);
    }
  }

  #applySnapshot(active: ActiveSubscription, snapshot: CollaborationPresenceSnapshot): void {
    if (
      snapshot.sharedProjectId !== active.sharedProjectId ||
      snapshot.version < this.#state.version
    )
      return;
    if (snapshot.entries.length > COLLABORATION_PRESENCE_ROSTER_MAX) {
      this.#requireResync();
      return;
    }
    this.#entries = new Map(snapshot.entries.map((entry) => [entry.sessionId, entry]));
    this.#hasSnapshot = true;
    this.#publish("ready", snapshot.version);
  }

  #applyDelta(active: ActiveSubscription, delta: CollaborationPresenceDelta): void {
    if (
      delta.sharedProjectId !== active.sharedProjectId ||
      this.#state.status === "resync-required" ||
      delta.version <= this.#state.version
    ) {
      return;
    }
    if (!this.#hasSnapshot || delta.version !== this.#state.version + 1) {
      this.#requireResync();
      return;
    }
    if (
      delta.removedSessionIds.length > COLLABORATION_PRESENCE_ROSTER_MAX ||
      delta.upserts.length > COLLABORATION_PRESENCE_ROSTER_MAX
    ) {
      this.#requireResync();
      return;
    }
    const entries = new Map(this.#entries);
    for (const id of delta.removedSessionIds) entries.delete(id);
    for (const entry of delta.upserts) entries.set(entry.sessionId, entry);
    if (entries.size > COLLABORATION_PRESENCE_ROSTER_MAX) {
      this.#requireResync();
      return;
    }
    this.#entries = entries;
    this.#publish("ready", delta.version);
  }

  #requireResync(): void {
    this.#entries.clear();
    this.#hasSnapshot = false;
    this.#setState(emptyState("resync-required", this.#state.version));
  }

  #fail(active: ActiveSubscription): void {
    const version = this.#state.version;
    this.#entries.clear();
    this.#hasSnapshot = false;
    this.#close(active);
    this.#setState(emptyState("unavailable", version));
  }

  #close(active: ActiveSubscription): void {
    if (active.closed) return;
    active.closed = true;
    if (this.#active === active) this.#active = null;
    const unsubscribe = active.unsubscribe;
    active.unsubscribe = null;
    this.#invokeUnsubscribe(unsubscribe);
  }

  #isActive(active: ActiveSubscription): boolean {
    return !active.closed && this.#active === active;
  }

  #invokeUnsubscribe(unsubscribe: (() => void) | null): void {
    try {
      unsubscribe?.();
    } catch {
      // The injected transport owns its diagnostics. UI cleanup must remain fail-closed.
    }
  }

  #publish(status: ProjectPresenceRosterState["status"], version: number): void {
    this.#setState({
      status,
      version,
      ...aggregate([...this.#entries.values()], this.rosterLimit),
    });
  }

  #setState(state: ProjectPresenceRosterState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
