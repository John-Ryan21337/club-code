import {
  CollaborationCurrentDeviceKeyStatus,
  CollaborationCurrentDeviceKeyStatusRequest,
  CollaborationDeviceCommandId,
  CollaborationDeviceKeyMutationResult,
  CollaborationMembershipEpoch,
  CollaborationRevokeDeviceKeyRequest,
  DeviceId,
  SharedProjectId,
  UserId,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const PLAIN_DATA_MAX_NODES = 32;
const PLAIN_DATA_MAX_PROPERTIES = 12;
const PLAIN_DATA_MAX_STRING_CHARS = 4096;
const strictOptions = { onExcessProperty: "error" } as const;

const CurrentDeviceKeyScope = Schema.Struct({
  sharedProjectId: SharedProjectId,
  userId: UserId,
  deviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
});

export type CoworkCurrentDeviceKeyScope = typeof CurrentDeviceKeyScope.Type;

export interface CoworkCurrentDeviceKeyClient {
  readonly getCurrentDeviceKeyStatus: (
    request: Readonly<typeof CollaborationCurrentDeviceKeyStatusRequest.Type>,
  ) => Promise<unknown>;
  readonly revokeCurrentDeviceKey: (
    request: Readonly<typeof CollaborationRevokeDeviceKeyRequest.Type>,
  ) => Promise<unknown>;
}

export type CoworkCurrentDeviceKeyPhase =
  | "idle"
  | "loading"
  | "unavailable"
  | "enrollment-required"
  | "active"
  | "confirming-revoke"
  | "prepare-failed"
  | "revoking"
  | "retry-revoke";

export interface CoworkCurrentDeviceKeyState {
  readonly phase: CoworkCurrentDeviceKeyPhase;
  readonly sharedProjectId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly membershipEpoch: number;
  readonly deviceKeyId: string | null;
  readonly activatedAt: string | null;
}

interface ActiveGeneration {
  readonly id: number;
  closed: boolean;
}

interface RevokeAttempt {
  readonly request: Readonly<typeof CollaborationRevokeDeviceKeyRequest.Type>;
  readonly deviceKeyId: string;
  readonly activatedAt: string;
}

const decodeScope = Schema.decodeUnknownSync(CurrentDeviceKeyScope);
const decodeStatusRequest = Schema.decodeUnknownSync(CollaborationCurrentDeviceKeyStatusRequest);
const decodeStatus = Schema.decodeUnknownSync(CollaborationCurrentDeviceKeyStatus);
const decodeCommandId = Schema.decodeUnknownSync(CollaborationDeviceCommandId);
const decodeRevokeRequest = Schema.decodeUnknownSync(CollaborationRevokeDeviceKeyRequest);
const decodeMutationResult = Schema.decodeUnknownSync(CollaborationDeviceKeyMutationResult);

function assertPlainData(root: unknown, label: string): void {
  const pending: unknown[] = [root];
  let visited = 0;
  while (pending.length > 0) {
    if (++visited > PLAIN_DATA_MAX_NODES) throw new Error(`${label} is too large`);
    const value = pending.pop();
    if (typeof value === "string" && value.length > PLAIN_DATA_MAX_STRING_CHARS) {
      throw new Error(`${label} contains an oversized string`);
    }
    if (value === null || typeof value !== "object") continue;
    let prototype: object | null;
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      throw new Error(`${label} could not be inspected safely`);
    }
    if (prototype !== Object.prototype && prototype !== Array.prototype) {
      throw new Error(`${label} must use intrinsic plain-data prototypes`);
    }
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > PLAIN_DATA_MAX_PROPERTIES) throw new Error(`${label} has too many fields`);
    if (keys.some((key) => typeof key === "symbol")) throw new Error(`${label} has symbols`);
    if (Array.isArray(value)) {
      if (keys.length !== value.length + 1 || !("length" in descriptors)) {
        throw new Error(`${label} arrays must be dense and unadorned`);
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error(`${label} arrays must contain own data elements`);
        }
        pending.push(descriptor.value);
      }
      continue;
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error(`${label} objects must contain enumerable own data properties`);
      }
      pending.push(descriptor.value);
    }
  }
  if (typeof globalThis.structuredClone !== "function") {
    throw new Error(`${label} cannot be verified in this browser`);
  }
  try {
    globalThis.structuredClone(root);
  } catch {
    throw new Error(`${label} contains proxy or uncloneable data`);
  }
}

function captureMethod<T extends (...arguments_: never[]) => unknown>(
  client: object,
  key: string,
): T {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(client, key);
  } catch {
    throw new Error("current-device key client could not be inspected safely");
  }
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new Error(`current-device key client must expose own callable ${key}`);
  }
  return descriptor.value as T;
}

function timestamp(value: string | DateTime.Utc): string {
  return typeof value === "string" ? value : DateTime.formatIso(value);
}

function sameScope(
  value: {
    readonly sharedProjectId: string;
    readonly userId: string;
    readonly deviceId: string;
    readonly membershipEpoch: number;
  },
  scope: CoworkCurrentDeviceKeyScope,
): boolean {
  return (
    value.sharedProjectId === scope.sharedProjectId &&
    value.userId === scope.userId &&
    value.deviceId === scope.deviceId &&
    value.membershipEpoch === scope.membershipEpoch
  );
}

function stateFor(
  scope: CoworkCurrentDeviceKeyScope,
  phase: CoworkCurrentDeviceKeyPhase,
  activeKey: { readonly deviceKeyId: string; readonly activatedAt: string } | null = null,
): CoworkCurrentDeviceKeyState {
  return Object.freeze({
    phase,
    sharedProjectId: String(scope.sharedProjectId),
    userId: String(scope.userId),
    deviceId: String(scope.deviceId),
    membershipEpoch: scope.membershipEpoch,
    deviceKeyId: activeKey?.deviceKeyId ?? null,
    activatedAt: activeKey?.activatedAt ?? null,
  });
}

function activeKeyFromState(
  state: CoworkCurrentDeviceKeyState,
): { readonly deviceKeyId: string; readonly activatedAt: string } | null {
  return state.deviceKeyId === null || state.activatedAt === null
    ? null
    : { deviceKeyId: state.deviceKeyId, activatedAt: state.activatedAt };
}

export class CoworkCurrentDeviceKeyModel {
  readonly #scope: CoworkCurrentDeviceKeyScope;
  readonly #client: CoworkCurrentDeviceKeyClient;
  readonly #statusRequest: Readonly<typeof CollaborationCurrentDeviceKeyStatusRequest.Type>;
  readonly #getCurrentDeviceKeyStatus: CoworkCurrentDeviceKeyClient["getCurrentDeviceKeyStatus"];
  readonly #revokeCurrentDeviceKey: CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"];
  #state: CoworkCurrentDeviceKeyState;
  #active: ActiveGeneration | null = null;
  #attempt: RevokeAttempt | null = null;
  #constructingCommand = false;
  #generation = 0;
  #listeners = new Set<() => void>();

  constructor(client: CoworkCurrentDeviceKeyClient, scope: CoworkCurrentDeviceKeyScope) {
    assertPlainData(scope, "current-device key scope");
    this.#scope = Object.freeze({ ...decodeScope(scope, strictOptions) });
    this.#client = client;
    this.#getCurrentDeviceKeyStatus = captureMethod<
      CoworkCurrentDeviceKeyClient["getCurrentDeviceKeyStatus"]
    >(client, "getCurrentDeviceKeyStatus");
    this.#revokeCurrentDeviceKey = captureMethod<
      CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"]
    >(client, "revokeCurrentDeviceKey");
    this.#statusRequest = Object.freeze(
      decodeStatusRequest({ sharedProjectId: this.#scope.sharedProjectId }, strictOptions),
    );
    this.#state = stateFor(this.#scope, "idle");
  }

  readonly getSnapshot = (): CoworkCurrentDeviceKeyState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  start(): void {
    this.stop();
    const active = { id: ++this.#generation, closed: false };
    this.#active = active;
    void this.#readStatus(active);
  }

  stop(): void {
    if (this.#active) this.#active.closed = true;
    this.#active = null;
    this.#attempt = null;
    this.#state = stateFor(this.#scope, "idle");
  }

  refresh(): void {
    const active = this.#active;
    if (
      !this.#isActive(active) ||
      this.#state.phase === "loading" ||
      this.#state.phase === "confirming-revoke" ||
      this.#state.phase === "revoking" ||
      this.#state.phase === "retry-revoke"
    ) {
      return;
    }
    this.#attempt = null;
    void this.#readStatus(active);
  }

  requestSelfRevoke(): void {
    if (
      !this.#isActive(this.#active) ||
      (this.#state.phase !== "active" && this.#state.phase !== "prepare-failed")
    ) {
      return;
    }
    const activeKey = activeKeyFromState(this.#state);
    if (activeKey === null) return;
    this.#attempt = null;
    this.#setState(stateFor(this.#scope, "confirming-revoke", activeKey));
  }

  cancelSelfRevoke(): void {
    if (!this.#isActive(this.#active) || this.#state.phase !== "confirming-revoke") return;
    const activeKey = activeKeyFromState(this.#state);
    if (activeKey === null) return;
    this.#attempt = null;
    this.#setState(stateFor(this.#scope, "active", activeKey));
  }

  confirmSelfRevoke(createCommandId: () => string): void {
    const active = this.#active;
    if (
      !this.#isActive(active) ||
      this.#state.phase !== "confirming-revoke" ||
      this.#constructingCommand
    ) {
      return;
    }
    const activeKey = activeKeyFromState(this.#state);
    if (activeKey === null) return;
    this.#constructingCommand = true;
    try {
      const commandId = decodeCommandId(createCommandId(), strictOptions);
      if (!this.#isActive(active) || this.#state.phase !== "confirming-revoke") return;
      const request = Object.freeze(
        decodeRevokeRequest(
          {
            commandId,
            sharedProjectId: this.#scope.sharedProjectId,
            deviceKeyId: activeKey.deviceKeyId,
          },
          strictOptions,
        ),
      );
      const attempt = Object.freeze({ request, ...activeKey });
      this.#attempt = attempt;
      void this.#revoke(active, attempt);
    } catch {
      if (!this.#isActive(active) || this.#state.phase !== "confirming-revoke") return;
      this.#attempt = null;
      this.#setState(stateFor(this.#scope, "prepare-failed", activeKey));
    } finally {
      this.#constructingCommand = false;
    }
  }

  retrySelfRevoke(): void {
    const active = this.#active;
    const attempt = this.#attempt;
    if (!this.#isActive(active) || this.#state.phase !== "retry-revoke" || attempt === null) return;
    void this.#revoke(active, attempt);
  }

  async #readStatus(active: ActiveGeneration): Promise<void> {
    if (!this.#isActive(active)) return;
    this.#attempt = null;
    this.#setState(stateFor(this.#scope, "loading"));
    if (!this.#isActive(active)) return;
    try {
      const raw = await Reflect.apply(this.#getCurrentDeviceKeyStatus, this.#client, [
        this.#statusRequest,
      ]);
      if (!this.#isActive(active)) return;
      assertPlainData(raw, "current-device key status response");
      const result = decodeStatus(raw, strictOptions);
      if (!sameScope(result, this.#scope)) throw new Error("current-device key scope mismatch");
      if (result.status === "enrollment-required") {
        this.#setState(stateFor(this.#scope, "enrollment-required"));
        return;
      }
      this.#setState(
        stateFor(this.#scope, "active", {
          deviceKeyId: result.activeKey.deviceKeyId,
          activatedAt: timestamp(result.activeKey.activatedAt),
        }),
      );
    } catch {
      if (!this.#isActive(active)) return;
      this.#attempt = null;
      this.#setState(stateFor(this.#scope, "unavailable"));
    }
  }

  async #revoke(active: ActiveGeneration, attempt: RevokeAttempt): Promise<void> {
    if (!this.#isCurrent(active, attempt)) return;
    this.#setState(stateFor(this.#scope, "revoking", attempt));
    if (!this.#isCurrent(active, attempt)) return;
    try {
      const raw = await Reflect.apply(this.#revokeCurrentDeviceKey, this.#client, [
        attempt.request,
      ]);
      if (!this.#isCurrent(active, attempt)) return;
      assertPlainData(raw, "current-device key revocation response");
      const result = decodeMutationResult(raw, strictOptions);
      const revokedAt = result.key.revokedAt;
      if (
        (result.disposition !== "revoked" && result.disposition !== "already-applied") ||
        !sameScope(result.key, this.#scope) ||
        result.key.deviceKeyId !== attempt.deviceKeyId ||
        timestamp(result.key.activatedAt) !== attempt.activatedAt ||
        revokedAt === null
      ) {
        throw new Error("current-device key revocation response mismatch");
      }
      this.#attempt = null;
      this.#setState(stateFor(this.#scope, "enrollment-required"));
    } catch {
      if (!this.#isCurrent(active, attempt)) return;
      this.#setState(stateFor(this.#scope, "retry-revoke", attempt));
    }
  }

  #isActive(active: ActiveGeneration | null): active is ActiveGeneration {
    return active !== null && !active.closed && this.#active === active;
  }

  #isCurrent(active: ActiveGeneration, attempt: RevokeAttempt): boolean {
    return this.#isActive(active) && this.#attempt === attempt;
  }

  #setState(state: CoworkCurrentDeviceKeyState): void {
    this.#state = state;
    const listeners = Array.from(this.#listeners);
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A renderer observer is not part of the device-key authority. Keep
        // hostile or stale subscribers from changing a transport outcome.
      }
    }
  }
}
