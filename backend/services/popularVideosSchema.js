const pool = require("../pool");

async function ensurePopularVideosTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_view_events (
      id BIGSERIAL PRIMARY KEY,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_video_view_events_video_date
    ON video_view_events (video_id, viewed_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_video_view_events_date
    ON video_view_events (viewed_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS popular_videos_etl_runs (
      id BIGSERIAL PRIMARY KEY,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      top1_video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      top1_score INTEGER NOT NULL DEFAULT 0,
      top2_video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      top2_score INTEGER NOT NULL DEFAULT 0,
      top3_video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      top3_score INTEGER NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_popular_videos_etl_runs_run_at
    ON popular_videos_etl_runs (run_at DESC)
  `);
}

module.exports = {
  ensurePopularVideosTables,
};
