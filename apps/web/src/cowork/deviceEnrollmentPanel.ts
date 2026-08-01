import {
  COLLABORATION_DEVICE_CHALLENGE_LIFETIME_MILLIS,
  CollaborationBeginDeviceEnrollmentRequest,
  CollaborationBeginDeviceEnrollmentResult,
  CollaborationCompleteDeviceEnrollmentRequest,
  CollaborationDeviceCommandId,
  CollaborationDeviceEnrollmentChallenge,
  CollaborationDeviceKeyMutationResult,
  CollaborationEd25519PublicKeySpkiDer,
  CollaborationEd25519Signature,
  CollaborationMembershipEpoch,
  DeviceId,
  SharedProjectId,
  UserId,
  type CollaborationDeviceEnrollmentNonce,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const PLAIN_DATA_MAX_NODES = 128;
const PLAIN_DATA_MAX_PROPERTIES = 16;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ED25519_SPKI_PREFIX = [
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

const FIELD_MODULUS = (1n << 255n) - 19n;
const GROUP_ORDER = (1n << 252n) + 27742317777372353535851937790883648493n;

const EnrollmentScope = Schema.Struct({
  sharedProjectId: SharedProjectId,
  userId: UserId,
  deviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
});

const SignerIdentity = Schema.Struct({
  ...EnrollmentScope.fields,
  publicKeySpkiDer: CollaborationEd25519PublicKeySpkiDer,
});

export type CoworkDeviceEnrollmentScope = typeof EnrollmentScope.Type;
export type CoworkDeviceEnrollmentSignerIdentity = typeof SignerIdentity.Type;
export type CoworkDeviceEnrollmentChallenge = typeof CollaborationDeviceEnrollmentChallenge.Type;

export interface CoworkDeviceEnrollmentClient {
  readonly beginEnrollment: (
    request: Readonly<typeof CollaborationBeginDeviceEnrollmentRequest.Type>,
  ) => Promise<unknown>;
  readonly completeEnrollment: (
    request: Readonly<typeof CollaborationCompleteDeviceEnrollmentRequest.Type>,
  ) => Promise<unknown>;
}

/**
 * The signer is the private-key custody boundary. It may reveal only public
 * identity and an opaque proof. There is deliberately no export/private-key API.
 */
export interface CoworkDeviceEnrollmentSigner {
  readonly getPublicIdentity: () => Promise<unknown>;
  readonly signEnrollmentProof: (
    challenge: Readonly<CoworkDeviceEnrollmentChallenge>,
    nonce: CollaborationDeviceEnrollmentNonce,
  ) => Promise<unknown>;
}

export type CoworkDeviceEnrollmentStatus =
  | "idle"
  | "prepare-failed"
  | "reading-signer"
  | "beginning"
  | "signing"
  | "completing"
  | "retry-begin"
  | "retry-sign"
  | "retry-complete"
  | "lost-nonce"
  | "activated";

export interface CoworkDeviceEnrollmentState {
  readonly status: CoworkDeviceEnrollmentStatus;
  readonly sharedProjectId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly membershipEpoch: number;
  readonly challengeId: string | null;
  readonly deviceKeyId: string | null;
  readonly publicKeySpkiDer: string | null;
  readonly challengeExpiresAt: string | null;
  readonly activatedAt: string | null;
}

interface ActiveScope {
  readonly generation: number;
  closed: boolean;
}

interface BeginAttempt {
  readonly identity: Readonly<CoworkDeviceEnrollmentSignerIdentity>;
  readonly request: Readonly<typeof CollaborationBeginDeviceEnrollmentRequest.Type>;
}

interface EnrollmentSecret {
  readonly challenge: Readonly<CoworkDeviceEnrollmentChallenge>;
  readonly nonce: CollaborationDeviceEnrollmentNonce;
}

interface CompleteAttempt {
  readonly challenge: Readonly<CoworkDeviceEnrollmentChallenge>;
  readonly request: Readonly<typeof CollaborationCompleteDeviceEnrollmentRequest.Type>;
}

const strictOptions = { onExcessProperty: "error" } as const;
const decodeScope = Schema.decodeUnknownSync(EnrollmentScope);
const decodeSignerIdentitySchema = Schema.decodeUnknownSync(SignerIdentity);
const decodeCommandId = Schema.decodeUnknownSync(CollaborationDeviceCommandId);
const decodeBeginRequest = Schema.decodeUnknownSync(CollaborationBeginDeviceEnrollmentRequest);
const decodeBeginResultSchema = Schema.decodeUnknownSync(CollaborationBeginDeviceEnrollmentResult);
const decodeCompleteRequest = Schema.decodeUnknownSync(
  CollaborationCompleteDeviceEnrollmentRequest,
);
const decodeMutationResultSchema = Schema.decodeUnknownSync(CollaborationDeviceKeyMutationResult);
const decodeSignature = Schema.decodeUnknownSync(CollaborationEd25519Signature);

function assertPlainData(root: unknown, label: string): void {
  const pending: unknown[] = [root];
  let visited = 0;
  while (pending.length > 0) {
    if (++visited > PLAIN_DATA_MAX_NODES) throw new Error(`${label} is too large`);
    const value = pending.pop();
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

function decodeBase64Url(value: string): Uint8Array | null {
  let accumulator = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value) {
    const digit = BASE64URL.indexOf(character);
    if (digit < 0) return null;
    accumulator = accumulator * 64 + digit;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      output.push(Math.floor(accumulator / 2 ** bits) & 0xff);
      accumulator %= 2 ** bits;
    }
  }
  if (accumulator !== 0) return null;
  return Uint8Array.from(output);
}

function mod(value: bigint): bigint {
  const reduced = value % FIELD_MODULUS;
  return reduced < 0n ? reduced + FIELD_MODULUS : reduced;
}

function powMod(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let factor = mod(base);
  let power = exponent;
  while (power > 0n) {
    if ((power & 1n) === 1n) result = mod(result * factor);
    factor = mod(factor * factor);
    power >>= 1n;
  }
  return result;
}

const EDWARDS_D = mod(-121665n * powMod(121666n, FIELD_MODULUS - 2n));
const SQRT_MINUS_ONE = powMod(2n, (FIELD_MODULUS - 1n) / 4n);
type Point = { readonly x: bigint; readonly y: bigint; readonly z: bigint; readonly t: bigint };
const IDENTITY: Point = { x: 0n, y: 1n, z: 1n, t: 0n };

function addPoints(left: Point, right: Point): Point {
  const a = mod((left.y - left.x) * (right.y - right.x));
  const b = mod((left.y + left.x) * (right.y + right.x));
  const c = mod(2n * EDWARDS_D * left.t * right.t);
  const d = mod(2n * left.z * right.z);
  const e = mod(b - a);
  const f = mod(d - c);
  const g = mod(d + c);
  const h = mod(b + a);
  return { x: mod(e * f), y: mod(g * h), z: mod(f * g), t: mod(e * h) };
}

function doublePoint(point: Point): Point {
  const a = mod(point.x * point.x);
  const b = mod(point.y * point.y);
  const c = mod(2n * point.z * point.z);
  const d = mod(-a);
  const e = mod((point.x + point.y) * (point.x + point.y) - a - b);
  const g = mod(d + b);
  const f = mod(g - c);
  const h = mod(d - b);
  return { x: mod(e * f), y: mod(g * h), z: mod(f * g), t: mod(e * h) };
}

function multiplyPoint(point: Point, scalar: bigint): Point {
  let result = IDENTITY;
  let addend = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = addPoints(result, addend);
    addend = doublePoint(addend);
    remaining >>= 1n;
  }
  return result;
}

function littleEndianInteger(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(bytes[index]!);
  }
  return result;
}

function isPrimeSubgroupPoint(encoded: Uint8Array): boolean {
  if (encoded.length !== 32) return false;
  const bytes = Uint8Array.from(encoded);
  const parity = bytes[31]! >>> 7;
  bytes[31] = bytes[31]! & 0x7f;
  const y = littleEndianInteger(bytes);
  if (y >= FIELD_MODULUS) return false;
  const ySquared = mod(y * y);
  const denominator = mod(EDWARDS_D * ySquared + 1n);
  if (denominator === 0n) return false;
  const xSquared = mod((ySquared - 1n) * powMod(denominator, FIELD_MODULUS - 2n));
  let x = powMod(xSquared, (FIELD_MODULUS + 3n) / 8n);
  if (mod(x * x) !== xSquared) x = mod(x * SQRT_MINUS_ONE);
  if (mod(x * x) !== xSquared) return false;
  if (Number(x & 1n) !== parity) x = mod(-x);
  if (x === 0n && parity !== 0) return false;
  const point = { x, y, z: 1n, t: mod(x * y) } satisfies Point;
  if (point.x === 0n && point.y === point.z) return false;
  const multiplied = multiplyPoint(point, GROUP_ORDER);
  return multiplied.x === 0n && multiplied.y === multiplied.z;
}

function validatePublicKey(value: string): void {
  const bytes = decodeBase64Url(value);
  if (
    bytes?.length !== 44 ||
    ED25519_SPKI_PREFIX.some((byte, index) => bytes[index] !== byte) ||
    !isPrimeSubgroupPoint(bytes.subarray(ED25519_SPKI_PREFIX.length))
  ) {
    throw new Error("signer public key is not a canonical prime-order Ed25519 SPKI key");
  }
}

function decodeSignerIdentity(value: unknown): CoworkDeviceEnrollmentSignerIdentity {
  assertPlainData(value, "signer identity");
  const identity = decodeSignerIdentitySchema(value, strictOptions);
  validatePublicKey(identity.publicKeySpkiDer);
  return identity;
}

function decodeBeginResult(value: unknown) {
  assertPlainData(value, "begin response");
  return decodeBeginResultSchema(value, strictOptions);
}

function decodeMutationResult(value: unknown) {
  assertPlainData(value, "complete response");
  return decodeMutationResultSchema(value, strictOptions);
}

function timestamp(value: CoworkDeviceEnrollmentChallenge["issuedAt"]): string {
  return typeof value === "string" ? value : DateTime.formatIso(value);
}

function immutableChallenge(
  challenge: CoworkDeviceEnrollmentChallenge,
): Readonly<CoworkDeviceEnrollmentChallenge> {
  if (typeof challenge.issuedAt !== "string") Object.freeze(challenge.issuedAt);
  if (typeof challenge.expiresAt !== "string") Object.freeze(challenge.expiresAt);
  return Object.freeze({ ...challenge });
}

function sameScope(
  identity: CoworkDeviceEnrollmentSignerIdentity,
  scope: CoworkDeviceEnrollmentScope,
): boolean {
  return (
    identity.sharedProjectId === scope.sharedProjectId &&
    identity.userId === scope.userId &&
    identity.deviceId === scope.deviceId &&
    identity.membershipEpoch === scope.membershipEpoch
  );
}

function stateFor(
  scope: CoworkDeviceEnrollmentScope,
  status: CoworkDeviceEnrollmentStatus,
  details: Partial<CoworkDeviceEnrollmentState> = {},
): CoworkDeviceEnrollmentState {
  return Object.freeze({
    status,
    sharedProjectId: String(scope.sharedProjectId),
    userId: String(scope.userId),
    deviceId: String(scope.deviceId),
    membershipEpoch: scope.membershipEpoch,
    challengeId: null,
    deviceKeyId: null,
    publicKeySpkiDer: null,
    challengeExpiresAt: null,
    activatedAt: null,
    ...details,
  });
}

export class CoworkDeviceEnrollmentModel {
  readonly #scope: CoworkDeviceEnrollmentScope;
  readonly #client: CoworkDeviceEnrollmentClient;
  readonly #signer: CoworkDeviceEnrollmentSigner;
  readonly #beginEnrollment: CoworkDeviceEnrollmentClient["beginEnrollment"];
  readonly #completeEnrollment: CoworkDeviceEnrollmentClient["completeEnrollment"];
  readonly #getPublicIdentity: CoworkDeviceEnrollmentSigner["getPublicIdentity"];
  readonly #signEnrollmentProof: CoworkDeviceEnrollmentSigner["signEnrollmentProof"];
  #state: CoworkDeviceEnrollmentState;
  #active: ActiveScope | null = null;
  #generation = 0;
  #working = false;
  #beginAttempt: BeginAttempt | null = null;
  #enrollment: EnrollmentSecret | null = null;
  #completeAttempt: CompleteAttempt | null = null;
  #listeners = new Set<() => void>();

  constructor(
    client: CoworkDeviceEnrollmentClient,
    signer: CoworkDeviceEnrollmentSigner,
    scope: CoworkDeviceEnrollmentScope,
  ) {
    assertPlainData(scope, "enrollment scope");
    this.#scope = Object.freeze({ ...decodeScope(scope, strictOptions) });
    this.#client = client;
    this.#signer = signer;
    this.#beginEnrollment = client.beginEnrollment;
    this.#completeEnrollment = client.completeEnrollment;
    this.#getPublicIdentity = signer.getPublicIdentity;
    this.#signEnrollmentProof = signer.signEnrollmentProof;
    if (
      typeof this.#beginEnrollment !== "function" ||
      typeof this.#completeEnrollment !== "function" ||
      typeof this.#getPublicIdentity !== "function" ||
      typeof this.#signEnrollmentProof !== "function"
    ) {
      throw new Error("device enrollment adapters must expose callable exact capabilities");
    }
    this.#state = stateFor(this.#scope, "idle");
  }

  readonly getSnapshot = (): CoworkDeviceEnrollmentState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  start(): void {
    this.stop();
    this.#active = { generation: ++this.#generation, closed: false };
    this.#setState(stateFor(this.#scope, "idle"));
  }

  stop(): void {
    if (this.#active) this.#active.closed = true;
    this.#active = null;
    this.#working = false;
    this.#clearSecrets();
  }

  enroll(createCommandId: () => string): void {
    const active = this.#active;
    if (!active || active.closed || this.#working || this.#state.status === "lost-nonce") return;
    if (this.#state.status === "retry-begin" && this.#beginAttempt) {
      void this.#begin(active, this.#beginAttempt, createCommandId);
      return;
    }
    if (this.#state.status === "retry-sign" && this.#enrollment) {
      void this.#sign(active, this.#enrollment, createCommandId);
      return;
    }
    if (this.#state.status === "retry-complete" && this.#completeAttempt) {
      void this.#complete(active, this.#completeAttempt);
      return;
    }
    if (
      this.#state.status !== "idle" &&
      this.#state.status !== "prepare-failed" &&
      this.#state.status !== "activated"
    )
      return;
    this.#clearSecrets();
    void this.#prepare(active, createCommandId);
  }

  discardAndRestart(): void {
    if (!this.#active || this.#working) return;
    if (
      this.#state.status !== "lost-nonce" &&
      this.#state.status !== "retry-begin" &&
      this.#state.status !== "retry-sign" &&
      this.#state.status !== "retry-complete"
    ) {
      return;
    }
    this.#clearSecrets();
    this.#setState(stateFor(this.#scope, "idle"));
  }

  async #prepare(active: ActiveScope, createCommandId: () => string): Promise<void> {
    if (!this.#isActive(active)) return;
    this.#working = true;
    this.#setState(stateFor(this.#scope, "reading-signer"));
    if (!this.#isActive(active)) return;
    try {
      const identity = decodeSignerIdentity(
        await Reflect.apply(this.#getPublicIdentity, this.#signer, []),
      );
      if (!this.#isActive(active)) return;
      if (!sameScope(identity, this.#scope)) throw new Error("signer identity scope mismatch");
      const commandId = decodeCommandId(createCommandId(), strictOptions);
      if (!this.#isActive(active)) return;
      const request = Object.freeze(
        decodeBeginRequest(
          {
            commandId,
            sharedProjectId: this.#scope.sharedProjectId,
            publicKeySpkiDer: identity.publicKeySpkiDer,
          },
          strictOptions,
        ),
      );
      const attempt = Object.freeze({ identity: Object.freeze({ ...identity }), request });
      this.#beginAttempt = attempt;
      this.#working = false;
      await this.#begin(active, attempt, createCommandId);
    } catch {
      if (!this.#isActive(active)) return;
      this.#working = false;
      this.#clearSecrets();
      this.#setState(stateFor(this.#scope, "prepare-failed"));
    }
  }

  async #begin(
    active: ActiveScope,
    attempt: BeginAttempt,
    createCommandId: () => string,
  ): Promise<void> {
    if (this.#working || !this.#isCurrent(active, attempt)) return;
    this.#working = true;
    this.#setState(
      stateFor(this.#scope, "beginning", { publicKeySpkiDer: attempt.identity.publicKeySpkiDer }),
    );
    if (!this.#isCurrent(active, attempt)) return;
    try {
      const result = decodeBeginResult(
        await Reflect.apply(this.#beginEnrollment, this.#client, [attempt.request]),
      );
      if (!this.#isCurrent(active, attempt)) return;
      const challenge = result.challenge;
      if (
        challenge.sharedProjectId !== this.#scope.sharedProjectId ||
        challenge.userId !== this.#scope.userId ||
        challenge.deviceId !== this.#scope.deviceId ||
        challenge.membershipEpoch !== this.#scope.membershipEpoch ||
        challenge.publicKeySpkiDer !== attempt.identity.publicKeySpkiDer ||
        DateTime.toEpochMillis(challenge.expiresAt) - DateTime.toEpochMillis(challenge.issuedAt) !==
          COLLABORATION_DEVICE_CHALLENGE_LIFETIME_MILLIS
      ) {
        throw new Error("begin response scope mismatch");
      }
      validatePublicKey(challenge.publicKeySpkiDer);
      if (result.disposition === "already-applied") {
        if (result.nonce !== null) throw new Error("a replay must not recover a nonce");
        this.#beginAttempt = null;
        this.#working = false;
        this.#setState(
          stateFor(this.#scope, "lost-nonce", {
            challengeId: challenge.challengeId,
            deviceKeyId: challenge.deviceKeyId,
            publicKeySpkiDer: challenge.publicKeySpkiDer,
            challengeExpiresAt: timestamp(challenge.expiresAt),
          }),
        );
        return;
      }
      if (result.nonce === null) throw new Error("a new challenge requires its one-time nonce");
      this.#beginAttempt = null;
      this.#working = false;
      const secret = Object.freeze({
        challenge: immutableChallenge(challenge),
        nonce: result.nonce,
      });
      this.#enrollment = secret;
      await this.#sign(active, secret, createCommandId);
    } catch {
      if (!this.#isActive(active)) return;
      this.#working = false;
      this.#enrollment = null;
      this.#completeAttempt = null;
      this.#setState(
        stateFor(this.#scope, "retry-begin", {
          publicKeySpkiDer: attempt.identity.publicKeySpkiDer,
        }),
      );
    }
  }

  async #sign(
    active: ActiveScope,
    secret: EnrollmentSecret,
    createCommandId: () => string,
  ): Promise<void> {
    if (this.#working || !this.#isActive(active) || this.#enrollment !== secret) return;
    this.#working = true;
    this.#setState(
      stateFor(this.#scope, "signing", {
        challengeId: secret.challenge.challengeId,
        deviceKeyId: secret.challenge.deviceKeyId,
        publicKeySpkiDer: secret.challenge.publicKeySpkiDer,
        challengeExpiresAt: timestamp(secret.challenge.expiresAt),
      }),
    );
    if (!this.#isActive(active) || this.#enrollment !== secret) return;
    try {
      const proofSignature = decodeSignature(
        await Reflect.apply(this.#signEnrollmentProof, this.#signer, [
          secret.challenge,
          secret.nonce,
        ]),
        strictOptions,
      );
      const signatureBytes = decodeBase64Url(proofSignature);
      if (signatureBytes?.length !== 64) throw new Error("signer proof is not canonical");
      if (!this.#isActive(active) || this.#enrollment !== secret) return;
      const commandId = decodeCommandId(createCommandId(), strictOptions);
      if (!this.#isActive(active) || this.#enrollment !== secret) return;
      const request = Object.freeze(
        decodeCompleteRequest(
          {
            commandId,
            sharedProjectId: this.#scope.sharedProjectId,
            challengeId: secret.challenge.challengeId,
            nonce: secret.nonce,
            proofSignature,
          },
          strictOptions,
        ),
      );
      const attempt = Object.freeze({ challenge: secret.challenge, request });
      this.#enrollment = null;
      this.#completeAttempt = attempt;
      this.#working = false;
      await this.#complete(active, attempt);
    } catch {
      if (!this.#isActive(active) || this.#enrollment !== secret) return;
      this.#working = false;
      this.#setState(
        stateFor(this.#scope, "retry-sign", {
          challengeId: secret.challenge.challengeId,
          deviceKeyId: secret.challenge.deviceKeyId,
          publicKeySpkiDer: secret.challenge.publicKeySpkiDer,
          challengeExpiresAt: timestamp(secret.challenge.expiresAt),
        }),
      );
    }
  }

  async #complete(active: ActiveScope, attempt: CompleteAttempt): Promise<void> {
    if (this.#working || !this.#isActive(active) || this.#completeAttempt !== attempt) return;
    this.#working = true;
    this.#setState(
      stateFor(this.#scope, "completing", {
        challengeId: attempt.challenge.challengeId,
        deviceKeyId: attempt.challenge.deviceKeyId,
        publicKeySpkiDer: attempt.challenge.publicKeySpkiDer,
        challengeExpiresAt: timestamp(attempt.challenge.expiresAt),
      }),
    );
    if (!this.#isActive(active) || this.#completeAttempt !== attempt) return;
    try {
      const result = decodeMutationResult(
        await Reflect.apply(this.#completeEnrollment, this.#client, [attempt.request]),
      );
      if (!this.#isActive(active) || this.#completeAttempt !== attempt) return;
      const key = result.key;
      const activatedAt = DateTime.toEpochMillis(key.activatedAt);
      if (
        result.disposition === "revoked" ||
        key.sharedProjectId !== this.#scope.sharedProjectId ||
        key.userId !== this.#scope.userId ||
        key.deviceId !== this.#scope.deviceId ||
        key.membershipEpoch !== this.#scope.membershipEpoch ||
        key.deviceKeyId !== attempt.challenge.deviceKeyId ||
        key.publicKeySpkiDer !== attempt.challenge.publicKeySpkiDer ||
        key.revokedAt !== null ||
        activatedAt < DateTime.toEpochMillis(attempt.challenge.issuedAt) ||
        activatedAt >= DateTime.toEpochMillis(attempt.challenge.expiresAt)
      ) {
        throw new Error("complete response did not bind the exact challenge authority");
      }
      this.#working = false;
      this.#clearSecrets();
      this.#setState(
        stateFor(this.#scope, "activated", {
          deviceKeyId: key.deviceKeyId,
          publicKeySpkiDer: key.publicKeySpkiDer,
          activatedAt: timestamp(key.activatedAt),
        }),
      );
    } catch {
      if (!this.#isActive(active) || this.#completeAttempt !== attempt) return;
      this.#working = false;
      this.#setState(
        stateFor(this.#scope, "retry-complete", {
          challengeId: attempt.challenge.challengeId,
          deviceKeyId: attempt.challenge.deviceKeyId,
          publicKeySpkiDer: attempt.challenge.publicKeySpkiDer,
          challengeExpiresAt: timestamp(attempt.challenge.expiresAt),
        }),
      );
    }
  }

  #isActive(active: ActiveScope): boolean {
    return !active.closed && this.#active === active && active.generation === this.#generation;
  }

  #isCurrent(active: ActiveScope, attempt: BeginAttempt): boolean {
    return this.#isActive(active) && this.#beginAttempt === attempt;
  }

  #clearSecrets(): void {
    this.#beginAttempt = null;
    this.#enrollment = null;
    this.#completeAttempt = null;
  }

  #setState(state: CoworkDeviceEnrollmentState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // One observer must not prevent security-boundary cleanup or other observers.
      }
    }
  }
}
