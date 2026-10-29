"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { VexqoraLogo } from "../../components/logo";
import { signOut } from "../login/actions";

interface TopNavProps {
  account: { id: string; label: string; environment: "demo" | "live"; exchange: string } | null;
  availableBalance: number | null;
  userEmail: string;
  displayName: string | null;
}

type IconName = "pulse" | "signals" | "desk" | "positions" | "history" | "copilot" | "profile" | "accounts" | "risk" | "integrations";
type NavItem = { label: string; href: string; icon: IconName; match?: (path: string) => boolean };
type NavGroup = { id: string; label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    id: "trading",
    label: "Trading",
    items: [
      { label: "Market pulse", href: "/dashboard/pulse", icon: "pulse" },
      { label: "Signals", href: "/dashboard/signals", icon: "signals", match: (path) => path.startsWith("/dashboard/signals") || path.startsWith("/dashboard/signal/") },
      { label: "Signal desk", href: "/dashboard/chat", icon: "desk" },
      { label: "Positions", href: "/dashboard/positions", icon: "positions" },
      { label: "Trade history", href: "/dashboard/history", icon: "history" }
    ]
  },
  {
    id: "intelligence",
    label: "Intelligence",
    items: [{ label: "Market copilot", href: "/dashboard/copilot", icon: "copilot" }]
  },
  {
    id: "account",
    label: "Account",
    items: [
      { label: "Profile & performance", href: "/dashboard/profile", icon: "profile" },
      { label: "Exchange accounts", href: "/dashboard/accounts", icon: "accounts" },
      { label: "Risk limits", href: "/dashboard/risk", icon: "risk" },
      { label: "Integrations", href: "/dashboard/integrations", icon: "integrations" }
    ]
  }
];

function isItemActive(item: NavItem, pathname: string) {
  return item.match ? item.match(pathname) : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    pulse: <><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" /></>,
    signals: <><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 19h18" /></>,
    desk: <><path d="M4 5h16v11H4z" /><path d="M8 20h8M12 16v4" /></>,
    positions: <><path d="M5 6h14M5 12h14M5 18h14" /><path d="M8 3v6M16 9v6M10 15v6" /></>,
    history: <><path d="M4 7V3m0 0h4M4 3l3 3" /><path d="M5.2 18.8A9 9 0 1 0 4 7" /><path d="M12 7v5l3 2" /></>,
    copilot: <><path d="M12 3l2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2z" /><path d="M5 16l.8 1.8L8 19l-2.2 1.2L5 22l-.8-1.8L2 19l2.2-1.2z" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    accounts: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 15h4" /></>,
    risk: <><path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7z" /><path d="M12 8v5m0 3h.01" /></>,
    integrations: <><path d="M8 3v5H3M16 21v-5h5M3 8a9 9 0 0 1 15-3M21 16a9 9 0 0 1-15 3" /></>
  };
  return <svg className="terminal-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function TopNav({ account, availableBalance, userEmail, displayName }: TopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileGroup, setMobileGroup] = useState("trading");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const activeGroup = navGroups.find((group) => group.items.some((item) => isItemActive(item, pathname)))?.id;
  const balance = availableBalance === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(availableBalance);
  const avatar = (displayName || userEmail || "V").trim().charAt(0).toUpperCase();
  const live = account?.environment === "live";

  const openMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMenuOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setMenuOpen(false), 140);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (event.key === "Escape") { setMenuOpen(false); setMobileOpen(false); setSearchOpen(false); }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => { window.removeEventListener("keydown", onKeyDown); document.removeEventListener("mousedown", onPointerDown); if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, []);

  useEffect(() => { setMenuOpen(false); setMobileOpen(false); setSearchOpen(false); }, [pathname]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const symbol = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (symbol) router.push(`/dashboard/signals?q=${encodeURIComponent(symbol)}`);
  };

  return (
    <>
      <header className="terminal-nav" ref={navRef}>
        <Link className="terminal-nav__brand" href="/dashboard/pulse" aria-label="Vexqora Trade home"><VexqoraLogo /></Link>
        <nav className="terminal-nav__groups" aria-label="Primary navigation" onMouseEnter={openMenu} onMouseLeave={scheduleClose} onFocus={openMenu} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose(); }}>
          {navGroups.map((group) => (
            <button key={group.id} type="button" className={`terminal-nav__trigger ${activeGroup === group.id ? "is-current" : ""}`} aria-expanded={menuOpen} aria-controls="vexqora-mega-menu" onClick={() => setMenuOpen((open) => !open)}>
              {group.label}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
            </button>
          ))}
          {menuOpen && (
            <div id="vexqora-mega-menu" className="mega-menu" onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
              <div className="mega-menu__rail"><span>Workspace</span><strong>{account?.label || "No account connected"}</strong><small>{live ? "Live execution" : "Paper trading"}</small></div>
              <div className="mega-menu__grid">
                {navGroups.map((group) => (
                  <section className={`mega-menu__group ${activeGroup === group.id ? "is-current" : ""}`} key={group.id} aria-labelledby={`nav-${group.id}`}>
                    <h2 id={`nav-${group.id}`}>{group.label}</h2>
                    <div className="mega-menu__items">{group.items.map((item) => <Link className={`mega-menu__item ${isItemActive(item, pathname) ? "is-active" : ""}`} href={item.href} key={item.href}><NavIcon name={item.icon} /><span>{item.label}</span></Link>)}</div>
                  </section>
                ))}
              </div>
            </div>
          )}
        </nav>
        <div className="terminal-nav__tools">
          <button className="terminal-nav__search" type="button" onClick={() => setSearchOpen(true)} aria-label="Search markets"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><span>Search</span><kbd>⌘ K</kbd></button>
          <Link className="terminal-nav__account" href="/dashboard/accounts"><i className={live ? "is-live" : ""} /><span className="terminal-nav__account-label">{account?.label || "Connect account"}</span><strong>{balance}</strong></Link>
          <Link className="terminal-nav__avatar" href="/dashboard/profile" aria-label="Open profile">{avatar}</Link>
          <button className="terminal-nav__mobile-toggle" type="button" aria-expanded={mobileOpen} aria-controls="mobile-navigation" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><span /><span /><span /></button>
        </div>
      </header>

      {searchOpen && <div className="market-search" role="dialog" aria-modal="true" aria-label="Search markets" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}><form onSubmit={submitSearch}><label htmlFor="market-query">Find a market</label><div><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input id="market-query" name="market" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. BTCUSDT" autoComplete="off" spellCheck={false} /><button type="button" onClick={() => setSearchOpen(false)}>Esc</button></div></form></div>}

      {mobileOpen && <div className="mobile-menu" id="mobile-navigation" role="dialog" aria-modal="true" aria-label="Navigation"><button className="mobile-menu__backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /><div className="mobile-menu__panel"><div className="mobile-menu__header"><Link href="/dashboard/pulse" aria-label="Vexqora Trade home"><VexqoraLogo /></Link><button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation">×</button></div><Link className="mobile-menu__account" href="/dashboard/accounts"><span><i className={live ? "is-live" : ""} />{account?.label || "Connect account"}</span><strong>{balance}</strong></Link><nav aria-label="Mobile navigation">{navGroups.map((group) => <section className="mobile-menu__group" key={group.id}><button type="button" aria-expanded={mobileGroup === group.id} onClick={() => setMobileGroup((open) => open === group.id ? "" : group.id)}><span>{group.label}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg></button>{mobileGroup === group.id && <div>{group.items.map((item) => <Link className={isItemActive(item, pathname) ? "is-active" : ""} href={item.href} key={item.href}><NavIcon name={item.icon} /><span>{item.label}</span></Link>)}</div>}</section>)}</nav><div className="mobile-menu__footer"><span>{displayName || "Trader"}<small>{userEmail}</small></span><form action={signOut}><button type="submit">Sign out</button></form></div></div></div>}
    </>
  );
}
