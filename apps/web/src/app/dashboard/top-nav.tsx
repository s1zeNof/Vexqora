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

  const settingsRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

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
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isPulse = pathname === "/dashboard/pulse";
  const isSignals = pathname === "/dashboard/chat" || pathname.startsWith("/dashboard/signal");
  const isPositions = pathname === "/dashboard/positions";
  const isHistory = pathname === "/dashboard/history";
  const isSettings =
    pathname.startsWith("/dashboard/settings") ||
    pathname === "/dashboard/accounts" ||
    pathname === "/dashboard/risk" ||
    pathname === "/dashboard/integrations" ||
    pathname === "/dashboard/profile";

  const isLive = account?.environment === "live";
  const avatarLetter = (displayName || userEmail || "U")[0]?.toUpperCase() ?? "U";

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
            marginRight: "20px",
            font: "700 17px Inter, sans-serif",
            color: "#FFFFFF",
            letterSpacing: "-0.01em"
          }}
        >
          <VexqoraLogo size={24} />
          <span>Vexqora</span>
        </Link>

        {/* Primary Navigation */}
        <nav style={{ display: "flex", alignItems: "center", height: "64px" }}>
          <Link href="/dashboard/pulse" className={`nav-link ${isPulse ? "active" : ""}`}>
            Pulse
          </Link>
          <Link href="/dashboard/chat" className={`nav-link ${isSignals ? "active" : ""}`}>
            Signals
          </Link>
          <Link href="/dashboard/positions" className={`nav-link ${isPositions ? "active" : ""}`}>
            Positions
          </Link>
          <Link href="/dashboard/history" className={`nav-link ${isHistory ? "active" : ""}`}>
            History
          </Link>

          {/* Settings Dropdown */}
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

                <Link
                  href="/dashboard/profile"
                  onClick={() => setSettingsOpen(false)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: pathname === "/dashboard/profile" ? "#1A1A1A" : "transparent"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", font: "600 13px Inter", color: "#FFFFFF" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#42F5B9" strokeWidth="1.5">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    Profile
                  </div>
                  <div style={{ font: "400 12px Inter", color: "#9A9A9A" }}>
                    Preferences and security
                  </div>
                </Link>
              </div>
            )}
          </div>
        </nav>

        {/* Right Toolbar */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
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
            {isLive ? "Live" : (account?.exchange === "paper" ? "Paper · VEXQORA" : "Paper · DEMO")}
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
            {availableBalance === null
              ? "— USDT"
              : `${availableBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}
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
      </header>

      {/* Cmd/Ctrl+K Search Modal */}
      {searchOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "15vh",
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
                placeholder="Search Bybit linear pair (e.g. BTC, ETH, SOL)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  background: "#1A1A1A",
                  border: "1px solid #262626",
                  color: "#FFFFFF",
                  fontSize: "15px",
                  padding: "10px 14px",
                  borderRadius: "8px"
                }}
              />
              <button type="submit" className="bt pr">
                Open
              </button>
            </form>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <span className="lb">Popular:</span>
              {["BTCUSDT", "ETHUSDT", "SOLUSDT", "BTRUSDT", "PEPEUSDT", "SUIUSDT"].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    router.push(`/dashboard/signal/${p}`);
                  }}
                  className="tg gy"
                  style={{ cursor: "pointer", border: "1px solid #262626" }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation (Pulse, Signals, Positions, Settings) */}
      <nav
        style={{
          display: "none",
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "56px",
          background: "#000000",
          borderTop: "1px solid #262626",
          zIndex: 40,
          justifyContent: "space-around",
          alignItems: "center"
        }}
        className="mobile-tabbar"
      >
        <Link href="/dashboard/pulse" style={{ color: isPulse ? "#42F5B9" : "#9A9A9A", font: "600 12px Inter" }}>
          Pulse
        </Link>
        <Link href="/dashboard/chat" style={{ color: isSignals ? "#42F5B9" : "#9A9A9A", font: "600 12px Inter" }}>
          Signals
        </Link>
        <Link href="/dashboard/positions" style={{ color: isPositions ? "#42F5B9" : "#9A9A9A", font: "600 12px Inter" }}>
          Positions
        </Link>
        <Link href="/dashboard/accounts" style={{ color: isSettings ? "#42F5B9" : "#9A9A9A", font: "600 12px Inter" }}>
          Settings
        </Link>
      </nav>
    </>
  );
}
