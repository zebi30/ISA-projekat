require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const os = require('os');
const path = require("path");
const commentCache = require('./services/commentCache');
const rateLimiter = require('./middlewares/rateLimiter');
const { ensureVideoScheduleColumns } = require('./services/videoScheduleSchema');
const { ensurePopularVideosTables } = require('./services/popularVideosSchema');
const { recordVideoViewEvent, getLatestPopularVideos } = require('./services/popularVideosEtlService');
const { startDailyPopularVideosEtlJob } = require('./jobs/popularVideosEtl');
const { getRedis } = require('./services/redisClient');
const client = require('prom-client');

const videosRoutes = require("./routes/videos");
const thumbnailsRoutes = require("./routes/thumbnails");

const http = require("http");
const { Server } = require("socket.io");

const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

// PostgreSQL pool
const pool = require("./pool");

const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry });

const dbPoolTotalConnectionsGauge = new client.Gauge({
  name: 'app_db_pool_total_connections',
  help: 'Ukupan broj konekcija u PostgreSQL pool-u',
  registers: [metricsRegistry],
});

const dbPoolIdleConnectionsGauge = new client.Gauge({
  name: 'app_db_pool_idle_connections',
  help: 'Broj idle konekcija u PostgreSQL pool-u',
  registers: [metricsRegistry],
});

const dbPoolWaitingRequestsGauge = new client.Gauge({
  name: 'app_db_pool_waiting_requests',
  help: 'Broj zahteva koji čekaju slobodnu konekciju iz PostgreSQL pool-a',
  registers: [metricsRegistry],
});

const appCpuUsagePercentGauge = new client.Gauge({
  name: 'app_cpu_usage_percent',
  help: 'Prosecno zauzece CPU u procentima u poslednjem mernom intervalu',
  registers: [metricsRegistry],
});

const activeUsers24hGauge = new client.Gauge({
  name: 'app_active_users_24h',
  help: 'Broj jedinstvenih aktivnih posetilaca u poslednja 24h (korisnici + gosti)',
  registers: [metricsRegistry],
});

const activeVisitorsLastSeenMap = new Map();
const ACTIVE_USERS_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_USERS_REDIS_KEY = 'metrics:active_visitors_24h';
const watchPartyRooms = new Map();

function buildWatchPartyState(room) {
  return {
    roomId: room.roomId,
    videoId: room.videoId,
    owner: room.owner,
    createdAt: room.createdAt,
    membersCount: room.members.size,
    playback: room.playback,
  };
}

function createWatchPartyRoom({ videoId, owner }) {
  let roomId = crypto.randomBytes(4).toString('hex');
  while (watchPartyRooms.has(roomId)) {
    roomId = crypto.randomBytes(4).toString('hex');
  }

  const room = {
    roomId,
    videoId,
    owner,
    createdAt: new Date().toISOString(),
    members: new Set(),
    playback: {
      isPlaying: false,
      currentTime: 0,
      updatedAt: Date.now(),
    },
  };

  watchPartyRooms.set(roomId, room);
  return room;
}

function cleanupInactiveUsersLocal() {
  const cutoff = Date.now() - ACTIVE_USERS_WINDOW_MS;
  for (const [visitorKey, lastSeen] of activeVisitorsLastSeenMap.entries()) {
    if (lastSeen < cutoff) {
      activeVisitorsLastSeenMap.delete(visitorKey);
    }
  }
}

async function refreshActiveUsersGaugeFromRedis() {
  try {
    const redis = await getRedis();
    if (!redis || !redis.isOpen) {
      cleanupInactiveUsersLocal();
      activeUsers24hGauge.set(activeVisitorsLastSeenMap.size);
      return;
    }

    const cutoff = Date.now() - ACTIVE_USERS_WINDOW_MS;
    await redis.zRemRangeByScore(ACTIVE_USERS_REDIS_KEY, '-inf', cutoff);
    const uniqueCount = await redis.zCard(ACTIVE_USERS_REDIS_KEY);
    activeUsers24hGauge.set(Number(uniqueCount) || 0);
  } catch {
    cleanupInactiveUsersLocal();
    activeUsers24hGauge.set(activeVisitorsLastSeenMap.size);
  }
}

function buildGuestVisitorKey(req) {
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'unknown-agent';
  const raw = `${ip}|${userAgent}`;
  const hash = crypto.createHash('sha1').update(raw).digest('hex');
  return `guest:${hash}`;
}

function trackVisitorInRedis(visitorKey) {
  const now = Date.now();

  getRedis()
    .then((redis) => {
      if (!redis || !redis.isOpen) return;
      return redis.zAdd(ACTIVE_USERS_REDIS_KEY, [{ score: now, value: visitorKey }]);
    })
    .catch(() => {});
}

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
    return xForwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown-ip';
}

function trackVisitorActivity(req, res, next) {
  const requestPath = req.path || req.originalUrl || '';
  const userAgent = String(req.headers['user-agent'] || '').toLowerCase();

  if (
    requestPath.startsWith('/metrics') ||
    requestPath.startsWith('/health') ||
    requestPath.startsWith('/whoami') ||
    userAgent.includes('prometheus')
  ) {
    return next();
  }

  try {
    let visitorKey = null;
    const authHeader = req.headers['authorization'];

    if (authHeader) {
      const token = authHeader.split(' ')[1];
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded?.id) {
          visitorKey = `user:${decoded.id}`;
        }
      }
    }

    if (!visitorKey) {
      visitorKey = buildGuestVisitorKey(req);
    }

    activeVisitorsLastSeenMap.set(visitorKey, Date.now());
    trackVisitorInRedis(visitorKey);
  } catch {
    const fallbackVisitorKey = buildGuestVisitorKey(req);
    activeVisitorsLastSeenMap.set(fallbackVisitorKey, Date.now());
    trackVisitorInRedis(fallbackVisitorKey);
  }

  return next();
}

function readCpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }

  return { idle, total };
}

let previousCpuSnapshot = readCpuSnapshot();

async function collectAppMetrics() {
  dbPoolTotalConnectionsGauge.set(pool.totalCount || 0);
  dbPoolIdleConnectionsGauge.set(pool.idleCount || 0);
  dbPoolWaitingRequestsGauge.set(pool.waitingCount || 0);

  const current = readCpuSnapshot();
  const idleDiff = current.idle - previousCpuSnapshot.idle;
  const totalDiff = current.total - previousCpuSnapshot.total;
  previousCpuSnapshot = current;

  if (totalDiff > 0) {
    const usagePercent = (1 - idleDiff / totalDiff) * 100;
    appCpuUsagePercentGauge.set(Number(usagePercent.toFixed(2)));
  }

  await refreshActiveUsersGaugeFromRedis();
}

const metricsInterval = setInterval(() => {
  collectAppMetrics().catch((error) => {
    console.error('Periodic metrics collection error:', error.message);
  });
}, 5000);
metricsInterval.unref();
collectAppMetrics().catch((error) => {
  console.error('Initial metrics collection error:', error.message);
});

app.use(trackVisitorActivity);

app.get('/metrics', async (req, res) => {
  try {
    collectAppMetrics();
    res.set('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  } catch (error) {
    console.error('Metrics endpoint error:', error);
    res.status(500).send('Cannot collect metrics');
  }
});

// Redis-based rate limiter with sliding window (5 requests per minute per IP)
const loginLimiter = rateLimiter.createLimiter({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Previše pokušaja prijave. Pokušajte ponovo za minut.'
    });
  }
});

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// health: liveness (NE dira DB/Redis)- uvek 200 ako je proces ziv  - koristi se za proveru da li je app uopste ziv, bez obzira na stanje DB/Redis
app.get("/health/live", (req, res) => {
  return res.json({
    ok: true,
    status: "live",
    instance: process.env.INSTANCE_NAME || "unknown",
    pid: process.pid,
    ts: new Date().toISOString()
  });
});

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

// helper: proveri redis (ako padne, ne baca dalje)
async function checkRedis() {
  try {
    const { getRedis } = require("./services/redisClient");

    // getRedis mora brzo da vrati objekat (ne da blokira)
    const r = await withTimeout(getRedis(), 200);

    // ako nije konektovan, odmah down
    if (!r || !r.isOpen) return "down";

    // ping sa timeoutom, da ne visi
    await withTimeout(r.ping(), 300);
    return "up";
  } catch (e) {
    return "down";
  }
}

// health: readiness (proverava DB + Redis)
app.get("/health/ready", async (req, res) => {
  const result = { ok: true, db: "up", redis: "up" };

  // DB check
  try {
    await pool.query("SELECT 1");
    result.db = "up";
  } catch (e) {
    result.db = "down";
    result.ok = false;
  }

  // Redis check
  result.redis = await checkRedis();
  if (result.redis !== "up") result.ok = false;

  if (!result.ok) {
    return res.status(503).json(result);
  }
  return res.json(result);
});

app.get("/health", async (req, res) => {
  // isto kao /health/ready
  const result = { ok: true, db: "up", redis: "up" };

  try { await pool.query("SELECT 1"); } catch { result.db = "down"; result.ok = false; }
  result.redis = await checkRedis();
  if (result.redis !== "up") result.ok = false;

  if (!result.ok) return res.status(503).json(result);
  return res.json(result);
});

app.get("/whoami", (req, res) => {      //identitet replike, koristi se za testiranje load balancera i sticky sessiona
  res.json({
    instance: process.env.INSTANCE_NAME || "unknown",
    pid: process.pid
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, username, password, password2, first_name, last_name, address } = req.body;

  if (!email || !username || !password || !password2 || !first_name || !last_name || !address)
    return res.status(400).json({ error: 'Sva polja su obavezna.' });

  if (password !== password2) return res.status(400).json({ error: 'Lozinke se ne poklapaju.' });
  if (password.length < 6) return res.status(400).json({ error: 'Lozinka mora imati najmanje 6 karaktera.' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const activationToken = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
      `INSERT INTO users (email, username, password, first_name, last_name, address, activation_token) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [email, username, hashedPassword, first_name, last_name, address, activationToken]
    );

    // Send activation email
    const activationLink = `${process.env.FRONTEND_URL}/activate/${activationToken}`;
    
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: '🎬 Aktivirajte vaš Jutjubić nalog',
        html: `...`
      });
      
      console.log(`Aktivacioni email poslat na: ${email}`);
    } catch (emailError) {
      console.error('GREŠKA pri slanju emaila:', emailError);
      console.error('Email detalji:', {
        user: process.env.EMAIL_USER,
        hasPassword: !!process.env.EMAIL_PASS,
        to: email
      });
      
      // Ne blokiraj registraciju ako email ne uspe
      console.log(`Registracija uspešna za ${email}, ali email nije poslat. Token: ${activationToken}`);
    }

    res.json({ 
      message: 'Registracija uspešna! Proverite email za aktivaciju.',
      devNote: process.env.NODE_ENV === 'development' ? `Token: ${activationToken}` : undefined
    });
  } catch (err) {
    console.error('GREŠKA pri registraciji:', err);
    if (err.code === '23505') {
      res.status(400).json({ error: 'Email ili korisničko ime već postoji.' });
    } else {
      res.status(500).json({ error: 'Greška na serveru.' });
    }
  }
});

app.get('/activate/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const result = await pool.query(
      'UPDATE users SET is_active = true, activation_token = NULL WHERE activation_token = $1 RETURNING id, email, first_name',
      [token]
    );

    if (result.rowCount === 0) {
      return res.status(400).send('Nevažeći ili istekao aktivacioni link.');
    }

    const user = result.rows[0];
    console.log(`Nalog aktiviran: ${user.email} (ID: ${user.id})`);
    
    res.send(`<!DOCTYPE html>...`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Greška na serveru prilikom aktivacije naloga.');
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email i lozinka su obavezni.' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'Pogrešan email ili lozinka.' });
    if (!user.is_active) return res.status(403).json({ error: 'Nalog nije aktiviran.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Pogrešan email ili lozinka.' });

    const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Uspešna prijava!', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru.' });
  }
});

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Niste prijavljeni.' });
  }

  const token = authHeader.split(' ')[1]; // "beraerr token"
  
  if (!token) {
    return res.status(401).json({ error: 'Niste prijavljeni.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Attach user info to the request
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Nevažeći token.' });
  }
};

app.post('/api/watch-party/rooms', authMiddleware, async (req, res) => {
  const videoId = Number(req.body?.videoId);
  if (!videoId) {
    return res.status(400).json({ error: 'videoId je obavezan.' });
  }

  try {
    const videoRes = await pool.query(
      'SELECT id, title, is_live FROM videos WHERE id = $1',
      [videoId]
    );

    if (videoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Video ne postoji.' });
    }

    if (videoRes.rows[0].is_live) {
      return res.status(400).json({ error: 'Watch Party za LIVE video nije podržan.' });
    }

    const room = createWatchPartyRoom({
      videoId,
      owner: {
        id: req.user.id,
        username: req.user.username || 'Host',
      },
    });

    return res.status(201).json(buildWatchPartyState(room));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Greška pri kreiranju Watch Party sobe.' });
  }
});

app.get('/api/watch-party/rooms/:roomId', async (req, res) => {
  const roomId = String(req.params.roomId || '').trim();
  if (!roomId) {
    return res.status(400).json({ error: 'roomId je obavezan.' });
  }

  const room = watchPartyRooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Watch Party soba ne postoji ili je zatvorena.' });
  }

  return res.json(buildWatchPartyState(room));
});

function getSynchronizedOffsetSeconds(videoRow) {
  if (!videoRow?.schedule_at) return 0;

  const scheduleTimestamp = new Date(videoRow.schedule_at).getTime();
  if (Number.isNaN(scheduleTimestamp)) return 0;

  const now = Date.now();
  return Math.max(0, Math.floor((now - scheduleTimestamp) / 1000));
}

function buildScheduleLockPayload(scheduleAt) {
  const releaseTime = new Date(scheduleAt).getTime();
  const now = Date.now();
  return {
    message: "Video je zakazan i još nije dostupan.",
    schedule_at: scheduleAt,
    available_in_seconds: Math.ceil((releaseTime - now) / 1000),
  };
}

async function blockScheduledVideoAccess(req, res, next) {
  const id = Number(req.params.id);
  if (!id) return next();

  try {
    const result = await pool.query(
      'SELECT schedule_at FROM videos WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) return next();

    const scheduleAt = result.rows[0].schedule_at;
    if (!scheduleAt) return next();

    const releaseTime = new Date(scheduleAt).getTime();
    if (!Number.isNaN(releaseTime) && releaseTime > Date.now()) {
      return res.status(423).json(buildScheduleLockPayload(scheduleAt));
    }

    return next();
  } catch (err) {
    console.error('Schedule lock check failed:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// All videos sorted by date (newest first)
app.get('/api/videos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.id, v.title, v.description, v.thumbnail, v.created_at, v.schedule_at, v.likes, v.views, v.is_live,
            v.transcode_status, v.transcoded_outputs, v.transcode_error,
             u.id as user_id, u.username, u.first_name, u.last_name
      FROM videos v
      JOIN users u ON v.user_id = u.id
      WHERE v.schedule_at IS NULL OR v.schedule_at <= NOW()
      ORDER BY v.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greska pri ucitavanju videa.'});
  }
});

app.get('/api/videos/popular/latest', async (req, res) => {
  try {
    const latest = await getLatestPopularVideos();
    return res.json(latest);
  } catch (error) {
    console.error('Error fetching popular videos snapshot:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Get user profile by ID (public view)
app.get('/api/users/:id/profile', async (req, res) => {
  const { id } = req.params;
  
  try {
    // USer info
    const userResult = await pool.query(
      'SELECT id, username, first_name, last_name, created_at FROM users WHERE id = $1',
      [id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Korisnik nije pronadjen.' });
    }
    
    const user = userResult.rows[0];
    
    // Get videos the user posted
    const videosResult = await pool.query(
      `SELECT id, title, description, thumbnail, created_at, schedule_at
       FROM videos
       WHERE user_id = $1
         AND (schedule_at IS NULL OR schedule_at <= NOW())
       ORDER BY created_at DESC`,
      [id]
    );
    
    // Get user's comments
    const commentsResult = await pool.query(`
      SELECT c.id, c.content, c.created_at, v.id as video_id, v.title as video_title
      FROM comments c
      JOIN videos v ON c.video_id = v.id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC
    `, [id]);
    
    res.json({
      user,
      videos: videosResult.rows,
      comments: commentsResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greska pri ucitavanju profila.' });
  }
});

app.get('/api/videos/:id/comments', async (req, res) => { /* ... */ });
app.post('/api/videos/:id/comment', authMiddleware, async (req, res) => { /* ... */ });
app.get('/api/cache/stats', async (req, res) => { /* ... */ });

// Like
app.post('/api/videos/:id/like', authMiddleware, async (req, res) => { /* ... */ });

// Check if user has liked a video  ✅ (OSTAJE JEDNA VERZIJA)
app.get('/api/videos/:id/like/check', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const result = await pool.query(
      'SELECT * FROM likes WHERE user_id = $1 AND video_id = $2',
      [userId, id]
    );

    res.json({ liked: result.rows.length > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greska pri proveri lajka.' });
  }
});

// Delete the like
app.delete('/api/videos/:id/like', authMiddleware, async (req, res) => { /* ... */ });

// GET /api/videos/map - MORA BITI PRE /:id rute!
function getTileKey(lat, lng, tileSize = 0.1) { /* ... */ }
app.get('/api/videos/map/count', async (req, res) => { /* ... */ });
app.get('/api/videos/map/bounds', async (req, res) => { /* ... */ });
app.get('/api/videos/map', async (req, res) => { /* ... */ });

// Get a singular video via id (public) ✅ (OSTAJE JEDNA VERZIJA)
app.get("/api/videos/:id", blockScheduledVideoAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid video id" });

  try {
    const result = await pool.query(
      `
      SELECT v.id, v.title, v.description, v.video_path, v.thumbnail, v.views, v.likes, v.created_at, v.is_live,  v.schedule_at,
            v.transcode_status, v.transcoded_outputs, v.transcode_error,
             u.id as user_id, u.username, u.first_name, u.last_name
      FROM videos v
      JOIN users u ON v.user_id = u.id
      WHERE v.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Video nije pronadjen" });
    }

    const row = result.rows[0];
    if (row.schedule_at) {
      const releaseTime = new Date(row.schedule_at).getTime();
      const now = Date.now();
      if (!Number.isNaN(releaseTime) && releaseTime > now) {
        return res.status(423).json({
          message: "Video je zakazan i još nije dostupan.",
          schedule_at: row.schedule_at,
          available_in_seconds: Math.ceil((releaseTime - now) / 1000),
        });
      }
    }

    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Watch video endpoint - increments views count ✅ (OSTAJE JEDNA VERZIJA)
app.post("/api/videos/:id/watch", blockScheduledVideoAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid video id" });

  try {
    const result = await pool.query(
      `
      SELECT v.id, v.title, v.description, v.video_path, v.thumbnail, v.views, v.likes, v.created_at, v.is_live, v.schedule_at,
            v.transcode_status, v.transcoded_outputs, v.transcode_error,
             u.id as user_id, u.username, u.first_name, u.last_name
      FROM videos v
      JOIN users u ON v.user_id = u.id
      WHERE v.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Video nije pronadjen" });
    }

    const row = result.rows[0];
    if (row.schedule_at) {
      const releaseTime = new Date(row.schedule_at).getTime();
      const now = Date.now();
      if (!Number.isNaN(releaseTime) && releaseTime > now) {
        return res.status(423).json({
          message: "Video je zakazan i još nije dostupan.",
          schedule_at: row.schedule_at,
          available_in_seconds: Math.ceil((releaseTime - now) / 1000),
        });
      }
    }

    const updatedViews = await pool.query(
      'UPDATE videos SET views = views + 1 WHERE id = $1 RETURNING views',
      [id]
    );
    row.views = updatedViews.rows[0]?.views ?? row.views;
    await recordVideoViewEvent(id);

    const playbackOffsetSeconds = getSynchronizedOffsetSeconds(row);

    res.json({
      ...row,
      playback_offset_seconds: playbackOffsetSeconds,
      stream_sync: Boolean(row.schedule_at),
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// START LIVE (samo vlasnik videa)
app.post("/api/videos/:id/live/start", authMiddleware, async (req, res) => { /* ... */ });

//Kreiranje ruta za video i thumbnail 
// statički pristup video fajlovima (video_path koristi ovo)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// IMPORTANT: Specific routes MUST come BEFORE generic app.use("/api/videos", videosRoutes)
// Otherwise videosRoutes will catch all /api/videos/* routes
app.use("/api/videos", videosRoutes);
app.use("/api/thumbnails", thumbnailsRoutes);

// error handler (da vraća poruku)
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || "Server error",
  });
});

const { startNightlyRebuild } = require("./jobs/rebuildMapTiles");
const { startNightlyThumbnailCompression } = require("./jobs/compressOldThumbnails");

//app.listen(PORT, () => console.log(`Backend running on ${PORT}`));
const server = http.createServer(app);      //real time razmena poruka, kad neko udje na video -> automatski se pridruzi chatroomu, ne cuva se istorija

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// ---- CHAT + WATCH PARTY LOGIC (NO HISTORY) ----
io.on("connection", (socket) => {
  const closeWatchPartyRoom = (roomId) => {
    const room = watchPartyRooms.get(roomId);
    if (!room) return;

    io.to(`party:${roomId}`).emit('party:closed', {
      roomId,
      message: 'Owner je napustio sobu. Watch Party je zatvoren.',
    });

    io.in(`party:${roomId}`).socketsLeave(`party:${roomId}`);
    watchPartyRooms.delete(roomId);
  };

  const leaveWatchPartyIfAny = () => {
    const data = socket.data.watchParty;
    if (!data?.roomId) return;

    const roomId = data.roomId;
    const room = watchPartyRooms.get(roomId);
    socket.leave(`party:${roomId}`);
    delete socket.data.watchParty;

    if (!room) return;

    room.members.delete(socket.id);

    if (room.owner.id === data.user?.id) {
      closeWatchPartyRoom(roomId);
      return;
    }

    io.to(`party:${roomId}`).emit('party:members', {
      roomId,
      membersCount: room.members.size,
    });
  };

  socket.on('party:join', ({ roomId, token }) => {
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) {
      socket.emit('party:error', { message: 'Room ID je obavezan.' });
      return;
    }

    const room = watchPartyRooms.get(normalizedRoomId);
    if (!room) {
      socket.emit('party:error', { message: 'Watch Party soba ne postoji ili je zatvorena.' });
      return;
    }

    leaveWatchPartyIfAny();

    let user = { id: null, username: 'Guest' };
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        user = {
          id: payload.id,
          username: payload.username || 'Guest',
        };
      } catch {
        user = { id: null, username: 'Guest' };
      }
    }

    const isOwner = room.owner.id === user.id;
    socket.data.watchParty = { roomId: normalizedRoomId, user, isOwner };
    socket.join(`party:${normalizedRoomId}`);
    room.members.add(socket.id);

    socket.emit('party:state', {
      ...buildWatchPartyState(room),
      isOwner,
    });

    io.to(`party:${normalizedRoomId}`).emit('party:members', {
      roomId: normalizedRoomId,
      membersCount: room.members.size,
    });
  });

  socket.on('party:control', ({ roomId, action, currentTime, isPlaying }) => {
    const data = socket.data.watchParty;
    const normalizedRoomId = String(roomId || '').trim();

    if (!data?.roomId || data.roomId !== normalizedRoomId) return;
    if (!data.isOwner) {
      socket.emit('party:error', { message: 'Samo owner može da kontroliše reprodukciju.' });
      return;
    }

    const room = watchPartyRooms.get(normalizedRoomId);
    if (!room) return;

    const safeTime = Number.isFinite(Number(currentTime)) ? Math.max(0, Number(currentTime)) : room.playback.currentTime;

    if (action === 'play') {
      room.playback = { isPlaying: true, currentTime: safeTime, updatedAt: Date.now() };
    } else if (action === 'pause') {
      room.playback = { isPlaying: false, currentTime: safeTime, updatedAt: Date.now() };
    } else if (action === 'seek') {
      const shouldPlay = typeof isPlaying === 'boolean' ? isPlaying : room.playback.isPlaying;
      room.playback = { isPlaying: shouldPlay, currentTime: safeTime, updatedAt: Date.now() };
    } else {
      return;
    }

    socket.to(`party:${normalizedRoomId}`).emit('party:playback', {
      roomId: normalizedRoomId,
      playback: room.playback,
    });
  });

  socket.on('party:chat', ({ roomId, text }) => {
    const data = socket.data.watchParty;
    const normalizedRoomId = String(roomId || '').trim();
    if (!data?.roomId || data.roomId !== normalizedRoomId) return;

    const clean = String(text || '').trim();
    if (!clean || clean.length > 200) return;

    io.to(`party:${normalizedRoomId}`).emit('party:chat', {
      roomId: normalizedRoomId,
      text: clean,
      user: data.user || { id: null, username: 'Guest' },
      at: new Date().toISOString(),
    });
  });

  socket.on('party:leave', () => {
    leaveWatchPartyIfAny();
  });

  // auto-join u chat na osnovu videa
  socket.on("chat:join", async ({ videoId, token }) => {
    const id = Number(videoId);
    if (!id) return;

    // 1) PROVERI DA LI JE VIDEO LIVE/STREAMING
    try {
      const r = await pool.query("SELECT is_live FROM videos WHERE id=$1", [id]);
      if (r.rows.length === 0) {
        socket.emit("chat:error", { message: "Video ne postoji." });
        return;
      }
      if (!r.rows[0].is_live) {
        socket.emit("chat:error", { message: "Live chat je dostupan samo tokom live streaming-a." });
        return;
      }
    } catch (e) {
      socket.emit("chat:error", { message: "Server error (chat join)." });
      return;
    }

    // opcionalno: user info iz tokena (ako postoji)
    let user = { id: null, username: "Guest" };
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        user.id = payload.id;
        user.username = payload.username || "Guest";
      } catch {
        // ignore invalid token
      }
    }

    socket.data.user = user;
    
    // 3) JOIN LIVE ROOM (razmena poruka samo između gledalaca tog videa)
    socket.join(`live:${id}`);
  });

  socket.on("chat:message", async ({ videoId, text }) => {
    const id = Number(videoId);
    if (!id) return;

    const clean = String(text || "").trim();
    if (!clean) return;
    if (clean.length > 200) return; // anti spam 

    // proveri da i dalje traje live (ako je stream završio, ne salji poruke)
    try {
      const r = await pool.query("SELECT is_live FROM videos WHERE id=$1", [id]);
      if (r.rows.length === 0 || !r.rows[0].is_live) return;
    } catch {
      return;
    }
    const user = socket.data.user || { id: null, username: "Guest" };

    // EMIT ISTO U LIVE ROOM 
    io.to(`live:${id}`).emit("chat:message", {
      videoId: id,
      text: clean,
      user,
      at: new Date().toISOString()
    });
  });

  socket.on("chat:leave", ({ videoId }) => {
    const id = Number(videoId);
    if (!id) return;
    socket.leave(`live:${id}`);
  });

  socket.on('disconnect', () => {
    leaveWatchPartyIfAny();
  });
});

server.listen(PORT, () => console.log(`Backend running on ${PORT}`));


(async function initBackground() {
  try {
    await ensureTranscodeColumns();
  } catch (e) {
    console.error("ensureTranscodeColumns failed (server stays up):", e?.message || e);
  }

  try {
    await Promise.all([
      ensureVideoScheduleColumns(),
      ensurePopularVideosTables(),
    ]);
  } catch (e) {
    console.error("schema ensure failed:", e?.message || e);
  }

  try {
    startNightlyRebuild();
  } catch (e) {
    console.error("startNightlyRebuild failed:", e?.message || e);
  }

  try {
    startNightlyThumbnailCompression();
  } catch (e) {
    console.error("startNightlyThumbnailCompression failed:", e?.message || e);
  }

  try {
    startDailyPopularVideosEtlJob();
  } catch (e) {
    console.error("startDailyPopularVideosEtlJob failed:", e?.message || e);
  }
})();
