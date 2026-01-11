import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Input from '../components/Input';
import { loginUser } from '../services/api';

export default function Login() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: '',
    password: '',
  });

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    
    // Clear field error on change
    if (fieldErrors[name]) {
      setFieldErrors({ ...fieldErrors, [name]: '' });
    }
    if (error) setError('');
  };

  const validateForm = () => {
    const errors = {};

    // Email validacija
    if (!form.email.trim()) {
      errors.email = 'Email je obavezan.';
    } else if (!validateEmail(form.email)) {
      errors.email = 'Unesite validan email format.';
    }

    // Password validacija
    if (!form.password) {
      errors.password = 'Lozinka je obavezna.';
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    // Validacija
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    try {
      const data = await loginUser(form);

      // sacuvaj token
      localStorage.setItem('token', data.token);

      // redirect na home
      navigate('/home');
    } catch (err) {
      // Better error messages
      if (err.message.includes('429') || err.message.includes('Previše')) {
        setError('Previše pokušaja prijave. Pokušajte ponovo za 1 minut.');
      } else if (err.message.includes('aktiviran')) {
        setError('Nalog nije aktiviran. Proverite email za aktivacioni link.');
      } else {
        setError(err.message);
      }
    }
  };

  return (
    <div style={styles.container}>
      <h2>Prijava</h2>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '15px' }}>
          <Input
            label="Email"
            name="email"
            value={form.email}
            onChange={handleChange}
          />
          {fieldErrors.email && <p style={styles.fieldError}>{fieldErrors.email}</p>}
        </div>

        <div style={{ marginBottom: '15px' }}>
          <Input
            label="Lozinka"
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
          />
          {fieldErrors.password && <p style={styles.fieldError}>{fieldErrors.password}</p>}
        </div>

        <button type="submit" style={styles.button}>
          Prijavi se
        </button>
      </form>

      {error && <p style={styles.error}>{error}</p>}

      <p style={{ marginTop: '15px' }}>
        Nemate nalog?{' '}
        <Link to="/register" style={styles.link}>
          Registrujte se
        </Link>
      </p>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '400px',
    margin: '80px auto',
    padding: '30px',
    boxShadow: '0 0 10px rgba(0,0,0,0.1)',
    borderRadius: '10px',
    textAlign: 'center',
  },
  button: {
    width: '100%',
    padding: '10px',
    borderRadius: '5px',
    border: 'none',
    backgroundColor: '#1976d2',
    color: 'white',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '10px',
    boxSizing: 'border-box',
  },
  error: {
    color: 'red',
    marginTop: '10px',
    fontWeight: 'bold',
  },
  fieldError: {
    color: '#d32f2f',
    fontSize: '12px',
    marginTop: '4px',
    textAlign: 'left',
  },
  link: {
    color: 'blue',
    textDecoration: 'none',
  },
};
