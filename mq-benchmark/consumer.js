//prima poruke i meri deserialize
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

  const qJson = "upload.q.json";
  const qPb = "upload.q.pb";

  await ch.assertQueue(qJson, { durable: true });
  await ch.assertQueue(qPb, { durable: true });

  await ch.bindQueue(qJson, EXCHANGE, "upload.json");
  await ch.bindQueue(qPb, EXCHANGE, "upload.pb");

  const protoPath = path.join(__dirname, "contracts", "upload_event.proto");
  const root = await protobuf.load(protoPath);
  const T = root.lookupType("jutjubic.UploadEvent");

  let jsonDesNs = 0n, pbDesNs = 0n;
  let jsonBytes = 0, pbBytes = 0;
  let jsonCount = 0, pbCount = 0;

  function maybeFinish() {
    if (jsonCount >= N && pbCount >= N) {
      console.log("=== CONSUMER (deserialize) ===");
      console.log(`N=${N}`);
      console.log(`JSON avg deserialize: ${nsToMs(jsonDesNs) / N} ms`);
      console.log(`PB   avg deserialize: ${nsToMs(pbDesNs) / N} ms`);
      console.log(`JSON avg size: ${(jsonBytes / N).toFixed(2)} bytes`);
      console.log(`PB   avg size: ${(pbBytes / N).toFixed(2)} bytes`);
      process.exit(0);
    }
  }

  await ch.consume(qJson, (msg) => {
    if (!msg) return;
    jsonBytes += msg.content.length;

    const t0 = hrNow();
    JSON.parse(msg.content.toString("utf8"));
    const t1 = hrNow();
    jsonDesNs += (t1 - t0);

    jsonCount++;
    ch.ack(msg);
    maybeFinish();
  });

  await ch.consume(qPb, (msg) => {
    if (!msg) return;
    pbBytes += msg.content.length;

    const t0 = hrNow();
    T.decode(msg.content);
    const t1 = hrNow();
    pbDesNs += (t1 - t0);

    pbCount++;
    ch.ack(msg);
    maybeFinish();
  });

  console.log("Consumer ready. Waiting messages...");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
