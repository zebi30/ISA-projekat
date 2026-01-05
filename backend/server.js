require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

// PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

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
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste prijavljeni.' });

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    req.user = user;
    next();
  } catch {
    return res.status(403).json({ error: 'Nevažeći token.' });
  }
};

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});