require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require("path");
const commentCache = require('./services/commentCache');
const rateLimiter = require('./middlewares/rateLimiter');

const videosRoutes = require("./routes/videos");
const thumbnailsRoutes = require("./routes/thumbnails");

const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

// PostgreSQL pool
const pool = require("./pool");

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

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
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

// All videos sorted by date (newest first)
app.get('/api/videos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.id, v.title, v.description, v.thumbnail, v.created_at, v.likes, v.views,
             u.id as user_id, u.username, u.first_name, u.last_name
      FROM videos v
      JOIN users u ON v.user_id = u.id
      ORDER BY v.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greska pri ucitavanju videa.'});
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
      'SELECT id, title, description, thumbnail, created_at FROM videos WHERE user_id = $1 ORDER BY created_at DESC',
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

// Get a singular video via id (public)
app.get("/api/videos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid video id" });

  try {
    const result = await pool.query(
      `
      SELECT v.id, v.title, v.description, v.video_path, v.thumbnail, v.views, v.likes, v.created_at,
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

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Watch video endpoint - increments views count
app.post("/api/videos/:id/watch", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid video id" });

  try {
    // Increment views
    await pool.query(
      'UPDATE videos SET views = views + 1 WHERE id = $1',
      [id]
    );

    // Get video data
    const result = await pool.query(
      `
      SELECT v.id, v.title, v.description, v.video_path, v.thumbnail, v.views, v.likes, v.created_at,
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

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

//Kreiranje ruta za video i thumbnail 
// statički pristup video fajlovima (video_path koristi ovo)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// IMPORTANT: Specific routes MUST come BEFORE generic app.use("/api/videos", videosRoutes)
// Otherwise videosRoutes will catch all /api/videos/* routes

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

// Get a singular video via id (public)
app.get("/api/videos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid video id" });

  try {
    const result = await pool.query(
      `
      SELECT v.id, v.title, v.description, v.video_path, v.thumbnail, v.views, v.likes, v.created_at,
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

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Watch video endpoint - increments views count
app.post("/api/videos/:id/watch", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid video id" });

  try {
    // Increment views
    await pool.query(
      'UPDATE videos SET views = views + 1 WHERE id = $1',
      [id]
    );

    // Get video data
    const result = await pool.query(
      `
      SELECT v.id, v.title, v.description, v.video_path, v.thumbnail, v.views, v.likes, v.created_at,
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

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.use("/api/videos", videosRoutes);
app.use("/api/thumbnails", thumbnailsRoutes);

// error handler (da vraća poruku)
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || "Server error",
  });
});

app.listen(PORT, () => console.log(`Backend running on ${PORT}`));