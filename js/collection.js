/* 恐竜なわばりカード: カード集め。持っているカード、デッキ、化石、ライバル、発掘、課題と、その保存。
   画面からの使い方(DinoCollection.*):
     load()                     保存を読む(最初に1回)。get() で今の状態(読むだけ)
     deck() / setCur(i) / setDeck(i, ids, name) / checkDeck(ids) / suggestDeck()
     landOpen(land) / rivalOpen(id) / beaten(id) / digPool(land)
     digStart(land, rand) → { ok, offer:[id…] }   化石を払って、候補を最大3枚出す(選ぶまで保存される)
     digPick(id)          → { ok, card, tasks }   候補から1枚もらう
     summarize(s, me, { level, rivalId })         終わった対戦から、記録を作る
     finishGame(summary)  → { fossils, cards, tasks, firstWin, unlocked, total }   ごほうびを渡す(1戦に1回だけ呼ぶ)
     grant(id, source)    → { id, added, fossils } 本編などから、カードを1枚渡す
     whereToGet(id)       → ['森の発掘', …]       手に入る場所
     exportText() / importText(text) / reset() */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var E = node ? require('./engine.js') : root.DinoEngine;
  var C = node ? require('./cards.js') : root.DinoCards;
  var api = factory(E, C, node ? null : root);
  if (node) module.exports = api;
  root.DinoCollection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E, C, win) {
  'use strict';

  var KEY = 'dinoNawabari.save.v1';
  var DIG_COST = 5;            // 発掘1回に要る化石(3だと、9人に勝った時点で全45枚がそろってしまい、発掘に迷いが無かった)
  var DECK_SLOTS = 3;
  var WIN_FOSSILS = { gentle: 2, easy: 2, normal: 3, hard: 4 };
  var LOSE_FOSSILS = 1;        // 負け・引き分けでも、MIN_PLACED 枚以上置いていればもらえる
  var MIN_PLACED = 4;
  var DUP_FOSSILS = 3;         // もう上限まで持っているカードをもらった時の代わり(発掘1回分。多いと、わざと重ねる方が得になる)
  var EASE_AFTER = 3;          // 同じライバルに続けてこの回数負けるたびに、相手の強さが1段下がる(勝つと元に戻る)
  var EASIER = { hard: 'normal', normal: 'easy', easy: 'gentle', gentle: 'gentle' };
  var LANDS = C.LANDS;

  /* ライバル9人。土地ごとに3人(3人目が主)。初めて勝つと card を1枚もらえる。deck は決まりを守った12枚 */
  var RIVALS = [
    { id: 'haru', name: 'ハル', title: '見習いの探検家', land: 0, level: 'easy', boss: false, card: 'psitta',
      say: 'カードは集めはじめたばかり。お手やわらかに!',
      deck: ['compy', 'proto', 'galli', 'hypsi', 'pachy', 'deino', 'raptor', 'psitta', 'psitta', 'stego', 'parasa', 'trike'] },
    { id: 'gen', name: 'ゲン', title: '森のきこり', land: 0, level: 'easy', boss: false, card: 'troodon',
      say: 'すばしこいやつらで、森をかけ回るぞ。',
      deck: ['troodon', 'troodon', 'deino', 'deino', 'raptor', 'compy', 'pachy', 'hypsi', 'stego', 'spino', 'trike', 'tyranno'] },
    { id: 'midori', name: 'ミドリ', title: '森の主', land: 0, level: 'normal', boss: true, card: 'brachi',
      say: '大きな体は、足あとを重ねてから。待つのも作戦よ。',
      deck: ['psitta', 'psitta', 'hypsi', 'hypsi', 'pachy', 'proto', 'troodon', 'stego', 'stego', 'theri', 'parasa', 'brachi'] },
    { id: 'towa', name: 'トワ', title: '渡し守', land: 1, level: 'normal', boss: false, card: 'ovi',
      say: '足場を固めてから、大物を出す。急がないよ。',
      deck: ['ovi', 'ovi', 'proto', 'proto', 'hypsi', 'psitta', 'minmi', 'spino', 'spino', 'bary', 'trike', 'tyranno'] },
    { id: 'nagi', name: 'ナギ', title: '川の釣り人', land: 1, level: 'normal', boss: false, card: 'coelo',
      say: '前へ前へ。流れに乗れば止まらないさ。',
      deck: ['coelo', 'coelo', 'galli', 'galli', 'compy', 'compy', 'raptor', 'spino', 'parasa', 'iguano', 'stego', 'tyranno'] },
    { id: 'shizuku', name: 'シズク', title: '水辺の主', land: 1, level: 'hard', boss: true, card: 'bary',
      say: '水辺の恐竜は、大きさで押す。受けてみる?',
      deck: ['compy', 'coelo', 'galli', 'ovi', 'hypsi', 'psitta', 'deino', 'bary', 'bary', 'spino', 'spino', 'iguano'] },
    { id: 'daichi', name: 'ダイチ', title: '牧場の番人', land: 2, level: 'hard', boss: false, card: 'ankylo',
      say: 'かたい守りは、かんたんにはくずせないぞ。',
      deck: ['minmi', 'hypsi', 'psitta', 'proto', 'proto', 'raptor', 'galli', 'ankylo', 'ankylo', 'trike', 'stego', 'tyranno'] },
    { id: 'sora', name: 'ソラ', title: '草原の旅人', land: 2, level: 'hard', boss: false, card: 'eorap',
      say: '広い所では、先に走った方が勝つんだ。',
      deck: ['eorap', 'eorap', 'raptor', 'raptor', 'proto', 'proto', 'minmi', 'trike', 'trike', 'parasa', 'stego', 'tyranno'] },
    { id: 'raiga', name: 'ライガ', title: '平原の主', land: 2, level: 'hard', boss: true, card: 'giga',
      say: 'ここまで来たか。切り札を見せてやろう。',
      deck: ['raptor', 'deino', 'troodon', 'coelo', 'eorap', 'compy', 'proto', 'bary', 'spino', 'trike', 'ankylo', 'giga'] }
  ];
  var RIVAL = {};
  RIVALS.forEach(function (r) { RIVAL[r.id] = r; });

  /* 課題。reward: { fossils } / { card } / { title }(組み合わせてよい)。test(sum, st): sum は対戦の記録(発掘の後などは null) */
  function won(sum) { return !!sum && sum.result === 'win'; }
  var TASKS = [
    { id: 'first_win', name: 'はじめての勝ち', text: 'だれかに1回勝つ', reward: { fossils: 5 },
      test: function (sum) { return won(sum); } },
    { id: 'sweep', name: '3列まとめて', text: '森・水辺・平原の3列すべてを取って勝つ', reward: { card: 'minmi' },
      test: function (sum) { return won(sum) && sum.lanes >= 3; } },
    { id: 'margin15', name: '大差の勝ち', text: '15点以上の差をつけて勝つ', reward: { card: 'iguano' },
      test: function (sum) { return won(sum) && sum.margin >= 15; } },
    { id: 'caps7', name: 'なわばり荒らし', text: '1回の対戦で、相手のマスを7つ奪って勝つ', reward: { card: 'theri' },
      test: function (sum) { return won(sum) && sum.caps >= 7; } },
    { id: 'big3', name: '切り札', text: '重さ3の恐竜を、もとの大きさで置く', reward: { fossils: 5 },
      test: function (sum) { return !!sum && sum.bigs >= 1; } },
    { id: 'no_rescue', name: '足ぶみいらず', text: '足ぶみを使わずに、「ふつう」以上の相手に勝つ', reward: { fossils: 5 },
      test: function (sum) { return won(sum) && sum.rescues === 0 && sum.level !== 'easy'; } },
    { id: 'beat_hard', name: 'つよい相手', text: '「つよい」相手に勝つ', reward: { fossils: 8 },
      test: function (sum) { return won(sum) && sum.level === 'hard'; } },
    { id: 'dig3', name: '3つの土地で発掘', text: '森・水辺・平原のすべてで発掘する', reward: { fossils: 5 },
      test: function (sum, st) { return st.digs[0] > 0 && st.digs[1] > 0 && st.digs[2] > 0; } },
    { id: 'all_rivals', name: '9人抜き', text: 'ライバル9人すべてに勝つ', reward: { fossils: 10, title: 'なわばりの王' },
      test: function (sum, st) { return RIVALS.every(function (r) { return st.rivals[r.id] > 0; }); } },
    { id: 'dex24', name: '図鑑がそろう', text: '24種すべてを手に入れる', reward: { title: '恐竜博士' },
      test: function (sum, st) { return C.LIST.every(function (c) { return st.cards[c.id] > 0; }); } },
    { id: 'full45', name: 'ぜんぶ集めた', text: '45枚すべてを手に入れる', reward: { title: '大収集家' },
      test: function (sum, st) { return C.LIST.every(function (c) { return st.cards[c.id] >= C.maxCopies(c.id); }); } }
  ];
  var TASK = {};
  TASKS.forEach(function (t) { TASK[t.id] = t; });

  var MAX_CARDS = C.LIST.reduce(function (a, c) { return a + C.maxCopies(c.id); }, 0);

  /* ---------- 保存 ---------- */

  var mem = null;
  var store = {
    get: function () {
      try { if (win && win.localStorage) { var v = win.localStorage.getItem(KEY); if (v !== null) return v; } } catch (e) { /* 保存が使えない環境 */ }
      return mem;
    },
    set: function (v) {
      mem = v;
      try { if (win && win.localStorage) win.localStorage.setItem(KEY, v); } catch (e) { /* 同上。この場合は開いている間だけ覚えている */ }
    }
  };
  function useStorage(s) { store = s; }

  function fresh() {
    var st = {
      v: 1, cards: {}, decks: [], cur: 0, fossils: 0, rivals: {}, lost: {}, tasks: {}, digs: [0, 0, 0],
      pending: null, games: 0, wins: 0, titles: [], fresh: {}
    };
    C.STARTER.forEach(function (id) { st.cards[id] = 1; });
    for (var i = 0; i < DECK_SLOTS; i++) st.decks.push({ name: 'デッキ' + (i + 1), ids: C.STARTER.slice() });
    return st;
  }

  function int(v, lo, hi) {
    v = Math.floor(Number(v));
    if (!isFinite(v)) v = lo;
    return v < lo ? lo : (v > hi ? hi : v);
  }

  // 読んだ保存を、今の決まりに合う形に直す(壊れた所や知らないカードは捨てる)
  function sanitize(o) {
    var st = fresh(), i;
    if (!o || typeof o !== 'object') return st;
    var oc = o.cards && typeof o.cards === 'object' ? o.cards : {};
    C.LIST.forEach(function (c) {
      var n = int(oc[c.id], 0, C.maxCopies(c.id));
      if (n > (st.cards[c.id] || 0)) st.cards[c.id] = n;
    });
    if (Array.isArray(o.decks)) {
      for (i = 0; i < DECK_SLOTS; i++) {
        var d = o.decks[i];
        if (!d || !Array.isArray(d.ids)) continue;
        var ids = d.ids.filter(function (x) { return typeof x === 'string'; });
        if (C.checkDeck(ids, st.cards).ok) st.decks[i].ids = ids;
        if (typeof d.name === 'string' && d.name.trim()) st.decks[i].name = d.name.trim().slice(0, 12);
      }
    }
    st.cur = int(o.cur, 0, DECK_SLOTS - 1);
    st.fossils = int(o.fossils, 0, 9999);
    st.games = int(o.games, 0, 999999);
    st.wins = int(o.wins, 0, st.games);
    var or = o.rivals && typeof o.rivals === 'object' ? o.rivals : {};
    RIVALS.forEach(function (r) { var n = int(or[r.id], 0, 999999); if (n) st.rivals[r.id] = n; });
    var ol = o.lost && typeof o.lost === 'object' ? o.lost : {};
    RIVALS.forEach(function (r) { var n = int(ol[r.id], 0, 99); if (n) st.lost[r.id] = n; });
    var ot = o.tasks && typeof o.tasks === 'object' ? o.tasks : {};
    TASKS.forEach(function (t) {
      if (!ot[t.id]) return;
      st.tasks[t.id] = 1;
      if (t.reward.title) st.titles.push(t.reward.title);
    });
    if (Array.isArray(o.digs)) for (i = 0; i < 3; i++) st.digs[i] = int(o.digs[i], 0, 999999);
    var p = o.pending;
    if (p && Array.isArray(p.offer) && p.offer.length && p.offer.length <= 3 && int(p.land, -1, 2) === p.land &&
        p.offer.every(function (id) { return E.CARDS[id] && E.CARDS[id].w < 3 && E.CARDS[id].land === p.land; })) {
      st.pending = { land: p.land, offer: p.offer.slice() };
    }
    var of = o.fresh && typeof o.fresh === 'object' ? o.fresh : {};
    C.LIST.forEach(function (c) { if (of[c.id] && st.cards[c.id]) st.fresh[c.id] = 1; });
    return st;
  }

  var S = fresh();

  function save() { store.set(JSON.stringify(S)); }
  function load() {
    var o = null;
    try { var t = store.get(); if (t) o = JSON.parse(t); } catch (e) { o = null; }
    S = sanitize(o);
    return S;
  }
  function reset() { S = fresh(); save(); return S; }
  function get() { return S; }
  function exportText() { return JSON.stringify(S); }
  function importText(text) {
    var o;
    try { o = JSON.parse(String(text)); } catch (e) { return { ok: false, reason: '読めない文字列です' }; }
    if (!o || typeof o !== 'object' || o.v !== 1 || !o.cards) return { ok: false, reason: 'このゲームの保存ではありません' };
    S = sanitize(o);
    save();
    return { ok: true };
  }

  /* ---------- カードとデッキ ---------- */

  function owned(id) { return S.cards[id] || 0; }
  function count() {
    var n = 0, kinds = 0;
    C.LIST.forEach(function (c) { var k = owned(c.id); n += k; if (k) kinds++; });
    return { cards: n, maxCards: MAX_CARDS, kinds: kinds, maxKinds: C.LIST.length };
  }
  function deck() { return S.decks[S.cur].ids.slice(); }
  function checkDeck(ids) { return C.checkDeck(ids, S.cards); }
  function setCur(i) { S.cur = int(i, 0, DECK_SLOTS - 1); save(); return S.cur; }
  // 決まりに合っている時だけ保存する
  function setDeck(i, ids, name) {
    i = int(i, 0, DECK_SLOTS - 1);
    var res = checkDeck(ids);
    if (res.ok) S.decks[i].ids = ids.slice();
    if (typeof name === 'string' && name.trim()) S.decks[i].name = name.trim().slice(0, 12);
    save();
    return res;
  }

  // おまかせ: 持っているカードから、重さ3を1枚、重さ2を4枚、重さ1を7枚を目安に、値打ちの高い順に入れる
  // 値打ち = 大きさ×a + 足あとの付くマスの数×b + そのうち前向きの数×c(重みは自動対戦で決めた。tools/collect_sim.js suggest)
  var SUGGEST = [1, 1.3, 0.3];
  function cardValue(c, wt) {
    var fwd = c.pat.filter(function (d) { return d[0] > 0; }).length;
    return wt[0] * (c.alt ? (c.size + c.alt.size) / 2 : c.size) + wt[1] * c.pat.length + wt[2] * fwd;
  }
  function suggestDeck(wt) {
    var byW = { 1: [], 2: [], 3: [] };
    wt = wt || SUGGEST;
    C.LIST.forEach(function (c) {
      var k = Math.min(owned(c.id), C.maxCopies(c.id));
      // 2枚目は少し下げて、種類がばらけるようにする
      for (var j = 0; j < k; j++) byW[c.w].push({ id: c.id, v: cardValue(c, wt) - 0.6 * j });
    });
    [1, 2, 3].forEach(function (w) { byW[w].sort(function (a, b) { return b.v - a.v; }); });
    var out = byW[3].slice(0, 1).concat(byW[2].slice(0, 4), byW[1].slice(0, 7)).map(function (x) { return x.id; });
    var rest = byW[1].slice(7).concat(byW[2].slice(4), byW[3].slice(1));
    for (var i = 0; i < rest.length && out.length < C.DECK_SIZE; i++) {
      if (C.deckWeight(out) + E.CARDS[rest[i].id].w <= C.MAX_WEIGHT) out.push(rest[i].id);
    }
    return checkDeck(out).ok ? out : deck();
  }

  // カードを1枚渡す。もう上限まで持っていれば、代わりに化石
  function grantCard(id, source) {
    if (!E.CARDS[id]) return { id: id, source: source, added: false, fossils: 0 };
    if (owned(id) >= C.maxCopies(id)) {
      S.fossils += DUP_FOSSILS;
      return { id: id, source: source, added: false, fossils: DUP_FOSSILS };
    }
    var isNew = !owned(id);
    S.cards[id] = owned(id) + 1;
    S.fresh[id] = 1;
    return { id: id, source: source, added: true, isNew: isNew, fossils: 0 };
  }
  function clearFresh(id) {
    if (id) delete S.fresh[id]; else S.fresh = {};
    save();
  }

  /* ---------- 場所: 土地、ライバル、発掘 ---------- */

  function beaten(id) { return (S.rivals[id] || 0) > 0; }
  function landBeaten(land) { return RIVALS.filter(function (r) { return r.land === land && beaten(r.id); }).length; }
  // 森は最初から。次の土地は、前の土地で2人に勝つと開く
  function landOpen(land) { return land === 0 || (land > 0 && land < 3 && landBeaten(land - 1) >= 2); }
  // 主は、同じ土地のほかの2人に勝つと挑める
  function rivalOpen(id) {
    var r = RIVAL[id];
    if (!r || !landOpen(r.land)) return false;
    if (!r.boss) return true;
    return RIVALS.every(function (x) { return x.land !== r.land || x.boss || beaten(x.id); });
  }
  function openSet() {
    var o = {};
    [0, 1, 2].forEach(function (l) { if (landOpen(l)) o['land' + l] = LANDS[l]; });
    RIVALS.forEach(function (r) { if (rivalOpen(r.id)) o[r.id] = r.title + ' ' + r.name; });
    return o;
  }

  // 同じライバルに続けて負けると、相手の強さが下がる(ごほうびは同じ)。勝つと元に戻る
  function rivalLevel(id) {
    var r = RIVAL[id];
    if (!r) return 'normal';
    var lv = r.level;
    for (var k = Math.floor((S.lost[id] || 0) / EASE_AFTER); k > 0; k--) lv = EASIER[lv];
    return lv;
  }

  // そのカードを切り札にしているライバル(いなければ null)
  function signatureOf(id) {
    for (var i = 0; i < RIVALS.length; i++) if (RIVALS[i].card === id) return RIVALS[i];
    return null;
  }
  /* 発掘で出るカード: その土地の重さ1と2のうち、まだ上限まで持っていないもの(重さ3は主に勝ってもらう)。
     ライバルの切り札は、そのライバルに勝つまでは出ない(先に掘り当てると、初めて勝った時の楽しみが薄れるため) */
  function digPool(land) {
    return C.LIST.filter(function (c) {
      if (c.land !== land || c.w >= 3 || owned(c.id) >= C.maxCopies(c.id)) return false;
      var r = signatureOf(c.id);
      return !r || beaten(r.id);
    }).map(function (c) { return c.id; });
  }
  // 土地ごとに、最初の1回はただで掘れる(勝てない人も、集めることとデッキの組み替えを試せるように)
  function digCost(land) { return S.digs[land] > 0 ? DIG_COST : 0; }
  function digStart(land, rand) {
    if (S.pending) return { ok: true, land: S.pending.land, offer: S.pending.offer.slice(), resumed: true };
    if (!landOpen(land)) return { ok: false, reason: 'この土地は、まだ開いていません' };
    var pool = digPool(land), cost = digCost(land);
    if (!pool.length) return { ok: false, reason: 'この土地でいま掘れるカードは、掘りつくしました' };
    if (S.fossils < cost) return { ok: false, reason: '化石が足りません(' + cost + 'こ要ります)' };
    S.fossils -= cost;
    S.digs[land]++;
    E.shuffle(pool, rand || Math.random);
    S.pending = { land: land, offer: pool.slice(0, 3) };
    save();
    return { ok: true, land: land, offer: S.pending.offer.slice(), resumed: false };
  }
  function digPick(id) {
    if (!S.pending || S.pending.offer.indexOf(id) < 0) return { ok: false, reason: '候補にないカードです' };
    var card = grantCard(id, 'dig');
    S.pending = null;
    var tasks = runTasks(null);
    save();
    return { ok: true, card: card, tasks: tasks };
  }

  /* ---------- 課題とごほうび ---------- */

  // まだの課題を調べて、達成したものにごほうびを渡す(カードをもらって別の課題が達成されることがあるので、変化が無くなるまで)
  function runTasks(sum) {
    var out = [], again = true;
    while (again) {
      again = false;
      TASKS.forEach(function (t) {
        if (S.tasks[t.id] || !t.test(sum, S)) return;
        S.tasks[t.id] = 1;
        var got = { id: t.id, name: t.name, text: t.text, fossils: t.reward.fossils || 0, title: t.reward.title || '', card: null };
        if (t.reward.fossils) S.fossils += t.reward.fossils;
        if (t.reward.title) S.titles.push(t.reward.title);
        if (t.reward.card) got.card = grantCard(t.reward.card, 'task');
        out.push(got);
        again = true;
      });
    }
    return out;
  }

  // 終わった対戦 s から、me(0 か 1)の記録を作る。ctx: { level, rivalId }
  function summarize(s, me, ctx) {
    var sc = E.score(s), o = 1 - me;
    ctx = ctx || {};
    return {
      result: sc.winner === me ? 'win' : (sc.winner === o ? 'lose' : 'draw'),
      level: ctx.level || 'normal', rivalId: ctx.rivalId || null,
      lanes: sc.won[me], margin: sc.pts[me] - sc.pts[o],
      rescues: s.rescued[me], caps: s.caps[me], bigs: s.bigs[me], placed: s.played[me].length
    };
  }

  // 対戦のごほうびを渡す。1戦につき1回だけ呼ぶこと
  function finishGame(sum) {
    var before = openSet(), start = S.fossils;
    var out = { result: sum.result, fossils: 0, cards: [], tasks: [], firstWin: false, unlocked: [], total: 0, eased: '' };
    var r = sum.rivalId ? RIVAL[sum.rivalId] : null;
    S.games++;
    if (sum.result === 'win') {
      S.wins++;
      out.fossils = WIN_FOSSILS[sum.level] || WIN_FOSSILS.normal;
      if (r) {
        out.firstWin = !beaten(r.id);
        S.rivals[r.id] = (S.rivals[r.id] || 0) + 1;
        delete S.lost[r.id];
        if (out.firstWin) out.cards.push(grantCard(r.card, 'rival'));
      }
    } else if (sum.placed >= MIN_PLACED) {
      out.fossils = LOSE_FOSSILS;
      if (r) {
        // 続けて負けた数。強さが1段下がった時は、次の強さを eased に入れる
        var was = rivalLevel(r.id);
        S.lost[r.id] = Math.min((S.lost[r.id] || 0) + 1, 99);
        if (rivalLevel(r.id) !== was) out.eased = rivalLevel(r.id);
      }
    }
    S.fossils += out.fossils;
    out.tasks = runTasks(sum);
    var after = openSet();
    Object.keys(after).forEach(function (k) { if (!before[k]) out.unlocked.push({ key: k, name: after[k] }); });
    out.total = S.fossils - start;
    if (S.fossils > 9999) S.fossils = 9999;
    save();
    return out;
  }

  // 本編などから、カードを1枚渡す
  function grant(id, source) {
    var g = grantCard(id, source || 'gift');
    g.tasks = runTasks(null);
    save();
    return g;
  }
  function addFossils(n) { S.fossils = int(S.fossils + n, 0, 9999); save(); return S.fossils; }

  // そのカードが手に入る場所
  function whereToGet(id) {
    var c = E.CARDS[id], out = [];
    if (!c) return out;
    if (C.STARTER.indexOf(id) >= 0) out.push('最初から1枚持っている');
    RIVALS.forEach(function (r) { if (r.card === id) out.push(LANDS[r.land] + 'の' + r.name + 'に勝つ'); });
    TASKS.forEach(function (t) { if (t.reward.card === id) out.push('課題「' + t.name + '」'); });
    var sig = signatureOf(id);
    if (c.w < 3) out.push(LANDS[c.land] + 'の発掘' + (sig ? '(' + sig.name + 'に勝った後)' : ''));
    return out;
  }

  return {
    KEY: KEY, DIG_COST: DIG_COST, DECK_SLOTS: DECK_SLOTS, WIN_FOSSILS: WIN_FOSSILS, LOSE_FOSSILS: LOSE_FOSSILS,
    MIN_PLACED: MIN_PLACED, DUP_FOSSILS: DUP_FOSSILS, MAX_CARDS: MAX_CARDS,
    RIVALS: RIVALS, RIVAL: RIVAL, TASKS: TASKS, TASK: TASK,
    useStorage: useStorage, load: load, reset: reset, get: get, exportText: exportText, importText: importText,
    owned: owned, count: count, deck: deck, checkDeck: checkDeck, setCur: setCur, setDeck: setDeck,
    suggestDeck: suggestDeck, clearFresh: clearFresh,
    EASE_AFTER: EASE_AFTER, rivalLevel: rivalLevel, digCost: digCost,
    beaten: beaten, landOpen: landOpen, rivalOpen: rivalOpen, digPool: digPool, digStart: digStart, digPick: digPick,
    summarize: summarize, finishGame: finishGame, grant: grant, addFossils: addFossils, whereToGet: whereToGet
  };
});
