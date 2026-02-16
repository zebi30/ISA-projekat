//salje 50 JSON + 50 PB i meri serialize
const amqp = require("amqplib");
const path = require("path");
const protobuf = require("protobufjs");

const MQ_URL = process.env.MQ_URL || "amqp://localhost:5672";
const EXCHANGE = process.env.MQ_EXCHANGE || "upload.events";
const N = Number(process.env.N || 50);

function hrNow() { return process.hrtime.bigint(); }
function nsToMs(ns) { return Number(ns) / 1e6; }

async function main() {
  const conn = await amqp.connect(MQ_URL);
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, "direct", { durable: true });

  const protoPath = path.join(__dirname, "contracts", "upload_event.proto");
  const root = await protobuf.load(protoPath);
  const T = root.lookupType("jutjubic.UploadEvent");

  let jsonSerNs = 0n, pbSerNs = 0n;
  let jsonBytes = 0, pbBytes = 0;

  for (let i = 0; i < N; i++) {
    const event = {
      video_id: 1000 + i,
      title: `Video #${i}`,
      size_bytes: 123456 + i,
      author_id: 42,
      author_username: "pera",
      mime_type: "video/mp4",
      created_at_iso: new Date().toISOString(),
      thumbnail_path: `/uploads/thumbs/${1000 + i}.png`,
      video_path: `/uploads/videos/${1000 + i}.mp4`,
      tags: ["tag1", "tag2", "tag3"]
    };

    // JSON serialize
    let t0 = hrNow();
    const jsonStr = JSON.stringify(event);
    let t1 = hrNow();
    const jsonBuf = Buffer.from(jsonStr, "utf8");
    jsonSerNs += (t1 - t0);
    jsonBytes += jsonBuf.length;

    ch.publish(EXCHANGE, "upload.json", jsonBuf, {
      persistent: true,
      contentType: "application/json"
    });

    // PB serialize
    t0 = hrNow();
    const errMsg = T.verify(event);
    if (errMsg) throw new Error(errMsg);
    const pbBuf = Buffer.from(T.encode(T.create(event)).finish());
    t1 = hrNow();
    pbSerNs += (t1 - t0);
    pbBytes += pbBuf.length;

    ch.publish(EXCHANGE, "upload.pb", pbBuf, {
      persistent: true,
      contentType: "application/x-protobuf"
    });
  }

  console.log("=== PRODUCER (serialize) ===");
  console.log(`N=${N}`);
  console.log(`JSON avg serialize: ${nsToMs(jsonSerNs) / N} ms`);
  console.log(`PB   avg serialize: ${nsToMs(pbSerNs) / N} ms`);
  console.log(`JSON avg size: ${(jsonBytes / N).toFixed(2)} bytes`);
  console.log(`PB   avg size: ${(pbBytes / N).toFixed(2)} bytes`);

  await ch.close();
  await conn.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
