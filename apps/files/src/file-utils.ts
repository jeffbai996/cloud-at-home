export type EditorMode = "edit" | "read" | "download";

export function isReadOnlyPath(path: string): boolean {
  const normalized = `/${path.replace(/\\/g, "/").split("/").filter(Boolean).join("/")}`;
  return normalized === "/Media Drive" || normalized.startsWith("/Media Drive/");
}
export type ViewerKind = "text" | "markdown" | "html" | "image" | "video" | "audio" | "pdf" | "download";

const textExtensions = new Set([
  "txt", "text", "md", "markdown", "mdx", "rst", "adoc", "log", "srt", "vtt", "ass", "ssa",
  "json", "jsonc", "json5", "jsonl", "ndjson", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
  "csv", "tsv", "xml", "xsl", "xsd", "graphql", "gql", "sql", "proto",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "css", "scss", "sass", "less", "html", "htm", "svg",
  "py", "pyi", "rb", "php", "java", "kt", "kts", "swift", "go", "rs", "c", "h", "cc", "cpp", "cxx", "hpp",
  "cs", "fs", "fsx", "scala", "clj", "cljs", "dart", "lua", "r", "pl", "pm", "ex", "exs", "erl", "hrl",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "vue", "svelte", "astro", "tex", "bib",
  "diff", "patch", "properties", "gradle", "make", "mk", "dockerfile", "gitignore", "gitattributes",
]);
const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "bmp", "ico"]);
const videoExtensions = new Set(["mp4", "m4v", "webm", "mov", "mkv", "ogv"]);
const audioExtensions = new Set(["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac"]);
const specialLanguages: Record<string, string> = {
  dockerfile: "dockerfile", makefile: "makefile", gnumakefile: "makefile", rakefile: "ruby", gemfile: "ruby",
  procfile: "shell", ".gitignore": "plaintext", ".gitattributes": "plaintext", ".editorconfig": "ini",
};
const languageAliases: Record<string, string> = {
  py: "python", pyi: "python", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", md: "markdown", mdx: "markdown", markdown: "markdown", yml: "yaml",
  sh: "shell", bash: "shell", zsh: "shell", jsonl: "json", ndjson: "json", jsonc: "json", conf: "ini",
  cfg: "ini", env: "ini", htm: "html", svg: "xml", xsl: "xml", xsd: "xml", h: "cpp", cc: "cpp",
  cxx: "cpp", hpp: "cpp", rs: "rust", rb: "ruby", kt: "kotlin", kts: "kotlin", cs: "csharp",
  fs: "fsharp", fsx: "fsharp", ps1: "powershell", bat: "bat", cmd: "bat", gql: "graphql", tex: "latex",
};

export function extensionFor(name: string): string {
  const base = name.toLowerCase().split("/").pop() ?? "";
  if (specialLanguages[base]) return base;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : base;
}

export function isTextFile(name: string, type?: string): boolean {
  const extension = extensionFor(name);
  return type?.startsWith("text/") === true || textExtensions.has(extension) || extension in specialLanguages;
}

export function languageForFile(name: string): string {
  const extension = extensionFor(name);
  return specialLanguages[extension] ?? languageAliases[extension] ?? (textExtensions.has(extension) ? extension : "plaintext");
}

export function viewerKindFor(name: string, type?: string): ViewerKind {
  const extension = extensionFor(name);
  if (extension === "pdf" || type === "application/pdf") return "pdf";
  if (imageExtensions.has(extension) || type?.startsWith("image/")) return extension === "svg" ? "text" : "image";
  if (videoExtensions.has(extension) || type?.startsWith("video/")) return "video";
  if (audioExtensions.has(extension) || type?.startsWith("audio/")) return "audio";
  if (extension === "md" || extension === "markdown" || extension === "mdx") return "markdown";
  if (extension === "html" || extension === "htm") return "html";
  if (isTextFile(name, type)) return "text";
  return "download";
}

export function joinPath(parent: string, child: string): string {
  const parts = `${parent}/${child}`.replaceAll("\\", "/").split("/");
  const safe = parts.filter(Boolean);
  if (safe.some((part) => part === ".." || part === "." || part.includes("\0"))) {
    throw new Error("Unsafe path");
  }
  return `/${safe.join("/")}`;
}

type PathResource = { name: string; path?: string; url?: string };

/** Prefer the path returned with a collection item over the folder currently open. */
export function resourcePath(resource: PathResource, currentPath: string): string {
  return resource.url || resource.path || joinPath(currentPath, resource.name);
}

/** Trailing path segment ("" for the root or an empty path). */
export function basename(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? "";
}

export function parentPath(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

/** Build destinations from the source path so virtual collections cannot move a file by accident. */
export function mutationDestination(action: "rename" | "move" | "copy", source: string, value: string): string {
  const name = source.split("/").filter(Boolean).pop();
  if (!name) throw new Error("Source path must name a resource");
  return action === "rename" ? joinPath(parentPath(source), value) : joinPath(value, name);
}

export function togglePath(paths: string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((entry) => entry !== path) : [...paths, path];
}

// ── batch operations ────────────────────────────────────────────────────────
// Bulk copy/move/trash used to run strictly sequentially inside one try block,
// so a failure halfway through aborted the rest and surfaced a single generic
// message — the batch was left half-applied with no indication of which items
// made it. These run every item regardless of individual failures and report
// per-item outcomes, with a small concurrency cap so a 40-file move doesn't
// become 40 serial round trips (nor 40 simultaneous ones).

export type BatchResult<T> = { item: T; ok: true } | { item: T; ok: false; error: string };

export const BATCH_CONCURRENCY = 4;

export async function runBatch<T>(
  items: readonly T[],
  operation: (item: T) => Promise<unknown>,
  concurrency = BATCH_CONCURRENCY,
): Promise<BatchResult<T>[]> {
  const results: BatchResult<T>[] = new Array(items.length);
  let cursor = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      try {
        await operation(item);
        results[index] = { item, ok: true };
      } catch (reason) {
        results[index] = { item, ok: false, error: reason instanceof Error ? reason.message : "Operation failed" };
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

/** User-facing summary of a batch, or null when every item succeeded. */
export function summarizeBatch<T>(results: readonly BatchResult<T>[], action: string, describe: (item: T) => string): string | null {
  const failures = results.filter((result): result is { item: T; ok: false; error: string } => !result.ok);
  if (!failures.length) return null;
  if (failures.length === 1) return `Could not ${action} ${describe(failures[0].item)}: ${failures[0].error}`;
  return `Could not ${action} ${failures.length} of ${results.length} items. First error — ${describe(failures[0].item)}: ${failures[0].error}`;
}

export function relativeTimestamp(value: string, now = Date.now(), locale?: string): string {
  const timestamp = new Date(value).valueOf();
  if (!Number.isFinite(timestamp)) return "Unavailable";
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function exactTimestamp(value: string, locale?: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "Unavailable";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function editorModeFor(bytes: number): EditorMode {
  if (bytes <= 5 * 1024 * 1024) return "edit";
  if (bytes <= 50 * 1024 * 1024) return "read";
  return "download";
}

// ── the photos bridge ───────────────────────────────────────────────────────
// Drive and Photos are two views over the same folder; these helpers are the
// navigation glue. Root must match the Photos app's VITE_PHOTOS_ROOT.

export const PHOTOS_ROOT: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PHOTOS_ROOT || "photos")
    .replace(/^\/+|\/+$/g, "");

export function isUnderPhotosRoot(path: string): boolean {
  const clean = path.replace(/^\/+/, "");
  return clean === PHOTOS_ROOT || clean.startsWith(`${PHOTOS_ROOT}/`);
}

export function photosDeepLink(photosOrigin: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  const parts = clean.split("/");
  const name = parts.pop() ?? "";
  const album = parts.join("/");
  return `${photosOrigin}/#/album/${encodeURIComponent(album)}?item=${encodeURIComponent(name)}`;
}
