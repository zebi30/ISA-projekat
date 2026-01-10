const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const pool = require("../pool");
const { getThumbnailBuffer } = require("../services/thumbnailCache");

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, "..");

router.get("/:videoId", async (req, res, next) => {
  try {
    const id = Number(req.params.videoId);
    if (!id) return res.status(400).json({ message: "Bad videoId" });

    const q = await pool.query("SELECT thumbnail FROM videos WHERE id=$1", [id]);
    if (q.rowCount === 0 || !q.rows[0].thumbnail) return res.sendStatus(404);

    // thumbnail je relativna putanja tipa "/uploads/thumbs/12.png"
    const rel = q.rows[0].thumbnail;
    const abs = path.join(UPLOADS_DIR, rel.startsWith("/") ? rel.slice(1) : rel);

    const exists = await fs.pathExists(abs);
    if (!exists) return res.sendStatus(404);

    const { buf, contentType } = await getThumbnailBuffer(abs);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=60"); // browser cache + server LRU
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
