-- Kreiranje indeksa za brže pretraživanje po lokaciji
-- Ovo će ubrzati tile-based upite na mapi

-- GIN indeks za JSONB lokaciju
CREATE INDEX IF NOT EXISTS idx_videos_location ON videos USING GIN (location);

-- Indeksi za latitude i longitude ekstraktovane iz JSONB
CREATE INDEX IF NOT EXISTS idx_videos_latitude 
  ON videos (((location->>'latitude')::numeric));

CREATE INDEX IF NOT EXISTS idx_videos_longitude 
  ON videos (((location->>'longitude')::numeric));

-- Composite indeks za oba (najbrži za bounding box upite)
CREATE INDEX IF NOT EXISTS idx_videos_lat_lng 
  ON videos (((location->>'latitude')::numeric), ((location->>'longitude')::numeric));

-- Provera da li indeksi postoje
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'videos' 
  AND indexname LIKE 'idx_videos_%';
