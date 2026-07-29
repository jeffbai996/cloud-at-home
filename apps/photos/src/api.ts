// The ONLY module that knows what backend sits under Photos. Today that is
// FileBrowser through the gateway's files service; the planned endgame is
// Immich. Nothing outside this file may depend on a backend response shape —
// that constraint is what makes the swap a one-file rewrite.

import { lightboxKindFor } from "@cloud-at-home/ui";

export type Session = { user: { id: string; name: string }; csrf: string };

let csrf = "";

// App registers a handler so a mid-session 401 (expired upstream token — the
// gateway has already cleared our cookie) drops straight to the login view
// instead of leaving a wall of failed requests behind a stale UI.
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(fn: () => void): void { onSessionLost = fn; }

async function request(url: string, options: RequestInit = {}, expectJson = true) {
  const headers = new Headers(options.headers);
  if (csrf && options.method && options.method !== "GET" && !headers.has("X-CSRF-Token")) {
    headers.set("X-CSRF-Token", csrf);
  }
  const response = await fetch(url, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    if (response.status === 401 && !url.endsWith("/session")) onSessionLost?.();
    const payload = await response.json().catch(() => ({ error: `${response.status} ${response.statusText}` }));
    throw new Error(payload.error ?? "Request failed");
  }
  return expectJson ? response.json() : response;
}

function jsonRequest(url: string, options: RequestInit = {}, expectJson = true) {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  return request(url, { ...options, headers }, expectJson);
}

export async function getSession(): Promise<Session | null> {
  try {
    const session = await request("/api/auth/files/session") as Session;
    csrf = session.csrf;
    return session;
  } catch { return null; }
}

export async function login(username: string, password: string): Promise<Session> {
  const session = await jsonRequest("/api/auth/files/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  }) as Session;
  csrf = session.csrf;
  return session;
}

export async function logout(): Promise<void> {
  await request("/api/auth/files/session", { method: "DELETE" });
  csrf = "";
}

export async function loginPhotos(username: string, password: string): Promise<Session> {
  const session = await jsonRequest("/api/auth/photos/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  }) as Session;
  photosCsrf = session.csrf;
  photosSessionReady = Promise.resolve(true);
  return session;
}

export async function logoutPhotos(): Promise<void> {
  await request("/api/auth/photos/session", {
    method: "DELETE", headers: { "X-CSRF-Token": photosCsrf },
  });
  photosCsrf = "";
  photosSessionReady = null;
}

// ── the adapter proper ──────────────────────────────────────────────────────

export type Album = { path: string; name: string; count: number; coverThumbUrl: string | null };
export type Photo = { path: string; name: string; date: string; kind: "image" | "video" };

// FileBrowser resource rows, used ONLY inside this module.
type ResourceItem = {
  name: string; path?: string; isDir: boolean; size: number; modified: string;
  numFiles?: number; items?: ResourceItem[];
};

export const PHOTOS_ROOT: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PHOTOS_ROOT || "photos")
    .replace(/^\/+|\/+$/g, "");

function encodedPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function childPath(parent: string, name: string): string {
  const base = `/${parent.split("/").filter(Boolean).join("/")}`;
  return `${base === "/" ? "" : base}/${name}`;
}

function assertUnderRoot(path: string): void {
  const clean = path.replace(/^\/+/, "");
  if (clean !== PHOTOS_ROOT && !clean.startsWith(`${PHOTOS_ROOT}/`)) {
    throw new Error(`path escapes the photo library: ${path}`);
  }
}

export function thumbUrl(photo: Photo): string {
  return `/api/photos/proxy/preview/thumb${encodedPath(photo.path)}`;
}

export function previewUrl(photo: Photo): string {
  return `/api/photos/proxy/preview/big${encodedPath(photo.path)}`;
}

export function fullUrl(photo: Photo): string {
  return `/api/photos/proxy/raw${encodedPath(photo.path)}?inline=true`;
}

export function photosFromResource(
  resource: { items?: ResourceItem[] }, parentPath?: string,
): Photo[] {
  return (resource.items ?? [])
    .filter((item) => !item.isDir)
    .flatMap((item) => {
      const kind = lightboxKindFor(item.name);
      if (!kind) return [];
      return [{
        path: parentPath ? childPath(parentPath, item.name) : item.path ?? "",
        name: item.name,
        date: item.modified,
        kind,
      }];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function albumsFromResource(
  resource: { items?: ResourceItem[] }, parentPath?: string,
): Album[] {
  return (resource.items ?? [])
    .filter((item) => item.isDir)
    .map((item) => ({
      path: parentPath ? childPath(parentPath, item.name) : item.path ?? "",
      name: item.name,
      count: item.numFiles ?? 0,
      coverThumbUrl: null,
    }));
}

export function monthGroups(photos: Photo[]): { label: string; photos: Photo[] }[] {
  const groups: { label: string; photos: Photo[] }[] = [];
  const seen = new Map<string, { label: string; photos: Photo[] }>();
  for (const photo of photos) {
    const stamp = new Date(photo.date);
    const key = `${stamp.getUTCFullYear()}-${stamp.getUTCMonth()}`;
    let group = seen.get(key);
    if (!group) {
      group = {
        label: stamp.toLocaleDateString("en-US",
          { month: "long", year: "numeric", timeZone: "UTC" }),
        photos: [],
      };
      seen.set(key, group);
      groups.push(group);
    }
    group.photos.push(photo);
  }
  return groups;
}

// Library listings go through the photos service: read-only, scoped to the
// library root by the gateway policy, and sessioned automatically — viewing
// photos never shows a login. One retry after re-ensuring the session covers
// an expired upstream token.
let photosSessionReady: Promise<boolean> | null = null;
let photosCsrf = "";
export function ensurePhotosSession(force = false): Promise<boolean> {
  if (!photosSessionReady || force) {
    photosSessionReady = fetch("/api/auth/photos/session", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return false;
        const payload = await response.json() as { csrf?: string };
        photosCsrf = payload.csrf ?? "";
        return true;
      })
      .catch(() => false);
  }
  return photosSessionReady;
}

async function photosRequest(url: string): Promise<unknown> {
  await ensurePhotosSession();
  let response = await fetch(url, { credentials: "include" });
  if (response.status === 401) {
    await ensurePhotosSession(true);
    response = await fetch(url, { credentials: "include" });
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: `${response.status} ${response.statusText}` }));
    throw new Error(payload.error ?? "Request failed");
  }
  return response.json();
}

async function getResourceRaw(path: string): Promise<ResourceItem> {
  return photosRequest(`/api/photos/proxy/resources${encodedPath(path)}`) as Promise<ResourceItem>;
}

export async function listPhotosRecursive(
  path: string,
  load: (path: string) => Promise<{ items?: ResourceItem[] }> = getResourceRaw,
): Promise<Photo[]> {
  assertUnderRoot(path);
  const resource = await load(path);
  const local = photosFromResource(resource, path);
  const folders = (resource.items ?? []).filter((item) => item.isDir);
  const nested = await Promise.allSettled(
    folders.map((folder) => listPhotosRecursive(childPath(path, folder.name), load)),
  );
  return local.concat(nested.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function listAlbums(): Promise<Album[]> {
  const root = `/${PHOTOS_ROOT}`;
  return albumsFromResource(await getResourceRaw(root), root);
}

export async function listPhotos(album: string): Promise<Photo[]> {
  assertUnderRoot(album);
  const path = album.startsWith("/") ? album : `/${album}`;
  if (path === `/${PHOTOS_ROOT}`) return listPhotosRecursive(path);
  return photosFromResource(await getResourceRaw(path), path);
}

// First media file of an album, for its cover card. One extra listing per
// album, fetched lazily by the card and cached here.
const coverCache = new Map<string, string | null>();
export async function albumCover(album: Album): Promise<string | null> {
  const cached = coverCache.get(album.path);
  if (cached !== undefined) return cached;
  const photos = await listPhotos(album.path).catch(() => [] as Photo[]);
  const cover = photos.length ? thumbUrl(photos[0]) : null;
  coverCache.set(album.path, cover);
  return cover;
}

// ── Drive browsing + import (used by the Import-from-Drive picker) ─────────

export type DriveEntry = { name: string; path: string; isDir: boolean };

export function isIngestibleMedia(name: string): boolean {
  return lightboxKindFor(name) !== null;
}

export function driveEntriesFromResource(
  resource: { items?: ResourceItem[] }, parentPath: string,
): DriveEntry[] {
  return (resource.items ?? [])
    .filter((item) => item.isDir || isIngestibleMedia(item.name))
    .map((item) => ({
      name: item.name,
      path: childPath(parentPath, item.name),
      isDir: item.isDir,
    }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
}

export async function browseDrive(path: string): Promise<DriveEntry[]> {
  const parent = path || "/";
  const resource = await request(`/api/files/proxy/resources${encodedPath(parent)}`) as ResourceItem;
  return driveEntriesFromResource(resource, parent);
}

export async function uploadPhoto(
  album: string, file: File, onProgress?: (value: number) => void,
): Promise<void> {
  if (!await getSession()) throw new Error("Sign in to Drive before uploading");
  assertUnderRoot(album);
  if (!isIngestibleMedia(file.name)) throw new Error(`${file.name} is not a supported photo or video`);
  const target = `${album.replace(/\/$/, "")}/${file.name}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/photos/upload${encodedPath(target)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total);
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload connection failed"));
    xhr.send(file);
  });
}

export async function transformResource(from: string, to: string, copy: boolean): Promise<void> {
  const query = new URLSearchParams({
    action: copy ? "copy" : "rename", destination: to,
    override: "false", rename: "false",
  });
  await request(`/api/files/proxy/resources${encodedPath(from)}?${query}`,
    { method: "PATCH" }, false);
}

export async function createDriveDirectory(path: string): Promise<void> {
  await request(`/api/files/proxy/resources${encodedPath(path)}/?override=false`,
    { method: "POST", body: "" }, false);
}

export async function createAlbum(
  parent: string, name: string,
  create: (path: string) => Promise<void> = createDriveDirectory,
): Promise<void> {
  assertUnderRoot(parent);
  const clean = name.trim();
  if (!clean || clean === "." || clean === ".." || /[\\/]/.test(clean)) {
    throw new Error("Enter a valid album name");
  }
  await create(`${parent.replace(/\/+$/, "")}/${clean}`);
}

export async function organizePhotos(
  photos: Photo[], destination: string, copy: boolean,
  transform: (from: string, to: string, copy: boolean) => Promise<void> = transformResource,
): Promise<{ done: number; failed: string[] }> {
  assertUnderRoot(destination);
  let done = 0;
  const failed: string[] = [];
  for (const photo of photos) {
    try {
      await transform(photo.path, `${destination.replace(/\/+$/, "")}/${photo.name}`, copy);
      done += 1;
    } catch (failure) {
      failed.push(`${photo.name}: ${failure instanceof Error ? failure.message : "operation failed"}`);
    }
  }
  return { done, failed };
}

// Copies (never moves) each source into the album. Failures are collected,
// not fatal — one name collision must not abort the rest of the batch.
export async function importFromDrive(
  sources: string[], album: string,
  copyFn: (from: string, to: string, copy: boolean) => Promise<void> = transformResource,
): Promise<{ done: number; failed: string[] }> {
  const target = album.replace(/\/+$/, "");
  assertUnderRoot(target);
  let done = 0;
  const failed: string[] = [];
  for (const source of sources) {
    const name = source.split("/").filter(Boolean).pop() ?? source;
    try {
      await copyFn(source, `${target}/${name}`, true);
      done += 1;
    } catch (failure) {
      failed.push(`${name}: ${failure instanceof Error ? failure.message : "copy failed"}`);
    }
  }
  return { done, failed };
}
