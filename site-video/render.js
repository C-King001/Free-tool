#!/usr/bin/env node
// Render a website showcase video (laptop, or laptop + phone) as an MP4.
//
//   node render.js --url https://www.example.com
//   node render.js --url https://www.example.com --layout tall --caption example.com
//
// See README.md for every option.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------- options ----------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2), v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; }
}
if (!args.url) { console.error('Missing --url. Example: node render.js --url https://www.example.com'); process.exit(1); }
const URL_ = /^https?:\/\//.test(args.url) ? args.url : 'https://' + args.url;
const host = new URL(URL_).hostname.replace(/^www\./, '');
const LAYOUT = args.layout || 'wide';                       // wide | tall | laptop
if (!['wide', 'tall', 'laptop'].includes(LAYOUT)) { console.error('--layout must be wide, tall or laptop'); process.exit(1); }
const [VW, VH] = LAYOUT === 'tall' ? [1080, 1920] : [1920, 1080];
const FPS = +(args.fps || 60);
const CAPTION = args.caption || host;
const ACCENT = args.accent || '#1f5fff';
const OUTDIR = args.outdir || 'output';
const OUT = args.out || path.join(OUTDIR, `${host.split('.')[0]}_${LAYOUT}.mp4`);
const STILLS = args.stills;                                 // "0.5,3,9" -> JPG stills instead of a video
const PACE = +(args.pace || 1);                             // >1 slower, <1 faster
const HOLD = +(args.hold || 1.0);                           // seconds paused on each section
const DRIFT = +(args.drift ?? 30);                          // px of slow drift while paused (feels like reading)

// ---------- ffmpeg ----------
function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { return require('ffmpeg-static'); } catch (e) {}
  try { return execSync('python3 -c "import imageio_ffmpeg as i;print(i.get_ffmpeg_exe())"', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {}
  return 'ffmpeg';
}

// Cloud sandboxes re-sign HTTPS with their own CA. Trust that CA's key only (TLS is still verified).
function browserArgs() {
  const ca = '/root/.ccr/agent-proxy-ca.crt';
  if (!fs.existsSync(ca)) return [];
  const spki = execSync(`openssl x509 -in ${ca} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`).toString().trim();
  return ['--ignore-certificate-errors-spki-list=' + spki];
}

const E = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

(async () => {
  const b = await chromium.launch({ channel: 'chromium', args: browserArgs() });
  const p = await b.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  const q = new URLSearchParams({ layout: LAYOUT, url: URL_, caption: CAPTION, accent: ACCENT });
  await p.goto('file://' + path.join(__dirname, 'mockup.html') + '?' + q, { waitUntil: 'load', timeout: 90000 });

  // Load the site, dismiss cookie banners, and pre-scroll so lazy images and reveal animations are loaded.
  const prep = async f => {
    await f.waitForLoadState('load'); await f.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(1500);
    await f.evaluate(() => {
      const btns = [...document.querySelectorAll('button,a,[role=button]')];
      for (const re of [/necessary only|reject all|reject|decline|only essential/i, /accept all|accept|agree|got it|allow all|ok$/i]) {
        const hit = btns.find(x => re.test((x.textContent || '').trim()) && x.offsetParent !== null && (x.textContent || '').length < 40);
        if (hit) { hit.click(); return; }
      }
    });
    await p.waitForTimeout(800);
    await f.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      for (const el of document.querySelectorAll('body *')) {
        const pos = getComputedStyle(el).position;
        if ((pos === 'fixed' || pos === 'sticky') && /cookie|consent|gdpr/i.test(el.textContent || '') && el.children.length < 12 && el.offsetHeight < innerHeight * .6) el.remove();
      }
    });
    const H = await f.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (let y = 0; y <= H; y += 300) { await f.evaluate(y => scrollTo(0, y), y); await p.waitForTimeout(150); }
    await f.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(800);
    return Math.max(0, H);
  };
  const f = p.frame({ name: 'site' }), m = LAYOUT === 'laptop' ? null : p.frame({ name: 'msite' });
  const H = await prep(f), MH = m ? await prep(m) : 0;

  // Sync the phone to the laptop section by section (falls back to proportional if the pages differ).
  const sectionTops = fr => fr.evaluate(() => [...document.querySelectorAll('body section, body footer')]
    .filter(e => !e.parentElement.closest('section, footer') && e.offsetHeight > 50)
    .map(e => Math.round(e.getBoundingClientRect().top + scrollY)));
  let mapY = y => H ? y / H * MH : 0;
  if (m) {
    const [ds, ms] = await Promise.all([sectionTops(f), sectionTops(m)]);
    if (ds.length > 1 && ds.length === ms.length) {
      const A = [0, ...ds.map(v => Math.min(v, H)), H], B = [0, ...ms.map(v => Math.min(v, MH)), MH];
      mapY = y => { for (let i = 1; i < A.length; i++) if (y <= A[i]) return A[i] === A[i - 1] ? B[i] : B[i - 1] + (B[i] - B[i - 1]) * (y - A[i - 1]) / (A[i] - A[i - 1]); return MH; };
      console.log(`phone synced to laptop across ${ds.length} sections`);
    }
  }

  // Scroll plan: [targetY, moveSeconds, holdSeconds].
  // --stops "950,2350,3700" gives exact desktop pixel stops; otherwise stops are spread evenly down the page.
  let targets;
  if (args.stops) targets = String(args.stops).split(',').map(Number).filter(n => !isNaN(n)).concat([H]);
  else { const n = Math.min(8, Math.max(3, Math.round(H / 1700))); targets = Array.from({ length: n }, (_, i) => Math.round(H * (i + 1) / n)); }
  const start = 2.6 * PACE, seg = []; let t = start, y = 0;
  targets.forEach((ty, i) => {
    ty = Math.min(ty, H); const dist = Math.abs(ty - y), last = i === targets.length - 1;
    const move = Math.min(2.2, Math.max(1.1, 0.9 + dist / 2600)) * PACE, hold = (last ? .3 : HOLD) * PACE;
    seg.push({ t0: t, t1: t + move, y0: y, y1: ty, ease: true }); t += move; y = ty;
    const d = last ? 0 : Math.min(DRIFT, Math.max(0, H - ty));        // gentle drift while paused
    seg.push({ t0: t, t1: t + hold, y0: y, y1: y + d, ease: false }); t += hold; y += d;
  });
  const T = t + 2.6;
  console.log(`${host} | layout ${LAYOUT} | page height ${H}px | ${T.toFixed(1)}s`);
  const scrollAt = tt => { let v = 0; for (const s of seg) { if (tt >= s.t1) v = s.y1; else if (tt > s.t0) { { const k = (tt - s.t0) / (s.t1 - s.t0); v = s.y0 + (s.y1 - s.y0) * (s.ease ? E(k) : k); } break; } else break; } return v; };

  const shoot = async tt => {
    await p.evaluate(([a, b]) => setT(a, b), [tt, T]);
    const sy = scrollAt(tt);
    await f.evaluate(y => scrollTo(0, y), Math.round(sy));
    if (m) await m.evaluate(y => scrollTo(0, y), Math.round(mapY(sy)));
    // Each site iframe paints in its own process: wait for both to draw the new scroll position.
    const painted = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all([f.evaluate(painted), m ? m.evaluate(painted) : null, p.evaluate(painted)]);
    return p.screenshot({ type: 'jpeg', quality: 95 });
  };

  fs.mkdirSync(path.dirname(OUT) || '.', { recursive: true });
  if (STILLS) {
    for (const s of String(STILLS).split(',')) { const fp = OUT.replace(/\.mp4$/, `_${s}s.jpg`); fs.writeFileSync(fp, await shoot(+s)); console.log('wrote', fp); }
    await b.close(); return;
  }
  const ff = spawn(findFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = Math.round(T * FPS);
  for (let i = 0; i < N; i++) {
    const buf = await shoot(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % (FPS * 2) === 0) process.stdout.write(`\r  frame ${i}/${N}`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();
  console.log(`\r  done -> ${OUT}            `);
})().catch(e => { console.error(e); process.exit(1); });
