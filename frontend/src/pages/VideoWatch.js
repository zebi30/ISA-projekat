import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

export default function VideoWatch() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`http://localhost:5000/api/videos/${id}`);
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          alert(data.message || data.error || "Video nije pronađen");
          navigate("/");
          return;
        }

        setVideo(data);
      } catch (e) {
        alert("Greška pri učitavanju videa.");
        navigate("/");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;
  if (!video) return null;

  const base = "http://localhost:5000";
  const videoUrl = video.video_path?.startsWith("http")
    ? video.video_path
    : `${base}${video.video_path}`;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      <div style={{ background: "#000", borderRadius: 12, overflow: "hidden" }}>
        <video src={videoUrl} controls style={{ width: "100%", maxHeight: 520 }} />
      </div>

      <h2 style={{ marginTop: 16 }}>{video.title}</h2>

      <div style={{ color: "#666", marginTop: 6 }}>
        @{video.username || "unknown"} •{" "}
        {video.created_at ? new Date(video.created_at).toLocaleString("sr-RS") : ""}
      </div>

      {video.description && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            background: "#f7f7f7",
            borderRadius: 12,
            whiteSpace: "pre-wrap"
          }}
        >
          {video.description}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => navigate("/")}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            cursor: "pointer",
            background: "white",
            fontWeight: 600
          }}
        >
          ← Nazad
        </button>
      </div>
    </div>
  );
}
