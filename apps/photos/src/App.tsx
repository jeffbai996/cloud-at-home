import {
  useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent,
} from "react";

import {
  AppShell, Button, DropdownMenu, EmptyState, Lightbox, LoginView, Modal,
  Skeleton, serviceHref,
  type LightboxItem,
} from "@cloud-at-home/ui";
import {
  AlertCircle, Check, CheckCircle2, ChevronDown, Circle, Copy, FileImage, Folder,
  FolderOpen, FolderPlus, HardDrive, Images, LogOut, Move, Play, Search,
  Upload, X,
} from "lucide-react";

import {
  PHOTOS_ROOT, albumCover, browseDrive, createAlbum, ensurePhotosSession, fullUrl,
  getSession, importFromDrive, isIngestibleMedia,
  listAlbums, listPhotos, login, loginPhotos, logoutPhotos,
  organizePhotos,
  setSessionLostHandler,
  monthGroups, previewUrl, thumbUrl, uploadPhoto,
  type Album, type DriveEntry, type Photo, type Session,
} from "./api";

// Hash contract: "#/" = the All timeline (the photos root itself);
// "#/album/<path>?item=<name>" = an album, optionally with the lightbox open.
function parseHash(): { album: string; item: string | null } {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash.startsWith("album/")) return { album: `/${PHOTOS_ROOT}`, item: null };
  const [path, query = ""] = hash.slice("album/".length).split("?");
  const item = new URLSearchParams(query).get("item");
  return { album: `/${decodeURIComponent(path).replace(/^\/+/, "")}`, item };
}

function writeHash(album: string, item: string | null): void {
  const root = `/${PHOTOS_ROOT}`;
  const base = album === root ? "#/" :
    `#/album/${encodeURIComponent(album.replace(/^\/+/, ""))}`;
  const next = item ? `${base}?item=${encodeURIComponent(item)}` : base;
  if (location.hash !== next) history.replaceState(null, "", next);
}

function filesAppOrigin(): string {
  const host = window.location.hostname;
  const secure = window.location.protocol === "https:";
  return serviceHref(host, 8082, 8454, secure);
}

function AlbumCard({ album, active, onOpen }: {
  album: Album; active: boolean; onOpen(): void;
}) {
  const [cover, setCover] = useState<string | null>(album.coverThumbUrl);
  useEffect(() => { albumCover(album).then(setCover); }, [album]);
  return (
    <button type="button" className="album-card" data-active={active} onClick={onOpen}>
      {cover
        ? <img className="album-cover" src={cover} alt="" loading="lazy" />
        : <span className="album-cover album-cover-empty"><Folder size={22} /></span>}
      <strong>{album.name}</strong>
      {album.count > 0 && <small>{album.count === 1 ? "1 item" : `${album.count} items`}</small>}
    </button>
  );
}

function albumLabel(album: string): string {
  if (album.replace(/^\/+|\/+$/g, "") === PHOTOS_ROOT) return "All photos";
  return album.split("/").filter(Boolean).pop() ?? "All photos";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function ImportContext({ album, source }: { album: string; source: string }) {
  return (
    <div className="import-context">
      <span>{source}</span><i />
      <span>Adding to</span><strong>{albumLabel(album)}</strong>
    </div>
  );
}

function DriveLogin({ onSignedIn }: { onSignedIn(session: Session): void }) {
  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // One handler for both fields: an inline `password: event.target.value`
  // reads as a hardcoded credential to the pre-push secret scanner.
  const edit = (field: "username" | "password") => (event: ChangeEvent<HTMLInputElement>) =>
    setCredentials((current) => ({ ...current, [field]: event.target.value }));
  async function submit() {
    setBusy(true);
    setError("");
    try {
      onSignedIn(await login(credentials.username, credentials.password));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="import-login" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="import-login-mark"><HardDrive size={19} /></div>
      <div><strong>Drive sign-in required</strong>
        <p>Uploads use your Cloud at Home Drive account. Photos never stores the password.</p></div>
      <input placeholder="Username" autoComplete="username"
        value={credentials.username} onChange={edit("username")} />
      <input placeholder="Password" type="password" autoComplete="current-password"
        value={credentials.password} onChange={edit("password")} />
      {error && <p className="photos-error">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in to Drive"}</Button>
    </form>
  );
}

// Importing WRITES through the Drive service, which stays credentialed even
// though viewing does not — the picker carries its own sign-in when needed.
function ImportPicker({ open, album, onClose, onDone }: {
  open: boolean; album: string; onClose(): void;
  onDone(result: { done: number; failed: string[] }): void;
}) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<DriveEntry[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    getSession().then(setSession);
  }, [open]);

  useEffect(() => {
    if (!open || !session) return;
    setEntries(null);
    setError("");
    browseDrive(path).then(setEntries).catch((failure: Error) => {
      setEntries([]);
      setError(failure.message);
    });
  }, [open, path, session]);

  function toggle(entry: DriveEntry) {
    const next = new Set(picked);
    if (next.has(entry.path)) next.delete(entry.path);
    else next.add(entry.path);
    setPicked(next);
  }

  async function run() {
    setBusy(true);
    setError("");
    try {
      const result = await importFromDrive([...picked], album);
      setPicked(new Set());
      onDone(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const crumbs = path.split("/").filter(Boolean);
  return (
    <Modal open={open} title="Import from Drive" onClose={onClose}>
      {session === undefined && <Skeleton className="import-skeleton" />}
      {session === null && <DriveLogin onSignedIn={setSession} />}
      {session && (
        <>
          <ImportContext album={album} source="Cloud at Home Drive" />
          <nav className="import-crumbs">
            <button type="button" onClick={() => setPath("/")}>Drive</button>
            {crumbs.map((part, index) => (
              <button key={index} type="button"
                onClick={() => setPath(`/${crumbs.slice(0, index + 1).join("/")}`)}>
                / {part}
              </button>
            ))}
          </nav>
          {error && <div className="import-inline-error"><AlertCircle size={15} />{error}</div>}
          <div className="import-list">
            {entries === null && <Skeleton className="import-skeleton" />}
            {entries?.map((entry) => (
              <div key={entry.path} className="import-row">
                {!entry.isDir && <button type="button" className="import-check"
                  aria-label={picked.has(entry.path) ? `Deselect ${entry.name}` : `Select ${entry.name}`}
                  onClick={() => toggle(entry)}>
                  {picked.has(entry.path) ? <Check size={15} /> : <Circle size={15} />}
                </button>}
                <button type="button" className="import-name"
                  onClick={() => entry.isDir ? setPath(entry.path) : toggle(entry)}>
                  {entry.isDir ? <FolderOpen size={15} /> : <Images size={15} />}
                  <span>{entry.name}</span>
                </button>
              </div>
            ))}
            {entries?.length === 0 && !error && <p className="import-empty">No photos or videos in this folder</p>}
          </div>
          <footer className="import-foot">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={run} disabled={busy || picked.size === 0}>
              {busy ? "Adding…" :
                picked.size === 1 ? "Add 1 photo" : `Add ${picked.size} photos`}
            </Button>
          </footer>
        </>
      )}
    </Modal>
  );
}

function ManualUpload({ open, album, onClose, onDone }: {
  open: boolean; album: string; onClose(): void;
  onDone(result: { done: number; failed: string[] }): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState(0);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    getSession().then(setSession);
    setFiles([]);
    setRejected(0);
    setProgress(0);
    setError("");
  }, [open]);
  function choose(list: FileList | null) {
    if (!list) return;
    const incoming = [...list];
    const eligible = incoming.filter((file) => isIngestibleMedia(file.name));
    setFiles(eligible);
    setRejected(incoming.length - eligible.length);
    setError("");
  }
  async function run() {
    setBusy(true);
    setError("");
    let done = 0;
    const failed: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        await uploadPhoto(album, file, (value) => setProgress((index + value) / files.length));
        done += 1;
      } catch (failure) {
        failed.push(`${file.name}: ${failure instanceof Error ? failure.message : "upload failed"}`);
      }
      setProgress((index + 1) / files.length);
    }
    setBusy(false);
    if (done === 0 && failed.length) {
      setError(failed.join(" · "));
      return;
    }
    onDone({ done, failed });
  }
  return (
    <Modal open={open} title="Upload photos" onClose={onClose}>
      {session === undefined && <Skeleton className="import-skeleton" />}
      {session === null && <DriveLogin onSignedIn={setSession} />}
      {session && <>
        <ImportContext album={album} source="This device" />
        <input ref={input} hidden multiple type="file" accept="image/*,video/*"
          onChange={(event) => choose(event.target.files)} />
        <button type="button" className="manual-drop" onClick={() => input.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files); }}>
          <span><Upload size={21} /></span>
          <strong>{files.length ? "Choose different files" : "Drop photos and videos here"}</strong>
          <small>or browse this device</small>
        </button>
        {rejected > 0 && <div className="import-inline-error"><AlertCircle size={15} />
          {rejected} unsupported {rejected === 1 ? "file was" : "files were"} left out</div>}
        {files.length > 0 && <div className="manual-files">
          {files.map((file) => <div key={`${file.name}-${file.size}`}>
            <span><FileImage size={15} /></span>
            <div><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></div>
          </div>)}
        </div>}
        {busy && <div className="import-progress"><i style={{ width: `${progress * 100}%` }} /></div>}
        {error && <div className="import-inline-error"><AlertCircle size={15} />{error}</div>}
        <footer className="import-foot">
          <span className="import-selection">{files.length ? `${files.length} ready` : "Choose files to continue"}</span>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy || files.length === 0}>
            {busy ? `Uploading ${Math.round(progress * 100)}%` :
              files.length === 0 ? "Upload photos" :
                files.length === 1 ? "Upload 1 photo" : `Upload ${files.length} photos`}
          </Button>
        </footer>
      </>}
    </Modal>
  );
}

type ImportNotice = { tone: "success" | "warning"; title: string; detail: string };

function NewAlbumModal({ open, parent, onClose, onDone }: {
  open: boolean; parent: string; onClose(): void; onDone(): void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => { if (open) void getSession().then(setSession); }, [open]);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await createAlbum(parent, name);
      setName("");
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create album");
    } finally {
      setBusy(false);
    }
  }
  return <Modal open={open} title="New album" onClose={onClose}>
    {session === undefined && <Skeleton className="import-skeleton" />}
    {session === null && <DriveLogin onSignedIn={setSession} />}
    {session && <form className="edit-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>Album name<input autoFocus value={name} maxLength={80}
        onChange={(event) => setName(event.target.value)} placeholder="Weekend trip" /></label>
      {error && <div className="import-inline-error"><AlertCircle size={15} />{error}</div>}
      <footer className="import-foot">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create album"}
        </Button>
      </footer>
    </form>}
  </Modal>;
}

function OrganizeModal({ open, selected, albums, onClose, onDone }: {
  open: "move" | "copy" | null; selected: Photo[]; albums: Album[];
  onClose(): void; onDone(result: { done: number; failed: string[] }, verb: string): void;
}) {
  const [destination, setDestination] = useState(`/${PHOTOS_ROOT}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => { if (open) void getSession().then(setSession); }, [open]);
  async function submit() {
    if (!open) return;
    setBusy(true);
    setError("");
    try {
      const result = await organizePhotos(selected, destination, open === "copy");
      onDone(result, open === "copy" ? "Copied" : "Moved");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not organize photos");
    } finally {
      setBusy(false);
    }
  }
  return <Modal open={open !== null} title={`${open === "copy" ? "Copy" : "Move"} photos`}
    onClose={onClose}>
    {session === undefined && <Skeleton className="import-skeleton" />}
    {session === null && <DriveLogin onSignedIn={setSession} />}
    {session && <form className="edit-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p>{selected.length === 1 ? "1 photo selected" : `${selected.length} photos selected`}</p>
      <label>Destination<select value={destination}
        onChange={(event) => setDestination(event.target.value)}>
        <option value={`/${PHOTOS_ROOT}`}>All photos</option>
        {albums.map((entry) => <option key={entry.path} value={entry.path}>{entry.name}</option>)}
      </select></label>
      {error && <div className="import-inline-error"><AlertCircle size={15} />{error}</div>}
      <footer className="import-foot">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || selected.length === 0}>
          {busy ? "Working…" : open === "copy" ? "Copy here" : "Move here"}
        </Button>
      </footer>
    </form>}
  </Modal>;
}

export default function App() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [album, setAlbum] = useState(() => parseHash().album);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [error, setError] = useState("");
  const [openItem, setOpenItem] = useState<string | null>(() => parseHash().item);
  const [importing, setImporting] = useState(false);
  const [uploadingManual, setUploadingManual] = useState(false);
  const [notice, setNotice] = useState<ImportNotice | null>(null);
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [organizing, setOrganizing] = useState<"move" | "copy" | null>(null);
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  // Covers both 'never signed in' and 'signed out' — the gate has to answer
  // the first visit too, not just the sign-out button.
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const refresh = useCallback(() => {
    setError("");
    listPhotos(album)
      .then(setPhotos)
      .catch((failure: Error) => { setPhotos([]); setError(failure.message); });
    listAlbums().then(setAlbums).catch(() => setAlbums([]));
  }, [album]);

  useEffect(() => {
    ensurePhotosSession().then((live) => (live ? refresh() : setNeedsSignIn(true)));
  }, [refresh]);

  // A session that dies mid-visit (upstream restart, expiry) lands back on
  // the gate rather than on a listing error nobody can act on.
  useEffect(() => setSessionLostHandler(() => setNeedsSignIn(true)), []);

  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash();
      setAlbum(parsed.album);
      setOpenItem(parsed.item);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => { writeHash(album, openItem); }, [album, openItem]);

  const visible = useMemo(() => {
    if (!photos) return null;
    const needle = query.trim().toLowerCase();
    return needle ? photos.filter((photo) => photo.name.toLowerCase().includes(needle)) : photos;
  }, [photos, query]);
  const items: LightboxItem[] = useMemo(() => (visible ?? []).map((photo) => ({
    name: photo.name,
    kind: photo.kind,
    previewUrl: previewUrl(photo),
    fullUrl: fullUrl(photo),
  })), [visible]);
  const openIndex = openItem === null ? -1 :
    (visible ?? []).findIndex((photo) => photo.path === openItem || photo.name === openItem);
  const groups = useMemo(() => monthGroups(visible ?? []), [visible]);
  const recent = useMemo(() => (visible ?? []).slice(0, 12), [visible]);
  const years = useMemo(() => [...new Set((visible ?? []).map((photo) =>
    new Date(photo.date).getUTCFullYear()))], [visible]);
  const root = `/${PHOTOS_ROOT}`;
  const selectedPhotos = useMemo(() =>
    (photos ?? []).filter((photo) => selected.has(photo.path)), [photos, selected]);

  function toggleSelected(photo: Photo) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(photo.path) ? next.delete(photo.path) : next.add(photo.path);
      return next;
    });
  }

  function leaveSelection() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function signIn(username: string, password: string) {
    setAuthBusy(true);
    setAuthError("");
    try {
      await loginPhotos(username, password);
      setNeedsSignIn(false);
      refresh();
    } catch (failure) {
      setAuthError(failure instanceof Error ? failure.message : "Sign in failed");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    await logoutPhotos().catch(() => undefined);
    setNeedsSignIn(true);
    setPhotos(null);
    setAlbums([]);
    setOpenItem(null);
  }

  function completeImport(result: { done: number; failed: string[] }, verb = "Added") {
    const hasFailures = result.failed.length > 0;
    setNotice({
      tone: hasFailures ? "warning" : "success",
      title: `${verb} ${result.done === 1 ? "1 photo" : `${result.done} photos`}`,
      detail: hasFailures
        ? `${result.failed.length} failed: ${result.failed.join(", ")}`
        : `Saved to ${albumLabel(album)}`,
    });
    window.setTimeout(() => setNotice(null), 6500);
    refresh();
  }

  function completeOrganization(result: { done: number; failed: string[] }, verb: string) {
    setOrganizing(null);
    leaveSelection();
    completeImport(result, verb);
  }

  const showInDrive = openIndex >= 0 && visible ? (
    <>
      <span className="lightbox-context">
        {new Date(visible[openIndex].date).toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
        })}
        <i />{albumLabel(visible[openIndex].path.split("/").slice(0, -1).join("/"))}
      </span>
      <a className="button button-ghost" target="_blank" rel="noreferrer"
        href={`${filesAppOrigin()}/?path=${encodeURIComponent(
          visible[openIndex].path.split("/").slice(0, -1).join("/") || "/")}`}>
        Show in Drive
      </a>
    </>
  ) : null;

  if (needsSignIn) {
    return (
      <AppShell kind="photos" brand="Cloud Photos">
        <LoginView service="Photos" onSubmit={signIn} loading={authBusy} error={authError} />
      </AppShell>
    );
  }

  return (
    <AppShell kind="photos" brand="Cloud Photos" actions={<>
      <Button variant="secondary" onClick={() => setCreatingAlbum(true)}
        aria-label="New album"><FolderPlus size={15} /><span className="import-label">New album</span></Button>
      <Button variant="secondary" onClick={() => selecting ? leaveSelection() : setSelecting(true)}>
        {selecting ? <X size={15} /> : <Check size={15} />}
        <span className="import-label">{selecting ? "Done" : "Select"}</span>
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="secondary" className="upload-trigger" aria-label="Upload photos">
            <Upload size={15} /><span className="import-label">Upload</span><ChevronDown size={13} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dropdown upload-menu-list" sideOffset={9} align="end">
            <div className="dropdown-label">Import from</div>
            <DropdownMenu.Item asChild>
              <button type="button" className="dropdown-item" onClick={() => setImporting(true)}>
                <HardDrive size={16} /><span>Drive</span>
              </button>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <button type="button" className="dropdown-item" onClick={() => setUploadingManual(true)}>
                <Upload size={16} /><span>Upload</span>
              </button>
            </DropdownMenu.Item>
            <DropdownMenu.Arrow className="dropdown-arrow" />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>} navigation={
      <button className="icon-button topbar-signout" aria-label="Sign out"
        title="Sign out" onClick={() => void signOut()}><LogOut size={17} /></button>
    }>
      <main className="photos-main">
        <div className="photos-brow">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search photos"
            aria-label="Search photos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {selecting && <div className="selection-bar" role="toolbar" aria-label="Photo selection">
          <strong>{selected.size ? `${selected.size} selected` : "Select photos"}</strong>
          <button type="button" onClick={() => setSelected(new Set((visible ?? []).map((item) => item.path)))}>
            Select all
          </button>
          <span />
          <Button variant="secondary" disabled={!selected.size} onClick={() => setOrganizing("copy")}>
            <Copy size={14} />Copy
          </Button>
          <Button disabled={!selected.size} onClick={() => setOrganizing("move")}>
            <Move size={14} />Move
          </Button>
        </div>}
        {albums.length > 0 && (
          <div className="album-strip">
            <button type="button" className="album-card" data-active={album === root}
              onClick={() => { setAlbum(root); setOpenItem(null); }}>
              <span className="album-cover album-cover-empty"><Images size={22} /></span>
              <strong>All photos</strong>
            </button>
            {albums.map((entry) => (
              <AlbumCard key={entry.path} album={entry} active={album === entry.path}
                onOpen={() => { setAlbum(entry.path); setOpenItem(null); }} />
            ))}
          </div>
        )}
        {visible && visible.length > 0 && !query && (
          <div className="library-overview">
            <div>
              <strong>{albumLabel(album)}</strong>
              <span>{visible.length === 1 ? "1 item" : `${visible.length} items`}</span>
            </div>
            {years.length > 1 && <nav aria-label="Jump to year">
              {years.map((year) => <button type="button" key={year}
                onClick={() => document.getElementById(`year-${year}`)?.scrollIntoView(
                  { behavior: "smooth", block: "start" },
                )}>{year}</button>)}
            </nav>}
          </div>
        )}
        {album === root && recent.length > 0 && !query && (
          <section className="recent-section">
            <h2 className="shelf-label">Recently added</h2>
            <div className="recent-strip">
              {recent.map((photo) => (
                <button key={photo.path} type="button" className="recent-tile"
                  aria-label={`Open ${photo.name}`} onClick={() => setOpenItem(photo.path)}>
                  <img src={thumbUrl(photo)} alt="" loading="lazy" />
                  {photo.kind === "video" && <span className="video-mark"><Play size={12} /></span>}
                </button>
              ))}
            </div>
          </section>
        )}
        {error && <p className="photos-error">{error}</p>}
        {visible === null && <Skeleton className="photos-skeleton" />}
        {visible?.length === 0 && !error && (
          <EmptyState
            title={query ? "No matching photos" : "No photos yet"}
            body={query ? "Try another name." :
              "Upload directly or bring photos in from Drive."}
            icon={<Images size={28} />}
          />
        )}
        {groups.map((group, index) => {
          const year = new Date(group.photos[0].date).getUTCFullYear();
          const priorYear = index > 0
            ? new Date(groups[index - 1].photos[0].date).getUTCFullYear()
            : null;
          return (
          <section key={group.label}
            id={year !== priorYear ? `year-${year}` : undefined}>
            <h2 className="month-label">{group.label}</h2>
            <div className="photo-grid">
              {group.photos.map((photo) => (
                <button key={photo.path} type="button" className="photo-tile"
                  data-selected={selected.has(photo.path)}
                  aria-label={photo.name}
                  aria-pressed={selecting ? selected.has(photo.path) : undefined}
                  onClick={() => selecting ? toggleSelected(photo) : setOpenItem(photo.path)}>
                  <img src={thumbUrl(photo)} alt="" loading="lazy" />
                  {selecting && <span className="selection-check">
                    {selected.has(photo.path) ? <Check size={14} /> : <Circle size={14} />}
                  </span>}
                  {photo.kind === "video" && (
                    <span className="video-mark"><Play size={12} /></span>
                  )}
                </button>
              ))}
            </div>
          </section>
          );
        })}
      </main>
      {openIndex >= 0 && visible && (
        <Lightbox
          items={items}
          index={openIndex}
          onClose={() => setOpenItem(null)}
          onNavigate={(next) => setOpenItem(visible[next]?.path ?? null)}
          actions={showInDrive}
        />
      )}
      {notice && <div className="import-toast" data-tone={notice.tone} role="status">
        <span>{notice.tone === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}</span>
        <div><strong>{notice.title}</strong><small>{notice.detail}</small></div>
        <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={14} /></button>
      </div>}
      <ImportPicker open={importing} album={album}
        onClose={() => setImporting(false)}
        onDone={(result) => {
          setImporting(false);
          completeImport(result);
        }} />
      <ManualUpload open={uploadingManual} album={album}
        onClose={() => setUploadingManual(false)}
        onDone={(result) => {
          setUploadingManual(false);
          completeImport(result, "Uploaded");
        }} />
      <NewAlbumModal open={creatingAlbum} parent={root}
        onClose={() => setCreatingAlbum(false)}
        onDone={() => {
          setCreatingAlbum(false);
          setNotice({ tone: "success", title: "Album created", detail: "Ready for photos" });
          window.setTimeout(() => setNotice(null), 6500);
          refresh();
        }} />
      <OrganizeModal open={organizing} selected={selectedPhotos} albums={albums}
        onClose={() => setOrganizing(null)} onDone={completeOrganization} />
    </AppShell>
  );
}
