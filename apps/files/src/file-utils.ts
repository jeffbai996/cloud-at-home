export type EditorMode = "edit" | "read" | "download";

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
