import { Bookmark, Check, ChevronDown, ChevronUp, Clock3, ExternalLink, Film, Home as HomeIcon, LogOut, Menu, Play, Plus, RefreshCw, RotateCcw, Search, Shuffle, Tv, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AppShell, Button, EmptyState, Skeleton } from "@cloud-at-home/ui";
import { getMediaItem, getSeriesEpisodes, getSession, imageUrl, loadHome, login, logout, search, type MediaItem, type Session } from "./api";
import { Player } from "./Player";
import { isResumable } from "./playback";
import { ratingBadge } from "./rating";

type Home = { resume: MediaItem[]; latest: MediaItem[]; movies: MediaItem[]; series: MediaItem[] };
type PlaybackSelection = { item: MediaItem; fromBeginning: boolean };
type LibraryView = "home" | "my-list";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [home, setHome] = useState<Home | null>(null);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [playing, setPlaying] = useState<PlaybackSelection | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loginError, setLoginError] = useState("");
  const [homeError, setHomeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [libraryView, setLibraryView] = useState<LibraryView>("home");
  const [myList, setMyList] = useState<MediaItem[]>(() => readMyList());
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void getSession().then(setSession); }, []);
  useEffect(() => {
    if (!session) return;
    void refreshHome(session);
  }, [session]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => void search(session.user.id, query).then(setResults), 220);
    return () => clearTimeout(timer);
  }, [query, session]);
  useEffect(() => { localStorage.setItem("cloud-media-my-list", JSON.stringify(myList)); }, [myList]);
  useEffect(() => {
    if (!home) return;
    const currentItems = new Map([...home.movies, ...home.series].map((item) => [item.Id, item]));
    setMyList((saved) => saved.map((item) => currentItems.get(item.Id) ?? item));
  }, [home]);
  useEffect(() => {
    if (!selected) return;
    const scrollY = window.scrollY;
    const previous = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.position = previous.position;
      document.body.style.top = previous.top;
      document.body.style.width = previous.width;
      document.body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [selected]);

  const hero = useMemo(() => home?.resume[0] ?? home?.latest[0] ?? home?.movies[0], [home]);

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

  function showMyList() { setQuery(""); setLibraryView("my-list"); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }

  function toggleMyList(item: MediaItem) {
    setMyList((current) => current.some((entry) => entry.Id === item.Id)
      ? current.filter((entry) => entry.Id !== item.Id)
      : [item, ...current]);
  }

  function play(item: MediaItem, fromBeginning = false) {
    setHeaderCollapsed(true);
    setPlaying({ item, fromBeginning });
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

  if (session === undefined) return <div className="boot-screen" aria-label="Loading Cloud Media" />;
  if (!session) return <AppShell kind="media" brand="Cloud Media"><CloudMediaLogin onSubmit={signIn} loading={busy} error={loginError} /></AppShell>;

  return (
    <AppShell
      kind="media"
      brand="Cloud Media"
      headerCollapsed={headerCollapsed}
      navigation={
        <CloudMediaMenu
          open={menuOpen}
          username={session.user.name}
          onToggle={() => setMenuOpen((current) => !current)}
          onNavigate={navigateTo}
          onMyList={showMyList}
          onHeaderCollapse={() => { setMenuOpen(false); setHeaderCollapsed(true); }}
          onSearch={() => { setMenuOpen(false); requestAnimationFrame(() => searchRef.current?.focus()); }}
          onRandom={surpriseMe}
          onRefresh={() => { setMenuOpen(false); void refreshHome(session); }}
          onLogout={() => void signOut()}
        />
      }
      actions={
        <><button className={`media-my-list ${libraryView === "my-list" ? "active" : ""}`} aria-label={`My List ${myList.length}`} onClick={showMyList}><Bookmark size={16} fill={libraryView === "my-list" ? "currentColor" : "none"} /><span>My List</span>{myList.length > 0 && <b>{myList.length}</b>}</button><div className={`media-search ${query ? "media-search-active" : ""}`}>
          <Search size={17} />
          <input ref={searchRef} type="search" value={query} onFocus={() => setLibraryView("home")} onChange={(event) => setQuery(event.target.value)} placeholder="search..." aria-label="Search Cloud Media" />
          {query && <button onClick={() => setQuery("")}><X size={15} /></button>}
        </div></>
      }
    >
      {headerCollapsed && !playing && <div className="cloud-media-header-reveal-zone" onMouseEnter={() => setHeaderCollapsed(false)}><button className="cloud-media-header-restore" aria-label="Restore Cloud Media header" onClick={() => setHeaderCollapsed(false)}><ChevronDown size={17} /><span>Show header</span></button></div>}
      {query ? (
        <section className="media-page search-page"><div className="section-heading"><div><span className="eyebrow">Search</span><h1>{results.length ? `Results for “${query}”` : "No matches yet"}</h1></div></div><MediaGrid items={results} onSelect={setSelected} /></section>
      ) : libraryView === "my-list" ? (
        <section className="media-page my-list-page"><div className="section-heading"><div><span className="eyebrow">Saved</span><h1>My List</h1></div></div><MediaGrid items={myList} onSelect={setSelected} /></section>
      ) : !home ? (
        homeError
          ? <section className="media-page media-error-state"><EmptyState title="Couldn’t load Cloud Media" body={homeError} icon={<Film />} /><Button variant="secondary" onClick={() => void refreshHome(session)}>Retry</Button></section>
          : <div className="media-loading"><Skeleton className="hero-skeleton" /><div className="skeleton-row">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="poster-skeleton" />)}</div></div>
      ) : (
        <>
          {hero && <Hero item={hero} onPlay={(fromBeginning) => play(hero, fromBeginning)} onInfo={() => setSelected(hero)} />}
          <div className="media-rails">
            {home.resume.length > 0 && <MediaRail id="continue-watching" title="Continue watching" items={home.resume} onSelect={setSelected} />}
            <MediaRail id="recently-added" title="Recently added" items={home.latest} onSelect={setSelected} />
            <MediaRail id="movies" title="Movies" items={home.movies} onSelect={setSelected} />
            <MediaRail id="shows" title="Shows" items={home.series} onSelect={setSelected} />
          </div>
        </>
      )}
      <AnimatePresence>{selected && <Details item={selected} userId={session.user.id} inMyList={myList.some((entry) => entry.Id === selected.Id)} onToggleMyList={() => toggleMyList(selected)} onClose={() => setSelected(null)} onPlay={(target, fromBeginning) => { play(target, fromBeginning); setSelected(null); }} />}</AnimatePresence>
      <AnimatePresence>{playing && <Player key={playing.item.Id} item={playing.item} fromBeginning={playing.fromBeginning} session={session} onPlayEpisode={(episode) => play(episode)} onClose={() => { setPlaying(null); setHeaderCollapsed(false); void refreshHome(session); }} />}</AnimatePresence>
    </AppShell>
  );
}

function CloudMediaMenu({
  open,
  username,
  onToggle,
  onNavigate,
  onMyList,
  onHeaderCollapse,
  onSearch,
  onRandom,
  onRefresh,
  onLogout,
}: {
  open: boolean;
  username: string;
  onToggle: () => void;
  onNavigate: (section?: string) => void;
  onMyList: () => void;
  onHeaderCollapse: () => void;
  onSearch: () => void;
  onRandom: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const items = [
    { name: "Home", icon: <HomeIcon size={16} />, section: undefined },
    { name: "Continue watching", icon: <Clock3 size={16} />, section: "continue-watching" },
    { name: "Recently added", icon: <Clock3 size={16} />, section: "recently-added" },
    { name: "Movies", icon: <Film size={16} />, section: "movies" },
    { name: "Shows", icon: <Tv size={16} />, section: "shows" },
  ];
  const jellyfinUrl = typeof window === "undefined" ? "http://localhost:8096/web/" : `http://${window.location.hostname}:8096/web/`;
  return (
    <div className="cloud-media-menu">
      <button className="cloud-media-menu-trigger" aria-label={open ? "Close Cloud Media menu" : "Open Cloud Media menu"} aria-expanded={open} onClick={onToggle}><Menu size={20} /></button>
      <AnimatePresence>
        {open && (
          <motion.div className="cloud-media-menu-popover" initial={{ opacity: 0, y: -8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: .98 }}>
            <span>Browse Cloud Media</span>
            <button onClick={onSearch}><Search size={16} />Search library</button>
            <button onClick={onMyList}><Bookmark size={16} />My List</button>
            {items.map((entry) => <button key={entry.name} onClick={() => onNavigate(entry.section)}>{entry.icon}{entry.name}</button>)}
            <div className="cloud-media-menu-rule" />
            <span>Tools</span>
            <button onClick={onRandom}><Shuffle size={16} />Surprise me</button>
            <button onClick={onRefresh}><RefreshCw size={16} />Refresh home</button>
            <button onClick={onHeaderCollapse}><ChevronUp size={16} />Cinema mode</button>
            <a href={jellyfinUrl}><ExternalLink size={16} />Open Jellyfin</a>
            <button className="cloud-media-logout" onClick={onLogout}><LogOut size={16} />Sign out</button>
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
        <h1>Sign in to Cloud Media</h1>
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
      <motion.div className="hero-copy" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .08 }}>
        <span className="eyebrow">{item.Type === "Series" ? "SERIES" : "NOW WATCHING"}</span>
        <h1>{item.Name}</h1>
        <div className="hero-meta">{item.ProductionYear && <span>{item.ProductionYear}</span>}{minutes > 0 && <span>{minutes} min</span>}</div>
        {item.Overview && <p>{item.Overview}</p>}
        <div className="hero-actions"><Button onClick={() => onPlay(false)}><Play size={18} fill="currentColor" /> {resumable ? "Resume" : "Play"}</Button>{resumable && <Button variant="secondary" onClick={() => onPlay(true)}><RotateCcw size={17} /> Play from beginning</Button>}<Button variant="secondary" onClick={onInfo}>More info</Button></div>
      </motion.div>
    </section>
  );
}

function MediaRail({ id, title, items, onSelect }: { id: string; title: string; items: MediaItem[]; onSelect: (item: MediaItem) => void }) {
  if (!items.length) return null;
  return <section className="media-rail" id={id}><h2>{title}</h2><div className="rail-scroll">{items.map((item, index) => <MediaCard key={`${item.Id}-${index}`} item={item} onClick={() => onSelect(item)} />)}</div></section>;
}

function MediaGrid({ items, onSelect }: { items: MediaItem[]; onSelect: (item: MediaItem) => void }) {
  if (!items.length) return <EmptyState title="Nothing hiding back here" body="Try a title, series, or episode name." icon={<Search />} />;
  return <div className="media-grid">{items.map((item) => <MediaCard key={item.Id} item={item} onClick={() => onSelect(item)} />)}</div>;
}

function MediaCard({ item, onClick }: { item: MediaItem; onClick: () => void }) {
  const progress = item.UserData?.PlayedPercentage ?? 0;
  return (
    <motion.button className="media-card" onClick={onClick} whileHover={{ y: -6, scale: 1.018 }} transition={{ type: "spring", stiffness: 380, damping: 28 }}>
      <div className="poster"><img src={imageUrl(item)} alt="" loading="lazy" /><div className="card-overlay"><span className="card-play"><Play fill="currentColor" size={19} /></span></div>{progress > 0 && <div className="progress"><span style={{ width: `${progress}%` }} /></div>}</div>
      <strong>{item.SeriesName ?? item.Name}</strong>
      <span>{item.SeriesName ? item.Name : [item.ProductionYear, item.Type === "Series" ? "TV" : null].filter(Boolean).join(" · ")}</span>
    </motion.button>
  );
}

function Details({ item, userId, inMyList, onToggleMyList, onClose, onPlay }: { item: MediaItem; userId: string; inMyList: boolean; onToggleMyList: () => void; onClose: () => void; onPlay: (target: MediaItem, fromBeginning: boolean) => void }) {
  const art = item.BackdropImageTags?.length ? "Backdrop" : "Primary";
  const [episodes, setEpisodes] = useState<MediaItem[]>([]);
  const [episodeError, setEpisodeError] = useState("");
  const [loadingEpisodes, setLoadingEpisodes] = useState(item.Type === "Series");
  const minutes = runtimeMinutes(item);
  const nextEpisode = episodes.find((episode) => !episode.UserData?.Played) ?? episodes[0];
  const playTarget = nextEpisode ?? item;
  const resumable = itemCanResume(playTarget);
  const watched = Math.round(playTarget.UserData?.PlayedPercentage ?? 0);
  const primaryLabel = resumable ? "Resume" : item.Type === "Series" ? "Play next" : "Play";
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
    <motion.div className="details-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.article className={`details-card ${item.Type === "Series" ? "details-card-series" : ""}`} layoutId={`media-${item.Id}`} initial={{ y: 40, scale: .97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 26, opacity: 0 }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="details-art" style={{ backgroundImage: `linear-gradient(0deg, var(--surface) 0%, transparent 65%), url(${imageUrl(item, art, 1300)})` }}><button className="details-close icon-button" onClick={onClose}><X /></button></div>
        <div className="details-copy">
          <span className="eyebrow">{item.Type}</span>
          <h1>{item.Name}</h1>
          <div className="hero-meta">{item.ProductionYear && <span>{item.ProductionYear}</span>}{item.Type === "Series" && episodes.length > 0 && <span>{episodes.length} episodes</span>}{item.Type !== "Series" && minutes > 0 && <span>{minutes} min</span>}</div>
          <p>{item.Overview || "No synopsis available."}</p>
          <div className="details-actions">
            <Button className="details-play" disabled={item.Type === "Series" && !nextEpisode} onClick={() => onPlay(withSeriesMetadata(playTarget, item), false)}><Play size={18} fill="currentColor" /> {primaryLabel}</Button>
            {resumable && <Button className="details-start-over" variant="secondary" onClick={() => onPlay(withSeriesMetadata(playTarget, item), true)}><RotateCcw size={17} /> Play from beginning</Button>}
            <Button className="details-list" variant="ghost" onClick={onToggleMyList}>{inMyList ? <Check size={17} /> : <Plus size={17} />}{inMyList ? "Remove from My List" : "Add to My List"}</Button>
          </div>
          {resumable && <div className="details-progress"><div><strong>{watched}% watched</strong><span>{playTarget.Type === "Episode" ? playTarget.Name : `${Math.max(1, Math.round((playTarget.UserData?.PlaybackPositionTicks ?? 0) / 600_000_000))} min in`}</span></div><div><i style={{ width: `${Math.min(100, watched)}%` }} /></div></div>}
          <div className="details-facts">
            {item.OfficialRating && <OfficialRating value={item.OfficialRating} />}
            {item.CommunityRating && <span>★ {item.CommunityRating.toFixed(1)}</span>}
            {(item.Genres ?? []).slice(0, 4).map((genre) => <span key={genre}>{genre}</span>)}
            {!item.OfficialRating && !item.CommunityRating && !(item.Genres?.length) && <span>{item.Type === "Series" ? "Serialized drama" : "Feature presentation"}</span>}
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
    </motion.div>
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

function OfficialRating({ value }: { value: string }) {
  const badge = ratingBadge(value);
  const tooltipId = useId();
  const badgeClassName = `rating-badge rating-badge-${badge.scheme} rating-badge-${badge.shape} rating-badge-${badge.tone}`;
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

function RatingBadgeLabel({ scheme, label }: { scheme: string; label: string }) {
  const accompaniment = scheme === "ca" && /^(14|18)A$/.exec(label);
  if (!accompaniment) return <>{label}</>;
  return <><span className="rating-badge-base">{accompaniment[1]}</span><sup className="rating-badge-accompaniment">A</sup></>;
}

function withSeriesMetadata(target: MediaItem, series: MediaItem): MediaItem {
  if (target.Type !== "Episode" || series.Type !== "Series") return target;
  return { ...target, SeriesId: target.SeriesId ?? series.Id, SeriesName: target.SeriesName ?? series.Name, SeriesProductionYear: series.ProductionYear, SeriesEndDate: series.EndDate };
}

function itemCanResume(item: MediaItem): boolean {
  return isResumable(item.UserData?.PlaybackPositionTicks, item.UserData?.Played);
}

function readMyList(): MediaItem[] {
  try {
    const value = JSON.parse(localStorage.getItem("cloud-media-my-list") ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
