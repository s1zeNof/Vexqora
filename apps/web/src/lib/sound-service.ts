"use client";

export type SoundTheme = "vexqora" | "chime" | "bell" | "ping";

interface SoundSettings {
  enabled: boolean;
  theme: SoundTheme;
}

const STORAGE_KEY = "vexqora_sound_settings";

export function getSoundSettings(): SoundSettings {
  if (typeof window === "undefined") {
    return { enabled: true, theme: "vexqora" };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: true, theme: "vexqora" };
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      enabled: parsed.enabled !== false,
      theme: (["vexqora", "chime", "bell", "ping"].includes(parsed.theme as string)
        ? parsed.theme
        : "vexqora") as SoundTheme
    };
  } catch {
    return { enabled: true, theme: "vexqora" };
  }
}

export function saveSoundSettings(settings: SoundSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Synthesize a profit chime using Web Audio API (zero external asset dependencies).
 */
export function playProfitSound(theme: SoundTheme = "vexqora"): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  if (theme === "ping") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.12);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
    return;
  }

  if (theme === "bell") {
    // Dual frequency resonant bell
    [784, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.05);

      gain.gain.setValueAtTime(0.18, now + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 0.6);
    });
    return;
  }

  if (theme === "chime") {
    // 3-note ascending crystalline chime
    const notes = [587.33, 739.99, 880.0]; // D5, F#5, A5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + idx * 0.08;

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
    return;
  }

  // Default: "vexqora" — signature neon synth arpeggio (C5 -> E5 -> G5 -> C6)
  const neonNotes = [523.25, 659.25, 783.99, 1046.5];
  neonNotes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = now + idx * 0.07;

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

/**
 * Synthesize a protective loss / stop loss sound.
 */
export function playLossSound(theme: SoundTheme = "vexqora"): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  if (theme === "ping") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.2);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
    return;
  }

  // Soft warning two-tone descending tone (392Hz -> 261.6Hz)
  const notes = [392.0, 261.63];
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = now + idx * 0.12;

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, t);

    // Warm filter to make sawtooth mellow
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(600, t);

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

/**
 * Main player that checks user settings and plays the corresponding sound.
 */
export function playTradeNotification(pnlUsdt: number): void {
  const settings = getSoundSettings();
  if (!settings.enabled) return;

  if (pnlUsdt >= 0) {
    playProfitSound(settings.theme);
  } else {
    playLossSound(settings.theme);
  }
}
