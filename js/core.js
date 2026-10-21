// Triangle Nim 核心邏輯：棋盤、鄰接、合法步、解算器、紀錄格式。
// 純 ES module，瀏覽器與 Node 共用。

export const ROWS = 5;
export const N = 15;
export const FULL = (1 << N) - 1;

// index (0..14) <-> (row, col)，編號 = index + 1（由上而下、由左而右）
export const CELLS = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c <= r; c++) CELLS.push({ r, c });
}

export function indexOf(r, c) {
  if (r < 0 || r >= ROWS || c < 0 || c > r) return -1;
  return (r * (r + 1)) / 2 + c;
}

// 每格最多 6 個相鄰格
export const NEIGHBORS = CELLS.map(({ r, c }) =>
  [
    [r, c - 1], [r, c + 1],
    [r - 1, c - 1], [r - 1, c],
    [r + 1, c], [r + 1, c + 1],
  ]
    .map(([rr, cc]) => indexOf(rr, cc))
    .filter((i) => i >= 0)
);

export function isAdjacent(a, b) {
  return NEIGHBORS[a].includes(b);
}

export function bitCount(m) {
  let n = 0;
  while (m) { m &= m - 1; n++; }
  return n;
}

export function maskToIndices(m) {
  const out = [];
  for (let i = 0; i < N; i++) if (m & (1 << i)) out.push(i);
  return out;
}

export function indicesToMask(list) {
  let m = 0;
  for (const i of list) m |= 1 << i;
  return m;
}

export function maskToNumbers(m) {
  return maskToIndices(m).map((i) => i + 1);
}

export function numbersToMask(nums) {
  return indicesToMask(nums.map((n) => n - 1));
}

// 一組格子是否在鄰接關係下連通
export function isConnected(m) {
  if (m === 0) return false;
  const start = maskToIndices(m)[0];
  let seen = 1 << start;
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    for (const j of NEIGHBORS[i]) {
      const b = 1 << j;
      if (m & b && !(seen & b)) { seen |= b; stack.push(j); }
    }
  }
  return seen === m;
}

// 所有大小 1–3 的連通子集（作為一步可取走的組合）
export const MOVES = (() => {
  const list = [];
  for (let m = 1; m <= FULL; m++) {
    const k = bitCount(m);
    if (k <= 3 && isConnected(m)) list.push(m);
  }
  return list;
})();

export function isLegalMove(board, move) {
  return move !== 0 && (move & board) === move && bitCount(move) <= 3 && isConnected(move);
}

export function legalMoves(board) {
  return MOVES.filter((mv) => (mv & board) === mv);
}

// 解算：WIN[board] = 1 表示「輪到走的一方」在雙方完美下法下必勝。
// 拿走最後一子者輸 ⇒ 面對空盤的一方獲勝（對手剛拿走最後一子）。
export const WIN = (() => {
  const win = new Uint8Array(FULL + 1);
  win[0] = 1;
  for (let b = 1; b <= FULL; b++) {
    let w = 0;
    for (const mv of MOVES) {
      if ((mv & b) === mv && !win[b ^ mv]) { w = 1; break; }
    }
    win[b] = w;
  }
  return win;
})();

export function isWinning(board) {
  return WIN[board] === 1;
}

export function winningMoves(board) {
  return legalMoves(board).filter((mv) => !WIN[board ^ mv]);
}

export function randomMove(board, rng = Math.random) {
  const moves = legalMoves(board);
  return moves[Math.floor(rng() * moves.length)];
}

// 完美下法：有必勝步就走（偏好取子較多者以加快結束）；
// 必敗時盡量拖延：選讓對手可選必勝步最少的走法，並優先取一子。
export function bestMove(board, rng = Math.random) {
  const wins = winningMoves(board);
  if (wins.length) return wins[Math.floor(rng() * wins.length)];
  const moves = legalMoves(board);
  let best = [], bestScore = Infinity;
  for (const mv of moves) {
    const next = board ^ mv;
    const score = winningMoves(next).length * 4 + bitCount(mv);
    if (score < bestScore) { bestScore = score; best = [mv]; }
    else if (score === bestScore) best.push(mv);
  }
  return best[Math.floor(rng() * best.length)];
}

// 統計：依剩餘子數，必勝 / 必敗局面數
export function statsByCount() {
  const rows = [];
  for (let k = 0; k <= N; k++) rows.push({ remaining: k, total: 0, win: 0, lose: 0 });
  for (let b = 0; b <= FULL; b++) {
    const row = rows[bitCount(b)];
    row.total++;
    if (WIN[b]) row.win++; else row.lose++;
  }
  return rows;
}

// ---- 對局紀錄 ----
export const RECORD_VERSION = 1;

export function createRecord({ mode, players, firstPlayer = 0, date = new Date().toISOString(), difficulty = null }) {
  return {
    version: RECORD_VERSION,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    mode, // 'pvp' | 'ai'
    difficulty, // 'easy' | 'hard' | null
    players, // [名稱0, 名稱1]
    firstPlayer, // 先手玩家索引
    moves: [], // { player, count, circles: [編號...] }
    winner: null, // 玩家索引
  };
}

export function addMove(record, player, moveMask) {
  const circles = maskToNumbers(moveMask);
  record.moves.push({ player, count: circles.length, circles });
}

// 依紀錄重建每一步之後的盤面：boards[0] 為開局，boards[i] 為第 i 步之後
export function replayBoards(record) {
  const boards = [FULL];
  let b = FULL;
  for (const mv of record.moves) {
    const m = numbersToMask(mv.circles);
    if (!isLegalMove(b, m)) throw new Error(`不合法的步驟：${mv.circles.join(',')}`);
    b ^= m;
    boards.push(b);
  }
  return boards;
}

export function validateRecord(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.version !== RECORD_VERSION) return false;
  if (typeof rec.id !== 'string' || typeof rec.date !== 'string') return false;
  if (!['pvp', 'ai'].includes(rec.mode)) return false;
  if (!Array.isArray(rec.players) || rec.players.length !== 2) return false;
  if (!Array.isArray(rec.moves)) return false;
  for (const mv of rec.moves) {
    if (!mv || ![0, 1].includes(mv.player) || !Array.isArray(mv.circles)) return false;
    if (mv.count !== mv.circles.length) return false;
    if (!mv.circles.every((n) => Number.isInteger(n) && n >= 1 && n <= N)) return false;
  }
  let boards;
  try { boards = replayBoards(rec); } catch { return false; }
  // 玩家輪流
  for (let i = 1; i < rec.moves.length; i++) {
    if (rec.moves[i].player === rec.moves[i - 1].player) return false;
  }
  if (rec.winner !== null) {
    if (![0, 1].includes(rec.winner)) return false;
    // 已結束的局：盤面清空，取最後一子者輸
    if (boards[boards.length - 1] !== 0) return false;
    if (rec.winner === rec.moves[rec.moves.length - 1].player) return false;
  }
  return true;
}

export function exportRecords(records) {
  return JSON.stringify({ app: 'triangle-nim', version: RECORD_VERSION, records }, null, 2);
}

export function importRecords(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data && data.records;
  if (!Array.isArray(list)) throw new Error('格式錯誤');
  return list.filter(validateRecord);
}

// ---- 對稱 ----
// 以三角座標 (r-c, c, 4-r)（三者和為 4）表示格子，三個座標的 6 種排列即三角形的 6 種對稱。
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
export const SYMMETRIES = PERMS.map((p) =>
  CELLS.map(({ r, c }) => {
    const t = [r - c, c, ROWS - 1 - r];
    const [, b, d] = p.map((k) => t[k]);
    return indexOf(ROWS - 1 - d, b);
  })
);

export function transformMask(m, sym) {
  let out = 0;
  for (let i = 0; i < N; i++) if (m & (1 << i)) out |= 1 << sym[i];
  return out;
}

export function canonical(m) {
  return Math.min(...SYMMETRIES.map((s) => transformMask(m, s)));
}

// 將完整開局的第一步依對稱分類，並列出後手的致勝回應
export function firstMoveAnalysis() {
  const classes = new Map();
  for (const mv of legalMoves(FULL)) {
    const key = canonical(mv);
    if (!classes.has(key)) classes.set(key, []);
    classes.get(key).push(mv);
  }
  return [...classes.values()].map((members) => {
    const rep = members.reduce((a, b) => (maskToNumbers(a).join() <= maskToNumbers(b).join() ? a : b));
    const after = FULL ^ rep;
    return {
      move: rep,
      size: bitCount(rep),
      members,
      firstWins: !WIN[after],
      replies: winningMoves(after),
    };
  }).sort((a, b) => a.size - b.size || maskToNumbers(a.move)[0] - maskToNumbers(b.move)[0]);
}
