"use client";

/**
 * AmbientVideo — muted, looping background clip with a still-image floor
 * ─────────────────────────────────────────────────────────────────────────────
 * - Renders nothing but the poster while the clip's `src` is null.
 * - Loads only when the slot nears the viewport; pauses when it leaves.
 * - Fades the clip in once it is actually playing, so a slow or failed load
 *   never shows a black box — the poster simply stays.
 * - Skips video entirely under prefers-reduced-motion or Save-Data.
 */

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { CLIPS, type ClipId } from "@/lib/cinematic-clips";
import { useSaveData } from "./useSaveData";

interface AmbientVideoProps {
  clip: ClipId;
  /** Render the poster image too. Off when the parent already draws a still. */
  showPoster?: boolean;
  /** CSS object-position for both poster and video */
  position?: string;
  className?: string;
  /** Called with true once the clip is visibly playing */
  onPlayingChange?: (playing: boolean) => void;
}

export function AmbientVideo({
  clip,
  showPoster = true,
  position = "center",
  className = "",
  onPlayingChange,
}: AmbientVideoProps) {
  const { src, webm, poster } = CLIPS[clip];
  const shouldReduceMotion = useReducedMotion();
  const saveData = useSaveData();
  const enabled = Boolean(src) && !shouldReduceMotion && !saveData;

  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [playing, setPlaying] = useState(false);

  const [onScreen, setOnScreen] = useState(false);

  // Two observers: mount (and start buffering) the <video> once the slot is
  // within ~1 screen, but only *play* it while it is actually on screen, so
  // stacked slots (the four capability panels) never all decode at once.
  useEffect(() => {
    if (!enabled || !wrapRef.current) return;
    const el = wrapRef.current;
    const near = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNearViewport(true);
      },
      { rootMargin: "100% 0px" },
    );
    const visible = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    near.observe(el);
    visible.observe(el);
    return () => {
      near.disconnect();
      visible.disconnect();
    };
  }, [enabled]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (onScreen) {
      video.play().catch(() => {
        /* autoplay refused — poster stays */
      });
    } else {
      video.pause();
    }
  }, [onScreen, nearViewport]);

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  return (
    <div ref={wrapRef} className={`absolute inset-0 ${className}`} aria-hidden="true">
      {showPoster && (
        <div
          className="absolute inset-0 bg-cover"
          style={{ backgroundImage: `url(${poster})`, backgroundPosition: position }}
        />
      )}
      {enabled && nearViewport && (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            opacity: playing ? 1 : 0,
            objectPosition: position,
            transition: "opacity 1200ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          poster={poster}
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          onPlaying={() => setPlaying(true)}
          onError={() => setPlaying(false)}
        >
          {webm && <source src={webm} type="video/webm" />}
          {src && <source src={src} type="video/mp4" />}
        </video>
      )}
    </div>
  );
}
