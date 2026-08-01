import { createPublicKey, verify } from "node:crypto";
import { Buffer } from "node:buffer";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_SPKI_BYTES = ED25519_SPKI_PREFIX.byteLength + 32;
const ED25519_SIGNATURE_BYTES = 64;

const FIELD_MODULUS = (1n << 255n) - 19n;
const GROUP_ORDER = (1n << 252n) + 27742317777372353535851937790883648493n;

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

type ExtendedPoint = {
  readonly x: bigint;
  readonly y: bigint;
  readonly z: bigint;
  readonly t: bigint;
};

const IDENTITY: ExtendedPoint = { x: 0n, y: 1n, z: 1n, t: 0n };

function addPoints(left: ExtendedPoint, right: ExtendedPoint): ExtendedPoint {
  const a = mod((left.y - left.x) * (right.y - right.x));
  const b = mod((left.y + left.x) * (right.y + right.x));
  const c = mod(2n * EDWARDS_D * left.t * right.t);
  const d = mod(2n * left.z * right.z);
  const e = mod(b - a);
  const f = mod(d - c);
  const g = mod(d + c);
  const h = mod(b + a);
  return {
    x: mod(e * f),
    y: mod(g * h),
    z: mod(f * g),
    t: mod(e * h),
  };
}

function doublePoint(point: ExtendedPoint): ExtendedPoint {
  const a = mod(point.x * point.x);
  const b = mod(point.y * point.y);
  const c = mod(2n * point.z * point.z);
  const d = mod(-a);
  const e = mod((point.x + point.y) * (point.x + point.y) - a - b);
  const g = mod(d + b);
  const f = mod(g - c);
  const h = mod(d - b);
  return {
    x: mod(e * f),
    y: mod(g * h),
    z: mod(f * g),
    t: mod(e * h),
  };
}

function multiplyPoint(point: ExtendedPoint, scalar: bigint): ExtendedPoint {
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
  let value = 0n;
  for (let index = bytes.byteLength - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]!);
  }
  return value;
}

/**
 * Decodes an Ed25519 compressed point and requires the non-identity prime-order subgroup.
 *
 * OpenSSL versions used by supported Node runtimes can accept forged signatures for low-order
 * public keys (including the encoded identity). A DER round trip and
 * `asymmetricKeyType === "ed25519"` therefore do not prove that a key is safe for author
 * authentication. Enrollment and event admission must both pass this check before asking OpenSSL
 * to verify a signature.
 */
function isPrimeSubgroupEd25519Point(encodedPoint: Uint8Array): boolean {
  if (encodedPoint.byteLength !== 32) return false;
  const bytes = Buffer.from(encodedPoint);
  const xParity = bytes[31]! >>> 7;
  bytes[31] = bytes[31]! & 0x7f;
  const y = littleEndianInteger(bytes);
  if (y >= FIELD_MODULUS) return false;

  const ySquared = mod(y * y);
  const numerator = mod(ySquared - 1n);
  const denominator = mod(EDWARDS_D * ySquared + 1n);
  if (denominator === 0n) return false;
  const xSquared = mod(numerator * powMod(denominator, FIELD_MODULUS - 2n));
  let x = powMod(xSquared, (FIELD_MODULUS + 3n) / 8n);
  if (mod(x * x) !== xSquared) x = mod(x * SQRT_MINUS_ONE);
  if (mod(x * x) !== xSquared) return false;
  if (Number(x & 1n) !== xParity) x = mod(-x);
  // RFC 8032 forbids the non-canonical negative-zero encoding.
  if (x === 0n && xParity !== 0) return false;

  const point = { x, y, z: 1n, t: mod(x * y) } satisfies ExtendedPoint;
  if (point.x === 0n && point.y === point.z) return false;
  const multiplied = multiplyPoint(point, GROUP_ORDER);
  return multiplied.x === 0n && multiplied.y === multiplied.z;
}

export function canonicalEd25519PublicKeySpkiDerBytes(value: Uint8Array): Buffer | null {
  if (!(value instanceof Uint8Array) || value.byteLength !== ED25519_SPKI_BYTES) return null;
  const bytes = Buffer.from(value);
  if (!bytes.subarray(0, ED25519_SPKI_PREFIX.byteLength).equals(ED25519_SPKI_PREFIX)) return null;
  if (!isPrimeSubgroupEd25519Point(bytes.subarray(ED25519_SPKI_PREFIX.byteLength))) return null;
  try {
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") return null;
    const canonical = key.export({ format: "der", type: "spki" });
    return canonical.equals(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export function canonicalEd25519PublicKeySpkiDer(encoded: string): Buffer | null {
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) return null;
    return canonicalEd25519PublicKeySpkiDerBytes(bytes);
  } catch {
    return null;
  }
}

export function verifyStrictEd25519Signature(input: {
  readonly publicKeySpkiDer: Uint8Array;
  readonly signature: Uint8Array;
  readonly signedBytes: Uint8Array;
}): boolean {
  const publicKeySpkiDer = canonicalEd25519PublicKeySpkiDerBytes(input.publicKeySpkiDer);
  if (publicKeySpkiDer === null || input.signature.byteLength !== ED25519_SIGNATURE_BYTES) {
    return false;
  }
  try {
    const publicKey = createPublicKey({ key: publicKeySpkiDer, format: "der", type: "spki" });
    return verify(null, input.signedBytes, publicKey, input.signature);
  } catch {
    return false;
  }
}
