import {
  Archive,
  CheckCircle2,
  Circle,
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
  Grid3X3,
  HardDrive,
  Info,
  List,
  ListChecks,
  Move,
  LogOut,
  Pencil,
  Pin,
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
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

import { AppShell, Button, EmptyState, Lightbox, LoginView, Modal, Skeleton, lightboxKindFor, serviceHref, type LightboxItem } from "@cloud-at-home/ui";
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
  setSessionLostHandler,
  transformResource,
  trash,
  uploadFile,
  previewBigUrl,
  previewThumbUrl,
  rawUrl,
  type Resource,
  type Session,
  type StorageUsage,
  type TrashEntry,
} from "./api";
import { PHOTOS_ROOT, exactTimestamp, isUnderPhotosRoot, joinPath, mutationDestination, photosDeepLink, relativeTimestamp, resourcePath, togglePath } from "./file-utils";

type Prompt = null | { type: "new-folder" | "new-file" | "rename" | "move" | "copy"; item?: Resource; bulk?: boolean };
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
  const [dense, setDense] = useState(() => localStorage.getItem("files-dense") === "1");
  const [selected, setSelected] = useState<Resource | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [viewer, setViewer] = useState<Resource | null>(null);
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [admin, setAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<"users" | "shares" | "settings">("users");
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashEntry[]>([]);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [dropActive, setDropActive] = useState(false);
  const [collection, setCollection] = useState<Collection>("browse");
  const [favorites, setFavorites] = useState<SavedResource[]>(() => readSavedResources("cloud-at-home-favorites"));
  const [recent, setRecent] = useState<SavedResource[]>(() => readSavedResources("cloud-at-home-recent"));
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem("cloud-at-home-show-hidden") === "true");
  const [rootFolders, setRootFolders] = useState<Resource[]>([]);
  const [quickAccessPaths, setQuickAccessPaths] = useState<string[]>(() => readStringList("cloud-at-home-quick-access"));
  const uploadInput = useRef<HTMLInputElement>(null);
  const lastClickIndex = useRef(-1);
  const loadController = useRef<AbortController | null>(null);
  const loadSequence = useRef(0);

  useEffect(() => { void getSession().then(setSession); }, []);
  // A mid-session 401 means the upstream token expired and the gateway cleared
  // our cookie — drop to the login view instead of a stalled UI full of errors.
  useEffect(() => { setSessionLostHandler(() => { setSession(null); setError(""); }); }, []);
  useEffect(() => { if (session) void load(path); }, [path, session]);
  useEffect(() => {
    function onPopState() {
      setCollection("browse");
      setPath(new URLSearchParams(location.search).get("path") || "/");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => () => loadController.current?.abort(), []);
  useEffect(() => { localStorage.setItem("files-view", view); }, [view]);
  useEffect(() => { localStorage.setItem("files-dense", dense ? "1" : "0"); }, [dense]);
  useEffect(() => { localStorage.setItem("cloud-at-home-favorites", JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem("cloud-at-home-recent", JSON.stringify(recent)); }, [recent]);
  useEffect(() => { localStorage.setItem("cloud-at-home-show-hidden", String(showHidden)); }, [showHidden]);
  useEffect(() => { localStorage.setItem("cloud-at-home-quick-access", JSON.stringify(quickAccessPaths)); }, [quickAccessPaths]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") { setChecked([]); setSelectMode(false); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!rootFolders.length || localStorage.getItem("cloud-at-home-quick-access-initialized") === "true") return;
    const initial = rootFolders.slice().sort((left, right) => quickAccessRank(left.name) - quickAccessRank(right.name) || left.name.localeCompare(right.name)).slice(0, 5).map((item) => joinPath("/", item.name));
    setQuickAccessPaths(initial);
    localStorage.setItem("cloud-at-home-quick-access-initialized", "true");
  }, [rootFolders]);

  async function load(next = path) {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    try {
      const nextResource = await getResource(next, controller.signal);
      if (sequence !== loadSequence.current) return;
      setResource(nextResource);
      if (next === "/") setRootFolders((nextResource.items ?? []).filter((item) => item.isDir && !item.name.startsWith(".")));
      setSelected(null); setChecked([]); lastClickIndex.current = -1; setDetailsOpen(false);
      void getStorageUsage().then(setUsage).catch(() => undefined);
    } catch (reason) {
      if (sequence === loadSequence.current && !(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Could not load folder");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
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
      if (prompt.type === "new-folder" || prompt.type === "new-file") {
        if (collection !== "browse") throw new Error("Open a folder before creating files or folders.");
        await createResource(joinPath(path, value), prompt.type === "new-folder");
      }
      else if (prompt.bulk && (prompt.type === "move" || prompt.type === "copy")) {
        for (const source of checked) {
          const name = source.split("/").filter(Boolean).pop();
          if (!name) continue;
          const destination = joinPath(value, name);
          if (destination === source) continue;
          await transformResource(source, destination, prompt.type === "copy");
        }
      }
      else if (prompt.item) {
        const from = itemPath(prompt.item);
        const destination = mutationDestination(prompt.type, from, value);
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
  async function bulkTrash() {
    try {
      for (const checkedPath of checked) {
        const item = items.find((entry) => itemPath(entry) === checkedPath);
        await trash(checkedPath, item?.size ?? 0);
      }
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Trash failed"); }
  }
  function toggleChecked(item: Resource) {
    const checkedPath = itemPath(item);
    setChecked((current) => current.includes(checkedPath) ? current.filter((entry) => entry !== checkedPath) : [...current, checkedPath]);
    setSelected(item); setDetailsOpen(false);
  }
  function itemClick(event: ReactMouseEvent, item: Resource, index: number) {
    if (event.shiftKey && lastClickIndex.current >= 0 && lastClickIndex.current !== index) {
      const [start, end] = [Math.min(lastClickIndex.current, index), Math.max(lastClickIndex.current, index)];
      const range = items.slice(start, end + 1).map((entry) => itemPath(entry));
      setChecked((current) => [...current, ...range.filter((entry) => !current.includes(entry))]);
    } else if (event.metaKey || event.ctrlKey || selectMode || checked.length > 0) {
      // An active selection behaves like select mode: plain taps toggle membership
      // (the standard iOS-Files/Drive pattern). Without this, growing a selection
      // meant precisely hitting each row's small check circle — a stray tap on the
      // row body wiped the whole set.
      // Unchecking the last item empties `checked`, restoring single-select taps.
      toggleChecked(item);
    } else { setSelected(item); setChecked([]); setDetailsOpen(false); }
    lastClickIndex.current = index;
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    if (collection !== "browse") { setError("Open a folder before uploading files."); return; }
    for (const file of Array.from(files)) {
      setUploads((current) => ({ ...current, [file.name]: 0 }));
      try { await uploadFile(path, file, (progress) => setUploads((current) => ({ ...current, [file.name]: progress }))); setUploads((current) => ({ ...current, [file.name]: 1 })); }
      catch (reason) { setError(reason instanceof Error ? reason.message : `Upload failed: ${file.name}`); }
    }
    await load(); setTimeout(() => setUploads({}), 1200);
  }
  async function showTrash() { setTrashItems(await listTrash()); setTrashOpen(true); }
  function browse(next: string) {
    if (next !== path || collection !== "browse") history.pushState(null, "", `?path=${encodeURIComponent(next)}`);
    setCollection("browse");
    setPath(next);
  }
  function openResource(item: Resource, currentPath: string) {
    if (item.isDir) { browse(currentPath); return; }
    const saved = { ...item, path: currentPath };
    setRecent((current) => [saved, ...current.filter((entry) => entry.path !== currentPath)].slice(0, 24));
    // Images and videos get the shared Photos lightbox — Drive's integrated
    // photos viewer IS the Photos viewer. Everything else keeps FileViewer.
    if (lightboxKindFor(item.name)) { setLightboxPath(currentPath); return; }
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
  const items = useMemo(() => sourceItems.filter((item) => item.name !== ".cloud-at-home-trash" && (showHidden || !item.name.startsWith(".")) && item.name.toLowerCase().includes(query.toLowerCase())), [query, showHidden, sourceItems]);
  const crumbs = path.split("/").filter(Boolean);
  const itemPath = (item: Resource) => resourcePath(item, path);
  const mediaItems = useMemo(() => items.filter((item) => !item.isDir && lightboxKindFor(item.name)), [items]);
  const lightboxIndex = lightboxPath === null ? -1 : mediaItems.findIndex((item) => itemPath(item) === lightboxPath);
  const lightboxItems: LightboxItem[] = useMemo(() => mediaItems.map((item) => ({
    name: item.name,
    kind: lightboxKindFor(item.name) ?? "image",
    previewUrl: previewBigUrl(itemPath(item)),
    fullUrl: rawUrl(itemPath(item)),
  })), [mediaItems, path]);
  function photosOrigin(): string {
    return serviceHref(window.location.hostname, 8083, 8458, window.location.protocol === "https:");
  }
  async function addToPhotos(source: string) {
    const name = source.split("/").filter(Boolean).pop();
    if (!name) return;
    try { await transformResource(source, `/${PHOTOS_ROOT}/${name}`, true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Add to Photos failed"); }
  }
  const canWriteToCurrentFolder = collection === "browse";

  if (session === undefined) return <div className="files-boot"><HardDrive /></div>;
  if (!session) return <AppShell kind="files" brand="Cloud at Home Drive"><LoginView service="Cloud at Home Drive" onSubmit={signIn} loading={loading} error={loginError} /></AppShell>;

  return (
    <AppShell kind="files" brand="Cloud at Home Drive" actions={<><div className="file-search"><Search size={16} /><input placeholder="Search Cloud at Home Drive" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button onClick={() => setQuery("")}><X size={14} /></button>}</div><button className="icon-button" aria-label="Open Control Panel" onClick={() => setAdmin(true)}><Settings size={18} /></button></>} navigation={<button className="icon-button topbar-signout" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut size={18} /></button>}>
      <div className="files-layout">
        <aside className="files-sidebar">
          <nav>
            <div className="sidebar-section"><span>Locations</span><button className={collection === "browse" && path === "/" ? "active" : ""} onClick={() => browse("/")}><HardDrive size={17} /> Drive</button><button className={collection === "recent" ? "active" : ""} onClick={() => { setCollection("recent"); setSelected(null); }}><Clock3 size={17} /> Recents</button><button className={collection === "favorites" ? "active" : ""} onClick={() => { setCollection("favorites"); setSelected(null); }}><Star size={17} /> Favorites</button></div>
            {quickAccessPaths.length > 0 && <div className="sidebar-section quick-access"><span>Quick Access</span>{quickAccessPaths.map((quickPath) => <div className="quick-access-row" key={quickPath}><button title={quickPath} onClick={() => browse(quickPath)}><Folder size={17} /><span>{quickPath.split("/").filter(Boolean).pop()}</span></button><button className="quick-access-remove" aria-label={`Remove ${quickPath} from Quick Access`} title="Remove from Quick Access" onClick={() => setQuickAccessPaths((current) => togglePath(current, quickPath))}><X size={13} /></button></div>)}</div>}
            <div className="sidebar-section"><span>Manage</span><button onClick={() => { setAdminTab("shares"); setAdmin(true); }}><Share2 size={17} /> Sharing</button><button onClick={() => void showTrash()}><Trash2 size={17} /> Trash</button><button onClick={() => { setAdminTab("users"); setAdmin(true); }}><Settings size={17} /> Control Panel</button></div>
          </nav>
          <div className="sidebar-bottom">{usage && <StorageMeter usage={usage} />}<div className="sidebar-foot"><div><span>Signed in as</span><strong>{session.user.name}</strong></div><button aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut size={16} /></button></div></div>
        </aside>
        <section className={`files-main ${dropActive ? "drop-active" : ""}`} onDragEnter={(event) => { if (canWriteToCurrentFolder && event.dataTransfer.types.includes("Files")) setDropActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }} onDrop={(event) => { event.preventDefault(); setDropActive(false); if (!event.dataTransfer.types.includes("application/x-cloud-at-home-path")) void upload(event.dataTransfer.files); }}>
          <header className="files-toolbar">
            <div className="breadcrumbs">{collection !== "browse" ? <strong>{collection === "recent" ? "Recents" : "Favorites"}</strong> : <><button onClick={() => browse("/")}>Drive</button><span><ChevronRight size={14} /><button onClick={() => browse("/")}>home</button></span>{crumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><ChevronRight size={14} /><button onClick={() => browse(`/${crumbs.slice(0, index + 1).join("/")}`)}>{crumb}</button></span>)}</>}</div>
            <div className="toolbar-actions">
              {checked.length > 0 ? <><span className="selection-count">{checked.length} selected</span><button className="icon-button" aria-label="Copy selected" title="Copy selected" onClick={() => setPrompt({ type: "copy", bulk: true })}><Copy size={17} /></button><button className="icon-button" aria-label="Move selected" title="Move selected" onClick={() => setPrompt({ type: "move", bulk: true })}><Move size={17} /></button><button className="icon-button toolbar-danger" aria-label="Move selected to Trash" title="Move selected to Trash" onClick={() => void bulkTrash()}><Trash2 size={17} /></button><button className="icon-button" aria-label="Clear selection" title="Clear selection" onClick={() => { setChecked([]); setSelectMode(false); }}><X size={17} /></button><span className="toolbar-divider" /></> : selected && <><button className={`icon-button ${detailsOpen ? "active" : ""}`} aria-label="File details" title="File details" onClick={() => setDetailsOpen((value) => !value)}><Info size={17} /></button>{!selected.isDir && <a className="icon-button" aria-label="Download" title="Download" href={rawUrl(itemPath(selected), false)} download><Download size={17} /></a>}{selected.isDir && <button className={`icon-button ${quickAccessPaths.includes(itemPath(selected)) ? "active" : ""}`} aria-label={quickAccessPaths.includes(itemPath(selected)) ? "Remove from Quick Access" : "Add to Quick Access"} title={quickAccessPaths.includes(itemPath(selected)) ? "Remove from Quick Access" : "Add to Quick Access"} onClick={() => setQuickAccessPaths((current) => togglePath(current, itemPath(selected)))}><Pin size={17} fill={quickAccessPaths.includes(itemPath(selected)) ? "currentColor" : "none"} /></button>}<button className="icon-button" aria-label="Favorite" title="Favorite" onClick={() => toggleFavorite(selected)}><Star size={17} fill={favorites.some((entry) => entry.path === itemPath(selected)) ? "currentColor" : "none"} /></button><button className="icon-button" aria-label="Rename" title="Rename" onClick={() => setPrompt({ type: "rename", item: selected })}><Pencil size={17} /></button><button className="icon-button" aria-label="Copy" title="Copy" onClick={() => setPrompt({ type: "copy", item: selected })}><Copy size={17} /></button><button className="icon-button" aria-label="Move" title="Move" onClick={() => setPrompt({ type: "move", item: selected })}><Move size={17} /></button><button className="icon-button toolbar-danger" aria-label="Move to Trash" title="Move to Trash" onClick={() => void deleteSelected()}><Trash2 size={17} /></button><span className="toolbar-divider" /></>}
              <input ref={uploadInput} hidden multiple type="file" onChange={(event) => void upload(event.target.files)} />
              <button className="icon-button" aria-label="Upload" title={canWriteToCurrentFolder ? "Upload" : "Open a folder to upload"} disabled={!canWriteToCurrentFolder} onClick={() => uploadInput.current?.click()}><Upload size={18} /></button>
              <button className="icon-button" aria-label="Refresh folder" title="Refresh folder" onClick={() => void load()}><RefreshCw size={17} /></button>
              <button className={`icon-button ${selectMode ? "active" : ""}`} aria-label={selectMode ? "Exit multi-select" : "Select multiple"} title={selectMode ? "Exit multi-select" : "Select multiple"} onClick={() => setSelectMode((current) => { if (current) setChecked([]); return !current; })}><ListChecks size={18} /></button>
              <button className="icon-button" aria-label={showHidden ? "Hide hidden files" : "Show hidden files"} title={showHidden ? "Hide hidden files" : "Show hidden files"} onClick={() => setShowHidden((current) => !current)}>{showHidden ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              <button className={`icon-button ${view === "grid" ? "active" : ""}`} aria-label={view === "grid" ? "Switch to list view" : "Switch to grid view"} title={view === "grid" ? "Switch to list view" : "Switch to grid view"} onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? <Grid2X2 size={18} /> : <List size={18} />}</button>
              {view === "grid" && <button className={`icon-button ${dense ? "active" : ""}`} aria-label={dense ? "Switch to comfortable grid" : "Switch to dense grid"} title={dense ? "Comfortable grid" : "Dense grid"} onClick={() => setDense((current) => !current)}><Grid3X3 size={18} /></button>}
              <button className="icon-button" aria-label="New folder" title={canWriteToCurrentFolder ? "New folder" : "Open a folder to create a folder"} disabled={!canWriteToCurrentFolder} onClick={() => setPrompt({ type: "new-folder" })}><FolderPlus size={18} /></button>
              <button className="icon-button" aria-label="New file" title={canWriteToCurrentFolder ? "New file" : "Open a folder to create a file"} disabled={!canWriteToCurrentFolder} onClick={() => setPrompt({ type: "new-file" })}><FilePlus2 size={18} /></button>
            </div>
          </header>
          <AnimatePresence>{selected && detailsOpen && <FileDetails item={selected} path={itemPath(selected)} onClose={() => setDetailsOpen(false)} />}</AnimatePresence>
          {error && <div className="files-error">{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
          {Object.keys(uploads).length > 0 && <div className="upload-stack">{Object.entries(uploads).map(([name, progress]) => <div key={name}><span>{name}</span><div><i style={{ width: `${progress * 100}%` }} /></div><strong>{Math.round(progress * 100)}%</strong></div>)}</div>}
          {dropActive && <div className="file-drop-zone"><Upload /><strong>Drop to upload</strong><span>Files will be added to this folder</span></div>}
          {loading && collection === "browse" ? <FileSkeleton view={view} /> : items.length ? <div className={`file-view file-view-${view}${view === "grid" && dense ? " file-view-dense" : ""}`}>{items.map((item, index) => { const currentPath = itemPath(item); return <FileItem key={`${currentPath}-${item.name}`} item={item} path={currentPath} selected={itemPath(selected ?? { ...item, name: "" }) === currentPath && selected?.name === item.name} checked={checked.includes(currentPath)} selectMode={selectMode} view={view} onClick={(event) => itemClick(event, item, index)} onToggleCheck={() => toggleChecked(item)} onOpen={() => openResource(item, currentPath)} onMoveInto={(source) => void moveIntoFolder(source, item)} />; })}</div> : <EmptyState title={query ? "No matching files" : collection === "recent" ? "No recent files" : collection === "favorites" ? "No favorites yet" : "This folder is empty"} body={query ? "Try another filename." : collection === "favorites" ? "Select a file or folder and add it to Favorites." : collection === "recent" ? "Files you open will appear here." : "Drop files anywhere or create a folder."} icon={collection === "favorites" ? <Star /> : collection === "recent" ? <Clock3 /> : <Folder />} />}
        </section>
      </div>
      {lightboxIndex >= 0 && createPortal(
        <Lightbox
          items={lightboxItems}
          index={lightboxIndex}
          onClose={() => setLightboxPath(null)}
          onNavigate={(next) => setLightboxPath(itemPath(mediaItems[next]))}
          actions={lightboxPath !== null && (isUnderPhotosRoot(lightboxPath)
            ? <a className="button button-ghost" href={photosDeepLink(photosOrigin(), lightboxPath)}>Open in Photos</a>
            : <button type="button" className="button button-ghost" onClick={() => void addToPhotos(lightboxPath)}>Add to Photos</button>)}
        />, document.body)}
      {createPortal(<AnimatePresence>{viewer && <motion.div className="viewer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><FileViewer file={viewer} path={itemPath(viewer)} onClose={() => setViewer(null)} /></motion.div>}</AnimatePresence>, document.body)}
      <OperationPrompt prompt={prompt} onClose={() => setPrompt(null)} onSubmit={(value) => void submitPrompt(value)} />
      <Modal open={admin} title="Control Panel" onClose={() => setAdmin(false)}><AdminPanel initialTab={adminTab} currentUserId={session.user.id} usage={usage} /></Modal>
      <Modal open={trashOpen} title="Trash" onClose={() => setTrashOpen(false)}><TrashPanel entries={trashItems} onRestore={async (id) => { await restoreTrash(id); setTrashItems(await listTrash()); await load(); }} onPurge={async (id) => { await purgeTrash(id); setTrashItems(await listTrash()); }} /></Modal>
    </AppShell>
  );
}

function FileItem({ item, path, selected, checked, selectMode, view, onClick, onToggleCheck, onOpen, onMoveInto }: { item: Resource; path: string; selected: boolean; checked: boolean; selectMode: boolean; view: "grid" | "list"; onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void; onToggleCheck: () => void; onOpen: () => void; onMoveInto: (source: string) => void }) {
  const Icon = item.isDir ? Folder : fileIcon(item.name);
  const image = !item.isDir && isImageName(item.name);
  function dragStart(event: ReactDragEvent<HTMLDivElement>) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-cloud-at-home-path", path); event.dataTransfer.setData("text/plain", path); }
  function dragOver(event: ReactDragEvent<HTMLDivElement>) { if (item.isDir && event.dataTransfer.types.includes("application/x-cloud-at-home-path")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; event.currentTarget.classList.add("drop-target"); } }
  function drop(event: ReactDragEvent<HTMLDivElement>) { event.currentTarget.classList.remove("drop-target"); if (!item.isDir) return; const source = event.dataTransfer.getData("application/x-cloud-at-home-path"); if (source) { event.preventDefault(); event.stopPropagation(); onMoveInto(source); } }
  const modified = exactTimestamp(item.modified);
  return <div className={`file-item ${selected ? "selected" : ""} ${checked ? "checked" : ""} ${selectMode ? "select-mode" : ""}`} draggable onDragStart={dragStart} onDragOver={dragOver} onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")} onDrop={drop}><button type="button" className="item-check" aria-label={checked ? `Deselect ${item.name}` : `Select ${item.name}`} title={checked ? "Deselect" : "Select"} onClick={(event) => { event.stopPropagation(); onToggleCheck(); }}>{checked ? <CheckCircle2 size={17} /> : <Circle size={17} />}</button><button type="button" className="file-target" aria-label={item.name} onClick={onClick} onDoubleClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onOpen(); } }}><span className={`file-icon ${item.isDir ? "folder" : ""} ${image ? "image-preview" : ""}`}>{image ? <img src={previewThumbUrl(path)} alt="" loading="lazy" /> : <Icon />}</span><span className="file-name"><strong>{item.name}</strong>{!item.isDir && <small>{formatBytes(item.size)}</small>}</span><time className="file-modified" dateTime={item.modified} title={`Modified ${modified}`}>{relativeTimestamp(item.modified)}</time></button><button type="button" className="item-more" aria-label={`Open ${item.name}`} title={`Open ${item.name}`} onClick={onOpen}>{item.isDir ? <ChevronRight size={17} /> : <Eye size={17} />}</button></div>;
}

function FileDetails({ item, path, onClose }: { item: Resource; path: string; onClose: () => void }) {
  const kind = item.isDir ? "Folder" : item.extension?.replace(/^\./, "").toUpperCase() || item.type || "File";
  return <motion.aside className="file-details" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}><div className="file-details-name"><span className="file-icon">{item.isDir ? <Folder /> : <File />}</span><div><strong>{item.name}</strong><span title={path}>{path}</span></div></div><dl><div><dt>Modified</dt><dd>{exactTimestamp(item.modified)}</dd></div><div><dt>Type</dt><dd>{kind}</dd></div><div><dt>Size</dt><dd>{item.isDir ? `${item.numFiles ?? 0} files · ${item.numDirs ?? 0} folders` : formatBytes(item.size)}</dd></div></dl><button aria-label="Close file details" title="Close" onClick={onClose}><X size={15} /></button></motion.aside>;
}
function FileSkeleton({ view }: { view: "grid" | "list" }) { return <div className={`file-view file-view-${view}`}>{Array.from({ length: 12 }, (_, index) => <Skeleton key={index} className="file-skeleton" />)}</div>; }

function OperationPrompt({ prompt, onClose, onSubmit }: { prompt: Prompt; onClose: () => void; onSubmit: (value: string) => void }) {
  const titles = { "new-folder": "New folder", "new-file": "New file", rename: "Rename", move: "Move to folder", copy: "Copy to folder" };
  return <Modal open={Boolean(prompt)} title={prompt ? titles[prompt.type] : "Operation"} onClose={onClose}>{prompt && <form className="operation-form" onSubmit={(event) => { event.preventDefault(); onSubmit(String(new FormData(event.currentTarget).get("value") || "")); }}><label><span>{prompt.type === "move" || prompt.type === "copy" ? "Destination path" : "Name"}</span><input name="value" autoFocus defaultValue={prompt.type === "rename" ? prompt.item?.name : prompt.type === "move" || prompt.type === "copy" ? "/" : ""} required /></label><div><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button type="submit">{titles[prompt.type]}</Button></div></form>}</Modal>;
}
function TrashPanel({ entries, onRestore, onPurge }: { entries: TrashEntry[]; onRestore: (id: string) => void; onPurge: (id: string) => void }) { return <div className="trash-list">{entries.length ? entries.map((entry) => <div key={entry.id}><span className="file-icon"><Trash2 /></span><div><strong>{entry.originalPath.split("/").pop()}</strong><span>{entry.originalPath} · expires {new Date(entry.expiresAt).toLocaleDateString()}</span></div><Button variant="secondary" onClick={() => onRestore(entry.id)}>Restore</Button><Button variant="danger" onClick={() => onPurge(entry.id)}>Delete now</Button></div>) : <EmptyState title="Trash is empty" body="Deleted files stay recoverable here for 30 days." icon={<Trash2 />} />}</div>; }
function fileIcon(name: string) { const ext = name.split(".").pop()?.toLowerCase(); if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext || "")) return FileImage; if (["zip", "tar", "gz", "7z", "rar"].includes(ext || "")) return Archive; if (["txt", "md", "json", "js", "ts", "py", "css", "html", "log"].includes(ext || "")) return FileText; return File; }
function isImageName(name: string) { return ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "heic", "heif", "bmp"].includes(name.split(".").pop()?.toLowerCase() || ""); }
function formatBytes(value: number) { if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB", "TB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`; }
function readSavedResources(key: string): SavedResource[] { try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function readStringList(key: string): string[] { try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; } catch { return []; } }
function quickAccessRank(name: string): number { const preferred = ["Desktop", "Documents", "Downloads", "tv-movies", "tv-shows", "local-projects"]; const index = preferred.indexOf(name); return index === -1 ? preferred.length : index; }
function StorageMeter({ usage }: { usage: StorageUsage }) { const total = Math.max(0, Number(usage.total) || 0); const used = Math.max(0, Number(usage.used) || 0); const percent = total > 0 ? Math.min(100, used / total * 100) : 0; return <div className="storage-meter"><div><span>Storage</span><strong>{formatBytes(Math.max(0, total - used))} free</strong></div><div className="storage-track"><i style={{ width: `${percent}%` }} /></div><small>{formatBytes(used)} of {formatBytes(total)} used</small></div>; }
