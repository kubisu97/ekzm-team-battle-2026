import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const members = { a: { name: 'A子', team: 'A' }, b: { name: 'B男', team: 'B' }, c: { name: 'C太', team: 'C' }, d: { name: 'D美', team: 'D' }, e: { name: 'E吉', team: 'E' } };
const reps = { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' };

test('10秒：誤差の小さい順、同誤差は同順位・同得点、次は飛ばす', () => {
  const subs = { a: { res: { v: 10050 } }, b: { res: { v: 9950 } }, c: { res: { v: 10500 } }, d: { res: { v: 11000 } }, e: { res: { v: 8000 } } };
  const r = L.rankRows('ten', L.buildRows('ten', reps, members, subs), 1);
  assert.equal(r.A.rank, 1); assert.equal(r.B.rank, 1);
  assert.equal(r.A.pts, 100); assert.equal(r.B.pts, 100);
  assert.equal(r.C.rank, 3); assert.equal(r.C.pts, 50);
  assert.equal(r.D.rank, 4); assert.equal(r.D.pts, 30);
  assert.equal(r.E.rank, 5); assert.equal(r.E.pts, 10);
  assert.match(r.A.detail, /誤差 \+0\.050秒/);
  assert.match(r.B.detail, /誤差 −0\.050/);
});

test('10秒：記録なしは順位なし0点', () => {
  const subs = { a: { res: { v: 10001 } } };
  const r = L.rankRows('ten', L.buildRows('ten', reps, members, subs), 1);
  assert.equal(r.A.rank, 1); assert.equal(r.A.pts, 100);
  assert.equal(r.B.rank, null); assert.equal(r.B.pts, 0); assert.equal(r.B.detail, '記録なし');
});

test('居合：フライング・100ms未満は失格0点、速い順', () => {
  const subs = { a: { res: { v: 250, f: false } }, b: { res: { v: 0, f: true } }, c: { res: { v: 80, f: false } }, d: { res: { v: 210, f: false } }, e: { res: { v: 3000, f: false } } };
  const r = L.rankRows('iai', L.buildRows('iai', reps, members, subs), 1);
  assert.equal(r.D.rank, 1); assert.equal(r.A.rank, 2); assert.equal(r.E.rank, 3);
  assert.equal(r.B.status, 'foul'); assert.equal(r.B.pts, 0);
  assert.equal(r.C.status, 'foul'); assert.equal(r.C.pts, 0);
  assert.equal(r.E.pts, 50);
});

test('連打：多い順・同数は同順位、2倍', () => {
  const subs = { a: { res: { v: 60 } }, b: { res: { v: 72 } }, c: { res: { v: 72 } }, d: { res: { v: 55 } }, e: { res: { v: 999 } } };
  const r = L.rankRows('tap', L.buildRows('tap', reps, members, subs), 2);
  assert.equal(r.E.rank, 1); assert.equal(r.E.pts, 200); // 999 は 250 に丸め
  assert.equal(r.B.rank, 2); assert.equal(r.C.rank, 2); assert.equal(r.B.pts, 140); assert.equal(r.C.pts, 140);
  assert.equal(r.A.rank, 4); assert.equal(r.A.pts, 60);
  assert.equal(r.D.rank, 5); assert.equal(r.D.pts, 20);
});

test('クイズ：正解数→正解時間合計、誤答は下位、全問誤答同士は同順位', () => {
  const answers = [0, 2, 1];
  const subs = {
    a: { q0: { v: 3000, c: 0 }, q1: { v: 4000, c: 2 }, q2: { v: 5000, c: 1 } }, // 3問 12.0s
    b: { q0: { v: 1000, c: 0 }, q1: { v: 1000, c: 2 }, q2: { v: 1000, c: 3 } }, // 2問 2.0s
    c: { q0: { v: 2000, c: 0 }, q1: { v: 9000, c: 2 }, q2: { v: 9000, c: 1 } }, // 3問 20s
    d: { q0: { v: 500, c: 1 }, q1: { v: 500, c: 1 } },                           // 0問
    e: {},                                                                        // 未回答
  };
  const r = L.rankRows('quiz', L.buildRows('quiz', reps, members, subs, { answers, quizTotal: 3 }), 1);
  assert.equal(r.A.rank, 1); assert.equal(r.C.rank, 2); assert.equal(r.B.rank, 3);
  assert.equal(r.D.rank, 4); assert.equal(r.E.rank, 4); assert.equal(r.D.pts, 30); assert.equal(r.E.pts, 30);
  assert.match(r.D.detail, /0\/3問正解/);
});

test('管理者の手動修正（順位指定・失格）', () => {
  const subs = { a: { res: { v: 10000 } }, b: { res: { v: 10100 } } };
  const r = L.rankRows('ten', L.buildRows('ten', { A: 'a', B: 'b' }, members, subs), 1, { A: 'dq', B: '1' });
  assert.equal(r.A.pts, 0); assert.equal(r.A.rank, null); assert.equal(r.B.rank, 1); assert.equal(r.B.pts, 100);
});

test('累計と総合順位（同点は同順位）', () => {
  const results = {
    r1: { rows: { A: { pts: 100 }, B: { pts: 70 }, C: { pts: 50 }, D: { pts: 30 }, E: { pts: 10 } } },
    r2: { rows: { A: { pts: 10 }, B: { pts: 30 }, C: { pts: 50 }, D: { pts: 70 }, E: { pts: 100 } } },
  };
  const totals = L.computeTotals(results, { E: 5 });
  assert.deepEqual(totals, { A: 110, B: 100, C: 100, D: 100, E: 115 });
  const rk = L.overallRanking(totals);
  assert.equal(rk[0].team, 'E'); assert.equal(rk[0].rank, 1);
  assert.equal(rk[1].team, 'A'); assert.equal(rk[1].rank, 2);
  assert.deepEqual(rk.slice(2).map(x => x.rank), [3, 3, 3]);
});

test('名前の正規化', () => {
  assert.equal(L.cleanName('  <b>くりす</b>  '), 'bくりす/b');
  assert.equal(L.cleanName('a'.repeat(30)).length, 16);
});
