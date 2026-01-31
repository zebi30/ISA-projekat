const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Eksplicitno konvertuj password u string ako je potrebno
  ...(process.env.DB_PASSWORD && { password: String(process.env.DB_PASSWORD) })
});

module.exports = pool;
