// 参加者・観戦画面
import { createBackend, errMsg } from './db.js?v=10';
import * as L from './logic.js?v=10';
import { joinTeam, submitResult, markProg, sendLive, startPresence } from './actions.js?v=10';
import { sfx, vibrate, flash, wantAwake, isMuted, setMuted, confetti } from './fx.js?v=10';
import {
  $, esc, tvars, teamBadge, toast, perfAt, waitUntil, countdownOverlay,
  scoreboardHTML, mountRoundReveal, mountFinalReveal, rosterHTML, teamStripHTML, rankStripHTML,
  head, gameTag, cubeSVG, ICON, howtoHTML, pointsHTML, openHelp, progressHTML, nowHTML,
  explainSlideHTML, explainName,
} from './ui.js?v=10';

const params = new URLSearchParams(location.search);
const slotParam = (params.get('p') || '').replace(/[^\w-]/g, '').slice(0, 12);
const APP_NAME = 'player' + (slotParam ? '-' + slotParam : '');
const app = $('#app');

let be = null;
let uid = null;
const S = {
  state: undefined, config: undefined, members: undefined, slots: {}, results: {}, adjust: {}, used: {}, pick: {},
  prog: {}, live: {}, mine: {}, runLoaded: false,
};
let view = { key: null, ctl: null };
let runWatch = { runId: null, offs: [], got: 0 };
let renderQueued = false;
let presenceStarted = false;

const me = () => (uid && S.members ? S.members[uid] : null);
const isRep = () => !!(uid && S.state?.repOf?.[uid]);
const evTime = e => { const n = performance.now(); const t = e?.timeStamp; return t > 0 && Math.abs(n - t) < 1000 ? t : n; };
const gameNo = st => (st?.round || 1);

// ---------- 起動 ----------

async function boot() {
  setupHeader();
  app.innerHTML = loadingHTML('サーバーに接続中…');
  try {
    be = await createBackend(APP_NAME);
  } catch (e) {
    console.error(e);
    app.innerHTML = fatalHTML('Firebase を読み込めませんでした。電波の良い場所で再読み込みしてください。');
    return;
  }
  be.onConnected(c => document.body.classList.toggle('offline', !c));
  be.onAuth(async user => {
    if (!user) {
      try { await be.signInAnon(); } catch (e) { app.innerHTML = fatalHTML('ログインできませんでした：' + esc(errMsg(e))); }
      return;
    }
    if (uid === user.uid) return;
    uid = user.uid;
    subscribe();
  });
}

function subscribe() {
  const keys = ['state', 'config', 'members', 'slots', 'results', 'adjust', 'used', 'pick'];
  for (const k of keys) {
    be.watch(k, v => {
      S[k] = v ?? (k === 'state' || k === 'config' || k === 'members' ? null : {});
      if (k === 'state') syncRunWatch();
      if (k === 'members' && me() && !presenceStarted) { presenceStarted = true; startPresence(be); }
      queueRender();
    }, () => { if (k === 'state') app.innerHTML = fatalHTML('データを読み込めません。Firebase のルール設定を確認してください。'); });
  }
}

function syncRunWatch() {
  const runId = S.state?.runId || null;
  if (runWatch.runId === runId) return;
  runWatch.offs.forEach(f => f());
  runWatch = { runId, offs: [], got: 0 };
  S.prog = {}; S.live = {}; S.mine = {}; S.runLoaded = !runId;
  if (!runId) return;
  const mark = () => { runWatch.got++; if (runWatch.got >= 2) S.runLoaded = true; };
  let first = { prog: true, mine: true };
  runWatch.offs.push(be.watch(`prog/${runId}`, v => { S.prog = v || {}; if (first.prog) { first.prog = false; mark(); } queueRender(); }));
  runWatch.offs.push(be.watch(`subs/${runId}/${uid}`, v => { S.mine = v || {}; if (first.mine) { first.mine = false; mark(); } queueRender(); }, () => { if (first.mine) { first.mine = false; mark(); } }));
  runWatch.offs.push(be.watch(`live/${runId}`, v => { S.live = v || {}; queueRender(); }));
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  // 画面が非表示だと requestAnimationFrame が止まるため、タイマーでも必ず描画する
  const run = () => { if (!renderQueued) return; renderQueued = false; render(); };
  requestAnimationFrame(run);
  setTimeout(run, 120);
}

// ---------- ヘッダー ----------
function setupHeader() {
  window.addEventListener('pointerdown', () => { if (me()) wantAwake(); }, { passive: true });
  const btn = $('#soundBtn');
  const paint = () => { btn.innerHTML = isMuted() ? ICON.soundOff : ICON.soundOn; btn.setAttribute('aria-label', isMuted() ? '音を出す' : '消音する'); };
  paint();
  btn.addEventListener('click', () => { setMuted(!isMuted()); paint(); if (!isMuted()) sfx.choose(); });
  $('#helpBtn')?.addEventListener('click', openHelp);
}

function paintMe() {
  document.body.classList.toggle('rehearsal', !!S.config?.rehearsal);
  const box = $('#meBox');
  const m = me();
  box.innerHTML = m ? `${teamBadge(m.team)}<span class="me-name">${esc(m.name)}</span>` : '';
  document.documentElement.style.setProperty('--my', m ? L.TEAM_INFO[m.team].color : '#7c7cff');
}

// ---------- 画面の振り分け ----------
function computeKey() {
  if (S.state === undefined || S.members === undefined || S.config === undefined) return 'loading';
  if (!S.state) return 'noinit';
  if (!me()) return 'join';
  const st = S.state;
  switch (st.phase) {
    case 'ready': return `ready|${st.runId}|${isRep() ? 'rep' : 'spec'}`;
    case 'running':
      if (!S.runLoaded) return 'loading-run';
      return `run|${st.runId}|${isRep() ? 'rep' : 'spec'}|${st.game}`;
    case 'judging': return `judging|${st.runId}`;
    case 'results': return S.results?.['r' + st.round] ? `results|${st.round}|${st.revealAt}` : 'judging|wait';
    case 'final': return `final|${st.revealAt}`;
    default: return `lobby|${st.round}`;
  }
}

function render() {
  paintMe();
  const key = computeKey();
  if (key !== view.key) mount(key);
  else if (view.ctl?.update?.() === 'remount') mount(key);
  paintNow();
  paintExplain();
  syncCheer();
  paintAwards();
}

// ---------- 応援ボタン（ゲーム中・観戦している人だけ。どのチームの代表にも送れる） ----------
const cheer = { run: null, mine: {}, sent: {}, totals: {}, loaded: false, last: 0, timer: 0, off: null, pops: 0 };
const cheerActive = () => {
  const st = S.state;
  return !!(st && st.phase === 'running' && st.runId && me() && !isRep() && S.runLoaded && Object.keys(st.reps || {}).length && (st.game !== 'quiz' || st.quiz?.open));
};
function syncCheer() {
  const st = S.state;
  const run = st?.runId || null;
  const active = cheerActive();
  if (cheer.run && (cheer.run !== run || !active)) flushCheer();
  if (cheer.run !== run) {
    cheer.off?.(); cheer.off = null;
    $('#cheerBar')?.remove();
    Object.assign(cheer, { run, mine: {}, sent: {}, totals: {}, loaded: false });
  }
  if (active && !cheer.off) {
    cheer.off = be.watch(`cheer/${run}`, v => {
      cheer.totals = v || {};
      if (!cheer.loaded) { // 再読み込みしても自分の回数を引き継ぐ
        cheer.loaded = true;
        const m = cheer.totals[uid] || {};
        for (const t of L.TEAMS) { const n = Number(m[t]) || 0; cheer.mine[t] = Math.max(cheer.mine[t] || 0, n); cheer.sent[t] = Math.max(cheer.sent[t] || 0, n); }
      }
      paintCheer();
    });
  }
  if (!active && cheer.off) { const off = cheer.off; cheer.off = null; setTimeout(off, 1500); }
  paintCheer();
}
function paintCheer() {
  const active = cheerActive();
  let el = $('#cheerBar');
  document.body.classList.toggle('cheering', active);
  if (!active) { el?.remove(); return; }
  const st = S.state;
  const teams = L.TEAMS.filter(t => st.reps?.[t]);
  if (!el) {
    el = document.createElement('div');
    el.id = 'cheerBar';
    el.className = 'cheer';
    el.innerHTML = `<div class="cheer-head"><b>代表に「がんばれ！」を送ろう</b><span>あなた <b id="cheerMine">0</b>回</span></div>
      <div class="cheer-btns">${teams.map(t => `<button class="cheer-btn" data-t="${t}" style="${tvars(t)}" aria-label="${t}チームの代表を応援"><b>${t}</b><small>がんばれ</small><i id="ct-${t}">0</i></button>`).join('')}</div>`;
    el.addEventListener('pointerdown', onCheer);
    el.addEventListener('contextmenu', e => e.preventDefault());
    document.body.appendChild(el);
  }
  const totals = {};
  for (const [u, m] of Object.entries(cheer.totals || {})) {
    if (u === uid) continue;
    for (const [t, n] of Object.entries(m || {})) totals[t] = (totals[t] || 0) + (Number(n) || 0);
  }
  for (const t of teams) { const i = $('#ct-' + t, el); if (i) i.textContent = (totals[t] || 0) + (cheer.mine[t] || 0); }
  const mineEl = $('#cheerMine', el);
  if (mineEl) mineEl.textContent = L.TEAMS.reduce((a, t) => a + (cheer.mine[t] || 0), 0);
}
function onCheer(e) {
  const b = e.target.closest('.cheer-btn');
  if (!b || !cheerActive()) return;
  e.preventDefault();
  const now = performance.now();
  if (now - cheer.last < L.CHEER_MIN_GAP) return; // 速すぎる連打は数えない
  cheer.last = now;
  const t = b.dataset.t;
  if ((cheer.mine[t] || 0) >= L.CHEER_MAX) return;
  cheer.mine[t] = (cheer.mine[t] || 0) + 1;
  popCheer(b);
  paintCheer();
  if (!cheer.timer) cheer.timer = setTimeout(flushCheer, L.CHEER_SEND_MS);
}
function flushCheer() {
  clearTimeout(cheer.timer); cheer.timer = 0;
  const run = cheer.run;
  if (!run || !uid) return;
  const up = {};
  const snap = { ...cheer.mine };
  for (const t of L.TEAMS) if ((snap[t] || 0) > (cheer.sent[t] || 0)) up[`cheer/${run}/${uid}/${t}`] = snap[t];
  if (!Object.keys(up).length) return;
  be.update(up).then(() => { for (const t of L.TEAMS) cheer.sent[t] = Math.max(cheer.sent[t] || 0, snap[t] || 0); }).catch(() => {});
}
function popCheer(btn) {
  if (cheer.pops > 10) return;
  cheer.pops++;
  const r = btn.getBoundingClientRect();
  const p = document.createElement('span');
  p.className = 'cheer-pop';
  p.textContent = '+1';
  p.style.cssText = `left:${r.left + r.width / 2 + (Math.random() - 0.5) * 24}px;top:${r.top}px;color:${L.TEAM_INFO[btn.dataset.t]?.color || 'var(--navy)'}`;
  document.body.appendChild(p);
  setTimeout(() => { p.remove(); cheer.pops--; }, 650);
}

// ---------- 個人賞の発表（司会者が押すと全員のスマホに出る。受賞者はゲームの記録で自動的に決まる） ----------
let awardsShown = null;
let awardsClosed = null;
let awardTimers = [];
function paintAwards() {
  const aw = S.state?.awards;
  let el = $('#awards');
  const show = !!(aw?.at && me() && S.state.phase === 'final' && awardsClosed !== aw.at);
  if (!show) {
    if (el) { awardTimers.forEach(clearTimeout); awardTimers = []; el.remove(); }
    document.body.classList.remove('awarding');
    awardsShown = null;
    return;
  }
  if (el && awardsShown === aw.at) return;
  awardsShown = aw.at;
  awardTimers.forEach(clearTimeout); awardTimers = [];
  el?.remove();
  el = document.createElement('div');
  el.id = 'awards';
  el.className = 'awards';
  el.setAttribute('role', 'dialog');
  const list = L.arr(aw.list);
  const winHTML = a => {
    const ws = L.arr(a.winners);
    if (!ws.length) return '<p class="aw-none">該当者なし</p>';
    return `${ws.map(w => `<div class="aw-person ${w.uid === uid ? 'me' : ''}">${w.team ? teamBadge(w.team) : ''}<b>${esc(w.name)}</b><small>${esc(w.detail || '')}</small>${w.uid === uid ? '<em>あなたです！おめでとう！</em>' : ''}</div>`).join('')}${ws.length > 1 ? `<p class="aw-tie">同じ記録で${ws.length}人が受賞</p>` : ''}`;
  };
  el.innerHTML = `<div class="aw-in">
      <p class="aw-kicker">Awards</p>
      <h2 class="aw-title">個人賞の発表</h2>
      <p class="aw-lead">受賞者は、ゲームの記録から自動で決まりました</p>
      ${list.map((a, i) => `<section class="aw-card" id="aw${i}">
        <p class="aw-no">個人賞 ${i + 1}</p>
        <h3>${esc(a.title)}</h3>
        <p class="aw-sub">${esc(a.sub)}</p>
        <div class="aw-win" hidden>${winHTML(a)}</div>
        <p class="aw-wait">発表まで、もう少し…</p>
      </section>`).join('')}
      <button class="btn btn-primary btn-block" id="awClose" hidden>閉じる</button>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('awarding');
  $('#awClose', el).addEventListener('click', () => { awardsClosed = aw.at; document.body.classList.remove('awarding'); paintAwards(); });
  const base = Number(aw.at) || be.serverNow();
  const late = be.serverNow() - base > (list.length * 4500 + 3000);
  list.forEach((a, i) => {
    const t = base + 1800 + i * 4500 - be.serverNow();
    const reveal = () => {
      const card = $('#aw' + i, el);
      if (!card) return;
      $('.aw-win', card).hidden = false;
      $('.aw-wait', card).hidden = true;
      card.classList.add('open');
      if (late) return;
      try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* noop */ }
      sfx.fanfare();
      if (L.arr(a.winners).some(w => w.uid === uid)) { confetti(4000); vibrate([60, 40, 120]); }
    };
    if (late || t <= 0) reveal();
    else {
      if (t > 1500) awardTimers.push(setTimeout(() => sfx.drum(1.3), t - 1400));
      awardTimers.push(setTimeout(reveal, t));
    }
  });
  const tClose = base + 1800 + (list.length - 1) * 4500 + 1500 - be.serverNow();
  const showClose = () => { const b = $('#awClose', el); if (b) b.hidden = false; };
  late || tClose <= 0 ? showClose() : awardTimers.push(setTimeout(showClose, tClose));
}

// ---------- 説明スライド（司会者が管理画面で出す。全員のスマホに同じページが同時に出る） ----------
let explainShown = null;
const myTeamPicked = () => { const t = me()?.team; const u = t && S.pick?.[t]; return !!(u && S.members?.[u]?.team === t); };
let explainClosed = null; // 代表者が準備OKを押すために、そのページだけ自分で閉じた
function paintExplain() {
  const st = S.state;
  const ex = st?.explain;
  const pageKey = ex?.key ? `${ex.key}|${ex.page}|${st.phase}` : null;
  const show = !!(ex?.key && me() && L.EXPLAIN_PHASES.includes(st.phase) && explainClosed !== pageKey);
  let el = $('#explain');
  if (!show) {
    if (el) { el.id = ''; el.classList.add('out'); setTimeout(() => el.remove(), 260); }
    document.body.classList.remove('explaining');
    explainShown = null;
    return;
  }
  const slides = L.explainSlides(ex.key, { mult: Number(st.mult) || 1, round: st.round || 1, phase: st.phase, award2: L.award2Of(S.config) });
  if (!slides.length) return;
  const page = Math.min(Math.max(Number(ex.page) || 0, 0), slides.length - 1);
  const k = `${ex.key}|${page}|${slides.length}|${st.phase}|${isRep() ? 'rep' : ''}|${S.prog?.[uid]?.ok ? 'ok' : ''}|${myTeamPicked() ? 'p' : ''}`;
  if (el && k === explainShown) return;
  const first = !el;
  if (!el) {
    el = document.createElement('div');
    el.id = 'explain';
    el.className = 'explain';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el);
  }
  explainShown = k;
  // 最後のページ（代表者決め・準備OK）では、自分の画面だけ閉じて操作できるボタンを出す
  const sl = slides[page];
  const closeBtn = sl.action === 'pick' && !myTeamPicked() ? '<button class="btn btn-primary btn-block" id="explainClose">閉じて代表者を決める</button>'
    : sl.action === 'ok' && isRep() && !S.prog?.[uid]?.ok ? '<button class="btn btn-primary btn-block" id="explainClose">閉じて「準備OK」を押す</button>' : '';
  el.innerHTML = `<div class="explain-in">
      <div class="explain-top"><span class="explain-badge">説明中</span><b>${esc(explainName(ex.key))}</b><span class="explain-page">${page + 1}<small> / ${slides.length}</small></span></div>
      <div class="explain-dots" aria-hidden="true">${slides.map((_, i) => `<i class="${i < page ? 'done' : i === page ? 'cur' : ''}"></i>`).join('')}</div>
      <div class="explain-body" aria-live="polite">${explainSlideHTML(slides[page])}</div>
      <p class="explain-foot">司会者の説明に合わせて、ページが自動で進みます</p>
      ${closeBtn}
    </div>`;
  $('#explainClose', el)?.addEventListener('click', () => { explainClosed = pageKey; paintExplain(); });
  el.scrollTop = 0;
  document.body.classList.add('explaining');
  first ? sfx.reveal() : sfx.choose();
}

// ---------- いまやること（画面上部に常に表示して、次の行動を迷わせない） ----------
let joinState = { name: false, team: null };
function paintNow() {
  const bar = $('#nowBar');
  if (!bar) return;
  document.body.classList.toggle('is-rep', isRep());
  const kind = (view.key || '').split('|')[0];
  const st = S.state;
  const m = me();
  let h = '';
  if (kind === 'join') {
    if (!S.config?.regOpen) h = nowHTML({ tag: '受付終了', title: '参加受付は締め切られています', sub: '参加したい場合は司会者に声をかけてください', kind: 'wait' });
    else if (!joinState.name) h = nowHTML({ tag: 'STEP 1/3', title: '下の欄に名前を入力', sub: 'ニックネームでもOK', kind: 'act' });
    else if (!joinState.team) h = nowHTML({ tag: 'STEP 2/3', title: '自分のチーム（A〜E）をタップ', sub: '幹事から案内されたチームを選んでください', kind: 'act' });
    else h = nowHTML({ tag: 'STEP 3/3', title: `「${joinState.team}チームで参加する」を押す`, sub: '押したら登録完了です', kind: 'act' });
  } else if (kind === 'lobby' && m) {
    const pick = S.pick || {};
    const mine = pick[m.team] && S.members?.[pick[m.team]]?.team === m.team ? pick[m.team] : null;
    const decided = L.TEAMS.filter(t => pick[t] && S.members?.[pick[t]]?.team === t).length;
    if (!mine) h = nowHTML({ tag: 'いまやること', title: 'チームで代表者を1人決めよう', sub: '話し合って、出る人だけが「わたしが出る」を押します', kind: 'act' });
    else if (mine === uid) h = nowHTML({ tag: 'あなたが代表', title: '司会者の発表を待とう', sub: `代表者が決まったチーム ${decided}/5。そろったら呼ばれます`, kind: 'mine' });
    else h = nowHTML({ tag: '待つだけ', title: `代表は ${esc(S.members[mine].name)} さん。あとは待つだけ`, sub: `あなたは何もしなくてOK（決定 ${decided}/5チーム）`, kind: 'wait' });
  } else if (kind === 'ready' && st) {
    if (isRep()) h = S.prog?.[uid]?.ok
      ? nowHTML({ tag: 'あなたが代表', title: '準備OK！ スタートの合図を待とう', sub: 'この画面を閉じずにそのまま持っていてください', kind: 'mine' })
      : nowHTML({ tag: 'いまやること', title: '前に出て「準備OK」を押そう', sub: 'あなたがこのゲームの代表です', kind: 'act' });
    else h = nowHTML({ tag: '観戦', title: '今回は観戦。何もしなくてOK', sub: 'このまま画面を開いておくと試合が見られます', kind: 'wait' });
  } else if (kind === 'run' && !isRep() && st?.game === 'quiz' && !st.quiz?.open) {
    h = st.quiz?.reveal != null
      ? nowHTML({ tag: '正解発表', title: '各チームの結果をチェック', sub: '次の問題が出たら、また応援ボタンで応援しよう', kind: 'wait' })
      : nowHTML({ tag: '観戦中', title: 'まもなく問題が出ます', sub: '問題が出ている間は、応援ボタンで応援できます', kind: 'wait' });
  } else if (kind === 'run' && !isRep()) {
    h = nowHTML({ tag: '観戦中', title: '下の応援ボタンで「がんばれ！」を送ろう', sub: 'どのチームにも何回でもOK。たくさん押すと……？', kind: 'act' });
  } else if (kind === 'judging') {
    h = nowHTML({ tag: '集計中', title: 'そのまま待とう', sub: 'まもなく全員の画面で結果発表が始まります', kind: 'wait' });
  }
  // 結果発表・総合結果は見るだけなので、画面を広く使うために「いまやること」は出さない
  if (bar.innerHTML !== h) bar.innerHTML = h;
}

function mount(key) {
  try { view.ctl?.destroy?.(); } catch (e) { console.warn(e); }
  view = { key, ctl: null };
  window.scrollTo(0, 0);
  document.body.dataset.view = key.split('|')[0];
  const kind = key.split('|')[0];
  const ctl =
    kind === 'loading' || kind === 'loading-run' ? simple(loadingHTML('読み込み中…')) :
    kind === 'noinit' ? simple(waitingInitHTML()) :
    kind === 'join' ? mountJoin() :
    kind === 'lobby' ? mountLobby() :
    kind === 'ready' ? mountReady() :
    kind === 'run' ? (isRep() ? mountRep() : mountSpectator()) :
    kind === 'judging' ? mountJudging() :
    kind === 'results' ? mountResults() :
    kind === 'final' ? mountFinal() : simple(loadingHTML('…'));
  view.ctl = ctl;
}

function simple(html) { app.innerHTML = html; return {}; }
const loadingHTML = msg => `<section class="card center loading"><div class="spinner"></div><p>${esc(msg)}</p></section>`;
const fatalHTML = msg => `<section class="card center warn"><span class="label">Error</span><h2>うまく読み込めませんでした</h2><p>${msg}</p><button class="btn" onclick="location.reload()">再読み込み <span class="arr">→</span></button></section>`;
const waitingInitHTML = () => `<section class="card center">${cubeSVG()}<span class="label">Preparing</span><h2>準備中です</h2><p>司会者がゲームを準備しています。少し待ってから、このページを再読み込みしてください。</p></section>`;

// ---------- 参加登録 ----------
function mountJoin() {
  let picked = null;
  let busy = false;
  app.innerHTML = `
    <section class="card white hero-join">
      ${cubeSVG(110)}
      <div class="eyebrow">2026.12.18 Year-end party</div>
      <h2 class="title-xl">チーム対抗<br>ゲーム大会</h2>
      <p class="muted">5チームに分かれて、4つのゲームで対決します。</p>
      <div class="field-step" id="stepName"><i>1</i><span class="nw">名前を入力</span><small>ニックネームOK・16文字まで</small></div>
      <input id="nameIn" class="input" maxlength="16" autocomplete="nickname" enterkeyhint="done" placeholder="例：くりす">
      <div class="field-step" id="stepTeam"><i>2</i><span class="nw">自分のチームをタップ</span></div>
      <div class="team-pick" id="teamPick"></div>
      <div id="regMsg"></div>
      <button class="btn btn-primary btn-xl" id="joinBtn" disabled>名前を入力してください</button>
    </section>
    <section class="card slim">
      <details class="more"><summary>参加のながれ・得点・注意事項を見る</summary>
        <ol class="howto">${L.OVERVIEW.flow.map(h => `<li>${h}</li>`).join('')}</ol>
        <div class="infobox"><span class="k">得点</span>各ゲームの順位で得点が入り、4ゲームの合計で総合優勝が決まります（最終ゲームは2倍）。${pointsHTML(1)}</div>
        <ul class="checklist">${L.OVERVIEW.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        <p class="fine">ルールは各ゲームの前に画面に出ます。右上の「?」でいつでも見られます。同じスマホ・同じブラウザなら、閉じても続きから参加できます。</p>
      </details>
    </section>`;
  const nameIn = $('#nameIn');
  const btn = $('#joinBtn');
  try { nameIn.value = localStorage.getItem('ekzm-name') || ''; } catch { /* noop */ }
  const paint = () => {
    const cap = Object.values(S.config?.slots || {}).filter(v => v === true).length || 0;
    const counts = Object.fromEntries(L.TEAMS.map(t => [t, Object.values(S.slots?.[t] || {}).filter(Boolean).length]));
    $('#teamPick').innerHTML = L.TEAMS.map(t => {
      const full = cap && counts[t] >= cap;
      return `<button class="team-btn ${picked === t ? 'on' : ''}" data-team="${t}" style="${tvars(t)}" ${full ? 'disabled' : ''} aria-label="${t}チーム">
        <b>${t}</b><small>${full ? '満員' : `${counts[t]}人`}</small></button>`;
    }).join('');
    const open = !!S.config?.regOpen;
    const hasName = !!L.cleanName(nameIn.value);
    $('#regMsg').innerHTML = open ? '' : '<p class="note warn">参加受付は締め切られています。参加したい場合は司会者に声をかけてください。</p>';
    $('#stepName').classList.toggle('done', hasName);
    $('#stepTeam').classList.toggle('done', !!picked);
    btn.disabled = busy || !open || !picked || !hasName;
    if (!busy) btn.innerHTML = !open ? '受付は締め切られています' : !hasName ? '名前を入力してください' : !picked ? 'チームを選んでください' : `${picked}チームで参加する <span class="arr">→</span>`;
    joinState = { name: hasName, team: picked };
    paintNow();
  };
  $('#teamPick').addEventListener('click', e => {
    const b = e.target.closest('[data-team]');
    if (!b || b.disabled) return;
    picked = b.dataset.team;
    sfx.choose();
    paint();
  });
  nameIn.addEventListener('input', paint);
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') nameIn.blur(); });
  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true; btn.textContent = '登録しています…'; paint();
    try {
      try { localStorage.setItem('ekzm-name', L.cleanName(nameIn.value)); } catch { /* noop */ }
      await joinTeam(be, nameIn.value, picked);
      wantAwake();
      sfx.go();
      vibrate(40);
    } catch (e) {
      toast(errMsg(e), 'error', 5000);
      busy = false; paint();
    }
  });
  paint();
  return { update: paint };
}

// ---------- ロビー ----------
function pickButtonsHTML(myPick, played, busy) {
  const dis = busy ? 'disabled' : '';
  if (myPick === uid) {
    return `<div class="pick-row"><span><b>あなたが代表です。</b>呼ばれるまで待ちましょう</span><button class="btn btn-ghost btn-sm" id="unpickBtn" ${dis}>やっぱり辞退する</button></div>`;
  }
  if (myPick) return `<div class="pick-row"><span>あなたは何もしなくてOK</span><button class="btn btn-ghost btn-sm" id="pickBtn" ${dis}>代わりにわたしが出る</button></div>`;
  return `<button class="btn btn-primary btn-xl" id="pickBtn" ${dis}>わたしが出る <span class="arr">→</span></button>
    <p class="fine">${played ? 'まだ出ていない人が優先。' : 'チームで話し合って、'}<b>出る人だけ</b>が押してください</p>`;
}

function mountLobby() {
  app.innerHTML = `<div id="lobbyPick"></div><div id="lobbyMain"></div><section class="card slim" id="lobbyTeams"></section>`;
  let busy = false;
  let howKey = '';
  let pickMoreOpen = false;
  const paint = () => {
    const st = S.state;
    const gk = st.game || L.ROUND_GAMES[(st.round || 1) - 1];
    const g = L.GAMES[gk];
    const m = me();
    const team = m.team;
    const played = !!S.used?.[uid];
    const hasResults = Object.keys(S.results || {}).length > 0;
    const pick = S.pick || {};
    const mates = Object.entries(S.members || {}).filter(([, x]) => x.team === team).map(([u, x]) => ({ uid: u, ...x }));
    const unusedMates = mates.filter(x => !S.used?.[x.uid]);
    const myPick = pick[team] && S.members?.[pick[team]]?.team === team ? pick[team] : null;
    const decided = L.TEAMS.filter(t => pick[t] && S.members?.[pick[t]]?.team === t).length;
    $('#lobbyPick').innerHTML = `
      <section class="card pick-card" style="${tvars(team)}">
        <div class="pick-head">${teamBadge(team)}<b>${team}チームの代表者</b><span class="chip ${myPick ? 'ok' : 'warn'}">${myPick ? '決定' : '未定'}</span></div>
        ${myPick ? `<div class="pick-now"><span class="nw">${esc(S.members[myPick].name)}</span> さんに決定</div>` : ''}
        ${pickButtonsHTML(myPick, played, busy)}
        <ul class="pick-members" aria-label="チームのメンバー">${mates.map(x => `<li class="${x.uid === myPick ? 'picked' : ''} ${x.uid === uid ? 'me' : ''}">${esc(x.name)}${S.used?.[x.uid] ? ` <small class="played">出場${Object.keys(S.used[x.uid]).length}回</small>` : ' <small class="fresh">未出場</small>'}</li>`).join('')}</ul>
        <details class="more" id="pickMore" ${pickMoreOpen ? 'open' : ''}><summary>代表者の決め方・参加メンバー（${Object.keys(S.members || {}).length}人）</summary>
          <div class="infobox">決まるとチーム全員の画面に名前が出ます。取り消すときは本人が「やっぱり辞退する」、交代するときは新しく出る人が「代わりにわたしが出る」を押します。4ゲームで全員が1回ずつ出るのが目安です。</div>
          ${rosterHTML(S.members, { me: uid, used: S.used })}
        </details>
      </section>`;
    $('#pickMore')?.addEventListener('toggle', e => { pickMoreOpen = e.target.open; });
    if (howKey !== gk + st.mult + st.round) {
      howKey = gk + st.mult + st.round;
      $('#lobbyMain').innerHTML = `
        <section class="card next-card">
          <h2 class="title-md"><span class="label">Next</span>${gameTag(gk)}${esc(g.title)}${Number(st.mult) > 1 ? '<span class="x2">得点2倍</span>' : ''}</h2>
          <p class="muted lead1">${esc(g.lead)}</p>
          <details class="more"><summary>遊び方を見る</summary>${howtoHTML(gk, { mult: st.mult })}</details>
        </section>`;
    }
    const totals = hasResults ? L.computeTotals(S.results, S.adjust) : {};
    $('#lobbyTeams').innerHTML = teamStripHTML(L.TEAMS.map(t => {
      const u = pick[t];
      const ok = u && S.members?.[u]?.team === t;
      return { t, top: ok ? '決定' : '相談中', sub: hasResults ? `${totals[t] || 0}pt` : '', cls: ok ? 'ok' : 'wait' };
    }), { me: team, title: `代表者 ${decided}/5 チーム決定${hasResults ? '<span>下の数字は合計点</span>' : ''}` });
    $('#pickBtn')?.addEventListener('click', async () => {
      if (played && unusedMates.length && !confirm(`あなたは出場済みです。まだ出ていない人（${unusedMates.map(x => x.name).join('・')}）がいますが、それでも出ますか？`)) return;
      busy = true; paint();
      try { await be.set(`pick/${team}`, uid); sfx.choose(); vibrate(40); wantAwake(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      catch (e) { toast(errMsg(e), 'error', 5000); }
      busy = false; paint();
    });
    $('#unpickBtn')?.addEventListener('click', async () => {
      busy = true; paint();
      try { await be.remove(`pick/${team}`); } catch (e) { toast(errMsg(e), 'error', 5000); }
      busy = false; paint();
    });
    paintNow();
  };
  paint();
  return { update: paint };
}

// ---------- 代表者発表 ----------
function repsListHTML(st, statusFn) {
  return `<ul class="reps">${L.TEAMS.filter(t => st.reps?.[t]).map(t => {
    const u = st.reps[t];
    const nm = S.members?.[u]?.name || '（退出）';
    return `<li class="rep ${u === uid ? 'me' : ''}" style="${tvars(t)}">${teamBadge(t)}<b>${esc(nm)}</b><span class="rep-st">${statusFn ? statusFn(u, t) : ''}</span></li>`;
  }).join('')}</ul>`;
}

function gameIntroHTML(st, role = 'all') {
  const g = L.GAMES[st.game];
  return `<section class="card next-card game-intro">
    <div class="next-top"><span class="label">Game ${gameNo(st)} / 4</span>${progressHTML(st.round, st.phase)}</div>
    <h2 class="title-md">${gameTag(st.game)}${esc(g.title)}${Number(st.mult) > 1 ? '<span class="x2">得点2倍</span>' : ''}</h2>
    <p class="muted lead1">${esc(g.lead)}</p>
    <details class="more"><summary>遊び方を見る</summary>${howtoHTML(st.game, { mult: st.mult, role })}</details>
  </section>`;
}

/** 今回の代表者（5チームを1行で） */
function repsStripHTML(st, statusFn, title = '今回の代表者') {
  return teamStripHTML(L.TEAMS.filter(t => st.reps?.[t]).map(t => {
    const u = st.reps[t];
    return { t, top: esc(S.members?.[u]?.name || '（退出）'), sub: statusFn ? statusFn(u, t) : '', cls: u === uid ? 'self' : '' };
  }), { title });
}

function mountReady() {
  const st = S.state;
  const rep = isRep();
  app.innerHTML = `<div id="youBox"></div>
    ${gameIntroHTML(st, rep ? 'rep' : 'all')}
    <section class="card slim" id="repsBox"></section>`;
  if (rep) { sfx.fanfare(); vibrate([100, 60, 100]); } else sfx.reveal();
  let sending = false;
  const paint = () => {
    const okMine = !!S.prog?.[uid]?.ok;
    $('#youBox').innerHTML = rep
      ? `<section class="card you-rep" style="${tvars(me().team)}">
          <div class="pick-head">${teamBadge(me().team)}<b>あなたが代表です</b><span class="chip ${okMine ? 'ok' : 'warn'}">${okMine ? '準備OK' : '準備中'}</span></div>
          <ul class="checklist tight">
            <li>司会者の近くに出る</li>
            <li>マナーモードを解除して、スマホを縦に持つ</li>
            <li>始まったら画面を閉じない・再読み込みしない</li>
          </ul>
          <button class="btn btn-primary btn-xl" id="okBtn" ${okMine || sending ? 'disabled' : ''}>${okMine ? '準備OK。スタートを待っています' : '準備OK <span class="arr">→</span>'}</button>
        </section>`
      : `<section class="card slim spectator-note"><b>今回は観戦です。</b>何もしなくてOK。このまま画面を開いておくと、試合のようすが見られます。</section>`;
    $('#repsBox').innerHTML = repsStripHTML(st, u => (S.prog?.[u]?.ok ? '<span class="ok">準備OK</span>' : '<span class="muted">準備中</span>'));
    $('#okBtn')?.addEventListener('click', async () => {
      sending = true; paint();
      wantAwake();
      await markProg(be, st.runId, 'ok');
      sfx.choose();
      sending = false; paint();
    });
    paintNow();
  };
  paint();
  return { update: paint };
}

// ---------- 代表者：ゲーム ----------
function mountRep() {
  const st = S.state;
  const done = st.game === 'quiz' ? false : !!S.mine?.res;
  const started = !!S.prog?.[uid]?.go;
  if (done) return submittedView('記録しました', '結果は全チームそろってから、みんなの画面で同時に発表されます。席に戻って待ちましょう。');
  if (st.game !== 'quiz' && started) return lockedView('go');
  if (st.game === 'ten') return tenRep(st);
  if (st.game === 'iai') return iaiRep(st);
  if (st.game === 'touch') return touchRep(st);
  if (st.game === 'tap') return tapRep(st);
  if (st.game === 'quiz') return quizRep(st);
  return simple(loadingHTML('…'));
}

function submittedView(title, sub) {
  app.innerHTML = `<section class="card center submitted">${cubeSVG()}<span class="label">Recorded</span><h2>${esc(title)}</h2><p>${esc(sub)}</p></section>`;
  return { update: () => (!S.mine?.res ? 'remount' : undefined) }; // 司会者が再挑戦を許可したら戻る
}

function lockedView(flag) {
  app.innerHTML = `<section class="card center warn"><span class="label">Paused</span><h2>挑戦が中断されました</h2>
    <p>ゲームの途中で画面が再読み込みされた（または閉じられた）ため、この挑戦はいったん止まっています。</p>
    <div class="infobox"><span class="k">どうすればいい？</span>司会者に声をかけて、管理画面の「再挑戦を許可」を押してもらってください。この画面が自動でゲームに戻ります。</div></section>`;
  return { update: () => (!S.prog?.[uid]?.[flag] ? 'remount' : undefined) };
}

/** 送信済みの記録を司会者が取り消した（再挑戦許可）ときは画面を作り直す */
function retryCheck(guard) {
  if (guard.sent && !S.mine?.res && !S.prog?.[uid]?.go) return 'remount';
  return undefined;
}

/** ゲーム開始時刻（遅れて画面を開いた場合はその場で3秒カウント） */
function goTime(st) {
  const p = perfAt(be, st.startAt);
  return p < performance.now() + 600 ? performance.now() + 3200 : p;
}

function finishSend(st, key, payload, hintEl, okMsg = '記録しました！結果発表をお楽しみに', guard = null) {
  if (hintEl) hintEl.textContent = '記録を送信中…';
  return submitResult(be, st.runId, key, payload)
    .then(() => { if (hintEl) hintEl.textContent = okMsg; if (guard) guard.sent = true; })
    .catch(e => { if (hintEl) hintEl.textContent = '送信できませんでした：' + errMsg(e); toast(errMsg(e), 'error', 6000); });
}

function tenRep(st) {
  app.innerHTML = `<section class="game game-ten">
      <div class="game-top"><span class="label">Game ${gameNo(st)} ・ 代表者</span><h2>${esc(L.GAMES.ten.title)}</h2></div>
      <div class="ten-display"><span class="ten-num" id="tenNum">0.00</span><span class="ten-unit">秒</span></div>
      <p class="hint big" id="tenHint">スタートしたら心の中で数えて、${L.TEN_TARGET / 1000}秒ちょうどでSTOP</p>
      <button class="stop-btn" id="stopBtn" disabled>STOP</button>
    </section>`;
  const num = $('#tenNum'), hint = $('#tenHint'), btn = $('#stopBtn');
  let t0 = null, stopped = false, raf = 0;
  const cancelCd = countdownOverlay(app, goTime(st), {
    label: L.GAMES.ten.title, sub: `数字が見えるのは最初の3秒だけ。${L.TEN_TARGET / 1000}秒だと思ったらSTOPをタップ`,
    onGo(now) {
      t0 = now; sfx.go(); vibrate(40); markProg(be, st.runId, 'go');
      btn.disabled = false; btn.classList.add('live');
      const loop = () => {
        if (stopped) return;
        const e = performance.now() - t0;
        if (e < L.TEN_VISIBLE) num.textContent = (e / 1000).toFixed(2);
        else if (!num.classList.contains('masked')) { num.textContent = '?.??'; num.classList.add('masked'); hint.textContent = `数字は隠れました。数え続けて、${L.TEN_TARGET / 1000}秒ちょうどでSTOP`; }
        if (e >= L.TEN_LIMIT) { finish(L.TEN_LIMIT); return; }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    },
  });
  function finish(ms) {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    sfx.stop(); vibrate(70);
    btn.disabled = true; btn.classList.remove('live'); btn.classList.add('pressed');
    num.textContent = 'STOP!'; num.classList.add('stopped');
    finishSend(st, 'res', { v: Math.round(ms) }, hint, undefined, guard);
  }
  const guard = { sent: false };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); if (t0 == null || stopped) return; finish(evTime(e) - t0); });
  return { update: () => retryCheck(guard), destroy() { cancelCd(); cancelAnimationFrame(raf); } };
}

function iaiRep(st) {
  document.body.classList.add('fullgame');
  app.innerHTML = `<section class="game game-iai" id="iaiArea">
      <div class="iai-bg"></div><div class="iai-moon"></div><div class="iai-ground"></div>
      <div class="iai-label"><span class="eyebrow">GAME ${gameNo(st)} ・ 居合斬り</span></div>
      <div class="iai-text" id="iaiText">　</div>
      <div class="iai-sub" id="iaiSub">「構え…」の間は触らずに待つ。「斬れ！」が出た瞬間に画面のどこかをタップ</div>
      <div class="slash-layer" id="slashLayer"></div>
    </section>`;
  const area = $('#iaiArea'), text = $('#iaiText'), sub = $('#iaiSub');
  let armed = false, t0 = null, finished = false, cancelGo = null, timeoutId = 0;
  const kamaeAt = goTime(st);
  const delay = Number(st.iaiDelay) || 3000;
  const cancelCd = countdownOverlay(app, kamaeAt, {
    label: '居合斬り', sub: '「構え…」の間に触るとフライングで失格。「斬れ！」でタップ',
    onGo() {
      armed = true; markProg(be, st.runId, 'go');
      text.textContent = '構え…'; text.className = 'iai-text kamae';
      area.classList.add('kamae'); sfx.kamae(); vibrate(30);
      cancelGo = waitUntil(kamaeAt + delay, {
        onGo(now) {
          if (finished) return;
          area.classList.remove('kamae'); area.classList.add('kire');
          text.textContent = '斬れ！'; text.className = 'iai-text kire';
          t0 = now; sfx.kire(); vibrate(25);
          timeoutId = setTimeout(() => finish({ v: L.IAI_LIMIT }, 'timeout'), L.IAI_LIMIT);
        },
      });
    },
  });
  area.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!armed || finished) return;
    const ts = evTime(e);
    if (t0 == null) { finish({ v: 0, f: true }, 'foul'); return; }
    const rt = Math.max(0, Math.round(ts - t0));
    if (rt < L.IAI_FOUL_MS) finish({ v: rt, f: true }, 'foul');
    else finish({ v: rt, f: false }, 'ok', e);
  });
  function finish(payload, kind, e) {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutId); cancelGo?.();
    if (kind === 'foul') {
      area.classList.remove('kamae', 'kire'); area.classList.add('foul');
      text.textContent = 'フライング！'; text.className = 'iai-text foul';
      sfx.foul(); vibrate([200, 80, 200]); flash('rgba(255,0,40,.6)', 450);
    } else if (kind === 'timeout') {
      text.textContent = '時間切れ…'; text.className = 'iai-text';
      sfx.wrong();
    } else {
      slashEffect($('#slashLayer'), e);
      text.textContent = '斬！'; text.className = 'iai-text zan';
      sfx.slash(); vibrate([30, 30, 90]); flash('#ffffff', 220);
    }
    finishSend(st, 'res', payload, sub, undefined, guard);
  }
  const guard = { sent: false };
  return { update: () => retryCheck(guard), destroy() { cancelCd(); cancelGo?.(); clearTimeout(timeoutId); document.body.classList.remove('fullgame'); } };
}

export function slashEffect(layer, e) {
  if (!layer) return;
  const r = layer.getBoundingClientRect();
  const x = e ? e.clientX - r.left : r.width / 2;
  const y = e ? e.clientY - r.top : r.height / 2;
  const ang = -25 - Math.random() * 20;
  layer.innerHTML = `<div class="slash" style="left:${x}px;top:${y}px;--ang:${ang}deg"></div>
    <div class="slash s2" style="left:${x}px;top:${y + 10}px;--ang:${ang + 8}deg"></div>
    ${Array.from({ length: 14 }, (_, i) => `<i class="spark" style="left:${x}px;top:${y}px;--dx:${Math.cos(i) * (60 + Math.random() * 120)}px;--dy:${Math.sin(i * 1.7) * (60 + Math.random() * 120)}px"></i>`).join('')}`;
  layer.parentElement?.classList.add('cut');
}

function tapRep(st) {
  document.body.classList.add('fullgame');
  app.innerHTML = `<section class="game game-tap">
      <div class="tap-top"><span class="eyebrow">GAME ${gameNo(st)} ・ ${L.TAP_MS / 1000}秒連打</span><span class="tap-time"><b id="tapTime">${(L.TAP_MS / 1000).toFixed(2)}</b>秒</span></div>
      <div class="tap-bar"><i id="tapBar"></i></div>
      <div class="tap-count" id="tapCount">0</div>
      <button class="tap-pad" id="tapPad" disabled><span>TAP!</span></button>
      <p class="hint" id="tapHint">スタートの合図で、黄色いボタンを${L.TAP_MS / 1000}秒間とにかく連打</p>
    </section>`;
  const pad = $('#tapPad'), cnt = $('#tapCount'), time = $('#tapTime'), bar = $('#tapBar'), hint = $('#tapHint');
  let t0 = null, n = 0, ended = false, raf = 0, liveTimer = 0, lastSent = -1, endTimer = 0;
  const cancelCd = countdownOverlay(app, goTime(st), {
    label: `${L.TAP_MS / 1000}秒連打`, sub: 'スタートしたら黄色いボタンを連打。指を何本使ってもOK',
    onGo(now) {
      t0 = now; sfx.go(); vibrate(40); markProg(be, st.runId, 'go');
      pad.disabled = false; pad.classList.add('live');
      liveTimer = setInterval(() => {
        if (t0 == null || ended) return;
        if (performance.now() - t0 > L.TAP_LIVE_UNTIL) return;
        if (n !== lastSent) { lastSent = n; sendLive(be, st.runId, n); }
      }, 250);
      const loop = () => {
        const e = performance.now() - t0;
        const left = Math.max(0, L.TAP_MS - e);
        time.textContent = (left / 1000).toFixed(2);
        bar.style.width = (left / L.TAP_MS) * 100 + '%';
        if (left <= 0) { end(); return; }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      endTimer = setTimeout(end, L.TAP_MS + 80); // 画面描画が止まっても時間どおりに必ず締める
    },
  });
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (t0 == null || ended) return;
    const ts = evTime(e);
    if (ts < t0 || ts > t0 + L.TAP_MS) return;
    if (n >= L.TAP_MAX) return;
    n++;
    cnt.textContent = n;
    cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump');
    sfx.tap();
  });
  function end() {
    if (ended) return;
    ended = true;
    clearInterval(liveTimer); cancelAnimationFrame(raf); clearTimeout(endTimer);
    pad.disabled = true; pad.classList.remove('live');
    pad.innerHTML = '<span>TIME UP!</span>';
    sfx.stop(); vibrate([60, 40, 60]);
    finishSend(st, 'res', { v: n }, hint, `記録 ${n}回 を送信しました！結果発表を待とう`, guard);
  }
  const guard = { sent: false };
  return { update: () => retryCheck(guard), destroy() { cancelCd(); clearInterval(liveTimer); clearTimeout(endTimer); cancelAnimationFrame(raf); document.body.classList.remove('fullgame'); } };
}

// ---------- 数字タッチ（1→16 を順番にタップ。全員同じ並び） ----------
function touchRep(st) {
  document.body.classList.add('fullgame');
  const board = L.touchBoard(st.runId);
  app.innerHTML = `<section class="game game-touch">
      <div class="touch-top"><span class="eyebrow">GAME ${gameNo(st)} ・ 数字タッチ</span><span class="tap-time"><b id="tTime">0.00</b>秒</span></div>
      <div class="touch-next">次は <b id="tNext">1</b><small> / ${L.TOUCH_N}</small></div>
      <div class="touch-grid" id="tGrid">${board.map(n => `<button class="tcell" data-n="${n}" disabled>?</button>`).join('')}</div>
      <p class="hint" id="tHint">スタートの合図で数字が出ます。1から順番にタップ</p>
    </section>`;
  const grid = $('#tGrid'), nextEl = $('#tNext'), time = $('#tTime'), hint = $('#tHint');
  let t0 = null, next = 1, ended = false, raf = 0, liveTimer = 0, endTimer = 0, lastSent = -1;
  const cancelCd = countdownOverlay(app, goTime(st), {
    label: '数字タッチ', sub: '1から16まで、順番にタップ。違う数字を押しても失格にはなりません',
    onGo(now) {
      t0 = now; sfx.go(); vibrate(40); markProg(be, st.runId, 'go');
      grid.querySelectorAll('.tcell').forEach(b => { b.textContent = b.dataset.n; b.disabled = false; });
      grid.classList.add('live');
      hint.textContent = '1から順番にタップ！';
      liveTimer = setInterval(() => { const n = next - 1; if (!ended && n !== lastSent) { lastSent = n; sendLive(be, st.runId, n); } }, 300);
      const loop = () => {
        const e = performance.now() - t0;
        time.textContent = (Math.min(e, L.TOUCH_LIMIT) / 1000).toFixed(2);
        if (e >= L.TOUCH_LIMIT) { end(L.TOUCH_LIMIT); return; }
        if (!ended) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      endTimer = setTimeout(() => end(L.TOUCH_LIMIT), L.TOUCH_LIMIT + 80);
    },
  });
  grid.addEventListener('pointerdown', e => {
    const b = e.target.closest('.tcell');
    if (!b || t0 == null || ended) return;
    e.preventDefault();
    const n = Number(b.dataset.n);
    if (n === next) {
      b.classList.add('ok'); b.disabled = true;
      next++;
      sfx.tap();
      if (next > L.TOUCH_N) { end(Math.min(L.TOUCH_LIMIT, evTime(e) - t0)); return; }
      nextEl.textContent = next;
    } else if (n > next) {
      b.classList.remove('ng'); void b.offsetWidth; b.classList.add('ng');
      vibrate(30);
    }
  });
  function end(ms) {
    if (ended) return;
    ended = true;
    clearInterval(liveTimer); clearTimeout(endTimer); cancelAnimationFrame(raf);
    const n = next - 1;
    sendLive(be, st.runId, n);
    grid.classList.remove('live');
    grid.querySelectorAll('.tcell').forEach(b => { b.disabled = true; });
    const goal = n >= L.TOUCH_N;
    time.textContent = (ms / 1000).toFixed(2);
    nextEl.parentElement.innerHTML = goal ? '<b>GOAL!</b>' : `<b>TIME UP</b><small> ${n} / ${L.TOUCH_N}</small>`;
    sfx.stop(); vibrate([60, 40, 60]);
    finishSend(st, 'res', { v: Math.round(ms), n }, hint, goal ? `ゴール！ ${(ms / 1000).toFixed(2)}秒で送信しました` : `${n}まで押せました。結果発表を待とう`, guard);
  }
  const guard = { sent: false };
  return { update: () => retryCheck(guard), destroy() { cancelCd(); clearInterval(liveTimer); clearTimeout(endTimer); cancelAnimationFrame(raf); document.body.classList.remove('fullgame'); } };
}

function specTouch(stage, st) {
  stage.innerHTML = `<div class="tap-top spec"><span class="eyebrow">LIVE 進み具合</span><span class="tap-time"><b id="sTime">0.00</b>秒</span></div>
    <div class="live-bars" id="sBars"></div><p class="hint center" id="sHint">合図と同時にスタート。1から16まで順番にタップしています</p>`;
  let t0 = null, raf = 0;
  const cancel = countdownOverlay(stage, perfAt(be, st.startAt), {
    label: '数字タッチ',
    onGo(now) {
      t0 = Math.min(now, perfAt(be, st.startAt)); sfx.go();
      const loop = () => {
        const e = performance.now() - t0;
        $('#sTime', stage).textContent = (Math.min(e, L.TOUCH_LIMIT) / 1000).toFixed(2);
        if (e < L.TOUCH_LIMIT) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    },
  });
  const goals = new Set();
  function paint() {
    const reps = S.state?.reps || {};
    $('#sBars', stage).innerHTML = L.TEAMS.filter(t => reps[t]).map(t => {
      const u = reps[t];
      const done = !!S.prog?.[u]?.res;
      const n = Math.min(L.TOUCH_N, Number(S.live?.[u] || 0));
      if (done && n >= L.TOUCH_N && !goals.has(u)) { goals.add(u); sfx.stop(); }
      return `<div class="lb" style="${tvars(t)}">${teamBadge(t)}<span class="lb-track"><i style="width:${Math.round((n / L.TOUCH_N) * 100)}%"></i></span><b>${done && n >= L.TOUCH_N ? 'GOAL' : `${n}<small>/${L.TOUCH_N}</small>`}</b></div>`;
    }).join('');
  }
  paint();
  return {
    status: u => (S.prog?.[u]?.res ? (Number(S.live?.[u] || 0) >= L.TOUCH_N ? '<span class="st-stop">ゴール！</span>' : '<span class="st-stop">終了</span>') : S.prog?.[u]?.go ? '<span class="st-live">タッチ中…</span>' : '<span class="muted">待機</span>'),
    update: paint,
    destroy() { cancel(); cancelAnimationFrame(raf); },
  };
}

function quizRep(st) {
  app.innerHTML = `<section class="game game-quiz">
      <div class="game-top one"><span class="label">Game ${gameNo(st)} ・ 代表者</span><h2>早押しクイズ</h2></div>
      <div id="qBox"></div>
    </section>`;
  const box = $('#qBox');
  let curKey = '__init__';
  let qctl = null;
  let introDone = false;
  const cancelIntro = countdownOverlay(app, goTime(st), { label: '早押しクイズ', sub: '問題が出たら、正しいと思う答えをタップ。回答は1回だけ', onGo() { introDone = true; sfx.go(); paint(); } });
  function paint() {
    const q = S.state?.quiz || {};
    if (!introDone) return;
    if (q.key !== curKey) {
      qctl?.destroy?.();
      curKey = q.key;
      qctl = q.key ? mountQuestion(box, q, true) : null;
      if (!q.key) box.innerHTML = `<div class="q-wait"><span class="label">Stand by</span><p>まもなく <b>第1問</b> です。<br>司会者が出題すると、ここに問題と4つの答えが出ます。</p><p class="fine">全${q.total || L.QUIZ_DEFAULT_COUNT}問・1問15秒・回答は1問につき1回だけ</p></div>`;
    } else qctl?.update?.();
  }
  return { update: paint, destroy() { cancelIntro(); qctl?.destroy?.(); } };
}

/** 1問ごとの結果（○×・選んだ答え・回答時間・それまでの正解数）。司会者が正解発表のときに配る */
function quizResultHTML(qq) {
  const reps = S.state?.reps || {};
  return teamStripHTML(L.TEAMS.filter(t => reps[t]).map(t => {
    const r = qq.res?.[t] || {};
    const answered = r.c != null && r.c >= 0;
    return { t, top: `<span class="qr-mark">${r.ok ? '○' : '×'}</span>${answered ? 'ABCD'[r.c] : ''}`, sub: answered ? `${(Number(r.v) / 1000).toFixed(2)}秒` : '無回答', cls: `${r.ok ? 'ok' : 'ng'} ${reps[t] === uid ? 'self' : ''}` };
  }), { title: 'この問題の結果<span>選んだ答え・回答時間</span>' });
}

/** 1問分の表示（代表者=回答可能 / 観戦=見るだけ） */
function mountQuestion(box, q, asRep) {
  const st = S.state;
  const i = Number(q.idx);
  const key = q.key;
  const total = q.total || L.QUIZ_DEFAULT_COUNT;
  box.innerHTML = `<div class="q-card">
      <div class="q-head"><span class="q-no">Q${i + 1}<small>/${total}</small></span><span class="q-timer"><i id="qTimeBar"></i></span></div>
      <div class="q-text" id="qText">　</div>
      <div class="q-choices" id="qChoices"></div>
      <p class="hint" id="qHint"></p>
      <div class="q-res" id="qRes" hidden></div>
      <p class="q-note" id="qNote" hidden></p>
      ${asRep ? '' : '<div id="qAnswered" class="q-answered"></div>'}
    </div>`;
  const textEl = $('#qText', box), choicesEl = $('#qChoices', box), hint = $('#qHint', box), tbar = $('#qTimeBar', box);
  let t0 = null, answered = !!S.mine?.[key], myChoice = S.mine?.[key]?.c ?? null, raf = 0, limitTimer = 0, revealedShown = false;
  const locked = asRep && !answered && !!S.prog?.[uid]?.['g' + i];
  const showQ = now => {
    t0 = now;
    textEl.textContent = q.q?.text || '';
    choicesEl.innerHTML = L.arr(q.q?.choices).map((c, k) => `<button class="q-choice c${k}" data-k="${k}" ${asRep && !answered && !locked ? '' : 'disabled'}><span class="q-mark">${'ABCD'[k]}</span><span>${esc(c)}</span></button>`).join('');
    if (asRep && !answered && !locked) { markProg(be, st.runId, 'g' + i); hint.textContent = '正しいと思う答えをタップ（1回だけ・変更不可）'; }
    if (locked) hint.textContent = 'この問題は表示中に再読み込みされたため回答できません（無回答扱い）';
    if (answered) markChosen();
    const loop = () => {
      const left = Math.max(0, L.QUIZ_LIMIT - (performance.now() - t0));
      tbar.style.width = (left / L.QUIZ_LIMIT) * 100 + '%';
      if (left <= 0) {
        if (asRep && !answered && !locked && S.state?.quiz?.open) answer(-1, null);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    update();
  };
  const perfQ = perfAt(be, q.at);
  let cancelCd = null;
  if (perfQ > performance.now() + 300) {
    cancelCd = countdownOverlay(box.closest('.game') || app, perfQ, { label: `第${i + 1}問`, onGo: now => { sfx.go(); showQ(now); } });
  } else showQ(performance.now());

  function markChosen() {
    choicesEl.querySelectorAll('.q-choice').forEach(b => { b.disabled = true; if (Number(b.dataset.k) === Number(myChoice)) b.classList.add('chosen'); });
    hint.textContent = myChoice === -1 ? '時間切れ（無回答）。次の問題を待ちましょう' : '回答しました。司会者の正解発表を待ちましょう';
  }
  function answer(k, e) {
    if (answered || t0 == null) return;
    answered = true;
    myChoice = k;
    const ms = k === -1 ? L.QUIZ_LIMIT : Math.round(evTime(e) - t0);
    sfx.choose(); vibrate(30);
    markChosen();
    submitResult(be, st.runId, key, { v: Math.max(0, Math.min(L.QUIZ_LIMIT, ms)), c: k })
      .catch(err => { hint.textContent = '送信できませんでした：' + errMsg(err); });
  }
  choicesEl.addEventListener('pointerdown', e => {
    const b = e.target.closest('.q-choice');
    if (!b || b.disabled || !asRep) return;
    e.preventDefault();
    answer(Number(b.dataset.k), e);
  });
  function update() {
    const qq = S.state?.quiz || {};
    if (t0 == null) return;
    if (!qq.open && asRep && !answered) { choicesEl.querySelectorAll('.q-choice').forEach(b => (b.disabled = true)); hint.textContent = '締め切りました。次の問題を待ちましょう'; }
    if (!asRep) {
      const reps = Object.values(S.state?.reps || {});
      const n = reps.filter(u => S.prog?.[u]?.[key]).length;
      const el = $('#qAnswered', box);
      if (el) el.innerHTML = `<span>回答済み <b>${n}</b> / ${reps.length}</span>` + L.TEAMS.filter(t => S.state?.reps?.[t]).map(t => `<span class="ans-chip ${S.prog?.[S.state.reps[t]]?.[key] ? 'on' : ''}" style="${tvars(t)}">${t}</span>`).join('');
    }
    if (qq.reveal != null && qq.key === key && !revealedShown) {
      revealedShown = true;
      cancelAnimationFrame(raf);
      choicesEl.querySelectorAll('.q-choice').forEach(b => { b.disabled = true; if (Number(b.dataset.k) === Number(qq.reveal)) b.classList.add('correct'); else b.classList.add('dim'); });
      if (qq.res) {
        choicesEl.classList.add('revealed');
        const ans = $('#qAnswered', box); if (ans) ans.hidden = true;
        const reps = S.state?.reps || {};
        choicesEl.querySelectorAll('.q-choice').forEach(b => {
          const k = Number(b.dataset.k);
          const who = L.TEAMS.filter(t => reps[t] && Number(qq.res?.[t]?.c) === k);
          if (who.length) b.insertAdjacentHTML('beforeend', `<span class="q-pickers">${who.map(t => teamBadge(t)).join('')}</span>`);
        });
      }
      if (asRep) {
        const ok = Number(myChoice) === Number(qq.reveal);
        hint.innerHTML = ok ? '<b class="ok">正解！</b> 次の問題を待ちましょう' : '<b class="ng">不正解…</b> 次の問題で取り返しましょう';
        ok ? sfx.correct() : sfx.wrong();
      } else { hint.textContent = qq.res ? '' : '枠で囲まれたのが正解です'; if (qq.res) hint.hidden = true; sfx.correct(); }
      const noteEl = $('#qNote', box);
      if (noteEl && qq.note) { noteEl.innerHTML = `<b>解説</b>${esc(qq.note)}`; noteEl.hidden = false; }
      const resEl = $('#qRes', box);
      if (resEl && qq.res) { resEl.innerHTML = quizResultHTML(qq); resEl.hidden = false; }
    }
  }
  return { update, destroy() { cancelCd?.(); cancelAnimationFrame(raf); clearTimeout(limitTimer); } };
}

// ---------- 観戦 ----------
function mountSpectator() {
  const st = S.state;
  const g = L.GAMES[st.game];
  app.innerHTML = `<section class="card slim spec-head">
      <div class="spec-line"><span class="label">Live ${gameNo(st)}/4</span><b>${gameTag(st.game)}${esc(g.title)}</b>${Number(st.mult) > 1 ? '<span class="x2">得点2倍</span>' : ''}</div>
    </section>
    <section class="game spec spec-${st.game}" id="specStage"></section>
    ${st.game === 'ten' || st.game === 'iai' ? '<section class="card slim" id="specReps"></section>' : ''}`;
  const stage = $('#specStage');
  const inner = st.game === 'ten' ? specTen(stage, st) : st.game === 'iai' ? specIai(stage, st) : st.game === 'touch' ? specTouch(stage, st) : st.game === 'tap' ? specTap(stage, st) : specQuiz(stage, st);
  const paintReps = () => {
    const el = $('#specReps');
    if (el) el.innerHTML = repsStripHTML(S.state, u => inner.status?.(u) ?? '', '各チームの代表者');
  };
  paintReps();
  return { update() { inner.update?.(); paintReps(); }, destroy() { inner.destroy?.(); } };
}

function specTen(stage, st) {
  stage.innerHTML = `<div class="ten-display spec"><span class="ten-num" id="sNum">0.00</span><span class="ten-unit">秒</span></div><p class="hint center" id="sHint">タイマーが見えるのは最初の3秒だけ。代表者の体内時計を見守りましょう</p>`;
  const num = $('#sNum', stage);
  let raf = 0, t0 = null;
  const cancel = countdownOverlay(stage, perfAt(be, st.startAt), {
    label: L.GAMES.ten.title, sound: true,
    onGo(now) {
      t0 = Math.min(now, perfAt(be, st.startAt)); sfx.go();
      const loop = () => {
        const e = performance.now() - t0;
        if (e < L.TEN_VISIBLE) num.textContent = (e / 1000).toFixed(2);
        else { num.textContent = '?.??'; num.classList.add('masked'); }
        if (e < L.TEN_LIMIT + 10000) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    },
  });
  let stopped = new Set();
  return {
    status: u => (S.prog?.[u]?.res ? '<span class="st-stop">STOP!</span>' : S.prog?.[u]?.go ? '<span class="st-live">計測中…</span>' : '<span class="muted">待機</span>'),
    update() {
      for (const u of Object.values(S.state?.reps || {})) if (S.prog?.[u]?.res && !stopped.has(u)) { stopped.add(u); sfx.stop(); }
    },
    destroy() { cancel(); cancelAnimationFrame(raf); },
  };
}

function specIai(stage, st) {
  stage.innerHTML = `<div class="game-iai spec-iai" id="sIai"><div class="iai-bg"></div><div class="iai-moon"></div><div class="iai-ground"></div>
      <div class="iai-text" id="sText">　</div><div class="iai-sub" id="sSub">お静かに。代表者は「斬れ！」の合図を待っています</div><div class="slash-layer" id="sSlash"></div></div>`;
  const area = $('#sIai', stage), text = $('#sText', stage), sub = $('#sSub', stage);
  const kamaeAt = perfAt(be, st.startAt);
  const goAt = kamaeAt + (Number(st.iaiDelay) || 3000);
  let cancelGo = null, revealT = 0, canShow = false;
  const cancel = countdownOverlay(stage, kamaeAt, {
    label: '居合斬り',
    onGo() {
      text.textContent = '構え…'; text.className = 'iai-text kamae'; area.classList.add('kamae'); sfx.kamae();
      cancelGo = waitUntil(goAt, {
        onGo() {
          area.classList.remove('kamae'); area.classList.add('kire');
          text.textContent = '斬れ！'; text.className = 'iai-text kire'; sfx.kire();
          revealT = setTimeout(() => {
            canShow = true;
            queueRender();
            slashEffect($('#sSlash', stage)); sfx.slash(); flash('#fff', 200);
            text.textContent = '斬！'; text.className = 'iai-text zan';
            sub.textContent = '勝負あり。結果は発表で！';
          }, 1500);
        },
      });
    },
  });
  if (performance.now() > goAt + 1500) canShow = true;
  return {
    status: u => (!canShow ? (S.prog?.[u]?.go ? '<span class="st-live">構え中</span>' : '<span class="muted">待機</span>') : S.prog?.[u]?.res ? '<span class="st-stop">斬った！</span>' : '<span class="st-live">…</span>'),
    destroy() { cancel(); cancelGo?.(); clearTimeout(revealT); },
  };
}

function specTap(stage, st) {
  stage.innerHTML = `<div class="tap-top spec"><span class="eyebrow">LIVE 連打数</span><span class="tap-time"><b id="sTime">${(L.TAP_MS / 1000).toFixed(2)}</b>秒</span></div>
    <div class="tap-bar"><i id="sBar"></i></div>
    <div class="live-bars" id="sBars"></div><p class="hint center" id="sHint">合図と同時に連打スタート。棒グラフで各チームの回数が見られます</p>`;
  let t0 = null, raf = 0, phase = 'wait';
  const cancel = countdownOverlay(stage, perfAt(be, st.startAt), {
    label: `${L.TAP_MS / 1000}秒連打`,
    onGo(now) {
      t0 = Math.min(now, perfAt(be, st.startAt)); phase = 'live'; sfx.go();
      const loop = () => {
        const e = performance.now() - t0;
        const left = Math.max(0, L.TAP_MS - e);
        $('#sTime', stage).textContent = (left / 1000).toFixed(2);
        $('#sBar', stage).style.width = (left / L.TAP_MS) * 100 + '%';
        const np = e < L.TAP_LIVE_UNTIL ? 'live' : e < L.TAP_MS ? 'hidden' : 'end';
        if (np !== phase) { phase = np; paint(); if (np === 'hidden') sfx.drum(2); if (np === 'end') sfx.stop(); }
        if (left > 0) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    },
  });
  function paint() {
    const reps = S.state?.reps || {};
    const counts = L.TEAMS.filter(t => reps[t]).map(t => ({ t, n: Number(S.live?.[reps[t]] || 0) }));
    const max = Math.max(80, ...counts.map(c => c.n));
    $('#sBars', stage).innerHTML = counts.map(c => `<div class="lb" style="${tvars(c.t)}">${teamBadge(c.t)}<span class="lb-track"><i style="width:${phase === 'hidden' || phase === 'end' ? 100 : Math.round((c.n / max) * 100)}%" class="${phase !== 'live' ? 'secret' : ''}"></i></span><b>${phase === 'live' || phase === 'wait' ? c.n : '？？？'}</b></div>`).join('');
    $('#sHint', stage).textContent = phase === 'hidden' ? 'ラストスパート！ ここからの回数は結果発表まで秘密' : phase === 'end' ? 'TIME UP！ 集計を待ちましょう' : phase === 'live' ? '連打中！' : '合図と同時に連打スタート！';
  }
  paint();
  return {
    status: u => (S.prog?.[u]?.res ? '<span class="st-stop">終了</span>' : S.prog?.[u]?.go ? '<span class="st-live">連打中！</span>' : '<span class="muted">待機</span>'),
    update: paint,
    destroy() { cancel(); cancelAnimationFrame(raf); },
  };
}

function specQuiz(stage, st) {
  stage.innerHTML = `<div id="sQ"></div>`;
  const box = $('#sQ', stage);
  let cur = '__init__', qctl = null, intro = false;
  const cancel = countdownOverlay(stage, goTime(st), { label: '早押しクイズ', onGo() { intro = true; sfx.go(); paint(); } });
  function paint() {
    if (!intro) return;
    const q = S.state?.quiz || {};
    if (q.key !== cur) {
      qctl?.destroy?.(); cur = q.key;
      qctl = q.key ? mountQuestion(box, q, false) : null;
      if (!q.key) box.innerHTML = `<div class="q-wait"><span class="label">Stand by</span><p>まもなく <b>第1問</b> です。<br>問題と選択肢はこの画面にも出ます。一緒に考えてみましょう。</p><p class="fine">全${q.total || L.QUIZ_DEFAULT_COUNT}問・1問15秒</p></div>`;
    } else qctl?.update?.();
  }
  return {
    status: u => {
      const k = S.state?.quiz?.key;
      return k ? (S.prog?.[u]?.[k] ? '<span class="st-stop">回答済</span>' : '<span class="st-live">考え中…</span>') : '<span class="muted">待機</span>';
    },
    update: paint,
    destroy() { cancel(); qctl?.destroy?.(); },
  };
}

// ---------- 集計・結果 ----------
function mountJudging() {
  app.innerHTML = `<section class="card center judging white">${cubeSVG()}<span class="drum">COUNTING</span><h2>集計中です</h2><p>全チームの記録を集計しています。<br>結果はみんなのスマホで同時に発表されます。</p><div class="wait-dots"><i></i><i></i><i></i></div></section>
    <div id="jScore"></div>`;
  sfx.drum(1.5);
  const paint = () => { $('#jScore').innerHTML = Object.keys(S.results || {}).length ? `<section class="card slim">${rankStripHTML(S.results, S.adjust, { me: me()?.team, title: '今回のゲーム前の総合順位' })}</section>` : ''; };
  paint();
  return { update: paint };
}

function mountResults() {
  const st = S.state;
  app.innerHTML = '<div id="rv"></div>';
  const stop = mountRoundReveal($('#rv'), { be, result: S.results['r' + st.round], round: st.round, results: S.results, adjust: S.adjust, revealAt: st.revealAt, me: me()?.team });
  return { destroy: stop };
}

function mountFinal() {
  const st = S.state;
  app.innerHTML = '<div id="fv"></div>';
  const stop = mountFinalReveal($('#fv'), { be, results: S.results, adjust: S.adjust, revealAt: st.revealAt, members: S.members, me: me()?.team });
  return { destroy: stop };
}

boot();
