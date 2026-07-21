import { Check, ChevronDown, Clapperboard, Clock3, ExternalLink, Film, Flag, Heart, House, Info, ListPlus, LogOut, Menu, Pin, Play, Plus, RefreshCw, RotateCcw, Search, Shuffle, Trash2, Tv, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AppShell, Button, EmptyState, Modal, Skeleton } from "@cloud-at-home/ui";
import { clearWatchHistory, getMediaItem, getSeriesEpisodes, getSession, imageUrl, loadHome, login, logout, removeWatchHistoryItem, search, type MediaItem, type Session } from "./api";
import { Player } from "./Player";
import { createMediaList, MAX_LIST_NAME_LENGTH, normalizeListName, toggleListItem, validPromotedListId, type MediaList } from "./lists";
import { mobileHeaderScrollIntent } from "./mobileHeader";
import { countryPills, productionDetails, scoreSource, seriesCardMeta, seriesYearRange, studioLabel, type ScoreKind } from "./mediaMetadata";
import { countryFlagPath } from "./countryFlags";
import { isResumable } from "./playback";
import { ratingBadge } from "./rating";
import { buildMovieShelves } from "./shelves";

type Home = { resume: MediaItem[]; latest: MediaItem[]; movies: MediaItem[]; series: MediaItem[] };
type PlaybackSelection = { item: MediaItem; fromBeginning: boolean };
type LibraryView = "home" | "favorites" | "list";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [sessionError, setSessionError] = useState("");
  const [home, setHome] = useState<Home | null>(null);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [playing, setPlaying] = useState<PlaybackSelection | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [homeError, setHomeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [libraryView, setLibraryView] = useState<LibraryView>("home");
  const [favorites, setFavorites] = useState<MediaItem[]>(() => readFavorites());
  const [lists, setLists] = useState<MediaList[]>(() => readLists());
  const [promotedListId, setPromotedListId] = useState<string | null>(() => localStorage.getItem("cloud-media-promoted-list"));
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchShellRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void recoverSession(); }, []);
  useEffect(() => {
    if (!session) return;
    void refreshHome(session);
  }, [session]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => void search(session.user.id, query).then(setResults), 220);
    return () => clearTimeout(timer);
  }, [query, session]);
  useEffect(() => { localStorage.setItem("cloud-media-favorites", JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem("cloud-media-lists", JSON.stringify(lists)); }, [lists]);
  useEffect(() => {
    const valid = validPromotedListId(lists, promotedListId);
    if (valid !== promotedListId) { setPromotedListId(valid); return; }
    if (valid) localStorage.setItem("cloud-media-promoted-list", valid);
    else localStorage.removeItem("cloud-media-promoted-list");
  }, [lists, promotedListId]);
  useEffect(() => {
    if (!home) return;
    const currentItems = new Map([...home.movies, ...home.series].map((item) => [item.Id, item]));
    setFavorites((saved) => saved.map((item) => currentItems.get(item.Id) ?? item));
    setLists((saved) => saved.map((list) => ({ ...list, items: list.items.map((item) => currentItems.get(item.Id) ?? item) })));
  }, [home]);
  useEffect(() => {
    const closeEmptySearch = (event: PointerEvent) => {
      if (!mobileSearchOpen || query || searchShellRef.current?.contains(event.target as Node)) return;
      setMobileSearchOpen(false);
    };
    document.addEventListener("pointerdown", closeEmptySearch);
    return () => document.removeEventListener("pointerdown", closeEmptySearch);
  }, [mobileSearchOpen, query]);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 700px)");
    let previousY = window.scrollY;
    const sync = () => {
      const currentY = window.scrollY;
      if (!mobile.matches || mobileSearchOpen || menuOpen || selected || playing || headerCollapsed) {
        setMobileHeaderHidden(false);
        previousY = currentY;
        return;
      }
      const intent = mobileHeaderScrollIntent(previousY, currentY);
      if (intent) setMobileHeaderHidden(intent === "hide");
      if (intent || Math.abs(currentY - previousY) >= 12) previousY = currentY;
    };
    window.addEventListener("scroll", sync, { passive: true });
    mobile.addEventListener("change", sync);
    sync();
    return () => {
      window.removeEventListener("scroll", sync);
      mobile.removeEventListener("change", sync);
    };
  }, [headerCollapsed, menuOpen, mobileSearchOpen, playing, selected]);

  const hero = useMemo(() => home?.resume[0] ?? home?.latest[0] ?? home?.movies[0], [home]);
  const movieShelves = useMemo(() => buildMovieShelves(home?.movies ?? []), [home?.movies]);
  const activeList = lists.find((list) => list.id === activeListId) ?? null;

  async function recoverSession() {
    setSession(undefined);
    setSessionError("");
    try { setSession(await getSession()); }
    catch (reason) {
      setSessionError(reason instanceof Error ? reason.message : "Could not reach Jellyfin.");
    }
  }

  async function signIn(username: string, password: string) {
    setBusy(true); setLoginError("");
    try { setSession(await login(username, password)); }
    catch (reason) { setLoginError(reason instanceof Error ? reason.message : "Login failed"); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setMenuOpen(false);
    await logout().catch(() => undefined);
    setSession(null);
    setHome(null);
    setSelected(null);
    setPlaying(null);
  }

  async function refreshHome(current: Session) {
    setHomeError("");
    try { setHome(await loadHome(current.user.id)); }
    catch (reason) { setHomeError(String(reason instanceof Error ? reason.message : reason)); }
  }

  function navigateTo(section?: string) {
    setQuery("");
    setLibraryView("home");
    setMenuOpen(false);
    requestAnimationFrame(() => section ? document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" }) : window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function showFavorites() { setQuery(""); setLibraryView("favorites"); setActiveListId(null); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }

  function toggleFavorite(item: MediaItem) {
    setFavorites((current) => current.some((entry) => entry.Id === item.Id)
      ? current.filter((entry) => entry.Id !== item.Id)
      : [item, ...current]);
  }

  function showList(id: string) { setQuery(""); setLibraryView("list"); setActiveListId(id); setMenuOpen(false); setListsOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }

  function toggleItemInList(listId: string, item: MediaItem) {
    setLists((current) => current.map((list) => list.id === listId ? toggleListItem(list, item) : list));
  }

  async function removeFromHistory(item: MediaItem) {
    if (!session) return;
    await removeWatchHistoryItem(session.user.id, item.Id);
    const clearHistory = (entry: MediaItem): MediaItem => entry.Id === item.Id
      ? { ...entry, UserData: { ...entry.UserData, PlaybackPositionTicks: 0, PlayedPercentage: 0, Played: false } }
      : entry;
    setHome((current) => current ? {
      ...current,
      resume: current.resume.filter((entry) => entry.Id !== item.Id),
      latest: current.latest.map(clearHistory),
      movies: current.movies.map(clearHistory),
      series: current.series.map(clearHistory),
    } : current);
    setSelected((current) => current ? clearHistory(current) : current);
  }

  function play(item: MediaItem, fromBeginning = false) {
    setPlaying({ item, fromBeginning });
  }

  async function playFromCard(item: MediaItem) {
    if (item.Type !== "Series") { play(item); return; }
    if (!session) return;
    try {
      const episodes = await getSeriesEpisodes(item.Id, session.user.id);
      const episode = episodes.find((entry) => !entry.UserData?.Played) ?? episodes[0];
      if (episode) { play(withSeriesMetadata(episode, item)); return; }
    } catch {
      // Opening details is a useful fallback when Jellyfin cannot resolve an episode.
    }
    setSelected(item);
  }

  async function returnToSeries(episode: MediaItem) {
    setPlaying(null);
    setHeaderCollapsed(false);
    const cached = home?.series.find((series) => series.Id === episode.SeriesId || series.Name === episode.SeriesName);
    if (cached) { setSelected(cached); return; }
    if (!episode.SeriesId || !session) return;
    try { setSelected(await getMediaItem(episode.SeriesId, session.user.id)); }
    catch { setSelected(null); }
  }

  function surpriseMe() {
    if (!home) return;
    const candidates = [...new Map([...home.resume, ...home.latest, ...home.movies, ...home.series].map((item) => [item.Id, item])).values()];
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    if (choice) setSelected(choice);
    setMenuOpen(false);
  }

  if (sessionError) return <AppShell kind="media" brand="Video"><section className="media-page media-error-state"><EmptyState title="Video is temporarily unavailable" body={sessionError} icon={<Film />} /><Button variant="secondary" onClick={() => void recoverSession()}>Retry</Button></section></AppShell>;
  if (session === undefined) return <div className="boot-screen" aria-label="Loading Video" />;
  if (!session) return <AppShell kind="media" brand="Video"><CloudMediaLogin onSubmit={signIn} loading={busy} error={loginError} /></AppShell>;

  return (
    <AppShell
      kind="media"
      brand="Video"
      headerCollapsed={headerCollapsed}
      headerAutoHidden={mobileHeaderHidden}
      navigation={
        <><CloudMediaMenu
          open={menuOpen}
          username={session.user.name}
          onToggle={() => setMenuOpen((current) => !current)}
          onNavigate={navigateTo}
          lists={lists}
          onFavorites={showFavorites}
          onList={showList}
          onManageLists={() => { setMenuOpen(false); setListsOpen(true); }}
          onSearch={() => { setMenuOpen(false); requestAnimationFrame(() => searchRef.current?.focus()); }}
          onRandom={surpriseMe}
          onRefresh={() => { setMenuOpen(false); void refreshHome(session); }}
          onSignOut={() => void signOut()}
          onClearHistory={async () => {
            const cleared = await clearWatchHistory(session.user.id);
            await refreshHome(session);
            return cleared;
          }}
        /><button className="icon-button topbar-signout" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut size={17} /></button></>
      }
      actions={
        <><button className={`media-nav-list media-favorites-nav ${libraryView === "favorites" ? "active" : ""}`} aria-label={`Favorites ${favorites.length}`} onClick={showFavorites}><Heart size={16} fill={libraryView === "favorites" ? "currentColor" : "none"} /><span>Favorites</span>{favorites.length > 0 && <b>{favorites.length}</b>}</button><div ref={searchShellRef} className={`media-search-shell ${mobileSearchOpen ? "mobile-search-open" : ""}`} onFocus={() => setSearchFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSearchFocused(false); }}><button className="icon-button media-search-trigger" aria-label="Search" aria-expanded={mobileSearchOpen} onClick={() => { const opening = !mobileSearchOpen; setMobileSearchOpen(opening); if (opening) requestAnimationFrame(() => searchRef.current?.focus()); }}><SearchGlyph size={17} /></button><div className={`media-search ${query ? "media-search-active" : ""}`}>
          <SearchGlyph size={17} />
          <input ref={searchRef} type="search" value={query} onFocus={() => setLibraryView("home")} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); setMobileSearchOpen(false); searchRef.current?.blur(); } }} onChange={(event) => setQuery(event.target.value)} placeholder="search..." aria-label="Search Video" autoComplete="off" />
          {query && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={15} /></button>}
        </div>{searchFocused && query.trim() && results.length > 0 && <div className="media-search-suggestions" role="listbox" aria-label="Search suggestions">{results.slice(0, 6).map((item) => <button key={item.Id} role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSelected(item); setQuery(""); setSearchFocused(false); setMobileSearchOpen(false); searchRef.current?.blur(); }}><img src={imageUrl(item, "Primary", 100)} alt="" /><span><strong>{item.SeriesName ?? item.Name}</strong><small>{item.SeriesName ? item.Name : [item.ProductionYear, item.Type === "Series" ? "TV" : item.Type].filter(Boolean).join(" · ")}</small></span></button>)}</div>}</div><button className="icon-button media-home-action" aria-label="Home" title="Home" onClick={() => navigateTo()}><House size={17} /></button><WatchlistDropdown lists={lists} activeListId={libraryView === "list" ? activeListId : null} onOpenList={showList} onManageLists={() => setListsOpen(true)} /><button className="icon-button media-cinema-action" aria-label="Cinema mode" title="Cinema mode" onClick={() => { setMenuOpen(false); setMobileSearchOpen(false); setHeaderCollapsed(true); }}><Clapperboard size={17} /></button></>
      }
    >
      {headerCollapsed && !playing && <div className="cloud-media-header-reveal-zone" onMouseEnter={() => setHeaderCollapsed(false)}><button className="cloud-media-header-restore" aria-label="Restore Video header" onClick={() => setHeaderCollapsed(false)}><ChevronDown size={17} /><span>Show header</span></button></div>}
      {query ? (
        <section className="media-page search-page"><div className="section-heading"><div><span className="eyebrow">Search</span><h1>{results.length ? `Results for “${query}”` : "No matches yet"}</h1></div></div><MediaGrid items={results} onSelect={setSelected} onPlay={(item) => void playFromCard(item)} /></section>
      ) : libraryView === "favorites" ? (
        <section className="media-page favorites-page"><div className="section-heading"><div><span className="eyebrow">Saved</span><h1>Favorites</h1></div></div><MediaGrid items={favorites} onSelect={setSelected} onPlay={(item) => void playFromCard(item)} /></section>
      ) : libraryView === "list" && activeList ? (
        <section className="media-page list-page"><div className="section-heading"><div><span className="eyebrow">List</span><h1>{activeList.name}</h1></div></div><MediaGrid items={activeList.items} onSelect={setSelected} onPlay={(item) => void playFromCard(item)} /></section>
      ) : !home ? (
        homeError
          ? <section className="media-page media-error-state"><EmptyState title="Couldn’t load Video" body={homeError} icon={<Film />} /><Button variant="secondary" onClick={() => void refreshHome(session)}>Retry</Button></section>
          : <div className="media-loading"><Skeleton className="hero-skeleton" /><div className="skeleton-row">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="poster-skeleton" />)}</div></div>
      ) : (
        <>
          {hero && <Hero item={hero} onPlay={(fromBeginning) => play(hero, fromBeginning)} onInfo={() => setSelected(hero)} />}
          <div className="media-rails">
            {home.resume.length > 0 && <MediaRail id="continue-watching" title="Continue watching" items={home.resume} onSelect={setSelected} onPlay={(item) => void playFromCard(item)} />}
            <MediaRail id="recently-added" title="Recently added" items={home.latest} onSelect={setSelected} onPlay={(item) => void playFromCard(item)} />
            <MediaRail id="movies" title="Movies" items={home.movies} count onSelect={setSelected} onPlay={(item) => void playFromCard(item)} />
            <MediaRail id="shows" title="TV Series" items={home.series} count onSelect={setSelected} onPlay={(item) => void playFromCard(item)} />
            {movieShelves.map((shelf) => <MediaRail key={shelf.id} id={`movies-${shelf.id}`} title={shelf.title} items={shelf.items} onSelect={setSelected} onPlay={(item) => void playFromCard(item)} />)}
          </div>
        </>
      )}
      <AnimatePresence mode="wait">
        {playing
          ? <Player key={`player-${playing.item.Id}`} item={playing.item} fromBeginning={playing.fromBeginning} session={session} onPlayEpisode={(episode) => play(episode)} onClose={() => { setPlaying(null); setHeaderCollapsed(false); void refreshHome(session); }} />
          : selected
            ? <Details key={`details-${selected.Id}`} item={selected} userId={session.user.id} favorite={favorites.some((entry) => entry.Id === selected.Id)} lists={lists} onToggleFavorite={() => toggleFavorite(selected)} onToggleList={(listId) => toggleItemInList(listId, selected)} onRemoveHistory={() => removeFromHistory(selected)} onManageLists={() => { setSelected(null); setListsOpen(true); }} onClose={() => setSelected(null)} onPlay={(target, fromBeginning) => { play(target, fromBeginning); setSelected(null); }} />
            : null}
      </AnimatePresence>
      <ListManager open={listsOpen} lists={lists} promotedListId={promotedListId} onClose={() => setListsOpen(false)} onChange={setLists} onPromote={setPromotedListId} onOpen={showList} />
    </AppShell>
  );
}

function WatchlistDropdown({
  lists,
  activeListId,
  onOpenList,
  onManageLists,
}: {
  lists: MediaList[];
  activeListId: string | null;
  onOpenList: (id: string) => void;
  onManageLists: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const activeInList = lists.some((list) => list.id === activeListId);
  return (
    <div className="cloud-media-menu watchlist-dropdown" ref={shellRef}>
      <button
        className={`icon-button watchlist-trigger ${activeInList ? "active" : ""}`}
        aria-label="Watchlists"
        title="Watchlists"
        aria-expanded={open}
        data-state={open ? "open" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <ListPlus size={17} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="cloud-media-menu-popover watchlist-popover" initial={{ opacity: 0, y: -8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: .98 }} transition={{ duration: .16, ease: [0.22, 1, 0.36, 1] }}>
            <span>Watchlists</span>
            {lists.length === 0
              ? <p className="watchlist-empty">No lists yet. Create one to keep track of what you want to watch.</p>
              : lists.map((list) => (
                <button key={list.id} className={list.id === activeListId ? "active" : ""} onClick={() => { onOpenList(list.id); setOpen(false); }}>
                  <ListPlus size={16} /><span className="menu-list-name" title={list.name}>{list.name}</span>{list.items.length > 0 && <small>{list.items.length}</small>}
                </button>
              ))}
            <div className="cloud-media-menu-rule" />
            <button className="watchlist-manage" onClick={() => { onManageLists(); setOpen(false); }}><Plus size={16} />{lists.length ? "Manage lists" : "Create a list"}</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CloudMediaMenu({
  open,
  username,
  onToggle,
  onNavigate,
  lists,
  onFavorites,
  onList,
  onManageLists,
  onSearch,
  onRandom,
  onRefresh,
  onSignOut,
  onClearHistory,
}: {
  open: boolean;
  username: string;
  onToggle: () => void;
  onNavigate: (section?: string) => void;
  lists: MediaList[];
  onFavorites: () => void;
  onList: (id: string) => void;
  onManageLists: () => void;
  onSearch: () => void;
  onRandom: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onClearHistory: () => Promise<number>;
}) {
  const [clearState, setClearState] = useState<"idle" | "confirm" | "clearing" | "cleared" | "error">("idle");
  const clearLabel = clearState === "confirm" ? "Confirm clear history"
    : clearState === "clearing" ? "Clearing…"
      : clearState === "cleared" ? "Watch history cleared"
        : clearState === "error" ? "Couldn’t clear — retry"
          : "Clear watch history";
  async function handleClearHistory() {
    if (clearState !== "confirm" && clearState !== "error") { setClearState("confirm"); return; }
    setClearState("clearing");
    try { await onClearHistory(); setClearState("cleared"); }
    catch { setClearState("error"); }
  }
  const items = [
    { name: "Continue watching", icon: <Clock3 size={16} />, section: "continue-watching" },
    { name: "Recently added", icon: <Plus size={16} />, section: "recently-added" },
    { name: "Movies", icon: <Film size={16} />, section: "movies" },
    { name: "Shows", icon: <Tv size={16} />, section: "shows" },
  ];
  return (
    <div className="cloud-media-menu">
      <button className="cloud-media-menu-trigger" aria-label={open ? "Close Video menu" : "Open Video menu"} aria-expanded={open} onClick={onToggle}><Menu size={20} /></button>
      <AnimatePresence>
        {open && (
          <motion.div className="cloud-media-menu-popover" initial={{ opacity: 0, y: -8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: .98 }}>
            <span>Browse Video</span>
            <button onClick={onSearch}><Search size={16} />Search library</button>
            <button className="cloud-media-menu-favorites" onClick={onFavorites}><Heart size={16} />Favorites</button>
            {items.map((entry) => <button key={entry.name} onClick={() => onNavigate(entry.section)}>{entry.icon}{entry.name}</button>)}
            <div className="cloud-media-menu-rule" />
            <span>Lists</span>
            {lists.map((list) => <button key={list.id} onClick={() => onList(list.id)}><ListPlus size={16} /><span className="menu-list-name" title={list.name}>{list.name}</span>{list.items.length > 0 && <small>{list.items.length}</small>}</button>)}
            <button onClick={onManageLists}><Plus size={16} />{lists.length ? "Manage lists" : "Create a list"}</button>
            <div className="cloud-media-menu-rule" />
            <span>Tools</span>
            <button onClick={onRandom}><Shuffle size={16} />Surprise me</button>
            <button onClick={onRefresh}><RefreshCw size={16} />Refresh home</button>
            <button className={`cloud-media-clear-history ${clearState === "confirm" || clearState === "error" ? "confirm" : ""}`} disabled={clearState === "clearing" || clearState === "cleared"} onClick={() => void handleClearHistory()}><Trash2 size={16} />{clearLabel}</button>
            <button className="cloud-media-menu-mobile-signout" onClick={onSignOut}><LogOut size={16} />Sign out</button>
            <div className="cloud-media-menu-footer">
              <span>Signed in as {username}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CloudMediaLogin({ onSubmit, loading, error }: { onSubmit: (username: string, password: string) => void; loading: boolean; error: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <main className="cloud-media-login">
      <div className="cloud-media-login-glow" />
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(username.trim(), password); }}>
        <span className="cloud-media-login-kicker">WELCOME BACK</span>
        <h1>Sign in to Video</h1>
        <p>Pick up where you left off, on your own profile.</p>
        <label><span>Profile</span><input autoFocus required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Profile name" /></label>
        <label><span>Password <small>optional</small></span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" /></label>
        {error && <div className="cloud-media-login-error">{error}</div>}
        <button type="submit" disabled={loading || !username.trim()}>{loading ? "Signing in…" : "Sign in"}</button>
        <small>Profiles keep watch progress and history separate.</small>
      </form>
    </main>
  );
}

function Hero({ item, onPlay, onInfo }: { item: MediaItem; onPlay: (fromBeginning: boolean) => void; onInfo: () => void }) {
  const art = item.BackdropImageTags?.length ? "Backdrop" : "Primary";
  const minutes = runtimeMinutes(item);
  const resumable = itemCanResume(item);
  return (
    <section className="hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.93) 0%, rgba(0,0,0,.56) 43%, transparent 76%), linear-gradient(0deg, var(--bg) 0%, transparent 38%), url(${imageUrl(item, art, 1600)})` }}>
      <motion.div className="hero-copy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .08 }}>
        <span className="eyebrow">{item.Type === "Series" ? "SERIES" : "NOW WATCHING"}</span>
        <h1>{item.Name}</h1>
        <div className="hero-meta">{item.ProductionYear && <span>{item.ProductionYear}</span>}{minutes > 0 && <span>{minutes} min</span>}</div>
        {item.Overview && <p>{item.Overview}</p>}
        <div className="hero-actions"><Button onClick={() => onPlay(false)}><Play size={18} fill="currentColor" /> {resumable ? "Resume" : "Play"}</Button>{resumable && <Button variant="secondary" onClick={() => onPlay(true)}><RotateCcw size={17} /> Play from beginning</Button>}<Button className="hero-more-info" variant="secondary" aria-label="More info" title="More info" onClick={onInfo}><Info size={20} /></Button></div>
      </motion.div>
    </section>
  );
}

function MediaRail({ id, title, items, onSelect, onPlay, count }: { id: string; title: string; items: MediaItem[]; onSelect: (item: MediaItem) => void; onPlay: (item: MediaItem) => void; count?: boolean }) {
  if (!items.length) return null;
  return <section className="media-rail" id={id}><h2>{title}{count && <span className="rail-count">{items.length}</span>}</h2><div className="rail-scroll">{items.map((item, index) => <MediaCard key={`${item.Id}-${index}`} item={item} onOpen={() => onSelect(item)} onPlay={() => onPlay(item)} />)}</div></section>;
}

function MediaGrid({ items, onSelect, onPlay }: { items: MediaItem[]; onSelect: (item: MediaItem) => void; onPlay: (item: MediaItem) => void }) {
  if (!items.length) return <EmptyState title="Nothing hiding back here" body="Try a title, series, or episode name." icon={<Search />} />;
  return <div className="media-grid">{items.map((item) => <MediaCard key={item.Id} item={item} onOpen={() => onSelect(item)} onPlay={() => onPlay(item)} />)}</div>;
}

const warmedDetailsArt = new Set<string>();

function warmDetailsArt(item: MediaItem) {
  const src = imageUrl(item, item.BackdropImageTags?.length ? "Backdrop" : "Primary", 1300);
  if (warmedDetailsArt.has(src)) return;
  warmedDetailsArt.add(src);
  const image = new Image();
  image.decoding = "async";
  image.src = src;
}

function MediaCard({ item, onOpen, onPlay }: { item: MediaItem; onOpen: () => void; onPlay: () => void }) {
  const progress = item.UserData?.PlayedPercentage ?? 0;
  const title = item.SeriesName ?? item.Name;
  return (
    <motion.article className="media-card" onPointerEnter={() => warmDetailsArt(item)} onPointerDown={() => warmDetailsArt(item)} whileHover={{ y: -5, scale: 1.014 }} transition={{ type: "spring", stiffness: 350, damping: 30 }}>
      <div className="poster">
        <button className="poster-open" aria-label={`View details for ${title}`} onFocus={() => warmDetailsArt(item)} onClick={onOpen}>
          <img src={imageUrl(item)} alt="" loading="lazy" />
          <span className="card-overlay" />
          {progress > 0 && <span className="progress"><span style={{ width: `${progress}%` }} /></span>}
        </button>
        <button className="card-play" aria-label={`Play ${title}`} onClick={onPlay}><Play fill="currentColor" size={19} /></button>
      </div>
      <button className="media-card-copy" onClick={onOpen}>
        <strong>{title}</strong>
        <span>{item.SeriesName ? item.Name : item.Type === "Series" ? seriesCardMeta(item) : [item.ProductionYear].filter(Boolean).join(" · ")}</span>
      </button>
    </motion.article>
  );
}

function Details({ item, userId, favorite, lists, onToggleFavorite, onToggleList, onRemoveHistory, onManageLists, onClose, onPlay }: { item: MediaItem; userId: string; favorite: boolean; lists: MediaList[]; onToggleFavorite: () => void; onToggleList: (listId: string) => void; onRemoveHistory: () => Promise<void>; onManageLists: () => void; onClose: () => void; onPlay: (target: MediaItem, fromBeginning: boolean) => void }) {
  const art = item.BackdropImageTags?.length ? "Backdrop" : "Primary";
  const [episodes, setEpisodes] = useState<MediaItem[]>([]);
  const [episodeError, setEpisodeError] = useState("");
  const [loadingEpisodes, setLoadingEpisodes] = useState(item.Type === "Series");
  const [listPicker, setListPicker] = useState(false);
  const [historyState, setHistoryState] = useState<"idle" | "removing" | "error">("idle");
  const [artLoaded, setArtLoaded] = useState(false);
  const minutes = runtimeMinutes(item);
  const hasWatchHistory = Boolean((item.UserData?.PlaybackPositionTicks ?? 0) > 0 || item.UserData?.Played);
  const nextEpisode = episodes.find((episode) => !episode.UserData?.Played) ?? episodes[0];
  const playTarget = nextEpisode ?? item;
  const resumable = itemCanResume(playTarget);
  const watched = Math.round(playTarget.UserData?.PlayedPercentage ?? 0);
  const primaryLabel = resumable ? "Resume" : item.Type === "Series" ? "Play next" : "Play";
  const genrePills = (item.Genres ?? []).slice(0, 2);
  const studioName = item.Studios?.[0]?.Name;
  const studioPill = studioLabel(studioName);
  const { pills: countryPillsList, overflow: countryOverflow } = countryPills(item.ProductionLocations);
  const productionRows = productionDetails(item);

  useLayoutEffect(() => {
    const previous = {
      overflow: document.body.style.overflow,
      paddingRight: document.body.style.paddingRight,
    };
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous.overflow;
      document.body.style.paddingRight = previous.paddingRight;
    };
  }, []);

  const seasons = useMemo(() => {
    const grouped = new Map<number, MediaItem[]>();
    for (const episode of episodes) {
      const season = episode.ParentIndexNumber ?? 0;
      grouped.set(season, [...(grouped.get(season) ?? []), episode]);
    }
    return [...grouped.entries()].sort(([left], [right]) => left - right);
  }, [episodes]);

  useEffect(() => {
    if (item.Type !== "Series") return;
    let cancelled = false;
    setLoadingEpisodes(true);
    setEpisodeError("");
    void getSeriesEpisodes(item.Id, userId)
      .then((items) => { if (!cancelled) setEpisodes(items); })
      .catch((reason) => { if (!cancelled) setEpisodeError(reason instanceof Error ? reason.message : "Could not load episodes"); })
      .finally(() => { if (!cancelled) setLoadingEpisodes(false); });
    return () => { cancelled = true; };
  }, [item.Id, item.Type, userId]);

  return (
    <motion.div className="details-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .22 } }} transition={{ duration: .3, ease: [0.22, 1, 0.36, 1] }} onMouseDown={onClose}>
      <motion.article className={`details-card ${item.Type === "Series" ? "details-card-series" : ""}`} initial={{ y: 16, scale: .992 }} animate={{ y: 0, scale: 1 }} exit={{ y: 10, scale: .996, transition: { duration: .22 } }} transition={{ duration: .38, ease: [0.22, 1, 0.36, 1] }} onMouseDown={(event) => event.stopPropagation()}>
        <div className={`details-art ${artLoaded ? "is-loaded" : ""}`} style={{ backgroundImage: `url(${imageUrl(item)})` }}><img className="details-art-image" src={imageUrl(item, art, 1300)} alt="" onLoad={() => setArtLoaded(true)} /><span className="details-art-shade" /><button className="details-close icon-button" aria-label="Close details" onClick={onClose}><X /></button></div>
        <div className="details-copy">
          <span className="eyebrow">{item.Type}</span>
          <h1>{item.Name}</h1>
          <div className="hero-meta">{item.Type === "Series" ? (seriesYearRange(item) && <span>{seriesYearRange(item)}</span>) : (item.ProductionYear && <span>{item.ProductionYear}</span>)}{item.Type === "Series" && item.ChildCount && item.ChildCount > 0 && <span>{item.ChildCount} {item.ChildCount === 1 ? "Season" : "Seasons"}</span>}{item.Type === "Series" && episodes.length > 0 && <span>{episodes.length} episodes</span>}{item.Type !== "Series" && minutes > 0 && <span>{minutes} min</span>}</div>
          <p>{item.Overview || "No synopsis available."}</p>
          <div className="details-actions">
            <Button className="details-play" disabled={item.Type === "Series" && !nextEpisode} onClick={() => onPlay(withSeriesMetadata(playTarget, item), false)}><Play size={18} fill="currentColor" /> {primaryLabel}</Button>
            {resumable && <Button className="details-start-over" variant="secondary" onClick={() => onPlay(withSeriesMetadata(playTarget, item), true)}><RotateCcw size={17} /> Play from beginning</Button>}
            <Button className={`details-list details-favorite ${favorite ? "active" : ""}`} variant="ghost" onClick={onToggleFavorite}><Heart size={17} fill={favorite ? "currentColor" : "none"} /><span>{favorite ? "Favorited" : "Add to favorites"}</span></Button>
            <Button className="details-list details-add-list" variant="ghost" onClick={() => setListPicker(true)}><ListPlus size={17} /><span>Add to list</span></Button>
            {hasWatchHistory && <Button className="details-list details-remove-history" variant="ghost" disabled={historyState === "removing"} onClick={() => { setHistoryState("removing"); void onRemoveHistory().then(() => setHistoryState("idle")).catch(() => setHistoryState("error")); }}><Trash2 size={16} /><span>{historyState === "removing" ? "Removing…" : historyState === "error" ? "Try removing again" : "Remove from history"}</span></Button>}
          </div>
          {resumable && <div className="details-progress"><div><strong>{watched}% watched</strong><span>{playTarget.Type === "Episode" ? playTarget.Name : `${Math.max(1, Math.round((playTarget.UserData?.PlaybackPositionTicks ?? 0) / 600_000_000))} min in`}</span></div><div><i style={{ width: `${Math.min(100, watched)}%` }} /></div></div>}
          <div className="details-facts">
            {item.OfficialRating && <OfficialRating value={item.OfficialRating} />}
            {item.CommunityRating && <ScorePill kind="community" value={item.CommunityRating.toFixed(1)} providerIds={item.ProviderIds} />}
            {item.CriticRating != null && <ScorePill kind="critic" value={`${Math.round(item.CriticRating)}%`} providerIds={item.ProviderIds} />}
            {countryPillsList.map((country, index) => <ProductionPill key={country.label} country={country} pills={countryPillsList} overflow={countryOverflow} rows={productionRows} first={index === 0} />)}
            {countryOverflow.length > 0 && <CountryOverflowPill pills={countryPillsList} overflow={countryOverflow} rows={productionRows} />}
            {genrePills.map((genre) => <span className="details-category details-category-genre" key={genre}><span className="details-category-label">{genre}</span></span>)}
            {studioPill && <span className="details-category details-category-context details-category-studio" title={studioName}><span className="details-category-label">{studioPill}</span></span>}
            {!item.OfficialRating && !item.CommunityRating && item.CriticRating == null && !genrePills.length && !studioPill && !countryPillsList.length && <span className="details-category"><span className="details-category-label">{item.Type === "Series" ? "Serialized drama" : "Feature presentation"}</span></span>}
          </div>
        </div>
        {item.Type === "Series" && (
          <div className="episode-browser">
            <div className="episode-browser-heading"><h2>Episodes</h2>{episodes.length > 0 && <span>{episodes.length} total</span>}</div>
            {loadingEpisodes && <div className="episode-status">Loading episodes…</div>}
            {episodeError && <div className="episode-status episode-error">{episodeError}</div>}
            {!loadingEpisodes && !episodeError && episodes.length === 0 && <div className="episode-status">No episodes found in this library.</div>}
            {seasons.map(([season, seasonEpisodes]) => (
              <section className="episode-season" key={season}>
                <h3>Season {season}</h3>
                <div className="episode-list">
                  {seasonEpisodes.map((episode) => {
                    const episodeMinutes = runtimeMinutes(episode);
                    return (
                      <button className="episode-row" key={episode.Id} onClick={() => onPlay(withSeriesMetadata(episode, item), false)}>
                        <span className="episode-thumb"><img src={imageUrl(episode, "Primary", 420)} alt="" loading="lazy" /><span className="episode-play"><Play size={19} fill="currentColor" /></span></span>
                        <span className="episode-copy"><span>EPISODE {episode.IndexNumber ?? "—"}</span><strong>{episode.Name}</strong>{episode.Overview && <small>{episode.Overview}</small>}</span>
                        {episodeMinutes > 0 && <span className="episode-runtime">{formatCompactMinutes(episodeMinutes)}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </motion.article>
      <Modal open={listPicker} title="Add to list" onClose={() => setListPicker(false)}>
        <div className="list-picker">
          {lists.length === 0 && <p className="list-picker-empty">No lists yet — create one to start adding titles.</p>}
          {lists.map((list) => {
            const included = list.items.some((entry) => entry.Id === item.Id);
            return <button key={list.id} className={included ? "active" : ""} onClick={() => onToggleList(list.id)}><span><ListPlus size={17} /><b title={list.name}>{list.name}</b></span>{included ? <Check size={17} /> : <Plus size={17} />}</button>;
          })}
          <button className="list-picker-manage" onClick={() => { setListPicker(false); onManageLists(); }}><Plus size={16} />Create or manage lists</button>
        </div>
      </Modal>
    </motion.div>
  );
}

function ListManager({ open, lists, promotedListId, onClose, onChange, onPromote, onOpen }: { open: boolean; lists: MediaList[]; promotedListId: string | null; onClose: () => void; onChange: (lists: MediaList[]) => void; onPromote: (id: string | null) => void; onOpen: (id: string) => void }) {
  const [name, setName] = useState("");

  function createList() {
    const normalized = normalizeListName(name);
    if (!normalized) return;
    const id = globalThis.crypto?.randomUUID?.() ?? `list-${Date.now()}`;
    const next = createMediaList(lists, normalized, id);
    onChange(next);
    if (!promotedListId) onPromote(id);
    setName("");
  }

  function removeList(list: MediaList) {
    if (!window.confirm(`Delete “${list.name}”? The titles themselves will not be removed.`)) return;
    const next = lists.filter((entry) => entry.id !== list.id);
    onChange(next);
    if (promotedListId === list.id) onPromote(validPromotedListId(next, null));
  }

  return (
    <Modal open={open} title="Lists" onClose={onClose}>
      <div className="list-manager">
        <form onSubmit={(event) => { event.preventDefault(); createList(); }}>
          <label htmlFor="new-list-name">New list</label>
          <div><input id="new-list-name" value={name} maxLength={MAX_LIST_NAME_LENGTH} onChange={(event) => setName(event.target.value)} placeholder="e.g. Date night" /><button type="submit" disabled={!normalizeListName(name)}><Plus size={17} />Create</button></div>
          <small>{name.length}/{MAX_LIST_NAME_LENGTH}</small>
        </form>
        <div className="list-manager-rows">
          {lists.length === 0 && <div className="list-manager-empty"><ListPlus /><span>Create your first list and it will appear in the top bar.</span></div>}
          {lists.map((list) => {
            const promoted = list.id === promotedListId;
            return <div className="list-manager-row" key={list.id}><button className="list-manager-open" onClick={() => onOpen(list.id)}><ListPlus size={18} /><span><b title={list.name}>{list.name}</b><small>{list.items.length} {list.items.length === 1 ? "title" : "titles"}</small></span></button><button className={`list-promote ${promoted ? "active" : ""}`} aria-label={promoted ? `${list.name} is promoted` : `Promote ${list.name} to navigation`} title={promoted ? "Shown in top bar" : "Show in top bar"} onClick={() => onPromote(list.id)}><Pin size={16} fill={promoted ? "currentColor" : "none"} /></button><button className="list-delete" aria-label={`Delete ${list.name}`} onClick={() => removeList(list)}><Trash2 size={16} /></button></div>;
          })}
        </div>
      </div>
    </Modal>
  );
}

function runtimeMinutes(item: MediaItem): number {
  return item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600_000_000) : 0;
}

function formatCompactMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const remainder = minutes % 60;
  return remainder ? `${Math.floor(minutes / 60)}h ${remainder}m` : `${minutes / 60}h`;
}

function ScorePill({ kind, value, providerIds }: { kind: ScoreKind; value: string; providerIds?: Record<string, string> }) {
  const tooltipId = useId();
  const critic = kind === "critic";
  const source = scoreSource(kind, providerIds);
  return (
    <span className={`${kind}-rating score-pill`} tabIndex={0} aria-describedby={tooltipId} aria-label={`${critic ? "Tomatometer" : "IMDb rating"} ${value}`}>
      {critic ? <TomatoMark /> : <i className="community-rating-star" aria-hidden="true">★</i>}
      {value}
      <span className="score-tooltip" id={tooltipId} role="tooltip">
        <span className="score-tooltip-heading">
          <strong>{critic ? "Tomatometer" : "IMDb"}</strong>
          <b>{value}{!critic && <span className="score-denominator">/10</span>}</b>
        </span>
        <small>{source.description}</small>
        {source.href && <a href={source.href} target="_blank" rel="noreferrer">View title on {critic ? "Rotten Tomatoes" : "Internet Movie Database"}<ExternalLink aria-hidden="true" /></a>}
      </span>
    </span>
  );
}

function CountryFlag({ code }: { code?: string }) {
  const path = countryFlagPath(code);
  if (path) return <img className="country-flag" src={path} alt="" aria-hidden="true" />;
  return <span className="country-flag country-flag-generic" aria-hidden="true"><Flag size={15} /></span>;
}

function ProductionPill({ country, pills, overflow, rows, first }: { country: { code?: string; label: string }; pills: Array<{ code?: string; label: string }>; overflow: Array<{ code?: string; label: string }>; rows: Array<{ label: string; value: string }>; first: boolean }) {
  const tooltipId = useId();
  // Every pill's card lists all countries — the visible three plus any overflow —
  // so a >3-country title never hides a co-producer, whichever pill you hover.
  const allCountries = [...pills, ...overflow];
  // The card repeats the joined country line from `rows` for the visible pills, but
  // drop it: the dedicated country list below is the fuller, flag-tagged version.
  const nonCountryRows = rows.filter((row) => !row.label.startsWith("Countr"));
  return (
    <span className={`country-pill${first ? " country-pill-lead" : ""}`} tabIndex={0} aria-label={`Production details for ${country.label}`} aria-describedby={tooltipId}>
      <CountryFlag code={country.code} />
      <span className="country-pill-label">{country.label}</span>
      <span className="production-card" id={tooltipId} role="tooltip">
        <strong>Production details</strong>
        <span className="production-card-row">
          <small>{allCountries.length === 1 ? "Country of production" : "Countries of production"}</small>
          <span className="production-card-countries">
            {allCountries.map((entry) => (
              <span className="production-card-country" key={entry.label}>
                <CountryFlag code={entry.code} />
                <b>{entry.label}</b>
              </span>
            ))}
          </span>
        </span>
        {nonCountryRows.map((row) => <span className="production-card-row" key={row.label}><small>{row.label}</small><b>{row.value}</b></span>)}
      </span>
    </span>
  );
}

// The "+N" pill collapses production countries beyond the first two. It hovers to
// the same full-detail card (every country, flag-tagged, plus studio/release), so
// the co-producers are one hover away and nothing is dropped from the row.
function CountryOverflowPill({ pills, overflow, rows }: { pills: Array<{ code?: string; label: string }>; overflow: Array<{ code?: string; label: string }>; rows: Array<{ label: string; value: string }> }) {
  const tooltipId = useId();
  const allCountries = [...pills, ...overflow];
  const nonCountryRows = rows.filter((row) => !row.label.startsWith("Countr"));
  const overflowLabels = overflow.map((entry) => entry.label).join(", ");
  return (
    <span className="country-pill country-pill-overflow" tabIndex={0} aria-label={`${overflow.length} more production ${overflow.length === 1 ? "country" : "countries"}: ${overflowLabels}`} aria-describedby={tooltipId}>
      <span className="country-pill-label">+{overflow.length}</span>
      <span className="production-card" id={tooltipId} role="tooltip">
        <strong>Production details</strong>
        <span className="production-card-row">
          <small>{allCountries.length === 1 ? "Country of production" : "Countries of production"}</small>
          <span className="production-card-countries">
            {allCountries.map((entry) => (
              <span className="production-card-country" key={entry.label}>
                <CountryFlag code={entry.code} />
                <b>{entry.label}</b>
              </span>
            ))}
          </span>
        </span>
        {nonCountryRows.map((row) => <span className="production-card-row" key={row.label}><small>{row.label}</small><b>{row.value}</b></span>)}
      </span>
    </span>
  );
}

function TomatoMark() {
  return (
    <svg className="critic-rating-tomato" viewBox="0 0 139 142" aria-hidden="true">
      <path fill="#f0442d" d="M20.2 40.8C-8 68.5 6.5 101.9 14.4 112.8c35.3 42 92.8 25.3 111.9-5.9 4.8-8.2 22.6-53.5-24-78.1z" />
      <path fill="#54a85d" d="m39.4 8.6 9-5.3 6.8 15.5c3.8-6.3 13.8-16.3 24.9-4.7-4.7 1.3-7.5 3.9-7.7 8.5 15.1-4.2 31.3 3.2 33.5 9.1-11-4.3-27.7 10.4-41.8 2.3 0 15-12.6 16.6-19.9 17.1 2.1-5 5.6-10 1.5-15-7.6 8.2-13.9 10.7-33.2 4.7 4.9-1.7 14.8-11.4 24.5-11.4-6.8-2.5-12.3-2.1-17.8-1.5 2.9-4 12.1-15.2 28.6-8.5z" />
    </svg>
  );
}

function OfficialRating({ value }: { value: string }) {
  const badge = ratingBadge(value);
  const tooltipId = useId();
  const letterClassName = badge.scheme === "us-film" && badge.label === "G"
    ? " rating-badge-letter-g"
    : badge.scheme === "us-film" && /^(PG-13|NC-17)$/.test(badge.label) ? " rating-badge-letter-long"
    : badge.scheme === "ca" && badge.label === "R" ? " rating-badge-letter-r"
    : badge.scheme === "ca" && badge.label === "PG" ? " rating-badge-letter-pg" : "";
  const badgeClassName = `rating-badge rating-badge-${badge.scheme} rating-badge-${badge.shape} rating-badge-${badge.tone}${letterClassName}`;
  return (
    <span className="rating-classification">
      <span className={badgeClassName} aria-label={`${badge.ariaLabel}. ${badge.name}. ${badge.description}`} aria-describedby={tooltipId} tabIndex={0}><RatingBadgeLabel scheme={badge.scheme} label={badge.label} /></span>
      <span className="rating-card" id={tooltipId} role="tooltip">
        <span className="rating-card-heading"><span className={`${badgeClassName} rating-card-icon`} aria-hidden="true"><RatingBadgeLabel scheme={badge.scheme} label={badge.label} /></span><strong>{badge.name}</strong></span>
        <span className="rating-card-copy">{badge.description}</span>
        {badge.authorityUrl
          ? <a href={badge.authorityUrl} target="_blank" rel="noreferrer">{badge.authority}<ExternalLink aria-hidden="true" /></a>
          : <span className="rating-card-authority">{badge.authority}</span>}
      </span>
    </span>
  );
}

function SearchGlyph({ size = 17 }: { size?: number }) {
  return <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.4" /><path d="m13.5 13.5-3.2-3.2" /></svg>;
}

function RatingBadgeLabel({ scheme, label }: { scheme: string; label: string }) {
  const accompaniment = scheme === "ca" && /^(14|18)A$/.exec(label);
  if (!accompaniment) return <>{label}</>;
  return <span className="rating-badge-content"><span className="rating-badge-base">{accompaniment[1]}</span><sup className="rating-badge-accompaniment">A</sup></span>;
}

function withSeriesMetadata(target: MediaItem, series: MediaItem): MediaItem {
  if (target.Type !== "Episode" || series.Type !== "Series") return target;
  return { ...target, SeriesId: target.SeriesId ?? series.Id, SeriesName: target.SeriesName ?? series.Name, SeriesProductionYear: series.ProductionYear, SeriesEndDate: series.EndDate };
}

function itemCanResume(item: MediaItem): boolean {
  return isResumable(item.UserData?.PlaybackPositionTicks, item.UserData?.Played);
}

function readFavorites(): MediaItem[] {
  try {
    const saved = localStorage.getItem("cloud-media-favorites") ?? localStorage.getItem("cloud-media-my-list") ?? "[]";
    const value = JSON.parse(saved);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function readLists(): MediaList[] {
  try {
    const value = JSON.parse(localStorage.getItem("cloud-media-lists") ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((list): list is MediaList => Boolean(list && typeof list.id === "string" && typeof list.name === "string" && Array.isArray(list.items)))
      .map((list) => ({ ...list, name: normalizeListName(list.name) }))
      .filter((list) => Boolean(list.name));
  } catch {
    return [];
  }
}



