"use client";

import { useState } from "react";
import { PnlShareCardModal, type PnlShareData } from "./pnl-share-card-modal";

export function PnlShareButton({
  data,
  label = "Картка",
  className = "bt sm",
  title = "Отримати та зберегти картку результату угоди"
}: {
  data: PnlShareData;
  label?: string;
  className?: string;
  title?: string;
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
          gap: "4px"
        }}
      >
        <span>📸</span>
        <span>{label}</span>
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
