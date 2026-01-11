const redis = require('redis');

class RedisRateLimiter {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.initializeRedis();
  }

  async initializeRedis() {
    try {
      this.client = redis.createClient({
        host: 'localhost',
        port: 6379,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            if (retries > 3) {
              console.log('Redis unavailable - rate limiting disabled');
              return false;
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      this.client.on('error', (err) => {
        console.warn('Redis unavailable - rate limiting disabled:', err.message);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('Redis connected successfully (Rate Limiter)');
        this.isConnected = true;
      });

      await this.client.connect();
    } catch (err) {
      console.warn('Redis connection failed - rate limiting disabled:', err.message);
      this.client = null;
      this.isConnected = false;
    }
  }

  // Sliding window rate limiter
  async checkRateLimit(identifier, windowMs = 60000, maxRequests = 5) {
    // If Redis is not available, allow the request
    if (!this.isConnected || !this.client) {
      return { allowed: true, remaining: maxRequests };
    }

    const key = `rate_limit:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Start a transaction (pipeline)
      const multi = this.client.multi();

      // Remove old entries outside the window
      multi.zRemRangeByScore(key, 0, windowStart);

      // Count requests in current window
      multi.zCard(key);

      // Add current request with timestamp as score
      multi.zAdd(key, { score: now, value: `${now}` });

      // Set expiration on the key
      multi.expire(key, Math.ceil(windowMs / 1000));

      const results = await multi.exec();
      
      // results[1] contains the count before adding current request
      const requestCount = results[1];

      if (requestCount >= maxRequests) {
        // Get oldest request in window to calculate retry-after
        const oldest = await this.client.zRange(key, 0, 0, { withScores: true });
        const retryAfter = oldest.length > 0 
          ? Math.ceil((parseFloat(oldest[0].score) + windowMs - now) / 1000)
          : Math.ceil(windowMs / 1000);

        return {
          allowed: false,
          remaining: 0,
          retryAfter
        };
      }

      return {
        allowed: true,
        remaining: maxRequests - requestCount - 1
      };
    } catch (err) {
      console.error('Rate limiter error:', err);
      // On error, allow the request (fail open)
      return { allowed: true, remaining: maxRequests };
    }
  }

  // Middleware factory
  createLimiter(options = {}) {
    const {
      windowMs = 60 * 1000,        // 1 minute
      max = 5,                      // 5 requests
      keyGenerator = (req) => req.ip,
      handler = null
    } = options;

    return async (req, res, next) => {
      const identifier = keyGenerator(req);
      const result = await this.checkRateLimit(identifier, windowMs, max);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        res.setHeader('X-RateLimit-Reset', Date.now() + (result.retryAfter * 1000));
        res.setHeader('Retry-After', result.retryAfter);

        if (handler) {
          return handler(req, res);
        }

        return res.status(429).json({
          error: 'Previše pokušaja. Pokušajte ponovo za minut.'
        });
      }

      next();
    };
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.quit();
      console.log('Redis rate limiter disconnected');
    }
  }
}

module.exports = new RedisRateLimiter();
