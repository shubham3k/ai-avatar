import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../../config/env.js";

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  userId: string;
  nonce: string;
  exp: number;
}

function getSecret(): string {
  const secret = env.ENCRYPTION_KEY ?? env.GOOGLE_CLIENT_SECRET;
  if (!secret) {
    throw new Error(
      "Cannot sign OAuth state: set ENCRYPTION_KEY (preferred) or GOOGLE_CLIENT_SECRET.",
    );
  }
  return secret;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

/** Signs a userId into an opaque, tamper-evident state token for the OAuth redirect round-trip. */
export function createOAuthState(userId: string): string {
  const payload: StatePayload = {
    userId,
    nonce: randomBytes(12).toString("base64url"),
    exp: Date.now() + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = sign(body);
  return `${body}.${signature}`;
}

/** Verifies a state token produced by createOAuthState and returns the embedded userId. */
export function verifyOAuthState(state: string): string {
  const [body, signature] = state.split(".");
  if (!body || !signature) {
    throw new Error("Malformed OAuth state.");
  }

  const expectedSignature = sign(body);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new Error("OAuth state signature is invalid.");
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as StatePayload;
  } catch {
    throw new Error("OAuth state payload is invalid.");
  }

  if (typeof payload.userId !== "string" || !payload.userId) {
    throw new Error("OAuth state is missing a user id.");
  }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    throw new Error("OAuth state has expired. Please try connecting again.");
  }

  return payload.userId;
}
