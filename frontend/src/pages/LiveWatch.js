import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

export default function LiveWatch() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);

  // chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const socketRef = useRef(null);

  // ucitaj video (bez increment views ako ne želiš)
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

        // mora da bude live
        if (!data.is_live) {
          alert("Ovaj video nije u live režimu.");
          navigate(`/watch/${id}`); // ili "/" ako nemaš watch rutu
          return;
        }

        setVideo(data);
      } catch (e) {
        alert("Greška pri učitavanju live videa.");
        navigate("/");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  // socket connect ONLY za live
  useEffect(() => {
    if (!id) return;
    if (!video?.is_live) return;

    const socket = io("http://localhost:5000", { transports: ["websocket"] });
    socketRef.current = socket;

    socket.emit("chat:join", { videoId: id, token: localStorage.getItem("token") });

    socket.on("chat:message", (msg) => {
      if (Number(msg.videoId) !== Number(id)) return;
      setChatMessages((prev) => [...prev, msg]);
    });

    socket.on("chat:error", (e) => {
      alert(e?.message || "Chat error");
    });

    return () => {
      try {
        socket.emit("chat:leave", { videoId: id });
        socket.disconnect();
      } catch {}
    };
  }, [id, video?.is_live]);

  const sendChatMessage = (e) => {
    e.preventDefault();
    const clean = chatText.trim();
    if (!clean) return;

    socketRef.current?.emit("chat:message", { videoId: id, text: clean });
    setChatText("");
  };

  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;
  if (!video) return null;

  const base = "http://localhost:5000";
  const videoUrl = video.video_path?.startsWith("http")
    ? video.video_path
    : `${base}${video.video_path}`;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      <button
        onClick={() => navigate("/")}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #ddd",
          cursor: "pointer",
          background: "white",
          fontWeight: 600,
          marginBottom: 12
        }}
      >
        ← Nazad
      </button>

      {/* LIVE badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{
          background: "#e53935",
          color: "white",
          padding: "4px 10px",
          borderRadius: 999,
          fontWeight: 800,
          fontSize: 12
        }}>
          LIVE
        </span>
        <div style={{ color: "#666", fontSize: 14 }}>
          @{video.username || "unknown"}
        </div>
      </div>

      {/* Player */}
      <div style={{ background: "#000", borderRadius: 12, overflow: "hidden" }}>
        <video src={videoUrl} controls autoPlay style={{ width: "100%", maxHeight: 520 }} />
      </div>

      <h2 style={{ marginTop: 16 }}>{video.title}</h2>

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

      {/* LIVE CHAT */}
      <div style={{ marginTop: 28, padding: 16, border: "1px solid #e0e0e0", borderRadius: 12, background: "white" }}>
        <h3 style={{ marginTop: 0 }}>💬 Live chat</h3>

        <div style={{
          height: 260,
          overflowY: "auto",
          border: "1px solid #eee",
          borderRadius: 10,
          padding: 10,
          background: "#fafafa"
        }}>
          {chatMessages.length === 0 ? (
            <div style={{ color: "#999" }}>Nema poruka još.</div>
          ) : (
            chatMessages.map((m, idx) => (
              <div key={idx} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: "#666" }}>
                  <b>{m.user?.username || "Guest"}</b> • {new Date(m.at).toLocaleTimeString("sr-RS")}
                </div>
                <div style={{ fontSize: 14, color: "#333" }}>{m.text}</div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={sendChatMessage} style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="Napiši poruku..."
            maxLength={200}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd"
            }}
          />
          <button
            type="submit"
            disabled={!chatText.trim()}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              background: !chatText.trim() ? "#ccc" : "#1976d2",
              color: "white",
              fontWeight: 700,
              cursor: !chatText.trim() ? "not-allowed" : "pointer"
            }}
          >
            Pošalji
          </button>
        </form>
      </div>
    </div>
  );
}
