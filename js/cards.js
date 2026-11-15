/* 恐竜なわばりカード: カードの定義。
   w=重さ(置くのに要る足あとの数)、size=大きさ、pat=足あとの付く形 [前へ, 下へ](自分から見た向き)、
   diet=食べ物(herb 草食 / carn 肉食)、land=得意な土地(0 森 / 1 水辺 / 2 平原)、ab=能力(hunt 狩り / grow 成長)。
   数値は「大きさ+足あとの価値+能力の価値=予算(重さ1は5、重さ2は7、重さ3は9)」から出した仮の値。
   足あとの価値: 前1.5、上下1.0、後ろ0.5、前の2マス先2.5。自動対戦の結果で直す。 */
(function (root, factory) {
  var E = (typeof module === 'object' && module.exports) ? require('./engine.js') : root.DinoEngine;
  var api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DinoCards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  var F = [1, 0], B = [-1, 0], U = [0, -1], D = [0, 1], F2 = [2, 0], UF = [1, -1], DF = [1, 1];
  var LANDS = ['森', '水辺', '平原'];
  // 最初から持っている12種(最初のデッキ)。LIST に種類を足しても、ここは変えない
  var STARTER = ['compy', 'raptor', 'deino', 'pachy', 'proto', 'galli', 'hypsi', 'trike', 'stego', 'spino', 'parasa', 'tyranno'];

  /* 第2版(2026-11-14): 第1版は足あとが足りず、重さ2が82%使われなかった(400戦)。
     足あとの付くマスを平均1.7から2.5に増やし、足あとの価値を 前1.0 / 上下0.75 / 後ろ0.5 / 2マス先1.25 / 斜め前1.0 に下げた。 */
  /* 第3版: 第2版でも重さ2の66%が使われなかった(先読み同士)。重さ1との大きさの差が1〜2しかなく、
     足あとを重ねる手間に見合わなかったため。重さ1を1〜3、重さ2を4〜6、重さ3を10にして差を広げた。 */
  /* 第4版: 第3版でも改善せず。診断で、置けるマスが番ごとに約3つしかなく、足あとの35%が盤の外かカードに当たって
     無駄になっていると分かった。足あとの付くマスを平均3.4に増やし、上下(重ねやすい向き)を多くした。 */
  var LIST = [
    // 重さ1
    { id: 'compy',   name: 'コンプソグナトゥス',   w: 1, size: 2, pat: [F, F2, U],         diet: 'carn', land: 1, ab: null },
    { id: 'raptor',  name: 'ヴェロキラプトル',     w: 1, size: 1, pat: [F, UF, DF, U, D],  diet: 'carn', land: 2, ab: 'hunt' },
    { id: 'deino',   name: 'デイノニクス',         w: 1, size: 2, pat: [F, U, UF],         diet: 'carn', land: 0, ab: 'hunt' },
    { id: 'pachy',   name: 'パキケファロサウルス', w: 1, size: 2, pat: [F, D, DF],         diet: 'herb', land: 0, ab: null },
    { id: 'proto',   name: 'プロトケラトプス',     w: 1, size: 2, pat: [F, U, D],          diet: 'herb', land: 2, ab: null },
    { id: 'galli',   name: 'ガリミムス',           w: 1, size: 1, pat: [F, F2, U, D],      diet: 'herb', land: 1, ab: null },
    { id: 'hypsi',   name: 'ヒプシロフォドン',     w: 1, size: 3, pat: [F, D],             diet: 'herb', land: 0, ab: null },
    // 重さ2
    { id: 'trike',   name: 'トリケラトプス',       w: 2, size: 5, pat: [F, U, D, UF, DF],  diet: 'herb', land: 2, ab: null },
    { id: 'stego',   name: 'ステゴサウルス',       w: 2, size: 4, pat: [F, F2, U, D],      diet: 'herb', land: 0, ab: null },
    { id: 'spino',   name: 'スピノサウルス',       w: 2, size: 6, pat: [F, U],             diet: 'carn', land: 1, ab: null },
    { id: 'parasa',  name: 'パラサウロロフス',     w: 2, size: 4, pat: [F, B, UF, DF],     diet: 'herb', land: 1, ab: null },
    // 重さ3
    { id: 'tyranno', name: 'ティラノサウルス',     w: 3, size: 10, pat: [F, U, D],         diet: 'carn', land: 2, ab: 'hunt', alt: { w: 2, size: 6 } },

    /* 集めて手に入る12種(2026-11-15)。既存の札の上位互換にならないよう、形を変えてある。
       土地ごとに4種ずつ(森: troodon psitta theri brachi / 水辺: coelo ovi iguano bary / 平原: eorap minmi ankylo giga) */
    // 重さ1
    { id: 'troodon', name: 'トロオドン',           w: 1, size: 2, pat: [F, UF, DF],        diet: 'carn', land: 0, ab: null },
    { id: 'psitta',  name: 'プシッタコサウルス',   w: 1, size: 3, pat: [F, U],             diet: 'herb', land: 0, ab: null },
    { id: 'coelo',   name: 'コエロフィシス',       w: 1, size: 1, pat: [F, F2, UF, DF],    diet: 'carn', land: 1, ab: null },
    { id: 'ovi',     name: 'オヴィラプトル',       w: 1, size: 2, pat: [B, U, D],          diet: 'carn', land: 1, ab: null },
    { id: 'eorap',   name: 'エオラプトル',         w: 1, size: 2, pat: [F, F2, D],         diet: 'carn', land: 2, ab: null },
    { id: 'minmi',   name: 'ミンミ',               w: 1, size: 3, pat: [U, D],             diet: 'herb', land: 2, ab: null },
    // 重さ2
    { id: 'theri',   name: 'テリジノサウルス',     w: 2, size: 3, pat: [F, F2, U, D, UF, DF], diet: 'herb', land: 0, ab: null },
    { id: 'iguano',  name: 'イグアノドン',         w: 2, size: 5, pat: [F, F2, B],         diet: 'herb', land: 1, ab: null },
    { id: 'bary',    name: 'バリオニクス',         w: 2, size: 6, pat: [F, D],             diet: 'carn', land: 1, ab: 'hunt' },
    { id: 'ankylo',  name: 'アンキロサウルス',     w: 2, size: 7, pat: [F],                diet: 'herb', land: 2, ab: null },
    // 重さ3(二段構え)
    { id: 'brachi',  name: 'ブラキオサウルス',     w: 3, size: 8, pat: [F, F2, B, U, D],   diet: 'herb', land: 0, ab: null, alt: { w: 2, size: 5 } },
    { id: 'giga',    name: 'ギガノトサウルス',     w: 3, size: 12, pat: [F],               diet: 'carn', land: 2, ab: 'hunt', alt: { w: 2, size: 6 } }
  ];
  E.registerCards(LIST);

  // 調整用: 重さの配分(7/4/1)と「同じカードは2枚まで」を守った、ばらばらのデッキ
  function randomDeck(rand, split) {
    var deck = [];
    split = split || [7, 4, 1];
    [[1, split[0]], [2, split[1]], [3, split[2]]].forEach(function (wn) {
      var pool = [];
      LIST.forEach(function (c) { if (c.w === wn[0]) { pool.push(c.id); pool.push(c.id); } });
      E.shuffle(pool, rand);
      deck = deck.concat(pool.slice(0, wn[1]));
    });
    return deck;
  }

  /* デッキの決まり: 12枚ちょうど。同じカードは2枚まで(重さ3は1枚)。重さの合計は18まで。 */
  var DECK_SIZE = 12, MAX_WEIGHT = 18;
  function maxCopies(id) { return E.CARDS[id].w >= 3 ? 1 : 2; }
  function deckWeight(ids) { return ids.reduce(function (a, id) { return a + (E.CARDS[id] ? E.CARDS[id].w : 0); }, 0); }

  // デッキを調べる。own(id -> 持っている枚数)を渡すと、持っている枚数も確かめる
  function checkDeck(ids, own) {
    var errors = [], n = {}, i;
    for (i = 0; i < ids.length; i++) {
      if (!E.CARDS[ids[i]]) { errors.push('知らないカードが入っています'); return { ok: false, errors: errors, count: ids.length, weight: 0 }; }
      n[ids[i]] = (n[ids[i]] || 0) + 1;
    }
    var weight = deckWeight(ids);
    if (ids.length !== DECK_SIZE) errors.push('カードは' + DECK_SIZE + '枚ちょうどにします(いま' + ids.length + '枚)');
    if (weight > MAX_WEIGHT) errors.push('重さの合計は' + MAX_WEIGHT + 'までです(いま' + weight + ')');
    Object.keys(n).forEach(function (id) {
      if (n[id] > maxCopies(id)) errors.push(E.CARDS[id].name + 'は' + maxCopies(id) + '枚までです');
      else if (own && n[id] > (own[id] || 0)) errors.push(E.CARDS[id].name + 'は' + (own[id] || 0) + '枚しか持っていません');
    });
    return { ok: !errors.length, errors: errors, count: ids.length, weight: weight };
  }

  // 調整用: 決まりを守った、ばらばらのデッキ。pool を渡すとその中から(id -> 枚数)、無ければ全カードを上限まで
  function randomLegalDeck(rand, pool) {
    for (var tries = 0; tries < 200; tries++) {
      var all = [];
      LIST.forEach(function (c) {
        var k = pool ? Math.min(pool[c.id] || 0, maxCopies(c.id)) : maxCopies(c.id);
        while (k-- > 0) all.push(c.id);
      });
      E.shuffle(all, rand);
      var deck = all.slice(0, DECK_SIZE);
      if (deck.length === DECK_SIZE && deckWeight(deck) <= MAX_WEIGHT) return deck;
    }
    return STARTER.slice();
  }

  return {
    LIST: LIST, LANDS: LANDS, STARTER: STARTER, randomDeck: randomDeck,
    DECK_SIZE: DECK_SIZE, MAX_WEIGHT: MAX_WEIGHT, maxCopies: maxCopies, deckWeight: deckWeight,
    checkDeck: checkDeck, randomLegalDeck: randomLegalDeck
  };
});
