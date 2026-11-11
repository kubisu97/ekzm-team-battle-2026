// 参加者画面・管理画面で共通の表示部品
import { TEAMS, TEAM_INFO, GAMES, orderRows, computeTotals, overallRanking } from './logic.js';
import { sfx, confetti, vibrate } from './fx.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const tvars = t => `--tc:${TEAM_INFO[t]?.color || '#888'};--tg:${TEAM_INFO[t]?.glow || 'transparent'}`;
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
export function countdownOverlay(host, perfGo, { label = '', onGo, sound = true } = {}) {
  const ov = document.createElement('div');
  ov.className = 'cd-overlay';
  ov.innerHTML = `<div class="cd-label">${esc(label)}</div><div class="cd-num">…</div>`;
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
    <div class="card-head"><h2>🏆 ${esc(title)}</h2><span class="chip">${played}/4 ゲーム終了</span></div>
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
      <div class="reveal-title"><span class="eyebrow">GAME ${round} RESULT${Number(result.mult) > 1 ? ' ・ 得点2倍' : ''}</span>
      <h2>${game.icon || ''} ${esc(game.title || '')} 結果発表！</h2></div>
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
    after.innerHTML = scoreboardHTML(results, adjust, { me, title: `第${round}ゲーム終了時点の順位` });
  };
  if (now > doneAt + 1500) { showAll(); return () => {}; }
  if (now < start + LEAD) sfx.drum(Math.min(2, (start + LEAD - now) / 1000));
  items.forEach((el, i) => {
    const at = start + LEAD + i * STEP;
    timers.push(setTimeout(() => {
      el.classList.add('shown');
      if (i === items.length - 1) { sfx.fanfare(); confetti(3500, [TEAM_INFO[seq[i].team].color, '#ffffff', '#ffd76a']); vibrate([60, 40, 120]); }
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
      <div class="reveal-title"><span class="eyebrow">EKZM TEAM BATTLE 2026</span><h2>👑 総合結果発表</h2></div>
      <ol class="reveal-list final">${seq.map(r => `
        <li class="reveal-item ${r.rank === 1 ? 'first' : ''} ${me === r.team ? 'me' : ''}" style="${tvars(r.team)}">
          <span class="rk">${r.rank}<small>位</small></span>${teamBadge(r.team)}
          <span class="who"><b>${esc(r.team)}チーム</b><small>${memberNames(r.team) || '&nbsp;'}</small></span>
          <b class="gain">${r.pts}<small>pt</small></b>
        </li>`).join('')}</ol>
      <div class="champion">${champs.map(c => `<div class="champ" style="${tvars(c.team)}"><span class="crown">👑</span><b>${esc(c.team)}チーム</b><span>総合優勝！</span></div>`).join('')}</div>
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
    confetti(6000, champs.map(c => TEAM_INFO[c.team].color).concat(['#ffd76a', '#ffffff']));
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
