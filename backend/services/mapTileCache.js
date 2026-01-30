// services/mapTileCache.js
const { getRedis } = require("./redisClient");

function key(tileSize, tileKey, period) {
  return `map:tile:${tileSize}:${tileKey}:${period}`;
}

async function getTile(tileSize, tileKey, period) {
  const r = await getRedis();
  const raw = await r.get(key(tileSize, tileKey, period));
  return raw ? JSON.parse(raw) : null;
}

async function setTile(tileSize, tileKey, period, data, ttlSeconds = 24 * 3600) {
  const r = await getRedis();
  // nocni rebuild = dovoljno 24h, a i “fail-safe” ako cron preskoci
  await r.setEx(key(tileSize, tileKey, period), ttlSeconds, JSON.stringify(data));
}

async function deleteTile(tileSize, tileKey, period) {
  const r = await getRedis();
  await r.del(key(tileSize, tileKey, period));
}

// “Instant update”: ako postoji u cache-u, ubaci novi video
async function upsertVideoIntoTile(tileSize, tileKey, period, video) {
  const existing = await getTile(tileSize, tileKey, period);
  if (!existing) return false;

  const arr = existing.videos || [];
  // izbegni duplikat
  if (!arr.some(v => v.id === video.id)) {
    arr.unshift(video); // najnoviji gore
    existing.videos = arr;
    existing.count = arr.length;
    await setTile(tileSize, tileKey, period, existing);
  }
  return true;
}

module.exports = {
  getTile, setTile, deleteTile, upsertVideoIntoTile
};
