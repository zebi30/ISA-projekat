const express = require("express");
const path = require("path");
const fs = require("fs-extra");

const pool = require("../pool");
const { upload, TMP_DIR } = require("../middlewares/upload");
const requestTimeout = require("../middlewares/requestTimeout");

const auth = require("../middlewares/auth"); 
const mapTileCache = require("../services/mapTileCache");

const router = express.Router();

const VIDEOS_DIR = path.join(__dirname, "..", "uploads", "videos");
const THUMBS_DIR = path.join(__dirname, "..", "uploads", "thumbs");

fs.ensureDirSync(VIDEOS_DIR);
fs.ensureDirSync(THUMBS_DIR);

function parseTags(raw) {
  if (!raw) return [];
  // dozvoli JSON array ili "tag1,tag2"
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(t => String(t).trim()).filter(Boolean);
  } catch {}
  return String(raw)
    .split(",")
    .map(t => t.trim())
    .filter(Boolean);
}

function getTileKeyFromLatLng(lat, lng, tileSize = 0.1) {
  const tileX = Math.floor(lng / tileSize);
  const tileY = Math.floor(lat / tileSize);
  return `tile_${tileX}_${tileY}`;
}

router.post(
  "/",
  auth,
  requestTimeout(30000),
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  async (req, res, next) => {
    const client = await pool.connect();

    // fajlovi (temp)
    const videoFile = req.files?.video?.[0];
    const thumbFile = req.files?.thumbnail?.[0];

    // za cleanup u catch-u
    const toDelete = [];
    let movedVideoPath = null;
    let movedThumbPath = null;

    try {
      const { title, description, location } = req.body;
      const tags = parseTags(req.body.tags);

      if (!title?.trim()) {
        const err = new Error("Naslov je obavezan.");
        err.status = 400;
        throw err;
      }
      if (!videoFile) {
        const err = new Error("Video je obavezan (mp4, max 200MB).");
        err.status = 400;
        throw err;
      }
      if (!thumbFile) {
        const err = new Error("Thumbnail je obavezan.");
        err.status = 400;
        throw err;
      }

      // location JSON opcionalno
      let locationObj = null;
      if (location) {
        try {
          locationObj = JSON.parse(location);
        } catch {
          const err = new Error("Location mora biti validan JSON (ako se šalje).");
          err.status = 400;
          throw err;
        }
      }

      await client.query("BEGIN");

      // 1) prvo napravi row (sa placeholder putanjama)
      const insert = await client.query(
        `INSERT INTO videos (user_id, title, description, video_path, thumbnail, tags, location)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, created_at`,
        [
          req.user.id,
          title.trim(),
          description || null,
          null, // setovacemo posle move
          null,
          tags.length ? tags : null,
          locationObj,
        ]
      );

      const videoId = insert.rows[0].id;

      // 2) definisi final imena fajlova
      const videoExt = path.extname(videoFile.originalname).toLowerCase(); // .mp4
      const thumbExt = path.extname(thumbFile.originalname).toLowerCase(); // .jpg/.png...

      movedVideoPath = path.join(VIDEOS_DIR, `${videoId}${videoExt}`);
      movedThumbPath = path.join(THUMBS_DIR, `${videoId}${thumbExt}`);

      // 3) premesti iz tmp u final
      await fs.move(videoFile.path, movedVideoPath, { overwrite: true });
      await fs.move(thumbFile.path, movedThumbPath, { overwrite: true });

      toDelete.push(movedVideoPath, movedThumbPath);

      // 4) update row sa putanjama (cuvamo relativno, lepse)
      const relVideo = `/uploads/videos/${path.basename(movedVideoPath)}`;
      const relThumb = `/uploads/thumbs/${path.basename(movedThumbPath)}`;

      await client.query(
        `UPDATE videos
         SET video_path=$1, thumbnail=$2
         WHERE id=$3`,
        [relVideo, relThumb, videoId]
      );

      await client.query("COMMIT");


      // INSTANT UPDATE: osvezi samo tile gde je dodat video (ako je tile vec u cache-u)
      try {
        const tileSize = 0.1;
        const lat = Number(locationObj?.latitude);
        const lng = Number(locationObj?.longitude);

        if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
          const tileKey = getTileKeyFromLatLng(lat, lng, tileSize);

          const videoForMap = {
            id: videoId,
            title: title.trim(),
            location: locationObj,
            views: 0,
            created_at: insert.rows[0].created_at,
            username: null // (opciono) mozes iz DB da povuces username, ali nije obavezno
          };

          // ALL (uvek)
          await mapTileCache.upsertVideoIntoTile(tileSize, tileKey, "all", videoForMap);

          // ako koristis period filtere na mapi, može i ovo (ne smeta)
          await mapTileCache.upsertVideoIntoTile(tileSize, tileKey, "30d", videoForMap);
          await mapTileCache.upsertVideoIntoTile(tileSize, tileKey, "year", videoForMap);
        }
      } catch (e) {
        // ne rusi upload ako redis ne radi
        console.warn("[MAP TILE] instant update skipped:", e.message);
      }

      // uspeh: ne brisemo final fajlove
      toDelete.length = 0;

      res.status(201).json({
        id: videoId,
        title,
        description,
        tags,
        location: locationObj,
        created_at: insert.rows[0].created_at,
        video_path: relVideo,
        thumbnail: relThumb,
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      // cleanup temp fajlova ako postoje
      const maybeTemp = [videoFile?.path, thumbFile?.path].filter(Boolean);
      for (const p of maybeTemp) {
        try { await fs.remove(p); } catch {}
      }

      // cleanup final fajlova ako su vec premešteni
      for (const p of toDelete) {
        try { await fs.remove(p); } catch {}
      }

      next(err);
    } finally {
      client.release();
    }
  }
);

// GET /api/videos/:id  (public)
router.get("/:id", async (req, res) => {
  const videoId = Number(req.params.id);
  if (!videoId) return res.status(400).json({ message: "Invalid video id" });

  try {
    const q = `
      SELECT v.*,
             u.username, u.first_name, u.last_name
      FROM videos v
      JOIN users u ON u.id = v.user_id
      WHERE v.id = $1
    `;
    const r = await pool.query(q, [videoId]);
    if (r.rows.length === 0) return res.status(404).json({ message: "Video not found" });

    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/videos/:id/watch  (public) - uveca views i vraca video
router.post("/:id/watch", async (req, res) => {
  const videoId = Number(req.params.id);
  if (!videoId) return res.status(400).json({ message: "Invalid video id" });

  try {
    // 1 statement: atomic update 
    const q = `
      WITH upd AS (
        UPDATE videos
        SET views = views + 1
        WHERE id = $1
        RETURNING *
      )
      SELECT upd.*, u.username, u.first_name, u.last_name
      FROM upd
      JOIN users u ON u.id = upd.user_id
    `;

    const r = await pool.query(q, [videoId]);
    if (r.rows.length === 0) return res.status(404).json({ message: "Video not found" });

    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Server error" });
  }
});


module.exports = router;
