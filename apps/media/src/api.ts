export type Session = { user: { id: string; name: string }; csrf: string };

export type MediaItem = {
  Id: string;
  Name: string;
  Type: "Movie" | "Series" | "Season" | "Episode";
  ProductionYear?: number;
  Overview?: string;
  RunTimeTicks?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  SeriesName?: string;
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
      IsDefault?: boolean;
      IsExternal?: boolean;
      DeliveryUrl?: string;
    }>;
  }>;
};

let csrf = "";

async function json<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (csrf && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrf);
  const response = await fetch(url, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: `${response.status} ${response.statusText}` }));
    throw new Error(payload.error ?? "Request failed");
  }
  return response.json() as Promise<T>;
}

export async function getSession(): Promise<Session | null> {
  try {
    const session = await json<Session>("/api/auth/media/session");
    csrf = session.csrf;
    return session;
  } catch {
    return null;
  }
}

export async function login(username: string, password: string): Promise<Session> {
  const session = await json<Session>("/api/auth/media/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  csrf = session.csrf;
  return session;
}

export async function mediaRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  return json<T>(`/api/media/proxy/${path}`, options);
}

export function imageUrl(item: MediaItem, kind: "Primary" | "Backdrop" = "Primary", width = 720): string {
  return `/api/media/proxy/Items/${item.Id}/Images/${kind}?maxWidth=${width}&quality=88`;
}

export async function loadHome(userId: string) {
  const fields = "Overview,PrimaryImageAspectRatio,MediaSources,DateCreated,Genres";
  const [resume, latest, movies, series] = await Promise.all([
    mediaRequest<{ Items: MediaItem[] }>(`Users/${userId}/Items/Resume?Limit=20&MediaTypes=Video&Fields=${fields}`),
    mediaRequest<MediaItem[]>(`Users/${userId}/Items/Latest?Limit=24&IncludeItemTypes=Movie,Episode&Fields=${fields}`),
    mediaRequest<{ Items: MediaItem[] }>(`Users/${userId}/Items?Recursive=true&IncludeItemTypes=Movie&SortBy=SortName&Fields=${fields}&Limit=100`),
    mediaRequest<{ Items: MediaItem[] }>(`Users/${userId}/Items?Recursive=true&IncludeItemTypes=Series&SortBy=SortName&Fields=${fields}&Limit=100`),
  ]);
  return { resume: resume.Items ?? [], latest: latest ?? [], movies: movies.Items ?? [], series: series.Items ?? [] };
}

export async function search(userId: string, term: string): Promise<MediaItem[]> {
  if (!term.trim()) return [];
  const result = await mediaRequest<{ Items: MediaItem[] }>(
    `Users/${userId}/Items?Recursive=true&IncludeItemTypes=Movie,Series,Episode&SearchTerm=${encodeURIComponent(term)}&Limit=40&Fields=Overview`,
  );
  return result.Items ?? [];
}

export async function getSeriesEpisodes(seriesId: string, userId: string): Promise<MediaItem[]> {
  const result = await mediaRequest<{ Items: MediaItem[] }>(
    `Shows/${seriesId}/Episodes?UserId=${encodeURIComponent(userId)}&Fields=Overview,PrimaryImageAspectRatio&EnableUserData=true`,
  );
  return result.Items ?? [];
}

export async function getPlaybackInfo(itemId: string, userId: string): Promise<PlaybackInfo> {
  return mediaRequest<PlaybackInfo>(`Items/${itemId}/PlaybackInfo?UserId=${userId}`, {
    method: "POST",
    body: JSON.stringify({ UserId: userId, EnableDirectPlay: true, EnableDirectStream: true, EnableTranscoding: true }),
  });
}

export async function reportPlayback(
  event: "start" | "progress" | "stop",
  payload: Record<string, unknown>,
): Promise<void> {
  const endpoint = event === "start" ? "Sessions/Playing" : event === "stop" ? "Sessions/Playing/Stopped" : "Sessions/Playing/Progress";
  await mediaRequest(endpoint, { method: "POST", body: JSON.stringify(payload) });
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
