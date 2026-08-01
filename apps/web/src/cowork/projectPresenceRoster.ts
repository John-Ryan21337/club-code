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

const empty: ProjectPresenceRosterState = {
  status: "loading",
  version: 0,
  participants: [],
  overflowCount: 0,
};

function aggregate(entries: ReadonlyArray<CollaborationPresenceRosterEntry>, limit: number) {
  const byUser = new Map<string, ProjectPresenceParticipant>();
  for (const entry of entries) {
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
      capabilities: [...capabilities].sort() as ProjectPresenceParticipant["capabilities"],
    });
  }
  const participants = [...byUser.values()].sort((a, b) => a.userId.localeCompare(b.userId));
  return {
    participants: participants.slice(0, limit),
    overflowCount: Math.max(0, participants.length - limit),
  };
}

export class ProjectPresenceRosterModel {
  #entries = new Map<string, CollaborationPresenceRosterEntry>();
  #state: ProjectPresenceRosterState = empty;
  #unsubscribe: (() => void) | null = null;
  constructor(
    readonly client: ProjectPresenceSubscriptionClient | null,
    readonly rosterLimit = COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT,
  ) {
    if (
      !Number.isSafeInteger(rosterLimit) ||
      rosterLimit < 1 ||
      rosterLimit > COLLABORATION_PRESENCE_ROSTER_MAX
    )
      throw new Error("invalid presence roster limit");
  }
  get state() {
    return this.#state;
  }
  start(sharedProjectId: SharedProjectId): void {
    this.stop();
    this.#entries.clear();
    this.#state = empty;
    if (!this.client) return;
    this.#unsubscribe = this.client.subscribe({
      sharedProjectId,
      rosterLimit: this.rosterLimit,
      onUpdate: (u) => this.apply(u),
      onError: () => {
        this.#state = { ...this.#state, status: "unavailable" };
      },
    });
  }
  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
  apply(update: CollaborationPresenceUpdate): void {
    update.kind === "snapshot" ? this.snapshot(update.snapshot) : this.delta(update.delta);
  }
  private snapshot(snapshot: CollaborationPresenceSnapshot): void {
    if (snapshot.version < this.#state.version) return;
    this.#entries = new Map(snapshot.entries.map((entry) => [entry.sessionId, entry]));
    this.publish("ready", snapshot.version);
  }
  private delta(delta: CollaborationPresenceDelta): void {
    if (delta.version <= this.#state.version) return;
    if (delta.version !== this.#state.version + 1) {
      this.#state = { ...this.#state, status: "resync-required" };
      return;
    }
    for (const id of delta.removedSessionIds) this.#entries.delete(id);
    for (const entry of delta.upserts) this.#entries.set(entry.sessionId, entry);
    this.publish("ready", delta.version);
  }
  private publish(status: ProjectPresenceRosterState["status"], version: number): void {
    this.#state = { status, version, ...aggregate([...this.#entries.values()], this.rosterLimit) };
  }
}
