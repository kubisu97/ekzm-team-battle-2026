// 参加者・観戦画面
import { createBackend, errMsg } from './db.js';
import * as L from './logic.js';
import { joinTeam, submitResult, markProg, sendLive, startPresence } from './actions.js';
import { sfx, vibrate, flash, wantAwake, isMuted, setMuted } from './fx.js';
import {
  $, esc, tvars, teamBadge, toast, perfAt, waitUntil, countdownOverlay,
  scoreboardHTML, mountRoundReveal, mountFinalReveal, rosterHTML,
} from './ui.js';

const params = new URLSearchParams(location.search);
const slotParam = (params.get('p') || '').replace(/[^\w-]/g, '').slice(0, 12);
const APP_NAME = 'player' + (slotParam ? '-' + slotParam : '');
const app = $('#app');

let be = null;
let uid = null;
const S = {
  state: undefined, config: undefined, members: undefined, slots: {}, results: {}, adjust: {}, used: {},
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
  const keys = ['state', 'config', 'members', 'slots', 'results', 'adjust', 'used'];
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
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

// ---------- ヘッダー ----------
function setupHeader() {
  window.addEventListener('pointerdown', () => { if (me()) wantAwake(); }, { passive: true });
  const btn = $('#soundBtn');
  const paint = () => { btn.textContent = isMuted() ? '🔇' : '🔊'; btn.setAttribute('aria-label', isMuted() ? '音を出す' : '消音'); };
  paint();
  btn.addEventListener('click', () => { setMuted(!isMuted()); paint(); if (!isMuted()) sfx.choose(); });
}

function paintMe() {
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
const fatalHTML = msg => `<section class="card center warn"><h2>⚠️ エラー</h2><p>${msg}</p><button class="btn" onclick="location.reload()">再読み込み</button></section>`;
const waitingInitHTML = () => `<section class="card center"><div class="big-emoji">🎮</div><h2>準備中</h2><p>司会者がゲームを準備しています。少し待ってから再読み込みしてね。</p></section>`;

// ---------- 参加登録 ----------
function mountJoin() {
  let picked = null;
  let busy = false;
  app.innerHTML = `
    <section class="card hero-join">
      <div class="eyebrow">YEAR END PARTY 2026</div>
      <h2 class="title-xl">ENTRY</h2>
      <p class="muted">名前を入れて、自分のチームを選んでね。</p>
      <label class="lbl" for="nameIn">名前（ニックネームOK・16文字まで）</label>
      <input id="nameIn" class="input" maxlength="16" autocomplete="nickname" enterkeyhint="done" placeholder="例：くりす">
      <label class="lbl">チーム</label>
      <div class="team-pick" id="teamPick"></div>
      <div id="regMsg"></div>
      <button class="btn btn-primary btn-xl" id="joinBtn" disabled>参加する ▶</button>
      <p class="fine">※ 同じスマホ・同じブラウザなら、再読み込みしても参加情報は消えません。別のアプリやブラウザで開き直すと別人扱いになるので注意。</p>
    </section>`;
  const nameIn = $('#nameIn');
  const btn = $('#joinBtn');
  try { nameIn.value = localStorage.getItem('ekzm-name') || ''; } catch { /* noop */ }
  const paint = () => {
    const cap = Object.values(S.config?.slots || {}).filter(v => v === true).length || 0;
    const counts = Object.fromEntries(L.TEAMS.map(t => [t, Object.values(S.slots?.[t] || {}).filter(Boolean).length]));
    $('#teamPick').innerHTML = L.TEAMS.map(t => {
      const full = cap && counts[t] >= cap;
      return `<button class="team-btn ${picked === t ? 'on' : ''}" data-team="${t}" style="${tvars(t)}" ${full ? 'disabled' : ''}>
        <b>${t}</b><small>${counts[t]}/${cap || '-'}人${full ? '・満員' : ''}</small></button>`;
    }).join('');
    const open = !!S.config?.regOpen;
    $('#regMsg').innerHTML = open ? '' : '<p class="note warn">参加受付は締め切られています。参加したい場合は司会者に声をかけてね。</p>';
    btn.disabled = busy || !open || !picked || !L.cleanName(nameIn.value);
  };
  $('#teamPick').addEventListener('click', e => {
    const b = e.target.closest('[data-team]');
    if (!b || b.disabled) return;
    picked = b.dataset.team;
    sfx.choose();
    paint();
  });
  nameIn.addEventListener('input', paint);
  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true; btn.textContent = '登録中…'; paint();
    try {
      try { localStorage.setItem('ekzm-name', L.cleanName(nameIn.value)); } catch { /* noop */ }
      await joinTeam(be, nameIn.value, picked);
      wantAwake();
      sfx.go();
      vibrate(40);
    } catch (e) {
      toast(errMsg(e), 'error', 5000);
      busy = false; btn.textContent = '参加する ▶'; paint();
    }
  });
  paint();
  return { update: paint };
}

// ---------- ロビー ----------
function mountLobby() {
  app.innerHTML = `<div id="lobbyMain"></div><div id="lobbyScore"></div>
    <section class="card"><div class="card-head"><h2>👥 参加メンバー</h2><span class="chip" id="memberCount"></span></div><div id="lobbyRoster"></div></section>`;
  const paint = () => {
    const st = S.state;
    const g = L.GAMES[st.game] || L.GAMES[L.ROUND_GAMES[(st.round || 1) - 1]];
    const m = me();
    const played = S.used?.[uid];
    const hasResults = Object.keys(S.results || {}).length > 0;
    $('#lobbyMain').innerHTML = `
      <section class="card hero" style="${tvars(m.team)}">
        <div class="eyebrow">${hasResults ? `NEXT ・ GAME ${st.round} / 4` : 'WELCOME'}</div>
        <h2 class="title-lg">${hasResults ? `${g.icon} ${esc(g.title)}` : `ようこそ、${esc(m.name)}さん！`}</h2>
        <p>${hasResults ? '司会者が代表者を選んでいます…' : `あなたは <b class="tcolor">${m.team}チーム</b>。開幕までもう少し待ってね。`}</p>
        <div class="wait-dots"><i></i><i></i><i></i></div>
        <p class="fine">${played ? '✅ あなたは出場済み。あとは全力で応援！' : '代表者に選ばれたら、この画面が自動でゲーム画面に切り替わるよ。'}</p>
      </section>`;
    $('#lobbyScore').innerHTML = hasResults ? scoreboardHTML(S.results, S.adjust, { me: m.team }) : '';
    $('#lobbyRoster').innerHTML = rosterHTML(S.members, { me: uid, used: S.used });
    $('#memberCount').textContent = `${Object.keys(S.members || {}).length}人`;
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

function gameIntroHTML(st) {
  const g = L.GAMES[st.game];
  return `<section class="card game-intro g-${st.game}">
    <div class="eyebrow">GAME ${gameNo(st)} / 4 ${Number(st.mult) > 1 ? '<span class="x2">得点 ×2</span>' : ''}</div>
    <h2 class="title-lg">${g.icon} ${esc(g.title)}</h2>
    <div class="en">${g.en}</div>
    <p>${esc(g.rule)}</p>
  </section>`;
}

function mountReady() {
  const st = S.state;
  const rep = isRep();
  app.innerHTML = `${gameIntroHTML(st)}
    <div id="youBox"></div>
    <section class="card"><div class="card-head"><h2>🎤 代表者</h2></div><div id="repsBox"></div></section>`;
  if (rep) { sfx.fanfare(); vibrate([100, 60, 100]); flash(L.TEAM_INFO[me().team].glow, 400); } else sfx.reveal();
  let sending = false;
  const paint = () => {
    const okMine = !!S.prog?.[uid]?.ok;
    $('#youBox').innerHTML = rep
      ? `<section class="card you-rep" style="${tvars(me().team)}">
          <div class="big-emoji">🔥</div>
          <h2>あなたが <b class="tcolor">${me().team}チーム</b> の代表！</h2>
          <p>前に出てスマホを構えよう。ゲームは司会者の合図で一斉スタート。</p>
          <button class="btn btn-primary btn-xl" id="okBtn" ${okMine || sending ? 'disabled' : ''}>${okMine ? '✅ 準備OK！スタートを待とう' : '準備OK！'}</button>
        </section>`
      : `<section class="card spectator-note"><div class="big-emoji">📣</div><h2>今回は観戦！</h2><p>このまま待てば、試合のようすがリアルタイムで見られるよ。代表を応援しよう！</p></section>`;
    $('#repsBox').innerHTML = repsListHTML(st, u => (S.prog?.[u]?.ok ? '<span class="ok">準備OK</span>' : '<span class="muted">準備中…</span>'));
    $('#okBtn')?.addEventListener('click', async () => {
      sending = true; paint();
      wantAwake();
      await markProg(be, st.runId, 'ok');
      sfx.choose();
      sending = false; paint();
    });
  };
  paint();
  return { update: paint };
}

// ---------- 代表者：ゲーム ----------
function mountRep() {
  const st = S.state;
  const done = st.game === 'quiz' ? false : !!S.mine?.res;
  const started = !!S.prog?.[uid]?.go;
  if (done) return submittedView('記録済み！', '結果発表をお楽しみに。');
  if (st.game !== 'quiz' && started) return lockedView('go');
  if (st.game === 'ten') return tenRep(st);
  if (st.game === 'iai') return iaiRep(st);
  if (st.game === 'tap') return tapRep(st);
  if (st.game === 'quiz') return quizRep(st);
  return simple(loadingHTML('…'));
}

function submittedView(title, sub) {
  app.innerHTML = `<section class="card center submitted"><div class="big-emoji">✅</div><h2>${esc(title)}</h2><p>${esc(sub)}</p></section>`;
  return { update: () => (!S.mine?.res ? 'remount' : undefined) }; // 司会者が再挑戦を許可したら戻る
}

function lockedView(flag) {
  app.innerHTML = `<section class="card center warn"><div class="big-emoji">⏸️</div><h2>挑戦が中断されました</h2>
    <p>ゲームの途中で画面が再読み込みされた（または閉じられた）ため、この挑戦はいったん止まっています。</p>
    <p><b>司会者に「再挑戦を許可」してもらうと、もう一度プレイできます。</b></p></section>`;
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
      <div class="game-top"><span class="eyebrow">GAME ${gameNo(st)} ・ 代表者</span><h2>⏱️ 10秒ぴったり</h2></div>
      <div class="ten-display"><span class="ten-num" id="tenNum">0.00</span><span class="ten-unit">秒</span></div>
      <p class="hint" id="tenHint">スタートしたら心の中でカウント！</p>
      <button class="stop-btn" id="stopBtn" disabled>STOP</button>
    </section>`;
  const num = $('#tenNum'), hint = $('#tenHint'), btn = $('#stopBtn');
  let t0 = null, stopped = false, raf = 0;
  const cancelCd = countdownOverlay(app, goTime(st), {
    label: '10秒ぴったり',
    onGo(now) {
      t0 = now; sfx.go(); vibrate(40); markProg(be, st.runId, 'go');
      btn.disabled = false; btn.classList.add('live');
      const loop = () => {
        if (stopped) return;
        const e = performance.now() - t0;
        if (e < L.TEN_VISIBLE) num.textContent = (e / 1000).toFixed(2);
        else if (!num.classList.contains('masked')) { num.textContent = '?.??'; num.classList.add('masked'); hint.textContent = 'ここからは体内時計だけが頼り！'; }
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
      <div class="iai-sub" id="iaiSub">「斬れ！」が出た瞬間、画面のどこかをタップ</div>
      <div class="slash-layer" id="slashLayer"></div>
    </section>`;
  const area = $('#iaiArea'), text = $('#iaiText'), sub = $('#iaiSub');
  let armed = false, t0 = null, finished = false, cancelGo = null, timeoutId = 0;
  const kamaeAt = goTime(st);
  const delay = Number(st.iaiDelay) || 3000;
  const cancelCd = countdownOverlay(app, kamaeAt, {
    label: '居合斬り',
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
      <div class="tap-top"><span class="eyebrow">GAME ${gameNo(st)} ・ 7秒連打</span><span class="tap-time"><b id="tapTime">7.00</b>秒</span></div>
      <div class="tap-bar"><i id="tapBar"></i></div>
      <div class="tap-count" id="tapCount">0</div>
      <button class="tap-pad" id="tapPad" disabled><span>TAP!</span></button>
      <p class="hint" id="tapHint">合図と同時に連打！</p>
    </section>`;
  const pad = $('#tapPad'), cnt = $('#tapCount'), time = $('#tapTime'), bar = $('#tapBar'), hint = $('#tapHint');
  let t0 = null, n = 0, ended = false, raf = 0, liveTimer = 0, lastSent = -1;
  const cancelCd = countdownOverlay(app, goTime(st), {
    label: '7秒連打',
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
    clearInterval(liveTimer); cancelAnimationFrame(raf);
    pad.disabled = true; pad.classList.remove('live');
    pad.innerHTML = '<span>TIME UP!</span>';
    sfx.stop(); vibrate([60, 40, 60]);
    finishSend(st, 'res', { v: n }, hint, `記録 ${n}回 を送信しました！結果発表を待とう`, guard);
  }
  const guard = { sent: false };
  return { update: () => retryCheck(guard), destroy() { cancelCd(); clearInterval(liveTimer); cancelAnimationFrame(raf); document.body.classList.remove('fullgame'); } };
}

function quizRep(st) {
  app.innerHTML = `<section class="game game-quiz">
      <div class="game-top"><span class="eyebrow">GAME ${gameNo(st)} ・ 代表者</span><h2>❓ 早押しクイズ</h2></div>
      <div id="qBox"></div>
    </section>`;
  const box = $('#qBox');
  let curKey = '__init__';
  let qctl = null;
  let introDone = false;
  const cancelIntro = countdownOverlay(app, goTime(st), { label: '早押しクイズ', onGo() { introDone = true; sfx.go(); paint(); } });
  function paint() {
    const q = S.state?.quiz || {};
    if (!introDone) return;
    if (q.key !== curKey) {
      qctl?.destroy?.();
      curKey = q.key;
      qctl = q.key ? mountQuestion(box, q, true) : null;
      if (!q.key) box.innerHTML = `<div class="q-wait"><div class="big-emoji">🎤</div><p>まもなく <b>第1問</b>！<br>司会者の出題を待とう</p><p class="fine">全${q.total || L.QUIZ_DEFAULT_COUNT}問・1問15秒</p></div>`;
    } else qctl?.update?.();
  }
  return { update: paint, destroy() { cancelIntro(); qctl?.destroy?.(); } };
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
      ${asRep ? '' : '<div id="qAnswered" class="q-answered"></div>'}
    </div>`;
  const textEl = $('#qText', box), choicesEl = $('#qChoices', box), hint = $('#qHint', box), tbar = $('#qTimeBar', box);
  let t0 = null, answered = !!S.mine?.[key], myChoice = S.mine?.[key]?.c ?? null, raf = 0, limitTimer = 0, revealedShown = false;
  const locked = asRep && !answered && !!S.prog?.[uid]?.['g' + i];
  const showQ = now => {
    t0 = now;
    textEl.textContent = q.q?.text || '';
    choicesEl.innerHTML = L.arr(q.q?.choices).map((c, k) => `<button class="q-choice c${k}" data-k="${k}" ${asRep && !answered && !locked ? '' : 'disabled'}><span class="q-mark">${'ABCD'[k]}</span><span>${esc(c)}</span></button>`).join('');
    if (asRep && !answered && !locked) { markProg(be, st.runId, 'g' + i); hint.textContent = '正しいと思う答えをタップ！'; }
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
    hint.textContent = myChoice === -1 ? '時間切れ（無回答）' : '回答しました！正解発表を待とう';
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
    if (!qq.open && asRep && !answered) { choicesEl.querySelectorAll('.q-choice').forEach(b => (b.disabled = true)); hint.textContent = '締め切り！'; }
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
      if (asRep) {
        const ok = Number(myChoice) === Number(qq.reveal);
        hint.innerHTML = ok ? '<b class="ok">⭕ 正解！</b>' : '<b class="ng">❌ 残念…</b>';
        ok ? sfx.correct() : sfx.wrong();
      } else { hint.textContent = '正解はこれ！'; sfx.correct(); }
    }
  }
  return { update, destroy() { cancelCd?.(); cancelAnimationFrame(raf); clearTimeout(limitTimer); } };
}

// ---------- 観戦 ----------
function mountSpectator() {
  const st = S.state;
  const g = L.GAMES[st.game];
  app.innerHTML = `<section class="card spec-head g-${st.game}">
      <div class="eyebrow">LIVE ・ GAME ${gameNo(st)} / 4 ${Number(st.mult) > 1 ? '<span class="x2">×2</span>' : ''}</div>
      <h2 class="title-md">${g.icon} ${esc(g.title)}</h2>
    </section>
    <section class="game spec spec-${st.game}" id="specStage"></section>
    <section class="card"><div class="card-head"><h2>🎤 各チームの代表</h2><span class="chip">観戦中</span></div><div id="specReps"></div></section>
    <p class="fine center">※ 正確な記録と順位は結果発表まで非公開</p>`;
  const stage = $('#specStage');
  const inner = st.game === 'ten' ? specTen(stage, st) : st.game === 'iai' ? specIai(stage, st) : st.game === 'tap' ? specTap(stage, st) : specQuiz(stage, st);
  const paintReps = () => {
    $('#specReps').innerHTML = repsListHTML(S.state, (u) => inner.status?.(u) ?? '');
  };
  paintReps();
  return { update() { inner.update?.(); paintReps(); }, destroy() { inner.destroy?.(); } };
}

function specTen(stage, st) {
  stage.innerHTML = `<div class="ten-display spec"><span class="ten-num" id="sNum">0.00</span><span class="ten-unit">秒</span></div><p class="hint center" id="sHint">代表者の体内時計を見守ろう</p>`;
  const num = $('#sNum', stage);
  let raf = 0, t0 = null;
  const cancel = countdownOverlay(stage, perfAt(be, st.startAt), {
    label: '10秒ぴったり', sound: true,
    onGo(now) {
      t0 = Math.min(now, perfAt(be, st.startAt)); sfx.go();
      const loop = () => {
        const e = performance.now() - t0;
        if (e < L.TEN_VISIBLE) num.textContent = (e / 1000).toFixed(2);
        else { num.textContent = '?.??'; num.classList.add('masked'); }
        if (e < 40000) raf = requestAnimationFrame(loop);
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
      <div class="iai-text" id="sText">　</div><div class="iai-sub" id="sSub">静寂の中、合図を待つ…</div><div class="slash-layer" id="sSlash"></div></div>`;
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
            sub.textContent = '勝負あり…結果は発表で！';
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
  stage.innerHTML = `<div class="tap-top spec"><span class="eyebrow">LIVE 連打数</span><span class="tap-time"><b id="sTime">7.00</b>秒</span></div>
    <div class="tap-bar"><i id="sBar"></i></div>
    <div class="live-bars" id="sBars"></div><p class="hint center" id="sHint">合図と同時に連打スタート！</p>`;
  let t0 = null, raf = 0, phase = 'wait';
  const cancel = countdownOverlay(stage, perfAt(be, st.startAt), {
    label: '7秒連打',
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
    const max = Math.max(40, ...counts.map(c => c.n));
    $('#sBars', stage).innerHTML = counts.map(c => `<div class="lb" style="${tvars(c.t)}">${teamBadge(c.t)}<span class="lb-track"><i style="width:${phase === 'hidden' || phase === 'end' ? 100 : Math.round((c.n / max) * 100)}%" class="${phase !== 'live' ? 'secret' : ''}"></i></span><b>${phase === 'live' || phase === 'wait' ? c.n : '？？？'}</b></div>`).join('');
    $('#sHint', stage).textContent = phase === 'hidden' ? '🔥 ラストスパート！ここからは秘密… 🔥' : phase === 'end' ? 'TIME UP！ 集計を待とう' : phase === 'live' ? '連打中！' : '合図と同時に連打スタート！';
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
      if (!q.key) box.innerHTML = `<div class="q-wait"><div class="big-emoji">🎤</div><p>まもなく <b>第1問</b>！</p><p class="fine">全${q.total || 3}問・1問15秒</p></div>`;
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
  app.innerHTML = `<section class="card center judging"><div class="drum">🥁</div><h2>集計中…</h2><p>まもなく結果発表！</p><div class="wait-dots"><i></i><i></i><i></i></div></section>
    <div id="jScore"></div>`;
  sfx.drum(1.5);
  const paint = () => { $('#jScore').innerHTML = Object.keys(S.results || {}).length ? scoreboardHTML(S.results, S.adjust, { me: me()?.team, title: '現在の順位（今回のゲーム前）' }) : ''; };
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
