import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { getVideoById, getWatchPartyRoom } from "../services/api";

function getExpectedTime(playback) {
  if (!playback) return 0;
  const base = Number(playback.currentTime) || 0;
  if (!playback.isPlaying) return Math.max(0, base);
  const elapsed = Math.max(0, (Date.now() - Number(playback.updatedAt || Date.now())) / 1000);
  return Math.max(0, base + elapsed);
}

export default function WatchPartyRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [room, setRoom] = useState(null);
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [membersCount, setMembersCount] = useState(1);

  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");

  const socketRef = useRef(null);
  const videoRef = useRef(null);
  const applyingRemoteRef = useRef(false);
  const roomPlaybackRef = useRef({ isPlaying: false, currentTime: 0, updatedAt: Date.now() });

  useEffect(() => {
    let canceled = false;

    async function bootstrap() {
      setLoading(true);
      setError("");
      try {
        const roomData = await getWatchPartyRoom(roomId);
        if (canceled) return;

        const videoData = await getVideoById(roomData.videoId);
        if (canceled) return;

        setRoom(roomData);
        setVideo(videoData);
        setMembersCount(roomData.membersCount || 1);
      } catch (e) {
        if (!canceled) {
          setError(e.message || "Ne mogu da učitam Watch Party sobu.");
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      canceled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!video?.id) return;

    const socket = io("http://localhost:5000", { transports: ["websocket"] });
    socketRef.current = socket;

    socket.emit("party:join", {
      roomId,
      token: localStorage.getItem("token"),
    });

    socket.on("party:state", (payload) => {
      setRoom(payload);
      setIsOwner(Boolean(payload.isOwner));
      setMembersCount(payload.membersCount || 1);

      const element = videoRef.current;
      if (!element || !payload.playback) return;

      const expected = getExpectedTime(payload.playback);
      roomPlaybackRef.current = payload.playback;
      applyingRemoteRef.current = true;
      element.currentTime = expected;
      if (payload.playback.isPlaying) {
        element.play().catch(() => {});
      } else {
        element.pause();
      }
      setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 0);
    });

    socket.on("party:members", (payload) => {
      if (payload?.roomId !== roomId) return;
      setMembersCount(payload.membersCount || 1);
    });

    socket.on("party:playback", (payload) => {
      if (payload?.roomId !== roomId) return;
      const element = videoRef.current;
      if (!element || !payload.playback) return;

      const expected = getExpectedTime(payload.playback);
      roomPlaybackRef.current = payload.playback;
      applyingRemoteRef.current = true;
      element.currentTime = expected;
      if (payload.playback.isPlaying) {
        element.play().catch(() => {});
      } else {
        element.pause();
      }
      setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 0);
    });

    socket.on("party:chat", (message) => {
      if (message?.roomId !== roomId) return;
      setChatMessages((prev) => [...prev, message]);
    });

    socket.on("party:closed", (payload) => {
      alert(payload?.message || "Watch Party je zatvoren.");
      navigate(`/watch/${video?.id || ""}`);
    });

    socket.on("party:error", (payload) => {
      alert(payload?.message || "Watch Party greška.");
    });

    return () => {
      try {
        socket.emit("party:leave");
        socket.disconnect();
      } catch {
      }
    };
  }, [navigate, roomId, video?.id]);

  useEffect(() => {
    if (!isOwner || !videoRef.current) return;

    const element = videoRef.current;

    const sendControl = (action) => {
      if (applyingRemoteRef.current) return;
      socketRef.current?.emit("party:control", {
        roomId,
        action,
        currentTime: Number(element.currentTime) || 0,
        isPlaying: !element.paused,
      });
    };

    const onPlay = () => sendControl("play");
    const onPause = () => sendControl("pause");
    const onSeeked = () => sendControl("seek");

    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("seeked", onSeeked);

    return () => {
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("seeked", onSeeked);
    };
  }, [isOwner, roomId]);

  useEffect(() => {
    if (isOwner || !videoRef.current) return;

    const element = videoRef.current;

    const resyncToOwner = () => {
      if (applyingRemoteRef.current) return;

      const playback = roomPlaybackRef.current;
      const expected = getExpectedTime(playback);

      applyingRemoteRef.current = true;
      element.currentTime = expected;
      if (playback.isPlaying) {
        element.play().catch(() => {});
      } else {
        element.pause();
      }
      setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 0);
    };

    element.addEventListener("seeking", resyncToOwner);
    element.addEventListener("seeked", resyncToOwner);
    element.addEventListener("play", resyncToOwner);
    element.addEventListener("pause", resyncToOwner);

    return () => {
      element.removeEventListener("seeking", resyncToOwner);
      element.removeEventListener("seeked", resyncToOwner);
      element.removeEventListener("play", resyncToOwner);
      element.removeEventListener("pause", resyncToOwner);
    };
  }, [isOwner]);

  const sendChatMessage = (e) => {
    e.preventDefault();
    const clean = chatText.trim();
    if (!clean) return;

    socketRef.current?.emit("party:chat", {
      roomId,
      text: clean,
    });
    setChatText("");
  };

  if (loading) return <div style={{ padding: 20 }}>Loading Watch Party...</div>;

  if (error) {
    return (
      <div style={{ maxWidth: 760, margin: "40px auto", padding: 20 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Watch Party</h3>
          <p style={{ color: "#555" }}>{error}</p>
          <button
            onClick={() => navigate("/")}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ddd",
              cursor: "pointer",
              background: "white",
              fontWeight: 600,
            }}
          >
            ← Nazad
          </button>
        </div>
      </div>
    );
  }

  if (!room || !video) return null;

  const base = "http://localhost:5000";
  const videoUrl = video.video_path?.startsWith("http")
    ? video.video_path
    : `${base}${video.video_path}`;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Watch Party</h2>
        <button
          onClick={() => navigate(`/watch/${video.id}`)}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            cursor: "pointer",
            background: "white",
            fontWeight: 600,
          }}
        >
          ← Nazad na video
        </button>
      </div>

      <div style={{ marginTop: 10, color: "#666" }}>
        Room: <strong>{roomId}</strong> • Učesnika: <strong>{membersCount}</strong> •
        {" "}{isOwner ? "Ti si owner (kontrola plejera)." : `Owner: @${room.owner?.username || "host"}`}
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div>
          <div style={{ background: "#000", borderRadius: 12, overflow: "hidden" }}>
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              style={{ width: "100%", maxHeight: 560 }}
            />
          </div>
          {!isOwner && (
            <div style={{ marginTop: 8, color: "#666", fontSize: 13 }}>
              Reprodukciju i timeline kontroliše owner sobe. Zvuk i fullscreen možeš lokalno da menjaš.
            </div>
          )}
          <h3 style={{ marginTop: 14 }}>{video.title}</h3>
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
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Details</div>
              {video.description}
            </div>
          )}
        </div>

        <div style={{ border: "1px solid #e0e0e0", borderRadius: 12, padding: 12, background: "white" }}>
          <h3 style={{ marginTop: 0 }}>Party chat</h3>
          <div
            style={{
              height: 360,
              overflowY: "auto",
              border: "1px solid #eee",
              borderRadius: 10,
              padding: 10,
              background: "#fafafa",
            }}
          >
            {chatMessages.length === 0 ? (
              <div style={{ color: "#999" }}>Nema poruka još.</div>
            ) : (
              chatMessages.map((m, idx) => (
                <div key={`${m.at || idx}-${idx}`} style={{ marginBottom: 10 }}>
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
                border: "1px solid #ddd",
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
                cursor: !chatText.trim() ? "not-allowed" : "pointer",
              }}
            >
              Pošalji
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
