// node scripts/simulateViews.js 2 200
// args: <videoId> <concurrentCalls>

const videoId = Number(process.argv[2] || 2);
const n = Number(process.argv[3] || 100);

async function main() {
  const url = `http://localhost:5000/api/videos/${videoId}/watch`;

  console.log(`Simuliram ${n} istovremenih poseta za video ${videoId}...`);

  const start = Date.now();

  const reqs = Array.from({ length: n }, () =>
    fetch(url, { method: "POST" }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
  );

  const results = await Promise.all(reqs);
  const last = results[results.length - 1];

  console.log(`Gotovo za ${Date.now() - start}ms`);
  console.log(`Zadnji odgovor views = ${last.views}`);

  // proveri da li su svi dobili razlicite vrednosti
  const viewsSet = new Set(results.map(x => x.views));
  console.log(`Unique views values returned: ${viewsSet.size}/${n}`);
}

main().catch((e) => {
  console.error("Greska:", e);
  process.exit(1);
});
