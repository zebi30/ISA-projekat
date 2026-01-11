import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function Activate() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading, success, error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const activateAccount = async () => {
      try {
        const res = await fetch(`http://localhost:5000/activate/${token}`);
        const text = await res.text();
        
        if (res.ok) {
          setStatus('success');
          setMessage('Nalog uspešno aktiviran! Možete se prijaviti.');
          // Redirect to login after 3 seconds
          setTimeout(() => {
            navigate('/login');
          }, 3000);
        } else {
          setStatus('error');
          setMessage(text || 'Nevažeći ili istekao aktivacioni link.');
        }
      } catch (err) {
        setStatus('error');
        setMessage('Greška pri aktivaciji naloga. Pokušajte ponovo.');
      }
    };

    if (token) {
      activateAccount();
    }
  }, [token, navigate]);

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {status === 'loading' && (
          <>
            <div style={styles.spinner}></div>
            <h2 style={styles.title}>Aktivacija naloga...</h2>
            <p style={styles.text}>Molimo sačekajte.</p>
          </>
        )}
        
        {status === 'success' && (
          <>
            <div style={styles.iconSuccess}>✓</div>
            <h2 style={{ ...styles.title, color: '#2e7d32' }}>Uspešno!</h2>
            <p style={styles.text}>{message}</p>
            <p style={{ ...styles.text, fontSize: '14px', color: '#666' }}>
              Prebacujemo vas na stranicu za prijavu...
            </p>
          </>
        )}
        
        {status === 'error' && (
          <>
            <div style={styles.iconError}>✕</div>
            <h2 style={{ ...styles.title, color: '#d32f2f' }}>Greška</h2>
            <p style={styles.text}>{message}</p>
            <button 
              onClick={() => navigate('/register')}
              style={styles.button}
            >
              Povratak na registraciju
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '20px',
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    padding: '60px 40px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    textAlign: 'center',
    maxWidth: '500px',
    width: '100%',
  },
  spinner: {
    width: '60px',
    height: '60px',
    border: '6px solid #f3f3f3',
    borderTop: '6px solid #1976d2',
    borderRadius: '50%',
    margin: '0 auto 20px',
    animation: 'spin 1s linear infinite',
  },
  iconSuccess: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    background: '#4caf50',
    color: 'white',
    fontSize: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 20px',
    fontWeight: 'bold',
  },
  iconError: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    background: '#f44336',
    color: 'white',
    fontSize: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 20px',
    fontWeight: 'bold',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    marginBottom: '16px',
  },
  text: {
    fontSize: '16px',
    color: '#555',
    marginBottom: '12px',
    lineHeight: '1.6',
  },
  button: {
    marginTop: '24px',
    padding: '12px 32px',
    background: '#1976d2',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background 0.3s',
  },
};
