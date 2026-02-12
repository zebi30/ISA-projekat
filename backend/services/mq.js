const amqp = require("amqplib");

let conn = null;
let ch = null;

const EXCHANGE = process.env.MQ_EXCHANGE || "upload.events";

async function getChannel() {
  if (ch) return ch;

  const url = process.env.MQ_URL || "amqp://localhost:5672";
  conn = await amqp.connect(url);
  ch = await conn.createChannel();

  await ch.assertExchange(EXCHANGE, "direct", { durable: true });
  return ch;
}

async function publish(routingKey, buffer, headers = {}) {
  const channel = await getChannel();
  channel.publish(EXCHANGE, routingKey, buffer, {
    persistent: true,
    contentType: headers.contentType,
    headers
  });
}

module.exports = { publish, EXCHANGE };
