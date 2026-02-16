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
const client = require('prom-client');

const videosRoutes = require("./routes/videos");
const thumbnailsRoutes = require("./routes/thumbnails");

const http = require("http");
const { Server } = require("socket.io");

const { startNightlyRebuild } = require("./jobs/rebuildMapTiles");
const { startNightlyThumbnailCompression } = require("./jobs/compressOldThumbnails");

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

function cleanupInactiveUsers() {
  const cutoff = Date.now() - ACTIVE_USERS_WINDOW_MS;
  for (const [visitorKey, lastSeen] of activeVisitorsLastSeenMap.entries()) {
    if (lastSeen < cutoff) {
      activeVisitorsLastSeenMap.delete(visitorKey);
    }
  }
  activeUsers24hGauge.set(activeVisitorsLastSeenMap.size);
}

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
    return xForwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown-ip';
}

function trackVisitorActivity(req, res, next) {
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
      const ip = getClientIp(req);
      const userAgent = req.headers['user-agent'] || 'unknown-agent';
      visitorKey = `guest:${ip}:${userAgent}`;
    }

    activeVisitorsLastSeenMap.set(visitorKey, Date.now());
  } catch {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown-agent';
    activeVisitorsLastSeenMap.set(`guest:${ip}:${userAgent}`, Date.now());
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

function collectAppMetrics() {
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

  cleanupInactiveUsers();
}

const metricsInterval = setInterval(collectAppMetrics, 5000);
metricsInterval.unref();
collectAppMetrics();

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
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">🎬 Jutjubić</h1>
            </div>
            
            <div style="background: white; padding: 40px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h2 style="color: #333; margin-top: 0;">Dobrodošli, ${first_name}!</h2>
              
              <p style="color: #666; font-size: 16px; line-height: 1.6;">
                Hvala što ste se registrovali na Jutjubić platformu! 
              </p>
              
              <p style="color: #666; font-size: 16px; line-height: 1.6;">
                Da biste aktivirali svoj nalog i počeli da koristite sve funkcionalnosti, molimo vas da kliknete na dugme ispod:
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${activationLink}" 
                   style="display: inline-block; background: #1976d2; color: white; padding: 15px 40px; 
                          text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                  Aktiviraj nalog
                </a>
              </div>
              
              <p style="color: #999; font-size: 14px; line-height: 1.6;">
                Ili kopirajte i nalepite sledeći link u vaš pretraživač:
              </p>
              <p style="color: #1976d2; font-size: 14px; word-break: break-all;">
                ${activationLink}
              </p>
              
              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
              
              <p style="color: #999; font-size: 12px; line-height: 1.6;">
                Ako niste vi zahtevali registraciju, molimo vas da ignorišete ovaj email.
              </p>
            </div>
          </div>
        `
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
    
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Nalog aktiviran</title>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; 
                   min-height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
            .container { background: white; padding: 60px 40px; border-radius: 16px; text-align: center; 
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 500px; }
            h1 { color: #2e7d32; font-size: 32px; margin-bottom: 20px; }
            p { color: #555; font-size: 18px; margin-bottom: 30px; }
            .icon { font-size: 80px; margin-bottom: 20px; }
            a { display: inline-block; background: #1976d2; color: white; padding: 15px 40px; 
                text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; }
            a:hover { background: #1565c0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">✓</div>
            <h1>Nalog uspešno aktiviran!</h1>
            <p>Čestitamo, ${user.first_name}! Vaš nalog je sada aktivan.</p>
            <p style="font-size: 16px; color: #666;">Možete se prijaviti i početi da koristite platformu.</p>
            <a href="${process.env.FRONTEND_URL}/login">Prijavi se</a>
          </div>
        </body>
      </html>
    `);
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

app.get('/api/videos/:id/comments', async (req, res) => {
  const { id } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 6;
  const offset = (page - 1) * limit;

  try {
    // Check Redis cache first
    const cachedData = await commentCache.get(id, page, limit);
    if (cachedData) {
      return res.json(cachedData);
    }

    // If not in cache, fetch from database
    console.log(`Cache MISS (Redis L2) for video ${id}, page ${page} - fetching from DB`);

    // Total comment count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM comments WHERE video_id = $1',
      [id]
    );
    const totalComments = parseInt(countResult.rows[0].count);

    // Get comments with user info (sorted by date newest 1st)
    const result = await pool.query(`
      SELECT c.id, c.content, c.created_at, 
             u.id as user_id, u.username, u.first_name, u.last_name
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.video_id = $1
      ORDER BY c.created_at DESC
      LIMIT $2 OFFSET $3
    `, [id, limit, offset]);

    const responseData = {
      comments: result.rows,
      pagination: {
        page,
        limit,
        totalComments,
        totalPages: Math.ceil(totalComments / limit),
        hasMore: page < Math.ceil(totalComments / limit)
      }
    };

    // Store in REdis cache
    await commentCache.set(id, page, limit, responseData);

    res.json(responseData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greska pri ucitavanju komentara.' });
  }
});

// Post comment with checks - invalidate redis cache after posting 
app.post('/api/videos/:id/comment', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const userId = req.user.id;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Komentar ne moze biti prazan.' });
  }

  if (content.length > 150) {
    return res.status(400).json({ error: 'Komentar ne sme biti duzi od 150 karaktera.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO comments (user_id, video_id, content) VALUES ($1, $2, $3) RETURNING *',
      [userId, id, content]
    );

    // Invalidate Redis cache for this video
    await commentCache.invalidateVideo(id);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greska pri dodavanju komentara.' });
  }
});

// Cache stats endpoint
app.get('/api/cache/stats', async (req, res) => {
  const stats = await commentCache.getStats();
  res.json(stats);
});

// Like
app.post('/api/videos/:id/like', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    // Check if already liked
    const existing = await pool.query(
      'SELECT * FROM likes WHERE user_id = $1 AND video_id = $2',
      [userId, id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Vec ste lajkovali ovaj video.' });
    }

    // Insert like and increment likes column
    await pool.query('BEGIN');
    
    const result = await pool.query(
      'INSERT INTO likes (user_id, video_id) VALUES ($1, $2) RETURNING *',
      [userId, id]
    );
    
    await pool.query(
      'UPDATE videos SET likes = likes + 1 WHERE id = $1',
      [id]
    );
    
    await pool.query('COMMIT');
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Greska pri lajkovanju videa.' });
  }
});

// Check if user has liked a video
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
app.delete('/api/videos/:id/like', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    await pool.query('BEGIN');
    
    const result = await pool.query(
      'DELETE FROM likes WHERE user_id = $1 AND video_id = $2 RETURNING *',
      [userId, id]
    );

    if (result.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Niste lajkovali ovaj video.' });
    }

    await pool.query(
      'UPDATE videos SET likes = GREATEST(likes - 1, 0) WHERE id = $1',
      [id]
    );
    
    await pool.query('COMMIT');

    res.json({ message: 'Lajk uklonjen.' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Greska pri uklanjanju lajka.' });
  }
});

// GET /api/videos/map - MORA BITI PRE /:id rute!
// Tile helper funkcija - izračunava tile koordinate na osnovu lat/lng
function getTileKey(lat, lng, tileSize = 0.1) {
  const tileX = Math.floor(lng / tileSize);
  const tileY = Math.floor(lat / tileSize);
  return `tile_${tileX}_${tileY}`;
}

// GET /api/videos/map/count - brz count videa sa lokacijom
app.get('/api/videos/map/count', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count 
       FROM videos 
       WHERE location IS NOT NULL
         AND (schedule_at IS NULL OR schedule_at <= NOW())`
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (e) {
    console.error('Error counting videos with location:', e);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/videos/map/bounds - min/max koordinate svih videa (za auto-centriranje)
app.get('/api/videos/map/bounds', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        MIN((location->>'latitude')::numeric) as minLat,
        MAX((location->>'latitude')::numeric) as maxLat,
        MIN((location->>'longitude')::numeric) as minLng,
        MAX((location->>'longitude')::numeric) as maxLng,
        COUNT(*) as count
       FROM videos 
         WHERE location IS NOT NULL
           AND (schedule_at IS NULL OR schedule_at <= NOW())`
    );
    
    const bounds = result.rows[0];
    
    if (!bounds.minlat) {
      return res.json({ bounds: null, count: 0 });
    }

    res.json({ 
      bounds: {
        minLat: parseFloat(bounds.minlat),
        maxLat: parseFloat(bounds.maxlat),
        minLng: parseFloat(bounds.minlng),
        maxLng: parseFloat(bounds.maxlng),
      },
      count: parseInt(bounds.count)
    });
  } catch (e) {
    console.error('Error getting video bounds:', e);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/videos/map - tile-based loading sa bounds
app.get('/api/videos/map', async (req, res) => {
  try {
    const { minLat, maxLat, minLng, maxLng, tileSize = 0.1 } = req.query;

    // Ako nema bounds parametara, vrati sve (fallback za kompatibilnost)
    if (!minLat || !maxLat || !minLng || !maxLng) {
      const result = await pool.query(
        `SELECT 
          v.id, 
          v.title,
          v.description,
          v.location,
          v.views,
          v.likes,
          v.created_at,
          v.is_live,
          u.username,
          u.first_name,
          u.last_name
         FROM videos v
         LEFT JOIN users u ON v.user_id = u.id
         WHERE v.location IS NOT NULL
           AND (v.schedule_at IS NULL OR v.schedule_at <= NOW())
         ORDER BY v.created_at DESC
         LIMIT 1000`
      );

      return res.json({ 
        videos: result.rows,
        count: result.rows.length,
        cached: false
      });
    }

    // Parse bounds
    const bounds = {
      minLat: parseFloat(minLat),
      maxLat: parseFloat(maxLat),
      minLng: parseFloat(minLng),
      maxLng: parseFloat(maxLng)
    };

    // Validacija
    if (isNaN(bounds.minLat) || isNaN(bounds.maxLat) || 
        isNaN(bounds.minLng) || isNaN(bounds.maxLng)) {
      return res.status(400).json({ message: "Invalid bounds parameters" });
    }

    // Generiši tile keys za sve tiles u vidljivom području
    const tiles = [];
    const tileSizeNum = parseFloat(tileSize);
    
    for (let lat = Math.floor(bounds.minLat / tileSizeNum) * tileSizeNum; 
         lat <= bounds.maxLat; 
         lat += tileSizeNum) {
      for (let lng = Math.floor(bounds.minLng / tileSizeNum) * tileSizeNum; 
           lng <= bounds.maxLng; 
           lng += tileSizeNum) {
        tiles.push(getTileKey(lat, lng, tileSizeNum));
      }
    }

    // Pokušaj da učitaš iz cache-a (Redis L2)
    const cacheKey = `map_tiles:${tiles.join(',')}`;
    let cachedData = null;
    
    try {
      if (commentCache.redisClient && commentCache.redisClient.isReady) {
        const cached = await commentCache.redisClient.get(cacheKey);
        if (cached) {
          cachedData = JSON.parse(cached);
          console.log(`[CACHE HIT] Map tiles: ${tiles.length} tiles`);
        }
      }
    } catch (cacheErr) {
      console.error('Cache read error:', cacheErr);
    }

    if (cachedData) {
      return res.json({ 
        ...cachedData,
        cached: true,
        tiles: tiles.length
      });
    }

    // Query sa bounding box filterom
    const result = await pool.query(
      `SELECT 
        v.id, 
        v.title,
        v.description,
        v.location,
        v.views,
        v.likes,
        v.created_at,
        u.username,
        u.first_name,
        u.last_name
       FROM videos v
       LEFT JOIN users u ON v.user_id = u.id
       WHERE v.location IS NOT NULL
         AND (v.schedule_at IS NULL OR v.schedule_at <= NOW())
         AND (v.location->>'latitude')::numeric >= $1
         AND (v.location->>'latitude')::numeric <= $2
         AND (v.location->>'longitude')::numeric >= $3
         AND (v.location->>'longitude')::numeric <= $4
       ORDER BY v.created_at DESC
       LIMIT 500`,
      [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng]
    );

    const responseData = {
      videos: result.rows,
      count: result.rows.length,
      bounds,
      tiles: tiles.length
    };

    // Keširanje rezultata (5 minuta TTL)
    try {
      if (commentCache.redisClient && commentCache.redisClient.isReady) {
        await commentCache.redisClient.setEx(
          cacheKey, 
          300, // 5 minuta
          JSON.stringify(responseData)
        );
        console.log(`[CACHE SET] Map tiles: ${tiles.length} tiles, ${result.rows.length} videos`);
      }
    } catch (cacheErr) {
      console.error('Cache write error:', cacheErr);
    }

    res.json({ 
      ...responseData,
      cached: false
    });
  } catch (e) {
    console.error('Error fetching video locations:', e);
    res.status(500).json({ message: "Server error" });
  }
});

// Get a singular video via id (public)
app.get("/api/videos/:id", blockScheduledVideoAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid video id" });

  try {
    const result = await pool.query(
      `
      SELECT v.id, v.title, v.description, v.video_path, v.thumbnail, v.views, v.likes, v.created_at, v.is_live,  v.schedule_at,
            v.transcode_status, emphasize_outputs, v.transcode_error,
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

// Watch video endpoint - increments views count
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
app.post("/api/videos/:id/live/start", authMiddleware, async (req, res) => {
  const videoId = Number(req.params.id);
  const userId = req.user.id;

  if (!videoId) return res.status(400).json({ error: "Invalid video id" });

  try {
    // proveri da video postoji i da je vlasnik isti user
    const check = await pool.query(
      "SELECT id, user_id, is_live FROM videos WHERE id = $1",
      [videoId]
    );

    if (check.rows.length === 0) return res.status(404).json({ error: "Video ne postoji." });

    const video = check.rows[0];
    if (Number(video.user_id) !== Number(userId)) {
      return res.status(403).json({ error: "Nemate pravo da startujete live za ovaj video." });
    }

    // set live = true
    const upd = await pool.query(
      "UPDATE videos SET is_live = true WHERE id = $1 RETURNING id, is_live",
      [videoId]
    );

    return res.json({ message: "Live startovan.", video: upd.rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});


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

//app.listen(PORT, () => console.log(`Backend running on ${PORT}`));
const server = http.createServer(app);      //real time razmena poruka, kad neko udje na video -> automatski se pridruzi chatroomu, ne cuva se istorija

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// ---- CHAT LOGIC (NO HISTORY) ----
io.on("connection", (socket) => {
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
});

async function startServer() {
  // ovde inicijalizuj sve pre nego sto server krene da prima requestove
  await ensureTranscodeColumns();

  await Promise.all([
    ensureVideoScheduleColumns(),
    ensurePopularVideosTables(),
  ]);

  startNightlyRebuild();
  startNightlyThumbnailCompression();
  startDailyPopularVideosEtlJob();

  server.listen(PORT, () => console.log(`Backend running on ${PORT}`));
}

startServer().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});

(async function initBackground() {
  try {
    await ensureTranscodeColumns();
  } catch (e) {
    console.error("ensureTranscodeColumns failed (server stays up):", e?.message || e);
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
})();
