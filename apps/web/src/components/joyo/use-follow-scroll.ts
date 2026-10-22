import { useCallback, useEffect, useRef, useState } from "react";

import { distanceFromBottom, nextAway } from "@joyorogo/api/lib/joyo-ai/chat-state";

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Scrolling of the chat, which lives in the page (window) scroll with the composer pinned to the bottom. The rule: the page never
 * moves by itself unless the person is at the end of the chat (then growing text keeps them there), sends something, or presses
 * "Ke terbaru". Text that grows below the viewport of someone reading older messages moves nothing they see.
 *
 * `away` is true once the end is more than the shared threshold below the viewport (with the same hysteresis as the phone app).
 */
export function useFollowScroll() {
  const [away, setAway] = useState(false);
  const awayRef = useRef(false);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const root = document.documentElement;
      const distance = distanceFromBottom({ offsetY: window.scrollY, viewportH: window.innerHeight, contentH: root.scrollHeight });
      const next = nextAway(awayRef.current, distance);
      if (next !== awayRef.current) {
        awayRef.current = next;
        setAway(next);
      }
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    read();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  /** Shows the end of the chat. Instant by default (used while text streams in); `smooth` is for the button and respects reduced motion. */
  const toBottom = useCallback((smooth = false) => {
    const top = document.documentElement.scrollHeight;
    const animate = smooth && !reducedMotion();
    window.scrollTo({ top, behavior: animate ? "smooth" : "auto" });
    // A smooth scroll reports its own progress; an instant one has arrived.
    if (!animate) {
      awayRef.current = false;
      setAway(false);
    }
  }, []);

  return { away, awayRef, toBottom };
}
