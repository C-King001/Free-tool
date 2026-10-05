#!/usr/bin/env node
// Compose a 1080x1920 TikTok portfolio ad from clips filmed with `render.js --clips`.
//
//   node ad.js --concept feed|three|sell --clips <dir with food/ careers/ faith/ ecom/> --out ad.mp4
//
// Each clip folder holds desk.webm, mob.webm and clip.json. AD_CLIPS below says which folder plays which
// role and where in each clip its signature moment starts.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) args[a.slice(2)] = true; else { args[a.slice(2)] = v; i++; } } }
const CONCEPT = args.concept || 'feed', DIR = path.resolve(args.clips || 'clips'), FPS = +(args.fps || 60);
const OUT = path.resolve(args.out || `output/ad_${CONCEPT}.mp4`);

// role -> folder, plus moment offsets in seconds: feed = phone moment, hero = click moment, sweep = cursor hover moment
const AD_CLIPS = {
  food:    { dir: 'food',      feed: 4.2, hero: 4.2, sweep: 11.3 },
  careers: { dir: 'careers',   feed: 4.6, sweep: 9.3 },
  faith:   { dir: 'nonprofit', feed: 3.6, sweep: 9.8 },
  ecom:    { dir: 'ecom',      feed: 5.4, hero: 5.4 },
};
if (args.offsets) Object.assign(AD_CLIPS, JSON.parse(fs.readFileSync(args.offsets, 'utf8')));

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { return require('ffmpeg-static'); } catch (e) { return 'ffmpeg'; }
}

(async () => {
  const clips = {};
  for (const [role, c] of Object.entries(AD_CLIPS)) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, c.dir, 'clip.json'), 'utf8'));
    clips[role] = { ...c, base: 'file://' + path.join(DIR, c.dir) + '/', fps: j.fps, frames: j.frames, meta: j.meta };
  }
  const b = await chromium.launch({ channel: 'chromium', args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(__dirname, 'ad.html') + '?concept=' + CONCEPT, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(c => { window.CLIPS = c; }, clips);
  const T = await p.evaluate(() => duration());
  console.log(`ad ${CONCEPT} | ${T.toFixed(1)}s`);
  const painted = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (args.stills) {
    for (const s of String(args.stills).split(',')) { await p.evaluate(t => drawFrame(t), +s); await p.evaluate(painted);
      const fp = OUT.replace(/\.mp4$/, `_${s}s.jpg`); fs.writeFileSync(fp, await p.screenshot({ type: 'jpeg', quality: 90 })); console.log('wrote', fp); }
    await b.close(); return;
  }
  const ff = spawn(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = Math.round(T * FPS);
  for (let i = 0; i < N; i++) {
    await p.evaluate(t => drawFrame(t), i / FPS); await p.evaluate(painted);
    const buf = await p.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % (FPS * 2) === 0) process.stdout.write(`\r  frame ${i}/${N}`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();
  console.log(`\r  done -> ${OUT}            `);
})().catch(e => { console.error(e); process.exit(1); });
