const path = require("path");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = require("../pool");
const { enqueueTranscodeJob } = require("../services/transcodeQueue");

const TRANSCODED_DIR = path.join(__dirname, "..", "uploads", "transcoded");

const TRANSCODE_PROFILES = [
  { label: "480p", width: 854, height: 480, videoBitrate: "1000k", audioBitrate: "128k" },
  { label: "720p", width: 1280, height: 720, videoBitrate: "2500k", audioBitrate: "128k" },
];

function toAbsoluteVideoPath(videoPath) {
  if (!videoPath) return null;

  if (path.isAbsolute(videoPath)) return videoPath;

  const normalized = videoPath.startsWith("/")
    ? videoPath.slice(1)
    : videoPath;

  return path.join(__dirname, "..", normalized.replaceAll("/", path.sep));
}

async function main() {
  const includeFailed = process.argv.includes("--include-failed");
  const demoFallback = process.argv.includes("--demo-fallback");
  const demoFallbackPath = path.join(__dirname, "test_video.mp4");

  const whereClause = includeFailed
    ? `transcode_status IN ('pending', 'failed')`
    : `transcode_status = 'pending'`;

  const result = await pool.query(
    `SELECT id, video_path, transcode_status
     FROM videos
     WHERE ${whereClause}
       AND video_path IS NOT NULL
     ORDER BY id ASC`
  );

  if (result.rows.length === 0) {
    console.log("Nema videa za requeue.");
    await pool.end();
    process.exit(0);
  }

  let queuedCount = 0;
  let duplicateCount = 0;
  let missingFileCount = 0;

  for (const row of result.rows) {
    let sourcePath = toAbsoluteVideoPath(row.video_path);

    if ((!sourcePath || !(await fs.pathExists(sourcePath))) && demoFallback && (await fs.pathExists(demoFallbackPath))) {
      sourcePath = demoFallbackPath;
      console.warn(`[FALLBACK] Video ${row.id} koristi demo input: ${demoFallbackPath}`);
    }

    if (!sourcePath || !(await fs.pathExists(sourcePath))) {
      missingFileCount += 1;
      console.warn(`[SKIP] Video ${row.id} - source file ne postoji: ${sourcePath}`);
      continue;
    }

    const job = {
      jobId: uuidv4(),
      videoId: row.id,
      sourceReference: row.video_path,
      sourcePath,
      outputDir: path.join(TRANSCODED_DIR, String(row.id)),
      profiles: TRANSCODE_PROFILES,
      requestedAt: new Date().toISOString(),
      requestedBy: "requeue-script",
    };

    const enqueueResult = await enqueueTranscodeJob(job);

    if (enqueueResult.queued) {
      queuedCount += 1;
      console.log(`[ENQUEUED] videoId=${row.id}`);
    } else {
      duplicateCount += 1;
      console.log(`[DUPLICATE] videoId=${row.id} already queued`);
    }
  }

  console.log("\n--- Requeue summary ---");
  console.log(`Candidates: ${result.rows.length}`);
  console.log(`Queued: ${queuedCount}`);
  console.log(`Skipped duplicate: ${duplicateCount}`);
  console.log(`Skipped missing file: ${missingFileCount}`);

  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("Requeue failed:", error.message);
    try {
      await pool.end();
    } catch (_) {}
    process.exit(1);
  });
