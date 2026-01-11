const redis = require('redis');

class CommentCache {
  constructor() {
    // Create Redis client
    this.client = redis.createClient({
      host: 'localhost',
      port: 6379
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis connected successfully (L2 Cache)');
    });

    // Connect to Redis
    this.client.connect();

    this.TTL = 60 * 10; // 10 ms [Redis uses seconds for TTL]
  }

  // Generate cache key
  generateKey(videoId, page, limit) {
    return `comments:${videoId}:${page}:${limit}`;
  }

  // Get cached comments
  async get(videoId, page, limit) {
    const key = this.generateKey(videoId, page, limit);
    
    try {
      const cached = await this.client.get(key);
      
      if (!cached) {
        return null;
      }

      console.log(`Cache HIT (Redis L2) for video ${videoId}, page ${page}`);
      return JSON.parse(cached);
    } catch (err) {
      console.error('Redis GET error:', err);
      return null;
    }
  }

  // Set cache with TTL
  async set(videoId, page, limit, data) {
    const key = this.generateKey(videoId, page, limit);
    
    try {
      await this.client.setEx(key, this.TTL, JSON.stringify(data));
      console.log(`Cache SET (Redis L2) for video ${videoId}, page ${page} (TTL: ${this.TTL}s)`);
    } catch (err) {
      console.error('Redis SET error:', err);
    }
  }

  // Invalidate cache for the video (when a new comment gets posted)
  async invalidateVideo(videoId) {
    try {
      const pattern = `comments:${videoId}:*`;
      const keys = await this.client.keys(pattern);
      
      if (keys.length > 0) {
        await this.client.del(keys);
        console.log(`Cache invalidated (Redis L2) for video ${videoId} (${keys.length} entries deleted)`);
      }
    } catch (err) {
      console.error('Redis invalidate error:', err);
    }
  }

  // Clear all cache
  async clear() {
    try {
      await this.client.flushAll();
      console.log('All cache cleared (Redis L2)');
    } catch (err) {
      console.error('Redis clear error:', err);
    }
  }

  // Cache stats
  async getStats() {
    try {
      const keys = await this.client.keys('comments:*');
      const info = await this.client.info('stats');
      
      return {
        totalKeys: keys.length,
        entries: keys,
        redisInfo: info
      };
    } catch (err) {
      console.error('Redis stats error:', err);
      return { error: err.message };
    }
  }

  // Connection shutdfown
  async disconnect() {
    await this.client.quit();
    console.log('Redis disconnected');
  }
}

module.exports = new CommentCache();