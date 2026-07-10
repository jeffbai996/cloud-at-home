import Editor from "@monaco-editor/react";
import { Check, Code2, ExternalLink, Eye, FileDown, RotateCcw, Save, X, ZoomIn, ZoomOut } from "lucide-react";
import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
import sanitizeHtml from "sanitize-html";

import { Button } from "@cloud-at-home/ui";
import { editorModeFor } from "./file-utils";
import { getText, rawUrl, saveText, type Resource } from "./api";

const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"]);
const videoExtensions = new Set(["mp4", "m4v", "webm", "mov", "mkv"]);
const audioExtensions = new Set(["mp3", "m4a", "aac", "ogg", "wav", "flac"]);

export function FileViewer({ file, path, onClose }: { file: Resource; path: string; onClose: () => void }) {
  const extension = (file.extension ?? file.name.split(".").pop() ?? "").toLowerCase();
  const mode = editorModeFor(file.size);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(extension === "md" || extension === "markdown");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const isText = isTextFile(extension, file.type);
  const editorLanguage = languageFor(extension);
  const lineCount = text ? text.split(/\r\n|\r|\n/).length : 1;

  useEffect(() => {
    if (!isText || mode === "download") { setLoading(false); return; }
    void getText(path).then((result) => { setText(result.text); setOriginal(result.text); }).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, [isText, mode, path]);

  const markdown = useMemo(() => sanitizeHtml(marked.parse(text, { async: false }) as string, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "details", "summary"]),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ["src", "alt", "title"] },
    allowedSchemes: ["http", "https", "mailto", "data"],
  }), [text]);

  async function save() {
    setSaving(true); setError("");
    try { await saveText(path, text); setOriginal(text); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div className="viewer">
      <header className="viewer-header">
        <div><strong>{file.name}</strong><span>{formatBytes(file.size)} · {mode === "edit" ? "Editable" : mode === "read" ? "Read only" : "Download only"}</span></div>
        <div className="viewer-actions">
          {(extension === "md" || extension === "markdown") && <Button variant="ghost" onClick={() => setPreview(!preview)}>{preview ? <Code2 size={16} /> : <Eye size={16} />}{preview ? "Editor" : "Preview"}</Button>}
          {isText && mode === "edit" && <Button disabled={saving || text === original} onClick={save}>{text === original ? <Check size={16} /> : <Save size={16} />}{saving ? "Saving…" : text === original ? "Saved" : "Save"}</Button>}
          {(extension === "pdf" || imageExtensions.has(extension)) && <a className="button button-ghost" href={rawUrl(path)} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open</a>}
          <a className="button button-secondary" href={rawUrl(path, false)} download><FileDown size={16} /> Download</a>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>
      </header>
      {error && <div className="viewer-error">{error}</div>}
      <div className="viewer-body">
        {loading ? <div className="editor-loading">Opening file…</div> : imageExtensions.has(extension) ? <div className="image-stage"><div className="viewer-float-tools"><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.25, value - .25))}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(4, value + .25))}><ZoomIn /></button><button aria-label="Rotate image" onClick={() => setRotation((value) => value + 90)}><RotateCcw /></button></div><div className="image-canvas"><img src={rawUrl(path)} alt={file.name} style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }} /></div></div> : videoExtensions.has(extension) ? <div className="media-stage"><video src={rawUrl(path)} controls autoPlay playsInline /></div> : audioExtensions.has(extension) ? <div className="media-stage audio-stage"><div><strong>{file.name}</strong><audio src={rawUrl(path)} controls autoPlay /></div></div> : extension === "pdf" ? <div className="document-stage"><iframe className="pdf-frame" src={rawUrl(path)} title={file.name} /></div> : isText && mode !== "download" ? preview ? <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: markdown }} /> : <div className="editor-shell"><Editor height="100%" theme="vs-dark" value={text} onChange={(value) => setText(value ?? "")} language={editorLanguage} options={{ readOnly: mode !== "edit", fontSize: 14, lineHeight: 22, fontFamily: "'SFMono-Regular', 'Cascadia Code', Consolas, monospace", fontLigatures: true, minimap: { enabled: file.size < 512_000 }, smoothScrolling: true, cursorSmoothCaretAnimation: "on", cursorBlinking: "smooth", renderLineHighlight: "all", bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, stickyScroll: { enabled: true }, padding: { top: 16, bottom: 16 }, wordWrap: extension === "md" ? "on" : "off", automaticLayout: true, formatOnPaste: true, scrollBeyondLastLine: false }} /><footer className="editor-status"><span>{editorLanguage}</span><span>{lineCount} {lineCount === 1 ? "line" : "lines"}</span><span>UTF-8</span><span>{mode === "edit" ? "Editable" : "Read only"}</span></footer></div> : <div className="unsupported"><FileDown size={36} /><h2>No safe preview for .{extension || "binary"}</h2><p>{formatBytes(file.size)} · Download the original without conversion or quality loss.</p><a className="button button-primary" href={rawUrl(path, false)} download>Download file</a></div>}
      </div>
    </div>
  );
}

function isTextFile(extension: string, type?: string): boolean {
  return type?.startsWith("text/") || ["txt", "md", "markdown", "json", "jsonl", "js", "jsx", "ts", "tsx", "py", "css", "html", "xml", "yaml", "yml", "toml", "ini", "conf", "log", "sh", "sql", "csv"].includes(extension);
}
function languageFor(extension: string): string {
  return (({ py: "python", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", md: "markdown", yml: "yaml", sh: "shell", jsonl: "json", conf: "ini" } as Record<string, string>)[extension] ?? extension) || "plaintext";
}
function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024; let unit = units[0];
  for (let index = 1; size >= 1024 && index < units.length; index += 1) { size /= 1024; unit = units[index]; }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}
