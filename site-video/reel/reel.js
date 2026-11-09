#!/usr/bin/env node
// Renders a showreel composition (reel.html) frame by frame and mixes in the music and sound effects.
//   node reel/reel.js --story onejob --out reel/out/nexara_onejob.mp4
//   node reel/reel.js --story whatif --stills 1,5,12        (JPG previews only)
//   node reel/reel.js --story onejob --from 14 --until 20   (render a slice, silent; for checking)
// The page exposes window.STORY = { duration, music: {file, offset, gain, fadeIn, fadeOut}, cues: [[t, sfx, gain]] }
// and window.R(t), which draws the frame at time t (seconds). Everything is driven by t, so frames are deterministic.
const { chromium } = require('playwright');
const { spawn, execSync, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');

const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) args[a.slice(2)] = true; else { args[a.slice(2)] = v; i++; } } }
const STORY = args.story || 'onejob', FPS = +(args.fps || 60);
const OUT = path.resolve(args.out || path.join(__dirname, 'out', `nexara_${STORY}.mp4`));
const ffmpeg = () => { try { return require('ffmpeg-static'); } catch (e) { return 'ffmpeg'; } };
function browserArgs() { const ca = '/root/.ccr/agent-proxy-ca.crt'; if (!fs.existsSync(ca)) return [];
  return ['--ignore-certificate-errors-spki-list=' + execSync(`openssl x509 -in ${ca} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`).toString().trim()]; }
async function launch(a) { try { return await chromium.launch({ channel: 'chromium', args: a }); }
  catch (e) { return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: a }); } }

(async () => {
  const b = await launch(['--allow-file-access-from-files', ...browserArgs()]);
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('  page:', m.text()); });
  p.on('pageerror', e => console.log('  page error:', e.message));
  await p.goto('file://' + path.join(__dirname, 'reel.html') + '?story=' + STORY, { waitUntil: 'load' });
  await p.evaluate(() => window.READY);
  const S = await p.evaluate(() => window.STORY);
  const painted = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  if (args.stills) {
    for (const s of String(args.stills).split(',').map(Number)) {
      await p.evaluate(t => R(t), s); await p.evaluate(painted);
      const f = OUT.replace(/\.mp4$/, `_${s}s.jpg`); await p.screenshot({ path: f, type: 'jpeg', quality: 90 }); console.log('wrote', f);
    }
    await b.close(); return;
  }

  const T0 = +(args.from || 0), T1 = Math.min(S.duration, +(args.until || S.duration));
  const silent = OUT.replace(/\.mp4$/, '.silent.mp4');
  const ff = spawn(ffmpeg(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N0 = Math.round(T0 * FPS), N1 = Math.round(T1 * FPS); const start = Date.now();
  for (let i = N0; i < N1; i++) {
    await p.evaluate(t => R(t), i / FPS);
    const buf = await p.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % FPS === 0) process.stdout.write(`\r  ${(i / FPS).toFixed(0)}s / ${T1.toFixed(0)}s  (${((Date.now() - start) / 1000).toFixed(0)}s elapsed)`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();

  // Audio: music trimmed from its offset with fades, plus each sound effect at its cue time.
  const A = path.join(__dirname, 'assets', 'audio'); const m = S.music; const dur = T1 - T0;
  const inputs = ['-i', silent, '-ss', String(m.offset + T0), '-t', String(dur), '-i', path.join(A, m.file)];
  const cues = (S.cues || []).filter(c => c[0] >= T0 && c[0] < T1 && !args.nosfx);
  const filt = [`[1:a]volume=${m.gain || 1},afade=t=in:st=0:d=${T0 ? 0.05 : (m.fadeIn || 0.3)},afade=t=out:st=${Math.max(0, dur - (m.fadeOut || 1.5))}:d=${m.fadeOut || 1.5}[mu]`];
  cues.forEach((c, k) => { inputs.push('-i', path.join(A, 'sfx_' + c[1] + '.mp3'));
    const ms = Math.round((c[0] - T0) * 1000); filt.push(`[${k + 2}:a]${c[3] ? `atrim=0:${c[3]},afade=t=out:st=${Math.max(0, c[3] - .15)}:d=.15,` : ''}volume=${c[2] || 0.5},adelay=${ms}|${ms}[s${k}]`); });
  filt.push(`[mu]${cues.map((c, k) => `[s${k}]`).join('')}amix=inputs=${cues.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[a]`);
  execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filt.join(';'), '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT]);
  fs.rmSync(silent);
  console.log(`\r  done -> ${OUT}                    `);
})().catch(e => { console.error(e); process.exit(1); });
