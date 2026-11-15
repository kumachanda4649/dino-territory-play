/* 恐竜なわばりカード: 規則エンジン。ブラウザ(DinoEngine)と Node(require)の両方で動く。
   局面(state)は素のデータだけで出来ていて、clone で丸ごと写せる。乱数の状態も局面の中(rs)にある。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DinoEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ROWS = 3, COLS = 5, N = ROWS * COLS;
  var HAND0 = 4;               // 最初の手札
  var MAX_FEET = 3;            // 足あとの上限
  var CARDS = {};              // id -> カード定義(cards.js が registerCards で入れる)

  // 上下左右のとなり
  var NEIGH = [];
  (function () {
    for (var i = 0; i < N; i++) {
      var r = (i / COLS) | 0, c = i % COLS, a = [];
      if (r > 0) a.push(i - COLS);
      if (r < ROWS - 1) a.push(i + COLS);
      if (c > 0) a.push(i - 1);
      if (c < COLS - 1) a.push(i + 1);
      NEIGH.push(a);
    }
  })();

  function registerCards(list) { list.forEach(function (c) { CARDS[c.id] = c; }); }

  // 乱数(mulberry32)。holder.rs に状態を持つ
  function nextRand(holder) {
    var a = (holder.rs + 0x6D2B79F5) | 0;
    holder.rs = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function makeRng(seed) { var h = { rs: seed | 0 }; return function () { return nextRand(h); }; }
  function shuffle(a, rand) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function draw(s, p) {
    if (!s.decks[p].length) return false;
    s.hands[p].push(s.decks[p].pop());
    return true;
  }

  /* cfg: { seed, decks:[ids, ids], opts, first(0/1/省略でくじ), preshuffled }
     opts: scoring 'sum'(勝った列の合計) | 'lanes'(取った列の数)、land / herdHunt / growth は恐竜の要素の入り切り */
  function newGame(cfg) {
    var s = {
      opts: { scoring: 'sum', land: false, herdHunt: false, growth: false, comp: 'none', rescue: 0 },
      rs: (cfg.seed | 0) || 1,
      cells: [], hands: [[], []], decks: [null, null],
      deckLists: [cfg.decks[0].slice(), cfg.decks[1].slice()],
      played: [[], []],
      turn: 0, first: 0, turnsTaken: [0, 0], passes: 0, over: false,
      phase: 'mulligan', mull: [false, false], grown: [false, false], rescued: [0, 0], ply: 0, last: null,
      caps: [0, 0], bigs: [0, 0]   // 課題用の記録: 奪ったマスの数、重さ3をもとの大きさで置いた回数
    };
    var k, p, i;
    if (cfg.opts) for (k in cfg.opts) s.opts[k] = cfg.opts[k];
    var rand = function () { return nextRand(s); };
    for (p = 0; p < 2; p++) {
      s.decks[p] = cfg.decks[p].slice();
      if (!cfg.preshuffled) shuffle(s.decks[p], rand);
    }
    s.first = (cfg.first === 0 || cfg.first === 1) ? cfg.first : (rand() < 0.5 ? 0 : 1);
    s.turn = s.first;
    for (i = 0; i < N; i++) s.cells.push({ o: -1, f: 0, c: null });
    for (var r = 0; r < ROWS; r++) {
      s.cells[r * COLS].o = 0; s.cells[r * COLS].f = 1;
      s.cells[r * COLS + COLS - 1].o = 1; s.cells[r * COLS + COLS - 1].f = 1;
    }
    for (p = 0; p < 2; p++) for (i = 0; i < HAND0; i++) draw(s, p);
    return s;
  }

  // 引き直し(1回だけ)。idxs は手札の位置。先に引いてから、戻した札を山に混ぜる
  function mulligan(s, p, idxs) {
    if (s.phase !== 'mulligan' || s.mull[p]) return;
    var back = [], keep = [];
    s.hands[p].forEach(function (id, i) { (idxs.indexOf(i) >= 0 ? back : keep).push(id); });
    s.hands[p] = keep;
    for (var i = 0; i < back.length; i++) draw(s, p);
    if (back.length) {
      s.decks[p] = s.decks[p].concat(back);
      shuffle(s.decks[p], function () { return nextRand(s); });
    }
    s.mull[p] = true;
    if (s.mull[0] && s.mull[1]) {
      s.phase = 'play';
      // 後手への補正(opts.comp): 'card' = 1枚多く引く、'feet' = 中央の列の足あとを2にする
      var second = 1 - s.first;
      if (s.opts.comp === 'card') draw(s, second);
      else if (s.opts.comp === 'feet') s.cells[COLS + (second === 0 ? 0 : COLS - 1)].f = 2;
      else if (s.opts.comp === 'side') s.cells[(second === 0 ? 0 : COLS - 1)].f = 2;   // 森の列だけ2にする(弱めの補正)
      else if (s.opts.comp === 'both') { s.cells[(second === 0 ? 0 : COLS - 1)].f = 2; draw(s, second); }
    }
  }

  function hasFriendHerb(s, i, owner) {
    var nb = NEIGH[i];
    for (var j = 0; j < nb.length; j++) {
      var k = s.cells[nb[j]].c;
      if (k && k.o === owner && CARDS[k.id].diet === 'herb') return true;
    }
    return false;
  }

  // 盤面にあるカードの、いまの大きさ
  function sizeAt(s, i) {
    var k = s.cells[i].c;
    if (!k) return 0;
    var cd = CARDS[k.id], v = cd.size + k.mod;
    if (s.opts.land && cd.land === ((i / COLS) | 0)) v += 1;
    if (s.opts.herdHunt && cd.diet === 'herb' && hasFriendHerb(s, i, k.o)) v += 1;
    return v < 1 ? 1 : v;
  }

  // カードを i に置いた時に足あとが付くマス(盤の外は除く。カードのあるマスも含めて返す)
  function patternTargets(p, i, id) {
    var pat = CARDS[id].pat, r = (i / COLS) | 0, c = i % COLS, dir = p === 0 ? 1 : -1, out = [];
    for (var j = 0; j < pat.length; j++) {
      var cc = c + pat[j][0] * dir, rr = r + pat[j][1];
      if (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS) out.push(rr * COLS + cc);
    }
    return out;
  }

  function nextToOwnCard(s, i, p) {
    var nb = NEIGH[i];
    for (var j = 0; j < nb.length; j++) {
      var k = s.cells[nb[j]].c;
      if (k && k.o === p) return true;
    }
    return false;
  }

  // 打てる手。同じカードが手札に2枚あっても1回だけ数える。最後は必ずパス
  function legalMoves(s, p) {
    var moves = [], seen = {}, hand = s.hands[p];
    if (s.over || s.phase !== 'play') return moves;
    for (var h = 0; h < hand.length; h++) {
      var id = hand[h];
      if (seen[id]) continue;
      seen[id] = 1;
      var cd = CARDS[id];
      for (var i = 0; i < N; i++) {
        var cell = s.cells[i];
        if (cell.c) {
          if (s.opts.growth && cd.ab === 'grow' && !s.grown[p] && cell.c.o === p && sizeAt(s, i) <= 2) {
            moves.push({ t: 'grow', id: id, i: i });
          }
          continue;
        }
        if (cell.o === p) {
          if (cell.f >= cd.w) moves.push({ t: 'place', id: id, i: i });
          // 二段構えの札(alt): 足あとが足りなくても、alt.w 以上あれば小さく置ける
          else if (cd.alt && cell.f >= cd.alt.w) moves.push({ t: 'place', id: id, i: i, small: true });
        }
      }
    }
    // 足ぶみ: 置ける手が1つも無く、手札がある時だけ(1試合に opts.rescue 回まで)。
    // 自分のカードのとなりのマスか、自分の足あとのあるマスに、足あとを1つ付ける
    if (!moves.length && hand.length && s.opts.rescue && s.rescued[p] < s.opts.rescue) {
      for (var q = 0; q < N; q++) {
        var rc = s.cells[q];
        if (rc.c) continue;
        if (rc.o === p ? rc.f < MAX_FEET : nextToOwnCard(s, q, p)) moves.push({ t: 'rescue', i: q });
      }
    }
    moves.push({ t: 'pass' });
    return moves;
  }

  // 手を打つ(局面を書き換える)。s.last に、画面の演出用の情報を残す
  function applyMove(s, m) {
    var p = s.turn, info = { p: p, move: m, gained: [], captured: [], hunted: -1, drew: false };
    if (m.t === 'pass') {
      s.passes++;
    } else if (m.t === 'rescue') {
      var rcell = s.cells[m.i];
      if (rcell.c) throw new Error('足ぶみできないマス: ' + m.i);
      if (rcell.o === p) { if (rcell.f < MAX_FEET) rcell.f++; }
      else { if (rcell.o === 1 - p) info.captured.push(m.i); rcell.o = p; rcell.f = 1; }
      info.gained.push(m.i);
      s.rescued[p]++;
      s.passes = 0;
    } else {
      var h = s.hands[p].indexOf(m.id);
      if (h < 0) throw new Error('手札にないカード: ' + m.id);
      s.hands[p].splice(h, 1);
      s.played[p].push(m.id);
      var cell = s.cells[m.i], cd = CARDS[m.id];
      if (m.t === 'grow') {
        if (!cell.c || cell.c.o !== p) throw new Error('成長できないマス');
        cell.c = { id: m.id, o: p, mod: 0 };
        s.grown[p] = true;
      } else {
        var small = cell.f < cd.w;
        if (cell.c || cell.o !== p || (small && !(cd.alt && cell.f >= cd.alt.w))) throw new Error('置けないマス: ' + m.i);
        cell.c = { id: m.id, o: p, mod: small ? cd.alt.size - cd.size : 0 };   // 小さく置いた時は alt.size になる
        info.small = small;
        cell.f = 0;
        var tg = patternTargets(p, m.i, m.id);
        for (var j = 0; j < tg.length; j++) {
          var t = s.cells[tg[j]];
          if (t.c) continue;                       // カードのあるマスには付かない
          if (t.o === p) { if (t.f < MAX_FEET) { t.f++; info.gained.push(tg[j]); } }
          else { if (t.o === 1 - p) info.captured.push(tg[j]); t.o = p; t.f = 1; info.gained.push(tg[j]); }
        }
        if (s.opts.herdHunt && cd.ab === 'hunt') {   // 狩り: となりの相手の草食のうち、いちばん大きい1枚を -2
          var nb = NEIGH[m.i], best = -1, bestV = 0;
          for (j = 0; j < nb.length; j++) {
            var k = s.cells[nb[j]].c;
            if (k && k.o === 1 - p && CARDS[k.id].diet === 'herb') {
              var v = sizeAt(s, nb[j]);
              if (v > bestV) { bestV = v; best = nb[j]; }
            }
          }
          if (best >= 0) { s.cells[best].c.mod -= 2; info.hunted = best; }
        }
      }
      s.passes = 0;
    }
    s.caps[p] += info.captured.length;
    if (m.t === 'place' && CARDS[m.id].w >= 3 && !info.small) s.bigs[p]++;
    s.turnsTaken[p]++;
    s.ply++;
    s.last = info;
    if (s.passes >= 2) { s.over = true; return s; }
    s.turn = 1 - p;
    // 2回目の番からは、番の最初に1枚引く
    if (s.turnsTaken[s.turn] >= 1) info.drew = draw(s, s.turn);
    return s;
  }

  /* 得点。tot[列][人] = 大きさの合計、lanes[列] = 取った人(-1 は同点)、
     pts = 得点方式に応じた点、sum = 大きさの総計、winner = 0/1/-1(引き分け) */
  function score(s) {
    var tot = [[0, 0], [0, 0], [0, 0]], i, r;
    for (i = 0; i < N; i++) {
      var k = s.cells[i].c;
      if (k) tot[(i / COLS) | 0][k.o] += sizeAt(s, i);
    }
    var lanes = [], pts = [0, 0], sum = [0, 0], won = [0, 0];
    for (r = 0; r < ROWS; r++) {
      var w = tot[r][0] > tot[r][1] ? 0 : (tot[r][1] > tot[r][0] ? 1 : -1);
      lanes.push(w);
      sum[0] += tot[r][0]; sum[1] += tot[r][1];
      if (w >= 0) { won[w]++; if (s.opts.scoring === 'sum') pts[w] += tot[r][w]; }
    }
    var winner;
    if (s.opts.scoring === 'sum') {
      winner = pts[0] > pts[1] ? 0 : (pts[1] > pts[0] ? 1 : -1);
    } else {
      pts = won.slice();
      if (won[0] !== won[1]) winner = won[0] > won[1] ? 0 : 1;
      else winner = sum[0] > sum[1] ? 0 : (sum[1] > sum[0] ? 1 : -1);
    }
    return { tot: tot, lanes: lanes, pts: pts, sum: sum, won: won, winner: winner };
  }

  function clone(s) {
    return {
      opts: s.opts, rs: s.rs,
      cells: s.cells.map(function (c) {
        return { o: c.o, f: c.f, c: c.c ? { id: c.c.id, o: c.c.o, mod: c.c.mod } : null };
      }),
      hands: [s.hands[0].slice(), s.hands[1].slice()],
      decks: [s.decks[0].slice(), s.decks[1].slice()],
      deckLists: s.deckLists,
      played: [s.played[0].slice(), s.played[1].slice()],
      turn: s.turn, first: s.first, turnsTaken: [s.turnsTaken[0], s.turnsTaken[1]],
      passes: s.passes, over: s.over, phase: s.phase,
      mull: [s.mull[0], s.mull[1]], grown: [s.grown[0], s.grown[1]], rescued: [s.rescued[0], s.rescued[1]], ply: s.ply, last: null,
      caps: [s.caps[0], s.caps[1]], bigs: [s.bigs[0], s.bigs[1]]
    };
  }

  return {
    ROWS: ROWS, COLS: COLS, N: N, HAND0: HAND0, MAX_FEET: MAX_FEET, CARDS: CARDS, NEIGH: NEIGH,
    registerCards: registerCards, makeRng: makeRng, nextRand: nextRand, shuffle: shuffle,
    newGame: newGame, mulligan: mulligan, legalMoves: legalMoves, applyMove: applyMove,
    patternTargets: patternTargets, sizeAt: sizeAt, score: score, clone: clone
  };
});
