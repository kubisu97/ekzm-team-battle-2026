// スマホ表示の崩れチェック：小さい画面（320〜414px）で全画面を巡回し、
// 画面からはみ出した要素・横スクロール・切れた文字を検出してスクリーンショットを保存する
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || path.join(__dirname, 'audit');
const FONT_DIR = process.env.FONT_DIR;
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TEAMS = ['A', 'B', 'C', 'D', 'E'];
const DEVICES = ['iPhone SE', 'Galaxy S8', 'iPhone 12 Mini', 'Pixel 5', 'iPhone 13'];
const problems = [];
const errors = [];

let FONT_CSS = '';
if (FONT_DIR) {
  const css = (pkg, f) => fs.readFileSync(path.join(FONT_DIR, pkg, f), 'utf8').replace(/url\(\.\/files\//g, `url(https://fontfiles.local/${pkg}/files/`);
  FONT_CSS = ['500.css', '600.css', '700.css'].map(f => css('jost', f)).join('\n') + css('yuji-syuku', 'index.css') +
    [[400, 'Noto Sans CJK JP'], [700, 'Noto Sans CJK JP Bold'], [800, 'Noto Sans CJK JP Bold'], [900, 'Noto Sans CJK JP Black']]
      .map(([w, n]) => `@font-face{font-family:'Noto Sans JP';font-weight:${w};src:local('${n}')}`).join('\n');
}

async function newPage(browser, name, dev) {
  const ctx = await browser.newContext(dev ? { ...devices[dev], deviceScaleFactor: 1 } : { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  await p.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.continue();
    if (FONT_CSS && u.startsWith('https://fonts.googleapis.com/')) return r.fulfill({ contentType: 'text/css', body: FONT_CSS });
    if (FONT_CSS && u.startsWith('https://fontfiles.local/')) return r.fulfill({ path: path.join(FONT_DIR, new URL(u).pathname), contentType: 'font/woff2' });
    return r.abort();
  });
  p.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
  p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'リセット' : undefined));
  p._name = name; p._dev = dev;
  return p;
}

// はみ出し検出（ページ内で実行）
async function check(p, step) {
  const r = await p.evaluate(() => {
    // 中身がはみ出すとモバイルのレイアウト幅自体が広がるため、端末の画面幅（screen.width）を基準にする
    const W = Math.min(innerWidth, screen.width || innerWidth);
    const out = [];
    const docW = document.documentElement.scrollWidth;
    if (docW > W + 1) out.push({ kind: 'page-scroll-x', detail: `scrollWidth ${docW} > ${W}` });
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.slash-layer, .fx-confetti, .cd-overlay, svg, .bar, .lb-track, .tap-bar, .q-timer')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed' && el.classList.contains('fx-flash')) continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (b.right > W + 1.5 || b.left < -1.5) {
        // 祖先が横スクロール可能なら許容
        let a = el.parentElement, scrollable = false;
        while (a) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth) { scrollable = true; break; } a = a.parentElement; }
        if (!scrollable) out.push({ kind: 'out-of-view', el: el.tagName + '.' + [...el.classList].join('.'), text: (el.innerText || '').trim().slice(0, 30), right: Math.round(b.right), W });
      }
      if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis') {
        out.push({ kind: 'clipped-text', el: el.tagName + '.' + [...el.classList].join('.'), text: el.innerText.trim().slice(0, 30) });
      }
    }
    // 親から子がはみ出す（ボタン内の文字など）
    for (const el of document.querySelectorAll('.btn, .chip, .team-btn, .q-choice, .tbadge, .gnum, .rk, .pts, .gain')) {
      if (el.scrollWidth > el.clientWidth + 2) out.push({ kind: 'content-overflow', el: el.tagName + '.' + [...el.classList].join('.'), text: el.innerText.trim().slice(0, 30), sw: el.scrollWidth, cw: el.clientWidth });
    }
    // 重複を減らす（同じ要素種別は1件）
    const seen = new Set();
    return out.filter(o => { const k = o.kind + o.el + o.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 25);
  });
  for (const x of r) problems.push({ step, page: p._name, dev: p._dev, ...x });
}

async function snap(p, step, full = true) {
  await check(p, step);
  await p.screenshot({ path: path.join(OUT, `${step}__${(p._dev || 'desktop').replace(/\W/g, '')}.png`), fullPage: full });
}

(async () => {
  await fetch(BASE + '/__mock/reset', { method: 'POST' });
  const browser = await chromium.launch();
  // 管理者はスマホで操作する想定でもチェック
  const admin = await newPage(browser, 'admin', 'iPhone 13');
  await admin.goto(BASE + '/admin.html?mock');
  await admin.fill('#em', 'a@a'); await admin.fill('#pw', 'mock'); await admin.click('#loginForm button');
  await admin.waitForSelector('.tabs');
  await sleep(400);
  await snap(admin, 'A01-lobby');
  const players = [];
  for (let i = 0; i < 10; i++) {
    const p = await newPage(browser, 'p' + i, DEVICES[i % 5]);
    await p.goto(BASE + `/index.html?mock&p=${i}`);
    await p.waitForSelector('#nameIn');
    if (i < 5) await snap(p, 'P01-join');
    await p.fill('#nameIn', i === 0 ? 'ながいなまえのひと' : `参加者${i + 1}`);
    await p.click(`.team-btn[data-team="${TEAMS[i % 5]}"]`);
    await p.click('#joinBtn');
    await p.waitForSelector('#lobbyMain');
    players.push(p);
  }
  await sleep(500);
  for (const p of players.slice(0, 5)) await snap(p, 'P02-lobby');
  // ヘルプ
  await players[0].click('#helpBtn'); await sleep(300); await snap(players[0], 'P03-help', false); await players[0].click('.help-sheet .close');
  // 管理画面タブ
  await admin.click('[data-tab="quiz"]'); await admin.click('[data-act="sampleQuiz"]'); await sleep(300); await snap(admin, 'A02-quiz');
  await admin.click('[data-tab="members"]'); await sleep(200); await snap(admin, 'A03-members');
  await admin.click('[data-tab="setup"]'); await sleep(200); await snap(admin, 'A04-setup');
  await admin.click('[data-tab="score"]'); await sleep(200); await snap(admin, 'A05-score');
  await admin.click('[data-tab="control"]');

  const get = async q => (await (await fetch(BASE + '/__mock/get?path=' + q)).json()).value;
  const games = ['ten', 'quiz', 'iai', 'tap'];
  for (let round = 1; round <= 4; round++) {
    const g = games[round - 1];
    for (let t = 0; t < 5; t++) { const p = players[((round - 1) % 2) * 5 + t]; await p.waitForSelector('#pickBtn'); await p.click('#pickBtn'); }
    await sleep(500);
    for (const p of players.slice(0, 5)) await snap(p, `R${round}-1-picked`);
    await snap(admin, `R${round}-A1-lobby`);
    if (g === 'quiz') { await admin.click('[data-act="autoQuiz"]'); await sleep(200); }
    await admin.click('[data-act="announce"]'); await sleep(600);
    for (const p of players.slice(0, 5)) await snap(p, `R${round}-2-ready`);
    const st = await get('state');
    const repPages = players.filter((p, i) => Object.keys(st.repOf).length && i >= ((round - 1) % 2) * 5 && i < ((round - 1) % 2) * 5 + 5);
    const specPages = players.filter(p => !repPages.includes(p));
    for (const p of repPages) await p.click('#okBtn');
    await snap(admin, `R${round}-A2-ready`);
    await admin.click('[data-act="start"]');
    await sleep(1500);
    await snap(specPages[0], `R${round}-3-countdown`, false);
    await sleep(3000);
    if (g === 'ten') {
      for (const p of repPages) await snap(p, `R${round}-4-rep`, false);
      await snap(specPages[0], `R${round}-4-spec`);
      await sleep(5000);
      for (const p of repPages) await p.click('#stopBtn');
    } else if (g === 'iai') {
      for (const p of repPages) await snap(p, `R${round}-4-rep`, false);
      const s2 = await get('state'); await sleep(Number(s2.iaiDelay) + 100);
      await snap(specPages[0], `R${round}-4-spec`);
      for (const p of repPages) await p.click('#iaiArea', { force: true });
      await sleep(400); for (const p of repPages) await snap(p, `R${round}-5-rep-after`, false);
      await sleep(1500);
    } else if (g === 'tap') {
      for (const p of repPages) { for (let k = 0; k < 15; k++) await p.dispatchEvent('#tapPad', 'pointerdown'); }
      for (const p of repPages) await snap(p, `R${round}-4-rep`, false);
      await snap(specPages[0], `R${round}-4-spec`);
      await sleep(4500);
    } else {
      for (let q = 0; q < 3; q++) {
        await admin.click('[data-act="quizNext"]'); await sleep(3200);
        if (q === 0) { for (const p of repPages) await snap(p, `R${round}-4-rep`, false); await snap(specPages[0], `R${round}-4-spec`); await snap(admin, `R${round}-A3-quiz`); }
        for (const [i, p] of repPages.entries()) await p.click(`.q-choice.c${(i + q) % 4}`);
        await sleep(400); await admin.click('[data-act="quizReveal"]'); await sleep(600);
        if (q === 0) for (const p of repPages) await snap(p, `R${round}-5-rep-reveal`, false);
      }
    }
    await sleep(500);
    await snap(admin, `R${round}-A4-running`);
    await admin.click('[data-act="finish"]'); await sleep(600);
    await snap(specPages[0], `R${round}-6-judging`);
    await snap(admin, `R${round}-A5-judging`);
    await admin.click('[data-act="publish"]');
    await sleep(1200 + 1600 + 5 * 1500 + 1600);
    for (const p of players.slice(0, 5)) await snap(p, `R${round}-7-results`);
    await snap(admin, `R${round}-A6-results`);
    await admin.click(`[data-act="${round < 4 ? 'next' : 'final'}"]`);
    await sleep(800);
  }
  await sleep(1500 + 2200 + 4 * 1900 + 2500);
  for (const p of players.slice(0, 5)) await snap(p, 'Z-final');
  await snap(admin, 'Z-A-final');
  fs.writeFileSync(path.join(OUT, 'problems.json'), JSON.stringify(problems, null, 1));
  const summary = {};
  for (const x of problems) { const k = `${x.kind} ${x.el || ''} "${x.text || ''}"`; (summary[k] ||= new Set()).add(`${x.step}@${(x.dev || '').replace('iPhone ', 'i')}`); }
  console.log('problems:', problems.length);
  for (const [k, v] of Object.entries(summary)) console.log(' -', k, '→', [...v].slice(0, 6).join(', '), v.size > 6 ? `…(+${v.size - 6})` : '');
  console.log('page errors:', errors.length, errors.slice(0, 5).join('\n'));
  await browser.close();
})().catch(e => { console.error('AUDIT FAILED', e); console.log(errors.join('\n')); process.exit(1); });
