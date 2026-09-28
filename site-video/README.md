# Site Video

Turn any website URL into a polished showcase video: the live site scrolling inside a laptop mockup, with the real mobile version on a phone next to it. Output is a 60fps MP4.

| Layout   | Size        | What it shows              | Use it for                        |
|----------|-------------|----------------------------|-----------------------------------|
| `wide`   | 1920×1080   | Laptop + phone side by side | LinkedIn, YouTube, X, portfolio   |
| `tall`   | 1080×1920   | Laptop on top, phone below | Reels, TikTok, Shorts, Stories    |
| `laptop` | 1920×1080   | Laptop only                | Clean single-device showcase      |

Each video is about 20 seconds: the devices rise into view, the site scrolls with pauses on sections, then the devices ease back and the site's domain fades in underneath.

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

Videos land in `output/` as `<site>_<layout>.mp4`. Each render takes about 3 minutes.

## Options

| Option        | Default                  | What it does |
|---------------|--------------------------|--------------|
| `--url`       | (required)               | Site to film. `https://` is optional. |
| `--layout`    | `wide`                   | `wide`, `tall` or `laptop`. |
| `--caption`   | the domain               | Text that fades in at the end. The part after the last dot is coloured, e.g. `example` + **`.com`**. |
| `--accent`    | `#1f5fff`                | Colour of that highlighted part. Match it to the client's brand. |
| `--pace`      | `1`                      | `1.3` = slower and calmer, `0.8` = snappier. |
| `--stops`     | spread evenly            | Exact scroll positions (desktop pixels) to pause on, e.g. `--stops 950,2350,3700`. The video always ends at the bottom of the page. |
| `--fps`       | `60`                     | Frame rate. |
| `--out`       | `output/<site>_<layout>.mp4` | Output file. |
| `--outdir`    | `output`                 | Output folder. |
| `--stills`    | —                        | Save JPG previews at these seconds instead of a video, e.g. `--stills 1,5,15`. Fast way to check framing. |

Example with brand colour and a slower pace:

```bash
./render-all.sh https://www.example.com --accent "#ff5a1f" --pace 1.2
```

### Preset used for ExpertLinc

```bash
./render-all.sh https://www.expertlinc.com --stops 950,2350,3700,6050,8000
```

## Good to know

- **Cookie banners** are dismissed automatically (it clicks "Reject"/"Necessary only" first, then "Accept"), and any leftover cookie popup is hidden.
- **The phone shows the real mobile site** (390px wide, like an iPhone), so responsive layouts get shown off properly.
- **Lazy-loaded images and scroll animations** are triggered before filming, so sections aren't blank.
- **Sites that block embedding** (they send `X-Frame-Options` / `frame-ancestors` headers) show a blank screen. Most marketing sites are fine; if one isn't, that site has to allow embedding or be filmed a different way.
- The site's own sticky headers, carousels and pop-ups appear exactly as they do live. Check a few `--stills` first if a site has a newsletter pop-up.

## Files

- `render.js`: loads the site, plans the scroll, renders frames and encodes the MP4.
- `mockup.html`: the scene (background, laptop, phone, caption and animation timing). Edit this to change the look.
- `render-all.sh`: renders all three layouts in one go.
