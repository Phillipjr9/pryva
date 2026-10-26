"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";

interface ConfettiProps {
  trigger: boolean;
  duration?: number;
  particleCount?: number;
  spread?: number;
  origin?: { x: number; y: number };
}

export function Confetti({ 
  trigger, 
  duration = 3000,
  particleCount = 100,
  spread = 70,
  origin = { x: 0.5, y: 0.5 }
}: ConfettiProps) {
  useEffect(() => {
    if (!trigger) return;

    const end = Date.now() + duration;

    const colors = ["#8266C9", "#B49CE7", "#D6C7F5", "#4caf50", "#ff9800"];

    (function frame() {
      confetti({
        particleCount: Math.floor(particleCount / 10),
        angle: 60,
        spread: spread,
        origin: { x: 0, y: origin.y },
        colors: colors,
      });
      confetti({
        particleCount: Math.floor(particleCount / 10),
        angle: 120,
        spread: spread,
        origin: { x: 1, y: origin.y },
        colors: colors,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    })();
  }, [trigger, duration, particleCount, spread, origin]);

  return null;
}

export function fireConfetti(options?: {
  particleCount?: number;
  spread?: number;
  origin?: { x: number; y: number };
}) {
  const { particleCount = 100, spread = 70, origin = { x: 0.5, y: 0.5 } } = options || {};
  
  confetti({
    particleCount,
    spread,
    origin,
    colors: ["#8266C9", "#B49CE7", "#D6C7F5", "#4caf50", "#ff9800"],
  });
}

export function fireCelebration() {
  const duration = 3000;
  const end = Date.now() + duration;

  (function frame() {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: ["#8266C9", "#B49CE7", "#D6C7F5"],
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ["#8266C9", "#B49CE7", "#D6C7F5"],
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();
}
