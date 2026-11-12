// EKZM TEAM BATTLE 2026 — 純粋ロジック（得点・順位・表示フォーマット）
// ブラウザと Node の両方から import できるよう、DOM や Firebase に依存しない。

export const TEAMS = ['A', 'B', 'C', 'D', 'E'];

export const TEAM_INFO = {
  A: { label: 'A', color: '#d9483b', text: '#ffffff', glow: 'rgba(217,72,59,.25)', name: '赤' },
  B: { label: 'B', color: '#e9b21c', text: '#112850', glow: 'rgba(233,178,28,.25)', name: '黄' },
  C: { label: 'C', color: '#1f9a55', text: '#ffffff', glow: 'rgba(31,154,85,.25)', name: '緑' },
  D: { label: 'D', color: '#2d63b0', text: '#ffffff', glow: 'rgba(45,99,176,.25)', name: '青' },
  E: { label: 'E', color: '#8a5bb0', text: '#ffffff', glow: 'rgba(138,91,176,.25)', name: '紫' },
};

export const POINTS = [100, 70, 50, 30, 10];
export const ROUND_GAMES = ['ten', 'quiz', 'iai', 'tap'];
export const DEFAULT_MULT = [1, 1, 1, 2];
export const TOTAL_ROUNDS = 4;

// ゲームごとの定数
export const TEN_TARGET = 10000;     // 目標 10 秒
export const TEN_VISIBLE = 3000;     // 最初の 3 秒だけタイマーを見せる
export const TEN_LIMIT = 30000;      // 30 秒で自動停止
export const IAI_MIN_DELAY = 2500;   // 「構え」から「斬れ」までの最短待機
export const IAI_MAX_DELAY = 6500;   // 最長待機
export const IAI_FOUL_MS = 100;      // 100ms 未満の反応は予測押し＝フライング扱い
export const IAI_LIMIT = 3000;       // 「斬れ」から 3 秒で時間切れ
export const TAP_MS = 7000;          // 連打時間
export const TAP_LIVE_UNTIL = 5000;  // 観戦画面の連打数は 5 秒まで公開（最後 2 秒は伏せる）
export const TAP_MAX = 250;          // 7 秒で物理的にありえない回数は弾く
export const QUIZ_LIMIT = 15000;     // 1 問の制限時間
export const QUIZ_DEFAULT_COUNT = 3;
export const QUIZ_MAX_COUNT = 5;
export const COUNTDOWN_MS = 4000;    // 3,2,1,START!

export const GAMES = {
  ten: {
    key: 'ten', num: '01', title: '10秒ぴったり', en: 'Just 10 Seconds', icon: '',
    rule: 'スタートと同時にタイマーが動き出す。最初の3秒だけ数字が見えて、あとは体内時計が頼り。ちょうど10秒だと思った瞬間にSTOPをタップ。10秒との誤差が小さい順に順位が決まる。',
    lead: '体内時計で、ちょうど10秒を当てるゲーム',
    howto: [
      '司会者の合図で、代表者のスマホに <b>3・2・1</b> のカウントダウンが出ます。',
      'スタートと同時にタイマーが動き出します。数字が見えるのは <b>最初の3秒だけ</b>。そのあとは「?.??」に変わります。',
      '心の中で数え続けて、<b>ちょうど10秒だと思った瞬間に「STOP」</b>をタップします。',
    ],
    judge: '10秒との誤差（ズレ）が小さい順。早すぎても遅すぎても同じ扱いです。',
    tips: '時計やほかの人のスマホを見るのはナシ。30秒たつと自動で止まります。',
    spec: '観戦画面にもタイマーが出ます（3秒以降は非表示）。誰がSTOPしたかは分かりますが、記録は結果発表まで秘密です。',
    mc: ['続いてのゲームは「10秒ぴったり」！', 'タイマーが見えるのは最初の3秒だけ。あとは体内時計で、ちょうど10秒だと思ったらSTOPです。'],
    mcGo: 'それではいきます。3・2・1、スタート！',
  },
  quiz: {
    key: 'quiz', num: '02', title: '早押しクイズ', en: 'Speed Quiz', icon: '',
    rule: '司会者が出題する4択クイズに代表者5人が同時に回答。正解数が多い順、同じ正解数なら「正解した問題の合計回答時間」が短い順。1問の制限時間は15秒。',
    lead: '4択クイズに、早く・正しく答えるゲーム',
    howto: [
      '司会者が問題を出すと、代表者のスマホに <b>問題と4つの選択肢</b> が出ます。',
      '正しいと思う選択肢をタップ。<b>回答は1問につき1回だけ</b>で、変更はできません。',
      '制限時間は <b>1問15秒</b>。司会者が正解を発表したら、次の問題へ進みます。',
    ],
    judge: '正解した数が多い順。正解数が同じなら、正解した問題の回答時間の合計が短い方が上位。間違い・時間切れは正解に数えません。',
    tips: '速さも大事。でも間違えると意味がないので、落ち着いて選びましょう。',
    spec: '観戦画面にも問題と選択肢が出ます。誰が回答したかは分かりますが、何を選んだかは結果発表まで秘密です。',
    mc: ['続いてのゲームは「早押しクイズ」！', '4択の問題に、代表者のみなさんが一斉に答えます。正解数が多いチームが上位、同じ数なら速い方が勝ちです。'],
    mcGo: 'それでは第1問！',
  },
  iai: {
    key: 'iai', num: '03', title: '居合斬りバトル', en: 'Iai Slash', icon: '',
    rule: '「構え…」のあと、ランダムな間をおいて「斬れ！」が出る。出た瞬間に画面をタップ（スワイプ不要）。反応速度をミリ秒で計測し、速い順に順位決定。「斬れ」より前のタップと100ms未満の反応はフライングで失格。',
    lead: '合図の瞬間に斬る、反射神経のゲーム',
    howto: [
      'カウントダウンのあと、画面に <b>「構え…」</b> と出ます。画面には触れずに待ちます。',
      'しばらくすると突然 <b>「斬れ！」</b> に変わります。待ち時間は毎回ランダムです。',
      '「斬れ！」が出た瞬間に、<b>画面のどこでもいいのでタップ</b>。スワイプはいりません。',
    ],
    judge: '「斬れ！」が出てからタップするまでの時間（ミリ秒）が短い順。',
    tips: '「構え…」の間に触るとフライングで失格（0点）。0.1秒より速い反応も「予測押し」としてフライング扱いです。',
    spec: '観戦画面にも「構え…」「斬れ！」が同時に出ます。勝負の結果は結果発表まで秘密です。',
    mc: ['続いてのゲームは「居合斬りバトル」！', '「構え…」のあと「斬れ！」が出た瞬間に画面をタップ。先に触るとフライングで失格です。'],
    mcGo: '静かに……構えてください。',
  },
  tap: {
    key: 'tap', num: '04', title: '7秒連打バトル', en: '7 Sec Rapid Tap', icon: '',
    rule: '7秒間でタップした回数を競う。回数が多い順に順位決定。観戦画面には連打数がリアルタイムで流れるけど、ラスト2秒は伏せ字。最終ゲームは得点2倍！',
    lead: '7秒間、とにかく連打するゲーム',
    howto: [
      'カウントダウンのあと、画面いっぱいの <b>「TAP!」ボタン</b> が押せるようになります。',
      '<b>7秒間、とにかく連打</b>。指を何本使ってもかまいません。',
      '7秒たつと自動で終わります。回数は自分の画面に出ます。',
    ],
    judge: 'タップした回数が多い順。',
    tips: '最終ゲームは得点2倍。逆転のチャンスです。',
    spec: '観戦画面に、各チームの連打数がリアルタイムで流れます。ただしラスト2秒は「？？？」で隠れます。',
    mc: ['いよいよ最終ゲーム「7秒連打バトル」！', '7秒間でタップした回数を競います。このゲームは得点2倍、逆転のチャンスです！'],
    mcGo: 'いきます。3・2・1、連打！',
  },
};

/** 全体のルール説明（参加画面・ヘルプで使用） */
export const OVERVIEW = {
  flow: [
    '<b>名前を入れてチームを選ぶ</b>（A〜Eの5チーム）',
    '待機画面で、<b>チームで相談して代表者を1人決める</b>。出る人が自分のスマホで「わたしが出る」を押します。',
    '代表者のスマホはゲーム画面に、それ以外の人は <b>観戦画面</b> に自動で切り替わります。',
    '<b>結果発表</b> はみんなのスマホに同時に出ます。これを4ゲームくり返して、合計点で総合優勝を決めます。',
  ],
  scoring: '各ゲームの順位で得点が入ります。同じ記録なら同じ順位・同じ得点（次の順位は飛ばします）。フライング・記録なしは0点。',
  notes: [
    '4ゲームで、チームの全員が1回ずつ代表になるのが目安です。',
    '画面を閉じても、同じスマホ・同じブラウザで開き直せば続きから参加できます。',
    'LINEなどのアプリでQRを開いた場合は、最後までそのアプリで開いてください（別のブラウザだと別人扱いになります）。',
    '効果音が出ます。マナーモードを解除すると盛り上がります。',
  ],
};

export const PHASE_LABEL = {
  lobby: '待機中', ready: '代表者発表', running: '対戦中', judging: '集計中', results: '結果発表', final: '総合結果',
};

/** 競技順位（同記録は同順位、次の順位は人数分飛ばす：1,1,3） */
export function competitionRanks(items, compare) {
  const sorted = [...items].sort(compare);
  let lastRank = 0;
  sorted.forEach((it, i) => {
    if (i > 0 && compare(sorted[i - 1], it) === 0) it.rank = sorted[i - 1].rank;
    else it.rank = i + 1;
    lastRank = it.rank;
  });
  return sorted;
}

/** 順位→得点（同順位は同得点、倍率適用） */
export function pointsForRank(rank, mult = 1) {
  if (!rank || rank < 1 || rank > POINTS.length) return 0;
  return POINTS[rank - 1] * (Number(mult) || 1);
}

const secs = (ms, d = 3) => (ms / 1000).toFixed(d);

/**
 * 提出データから各チームの成績行を作る（順位付け前）。
 * @param game  'ten'|'quiz'|'iai'|'tap'
 * @param reps  {A: uid, ...}
 * @param members {uid: {name, team}}
 * @param subs  {uid: {res: {v, f}, q0: {v, c}, ...}}
 * @param opts  {answers: [0..3], quizTotal}
 */
export function buildRows(game, reps, members, subs, opts = {}) {
  const rows = {};
  for (const team of TEAMS) {
    const uid = reps?.[team];
    if (!uid) continue;
    const name = members?.[uid]?.name ?? '（退出済み）';
    const s = subs?.[uid] || {};
    const row = { team, uid, name, status: 'none', metric: null, detail: '記録なし' };
    if (game === 'quiz') {
      const answers = opts.answers || [];
      const total = opts.quizTotal || answers.length;
      let correct = 0, time = 0, answered = 0;
      for (let i = 0; i < total; i++) {
        const a = s['q' + i];
        if (!a) continue;
        answered++;
        if (Number(a.c) === Number(answers[i]) && Number(a.c) >= 0) { correct++; time += Math.max(0, Math.round(Number(a.v) || 0)); }
      }
      row.status = 'ok';
      row.metric = { correct, time };
      row.detail = `${correct}/${total}問正解` + (correct ? `・正解合計 ${secs(time, 2)}秒` : '') + (answered < total ? `（未回答${total - answered}）` : '');
    } else if (s.res && Number.isFinite(Number(s.res.v))) {
      const v = Math.round(Number(s.res.v));
      if (game === 'ten') {
        const diff = Math.abs(v - TEN_TARGET);
        row.status = 'ok';
        row.metric = diff;
        const sign = v >= TEN_TARGET ? '+' : '−';
        row.detail = `${secs(v)}秒（誤差 ${sign}${secs(diff)}秒）`;
      } else if (game === 'iai') {
        if (s.res.f === true || v < IAI_FOUL_MS) {
          row.status = 'foul';
          row.detail = s.res.f === true ? 'フライング（失格）' : `反応${v}ms＝予測押し（失格）`;
        } else {
          row.status = 'ok';
          row.metric = v;
          row.detail = v >= IAI_LIMIT ? '時間切れ（3秒）' : `反応 ${secs(v)}秒`;
        }
      } else if (game === 'tap') {
        const n = Math.min(TAP_MAX, Math.max(0, v));
        row.status = 'ok';
        row.metric = n;
        row.detail = `${n}回`;
      }
    }
    rows[team] = row;
  }
  return rows;
}

export function compareFor(game) {
  if (game === 'quiz') return (a, b) => (b.metric.correct - a.metric.correct) || (a.metric.time - b.metric.time);
  if (game === 'tap') return (a, b) => b.metric - a.metric;
  return (a, b) => a.metric - b.metric; // ten: 誤差、iai: 反応時間（小さいほど良い）
}

/**
 * 成績行に順位と得点を付ける。
 * overrides: {team: 'auto'|'1'..'5'|'dq'} 管理者による手動修正
 */
export function rankRows(game, rows, mult = 1, overrides = {}) {
  const list = Object.values(rows).map(r => ({ ...r }));
  const valid = list.filter(r => r.status === 'ok');
  competitionRanks(valid, compareFor(game));
  for (const r of list) {
    if (r.status !== 'ok') r.rank = null;
    r.autoRank = r.rank;
    const o = overrides?.[r.team];
    if (o === 'dq') { r.rank = null; r.manual = true; }
    else if (o && o !== 'auto') { r.rank = Number(o); r.manual = true; }
    r.pts = pointsForRank(r.rank, mult);
  }
  const out = {};
  for (const r of list) out[r.team] = r;
  return out;
}

/** 表示用：順位の良い順（順位なしは最後） */
export function orderRows(rows) {
  return Object.values(rows || {}).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.team.localeCompare(b.team));
}

/** 累計得点 */
export function computeTotals(results, adjust) {
  const totals = {};
  for (const t of TEAMS) totals[t] = Number(adjust?.[t] || 0);
  for (const r of Object.values(results || {})) {
    if (!r || !r.rows) continue;
    for (const [t, row] of Object.entries(r.rows)) if (t in totals) totals[t] += Number(row.pts || 0);
  }
  return totals;
}

/** 総合順位（同点は同順位） */
export function overallRanking(totals) {
  const items = TEAMS.map(team => ({ team, pts: Number(totals?.[team] || 0) }));
  return competitionRanks(items, (a, b) => b.pts - a.pts).sort((a, b) => a.rank - b.rank || a.team.localeCompare(b.team));
}

/** 文字列の正規化（名前入力） */
export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

/** Firebase は配列をオブジェクトで返すことがあるため、どちらでも配列にそろえる */
export function arr(x) {
  if (Array.isArray(x)) return x.filter(v => v !== undefined);
  if (!x || typeof x !== 'object') return [];
  return Object.keys(x).sort((a, b) => Number(a) - Number(b)).map(k => x[k]);
}

export function randomInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
