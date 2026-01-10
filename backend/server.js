require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require("path");

const videosRoutes = require("./routes/videos");
const thumbnailsRoutes = require("./routes/thumbnails");

const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

// PostgreSQL pool
const pool = require("./pool");

// Rate limiter (5 requests per minute per IP)
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
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
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Aktivirajte nalog',
      html: `<p>Kliknite na link da aktivirate nalog: <a href="${activationLink}">${activationLink}</a></p>`
    });

    res.json({ message: 'Registracija uspešna! Proverite email za aktivaciju.' });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') res.status(400).json({ error: 'Email ili korisničko ime već postoji.' });
    else res.status(500).json({ error: 'Greška na serveru.' });
  }
});

app.get('/activate/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const result = await pool.query(
      'UPDATE users SET is_active = true, activation_token = NULL WHERE activation_token = $1 RETURNING id',
      [token]
    );

    if (result.rowCount === 0) return res.status(400).send('Nevažeći token.');
    res.send('Nalog aktiviran! Možete se prijaviti.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Greška na serveru.');
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
      SELECT v.id, v.title, v.description, v.thumbnail, v.created_at, u.id as user_id, u.username, u.first_name, u.last_name
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

// COmment
app.post('/api/videos/:id/comment', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const userId = req.user.id;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Komentar ne može biti prazan.' });
  }

  if (content.length > 60) {
    return res.status(400).json({ error: 'Komentar ne sme biti duži od 60 karaktera.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO comments (user_id, video_id, content) VALUES ($1, $2, $3) RETURNING *',
      [userId, id, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greska pri dodavanju komentara.' });
  }
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

    const result = await pool.query(
      'INSERT INTO likes (user_id, video_id) VALUES ($1, $2) RETURNING *',
      [userId, id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greska pri lajkovanju videa.' });
  }
});

// Delete the like
app.delete('/api/videos/:id/like', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const result = await pool.query(
      'DELETE FROM likes WHERE user_id = $1 AND video_id = $2 RETURNING *',
      [userId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Niste lajkovali ovaj video.' });
    }

    res.json({ message: 'Lajk uklonjen.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greska pri uklanjanju lajka.' });
  }
});

// Get single video by id (public)
app.get("/api/videos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid video id" });

  try {
    const result = await pool.query(
      `
      SELECT v.id, v.title, v.description, v.video_path, v.thumbnail, v.created_at,
             u.id as user_id, u.username, u.first_name, u.last_name
      FROM videos v
      JOIN users u ON v.user_id = u.id
      WHERE v.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Video nije pronađen" });
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