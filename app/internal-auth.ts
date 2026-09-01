import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const SESSION_COOKIE = "trp_internal_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const encoder = new TextEncoder();

function getPassword() {
  return process.env.TRP_INTERNAL_PASSWORD ?? "";
}

function trustsCloudflareAccess() {
  return process.env.TRUST_CLOUDFLARE_ACCESS === "true";
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomSessionId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(value: string) {
  const password = getPassword();
  if (!password) {
    throw new Error("Internal password is not configured.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function verifyToken(token: string | undefined) {
  if (!token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  const [createdAt, sessionId, signature] = parts;
  const createdAtMs = Number(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  const age = Date.now() - createdAtMs;
  if (age < 0 || age > SESSION_MAX_AGE_SECONDS * 1000) {
    return false;
  }

  const expected = await sign(`${createdAt}.${sessionId}`);
  return expected === signature;
}

function readCookie(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function cookieAttributes(maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function assertPasswordConfigured() {
  if (!getPassword()) {
    throw new Error("Internal password is not configured.");
  }
}

export async function createInternalSessionCookie() {
  const payload = `${Date.now()}.${randomSessionId()}`;
  const signature = await sign(payload);
  return `${SESSION_COOKIE}=${payload}.${signature}; ${cookieAttributes(
    SESSION_MAX_AGE_SECONDS,
  )}`;
}

export function clearInternalSessionCookie() {
  return `${SESSION_COOKIE}=; ${cookieAttributes(0)}`;
}

export async function isValidInternalPassword(password: string) {
  const configuredPassword = getPassword();
  if (!configuredPassword) {
    throw new Error("Internal password is not configured.");
  }

  return password === configuredPassword;
}

export async function hasInternalSessionFromRequest(request: Request) {
  if (trustsCloudflareAccess()) {
    return true;
  }

  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return verifyToken(token);
}

export async function requireInternalSession(returnTo: string) {
  if (trustsCloudflareAccess()) {
    return;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (await verifyToken(token)) {
    return;
  }

  redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}
