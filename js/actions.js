// 参加者側の書き込み処理（参加画面とテスト用ボットで共通利用）
import { TEAMS, cleanName } from './logic.js?v=3';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** チームに参加（空き枠を予約して名前を登録）。ルールでチーム定員を強制している。 */
export async function joinTeam(be, rawName, team) {
  const uid = be.uid();
  const name = cleanName(rawName);
  if (!uid) throw new Error('接続準備中です。数秒後にもう一度押してね');
  if (!name) throw new Error('名前を入力してね');
  if (!TEAMS.includes(team)) throw new Error('チームを選んでね');
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const [config, slots] = await Promise.all([be.get('config'), be.get('slots/' + team)]);
    if (!config?.regOpen) throw new Error('参加受付は締め切られています。司会者に声をかけてね');
    const allowed = Object.keys(config.slots || {}).filter(k => config.slots[k] === true).sort((a, b) => a - b);
    const free = allowed.filter(n => !(slots && slots[n]));
    if (!free.length) throw new Error(`${team}チームは満員です（定員${allowed.length}名）`);
    const n = free[Math.min(free.length - 1, attempt ? Math.floor(Math.random() * free.length) : 0)];
    try {
      await be.update({
        [`members/${uid}`]: { name, team, slot: String(n), at: be.TS },
        [`slots/${team}/${n}`]: uid,
      });
      return { name, team, slot: String(n) };
    } catch (e) {
      lastErr = e; // 同時に同じ枠を取り合った場合など → 少し待って再挑戦
      await sleep(250 + Math.random() * 500);
    }
  }
  throw lastErr || new Error('参加登録に失敗しました');
}

/** 計測結果の送信（同じラウンド・同じ問題は1回だけ。2回目はルールで拒否される） */
export function submitResult(be, runId, key, payload) {
  const uid = be.uid();
  return be.update({
    [`subs/${runId}/${uid}/${key}`]: { ...payload, at: be.TS },
    [`prog/${runId}/${uid}/${key}`]: true,
  });
}

/** 進行フラグ（ok=準備OK, go=開始した, g0..=問題を表示した） */
export function markProg(be, runId, key) {
  return be.set(`prog/${runId}/${be.uid()}/${key}`, true).catch(() => {});
}

/** 連打数のライブ送信（観戦用） */
export function sendLive(be, runId, n) {
  return be.set(`live/${runId}/${be.uid()}`, n).catch(() => {});
}

/** 接続中の表示（管理画面用） */
export function startPresence(be) {
  const uid = be.uid();
  if (!uid) return () => {};
  return be.onConnected(c => {
    if (!c) return;
    be.onDisconnectRemove(`online/${uid}`)?.catch?.(() => {});
    be.set(`online/${uid}`, be.TS).catch(() => {});
  });
}
