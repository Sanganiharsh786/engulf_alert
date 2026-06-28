// Authentication: fixed accounts defined in the APP_USERS env var, plus a
// signed session token stored in an HttpOnly cookie.
//
//   APP_USERS="harsh:pass1,friend:pass2"
//
// Uses Web Crypto (available in both the Node and Edge runtimes) so this file
// can be imported from API routes AND middleware. Do NOT import next/headers
// or any node-only module here.

export const SESSION_COOKIE = "ea_session";
const DEFAULT_USERS = "admin:admin"; // local-dev fallback only
const enc = new TextEncoder();

function parseUsers() {
  const raw = process.env.APP_USERS || DEFAULT_USERS;
  const map = {};
  for (const part of raw.split(",")) {
    const i = part.indexOf(":");
    if (i === -1) continue;
    const u = part.slice(0, i).trim();
    const p = part.slice(i + 1).trim();
    if (u) map[u] = p;
  }
  return map;
}

export function listUsers() {
  return Object.keys(parseUsers());
}

// The first user in APP_USERS owns the pre-existing data (BTC/ETH/PAXG levels).
export function ownerUser() {
  return listUsers()[0] || null;
}

export function verifyCredentials(username, password) {
  const users = parseUsers();
  return Boolean(
    username && users[username] !== undefined && users[username] === password
  );
}

/* ---------- signed session tokens ---------- */

function b64url(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmac(data) {
  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64url(sig);
}

export async function createSession(username, days = 30) {
  const payload = { u: username, exp: Date.now() + days * 86400000 };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

export async function verifySession(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sig !== (await hmac(body))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if (!payload.exp || Date.now() > payload.exp) return null;
    if (!listUsers().includes(payload.u)) return null; // user removed
    return payload.u;
  } catch {
    return null;
  }
}
