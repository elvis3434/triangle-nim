import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../js/core.js';

const { FULL, N } = core;

test('棋盤有 15 格，編號由上而下、由左而右', () => {
  assert.equal(core.CELLS.length, 15);
  assert.deepEqual(core.CELLS[0], { r: 0, c: 0 });
  assert.deepEqual(core.CELLS[1], { r: 1, c: 0 });
  assert.deepEqual(core.CELLS[14], { r: 4, c: 4 });
  assert.equal(core.indexOf(3, 2), 8);
});

test('鄰接關係對稱且符合六方向定義', () => {
  for (let a = 0; a < N; a++) {
    for (const b of core.NEIGHBORS[a]) assert.ok(core.NEIGHBORS[b].includes(a));
  }
  // 頂點 1 只與 2、3 相鄰
  assert.deepEqual(core.NEIGHBORS[0].map((i) => i + 1).sort((x, y) => x - y), [2, 3]);
  // 中央的 5 與 2,3,4,6,8,9 相鄰
  assert.deepEqual(core.NEIGHBORS[4].map((i) => i + 1).sort((x, y) => x - y), [2, 3, 4, 6, 8, 9]);
  // 邊數：3 * (1+2+3+4) = 30
  const edges = core.NEIGHBORS.reduce((s, l) => s + l.length, 0) / 2;
  assert.equal(edges, 30);
});

test('合法取法：1 子 15 種、2 子 30 種、3 子 70 種', () => {
  const by = [0, 0, 0, 0];
  for (const m of core.MOVES) by[core.bitCount(m)]++;
  assert.deepEqual(by.slice(1), [15, 30, 70]);
  // 3 子：16 個小三角形 + 54 條三子路徑（含直線與彎折）
  const triangles = core.MOVES.filter((m) => {
    if (core.bitCount(m) !== 3) return false;
    const [a, b, c] = core.maskToIndices(m);
    return core.isAdjacent(a, b) && core.isAdjacent(b, c) && core.isAdjacent(a, c);
  });
  assert.equal(triangles.length, 16);
});

test('連通判定：直線、L 形、小三角可取；不相連不可取', () => {
  const m = core.numbersToMask;
  assert.ok(core.isLegalMove(FULL, m([1, 2, 4])));   // 直線（左邊）
  assert.ok(core.isLegalMove(FULL, m([4, 5, 6])));   // 橫線
  assert.ok(core.isLegalMove(FULL, m([2, 3, 5])));   // 小三角
  assert.ok(core.isLegalMove(FULL, m([1, 2, 5])));   // 彎折
  assert.ok(!core.isLegalMove(FULL, m([1, 4])));     // 不相鄰
  assert.ok(!core.isLegalMove(FULL, m([4, 6])));     // 中間隔一子
  assert.ok(!core.isLegalMove(FULL, m([1, 2, 3, 5]))); // 超過三子
  assert.ok(!core.isLegalMove(FULL ^ m([2]), m([1, 2]))); // 已被取走
  // 取走中間後兩端仍是「位置上不相鄰」
  assert.ok(!core.isLegalMove(FULL ^ m([5]), m([4, 6])));
});

// 獨立的參考實作：遞迴＋備忘，以不同方式產生合法步
function referenceSolve() {
  const adj = (a, b) => core.NEIGHBORS[a].includes(b);
  const memo = new Map();
  function win(board) {
    if (board === 0) return true;
    if (memo.has(board)) return memo.get(board);
    const cells = core.maskToIndices(board);
    let result = false;
    outer: for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      if (!win(board & ~(1 << a))) { result = true; break; }
      for (let j = i + 1; j < cells.length; j++) {
        const b = cells[j];
        if (adj(a, b) && !win(board & ~(1 << a) & ~(1 << b))) { result = true; break outer; }
        for (let k = j + 1; k < cells.length; k++) {
          const c = cells[k];
          const e = (adj(a, b) ? 1 : 0) + (adj(b, c) ? 1 : 0) + (adj(a, c) ? 1 : 0);
          if (e >= 2 && !win(board & ~(1 << a) & ~(1 << b) & ~(1 << c))) { result = true; break outer; }
        }
      }
    }
    memo.set(board, result);
    return result;
  }
  return win;
}

test('解算器與獨立參考實作在全部 32768 個局面一致', () => {
  const ref = referenceSolve();
  for (let b = 0; b <= FULL; b++) assert.equal(core.isWinning(b), ref(b), `board ${b}`);
});

test('基本局面：空盤為必勝（對手拿了最後一子）、剩一子必敗、剩兩子必勝', () => {
  assert.equal(core.isWinning(0), true);
  for (let i = 0; i < N; i++) assert.equal(core.isWinning(1 << i), false);
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    assert.equal(core.isWinning((1 << i) | (1 << j)), true);
  }
});

test('結論：完整開局先手必敗（後手必勝），先手沒有任何必勝第一步', () => {
  assert.equal(core.isWinning(FULL), false);
  assert.equal(core.winningMoves(FULL).length, 0);
  // 先手的每一種第一步，後手都至少有一個致勝回應
  for (const mv of core.legalMoves(FULL)) {
    assert.ok(core.winningMoves(FULL ^ mv).length > 0, `第一步 ${core.maskToNumbers(mv)}`);
  }
});

test('統計表總和正確', () => {
  const rows = core.statsByCount();
  assert.equal(rows.reduce((s, r) => s + r.total, 0), 32768);
  assert.deepEqual(rows[15], { remaining: 15, total: 1, win: 0, lose: 1 });
  assert.deepEqual(rows[1], { remaining: 1, total: 15, win: 0, lose: 15 });
});

test('困難電腦：必勝局面一定走到對手的必敗局面', () => {
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let b = 1; b <= FULL; b += 37) {
    const mv = core.bestMove(b, rng);
    assert.ok(core.isLegalMove(b, mv));
    if (core.isWinning(b)) assert.equal(core.isWinning(b ^ mv), false);
  }
});

test('簡單電腦：隨機走法永遠合法', () => {
  for (let b = 1; b <= FULL; b += 101) assert.ok(core.isLegalMove(b, core.randomMove(b)));
});

function playGame(firstPlayer = 0) {
  const rec = core.createRecord({ mode: 'pvp', players: ['甲', '乙'], firstPlayer, date: '2026-01-01T00:00:00.000Z' });
  let board = FULL, p = firstPlayer;
  while (board) {
    const mv = core.bestMove(board);
    core.addMove(rec, p, mv);
    board ^= mv;
    p = 1 - p;
  }
  rec.winner = p; // 拿最後一子者的對手獲勝
  return rec;
}

test('紀錄格式：完整對局可驗證、可重播、匯出匯入不變', () => {
  const rec = playGame(1);
  assert.equal(rec.moves[0].player, 1);
  for (const mv of rec.moves) assert.equal(mv.count, mv.circles.length);
  assert.ok(core.validateRecord(rec));
  const boards = core.replayBoards(rec);
  assert.equal(boards[0], FULL);
  assert.equal(boards.at(-1), 0);
  // 完美下法：後手獲勝
  assert.equal(rec.winner, 0);
  const again = core.importRecords(core.exportRecords([rec]));
  assert.deepEqual(again, [rec]);
});

test('紀錄格式：竄改過的紀錄會被拒絕', () => {
  const rec = playGame(0);
  const bad1 = structuredClone(rec); bad1.winner = 1 - rec.winner;
  const bad2 = structuredClone(rec); bad2.moves[0].circles = [1, 15]; bad2.moves[0].count = 2;
  const bad3 = structuredClone(rec); bad3.moves[1].player = bad3.moves[0].player;
  const bad4 = structuredClone(rec); bad4.moves[0].count = 9;
  for (const b of [bad1, bad2, bad3, bad4, null, {}, { ...rec, mode: 'x' }]) {
    assert.equal(core.validateRecord(b), false);
  }
  assert.deepEqual(core.importRecords(JSON.stringify([bad1, rec])), [rec]);
  assert.throws(() => core.importRecords('{"foo":1}'));
});

test('對稱：6 種變換皆保持鄰接與勝負', () => {
  assert.equal(core.SYMMETRIES.length, 6);
  for (const s of core.SYMMETRIES) {
    assert.equal(new Set(s).size, 15);
    for (let a = 0; a < N; a++) for (const b of core.NEIGHBORS[a]) assert.ok(core.isAdjacent(s[a], s[b]));
    for (let b = 0; b <= FULL; b += 7) assert.equal(core.isWinning(b), core.isWinning(core.transformMask(b, s)));
  }
  const fm = core.firstMoveAnalysis();
  assert.equal(fm.reduce((n, c) => n + c.members.length, 0), 115);
  assert.ok(fm.every((c) => !c.firstWins && c.replies.length > 0));
});
