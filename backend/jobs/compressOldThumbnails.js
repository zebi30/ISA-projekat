const path = require("path");
const fs = require("fs-extra");
const cron = require("node-cron");
const sharp = require("sharp");

const pool = require("../pool");

const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const THUMBS_DIR = path.join(UPLOADS_DIR, "thumbs");
const THUMBS_ORIGINALS_DIR = path.join(THUMBS_DIR, "originals");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFileLockError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    error?.code === "EBUSY" ||
    error?.code === "EPERM" ||
    msg.includes("ebusy") ||
    msg.includes("eperm") ||
    msg.includes("unknown: unknown error, open")
  );
}

function getCompressionConfig(ext) {
  const lowered = ext.toLowerCase();

  if (lowered === ".jpg" || lowered === ".jpeg") {
    return { format: "jpeg", options: { quality: 70, mozjpeg: true } };
  }

  if (lowered === ".png") {
    return { format: "png", options: { quality: 70, compressionLevel: 9, palette: true } };
  }

  if (lowered === ".webp") {
    return { format: "webp", options: { quality: 70 } };
  }

  return null;
}

function resolveAbsoluteThumbnailPath(relativePath) {
  if (!relativePath) return null;

  const normalizedInput = String(relativePath).replaceAll("\\", "/");

  if (normalizedInput.startsWith("/uploads/")) {
    return path.join(__dirname, "..", normalizedInput.slice(1).replaceAll("/", path.sep));
  }

  if (path.isAbsolute(relativePath)) return relativePath;

  const normalized = relativePath.startsWith("/")
    ? relativePath.slice(1)
    : relativePath;

  return path.join(__dirname, "..", normalized.replaceAll("/", path.sep));
}

async function compressThumbnailIfNeeded(absoluteThumbnailPath) {
  const fileName = path.basename(absoluteThumbnailPath);
  const backupPath = path.join(THUMBS_ORIGINALS_DIR, fileName);

  if (!(await fs.pathExists(absoluteThumbnailPath))) {
    return { status: "missing" };
  }

  const compressionConfig = getCompressionConfig(path.extname(absoluteThumbnailPath));
  if (!compressionConfig) {
    return { status: "unsupported" };
  }

  if (await fs.pathExists(backupPath)) {
    return { status: "already-compressed" };
  }

  await fs.ensureDir(THUMBS_ORIGINALS_DIR);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const tempOutputPath = `${absoluteThumbnailPath}.tmp-${Date.now()}-${attempt}`;

    try {
      await fs.copy(absoluteThumbnailPath, backupPath, { overwrite: false, errorOnExist: false });

      const image = sharp(absoluteThumbnailPath);
      const outputBuffer = await image
        .toFormat(compressionConfig.format, compressionConfig.options)
        .toBuffer();

      await fs.writeFile(tempOutputPath, outputBuffer);
      await fs.move(tempOutputPath, absoluteThumbnailPath, { overwrite: true });

      return { status: "compressed" };
    } catch (error) {
      try {
        if (await fs.pathExists(tempOutputPath)) {
          await fs.remove(tempOutputPath);
        }
      } catch (_) {}

      if (attempt < maxAttempts && isTransientFileLockError(error)) {
        await sleep(250 * attempt);
        continue;
      }

      throw error;
    }
  }

  return { status: "failed" };
}

async function compressOldThumbnails({ olderThanDays = 30 } = {}) {
  const result = await pool.query(
    `SELECT id, thumbnail, created_at
     FROM videos
     WHERE created_at < NOW() - ($1::text || ' days')::interval
       AND thumbnail IS NOT NULL
     ORDER BY created_at ASC`,
    [String(olderThanDays)]
  );

  const stats = {
    candidates: result.rows.length,
    compressed: 0,
    alreadyCompressed: 0,
    missing: 0,
    unsupported: 0,
    failed: 0,
  };

  for (const row of result.rows) {
    const absolutePath = resolveAbsoluteThumbnailPath(row.thumbnail);

    try {
      const compressionResult = await compressThumbnailIfNeeded(absolutePath);
      if (compressionResult.status === "compressed") stats.compressed += 1;
      else if (compressionResult.status === "already-compressed") stats.alreadyCompressed += 1;
      else if (compressionResult.status === "missing") stats.missing += 1;
      else if (compressionResult.status === "unsupported") stats.unsupported += 1;
    } catch (error) {
      stats.failed += 1;
      console.error(`[IMG-COMPRESS] videoId=${row.id} failed:`, error.message);
    }
  }

  console.log(
    `[IMG-COMPRESS] candidates=${stats.candidates}, compressed=${stats.compressed}, ` +
      `alreadyCompressed=${stats.alreadyCompressed}, missing=${stats.missing}, ` +
      `unsupported=${stats.unsupported}, failed=${stats.failed}`
  );

  return stats;
}

function startNightlyThumbnailCompression() {
  cron.schedule("15 4 * * *", async () => {
    try {
      console.log("[IMG-COMPRESS] starting nightly job...");
      await compressOldThumbnails({ olderThanDays: 30 });
      console.log("[IMG-COMPRESS] nightly job done.");
    } catch (error) {
      console.error("[IMG-COMPRESS] nightly job failed:", error.message);
    }
  });
}

module.exports = {
  compressOldThumbnails,
  startNightlyThumbnailCompression,
};
