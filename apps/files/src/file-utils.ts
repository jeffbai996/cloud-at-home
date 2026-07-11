export type EditorMode = "edit" | "read" | "download";
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

export function editorModeFor(bytes: number): EditorMode {
  if (bytes <= 5 * 1024 * 1024) return "edit";
  if (bytes <= 50 * 1024 * 1024) return "read";
  return "download";
}
