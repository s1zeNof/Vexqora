"use client";

import { useEffect, useState } from "react";
import {
  getSoundSettings,
  saveSoundSettings,
  playProfitSound,
  playLossSound,
  type SoundTheme
} from "../lib/sound-service";
import { dispatchTradeToast } from "./trade-toast";

export function SoundSettingsCard() {
  const [enabled, setEnabled] = useState(true);
  const [theme, setTheme] = useState<SoundTheme>("vexqora");
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    const s = getSoundSettings();
    setEnabled(s.enabled);
    setTheme(s.theme);
  }, []);

  const handleToggle = (val: boolean) => {
    setEnabled(val);
    saveSoundSettings({ enabled: val, theme });
    flashSaved();
  };

  const handleThemeChange = (newTheme: SoundTheme) => {
    setTheme(newTheme);
    saveSoundSettings({ enabled, theme: newTheme });
    playProfitSound(newTheme);
    flashSaved();
  };

  const flashSaved = () => {
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const testToast = () => {
    dispatchTradeToast({
      symbol: "BMTUSDT",
      type: "profit",
      title: "Take Profit 1",
      message: "Тестове сповіщення: закрито 40% позиції",
      pnlUsdt: 24.5,
      pnlPct: 12.8,
      exitPrice: 0.043107
    });
    if (enabled) {
      playProfitSound(theme);
    }
  };

  const testLossToast = () => {
    dispatchTradeToast({
      symbol: "BMTUSDT",
      type: "loss",
      title: "Stop Loss",
      message: "Тестове сповіщення: захисне закриття позиції",
      pnlUsdt: -19.39,
      pnlPct: -19.4,
      exitPrice: 0.04022
    });
    if (enabled) {
      playLossSound(theme);
    }
  };

  return (
    <div className="cd" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", color: "#FFFFFF", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>🔊</span>
            <span>Звукові та Pop-up сповіщення</span>
          </h3>
          <p className="lb" style={{ margin: "4px 0 0", fontSize: "12px" }}>
            Миттєві звукові сигнали та спливаючі картки при спрацюванні Take Profit, Stop Loss або Trailing Stop.
          </p>
        </div>

        {savedNotice && (
          <span style={{ fontSize: "12px", color: "#42F5B9", fontWeight: 600 }}>
            ✓ Збережено
          </span>
        )}
      </div>

      {/* Enable Toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          background: "#171229",
          borderRadius: "8px",
          border: "1px solid #2A2145"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <strong style={{ fontSize: "14px", color: "#FFFFFF" }}>Звук закриття ордерів</strong>
          <span className="lb" style={{ fontSize: "11px" }}>
            Синтезований звук через Web Audio API без затримки та без зовнішніх файлів
          </span>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleToggle(e.target.checked)}
            style={{ width: "18px", height: "18px", accentColor: "#42F5B9", cursor: "pointer" }}
          />
          <span style={{ fontSize: "13px", fontWeight: 600, color: enabled ? "#42F5B9" : "#A59CC4" }}>
            {enabled ? "Увімкнено" : "Вимкнено"}
          </span>
        </label>
      </div>

      {/* Theme Selection */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          background: "#171229",
          borderRadius: "8px",
          border: "1px solid #2A2145",
          flexWrap: "wrap",
          gap: "10px"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <strong style={{ fontSize: "14px", color: "#FFFFFF" }}>Тема звучання</strong>
          <span className="lb" style={{ fontSize: "11px" }}>
            Оберіть характер звучання акорду
          </span>
        </div>

        <select
          value={theme}
          onChange={(e) => handleThemeChange(e.target.value as SoundTheme)}
          disabled={!enabled}
          style={{
            background: "#0E0B1A",
            border: "1px solid #2A2145",
            borderRadius: "6px",
            color: "#FFFFFF",
            padding: "6px 12px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: enabled ? "pointer" : "not-allowed",
            opacity: enabled ? 1 : 0.5
          }}
        >
          <option value="vexqora">⚡ Vexqora Neon (Футуристичний синт-акорд)</option>
          <option value="chime">🔔 Exchange Chime (Кришталевий біржовий дзвін)</option>
          <option value="bell">🛎️ Classic Bell (Класичний резонансний дзвіночок)</option>
          <option value="ping">🎯 Subtle Ping (Мінімалістичний короткий пінг)</option>
        </select>
      </div>

      {/* Audio & Toast Preview Tests */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
        <button
          type="button"
          onClick={() => playProfitSound(theme)}
          className="bt sm"
          style={{ fontSize: "12px", color: "#42F5B9", border: "1px solid #42F5B944" }}
          title="Прослухати звук прибутку"
        >
          ▶ Тест звуку: Прибуток (+TP)
        </button>

        <button
          type="button"
          onClick={() => playLossSound(theme)}
          className="bt sm"
          style={{ fontSize: "12px", color: "#FF4F9A", border: "1px solid #FF4F9A44" }}
          title="Прослухати звук збитку"
        >
          ▶ Тест звуку: Збиток (-SL)
        </button>

        <button
          type="button"
          onClick={testToast}
          className="bt sm pr"
          style={{ fontSize: "12px" }}
          title="Показати тестовий спливаючий поп-ап прибутку"
        >
          🔔 Тест поп-апу (+TP)
        </button>

        <button
          type="button"
          onClick={testLossToast}
          className="bt sm dn"
          style={{ fontSize: "12px" }}
          title="Показати тестовий спливаючий поп-ап Stop Loss"
        >
          🛑 Тест поп-апу (-SL)
        </button>
      </div>
    </div>
  );
}
