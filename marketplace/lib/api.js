'use client';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('btg_mp_token');
}

export function setToken(token) {
  if (token) localStorage.setItem('btg_mp_token', token);
  else localStorage.removeItem('btg_mp_token');
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  return data;
}

export async function searchProducts(query, { limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({ q: query, limit, offset });
  return apiFetch(`/api/marketplace/search?${params}`);
}

export async function signup({ email, name, phone, password }) {
  return apiFetch('/api/marketplace/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, name, phone, password }),
  });
}

export async function login({ email, password }) {
  return apiFetch('/api/marketplace/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function getMe() {
  return apiFetch('/api/marketplace/auth/me');
}

export async function startNegotiation(productId) {
  return apiFetch('/api/marketplace/negotiate/start', {
    method: 'POST',
    body: JSON.stringify({ product_id: productId }),
  });
}

export async function sendMessage(negotiationId, { message, phone } = {}) {
  return apiFetch(`/api/marketplace/negotiate/${negotiationId}/message`, {
    method: 'POST',
    body: JSON.stringify({ message, phone }),
  });
}
