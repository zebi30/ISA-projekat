import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getUserProfile } from '../services/api';

export default function UserProfile() {
  const { userId } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchProfile();
  }, [userId]);

  const fetchProfile = async () => {
    try {
      const data = await getUserProfile(userId);
      setProfile(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Učitavanje...</div>;
  if (error) return <div style={{ padding: '40px', textAlign: 'center', color: 'red' }}>{error}</div>;

  return (
    <div style={{ padding: '40px' }}>
      <button onClick={() => navigate('/')} style={{ marginBottom: '20px', cursor: 'pointer', padding: '8px 16px' }}>
        ← Nazad na početnu
      </button>
      
      <h1>Profil korisnika</h1>
      
      <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#fafafa' }}>
        <h2>{profile.user.first_name} {profile.user.last_name}</h2>
        <p><strong>Korisničko ime:</strong> @{profile.user.username}</p>
        <p><strong>Član od:</strong> {new Date(profile.user.created_at).toLocaleDateString('sr-RS')}</p>
      </div>

      <h3 style={{ marginTop: '40px' }}>Video objave ({profile.videos.length})</h3>
      {profile.videos.length === 0 ? (
        <p style={{ color: '#666' }}>Korisnik nema objavljenih videa.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
          {profile.videos.map((video) => (
            <div key={video.id} style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '8px', backgroundColor: '#fafafa' }}>
              <h4>{video.title}</h4>
              <p>{video.description}</p>
              <p style={{ color: '#999', fontSize: '12px', marginTop: '10px' }}>
                {new Date(video.created_at).toLocaleString('sr-RS')}
              </p>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ marginTop: '40px' }}>Komentari ({profile.comments.length})</h3>
      {profile.comments.length === 0 ? (
        <p style={{ color: '#666' }}>Korisnik nema komentara.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
          {profile.comments.map((comment) => (
            <div key={comment.id} style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '8px', backgroundColor: '#fafafa' }}>
              <p style={{ marginBottom: '10px' }}>{comment.content}</p>
              <p style={{ color: '#666', fontSize: '14px' }}>
                Na videu: <strong>{comment.video_title}</strong>
              </p>
              <p style={{ color: '#999', fontSize: '12px' }}>
                {new Date(comment.created_at).toLocaleString('sr-RS')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}