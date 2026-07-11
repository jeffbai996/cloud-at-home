import Editor, { type OnMount } from "@monaco-editor/react";
import { Check, Code2, Command, ExternalLink, Eye, FileDown, Minus, Plus, RotateCcw, Save, Search, WandSparkles, WrapText, X, ZoomIn, ZoomOut } from "lucide-react";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import sanitizeHtml from "sanitize-html";

import { Button } from "@cloud-at-home/ui";
import { editorModeFor, languageForFile, viewerKindFor } from "./file-utils";
import { getText, rawUrl, saveText, type Resource } from "./api";

type MonacoEditor = Parameters<OnMount>[0];

export function FileViewer({ file, path, onClose }: { file: Resource; path: string; onClose: () => void }) {
  const mode = editorModeFor(file.size);
  const kind = viewerKindFor(file.name, file.type);
  const isText = kind === "text" || kind === "markdown" || kind === "html";
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [etag, setEtag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(kind === "markdown" || kind === "html");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [wordWrap, setWordWrap] = useState(kind === "markdown" || kind === "html");
  const [minimap, setMinimap] = useState(file.size < 512_000);
  const [fontSize, setFontSize] = useState(14);
  const [position, setPosition] = useState({ line: 1, column: 1, selected: 0 });
  const editorRef = useRef<MonacoEditor | null>(null);
  const dirty = text !== original;
  const editorLanguage = languageForFile(file.name);
  const lineCount = text ? text.split(/\r\n|\r|\n/).length : 1;

  useEffect(() => {
    if (!isText || mode === "download") { setLoading(false); return; }
    void getText(path).then((result) => {
      setText(result.text);
      setOriginal(result.text);
      setEtag(result.etag);
    }).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, [isText, mode, path]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const markdown = useMemo(() => sanitizeHtml(marked.parse(text, { async: false }) as string, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "details", "summary"]),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ["src", "alt", "title"] },
    allowedSchemes: ["http", "https", "mailto", "data"],
  }), [text]);
  const safeHtml = useMemo(() => sanitizeHtml(text, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "details", "summary", "main", "header", "footer", "section", "article"]),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, "*": ["class", "id", "title"], img: ["src", "alt", "title"], a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto", "data"],
  }), [text]);

  async function save() {
    if (saving || !dirty) return;
    setSaving(true); setError("");
    try {
      const result = await saveText(path, text, etag);
      setEtag(result.etag);
      setOriginal(text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
    } finally { setSaving(false); }
  }

  function close() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  const mount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save());
    editor.onDidChangeCursorSelection((event) => setPosition({
      line: event.selection.positionLineNumber,
      column: event.selection.positionColumn,
      selected: editor.getModel()?.getValueInRange(event.selection).length ?? 0,
    }));
    editor.focus();
  };

  const canPreview = kind === "markdown" || kind === "html";
  const editorAction = (id: string) => { void editorRef.current?.getAction(id)?.run(); editorRef.current?.focus(); };

  return (
    <div className="viewer">
      <header className="viewer-header">
        <div><strong>{file.name}{dirty ? " •" : ""}</strong><span>{formatBytes(file.size)} · {mode === "edit" ? "Editable" : mode === "read" ? "Read only" : "Download only"}</span></div>
        <div className="viewer-actions">
          {canPreview && <Button variant="ghost" onClick={() => setPreview(!preview)}>{preview ? <Code2 size={16} /> : <Eye size={16} />}{preview ? "Editor" : "Preview"}</Button>}
          {isText && !preview && <>
            <Button variant="ghost" title="Find (Ctrl/Cmd+F)" onClick={() => editorAction("actions.find")}><Search size={16} />Find</Button>
            <Button variant="ghost" title="Command palette (F1)" onClick={() => editorAction("editor.action.quickCommand")}><Command size={16} />Commands</Button>
            <Button variant="ghost" title="Format document" onClick={() => editorAction("editor.action.formatDocument")}><WandSparkles size={16} />Format</Button>
          </>}
          {isText && mode === "edit" && <Button disabled={saving || !dirty} onClick={() => void save()}>{!dirty ? <Check size={16} /> : <Save size={16} />}{saving ? "Saving…" : !dirty ? "Saved" : "Save"}</Button>}
          {(kind === "pdf" || kind === "image") && <a className="button button-ghost" href={rawUrl(path)} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open</a>}
          <a className="button button-secondary" href={rawUrl(path, false)} download><FileDown size={16} /> Download</a>
          <button className="icon-button" aria-label="Close viewer" onClick={close}><X /></button>
        </div>
      </header>
      {error && <div className="viewer-error">{error}{error.includes("412") && " The file changed on disk; reopen it before saving."}</div>}
      <div className="viewer-body">
        {loading ? <div className="editor-loading">Opening file…</div>
          : kind === "image" ? <div className="image-stage"><div className="viewer-float-tools"><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.25, value - .25))}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(4, value + .25))}><ZoomIn /></button><button aria-label="Rotate image" onClick={() => setRotation((value) => value + 90)}><RotateCcw /></button></div><div className="image-canvas"><img src={rawUrl(path)} alt={file.name} style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }} /></div></div>
          : kind === "video" ? <div className="media-stage"><video src={rawUrl(path)} controls autoPlay playsInline /></div>
          : kind === "audio" ? <div className="media-stage audio-stage"><div><strong>{file.name}</strong><audio src={rawUrl(path)} controls autoPlay /></div></div>
          : kind === "pdf" ? <div className="document-stage"><iframe className="pdf-frame" src={rawUrl(path)} title={file.name} /></div>
          : isText && mode !== "download" ? preview
            ? kind === "html" ? <iframe className="html-preview" sandbox="" srcDoc={safeHtml} title={`${file.name} preview`} /> : <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: markdown }} />
            : <div className="editor-shell"><Editor height="100%" theme="vs-dark" value={text} onChange={(value) => setText(value ?? "")} onMount={mount} language={editorLanguage} options={{ readOnly: mode !== "edit", fontSize, lineHeight: Math.round(fontSize * 1.57), fontFamily: "'SFMono-Regular', 'Cascadia Code', Consolas, monospace", fontLigatures: true, minimap: { enabled: minimap }, smoothScrolling: true, cursorSmoothCaretAnimation: "on", cursorBlinking: "smooth", renderLineHighlight: "all", bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, stickyScroll: { enabled: true }, padding: { top: 16, bottom: 16 }, wordWrap: wordWrap ? "on" : "off", automaticLayout: true, formatOnPaste: true, scrollBeyondLastLine: false, renderWhitespace: "selection", multiCursorModifier: "alt" }} /><footer className="editor-status"><button onClick={() => setWordWrap(!wordWrap)} className={wordWrap ? "active" : ""}><WrapText />Wrap</button><button onClick={() => setMinimap(!minimap)} className={minimap ? "active" : ""}>Map</button><button onClick={() => setFontSize((value) => Math.max(10, value - 1))} aria-label="Decrease editor font"><Minus /></button><span>{fontSize}px</span><button onClick={() => setFontSize((value) => Math.min(24, value + 1))} aria-label="Increase editor font"><Plus /></button><i /><span>Ln {position.line}, Col {position.column}</span>{position.selected > 0 && <span>{position.selected} selected</span>}<span>{editorLanguage}</span><span>{lineCount} {lineCount === 1 ? "line" : "lines"}</span><span>UTF-8</span><span>{mode === "edit" ? "Editable" : "Read only"}</span></footer></div>
          : <div className="unsupported"><FileDown size={36} /><h2>No safe browser preview</h2><p>{formatBytes(file.size)} · {file.name.split(".").pop()?.toUpperCase() || "Binary"} files stay byte-for-byte intact.</p><a className="button button-primary" href={rawUrl(path, false)} download>Download file</a></div>}
      </div>
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024; let unit = units[0];
  for (let index = 1; size >= 1024 && index < units.length; index += 1) { size /= 1024; unit = units[index]; }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}
