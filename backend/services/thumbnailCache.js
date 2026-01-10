const { LRUCache } = require("lru-cache");

const cache = new LRUCache({
  max: 200,               // broj thumbnailova u cache-u
  ttl: 1000 * 60 * 10     // 10 minuta (ms)
});

module.exports = cache;
