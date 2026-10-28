"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { VexqoraLogo } from "../../components/logo";
import { signOut } from "../login/actions";

interface TopNavProps {
  account: {
    id: string;
    label: string;
    environment: "demo" | "live";
    exchange: string;
  } | null;
  availableBalance: number | null;
  userEmail: string;
  displayName: string | null;
}

export function TopNav({
  account,
  availableBalance,
  userEmail,
  displayName
}: TopNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const settingsRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close dropdowns and drawer on route change
  useEffect(() => {
    setSettingsOpen(false);
    setProfileOpen(false);
    setSearchOpen(false);
    setMobileDrawerOpen(false);
  }, [pathname]);

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cmd/Ctrl+K shortcut
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
        setMobileDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isPulse = pathname === "/dashboard/pulse";
  const isCopilot = pathname.startsWith("/dashboard/copilot");
  const isSignals =
    pathname.startsWith("/dashboard/signals") ||
    pathname.startsWith("/dashboard/signal") ||
    pathname === "/dashboard/chat";
  const isPositions = pathname === "/dashboard/positions";
  const isHistory = pathname === "/dashboard/history";
  const isProfile = pathname === "/dashboard/profile";
  const isSettings =
    pathname.startsWith("/dashboard/settings") ||
    pathname === "/dashboard/accounts" ||
    pathname === "/dashboard/risk" ||
    pathname === "/dashboard/integrations";

  const isLive = account?.environment === "live";
  const avatarLetter = (displayName || userEmail || "U")[0]?.toUpperCase() ?? "U";

  const formattedBalance =
    availableBalance === null
      ? "— USDT"
      : `${availableBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;

  const compactBalance =
    availableBalance === null
      ? "—"
      : availableBalance >= 1000
        ? `$${(availableBalance / 1000).toFixed(1)}k`
        : `$${availableBalance.toFixed(0)}`;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const sym = searchQuery.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const formatted = sym.endsWith("USDT") ? sym : `${sym}USDT`;
    setSearchOpen(false);
    setSearchQuery("");
    router.push(`/dashboard/signal/${formatted}`);
  };

  return (
    <>
      <header className="top-nav">
        {/* Brand */}
        <Link
          href="/dashboard/pulse"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginRight: "16px",
            font: "700 17px Inter, sans-serif",
            color: "#FFFFFF",
            letterSpacing: "-0.01em",
            flexShrink: 0
          }}
        >
          <VexqoraLogo size={24} />
          <span>Vexqora</span>
        </Link>

        {/* Desktop Primary Navigation */}
        <nav className="desktop-nav">
          <Link href="/dashboard/pulse" className={`nav-link ${isPulse ? "active" : ""}`}>
            Pulse
          </Link>
          <Link
            href="/dashboard/copilot"
            className={`nav-link ${isCopilot ? "active" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <span>🧠</span>
            <span>AI Copilot</span>
          </Link>
          <Link href="/dashboard/signals" className={`nav-link ${isSignals ? "active" : ""}`}>
            Signals
          </Link>
          <Link href="/dashboard/positions" className={`nav-link ${isPositions ? "active" : ""}`}>
            Positions
          </Link>
          <Link href="/dashboard/history" className={`nav-link ${isHistory ? "active" : ""}`}>
            History
          </Link>
          <Link href="/dashboard/profile" className={`nav-link ${isProfile ? "active" : ""}`}>
            Profile
          </Link>

          {/* Desktop Settings Dropdown */}
          <div ref={settingsRef} style={{ position: "relative", height: "64px", display: "flex", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setSettingsOpen((prev) => !prev)}
              className={`nav-link ${isSettings ? "active" : ""}`}
              style={{
                background: "transparent",
                border: 0,
                borderBottom: isSettings ? "2px solid var(--primary)" : "2px solid transparent",
                cursor: "pointer",
                gap: "4px"
              }}
            >
              Settings
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 4.5L6 7.5L9 4.5" />
              </svg>
            </button>

            {settingsOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "64px",
                  left: "0",
                  width: "280px",
                  background: "#111111",
                  border: "1px solid #262626",
                  borderRadius: "10px",
                  padding: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  zIndex: 100
                }}
              >
                <Link
                  href="/dashboard/accounts"
                  onClick={() => setSettingsOpen(false)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: pathname === "/dashboard/accounts" ? "#1A1A1A" : "transparent"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", font: "600 13px Inter", color: "#FFFFFF" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#42F5B9" strokeWidth="1.5">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                    Accounts
                  </div>
                  <div style={{ font: "400 12px Inter", color: "#9A9A9A" }}>
                    Bybit Live, Demo & Paper workspaces
                  </div>
                </Link>

                <Link
                  href="/dashboard/risk"
                  onClick={() => setSettingsOpen(false)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: pathname === "/dashboard/risk" ? "#1A1A1A" : "transparent"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", font: "600 13px Inter", color: "#FFFFFF" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#42F5B9" strokeWidth="1.5">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    Risk limits
                  </div>
                  <div style={{ font: "400 12px Inter", color: "#9A9A9A" }}>
                    Trade sizing, caps & kill switch
                  </div>
                </Link>

                <Link
                  href="/dashboard/integrations"
                  onClick={() => setSettingsOpen(false)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: pathname === "/dashboard/integrations" ? "#1A1A1A" : "transparent"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", font: "600 13px Inter", color: "#FFFFFF" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#42F5B9" strokeWidth="1.5">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    Integrations
                  </div>
                  <div style={{ font: "400 12px Inter", color: "#9A9A9A" }}>
                    Telegram & Discord webhooks
                  </div>
                </Link>
              </div>
            )}
          </div>
        </nav>

        {/* Desktop Right Toolbar */}
        <div className="desktop-toolbar">
          {/* Search Trigger */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="bt"
            aria-label="Search pairs (Cmd+K)"
            title="Search pairs (Cmd+K)"
            style={{ width: "36px", padding: "0" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#FFFFFF" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
          </button>

          {/* Mode Pill */}
          <Link
            href="/dashboard/accounts"
            className="tg gy"
            style={{
              height: "36px",
              padding: "0 12px",
              borderRadius: "8px",
              fontSize: "13px",
              background: "#1A1A1A",
              border: "1px solid #262626",
              cursor: "pointer"
            }}
          >
            <i
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "4px",
                background: isLive ? "#F5C451" : "#42F5B9",
                display: "inline-block"
              }}
            />
            {isLive ? "Live" : account?.exchange === "paper" ? "Paper · VEXQORA" : "Paper · DEMO"}
          </Link>

          {/* Balance */}
          <span
            style={{
              font: "600 14px Inter, sans-serif",
              fontVariantNumeric: "tabular-nums",
              color: "#FFFFFF",
              padding: "0 4px"
            }}
          >
            {formattedBalance}
          </span>

          {/* Add Funds button (for demo accounts) */}
          {!isLive && (
            <Link
              href="/dashboard/accounts"
              className="bt"
              style={{ fontSize: "13px" }}
            >
              Add funds
            </Link>
          )}

          {/* Kill Switch */}
          <Link
            href="/dashboard/risk"
            className="bt dn"
            style={{ fontSize: "13px" }}
          >
            Kill switch
          </Link>

          {/* Profile Avatar Dropdown */}
          <div ref={profileRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setProfileOpen((prev) => !prev)}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "16px",
                background: "#1A1A1A",
                border: "1px solid #262626",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: "600 13px Inter, sans-serif",
                color: "#FFFFFF",
                cursor: "pointer"
              }}
              aria-label="Profile menu"
            >
              {avatarLetter}
            </button>

            {profileOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "40px",
                  right: "0",
                  width: "220px",
                  background: "#111111",
                  border: "1px solid #262626",
                  borderRadius: "10px",
                  padding: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  zIndex: 100
                }}
              >
                <div style={{ padding: "6px 8px", borderBottom: "1px solid #262626" }}>
                  <div style={{ font: "600 13px Inter", color: "#FFFFFF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {displayName || "Trader"}
                  </div>
                  <div style={{ font: "400 12px Inter", color: "#9A9A9A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {userEmail}
                  </div>
                </div>

                <Link
                  href="/dashboard/profile"
                  onClick={() => setProfileOpen(false)}
                  style={{
                    padding: "8px",
                    borderRadius: "6px",
                    font: "500 13px Inter",
                    color: "#FFFFFF"
                  }}
                >
                  Profile settings
                </Link>

                <form action={signOut}>
                  <button
                    type="submit"
                    className="bt dn sm"
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Toolbar (Visible on screens <= 960px) */}
        <div className="mobile-toolbar">
          {/* Quick Search */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="bt sm"
            aria-label="Search pairs"
            style={{ width: "32px", height: "32px", padding: 0 }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#FFFFFF" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
          </button>

          {/* Compact Balance Pill */}
          <Link
            href="/dashboard/accounts"
            className="tg gy"
            style={{
              height: "32px",
              padding: "0 8px",
              borderRadius: "6px",
              fontSize: "12px",
              background: "#171229",
              border: "1px solid #2A2145",
              display: "flex",
              alignItems: "center",
              gap: "5px"
            }}
          >
            <i
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "3px",
                background: isLive ? "#F5C451" : "#42F5B9",
                display: "inline-block"
              }}
            />
            <span style={{ fontWeight: 700, color: "#FFFFFF" }}>{compactBalance}</span>
          </Link>

          {/* Hamburger Drawer Toggle */}
          <button
            type="button"
            onClick={() => setMobileDrawerOpen((prev) => !prev)}
            className="mobile-nav-toggle"
            aria-label="Toggle navigation menu"
          >
            {mobileDrawerOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Mobile Navigation Drawer Sheet */}
      {mobileDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            zIndex: 999,
            display: "flex",
            justifyContent: "flex-end",
            animation: "drawerFadeIn 0.18s ease-out"
          }}
          onClick={() => setMobileDrawerOpen(false)}
        >
          <div
            style={{
              width: "82%",
              maxWidth: "340px",
              height: "100%",
              background: "#0E0B1A",
              borderLeft: "1px solid #2A2145",
              display: "flex",
              flexDirection: "column",
              padding: "20px 16px",
              gap: "16px",
              overflowY: "auto",
              animation: "drawerSlideRight 0.22s ease-out"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #262626", paddingBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <VexqoraLogo size={22} />
                <b style={{ font: "700 16px Inter, sans-serif", color: "#FFFFFF" }}>Vexqora Trade</b>
              </div>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="bt sm"
                style={{ width: "30px", height: "30px", padding: 0 }}
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>

            {/* Account Card */}
            <div
              style={{
                background: "#171229",
                border: "1px solid #2A2145",
                borderRadius: "10px",
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="lb" style={{ fontSize: "11px" }}>Активний рахунок</span>
                <span className={`tg ${isLive ? "warn" : "gy"}`} style={{ fontSize: "11px" }}>
                  <i style={{ width: "6px", height: "6px", borderRadius: "3px", background: isLive ? "#F5C451" : "#42F5B9" }} />
                  {isLive ? "Live" : account?.exchange === "paper" ? "Paper Vexqora" : "Bybit Demo"}
                </span>
              </div>
              <div style={{ font: "700 18px 'JetBrains Mono', monospace", color: "#FFFFFF" }}>
                {formattedBalance}
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                {!isLive && (
                  <Link
                    href="/dashboard/accounts"
                    onClick={() => setMobileDrawerOpen(false)}
                    className="bt sm pr"
                    style={{ flex: 1, fontSize: "12px" }}
                  >
                    + Поповнити
                  </Link>
                )}
                <Link
                  href="/dashboard/risk"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="bt sm dn"
                  style={{ flex: 1, fontSize: "12px" }}
                >
                  Kill Switch
                </Link>
              </div>
            </div>

            {/* Main Navigation Links */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span className="lb" style={{ fontSize: "11px", padding: "4px 8px" }}>Головне меню</span>
              <Link
                href="/dashboard/pulse"
                onClick={() => setMobileDrawerOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: isPulse ? "#1A1A1A" : "transparent",
                  color: isPulse ? "#42F5B9" : "#FFFFFF",
                  fontWeight: 600,
                  fontSize: "14px"
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                Pulse (Скринер)
              </Link>

              <Link
                href="/dashboard/copilot"
                onClick={() => setMobileDrawerOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: isCopilot ? "#1A1A1A" : "transparent",
                  color: isCopilot ? "#42F5B9" : "#FFFFFF",
                  fontWeight: 600,
                  fontSize: "14px"
                }}
              >
                <span style={{ fontSize: "16px" }}>🧠</span>
                AI Copilot (Аналітик)
              </Link>

              <Link
                href="/dashboard/signals"
                onClick={() => setMobileDrawerOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: isSignals ? "#1A1A1A" : "transparent",
                  color: isSignals ? "#42F5B9" : "#FFFFFF",
                  fontWeight: 600,
                  fontSize: "14px"
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                Signals (Сигнали ШІ)
              </Link>

              <Link
                href="/dashboard/positions"
                onClick={() => setMobileDrawerOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: isPositions ? "#1A1A1A" : "transparent",
                  color: isPositions ? "#42F5B9" : "#FFFFFF",
                  fontWeight: 600,
                  fontSize: "14px"
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 20V10" />
                  <path d="M12 20V4" />
                  <path d="M6 20v-6" />
                </svg>
                Positions (Позиції)
              </Link>

              <Link
                href="/dashboard/history"
                onClick={() => setMobileDrawerOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: isHistory ? "#1A1A1A" : "transparent",
                  color: isHistory ? "#42F5B9" : "#FFFFFF",
                  fontWeight: 600,
                  fontSize: "14px"
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                History (Історія)
              </Link>

              <Link
                href="/dashboard/profile"
                onClick={() => setMobileDrawerOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: isProfile ? "#1A1A1A" : "transparent",
                  color: isProfile ? "#42F5B9" : "#FFFFFF",
                  fontWeight: 600,
                  fontSize: "14px"
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Profile (Профіль)
              </Link>
            </div>

            {/* Settings Links */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", borderTop: "1px solid #262626", paddingTop: "12px" }}>
              <span className="lb" style={{ fontSize: "11px", padding: "4px 8px" }}>Налаштування</span>
              <Link
                href="/dashboard/accounts"
                onClick={() => setMobileDrawerOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  color: pathname === "/dashboard/accounts" ? "#42F5B9" : "#A59CC4",
                  fontSize: "13px"
                }}
              >
                Рахунки та Bybit API
              </Link>
              <Link
                href="/dashboard/risk"
                onClick={() => setMobileDrawerOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  color: pathname === "/dashboard/risk" ? "#42F5B9" : "#A59CC4",
                  fontSize: "13px"
                }}
              >
                Ліміти ризику
              </Link>
              <Link
                href="/dashboard/integrations"
                onClick={() => setMobileDrawerOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  color: pathname === "/dashboard/integrations" ? "#42F5B9" : "#A59CC4",
                  fontSize: "13px"
                }}
              >
                Інтеграції (Telegram, Discord)
              </Link>
            </div>

            {/* Sign out */}
            <div style={{ marginTop: "auto", borderTop: "1px solid #262626", paddingTop: "12px" }}>
              <form action={signOut}>
                <button
                  type="submit"
                  className="bt dn sm"
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Вийти з акаунту
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Cmd/Ctrl+K Search Modal */}
      {searchOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "15vh 16px 20px",
            zIndex: 999
          }}
          onClick={() => setSearchOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "520px",
              background: "#111111",
              border: "1px solid #262626",
              borderRadius: "12px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                autoFocus
                placeholder="Введіть пару Bybit (наприклад BTC, ETH, SOL)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  background: "#1A1A1A",
                  border: "1px solid #262626",
                  color: "#FFFFFF",
                  fontSize: "14px",
                  padding: "10px 12px",
                  borderRadius: "8px"
                }}
              />
              <button type="submit" className="bt pr">
                Знайти
              </button>
            </form>

            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              <span className="lb" style={{ fontSize: "11px" }}>Популярні:</span>
              {["BTCUSDT", "ETHUSDT", "SOLUSDT", "BTRUSDT", "PEPEUSDT", "SUIUSDT"].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    router.push(`/dashboard/signal/${p}`);
                  }}
                  className="tg gy"
                  style={{ cursor: "pointer", border: "1px solid #262626", fontSize: "11px" }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Tabbar (Visible on screens <= 768px) */}
      <nav className="mobile-tabbar">
        <Link
          href="/dashboard/pulse"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "3px",
            color: isPulse ? "#42F5B9" : "#9A9A9A",
            textDecoration: "none",
            flex: 1,
            padding: "6px 0"
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span style={{ font: "600 10.5px Inter, sans-serif" }}>Pulse</span>
        </Link>

        <Link
          href="/dashboard/signals"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "3px",
            color: isSignals ? "#42F5B9" : "#9A9A9A",
            textDecoration: "none",
            flex: 1,
            padding: "6px 0"
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span style={{ font: "600 10.5px Inter, sans-serif" }}>Signals</span>
        </Link>

        <Link
          href="/dashboard/positions"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "3px",
            color: isPositions ? "#42F5B9" : "#9A9A9A",
            textDecoration: "none",
            flex: 1,
            padding: "6px 0"
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 20V10" />
            <path d="M12 20V4" />
            <path d="M6 20v-6" />
          </svg>
          <span style={{ font: "600 10.5px Inter, sans-serif" }}>Positions</span>
        </Link>

        <Link
          href="/dashboard/history"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "3px",
            color: isHistory ? "#42F5B9" : "#9A9A9A",
            textDecoration: "none",
            flex: 1,
            padding: "6px 0"
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span style={{ font: "600 10.5px Inter, sans-serif" }}>History</span>
        </Link>

        <button
          type="button"
          onClick={() => setMobileDrawerOpen(true)}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "3px",
            color: mobileDrawerOpen ? "#42F5B9" : "#9A9A9A",
            background: "transparent",
            border: 0,
            cursor: "pointer",
            flex: 1,
            padding: "6px 0"
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
          <span style={{ font: "600 10.5px Inter, sans-serif" }}>Menu</span>
        </button>
      </nav>
    </>
  );
}
