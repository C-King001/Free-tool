# Site Video

Turn any website URL into a polished showcase video: the live site scrolling inside a laptop mockup, with the real mobile version on a phone next to it. Output is a 60fps MP4.

| Layout   | Size        | What it shows              | Use it for                        |
|----------|-------------|----------------------------|-----------------------------------|
| `wide`   | 1920×1080   | Laptop + phone side by side | LinkedIn, YouTube, X, portfolio   |
| `tall`   | 1080×1920   | Laptop on top, phone below | Reels, TikTok, Shorts, Stories    |
| `laptop` | 1920×1080   | Laptop only                | Clean single-device showcase      |

Each video is about 20 seconds by default (longer with `--pace`, `--hold` or more `--stops`): the devices rise into view, the site scrolls with pauses on sections, then the devices ease back and the site's domain fades in underneath.

## Setup (once)

Needs [Node.js](https://nodejs.org) 18+.

```bash
cd site-video
npm install
npx playwright install chromium
```

`npm install` also downloads ffmpeg, so nothing else is needed.

## Make videos

All three formats for a site:

```bash
./render-all.sh https://www.example.com
```

One format:

```bash
node render.js --url https://www.example.com --layout tall
```

Videos land in `output/` as `<site>_<layout>.mp4` (a page path is added to the name, e.g. `expertlinc-experience_tall.mp4`). Plan on roughly 30 to 40 seconds of rendering per second of video when all three formats render together. They share one filming pass, so it's faster than rendering each separately.

## Options

| Option        | Default                  | What it does |
|---------------|--------------------------|--------------|
| `--url`       | (required)               | Site to film. `https://` is optional. |
| `--layout`    | `wide`                   | `wide`, `tall`, `laptop`, or several at once: `wide,tall,laptop`. |
| `--caption`   | the domain               | Text that fades in at the end. The part after the last dot is coloured, e.g. `example` + **`.com`**. |
| `--accent`    | `#1f5fff`                | Colour of that highlighted part. Match it to the client's brand. |
| `--pace`      | `1`                      | `1.3` = slower and calmer, `0.8` = snappier. |
| `--hold`      | `1.0`                    | Seconds it pauses on each section. Raise it (e.g. `1.4`) so viewers can read more. |
| `--drift`     | `30`                     | Pixels it keeps drifting while paused, so the screen never freezes. `0` for a dead stop. |
| `--stops`     | spread evenly            | Exact scroll positions (desktop pixels) to pause on, e.g. `--stops 950,2350,3700`. Add `:seconds` to give one stop its own pause, e.g. `1150:2.8`. The video always ends at the bottom of the page. |
| `--sweep`     | —                        | Stops where a cursor glides across the middle of the laptop screen, to show off hover effects, e.g. `--sweep 1150`. Give that stop a longer pause (`1150:2.8`). |
| `--fps`       | `60`                     | Frame rate. |
| `--out`       | `output/<site>_<layout>.mp4` | Output file. |
| `--outdir`    | `output`                 | Output folder. |
| `--stills`    | —                        | Save JPG previews at these seconds instead of a video, e.g. `--stills 1,5,15`. Fast way to check framing. |

Example with brand colour and a slower pace:

```bash
./render-all.sh https://www.example.com --accent "#ff5a1f" --pace 1.2
```

### Preset used for ExpertLinc

Unhurried version (~35s), pausing on every section:

```bash
./render-all.sh https://www.expertlinc.com --stops 1000,1420,2330,3050,4150,5950,7250,8050,9100,9800 --pace 1.15 --hold 1.1
```

ExpertLinc `/experience` page (~44s). It pauses on the brochure at 900, then scrolls slowly so the phone's "scroll and the room opens" lens plays out. At 1150 a cursor sweeps the laptop's brochure to show the desktop hover lens. The stops from 4790 to 7800 step through the sticky "Five questions" panel, 01 to 05:

```bash
./render-all.sh https://www.expertlinc.com/experience --caption expertlinc.com --stops 900,1000:0.8,1150:2.8,2240,2620,3620,4790,5800,6800,7800,8940,9600,10560 --sweep 1150 --pace 1.15 --hold 1.1
```

Tip: the best `--stops` are the top of each section, minus a little room for the site's header.

## Good to know

- **Cookie banners** are dismissed automatically (it clicks "Reject"/"Necessary only" first, then "Accept"), and any leftover cookie popup is hidden.
- **Two real browsers film the site.** The laptop is a desktop browser (1440×900). The phone is an emulated iPhone with touch, a mobile browser identity and a retina screen, so touch-only effects (scroll-driven reveals, swipe layouts) play exactly as on a real phone.
- **Effects play on camera.** The page is reloaded after the image-warming pass, so scroll-reveal animations fire during filming rather than before it. CSS animations are slowed to match the capture speed so fades and transitions keep their real timing in the video.
- **Hover-only effects** need a cursor. Use `--sweep` on the stop where they live.
- **The phone stays in sync with the laptop**: both screens show the same section at the same time, even when the mobile page is longer.
- **Lazy-loaded images** are warmed up before filming, so sections aren't blank.
- **Sites that block embedding still work**, because pages are filmed directly rather than embedded.
- The site's own sticky headers, carousels and pop-ups appear exactly as they do live. Check a few `--stills` first if a site has a newsletter pop-up.

## Files

- `render.js`: films the site in desktop and iPhone browsers, plans the scroll, composes frames into each layout and encodes the MP4s.
- `mockup.html`: the scene (background, laptop, phone, cursor, caption and animation timing). Edit this to change the look.
- `render-all.sh`: renders all three layouts in one filming pass.
