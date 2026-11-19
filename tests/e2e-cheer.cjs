// 応援ボタンの試験：観戦中だけ出る・どのチームにも送れる・数がみんなに見える・代表者には出ない
const { chromium, devices } = require('playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const SHOTS = process.env.OUT || path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TEAMS = ['A', 'B', 'C', 'D', 'E'];
const errors = [];
const get = async p => (await (await fetch(BASE + '/__mock/get?path=' + p)).json()).value;
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

async function newPage(browser, name, device = 'iPhone 13') {
  const ctx = await browser.newContext(device ? { ...devices[device], deviceScaleFactor: 1 } : { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  await p.route('**/*', r => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  p.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
  p.on('dialog', d => d.accept());
  return p;
}
const uidOf = p => p.evaluate(() => { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k.startsWith('mock-user-')) return JSON.parse(sessionStorage.getItem(k)).uid; } return null; });
async function join(browser, key, name, team, device) {
  const p = await newPage(browser, key, device);
  await p.goto(BASE + `/index.html?mock&p=${key}`);
  await p.waitForSelector('#nameIn');
  await p.fill('#nameIn', name); await p.click(`.team-btn[data-team="${team}"]`); await p.click('#joinBtn');
  await p.waitForSelector('#lobbyMain');
  return { p, uid: await uidOf(p) };
}

(async () => {
  await fetch(BASE + '/__mock/reset', { method: 'POST' });
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const admin = await newPage(browser, 'admin', null);
  await admin.goto(BASE + '/admin.html?mock');
  await admin.fill('#em', 'a@a'); await admin.fill('#pw', 'mock'); await admin.click('#loginForm button');
  await admin.waitForSelector('.tabs');
  const R = {};
  for (const t of TEAMS) R[t] = await join(browser, 'r' + t, `代表${t}`, t, 'iPhone 13');
  const S1 = await join(browser, 's1', '観戦いち', 'A', 'iPhone SE');
  const S2 = await join(browser, 's2', '観戦に', 'B', 'iPhone 13');
  for (const t of TEAMS) await R[t].p.click('#pickBtn');
  await sleep(500);
  check(!(await S1.p.$('#cheerBar')), '待機中は応援ボタンが出ない');
  await admin.click('[data-act="announce"]'); await sleep(500);
  check(!(await S1.p.$('#cheerBar')), '代表者発表（準備中）も出ない');
  for (const t of TEAMS) await R[t].p.click('#okBtn');
  await admin.click('[data-act="start"]');
  await sleep(1500);
  check(!!(await S1.p.$('#cheerBar')), 'ゲームが始まると観戦中の人に応援ボタンが出る');
  check(!(await R.A.p.$('#cheerBar')), '代表者には出ない');
  check((await S1.p.$$('.cheer-btn')).length === 5, '5チーム分のボタン');
  check((await S1.p.textContent('#nowBar')).includes('応援ボタン'), '「いまやること」に応援の案内');
  // 観戦いち：A に10回、C に5回（間隔をあけて）
  for (let i = 0; i < 10; i++) { await S1.p.click('.cheer-btn[data-t="A"]'); await sleep(90); }
  for (let i = 0; i < 5; i++) { await S1.p.click('.cheer-btn[data-t="C"]'); await sleep(90); }
  // 観戦に：速すぎる連打（間隔なし）は一部しか数えない
  for (let i = 0; i < 20; i++) await S2.p.dispatchEvent('.cheer-btn[data-t="B"]', 'pointerdown');
  await sleep(900);
  await S1.p.screenshot({ path: path.join(SHOTS, 'C1-cheer__iPhoneSE.png') });
  const run = (await get('state')).runId;
  const c = await get(`cheer/${run}`);
  check(c?.[S1.uid]?.A === 10 && c?.[S1.uid]?.C === 5, `どのチームにも送れて、回数が保存される（A:${c?.[S1.uid]?.A} C:${c?.[S1.uid]?.C}）`);
  check((c?.[S2.uid]?.B || 0) < 20, `速すぎる連打は数えない（20回押して${c?.[S2.uid]?.B}回）`);
  const shown = await S2.p.textContent('#ct-A');
  check(shown === '10', `ほかの人の画面にも応援数が出る（A: ${shown}）`);
  check(!(await S1.p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'SE：横にはみ出さない');
  // 再読み込みしても自分の回数を引き継ぐ
  await S1.p.reload(); await S1.p.waitForSelector('#cheerBar');
  await sleep(600);
  await S1.p.click('.cheer-btn[data-t="A"]'); await sleep(900);
  check((await get(`cheer/${run}/${S1.uid}/A`)) === 11, '再読み込み後も続きから数える');
  // ゲーム終了直前に押した分も、集計に入ってから送られる
  await sleep(Math.max(0, (await get('state')).startAt + 10500 - Date.now()));
  for (const t of TEAMS) await R[t].p.click('#stopBtn', { force: true }).catch(() => {});
  await S1.p.click('.cheer-btn[data-t="E"]'); await sleep(80);
  await admin.click('[data-act="finish"]'); await sleep(900);
  check((await get(`cheer/${run}/${S1.uid}/E`)) === 1, '終了直前の応援も記録される');
  check(!(await S1.p.$('#cheerBar')), '集計に入ると応援ボタンは消える');
  // 代表者が自分で書き込もうとしても拒否
  const status = await R.A.p.evaluate(async ({ run, uid }) => (await fetch('/__mock/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'update', uid, value: { [`cheer/${run}/${uid}/B`]: 5 } }) })).status, { run, uid: R.A.uid });
  check(status === 403, '代表者は応援を書き込めない');

  console.log('page errors:', errors.length, errors.slice(0, 5).join(' | '));
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
