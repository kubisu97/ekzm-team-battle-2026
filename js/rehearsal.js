// リハーサルモード：管理画面だけで「ダミー参加者」を動かし、1人でも本番と同じ流れを試せるようにする。
// ダミーは参加者アカウントを作らず、管理者の権限で書き込む（uid が 'rh_' で始まるものがダミー）。
// ダミーを動かすのは、リハーサルを開始した管理画面（開いている間だけ動く）。
import * as L from './logic.js?v=6';

export const isDummy = uid => String(uid || '').startsWith('rh_');
export const RH_PREFIX = 'rh_';

const rand = (a, b) => a + Math.random() * (b - a);

/** ダミー参加者を各チームに追加する（空き枠の範囲で）。追加した人数を返す */
export async function addDummies(be, D, perTeam) {
  const allowed = Object.keys(D.config?.slots || {}).filter(k => D.config.slots[k] === true).sort((a, b) => a - b);
  const up = { 'config/rehearsal': true };
  let added = 0;
  for (const t of L.TEAMS) {
    const taken = D.slots?.[t] || {};
    const free = allowed.filter(n => !taken[n]);
    const already = Object.entries(D.members || {}).filter(([u, m]) => isDummy(u) && m.team === t).length;
    const n = Math.max(0, Math.min(perTeam - already, free.length));
    for (let i = 0; i < n; i++) {
      const slot = free[i];
      const uid = `${RH_PREFIX}${t}${slot}_${Math.random().toString(36).slice(2, 7)}`;
      up[`members/${uid}`] = { name: `ダミー${t}${already + i + 1}`, team: t, slot: String(slot), at: be.TS };
      up[`slots/${t}/${slot}`] = uid;
      added++;
    }
  }
  await be.update(up);
  return added;
}

/** リハーサルを終える：ダミーを消して、得点・記録をリセット（本物の参加者の登録は残す） */
export function endRehearsalUpdate(D, initialState) {
  const up = {
    'config/rehearsal': null,
    results: null, adjust: null, used: null, subs: null, prog: null, live: null, adminOnly: null, pick: null,
    state: initialState,
  };
  for (const [u, m] of Object.entries(D.members || {})) {
    if (!isDummy(u)) continue;
    up[`members/${u}`] = null;
    if (m?.team && m.slot != null) up[`slots/${m.team}/${m.slot}`] = null;
    up[`online/${u}`] = null;
  }
  for (const id of Object.keys(D.quizBank || {})) up[`quizBank/${id}/used`] = false;
  return up;
}

/**
 * ダミーの自動操作。state の変化に合わせて、立候補・準備OK・ゲームの記録を送る。
 * tick() を定期的に呼ぶ（管理画面の描画のたびと、0.5秒ごと）。
 */
export function createDriver(be, D, { onError = () => {} } = {}) {
  let timers = [];
  const done = new Set();          // 予約済み・実行済みの操作
  const pending = new Map();       // まだ実行していない予約（画面が変わったら取り消して、あとでやり直せるようにする）
  let phaseKey = '';
  const run1 = fn => Promise.resolve().then(fn).catch(onError);
  const later = (ms, fn) => timers.push(setTimeout(() => run1(fn), Math.max(0, ms)));
  const at = (serverT, fn) => later(serverT - be.serverNow(), fn);
  /** key ごとに1回だけ予約する */
  const once = (key, ms, fn) => {
    if (done.has(key)) return;
    done.add(key);
    pending.set(key, setTimeout(() => { pending.delete(key); run1(fn); }, Math.max(0, ms)));
  };
  const clear = () => {
    timers.forEach(clearTimeout); timers = [];
    for (const [k, id] of pending) { clearTimeout(id); done.delete(k); }
    pending.clear();
  };
  const validPick = t => { const u = D.pick?.[t]; return u && D.members?.[u]?.team === t ? u : null; };
  const stillRunning = run => D.state?.phase === 'running' && D.state?.runId === run;

  function submit(run, uid, key, payload) {
    if (!stillRunning(run)) return null;
    return be.update({
      [`subs/${run}/${uid}/${key}`]: { ...payload, at: be.TS },
      [`prog/${run}/${uid}/${key}`]: true,
    });
  }

  function lobby(st) {
    for (const t of L.TEAMS) {
      if (validPick(t)) continue;
      const ms = Object.entries(D.members || {}).filter(([, m]) => m.team === t);
      const dummies = ms.filter(([u]) => isDummy(u)).map(([u]) => u);
      if (!dummies.length) continue;
      // 本物の参加者がいるチームは、その人が立候補するのを20秒待つ
      const hasReal = ms.some(([u]) => !isDummy(u));
      once(`pick|${st.round}|${t}`, hasReal ? 20000 : rand(2000, 6000), async () => {
        const s = D.state;
        if (s?.phase !== 'lobby' || s.round !== st.round || validPick(t)) return;
        const pool = Object.entries(D.members || {}).filter(([u, m]) => isDummy(u) && m.team === t).map(([u]) => u);
        const fresh = pool.filter(u => !D.used?.[u]);
        const list = fresh.length ? fresh : pool;
        if (!list.length) return;
        await be.set(`pick/${t}`, list[Math.floor(Math.random() * list.length)]);
      });
    }
  }

  function ready(st) {
    const run = st.runId;
    for (const u of Object.values(st.reps || {})) {
      if (!isDummy(u)) continue;
      once(`ok|${run}|${u}`, rand(800, 3000), async () => {
        if (D.state?.phase !== 'ready' || D.state?.runId !== run) return;
        await be.set(`prog/${run}/${u}/ok`, true);
      });
    }
  }

  function running(st) {
    const run = st.runId;
    const start = Number(st.startAt) || be.serverNow();
    for (const u of Object.values(st.reps || {})) {
      if (!isDummy(u)) continue;
      if (st.game === 'quiz') {
        const q = st.quiz || {};
        if (!q.key || !q.open) continue;
        const think = Math.round(rand(1500, 10000));
        once(`q|${run}|${q.key}|${u}`, Number(q.at) + think - be.serverNow(), async () => {
          const cur = D.state?.quiz;
          if (!stillRunning(run) || cur?.key !== q.key || !cur.open) return;
          const ans = Number(L.arr(D.quizRun)[Number(q.idx)]?.answer);
          const n = L.arr(q.q?.choices).length || 4;
          let c = Math.floor(Math.random() * n);
          if (Number.isFinite(ans)) c = Math.random() < 0.55 ? ans : [...Array(n).keys()].filter(x => x !== ans)[Math.floor(Math.random() * (n - 1))];
          await be.update({ [`prog/${run}/${u}/g${q.idx}`]: true });
          await submit(run, u, q.key, { v: think, c });
        });
        continue;
      }
      if (done.has(`play|${run}|${u}`)) continue;
      done.add(`play|${run}|${u}`);
      at(start, () => stillRunning(run) && be.set(`prog/${run}/${u}/go`, true));
      if (st.game === 'ten') {
        const v = 10000 + Math.round(rand(-1300, 1300));
        at(start + v, () => submit(run, u, 'res', { v }));
      } else if (st.game === 'iai') {
        const go = start + Number(st.iaiDelay || 0);
        if (Math.random() < 0.08) at(go - 300, () => submit(run, u, 'res', { v: 0, f: true }));
        else { const rt = Math.round(rand(200, 480)); at(go + rt, () => submit(run, u, 'res', { v: rt, f: false })); }
      } else if (st.game === 'tap') {
        const rate = rand(6, 10.5);
        for (let t = 500; t <= L.TAP_LIVE_UNTIL; t += 500) {
          at(start + t, () => stillRunning(run) && be.set(`live/${run}/${u}`, Math.floor((t / 1000) * rate)));
        }
        at(start + L.TAP_MS + 300, () => submit(run, u, 'res', { v: Math.floor((L.TAP_MS / 1000) * rate) }));
      }
    }
  }

  function tick() {
    const st = D.state;
    if (!D.config?.rehearsal || !st) { if (phaseKey) { clear(); phaseKey = ''; } return; }
    const k = `${st.phase}|${st.runId || ''}|${st.round}`;
    if (k !== phaseKey) { clear(); phaseKey = k; }
    if (st.phase === 'lobby') lobby(st);
    else if (st.phase === 'ready') ready(st);
    else if (st.phase === 'running') running(st);
  }

  return { tick, stop: clear };
}
