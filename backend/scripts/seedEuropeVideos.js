const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Učitaj environment varijable
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Kreiraj pool direktno za skriptu
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Evropa koordinate
const EUROPE_BOUNDS = {
  minLat: 35.0,   // Južna Evropa (Sicilija, Krit)
  maxLat: 71.0,   // Severna Evropa (Nordkapp)
  minLng: -10.0,  // Zapadna Evropa (Portugal)
  maxLng: 40.0    // Istočna Evropa (Rusija)
};

// Veće gradove za reference
const EUROPEAN_CITIES = [
  { name: 'Beograd', lat: 44.8176, lng: 20.4633 },
  { name: 'London', lat: 51.5074, lng: -0.1278 },
  { name: 'Paris', lat: 48.8566, lng: 2.3522 },
  { name: 'Berlin', lat: 52.5200, lng: 13.4050 },
  { name: 'Madrid', lat: 40.4168, lng: -3.7038 },
  { name: 'Roma', lat: 41.9028, lng: 12.4964 },
  { name: 'Amsterdam', lat: 52.3676, lng: 4.9041 },
  { name: 'Prag', lat: 50.0755, lng: 14.4378 },
  { name: 'Budimpešta', lat: 47.4979, lng: 19.0402 },
  { name: 'Atina', lat: 37.9838, lng: 23.7275 },
  { name: 'Stockholm', lat: 59.3293, lng: 18.0686 },
  { name: 'Oslo', lat: 59.9139, lng: 10.7522 },
  { name: 'Kopenhagen', lat: 55.6761, lng: 12.5683 },
  { name: 'Varšava', lat: 52.2297, lng: 21.0122 },
  { name: 'Beč', lat: 48.2082, lng: 16.3738 },
  { name: 'Lisabon', lat: 38.7223, lng: -9.1393 },
  { name: 'Moskva', lat: 55.7558, lng: 37.6173 }
];

function getRandomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomLocation() {
  // 70% šanse da bude u blizini velikih gradova, 30% potpuno nasumično
  if (Math.random() < 0.7) {
    const city = EUROPEAN_CITIES[Math.floor(Math.random() * EUROPEAN_CITIES.length)];
    // Dodaj nasumični offset (do 2 stepena u svakom pravcu)
    return {
      latitude: city.lat + getRandomFloat(-2, 2),
      longitude: city.lng + getRandomFloat(-2, 2),
      address: `Blizu ${city.name}`
    };
  } else {
    // Potpuno nasumična lokacija u Evropi
    return {
      latitude: getRandomFloat(EUROPE_BOUNDS.minLat, EUROPE_BOUNDS.maxLat),
      longitude: getRandomFloat(EUROPE_BOUNDS.minLng, EUROPE_BOUNDS.maxLng),
      address: 'Nasumična lokacija u Evropi'
    };
  }
}

async function seedEuropeVideos() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Započinjem generisanje 5000 test videa...\n');

    // Proveri da li postoji test user
    let testUser = await client.query(
      `SELECT id FROM users WHERE username = 'test_europe' LIMIT 1`
    );

    if (testUser.rows.length === 0) {
      console.log('Kreiram test korisnika...');
      testUser = await client.query(
        `INSERT INTO users (username, email, password, first_name, last_name, address) 
         VALUES ('test_europe', 'test_europe@example.com', '$2b$10$dummy.hash.for.testing.purposes.only.abc123', 'Test', 'Europe', 'Test Address 123') 
         RETURNING id`
      );
    }

    const userId = testUser.rows[0].id;
    console.log(`✓ Koristim test korisnika ID: ${userId}\n`);

    // Pripremi test video fajl
    const sourceVideoPath = path.join(__dirname, 'test_video.mp4');
    const targetVideoPath = path.join(__dirname, '..', 'uploads', 'videos', 'test_seed_video.mp4');
    const targetThumbPath = path.join(__dirname, '..', 'uploads', 'thumbs', 'test_seed_thumb.jpg');
    
    let videoPath = 'uploads/videos/test_seed_video.mp4';
    let thumbnailPath = 'uploads/thumbs/test_seed_thumb.jpg';

    // Proveri da li postoji source video
    if (fs.existsSync(sourceVideoPath)) {
      console.log('Kopiram test video fajl...');
      
      // Kreiraj direktorijume ako ne postoje
      const videosDir = path.join(__dirname, '..', 'uploads', 'videos');
      const thumbsDir = path.join(__dirname, '..', 'uploads', 'thumbs');
      
      if (!fs.existsSync(videosDir)) {
        fs.mkdirSync(videosDir, { recursive: true });
      }
      if (!fs.existsSync(thumbsDir)) {
        fs.mkdirSync(thumbsDir, { recursive: true });
      }
      
      // Kopiraj video ako već ne postoji
      if (!fs.existsSync(targetVideoPath)) {
        fs.copyFileSync(sourceVideoPath, targetVideoPath);
        console.log(`✓ Video kopiran: ${videoPath}`);
      } else {
        console.log(`✓ Video već postoji: ${videoPath}`);
      }
      
      // Kreiraj dummy thumbnail (prazna slika 1x1 pixel)
      if (!fs.existsSync(targetThumbPath)) {
        // Kreiraj minimalni JPG fajl (Base64 encoded 1x1 pixel)
        const dummyJpg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==', 'base64');
        fs.writeFileSync(targetThumbPath, dummyJpg);
        console.log(`✓ Thumbnail kreiran: ${thumbnailPath}\n`);
      } else {
        console.log(`✓ Thumbnail već postoji: ${thumbnailPath}\n`);
      }
    } else {
      console.log(`⚠ UPOZORENJE: Fajl ${sourceVideoPath} ne postoji!`);
      console.log(`   Pokušavam da koristim postojeći video iz baze...\n`);
      
      // Pokušaj sa postojećim videom iz baze
      const existingVideo = await client.query(
        `SELECT video_path, thumbnail_path FROM videos WHERE video_path IS NOT NULL LIMIT 1`
      );
      
      if (existingVideo.rows.length > 0) {
        videoPath = existingVideo.rows[0].video_path;
        thumbnailPath = existingVideo.rows[0].thumbnail_path;
        console.log(`✓ Koristim postojeći video: ${videoPath}\n`);
      } else {
        console.log(`⚠ UPOZORENJE: Nema video fajla - test videi neće raditi!\n`);
      }
    }

    const BATCH_SIZE = 100;
    const TOTAL_VIDEOS = 5000;
    let inserted = 0;

    console.log('Ubacujem videe u bazu...\n');

    for (let i = 0; i < TOTAL_VIDEOS; i += BATCH_SIZE) {
      const batchSize = Math.min(BATCH_SIZE, TOTAL_VIDEOS - i);
      const values = [];
      const placeholders = [];

      for (let j = 0; j < batchSize; j++) {
        const videoNum = i + j + 1;
        const location = generateRandomLocation();
        
        const offset = j * 7;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`
        );

        values.push(
          userId,
          `Test Video ${videoNum} - ${location.address}`,
          `Automatski generisan test video broj ${videoNum} za testiranje tile sistema. Lokacija: ${location.address}`,
          videoPath,
          thumbnailPath,
          JSON.stringify(location),
          getRandomInt(0, 10000) // nasumičan broj pregleda
        );
      }

      const query = `
        INSERT INTO videos (user_id, title, description, video_path, thumbnail, location, views)
        VALUES ${placeholders.join(', ')}
      `;

      await client.query(query, values);
      inserted += batchSize;

      // Progress bar
      const progress = ((inserted / TOTAL_VIDEOS) * 100).toFixed(1);
      const bar = '█'.repeat(Math.floor(progress / 2)) + '░'.repeat(50 - Math.floor(progress / 2));
      process.stdout.write(`\r[${bar}] ${progress}% (${inserted}/${TOTAL_VIDEOS})`);
    }

    console.log('\n\n✅ Uspešno ubačeno 5000 test videa!\n');

    // Statistika
    const stats = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT user_id) as users,
        MIN((location->>'latitude')::numeric) as min_lat,
        MAX((location->>'latitude')::numeric) as max_lat,
        MIN((location->>'longitude')::numeric) as min_lng,
        MAX((location->>'longitude')::numeric) as max_lng
      FROM videos
      WHERE location IS NOT NULL
    `);

    console.log('📊 Statistika videa sa lokacijom:');
    console.log(`   Ukupno: ${stats.rows[0].total}`);
    console.log(`   Korisnika: ${stats.rows[0].users}`);
    console.log(`   Geografski opseg:`);
    console.log(`     Latitude:  ${stats.rows[0].min_lat}° do ${stats.rows[0].max_lat}°`);
    console.log(`     Longitude: ${stats.rows[0].min_lng}° do ${stats.rows[0].max_lng}°`);
    console.log('\n✨ Spremno za testiranje tile sistema!\n');

  } catch (error) {
    console.error('\n❌ Greška pri generisanju videa:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Pokreni skriptu
if (require.main === module) {
  seedEuropeVideos()
    .then(() => {
      console.log('🎉 Skripta uspešno završena!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('💥 Skripta neuspešna:', err);
      process.exit(1);
    });
}

module.exports = { seedEuropeVideos };
