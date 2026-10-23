"use client";

import { useState } from "react";
import { PnlShareCardModal, type PnlShareData } from "./pnl-share-card-modal";

export function PnlShareButton({
  data,
  label = "Закритий PnL (USDT)",
  className = "bt sm",
  title = "Отримати та зберегти картку результату угоди"
}: {
  data: PnlShareData;
  label?: string | undefined;
  className?: string | undefined;
  title?: string | undefined;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={className}
        title={title}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px"
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0, transition: "transform 0.2s ease" }}
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M3 9h18" />
          <path d="M9 21V9" />
          <path d="m14 13 2 2 4-4" />
        </svg>
        {label ? <span>{label}</span> : null}
      </button>

      {isOpen && (
        <PnlShareCardModal
          data={data}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
