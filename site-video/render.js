#!/usr/bin/env node
// Render a website showcase video (laptop, or laptop + phone) as an MP4.
//
//   node render.js --url https://www.example.com
//   node render.js --url https://www.example.com --layout tall --caption example.com
//
// See README.md for every option.
const { chromium, devices } = require('playwright');
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
const LAYOUTS = String(args.layout || 'wide').split(',');   // wide | tall | laptop (comma list renders several from one filming pass)
for (const L of LAYOUTS) if (!['wide', 'tall', 'laptop'].includes(L)) { console.error('--layout must be wide, tall, laptop or a comma list of them'); process.exit(1); }
const SIZE = L => L === 'tall' ? [1080, 1920] : [1920, 1080];
const FPS = +(args.fps || 60);
const CAPTION = args.caption || host;
const ACCENT = args.accent || '#1f5fff';
const OUTDIR = args.outdir || 'output';
const SLUG = (host.split('.')[0] + new URL(URL_).pathname.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-')).toLowerCase();
const OUT = L => args.out && LAYOUTS.length === 1 ? args.out : path.join(OUTDIR, `${SLUG}_${L}.mp4`);
const STILLS = args.stills;                                 // "0.5,3,9" -> JPG stills instead of a video
const PACE = +(args.pace || 1);                             // >1 slower, <1 faster
const HOLD = +(args.hold || 1.0);                           // seconds paused on each section
const DRIFT = +(args.drift ?? 30);                          // px of slow drift while paused (feels like reading)
const SWEEPS = args.sweep ? String(args.sweep).split(',').map(Number) : []; // stops where a cursor sweeps across (hover effects)

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

  // The site is filmed in two real browsers: a desktop one, and an emulated iPhone (touch, mobile UA, retina),
  // so touch-only effects (e.g. "scroll and the image changes") play on the phone exactly as they do on a real phone.
  const desk = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const iphone = devices['iPhone 13'];
  const mob = LAYOUTS.every(L => L === 'laptop') ? null : await (await b.newContext({
    userAgent: iphone.userAgent, viewport: { width: 390, height: 794 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  })).newPage();

  // Load, dismiss cookies, pre-scroll once to warm the image cache, then reload so scroll-reveal
  // animations are fresh and play on camera instead of having already fired.
  const dismissCookies = pg => pg.evaluate(() => {
    const btns = [...document.querySelectorAll('button,a,[role=button]')];
    for (const re of [/necessary only|reject all|reject|decline|only essential/i, /accept all|accept|agree|got it|allow all|ok$/i]) {
      const hit = btns.find(x => re.test((x.textContent || '').trim()) && x.offsetParent !== null && (x.textContent || '').length < 40);
      if (hit) { hit.click(); return; }
    }
  });
  const hideLeftovers = pg => pg.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position;
      if ((pos === 'fixed' || pos === 'sticky') && /cookie|consent|gdpr/i.test(el.textContent || '') && el.children.length < 12 && el.offsetHeight < innerHeight * .6) el.remove();
    }
  });
  const settle = async pg => { await pg.waitForLoadState('networkidle').catch(() => {}); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(1500); };
  const prep = async pg => {
    await pg.goto(URL_, { waitUntil: 'load', timeout: 90000 }); await settle(pg);
    await dismissCookies(pg); await pg.waitForTimeout(800);
    const H0 = await pg.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (let y = 0; y <= H0; y += 300) { await pg.evaluate(y => scrollTo(0, y), y); await pg.waitForTimeout(120); }
    await pg.reload({ waitUntil: 'load' }); await settle(pg);
    await dismissCookies(pg); await pg.waitForTimeout(500); await hideLeftovers(pg);
    await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(500);
    return Math.max(0, await pg.evaluate(() => document.documentElement.scrollHeight - innerHeight));
  };
  const [H, MH] = await Promise.all([prep(desk), mob ? prep(mob) : 0]);

  // Frames take longer to capture than they last on screen, so slow the sites' CSS animations and
  // transitions to match. Otherwise fades and reveals would look rushed in the video.
  const sessions = [];
  for (const pg of [desk, mob].filter(Boolean)) { const s = await pg.context().newCDPSession(pg); await s.send('Animation.enable'); sessions.push(s); }
  let rate = 1;
  const setRate = async r => { r = Math.max(.02, Math.min(1, r)); if (Math.abs(r - rate) / rate > .1) { rate = r; await Promise.all(sessions.map(s => s.send('Animation.setPlaybackRate', { playbackRate: r }))); } };

  // Sync the phone to the laptop section by section (falls back to proportional if the pages differ).
  const sectionTops = pg => pg.evaluate(() => [...document.querySelectorAll('body section, body footer')]
    .filter(e => !e.parentElement.closest('section, footer') && e.offsetHeight > 50)
    .map(e => Math.round(e.getBoundingClientRect().top + scrollY)));
  let mapY = y => H ? y / H * MH : 0;
  if (mob) {
    const [ds, ms] = await Promise.all([sectionTops(desk), sectionTops(mob)]);
    if (ds.length > 1 && ds.length === ms.length) {
      const A = [0, ...ds.map(v => Math.min(v, H)), H], B = [0, ...ms.map(v => Math.min(v, MH)), MH];
      mapY = y => { for (let i = 1; i < A.length; i++) if (y <= A[i]) return A[i] === A[i - 1] ? B[i] : B[i - 1] + (B[i] - B[i - 1]) * (y - A[i - 1]) / (A[i] - A[i - 1]); return MH; };
      console.log(`phone synced to laptop across ${ds.length} sections`);
    }
  }

  // Scroll plan: [targetY, moveSeconds, holdSeconds].
  // --stops "950,2350,3700" gives exact desktop pixel stops; otherwise stops are spread evenly down the page.
  let targets;
  // A stop can carry its own pause length: "1100:2.6" pauses 2.6s there.
  const holdAt = {};
  if (args.stops) targets = String(args.stops).split(',').map(s => { const [y, h] = s.split(':').map(Number); if (h) holdAt[y] = h; return y; }).filter(n => !isNaN(n)).concat([H]);
  else { const n = Math.min(8, Math.max(3, Math.round(H / 1700))); targets = Array.from({ length: n }, (_, i) => Math.round(H * (i + 1) / n)); }
  const start = 2.6 * PACE, seg = []; let t = start, y = 0;
  targets.forEach((ty, i) => {
    ty = Math.min(ty, H); const dist = Math.abs(ty - y), last = i === targets.length - 1;
    const move = Math.min(2.2, Math.max(1.1, 0.9 + dist / 2600)) * PACE, hold = (last ? .3 : (holdAt[ty] || HOLD)) * PACE;
    const sweep = SWEEPS.includes(ty);
    seg.push({ t0: t, t1: t + move, y0: y, y1: ty, ease: true }); t += move; y = ty;
    const d = last ? 0 : Math.min(DRIFT, Math.max(0, H - ty));        // gentle drift while paused
    seg.push({ t0: t, t1: t + hold, y0: y, y1: y + (sweep ? 0 : d), ease: false, sweep }); t += hold; y += sweep ? 0 : d;
  });
  const T = t + 2.6;
  console.log(`${host}${new URL(URL_).pathname} | ${LAYOUTS.join(', ')} | page height ${H}px | ${T.toFixed(1)}s`);
  const scrollAt = tt => { let v = 0; for (const s of seg) { if (tt >= s.t1) v = s.y1; else if (tt > s.t0) { { const k = (tt - s.t0) / (s.t1 - s.t0); v = s.y0 + (s.y1 - s.y0) * (s.ease ? E(k) : k); } break; } else break; } return v; };

  // One mockup page per layout; every filmed frame of the site feeds all of them.
  const scenes = [];
  for (const L of LAYOUTS) {
    const [w, h] = SIZE(L);
    const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const q = new URLSearchParams({ layout: L, caption: CAPTION, accent: ACCENT });
    await pg.goto('file://' + path.join(__dirname, 'mockup.html') + '?' + q, { waitUntil: 'load', timeout: 90000 });
    await pg.evaluate(() => document.fonts.ready);
    scenes.push({ L, pg });
  }

  const painted = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Hover effects on the laptop: during a --sweep pause, a cursor glides across the element in the middle of the screen.
  const sweepRects = new Map(); let cursor = null;
  const cursorAt = async tt => {
    const s = seg.find(s => s.sweep && tt >= s.t0 && tt < s.t1);
    if (!s) return null;
    if (!sweepRects.has(s)) sweepRects.set(s, await desk.evaluate(() => {
      let el = document.elementFromPoint(innerWidth / 2, innerHeight * .42);
      while (el && el.parentElement && el.getBoundingClientRect().width < innerWidth * .35) el = el.parentElement;
      const r = el.getBoundingClientRect(); return { x: r.left, y: Math.max(r.top, 70), w: r.width, h: Math.min(r.bottom, innerHeight) - Math.max(r.top, 70) };
    }));
    const r = sweepRects.get(s), k = (tt - s.t0) / (s.t1 - s.t0);
    const enter = Math.min(1, k / .15), leave = Math.max(0, (k - .85) / .15), mid = Math.min(1, Math.max(0, (k - .1) / .75));
    const sx = r.x + r.w * (.12 + .76 * E(mid)), syy = r.y + r.h * (.5 + .22 * Math.sin(mid * Math.PI * 2));
    return { x: sx + (1 - enter) * 160 + leave * 160, y: syy + (1 - enter) * 120, o: Math.min(enter, 1 - leave) };
  };
  const filmSite = async tt => {
    cursor = await cursorAt(tt);
    if (cursor) await desk.mouse.move(cursor.x, cursor.y);
    const sy = scrollAt(tt);
    await Promise.all([desk.evaluate(y => scrollTo(0, y), Math.round(sy)), mob && mob.evaluate(y => scrollTo(0, y), Math.round(mapY(sy)))]);
    await Promise.all([desk.evaluate(painted), mob && mob.evaluate(painted)]);
    const [d, m] = await Promise.all([desk.screenshot({ type: 'jpeg', quality: 92 }), mob ? mob.screenshot({ type: 'jpeg', quality: 92 }) : null]);
    return ['data:image/jpeg;base64,' + d.toString('base64'), m && 'data:image/jpeg;base64,' + m.toString('base64'), cursor];
  };
  const compose = async (scene, tt, shots) => {
    await scene.pg.evaluate(async ([a, b, c, d, m]) => { setT(a, b); setCursor(c); await setShots(d, m); }, [tt, T, shots[2], shots[0], shots[1]]);
    await scene.pg.evaluate(painted);
    return scene.pg.screenshot({ type: 'jpeg', quality: 95 });
  };

  fs.mkdirSync(OUTDIR, { recursive: true });
  if (args.out) fs.mkdirSync(path.dirname(args.out), { recursive: true });
  if (STILLS) {
    // Stills: play the timeline up to each requested time at a low frame rate so animations have state.
    const want = String(STILLS).split(',').map(Number).sort((a, b) => a - b); const step = 1 / 10;
    for (let tt = 0, k = 0; k < want.length; tt += step) {
      const shots = await filmSite(tt);
      if (tt + 1e-9 >= want[k]) { for (const sc of scenes) { const fp = OUT(sc.L).replace(/\.mp4$/, `_${want[k]}s.jpg`); fs.writeFileSync(fp, await compose(sc, tt, shots)); console.log('wrote', fp); } k++; }
    }
    await b.close(); return;
  }
  const encoders = scenes.map(sc => spawn(findFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT(sc.L)], { stdio: ['pipe', 'inherit', 'inherit'] }));
  const N = Math.round(T * FPS); let last = Date.now();
  for (let i = 0; i < N; i++) {
    const shots = await filmSite(i / FPS);
    for (let j = 0; j < scenes.length; j++) {
      const buf = await compose(scenes[j], i / FPS, shots);
      if (!encoders[j].stdin.write(buf)) await new Promise(r => encoders[j].stdin.once('drain', r));
    }
    const now = Date.now(); await setRate((1000 / FPS) / Math.max(1, now - last)); last = now;
    if (i % (FPS * 2) === 0) process.stdout.write(`\r  frame ${i}/${N}`);
  }
  for (const e of encoders) e.stdin.end();
  await Promise.all(encoders.map(e => new Promise(r => e.on('close', r)))); await b.close();
  console.log(`\r  done -> ${scenes.map(sc => OUT(sc.L)).join(', ')}            `);
})().catch(e => { console.error(e); process.exit(1); });
