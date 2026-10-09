#!/usr/bin/env node
// "Which is better, A or B?" post from two desktop clips filmed with `render.js --nophone --clips`.
//
//   node ab.js --a clips/a --b clips/b --format feed|tall --out output/ab_feed.mp4
//   node ab.js --a clips/a --b clips/b --format feed --still 2 --out output/ab_feed.png   (single image)
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) args[a.slice(2)] = true; else { args[a.slice(2)] = v; i++; } } }
const FORMAT = args.format || 'feed', FPS = +(args.fps || 60);
const OUT = path.resolve(args.out || `output/ab_${FORMAT}.mp4`);

// Cloud sandboxes re-sign HTTPS with their own CA (needed for the Google Fonts download). Trust that CA's key only.
function browserArgs() {
  const ca = '/root/.ccr/agent-proxy-ca.crt';
  if (!fs.existsSync(ca)) return [];
  return ['--ignore-certificate-errors-spki-list=' + execSync(`openssl x509 -in ${ca} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`).toString().trim()];
}
const ffmpegPath = () => { if (process.env.FFMPEG) return process.env.FFMPEG; try { return require('ffmpeg-static'); } catch (e) { return 'ffmpeg'; } };

(async () => {
  const load = d => { const j = JSON.parse(fs.readFileSync(path.join(path.resolve(d), 'clip.json'), 'utf8')); return { base: 'file://' + path.resolve(d) + '/', fps: j.fps, frames: j.frames, meta: j.meta }; };
  const AB = { a: load(args.a), b: load(args.b) };
  const b = await chromium.launch({ channel: 'chromium', args: ['--allow-file-access-from-files', ...browserArgs()] });
  const H = FORMAT === 'tall' ? 1920 : 1350;
  const p = await b.newPage({ viewport: { width: 1080, height: H }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(__dirname, 'ab.html') + '?format=' + FORMAT, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(ab => { window.AB = ab; }, AB);
  const painted = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (args.still !== undefined) {
    await p.evaluate(t => drawFrame(t), +args.still); await p.evaluate(painted);
    await p.screenshot({ path: OUT, type: OUT.endsWith('.png') ? 'png' : 'jpeg' }); console.log('wrote', OUT); await b.close(); return;
  }
  // Runs as long as the longer clip; the shorter one holds its last frame.
  const T = Math.max(AB.a.frames / AB.a.fps, AB.b.frames / AB.b.fps);
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
