const { getRedis } = require("./redisClient");

const QUEUE_KEY = "transcode:queue";

function getVideoDedupKey(videoId) {
  return `transcode:video:${videoId}:queued`;
}

function getJobProcessingKey(jobId) {
  return `transcode:job:${jobId}:processing`;
}

async function enqueueTranscodeJob(job) {
  const redis = await getRedis();
  const dedupKey = getVideoDedupKey(job.videoId);

  const setResult = await redis.set(dedupKey, job.jobId, {
    NX: true,
    EX: 60 * 60 * 24,
  });

  if (setResult !== "OK") {
    return { queued: false, reason: "duplicate-video-job" };
  }

  await redis.lPush(QUEUE_KEY, JSON.stringify(job));
  return { queued: true };
}

async function popTranscodeJob(timeoutSeconds = 0) {
  const redis = await getRedis();
  const result = await redis.brPop(QUEUE_KEY, timeoutSeconds);

  if (!result || !result.element) return null;

  try {
    return JSON.parse(result.element);
  } catch (error) {
    return null;
  }
}

async function acquireJobProcessingLock(jobId, ttlSeconds = 60 * 60) {
  const redis = await getRedis();
  const lockKey = getJobProcessingKey(jobId);

  const lockResult = await redis.set(lockKey, "1", {
    NX: true,
    EX: ttlSeconds,
  });

  return lockResult === "OK";
}

async function releaseJobProcessingLock(jobId) {
  const redis = await getRedis();
  const lockKey = getJobProcessingKey(jobId);
  await redis.del(lockKey);
}

module.exports = {
  enqueueTranscodeJob,
  popTranscodeJob,
  acquireJobProcessingLock,
  releaseJobProcessingLock,
};
