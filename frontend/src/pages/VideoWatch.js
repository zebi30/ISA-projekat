import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getVideoComments, postComment, likeVideo, unlikeVideo } from "../services/api";
import { startLive } from "../services/api";
import { createWatchPartyRoom } from "../services/api";

export default function VideoWatch() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Comments state
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  
  // Comment form state
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState('');

  // Like state
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [likeLoading, setLikeLoading] = useState(false);
  const videoRef = useRef(null);
  const [scheduleLock, setScheduleLock] = useState(null);
  const syncStartedAtRef = useRef(null);
  const liveEdgeInitializedRef = useRef(false);
  const [liveEdgeSeconds, setLiveEdgeSeconds] = useState(0);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [liveWindowEnded, setLiveWindowEnded] = useState(false);
  const [showLiveEndedNotice, setShowLiveEndedNotice] = useState(false);
  const [creatingParty, setCreatingParty] = useState(false);

  // Check if user is logged in
  const token = localStorage.getItem('token');
  const isLoggedIn = !!token;

  // Check if user has liked the video
  const checkLikeStatus = useCallback(async () => {
    if (!isLoggedIn || !token || !id) return;
    
    try {
      const res = await fetch(`http://localhost:5000/api/videos/${id}/like/check`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setIsLiked(data.liked);
        console.log('Like status checked:', data.liked);
      }
    } catch (err) {
      console.error('Error checking like status:', err);
    }
  }, [id, isLoggedIn, token]);

  const loadVideo = useCallback(async () => {
    setLoading(true);

    try {
      const res = await fetch(`http://localhost:5000/api/videos/${id}/watch`, { method: "POST" });
      const data = await res.json().catch(() => ({}));

      // scheduled lock sa 423 (backend već vraća payload)
      if (res.status === 423) {
        setVideo(null);
        setScheduleLock({
          message: data.message || "Video je zakazan i još nije dostupan.",
          schedule_at: data.schedule_at,
          available_in_seconds: Number(data.available_in_seconds) || 0,
        });
        return;
      }

      if (!res.ok) {
        alert(data.message || data.error || "Video nije pronađen");
        navigate("/");
        return;
      }

      setScheduleLock(null);
      setVideo(data);

      if (data.is_live) {
        navigate(`/live/${id}`);
        return;
      }

      setLikesCount(Number(data.likes) || 0);
      setLiveWindowEnded(false);
    } catch (e) {
      alert("Greška pri učitavanju videa.");
      navigate("/");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);


  // Load video
  useEffect(() => {
    loadVideo();
  }, [loadVideo]);

  useEffect(() => {
    if (!scheduleLock) return;

    const interval = setInterval(() => {
      setScheduleLock((prev) => {
        if (!prev) return prev;
        const next = Math.max(0, (Number(prev.available_in_seconds) || 0) - 1);
        if (next === 0) {
          clearInterval(interval);
          setTimeout(() => {
            loadVideo();
          }, 250);
        }
        return { ...prev, available_in_seconds: next };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [scheduleLock, loadVideo]);

  useEffect(() => {
    if (!liveWindowEnded) return;

    setShowLiveEndedNotice(true);
    const timeout = setTimeout(() => {
      setShowLiveEndedNotice(false);
    }, 4500);

    return () => clearTimeout(timeout);
  }, [liveWindowEnded]);

  useEffect(() => {
    if (!liveWindowEnded || !videoRef.current) return;

    const element = videoRef.current;

    const resetToStart = () => {
      element.pause();
      element.currentTime = 0;
      setCurrentSeconds(0);
      setLiveEdgeSeconds(0);
    };

    if (element.readyState >= 1) {
      resetToStart();
      return undefined;
    }

    element.addEventListener('loadedmetadata', resetToStart);
    return () => {
      element.removeEventListener('loadedmetadata', resetToStart);
    };
  }, [liveWindowEnded, video?.id]);

  // Check like status when video loads or login status changes
  useEffect(() => {
    console.log('Like status useEffect triggered', { 
      video: !!video, 
      isLoggedIn, 
      hasToken: !!token,
      videoId: id 
    });
    
    if (video && isLoggedIn && token) {
      console.log('Checking like status for video:', id);
      checkLikeStatus();
    } else if (!isLoggedIn) {
      console.log('User not logged in, setting isLiked to false');
      setIsLiked(false);
    } else {
      console.log('Conditions not met for checking like status');
    }
  }, [id, video, isLoggedIn, token, checkLikeStatus]);

  // Load comments
  useEffect(() => {
    if (scheduleLock) return;
    loadComments(currentPage);
  }, [id, currentPage, scheduleLock]);

  const loadComments = async (page) => {
    setCommentsLoading(true);
    try {
      const data = await getVideoComments(id, page, 6);
      setComments(data.comments);
      setPagination(data.pagination);
    } catch (err) {
      console.error('Error loading comments:', err);
    } finally {
      setCommentsLoading(false);
    }
  };

  // Handle like/unlike
  const handleLike = async () => {
    console.log('handleLike called, isLiked:', isLiked);
    
    if (!isLoggedIn) {
      alert('Morate se prijaviti kako biste lajkovali video.');
      navigate('/login');
      return;
    }

    setLikeLoading(true);
    try {
      if (isLiked) {
        console.log('Unliking video...');
        await unlikeVideo(id, token);
        setIsLiked(false);
        setLikesCount(prev => Math.max(0, prev - 1));
        console.log('Video unliked successfully');
      } else {
        console.log('Liking video...');
        await likeVideo(id, token);
        setIsLiked(true);
        setLikesCount(prev => prev + 1);
        console.log('Video liked successfully');
      }
    } catch (err) {
      console.error('Error in handleLike:', err);
      alert(err.message);
      // Refresh like status from server on error
      checkLikeStatus();
    } finally {
      setLikeLoading(false);
    }
  };

  // Commenting checks (double checked in server.js bcs it bugged out for some reason)
  const handleSubmitComment = async (e) => {
    e.preventDefault();
    
    if (!isLoggedIn) {
      alert('Morate se prijaviti kako biste komentarisali.');
      navigate('/login');
      return;
    }

    if (!commentText.trim()) {
      setCommentError('Komentar ne moze biti prazan.');
      return;
    }

    if (commentText.length > 150) {
      setCommentError('Komentar ne sme biti duzi od 150 karaktera.');
      return;
    }

    setSubmitting(true);
    setCommentError('');

    try {
      await postComment(id, commentText, token);
      setCommentText('');
      // REfershing comments to show the new one
      loadComments(1);
      setCurrentPage(1);
      alert('Komentar uspesno postavljen!');
    } catch (err) {
      setCommentError(err.message);
    } finally {
      setSubmitting(false);
    }
  };


  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStartLive = async () => {
    if (!isLoggedIn) {
      alert("Morate se prijaviti.");
      navigate("/login");
      return;
    }

    try {
      await startLive(id, token);
      navigate(`/live/${id}`);
    } catch (e) {
      alert(e.message);
    }
  };

  const handleCreateWatchParty = async () => {
    if (!isLoggedIn) {
      alert('Morate se prijaviti kako biste kreirali Watch Party.');
      navigate('/login');
      return;
    }

    setCreatingParty(true);
    try {
      const room = await createWatchPartyRoom(id, token);
      navigate(`/party/${room.roomId}`);
    } catch (e) {
      alert(e.message || 'Ne mogu da kreiram Watch Party sobu.');
    } finally {
      setCreatingParty(false);
    }
  };

  const isSynchronizedStream = Boolean(video?.stream_sync);
  const isLiveModeActive = isSynchronizedStream && !liveWindowEnded;

  useEffect(() => {
    if (!isLiveModeActive || !videoRef.current || !video) return;

    const element = videoRef.current;
    const baseOffset = Math.max(0, Number(video.playback_offset_seconds) || 0);
    const serverTs = video.server_time ? new Date(video.server_time).getTime() : Date.now();
    const scheduleTs = video.schedule_at ? new Date(video.schedule_at).getTime() : NaN;
    syncStartedAtRef.current = Date.now();

    const getExpectedOffset = () => {
      if (!Number.isFinite(element.duration) || element.duration <= 0) return null;

      const startedAt = syncStartedAtRef.current || Date.now();
      const elapsedSinceSyncStart = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      let expected = baseOffset + elapsedSinceSyncStart;

      if (!Number.isFinite(expected) && !Number.isNaN(scheduleTs)) {
        expected = Math.max(0, Math.floor((Date.now() - scheduleTs) / 1000));
      }

      if ((!Number.isFinite(expected) || expected < 0) && Number.isFinite(serverTs)) {
        expected = baseOffset + Math.max(0, Math.floor((Date.now() - serverTs) / 1000));
      }

      if (!Number.isFinite(expected) || expected < 0) {
        expected = baseOffset;
      }

      const durationEdge = Math.max(0, element.duration - 0.3);
      const normalized = Math.max(0, expected);

      if (normalized >= durationEdge) {
        setLiveWindowEnded(true);
        return durationEdge;
      }

      return Math.min(normalized, durationEdge);
    };

    const moveToLiveEdgeOnce = () => {
      const expected = getExpectedOffset();
      if (expected === null) return;
      if (!liveEdgeInitializedRef.current) {
        element.currentTime = expected;
        liveEdgeInitializedRef.current = true;
      }
    };

    const clampForwardSeek = () => {
      const expected = getExpectedOffset();
      if (expected === null) return;

      setLiveEdgeSeconds(Math.max(0, Math.floor(expected)));
      setCurrentSeconds(Math.max(0, Math.floor(element.currentTime || 0)));

      if (element.currentTime > expected) {
        element.currentTime = expected;
      }
    };

    if (element.readyState >= 1) {
      moveToLiveEdgeOnce();
    } else {
      element.addEventListener('loadedmetadata', moveToLiveEdgeOnce);
    }

    element.addEventListener('canplay', moveToLiveEdgeOnce);
    element.addEventListener('play', clampForwardSeek);
    element.addEventListener('seeking', clampForwardSeek);
    element.addEventListener('seeked', clampForwardSeek);
    element.addEventListener('timeupdate', clampForwardSeek);

    const interval = setInterval(clampForwardSeek, 250);
    const t1 = setTimeout(moveToLiveEdgeOnce, 100);
    const t2 = setTimeout(moveToLiveEdgeOnce, 350);
    const t3 = setTimeout(moveToLiveEdgeOnce, 700);

    return () => {
      element.removeEventListener('loadedmetadata', moveToLiveEdgeOnce);
      element.removeEventListener('canplay', moveToLiveEdgeOnce);
      element.removeEventListener('play', clampForwardSeek);
      element.removeEventListener('seeking', clampForwardSeek);
      element.removeEventListener('seeked', clampForwardSeek);
      element.removeEventListener('timeupdate', clampForwardSeek);
      clearInterval(interval);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      liveEdgeInitializedRef.current = false;
      setLiveEdgeSeconds(0);
      setCurrentSeconds(0);
    };
  }, [video, isLiveModeActive]);

  function formatClock(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function formatRemaining(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hours > 0) {
      return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;
  if (scheduleLock) {
    return (
      <div style={{ maxWidth: 720, margin: "48px auto", padding: 24 }}>
        <div style={{
          border: '1px solid #ddd',
          borderRadius: 12,
          padding: 24,
          background: '#fafafa'
        }}>
          <h2 style={{ marginTop: 0 }}>⏰ Video još nije dostupan</h2>
          <p style={{ color: '#555' }}>{scheduleLock.message}</p>
          <p style={{ marginBottom: 8 }}>
            Dostupan od: <strong>{scheduleLock.schedule_at ? new Date(scheduleLock.schedule_at).toLocaleString('sr-RS') : '-'}</strong>
          </p>
          <p style={{ marginTop: 0 }}>
            Preostalo: <strong>{formatRemaining(scheduleLock.available_in_seconds)}</strong>
          </p>
          <button
            onClick={() => navigate('/')}
            style={{
              marginTop: 10,
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #ddd',
              cursor: 'pointer',
              background: 'white',
              fontWeight: 600
            }}
          >
            ← Nazad
          </button>
        </div>
      </div>
    );
  }
  if (!video) return null;

  const base = "http://localhost:5000";
  const videoUrl = video.video_path?.startsWith("http")
    ? video.video_path
    : `${base}${video.video_path}`;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      {/* Video Player */}
      <div style={{ background: "#000", borderRadius: 12, overflow: "hidden" }}>
        <video
          key={`${video.id}-${isLiveModeActive ? 'live' : 'normal'}`}
          ref={videoRef}
          src={videoUrl}
          controls
          style={{ width: "100%", maxHeight: 520 }}
        />
      </div>

      {isLiveModeActive && (
        <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
          🔴 UŽIVO upload • sinhronizovani prikaz • start: {video.schedule_at ? new Date(video.schedule_at).toLocaleString('sr-RS') : '-'}
          <div style={{ marginTop: 4 }}>
            Možeš vraćati unazad, ali ne možeš premotati unapred preko trenutnog živog trenutka.
          </div>
          <div style={{ marginTop: 6, fontWeight: 600, color: '#b71c1c' }}>
            LIVE edge: {formatClock(liveEdgeSeconds)} • Trenutno: {formatClock(currentSeconds)}
          </div>
        </div>
      )}

      {showLiveEndedNotice && (
        <div style={{ marginTop: 8, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>
          ✅ UŽIVO prenos završen — video sada radi kao običan upload.
        </div>
      )}

      {/* Video Info */}
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
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: 12 }}>
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

          <button
            onClick={handleLike}
            disabled={likeLoading}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: isLiked ? "2px solid #e91e63" : "1px solid #ddd",
              cursor: likeLoading ? "not-allowed" : "pointer",
              background: isLiked ? "#ffe4ec" : "white",
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: isLiked ? "#e91e63" : "#666",
              transition: 'all 0.2s',
              fontSize: '14px'
            }}
          >
            {isLiked ? "❤️" : "♡"} {likesCount} {isLiked ? "Lajk-ova" : "Lajk-ova"}
          </button>

          {!video?.is_live && isLoggedIn && (
          <button
            onClick={handleStartLive}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: "#e53935",
              color: "white",
              fontWeight: 800,
              cursor: "pointer"
            }}
          >
            🔴 Start LIVE
          </button>
        )}

          {!video?.is_live && isLoggedIn && (
            <button
              onClick={handleCreateWatchParty}
              disabled={creatingParty}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: "none",
                background: creatingParty ? "#9e9e9e" : "#6a1b9a",
                color: "white",
                fontWeight: 700,
                cursor: creatingParty ? "not-allowed" : "pointer"
              }}
            >
              {creatingParty ? 'Kreiram...' : 'Start Watch Party'}
            </button>
          )}

        </div>

        <div style={{ color: "#666", fontSize: '14px' }}>
          👁 {video.views ?? 0} pregleda
        </div>
      </div>

      {/* Comments Section */}
      <div style={{ marginTop: 40, borderTop: '2px solid #e0e0e0', paddingTop: 20 }}>
        <h3 style={{ marginBottom: 20 }}>
          Komentari {pagination && `(${pagination.totalComments})`}
        </h3>

        {/* Comment Form */}
        {isLoggedIn ? (
          <form onSubmit={handleSubmitComment} style={{ marginBottom: 30 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Dodajte komentar... (max 150 karaktera)"
                maxLength={150}
                rows={3}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#666' }}>
                  {commentText.length}/150
                </span>
                <button
                  type="submit"
                  disabled={submitting || !commentText.trim()}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 8,
                    border: 'none',
                    background: submitting || !commentText.trim() ? '#ccc' : '#1976d2',
                    color: 'white',
                    fontWeight: 600,
                    cursor: submitting || !commentText.trim() ? 'not-allowed' : 'pointer'
                  }}
                >
                  {submitting ? 'Saljem...' : 'Postavi komentar'}
                </button>
              </div>
              {commentError && (
                <div style={{ color: 'red', fontSize: 14 }}>{commentError}</div>
              )}
            </div>
          </form>
        ) : (
          <div style={{ 
            padding: 20, 
            background: '#f7f7f7', 
            borderRadius: 8, 
            marginBottom: 30,
            textAlign: 'center'
          }}>
            <p style={{ margin: 0, color: '#666' }}>
              <button
                onClick={() => navigate('/login')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#1976d2',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600
                }}
              >
                Prijavite se
              </button>
              {' '}kako biste ostavili komentar.
            </p>
          </div>
        )}

        {/* Comments List */}
        {commentsLoading ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#666' }}>
            Ucitavanje komentara...
          </div>
        ) : comments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            Nema komentara. Budite prvi koji ce komentarisati!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {comments.map((comment) => (
              <div
                key={comment.id}
                style={{
                  padding: 16,
                  background: '#f9f9f9',
                  borderRadius: 8,
                  border: '1px solid #e0e0e0'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <strong style={{ color: '#333', fontSize: 14 }}>
                      {comment.first_name} {comment.last_name}
                    </strong>
                    <span style={{ color: '#999', fontSize: 13, marginLeft: 8 }}>
                      @{comment.username}
                    </span>
                  </div>
                  <span style={{ color: '#999', fontSize: 12 }}>
                    {new Date(comment.created_at).toLocaleString('sr-RS')}
                  </span>
                </div>
                <p style={{ margin: 0, color: '#555', fontSize: 14, lineHeight: 1.5 }}>
                  {comment.content}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div style={{ 
            marginTop: 30, 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center',
            gap: 10
          }}>
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #ddd',
                background: currentPage === 1 ? '#f5f5f5' : 'white',
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                fontWeight: 600
              }}
            >
              ← Prethodna
            </button>
            
            <span style={{ color: '#666', fontSize: 14 }}>
              Strana {currentPage} od {pagination.totalPages}
            </span>
            
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === pagination.totalPages}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #ddd',
                background: currentPage === pagination.totalPages ? '#f5f5f5' : 'white',
                cursor: currentPage === pagination.totalPages ? 'not-allowed' : 'pointer',
                fontWeight: 600
              }}
            >
              Sledeća →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
