// 説明スライド（司会者のボタンで全員のスマホに同時表示）と、Web制作クイズの解説表示の試験
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
  p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'リセット' : undefined));
  return p;
}
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: false });
const overflow = p => p.evaluate(() => {
  const W = Math.min(innerWidth, screen.width || innerWidth);
  const bad = [];
  document.querySelectorAll('#explain *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > W + 1 || r.left < -1)) bad.push(el.className || el.tagName);
  });
  return bad.slice(0, 5);
});
const explainText = p => p.evaluate(() => document.querySelector('#explain')?.innerText || '');

(async () => {
  await fetch(BASE + '/__mock/reset', { method: 'POST' });
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const admin = await newPage(browser, 'admin', 'iPhone 13'); // 司会者もスマホで操作する想定
  await admin.goto(BASE + '/admin.html?mock');
  await admin.fill('#em', 'a@a'); await admin.fill('#pw', 'mock'); await admin.click('#loginForm button');
  await admin.waitForSelector('.tabs');

  // Web制作クイズを登録
  await admin.click('[data-tab="quiz"]');
  await admin.click('[data-act="sampleQuiz"]'); await sleep(400);
  const bank = await get('quizBank');
  check(Object.keys(bank || {}).length === 10 && !!bank.w01?.note && Object.keys(bank.w10?.choices || {}).length === 4, 'Web制作クイズ10問（解説つき）が登録される');
  await admin.click('[data-act="sampleQuiz"]'); await sleep(400); // 2回目は入れ替え（確認ダイアログ→OK）
  check(Object.keys(await get('quizBank')).length === 10, '入れ替えても10問のまま（重複しない）');
  await shot(admin, 'X0-admin-quiz');
  await admin.click('[data-tab="control"]'); await sleep(200);

  // 参加者（SE と iPhone 13 を混ぜる）
  const P = {};
  for (const [i, t] of TEAMS.entries()) {
    const p = await newPage(browser, t, i % 2 ? 'iPhone 13' : 'iPhone SE');
    await p.goto(BASE + `/index.html?mock&p=${t}`);
    await p.waitForSelector('#nameIn');
    await p.fill('#nameIn', `選手${t}`); await p.click(`.team-btn[data-team="${t}"]`); await p.click('#joinBtn');
    await p.waitForSelector('#lobbyMain');
    P[t] = { p };
  }
  // 未登録の人には出ない
  const guest = await newPage(browser, 'guest', 'iPhone SE');
  await guest.goto(BASE + '/index.html?mock&p=guest'); await guest.waitForSelector('#nameIn');

  // ① 大会の説明
  await admin.click('[data-act="explainOpen"][data-key="opening"]'); await sleep(500);
  check((await get('state/explain'))?.key === 'opening', '管理：大会の説明を開始');
  for (const t of TEAMS) check((await explainText(P[t].p)).includes('チーム対抗ゲーム大会、はじめます'), `${t}: 1ページ目が全画面で出る`);
  check(!(await guest.$('#explain')), '未登録の人には説明を出さない（登録画面のまま）');
  check((await admin.textContent('.explain-ctl')).includes('1 / 5'), '管理：プレビューとページ数');
  await shot(P.A.p, 'X1-opening-1__iPhoneSE'); await shot(admin, 'X1-admin-opening-1');
  for (let i = 2; i <= 5; i++) {
    await admin.click('[data-act="explainMove"][data-d="1"]'); await sleep(450);
    const txt = await explainText(P.B.p);
    check(txt.includes(`${i}\n / 5`) || txt.includes(`${i} / 5`), `B: ${i}ページ目に同時に進む`);
    check((await overflow(P.A.p)).length === 0, `A(SE): ${i}ページ目ははみ出しなし`);
    await shot(P.A.p, `X1-opening-${i}__iPhoneSE`);
  }
  await admin.click('[data-act="explainMove"][data-d="-1"]'); await sleep(400);
  check((await explainText(P.C.p)).includes('4 / 5') || (await explainText(P.C.p)).includes('4\n / 5'), 'C: 前へで戻る');
  await admin.click('[data-act="explainMove"][data-d="1"]'); await sleep(300);
  await admin.click('[data-act="explainClose"]'); await sleep(600);
  check(!(await P.A.p.$('#explain')) && !(await get('state/explain')), '説明を終わると全員元の画面に戻る');

  // 途中参加：説明中に登録した人にも、今のページが出る
  await admin.click('[data-act="explainOpen"][data-key="ten"]'); await sleep(400);
  await admin.click('[data-act="explainMove"][data-d="1"]'); await sleep(300);
  await guest.fill('#nameIn', '遅刻さん'); await guest.click('.team-btn[data-team="A"]'); await guest.click('#joinBtn');
  await sleep(800);
  check((await explainText(guest)).includes('遊び方'), '説明中に登録した人にも今のページ（遊び方）が出る');
  await shot(guest, 'X2-ten-2__iPhoneSE');
  await admin.click('[data-act="explainMove"][data-d="1"]'); await sleep(300);
  await admin.click('[data-act="explainMove"][data-d="1"]'); await sleep(400);
  check((await explainText(P.D.p)).includes('チームで代表者を1人決めよう'), 'D: 最終ページ（代表者決め）');
  await shot(P.C.p, 'X2-ten-4__iPhoneSE'); await shot(admin, 'X2-admin-ten-4');

  // 最終ページでは「閉じて代表者を決める」で自分の画面だけ閉じて、わたしが出るを押せる
  await P.E.p.click('#explainClose'); await sleep(300);
  check(!(await P.E.p.$('#explain')), 'E: 最終ページで自分の画面だけ閉じられる');
  await P.E.p.click('#pickBtn'); await sleep(400);
  check(!!(await get('pick/E')), 'E: 閉じたあと「わたしが出る」を押せる');
  check(!!(await P.D.p.$('#explain #explainClose')), 'D: まだ決まっていないチームには閉じるボタンが出ている');
  // ほかのチームは説明画面の裏で押した扱い（DOM から直接）→ 発表で説明は自動で閉じる
  for (const t of ['A', 'B', 'C', 'D']) await P[t].p.evaluate(() => document.querySelector('#pickBtn')?.click());
  await sleep(500);
  check(!(await P.A.p.$('#explainClose')), 'A: チームの代表が決まったら閉じるボタンは消える');
  await admin.click('[data-act="announce"]'); await sleep(600);
  check(!(await get('state/explain')), '代表者発表で説明は自動で閉じる');

  // 準備画面で説明を出す→代表者は「閉じて準備OK」で自分だけ閉じられる
  await admin.click('[data-act="explainOpen"][data-key="ten"]'); await sleep(400);
  for (let i = 0; i < 3; i++) { await admin.click('[data-act="explainMove"][data-d="1"]'); await sleep(250); }
  await sleep(300);
  check((await explainText(P.A.p)).includes('代表者は前へ'), '準備中は最終ページが「代表者は前へ」になる');
  await P.A.p.click('#explainClose'); await sleep(300);
  check(!(await P.A.p.$('#explain')), '代表者は自分の画面だけ閉じられる');
  await P.A.p.click('#okBtn'); await sleep(300);
  check(!!(await P.B.p.$('#explain')), 'ほかの人の説明は続いている');
  await admin.click('[data-act="start"]'); await sleep(500);
  check(!(await get('state/explain')) && !(await P.B.p.$('#explain')), 'スタートで説明は閉じる');
  // ゲームを終わらせる
  await sleep(4500 + 10500);
  for (const t of TEAMS) await P[t].p.click('#stopBtn', { force: true }).catch(() => {});
  await sleep(600);
  await admin.click('[data-act="finish"]'); await sleep(500);
  await admin.click('[data-act="publish"]'); await sleep(500);
  await admin.click('[data-act="next"]'); await sleep(600);

  // GAME 2 クイズ：解説の表示
  check(!(await get('state/explain')), '次のゲームへ進むと説明は残らない');
  const gtxt = await admin.textContent('.explain-ctl');
  check(gtxt.includes('早押しクイズ') && !gtxt.includes('大会の説明を始める'), '2ゲーム目以降はそのゲームの説明ボタンが主');
  await admin.click('[data-act="autoQuiz"]'); await sleep(300);
  for (const t of TEAMS) await P[t].p.evaluate(() => document.querySelector('#pickBtn')?.click());
  await sleep(500);
  await admin.click('[data-act="announce"]'); await sleep(500);
  for (const t of TEAMS) await P[t].p.click('#okBtn').catch(() => {});
  await admin.click('[data-act="start"]'); await sleep(4300);
  await admin.click('[data-act="quizNext"]'); await sleep(3200);
  for (const t of TEAMS) await P[t].p.click('.q-choice.c1', { force: true }).catch(() => {});
  await sleep(500);
  await admin.click('[data-act="quizReveal"]'); await sleep(800);
  const note = await get('state/quiz/note');
  check(!!note, '正解発表で解説が配信される');
  const anyNote = await P.B.p.evaluate(() => document.querySelector('#qNote:not([hidden])')?.innerText || '');
  check(anyNote.includes('解説'), '参加者のスマホに解説が出る');
  await shot(P.A.p, 'X3-quiz-note__iPhoneSE'); await shot(admin, 'X3-admin-quiz-note');
  check(!(await P.A.p.$('#explain')), 'ゲーム中は説明スライドを出さない');

  console.log('page errors:', errors.length, errors.slice(0, 5).join(' | '));
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
