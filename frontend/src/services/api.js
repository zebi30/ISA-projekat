const BASE_URL = 'http://localhost:5000/api';

export const loginUser = async (credentials) => {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
};

export const registerUser = async (user) => {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Registration failed');
  return data;
};

export const getPublicVideos = async () => {
  const res = await fetch(`${BASE_URL}/videos`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch videos');
  return data;
};

export const getUserProfile = async (userId) => {
  const res = await fetch(`${BASE_URL}/users/${userId}/profile`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch user profile');
  return data;
}


export const getVideoById = async (id) => {
  const res = await fetch(`${BASE_URL}/videos/${id}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || "Video nije pronađen");
  return data;
};