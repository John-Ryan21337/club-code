import {
  CollaborationAuthenticatedIdentity,
  CollaborationInvitationSecret,
  CollaborationMembershipCommandId,
  CollaborationMembershipMutationResult,
  CollaborationRedeemInvitationRequest,
  SharedProjectId,
  collaborationPermissionsFitRole,
  type CollaborationProjectRole,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const PLAIN_DATA_MAX_ARRAY_LENGTH = 64;
const PLAIN_DATA_MAX_NODES = 256;
const PLAIN_DATA_MAX_OBJECT_PROPERTIES = 16;

export interface CoworkInvitationRedemptionIdentity {
  readonly sessionId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface CoworkInvitationRedemptionRequest {
  readonly commandId: string;
  readonly sharedProjectId: string;
  readonly secret: string;
  readonly displayName: string;
}

export interface CoworkInvitationRedemptionCommand {
  /**
   * Renderer-side response/scope evidence only. A production transport must
   * omit this field and derive the store identity from its authenticated
   * server session; it is deliberately not named like the store's `identity`
   * input so the whole command cannot be forwarded accidentally.
   */
  readonly expectedIdentity: Readonly<CoworkInvitationRedemptionIdentity>;
  readonly request: Readonly<CoworkInvitationRedemptionRequest>;
}

export interface CoworkInvitationRedemptionClient {
  readonly redeemInvitation: (
    command: Readonly<CoworkInvitationRedemptionCommand>,
  ) => Promise<unknown>;
}

export interface CoworkInvitationRedemptionInput {
  readonly sharedProjectId: string;
  readonly secret: string;
  readonly displayName: string;
}

export interface CoworkInvitationRedemptionMember {
  readonly userId: string;
  readonly displayName: string;
  readonly role: CollaborationProjectRole;
  readonly permissionCount: number;
  readonly joinedAt: string;
  readonly membershipEpoch: number;
}

export interface CoworkInvitationRedemptionState {
  readonly status: "idle" | "pending" | "indeterminate" | "rejected" | "succeeded" | "unavailable";
  readonly canSubmit: boolean;
  readonly member: CoworkInvitationRedemptionMember | null;
}

interface ActiveAttempt {
  readonly generation: number;
  readonly command: Readonly<CoworkInvitationRedemptionCommand>;
  status: "pending" | "indeterminate";
}

const strictOptions = { onExcessProperty: "error" } as const;
const decodeIdentitySchema = Schema.decodeUnknownSync(CollaborationAuthenticatedIdentity);
const decodeRequestSchema = Schema.decodeUnknownSync(CollaborationRedeemInvitationRequest);
const decodeResultSchema = Schema.decodeUnknownSync(CollaborationMembershipMutationResult);
const decodeCommandIdSchema = Schema.decodeUnknownSync(CollaborationMembershipCommandId);
const decodeProjectIdSchema = Schema.decodeUnknownSync(SharedProjectId);
const decodeSecretSchema = Schema.decodeUnknownSync(CollaborationInvitationSecret);

function state(
  status: CoworkInvitationRedemptionState["status"],
  member: CoworkInvitationRedemptionMember | null = null,
): CoworkInvitationRedemptionState {
  return Object.freeze({
    status,
    canSubmit: status === "idle" || status === "rejected",
    member,
  });
}

/**
 * The adapter is an untrusted transport boundary. Inspect only intrinsic,
 * enumerable own data properties, bound the graph before decoding, then use
 * structured cloning to reject otherwise-transparent Proxy wrappers. JSON
 * serialization is intentionally not used because it invokes accessors and
 * silently erases sparse entries and symbols.
 */
function assertPlainData(root: unknown): void {
  const pending: unknown[] = [root];
  let visited = 0;

  while (pending.length > 0) {
    if (++visited > PLAIN_DATA_MAX_NODES) throw new Error("adapter payload is too large");
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;

    let prototype: object | null;
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      throw new Error("adapter payload could not be inspected safely");
    }

    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) {
        throw new Error("adapter arrays must use the intrinsic prototype");
      }
      if (value.length > PLAIN_DATA_MAX_ARRAY_LENGTH) throw new Error("adapter array is too large");
      const keys = Reflect.ownKeys(descriptors);
      if (
        keys.some((key) => typeof key === "symbol") ||
        keys.length !== value.length + 1 ||
        !("length" in descriptors)
      ) {
        throw new Error("adapter arrays must be dense and unadorned");
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error("adapter arrays must contain enumerable own data elements");
        }
        pending.push(descriptor.value);
      }
      continue;
    }

    if (prototype !== Object.prototype) {
      throw new Error("adapter objects must use the intrinsic prototype");
    }
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > PLAIN_DATA_MAX_OBJECT_PROPERTIES) {
      throw new Error("adapter object has too many properties");
    }
    for (const key of keys) {
      if (typeof key === "symbol") throw new Error("adapter objects must not have symbols");
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("adapter objects must contain enumerable own data properties");
      }
      pending.push(descriptor.value);
    }
  }

  if (typeof globalThis.structuredClone !== "function") {
    throw new Error("adapter payload cannot be verified in this browser");
  }
  try {
    globalThis.structuredClone(root);
  } catch {
    throw new Error("adapter payload must not contain proxy or uncloneable values");
  }
}

function canonicalIdentity(value: unknown): Readonly<CoworkInvitationRedemptionIdentity> {
  assertPlainData(value);
  const identity = decodeIdentitySchema(value, strictOptions);
  return Object.freeze({
    sessionId: String(identity.sessionId),
    userId: String(identity.userId),
    deviceId: String(identity.deviceId),
    issuedAt: DateTime.formatIso(identity.issuedAt),
    expiresAt: DateTime.formatIso(identity.expiresAt),
  });
}

function snapshotRequestInput(
  input: CoworkInvitationRedemptionInput,
): CoworkInvitationRedemptionInput {
  if (input === null || typeof input !== "object") {
    throw new Error("redemption input must be a plain object");
  }
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(input);
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    throw new Error("redemption input could not be inspected safely");
  }
  if (prototype !== Object.prototype) {
    throw new Error("redemption input must use the intrinsic object prototype");
  }
  const expectedKeys = ["sharedProjectId", "secret", "displayName"] as const;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some(
      (key) =>
        typeof key === "symbol" ||
        (key !== "sharedProjectId" && key !== "secret" && key !== "displayName"),
    )
  ) {
    throw new Error("redemption input must contain only the expected fields");
  }
  const values = Object.fromEntries(
    expectedKeys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("redemption input fields must be enumerable own data properties");
      }
      return [key, descriptor.value];
    }),
  ) as unknown as CoworkInvitationRedemptionInput;
  return values;
}

function canonicalRequest(
  input: CoworkInvitationRedemptionInput,
  commandId: string,
): Readonly<CoworkInvitationRedemptionRequest> {
  const decoded = decodeRequestSchema(
    {
      commandId: decodeCommandIdSchema(commandId, strictOptions),
      sharedProjectId: decodeProjectIdSchema(input.sharedProjectId, strictOptions),
      secret: decodeSecretSchema(input.secret, strictOptions),
      displayName: input.displayName,
    },
    strictOptions,
  );
  return Object.freeze({
    commandId: String(decoded.commandId),
    sharedProjectId: String(decoded.sharedProjectId),
    secret: String(decoded.secret),
    displayName: String(decoded.displayName),
  });
}

function commandMatchesIdentity(
  command: CoworkInvitationRedemptionCommand,
  identity: CoworkInvitationRedemptionIdentity,
): boolean {
  return (
    command.expectedIdentity === identity &&
    command.expectedIdentity.sessionId === identity.sessionId &&
    command.expectedIdentity.userId === identity.userId &&
    command.expectedIdentity.deviceId === identity.deviceId &&
    command.expectedIdentity.issuedAt === identity.issuedAt &&
    command.expectedIdentity.expiresAt === identity.expiresAt
  );
}

export class CoworkInvitationRedemptionPanelModel {
  readonly #client: CoworkInvitationRedemptionClient;
  readonly #identity: Readonly<CoworkInvitationRedemptionIdentity> | null;
  readonly #listeners = new Set<() => void>();
  #state: CoworkInvitationRedemptionState;
  #attempt: ActiveAttempt | null = null;
  #generation = 0;
  #closed = false;
  #constructing = false;

  constructor(client: CoworkInvitationRedemptionClient, identity: unknown) {
    this.#client = client;
    try {
      this.#identity = canonicalIdentity(identity);
      this.#state = state("idle");
    } catch {
      this.#identity = null;
      this.#state = state("unavailable");
    }
  }

  readonly getSnapshot = (): CoworkInvitationRedemptionState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  start(): void {
    // React StrictMode deliberately replays effect setup/cleanup. Reopening
    // this immutable client/identity scope is safe only after discarding any
    // prior attempt and generation; no token or command crosses the replay.
    this.#closed = false;
    this.#generation += 1;
    this.#attempt = null;
    this.#setState(state(this.#identity === null ? "unavailable" : "idle"));
  }

  redeem(input: CoworkInvitationRedemptionInput, createCommandId: () => string): void {
    if (
      this.#closed ||
      this.#identity === null ||
      this.#constructing ||
      this.#attempt !== null ||
      (this.#state.status !== "idle" && this.#state.status !== "rejected")
    ) {
      return;
    }

    const constructionGeneration = this.#generation;
    this.#constructing = true;
    let command: Readonly<CoworkInvitationRedemptionCommand>;
    try {
      // Snapshot only descriptor values before invoking the command-id
      // factory. Unlike structuredClone, this does not manufacture another
      // transient copy of the one-time secret, and it never invokes a field
      // accessor or Proxy `get` trap.
      const inputSnapshot = snapshotRequestInput(input);
      const request = canonicalRequest(inputSnapshot, createCommandId());
      command = Object.freeze({ expectedIdentity: this.#identity, request });
    } catch {
      // Validation failures are definitive and retain neither the capability
      // nor a retry command. The UI can correct the explicit inputs.
      if (!this.#closed && this.#generation === constructionGeneration && this.#attempt === null) {
        this.#setState(state("rejected"));
      }
      return;
    } finally {
      this.#constructing = false;
    }

    // Command-id factories are injected and may run arbitrary synchronous
    // code. If one closed or restarted this scope, the freshly constructed
    // capability must never cross the adapter boundary.
    if (
      this.#closed ||
      this.#generation !== constructionGeneration ||
      this.#attempt !== null ||
      (this.#state.status !== "idle" && this.#state.status !== "rejected")
    ) {
      return;
    }

    const attempt: ActiveAttempt = {
      generation: ++this.#generation,
      command,
      status: "pending",
    };
    this.#attempt = attempt;
    this.#setState(state("pending"));
    // Subscribers are also arbitrary synchronous code. A listener may close
    // the scope while observing `pending`; do not dispatch after that cleanup.
    if (this.#isCurrent(attempt)) this.#dispatch(attempt);
  }

  retry(): void {
    const attempt = this.#attempt;
    if (this.#closed || !attempt || attempt.status !== "indeterminate") return;
    attempt.status = "pending";
    this.#setState(state("pending"));
    // An indeterminate transport acknowledgement may have committed upstream.
    // Reuse the exact frozen object and command id; never reconstruct a secret.
    if (this.#isCurrent(attempt)) this.#dispatch(attempt);
  }

  discardIndeterminate(): void {
    if (this.#attempt?.status !== "indeterminate") return;
    this.#generation += 1;
    this.#attempt = null;
    this.#setState(state("idle"));
  }

  stop(): void {
    this.#closed = true;
    this.#generation += 1;
    this.#attempt = null;
    this.#setState(state("unavailable"));
  }

  #dispatch(attempt: ActiveAttempt): void {
    let response: Promise<unknown>;
    try {
      response = Reflect.apply(this.#client.redeemInvitation, this.#client, [attempt.command]);
    } catch {
      this.#markIndeterminate(attempt);
      return;
    }
    try {
      void Promise.resolve(response).then(
        (value) => this.#accept(attempt, value),
        () => this.#markIndeterminate(attempt),
      );
    } catch {
      // Contain even a synchronously hostile thenable-assimilation surface.
      this.#markIndeterminate(attempt);
    }
  }

  #accept(attempt: ActiveAttempt, value: unknown): void {
    if (!this.#isCurrent(attempt)) return;
    try {
      assertPlainData(value);
      const decoded = decodeResultSchema(value, strictOptions);
      const member = decoded.member;
      if (
        this.#identity === null ||
        !commandMatchesIdentity(attempt.command, this.#identity) ||
        attempt.command.request.sharedProjectId.length === 0 ||
        member === null ||
        member.userId !== this.#identity.userId ||
        member.displayName !== attempt.command.request.displayName ||
        member.role === "owner" ||
        !collaborationPermissionsFitRole(member.role, member.permissions) ||
        decoded.membershipEpoch < 1
      ) {
        throw new Error("redemption result did not match the authenticated request");
      }

      const acceptedMember = Object.freeze({
        userId: String(member.userId),
        displayName: String(member.displayName),
        role: member.role,
        permissionCount: member.permissions.length,
        joinedAt: String(member.joinedAt),
        membershipEpoch: decoded.membershipEpoch,
      });
      this.#attempt = null;
      this.#generation += 1;
      this.#setState(state("succeeded", acceptedMember));
    } catch {
      if (!this.#isCurrent(attempt)) return;
      // A decoded or semantic failure is definitive hostile data, not a lost
      // acknowledgement. Drop the only retained capability/request reference.
      this.#attempt = null;
      this.#generation += 1;
      this.#setState(state("rejected"));
    }
  }

  #markIndeterminate(attempt: ActiveAttempt): void {
    if (!this.#isCurrent(attempt)) return;
    attempt.status = "indeterminate";
    this.#setState(state("indeterminate"));
  }

  #isCurrent(attempt: ActiveAttempt): boolean {
    return (
      !this.#closed &&
      this.#attempt === attempt &&
      attempt.status === "pending" &&
      attempt.generation === this.#generation
    );
  }

  #setState(next: CoworkInvitationRedemptionState): void {
    this.#state = next;
    // Snapshot the observer set so a listener cannot grow this notification
    // pass indefinitely by subscribing more listeners during iteration.
    for (const listener of Array.from(this.#listeners)) {
      try {
        listener();
      } catch {
        // One observer cannot block state cleanup or other subscribers.
      }
    }
  }
}
