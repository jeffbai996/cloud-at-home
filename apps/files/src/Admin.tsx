import { ExternalLink, HardDrive, Plus, RefreshCw, Shield, Trash2, UserRound, Users, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@cloud-at-home/ui";
import { adminResource, createUser, deleteUser, type StorageUsage } from "./api";

type User = { id: number; username: string; scope?: string; perm?: Record<string, boolean>; lockPassword?: boolean };
type Share = { hash: string; path: string; expire?: number; unit?: string; password_hash?: string };

export function AdminPanel({ initialTab = "users", currentUserId, usage }: { initialTab?: "users" | "shares" | "settings"; currentUserId: string; usage: StorageUsage | null }) {
  const [tab, setTab] = useState<"users" | "shares" | "settings">(initialTab);
  const [users, setUsers] = useState<User[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");

  async function load() {
    setError("");
    try {
      const [nextUsers, nextShares, nextSettings] = await Promise.all([
        adminResource<User[]>("users"),
        adminResource<Share[]>("shares"),
        adminResource<Record<string, unknown>>("settings"),
      ]);
      setUsers(nextUsers); setShares(nextShares); setSettings(nextSettings);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load control panel"); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => setTab(initialTab), [initialTab]);

  async function submitUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await createUser(String(form.get("username") ?? ""), String(form.get("password") ?? ""), form.get("admin") === "on");
      setCreating(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create user"); }
    finally { setBusy(false); }
  }

  async function removeUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const user = pendingDelete;
    if (!user || String(user.id) === currentUserId) return;
    setBusy(true); setError("");
    try { await deleteUser(user.id, currentPassword); setPendingDelete(null); setCurrentPassword(""); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove user"); }
    finally { setBusy(false); }
  }

  return (
    <div className="admin-panel">
      <div className="admin-head"><p>Manage accounts, shared links, and drive configuration.</p><button aria-label="Refresh control panel" title="Refresh" onClick={() => void load()}><RefreshCw size={16} /></button></div>
      <div className="admin-tabs"><button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><Users size={16} /> Users</button><button className={tab === "shares" ? "active" : ""} onClick={() => setTab("shares")}><ExternalLink size={16} /> Shares</button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Shield size={16} /> Settings</button></div>
      {error && <div className="inline-error">{error}</div>}
      {tab === "users" && <div className="admin-section">
        <div className="admin-section-heading"><div><strong>People with access</strong><span>{users.length} account{users.length === 1 ? "" : "s"}</span></div><Button onClick={() => setCreating((value) => !value)}>{creating ? <X size={16} /> : <Plus size={16} />}{creating ? "Cancel" : "Add user"}</Button></div>
        {creating && <form className="admin-user-form" onSubmit={(event) => void submitUser(event)}><label><span>Username</span><input name="username" required autoFocus autoComplete="off" /></label><label><span>Temporary password</span><input name="password" type="password" required minLength={8} autoComplete="new-password" /></label><label className="admin-check"><input name="admin" type="checkbox" /><span>Administrator access</span></label><Button type="submit" disabled={busy}><UserRound size={16} />{busy ? "Creating…" : "Create account"}</Button></form>}
        {pendingDelete && <form className="admin-delete-confirm" onSubmit={(event) => void removeUser(event)}><div><strong>Remove {pendingDelete.username}?</strong><span>Enter your current administrator password to revoke this account.</span></div><input type="password" autoFocus required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Your password" /><Button variant="ghost" type="button" onClick={() => { setPendingDelete(null); setCurrentPassword(""); }}>Cancel</Button><Button variant="danger" type="submit" disabled={busy || !currentPassword}>{busy ? "Removing…" : "Remove"}</Button></form>}
        <div className="admin-list">{users.map((user) => { const self = String(user.id) === currentUserId; return <div className="admin-row" key={user.id}><span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}{self ? " (you)" : ""}</strong><span>{user.scope ?? "/"}</span></div><span className={`status-pill ${user.perm?.admin ? "admin" : ""}`}>{user.perm?.admin ? "Admin" : "Member"}</span><button className="admin-delete" aria-label={`Remove ${user.username}`} disabled={self || busy} title={self ? "You cannot remove your active account" : `Remove ${user.username}`} onClick={() => { setPendingDelete(user); setCurrentPassword(""); }}><Trash2 size={16} /></button></div>; })}</div>
      </div>}
      {tab === "shares" && <div className="admin-section"><div className="admin-section-heading"><div><strong>Shared links</strong><span>Links created from Cloud Drive</span></div></div><div className="admin-list">{shares.length ? shares.map((share) => <div className="admin-row" key={share.hash}><span className="avatar share-avatar"><ExternalLink size={16} /></span><div><strong>{share.path}</strong><span>{share.expire ? `Expires in ${share.expire} ${share.unit ?? "hours"}` : "No expiration"}</span></div><code>{share.hash.slice(0, 8)}…</code></div>) : <div className="admin-empty">No active shared links.</div>}</div></div>}
      {tab === "settings" && <div className="admin-section"><div className="admin-section-heading"><div><strong>Drive configuration</strong><span>Storage and current FileBrowser values</span></div></div>{usage && <div className="admin-storage"><span className="admin-storage-icon"><HardDrive size={19} /></span><div><div><strong>{formatBytes(Math.max(0, usage.total - usage.used))} free</strong><span>{formatBytes(usage.total)} total</span></div><div className="admin-storage-track"><i style={{ width: `${usage.total > 0 ? Math.min(100, usage.used / usage.total * 100) : 0}%` }} /></div></div></div>}<dl className="settings-list">{Object.entries(settings).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => <div key={key}><dt>{labelForSetting(key)}</dt><dd>{String(value)}</dd></div>)}</dl></div>}
    </div>
  );
}

function formatBytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function labelForSetting(value: string): string {
  const spaced = value.replace(/([A-Z])/g, " $1").replaceAll("_", " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
