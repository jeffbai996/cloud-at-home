import { Clock3, ExternalLink, Film, Home as HomeIcon, Menu, Play, RefreshCw, Search, Shuffle, Tv, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell, Button, EmptyState, LoginView, Skeleton } from "@cloud-at-home/ui";
import { getSeriesEpisodes, getSession, imageUrl, loadHome, login, search, type MediaItem, type Session } from "./api";
import { Player } from "./Player";

type Home = { resume: MediaItem[]; latest: MediaItem[]; movies: MediaItem[]; series: MediaItem[] };

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [home, setHome] = useState<Home | null>(null);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [playing, setPlaying] = useState<MediaItem | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loginError, setLoginError] = useState("");
  const [homeError, setHomeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const hero = useMemo(() => home?.resume[0] ?? home?.latest[0] ?? home?.movies[0], [home]);

  async function signIn(username: string, password: string) {
    setBusy(true); setLoginError("");
    try { setSession(await login(username, password)); }
    catch (reason) { setLoginError(reason instanceof Error ? reason.message : "Login failed"); }
    finally { setBusy(false); }
  }

  async function refreshHome(current: Session) {
    setHomeError("");
    try { setHome(await loadHome(current.user.id)); }
    catch (reason) { setHomeError(String(reason instanceof Error ? reason.message : reason)); }
  }

  function navigateTo(section?: string) {
    setQuery("");
    setMenuOpen(false);
    requestAnimationFrame(() => section ? document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" }) : window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function surpriseMe() {
    if (!home) return;
    const candidates = [...new Map([...home.resume, ...home.latest, ...home.movies, ...home.series].map((item) => [item.Id, item])).values()];
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    if (choice) setSelected(choice);
    setMenuOpen(false);
  }

  if (session === undefined) return <div className="boot-screen" aria-label="Loading Cloud Media" />;
  if (!session) return <AppShell kind="media" brand="Cloud Media"><LoginView service="Cloud Media" onSubmit={signIn} loading={busy} error={loginError} /></AppShell>;

  return (
    <AppShell
      kind="media"
      brand="Cloud Media"
      navigation={
        <CloudMediaMenu
          open={menuOpen}
          username={session.user.name}
          onToggle={() => setMenuOpen((current) => !current)}
          onNavigate={navigateTo}
          onSearch={() => { setMenuOpen(false); requestAnimationFrame(() => searchRef.current?.focus()); }}
          onRandom={surpriseMe}
          onRefresh={() => { setMenuOpen(false); void refreshHome(session); }}
        />
      }
      actions={
        <div className={`media-search ${query ? "media-search-active" : ""}`}>
          <Search size={17} />
          <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="search..." aria-label="Search Cloud Media" />
          {query && <button onClick={() => setQuery("")}><X size={15} /></button>}
        </div>
      }
    >
      {query ? (
        <section className="media-page search-page"><div className="section-heading"><div><span className="eyebrow">Search</span><h1>{results.length ? `Results for “${query}”` : "No matches yet"}</h1></div></div><MediaGrid items={results} onSelect={setSelected} /></section>
      ) : !home ? (
        homeError
          ? <section className="media-page media-error-state"><EmptyState title="Couldn’t load Cloud Media" body={homeError} icon={<Film />} /><Button variant="secondary" onClick={() => void refreshHome(session)}>Retry</Button></section>
          : <div className="media-loading"><Skeleton className="hero-skeleton" /><div className="skeleton-row">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="poster-skeleton" />)}</div></div>
      ) : (
        <>
          {hero && <Hero item={hero} onPlay={() => setPlaying(hero)} onInfo={() => setSelected(hero)} />}
          <div className="media-rails">
            {home.resume.length > 0 && <MediaRail id="continue-watching" title="Continue watching" items={home.resume} onSelect={setSelected} />}
            <MediaRail id="recently-added" title="Recently added" items={home.latest} onSelect={setSelected} />
            <MediaRail id="movies" title="Movies" items={home.movies} onSelect={setSelected} />
            <MediaRail id="shows" title="Shows" items={home.series} onSelect={setSelected} />
          </div>
        </>
      )}
      <AnimatePresence>{selected && <Details item={selected} userId={session.user.id} onClose={() => setSelected(null)} onPlay={(target) => { setPlaying(target); setSelected(null); }} />}</AnimatePresence>
      <AnimatePresence>{playing && <Player item={playing} session={session} onClose={() => setPlaying(null)} />}</AnimatePresence>
    </AppShell>
  );
}

function CloudMediaMenu({
  open,
  username,
  onToggle,
  onNavigate,
  onSearch,
  onRandom,
  onRefresh,
}: {
  open: boolean;
  username: string;
  onToggle: () => void;
  onNavigate: (section?: string) => void;
  onSearch: () => void;
  onRandom: () => void;
  onRefresh: () => void;
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
            {items.map((entry) => <button key={entry.name} onClick={() => onNavigate(entry.section)}>{entry.icon}{entry.name}</button>)}
            <div className="cloud-media-menu-rule" />
            <span>Tools</span>
            <button onClick={onRandom}><Shuffle size={16} />Surprise me</button>
            <button onClick={onRefresh}><RefreshCw size={16} />Refresh home</button>
            <a href={jellyfinUrl}><ExternalLink size={16} />Open Jellyfin</a>
            <div className="cloud-media-menu-footer">
              <span>Signed in as {username}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Hero({ item, onPlay, onInfo }: { item: MediaItem; onPlay: () => void; onInfo: () => void }) {
  const art = item.BackdropImageTags?.length ? "Backdrop" : "Primary";
  const minutes = runtimeMinutes(item);
  return (
    <section className="hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.93) 0%, rgba(0,0,0,.56) 43%, transparent 76%), linear-gradient(0deg, var(--bg) 0%, transparent 38%), url(${imageUrl(item, art, 1600)})` }}>
      <motion.div className="hero-copy" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .08 }}>
        <span className="eyebrow">{item.Type === "Series" ? "Series" : "Now watching"}</span>
        <h1>{item.Name}</h1>
        <div className="hero-meta">{item.ProductionYear && <span>{item.ProductionYear}</span>}{minutes > 0 && <span>{minutes} min</span>}</div>
        {item.Overview && <p>{item.Overview}</p>}
        <div className="hero-actions"><Button onClick={onPlay}><Play size={18} fill="currentColor" /> Play</Button><Button variant="secondary" onClick={onInfo}>More info</Button></div>
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
      <span>{item.SeriesName ? item.Name : [item.ProductionYear, item.Type].filter(Boolean).join(" · ")}</span>
    </motion.button>
  );
}

function Details({ item, userId, onClose, onPlay }: { item: MediaItem; userId: string; onClose: () => void; onPlay: (target: MediaItem) => void }) {
  const art = item.BackdropImageTags?.length ? "Backdrop" : "Primary";
  const [episodes, setEpisodes] = useState<MediaItem[]>([]);
  const [episodeError, setEpisodeError] = useState("");
  const [loadingEpisodes, setLoadingEpisodes] = useState(item.Type === "Series");
  const minutes = runtimeMinutes(item);
  const nextEpisode = episodes.find((episode) => !episode.UserData?.Played) ?? episodes[0];
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
          <Button className="details-play" disabled={item.Type === "Series" && !nextEpisode} onClick={() => onPlay(nextEpisode ?? item)}><Play size={18} fill="currentColor" /> {item.Type === "Series" ? "Play next" : "Play"}</Button>
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
                      <button className="episode-row" key={episode.Id} onClick={() => onPlay(episode)}>
                        <span className="episode-thumb"><img src={imageUrl(episode, "Primary", 420)} alt="" loading="lazy" /><span className="episode-play"><Play size={19} fill="currentColor" /></span></span>
                        <span className="episode-copy"><span>S{season} E{episode.IndexNumber ?? "—"}</span><strong>{episode.Name}</strong>{episode.Overview && <small>{episode.Overview}</small>}</span>
                        {episodeMinutes > 0 && <span className="episode-runtime">{episodeMinutes} min</span>}
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
