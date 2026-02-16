const pool = require("../pool");

async function recordVideoViewEvent(videoId) {
  if (!Number.isInteger(videoId) || videoId <= 0) return;

  try {
    await pool.query(
      `INSERT INTO video_view_events (video_id, viewed_at) VALUES ($1, NOW())`,
      [videoId]
    );
  } catch (error) {
    console.error("Failed to record video view event:", error.message);
  }
}

async function runPopularVideosEtl() {
  const extractResult = await pool.query(
    `
    SELECT
      vve.video_id,
      DATE_TRUNC('day', vve.viewed_at) AS view_day,
      COUNT(*)::int AS day_views
    FROM video_view_events vve
    JOIN videos v ON v.id = vve.video_id
    WHERE vve.viewed_at >= DATE_TRUNC('day', NOW()) - INTERVAL '6 days'
      AND (v.schedule_at IS NULL OR v.schedule_at <= NOW())
    GROUP BY vve.video_id, DATE_TRUNC('day', vve.viewed_at)
    `
  );

  const now = Date.now();
  const scoreByVideoId = new Map();

  for (const row of extractResult.rows) {
    const videoId = Number(row.video_id);
    const dayViews = Number(row.day_views) || 0;
    const viewDay = new Date(row.view_day);
    if (!videoId || Number.isNaN(viewDay.getTime()) || dayViews <= 0) continue;

    const daysAgo = Math.floor((now - viewDay.getTime()) / (24 * 60 * 60 * 1000));
    if (daysAgo < 0 || daysAgo > 6) continue;

    const weight = 7 - daysAgo;
    const weightedContribution = dayViews * weight;

    scoreByVideoId.set(videoId, (scoreByVideoId.get(videoId) || 0) + weightedContribution);
  }

  let top3 = [...scoreByVideoId.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([videoId, score]) => ({ videoId, score }));

  if (top3.length === 0) {
    const previousRunResult = await pool.query(
      `
      SELECT top1_video_id, top1_score, top2_video_id, top2_score, top3_video_id, top3_score
      FROM popular_videos_etl_runs
      ORDER BY run_at DESC
      LIMIT 1
      `
    );

    const previousRun = previousRunResult.rows[0];
    if (previousRun) {
      top3 = [
        { videoId: previousRun.top1_video_id, score: Number(previousRun.top1_score) || 0 },
        { videoId: previousRun.top2_video_id, score: Number(previousRun.top2_score) || 0 },
        { videoId: previousRun.top3_video_id, score: Number(previousRun.top3_score) || 0 },
      ].filter((item) => item.videoId);
    }
  }

  const top1 = top3[0] || { videoId: null, score: 0 };
  const top2 = top3[1] || { videoId: null, score: 0 };
  const top3Item = top3[2] || { videoId: null, score: 0 };

  const loadResult = await pool.query(
    `
    INSERT INTO popular_videos_etl_runs (
      top1_video_id, top1_score,
      top2_video_id, top2_score,
      top3_video_id, top3_score
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, run_at
    `,
    [
      top1.videoId,
      top1.score,
      top2.videoId,
      top2.score,
      top3Item.videoId,
      top3Item.score,
    ]
  );

  return {
    run: loadResult.rows[0],
    top3,
  };
}

async function getLatestPopularVideos() {
  const runResult = await pool.query(
    `
    SELECT id, run_at, top1_video_id, top1_score, top2_video_id, top2_score, top3_video_id, top3_score
    FROM popular_videos_etl_runs
    ORDER BY run_at DESC
    LIMIT 1
    `
  );

  if (runResult.rows.length === 0) {
    return {
      run_at: null,
      videos: [],
    };
  }

  const run = runResult.rows[0];
  const ranked = [
    { rank: 1, videoId: run.top1_video_id, score: Number(run.top1_score) || 0 },
    { rank: 2, videoId: run.top2_video_id, score: Number(run.top2_score) || 0 },
    { rank: 3, videoId: run.top3_video_id, score: Number(run.top3_score) || 0 },
  ].filter((item) => item.videoId);

  if (ranked.length === 0) {
    return {
      run_at: run.run_at,
      videos: [],
    };
  }

  const ids = ranked.map((item) => item.videoId);
  const detailsResult = await pool.query(
    `
    SELECT
      v.id,
      v.title,
      v.description,
      v.thumbnail,
      v.views,
      v.likes,
      v.created_at,
      v.schedule_at,
      u.username,
      u.first_name,
      u.last_name
    FROM videos v
    JOIN users u ON u.id = v.user_id
    WHERE v.id = ANY($1::int[])
    `,
    [ids]
  );

  const detailMap = new Map(detailsResult.rows.map((row) => [Number(row.id), row]));

  const videos = ranked
    .map((item) => {
      const details = detailMap.get(Number(item.videoId));
      if (!details) return null;
      return {
        rank: item.rank,
        popularity_score: item.score,
        ...details,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);

  return {
    run_at: run.run_at,
    videos,
  };
}

module.exports = {
  recordVideoViewEvent,
  runPopularVideosEtl,
  getLatestPopularVideos,
};
