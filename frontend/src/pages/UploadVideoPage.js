import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function UploadVideoPage() {
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [location, setLocation] = useState("");
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
    if (location.trim()) fd.append("location", location);
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
      setLocation("");
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

        <input
          placeholder='Lokacija JSON (opciono) npr {"lat":45.26,"lng":19.83,"name":"NS"}'
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />

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
