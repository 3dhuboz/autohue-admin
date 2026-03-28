const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as any).error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function authed(token: string) {
  return {
    get: <T>(path: string) => request<T>(path, { headers: { Authorization: `Bearer ${token}` } }),
    post: <T>(path: string, body?: unknown) => request<T>(path, {
      method: 'POST', body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${token}` },
    }),
    put: <T>(path: string, body?: unknown) => request<T>(path, {
      method: 'PUT', body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${token}` },
    }),
    del: <T>(path: string) => request<T>(path, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    }),
  };
}

export const api = { request, authed };
