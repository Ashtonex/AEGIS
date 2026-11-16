"use client";

/**
 * BuildSequence — scroll-scrubbed construction timelapse
 * ─────────────────────────────────────────────────────────────────────────────
 * Objective: the visitor's scroll *builds the project*. One continuous clip
 * (bare ground → finished building) is pinned full-screen and its playhead is
 * driven by scroll position. Four programme stages caption the build.
 *
 * Without a clip (CLIPS.buildScrub.src === null), reduced motion, or Save-Data,
 * the same pinned frame crossfades between four stage stills instead, so the
 * section reads the same either way.
 *
 * Clip requirement: encode ALL-KEYFRAME (ffmpeg -g 1) — browsers can only seek
 * to keyframes quickly; a normal GOP makes scrubbing stutter.
 */

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { CLIPS } from "@/lib/cinematic-clips";
import { DXL_EASE } from "@/lib/motion";
import { useSaveData } from "@/components/cinematic/useSaveData";

const STAGES = [
  {
    ref: "STAGE 01",
    title: "Survey & Earthworks",
    body: "Setting out, bulk excavation and compaction. The programme is won or lost in the ground.",
    still: "/proj-earthworks.jpg",
  },
  {
    ref: "STAGE 02",
    title: "Foundations & Civil",
    body: "Rebar, formwork and pours, inspected and signed off before anything rises above slab.",
    still: "/cap-civil.jpg",
  },
  {
    ref: "STAGE 03",
    title: "Structure",
    body: "Frame, steel and envelope delivered as one package, with one point of accountability.",
    still: "/cap-structural.jpg",
  },
  {
    ref: "STAGE 04",
    title: "Handover",
    body: "Snagged, documented and handed over on the date in the contract.",
    still: "/snc_commercial_office.png",
  },
] as const;

export function BuildSequence() {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const saveData = useSaveData();
  const { src, webm, poster } = CLIPS.buildScrub;
  // Client-only: if the <video> were in the server HTML it would start loading
  // before hydration (so `loadeddata` fires with no handler attached), and it
  // would download for reduced-motion / Save-Data visitors too.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const useVideo = mounted && Boolean(src) && !shouldReduceMotion && !saveData;

  const [videoReady, setVideoReady] = useState(false);
  const [stage, setStage] = useState(0);

  // Catch a clip that finished loading before the handler was attached
  useEffect(() => {
    if (useVideo && videoRef.current && videoRef.current.readyState >= 2) {
      setVideoReady(true);
    }
  }, [useVideo]);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  // Smooth the playhead so wheel ticks don't jump frames
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    mass: 0.4,
  });
  const barScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const next = Math.min(STAGES.length - 1, Math.floor(p * STAGES.length));
    setStage((prev) => (prev === next ? prev : next));
  });

  // Drive the clip's playhead from scroll, at most once per animation frame.
  useEffect(() => {
    if (!useVideo || !videoReady) return;
    let frame = 0;
    const unsubscribe = smoothProgress.on("change", (p) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const video = videoRef.current;
        if (!video || !Number.isFinite(video.duration)) return;
        const target = Math.max(0, Math.min(1, p)) * (video.duration - 0.05);
        if (Math.abs(video.currentTime - target) > 0.01) video.currentTime = target;
      });
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [useVideo, videoReady, smoothProgress]);

  const showVideo = useVideo && videoReady;

  return (
    <section
      ref={sectionRef}
      id="build"
      aria-label="How SNC delivers a project, from earthworks to handover"
      className="relative bg-void"
      style={{ height: `${STAGES.length * 100 + 60}vh` }}
    >
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        {/* ── Visual layer ─────────────────────────────────────────────────── */}
        <div className="absolute inset-0" aria-hidden="true">
          {/* Stage stills — always present, hidden once the scrub clip is ready */}
          {STAGES.map((s, i) => (
            <motion.div
              key={s.still}
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${s.still})` }}
              initial={false}
              animate={{
                opacity: showVideo ? 0 : i === stage ? 1 : 0,
                scale: shouldReduceMotion || i !== stage ? 1 : 1.04,
              }}
              transition={{
                opacity: { duration: shouldReduceMotion ? 0 : 0.9, ease: DXL_EASE },
                scale: { duration: 6, ease: DXL_EASE },
              }}
            />
          ))}

          {useVideo && (
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                opacity: showVideo ? 1 : 0,
                transition: "opacity 900ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
              poster={poster}
              muted
              playsInline
              preload="auto"
              disablePictureInPicture
              onLoadedData={() => setVideoReady(true)}
              onError={() => setVideoReady(false)}
            >
              {webm && <source src={webm} type="video/webm" />}
              {src && <source src={src} type="video/mp4" />}
            </video>
          )}

          {/* Legibility scrims — explicit rgba: alpha modifiers on the
              var()-based ink token render transparent */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, rgba(10,22,40,0.92) 0%, rgba(10,22,40,0.75) 40%, rgba(10,22,40,0.2) 75%, rgba(10,22,40,0) 100%)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgba(10,22,40,0.8) 0%, rgba(10,22,40,0) 50%, rgba(10,22,40,0.4) 100%)",
            }}
          />
          {/* Right-edge scrim behind the stage rail (desktop only) */}
          <div
            className="absolute inset-0 hidden md:block"
            style={{
              background:
                "linear-gradient(to left, rgba(10,22,40,0.85) 0%, rgba(10,22,40,0.5) 18%, rgba(10,22,40,0) 34%)",
            }}
          />
        </div>

        {/* ── Caption layer ────────────────────────────────────────────────── */}
        <div className="relative z-10 flex h-full items-end md:items-center">
          <div className="mx-auto w-full max-w-[1440px] px-6 pb-24 md:px-10 md:pb-0 lg:px-16 xl:px-20">
            <span className="dxl-eyebrow mb-6 block">The Build — Ground to Handover</span>

            <div className="relative min-h-[260px] max-w-[620px] md:min-h-[300px]">
              {STAGES.map((s, i) => (
                <motion.div
                  key={s.ref}
                  className="absolute inset-x-0 top-0"
                  initial={false}
                  animate={{
                    opacity: i === stage ? 1 : 0,
                    y: shouldReduceMotion ? 0 : i === stage ? 0 : i < stage ? -24 : 24,
                  }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.55, ease: DXL_EASE }}
                  aria-hidden={i !== stage}
                >
                  <span className="mb-4 block font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
                    {s.ref}
                  </span>
                  <h2 className="mb-5 text-[clamp(36px,6vw,80px)] font-black leading-[0.95] tracking-[-0.025em] text-paper">
                    {s.title}
                  </h2>
                  <p className="max-w-[480px] text-[17px] font-light leading-[1.6] text-[rgba(245,245,240,0.85)]">
                    {s.body}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Programme rail — stage list (desktop) / progress bar (mobile) ── */}
        <div
          className="absolute bottom-8 right-6 z-10 flex items-center gap-4 md:hidden"
          aria-hidden="true"
        >
          <div className="relative h-[2px] w-40 bg-[color-mix(in_srgb,var(--dxl-paper)_15%,transparent)]">
            <motion.div className="absolute inset-0 origin-left bg-signal" style={{ scaleX: barScale }} />
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[color-mix(in_srgb,var(--dxl-paper)_72%,transparent)]">
            {String(stage + 1).padStart(2, "0")} / {String(STAGES.length).padStart(2, "0")}
          </span>
        </div>

        <ol
          className="absolute right-10 top-1/2 z-10 hidden -translate-y-1/2 md:block lg:right-16 xl:right-20"
          aria-hidden="true"
        >
          {/* Track behind the ticks, filled by scroll */}
          <div className="absolute bottom-3 right-[3px] top-3 w-px bg-[color-mix(in_srgb,var(--dxl-paper)_15%,transparent)]">
            <motion.div className="absolute inset-0 origin-top bg-signal" style={{ scaleY: barScale }} />
          </div>
          {STAGES.map((s, i) => {
            const state = i === stage ? "active" : i < stage ? "done" : "next";
            return (
              <li key={s.ref} className="relative flex items-center justify-end gap-4 py-4 pr-6">
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.15em] transition-colors duration-500 ${
                    state === "active"
                      ? "text-signal"
                      : "text-[color-mix(in_srgb,var(--dxl-paper)_45%,transparent)]"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={`text-[13px] font-semibold tracking-[0.02em] transition-all duration-500 ${
                    state === "active"
                      ? "text-paper opacity-100"
                      : state === "done"
                        ? "text-paper opacity-60"
                        : "text-paper opacity-35"
                  }`}
                >
                  {s.title}
                </span>
                <span
                  className={`absolute right-0 h-[7px] w-[7px] rotate-45 border transition-colors duration-500 ${
                    state === "next"
                      ? "border-[color-mix(in_srgb,var(--dxl-paper)_40%,transparent)] bg-void"
                      : "border-signal bg-signal"
                  }`}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
