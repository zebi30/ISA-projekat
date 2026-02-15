require("dotenv").config();

const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const pool = require("../pool");
const {
  popTranscodeJob,
  acquireJobProcessingLock,
  releaseJobProcessingLock,
} = require("../services/transcodeQueue");

const WORKER_NAME = process.env.TRANSCODE_WORKER_NAME || `worker-${process.pid}`;
const POLL_TIMEOUT_SECONDS = 2;

function runFfmpegTranscode(inputPath, outputPath, profile) {
  return new Promise((resolve, reject) => {
    const scaleFilter = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;

    const args = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      scaleFilter,
      "-c:v",
      "libx264",
      "-b:v",
      profile.videoBitrate,
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      "-b:a",
      profile.audioBitrate,
      "-movflags",
      "+faststart",
      outputPath,
    ];

    const ffmpeg = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", reject);

    ffmpeg.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

async function markVideoProcessing(videoId) {
  await pool.query(
    `UPDATE videos
     SET transcode_status = 'processing',
         transcode_error = NULL
     WHERE id = $1`,
    [videoId]
  );
}

async function markVideoReady(videoId, outputs) {
  await pool.query(
    `UPDATE videos
     SET transcode_status = 'ready',
         transcoded_outputs = $2::jsonb,
         transcode_error = NULL
     WHERE id = $1`,
    [videoId, JSON.stringify(outputs)]
  );
}

async function markVideoFailed(videoId, errorMessage) {
  const normalizedError = String(errorMessage || "Transcoding failed");
  const storedError = normalizedError.length > 2000
    ? normalizedError.slice(-2000)
    : normalizedError;

  await pool.query(
    `UPDATE videos
     SET transcode_status = 'failed',
         transcode_error = $2
     WHERE id = $1`,
    [videoId, storedError]
  );
}

async function processJob(job) {
  const lockAcquired = await acquireJobProcessingLock(job.jobId, 60 * 60);
  if (!lockAcquired) return;

  try {
    await markVideoProcessing(job.videoId);

    await fs.ensureDir(job.outputDir);

    const outputs = [];
    for (const profile of job.profiles) {
      const outputFileName = `${profile.label}.mp4`;
      const outputAbsolutePath = path.join(job.outputDir, outputFileName);

      await runFfmpegTranscode(job.sourcePath, outputAbsolutePath, profile);

      const outputPublicPath = `/uploads/transcoded/${job.videoId}/${outputFileName}`;
      outputs.push({
        profile: profile.label,
        width: profile.width,
        height: profile.height,
        path: outputPublicPath,
      });
    }

    await markVideoReady(job.videoId, outputs);
    console.log(`[${WORKER_NAME}] transcoding done for video ${job.videoId}`);
  } catch (error) {
    await markVideoFailed(job.videoId, error.message || "Transcoding failed");
    console.error(`[${WORKER_NAME}] transcoding failed for video ${job.videoId}:`, error.message);
  } finally {
    await releaseJobProcessingLock(job.jobId);
  }
}

async function startWorker() {
  console.log(`[${WORKER_NAME}] started`);

  while (true) {
    try {
      const job = await popTranscodeJob(POLL_TIMEOUT_SECONDS);
      if (!job) continue;
      await processJob(job);
    } catch (error) {
      console.error(`[${WORKER_NAME}] loop error:`, error.message);
    }
  }
}

startWorker().catch((error) => {
  console.error(`[${WORKER_NAME}] fatal error:`, error);
  process.exit(1);
});
