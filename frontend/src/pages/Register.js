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

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const data = await registerUser(form);
      setSuccess(data.message);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={styles.container}>
      <h2>Register</h2>

      <form onSubmit={handleSubmit}>
        <Input label="Email" name="email" value={form.email} onChange={handleChange} />
        <Input label="Username" name="username" value={form.username} onChange={handleChange} />
        <Input label="First Name" name="first_name" value={form.first_name} onChange={handleChange} />
        <Input label="Last Name" name="last_name" value={form.last_name} onChange={handleChange} />
        <Input label="Address" name="address" value={form.address} onChange={handleChange} />

        <Input
          label="Password"
          type="password"
          name="password"
          value={form.password}
          onChange={handleChange}
        />

        <Input
          label="Confirm Password"
          type="password"
          name="password2"
          value={form.password2}
          onChange={handleChange}
        />

        <button type="submit" style={styles.button}>
          Register
        </button>
      </form>

      {error && <p style={styles.error}>{error}</p>}
      {success && <p style={styles.success}>{success}</p>}

      <p style={{ marginTop: '15px' }}>
        Već imate nalog?{' '}
        <Link to="/" style={styles.link}>
          Login
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
    backgroundColor: '#8B0000',
    color: 'white',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  error: {
    color: 'red',
    marginTop: '10px',
  },
  success: {
    color: 'green',
    marginTop: '10px',
  },
  link: {
    color: 'blue',
    textDecoration: 'none',
  },
};
