import React from 'react';

export default function Input({ label, type = 'text', value, onChange, name }) {
  return (
    <div style={{ marginBottom: '15px' }}>
      <label style={{ display: 'block', marginBottom: '5px' }}>{label}</label>
      <input
        type={type}
        name={name}          // ✅ add this
        value={value}
        onChange={onChange}
        style={{
          width: '100%',
          padding: '10px',
          borderRadius: '5px',
          border: '1px solid #ccc',
        }}
      />
    </div>
  );
}
