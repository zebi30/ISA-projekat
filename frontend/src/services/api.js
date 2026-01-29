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

export const getPublicVideos = async (period = 'all') => {
  const qs = new URLSearchParams();
  if (period && period !== 'all') qs.set('period', period);

  const res = await fetch(`${BASE_URL}/videos?${qs.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch videos');
  return data;
};

export const getUserProfile = async (userId) => {
  const res = await fetch(`${BASE_URL}/users/${userId}/profile`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch user profile');
  return data;
};

export const getVideoById = async (id) => {
  const res = await fetch(`${BASE_URL}/videos/${id}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || "Video nije pronađen");
  return data;
};

// Get comments for a video
export const getVideoComments = async (videoId, page = 1, limit = 60) => {
  const res = await fetch(`${BASE_URL}/videos/${videoId}/comments?page=${page}&limit=${limit}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch comments');
  return data;
};

// Post a comment (requires authentication)
export const postComment = async (videoId, content, token) => {
  const res = await fetch(`${BASE_URL}/videos/${videoId}/comment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ content })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to post comment');
  return data;
};

// Like a video (requires authentication)
export const likeVideo = async (videoId, token) => {
  const res = await fetch(`${BASE_URL}/videos/${videoId}/like`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to like video');
  return data;
};

// Unlike a video (requires authentication)
export const unlikeVideo = async (videoId, token) => {
  const res = await fetch(`${BASE_URL}/videos/${videoId}/like`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to unlike video');
  return data;
};

// Check if user has liked a video (requires authentication)
export const checkIfLiked = async (videoId, token) => {
  const res = await fetch(`${BASE_URL}/videos/${videoId}/like/check`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await res.json();
  if (!res.ok) return { liked: false };
  return data;
};