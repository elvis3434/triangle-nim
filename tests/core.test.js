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

test('合法取法：1 子 15 種、2 子 30 種、3 子 18 種（直線）', () => {
  const by = [0, 0, 0, 0];
  for (const m of core.MOVES) by[core.bitCount(m)]++;
  assert.deepEqual(by.slice(1), [15, 30, 18]);
  // 3 子中沒有小三角形（三顆兩兩相鄰）
  const triangles = core.MOVES.filter((m) => {
    if (core.bitCount(m) !== 3) return false;
    const [a, b, c] = core.maskToIndices(m);
    return core.isAdjacent(a, b) && core.isAdjacent(b, c) && core.isAdjacent(a, c);
  });
  assert.equal(triangles.length, 0);
});

test('直線判定：相鄰且成一直線才可取；L 形、小三角、不相鄰不可取', () => {
  const m = core.numbersToMask;
  assert.ok(core.isLegalMove(FULL, m([7])));         // 單顆
  assert.ok(core.isLegalMove(FULL, m([2, 5])));      // 相鄰兩顆
  assert.ok(core.isLegalMove(FULL, m([1, 2, 4])));   // 左邊斜線
  assert.ok(core.isLegalMove(FULL, m([1, 3, 6])));   // 右邊斜線
  assert.ok(core.isLegalMove(FULL, m([4, 5, 6])));   // 橫線
  assert.ok(core.isLegalMove(FULL, m([2, 5, 9])));   // 內部斜線
  assert.ok(!core.isLegalMove(FULL, m([2, 3, 5])));  // 小三角
  assert.ok(!core.isLegalMove(FULL, m([1, 2, 5])));  // L 形／彎折
  assert.ok(!core.isLegalMove(FULL, m([2, 5, 8])));  // 彎折
  assert.ok(!core.isLegalMove(FULL, m([4, 5, 3])));  // 彎折
  assert.ok(!core.isLegalMove(FULL, m([1, 4])));     // 不相鄰（同線但隔一顆）
  assert.ok(!core.isLegalMove(FULL, m([4, 6])));     // 中間隔一子
  assert.ok(!core.isLegalMove(FULL, m([7, 8, 9, 10]))); // 超過三子
  assert.ok(!core.isLegalMove(FULL ^ m([2]), m([1, 2]))); // 已被取走
  // 取走中間後兩端仍是「位置上不相鄰」
  assert.ok(!core.isLegalMove(FULL ^ m([5]), m([4, 6])));
});

// 獨立的參考實作：遞迴＋備忘，以不同方式產生合法步
function referenceSolve() {
  // 以 (列, 位置) 沿三個方向逐格延伸，列出每個局面可取的直線
  const at = (r, c) => (c >= 0 && c <= r && r < 5 ? (r * (r + 1)) / 2 + c : -1);
  const dirs = [[0, 1], [1, 0], [1, 1]];
  const memo = new Map();
  function win(board) {
    if (board === 0) return true;
    if (memo.has(board)) return memo.get(board);
    let result = false;
    search: for (let r = 0; r < 5; r++) {
      for (let c = 0; c <= r; c++) {
        const a = at(r, c);
        if (!(board & (1 << a))) continue;
        if (!win(board & ~(1 << a))) { result = true; break search; }
        for (const [dr, dc] of dirs) {
          let taken = 1 << a;
          for (let step = 1; step <= 2; step++) {
            const x = at(r + dr * step, c + dc * step);
            if (x < 0 || !(board & (1 << x))) break;
            taken |= 1 << x;
            if (!win(board & ~taken)) { result = true; break search; }
          }
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

test('結論：完整開局先手必勝，必勝第一步恰為取單顆 1、4、5、6、8、9、11、13、15', () => {
  assert.equal(core.isWinning(FULL), true);
  const firsts = core.winningMoves(FULL).map(core.maskToNumbers);
  assert.deepEqual(firsts, [[1], [4], [5], [6], [8], [9], [11], [13], [15]]);
  // 取這些之後，後手的每一種回應都讓先手再回到必勝局面
  for (const mv of core.winningMoves(FULL)) {
    const after = FULL ^ mv;
    assert.equal(core.winningMoves(after).length, 0);
    for (const reply of core.legalMoves(after)) assert.ok(core.isWinning(after ^ reply));
  }
});

test('統計表總和正確', () => {
  const rows = core.statsByCount();
  assert.equal(rows.reduce((s, r) => s + r.total, 0), 32768);
  assert.deepEqual(rows[15], { remaining: 15, total: 1, win: 1, lose: 0 });
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
  // 完美下法：先手（此局為玩家 1）獲勝
  assert.equal(rec.winner, 1);
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
  assert.equal(fm.reduce((n, c) => n + c.members.length, 0), 63);
  assert.equal(fm.length, 14);
  // 必勝第一步分成 3 類（角、邊中、內部），後手對它們都沒有致勝回應
  const wins = fm.filter((c) => c.firstWins);
  assert.deepEqual(wins.map((c) => core.maskToNumbers(c.move)), [[1], [5], [13]]);
  assert.ok(fm.every((c) => (c.firstWins ? c.replies.length === 0 : c.replies.length > 0)));
});
