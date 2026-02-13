const pool = require("../pool");

async function ensureTranscodeColumns() {
  await pool.query(`
    ALTER TABLE videos
    ADD COLUMN IF NOT EXISTS transcode_status VARCHAR(20) DEFAULT 'pending'
  `);

  await pool.query(`
    ALTER TABLE videos
    ADD COLUMN IF NOT EXISTS transcoded_outputs JSONB
  `);

  await pool.query(`
    ALTER TABLE videos
    ADD COLUMN IF NOT EXISTS transcode_error TEXT
  `);
}

module.exports = { ensureTranscodeColumns };
