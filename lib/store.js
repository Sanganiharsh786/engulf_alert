import { promises as fs } from "fs";
import path from "path";
import { ownerUser } from "./auth.js";

const DATA_DIR = path.join(process.cwd(), "data");
const SEED_PATH = path.join(DATA_DIR, "store.json");
const KV_PREFIX = "engulfing:store:";

function hasKV() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

let redisClient = null;
async function getRedis() {
  if (!redisClient) {
    const { Redis } = await import("@upstash/redis");
    redisClient = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redisClient;
}

function safeName(user) {
  return String(user).replace(/[^a-zA-Z0-9_-]/g, "_");
}
function userFilePath(user) {
  return path.join(DATA_DIR, `store.${safeName(user)}.json`);
}

// A fresh, empty board for a brand-new user.
export function defaultStore() {
  return {
    settings: {
      timeframe: "15m",
      touchMode: "range",
      pollIntervalSeconds: 60,
      email: {
        smtpServer: "smtp.gmail.com",
        smtpPort: 587,
        sender: "",
        password: "",
        recipients: [],
      },
    },
    pairs: [],
    alertedKeys: [],
  };
}

// First-time data for a user: the owner inherits the bundled store.json
// (the existing BTC/ETH/PAXG levels); everyone else starts empty.
async function seedStore(user) {
  if (user === ownerUser()) {
    try {
      const s = JSON.parse(await fs.readFile(SEED_PATH, "utf8"));
      if (!Array.isArray(s.alertedKeys)) s.alertedKeys = [];
      return s;
    } catch {
      /* fall through to empty */
    }
  }
  return defaultStore();
}

export async function readStore(user) {
  if (!user) throw new Error("readStore requires a user");
  let store;
  if (hasKV()) {
    const redis = await getRedis();
    store = await redis.get(KV_PREFIX + user);
    if (!store) {
      store = await seedStore(user);
      await redis.set(KV_PREFIX + user, store);
    }
  } else {
    try {
      store = JSON.parse(await fs.readFile(userFilePath(user), "utf8"));
    } catch {
      store = await seedStore(user);
    }
  }
  if (!Array.isArray(store.alertedKeys)) store.alertedKeys = [];
  return store;
}

export async function writeStore(user, store) {
  if (!user) throw new Error("writeStore requires a user");
  if (hasKV()) {
    const redis = await getRedis();
    await redis.set(KV_PREFIX + user, store);
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(userFilePath(user), JSON.stringify(store, null, 2));
}
