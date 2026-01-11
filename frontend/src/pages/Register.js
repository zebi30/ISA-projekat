import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Input from '../components/Input';
import { registerUser } from '../services/api';

export default function Register() {
  const [form, setForm] = useState({
    email: '',
    username: '',
    first_name: '',
    last_name: '',
    address: '',
    password: '',
    password2: '',
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateUsername = (username) => {
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    return usernameRegex.test(username);
  };

  const validateName = (name) => {
    const nameRegex = /^[a-zA-ZčćžšđČĆŽŠĐ\s]{2,50}$/;
    return nameRegex.test(name);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    
    // Clear field error on change
    if (fieldErrors[name]) {
      setFieldErrors({ ...fieldErrors, [name]: '' });
    }
    if (error) setError('');

    // Real-time password matching validation
    if (name === 'password2' && form.password && value !== form.password) {
      setFieldErrors({ ...fieldErrors, password2: 'Lozinke se ne poklapaju.' });
    } else if (name === 'password2' && value === form.password) {
      setFieldErrors({ ...fieldErrors, password2: '' });
    }
  };

  const validateForm = () => {
    const errors = {};

    // Email validacija
    if (!form.email.trim()) {
      errors.email = 'Email je obavezan.';
    } else if (!validateEmail(form.email)) {
      errors.email = 'Unesite validan email format (npr. korisnik@example.com).';
    }

    // Username validacija
    if (!form.username.trim()) {
      errors.username = 'Korisničko ime je obavezno.';
    } else if (!validateUsername(form.username)) {
      errors.username = 'Korisničko ime mora imati 3-20 karaktera (slova, brojevi, _).';
    }

    // First name validacija
    if (!form.first_name.trim()) {
      errors.first_name = 'Ime je obavezno.';
    } else if (!validateName(form.first_name)) {
      errors.first_name = 'Ime može sadržati samo slova (2-50 karaktera).';
    }

    // Last name validacija
    if (!form.last_name.trim()) {
      errors.last_name = 'Prezime je obavezno.';
    } else if (!validateName(form.last_name)) {
      errors.last_name = 'Prezime može sadržati samo slova (2-50 karaktera).';
    }

    // Address validacija
    if (!form.address.trim()) {
      errors.address = 'Adresa je obavezna.';
    } else if (form.address.trim().length < 5) {
      errors.address = 'Adresa mora imati najmanje 5 karaktera.';
    }

    // Password validacija (samo da nije prazna i da se poklapaju)
    if (!form.password) {
      errors.password = 'Lozinka je obavezna.';
    }

    if (!form.password2) {
      errors.password2 = 'Potvrda lozinke je obavezna.';
    } else if (form.password !== form.password2) {
      errors.password2 = 'Lozinke se ne poklapaju.';
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setFieldErrors({});

    // Validacija
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    try {
      const data = await registerUser(form);
      setSuccess(data.message);
      // Clear form on success
      setForm({
        email: '',
        username: '',
        first_name: '',
        last_name: '',
        address: '',
        password: '',
        password2: '',
      });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={styles.container}>
      <h2>Registracija</h2>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '15px' }}>
          <Input label="Email" name="email" value={form.email} onChange={handleChange} />
          {fieldErrors.email && <p style={styles.fieldError}>{fieldErrors.email}</p>}
        </div>

        <div style={{ marginBottom: '15px' }}>
          <Input label="Korisničko ime" name="username" value={form.username} onChange={handleChange} />
          {fieldErrors.username && <p style={styles.fieldError}>{fieldErrors.username}</p>}
        </div>

        <div style={{ marginBottom: '15px' }}>
          <Input label="Ime" name="first_name" value={form.first_name} onChange={handleChange} />
          {fieldErrors.first_name && <p style={styles.fieldError}>{fieldErrors.first_name}</p>}
        </div>

        <div style={{ marginBottom: '15px' }}>
          <Input label="Prezime" name="last_name" value={form.last_name} onChange={handleChange} />
          {fieldErrors.last_name && <p style={styles.fieldError}>{fieldErrors.last_name}</p>}
        </div>

        <div style={{ marginBottom: '15px' }}>
          <Input label="Adresa" name="address" value={form.address} onChange={handleChange} />
          {fieldErrors.address && <p style={styles.fieldError}>{fieldErrors.address}</p>}
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

        <div style={{ marginBottom: '15px' }}>
          <Input
            label="Potvrda lozinke"
            type="password"
            name="password2"
            value={form.password2}
            onChange={handleChange}
          />
          {fieldErrors.password2 && <p style={styles.fieldError}>{fieldErrors.password2}</p>}
          {form.password && form.password2 && form.password === form.password2 && (
            <p style={styles.successMatch}>✓ Lozinke se poklapaju</p>
          )}
        </div>

        <button type="submit" style={styles.button}>
          Registruj se
        </button>
      </form>

      {error && <p style={styles.error}>{error}</p>}
      {success && <p style={styles.success}>{success}</p>}

      <p style={{ marginTop: '15px' }}>
        Već imate nalog?{' '}
        <Link to="/login" style={styles.link}>
          Prijavi se
        </Link>
      </p>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '450px',
    margin: '50px auto',
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
  success: {
    color: 'green',
    marginTop: '10px',
    fontWeight: 'bold',
  },
  fieldError: {
    color: '#d32f2f',
    fontSize: '12px',
    marginTop: '4px',
    textAlign: 'left',
  },
  successMatch: {
    color: '#2e7d32',
    fontSize: '12px',
    marginTop: '4px',
    textAlign: 'left',
  },
  link: {
    color: 'blue',
    textDecoration: 'none',
  },
};
