import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bot,
  Check,
  Clapperboard,
  Cloud,
  Database,
  Files,
  Moon,
  Play,
  Sparkles,
  SunMedium,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ButtonHTMLAttributes, FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

import { applyTheme, readTheme, serviceHref, type CloudHomeTheme } from "./theme";

export { applyTheme, readTheme, writeTheme, type CloudHomeTheme } from "./theme";

export type AppKind = "media" | "files" | "ai";
type ServiceKind = AppKind | "extra";

const apps = [
  { id: "media" as const, label: "Cloud Media", icon: Play, localPort: 8090, tailnetPort: 8453 },
  { id: "files" as const, label: "Drive", icon: Files, localPort: 8082, tailnetPort: 8454 },
  { id: "ai" as const, label: "Local AI", icon: Bot, localPort: 3003, tailnetPort: 8445 },
];

export function AppSwitcher({
  current,
  urls = {},
}: {
  current: AppKind;
  urls?: Partial<Record<ServiceKind, string>>;
}) {
  const [extraService, setExtraService] = useState<{ label: string; href: string } | null>(null);

  useEffect(() => {
    fetch("/api/navigation/extra-service", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => {
        if (value && typeof value.label === "string" && typeof value.href === "string") setExtraService(value);
      })
      .catch(() => undefined);
  }, []);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="icon-button app-switcher-trigger" aria-label="Switch app">
        <CloudMark />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={`dropdown app-switcher-menu app-switcher-menu-${current}`} sideOffset={10} align="end">
          <div className="dropdown-label">SERVICES</div>
          {apps.map((app) => {
            const Icon = app.icon;
            const host = typeof window === "undefined" ? "localhost" : window.location.hostname;
            const secure = typeof window !== "undefined" && window.location.protocol === "https:";
            const href = urls[app.id] ?? serviceHref(host, app.localPort, app.tailnetPort, secure);
            return (
              <DropdownMenu.Item key={app.id} asChild>
                <a className="dropdown-item app-switcher-item" data-active={current === app.id} href={href}>
                  <span className={`app-glyph app-glyph-${app.id}`}><Icon size={17} /></span>
                  <span>{app.label}</span>
                  {current === app.id && <Check className="dropdown-check" size={15} />}
                </a>
              </DropdownMenu.Item>
            );
          })}
          {extraService && (
            <DropdownMenu.Item asChild>
              <a className="dropdown-item app-switcher-item" href={urls.extra ?? extraService.href}>
                <span className="app-glyph app-glyph-extra"><Database size={17} /></span>
                <span>{extraService.label}</span>
              </a>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Arrow className="dropdown-arrow" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function CloudMark() {
  return (
    <svg className="cloud-cloud-mark" width="22" height="22" viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M78 55a18 18 0 0 0-35.5-4.5A14 14 0 1 0 44 78h34a14 14 0 0 0 0-23z" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<CloudHomeTheme>(() =>
    typeof document === "undefined" ? "noir" : readTheme(document.cookie),
  );

  useEffect(() => applyTheme(theme), [theme]);
  const next = theme === "noir" ? "oled" : "noir";

  return (
    <button
      className="icon-button"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ opacity: 0, rotate: -35, scale: 0.8 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 35, scale: 0.8 }}
          transition={{ duration: 0.16 }}
        >
          {theme === "noir" ? <Moon size={18} /> : <SunMedium size={18} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export function AppShell({
  kind,
  brand,
  children,
  actions,
  navigation,
  urls,
  headerCollapsed = false,
  headerAutoHidden = false,
}: {
  kind: AppKind;
  brand: string;
  children: ReactNode;
  actions?: ReactNode;
  navigation?: ReactNode;
  urls?: Partial<Record<ServiceKind, string>>;
  headerCollapsed?: boolean;
  headerAutoHidden?: boolean;
}) {
  const BrandIcon = kind === "media" ? Clapperboard : kind === "files" ? Cloud : Sparkles;
  return (
    <div className={`app app-${kind} ${headerCollapsed ? "app-header-collapsed" : ""} ${headerAutoHidden ? "app-header-auto-hidden" : ""}`}>
      <header className="topbar">
        <div className="topbar-left">
          <a href="/" className="brand">
            <span className={`brand-mark brand-mark-${kind}`}><BrandIcon size={16} /></span>
            <span>{brand}</span>
          </a>
        </div>
        <div className="topbar-actions">{actions}<AppSwitcher current={kind} urls={urls} />{navigation}<ThemeToggle /></div>
      </header>
      <main>{children}</main>
    </div>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

export function LoginView({
  service,
  onSubmit,
  loading,
  error,
}: {
  service: string;
  onSubmit: (username: string, password: string) => void;
  loading?: boolean;
  error?: string;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit(String(form.get("username") ?? ""), String(form.get("password") ?? ""));
  }
  return (
    <div className="login-stage">
      <motion.form
        className="login-card glass-panel"
        onSubmit={submit}
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
      >
        <div className="login-orb">{service.includes("Cloud") ? <Cloud size={27} /> : <Sparkles size={26} />}</div>
        <div>
          <div className="eyebrow">Secure personal storage</div>
          <h1>Sign in to {service}</h1>
          <p>{service.includes("Cloud") ? "Your files, tools, and shared spaces—available from one private drive." : "Your existing account, minus the existing interface."}</p>
        </div>
        <label>
          <span>Username</span>
          <input name="username" autoComplete="username" autoFocus required />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <Button type="submit" disabled={loading}>{loading ? "Signing in…" : "Continue"}</Button>
      </motion.form>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function EmptyState({ title, body, icon }: { title: string; body: string; icon?: ReactNode }) {
  return (
    <motion.div className="empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {icon && <div className="empty-icon">{icon}</div>}
      <h2>{title}</h2>
      <p>{body}</p>
    </motion.div>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="modal-card"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 330, damping: 28 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2>{title}</h2>
            {children}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
