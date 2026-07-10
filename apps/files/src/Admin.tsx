import { ExternalLink, RefreshCw, Shield, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@cloud-at-home/ui";
import { adminResource } from "./api";

type User = { id: number; username: string; scope?: string; perm?: Record<string, boolean>; lockPassword?: boolean };
type Share = { hash: string; path: string; expire?: number; unit?: string; password_hash?: string };

export function AdminPanel({ initialTab = "users" }: { initialTab?: "users" | "shares" | "settings" }) {
  const [tab, setTab] = useState<"users" | "shares" | "settings">(initialTab);
  const [users, setUsers] = useState<User[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");

  function load() {
    setError("");
    void Promise.all([
      adminResource<User[]>("users"),
      adminResource<Share[]>("shares"),
      adminResource<Record<string, unknown>>("settings"),
    ]).then(([nextUsers, nextShares, nextSettings]) => { setUsers(nextUsers); setShares(nextShares); setSettings(nextSettings); }).catch((reason) => setError(reason.message));
  }
  useEffect(load, []);
  useEffect(() => setTab(initialTab), [initialTab]);

  return (
    <div className="admin-panel">
      <div className="admin-tabs"><button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><Users size={16} /> Users</button><button className={tab === "shares" ? "active" : ""} onClick={() => setTab("shares")}><ExternalLink size={16} /> Shares</button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Shield size={16} /> Settings</button><Button variant="ghost" onClick={load}><RefreshCw size={15} /> Refresh</Button></div>
      {error && <div className="inline-error">{error}</div>}
      {tab === "users" && <div className="admin-list">{users.map((user) => <div className="admin-row" key={user.id}><span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><span>{user.scope ?? "/"}</span></div><span className="status-pill">{user.perm?.admin ? "Admin" : "User"}</span></div>)}</div>}
      {tab === "shares" && <div className="admin-list">{shares.length ? shares.map((share) => <div className="admin-row" key={share.hash}><span className="avatar share-avatar"><ExternalLink size={16} /></span><div><strong>{share.path}</strong><span>{share.expire ? `Expires in ${share.expire} ${share.unit ?? "hours"}` : "No expiration"}</span></div><code>{share.hash.slice(0, 8)}…</code></div>) : <div className="admin-empty">No active shares.</div>}</div>}
      {tab === "settings" && <div className="settings-grid">{Object.entries(settings).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><strong>{String(value)}</strong></div>)}</div>}
      <p className="admin-fallback">Destructive user/security edits remain available in the private stock FileBrowser fallback until their parity forms pass contract testing.</p>
    </div>
  );
}
