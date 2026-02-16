import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPublicVideos, getLatestPopularVideos } from '../services/api';

export default function Home() {
  const [videos, setVideos] = useState([]);
  const [popularVideos, setPopularVideos] = useState([]);
  const [popularRunAt, setPopularRunAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  
  const token = localStorage.getItem('token');
  const isLoggedIn = !!token;

  useEffect(() => {
    fetchVideos();
    if (token) {
      fetchPopularVideos();
    } else {
      setPopularVideos([]);
      setPopularRunAt(null);
    }
  }, [token]);

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

  const fetchPopularVideos = async () => {
    try {
      const data = await getLatestPopularVideos();
      setPopularVideos(data.videos || []);
      setPopularRunAt(data.run_at || null);
    } catch (_) {
      setPopularVideos([]);
      setPopularRunAt(null);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.reload();
  };

  const handleWatchClick1 = (video) => {
    if (video.is_live) {
      navigate(`/live/${video.id}`);
    } else {
      navigate(`/videos/${video.id}`);
    }
  };
  const handleWatchClick = async (video) => {
    if (video?.schedule_at) {
      const releaseTime = new Date(video.schedule_at).getTime();
      const now = Date.now();
      if (!Number.isNaN(releaseTime) && releaseTime > now) {
        alert(`Video još nije dostupan. Dostupan je od ${new Date(video.schedule_at).toLocaleString('sr-RS')}.`);
        return;
      }
    }

    try {
      const res = await fetch(`http://localhost:5000/api/videos/${video.id}`);
      const data = await res.json().catch(() => ({}));

      if (res.status === 423) {
        alert(`Video još nije dostupan. Dostupan je od ${data.schedule_at ? new Date(data.schedule_at).toLocaleString('sr-RS') : 'zakazanog termina'}.`);
        return;
      }
    } catch (_) {
      // fallback: ako precheck ne uspe, pusti postojeće ponašanje
    }

    navigate(`/videos/${video.id}`);
  };

  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        fontSize: '18px',
        color: '#666'
      }}>
        Učitavanje...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        fontSize: '18px',
        color: '#d32f2f'
      }}>
        Greška: {error}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ 
        background: 'white', 
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ 
          maxWidth: '1200px', 
          margin: '0 auto', 
          padding: '16px 24px',
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center'
        }}>
          <h1 style={{ 
            margin: 0, 
            fontSize: '28px', 
            color: '#1976d2',
            fontWeight: 700,
            cursor: 'pointer'
          }} onClick={() => navigate('/')}>
            🎬 Jutjubić
          </h1>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button 
              onClick={() => navigate('/map')}
              style={{ 
                padding: '10px 20px', 
                cursor: 'pointer', 
                background: '#4caf50', 
                color: 'white', 
                border: 'none', 
                borderRadius: '8px', 
                fontWeight: 600,
                fontSize: '14px',
                transition: 'background 0.2s'
              }}
              onMouseOver={(e) => e.target.style.background = '#45a049'}
              onMouseOut={(e) => e.target.style.background = '#4caf50'}
            >
              🗺️ Mapa videa
            </button>
            
            {isLoggedIn ? (
              <>
                <button 
                  onClick={() => navigate('/upload')}
                  style={{ 
                    padding: '10px 20px', 
                    cursor: 'pointer', 
                    background: '#1976d2', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '8px', 
                    fontWeight: 600,
                    fontSize: '14px',
                    transition: 'background 0.2s'
                  }}
                  onMouseOver={(e) => e.target.style.background = '#1565c0'}
                  onMouseOut={(e) => e.target.style.background = '#1976d2'}
                >
                  📤 Postavi video
                </button>
                <button 
                  onClick={handleLogout}
                  style={{ 
                    padding: '10px 20px', 
                    cursor: 'pointer', 
                    background: 'white', 
                    color: '#666', 
                    border: '1px solid #ddd', 
                    borderRadius: '8px', 
                    fontWeight: 600,
                    fontSize: '14px'
                  }}
                >
                  Odjavi se
                </button>
              </>
            ) : (
              <>
                <button 
                  onClick={() => navigate('/login')} 
                  style={{ 
                    padding: '10px 20px', 
                    cursor: 'pointer',
                    background: 'white',
                    color: '#1976d2',
                    border: '1px solid #1976d2',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '14px'
                  }}
                >
                  Prijavi se
                </button>
                <button 
                  onClick={() => navigate('/register')} 
                  style={{ 
                    padding: '10px 20px', 
                    cursor: 'pointer',
                    background: '#1976d2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '14px'
                  }}
                >
                  Registruj se
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
        {!isLoggedIn && (
          <div style={{ 
            padding: '20px', 
            background: '#e3f2fd', 
            borderRadius: '12px', 
            marginBottom: '24px',
            border: '1px solid #90caf9',
            textAlign: 'center'
          }}>
            <p style={{ margin: 0, color: '#1565c0', fontSize: '15px' }}>
              💡 Prijavite se kako biste mogli da komentarišete i lajkujete videe!
            </p>
          </div>
        )}

        {isLoggedIn && (
          <div style={{
            padding: '20px',
            background: 'white',
            borderRadius: '12px',
            marginBottom: '24px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
          }}>
            <h2 style={{ margin: '0 0 6px 0', fontSize: '22px', color: '#333' }}>
              🔥 Top 3 popularna videa
            </h2>
            <p style={{ margin: '0 0 14px 0', color: '#666', fontSize: '13px' }}>
              {popularRunAt
                ? `Poslednji ETL: ${new Date(popularRunAt).toLocaleString('sr-RS')}`
                : 'Podaci iz poslednjeg ETL izvršavanja'}
            </p>

            {popularVideos.length === 0 ? (
              <div style={{
                border: '1px dashed #d0d0d0',
                borderRadius: '10px',
                padding: '14px',
                background: '#fcfcfc',
                color: '#666',
                fontSize: '14px'
              }}>
                Nema ETL podataka za prikaz. Pokreni nekoliko pregleda videa i zatim `npm run etl:popular:run`.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {popularVideos.slice(0, 3).map((video) => (
                  <button
                    key={`popular-${video.id}`}
                    onClick={() => handleWatchClick(video)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      width: '100%',
                      border: '1px solid #eee',
                      borderRadius: '10px',
                      background: '#fafafa',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '14px', color: '#1976d2', fontWeight: 700 }}>
                        #{video.rank}
                      </div>
                      <div style={{
                        fontSize: '15px',
                        color: '#222',
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {video.title}
                      </div>
                      <div style={{ fontSize: '12px', color: '#666' }}>
                        {video.first_name} {video.last_name} • @{video.username}
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', color: '#444', fontWeight: 700 }}>
                      Score: {video.popularity_score}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <h2 style={{ 
          marginBottom: '24px', 
          fontSize: '24px', 
          fontWeight: 600,
          color: '#333'
        }}>
          Najnoviji videi
        </h2>
        
        {videos.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '60px 20px',
            background: 'white',
            borderRadius: '12px',
            color: '#666'
          }}>
            <p style={{ fontSize: '18px', margin: 0 }}>Nema objavljenih videa.</p>
          </div>
        ) : (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '24px'
          }}>
            {videos.map((video) => (
              <div 
                key={video.id} 
                onClick={() => handleWatchClick1(video)}
                style={{ 
                  background: 'white', 
                  borderRadius: '12px',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  transition: 'transform 0.2s, box-shadow 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                }}
              >
                {/* Thumbnail */}
                <div style={{ 
                  width: '100%', 
                  height: '180px', 
                  background: '#000',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  {video.is_live && (
                    <div style={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      background: "#e53935",
                      color: "white",
                      padding: "4px 8px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 800,
                      zIndex: 2
                    }}>
                      LIVE
                    </div>
                  )}
                  <img 
                    src={video.thumbnail?.startsWith('http') 
                      ? video.thumbnail 
                      : `http://localhost:5000${video.thumbnail}`
                    }
                    alt={video.title}
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'cover'
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.style.display = 'flex';
                      e.target.parentElement.style.alignItems = 'center';
                      e.target.parentElement.style.justifyContent = 'center';
                      e.target.parentElement.innerHTML = '<span style="color: white; font-size: 48px;">🎬</span>';
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '8px',
                    background: 'rgba(0,0,0,0.8)',
                    color: 'white',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 600
                  }}>
                    ▶
                  </div>
                </div>

                {/* Video Info */}
                <div style={{ padding: '16px' }}>
                  <h3 style={{ 
                    margin: '0 0 8px 0', 
                    fontSize: '16px', 
                    fontWeight: 600,
                    color: '#333',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: '1.4'
                  }}>
                    {video.title}
                  </h3>

                  {video.schedule_at && (
                    <div style={{
                      marginBottom: '8px',
                      display: 'inline-block',
                      background: '#ffe9ea',
                      color: '#b71c1c',
                      padding: '4px 8px',
                      borderRadius: '999px',
                      fontSize: '11px',
                      fontWeight: 700
                    }}>
                      🔴 UŽIVO upload
                    </div>
                  )}
                  
                  <p style={{ 
                    margin: '8px 0', 
                    fontSize: '13px', 
                    color: '#666',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: '1.4'
                  }}>
                    {video.description || 'Nema opisa'}
                  </p>

                  <div style={{ 
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid #f0f0f0'
                  }}>
                    <div style={{ 
                      fontSize: '13px', 
                      color: '#1976d2',
                      fontWeight: 500,
                      marginBottom: '6px'
                    }}>
                      {video.first_name} {video.last_name} • @{video.username}
                    </div>
                    
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '12px', 
                      color: '#999'
                    }}>
                      <span>
                        {new Date(video.created_at).toLocaleDateString('sr-RS')}
                      </span>
                      <div style={{ display: 'flex', gap: '12px' }}>
                        {video.views !== undefined && (
                          <span>👁 {video.views}</span>
                        )}
                        {video.likes !== undefined && (
                          <span>❤️ {video.likes}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}