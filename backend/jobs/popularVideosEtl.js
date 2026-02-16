const cron = require("node-cron");
const { runPopularVideosEtl } = require("../services/popularVideosEtlService");

async function runPopularVideosEtlSafe(source = "manual") {
  try {
    const result = await runPopularVideosEtl();
    console.log(
      `[POPULAR ETL] source=${source} runId=${result.run.id} runAt=${result.run.run_at} top=${result.top3
        .map((item) => `${item.videoId}:${item.score}`)
        .join(",")}`
    );
    return result;
  } catch (error) {
    console.error(`[POPULAR ETL] source=${source} failed:`, error);
    throw error;
  }
}

function startDailyPopularVideosEtlJob() {
  cron.schedule("0 2 * * *", async () => {
    await runPopularVideosEtlSafe("cron");
  });
}

module.exports = {
  startDailyPopularVideosEtlJob,
  runPopularVideosEtlSafe,
};
