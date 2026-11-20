// 管理者（司会者）画面
import { createBackend, errMsg } from './db.js?v=10';
import * as L from './logic.js?v=10';
import { sfx, isMuted, setMuted, wantAwake } from './fx.js?v=10';
import { addDummies, endRehearsalUpdate, createDriver, isDummy } from './rehearsal.js?v=10';
import { $, $$, esc, tvars, teamBadge, toast, scoreboardHTML, rosterHTML, head, gameTag, ICON, detailHTML, explainSlideHTML, explainName } from './ui.js?v=10';
import qrcode from './vendor/qrcode.mjs?v=10';

const root = $('#admin');
let be = null;
let authed = false;
const D = {
  state: undefined, config: null, members: {}, slots: {}, results: {}, adjust: {}, used: {}, online: {},
  quizBank: {}, pick: {}, prog: {}, live: {}, subs: {}, quizRun: null,
};
let runWatch = { runId: null, offs: [] };
let tab = 'control';
try { tab = sessionStorage.getItem('ekzm-admin-tab') || 'control'; } catch { /* noop */ }
const draft = { quizCount: L.QUIZ_DEFAULT_COUNT, quizPick: [], overrides: {}, forRound: null };
let editRound = null;
let rhDriver = null;
let editQuizId = null;
let renderQueued = false;
let dirtyWhileFocused = false;

const PLAYER_URL = new URL('./', location.href).href.split('?')[0].replace(/admin\.html$/, '');
const ADMIN_URL = new URL('admin.html', PLAYER_URL).href;

// Web制作にちなんだクイズ（正解・解説は公式情報で確認済み。出典は README に記載）
const WEB_QUIZ = [
  { text: '「HTML」の「M」は何の略？', choices: ['Machine', 'Media', 'Markup', 'Module'], answer: 2,
    note: 'HTMLは HyperText Markup Language（ハイパーテキスト・マークアップ・ランゲージ）の略です。' },
  { text: '「CSS」の最初の「C」は何の略？', choices: ['Creative', 'Cascading', 'Computer', 'Color'], answer: 1,
    note: 'Cascading Style Sheets の略。W3Cが最初のCSS（CSS1）を勧告したのは1996年12月です。' },
  { text: 'Webページで「404」エラーが出たときの意味は？', choices: ['ページが見つからない', 'サーバーが混雑している', 'アクセスが禁止されている', '通信が暗号化されていない'], answer: 0,
    note: '404 Not Found。サーバーが、指定されたページを見つけられなかったという意味です。' },
  { text: '「SEO」の「O」は何の略？', choices: ['Operation', 'Online', 'Organization', 'Optimization'], answer: 3,
    note: 'Search Engine Optimization（検索エンジン最適化）の略です。' },
  { text: '「Google」という社名の由来は？', choices: ['1の後ろに0が100個続く数', '創業者の飼い犬の名前', '「探す」という意味の古語', '検索窓の形'], answer: 0,
    note: 'Google公式サイトによると、1の後ろに0が100個続く数を表す数学の言葉をもじった名前。もとの名前は「Backrub」でした。' },
  { text: 'JavaScriptが試作されていたときの名前は？', choices: ['Latte', 'Mocha', 'Espresso', 'JavaLite'], answer: 1,
    note: '開発者ブレンダン・アイク本人のブログによると、1995年5月に試作していたときの名前は「Mocha（モカ）」でした。' },
  { text: '「favicon（ファビコン）」の「fav」は何の略？', choices: ['famous', 'fast view', 'favorite', 'feature'], answer: 2,
    note: 'favorite icon の略。ブラウザのタブやブックマークに出る小さなアイコンのことです。' },
  { text: 'ドメイン「.tv」は、どこの国の国別ドメイン？', choices: ['タイ', '台湾', 'トルコ', 'ツバル'], answer: 3,
    note: '南太平洋の島国ツバルの国別ドメインです。IANAの登録情報でも、管理者はツバルの政府機関になっています。' },
  { text: 'Internet Explorer 11（デスクトップ版）のサポートが終了したのは？', choices: ['2018年', '2020年', '2022年', '2024年'], answer: 2,
    note: 'Microsoftの公式情報によると、Windows 10 向けのサポートは2022年6月15日に終了しました。' },
  { text: '世界で最初のWebサイトが作られた研究機関は？', choices: ['NASA', 'MIT', 'スタンフォード大学', 'CERN'], answer: 3,
    note: 'CERN（欧州原子核研究機構）。1990年末に最初のWebサーバーが動き始め、最初のWebサイトのアドレスは info.cern.ch でした。' },
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
  const paint = () => { sb.innerHTML = isMuted() ? ICON.soundOff : ICON.soundOn; };
  $('#logoutBtn').innerHTML = ICON.logout;
  paint();
  sb.addEventListener('click', () => { setMuted(!isMuted()); paint(); });
  $('#logoutBtn').addEventListener('click', async () => { if (confirm('ログアウトしますか？')) { await be.signOut(); location.reload(); } });
}

function renderLogin() {
  root.innerHTML = `<section class="card login-card">
      <span class="label">Admin</span><h2>司会者ログイン</h2>
      <p class="muted">この画面は司会者専用です。ゲームの進行・得点の操作ができます。</p>
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
  const keys = { state: 'state', config: 'config', members: 'members', slots: 'slots', results: 'results', adjust: 'adjust', used: 'used', online: 'online', quizBank: 'quizBank', pick: 'pick' };
  for (const [k, path] of Object.entries(keys)) {
    be.watch(path, v => {
      D[k] = k === 'state' ? (v ?? null) : (v || (k === 'config' ? null : {}));
      if (k === 'state') { syncRun(); if (v === null) initIfEmpty(); }
      queueRender();
    }, e => toast('読み込みエラー：' + errMsg(e), 'error', 8000));
  }
  setInterval(() => { if (D.state?.phase === 'running') queueRender(); }, 500);
  // リハーサル中は、この管理画面がダミー参加者を動かす
  rhDriver = createDriver(be, D, { onError: e => console.warn('[rehearsal]', e) });
  setInterval(() => rhDriver.tick(), 500);
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
const TABS = [['control', '進行'], ['members', '参加者'], ['score', '得点'], ['quiz', 'クイズ'], ['setup', 'QR・設定']];

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
        ${st.explain?.key && L.EXPLAIN_PHASES.includes(st.phase) ? `<span class="chip ok">説明スライド表示中 ${(Number(st.explain.page) || 0) + 1}ページ目</span>` : ''}
      </div>
    </section>
    ${rehearsalBar()}
    <nav class="tabs">${TABS.map(([k, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
    <div id="tabBody">${tabBody()}</div>`;
  window.scrollTo(0, scroll);
  afterRender();
  rhDriver?.tick();
}

// ---------- リハーサルモード ----------
const dummyCount = () => Object.keys(D.members || {}).filter(isDummy).length;
function rehearsalBar() {
  if (!D.config?.rehearsal) return '';
  wantAwake();
  return `<section class="card rh-bar">
    <div class="rh-head"><span class="rh-tag">REHEARSAL</span><b>リハーサル中（ダミー ${dummyCount()}人）</b></div>
    <p class="fine">ダミーはこの画面が動かしています。リハーサル中はこの画面を開いたままにしてください。</p>
    <div class="rh-btns">
      <button class="btn btn-go" data-act="rhPreview">自分も参加者として見る</button>
      <button class="btn btn-ghost" data-act="rhEnd">リハーサルを終わる</button>
    </div>
  </section>`;
}
function rehearsalCard() {
  const on = !!D.config?.rehearsal;
  const real = Object.keys(D.members || {}).filter(u => !isDummy(u)).length;
  return `<section class="card rh-card">
    ${head('Rehearsal', 'リハーサルモード', on ? '<span class="chip ok">実行中</span>' : '')}
    <p class="step-desc">ダミー参加者を各チームに入れて、1人でも本番と同じ流れを試せます。ダミーは、代表者の立候補・準備OK・ゲームの記録を自動で送ります。</p>
    <ul class="rh-list">
      <li><b>自分の操作</b>：「自分も参加者として見る」を押すと、この画面の中に参加者の画面が開きます。1台で司会と参加者を行き来できます。</li>
      <li><b>手伝ってくれる人</b>：参加用のQRから普通に参加してもらえばOK。ダミーと一緒に遊べます。</li>
      <li>本物の参加者がいるチームは、その人の立候補を20秒待ってから、ダミーが代わりに立候補します。</li>
    </ul>
    ${on ? `<p>いまのダミー：<b>${dummyCount()}人</b>　本物の参加者：<b>${real}人</b></p>` : ''}
    <div class="row gap">
      <label class="lbl rh-n">1チームのダミー<select class="input input-sm" id="rhN">${[1, 2, 3, 4].map(n => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n}人</option>`).join('')}</select></label>
      <button class="btn ${on ? 'btn-ghost' : 'btn-primary'}" data-act="rhStart">${on ? 'ダミーを追加する' : 'リハーサルを始める'}</button>
    </div>
    ${on ? '<button class="btn btn-danger-ghost" data-act="rhEnd">リハーサルを終わる（ダミーを消して得点をリセット）</button>' : ''}
    <p class="fine">「リハーサルを終わる」で、ダミーとリハーサルの得点・記録を消して GAME 1 の待機に戻ります（本物の参加者の登録とクイズの問題は残ります）。本番の前には、念のため「全データ初期化」もしておくと安心です。</p>
  </section>`;
}

/** 管理画面の中に参加者の画面を重ねて開く（ダミーを動かし続けるため、同じページ内で開く） */
function togglePreview(show) {
  let pv = $('#pv');
  if (!pv) {
    pv = document.createElement('div');
    pv.id = 'pv';
    pv.className = 'pv';
    pv.hidden = true;
    const src = `./?${be?.mock ? 'mock&' : ''}p=rh`;
    pv.innerHTML = `<div class="pv-bar"><span class="rh-tag">REHEARSAL</span><b>参加者の画面</b><button class="btn btn-sm btn-go" id="pvBack">司会の画面に戻る</button></div>
      <iframe id="pvFrame" title="参加者の画面（リハーサル）" src="${esc(src)}" allow="autoplay; screen-wake-lock; vibrate"></iframe>`;
    document.body.appendChild(pv);
    $('#pvBack', pv).addEventListener('click', () => togglePreview(false));
  }
  pv.hidden = !show;
  document.body.classList.toggle('pv-open', !!show);
  if (!show) queueRender();
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
  return explainCard(st) + phasePanel(st);
}

/** 説明スライドの操作（全員のスマホに同じページを出す） */
function explainCard(st) {
  if (!L.EXPLAIN_PHASES.includes(st.phase)) return '';
  const ex = st.explain;
  const g = L.GAMES[st.game];
  const opts = { mult: Number(st.mult) || 1, round: st.round || 1, phase: st.phase, award2: L.award2Of(D.config) };
  if (!ex?.key) {
    const first = st.round === 1 && st.phase === 'lobby';
    const nOpen = L.explainSlides('opening', opts).length;
    const nGame = L.explainSlides(st.game, opts).length;
    return `<section class="card explain-ctl">
      ${head('Explain', '説明を全員のスマホに出す')}
      <p class="step-desc">押すと、参加者全員のスマホが説明スライドに切り替わります。この画面で「次へ」を押すと、全員のページが一緒に進みます。読み上げる文もここに出ます。</p>
      <div class="xbtns">
        ${first ? `<button class="btn btn-primary btn-block" data-act="explainOpen" data-key="opening">大会の説明を始める（${nOpen}ページ）</button>` : ''}
        <button class="btn ${first ? 'btn-ghost' : 'btn-primary'} btn-block" data-act="explainOpen" data-key="${esc(st.game)}">GAME ${g.num}「${esc(g.title)}」の説明を始める（${nGame}ページ）</button>
        ${first ? '' : '<button class="btn btn-ghost btn-sm" data-act="explainOpen" data-key="opening">大会全体の説明をもう一度出す</button>'}
      </div>
      ${first ? '<p class="fine">おすすめの順番：①大会の説明 → ②GAME 01 の説明 → ③チームで代表者決め</p>' : ''}
    </section>`;
  }
  const slides = L.explainSlides(ex.key, opts);
  const page = Math.min(Math.max(Number(ex.page) || 0, 0), slides.length - 1);
  const sl = slides[page];
  const last = page >= slides.length - 1;
  return `<section class="card explain-ctl live">
    ${head('Explain', `${esc(explainName(ex.key))}を表示中`, `<span class="chip ok">${page + 1} / ${slides.length}</span>`)}
    <div class="xpreview" aria-label="参加者のスマホに出ている画面">${explainSlideHTML(sl)}</div>
    ${mcHTML(sl?.mc || [], last ? '最後のページです。「説明を終わる」で全員のスマホが元の画面に戻ります。' : '読み終わったら「次へ」。全員のスマホのページが進みます。')}
    <div class="xnav">
      <button class="btn btn-ghost" data-act="explainMove" data-d="-1" ${page === 0 ? 'disabled' : ''}>← 前へ</button>
      ${last ? '<button class="btn btn-primary" data-act="explainClose">説明を終わる</button>' : '<button class="btn btn-go" data-act="explainMove" data-d="1">次へ <span class="arr">→</span></button>'}
    </div>
    ${last ? '' : '<button class="btn btn-ghost btn-sm" data-act="explainClose">途中で説明を閉じる</button>'}
  </section>`;
}

function phasePanel(st) {
  if (draft.forRound !== st.round + ':' + st.phase && st.phase === 'lobby') {
    draft.forRound = st.round + ':' + st.phase;
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

/** 各チームが自分たちで決めた代表者（pick/{team}）。チーム外・退出者は無効 */
function validPick(t) {
  const u = D.pick?.[t];
  return u && D.members?.[u]?.team === t ? u : null;
}

function lobbyPanel(st) {
  const g = st.game || L.ROUND_GAMES[st.round - 1];
  const mult = Number(st.mult) || 1;
  const bank = Object.entries(D.quizBank || {});
  const pickedOk = g !== 'quiz' || draft.quizPick.filter(id => D.quizBank?.[id]).length === Number(draft.quizCount);
  const teamsWithMembers = L.TEAMS.filter(t => membersOf(t).length);
  const decided = teamsWithMembers.filter(t => validPick(t));
  const allDecided = teamsWithMembers.length > 0 && decided.length === teamsWithMembers.length;
  return `
  <section class="card">
    ${head('Step 1', '次のゲームを確認')}
    <p class="step-desc">ここで選んだゲームと遊び方が、参加者のスマホの待機画面にすぐ表示されます。通常は変更不要です。</p>
    <div class="grid2">
      <label class="lbl">ゲーム<select class="input" id="gameSel">${L.ROUND_GAMES.map(k => `<option value="${k}" ${g === k ? 'selected' : ''}>${L.GAMES[k].icon} ${L.GAMES[k].title}</option>`).join('')}</select></label>
      <label class="lbl">得点倍率<select class="input" id="multSel"><option value="1" ${mult === 1 ? 'selected' : ''}>×1</option><option value="2" ${mult === 2 ? 'selected' : ''}>×2（最終ゲーム）</option></select></label>
    </div>
    <p class="note">${esc(L.GAMES[g].rule)}</p>
    ${g === 'quiz' ? `
      <div class="card-head"><h3>出題する問題</h3>
        <span class="row"><select class="input input-sm" id="qCount">${Array.from({ length: L.QUIZ_MAX_COUNT }, (_, i) => `<option ${Number(draft.quizCount) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>問
        <button class="btn btn-sm" data-act="autoQuiz">未使用からランダムに選ぶ</button></span></div>
      ${bank.length ? `<ol class="qpick">${bank.map(([id, q]) => `<li><label><input type="checkbox" class="qp" value="${id}" ${draft.quizPick.includes(id) ? 'checked' : ''}> ${esc(q.text)} ${q.used ? '<small class="played">使用済</small>' : ''}</label></li>`).join('')}</ol>` : '<p class="note warn">問題がありません。「クイズ」タブで問題を登録してください。</p>'}
      <p class="muted">選択中：${draft.quizPick.filter(id => D.quizBank?.[id]).length} / ${draft.quizCount}問（選んだ順に出題）</p>` : ''}
  </section>
  <section class="card">
    ${head('Step 2', '代表者がそろうのを待つ', `<span class="chip ${allDecided ? 'ok' : 'warn'}">${decided.length}/${teamsWithMembers.length} チーム決定</span>`)}
    <p class="step-desc">参加者のスマホに「わたしが出る」ボタンが出ています。チームで相談して、出る人が自分で押します。決まったチームから下に名前が出ます。</p>
    <ul class="pick-admin">${L.TEAMS.map(t => {
      const u = validPick(t);
      const ms = membersOf(t);
      return `<li style="${tvars(t)}">${teamBadge(t)}<b>${u ? esc(nameOf(u)) : '<span class="muted">相談中…</span>'}</b>
        ${u ? (D.used?.[u] ? `<small class="warn">決定（${usedRounds(u)}出場済）</small>` : '<small class="ok">決定</small>') : ''}
        <small class="muted">まだ出てない人 ${ms.filter(m => !D.used?.[m.uid]).length}/${ms.length}</small></li>`;
    }).join('')}</ul>
    ${mcHTML([...(L.GAMES[g].mc || []), 'ルールは皆さんのスマホに出ています。チームで相談して、出る人は「わたしが出る」を押してください！'], '全チームが「決定」になったら、下のボタンで代表者を発表します。押すと全員のスマホに代表者とルールが出ます。')}
    <button class="btn btn-primary btn-xl" data-act="announce" ${pickedOk && decided.length ? '' : 'disabled'}>代表者を発表する <span class="arr">→</span></button>
    ${allDecided ? '' : '<p class="fine warn">※ まだ決まっていないチームがあります。全チーム決まってから発表してください（未定のまま発表すると、そのチームは不参加になります）。</p>'}
    <details class="emergency"><summary>緊急用：司会者が代わりに指定する</summary>
      <p class="fine">欠席・通信トラブルなどでチームが決められないときだけ使います。指定するとそのチームのスマホにも反映されます。</p>
      <div class="rep-pick">${L.TEAMS.map(t => {
        const ms = membersOf(t);
        const sel = validPick(t) || '';
        return `<div class="rp-row" style="${tvars(t)}">${teamBadge(t)}
          <select class="input rep-sel" data-team="${t}"><option value="">— 未定 —</option>${ms.map(m => `<option value="${m.uid}" ${sel === m.uid ? 'selected' : ''}>${esc(m.name)}${D.used?.[m.uid] ? `（${usedRounds(m.uid)}出場済）` : ''}</option>`).join('')}</select>
          <small class="muted">未出場 ${ms.filter(m => !D.used?.[m.uid]).length}/${ms.length}</small></div>`;
      }).join('')}</div>
      <button class="btn btn-sm" data-act="autoReps">未定のチームを未出場者からランダムに指定</button>
    </details>
  </section>
  ${scoreboardHTML(D.results, D.adjust, { compact: true })}`;
}

/** 司会の読み上げ例（カンペ） */
function mcHTML(lines, note = '') {
  return `<div class="mc"><span class="k">MC ・ 読み上げ例</span>${lines.filter(Boolean).map(l => `<p>「${esc(l)}」</p>`).join('')}${note ? `<small>${esc(note)}</small>` : ''}</div>`;
}
const repNames = st => L.TEAMS.filter(t => st.reps?.[t]).map(t => `${t}チーム ${nameOf(st.reps[t])}さん`).join('、');

function readyPanel(st) {
  const reps = st.reps || {};
  const okN = Object.values(reps).filter(u => D.prog?.[u]?.ok).length;
  return `<section class="card">
    ${head('Step 3', '代表者を呼び出してスタート', `<span class="chip">準備OK ${okN}/${Object.keys(reps).length}</span>`)}
    <p class="step-desc">${gameTag(st.game)}${esc(L.GAMES[st.game].title)}${Number(st.mult) > 1 ? '（得点2倍）' : ''}。全員のスマホに代表者と遊び方が表示されています。代表者が「準備OK」を押すと下に表示されます。</p>
    ${repMonitor(st, u => (D.prog?.[u]?.ok ? '<span class="ok">準備OK</span>' : '<span class="muted">未確認</span>'), false)}
    ${mcHTML([`各チームの代表は、${repNames(st)}です！`, '代表の方は前へどうぞ。スマホの「準備OK」を押して、合図を待ってください。', L.GAMES[st.game].mcGo], 'スタートを押すと、全員のスマホで同時に3秒のカウントダウンが始まります。')}
    <button class="btn btn-go btn-xl" data-act="start">ゲームスタート <span class="arr">→</span></button>
    <button class="btn btn-ghost" data-act="backLobby">代表者を選び直す</button>
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
        <p>回答 <b>${answered}</b>/${repIds.length}　${q.open ? `残り <b>${Math.ceil(leftMs / 1000)}</b>秒` : '締め切り済み'}</p></div>` : '<p class="muted">まだ出題していません。下のボタンで第1問を出題します。</p>'}
      ${q.open ? mcHTML([`第${idx + 1}問！ ${cur?.text || ''}`, '15秒以内に答えてください！'], '全員が回答するか15秒たったら「正解を発表」。正解は参加者の画面で枠囲みされます。') : ''}
      ${q.key && !q.open ? mcHTML([`正解は「${'ABCD'[Number(cur?.answer)] || ''}. ${L.arr(cur?.choices)[Number(cur?.answer)] || ''}」でした！`, cur?.note || ''], (cur?.note ? '解説は全員のスマホにも出ています。' : '') + (next < total ? '次の問題へ進みます。' : '全問終わりました。下の「ゲーム終了・集計へ」を押します。')) : ''}
      ${q.open ? `<button class="btn btn-gold btn-xl" data-act="quizReveal">正解を発表（締め切り）</button>` : ''}
      ${!q.open && next < total ? `<button class="btn btn-go btn-xl" data-act="quizNext">第${next + 1}問を出題 <span class="arr">→</span></button>` : ''}
    </div>`;
    allDone = !q.open && next >= total;
  } else allDone = repIds.every(u => D.prog?.[u]?.res);
  const statusFn = u => {
    return liveStatus(st, u);
  };
  const counting = be.serverNow() < Number(st.startAt);
  const elapsed = Math.max(0, be.serverNow() - Number(st.startAt));
  return `<section class="card">
    ${head('Step 4', '対戦中・実況モニター', `<span class="chip">${counting ? 'カウントダウン中' : `LIVE ${(elapsed / 1000).toFixed(1)}秒`}</span>`)}
    <p class="step-desc">${st.game === 'quiz' ? '1問ずつ「出題」→「正解を発表」を繰り返します。' : '代表者全員が「完了」になったら、下の「ゲーム終了・集計へ」を押します。'}<b>記録はこの画面（司会）にだけ</b>表示されています。参加者には結果発表まで見えません。</p>
    ${repMonitor(st, statusFn, true)}
    <p class="fine">「再挑戦を許可」：通信切れや誤操作のとき、その代表者の今回の記録を消してもう一度挑戦させます${st.game === 'quiz' ? '（クイズは表示中の問題のみ）' : ''}。</p>
    ${quizCtl}
    ${st.game !== 'quiz' ? mcHTML([allDone ? '全員終了！ 集計に入ります。' : 'がんばれー！'], allDone ? '全員の記録が届きました。' : '「完了」になっていない代表者がいる間は、そのまま見守ります。') : ''}
    <button class="btn ${allDone ? 'btn-primary' : 'btn-ghost'} btn-xl" data-act="finish">ゲーム終了・集計へ <span class="arr">→</span></button>
  </section>`;
}

/** 司会用の実況：各代表の動きと記録（司会の画面にだけ出す） */
function liveStatus(st, u) {
  const p = D.prog?.[u] || {};
  const res = D.subs?.[u]?.res;
  const sec = ms => (Number(ms) / 1000).toFixed(2);
  const elapsed = Math.max(0, be.serverNow() - Number(st.startAt));
  if (st.game === 'quiz') {
    const q = st.quiz || {};
    const n = Number(q.total) || 0;
    const answers = L.arr(D.quizRun).map(x => Number(x.answer));
    let correct = 0;
    const dots = Array.from({ length: n }, (_, i) => {
      const a = D.subs?.[u]?.['q' + i];
      const revealed = i < Number(q.idx) || (i === Number(q.idx) && !q.open);
      const ok = a && Number(a.c) === answers[i];
      if (ok) correct++;
      const cls = !a ? (p['g' + i] ? 'seen' : '') : revealed ? (ok ? 'on' : 'ng') : 'ans';
      return `<span class="qdot ${cls}">${i + 1}</span>`;
    }).join('');
    const cur = q.key ? D.subs?.[u]?.[q.key] : null;
    const now = q.key ? (cur ? `<small class="mon-rec">${'ABCD'[cur.c] || '時間切れ'}${cur.c >= 0 ? `・${sec(cur.v)}秒` : ''} ${Number(cur.c) === answers[Number(q.idx)] ? '<b class="ok">正解</b>' : '<b class="ng">×</b>'}</small>` : (q.open ? '<small class="st-live">考え中…</small>' : '<small class="muted">無回答</small>')) : '';
    return `${dots}${now}<small class="mon-rec">正解 ${correct}</small>`;
  }
  if (st.game === 'ten') {
    if (res) { const d = Number(res.v) - L.TEN_TARGET; return `<b class="mon-rec">${sec(res.v)}秒</b><small class="muted">誤差${d >= 0 ? '+' : '−'}${sec(Math.abs(d))}</small>`; }
    return p.go ? `<span class="st-live">計測中 ${(elapsed / 1000).toFixed(1)}秒</span>` : '<span class="muted">待機</span>';
  }
  if (st.game === 'touch') {
    const n = Math.min(L.TOUCH_N, Number(D.live?.[u] || 0));
    if (res) return Number(res.n) >= L.TOUCH_N ? `<b class="mon-rec">ゴール ${sec(res.v)}秒</b>` : `<b class="mon-rec">時間切れ ${res.n}/${L.TOUCH_N}</b>`;
    return p.go ? `<span class="st-live">${n} / ${L.TOUCH_N}</span>` : '<span class="muted">待機</span>';
  }
  if (st.game === 'tap') {
    if (res) return `<b class="mon-rec">${res.v}回</b>`;
    return p.go ? `<span class="st-live">連打中 ${Number(D.live?.[u] || 0)}回</span>` : '<span class="muted">待機</span>';
  }
  if (st.game === 'iai') {
    if (res) return res.f ? '<b class="ng">フライング</b>' : `<b class="mon-rec">反応 ${sec(res.v)}秒</b>`;
    return p.go ? '<span class="st-live">構え中</span>' : '<span class="muted">待機</span>';
  }
  return p.res ? '<span class="ok">完了</span>' : p.go ? '<span class="st-live">プレイ中</span>' : '<span class="muted">待機</span>';
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
    ${head('Step 5', '集計結果を確認', '<span class="chip warn">参加者にはまだ非公開</span>')}
    <p class="step-desc">自動で順位と得点を計算しました。通信トラブルなどで直したいときだけ「修正」で順位を変えられます。問題なければ「結果発表」へ。</p>
    <ul class="jlist">
    ${list.map(r => `<li class="jrow" style="${tvars(r.team)}">
      <span class="rk">${r.rank ?? '—'}<small>${r.rank ? '位' : ''}</small></span>
      <span class="jwho">${teamBadge(r.team)}<span>${esc(r.name)}</span>${r.manual ? '<small class="warn">修正</small>' : ''}</span>
      <b class="jpts">${r.pts}<small>pt</small></b>
      <span class="jdet">${detailHTML(r.detail)}</span>
      <label class="jovr">順位の修正
        <select class="input input-sm ovr" data-team="${r.team}">
          <option value="auto" ${!draft.overrides[r.team] || draft.overrides[r.team] === 'auto' ? 'selected' : ''}>自動（${r.autoRank ? r.autoRank + '位' : '—'}）</option>
          ${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${draft.overrides[r.team] === String(n) ? 'selected' : ''}>${n}位にする</option>`).join('')}
          <option value="dq" ${draft.overrides[r.team] === 'dq' ? 'selected' : ''}>失格（0点）</option></select></label>
    </li>`).join('')}
    </ul>
    <p class="fine">同じ記録は同順位・同得点（次の順位は飛ばす）。フライング・記録なしは0点。${Number(st.mult) > 1 ? '今回は得点2倍。' : ''}</p>
    ${mcHTML(['集計が終わりました。それでは結果発表です！'], '押すと全員のスマホで、5位から順に発表演出が始まります（約10秒）。')}
    <button class="btn btn-gold btn-xl" data-act="publish">結果発表 <span class="arr">→</span></button>
    <div class="row gap">
      <button class="btn btn-ghost" data-act="backRunning">対戦に戻す</button>
      <button class="btn btn-danger-ghost" data-act="redo">このゲームをやり直す</button>
    </div>
  </section>`;
}

function resultsPanel(st) {
  const r = D.results?.['r' + st.round];
  const last = st.round >= L.TOTAL_ROUNDS;
  return `<section class="card">
    ${head('Step 6', '結果発表中')}
    <p class="step-desc">参加者のスマホで発表演出が流れています。終わったら次のゲームへ進みます。</p>
    ${r ? `<ol class="ranklist">${L.orderRows(r.rows).map(x => `<li class="rankrow" style="${tvars(x.team)}"><span class="rk">${x.rank ?? '—'}<small>位</small></span>${teamBadge(x.team)}<span class="who">${esc(x.name)} <small class="muted">${detailHTML(x.detail)}</small></span><b class="pts">+${x.pts}</b></li>`).join('')}</ol>` : '<p>結果データがありません</p>'}
    ${r ? mcHTML([`第${st.round}ゲームの1位は…${L.orderRows(r.rows).filter(x => x.rank === 1).map(x => `${x.team}チーム ${x.name}さん`).join('、')}！`, (() => { const top = L.overallRanking(L.computeTotals(D.results, D.adjust)).filter(x => x.rank === 1).map(x => x.team + 'チーム').join('・'); return `現在の総合1位は ${top} です。`; })()], last ? '次は総合結果発表です。' : '次のゲームへ進むと、参加者の画面は代表者決めに戻ります。') : ''}
    <button class="btn btn-primary btn-xl" data-act="${last ? 'final' : 'next'}">${last ? '総合結果発表へ' : `次のゲームへ（GAME ${st.round + 1}）`} <span class="arr">→</span></button>
    <div class="row gap"><button class="btn btn-ghost" data-act="replay">発表演出をもう一度</button><button class="btn btn-ghost" data-tab="score">得点を修正する</button></div>
  </section>
  ${scoreboardHTML(D.results, D.adjust)}`;
}

function finalPanel() {
  const st = D.state;
  const champs = L.overallRanking(L.computeTotals(D.results, D.adjust)).filter(x => x.rank === 1).map(x => x.team + 'チーム').join('・');
  const aw = st.awards;
  const awList = L.arr(aw?.list);
  const winnersText = a => L.arr(a.winners).length ? L.arr(a.winners).map(w => `${w.team ? w.team + 'チーム ' : ''}${w.name}さん`).join('、') : '該当者なし';
  return `<section class="card">${head('Final', '総合結果発表中')}
    <p class="step-desc">全員のスマホで総合順位を発表しています（約12秒）。発表が終わったら、下の「個人賞を発表する」へ進みます。</p>
    ${mcHTML(['それでは総合結果の発表です！', `総合優勝は……${champs}です！ おめでとうございます！`])}
    <div class="row gap"><button class="btn btn-ghost" data-act="replay">発表演出をもう一度</button><button class="btn btn-ghost" data-act="backResults">第4ゲーム結果に戻す</button></div>
  </section>
  <section class="card award-ctl">
    ${head('Awards', '個人賞の発表', aw ? '<span class="chip ok">発表済み</span>' : '')}
    <p class="step-desc">受賞者はゲームの記録から自動で決まります（司会者は選びません）。押すと全員のスマホで、個人賞1→2の順に発表されます。</p>
    ${aw ? `<ol class="aw-admin">${awList.map(a => `<li><b>${esc(a.title)}</b>：${esc(winnersText(a))}${L.arr(a.winners)[0]?.detail ? `（${esc(L.arr(a.winners)[0].detail)}）` : ''}</li>`).join('')}</ol>
      ${mcHTML(['続いて、個人賞の発表です！', ...awList.map(a => `${a.title}は……${winnersText(a)}！おめでとうございます！`)], L.arr(awList).some(a => L.arr(a.winners).length > 1) ? '同じ記録の人が複数いるときは、景品はじゃんけんで決めてください。' : '')}
      <button class="btn btn-ghost" data-act="announceAwards">もう一度発表する（最新の記録で計算し直す）</button>`
    : `<p>個人賞①：<b>応援団長賞</b>（応援ボタンをいちばん押した人）<br>個人賞②：<b>${esc(L.AWARDS[L.award2Of(D.config)].title)}</b>（${esc(L.AWARDS[L.award2Of(D.config)].sub)}）</p>
      <button class="btn btn-primary btn-xl" data-act="announceAwards">個人賞を発表する <span class="arr">→</span></button>`}
  </section>${scoreboardHTML(D.results, D.adjust, { title: '最終順位' })}`;
}

/** 個人賞の2つ目を選ぶ（受賞者ではなく、賞の種類を選ぶ。どれもゲームの記録で決まる） */
function award2Card() {
  const cur = L.award2Of(D.config);
  return `<section class="card">
    ${head('Awards', '個人賞（ゲームの記録で自動で決まる）')}
    <p>個人賞①：<b>応援団長賞</b>　観戦中に応援ボタンをいちばんたくさん押した人</p>
    <label class="lbl">個人賞②の種類<select class="input" id="award2Sel">${L.AWARD2_OPTIONS.map(k => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(L.AWARDS[k].title)}：${esc(L.AWARDS[k].sub)}</option>`).join('')}</select></label>
    <p class="fine">選べるのは賞の種類だけで、受賞者は記録で自動的に決まります。大会の説明スライドにも、ここで選んだ賞が出ます。「声援王」は、ゲーム時間の長い早押しクイズの代表が有利になりやすい点に注意してください。</p>
  </section>`;
}

// ----- 参加者タブ -----
function membersTab() {
  const cfg = D.config || {};
  const cap = Number(cfg.teamCap) || 5;
  return `<section class="card">
    ${head('Entry', '参加受付', `<span class="chip ${cfg.regOpen ? 'ok' : 'warn'}">${cfg.regOpen ? '受付中' : '締切'}</span>`)}
    <div class="row gap">
      <button class="btn ${cfg.regOpen ? 'btn-ghost' : 'btn-primary'}" data-act="toggleReg">${cfg.regOpen ? '受付を締め切る' : '受付を再開する'}</button>
      <label class="row">1チームの定員 <select class="input input-sm" id="capSel">${Array.from({ length: 9 }, (_, i) => `<option ${cap === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>名</label>
    </div>
    <p class="fine">全員の登録が済んだら受付を締め切ると、知らない人の飛び入り登録を防げます。</p>
  </section>
  ${L.TEAMS.map(t => {
    const ms = membersOf(t);
    return `<section class="card team-card" style="${tvars(t)}">
      <div class="card-head"><h2>${teamBadge(t)} ${t}チーム</h2><span class="chip ${ms.length === 4 ? 'ok' : 'warn'}">${ms.length}人</span></div>
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
    ${head('Score', 'ゲーム別の得点')}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>チーム</th>${rounds.map(r => `<th>G${r}</th>`).join('')}<th>調整</th><th>合計</th></tr></thead><tbody>
      ${L.TEAMS.map(t => `<tr style="${tvars(t)}"><td>${teamBadge(t)}</td>${rounds.map(r => { const x = D.results?.['r' + r]?.rows?.[t]; return `<td>${x ? `${x.pts}<small class="muted">${x.rank ? `(${x.rank}位)` : '(—)'}</small>` : '—'}</td>`; }).join('')}<td>${Number(D.adjust?.[t] || 0)}</td><td><b>${totals[t]}</b></td></tr>`).join('')}
    </tbody></table></div>
    <div class="row gap">${rounds.filter(r => D.results?.['r' + r]).map(r => `<button class="btn btn-sm" data-act="editRound" data-round="${r}">G${r}を修正</button>`).join('') || '<span class="muted">まだ結果はありません</span>'}</div>
  </section>
  ${editRound ? roundEditor(editRound) : ''}
  <section class="card">
    ${head('Adjust', '調整点（ボーナス・ペナルティ）')}
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
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>チーム</th><th>順位</th><th>得点</th></tr></thead><tbody>
    ${L.TEAMS.filter(t => res.rows?.[t]).map(t => { const x = res.rows[t]; return `<tr style="${tvars(t)}"><td>${teamBadge(t)} ${esc(x.name)}<br><small class="muted">${detailHTML(x.detail)}</small></td>
      <td><select class="input input-sm er-rank" data-team="${t}"><option value="">—</option>${[1, 2, 3, 4, 5].map(n => `<option ${Number(x.rank) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
      <td><input class="input input-sm er-pts" type="number" inputmode="numeric" data-team="${t}" value="${Number(x.pts) || 0}" style="width:90px"></td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="row gap"><button class="btn btn-sm" data-act="autoPts" data-round="${r}">順位から得点を再計算</button><button class="btn btn-primary" data-act="saveRound" data-round="${r}">修正を保存</button></div>
    <p class="fine">倍率 ×${Number(res.mult) || 1}。保存すると全員の総合ランキングに即反映されます。</p>
  </section>`;
}

// ----- クイズタブ -----
function quizTab() {
  const bank = Object.entries(D.quizBank || {});
  const ed = editQuizId ? (editQuizId === 'new' ? { text: '', choices: ['', '', '', ''], answer: 0, note: '' } : D.quizBank?.[editQuizId]) : null;
  return `<section class="card">
    ${head('Quiz', `問題一覧（${bank.length}問）`, '<button class="btn btn-sm btn-primary" data-act="newQuiz">＋ 問題を追加</button>')}
    <p class="fine">問題と正解は管理者だけが読めるよう保護されています。出題時は問題文と選択肢だけが参加者に送られます。</p>
    ${ed ? quizEditor(ed) : ''}
    ${bank.length ? `<ol class="qbank">${bank.map(([id, q]) => `<li><div><b>${esc(q.text)}</b> ${q.used ? '<small class="played">使用済</small>' : ''}</div>
      <div class="qb-ch">${L.arr(q.choices).map((c, k) => `<span class="${Number(q.answer) === k ? 'ans' : ''}">${'ABCD'[k]}. ${esc(c)}</span>`).join('')}</div>
      ${q.note ? `<p class="qb-note">解説：${esc(q.note)}</p>` : ''}
      <div class="row gap"><button class="btn btn-xs" data-act="editQuiz" data-id="${id}">編集</button>${q.used ? `<button class="btn btn-xs" data-act="unuseQuiz" data-id="${id}">使用済を解除</button>` : ''}<button class="btn btn-xs btn-danger-ghost" data-act="delQuiz" data-id="${id}">削除</button></div></li>`).join('')}</ol>`
    : '<p class="muted">まだ問題がありません。</p>'}
    <button class="btn ${bank.length ? 'btn-ghost' : 'btn-primary'}" data-act="sampleQuiz">${bank.length ? `Web制作クイズ（${WEB_QUIZ.length}問）に入れ替える` : `Web制作クイズ（${WEB_QUIZ.length}問）を登録する`}</button>
    <p class="fine">Web制作にちなんだ問題${WEB_QUIZ.length}問（解説つき）です。入れ替えると、今ある問題はすべて削除されます。</p>
  </section>`;
}

function quizEditor(q) {
  return `<form class="quiz-ed" id="quizForm">
    <label class="lbl">問題文<textarea class="input" id="qeText" rows="2" maxlength="120" required>${esc(q.text)}</textarea></label>
    ${[0, 1, 2, 3].map(k => `<label class="qe-row"><input type="radio" name="qeAns" value="${k}" ${Number(q.answer) === k ? 'checked' : ''}><span>${'ABCD'[k]}</span><input class="input qe-c" data-k="${k}" maxlength="40" value="${esc(q.choices?.[k] || '')}" required></label>`).join('')}
    <p class="fine">●を付けた選択肢が正解です。</p>
    <label class="lbl">解説（任意・正解発表のときに全員のスマホに出ます）<textarea class="input" id="qeNote" rows="2" maxlength="120">${esc(q.note || '')}</textarea></label>
    <div class="row gap"><button class="btn btn-primary" type="submit">保存</button><button class="btn btn-ghost" type="button" data-act="cancelQuiz">キャンセル</button></div>
  </form>`;
}

// ----- QR・設定タブ -----
function setupTab() {
  let svg = '';
  try { const qr = qrcode(0, 'M'); qr.addData(PLAYER_URL); qr.make(); svg = qr.createSvgTag({ cellSize: 8, margin: 3, scalable: true }); } catch (e) { svg = '<p>QR生成エラー</p>'; }
  return `${rehearsalCard()}
  ${award2Card()}
  <section class="card center qr-card">
    ${head('Entry QR', '参加用QRコード')}
    <div class="qr-box">${svg}</div>
    <p class="url">${esc(PLAYER_URL)}</p>
    <div class="row gap center"><button class="btn" data-act="copyUrl">URLをコピー</button><button class="btn btn-ghost" data-act="bigQr">QRを全画面表示</button></div>
    <p class="fine">Wi-Fi共通でなくてもOK。各自のスマホのモバイル回線で参加できます。LINE等でQRを読んだ場合も、そのまま開いたアプリで最後まで遊んでください。</p>
  </section>
  <section class="card">
    ${head('URL', 'URL')}
    <p>参加者用：<a href="${esc(PLAYER_URL)}" target="_blank" rel="noopener">${esc(PLAYER_URL)}</a></p>
    <p>管理者用：<a href="${esc(ADMIN_URL)}">${esc(ADMIN_URL)}</a></p>
  </section>
  <section class="card danger-zone">
    ${head('Reset', 'リセット')}
    <button class="btn btn-danger-ghost" data-act="redo">このゲームをやり直す（記録を消して代表者発表から）</button>
    <button class="btn btn-danger-ghost" data-act="resetScores">得点・出場履歴をリセット（参加者は残す）</button>
    <button class="btn btn-danger" data-act="resetAll">全データ初期化（参加者も削除）</button>
    <p class="fine">リハーサル後は「全データ初期化」で本番前の状態に戻せます。クイズの問題は残ります。</p>
  </section>`;
}

// ---------- イベント ----------
function afterRender() {
  $$('.rep-sel').forEach(s => s.addEventListener('change', async () => {
    const t = s.dataset.team;
    if (s.value && D.used?.[s.value] && !confirm(`${nameOf(s.value)} さんはすでに出場済みです。それでも代表にしますか？`)) { s.value = validPick(t) || ''; return; }
    s.blur();
    try { await be.set(`pick/${t}`, s.value || null); } catch (e) { toast(errMsg(e), 'error'); }
  }));
  // ゲーム・倍率は参加者の待機画面にもすぐ表示する（代表者決めの参考になる）
  $('#gameSel')?.addEventListener('change', async e => {
    const g = e.target.value; e.target.blur();
    try { await be.update({ 'state/game': g, 'state/updatedAt': be.TS }); } catch (err) { toast(errMsg(err), 'error'); }
  });
  $('#multSel')?.addEventListener('change', async e => {
    const m = Number(e.target.value); e.target.blur();
    try { await be.update({ 'state/mult': m, 'state/updatedAt': be.TS }); } catch (err) { toast(errMsg(err), 'error'); }
  });
  $('#qCount')?.addEventListener('change', e => { draft.quizCount = Number(e.target.value); e.target.blur(); queueRender(); });
  $$('.qp').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) { if (!draft.quizPick.includes(cb.value)) draft.quizPick.push(cb.value); } else draft.quizPick = draft.quizPick.filter(x => x !== cb.value);
    queueRender();
  }));
  $$('.ovr').forEach(s => s.addEventListener('change', () => { draft.overrides[s.dataset.team] = s.value; s.blur(); queueRender(); }));
  $('#capSel')?.addEventListener('change', e => { setCap(Number(e.target.value)); e.target.blur(); });
  $('#award2Sel')?.addEventListener('change', async e => {
    const v = e.target.value; e.target.blur();
    try { await be.set('config/award2', v); toast(`個人賞②を「${L.AWARDS[v].title}」にしました`, 'ok'); } catch (err) { toast(errMsg(err), 'error'); }
  });
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
  async explainOpen(b) {
    const key = b.dataset.key;
    if (key !== 'opening' && !L.GAMES[key]) throw new Error('説明が見つかりません');
    if (!L.EXPLAIN_PHASES.includes(D.state?.phase)) throw new Error('ゲーム中は説明を出せません');
    await be.update({ 'state/explain': { key, page: 0, at: be.TS }, 'state/updatedAt': be.TS });
    window.scrollTo(0, 0);
  },
  async explainMove(b) {
    const st = D.state;
    const ex = st?.explain;
    if (!ex?.key) return;
    const n = L.explainSlides(ex.key, { mult: Number(st.mult) || 1, round: st.round || 1, phase: st.phase, award2: L.award2Of(D.config) }).length;
    const page = Math.min(Math.max((Number(ex.page) || 0) + Number(b.dataset.d || 1), 0), n - 1);
    await be.update({ 'state/explain/page': page, 'state/updatedAt': be.TS });
  },
  async explainClose() {
    await be.update({ 'state/explain': null, 'state/updatedAt': be.TS });
  },
  async autoReps() {
    const up = {};
    for (const t of L.TEAMS) {
      if (validPick(t)) continue;
      const ms = membersOf(t);
      if (!ms.length) continue;
      const fresh = ms.filter(m => !D.used?.[m.uid]);
      const pool = fresh.length ? fresh : ms;
      up[`pick/${t}`] = pool[Math.floor(Math.random() * pool.length)].uid;
    }
    if (!Object.keys(up).length) { toast('未定のチームはありません', 'info'); return; }
    if (!confirm(`未定の ${Object.keys(up).length} チームを、未出場者からランダムに指定します。よろしいですか？`)) return;
    await be.update(up);
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
      const u = validPick(t);
      if (u) { reps[t] = u; repOf[u] = t; }
    }
    const n = Object.keys(reps).length;
    if (!n) throw new Error('代表者を1人以上選んでください');
    if (n < 5 && !confirm(`代表者が${n}チーム分しか選ばれていません。このまま進めますか？`)) return;
    const runId = newRunId();
    const up = {
      'state/phase': 'ready', 'state/reps': reps, 'state/repOf': repOf,
      'state/runId': runId, 'state/startAt': 0, 'state/iaiDelay': 0, 'state/revealAt': 0, 'state/updatedAt': be.TS, 'state/quiz': null, 'state/explain': null,
    };
    if (st.game === 'quiz') {
      const ids = draft.quizPick.filter(id => D.quizBank?.[id]).slice(0, draft.quizCount);
      if (ids.length !== Number(draft.quizCount)) throw new Error(`問題を${draft.quizCount}問選んでください`);
      up[`adminOnly/quizRun/${runId}`] = ids.map(id => ({ id, text: D.quizBank[id].text, choices: L.arr(D.quizBank[id].choices), answer: Number(D.quizBank[id].answer), note: D.quizBank[id].note || null }));
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
      'state/explain': null,
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
    // 1問ごとの結果（○×・選んだ答え・回答時間・それまでの正解数）を全員に配る
    const answers = L.arr(D.quizRun).map(x => Number(x.answer));
    const res = {};
    for (const [t, u] of Object.entries(st.reps || {})) {
      const a = D.subs?.[u]?.[q.key];
      let tot = 0;
      for (let i = 0; i <= Number(q.idx); i++) { const x = D.subs?.[u]?.['q' + i]; if (x && Number(x.c) === answers[i]) tot++; }
      res[t] = a ? { c: Number(a.c), v: Math.round(Number(a.v) || 0), ok: Number(a.c) === Number(src.answer), tot } : { c: -1, ok: false, tot };
    }
    await be.update({ 'state/quiz/open': false, 'state/quiz/reveal': Number(src.answer), 'state/quiz/note': src.note || null, 'state/quiz/res': res, 'state/updatedAt': be.TS });
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
    draft.forRound = null; draft.quizPick = [];
    await be.update({
      pick: null,
      state: { round: r, game: L.ROUND_GAMES[r - 1], mult: L.DEFAULT_MULT[r - 1], phase: 'lobby', startAt: 0, iaiDelay: 0, revealAt: 0, updatedAt: be.TS },
    });
  },
  async final() {
    if (!confirm('総合結果を発表しますか？（全員のスマホで最終順位の発表演出が始まります）')) return;
    await be.update({ 'state/phase': 'final', 'state/revealAt': be.serverNow() + 1500, 'state/awards': null, 'state/updatedAt': be.TS });
  },
  async backResults() { await be.update({ 'state/phase': 'results', 'state/revealAt': 0, 'state/updatedAt': be.TS }); },
  async redo() {
    const st = D.state;
    if (!st.runId || !['ready', 'running', 'judging', 'results'].includes(st.phase)) throw new Error('やり直せるゲームがありません（代表者発表後に使えます）');
    if (!confirm(`GAME ${st.round}（${L.GAMES[st.game].title}）をやり直します。今回の記録${st.phase === 'results' ? 'と発表済みの結果' : ''}を消して、代表者発表の状態に戻します。よろしいですか？`)) return;
    const runId = newRunId();
    const up = {
      'state/phase': 'ready', 'state/runId': runId, 'state/startAt': 0, 'state/revealAt': 0, 'state/explain': null, 'state/updatedAt': be.TS,
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
    const up = { [`members/${u}`]: null, [`slots/${m.team}/${m.slot}`]: null };
    if (D.pick?.[m.team] === u) up[`pick/${m.team}`] = null;
    await be.update(up);
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
    const n = Object.keys(D.quizBank || {}).length;
    if (n && !confirm(`今ある問題${n}問を削除して、Web制作クイズ${WEB_QUIZ.length}問に入れ替えます。よろしいですか？`)) return;
    const bank = {};
    WEB_QUIZ.forEach((q, i) => { bank['w' + String(i + 1).padStart(2, '0')] = { ...q, used: false }; });
    await be.set('quizBank', bank);
    draft.quizPick = [];
    toast(`Web制作クイズ${WEB_QUIZ.length}問を登録しました`, 'ok');
  },
  async rhStart() {
    const n = Number($('#rhN')?.value) || 3;
    const wasOn = !!D.config?.rehearsal;
    if (!wasOn && !confirm(`リハーサルを始めます。各チームにダミー参加者を${n}人ずつ入れます（空き枠の範囲で）。よろしいですか？`)) return;
    const added = await addDummies(be, D, n);
    toast(added ? `ダミーを${added}人追加しました` : 'ダミーを追加する空き枠がありません（定員を増やすか、人数を変えてください）', added ? 'ok' : 'warn', 5000);
    if (added && !wasOn) { tab = 'control'; try { sessionStorage.setItem('ekzm-admin-tab', tab); } catch { /* noop */ } }
    queueRender();
  },
  async rhEnd() {
    if (!confirm('リハーサルを終わります。ダミーと、リハーサルの得点・記録を消して GAME 1 の待機に戻ります（本物の参加者の登録とクイズの問題は残ります）。よろしいですか？')) return;
    togglePreview(false);
    rhDriver?.stop();
    draft.forRound = null; draft.quizPick = [];
    await be.update(endRehearsalUpdate(D, initialState()));
    toast('リハーサルを終了しました', 'ok');
  },
  rhPreview() { togglePreview(true); },
  async announceAwards() {
    const cheer = (await be.get('cheer')) || {};
    const list = L.computeAwards({ results: D.results, cheer, members: D.members, award2: L.award2Of(D.config) });
    if (!confirm(`個人賞（${list.map(a => a.title).join('・')}）を全員のスマホで発表します。受賞者はゲームの記録から自動で決まります。よろしいですか？`)) return;
    await be.update({ 'state/awards': { at: be.serverNow() + 1200, list }, 'state/updatedAt': be.TS });
    sfx.reveal();
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
    const up = { results: null, adjust: null, used: null, subs: null, prog: null, live: null, cheer: null, adminOnly: null, pick: null, state: initialState() };
    for (const id of Object.keys(D.quizBank || {})) up[`quizBank/${id}/used`] = false;
    draft.forRound = null; draft.quizPick = [];
    await be.update(up);
    toast('得点と履歴をリセットしました', 'ok');
  },
  async resetAll() {
    if (!confirm('参加者も含めて全データを初期化します（クイズ問題は残ります）。参加者は登録からやり直しになります。よろしいですか？')) return;
    if (prompt('確認のため「初期化」と入力してください') !== '初期化') return;
    const up = { results: null, adjust: null, used: null, subs: null, prog: null, live: null, cheer: null, adminOnly: null, pick: null, members: null, slots: null, online: null, state: initialState(), config: { ...defaultConfig(Number(D.config?.teamCap) || 5), award2: D.config?.award2 || null } };
    for (const id of Object.keys(D.quizBank || {})) up[`quizBank/${id}/used`] = false;
    draft.forRound = null; draft.quizPick = [];
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
  const note = ($('#qeNote')?.value || '').trim();
  if (!text || choices.some(c => !c)) { toast('問題文と4つの選択肢をすべて入力してください', 'error'); return; }
  const id = editQuizId === 'new' ? 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) : editQuizId;
  try {
    await be.set(`quizBank/${id}`, { text, choices, answer, note: note || null, used: !!D.quizBank?.[id]?.used });
    editQuizId = null;
    document.activeElement?.blur?.();
    toast('問題を保存しました', 'ok');
    queueRender();
  } catch (err) { toast(errMsg(err), 'error'); }
}

boot();
