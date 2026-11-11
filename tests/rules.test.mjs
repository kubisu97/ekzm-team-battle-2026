import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateWrite, evaluateRead } from './rules-engine.mjs';

const RULES = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url))).rules;
const ADMIN = 'uBDBPDOsN9OphJoSg1KHAIXonSA2';
const TS = { '.sv': 'timestamp' };
const auth = uid => (uid ? { uid, token: { firebase: { sign_in_provider: uid === ADMIN ? 'password' : 'anonymous' } } } : null);

let db = {};
function w(uid, updates) { const r = evaluateWrite(RULES, db, updates, auth(uid)); if (r.ok) db = r.newRoot; return r; }
const ok = (r, msg) => assert.equal(r.ok, true, msg + ' :: ' + r.reason);
const ng = (r, msg) => assert.equal(r.ok, false, msg + ' (should be denied)');
const join = (uid, name, team, slot) => w(uid, { [`members/${uid}`]: { name, team, slot, at: TS }, [`slots/${team}/${slot}`]: uid });

test('初期化と参加登録', () => {
  ng(w('u1', { state: { phase: 'lobby' } }), '参加者は state を初期化できない');
  ng(w(null, { 'members/x': { name: 'x', team: 'A', slot: '0', at: TS } }), '未ログインは書けない');
  ok(w(ADMIN, { state: { round: 1, game: 'ten', phase: 'lobby', mult: 1, startAt: 0, updatedAt: TS }, config: { regOpen: true, teamCap: 2, slots: { 0: true, 1: true } } }), '管理者の初期化');
  ok(join('u1', 'いち', 'A', '0'), '参加');
  ng(join('u2', 'に', 'A', '0'), '同じ枠は取れない');
  ok(join('u2', 'に', 'A', '1'), '空き枠');
  ng(join('u3', 'さん', 'A', '2'), '定員外の枠');
  ng(w('u1', { 'members/u1/team': 'B' }), '登録後のチーム変更不可');
  ng(w('u1', { 'slots/B/0': 'u1' }), '2つ目の枠は取れない');
  ng(w('u3', { 'members/u3': { name: 'さん', team: 'B', slot: '0', at: TS } }), '枠なしで登録はできない');
  ng(w('u3', { 'slots/B/0': 'u3' }), '登録なしで枠だけ取れない');
  ng(w('u3', { 'members/u3': { name: '', team: 'B', slot: '0', at: TS }, 'slots/B/0': 'u3' }), '空の名前');
  ng(w('u3', { 'members/u3': { name: 'x', team: 'F', slot: '0', at: TS }, 'slots/F/0': 'u3' }), 'F チームはない');
  ng(w('u3', { 'members/u3': { name: 'x', team: 'B', slot: '0', at: TS, admin: true }, 'slots/B/0': 'u3' }), '余計な項目');
  ok(join('u3', 'さん', 'B', '0'), 'B に参加');
  ok(join('u4', 'よん', 'C', '0'), 'C に参加');
  ok(w(ADMIN, { 'config/regOpen': false }), '受付締切');
  ng(join('u5', 'ご', 'D', '0'), '締切後は登録不可');
  ng(w('u1', { members: null }), '一覧削除不可');
  ok(w(ADMIN, { 'members/u4': null, 'slots/C/0': null }), '管理者は削除できる');
  ok(w(ADMIN, { 'config/regOpen': true }), '再開');
  ok(join('u4', 'よん', 'C', '0'), '再登録');
  assert.equal(evaluateRead(RULES, db, 'members', auth('u1')), true);
  assert.equal(evaluateRead(RULES, db, 'members', auth(null)), false);
});

test('チーム内での代表者決め（pick）', () => {
  ok(w('u1', { 'pick/A': 'u1' }), '自分のチームに自分を立候補');
  ok(w('u2', { 'pick/A': 'u2' }), '同じチームの別の人に交代');
  ng(w('u1', { 'pick/A': null }), '他人の立候補は取り消せない');
  ok(w('u2', { 'pick/A': null }), '本人は辞退できる');
  ng(w('u1', { 'pick/B': 'u1' }), '他チームには立候補できない');
  ng(w('u1', { 'pick/A': 'u2' }), '他人を勝手に指名できない');
  ng(w('u3', { 'pick/A': 'u3' }), 'Bチームの人はAの代表になれない');
  ng(w(ADMIN, { 'pick/A': 'u3' }), '管理者でも他チームの人は指定できない');
  ok(w(ADMIN, { 'pick/B': 'u3' }), '管理者は緊急指定できる');
  ok(w('u1', { 'pick/A': 'u1' }), '再立候補');
  ok(w(ADMIN, { 'state/phase': 'ready' }), '発表');
  ng(w('u2', { 'pick/A': 'u2' }), '発表後は変更不可');
  ok(w(ADMIN, { 'state/phase': 'lobby', pick: null }), '戻す');
});

test('代表者・提出・二重送信', () => {
  ok(w(ADMIN, { 'state/phase': 'ready', 'state/runId': 'run1', 'state/reps': { A: 'u1', B: 'u3' }, 'state/repOf': { u1: 'A', u3: 'B' } }), '代表者発表');
  ng(w('u2', { 'state/reps/A': 'u2' }), '参加者は代表を変えられない');
  ok(w('u1', { 'prog/run1/u1/ok': true }), '準備OK');
  ng(w('u2', { 'prog/run1/u2/ok': true }), '代表外は準備OK不可');
  ng(w('u1', { 'prog/run1/u1/go': true }), 'ready 中は go 不可');
  ng(w('u1', { 'subs/run1/u1/res': { v: 10000, at: TS }, 'prog/run1/u1/res': true }), 'running 前は提出不可');
  ok(w(ADMIN, { 'state/phase': 'running', 'state/startAt': Date.now() }), 'スタート');
  ok(w('u1', { 'prog/run1/u1/go': true }), 'go');
  ng(w('u1', { 'prog/run1/u1/go': true }), 'go 二重');
  ng(w('u1', { 'subs/run0/u1/res': { v: 10000, at: TS } }), '別ラウンドの提出不可');
  ng(w('u2', { 'subs/run1/u2/res': { v: 10000, at: TS }, 'prog/run1/u2/res': true }), '代表外は提出不可');
  ng(w('u1', { 'subs/run1/u3/res': { v: 10000, at: TS } }), '他人の提出不可');
  ng(w('u1', { 'subs/run1/u1/res': { v: 10000, at: 1 } }), 'at はサーバー時刻');
  ng(w('u1', { 'subs/run1/u1/res': { v: -5, at: TS } }), '負の値');
  ng(w('u1', { 'subs/run1/u1/res': { v: 10000, at: TS, cheat: 1 } }), '余計な項目');
  ng(w('u1', { 'subs/run1/u1/q0': { v: 1000, c: 1, at: TS } }), 'クイズ以外で q0 不可');
  ok(w('u1', { 'subs/run1/u1/res': { v: 10012, at: TS }, 'prog/run1/u1/res': true }), '提出');
  ng(w('u1', { 'subs/run1/u1/res': { v: 10000, at: TS }, 'prog/run1/u1/res': true }), '二重送信');
  ng(w('u1', { 'subs/run1/u1/res/v': 10000 }), '提出後の書き換え');
  ng(w('u1', { 'results/r1': { rows: { A: { pts: 100 } } } }), '得点の書き込み不可');
  ng(w('u1', { 'adjust/A': 100 }), '調整点の書き込み不可');
  ng(w('u1', { 'live/run1/u1': 5 }), 'tap 以外で live 不可');
  assert.equal(evaluateRead(RULES, db, 'subs/run1/u1', auth('u1')), true, '自分の記録は読める');
  assert.equal(evaluateRead(RULES, db, 'subs/run1/u1', auth('u3')), false, '他人の記録は読めない');
  assert.equal(evaluateRead(RULES, db, 'subs', auth('u3')), false);
  assert.equal(evaluateRead(RULES, db, 'subs', auth(ADMIN)), true);
  assert.equal(evaluateRead(RULES, db, 'prog/run1', auth('u2')), true);
  ok(w(ADMIN, { 'state/phase': 'judging' }), '集計');
  ng(w('u3', { 'subs/run1/u3/res': { v: 10000, at: TS }, 'prog/run1/u3/res': true }), '締切後の提出不可');
  ok(w(ADMIN, { 'results/r1': { round: 1, game: 'ten', mult: 1, runId: 'run1', rows: { A: { team: 'A', uid: 'u1', name: 'いち', rank: 1, pts: 100, detail: 'x', status: 'ok', manual: false } }, publishedAt: TS }, 'used/u1/r1': 'ten', 'state/phase': 'results' }), '結果発表');
  ok(w(ADMIN, { 'subs/run1/u1': null, 'prog/run1/u1/go': null, 'prog/run1/u1/res': null }), '再挑戦許可（管理者）');
});

test('連打のライブ値', () => {
  ok(w(ADMIN, { state: { round: 4, game: 'tap', phase: 'running', mult: 2, runId: 'run4', reps: { A: 'u1' }, repOf: { u1: 'A' }, startAt: Date.now(), updatedAt: TS } }), 'tap 開始');
  ok(w('u1', { 'live/run4/u1': 10 }), 'live');
  ok(w('u1', { 'live/run4/u1': 25 }), 'live 増加');
  ng(w('u1', { 'live/run4/u1': 20 }), 'live 減少不可');
  ng(w('u1', { 'live/run4/u1': 300 }), 'live 上限');
  ng(w('u2', { 'live/run4/u2': 5 }), '代表外 live 不可');
  ng(w('u1', { 'subs/run4/u1/res': { v: 400, at: TS } }), 'tap は 250 回まで');
  ok(w('u1', { 'subs/run4/u1/res': { v: 88, at: TS }, 'prog/run4/u1/res': true }), 'tap 提出');
});

test('クイズ：出題中の問題だけ回答可能', () => {
  ok(w(ADMIN, { state: { round: 2, game: 'quiz', phase: 'running', mult: 1, runId: 'run2', reps: { A: 'u1', B: 'u3' }, repOf: { u1: 'A', u3: 'B' }, startAt: Date.now(), quiz: { total: 3, idx: -1, open: false }, updatedAt: TS } }), 'クイズ開始');
  ng(w('u1', { 'subs/run2/u1/q0': { v: 1000, c: 1, at: TS } }), '出題前は回答不可');
  ok(w(ADMIN, { 'state/quiz': { total: 3, idx: 0, key: 'q0', open: true, at: Date.now(), q: { text: 'Q', choices: ['a', 'b', 'c', 'd'] } } }), '第1問');
  ng(w('u1', { 'subs/run2/u1/res': { v: 1000, at: TS } }), 'クイズで res 不可');
  ng(w('u1', { 'subs/run2/u1/q1': { v: 1000, c: 1, at: TS } }), '次の問題には回答不可');
  ng(w('u1', { 'subs/run2/u1/q0': { v: 1000, c: 7, at: TS } }), '選択肢は0-3');
  ok(w('u1', { 'subs/run2/u1/q0': { v: 1234, c: 2, at: TS }, 'prog/run2/u1/q0': true }), '回答');
  ng(w('u1', { 'subs/run2/u1/q0': { v: 900, c: 1, at: TS } }), '回答の変更不可');
  ok(w('u3', { 'prog/run2/u3/g0': true }), '表示フラグ');
  ok(w(ADMIN, { 'state/quiz/open': false, 'state/quiz/reveal': 2 }), '正解発表');
  ng(w('u3', { 'subs/run2/u3/q0': { v: 1000, c: 2, at: TS }, 'prog/run2/u3/q0': true }), '締切後は回答不可');
  assert.equal(evaluateRead(RULES, db, 'quizBank', auth('u1')), false, '問題集は読めない');
  assert.equal(evaluateRead(RULES, db, 'adminOnly', auth('u1')), false);
  assert.equal(evaluateRead(RULES, db, 'quizBank', auth(ADMIN)), true);
});

test('在席表示', () => {
  ok(w('u1', { 'online/u1': TS }), '自分の在席');
  ng(w('u1', { 'online/u2': TS }), '他人の在席不可');
  assert.equal(evaluateRead(RULES, db, 'online', auth('u1')), false);
  ok(w(ADMIN, { online: null }), '管理者は消せる');
});
