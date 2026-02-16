require("dotenv").config();

const { ensurePopularVideosTables } = require("../services/popularVideosSchema");
const { runPopularVideosEtlSafe } = require("../jobs/popularVideosEtl");

async function main() {
  await ensurePopularVideosTables();
  await runPopularVideosEtlSafe("manual-script");
  process.exit(0);
}

main().catch((error) => {
  console.error("Popular videos ETL run failed:", error);
  process.exit(1);
});
