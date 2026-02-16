require("dotenv").config();

const pool = require("../pool");
const { compressOldThumbnails } = require("../jobs/compressOldThumbnails");

async function main() {
  const arg = process.argv.find((value) => value.startsWith("--days="));
  const olderThanDays = arg ? Number(arg.split("=")[1]) : 30;

  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new Error("Parametar --days mora biti nenegativan broj.");
  }

  await compressOldThumbnails({ olderThanDays });
}

main()
  .catch((error) => {
    console.error("Thumbnail compression failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
