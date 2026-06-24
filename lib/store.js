import { promises as fs } from "fs";
import path from "path";

const STORE_PATH = path.join(process.cwd(), "data", "store.json");
const KV_KEY = "engulfing:store";

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

async function readFileStore() {
  const raw = await fs.readFile(STORE_PATH, "utf8");
  return JSON.parse(raw);
}

export async function readStore() {
  let store;
  if (hasKV()) {
    const redis = await getRedis();
    store = await redis.get(KV_KEY);
    if (!store) {
      // first run on Vercel: seed KV from the bundled JSON file
      store = await readFileStore();
      await redis.set(KV_KEY, store);
    }
  } else {
    store = await readFileStore();
  }
  if (!Array.isArray(store.alertedKeys)) store.alertedKeys = [];
  return store;
}

export async function writeStore(store) {
  if (hasKV()) {
    const redis = await getRedis();
    await redis.set(KV_KEY, store);
    return;
  }
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}
