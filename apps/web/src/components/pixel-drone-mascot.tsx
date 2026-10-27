"use client";

import { useEffect, useState, useRef, useCallback } from "react";

export type DronePhase = "idle" | "entering" | "thinking" | "exiting" | "revealed";

export const DRONE_ANIMATIONS = {
  idle: "/animations/vexqora/vexqora-logo-static.svg",
  entering: "/animations/vexqora/vexqora-logo-to-drone.svg",
  thinking: "/animations/vexqora/vexqora-drone-thinking-loop.svg",
  exiting: "/animations/vexqora/vexqora-drone-to-logo.svg",
  staticDrone: "/animations/vexqora/vexqora-drone-static.svg"
} as const;

export const ENTER_MS = 2800;
export const EXIT_MS = 2200;

/**
 * Preloads all 5 SVG assets into browser cache to avoid flashing or blank frames.
 */
let isPreloaded = false;
export function preloadDroneAssets() {
  if (isPreloaded || typeof window === "undefined") return;
  isPreloaded = true;
  Object.values(DRONE_ANIMATIONS).forEach((src) => {
    const img = new Image();
    img.src = src;
  });
}

export interface PixelDroneMascotProps {
  phase: DronePhase;
  statusText?: string;
  width?: number;
  height?: number;
  requestId?: string;
  showStatusText?: boolean;
  className?: string;
}

/**
 * Pixel Drone Mascot Component
 * Displays the authentic Vexqora Pixel Drone SVG series across state machine phases:
 * idle -> entering (2800ms) -> thinking (infinite loop) -> exiting (2200ms) -> revealed
 */
export function PixelDroneMascot({
  phase,
  statusText,
  width = 118,
  height = 99,
  requestId = "mascot",
  showStatusText = true,
  className = ""
}: PixelDroneMascotProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    preloadDroneAssets();
    if (typeof window !== "undefined") {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mq.matches);
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, []);

  // Determine current SVG source based on phase & reduced motion
  let currentSrc: string;
  if (prefersReducedMotion) {
    currentSrc = phase === "idle" || phase === "revealed" ? DRONE_ANIMATIONS.idle : DRONE_ANIMATIONS.staticDrone;
  } else {
    switch (phase) {
      case "entering":
        currentSrc = DRONE_ANIMATIONS.entering;
        break;
      case "thinking":
        currentSrc = DRONE_ANIMATIONS.thinking;
        break;
      case "exiting":
        currentSrc = DRONE_ANIMATIONS.exiting;
        break;
      case "idle":
      case "revealed":
      default:
        currentSrc = DRONE_ANIMATIONS.idle;
        break;
    }
  }

  const defaultStatus =
    phase === "entering"
      ? "Формування дрона…"
      : phase === "thinking"
      ? "Аналіз ринку Bybit & Multi-Agent синтез…"
      : phase === "exiting"
      ? "Повернення у логотип…"
      : "Готово";

  const resolvedStatus = statusText ?? defaultStatus;

  return (
    <div
      className={`vexqora-drone-shell ${className}`}
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        userSelect: "none"
      }}
    >
      {/* Fixed aspect ratio container (500:420) so transitions never shift layout */}
      <div
        style={{
          width: `${width}px`,
          height: `${height}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          flexShrink: 0
        }}
      >
        {/* Re-mounting <img> on phase/requestId change ensures SMIL SVG starts from frame 0 */}
        <img
          key={`${requestId}-${phase}`}
          src={currentSrc}
          alt={resolvedStatus}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block"
          }}
        />
      </div>

      {showStatusText && phase !== "idle" && phase !== "revealed" && (
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "11px",
            color: "#A59CC4",
            letterSpacing: "0.02em",
            textAlign: "center"
          }}
        >
          {resolvedStatus}
        </span>
      )}
    </div>
  );
}

/**
 * Controller hook for the Pixel Drone state machine:
 * idle -> entering (2800ms) -> thinking (infinite loop) -> exiting (2200ms) -> revealed
 *
 * Buffers incoming network response and ensures full playback of enter and exit phases
 * before disclosing the answer to the user.
 */
export function usePixelDroneMachine() {
  const [phase, setPhase] = useState<DronePhase>("idle");
  const [activeRequestId, setActiveRequestId] = useState<string>("");
  const enterTimerRef = useRef<NodeJS.Timeout | null>(null);
  const exitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isResponseReadyRef = useRef<boolean>(false);
  const bufferedPayloadRef = useRef<unknown>(null);
  const onRevealCallbackRef = useRef<((payload: unknown) => void) | null>(null);

  // Clear all pending timers on unmount
  useEffect(() => {
    return () => {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  /**
   * Starts a new drone animation cycle on message submission.
   */
  const startCycle = useCallback((requestId: string, onReveal: (payload: unknown) => void) => {
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);

    preloadDroneAssets();

    const isReduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    setActiveRequestId(requestId);
    isResponseReadyRef.current = false;
    bufferedPayloadRef.current = null;
    onRevealCallbackRef.current = onReveal;

    if (isReduced) {
      setPhase("thinking");
      return;
    }

    setPhase("entering");

    // 2800 ms entering phase
    enterTimerRef.current = setTimeout(() => {
      if (isResponseReadyRef.current) {
        // Response already arrived during entering: transition directly to exiting
        startExitingPhase();
      } else {
        // Response not ready yet: transition to infinite thinking loop
        setPhase("thinking");
      }
    }, ENTER_MS);
  }, []);

  /**
   * Marks that the network response is ready.
   * If in thinking loop, transitions to exiting immediately.
   * If still in entering, allows entering to complete before transitioning.
   */
  const finishResponse = useCallback((payload: unknown) => {
    bufferedPayloadRef.current = payload;
    isResponseReadyRef.current = true;

    const isReduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (isReduced) {
      setPhase("idle");
      if (onRevealCallbackRef.current) {
        onRevealCallbackRef.current(payload);
      }
      return;
    }

    setPhase((currentPhase) => {
      if (currentPhase === "thinking") {
        // Start exit phase immediately
        startExitingPhase();
        return "exiting";
      }
      // If entering, enter timer will see isResponseReadyRef.current === true and trigger exiting
      return currentPhase;
    });
  }, []);

  const startExitingPhase = () => {
    setPhase("exiting");
    exitTimerRef.current = setTimeout(() => {
      setPhase("idle");
      if (onRevealCallbackRef.current) {
        onRevealCallbackRef.current(bufferedPayloadRef.current);
      }
    }, EXIT_MS);
  };

  /**
   * Aborts/cancels the current animation cycle and returns to idle.
   */
  const abortCycle = useCallback(() => {
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setPhase("idle");
    bufferedPayloadRef.current = null;
    isResponseReadyRef.current = false;
  }, []);

  return {
    phase,
    activeRequestId,
    isAnimating: phase !== "idle" && phase !== "revealed",
    startCycle,
    finishResponse,
    abortCycle
  };
}
