import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix za default ikone
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Komponenta za klik na mapu
function LocationMarker({ position, setPosition }) {
  useMapEvents({
    click(e) {
      setPosition(e.latlng);
    },
  });

  return position === null ? null : (
    <Marker position={position} />
  );
}

export default function UploadVideoPage() {
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [locationPosition, setLocationPosition] = useState(null); // {lat, lng}
  const [locationName, setLocationName] = useState(""); // opciono ime
  const [video, setVideo] = useState(null);
  const [thumbnail, setThumbnail] = useState(null);

  const [msg, setMsg] = useState("");
  const [uploadedVideoId, setUploadedVideoId] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setMsg("");
    setUploadedVideoId(null);

    // validacija
    if (!video || !thumbnail) {
      setMsg("Moraš izabrati video (mp4) i thumbnail.");
      return;
    }

    const fd = new FormData();
    fd.append("title", title);
    fd.append("description", description);
    fd.append("tags", tags);
    
    // Šalji lokaciju kao JSON objekat
    if (locationPosition) {
      const locationObj = {
        latitude: locationPosition.lat,
        longitude: locationPosition.lng,
      };
      if (locationName.trim()) {
        locationObj.address = locationName.trim();
      }
      fd.append("location", JSON.stringify(locationObj));
    }
    
    fd.append("video", video);
    fd.append("thumbnail", thumbnail);

    const token = localStorage.getItem("token");
    if (!token) {
      setMsg("Moraš biti ulogovan da bi uploadovao.");
      return;
    }

    try {
      const res = await fetch("http://localhost:5000/api/videos", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMsg(data.message || data.error || "Upload failed");
        return;
      }

      // uspeh
      setMsg("✅ Uspešno uploadovan video!");
      setUploadedVideoId(data.id);

      // (opciono) očisti formu
      setTitle("");
      setDescription("");
      setTags("");
      setLocationPosition(null);
      setLocationName("");
      setVideo(null);
      setThumbnail(null);
    } catch (err) {
      setMsg("Greška: ne mogu da pošaljem upload (server down?)");
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "24px auto" }}>
      <h2>Upload video</h2>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input
          placeholder="Naslov"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <textarea
          placeholder="Opis"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <input
          placeholder="Tagovi (npr: gym, travel, motivation)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />

        {/* Mapa za odabir lokacije */}
        <div style={{ marginTop: 12 }}>
          <label style={{ fontWeight: 600, marginBottom: 8, display: 'block' }}>
            Lokacija (opciono) - Klikni na mapu da odabereš lokaciju:
          </label>
          
          <div style={{ height: 300, border: '2px solid #ddd', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
            <MapContainer
              center={[44.0165, 21.0059]} // Centar Srbije
              zoom={7}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <LocationMarker position={locationPosition} setPosition={setLocationPosition} />
            </MapContainer>
          </div>
          
          {locationPosition && (
            <div style={{ padding: 12, background: '#f0f0f0', borderRadius: 8, fontSize: 14 }}>
              <strong>Odabrana lokacija:</strong><br/>
              Latitude: {locationPosition.lat.toFixed(6)}<br/>
              Longitude: {locationPosition.lng.toFixed(6)}
              
              <input
                type="text"
                placeholder="Naziv lokacije (opciono, npr. Beograd)"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                style={{ 
                  marginTop: 8, 
                  width: '100%', 
                  padding: 8,
                  border: '1px solid #ccc',
                  borderRadius: 4
                }}
              />
              
              <button
                type="button"
                onClick={() => {
                  setLocationPosition(null);
                  setLocationName("");
                }}
                style={{
                  marginTop: 8,
                  padding: '6px 12px',
                  background: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                Ukloni lokaciju
              </button>
            </div>
          )}
        </div>

        <div>
          <div>Thumbnail (slika):</div>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setThumbnail(e.target.files?.[0] || null)}
          />
        </div>

        <div>
          <div>Video (mp4, max 200MB):</div>
          <input
            type="file"
            accept="video/mp4"
            onChange={(e) => setVideo(e.target.files?.[0] || null)}
          />
        </div>

        <button
          type="submit"
          style={{
            background: "#439cfb",
            color: "white",
            border: "none",
            padding: "10px 14px",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Upload
        </button>

        {msg && <div>{msg}</div>}

        {/* dugme se pojavi TEK posle uspeha */}
        {uploadedVideoId && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => navigate(`/videos/${uploadedVideoId}`)}
              style={{
                padding: "10px 16px",
                background: "#111",
                color: "white",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              ▶️ Pogledaj video
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
