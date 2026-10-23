"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SettingsNav() {
  const pathname = usePathname();

  const links = [
    { href: "/dashboard/accounts", label: "Accounts", desc: "Workspaces & Bybit API" },
    { href: "/dashboard/risk", label: "Risk limits", desc: "Sizing, caps & kill switch" },
    { href: "/dashboard/integrations", label: "Integrations", desc: "Telegram & Discord" }
  ];

  return (
    <aside className="settings-nav-aside">
      {links.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            style={{
              padding: "10px 14px",
              borderRadius: "8px",
              background: isActive ? "#1A1A1A" : "transparent",
              color: isActive ? "#FFFFFF" : "#9A9A9A",
              border: "1px solid",
              borderColor: isActive ? "#262626" : "transparent",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              whiteSpace: "nowrap"
            }}
          >
            <div style={{ font: "600 14px Inter, sans-serif", color: isActive ? "#FFFFFF" : "#9A9A9A" }}>
              {link.label}
            </div>
            <div style={{ font: "400 12px Inter, sans-serif", color: "#666666" }}>
              {link.desc}
            </div>
          </Link>
        );
      })}
    </aside>
  );
}
