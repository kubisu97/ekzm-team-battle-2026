// 例外系の通し試験：フライング、途中リロード→再挑戦許可、やり直し、受付締切、削除
const { chromium, devices } = require('playwright');
const BASE = 'http://localhost:8080';
const SHOTS = require('path').join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TEAMS = ['A', 'B', 'C', 'D', 'E'];
const errors = [];
const get = async p => (await (await fetch(BASE + '/__mock/get?path=' + p)).json()).value;
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

async function newPage(browser, name, mobile = true) {
  const ctx = await browser.newContext(mobile ? { ...devices['iPhone 13'], deviceScaleFactor: 1 } : { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  await p.route('**/*', r => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  p.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
  p.on('dialog', d => d.accept(d.type() === 'prompt' ? (d.message().includes('初期化') ? '初期化' : 'リセット') : undefined));
  return p;
}
const uidOf = p => p.evaluate(() => { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k.startsWith('mock-user-')) return JSON.parse(sessionStorage.getItem(k)).uid; } return null; });

(async () => {
  await fetch(BASE + '/__mock/reset', { method: 'POST' });
  const browser = await chromium.launch();
  const admin = await newPage(browser, 'admin', false);
  await admin.goto(BASE + '/admin.html?mock');
  await admin.fill('#em', 'a@a'); await admin.fill('#pw', 'mock'); await admin.click('#loginForm button');
  await admin.waitForSelector('.tabs');
  const P = {};
  for (const t of TEAMS) {
    const p = await newPage(browser, t);
    await p.goto(BASE + `/index.html?mock&p=${t}`);
    await p.waitForSelector('#nameIn');
    await p.fill('#nameIn', `選手${t}`); await p.click(`.team-btn[data-team="${t}"]`); await p.click('#joinBtn');
    await p.waitForSelector('#lobbyMain');
    P[t] = { p, uid: await uidOf(p) };
  }
  // 居合斬り
  await admin.selectOption('#gameSel', 'iai');
  await sleep(300);
  // 立候補→交代→辞退→再立候補
  await P.A.p.click('#pickBtn'); await sleep(300);
  check((await get('pick/A')) === P.A.uid, 'A: 立候補できる');
  await P.A.p.click('#unpickBtn'); await sleep(300);
  check(!(await get('pick/A')), 'A: 辞退できる');
  for (const t of TEAMS) { await P[t].p.click('#pickBtn'); }
  await sleep(500);
  check((await admin.textContent('#tabBody')).includes('5/5 チーム決定'), '管理画面に全チーム決定が表示');
  await admin.click('[data-act="announce"]'); await sleep(500);
  for (const t of TEAMS) await P[t].p.click('#okBtn');
  await sleep(300);
  await admin.click('[data-act="start"]');
  await sleep(4400); // 構え表示中
  await P.A.p.click('#iaiArea'); // フライング
  await sleep(200);
  check((await P.A.p.textContent('#iaiText')).includes('フライング'), 'A: 構え中のタップでフライング表示');
  await P.B.p.reload(); // 途中リロード
  await P.B.p.waitForSelector('.warn h2');
  check((await P.B.p.textContent('#app')).includes('挑戦が中断されました'), 'B: 途中リロードでロック表示');
  await shot(P.B.p, 'edge-locked');
  const st = await get('state');
  await sleep(Math.max(0, Number(st.startAt) + Number(st.iaiDelay) - Date.now()) + 300);
  for (const t of ['C', 'D', 'E']) await P[t].p.click('#iaiArea', { force: true });
  await sleep(500);
  // 管理者が B に再挑戦を許可
  await admin.click(`[data-act="retryOne"][data-uid="${P.B.uid}"]`);
  await P.B.p.waitForSelector('#iaiArea', { timeout: 5000 });
  check(true, 'B: 再挑戦許可で画面が戻る');
  await sleep(3300 + Number(st.iaiDelay) + 300);
  await P.B.p.click('#iaiArea', { force: true });
  await sleep(600);
  const subs = await get(`subs/${st.runId}`);
  check(subs[P.A.uid]?.res?.f === true, 'A: フライングが記録された');
  check(subs[P.B.uid]?.res && subs[P.B.uid].res.f === false, 'B: 再挑戦の記録が届いた');
  // 二重送信（ブラウザから直接）→ 拒否
  const dup = await P.C.p.evaluate(async ({ run, uid }) => {
    const r = await fetch('/__mock/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'update', uid, value: { [`subs/${run}/${uid}/res`]: { v: 1, at: { '.sv': 'timestamp' } } } }) });
    return r.status;
  }, { run: st.runId, uid: P.C.uid });
  check(dup === 403, 'C: 同じラウンドの二重送信は拒否');
  await admin.click('[data-act="finish"]'); await sleep(500);
  const judging = await admin.textContent('#tabBody');
  check(/失格/.test(judging) || /フライング/.test(judging), '集計画面に失格が表示');
  await shot(admin, 'edge-judging');
  // 手動修正：Aを3位に
  await admin.selectOption('.ovr[data-team="A"]', '3'); await sleep(300);
  await admin.click('[data-act="publish"]'); await sleep(600);
  const r1 = await get('results/r1');
  check(r1.rows.A.rank === 3 && r1.rows.A.manual === true, '手動修正した順位が保存');
  // やり直し
  await admin.click('[data-tab="setup"]'); await sleep(200);
  await admin.click('[data-act="redo"]'); await sleep(500);
  const st2 = await get('state');
  check(st2.phase === 'ready' && st2.runId !== st.runId && !(await get('results/r1')), 'やり直しで結果が消え代表者発表に戻る');
  // 受付締切 → 新規参加不可
  await admin.click('[data-tab="members"]'); await sleep(200);
  await admin.click('[data-act="toggleReg"]'); await sleep(300);
  const late = await newPage(browser, 'late');
  await late.goto(BASE + '/index.html?mock&p=late');
  await late.waitForSelector('#nameIn');
  check((await late.textContent('#regMsg')).includes('締め切'), '締切後は登録できない表示');
  // 削除 → 本人は登録画面に戻る（代表者以外）
  await admin.click('[data-act="toggleReg"]'); await sleep(300);
  await late.fill('#nameIn', '遅刻者'); await late.click('.team-btn[data-team="A"]'); await late.click('#joinBtn');
  await late.waitForSelector('#lobbyMain, #app .game-intro', { timeout: 5000 });
  const lateUid = await uidOf(late);
  await admin.click(`[data-act="kick"][data-uid="${lateUid}"]`); await sleep(600);
  check(!!(await late.$('#nameIn')), '削除された人は登録画面に戻る');
  // 総合リセット
  await admin.click('[data-tab="setup"]'); await sleep(200);
  await admin.click('[data-act="resetAll"]'); await sleep(600);
  check(!(await get('members')) && (await get('state')).phase === 'lobby', '全データ初期化');
  await sleep(500);
  check(!!(await P.C.p.$('#nameIn')), '初期化後、参加者は登録画面へ');
  console.log('page errors:', errors.length, errors.join('\n'));
  await browser.close();
})().catch(e => { console.error('EDGE FAILED', e); console.log(errors.join('\n')); process.exit(1); });

async function shot(p, n) { await p.screenshot({ path: `${SHOTS}/${n}.png` }); }
