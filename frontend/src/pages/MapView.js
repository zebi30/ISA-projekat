import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import '../styles/MapView.css';

// Custom marker icon
const customMarker = new L.Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Map changes/Video loader component
function MapTileLoader({ onVideosUpdate }) {
  const map = useMap();
  const [loading, setLoading] = useState(false);

  const loadTileVideos = async () => {
    if (!map) return;

    setLoading(true);

    try {
      // Current bounds/zoom level
      const bounds = map.getBounds();
      const zoomLevel = map.getZoom();

      const params = new URLSearchParams({
        zoomLevel: zoomLevel,
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast()
      });

      // Tile API
      const response = await fetch(
        `http://localhost:5000/api/videos/tiles?${params}`
      );
      const data = await response.json();

      console.log(`📍 Zoom: ${zoomLevel} | Videos: ${data.count}/${data.totalCount} | Tiles: ${data.tiles.gridSize}x${data.tiles.gridSize}`);

      onVideosUpdate(data.videos, data);

    } catch (err) {
      console.error('Error loading tile videos:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load videos
  useEffect(() => {
    loadTileVideos();
  }, []);

  // Load videos when the map is "changing" (zoom, moving)
  useEffect(() => {
    const timer = setTimeout(loadTileVideos, 300); // Debounce: 300ms

    map.on('moveend', () => {
      clearTimeout(timer);
      setTimeout(loadTileVideos, 300);
    });

    map.on('zoomend', () => {
      clearTimeout(timer);
      setTimeout(loadTileVideos, 300);
    });

    return () => clearTimeout(timer);
  }, [map]);

  return null;
}

// Main MapView compoentn
export default function MapView() {
  const [videos, setVideos] = useState([]);
  const [tileInfo, setTileInfo] = useState(null);
  const [mapCenter] = useState([20, 0]); // center
  const [zoomLevel] = useState(3);

  const handleVideosUpdate = (newVideos, tileData) => {
    setVideos(newVideos);
    setTileInfo(tileData);
  };

  return (
    <div className="map-container">
      <h1> Napredna mapa video snimaka</h1>

      
      {tileInfo && (
        <div className="tile-info">
          <div className="info-item message">
            {tileInfo.message}
          </div>
        </div>
      )}

      {/* Map */}
      <MapContainer
        center={mapCenter}
        zoom={zoomLevel}
        style={{ height: '600px', width: '100%', marginTop: '20px' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />

        {/* Tile loader */}
        <MapTileLoader onVideosUpdate={handleVideosUpdate} />

        {/* Video markers */}
        {videos.map(video => (
          <Marker
            key={video.id}
            position={[video.location.latitude, video.location.longitude]}
            icon={customMarker}
          >
            <Popup>
              <div style={{ minWidth: '250px' }}>
                <h4 style={{ margin: '0 0 10px 0', cursor: 'pointer', color: '#667eea', textDecoration: 'underline' }}>
                  <a 
                    href={`/videos/${video.id}`}
                    style={{ color: '#667eea', textDecoration: 'none' }}
                    onClick={(e) => {
                      e.preventDefault();
                      window.location.href = `/videos/${video.id}`;
                    }}
                  >
                    {video.title}
                  </a>
                </h4>
                <p style={{ margin: '5px 0', color: '#666', fontSize: '13px' }}>
                  {video.description?.substring(0, 100)}...
                </p>
                <p style={{ fontSize: '12px', color: '#666', margin: '5px 0' }}>
                  👤 {video.first_name} {video.last_name}
                </p>
                <p style={{ fontSize: '12px', color: '#999', margin: '5px 0' }}>
                  👁️ {video.views} views | ❤️ {video.likes} likes
                </p>
                <p style={{ fontSize: '11px', color: '#aaa', margin: '5px 0' }}>
                  📍 {video.location.latitude.toFixed(4)}, {video.location.longitude.toFixed(4)}
                </p>
                <button 
                  onClick={() => window.location.href = `/videos/${video.id}`}
                  style={{
                    marginTop: '10px',
                    width: '100%',
                    padding: '8px',
                    background: '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  Otvori video →
                </button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
