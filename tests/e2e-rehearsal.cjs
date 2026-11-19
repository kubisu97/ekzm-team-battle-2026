// リハーサルモードの通し試験：管理者1人（スマホ）＋管理画面内の参加者画面＋ダミーで4ゲームを通す
const { chromium, devices } = require('playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const SHOTS = process.env.OUT || path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const get = async p => (await (await fetch(BASE + '/__mock/get?path=' + p)).json()).value;
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const isDummy = u => String(u).startsWith('rh_');

async function newPage(browser, name, device) {
  const ctx = await browser.newContext({ ...devices[device], deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.route('**/*', r => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  p.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
  p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'リセット' : undefined));
  return p;
}
const shot = (p, n, full = false) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: full });
async function waitFor(fn, ms = 30000, step = 400) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return true; await sleep(step); }
  return false;
}
const overflowX = p => p.evaluate(() => document.documentElement.scrollWidth > Math.min(innerWidth, screen.width || innerWidth) + 1);

(async () => {
  await fetch(BASE + '/__mock/reset', { method: 'POST' });
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const admin = await newPage(browser, 'admin', 'iPhone 13');
  await admin.goto(BASE + '/admin.html?mock');
  await admin.fill('#em', 'a@a'); await admin.fill('#pw', 'mock'); await admin.click('#loginForm button');
  await admin.waitForSelector('.tabs');
  await admin.click('[data-tab="quiz"]'); await admin.click('[data-act="sampleQuiz"]'); await sleep(300);

  // ① リハーサル開始
  await admin.click('[data-tab="setup"]'); await sleep(200);
  await shot(admin, 'R0-setup-card', true);
  await admin.selectOption('#rhN', '3');
  await admin.click('[data-act="rhStart"]'); await sleep(800);
  const members = await get('members');
  const dummies = Object.keys(members || {}).filter(isDummy);
  check(dummies.length === 15, `ダミーが15人入る（${dummies.length}人）`);
  check((await get('config/rehearsal')) === true, 'リハーサル中フラグ');
  check((await admin.textContent('.rh-bar')).includes('リハーサル中'), '管理画面にリハーサル中の帯');
  check(await admin.$('[data-tab="control"].on') !== null, '開始後は進行タブに移る');
  // 本物の参加者（手伝いの幹事）も一緒に参加できる
  const helper = await newPage(browser, 'helper', 'iPhone SE');
  await helper.goto(BASE + '/index.html?mock&p=helper');
  await helper.waitForSelector('#nameIn');
  await helper.fill('#nameIn', 'お手伝い'); await helper.click('.team-btn[data-team="B"]'); await helper.click('#joinBtn');
  await helper.waitForSelector('#lobbyMain');
  check(await helper.evaluate(() => document.body.classList.contains('rehearsal')), '参加者の画面にも REHEARSAL 表示');
  check(!(await overflowX(helper)), 'SE：REHEARSAL 表示で横にはみ出さない');
  await shot(helper, 'R1-helper-lobby__iPhoneSE');

  // ② 自分も参加者として見る（管理画面の中に参加者の画面）
  await admin.click('[data-act="rhPreview"]'); await sleep(300);
  const fr = admin.frameLocator('#pvFrame');
  await fr.locator('#nameIn').waitFor();
  await fr.locator('#nameIn').fill('くりす');
  await fr.locator('.team-btn[data-team="A"]').click();
  await fr.locator('#joinBtn').click();
  await fr.locator('#lobbyMain').waitFor();
  check(true, '管理画面の中で参加者として登録できる');
  await shot(admin, 'R2-preview-lobby');

  // ③ GAME 1：自分（A）が代表。ほかのチームはダミーが立候補
  await fr.locator('#pickBtn').click();
  await helper.click('#pickBtn'); // B はお手伝いの人が代表
  check(await waitFor(async () => { const p = await get('pick'); return p && ['C', 'D', 'E'].every(t => isDummy(p[t])); }, 12000), 'C〜Eはダミーが自動で立候補（数秒）');
  await admin.click('#pvBack'); await sleep(300);
  await admin.click('[data-act="announce"]'); await sleep(500);
  await admin.click('[data-act="rhPreview"]'); await sleep(200);
  await fr.locator('#okBtn').click();
  await helper.click('#okBtn');
  const st1 = await get('state');
  check(await waitFor(async () => { const pr = await get(`prog/${st1.runId}`); return Object.values(st1.reps).every(u => pr?.[u]?.ok); }, 8000), 'ダミーの代表も自動で準備OK');
  await admin.click('#pvBack'); await sleep(200);
  await admin.click('[data-act="start"]');
  await admin.click('[data-act="rhPreview"]');
  await sleep(4000 + 9800);
  await fr.locator('#stopBtn').click({ force: true });
  await helper.click('#stopBtn', { force: true });
  await sleep(2000);
  await shot(admin, 'R3-preview-ten');
  const subs1 = await get(`subs/${st1.runId}`);
  check(Object.values(st1.reps).every(u => subs1?.[u]?.res), '全チームの記録が届く（ダミー含む）');
  await admin.click('#pvBack'); await sleep(200);
  await admin.click('[data-act="finish"]'); await sleep(400);
  await shot(admin, 'R4-admin-judging', true);
  await admin.click('[data-act="publish"]'); await sleep(500);
  check(Object.keys((await get('results/r1'))?.rows || {}).length === 5, 'GAME 1 の結果が5チーム分出る');
  await admin.click('[data-act="next"]'); await sleep(500);

  // ④ GAME 2 クイズ：自分は観戦。A チームは20秒待ってダミーが立候補（B はお手伝いの人が代表を譲る想定でダミーに任せる）
  const t0 = Date.now();
  check(await waitFor(async () => { const p = await get('pick'); return p && L5(p); }, 30000), '本物がいるチームは約20秒後にダミーが代わりに立候補');
  function L5(p) { return ['A', 'B', 'C', 'D', 'E'].every(t => p[t] && isDummy(p[t])); }
  check(Date.now() - t0 > 15000, '本物がいるチームは、すぐには立候補しない');
  await admin.click('[data-act="autoQuiz"]'); await sleep(300);
  await admin.click('[data-act="announce"]'); await sleep(3500);
  await admin.click('[data-act="start"]'); await sleep(4300);
  const st2 = await get('state');
  for (let i = 0; i < 3; i++) {
    await admin.click('[data-act="quizNext"]');
    check(await waitFor(async () => { const pr = await get(`prog/${st2.runId}`); return Object.values(st2.reps).every(u => pr?.[u]?.['q' + i]); }, 16000), `第${i + 1}問：ダミー全員が回答`);
    await admin.click('[data-act="quizReveal"]'); await sleep(600);
    if (i === 0) { await admin.click('[data-act="rhPreview"]'); await sleep(500); await shot(admin, 'R5-preview-quiz'); await admin.click('#pvBack'); }
  }
  await admin.click('[data-act="finish"]'); await sleep(300);
  await admin.click('[data-act="publish"]'); await sleep(400);
  await admin.click('[data-act="next"]'); await sleep(400);

  // ⑤ GAME 3・4 はダミーだけ（自分たちは立候補しない）
  for (const g of ['iai', 'tap']) {
    check(await waitFor(async () => { const p = await get('pick'); return p && L5(p); }, 30000), `${g}：全チームの代表がそろう`);
    await admin.click('[data-act="announce"]'); await sleep(3500);
    await admin.click('[data-act="start"]');
    const st = await get('state');
    if (g === 'tap') { // お手伝いの人は観戦しながら応援ボタンを押す
      await helper.waitForSelector('#cheerBar');
      for (let i = 0; i < 12; i++) { await helper.click('.cheer-btn[data-t="B"]'); await sleep(90); }
    }
    await sleep(4000 + (g === 'iai' ? Number(st.iaiDelay) + 1500 : 8000) - (g === 'tap' ? 1300 : 0));
    if (g === 'tap') {
      const live = await get(`live/${st.runId}`);
      check(live && Object.keys(live).length === 5, '連打：ダミーのライブ連打数が流れる');
    }
    const s = await get(`subs/${st.runId}`);
    check(Object.values(st.reps).every(u => s?.[u]?.res), `${g}：全チームの記録が届く`);
    await admin.click('[data-act="finish"]'); await sleep(300);
    await admin.click('[data-act="publish"]'); await sleep(400);
    await admin.click(`[data-act="${g === 'tap' ? 'final' : 'next'}"]`); await sleep(400);
  }
  check((await get('state/phase')) === 'final', '総合結果まで進む');
  await sleep(9000);
  await shot(helper, 'R6-helper-final__iPhoneSE', true);
  const cheerAll = await get('cheer');
  check(cheerAll && Object.keys(cheerAll).length >= 3, '観戦中のダミーも応援ボタンを押している');
  // 個人賞の発表（受賞者は記録から自動で決まる）
  check((await admin.textContent('.award-ctl')).includes('応援団長賞'), '管理画面に個人賞の発表ボタン');
  await admin.click('[data-act="announceAwards"]'); await sleep(800);
  const aw = await get('state/awards');
  const list = Object.values(aw?.list || {});
  check(list.length === 2 && list[0].title === '応援団長賞' && list[1].title === '神の体内時計賞', '個人賞2つ（応援団長賞・神の体内時計賞）');
  check(Object.values(list[0].winners || {}).length >= 1 && Object.values(list[1].winners || {}).length >= 1, '受賞者が自動で決まる');
  await helper.waitForSelector('#awards');
  check(true, 'お手伝いの人のスマホに個人賞の発表が出る');
  await sleep(2600); await shot(helper, 'R7-awards-1__iPhoneSE');
  await sleep(5000); await shot(helper, 'R7-awards-2__iPhoneSE');
  await helper.waitForSelector('#awClose:not([hidden])', { timeout: 6000 });
  await helper.click('#awClose'); await sleep(300);
  check(!(await helper.$('#awards')), '閉じると総合結果の画面に戻る');
  await shot(admin, 'R7-admin-awards', true);

  // ⑥ リハーサルを終わる
  await admin.click('[data-act="rhEnd"]'); await sleep(800);
  const m2 = await get('members');
  check(!Object.keys(m2 || {}).some(isDummy), 'ダミーが消える');
  check(Object.keys(m2 || {}).length === 2, '本物の参加者（自分・お手伝い）の登録は残る');
  check(!(await get('results')) && (await get('state/phase')) === 'lobby' && (await get('state/round')) === 1, '得点がリセットされて GAME 1 の待機に戻る');
  check(!(await get('config/rehearsal')), 'リハーサル中フラグが消える');
  const slots = await get('slots');
  check(Object.values(slots || {}).every(o => Object.values(o).every(u => !isDummy(u))), 'ダミーの枠も空く');
  check(!(await admin.$('.rh-bar')), '管理画面の帯が消える');
  await sleep(500);
  check(!(await helper.evaluate(() => document.body.classList.contains('rehearsal'))), '参加者の REHEARSAL 表示も消える');

  console.log('page errors:', errors.length, errors.slice(0, 5).join(' | '));
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
