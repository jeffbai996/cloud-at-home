import {
  Archive,
  Clock3,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  File,
  FileImage,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Grid2X2,
  HardDrive,
  List,
  Move,
  LogOut,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { createPortal } from "react-dom";

import { AppShell, Button, EmptyState, LoginView, Modal, Skeleton } from "@cloud-at-home/ui";
import { AdminPanel } from "./Admin";
import { FileViewer } from "./Editor";
import {
  createResource,
  getResource,
  getSession,
  getStorageUsage,
  listTrash,
  login,
  logout,
  purgeTrash,
  restoreTrash,
  transformResource,
  trash,
  uploadFile,
  rawUrl,
  type Resource,
  type Session,
  type StorageUsage,
  type TrashEntry,
} from "./api";
import { joinPath } from "./file-utils";

type Prompt = null | { type: "new-folder" | "new-file" | "rename" | "move" | "copy"; item?: Resource };
type Collection = "browse" | "recent" | "favorites";
type SavedResource = Resource & { path: string };

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [path, setPath] = useState(() => new URLSearchParams(location.search).get("path") || "/");
  const [resource, setResource] = useState<Resource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">(() => localStorage.getItem("files-view") === "list" ? "list" : "grid");
  const [selected, setSelected] = useState<Resource | null>(null);
  const [viewer, setViewer] = useState<Resource | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [admin, setAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<"users" | "shares" | "settings">("users");
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashEntry[]>([]);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [dropActive, setDropActive] = useState(false);
  const [collection, setCollection] = useState<Collection>("browse");
  const [favorites, setFavorites] = useState<SavedResource[]>(() => readSavedResources("cloud-drive-favorites"));
  const [recent, setRecent] = useState<SavedResource[]>(() => readSavedResources("cloud-drive-recent"));
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem("cloud-drive-show-hidden") === "true");
  const [rootFolders, setRootFolders] = useState<Resource[]>([]);
  const uploadInput = useRef<HTMLInputElement>(null);

  useEffect(() => { void getSession().then(setSession); }, []);
  useEffect(() => { if (session) void load(path); }, [path, session]);
  useEffect(() => { localStorage.setItem("files-view", view); }, [view]);
  useEffect(() => { localStorage.setItem("cloud-drive-favorites", JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem("cloud-drive-recent", JSON.stringify(recent)); }, [recent]);
  useEffect(() => { localStorage.setItem("cloud-drive-show-hidden", String(showHidden)); }, [showHidden]);

  async function load(next = path) {
    setLoading(true); setError("");
    try { const nextResource = await getResource(next); setResource(nextResource); if (next === "/") setRootFolders((nextResource.items ?? []).filter((item) => item.isDir && !item.name.startsWith("."))); setSelected(null); void getStorageUsage().then(setUsage).catch(() => undefined); history.replaceState(null, "", `?path=${encodeURIComponent(next)}`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load folder"); }
    finally { setLoading(false); }
  }
  async function signIn(username: string, password: string) {
    setLoading(true); setLoginError("");
    try { setSession(await login(username, password)); }
    catch (reason) { setLoginError(reason instanceof Error ? reason.message : "Login failed"); }
    finally { setLoading(false); }
  }
  async function signOut() {
    try { await logout(); setSession(null); setAdmin(false); setResource(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sign out"); }
  }
  async function submitPrompt(value: string) {
    if (!prompt) return;
    try {
      if (prompt.type === "new-folder" || prompt.type === "new-file") await createResource(joinPath(path, value), prompt.type === "new-folder");
      else if (prompt.item) {
        const from = itemPath(prompt.item);
        const destination = prompt.type === "rename" ? joinPath(path, value) : joinPath(value, prompt.item.name);
        await transformResource(from, destination, prompt.type === "copy");
      }
      setPrompt(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Operation failed"); }
  }
  async function deleteSelected() {
    if (!selected) return;
    try { await trash(itemPath(selected), selected.size); setSelected(null); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Trash failed"); }
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      setUploads((current) => ({ ...current, [file.name]: 0 }));
      try { await uploadFile(path, file, (progress) => setUploads((current) => ({ ...current, [file.name]: progress }))); setUploads((current) => ({ ...current, [file.name]: 1 })); }
      catch (reason) { setError(reason instanceof Error ? reason.message : `Upload failed: ${file.name}`); }
    }
    await load(); setTimeout(() => setUploads({}), 1200);
  }
  async function showTrash() { setTrashItems(await listTrash()); setTrashOpen(true); }
  function browse(next: string) { setCollection("browse"); setPath(next); }
  function openResource(item: Resource, currentPath: string) {
    if (item.isDir) { browse(currentPath); return; }
    const saved = { ...item, path: currentPath };
    setRecent((current) => [saved, ...current.filter((entry) => entry.path !== currentPath)].slice(0, 24));
    setViewer(saved);
  }
  function toggleFavorite(item: Resource) {
    const currentPath = itemPath(item);
    setFavorites((current) => current.some((entry) => entry.path === currentPath)
      ? current.filter((entry) => entry.path !== currentPath)
      : [{ ...item, path: currentPath }, ...current]);
  }
  async function moveIntoFolder(source: string, folder: Resource) {
    const name = source.split("/").filter(Boolean).pop();
    if (!name) return;
    const destination = joinPath(itemPath(folder), name);
    if (destination === source) return;
    try { await transformResource(source, destination, false); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Move failed"); }
  }

  const sourceItems = collection === "recent" ? recent : collection === "favorites" ? favorites : resource?.items ?? [];
  const items = useMemo(() => sourceItems.filter((item) => item.name !== ".cloud-drive-trash" && (showHidden || !item.name.startsWith(".")) && item.name.toLowerCase().includes(query.toLowerCase())), [query, showHidden, sourceItems]);
  const crumbs = path.split("/").filter(Boolean);
  const itemPath = (item: Resource) => item.url || item.path || joinPath(path, item.name);

  if (session === undefined) return <div className="files-boot"><HardDrive /></div>;
  if (!session) return <AppShell kind="files" brand="Cloud Drive"><LoginView service="Cloud Drive" onSubmit={signIn} loading={loading} error={loginError} /></AppShell>;

  return (
    <AppShell kind="files" brand="Cloud Drive" actions={<><div className="file-search"><Search size={16} /><input placeholder="Search Cloud Drive" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button onClick={() => setQuery("")}><X size={14} /></button>}</div><button className="icon-button" aria-label="Open Control Panel" onClick={() => setAdmin(true)}><Settings size={18} /></button><button className="icon-button" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={18} /></button></>}>
      <div className="files-layout">
        <aside className="files-sidebar">
          <nav>
            <div className="sidebar-section"><span>Locations</span><button className={collection === "browse" && path === "/" ? "active" : ""} onClick={() => browse("/")}><HardDrive size={17} /> Cloud Drive</button><button className={collection === "recent" ? "active" : ""} onClick={() => { setCollection("recent"); setSelected(null); }}><Clock3 size={17} /> Recents</button><button className={collection === "favorites" ? "active" : ""} onClick={() => { setCollection("favorites"); setSelected(null); }}><Star size={17} /> Favorites</button></div>
            {rootFolders.length > 0 && <div className="sidebar-section quick-access"><span>Quick Access</span>{rootFolders.slice().sort((left, right) => quickAccessRank(left.name) - quickAccessRank(right.name) || left.name.localeCompare(right.name)).slice(0, 5).map((item) => <button key={item.name} onClick={() => browse(itemPath(item))}><Folder size={17} />{item.name}</button>)}</div>}
            <div className="sidebar-section"><span>Manage</span><button onClick={() => { setAdminTab("shares"); setAdmin(true); }}><Share2 size={17} /> Shared Links</button><button onClick={() => void showTrash()}><Trash2 size={17} /> Trash</button><button onClick={() => { setAdminTab("users"); setAdmin(true); }}><Settings size={17} /> Control Panel</button></div>
          </nav>
          <div className="sidebar-bottom">{usage && <StorageMeter usage={usage} />}<div className="sidebar-foot"><div><span>Signed in as</span><strong>{session.user.name}</strong></div><button aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut size={16} /></button></div></div>
        </aside>
        <section className={`files-main ${dropActive ? "drop-active" : ""}`} onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) setDropActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }} onDrop={(event) => { event.preventDefault(); setDropActive(false); if (!event.dataTransfer.types.includes("application/x-cloud-drive-path")) void upload(event.dataTransfer.files); }}>
          <header className="files-toolbar">
            <div className="breadcrumbs">{collection !== "browse" ? <strong>{collection === "recent" ? "Recents" : "Favorites"}</strong> : <><button onClick={() => browse("/")}>Drive</button>{crumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><ChevronRight size={14} /><button onClick={() => browse(`/${crumbs.slice(0, index + 1).join("/")}`)}>{decodeURIComponent(crumb)}</button></span>)}</>}</div>
            <div className="toolbar-actions">
              {selected && <>{!selected.isDir && <a className="icon-button" aria-label="Download" title="Download" href={rawUrl(itemPath(selected), false)} download><Download size={17} /></a>}<button className="icon-button" aria-label="Favorite" title="Favorite" onClick={() => toggleFavorite(selected)}><Star size={17} fill={favorites.some((entry) => entry.path === itemPath(selected)) ? "currentColor" : "none"} /></button><button className="icon-button" aria-label="Rename" title="Rename" onClick={() => setPrompt({ type: "rename", item: selected })}><Pencil size={17} /></button><button className="icon-button" aria-label="Copy" title="Copy" onClick={() => setPrompt({ type: "copy", item: selected })}><Copy size={17} /></button><button className="icon-button" aria-label="Move" title="Move" onClick={() => setPrompt({ type: "move", item: selected })}><Move size={17} /></button><button className="icon-button toolbar-danger" aria-label="Move to Trash" title="Move to Trash" onClick={() => void deleteSelected()}><Trash2 size={17} /></button><span className="toolbar-divider" /></>}
              <input ref={uploadInput} hidden multiple type="file" onChange={(event) => void upload(event.target.files)} />
              <button className="icon-button" aria-label="Upload" title="Upload" onClick={() => uploadInput.current?.click()}><Upload size={18} /></button>
              <button className="icon-button" aria-label="Refresh folder" title="Refresh folder" onClick={() => void load()}><RefreshCw size={17} /></button>
              <button className="icon-button" aria-label={showHidden ? "Hide hidden files" : "Show hidden files"} title={showHidden ? "Hide hidden files" : "Show hidden files"} onClick={() => setShowHidden((current) => !current)}>{showHidden ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              <button className={`icon-button ${view === "grid" ? "active" : ""}`} aria-label={view === "grid" ? "Switch to list view" : "Switch to grid view"} title={view === "grid" ? "Switch to list view" : "Switch to grid view"} onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? <Grid2X2 size={18} /> : <List size={18} />}</button>
              <button className="icon-button" aria-label="New folder" title="New folder" onClick={() => setPrompt({ type: "new-folder" })}><FolderPlus size={18} /></button>
              <button className="icon-button" aria-label="New file" title="New file" onClick={() => setPrompt({ type: "new-file" })}><FilePlus2 size={18} /></button>
            </div>
          </header>
          {error && <div className="files-error">{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
          {Object.keys(uploads).length > 0 && <div className="upload-stack">{Object.entries(uploads).map(([name, progress]) => <div key={name}><span>{name}</span><div><i style={{ width: `${progress * 100}%` }} /></div><strong>{Math.round(progress * 100)}%</strong></div>)}</div>}
          {dropActive && <div className="file-drop-zone"><Upload /><strong>Drop to upload</strong><span>Files will be added to this folder</span></div>}
          {loading && collection === "browse" ? <FileSkeleton view={view} /> : items.length ? <div className={`file-view file-view-${view}`}>{items.map((item) => { const currentPath = itemPath(item); return <FileItem key={`${currentPath}-${item.name}`} item={item} path={currentPath} selected={itemPath(selected ?? { ...item, name: "" }) === currentPath && selected?.name === item.name} view={view} onClick={() => setSelected(item)} onOpen={() => openResource(item, currentPath)} onMoveInto={(source) => void moveIntoFolder(source, item)} />; })}</div> : <EmptyState title={query ? "No matching files" : collection === "recent" ? "No recent files" : collection === "favorites" ? "No favorites yet" : "This folder is empty"} body={query ? "Try another filename." : collection === "favorites" ? "Select a file or folder and add it to Favorites." : collection === "recent" ? "Files you open will appear here." : "Drop files anywhere or create a folder."} icon={collection === "favorites" ? <Star /> : collection === "recent" ? <Clock3 /> : <Folder />} />}
        </section>
      </div>
      {createPortal(<AnimatePresence>{viewer && <motion.div className="viewer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><FileViewer file={viewer} path={itemPath(viewer)} onClose={() => setViewer(null)} /></motion.div>}</AnimatePresence>, document.body)}
      <OperationPrompt prompt={prompt} onClose={() => setPrompt(null)} onSubmit={(value) => void submitPrompt(value)} />
      <Modal open={admin} title="Control Panel" onClose={() => setAdmin(false)}><AdminPanel initialTab={adminTab} currentUserId={session.user.id} /></Modal>
      <Modal open={trashOpen} title="Trash" onClose={() => setTrashOpen(false)}><TrashPanel entries={trashItems} onRestore={async (id) => { await restoreTrash(id); setTrashItems(await listTrash()); await load(); }} onPurge={async (id) => { await purgeTrash(id); setTrashItems(await listTrash()); }} /></Modal>
    </AppShell>
  );
}

function FileItem({ item, path, selected, view, onClick, onOpen, onMoveInto }: { item: Resource; path: string; selected: boolean; view: "grid" | "list"; onClick: () => void; onOpen: () => void; onMoveInto: (source: string) => void }) {
  const Icon = item.isDir ? Folder : fileIcon(item.name);
  const image = !item.isDir && isImageName(item.name);
  function dragStart(event: ReactDragEvent<HTMLDivElement>) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-cloud-drive-path", path); event.dataTransfer.setData("text/plain", path); }
  function dragOver(event: ReactDragEvent<HTMLDivElement>) { if (item.isDir && event.dataTransfer.types.includes("application/x-cloud-drive-path")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; event.currentTarget.classList.add("drop-target"); } }
  function drop(event: ReactDragEvent<HTMLDivElement>) { event.currentTarget.classList.remove("drop-target"); if (!item.isDir) return; const source = event.dataTransfer.getData("application/x-cloud-drive-path"); if (source) { event.preventDefault(); event.stopPropagation(); onMoveInto(source); } }
  return <div className={`file-item ${selected ? "selected" : ""}`} draggable onDragStart={dragStart} onDragOver={dragOver} onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")} onDrop={drop}><button type="button" className="file-target" aria-label={item.name} onClick={onClick} onDoubleClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onOpen(); } }}><span className={`file-icon ${item.isDir ? "folder" : ""} ${image ? "image-preview" : ""}`}>{image ? <img src={rawUrl(path)} alt="" loading="lazy" /> : <Icon />}</span><span className="file-name"><strong>{item.name}</strong>{!item.isDir && <small>{formatBytes(item.size)}</small>}</span><span className="file-modified">{formatDate(item.modified)}</span></button><button type="button" className="item-more" aria-label={`Open ${item.name}`} title={`Open ${item.name}`} onClick={onOpen}>{item.isDir ? <ChevronRight size={17} /> : <Eye size={17} />}</button></div>;
}
function FileSkeleton({ view }: { view: "grid" | "list" }) { return <div className={`file-view file-view-${view}`}>{Array.from({ length: 12 }, (_, index) => <Skeleton key={index} className="file-skeleton" />)}</div>; }

function OperationPrompt({ prompt, onClose, onSubmit }: { prompt: Prompt; onClose: () => void; onSubmit: (value: string) => void }) {
  const titles = { "new-folder": "New folder", "new-file": "New file", rename: "Rename", move: "Move to folder", copy: "Copy to folder" };
  return <Modal open={Boolean(prompt)} title={prompt ? titles[prompt.type] : "Operation"} onClose={onClose}>{prompt && <form className="operation-form" onSubmit={(event) => { event.preventDefault(); onSubmit(String(new FormData(event.currentTarget).get("value") || "")); }}><label><span>{prompt.type === "move" || prompt.type === "copy" ? "Destination path" : "Name"}</span><input name="value" autoFocus defaultValue={prompt.type === "rename" ? prompt.item?.name : prompt.type === "move" || prompt.type === "copy" ? "/" : ""} required /></label><div><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button type="submit">{titles[prompt.type]}</Button></div></form>}</Modal>;
}
function TrashPanel({ entries, onRestore, onPurge }: { entries: TrashEntry[]; onRestore: (id: string) => void; onPurge: (id: string) => void }) { return <div className="trash-list">{entries.length ? entries.map((entry) => <div key={entry.id}><span className="file-icon"><Trash2 /></span><div><strong>{entry.originalPath.split("/").pop()}</strong><span>{entry.originalPath} · expires {new Date(entry.expiresAt).toLocaleDateString()}</span></div><Button variant="secondary" onClick={() => onRestore(entry.id)}>Restore</Button><Button variant="danger" onClick={() => onPurge(entry.id)}>Delete now</Button></div>) : <EmptyState title="Trash is empty" body="Deleted files stay recoverable here for 30 days." icon={<Trash2 />} />}</div>; }
function fileIcon(name: string) { const ext = name.split(".").pop()?.toLowerCase(); if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext || "")) return FileImage; if (["zip", "tar", "gz", "7z", "rar"].includes(ext || "")) return Archive; if (["txt", "md", "json", "js", "ts", "py", "css", "html", "log"].includes(ext || "")) return FileText; return File; }
function isImageName(name: string) { return ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(name.split(".").pop()?.toLowerCase() || ""); }
function formatBytes(value: number) { if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB", "TB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }).format(date); }
function readSavedResources(key: string): SavedResource[] { try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function quickAccessRank(name: string): number { const preferred = ["Desktop", "Documents", "Downloads", "tv-movies", "tv-shows", "local-projects"]; const index = preferred.indexOf(name); return index === -1 ? preferred.length : index; }
function StorageMeter({ usage }: { usage: StorageUsage }) { const total = Math.max(0, Number(usage.total) || 0); const used = Math.max(0, Number(usage.used) || 0); const percent = total > 0 ? Math.min(100, used / total * 100) : 0; return <div className="storage-meter"><div><span>Storage</span><strong>{formatBytes(Math.max(0, total - used))} free</strong></div><div className="storage-track"><i style={{ width: `${percent}%` }} /></div><small>{formatBytes(used)} of {formatBytes(total)} used</small></div>; }
