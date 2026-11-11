// 通しテスト用：疑似参加者（ボット）とセキュリティ検査
// 管理者でログイン済みのブラウザでのみ動作する（admin.html で先にログイン）
import { createBackend, errMsg } from './db.js';
import * as L from './logic.js';
import { joinTeam, submitResult, markProg, sendLive } from './actions.js';
import { $, esc } from './ui.js';

const log = (msg, cls = '') => {
  const el = document.createElement('div');
  el.className = 'logline ' + cls;
  el.textContent = new Date().toLocaleTimeString() + '  ' + msg;
  $('#log').prepend(el);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitAuth = be => new Promise(res => { const off = be.onAuth(u => { if (u) { off?.(); res(u); } }); });

let adminBe = null;
const bots = [];

class Bot {
  constructor(i) {
    this.i = i;
    this.name = 'BOT' + String(i).padStart(2, '0');
    this.team = L.TEAMS[(i - 1) % 5];
    this.status = '起動中';
    this.done = new Set();
    this.timers = [];
  }
  async start() {
    this.be = await createBackend('bot-' + this.i);
    let u = this.be.user();
    if (!u) { const p = waitAuth(this.be); setTimeout(async () => { if (!this.be.user()) await this.be.signInAnon(); }, 800); u = await p; }
    this.uid = u.uid;
    const m = await this.be.get('members/' + this.uid);
    if (!m) { await joinTeam(this.be, this.name, this.team); this.status = '参加'; }
    else { this.status = '参加済'; this.team = m.team; }
    this.be.watch('state', st => this.onState(st));
    paint();
  }
  clear() { this.timers.forEach(clearTimeout); this.timers = []; }
  at(serverT, fn) { this.timers.push(setTimeout(fn, Math.max(0, serverT - this.be.serverNow()))); }
  onState(st) {
    if (!st) return;
    if (st.phase !== this.lastPhase) { this.clear(); this.lastPhase = st.phase; }
    // 待機中：自分のチームの代表が未定で、自分が未出場なら少し待ってから立候補（人間の参加者が先に押せるよう間を空ける）
    if (st.phase === 'lobby' && autoNominate() && !this.done.has('pick:' + st.round)) {
      this.done.add('pick:' + st.round);
      this.timers.push(setTimeout(async () => {
        try {
          const [cur, used] = await Promise.all([this.be.get('pick/' + this.team), this.be.get('used/' + this.uid)]);
          if (!cur && !used) { await this.be.set('pick/' + this.team, this.uid); this.status = '立候補した'; log(`${this.name} が ${this.team}チームの代表に立候補`); paint(); }
        } catch (e) { log(`${this.name} 立候補失敗: ${errMsg(e)}`, 'ng'); }
      }, 6000 + Math.random() * 9000));
    }
    if (!st.repOf?.[this.uid] || st.phase === 'lobby') { if (this.status.startsWith('代表')) this.status = '観戦'; paint(); return; }
    const run = st.runId;
    if (st.phase === 'ready' && !this.done.has(run + ':ok')) {
      this.done.add(run + ':ok'); this.status = '代表(準備OK)';
      this.timers.push(setTimeout(() => markProg(this.be, run, 'ok'), 300 + Math.random() * 1500));
    }
    if (st.phase === 'running') {
      if (st.game === 'quiz') {
        const q = st.quiz || {};
        if (q.key && q.open && !this.done.has(run + ':' + q.key)) {
          this.done.add(run + ':' + q.key);
          const think = 1200 + Math.random() * 7000;
          this.at(Number(q.at) + think, async () => {
            await markProg(this.be, run, 'g' + q.idx);
            this.submit(run, q.key, { v: Math.round(think), c: Math.floor(Math.random() * 4) });
          });
        }
        this.status = '代表(クイズ)';
      } else if (!this.done.has(run + ':play')) {
        this.done.add(run + ':play');
        this.status = '代表(プレイ)';
        this.play(st);
      }
    }
    paint();
  }
  async submit(run, key, payload) {
    try { await submitResult(this.be, run, key, payload); this.status = `送信OK ${key}=${JSON.stringify(payload)}`; }
    catch (e) { this.status = '送信NG ' + errMsg(e); log(`${this.name} 送信失敗: ${errMsg(e)}`, 'ng'); }
    paint();
  }
  play(st) {
    const run = st.runId;
    const start = Number(st.startAt);
    this.at(start, () => markProg(this.be, run, 'go'));
    if (st.game === 'ten') {
      const v = 10000 + Math.round((Math.random() - 0.5) * 1800);
      this.at(start + v, () => this.submit(run, 'res', { v }));
    } else if (st.game === 'iai') {
      const go = start + Number(st.iaiDelay);
      if (Math.random() < 0.1) this.at(go - 400, () => this.submit(run, 'res', { v: 0, f: true }));
      else { const rt = 190 + Math.round(Math.random() * 220); this.at(go + rt, () => this.submit(run, 'res', { v: rt, f: false })); }
    } else if (st.game === 'tap') {
      const rate = 6 + Math.random() * 5;
      let n = 0;
      this.at(start, () => {
        const t0 = performance.now();
        const iv = setInterval(() => {
          const e = performance.now() - t0;
          n = Math.min(L.TAP_MAX, Math.floor((e / 1000) * rate));
          if (e < L.TAP_LIVE_UNTIL) sendLive(this.be, run, n);
          if (e >= L.TAP_MS) { clearInterval(iv); n = Math.floor(7 * rate); this.submit(run, 'res', { v: n }); }
        }, 250);
        this.timers.push(setTimeout(() => clearInterval(iv), 9000));
      });
    }
  }
}

function autoNominate() { return !!document.querySelector('#autoPick')?.checked; }

function paint() {
  $('#bots').innerHTML = bots.length
    ? `<table class="tbl"><tr><th>ボット</th><th>チーム</th><th>状態</th></tr>${bots.map(b => `<tr><td>${esc(b.name)}</td><td>${b.team}</td><td><small>${esc(b.status)}</small></td></tr>`).join('')}</table>`
    : '<p class="muted">未起動</p>';
}

async function startBots() {
  const n = Math.max(1, Math.min(25, Number($('#botN').value) || 20));
  $('#startBtn').disabled = true;
  log(`ボット ${n} 体を起動します`);
  for (let i = bots.length + 1; i <= n; i++) {
    const b = new Bot(i);
    bots.push(b);
    try { await b.start(); log(`${b.name} → ${b.team}チーム`); }
    catch (e) { b.status = '失敗 ' + errMsg(e); log(`${b.name} 起動失敗: ${errMsg(e)}`, 'ng'); }
    paint();
    await sleep(150);
  }
  log('ボット起動完了', 'ok');
}

// ---------- セキュリティ検査 ----------
async function expect(name, promise, shouldPass) {
  let ok = true, msg = '';
  try { await promise; } catch (e) { ok = false; msg = e?.code || e?.message || String(e); }
  const pass = ok === shouldPass;
  const row = document.createElement('tr');
  row.innerHTML = `<td>${pass ? '✅' : '❌'}</td><td>${esc(name)}</td><td>${shouldPass ? '許可されるべき' : '拒否されるべき'}</td><td><small>${ok ? '許可された' : '拒否: ' + esc(msg)}</small></td>`;
  $('#secRows').appendChild(row);
  return pass;
}

async function securityTest() {
  $('#secBtn').disabled = true;
  $('#secRows').innerHTML = '';
  const sec = await createBackend('sec-test');
  if (!sec.user()) { const p = waitAuth(sec); await sec.signInAnon(); await p; }
  const me = sec.uid();
  const st = await sec.get('state');
  const run = st?.runId || 'run_none';
  const other = bots[0]?.uid || 'someone_else';
  const results = [];
  results.push(await expect('一般参加者が state（進行）を読む', sec.get('state'), true));
  results.push(await expect('一般参加者が members（参加者一覧）を読む', sec.get('members'), true));
  results.push(await expect('一般参加者が 進行フェーズを書き換える', sec.set('state/phase', 'results'), false));
  results.push(await expect('一般参加者が 得点（結果）を書き込む', sec.set('results/r9', { rows: { A: { pts: 999 } } }), false));
  results.push(await expect('一般参加者が 調整点を書き込む', sec.set('adjust/A', 999), false));
  results.push(await expect('一般参加者が 代表者を書き換える', sec.set('state/reps/A', me), false));
  results.push(await expect('一般参加者が クイズの答えを読む', sec.get('quizBank'), false));
  results.push(await expect('一般参加者が 管理者専用データを読む', sec.get('adminOnly'), false));
  results.push(await expect('一般参加者が 全員の記録を読む', sec.get('subs'), false));
  results.push(await expect('一般参加者が 他人の記録を読む', sec.get(`subs/${run}/${other}`), false));
  results.push(await expect('一般参加者が 他人として参加登録する', sec.set(`members/${other}x`, { name: 'なりすまし', team: 'A', slot: '0', at: sec.TS }), false));
  results.push(await expect('代表でない人が 記録を送信する', sec.update({ [`subs/${run}/${me}/res`]: { v: 10000, at: sec.TS }, [`prog/${run}/${me}/res`]: true }), false));
  results.push(await expect('他人の進行フラグを書く', sec.set(`prog/${run}/${other}/res`, true), false));
  results.push(await expect('連打数を不正に送る（代表外）', sec.set(`live/${run}/${me}`, 999), false));
  results.push(await expect('定員外の枠（9番）を取る', sec.update({ [`members/${me}`]: { name: 'テスト', team: 'A', slot: '8', at: sec.TS }, [`slots/A/8`]: me }), false));
  results.push(await expect('参加者一覧を丸ごと消す', sec.remove('members'), false));
  if (bots[0]?.be) {
    const b = bots[0];
    results.push(await expect('参加済みの人が 自分のチームを変更する', b.be.set(`members/${b.uid}/team`, 'E'), false));
    results.push(await expect('参加済みの人が 2つ目の枠を取る', b.be.set(`slots/E/7`, b.uid), false));
    if (st?.repOf?.[b.uid] && (st.phase === 'results' || st.phase === 'judging')) {
      results.push(await expect('代表者が 締切後に記録を再送信する', b.be.update({ [`subs/${run}/${b.uid}/res`]: { v: 10000, at: b.be.TS } }), false));
    }
  }
  const okN = results.filter(Boolean).length;
  log(`セキュリティ検査: ${okN}/${results.length} 合格`, okN === results.length ? 'ok' : 'ng');
  $('#secBtn').disabled = false;
}

async function duplicateTest() {
  // 代表者になっているボットが、同じラウンドで2回目の送信をして拒否されるかを確認
  const st = await adminBe.get('state');
  const rep = bots.find(b => st?.repOf?.[b.uid]);
  if (!rep || st.phase !== 'running' || st.game === 'quiz') { log('二重送信テストは、ボットが代表の「10秒/居合/連打」の対戦中に実行してください', 'ng'); return; }
  const has = await rep.be.get(`subs/${st.runId}/${rep.uid}/res`);
  if (!has) { log('まだ1回目の送信が済んでいません。少し待ってから実行してください', 'ng'); return; }
  $('#secRows').innerHTML = '';
  const r = await expect(`${rep.name} が同じラウンドで2回目の記録を送る`, submitResult(rep.be, st.runId, 'res', { v: 10000 }), false);
  log('二重送信テスト: ' + (r ? '合格（拒否された）' : '不合格'), r ? 'ok' : 'ng');
}

async function stopBots() {
  for (const b of bots) { b.clear(); }
  log('ボットの自動プレイを停止しました（参加登録は残ります。管理画面の「全データ初期化」で消せます）');
}

(async function boot() {
  paint();
  adminBe = await createBackend('admin');
  adminBe.onAuth(u => {
    const ok = !!u && u.uid === adminBe.ADMIN_UID;
    $('#gate').innerHTML = ok ? '<span class="ok">管理者ログイン済み：テストを実行できます</span>' : '<span class="warn">先に <a href="admin.html">管理画面</a> で管理者ログインしてください（このページはテスト専用です）</span>';
    $$all('[data-need-admin]').forEach(b => { b.disabled = !ok; });
  });
  $('#startBtn').addEventListener('click', startBots);
  $('#secBtn').addEventListener('click', securityTest);
  $('#dupBtn').addEventListener('click', duplicateTest);
  $('#stopBtn').addEventListener('click', stopBots);
})();

function $$all(s) { return [...document.querySelectorAll(s)]; }
