import * as core from './core.js';

const { FULL, CELLS, N } = core;
const $ = (sel) => document.querySelector(sel);
const STORAGE_KEY = 'triangle-nim.records';
const SVG_NS = 'http://www.w3.org/2000/svg';

const nums = (m) => core.maskToNumbers(m).join('、');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ---------- 棋盤繪製 ----------
const SQRT3 = Math.sqrt(3);
const POS = CELLS.map(({ r, c }) => ({ x: (c - r / 2) * 2, y: r * SQRT3 }));

function createBoard(svg, onTap) {
  const pad = 1.15;
  svg.setAttribute('viewBox', `${-4 - pad} ${-pad} ${8 + 2 * pad} ${4 * SQRT3 + 2 * pad}`);
  const cells = [];
  for (let i = 0; i < N; i++) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'cell');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `第 ${i + 1} 號`);
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', POS[i].x);
    circle.setAttribute('cy', POS[i].y);
    circle.setAttribute('r', 0.94);
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', POS[i].x);
    text.setAttribute('y', POS[i].y);
    text.textContent = i + 1;
    g.append(circle, text);
    if (onTap) g.addEventListener('click', () => onTap(i));
    svg.append(g);
    cells.push(g);
  }
  return {
    render({ board, selected = 0, last = 0, hint = 0, locked = false }) {
      svg.classList.toggle('locked', locked);
      cells.forEach((g, i) => {
        const b = 1 << i;
        g.classList.toggle('taken', !(board & b));
        g.classList.toggle('selected', !!(selected & b));
        g.classList.toggle('last', !!(last & b));
        g.classList.toggle('hint', !!(hint & b));
        g.setAttribute('aria-pressed', selected & b ? 'true' : 'false');
      });
    },
  };
}

// ---------- 紀錄存取 ----------
function loadRecords() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(list) ? list.filter(core.validateRecord) : [];
  } catch {
    return [];
  }
}
function saveRecords(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    alert('無法儲存紀錄：' + e.message);
  }
}

const MODE_LABEL = { pvp: '雙人對戰', ai: '人機對戰' };
const DIFF_LABEL = { easy: '簡單', hard: '困難' };
const fmtDate = (iso) => new Date(iso).toLocaleString('zh-TW', { hour12: false });

// ---------- 分頁 ----------
const views = ['play', 'records', 'replay', 'study', 'rules'];
function showView(name) {
  if (!views.includes(name)) name = 'play';
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name !== 'replay') replay.pause();
  if (name === 'records') renderRecords();
  if (name === 'study') renderStudy();
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ---------- 對戰 ----------
const game = {
  rec: null,
  board: FULL,
  turn: 0,
  selected: 0,
  last: 0,
  hint: 0,
  aiPlayer: null,
  difficulty: null,
  over: true,
  aiTimer: null,
};
const playBoard = createBoard($('#board'), onCellTap);

function setupMode() {
  const mode = document.querySelector('input[name=mode]:checked').value;
  document.querySelectorAll('.only-ai').forEach((el) => (el.hidden = mode !== 'ai'));
  document.querySelectorAll('.only-pvp').forEach((el) => (el.hidden = mode !== 'pvp'));
}
document.querySelectorAll('input[name=mode]').forEach((el) => el.addEventListener('change', setupMode));

function newGame() {
  clearTimeout(game.aiTimer);
  const mode = document.querySelector('input[name=mode]:checked').value;
  let players, aiPlayer = null, difficulty = null;
  if (mode === 'ai') {
    difficulty = document.querySelector('input[name=difficulty]:checked').value;
    const humanFirst = document.querySelector('input[name=first]:checked').value === 'human';
    const cpu = `電腦（${DIFF_LABEL[difficulty]}）`;
    players = humanFirst ? ['你', cpu] : [cpu, '你'];
    aiPlayer = humanFirst ? 1 : 0;
  } else {
    players = [$('#name0').value.trim() || '玩家一', $('#name1').value.trim() || '玩家二'];
    if (players[0] === players[1]) players[1] += '（2）';
  }
  game.rec = core.createRecord({ mode, players, firstPlayer: 0, difficulty });
  game.rec.aiPlayer = aiPlayer;
  Object.assign(game, { board: FULL, turn: 0, selected: 0, last: 0, hint: 0, aiPlayer, difficulty, over: false });
  $('#setup').open = false;
  setHint('');
  updatePlay();
  maybeAiMove();
}

function isHumanTurn() {
  return !game.over && game.turn !== game.aiPlayer;
}

function setHint(text, error = false) {
  const el = $('#hint-line');
  el.textContent = text;
  el.classList.toggle('error', error);
}

function onCellTap(i) {
  if (!isHumanTurn()) return;
  const b = 1 << i;
  if (!(game.board & b)) return;
  game.hint = 0;
  if (game.selected & b) game.selected ^= b;
  else if (core.bitCount(game.selected) >= 3) {
    setHint('一次最多取 3 顆', true);
    return;
  } else game.selected |= b;
  validateSelection();
  updatePlay();
}

function validateSelection() {
  const s = game.selected;
  if (!s) setHint('');
  else if (!core.isConnected(s)) setHint(`已選 ${nums(s)}：選取的圓必須彼此相連`, true);
  else setHint(`已選 ${nums(s)}（${core.bitCount(s)} 顆）`);
}

function applyMove(mv) {
  core.addMove(game.rec, game.turn, mv);
  game.board ^= mv;
  game.last = mv;
  game.selected = 0;
  game.hint = 0;
  if (game.board === 0) {
    game.over = true;
    game.rec.winner = 1 - game.turn;
    const list = loadRecords();
    list.unshift(game.rec);
    saveRecords(list);
    updatePlay();
    showEndDialog();
    return;
  }
  game.turn = 1 - game.turn;
  updatePlay();
  maybeAiMove();
}

function maybeAiMove() {
  if (game.over || game.turn !== game.aiPlayer) return;
  game.aiTimer = setTimeout(() => {
    const mv = game.difficulty === 'hard' ? core.bestMove(game.board) : core.randomMove(game.board);
    setHint(`電腦取走 ${nums(mv)}`);
    applyMove(mv);
  }, 700);
}

function updatePlay() {
  const { rec } = game;
  playBoard.render({ board: game.board, selected: game.selected, last: game.last, hint: game.hint, locked: !isHumanTurn() });
  const remain = core.bitCount(game.board);
  let status;
  if (!rec) status = '按「開始新局」開始遊戲';
  else if (game.over) status = `遊戲結束：${rec.players[rec.winner]} 獲勝！`;
  else if (game.turn === game.aiPlayer) status = `電腦思考中…（剩 ${remain} 顆）`;
  else status = `輪到 ${rec.players[game.turn]}（剩 ${remain} 顆）`;
  $('#status').textContent = status;
  const canAct = isHumanTurn();
  $('#btn-take').disabled = !(canAct && game.selected && core.isLegalMove(game.board, game.selected));
  $('#btn-clear').disabled = !(canAct && game.selected);
  $('#btn-hint').disabled = !canAct;
  const ol = $('#play-moves');
  ol.innerHTML = rec
    ? rec.moves.map((m) => `<li>${escapeHtml(rec.players[m.player])} 取 ${m.count} 顆：${m.circles.join('、')}</li>`).join('')
    : '';
}

$('#btn-new').addEventListener('click', newGame);
$('#btn-take').addEventListener('click', () => {
  if (isHumanTurn() && core.isLegalMove(game.board, game.selected)) {
    setHint('');
    applyMove(game.selected);
  }
});
$('#btn-clear').addEventListener('click', () => {
  game.selected = 0;
  setHint('');
  updatePlay();
});
$('#btn-hint').addEventListener('click', () => {
  if (!isHumanTurn()) return;
  const wins = core.winningMoves(game.board);
  if (wins.length) {
    const mv = wins[Math.floor(Math.random() * wins.length)];
    game.hint = mv;
    setHint(`必勝局面！共 ${wins.length} 種致勝走法，例如取 ${nums(mv)}`);
  } else {
    const mv = core.bestMove(game.board);
    game.hint = mv;
    setHint(`必敗局面：對手完美應對你就會輸。建議取 ${nums(mv)} 讓對手最難找到正解`);
  }
  updatePlay();
});

function showEndDialog() {
  const { rec } = game;
  const winner = rec.players[rec.winner];
  const loser = rec.players[1 - rec.winner];
  $('#end-title').textContent = rec.mode === 'ai' ? (rec.winner === rec.aiPlayer ? '電腦獲勝' : '你贏了！') : `${winner} 獲勝！`;
  $('#end-text').textContent = `${loser} 拿走了最後一顆。共 ${rec.moves.length} 步，紀錄已自動儲存。`;
  const dlg = $('#end-dialog');
  dlg.returnValue = '';
  dlg.showModal();
}
$('#end-dialog').addEventListener('close', () => {
  const v = $('#end-dialog').returnValue;
  if (v === 'replay') {
    replay.load(game.rec);
    showView('replay');
  } else if (v === 'again') newGame();
});

// ---------- 紀錄 ----------
function renderRecords() {
  const list = loadRecords();
  $('#records-empty').hidden = list.length > 0;
  const ul = $('#records-list');
  ul.innerHTML = '';
  for (const rec of list) {
    const li = document.createElement('li');
    const mode = rec.mode === 'ai' ? `${MODE_LABEL.ai}・${DIFF_LABEL[rec.difficulty] || ''}` : MODE_LABEL.pvp;
    li.innerHTML = `
      <div class="meta">
        <strong>${escapeHtml(rec.players[0])}（先）vs ${escapeHtml(rec.players[1])}（後）</strong>
        <small>${fmtDate(rec.date)}・${mode}・${rec.moves.length} 步・勝者：${escapeHtml(rec.players[rec.winner] ?? '未完')}</small>
      </div>
      <div class="btns">
        <button class="small primary" data-act="view">複盤</button>
        <button class="small danger" data-act="del">刪除</button>
      </div>`;
    li.querySelector('[data-act=view]').addEventListener('click', () => {
      replay.load(rec);
      showView('replay');
    });
    li.querySelector('[data-act=del]').addEventListener('click', () => {
      if (!confirm('確定刪除這筆紀錄？')) return;
      saveRecords(loadRecords().filter((r) => r.id !== rec.id));
      if (replay.rec && replay.rec.id === rec.id) replay.load(null);
      renderRecords();
    });
    ul.append(li);
  }
}

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([core.exportRecords(loadRecords())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `triangle-nim-records-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const incoming = core.importRecords(await file.text());
    const list = loadRecords();
    const ids = new Set(list.map((r) => r.id));
    const added = incoming.filter((r) => !ids.has(r.id));
    const merged = [...list, ...added].sort((a, b) => b.date.localeCompare(a.date));
    saveRecords(merged);
    alert(`匯入 ${added.length} 筆新紀錄`);
    renderRecords();
  } catch (err) {
    alert('匯入失敗：' + err.message);
  }
});
$('#btn-clear-all').addEventListener('click', () => {
  if (!confirm('確定刪除全部紀錄？此動作無法復原。')) return;
  saveRecords([]);
  replay.load(null);
  renderRecords();
});

// ---------- 複盤 ----------
const replayBoard = createBoard($('#replay-board'));
const replay = {
  rec: null,
  boards: [],
  step: 0,
  timer: null,

  load(rec) {
    this.pause();
    this.rec = rec;
    this.boards = rec ? core.replayBoards(rec) : [];
    this.step = 0;
    $('#replay-empty').hidden = !!rec;
    $('#replay-body').hidden = !rec;
    if (!rec) return;
    const mode = rec.mode === 'ai' ? `${MODE_LABEL.ai}・${DIFF_LABEL[rec.difficulty] || ''}` : MODE_LABEL.pvp;
    $('#replay-info').innerHTML = `<strong>${escapeHtml(rec.players[0])}（先）vs ${escapeHtml(rec.players[1])}（後）</strong><br>
      <span class="muted">${fmtDate(rec.date)}・${mode}・勝者：${escapeHtml(rec.players[rec.winner] ?? '未完')}</span>`;
    this.renderMoves();
    this.render();
  },

  go(step) {
    if (!this.rec) return;
    this.step = Math.max(0, Math.min(this.rec.moves.length, step));
    this.render();
  },

  renderMoves() {
    const { rec, boards } = this;
    const analysis = $('#rp-analysis').checked;
    const items = [`<li class="start" data-step="0">開局（15 顆）</li>`];
    rec.moves.forEach((m, i) => {
      let tags = '';
      if (analysis) {
        const before = core.isWinning(boards[i]);
        const after = core.isWinning(boards[i + 1]);
        tags = `<span class="tag ${before ? 'win' : 'lose'}">走前${before ? '必勝' : '必敗'}</span>`;
        if (before && after) tags += ` <span class="tag mistake">失誤</span>`;
      }
      items.push(`<li data-step="${i + 1}">${escapeHtml(rec.players[m.player])} 取 ${m.count} 顆：${m.circles.join('、')} ${tags}</li>`);
    });
    const ol = $('#replay-moves');
    ol.innerHTML = items.join('');
    ol.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
      this.pause();
      this.go(Number(li.dataset.step));
    }));
  },

  render() {
    const { rec, boards, step } = this;
    const n = rec.moves.length;
    const board = boards[step];
    const last = step > 0 ? core.numbersToMask(rec.moves[step - 1].circles) : 0;
    replayBoard.render({ board, last, locked: true });
    let text;
    if (step === 0) text = `開局（共 ${n} 步）`;
    else {
      const m = rec.moves[step - 1];
      text = `第 ${step} / ${n} 步：${rec.players[m.player]} 取走 ${m.circles.join('、')}`;
    }
    if (step === n && rec.winner !== null) text += `　→ ${rec.players[rec.winner]} 獲勝`;
    else if ($('#rp-analysis').checked) {
      const mover = step < n ? rec.moves[step].player : step === 0 ? 0 : 1 - rec.moves[step - 1].player;
      const wins = core.winningMoves(board);
      text += `　｜輪到 ${rec.players[mover]}：${wins.length ? `必勝（致勝走法 ${wins.length} 種，如 ${nums(wins[0])}）` : '必敗'}`;
    }
    $('#replay-status').textContent = text;
    $('#rp-start').disabled = $('#rp-prev').disabled = step === 0;
    $('#rp-end').disabled = $('#rp-next').disabled = step === n;
    document.querySelectorAll('#replay-moves li').forEach((li) => li.classList.toggle('current', Number(li.dataset.step) === step));
    const cur = document.querySelector('#replay-moves li.current');
    if (cur && document.getElementById('view-replay').classList.contains('active')) cur.scrollIntoView({ block: 'nearest' });
  },

  play() {
    if (!this.rec) return;
    if (this.step >= this.rec.moves.length) this.go(0);
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.step >= this.rec.moves.length) return this.pause();
      this.go(this.step + 1);
      if (this.step >= this.rec.moves.length) this.pause();
    }, Number($('#rp-interval').value));
    $('#rp-auto').textContent = '⏸ 暫停';
  },

  pause() {
    clearInterval(this.timer);
    this.timer = null;
    $('#rp-auto').textContent = '▶ 自動播放';
  },
};

$('#rp-start').addEventListener('click', () => { replay.pause(); replay.go(0); });
$('#rp-prev').addEventListener('click', () => { replay.pause(); replay.go(replay.step - 1); });
$('#rp-next').addEventListener('click', () => { replay.pause(); replay.go(replay.step + 1); });
$('#rp-end').addEventListener('click', () => { replay.pause(); replay.go(Infinity); });
$('#rp-auto').addEventListener('click', () => (replay.timer ? replay.pause() : replay.play()));
$('#rp-interval').addEventListener('change', () => { if (replay.timer) replay.play(); });
$('#rp-analysis').addEventListener('change', () => {
  if (!replay.rec) return;
  replay.renderMoves();
  replay.render();
});
document.addEventListener('keydown', (e) => {
  if (!$('#view-replay').classList.contains('active') || !replay.rec) return;
  if (e.key === 'ArrowLeft') { replay.pause(); replay.go(replay.step - 1); }
  if (e.key === 'ArrowRight') { replay.pause(); replay.go(replay.step + 1); }
});

// ---------- 先後手研究 ----------
let studyRendered = false;
function renderStudy() {
  if (studyRendered) return;
  studyRendered = true;
  const startWin = core.isWinning(FULL);
  const firstWins = core.winningMoves(FULL);
  const stats = core.statsByCount();
  const classes = core.firstMoveAnalysis();
  const verdict = startWin ? '先手必勝' : '後手必勝';
  const fmtMoves = (list) => list.map((m) => nums(m)).join('；');

  $('#study').innerHTML = `
    <div class="card prose">
      <h2>結論</h2>
      <p class="verdict">${verdict}</p>
      <p>在雙方都完美下法的前提下，完整的 15 顆開局是<strong>${startWin ? '先手' : '後手'}</strong>的必勝局。
      ${startWin
        ? `先手的必勝第一步共 ${firstWins.length} 種：${fmtMoves(firstWins)}。`
        : `先手的 115 種合法第一步<strong>全部</strong>會落入後手的必勝局面——<strong>沒有任何必勝的第一步</strong>。不論先手怎麼開局，後手都至少有一種致勝回應（見下表）。`}
      </p>
      <p class="muted">想親自驗證？到「對戰」選人機對戰、我先手、難度「困難」，你將無法獲勝。</p>
    </div>

    <div class="card prose">
      <h2>研究方法</h2>
      <ol>
        <li>15 顆圓各用 1 個位元表示是否還在，整個局面就是一個 15 位元整數，共 2<sup>15</sup> = 32768 種局面。</li>
        <li>預先列出所有可一次取走的組合：大小 1–3 且在六方向鄰接下相連的子集，共 115 種（1 顆 15 種、2 顆 30 種、3 顆 70 種，其中 16 種為小三角形）。</li>
        <li>定義 W(局面) = 輪到走的一方能否必勝。因為拿最後一顆的人輸，W(空盤) = 必勝（對手剛拿走最後一顆）。</li>
        <li>對其他局面：只要存在某個合法取法讓對手落入必敗局面，W 就是必勝；否則必敗。每次取子都讓位元數變少，所以由小到大依序計算即可，不會遺漏或循環。</li>
        <li>程式中另寫了一個完全獨立的遞迴版本，單元測試確認兩者在全部 32768 個局面結果一致，並驗證六種三角形對稱不改變勝負。</li>
      </ol>
    </div>

    <div class="card prose">
      <h2>先手第一步 vs 後手致勝回應</h2>
      <p class="muted">115 種第一步依三角形的旋轉／翻轉對稱歸成 ${classes.length} 類，每類列出代表走法、同類數量與後手所有致勝回應。</p>
      <div class="table-scroll">
        <table class="first-moves">
          <thead><tr><th>先手取</th><th>同類</th><th>結果</th><th>後手致勝回應</th></tr></thead>
          <tbody>${classes.map((c) => `
            <tr>
              <td>${nums(c.move)}</td>
              <td>${c.members.length}</td>
              <td>${c.firstWins ? '<span class="tag win">先手勝</span>' : '<span class="tag lose">先手敗</span>'}</td>
              <td>${c.replies.length} 種：${fmtMoves(c.replies)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card prose">
      <h2>依剩餘顆數的勝負局面統計</h2>
      <p class="muted">「必勝」「必敗」都是對「輪到走的一方」而言。</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>剩餘顆數</th><th>局面數</th><th>必勝</th><th>必敗</th><th>必敗比例</th></tr></thead>
          <tbody>${stats.map((s) => `
            <tr><td>${s.remaining}</td><td>${s.total}</td><td>${s.win}</td><td>${s.lose}</td><td>${((s.lose / s.total) * 100).toFixed(1)}%</td></tr>`).join('')}
            <tr><th>合計</th><th>${stats.reduce((a, s) => a + s.total, 0)}</th><th>${stats.reduce((a, s) => a + s.win, 0)}</th><th>${stats.reduce((a, s) => a + s.lose, 0)}</th><th></th></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

// ---------- 啟動 ----------
setupMode();
updatePlay();
replay.load(null);
showView(location.hash.slice(1) || 'play');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
