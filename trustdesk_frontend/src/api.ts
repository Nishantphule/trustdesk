export type User = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "supervisor" | "agent";
  org_id: string;
};

const TOKEN = "trustdesk_token";

export function getToken() {
  return localStorage.getItem(TOKEN);
}

export function setSession(token: string, user: User) {
  localStorage.setItem(TOKEN, token);
  localStorage.setItem("trustdesk_user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN);
  localStorage.removeItem("trustdesk_user");
}

export function currentUser(): User | null {
  const raw = localStorage.getItem("trustdesk_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    clearSession();
    return null;
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith("/auth/login")) {
    clearSession();
    if (window.location.pathname !== "/login") window.location.assign("/login");
  }
  if (!response.ok) {
    const message = data?.error?.message ?? response.statusText;
    throw new Error(message);
  }
  return data as T;
}
