import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPublicVideos } from '../services/api';

export default function Home() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchVideos();
  }, []);

  const fetchVideos = async () => {
    try {
      const data = await getPublicVideos();
      setVideos(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUserClick = (userId) => {
    navigate(`/profile/${userId}`);
  };

  const handleCommentClick = () => {
    alert('Morate se prijaviti kako biste komentarisali.');
    navigate('/login');
  };

  const handleLikeClick = () => {
    alert('Morate se prijaviti kako biste lajkovali video.');
    navigate('/login');
  };

  const handleUploadClick = () => {
    const token = localStorage.getItem("token"); // ili accessToken
    if (!token) {
      alert("Moraš se prijaviti da bi uploadovao video.");
      navigate("/login");
      return;
    }
    navigate("/upload");
  };

  const handleWatchClick = (videoId) => {
    navigate(`/videos/${videoId}`);
  };


  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Učitavanje...</div>;
  if (error) return <div style={{ padding: '40px', textAlign: 'center', color: 'red' }}>{error}</div>;

  return (
    <div style={{ padding: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1>Jutjubić</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => navigate('/login')} style={{ padding: '10px 20px', cursor: 'pointer' }}>
            Log in
          </button>
          <button onClick={() => navigate('/register')} style={{ padding: '10px 20px', cursor: 'pointer' }}>
            Register
          </button>
          <button
            onClick={handleUploadClick}
            style={{ padding: "10px 20px", cursor: "pointer", background: "#439cfb", color: "white", border: "none", borderRadius: 6, fontWeight: 700 }}
          >
            Upload
          </button>
        </div>
      </div>
      
      <p style={{ marginBottom: '20px', color: '#666' }}>
        Prijavite se za mogucnost lajkovanja/komentarisanja videa.
      </p>
      
      {videos.length === 0 ? (
        <p>Nema objavljenih videa.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
          {videos.map((video) => (
            <div key={video.id} style={{ border: '1px solid #ddd', padding: '20px', borderRadius: '8px', backgroundColor: '#fafafa' }}>
              <h3>{video.title}</h3>
              <p>{video.description}</p>
              <p style={{ color: '#666', fontSize: '14px', marginTop: '10px' }}>
                <button 
                  onClick={() => handleUserClick(video.user_id)}
                  style={{ color: 'blue', cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline', fontSize: '14px' }}>
                  {video.first_name} {video.last_name} (@{video.username})
                </button>
              </p>
              <p style={{ color: '#999', fontSize: '12px' }}>
                {new Date(video.created_at).toLocaleString('sr-RS')}
              </p>
              
              <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => handleWatchClick(video.id)}
                  style={{ padding: "8px 16px", cursor: "pointer", border: "1px solid #ddd", borderRadius: "4px", backgroundColor: "white" }}
                >
                  ▶️ Pogledaj
                </button>
                <button onClick={handleLikeClick} style={{ padding: '8px 16px', cursor: 'pointer', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: 'white' }}>
                  ❤️ Lajkuj
                </button>
                <button onClick={handleCommentClick} style={{ padding: '8px 16px', cursor: 'pointer', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: 'white' }}>
                  💬 Komentariši
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}