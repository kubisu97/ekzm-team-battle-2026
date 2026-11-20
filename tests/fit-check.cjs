// 「スマホ1画面に収まるか」のチェック：実際のブラウザの表示領域（アドレスバー等を除いた高さ）で、
// 参加者の各画面と説明スライドが、スクロールなしで収まるかを測る。
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8080';
const OUT = process.env.OUT || path.join(__dirname, 'fit');
const FONT_DIR = process.env.FONT_DIR;
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async p => (await (await fetch(BASE + '/__mock/get?path=' + p)).json()).value;
const TEAMS = ['A', 'B', 'C', 'D', 'E'];
const errors = [];
// iPhone の Safari（ツールバー表示中）と Android の Chrome の、実際にページが見える高さ
const VIEWS = {
  iphone: { ...devices['iPhone 15 Pro'], viewport: { width: 393, height: 659 } },
  android: { ...devices['Pixel 7'], viewport: { width: 412, height: 760 } },
};

let FONT_CSS = '';
if (FONT_DIR) {
  const css = (pkg, f) => fs.readFileSync(path.join(FONT_DIR, pkg, f), 'utf8').replace(/url\(\.\/files\//g, `url(https://fontfiles.local/${pkg}/files/`);
  FONT_CSS = ['500.css', '600.css', '700.css'].map(f => css('jost', f)).join('\n') + css('yuji-syuku', 'index.css') +
    [[400, 'Noto Sans CJK JP'], [500, 'Noto Sans CJK JP Medium'], [700, 'Noto Sans CJK JP Bold'], [800, 'Noto Sans CJK JP Bold'], [900, 'Noto Sans CJK JP Black']]
      .map(([w, n]) => `@font-face{font-family:'Noto Sans JP';font-weight:${w};src:local('${n}')}`).join('\n');
}
async function newPage(browser, name, view) {
  const ctx = await browser.newContext({ ...(view ? VIEWS[view] : {}), ...(view ? {} : { viewport: { width: 1000, height: 900 } }), deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.continue();
    if (FONT_CSS && u.startsWith('https://fonts.googleapis.com/')) return r.fulfill({ contentType: 'text/css', body: FONT_CSS });
    if (FONT_CSS && u.startsWith('https://fontfiles.local/')) return r.fulfill({ path: path.join(FONT_DIR, new URL(u).pathname), contentType: 'font/woff2' });
    return r.abort();
  });
  p.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
  p.on('dialog', d => d.accept());
  p._name = name; p._view = view;
  return p;
}
const results = [];
async function measure(p, step) {
  const m = await p.evaluate(() => {
    const ex = document.querySelector('#explain, #awards');
    if (ex) return { kind: ex.id, h: ex.scrollHeight, vh: innerHeight };
    return { kind: 'page', h: document.documentElement.scrollHeight, vh: innerHeight };
  });
  const over = m.h - m.vh;
  results.push({ step, who: p._name, view: p._view, ...m, over });
  await p.screenshot({ path: path.join(OUT, `${step}__${p._name}.png`) });
}

(async () => {
  await fetch(BASE + '/__mock/reset', { method: 'POST' });
  const browser = await chromium.launch();
  const admin = await newPage(browser, 'admin', null);
  await admin.goto(BASE + '/admin.html?mock');
  await admin.fill('#em', 'a@a'); await admin.fill('#pw', 'mock'); await admin.click('#loginForm button');
  await admin.waitForSelector('.tabs');
  await admin.click('[data-tab="quiz"]'); await admin.click('[data-act="sampleQuiz"]'); await sleep(300);
  await admin.click('[data-tab="control"]');
  const reps = {};
  for (const t of TEAMS) {
    const p = await newPage(browser, 'rep' + t, t === 'A' ? 'iphone' : t === 'B' ? 'android' : 'iphone');
    await p.goto(BASE + `/index.html?mock&p=r${t}`); await p.waitForSelector('#nameIn');
    if (t === 'A') await measure(p, '00-join');
    await p.fill('#nameIn', t === 'A' ? 'ながいなまえのひと' : `代表${t}`); await p.click(`.team-btn[data-team="${t}"]`); await p.click('#joinBtn');
    await p.waitForSelector('#lobbyMain');
    reps[t] = p;
  }
  const specI = await newPage(browser, 'specI', 'iphone');
  await specI.goto(BASE + '/index.html?mock&p=si'); await specI.waitForSelector('#nameIn');
  await specI.fill('#nameIn', '観戦あい'); await specI.click('.team-btn[data-team="A"]'); await specI.click('#joinBtn'); await specI.waitForSelector('#lobbyMain');
  const specA = await newPage(browser, 'specA', 'android');
  await specA.goto(BASE + '/index.html?mock&p=sa'); await specA.waitForSelector('#nameIn');
  await specA.fill('#nameIn', '観戦あん'); await specA.click('.team-btn[data-team="B"]'); await specA.click('#joinBtn'); await specA.waitForSelector('#lobbyMain');
  await sleep(400);
  await measure(specI, '01-lobby'); await measure(specA, '01-lobby');
  // 説明スライド
  await admin.click('[data-act="explainOpen"][data-key="opening"]'); await sleep(500);
  for (let i = 0; i < 6; i++) { await measure(specI, `02-opening-${i + 1}`); await measure(specA, `02-opening-${i + 1}`); await admin.click('[data-act="explainMove"][data-d="1"]').catch(() => {}); await sleep(350); }
  await admin.click('[data-act="explainClose"]').catch(() => {}); await sleep(300);
  for (const g of ['ten', 'quiz', 'touch', 'tap']) {
    await admin.selectOption('#gameSel', g); await sleep(300);
    await admin.click(`[data-act="explainOpen"][data-key="${g}"]`); await sleep(400);
    for (let i = 0; i < 4; i++) { await measure(specI, `03-${g}-${i + 1}`); await measure(specA, `03-${g}-${i + 1}`); await admin.click('[data-act="explainMove"][data-d="1"]').catch(() => {}); await sleep(300); }
    await admin.click('[data-act="explainClose"]').catch(() => {}); await sleep(300);
  }
  await admin.selectOption('#gameSel', 'ten'); await sleep(300);
  for (const g of ['ten', 'quiz', 'touch', 'tap']) {
    if (g !== 'ten') { await admin.click('[data-act="next"]'); await sleep(500); }
    await measure(reps.A, `10-${g}-lobby-before`);
    for (const t of TEAMS) await reps[t].click('#pickBtn');
    await sleep(400);
    await measure(reps.A, `11-${g}-lobby-rep`); await measure(specI, `11-${g}-lobby-spec`);
    if (g === 'quiz') { await admin.click('[data-act="autoQuiz"]'); await sleep(200); }
    await admin.click('[data-act="announce"]'); await sleep(500);
    await measure(reps.A, `12-${g}-ready-rep`); await measure(reps.B, `12-${g}-ready-rep`); await measure(specI, `12-${g}-ready-spec`); await measure(specA, `12-${g}-ready-spec`);
    for (const t of TEAMS) await reps[t].click('#okBtn');
    await admin.click('[data-act="start"]'); await sleep(4400);
    if (g === 'quiz') {
      await admin.click('[data-act="quizNext"]'); await sleep(3300);
      await measure(reps.A, `13-${g}-play-rep`); await measure(reps.B, `13-${g}-play-rep`); await measure(specI, `13-${g}-play-spec`); await measure(specA, `13-${g}-play-spec`);
      for (const t of TEAMS) await reps[t].click('.q-choice.c1', { force: true }).catch(() => {});
      await sleep(300); await admin.click('[data-act="quizReveal"]'); await sleep(800);
      await measure(reps.A, `14-${g}-reveal-rep`); await measure(specI, `14-${g}-reveal-spec`); await measure(specA, `14-${g}-reveal-spec`);
    } else {
      await sleep(1500);
      await measure(reps.A, `13-${g}-play-rep`); await measure(reps.B, `13-${g}-play-rep`); await measure(specI, `13-${g}-play-spec`); await measure(specA, `13-${g}-play-spec`);
      if (g === 'ten') for (const t of TEAMS) await reps[t].click('#stopBtn', { force: true }).catch(() => {});
      if (g === 'touch') for (const t of TEAMS) for (let n = 1; n <= 16; n++) await reps[t].click(`.tcell[data-n="${n}"]`).catch(() => {});
      if (g === 'tap') await sleep(15000);
      await sleep(600);
      await measure(reps.A, `14-${g}-done-rep`);
    }
    await admin.click('[data-act="finish"]'); await sleep(500);
    await measure(specI, `15-${g}-judging`);
    await admin.click('[data-act="publish"]'); await sleep(1200 + 1600 + 5 * 1500 + 1800);
    await measure(specI, `16-${g}-results`); await measure(specA, `16-${g}-results`);
  }
  await admin.click('[data-act="final"]'); await sleep(1500 + 2200 + 4 * 1900 + 3000);
  await measure(specI, '20-final'); await measure(specA, '20-final');
  await admin.click('[data-act="announceAwards"]'); await sleep(1200 + 1800 + 4500 + 1800);
  await measure(specI, '21-awards'); await measure(specA, '21-awards');
  fs.writeFileSync(path.join(OUT, 'fit.json'), JSON.stringify(results, null, 1));
  const bad = results.filter(r => r.over > 2);
  console.log(`measured ${results.length} screens, over: ${bad.length}`);
  for (const r of bad) console.log(` - ${r.step} ${r.who}(${r.view}) ${r.kind} +${r.over}px`);
  console.log('page errors:', errors.length, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
