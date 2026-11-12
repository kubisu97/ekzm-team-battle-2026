// 参加者画面・管理画面で共通の表示部品
import { TEAMS, TEAM_INFO, GAMES, OVERVIEW, POINTS, orderRows, computeTotals, overallRanking } from './logic.js?v=3';
import { sfx, confetti, vibrate } from './fx.js?v=3';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const tvars = t => `--tc:${TEAM_INFO[t]?.color || '#888'};--tct:${TEAM_INFO[t]?.text || '#fff'};--tg:${TEAM_INFO[t]?.glow || 'transparent'};--tcd:${t === 'B' ? '#9a6f00' : TEAM_INFO[t]?.color || '#888'}`;

/** 見出し：英語ラベル「( Label )」＋日本語タイトル（ekzm.co.jp のセクション見出しのトーン） */
export const head = (en, ja, extra = '') => `<div class="card-head"><div><span class="label">${esc(en)}</span><h2>${ja}</h2></div>${extra}</div>`;

/** ゲーム番号のピル */
export const gameTag = key => `<span class="gnum">GAME ${GAMES[key]?.num || ''}</span>`;

/** 線画のキューブ（サイトのイラストのトーンに合わせた装飾） */
export const cubeSVG = (w = 120) => `<svg class="deco" width="${w}" viewBox="0 0 160 110" aria-hidden="true" fill="none" stroke="#112850" stroke-width="1.6" stroke-linejoin="round">
  <path d="M30 52 L58 38 L86 52 L58 66 Z" fill="#fff"/><path d="M30 52 L30 82 L58 96 L58 66 Z" fill="#c9d6ea"/><path d="M58 66 L58 96 L86 82 L86 52 Z" fill="#fff"/>
  <path d="M86 30 L108 19 L130 30 L108 41 Z" fill="#fdf1c9"/><path d="M86 30 L86 54 L108 65 L108 41 Z" fill="#f5c842"/><path d="M108 41 L108 65 L130 54 L130 30 Z" fill="#fdf1c9"/>
  <rect x="104" y="72" width="16" height="16" fill="#009844" stroke="none"/><rect x="124" y="80" width="10" height="10" fill="#e50012" stroke="none"/><rect x="18" y="20" width="14" height="14" fill="#dbdcdc" stroke="none"/>
</svg>`;

export const ICON = {
  soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h4v16h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>',
};

/** 得点表（1位100…5位10、倍率つき） */
export function pointsHTML(mult = 1) {
  const m = Number(mult) || 1;
  return `<div class="points">${POINTS.map((p, i) => `<div><b>${p * m}</b><small>${i + 1}位</small></div>`).join('')}</div>`;
}

/** ゲームの遊び方（手順・順位の決め方・注意） */
export function howtoHTML(key, { mult = 1, role = 'all' } = {}) {
  const g = GAMES[key];
  if (!g) return '';
  return `<ol class="howto">${g.howto.map(h => `<li>${h}</li>`).join('')}</ol>
    <div class="infobox"><span class="k">順位の決め方</span>${esc(g.judge)}</div>
    <div class="infobox ${key === 'iai' ? 'alert' : ''}"><span class="k">${key === 'iai' ? '注意' : 'ポイント'}</span>${esc(g.tips)}</div>
    ${role !== 'rep' ? `<div class="infobox"><span class="k">観戦する人は</span>${esc(g.spec)}</div>` : ''}
    <div class="infobox"><span class="k">得点${Number(mult) > 1 ? `（このゲームは${mult}倍）` : ''}</span>${pointsHTML(mult)}</div>`;
}

/** 全体の遊び方（ヘルプ） */
export function helpHTML() {
  return `${head('How to play', 'EKZM TEAM BATTLE の遊び方')}
    <ol class="howto">${OVERVIEW.flow.map(h => `<li>${h}</li>`).join('')}</ol>
    <h3>得点</h3>${pointsHTML(1)}<p class="fine">${esc(OVERVIEW.scoring)} 最終ゲームは得点2倍です。</p>
    <h3>4つのゲーム</h3>
    ${Object.values(GAMES).map(g => `<div class="game-mini"><p>${gameTag(g.key)}<b>${esc(g.title)}</b></p><p class="muted" style="margin:0">${esc(g.lead)}。${esc(g.judge)}</p></div>`).join('')}
    <h3>困ったときは</h3>
    <ul class="checklist">${OVERVIEW.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;
}

export function openHelp() {
  const ov = document.createElement('div');
  ov.className = 'help-modal';
  ov.innerHTML = `<div class="help-sheet" role="dialog" aria-label="遊び方"><button class="btn btn-sm close" type="button">閉じる</button>${helpHTML()}</div>`;
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.close')) ov.remove(); });
  document.body.appendChild(ov);
}
export const teamBadge = (t, extra = '') => `<span class="tbadge ${extra}" style="${tvars(t)}">${esc(t)}</span>`;

export function toast(msg, kind = 'info', ms = 3200) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}

/** サーバー時刻 → この端末の performance.now() 基準時刻 */
export function perfAt(be, serverT) {
  return performance.now() + (Number(serverT) - be.serverNow());
}

/** 指定時刻まで rAF で待ち、ちょうど描画するフレームで onGo(now) を呼ぶ */
export function waitUntil(perfTarget, { onTick, onGo }) {
  let raf = 0;
  let to = 0;
  let last = null;
  let dead = false;
  const loop = () => {
    cancelAnimationFrame(raf); clearTimeout(to);
    if (dead) return;
    const now = performance.now();
    const remain = perfTarget - now;
    if (remain <= 0) { dead = true; onGo?.(now); return; }
    const n = Math.ceil(remain / 1000);
    if (n !== last) { last = n; onTick?.(n, remain); }
    schedule();
  };
  // 通常は rAF（描画フレームに合わせる）。rAF が止まる環境ではタイマーで代替
  const schedule = () => { raf = requestAnimationFrame(loop); to = setTimeout(loop, 60); };
  schedule();
  return () => { dead = true; cancelAnimationFrame(raf); clearTimeout(to); };
}

/** カウントダウン表示（3,2,1,START!）。COUNTDOWN 中の大きな数字。 */
export function countdownOverlay(host, perfGo, { label = '', sub = '', onGo, sound = true } = {}) {
  const ov = document.createElement('div');
  ov.className = 'cd-overlay';
  ov.innerHTML = `<div class="cd-label">${esc(label)}</div><div class="cd-num">…</div>${sub ? `<div class="cd-sub">${esc(sub)}</div>` : ''}`;
  host.appendChild(ov);
  const num = ov.querySelector('.cd-num');
  const stop = waitUntil(perfGo, {
    onTick(n) {
      if (n > 3) { num.textContent = 'READY'; num.className = 'cd-num small'; return; }
      num.textContent = n; num.className = 'cd-num'; void num.offsetWidth; num.classList.add('pop');
      if (sound) sfx.tick();
      vibrate(20);
    },
    onGo(now) {
      ov.remove();
      onGo?.(now);
    },
  });
  return () => { stop(); ov.remove(); };
}

export function scoreboardHTML(results, adjust, { me = null, title = '総合ランキング', compact = false } = {}) {
  const totals = computeTotals(results, adjust);
  const ranking = overallRanking(totals);
  const max = Math.max(1, ...ranking.map(r => r.pts));
  const played = Object.keys(results || {}).length;
  return `<section class="card scoreboard ${compact ? 'compact' : ''}">
    ${head('Ranking', esc(title), `<span class="chip">${played}/4 ゲーム終了</span>`)}
    <ol class="ranklist">${ranking.map(r => `
      <li class="rankrow ${me === r.team ? 'me' : ''}" style="${tvars(r.team)}">
        <span class="rk">${r.rank}<small>位</small></span>
        ${teamBadge(r.team)}
        <span class="bar"><i style="width:${Math.round((r.pts / max) * 100)}%"></i></span>
        <b class="pts">${r.pts}<small>pt</small></b>
      </li>`).join('')}
    </ol>
  </section>`;
}

/** ラウンド結果の発表演出（全端末で revealAt に合わせて同時に進行） */
export function mountRoundReveal(host, { be, result, round, results, adjust, revealAt, me = null }) {
  const game = GAMES[result.game] || {};
  const rows = orderRows(result.rows);
  const seq = [...rows].reverse(); // 下位から発表
  host.innerHTML = `<section class="card reveal-card">
      <div class="reveal-title"><span class="label">Result</span>
      <h2>${gameTag(result.game)}${esc(game.title || '')} 結果発表${Number(result.mult) > 1 ? '<span class="x2">得点2倍</span>' : ''}</h2>
      <p class="fine" style="margin-top:-6px">5位から順に発表します。記録の横の「+」がこのゲームで入った得点です。</p></div>
      <ol class="reveal-list">${seq.map(r => `
        <li class="reveal-item ${r.rank === 1 ? 'first' : ''} ${me === r.team ? 'me' : ''}" style="${tvars(r.team)}">
          <span class="rk">${r.rank ? `${r.rank}<small>位</small>` : '<small>失格</small>'}</span>
          ${teamBadge(r.team)}
          <span class="who"><b>${esc(r.name)}</b><small>${esc(r.detail)}</small></span>
          <b class="gain">+${r.pts}</b>
        </li>`).join('')}</ol>
    </section><div class="reveal-after"></div>`;
  const items = [...host.querySelectorAll('.reveal-item')];
  const after = host.querySelector('.reveal-after');
  const start = perfAt(be, revealAt || 0);
  const STEP = 1500, LEAD = 1600;
  const doneAt = start + LEAD + (items.length - 1) * STEP;
  const timers = [];
  const now = performance.now();
  const showAll = () => {
    items.forEach(i => i.classList.add('shown'));
    after.innerHTML = scoreboardHTML(results, adjust, { me, title: `第${round}ゲーム終了時点の順位` }) +
      (round < 4 ? `<p class="fine center">次のゲームの準備ができるまで、少しお待ちください。代表者はまたチームで決めます。</p>` : `<p class="fine center">このあと、司会者が総合結果を発表します。</p>`);
  };
  if (now > doneAt + 1500) { showAll(); return () => {}; }
  if (now < start + LEAD) sfx.drum(Math.min(2, (start + LEAD - now) / 1000));
  items.forEach((el, i) => {
    const at = start + LEAD + i * STEP;
    timers.push(setTimeout(() => {
      el.classList.add('shown');
      if (i === items.length - 1) { sfx.fanfare(); confetti(3500, [TEAM_INFO[seq[i].team].color, '#112850', '#f5c842', '#ffffff']); vibrate([60, 40, 120]); }
      else sfx.reveal();
    }, Math.max(0, at - now)));
  });
  timers.push(setTimeout(showAll, Math.max(0, doneAt + 1400 - now)));
  return () => timers.forEach(clearTimeout);
}

/** 総合結果発表（5位→1位、優勝チームを大きく） */
export function mountFinalReveal(host, { be, results, adjust, revealAt, members = {}, me = null }) {
  const totals = computeTotals(results, adjust);
  const ranking = overallRanking(totals);
  const seq = [...ranking].reverse();
  const champs = ranking.filter(r => r.rank === 1);
  const memberNames = t => Object.values(members || {}).filter(m => m.team === t).map(m => esc(m.name)).join('・');
  host.innerHTML = `<section class="card final-card">
      <div class="reveal-title"><span class="label">Final Result</span><h2>総合結果発表</h2><p class="fine" style="margin-top:-6px">4ゲームの合計点で順位が決まりました。5位から順に発表します。</p></div>
      <ol class="reveal-list final">${seq.map(r => `
        <li class="reveal-item ${r.rank === 1 ? 'first' : ''} ${me === r.team ? 'me' : ''}" style="${tvars(r.team)}">
          <span class="rk">${r.rank}<small>位</small></span>${teamBadge(r.team)}
          <span class="who"><b>${esc(r.team)}チーム</b><small>${memberNames(r.team) || '&nbsp;'}</small></span>
          <b class="gain">${r.pts}<small>pt</small></b>
        </li>`).join('')}</ol>
      <div class="champion">${champs.map(c => `<div class="champ" style="${tvars(c.team)}"><span class="crown">CHAMPION</span><b>${esc(c.team)}チーム</b><span>総合優勝！</span></div>`).join('')}</div>
    </section>`;
  const items = [...host.querySelectorAll('.reveal-item')];
  const champ = host.querySelector('.champion');
  const start = perfAt(be, revealAt || 0);
  const STEP = 1900, LEAD = 2200;
  const now = performance.now();
  const doneAt = start + LEAD + (items.length - 1) * STEP;
  const timers = [];
  if (now > doneAt + 2000) { items.forEach(i => i.classList.add('shown')); champ.classList.add('shown'); return () => {}; }
  if (now < start + LEAD) sfx.drum(Math.min(2.2, (start + LEAD - now) / 1000));
  items.forEach((el, i) => {
    timers.push(setTimeout(() => { el.classList.add('shown'); sfx.reveal(); }, Math.max(0, start + LEAD + i * STEP - now)));
  });
  timers.push(setTimeout(() => {
    champ.classList.add('shown');
    sfx.fanfare(); vibrate([80, 60, 80, 60, 200]);
    confetti(6000, champs.map(c => TEAM_INFO[c.team].color).concat(['#112850', '#f5c842', '#e50012', '#009844']));
  }, Math.max(0, doneAt + 900 - now)));
  return () => timers.forEach(clearTimeout);
}

export function rosterHTML(members, { me = null, used = {}, online = null } = {}) {
  const byTeam = Object.fromEntries(TEAMS.map(t => [t, []]));
  for (const [uid, m] of Object.entries(members || {})) if (byTeam[m.team]) byTeam[m.team].push({ uid, ...m });
  return `<div class="roster">${TEAMS.map(t => `
    <div class="roster-team" style="${tvars(t)}">
      <div class="roster-head">${teamBadge(t)}<span>${byTeam[t].length}人</span></div>
      <ul>${byTeam[t].sort((a, b) => String(a.slot).localeCompare(String(b.slot))).map(m => `<li class="${m.uid === me ? 'me' : ''}">${online ? `<i class="dot ${online[m.uid] ? 'on' : ''}"></i>` : ''}${esc(m.name)}${used?.[m.uid] ? ' <small class="played">出場済</small>' : ''}</li>`).join('') || '<li class="empty">まだいません</li>'}</ul>
    </div>`).join('')}</div>`;
}
