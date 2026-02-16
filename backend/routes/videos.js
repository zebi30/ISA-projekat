const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");

const pool = require("../pool");
const { upload, TMP_DIR } = require("../middlewares/upload");
const requestTimeout = require("../middlewares/requestTimeout");

const auth = require("../middlewares/auth"); 
const mapTileCache = require("../services/mapTileCache");
const { enqueueTranscodeJob } = require("../services/transcodeQueue");

const router = express.Router();

const VIDEOS_DIR = path.join(__dirname, "..", "uploads", "videos");
const THUMBS_DIR = path.join(__dirname, "..", "uploads", "thumbs");
const TRANSCODED_DIR = path.join(__dirname, "..", "uploads", "transcoded");

fs.ensureDirSync(VIDEOS_DIR);
fs.ensureDirSync(THUMBS_DIR);
fs.ensureDirSync(TRANSCODED_DIR);

const TRANSCODE_PROFILES = [
  { label: "480p", width: 854, height: 480, videoBitrate: "1000k", audioBitrate: "128k" },
  { label: "720p", width: 1280, height: 720, videoBitrate: "2500k", audioBitrate: "128k" },
];

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

function parseScheduleAt(raw, rawEpochMs) {
  if (!raw && !rawEpochMs) return null;

  let parsed;
  if (rawEpochMs !== undefined && rawEpochMs !== null && String(rawEpochMs).trim() !== '') {
    const epochMs = Number(rawEpochMs);
    if (!Number.isFinite(epochMs)) {
      const err = new Error("Zakazani datum/vreme nije validan.");
      err.status = 400;
      throw err;
    }
    parsed = new Date(epochMs);
  } else {
    parsed = new Date(raw);
  }

  if (Number.isNaN(parsed.getTime())) {
    const err = new Error("Zakazani datum/vreme nije validan.");
    err.status = 400;
    throw err;
  }

  const now = new Date();
  now.setSeconds(0, 0);
  const minAllowed = new Date(now.getTime() + 60 * 1000);

  if (parsed.getTime() < minAllowed.getTime()) {
    const err = new Error("Zakazani datum/vreme mora biti najmanje 1 minut u budućnosti.");
    err.status = 400;
    throw err;
  }

  return parsed;
}

function getTileKeyFromLatLng(lat, lng, tileSize = 0.1) {
  const tileX = Math.floor(lng / tileSize);
  const tileY = Math.floor(lat / tileSize);
  return `tile_${tileX}_${tileY}`;
}

function getSynchronizedOffsetSeconds(videoRow) {
  if (!videoRow?.schedule_at) return 0;

  const scheduleTimestamp = new Date(videoRow.schedule_at).getTime();
  if (Number.isNaN(scheduleTimestamp)) return 0;

  return Math.max(0, Math.floor((Date.now() - scheduleTimestamp) / 1000));
}

function buildScheduleLockPayload(scheduleAt) {
  const releaseTime = new Date(scheduleAt).getTime();
  const now = Date.now();
  return {
    message: "Video je zakazan i još nije dostupan.",
    schedule_at: scheduleAt,
    available_in_seconds: Math.ceil((releaseTime - now) / 1000),
  };
}

async function blockScheduledVideoAccess(req, res, next) {
  const videoId = Number(req.params.id);
  if (!videoId) return next();

  try {
    const result = await pool.query(
      'SELECT schedule_at FROM videos WHERE id = $1',
      [videoId]
    );

    if (result.rows.length === 0) return next();

    const scheduleAt = result.rows[0].schedule_at;
    if (!scheduleAt) return next();

    const releaseTime = new Date(scheduleAt).getTime();
    if (!Number.isNaN(releaseTime) && releaseTime > Date.now()) {
      return res.status(423).json(buildScheduleLockPayload(scheduleAt));
    }

    return next();
  } catch (error) {
    console.error('Schedule lock check failed:', error);
    return res.status(500).json({ message: 'Server error' });
  }
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
      const scheduleAt = parseScheduleAt(req.body.schedule_at, req.body.schedule_at_epoch_ms);

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
        `INSERT INTO videos (user_id, title, description, video_path, thumbnail, tags, location, schedule_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, created_at, schedule_at`,
        [
          req.user.id,
          title.trim(),
          description || null,
          null, // setovacemo posle move
          null,
          tags.length ? tags : null,
          locationObj,
          scheduleAt,
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
         SET video_path=$1,
             thumbnail=$2,
             transcode_status='pending',
             transcoded_outputs=NULL,
             transcode_error=NULL
         WHERE id=$3`,
        [relVideo, relThumb, videoId]
      );

      const transcodeJob = {
        jobId: uuidv4(),
        videoId,
        sourceReference: relVideo,
        sourcePath: movedVideoPath,
        outputDir: path.join(TRANSCODED_DIR, String(videoId)),
        profiles: TRANSCODE_PROFILES,
        requestedAt: new Date().toISOString(),
      };

      const enqueueResult = await enqueueTranscodeJob(transcodeJob);
      if (!enqueueResult.queued) {
        const err = new Error("Neuspesno slanje videa u transcoding queue.");
        err.status = 503;
        throw err;
      }

      await client.query("COMMIT");


      // INSTANT UPDATE: osvezi samo tile gde je dodat video (ako je tile vec u cache-u)
      try {
        const tileSize = 0.1;
        const lat = Number(locationObj?.latitude);
        const lng = Number(locationObj?.longitude);
        const isVisibleNow = !insert.rows[0].schedule_at || new Date(insert.rows[0].schedule_at) <= new Date();

        if (isVisibleNow && !Number.isNaN(lat) && !Number.isNaN(lng)) {
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
        schedule_at: insert.rows[0].schedule_at,
        video_path: relVideo,
        thumbnail: relThumb,
        transcode_status: "pending",
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
router.get("/:id", blockScheduledVideoAccess, async (req, res) => {
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

    const row = r.rows[0];
    if (row.schedule_at) {
      const releaseTime = new Date(row.schedule_at).getTime();
      const now = Date.now();
      if (!Number.isNaN(releaseTime) && releaseTime > now) {
        return res.status(423).json({
          message: "Video je zakazan i još nije dostupan.",
          schedule_at: row.schedule_at,
          available_in_seconds: Math.ceil((releaseTime - now) / 1000),
        });
      }
    }

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/videos/:id/watch  (public) - uveca views i vraca video
router.post("/:id/watch", blockScheduledVideoAccess, async (req, res) => {
  const videoId = Number(req.params.id);
  if (!videoId) return res.status(400).json({ message: "Invalid video id" });

  try {
    const videoResult = await pool.query(
      `
      SELECT v.*, u.username, u.first_name, u.last_name
      FROM videos v
      JOIN users u ON u.id = v.user_id
      WHERE v.id = $1
      `,
      [videoId]
    );

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ message: "Video not found" });
    }

    const row = videoResult.rows[0];
    if (row.schedule_at) {
      const releaseTime = new Date(row.schedule_at).getTime();
      const now = Date.now();
      if (!Number.isNaN(releaseTime) && releaseTime > now) {
        return res.status(423).json({
          message: "Video je zakazan i još nije dostupan.",
          schedule_at: row.schedule_at,
          available_in_seconds: Math.ceil((releaseTime - now) / 1000),
        });
      }
    }

    const upd = await pool.query(
      `UPDATE videos
       SET views = views + 1
       WHERE id = $1
       RETURNING views`,
      [videoId]
    );
    row.views = upd.rows[0]?.views ?? row.views;

    res.json({
      ...row,
      playback_offset_seconds: getSynchronizedOffsetSeconds(row),
      stream_sync: Boolean(row.schedule_at),
      server_time: new Date().toISOString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Server error" });
  }
});


module.exports = router;
