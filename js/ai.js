/* 恐竜なわばりカード: CPU と、調整用のボット。
   相手の手札と山の並びは見ない。相手のデッキの中身(何が何枚か)と盤面だけを使う。
   使い方:
     DinoAI.chooseMove(state, player, level, rand)   level: 'easy' | 'normal' | 'hard'
     DinoAI.chooseMulligan(state, player)            戻す手札の位置の配列
     DinoAI.analyze(state, player, rand, samples)    [{ m: 手, v: 評価 }] を良い順に返す(分かれ目の表示用)
     DinoAI.BOTS[name](state, player, rand)          調整用: territory / score / focus / search */
(function (root, factory) {
  var E = (typeof module === 'object' && module.exports) ? require('./engine.js') : root.DinoEngine;
  var api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DinoAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  var COLS = E.COLS, ROWS = E.ROWS, N = E.N;

  // 評価の重み。score=得点、margin=列の差、feet=足あと、adv=前進、play=置ける手札の種類、focus=1列集中
  var STYLES = {
    balanced:  { score: 1.0,  margin: 0.35, feet: 0.55, adv: 0.25, play: 0.25, focus: 0 },
    territory: { score: 0.35, margin: 0.1,  feet: 1.4,  adv: 0.7,  play: 0.2,  focus: 0 },
    score:     { score: 1.0,  margin: 0,    feet: 0,    adv: 0,    play: 0,    focus: 0 },
    focus:     { score: 1.0,  margin: 0.35, feet: 0.4,  adv: 0.2,  play: 0.2,  focus: 1.2 },
    mid:       { score: 0.6,  margin: 0.2,  feet: 1.0,  adv: 0.5,  play: 0.25, focus: 0 }
  };

  // 手札の見込み: いま置ける札は大きさの分、置けない札はその15%だけ数える。
  // 重い札を持っている時に、足あとを重ねたマスを残す理由になる
  function playableKinds(s, p) {
    var hand = s.hands[p], seen = {}, pot = 0, maxF = 0, i;
    for (i = 0; i < N; i++) { var c = s.cells[i]; if (!c.c && c.o === p && c.f > maxF) maxF = c.f; }
    for (i = 0; i < hand.length; i++) {
      if (seen[hand[i]]) continue;
      seen[hand[i]] = 1;
      var cd = E.CARDS[hand[i]];
      pot += cd.w <= maxF ? cd.size : (cd.alt && cd.alt.w <= maxF ? cd.alt.size : 0.15 * cd.size);
    }
    return pot;
  }

  // p から見た局面の良さ(大きいほど良い)
  function evaluate(s, p, W, lane) {
    var sc = E.score(s), o = 1 - p, v = 0, r, i;
    if (s.over) {
      return (sc.winner === p ? 1000 : (sc.winner === o ? -1000 : 0)) + (sc.pts[p] - sc.pts[o]) + 0.01 * (sc.sum[p] - sc.sum[o]);
    }
    if (s.opts.scoring === 'sum') v += W.score * (sc.pts[p] - sc.pts[o]);
    else v += W.score * (5 * (sc.won[p] - sc.won[o]) + 0.25 * (sc.sum[p] - sc.sum[o]));
    if (W.margin) {
      for (r = 0; r < ROWS; r++) {
        var m = sc.tot[r][p] - sc.tot[r][o];
        v += W.margin * (m > 4 ? 4 : (m < -4 ? -4 : m));
      }
    }
    if (W.feet || W.adv) {
      for (i = 0; i < N; i++) {
        var c = s.cells[i];
        if (c.c || c.o < 0) continue;
        var col = i % COLS, adv = (c.o === 0 ? col : COLS - 1 - col) / (COLS - 1);
        var val = W.feet * (0.6 + 0.4 * c.f) + W.adv * adv;
        v += c.o === p ? val : -val;
      }
    }
    if (W.play) v += W.play * playableKinds(s, p);
    if (W.focus) v += W.focus * 0.5 * (sc.tot[lane][p] - sc.tot[lane][o]);
    return v;
  }

  // 1手先だけ見て、いちばん良い手を選ぶ
  function best1(s, p, W, rand, lane) {
    var moves = E.legalMoves(s, p), best = moves[moves.length - 1], bestV = -Infinity;
    for (var j = 0; j < moves.length; j++) {
      var a = E.clone(s);
      E.applyMove(a, moves[j]);
      var v = evaluate(a, p, W, lane) + rand() * 1e-6 - (moves[j].t === 'pass' ? 1e-3 : 0);
      if (moves[j].t === 'pass' && !a.over) {
        // 自分がパスした後、相手もパスすれば終わる。勝っていない時のパスは、負けか引き分けを招く
        var w = E.score(a).winner;
        if (w !== p) v = (w < 0 ? -450 : -900) + v * 1e-3;
      }
      if (v > bestV) { bestV = v; best = moves[j]; }
    }
    return best;
  }

  // 見えていない所(相手の手札と山、自分の山の並び)を、ありうる形に置きかえた局面を作る
  function determinize(s, p, rand) {
    var d = E.clone(s), o = 1 - p, pool = s.deckLists[o].slice(), i;
    for (i = 0; i < s.played[o].length; i++) {
      var k = pool.indexOf(s.played[o][i]);
      if (k >= 0) pool.splice(k, 1);
    }
    E.shuffle(pool, rand);
    var hn = s.hands[o].length;
    d.hands[o] = pool.slice(0, hn);
    d.decks[o] = pool.slice(hn);
    E.shuffle(d.decks[p], rand);
    return d;
  }

  // 2手先(自分の手 → 相手のいちばん良い返し)まで見て、各手の評価を返す
  function search2(s, p, W, rand, samples, lane) {
    var moves = E.legalMoves(s, p), vals = [], j, k, WB = STYLES.territory;
    for (j = 0; j < moves.length; j++) vals.push(0);
    for (k = 0; k < samples; k++) {
      var d = determinize(s, p, rand);
      for (j = 0; j < moves.length; j++) {
        var a = E.clone(d);
        E.applyMove(a, moves[j]);
        if (a.over) { vals[j] += evaluate(a, p, W, lane); continue; }
        var om = E.legalMoves(a, 1 - p), bestO = -Infinity, mine = 0;
        for (var q = 0; q < om.length; q++) {
          var b = E.clone(a);
          E.applyMove(b, om[q]);
          var ev = evaluate(b, 1 - p, WB, lane);
          if (ev > bestO) { bestO = ev; mine = evaluate(b, p, W, lane); }
        }
        vals[j] += mine;
      }
    }
    var out = [];
    for (j = 0; j < moves.length; j++) {
      out.push({ m: moves[j], v: vals[j] / samples - (moves[j].t === 'pass' ? 1e-3 : 0) });
    }
    out.sort(function (x, y) { return y.v - x.v; });
    return out;
  }

  function analyze(s, p, rand, samples) { return search2(s, p, STYLES.territory, rand, samples || 8, 0); }

  function randomPlacement(s, p, rand) {
    var moves = E.legalMoves(s, p);
    if (moves.length <= 1) return moves[moves.length - 1];
    return moves[Math.floor(rand() * (moves.length - 1))];
  }

  function chooseMove(s, p, level, rand) {
    rand = rand || Math.random;
    // gentle(とてもやさしい): 続けて負けた人向け。置ける手の中から、でたらめに選ぶ
    // (測った結果: 「やさしい」がこれに勝つ率は69%、「ふつう」は90%。6割でたらめでは57%で、差が小さかった)
    if (level === 'gentle') return randomPlacement(s, p, rand);
    if (level === 'easy') {
      if (rand() < 0.3) return randomPlacement(s, p, rand);
      return best1(s, p, STYLES.score, rand, 0);
    }
    if (level === 'hard') return search2(s, p, STYLES.territory, rand, 6, 0)[0].m;
    return best1(s, p, STYLES.balanced, rand, 0);
  }

  // 引き直し: 重さ3は戻す。重さ2は1枚だけ残す
  function chooseMulligan(s, p) {
    var out = [], heavy = 0;
    s.hands[p].forEach(function (id, i) {
      var w = E.CARDS[id].w;
      if (w === 3) out.push(i);
      else if (w === 2) { heavy++; if (heavy > 1) out.push(i); }
    });
    return out;
  }

  // 調整用のボット。focus は対戦ごとに狙う列をくじで決める(局面の乱数の種から決めるので、同じ対戦では同じ列)
  var BOTS = {
    territory: function (s, p, rand) { return best1(s, p, STYLES.territory, rand, 0); },
    score:     function (s, p, rand) { return best1(s, p, STYLES.score, rand, 0); },
    focus:     function (s, p, rand) { return best1(s, p, STYLES.focus, rand, (s.deckLists[p].length + s.first + p * 2 + (s.rs >>> 0)) % 3); },
    search:    function (s, p, rand) { return search2(s, p, STYLES.territory, rand, 3, 0)[0].m; },
    normal:    function (s, p, rand) { return best1(s, p, STYLES.balanced, rand, 0); },
    easy:      function (s, p, rand) { return chooseMove(s, p, 'easy', rand); }
  };

  return {
    STYLES: STYLES, evaluate: evaluate, analyze: analyze, determinize: determinize,
    chooseMove: chooseMove, chooseMulligan: chooseMulligan, BOTS: BOTS
  };
});
