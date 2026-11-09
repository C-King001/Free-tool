#!/usr/bin/env node
// Captures crisp stills of each site for the showreel: phone (iPhone, 3x) and desktop (1.5x) viewport shots
// down the page, plus a full-page desktop shot. Output: reel/assets/<name>/{m,d}_NN.jpg, d_full.jpg
//   node reel/capture.js [name ...]
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const SITES = {
  meji: 'https://meji-eight.vercel.app/', moodring: 'https://moodring-five.vercel.app/', expertlinc: 'https://www.expertlinc.com/',
  moms: 'https://momsandmore.com.ng/', wigpa: 'https://www.wigpa.org/', bibire: 'https://bibire-six.vercel.app/',
  crib: 'https://www.getyourcrib.app/', throne: 'https://the-throneroom.vercel.app/',
};
function browserArgs() { const ca = '/root/.ccr/agent-proxy-ca.crt'; if (!fs.existsSync(ca)) return [];
  return ['--ignore-certificate-errors-spki-list=' + execSync(`openssl x509 -in ${ca} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`).toString().trim()]; }
async function launch() { try { return await chromium.launch({ channel: 'chromium', args: browserArgs() }); }
  catch (e) { return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: browserArgs() }); } }
const dismiss = pg => pg.evaluate(() => {
  const btns = [...document.querySelectorAll('button,a,[role=button]')];
  for (const re of [/necessary only|reject all|reject|decline|only essential/i, /accept all|accept|agree|got it|allow all/i]) {
    const hit = btns.find(x => re.test((x.textContent || '').trim()) && x.offsetParent !== null && (x.textContent || '').length < 40); if (hit) { hit.click(); break; } }
});
// Close newsletter/community pop-ups (after saving a shot of them: they are part of the work).
const popup = pg => pg.evaluate(() => {
  for (const el of document.querySelectorAll('body *')) { const c = getComputedStyle(el);
    if (c.position === 'fixed' && el.offsetWidth > innerWidth * .5 && el.offsetHeight > innerHeight * .5 && +c.zIndex > 10) {
      const x = el.querySelector('[aria-label*=lose i],[aria-label*=ismiss i],button.close,[class*=close]'); if (x) return true; } }
  return false; });
const closePopup = pg => pg.evaluate(() => {
  for (const el of document.querySelectorAll('body *')) { const c = getComputedStyle(el);
    if (c.position === 'fixed' && el.offsetWidth > innerWidth * .5 && el.offsetHeight > innerHeight * .5 && +c.zIndex > 10) {
      const x = [...el.querySelectorAll('button,a')].find(b => /not right now|no thanks|maybe later/i.test(b.textContent || ''))
        || el.querySelector('[aria-label*=lose i],[aria-label*=ismiss i],button.close,[class*=close]'); if (x) x.click(); } } });
(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SITES);
  const b = await launch();
  for (const n of names) {
    const dir = path.join(__dirname, 'assets', n); fs.mkdirSync(dir, { recursive: true });
    for (const kind of ['m', 'd']) {
      const ctx = await b.newContext(kind === 'm'
        ? { userAgent: devices['iPhone 13'].userAgent, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
        : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
      const pg = await ctx.newPage();
      try { await pg.goto(SITES[n], { waitUntil: 'networkidle', timeout: 90000 }); } catch (e) { console.log(n, kind, 'load:', e.message.slice(0, 60)); }
      await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(2500); await dismiss(pg); await pg.waitForTimeout(600);
      const VH = kind === 'm' ? 844 : 900, step = Math.round(VH * .8);
      let H = await pg.evaluate(() => document.documentElement.scrollHeight);
      let i = 0;
      for (let y = 0; y < H - VH * .3 && i < 40; y += step, i++) {
        await pg.evaluate(y => scrollTo(0, y), y); await pg.waitForTimeout(y === 0 ? 3500 : 1100);
        if (await popup(pg) || await pg.getByText(/not right now/i).first().isVisible().catch(() => false)) {
          if (!fs.existsSync(path.join(dir, `${kind}_popup.jpg`))) await pg.screenshot({ path: path.join(dir, `${kind}_popup.jpg`), type: 'jpeg', quality: 92 });
          await pg.getByText(/not right now/i).first().click({ timeout: 2000 }).catch(() => closePopup(pg)); await pg.keyboard.press('Escape');
          await pg.waitForTimeout(900); }
        await pg.screenshot({ path: path.join(dir, `${kind}_${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 92 });
        H = await pg.evaluate(() => document.documentElement.scrollHeight);
      }
      if (kind === 'd') { await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(800);
        await pg.screenshot({ path: path.join(dir, 'd_full.jpg'), type: 'jpeg', quality: 88, fullPage: true }).catch(e => console.log('full', e.message.slice(0, 60))); }
      console.log(n, kind, i, 'shots, page', H);
      await ctx.close();
    }
  }
  await b.close();
})();
