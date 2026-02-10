// services/redisClient.js
const redis = require("redis");

let client = null;

async function getRedis() {   //vraca Redis klijenta, kreira ga ako ne postoji (singleton pattern)
  if (client) return client;

  client = redis.createClient({
    socket: { host: "localhost", port: 6379 }
  });

  client.on("error", (e) => console.warn("Redis error:", e.message));

  await client.connect();
  return client;
}

module.exports = { getRedis };
