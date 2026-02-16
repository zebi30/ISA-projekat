const pool = require("../pool");

async function ensureVideoScheduleColumns() {
  await pool.query(`
    ALTER TABLE videos
    ADD COLUMN IF NOT EXISTS schedule_at TIMESTAMPTZ
  `);

  const columnTypeResult = await pool.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'videos'
      AND column_name = 'schedule_at'
    LIMIT 1
  `);

  const columnType = columnTypeResult.rows[0]?.data_type;
  if (columnType === 'timestamp without time zone') {
    await pool.query(`
      ALTER TABLE videos
      ALTER COLUMN schedule_at TYPE TIMESTAMPTZ
      USING schedule_at AT TIME ZONE 'UTC'
    `);
  }

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_videos_schedule_at
    ON videos (schedule_at)
  `);
}

module.exports = { ensureVideoScheduleColumns };
