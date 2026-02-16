// services/redisClient.js
const redis = require("redis");

let client = null;
let connecting = false;

async function getRedis() {   //vraca Redis klijenta, kreira ga ako ne postoji (singleton pattern)
  if (!client) {
    client = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || "localhost",
        port: Number(process.env.REDIS_PORT || 6379),
        reconnectStrategy: (retries) => Math.min(retries * 200, 2000),// malo backoff
      },
    });

    client.on("error", (e) => console.warn("Redis error:", e.message));
  }

  // ne blokiraj request: samo pokreni connect ako treba
  if (!client.isOpen && !connecting) {
    connecting = true;
    client.connect()
      .catch((e) => console.warn("Redis connect failed:", e.message))
      .finally(() => { connecting = false; });
  }

  return client;
}

module.exports = { getRedis };
