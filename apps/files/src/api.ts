export type Session = { user: { id: string; name: string }; csrf: string };
export type Resource = {
  name: string;
  path?: string;
  url?: string;
  size: number;
  isDir: boolean;
  modified: string;
  type?: string;
  extension?: string;
  items?: Resource[];
  numDirs?: number;
  numFiles?: number;
};
export type TrashEntry = {
  id: string;
  originalPath: string;
  trashPath: string;
  size: number;
  deletedAt: string;
  expiresAt: string;
};
export type StorageUsage = { total: number; used: number };

let csrf = "";

// App registers a handler here so a mid-session 401 (expired upstream token —
// the gateway has already cleared our cookie) drops us straight to the login
// view instead of leaving a wall of failed requests behind a stale UI.
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(fn: () => void): void { onSessionLost = fn; }

async function request(url: string, options: RequestInit = {}, expectJson = true) {
  const headers = new Headers(options.headers);
  if (csrf && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrf);
  if (options.body && typeof options.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    // Not for the initial session probe — that 401 just means "show login".
    if (response.status === 401 && !url.endsWith("/session")) onSessionLost?.();
    const payload = await response.json().catch(() => ({ error: `${response.status} ${response.statusText}` }));
    throw new Error(payload.error ?? "Request failed");
  }
  return expectJson ? response.json() : response;
}

export async function getSession(): Promise<Session | null> {
  try {
    const session = await request("/api/auth/files/session") as Session;
    csrf = session.csrf;
    return session;
  } catch { return null; }
}

export async function login(username: string, password: string): Promise<Session> {
  const session = await request("/api/auth/files/login", { method: "POST", body: JSON.stringify({ username, password }) }) as Session;
  csrf = session.csrf;
  return session;
}

export async function logout(): Promise<void> {
  await request("/api/auth/files/session", { method: "DELETE" });
  csrf = "";
}

function encodedPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function rawUrl(path: string, inline = true): string {
  return `/api/files/proxy/raw${encodedPath(path)}${inline ? "?inline=true" : ""}`;
}

export async function getResource(path: string): Promise<Resource> {
  return request(`/api/files/proxy/resources${encodedPath(path)}`) as Promise<Resource>;
}

export async function getText(path: string): Promise<{ text: string; etag: string | null; modified: string | null }> {
  const response = await request(rawUrl(path), {}, false) as Response;
  return { text: await response.text(), etag: response.headers.get("ETag"), modified: response.headers.get("Last-Modified") };
}

export async function saveText(path: string, text: string, etag?: string | null): Promise<{ etag: string | null; modified: string | null }> {
  const headers = new Headers();
  if (etag) headers.set("If-Match", etag);
  const response = await request(`/api/files/proxy/resources${encodedPath(path)}`, { method: "PUT", body: text, headers }, false) as Response;
  return { etag: response.headers.get("ETag") ?? etag ?? null, modified: response.headers.get("Last-Modified") };
}

export async function createResource(path: string, directory: boolean): Promise<void> {
  const target = `${encodedPath(path)}${directory ? "/" : ""}`;
  await request(`/api/files/proxy/resources${target}?override=false`, { method: "POST", body: "" }, false);
}

export async function transformResource(from: string, to: string, copy: boolean): Promise<void> {
  const query = new URLSearchParams({ action: copy ? "copy" : "rename", destination: to, override: "false", rename: "false" });
  await request(`/api/files/proxy/resources${encodedPath(from)}?${query}`, { method: "PATCH" }, false);
}

export async function uploadFile(directory: string, file: File, onProgress?: (value: number) => void): Promise<void> {
  const target = `${directory.replace(/\/$/, "")}/${file.name}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/files/proxy/resources${encodedPath(target)}?override=false`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total);
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload connection failed"));
    xhr.send(file);
  });
}

export async function trash(path: string, size: number): Promise<void> {
  await request("/api/files/trash", { method: "POST", body: JSON.stringify({ path, size }) });
}

export async function listTrash(): Promise<TrashEntry[]> {
  return request("/api/files/trash") as Promise<TrashEntry[]>;
}

export async function restoreTrash(id: string): Promise<{ restoredPath: string }> {
  return request(`/api/files/trash/${id}/restore`, { method: "POST" }) as Promise<{ restoredPath: string }>;
}

export async function purgeTrash(id: string): Promise<void> {
  await request(`/api/files/trash/${id}`, { method: "DELETE" });
}

export async function adminResource<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request(`/api/files/proxy/${path}`, options) as Promise<T>;
}

export async function createUser(username: string, password: string, admin: boolean): Promise<void> {
  await adminResource("users", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      scope: "/",
      locale: "en",
      viewMode: "mosaic",
      singleClick: false,
      perm: { admin, execute: false, create: true, rename: true, modify: true, delete: true, share: true, download: true },
      commands: [],
      lockPassword: false,
      hideDotfiles: false,
    }),
  });
}

export async function deleteUser(id: number, currentPassword: string): Promise<void> {
  await request(`/api/files/proxy/users/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ current_password: currentPassword }),
  }, false);
}

export async function getStorageUsage(): Promise<StorageUsage> {
  return adminResource<StorageUsage>("usage");
}

export function currentCsrf(): string { return csrf; }
