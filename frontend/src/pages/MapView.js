import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix za default ikone u Leaflet sa Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Komponenta koja prati promene bounds-a mape
function MapBoundsHandler({ onBoundsChange }) {
  const map = useMap();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && map) {
      const bounds = map.getBounds();
      onBoundsChange({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
      });
      setInitialized(true);
    }
  }, [map, initialized, onBoundsChange]);

  useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      onBoundsChange({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
      });
    },
    zoomend: () => {
      const bounds = map.getBounds();
      onBoundsChange({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
      });
    },
  });

  return null;
}



export default function MapView() {
  const navigate = useNavigate();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [stats, setStats] = useState({ cached: false, tiles: 0 });
  const [videosCount, setVideosCount] = useState(0);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Default centar - Srbija (ako nema videa)
  const defaultCenter = [44.0165, 21.0059];
  const defaultZoom = 7;

  // Učitaj inicijalne bounds i count pri mount-u
  useEffect(() => {
    async function loadInitialData() {
      try {
        // Proveri count
        const countRes = await fetch('http://localhost:5000/api/videos/map/count');
        const countData = await countRes.json();
        setVideosCount(countData.count);
      } catch (err) {
        console.error('Error loading initial data:', err);
      } finally {
        setLoading(false);
        setInitialLoadDone(true);
      }
    }

    loadInitialData();
  }, []);

  const loadVideosWithBounds = useCallback(async (mapBounds) => {
    if (!mapBounds) return;
    
    setError(null);
    
    try {
      const params = new URLSearchParams({
        minLat: mapBounds.minLat.toString(),
        maxLat: mapBounds.maxLat.toString(),
        minLng: mapBounds.minLng.toString(),
        maxLng: mapBounds.maxLng.toString(),
        tileSize: '0.1'
      });

      const res = await fetch(`http://localhost:5000/api/videos/map?${params}`);
      if (!res.ok) {
        throw new Error('Greška pri učitavanju video lokacija');
      }
      const data = await res.json();
      
      setVideos(data.videos || []);
      setStats({
        cached: data.cached || false,
        tiles: data.tiles || 0
      });

      console.log(`Loaded ${data.count} videos, ${data.tiles} tiles, cached: ${data.cached}`);
    } catch (err) {
      console.error('Error loading video locations:', err);
      setError(err.message);
    }
  }, []);

  const handleBoundsChange = useCallback((newBounds) => {
    setBounds(newBounds);
    loadVideosWithBounds(newBounds);
  }, [loadVideosWithBounds]);

  const handleMarkerClick = (videoId) => {
    navigate(`/watch/${videoId}`);
  };

  if (!initialLoadDone) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <div>Učitavanje mape...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <h3 style={{ color: 'red' }}>Greška: {error}</h3>
        <button 
          onClick={() => navigate('/')}
          style={{ 
            marginTop: 20, 
            padding: '10px 20px',
            cursor: 'pointer' 
          }}
        >
          Nazad na početnu
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ 
        padding: '20px', 
        background: '#1976d2', 
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <h2 style={{ margin: 0, marginBottom: 4 }}>
            Mapa Video Snimaka ({videosCount})
          </h2>
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            {stats.tiles > 0 && `📍 ${stats.tiles} tile${stats.tiles !== 1 ? 's' : ''} • `}
            {videos.length} videa u vidljivom području
            {stats.cached && ' • ⚡ Keš'}
          </div>
        </div>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: 'white',
            color: '#1976d2',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          ← Nazad na početnu
        </button>
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative' }}>
        {videosCount === 0 ? (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center',
            height: '100%',
            fontSize: 18,
            color: '#666'
          }}>
            Nema videa sa lokacijom
          </div>
        ) : (
          <MapContainer
            center={defaultCenter}
            zoom={defaultZoom}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            
            <MapBoundsHandler onBoundsChange={handleBoundsChange} />
            
            {videos.map((video) => (
              <Marker
                key={video.id}
                position={[video.location.latitude, video.location.longitude]}
                eventHandlers={{
                  click: () => handleMarkerClick(video.id)
                }}
              >
                <Popup>
                  <div style={{ minWidth: 200 }}>
                    <h4 style={{ marginTop: 0, marginBottom: 8 }}>
                      {video.title}
                    </h4>
                    <p style={{ margin: '4px 0', fontSize: 13, color: '#666' }}>
                      @{video.username}
                    </p>
                    <p style={{ margin: '4px 0', fontSize: 13 }}>
                      👁 {video.views || 0} pregleda
                    </p>
                    {video.location.address && (
                      <p style={{ margin: '4px 0', fontSize: 12, color: '#888' }}>
                        📍 {video.location.address}
                      </p>
                    )}
                    <button
                      onClick={() => handleMarkerClick(video.id)}
                      style={{
                        marginTop: 10,
                        padding: '6px 12px',
                        background: '#1976d2',
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer',
                        width: '100%',
                        fontWeight: 600
                      }}
                    >
                      Pogledaj video
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>
    </div>
  );
}
