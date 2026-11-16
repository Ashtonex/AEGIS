# Public website — video clips (Seedance 2.5)

The homepage has six video slots. Every slot already works with a still image;
a clip only makes it richer. Slots live in `src/lib/cinematic-clips.ts`.

| Slot | Where it shows | Length | Plays |
|---|---|---|---|
| `heroArrival` | Full-screen hero, top of homepage | 8–10 s | Autoplay loop |
| `buildScrub` | "The Build" section — scroll drives the playhead | 8–12 s | Scrubbed by scroll |
| `capCivil` | Capability panel 01 | 5–6 s | Autoplay loop |
| `capPlant` | Capability panel 02 | 5–6 s | Autoplay loop |
| `capStructural` | Capability panel 03 | 5–6 s | Autoplay loop |
| `capAdvisory` | Capability panel 04 | 5–6 s | Autoplay loop |

## Shared style (add to every prompt)

> Photoreal documentary cinematography, Southern African highveld, dry-season
> light, red-brown laterite soil, msasa trees on the horizon. Muted palette:
> deep navy shadows, warm amber highlights. Shot on a cinema camera, 35mm lens,
> shallow haze, subtle film grain. No text, no logos, no watermarks, no readable
> signage, no faces in close-up. Workers in hi-vis vests and hard hats, correct
> PPE. 16:9, 1080p or higher.

Keep the left third of the frame calm and darker in the hero and build clips:
the headline sits there.

## Prompts

### 1. `heroArrival` — hero loop
> Slow aerial drone push-in at blue hour over a large civil construction site:
> a half-built concrete bridge deck spanning a dry riverbed, two tower cranes
> silhouetted against a deep navy sky, the last amber light on the horizon,
> work lights just switching on, light dust drifting. Camera moves forward
> very slowly and steadily, no cuts. The last frame matches the first frame
> for a seamless loop.

If the loop seam shows, generate 10 s and cross-fade the last 1 s onto the
first in the edit (or ask Seedance for a "seamless loop" and pick the best take).

### 2. `buildScrub` — the build timelapse (most important)
> Locked-off wide shot, fixed camera, no camera movement at all. Construction
> timelapse of a three-storey commercial office building on a cleared site,
> from bare ground to completion in one continuous shot: surveyors and pegs,
> excavators doing bulk earthworks, rebar and formwork, concrete pours, the
> structural frame rising floor by floor, steel and glazing going on, then the
> finished building with landscaping and a car park at golden hour. The sun
> moves across the sky through the shot. Steady, even pace of progress.

Rules for this one:
- The camera must not move. Any drift makes scrubbing look broken.
- Progress should be even across the clip. The page shows four captions at
  0–25 %, 25–50 %, 50–75 % and 75–100 % of the scroll (earthworks, foundations,
  structure, handover), so roughly match those quarters.
- If one generation can't hold the whole build, generate four 3 s stages from
  the same start frame (use the last frame of each as the image prompt for
  the next) and join them.

### 3. `capCivil`
> Close tracking shot along a rebar grid at ground level as a concrete pump
> boom pours wet concrete, workers vibrating the pour, late afternoon side
> light raking across the steel. Slow lateral camera move. Seamless loop.

### 4. `capPlant`
> Low-angle shot of a yellow excavator loading an articulated dump truck at
> dusk on a red-earth haul road, dust catching the amber light, slow camera
> crane-up. No brand names visible. Seamless loop.

### 5. `capStructural`
> Looking up at structural steel being lifted into place by a tower crane,
> a worker guiding the beam with a tag line, welding sparks in the background,
> overcast bright sky. Slow push-in. Seamless loop.

### 6. `capAdvisory`
> Over-the-shoulder shot of an engineer's hands on a site table: unrolled
> drawings, a scale rule, a tablet showing a programme chart, a hard hat beside
> them, the live site soft-focused through a site-office window. Gentle rack
> focus from the drawings to the site. No readable text. Seamless loop.

## Encoding

Install ffmpeg, then from the folder with the raw clips. Keep each MP4 under
~4 MB (hero) and ~2 MB (capability loops): visitors are often on mobile data.

Looping clips (hero and capabilities). No audio, web-optimised:

```bash
ffmpeg -i hero-raw.mp4 -an -vf "scale=1920:-2,fps=24" -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart public/video/hero-01.mp4
```

```bash
ffmpeg -i hero-raw.mp4 -an -vf "scale=1920:-2,fps=24" -c:v libvpx-vp9 -crf 36 -b:v 0 public/video/hero-01.webm
```

Capability loops: same commands with `scale=1280:-2`.

Scroll-scrubbed build clip. **Every frame a keyframe** (`-g 1`), or scrubbing
stutters. It is larger, so keep it 1280 wide:

```bash
ffmpeg -i build-raw.mp4 -an -vf "scale=1280:-2,fps=24" -c:v libx264 -g 1 -crf 28 -preset slow -pix_fmt yuv420p -movflags +faststart public/video/build-scrub.mp4
```

## Turning a clip on

In `src/lib/cinematic-clips.ts`, set the slot's `src` (and `webm` if you made
one):

```ts
heroArrival: {
  src: "/video/hero-01.mp4",
  webm: "/video/hero-01.webm",
  poster: "/arrival-01.jpg",
},
```

Also export a still from the clip's first frame and use it as `poster`, so the
still and the video match when the clip fades in:

```bash
ffmpeg -i public/video/hero-01.mp4 -frames:v 1 -q:v 3 public/hero-01-poster.jpg
```

Visitors with reduced motion or Save-Data turned on always get the still.

## Hero v2 stills (Seedream image model)

The Figma frame "SNC — Hero v1 (concept)" needs two stills and one real photo.
Generate both stills in the same session, with the same seed if the tool shows
one, so the excavator matches between them.

### 1. Hero plate — 21:9 or 16:9, 2560 px wide or more

> Wide cinematic photograph at dusk, blue hour turning to night. A large
> yellow tracked hydraulic excavator stands left of centre in the foreground,
> facing three-quarters toward camera, boom raised high in an arch, bucket
> lowered near the ground, cab lights and work lights on, glowing warm. Behind
> it, slightly right, a newly finished modern two-storey house with flat
> concrete roofs, large floor-to-ceiling glass windows lit warm from inside,
> stone and timber cladding. Freshly graded red-brown earth and rubble in the
> foreground. Dramatic dark storm clouds, cool navy and slate sky. The upper
> third of the frame is open sky with nothing in it. The right third of the
> frame is calm and darker. Photoreal, shot on a cinema camera, 35mm lens,
> low angle, shallow haze, subtle film grain. No people, no text, no logos,
> no brand names on the machine, no watermarks.

### 2. Excavator cutout — same machine, plain background

> The same yellow tracked hydraulic excavator, same angle, same raised boom
> and lowered bucket, same work lights on, isolated on a plain flat mid-grey
> studio background, even soft light with warm rim light, full machine in
> frame with space around it, photoreal, no shadows on the background, no
> text, no logos.

The grey background is removed afterwards to make a transparent PNG. That PNG
sits above the giant "BUILD" word so the word reads as behind the machine.

### 3. Owner portrait — real photo, not generated

Waist-up, arms folded, SNC hard hat and hi-vis, facing camera, plain wall
behind, soft daylight from one side. A phone photo is enough; the background
is cut out afterwards.
