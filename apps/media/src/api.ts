import { webPlaybackProfile } from "./playback";

export type Session = { user: { id: string; name: string }; csrf: string };

export type MediaItem = {
  Id: string;
  Name: string;
  Type: "Movie" | "Series" | "Season" | "Episode";
  ProductionYear?: number;
  PremiereDate?: string;
  EndDate?: string;
  Status?: string;
  SeriesProductionYear?: number;
  SeriesEndDate?: string;
  Overview?: string;
  OfficialRating?: string;
  CommunityRating?: number;
  CriticRating?: number;
  Genres?: string[];
  Studios?: Array<{ Name: string }>;
  ProductionLocations?: string[];
  RunTimeTicks?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  SeriesName?: string;
  SeriesId?: string;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  UserData?: { PlaybackPositionTicks?: number; PlayedPercentage?: number; Played?: boolean };
};

export type PlaybackInfo = {
  PlaySessionId: string;
  MediaSources: Array<{
    Id: string;
    Path?: string;
    Container?: string;
    SupportsDirectPlay: boolean;
    SupportsTranscoding: boolean;
    TranscodingUrl?: string;
    Trickplay?: Record<string, Record<string, {
      Width: number;
      Height: number;
      TileWidth: number;
      TileHeight: number;
      ThumbnailCount: number;
      Interval: number;
      Bandwidth: number;
    }>>;
    MediaStreams?: Array<{
      Index: number;
      Type: "Audio" | "Subtitle" | "Video";
      DisplayTitle?: string;
      Language?: string;
      Codec?: string;
      Width?: number;
      Height?: number;
      IsDefault?: boolean;
      IsExternal?: boolean;
      DeliveryUrl?: string;
    }>;
  }>;
};

let csrf = "";

export class MediaRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MediaRequestError";
  }
}

export function httpErrorMessage(status: number, statusText = "", detail = ""): string {
  const descriptions: Record<number, string> = {
    400: "Bad request — the service could not understand the request.",
    401: "Authentication expired — sign in again.",
    403: "Request blocked — this profile does not have permission.",
    404: "Not found — the requested media resource is unavailable.",
    408: "Request timed out — try again.",
    429: "Too many requests — wait a moment and retry.",
    500: "Server error — the service could not complete the request.",
    502: "Gateway error — the upstream service returned an invalid response.",
    503: "Service unavailable — Jellyfin may be restarting.",
    504: "Gateway timeout — Jellyfin took too long to respond.",
  };
  const cleanDetail = detail.trim();
  return `${status}: ${cleanDetail || descriptions[status] || statusText || "Request failed."}`;
}

async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (csrf && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrf);
  let response: Response;
  try { response = await fetch(url, { ...options, headers, credentials: "include" }); }
  catch { throw new Error("Network error: Could not reach Cloud Media."); }
  if (response.status === 401 && url.startsWith("/api/media/") && url !== "/api/auth/media/session") {
    const refreshed = await fetch("/api/auth/media/session", { credentials: "include" });
    if (refreshed.ok) {
      const session = await refreshed.json() as Session;
      csrf = session.csrf;
      if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrf);
      response = await fetch(url, { ...options, headers, credentials: "include" });
    }
  }
  return response;
}

async function responseError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  const detail = typeof payload?.error === "string" ? payload.error : "";
  return new MediaRequestError(httpErrorMessage(response.status, response.statusText, detail), response.status);
}

async function json<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await authenticatedFetch(url, options);
  if (!response.ok) {
    throw await responseError(response);
  }
  return response.json() as Promise<T>;
}

export async function getSession(): Promise<Session | null> {
  const response = await authenticatedFetch("/api/auth/media/session", { signal: AbortSignal.timeout(5_000) });
  if (response.status === 401) return null;
  if (!response.ok) throw await responseError(response);
  const session = await response.json() as Session;
  csrf = session.csrf;
  return session;
}

export async function login(username: string, password: string): Promise<Session> {
  const session = await json<Session>("/api/auth/media/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  csrf = session.csrf;
  return session;
}

export async function logout(): Promise<void> {
  await json<{ ok: boolean }>("/api/auth/media/session", { method: "DELETE" });
  csrf = "";
}

export async function mediaRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  return json<T>(`/api/media/proxy/${path}`, options);
}

export function imageUrl(item: MediaItem, kind: "Primary" | "Backdrop" = "Primary", width = 720): string {
  const tag = kind === "Backdrop" ? item.BackdropImageTags?.[0] : item.ImageTags?.[kind];
  const cacheKey = tag ? `&tag=${encodeURIComponent(tag)}` : "";
  return `/api/media/proxy/Items/${item.Id}/Images/${kind}?maxWidth=${width}&quality=88${cacheKey}`;
}

export function normalizeSubtitleVtt(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^Region:[^\n]*\n+/m, "");
}

export async function loadSubtitleTrack(itemId: string, sourceId: string, index: number): Promise<string> {
  const path = `Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(sourceId)}/Subtitles/${index}/Stream.vtt`;
  const response = await authenticatedFetch(`/api/media/proxy/${path}`);
  if (!response.ok) throw await responseError(response);
  const vtt = normalizeSubtitleVtt(await response.text());
  if (!vtt.startsWith("WEBVTT")) throw new Error("Invalid subtitle data returned by Jellyfin.");
  return URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
}

export async function loadHome(userId: string) {
  const fields = "Overview,PrimaryImageAspectRatio,MediaSources,DateCreated,PremiereDate,EndDate,Status,Genres,Studios,ProductionLocations,OfficialRating,CommunityRating,CriticRating";
  const [resume, latest, movies, series] = await Promise.all([
    mediaRequest<{ Items: MediaItem[] }>(`Users/${userId}/Items/Resume?Limit=20&MediaTypes=Video&Fields=${fields}`),
    mediaRequest<MediaItem[]>(`Users/${userId}/Items/Latest?Limit=24&IncludeItemTypes=Movie,Episode&Fields=${fields}`),
    mediaRequest<{ Items: MediaItem[] }>(`Users/${userId}/Items?Recursive=true&IncludeItemTypes=Movie&SortBy=SortName&Fields=${fields}&Limit=100`),
    mediaRequest<{ Items: MediaItem[] }>(`Users/${userId}/Items?Recursive=true&IncludeItemTypes=Series&SortBy=SortName&Fields=${fields}&Limit=100`),
  ]);
  const shows = series.Items ?? [];
  const byId = new Map(shows.map((show) => [show.Id, show]));
  const byName = new Map(shows.map((show) => [show.Name, show]));
  const enrich = (item: MediaItem): MediaItem => {
    if (item.Type !== "Episode") return item;
    const show = (item.SeriesId ? byId.get(item.SeriesId) : undefined) ?? (item.SeriesName ? byName.get(item.SeriesName) : undefined);
    if (!show) return item;
    return { ...item, SeriesName: item.SeriesName ?? show.Name, SeriesProductionYear: show.ProductionYear, SeriesEndDate: show.EndDate };
  };
  return { resume: (resume.Items ?? []).map(enrich), latest: (latest ?? []).map(enrich), movies: movies.Items ?? [], series: shows };
}

export function watchHistoryItemIds(...groups: MediaItem[][]): string[] {
  return [...new Set(groups.flat().map((item) => item.Id))];
}

export async function clearWatchHistory(userId: string): Promise<number> {
  const base = `Users/${encodeURIComponent(userId)}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&EnableUserData=true&Limit=10000&Filters=`;
  const [played, resumable] = await Promise.all([
    mediaRequest<{ Items: MediaItem[] }>(`${base}IsPlayed`),
    mediaRequest<{ Items: MediaItem[] }>(`${base}IsResumable`),
  ]);
  const ids = watchHistoryItemIds(played.Items ?? [], resumable.Items ?? []);
  await Promise.all(ids.map((itemId) => mediaRequest(
    `UserPlayedItems/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  )));
  return ids.length;
}

export async function search(userId: string, term: string): Promise<MediaItem[]> {
  if (!term.trim()) return [];
  const result = await mediaRequest<{ Items: MediaItem[] }>(
    `Users/${userId}/Items?Recursive=true&IncludeItemTypes=Movie,Series,Episode&SearchTerm=${encodeURIComponent(term)}&Limit=40&Fields=Overview,PremiereDate,EndDate,Status,Genres,Studios,ProductionLocations,OfficialRating,CommunityRating,CriticRating`,
  );
  return result.Items ?? [];
}

export function episodesForSeries(items: MediaItem[], seriesId: string): MediaItem[] {
  return items.filter((item) => item.Type === "Episode" && item.SeriesId === seriesId);
}

export async function getSeriesEpisodes(seriesId: string, userId: string): Promise<MediaItem[]> {
  const fields = "Overview,PrimaryImageAspectRatio,Genres,Studios,ProductionLocations,OfficialRating,CommunityRating,CriticRating,SeriesId,SeriesName";
  try {
    const result = await mediaRequest<{ Items: MediaItem[] }>(
      `Shows/${seriesId}/Episodes?UserId=${encodeURIComponent(userId)}&Fields=${fields}&EnableUserData=true`,
    );
    const scoped = episodesForSeries(result.Items ?? [], seriesId);
    if (scoped.length) return scoped;
  } catch {
    // Some Jellyfin libraries reject the Shows endpoint even though the same
    // episodes remain available through the recursive user-items endpoint.
  }
  const fallback = await mediaRequest<{ Items: MediaItem[] }>(
    `Users/${encodeURIComponent(userId)}/Items?Recursive=true&IncludeItemTypes=Episode&SeriesId=${encodeURIComponent(seriesId)}&Fields=${fields}&EnableUserData=true`,
  );
  return episodesForSeries(fallback.Items ?? [], seriesId);
}

export async function getMediaItem(itemId: string, userId: string): Promise<MediaItem> {
  return mediaRequest<MediaItem>(
    `Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}?Fields=Overview,PremiereDate,EndDate,Status,Genres,Studios,ProductionLocations,OfficialRating,CommunityRating,CriticRating`,
  );
}

export async function getPlaybackInfo(itemId: string, userId: string): Promise<PlaybackInfo> {
  return mediaRequest<PlaybackInfo>(`Items/${itemId}/PlaybackInfo?UserId=${userId}`, {
    method: "POST",
    body: JSON.stringify({
      UserId: userId,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      SubtitleStreamIndex: -1,
      DeviceProfile: webPlaybackProfile,
    }),
  });
}

export async function reportPlayback(
  event: "start" | "progress" | "stop",
  payload: Record<string, unknown>,
  keepalive = false,
): Promise<void> {
  const endpoint = event === "start" ? "Sessions/Playing" : event === "stop" ? "Sessions/Playing/Stopped" : "Sessions/Playing/Progress";
  await mediaRequest(endpoint, { method: "POST", body: JSON.stringify(payload), keepalive });
}

export async function createStreamTicket(itemId: string): Promise<string> {
  const result = await json<{ ticket: string }>("/api/media/tickets", {
    method: "POST",
    body: JSON.stringify({ itemId }),
  });
  return result.ticket;
}

export function ticketedStreamUrl(ticket: string, target: string): string {
  return `/api/media/stream/${encodeURIComponent(ticket)}/${target.replace(/^\//, "")}`;
}
