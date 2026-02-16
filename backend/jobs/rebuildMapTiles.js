// jobs/rebuildMapTiles.js
const cron = require("node-cron");
const pool = require("../pool");
const mapTileCache = require("../services/mapTileCache");

function getTileKeyFromLatLng(lat, lng, tileSize) {     //pravi tileKey na osnovu lat/lng i tileSize (npr. tile_10_20)
  const tileX = Math.floor(lng / tileSize);
  const tileY = Math.floor(lat / tileSize);
  return `tile_${tileX}_${tileY}`;
}

function periodFilter(period) {
  if (period === "30d") return `AND v.created_at >= NOW() - INTERVAL '30 days'`;
  if (period === "year") return `AND v.created_at >= date_trunc('year', NOW())`;
  return "";
}

async function rebuildAllTiles(tileSize = 0.1) {
  const periods = ["all", "30d", "year"];

  for (const period of periods) {
    const pf = periodFilter(period);

    // povuci sve videe (sa lokacijom) za taj period
    const r = await pool.query(
      `
      SELECT v.id, v.title, v.location, v.views, v.created_at, u.username
      FROM videos v
      LEFT JOIN users u ON v.user_id = u.id
      WHERE v.location IS NOT NULL
        AND (v.schedule_at IS NULL OR v.schedule_at <= NOW())
        ${pf}
      ORDER BY v.created_at DESC
      `
    );

    // grupisi po tile-u
    const groups = new Map();
    for (const v of r.rows) {
      const lat = Number(v.location?.latitude);
      const lng = Number(v.location?.longitude);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

      const tileKey = getTileKeyFromLatLng(lat, lng, tileSize);
      if (!groups.has(tileKey)) groups.set(tileKey, []);
      groups.get(tileKey).push(v);
    }

    // upisi svaki tile u redis
    for (const [tileKey, videos] of groups.entries()) {
      const payload = {
        tileKey,
        period,
        tileSize,
        videos,
        count: videos.length,
        rebuiltAt: new Date().toISOString()
      };
      await mapTileCache.setTile(tileSize, tileKey, period, payload, 24 * 3600);
    }

    console.log(`[MAP REBUILD] period=${period}, tiles=${groups.size}, videos=${r.rows.length}`);
  }
}

function startNightlyRebuild() {
  // npr. u 03:30 svaku noc
  cron.schedule("30 3 * * *", async () => {
    try {
      console.log("[MAP REBUILD] starting...");
      await rebuildAllTiles(0.1);             //popunjava redis za sutra
      console.log("[MAP REBUILD] done.");
    } catch (e) {
      console.error("[MAP REBUILD] failed:", e);
    }
  });
}

module.exports = { startNightlyRebuild, rebuildAllTiles };
