// 管理者（司会者）画面
import { createBackend, errMsg } from './db.js';
import * as L from './logic.js';
import { sfx, isMuted, setMuted } from './fx.js';
import { $, $$, esc, tvars, teamBadge, toast, scoreboardHTML, rosterHTML } from './ui.js';
import qrcode from './vendor/qrcode.mjs';

const root = $('#admin');
let be = null;
let authed = false;
const D = {
  state: undefined, config: null, members: {}, slots: {}, results: {}, adjust: {}, used: {}, online: {},
  quizBank: {}, prog: {}, live: {}, subs: {}, quizRun: null,
};
let runWatch = { runId: null, offs: [] };
let tab = 'control';
try { tab = sessionStorage.getItem('ekzm-admin-tab') || 'control'; } catch { /* noop */ }
const draft = { game: null, mult: null, reps: {}, quizCount: L.QUIZ_DEFAULT_COUNT, quizPick: [], overrides: {}, forRound: null };
let editRound = null;
let editQuizId = null;
let renderQueued = false;
let dirtyWhileFocused = false;

const PLAYER_URL = new URL('./', location.href).href.split('?')[0].replace(/admin\.html$/, '');
const ADMIN_URL = new URL('admin.html', PLAYER_URL).href;

const SAMPLE_QUIZ = [
  { text: '日本で一番大きい湖は？', choices: ['琵琶湖', '霞ヶ浦', 'サロマ湖', '猪苗代湖'], answer: 0 },
  { text: '日本で一番高い山は？', choices: ['北岳', '富士山', '奥穂高岳', '槍ヶ岳'], answer: 1 },
  { text: '12月の和風月名は？', choices: ['霜月', '神無月', '師走', '睦月'], answer: 2 },
  { text: '太陽系で一番大きな惑星は？', choices: ['土星', '天王星', '海王星', '木星'], answer: 3 },
  { text: 'サッカーで1チームがフィールドに出せる人数は？（GK含む）', choices: ['11人', '10人', '9人', '12人'], answer: 0 },
  { text: '元素記号「Fe」が表す元素は？', choices: ['フッ素', '鉄', '金', '鉛'], answer: 1 },
  { text: '将棋で対局開始時に1人が並べる駒の数は？', choices: ['16枚', '18枚', '20枚', '22枚'], answer: 2 },
  { text: '「HTML」の「M」は何の略？', choices: ['Machine', 'Media', 'Module', 'Markup'], answer: 3 },
  { text: 'CSSで文字の色を指定するプロパティは？', choices: ['color', 'font-color', 'text-color', 'foreground'], answer: 0 },
  { text: '1ダースは何個？', choices: ['10個', '12個', '20個', '24個'], answer: 1 },
];

// ---------- 起動 ----------

async function boot() {
  setupHeader();
  root.innerHTML = `<section class="card center"><div class="spinner"></div><p>接続中…</p></section>`;
  try { be = await createBackend('admin'); } catch (e) { console.error(e); root.innerHTML = `<section class="card warn">Firebase を読み込めませんでした。再読み込みしてください。</section>`; return; }
  be.onConnected(c => document.body.classList.toggle('offline', !c));
  be.onAuth(user => {
    if (user && user.uid === be.ADMIN_UID && !user.isAnonymous) {
      if (!authed) { authed = true; startWatching(); }
      $('#logoutBtn').hidden = false;
    } else {
      authed = false;
      $('#logoutBtn').hidden = true;
      if (user) { be.signOut(); toast('このアカウントは管理者ではありません', 'error', 6000); }
      renderLogin();
    }
  });
}

function setupHeader() {
  const sb = $('#soundBtn');
  const paint = () => { sb.textContent = isMuted() ? '🔇' : '🔊'; };
  paint();
  sb.addEventListener('click', () => { setMuted(!isMuted()); paint(); });
  $('#logoutBtn').addEventListener('click', async () => { if (confirm('ログアウトしますか？')) { await be.signOut(); location.reload(); } });
}

function renderLogin() {
  root.innerHTML = `<section class="card login-card">
      <div class="eyebrow">ADMIN</div><h2>🎙️ 司会者ログイン</h2>
      <form id="loginForm">
        <label class="lbl" for="em">メールアドレス</label><input id="em" class="input" type="email" autocomplete="username" required>
        <label class="lbl" for="pw">パスワード</label><input id="pw" class="input" type="password" autocomplete="current-password" required>
        <button class="btn btn-primary btn-xl" type="submit">ログイン</button>
      </form>
      <p class="fine">Firebase Authentication に登録した管理者アカウントでログインします。参加者用ページは <a href="${esc(PLAYER_URL)}">${esc(PLAYER_URL)}</a></p>
    </section>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'ログイン中…';
    try { await be.signInEmail($('#em').value.trim(), $('#pw').value); }
    catch (err) { toast(errMsg(err), 'error', 6000); btn.disabled = false; btn.textContent = 'ログイン'; }
  });
}

// ---------- データ購読 ----------
function startWatching() {
  root.innerHTML = `<section class="card center"><div class="spinner"></div><p>データ読み込み中…</p></section>`;
  const keys = { state: 'state', config: 'config', members: 'members', slots: 'slots', results: 'results', adjust: 'adjust', used: 'used', online: 'online', quizBank: 'quizBank' };
  for (const [k, path] of Object.entries(keys)) {
    be.watch(path, v => {
      D[k] = k === 'state' ? (v ?? null) : (v || (k === 'config' ? null : {}));
      if (k === 'state') { syncRun(); if (v === null) initIfEmpty(); }
      queueRender();
    }, e => toast('読み込みエラー：' + errMsg(e), 'error', 8000));
  }
  setInterval(() => { if (D.state?.phase === 'running') queueRender(); }, 500);
  root.addEventListener('focusout', () => { if (dirtyWhileFocused) setTimeout(queueRender, 50); });
}

function syncRun() {
  const runId = D.state?.runId || null;
  if (runWatch.runId === runId) return;
  runWatch.offs.forEach(f => f());
  runWatch = { runId, offs: [] };
  D.prog = {}; D.live = {}; D.subs = {}; D.quizRun = null;
  if (!runId) return;
  runWatch.offs.push(be.watch(`prog/${runId}`, v => { D.prog = v || {}; queueRender(); }));
  runWatch.offs.push(be.watch(`live/${runId}`, v => { D.live = v || {}; queueRender(); }));
  runWatch.offs.push(be.watch(`subs/${runId}`, v => { D.subs = v || {}; queueRender(); }));
  runWatch.offs.push(be.watch(`adminOnly/quizRun/${runId}`, v => { D.quizRun = v || null; queueRender(); }));
}

async function initIfEmpty() {
  try {
    const cur = await be.get('state');
    if (cur) return;
    await be.update({ state: initialState(), config: D.config || defaultConfig(5) });
    toast('ゲームデータを初期化しました', 'ok');
  } catch (e) { toast('初期化に失敗：' + errMsg(e), 'error', 8000); }
}

function initialState() {
  return { round: 1, game: L.ROUND_GAMES[0], mult: L.DEFAULT_MULT[0], phase: 'lobby', startAt: 0, iaiDelay: 0, revealAt: 0, updatedAt: be.TS };
}
function defaultConfig(cap) {
  return { regOpen: true, teamCap: cap, slots: Object.fromEntries(Array.from({ length: cap }, (_, i) => [String(i), true])) };
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  // 画面が非表示だと requestAnimationFrame が止まるため、タイマーでも必ず描画する
  const run = () => { if (!renderQueued) return; renderQueued = false; render(); };
  requestAnimationFrame(run);
  setTimeout(run, 120);
}

// ---------- 描画 ----------
const TABS = [['control', '🎮 進行'], ['members', '👥 参加者'], ['score', '🏆 得点'], ['quiz', '❓ クイズ'], ['setup', '📲 QR・設定']];

function render() {
  if (!authed) return;
  const ae = document.activeElement;
  if (ae && root.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.dataset.live !== '1') { dirtyWhileFocused = true; return; }
  dirtyWhileFocused = false;
  if (D.state === undefined) return;
  if (!D.state) { root.innerHTML = `<section class="card center"><div class="spinner"></div><p>初期化中…</p></section>`; return; }
  const st = D.state;
  const nMembers = Object.keys(D.members || {}).length;
  const nOnline = Object.keys(D.online || {}).length;
  const scroll = window.scrollY;
  root.innerHTML = `
    <section class="card status-card">
      <div class="status-row">
        <span class="chip big">GAME ${st.round}/4</span>
        <span class="chip phase ph-${st.phase}">${esc(L.PHASE_LABEL[st.phase] || st.phase)}</span>
        <span class="chip">${L.GAMES[st.game]?.icon || ''} ${esc(L.GAMES[st.game]?.title || '')}${Number(st.mult) > 1 ? ' ×' + st.mult : ''}</span>
        <span class="chip">参加 ${nMembers}人・接続 ${nOnline}</span>
      </div>
    </section>
    <nav class="tabs">${TABS.map(([k, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
    <div id="tabBody">${tabBody()}</div>`;
  window.scrollTo(0, scroll);
  afterRender();
}

function tabBody() {
  switch (tab) {
    case 'members': return membersTab();
    case 'score': return scoreTab();
    case 'quiz': return quizTab();
    case 'setup': return setupTab();
    default: return controlTab();
  }
}

function membersOf(team) {
  return Object.entries(D.members || {}).filter(([, m]) => m.team === team).map(([uid, m]) => ({ uid, ...m })).sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
}
const usedRounds = uid => Object.keys(D.used?.[uid] || {}).map(k => k.replace('r', 'R')).join('・');
const nameOf = uid => D.members?.[uid]?.name ?? '（退出）';

// ----- 進行タブ -----
function controlTab() {
  const st = D.state;
  if (draft.forRound !== st.round + ':' + st.phase && st.phase === 'lobby') {
    draft.forRound = st.round + ':' + st.phase;
    draft.game = st.game || L.ROUND_GAMES[st.round - 1];
    draft.mult = Number(st.mult) || L.DEFAULT_MULT[st.round - 1];
    draft.reps = { ...(st.reps || {}) };
    draft.overrides = {};
  }
  switch (st.phase) {
    case 'ready': return readyPanel(st);
    case 'running': return runningPanel(st);
    case 'judging': return judgingPanel(st);
    case 'results': return resultsPanel(st);
    case 'final': return finalPanel(st);
    default: return lobbyPanel(st);
  }
}

function lobbyPanel(st) {
  const g = draft.game;
  const bank = Object.entries(D.quizBank || {});
  const pickedOk = g !== 'quiz' || draft.quizPick.filter(id => D.quizBank?.[id]).length === Number(draft.quizCount);
  const allReps = L.TEAMS.every(t => draft.reps[t] && D.members?.[draft.reps[t]]?.team === t);
  return `
  <section class="card">
    <div class="card-head"><h2>① ゲームと代表者を選ぶ</h2></div>
    <div class="grid2">
      <label class="lbl">ゲーム<select class="input" id="gameSel">${L.ROUND_GAMES.map(k => `<option value="${k}" ${g === k ? 'selected' : ''}>${L.GAMES[k].icon} ${L.GAMES[k].title}</option>`).join('')}</select></label>
      <label class="lbl">得点倍率<select class="input" id="multSel"><option value="1" ${draft.mult === 1 ? 'selected' : ''}>×1</option><option value="2" ${draft.mult === 2 ? 'selected' : ''}>×2（最終ゲーム）</option></select></label>
    </div>
    <p class="note">${esc(L.GAMES[g].rule)}</p>
    <div class="card-head"><h3>各チームの代表者</h3><button class="btn btn-sm" data-act="autoReps">🎲 未出場からおまかせ</button></div>
    <div class="rep-pick">${L.TEAMS.map(t => {
      const ms = membersOf(t);
      const sel = draft.reps[t] || '';
      return `<div class="rp-row" style="${tvars(t)}">${teamBadge(t)}
        <select class="input rep-sel" data-team="${t}"><option value="">— 選択 —</option>${ms.map(m => `<option value="${m.uid}" ${sel === m.uid ? 'selected' : ''}>${esc(m.name)}${D.used?.[m.uid] ? `（${usedRounds(m.uid)}出場済）` : ''}</option>`).join('')}</select>
        <small class="muted">未出場 ${ms.filter(m => !D.used?.[m.uid]).length}/${ms.length}</small></div>`;
    }).join('')}</div>
    ${g === 'quiz' ? `
      <div class="card-head"><h3>出題する問題</h3>
        <span class="row"><select class="input input-sm" id="qCount">${Array.from({ length: L.QUIZ_MAX_COUNT }, (_, i) => `<option ${Number(draft.quizCount) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>問
        <button class="btn btn-sm" data-act="autoQuiz">🎲 未使用から選ぶ</button></span></div>
      ${bank.length ? `<ol class="qpick">${bank.map(([id, q]) => `<li><label><input type="checkbox" class="qp" value="${id}" ${draft.quizPick.includes(id) ? 'checked' : ''}> ${esc(q.text)} ${q.used ? '<small class="played">使用済</small>' : ''}</label></li>`).join('')}</ol>` : '<p class="note warn">問題がありません。「❓ クイズ」タブで問題を登録してください。</p>'}
      <p class="muted">選択中：${draft.quizPick.filter(id => D.quizBank?.[id]).length} / ${draft.quizCount}問（選んだ順に出題）</p>` : ''}
    <button class="btn btn-primary btn-xl" data-act="announce" ${pickedOk ? '' : 'disabled'}>代表者を発表する ▶</button>
    ${allReps ? '' : '<p class="fine warn">※ 代表者が未選択のチームがあります（そのチームは不参加で進行できます）</p>'}
  </section>
  ${scoreboardHTML(D.results, D.adjust, { compact: true })}`;
}

function readyPanel(st) {
  const reps = st.reps || {};
  const okN = Object.values(reps).filter(u => D.prog?.[u]?.ok).length;
  return `<section class="card">
    <div class="card-head"><h2>② 代表者を発表中</h2><span class="chip">準備OK ${okN}/${Object.keys(reps).length}</span></div>
    <p class="muted">${L.GAMES[st.game].icon} ${esc(L.GAMES[st.game].title)}${Number(st.mult) > 1 ? '（得点×2）' : ''} — 全員のスマホに代表者とルールが表示されています。</p>
    ${repMonitor(st, u => (D.prog?.[u]?.ok ? '<span class="ok">準備OK</span>' : '<span class="muted">未確認</span>'), false)}
    <button class="btn btn-go btn-xl" data-act="start">ゲームスタート！（3秒カウント）</button>
    <button class="btn btn-ghost" data-act="backLobby">← 代表者を選び直す</button>
  </section>`;
}

function repMonitor(st, statusFn, withRetry) {
  return `<ul class="mon">${L.TEAMS.filter(t => st.reps?.[t]).map(t => {
    const u = st.reps[t];
    return `<li style="${tvars(t)}">${teamBadge(t)}<b>${esc(nameOf(u))}</b><i class="dot ${D.online?.[u] ? 'on' : ''}" title="接続"></i>
      <span class="mon-st">${statusFn(u, t)}</span>
      ${withRetry ? `<button class="btn btn-xs" data-act="retryOne" data-uid="${u}">再挑戦を許可</button>` : ''}</li>`;
  }).join('')}</ul>`;
}

function runningPanel(st) {
  const reps = st.reps || {};
  const repIds = Object.values(reps);
  const q = st.quiz || {};
  let quizCtl = '';
  let allDone;
  if (st.game === 'quiz') {
    const total = Number(q.total) || 0;
    const idx = Number.isFinite(Number(q.idx)) ? Number(q.idx) : -1;
    const answered = q.key ? repIds.filter(u => D.prog?.[u]?.[q.key]).length : 0;
    const leftMs = q.key && q.open ? Math.max(0, Number(q.at) + L.QUIZ_LIMIT - be.serverNow()) : 0;
    const cur = L.arr(D.quizRun)[idx];
    const next = idx + 1;
    quizCtl = `<div class="quiz-ctl">
      ${q.key ? `<div class="qc-now"><span class="chip">第${idx + 1}問 / ${total}</span> <b>${esc(cur?.text || q.q?.text || '')}</b>
        <ol class="qc-choices">${L.arr(q.q?.choices).map((c, k) => `<li class="${cur && Number(cur.answer) === k ? 'ans' : ''}">${'ABCD'[k]}. ${esc(c)}${cur && Number(cur.answer) === k ? ' ← 正解' : ''}</li>`).join('')}</ol>
        <p>回答 <b>${answered}</b>/${repIds.length}　${q.open ? `残り <b>${Math.ceil(leftMs / 1000)}</b>秒` : '締め切り済み'}</p></div>` : '<p class="muted">まだ出題していません。</p>'}
      ${q.open ? `<button class="btn btn-gold btn-xl" data-act="quizReveal">正解を発表（締め切り）</button>` : ''}
      ${!q.open && next < total ? `<button class="btn btn-go btn-xl" data-act="quizNext">第${next + 1}問を出題 ▶</button>` : ''}
    </div>`;
    allDone = !q.open && next >= total;
  } else allDone = repIds.every(u => D.prog?.[u]?.res);
  const statusFn = u => {
    const p = D.prog?.[u] || {};
    if (st.game === 'quiz') {
      const n = Number(q.total) || 0;
      return Array.from({ length: n }, (_, i) => `<span class="qdot ${p['q' + i] ? 'on' : p['g' + i] ? 'seen' : ''}">${i + 1}</span>`).join('');
    }
    const live = st.game === 'tap' && D.live?.[u] != null ? `<small class="muted">${D.live[u]}回</small> ` : '';
    return live + (p.res ? '<span class="ok">完了</span>' : p.go ? '<span class="st-live">プレイ中</span>' : '<span class="muted">待機</span>');
  };
  const counting = be.serverNow() < Number(st.startAt);
  return `<section class="card">
    <div class="card-head"><h2>③ 対戦中</h2><span class="chip">${counting ? 'カウントダウン中' : 'LIVE'}</span></div>
    ${repMonitor(st, statusFn, true)}
    <p class="fine">「再挑戦を許可」：通信切れや誤操作のとき、その代表者の今回の記録を消してもう一度挑戦させます${st.game === 'quiz' ? '（クイズは表示中の問題のみ）' : ''}。</p>
    ${quizCtl}
    <button class="btn ${allDone ? 'btn-primary' : 'btn-ghost'} btn-xl" data-act="finish">ゲーム終了・集計へ ▶</button>
  </section>`;
}

function computePreview(st) {
  const answers = L.arr(D.quizRun).map(q => Number(q.answer));
  const rows = L.buildRows(st.game, st.reps || {}, D.members, D.subs, { answers, quizTotal: Number(st.quiz?.total) || answers.length });
  return L.rankRows(st.game, rows, Number(st.mult) || 1, draft.overrides);
}

function judgingPanel(st) {
  const ranked = computePreview(st);
  const list = L.orderRows(ranked);
  return `<section class="card">
    <div class="card-head"><h2>④ 集計結果（参加者にはまだ非公開）</h2></div>
    <table class="tbl"><thead><tr><th>順位</th><th>チーム</th><th>記録</th><th>修正</th><th>得点</th></tr></thead><tbody>
    ${list.map(r => `<tr style="${tvars(r.team)}"><td><b>${r.rank ?? '—'}</b>${r.manual ? '<small class="warn">修正</small>' : ''}</td>
      <td>${teamBadge(r.team)} ${esc(r.name)}</td><td><small>${esc(r.detail)}</small></td>
      <td><select class="input input-sm ovr" data-team="${r.team}">
        <option value="auto" ${!draft.overrides[r.team] || draft.overrides[r.team] === 'auto' ? 'selected' : ''}>自動(${r.autoRank ?? '—'})</option>
        ${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${draft.overrides[r.team] === String(n) ? 'selected' : ''}>${n}位</option>`).join('')}
        <option value="dq" ${draft.overrides[r.team] === 'dq' ? 'selected' : ''}>失格(0点)</option></select></td>
      <td><b>${r.pts}</b></td></tr>`).join('')}
    </tbody></table>
    <p class="fine">同じ記録は同順位・同得点（次の順位は飛ばす）。フライング・記録なしは0点。${Number(st.mult) > 1 ? '今回は得点2倍。' : ''}</p>
    <button class="btn btn-gold btn-xl" data-act="publish">結果発表！ 🎉</button>
    <div class="row gap">
      <button class="btn btn-ghost" data-act="backRunning">← 対戦に戻す</button>
      <button class="btn btn-danger-ghost" data-act="redo">このゲームをやり直す</button>
    </div>
  </section>`;
}

function resultsPanel(st) {
  const r = D.results?.['r' + st.round];
  const last = st.round >= L.TOTAL_ROUNDS;
  return `<section class="card">
    <div class="card-head"><h2>⑤ 結果発表中</h2></div>
    ${r ? `<ol class="ranklist">${L.orderRows(r.rows).map(x => `<li class="rankrow" style="${tvars(x.team)}"><span class="rk">${x.rank ?? '—'}<small>位</small></span>${teamBadge(x.team)}<span class="who">${esc(x.name)} <small class="muted">${esc(x.detail)}</small></span><b class="pts">+${x.pts}</b></li>`).join('')}</ol>` : '<p>結果データがありません</p>'}
    <button class="btn btn-primary btn-xl" data-act="${last ? 'final' : 'next'}">${last ? '👑 総合結果発表へ ▶' : `次のゲームへ（GAME ${st.round + 1}）▶`}</button>
    <div class="row gap"><button class="btn btn-ghost" data-act="replay">発表演出をもう一度</button><button class="btn btn-ghost" data-tab="score">得点を修正する</button></div>
  </section>
  ${scoreboardHTML(D.results, D.adjust)}`;
}

function finalPanel() {
  return `<section class="card"><div class="card-head"><h2>👑 総合結果発表中</h2></div>
    <p>全員のスマホで総合順位を発表しています。おつかれさまでした！</p>
    <div class="row gap"><button class="btn btn-ghost" data-act="replay">発表演出をもう一度</button><button class="btn btn-ghost" data-act="backResults">← 第4ゲーム結果に戻す</button></div>
  </section>${scoreboardHTML(D.results, D.adjust, { title: '最終順位' })}`;
}

// ----- 参加者タブ -----
function membersTab() {
  const cfg = D.config || {};
  const cap = Number(cfg.teamCap) || 5;
  return `<section class="card">
    <div class="card-head"><h2>参加受付</h2><span class="chip ${cfg.regOpen ? 'ok' : 'warn'}">${cfg.regOpen ? '受付中' : '締切'}</span></div>
    <div class="row gap">
      <button class="btn ${cfg.regOpen ? 'btn-ghost' : 'btn-primary'}" data-act="toggleReg">${cfg.regOpen ? '受付を締め切る' : '受付を再開する'}</button>
      <label class="row">1チームの定員 <select class="input input-sm" id="capSel">${Array.from({ length: 9 }, (_, i) => `<option ${cap === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>名</label>
    </div>
    <p class="fine">全員の登録が済んだら受付を締め切ると、知らない人の飛び入り登録を防げます。</p>
  </section>
  ${L.TEAMS.map(t => {
    const ms = membersOf(t);
    return `<section class="card team-card" style="${tvars(t)}">
      <div class="card-head"><h2>${teamBadge(t)} チーム ${t}</h2><span class="chip ${ms.length === 4 ? 'ok' : 'warn'}">${ms.length}人</span></div>
      ${ms.length ? `<ul class="mlist">${ms.map(m => `<li><i class="dot ${D.online?.[m.uid] ? 'on' : ''}"></i><b>${esc(m.name)}</b>
        ${D.used?.[m.uid] ? `<small class="played">${usedRounds(m.uid)}出場</small><button class="btn btn-xs" data-act="unuse" data-uid="${m.uid}">出場済を解除</button>` : '<small class="muted">未出場</small>'}
        <button class="btn btn-xs btn-danger-ghost" data-act="kick" data-uid="${m.uid}">削除</button></li>`).join('')}</ul>` : '<p class="muted">まだいません</p>'}
    </section>`;
  }).join('')}`;
}

// ----- 得点タブ -----
function scoreTab() {
  const rounds = [1, 2, 3, 4];
  const totals = L.computeTotals(D.results, D.adjust);
  return `${scoreboardHTML(D.results, D.adjust, { title: '総合ランキング（全員に表示中）' })}
  <section class="card">
    <div class="card-head"><h2>ゲーム別の得点</h2></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>チーム</th>${rounds.map(r => `<th>G${r}</th>`).join('')}<th>調整</th><th>合計</th></tr></thead><tbody>
      ${L.TEAMS.map(t => `<tr style="${tvars(t)}"><td>${teamBadge(t)}</td>${rounds.map(r => { const x = D.results?.['r' + r]?.rows?.[t]; return `<td>${x ? `${x.pts}<small class="muted">${x.rank ? `(${x.rank}位)` : '(—)'}</small>` : '—'}</td>`; }).join('')}<td>${Number(D.adjust?.[t] || 0)}</td><td><b>${totals[t]}</b></td></tr>`).join('')}
    </tbody></table></div>
    <div class="row gap">${rounds.filter(r => D.results?.['r' + r]).map(r => `<button class="btn btn-sm" data-act="editRound" data-round="${r}">G${r}を修正</button>`).join('') || '<span class="muted">まだ結果はありません</span>'}</div>
  </section>
  ${editRound ? roundEditor(editRound) : ''}
  <section class="card">
    <div class="card-head"><h2>調整点（ボーナス・ペナルティ）</h2></div>
    <div class="adj">${L.TEAMS.map(t => `<label class="adj-row" style="${tvars(t)}">${teamBadge(t)}<input class="input input-sm adj-in" type="number" step="1" data-team="${t}" value="${Number(D.adjust?.[t] || 0)}"></label>`).join('')}</div>
    <button class="btn btn-primary" data-act="saveAdjust">調整点を保存</button>
    <p class="fine">合計＝各ゲームの得点＋調整点。保存すると全員の画面に即反映されます。</p>
  </section>`;
}

function roundEditor(r) {
  const res = D.results?.['r' + r];
  if (!res) return '';
  return `<section class="card edit-card">
    <div class="card-head"><h2>G${r} ${esc(L.GAMES[res.game]?.title || '')} の結果を修正</h2><button class="btn btn-xs" data-act="closeEdit">閉じる</button></div>
    <table class="tbl"><thead><tr><th>チーム</th><th>順位</th><th>得点</th></tr></thead><tbody>
    ${L.TEAMS.filter(t => res.rows?.[t]).map(t => { const x = res.rows[t]; return `<tr style="${tvars(t)}"><td>${teamBadge(t)} ${esc(x.name)}<br><small class="muted">${esc(x.detail)}</small></td>
      <td><select class="input input-sm er-rank" data-team="${t}"><option value="">—</option>${[1, 2, 3, 4, 5].map(n => `<option ${Number(x.rank) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
      <td><input class="input input-sm er-pts" type="number" data-team="${t}" value="${Number(x.pts) || 0}"></td></tr>`; }).join('')}
    </tbody></table>
    <div class="row gap"><button class="btn btn-sm" data-act="autoPts" data-round="${r}">順位から得点を再計算</button><button class="btn btn-primary" data-act="saveRound" data-round="${r}">修正を保存</button></div>
    <p class="fine">倍率 ×${Number(res.mult) || 1}。保存すると全員の総合ランキングに即反映されます。</p>
  </section>`;
}

// ----- クイズタブ -----
function quizTab() {
  const bank = Object.entries(D.quizBank || {});
  const ed = editQuizId ? (editQuizId === 'new' ? { text: '', choices: ['', '', '', ''], answer: 0 } : D.quizBank?.[editQuizId]) : null;
  return `<section class="card">
    <div class="card-head"><h2>❓ 問題一覧（${bank.length}問）</h2><button class="btn btn-sm btn-primary" data-act="newQuiz">＋ 問題を追加</button></div>
    <p class="fine">問題と正解は管理者だけが読めるよう保護されています。出題時は問題文と選択肢だけが参加者に送られます。</p>
    ${ed ? quizEditor(ed) : ''}
    ${bank.length ? `<ol class="qbank">${bank.map(([id, q]) => `<li><div><b>${esc(q.text)}</b> ${q.used ? '<small class="played">使用済</small>' : ''}</div>
      <div class="qb-ch">${L.arr(q.choices).map((c, k) => `<span class="${Number(q.answer) === k ? 'ans' : ''}">${'ABCD'[k]}. ${esc(c)}</span>`).join('')}</div>
      <div class="row gap"><button class="btn btn-xs" data-act="editQuiz" data-id="${id}">編集</button>${q.used ? `<button class="btn btn-xs" data-act="unuseQuiz" data-id="${id}">使用済を解除</button>` : ''}<button class="btn btn-xs btn-danger-ghost" data-act="delQuiz" data-id="${id}">削除</button></div></li>`).join('')}</ol>`
    : '<p class="muted">まだ問題がありません。</p>'}
    <button class="btn btn-ghost" data-act="sampleQuiz">サンプル問題（${SAMPLE_QUIZ.length}問）を追加</button>
  </section>`;
}

function quizEditor(q) {
  return `<form class="quiz-ed" id="quizForm">
    <label class="lbl">問題文<textarea class="input" id="qeText" rows="2" maxlength="120" required>${esc(q.text)}</textarea></label>
    ${[0, 1, 2, 3].map(k => `<label class="qe-row"><input type="radio" name="qeAns" value="${k}" ${Number(q.answer) === k ? 'checked' : ''}><span>${'ABCD'[k]}</span><input class="input qe-c" data-k="${k}" maxlength="40" value="${esc(q.choices?.[k] || '')}" required></label>`).join('')}
    <p class="fine">●を付けた選択肢が正解です。</p>
    <div class="row gap"><button class="btn btn-primary" type="submit">保存</button><button class="btn btn-ghost" type="button" data-act="cancelQuiz">キャンセル</button></div>
  </form>`;
}

// ----- QR・設定タブ -----
function setupTab() {
  let svg = '';
  try { const qr = qrcode(0, 'M'); qr.addData(PLAYER_URL); qr.make(); svg = qr.createSvgTag({ cellSize: 8, margin: 3, scalable: true }); } catch (e) { svg = '<p>QR生成エラー</p>'; }
  return `<section class="card center qr-card">
    <div class="card-head"><h2>📲 参加用QRコード</h2></div>
    <div class="qr-box">${svg}</div>
    <p class="url">${esc(PLAYER_URL)}</p>
    <div class="row gap center"><button class="btn" data-act="copyUrl">URLをコピー</button><button class="btn btn-ghost" data-act="bigQr">QRを全画面表示</button></div>
    <p class="fine">Wi-Fi共通でなくてもOK。各自のスマホのモバイル回線で参加できます。LINE等でQRを読んだ場合も、そのまま開いたアプリで最後まで遊んでください。</p>
  </section>
  <section class="card">
    <div class="card-head"><h2>🔗 URL</h2></div>
    <p>参加者用：<a href="${esc(PLAYER_URL)}" target="_blank" rel="noopener">${esc(PLAYER_URL)}</a></p>
    <p>管理者用：<a href="${esc(ADMIN_URL)}">${esc(ADMIN_URL)}</a></p>
  </section>
  <section class="card danger-zone">
    <div class="card-head"><h2>⚠️ リセット</h2></div>
    <button class="btn btn-danger-ghost" data-act="redo">このゲームをやり直す（記録を消して代表者発表から）</button>
    <button class="btn btn-danger-ghost" data-act="resetScores">得点・出場履歴をリセット（参加者は残す）</button>
    <button class="btn btn-danger" data-act="resetAll">全データ初期化（参加者も削除）</button>
    <p class="fine">リハーサル後は「全データ初期化」で本番前の状態に戻せます。クイズの問題は残ります。</p>
  </section>`;
}

// ---------- イベント ----------
function afterRender() {
  $$('.rep-sel').forEach(s => s.addEventListener('change', () => {
    const t = s.dataset.team;
    if (s.value && D.used?.[s.value] && !confirm(`${nameOf(s.value)} さんはすでに出場済みです。それでも代表にしますか？`)) { s.value = draft.reps[t] || ''; return; }
    draft.reps[t] = s.value || null;
  }));
  $('#gameSel')?.addEventListener('change', e => { draft.game = e.target.value; draft.mult = L.DEFAULT_MULT[L.ROUND_GAMES.indexOf(draft.game)] || 1; queueRender(); e.target.blur(); });
  $('#multSel')?.addEventListener('change', e => { draft.mult = Number(e.target.value); e.target.blur(); queueRender(); });
  $('#qCount')?.addEventListener('change', e => { draft.quizCount = Number(e.target.value); e.target.blur(); queueRender(); });
  $$('.qp').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) { if (!draft.quizPick.includes(cb.value)) draft.quizPick.push(cb.value); } else draft.quizPick = draft.quizPick.filter(x => x !== cb.value);
    queueRender();
  }));
  $$('.ovr').forEach(s => s.addEventListener('change', () => { draft.overrides[s.dataset.team] = s.value; s.blur(); queueRender(); }));
  $('#capSel')?.addEventListener('change', e => { setCap(Number(e.target.value)); e.target.blur(); });
  $('#quizForm')?.addEventListener('submit', saveQuiz);
}

root.addEventListener('click', async e => {
  const tb = e.target.closest('[data-tab]');
  if (tb) { tab = tb.dataset.tab; try { sessionStorage.setItem('ekzm-admin-tab', tab); } catch { /* noop */ } queueRender(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  const fn = ACTIONS[act];
  if (!fn) return;
  b.disabled = true;
  try { await fn(b); } catch (err) { console.error(err); toast(errMsg(err), 'error', 7000); }
  finally { b.disabled = false; }
});

const newRunId = () => 'run' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const ACTIONS = {
  autoReps() {
    for (const t of L.TEAMS) {
      const ms = membersOf(t);
      if (!ms.length) continue;
      const fresh = ms.filter(m => !D.used?.[m.uid]);
      const pool = fresh.length ? fresh : ms;
      draft.reps[t] = pool[Math.floor(Math.random() * pool.length)].uid;
    }
    queueRender();
  },
  autoQuiz() {
    const all = Object.entries(D.quizBank || {});
    const unused = all.filter(([, q]) => !q.used);
    const pool = (unused.length >= draft.quizCount ? unused : all).map(([id]) => id).sort(() => Math.random() - 0.5);
    draft.quizPick = pool.slice(0, draft.quizCount);
    queueRender();
  },
  async announce() {
    const st = D.state;
    const reps = {}, repOf = {};
    for (const t of L.TEAMS) {
      const u = draft.reps[t];
      if (u && D.members?.[u]?.team === t) { reps[t] = u; repOf[u] = t; }
    }
    const n = Object.keys(reps).length;
    if (!n) throw new Error('代表者を1人以上選んでください');
    if (n < 5 && !confirm(`代表者が${n}チーム分しか選ばれていません。このまま進めますか？`)) return;
    const runId = newRunId();
    const up = {
      'state/phase': 'ready', 'state/game': draft.game, 'state/mult': draft.mult, 'state/reps': reps, 'state/repOf': repOf,
      'state/runId': runId, 'state/startAt': 0, 'state/iaiDelay': 0, 'state/revealAt': 0, 'state/updatedAt': be.TS, 'state/quiz': null,
    };
    if (draft.game === 'quiz') {
      const ids = draft.quizPick.filter(id => D.quizBank?.[id]).slice(0, draft.quizCount);
      if (ids.length !== Number(draft.quizCount)) throw new Error(`問題を${draft.quizCount}問選んでください`);
      up[`adminOnly/quizRun/${runId}`] = ids.map(id => ({ id, text: D.quizBank[id].text, choices: L.arr(D.quizBank[id].choices), answer: Number(D.quizBank[id].answer) }));
      up['state/quiz'] = { total: ids.length, idx: -1, open: false };
    }
    await be.update(up);
    draft.overrides = {};
    sfx.reveal();
  },
  async backLobby() {
    draft.forRound = null;
    await be.update({ 'state/phase': 'lobby', 'state/runId': null, 'state/updatedAt': be.TS });
  },
  async start() {
    const st = D.state;
    const notOk = Object.values(st.reps || {}).filter(u => !D.prog?.[u]?.ok).length;
    if (notOk && !confirm(`準備OKを押していない代表者が${notOk}人います。スタートしますか？`)) return;
    await be.update({
      'state/phase': 'running',
      'state/startAt': be.serverNow() + L.COUNTDOWN_MS,
      'state/iaiDelay': L.randomInt(L.IAI_MIN_DELAY, L.IAI_MAX_DELAY),
      'state/updatedAt': be.TS,
    });
    sfx.go();
  },
  async quizNext() {
    const st = D.state;
    const q = st.quiz || {};
    const i = (Number.isFinite(Number(q.idx)) ? Number(q.idx) : -1) + 1;
    const src = L.arr(D.quizRun)[i];
    if (!src) throw new Error('問題データが見つかりません');
    const wait = Math.max(0, Number(st.startAt) - be.serverNow());
    await be.update({
      'state/quiz': { total: q.total, idx: i, key: 'q' + i, open: true, at: be.serverNow() + wait + 2600, q: { text: src.text, choices: L.arr(src.choices) }, reveal: null },
      'state/updatedAt': be.TS,
    });
  },
  async quizReveal() {
    const st = D.state;
    const q = st.quiz || {};
    const src = L.arr(D.quizRun)[Number(q.idx)];
    if (!src) throw new Error('正解データが見つかりません');
    const reps = Object.values(st.reps || {});
    const answered = reps.filter(u => D.prog?.[u]?.[q.key]).length;
    const left = Number(q.at) + L.QUIZ_LIMIT - be.serverNow();
    if (answered < reps.length && left > 0 && !confirm(`まだ${reps.length - answered}人が回答していません（残り${Math.ceil(left / 1000)}秒）。締め切って正解を発表しますか？`)) return;
    await be.update({ 'state/quiz/open': false, 'state/quiz/reveal': Number(src.answer), 'state/updatedAt': be.TS });
    if (src.id && D.quizBank?.[src.id]) be.set(`quizBank/${src.id}/used`, true).catch(() => {});
  },
  async retryOne(b) {
    const st = D.state;
    const u = b.dataset.uid;
    const q = st.quiz || {};
    if (st.game === 'quiz') {
      if (!q.key || !q.open) throw new Error('出題中の問題に対してのみ再挑戦を許可できます');
      if (!confirm(`${nameOf(u)} さんの「第${Number(q.idx) + 1}問」の回答を取り消して、もう一度回答できるようにしますか？`)) return;
      await be.update({ [`subs/${st.runId}/${u}/${q.key}`]: null, [`prog/${st.runId}/${u}/${q.key}`]: null, [`prog/${st.runId}/${u}/g${q.idx}`]: null });
    } else {
      if (!confirm(`${nameOf(u)} さんの今回の記録を消して、もう一度挑戦させますか？`)) return;
      await be.update({ [`subs/${st.runId}/${u}`]: null, [`prog/${st.runId}/${u}/go`]: null, [`prog/${st.runId}/${u}/res`]: null, [`live/${st.runId}/${u}`]: null });
    }
    toast('再挑戦を許可しました', 'ok');
  },
  async finish() {
    const st = D.state;
    const reps = Object.values(st.reps || {});
    if (st.game === 'quiz') {
      const q = st.quiz || {};
      if (q.open) throw new Error('出題中の問題の正解を発表してから集計してください');
      if (Number(q.idx) + 1 < Number(q.total) && !confirm(`まだ全${q.total}問を出題していません。ここで終了して集計しますか？`)) return;
    } else {
      const notDone = reps.filter(u => !D.prog?.[u]?.res).length;
      if (notDone && !confirm(`まだ記録が届いていない代表者が${notDone}人います（記録なし＝0点）。終了して集計しますか？`)) return;
    }
    draft.overrides = {};
    await be.update({ 'state/phase': 'judging', 'state/updatedAt': be.TS });
    sfx.drum(1.2);
  },
  async backRunning() { await be.update({ 'state/phase': 'running', 'state/updatedAt': be.TS }); },
  async publish() {
    const st = D.state;
    const ranked = computePreview(st);
    const rows = {};
    for (const [t, r] of Object.entries(ranked)) {
      rows[t] = { team: t, uid: r.uid, name: r.name, rank: r.rank ?? null, pts: r.pts, detail: r.detail, status: r.status, manual: !!r.manual };
    }
    const up = {
      [`results/r${st.round}`]: { round: st.round, game: st.game, mult: Number(st.mult) || 1, runId: st.runId, rows, publishedAt: be.TS },
      'state/phase': 'results', 'state/revealAt': be.serverNow() + 1200, 'state/updatedAt': be.TS,
    };
    for (const r of Object.values(rows)) if (r.uid) up[`used/${r.uid}/r${st.round}`] = st.game;
    await be.update(up);
  },
  async replay() { await be.update({ 'state/revealAt': be.serverNow() + 1200, 'state/updatedAt': be.TS }); },
  async next() {
    const st = D.state;
    const r = st.round + 1;
    draft.forRound = null; draft.reps = {}; draft.quizPick = [];
    await be.update({
      state: { round: r, game: L.ROUND_GAMES[r - 1], mult: L.DEFAULT_MULT[r - 1], phase: 'lobby', startAt: 0, iaiDelay: 0, revealAt: 0, updatedAt: be.TS },
    });
  },
  async final() {
    if (!confirm('総合結果を発表しますか？（全員のスマホで最終順位の発表演出が始まります）')) return;
    await be.update({ 'state/phase': 'final', 'state/revealAt': be.serverNow() + 1500, 'state/updatedAt': be.TS });
  },
  async backResults() { await be.update({ 'state/phase': 'results', 'state/revealAt': 0, 'state/updatedAt': be.TS }); },
  async redo() {
    const st = D.state;
    if (!st.runId || !['ready', 'running', 'judging', 'results'].includes(st.phase)) throw new Error('やり直せるゲームがありません（代表者発表後に使えます）');
    if (!confirm(`GAME ${st.round}（${L.GAMES[st.game].title}）をやり直します。今回の記録${st.phase === 'results' ? 'と発表済みの結果' : ''}を消して、代表者発表の状態に戻します。よろしいですか？`)) return;
    const runId = newRunId();
    const up = {
      'state/phase': 'ready', 'state/runId': runId, 'state/startAt': 0, 'state/revealAt': 0, 'state/updatedAt': be.TS,
      [`subs/${st.runId}`]: null, [`prog/${st.runId}`]: null, [`live/${st.runId}`]: null,
    };
    if (st.game === 'quiz') {
      up[`adminOnly/quizRun/${runId}`] = D.quizRun || null;
      up['state/quiz'] = { total: Number(st.quiz?.total) || 0, idx: -1, open: false };
    }
    if (D.results?.['r' + st.round]) {
      up[`results/r${st.round}`] = null;
      for (const u of Object.values(st.reps || {})) if (D.used?.[u]?.['r' + st.round]) up[`used/${u}/r${st.round}`] = null;
    }
    await be.update(up);
    draft.overrides = {};
    toast('やり直しの準備ができました', 'ok');
  },
  async toggleReg() { await be.set('config/regOpen', !D.config?.regOpen); },
  async kick(b) {
    const u = b.dataset.uid;
    const m = D.members?.[u];
    if (!m) return;
    if (D.state?.repOf?.[u] && D.state.phase !== 'lobby') throw new Error('現在の代表者は削除できません');
    if (!confirm(`${m.name}（${m.team}チーム）を削除しますか？ 本人は名前とチームを選び直せます。`)) return;
    await be.update({ [`members/${u}`]: null, [`slots/${m.team}/${m.slot}`]: null });
  },
  async unuse(b) {
    if (!confirm(`${nameOf(b.dataset.uid)} さんの出場履歴を解除しますか？（得点は変わりません）`)) return;
    await be.remove(`used/${b.dataset.uid}`);
  },
  editRound(b) { editRound = Number(b.dataset.round); queueRender(); },
  closeEdit() { editRound = null; queueRender(); },
  autoPts(b) {
    const r = Number(b.dataset.round);
    const mult = Number(D.results?.['r' + r]?.mult) || 1;
    $$('.er-rank').forEach(s => { const pin = $(`.er-pts[data-team="${s.dataset.team}"]`); pin.value = L.pointsForRank(Number(s.value) || null, mult); });
  },
  async saveRound(b) {
    const r = Number(b.dataset.round);
    const up = {};
    $$('.er-rank').forEach(s => {
      const t = s.dataset.team;
      up[`results/r${r}/rows/${t}/rank`] = s.value ? Number(s.value) : null;
      up[`results/r${r}/rows/${t}/pts`] = Number($(`.er-pts[data-team="${t}"]`).value) || 0;
      up[`results/r${r}/rows/${t}/manual`] = true;
    });
    await be.update(up);
    editRound = null;
    toast(`G${r} の結果を修正しました`, 'ok');
  },
  async saveAdjust() {
    const up = {};
    $$('.adj-in').forEach(i => { up[`adjust/${i.dataset.team}`] = Number(i.value) || 0; });
    await be.update(up);
    toast('調整点を保存しました', 'ok');
  },
  newQuiz() { editQuizId = 'new'; queueRender(); },
  editQuiz(b) { editQuizId = b.dataset.id; queueRender(); },
  cancelQuiz() { editQuizId = null; queueRender(); },
  async delQuiz(b) {
    if (!confirm('この問題を削除しますか？')) return;
    await be.remove(`quizBank/${b.dataset.id}`);
  },
  async unuseQuiz(b) { await be.set(`quizBank/${b.dataset.id}/used`, false); },
  async sampleQuiz() {
    const up = {};
    SAMPLE_QUIZ.forEach((q, i) => { up[`quizBank/qs${Date.now().toString(36)}${i}`] = { ...q, used: false }; });
    await be.update(up);
    toast('サンプル問題を追加しました', 'ok');
  },
  async copyUrl() {
    try { await navigator.clipboard.writeText(PLAYER_URL); toast('URLをコピーしました', 'ok'); } catch { prompt('このURLをコピーしてください', PLAYER_URL); }
  },
  bigQr() {
    const qr = qrcode(0, 'M'); qr.addData(PLAYER_URL); qr.make();
    const ov = document.createElement('div');
    ov.className = 'qr-full';
    ov.innerHTML = `<div class="qr-full-in">${qr.createSvgTag({ cellSize: 10, margin: 3, scalable: true })}<p>EKZM TEAM BATTLE 2026 ・ 参加はこちら</p><small>タップで閉じる</small></div>`;
    ov.addEventListener('click', () => ov.remove());
    document.body.appendChild(ov);
  },
  async resetScores() {
    if (!confirm('得点・結果・出場履歴をすべて消して GAME 1 からやり直します。参加者の登録は残ります。よろしいですか？')) return;
    if (prompt('確認のため「リセット」と入力してください') !== 'リセット') return;
    const up = { results: null, adjust: null, used: null, subs: null, prog: null, live: null, adminOnly: null, state: initialState() };
    for (const id of Object.keys(D.quizBank || {})) up[`quizBank/${id}/used`] = false;
    draft.forRound = null; draft.reps = {}; draft.quizPick = [];
    await be.update(up);
    toast('得点と履歴をリセットしました', 'ok');
  },
  async resetAll() {
    if (!confirm('参加者も含めて全データを初期化します（クイズ問題は残ります）。参加者は登録からやり直しになります。よろしいですか？')) return;
    if (prompt('確認のため「初期化」と入力してください') !== '初期化') return;
    const up = { results: null, adjust: null, used: null, subs: null, prog: null, live: null, adminOnly: null, members: null, slots: null, online: null, state: initialState(), config: defaultConfig(Number(D.config?.teamCap) || 5) };
    for (const id of Object.keys(D.quizBank || {})) up[`quizBank/${id}/used`] = false;
    draft.forRound = null; draft.reps = {}; draft.quizPick = [];
    await be.update(up);
    toast('全データを初期化しました', 'ok');
  },
};

async function setCap(cap) {
  const cur = D.config || {};
  const slots = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i), i < cap ? true : null]));
  const over = L.TEAMS.filter(t => membersOf(t).length > cap);
  if (over.length) toast(`${over.join('・')}チームは定員を超えています（登録済みの人はそのまま残ります）`, 'warn', 6000);
  await be.update({ 'config/teamCap': cap, 'config/slots': Object.fromEntries(Object.entries(slots).filter(([, v]) => v)), 'config/regOpen': cur.regOpen ?? true });
}

async function saveQuiz(e) {
  e.preventDefault();
  const text = $('#qeText').value.trim();
  const choices = $$('.qe-c').map(i => i.value.trim());
  const answer = Number(($('input[name="qeAns"]:checked') || {}).value ?? 0);
  if (!text || choices.some(c => !c)) { toast('問題文と4つの選択肢をすべて入力してください', 'error'); return; }
  const id = editQuizId === 'new' ? 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) : editQuizId;
  try {
    await be.set(`quizBank/${id}`, { text, choices, answer, used: !!D.quizBank?.[id]?.used });
    editQuizId = null;
    document.activeElement?.blur?.();
    toast('問題を保存しました', 'ok');
    queueRender();
  } catch (err) { toast(errMsg(err), 'error'); }
}

boot();
