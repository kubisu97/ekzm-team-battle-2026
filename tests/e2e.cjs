// モックサーバーを使った通し試験：管理者1 + 参加者10 で 4 ゲームを最後まで進行
const { chromium, devices } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8080';
const SHOTS = process.env.SHOTS || require('path').join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TEAMS = ['A', 'B', 'C', 'D', 'E'];
const errors = [];

// 任意：FONT_DIR（@fontsource のフォルダ）を指定すると Web フォントもローカルから読み込んで、本番に近い見た目でスクリーンショットを撮る
const FONT_DIR = process.env.FONT_DIR;
let FONT_CSS = '';
if (FONT_DIR) {
  const path = require('path');
  const css = (pkg, f) => fs.readFileSync(path.join(FONT_DIR, pkg, f), 'utf8').replace(/url\(\.\/files\//g, `url(https://fontfiles.local/${pkg}/files/`);
  FONT_CSS = ['500.css', '600.css', '700.css'].map(f => css('jost', f)).join('\n') + css('yuji-syuku', 'index.css') +
    [[400, 'Noto Sans CJK JP'], [700, 'Noto Sans CJK JP Bold'], [800, 'Noto Sans CJK JP Bold'], [900, 'Noto Sans CJK JP Black']]
      .map(([w, n]) => `@font-face{font-family:'Noto Sans JP';font-weight:${w};src:local('${n}')}`).join('\n');
}

async function newPage(ctx, name) {
  const p = await ctx.newPage();
  await p.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.continue();
    if (FONT_CSS && u.startsWith('https://fonts.googleapis.com/')) return r.fulfill({ contentType: 'text/css', body: FONT_CSS });
    if (FONT_CSS && u.startsWith('https://fontfiles.local/')) return r.fulfill({ path: require('path').join(FONT_DIR, new URL(u).pathname), contentType: 'font/woff2' });
    return r.abort();
  });
  p.on('pageerror', e => errors.push(`[${name}] pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
  p.on('dialog', d => d.accept(d.type() === 'prompt' ? (d.message().includes('初期化') ? '初期化' : 'リセット') : undefined));
  return p;
}

async function shot(p, name) { await p.screenshot({ path: `${SHOTS}/${name}.png` }); }

(async () => {
  await fetch(BASE + '/__mock/reset', { method: 'POST' });
  const browser = await chromium.launch();
  const actx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const admin = await newPage(actx, 'admin');
  await admin.goto(BASE + '/admin.html?mock');
  await admin.fill('#em', 'host@example.com');
  await admin.fill('#pw', 'mock');
  await admin.click('#loginForm button');
  await admin.waitForSelector('.tabs');
  await sleep(500);
  await shot(admin, '01-admin-lobby');

  // 参加者 10 人（各チーム2人）
  const players = [];
  for (let i = 0; i < 10; i++) {
    const team = TEAMS[i % 5];
    // EventSource の同時接続数制限（1プロファイル6本）を避けるため、参加者ごとに別コンテキスト
    const pctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
    const p = await newPage(pctx, `p${i}`);
    await p.goto(BASE + `/index.html?mock&p=${i}`);
    await p.waitForSelector('#nameIn');
    if (i === 0) await shot(p, '02-join');
    await p.fill('#nameIn', `参加者${i + 1}`);
    await p.click(`.team-btn[data-team="${team}"]`);
    await p.click('#joinBtn');
    await p.waitForSelector('#lobbyMain');
    players.push({ p, team, name: `参加者${i + 1}` });
  }
  await sleep(500);
  await shot(players[0].p, '03-lobby');

  // クイズ問題（サンプル）登録
  await admin.click('[data-tab="quiz"]');
  await admin.click('[data-act="sampleQuiz"]');
  await sleep(400);
  await shot(admin, '04-admin-quiz');
  await admin.click('[data-tab="members"]');
  await sleep(300);
  await shot(admin, '05-admin-members');
  await admin.click('[data-tab="setup"]');
  await sleep(300);
  await shot(admin, '06-admin-qr');
  await admin.click('[data-tab="control"]');

  const repsOf = async () => {
    const st = await (await fetch(BASE + '/__mock/get?path=state')).json();
    return st.value;
  };
  const pageOfUid = async uid => {
    for (const pl of players) { const u = await pl.p.evaluate(() => JSON.parse(sessionStorage.getItem('mock-user-' + [...document.scripts].length) || 'null')); }
    return null;
  };
  // uid → page
  const uidMap = {};
  for (const pl of players) {
    const u = await pl.p.evaluate(() => { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k.startsWith('mock-user-')) return JSON.parse(sessionStorage.getItem(k)).uid; } return null; });
    uidMap[u] = pl;
  }

  for (let round = 1; round <= 4; round++) {
    await admin.waitForSelector('[data-act="announce"]');
    // 各チームで1人が「わたしが出る！」を押す（2巡目以降は出場済みなので確認ダイアログ→OK）
    for (let t = 0; t < 5; t++) {
      const pl = players[((round - 1) % 2) * 5 + t];
      await pl.p.waitForSelector('#pickBtn');
      if (round === 1 && t === 0) await shot(pl.p, `r${round}-a0-pick`);
      await pl.p.click('#pickBtn');
    }
    await sleep(600);
    await shot(players[0].p, `r${round}-a1-picked`);
    const game = await admin.$eval('#gameSel', s => s.value);
    if (game === 'quiz') { await admin.click('[data-act="autoQuiz"]'); await sleep(300); }
    await shot(admin, `r${round}-a-select`);
    await admin.click('[data-act="announce"]');
    await sleep(600);
    const st = await repsOf();
    const repPages = Object.entries(st.repOf).map(([uid, t]) => ({ uid, t, pl: uidMap[uid] }));
    const spec = players.find(pl => !repPages.some(r => r.pl === pl));
    await shot(repPages[0].pl.p, `r${round}-b-rep-ready`);
    await shot(spec.p, `r${round}-b-spec-ready`);
    for (const r of repPages) await r.pl.p.click('#okBtn');
    await sleep(400);
    await admin.click('[data-act="start"]');
    console.log(`round ${round} game ${game} started`);
    if (game === 'ten') {
      await sleep(4300);
      await shot(repPages[0].pl.p, `r${round}-c-rep-play`);
      await Promise.all(repPages.map(async (r, i) => { await sleep(8500 + i * 400); await r.pl.p.click('#stopBtn'); }));
      await shot(spec.p, `r${round}-c-spec`);
    } else if (game === 'iai') {
      await sleep(4300);
      await shot(repPages[0].pl.p, `r${round}-c-rep-kamae`);
      const st2 = await repsOf();
      await sleep(Number(st2.iaiDelay) + 50);
      await shot(spec.p, `r${round}-c-spec-kire`);
      // 1人はフライング、他は反応
      await repPages[0].pl.p.click('#iaiArea').catch(() => {});
      await Promise.all(repPages.slice(1).map(async (r, i) => { await sleep(150 + i * 60); await r.pl.p.click('#iaiArea', { force: true }); }));
      await sleep(300);
      await shot(repPages[1].pl.p, `r${round}-c-rep-zan`);
      await sleep(1600);
      await shot(spec.p, `r${round}-c-spec-after`);
    } else if (game === 'tap') {
      await sleep(4200);
      const t0 = Date.now();
      await Promise.all(repPages.map(async (r, i) => {
        const n = 30 + i * 7;
        for (let k = 0; k < n; k++) { await r.pl.p.dispatchEvent('#tapPad', 'pointerdown'); await sleep(40); }
      }));
      await shot(spec.p, `r${round}-c-spec-live`);
      await sleep(Math.max(0, 5600 - (Date.now() - t0)));
      await shot(spec.p, `r${round}-c-spec-hidden`);
      await shot(repPages[0].pl.p, `r${round}-c-rep-tap`);
      await sleep(2500);
    } else if (game === 'quiz') {
      await sleep(4300);
      for (let q = 0; q < 3; q++) {
        await admin.click('[data-act="quizNext"]');
        await sleep(3200);
        if (q === 0) { await shot(repPages[0].pl.p, `r${round}-c-rep-q`); await shot(spec.p, `r${round}-c-spec-q`); await shot(admin, `r${round}-c-admin-q`); }
        await Promise.all(repPages.map(async (r, i) => { await sleep(300 + i * 250); await r.pl.p.click(`.q-choice.c${(i + q) % 4}`); }));
        await sleep(500);
        await admin.click('[data-act="quizReveal"]');
        await sleep(800);
        if (q === 0) await shot(repPages[0].pl.p, `r${round}-c-rep-reveal`);
      }
    }
    await sleep(500);
    await shot(admin, `r${round}-d-admin-running`);
    await admin.click('[data-act="finish"]');
    await sleep(600);
    await shot(spec.p, `r${round}-e-spec-judging`);
    await shot(admin, `r${round}-e-admin-judging`);
    await admin.click('[data-act="publish"]');
    await sleep(1200 + 1600 + 5 * 1500 + 1600);
    await shot(spec.p, `r${round}-f-spec-results`);
    await shot(admin, `r${round}-f-admin-results`);
    const res = (await (await fetch(BASE + '/__mock/get?path=results/r' + round)).json()).value;
    console.log(`round ${round} results:`, Object.values(res.rows).map(r => `${r.team}:${r.rank ?? '-'}位 ${r.pts}pt (${r.detail})`).join(' | '));
    if (round < 4) await admin.click('[data-act="next"]');
    else await admin.click('[data-act="final"]');
    await sleep(800);
  }
  await sleep(1500 + 2200 + 4 * 1900 + 2500);
  await shot(players[0].p, 'z-final-player');
  await shot(admin, 'z-final-admin');
  const champ = await players[3].p.textContent('.champion');
  console.log('champion text:', champ.replace(/\s+/g, ' '));
  // 再読み込みしても参加情報が残るか
  await players[2].p.reload();
  await players[2].p.waitForSelector('#fv, #lobbyMain', { timeout: 8000 });
  const meName = await players[2].p.textContent('#meBox');
  console.log('after reload meBox:', meName);
  const log = await (await fetch(BASE + '/__mock/log')).json();
  const denied = log.filter(l => !l.ok);
  console.log('denied writes:', denied.length, JSON.stringify(denied.slice(0, 12)));
  console.log('page errors:', errors.length, errors.slice(0, 15).join('\n'));
  await browser.close();
})().catch(e => { console.error('E2E FAILED', e); console.log('page errors:', errors.join('\n')); process.exit(1); });
