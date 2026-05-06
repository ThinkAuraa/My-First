const boardEl = document.querySelector("#board");
const statusEl = document.querySelector("#status");
const moveListEl = document.querySelector("#moveList");
const whiteCapturedEl = document.querySelector("#whiteCaptured");
const blackCapturedEl = document.querySelector("#blackCaptured");
const newGameButton = document.querySelector("#newGameButton");
const soundButton = document.querySelector("#soundButton");
const promotionDialog = document.querySelector("#promotionDialog");

const symbols = {
  wp: "♙",
  wr: "♖",
  wn: "♘",
  wb: "♗",
  wq: "♕",
  wk: "♔",
  bp: "♟",
  br: "♜",
  bn: "♞",
  bb: "♝",
  bq: "♛",
  bk: "♚"
};

const pieceNames = {
  p: "pawn",
  r: "rook",
  n: "knight",
  b: "bishop",
  q: "queen",
  k: "king"
};

let board;
let turn;
let selected;
let legalMoves;
let history;
let capturedByWhite;
let capturedByBlack;
let castleRights;
let enPassant;
let pendingPromotion;
let soundOn;
let audioContext;
let masterGain;

function newGame() {
  board = [
    ["br", "bn", "bb", "bq", "bk", "bb", "bn", "br"],
    ["bp", "bp", "bp", "bp", "bp", "bp", "bp", "bp"],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ["wp", "wp", "wp", "wp", "wp", "wp", "wp", "wp"],
    ["wr", "wn", "wb", "wq", "wk", "wb", "wn", "wr"]
  ];
  turn = "w";
  selected = null;
  legalMoves = [];
  history = [];
  capturedByWhite = [];
  capturedByBlack = [];
  castleRights = {
    w: { king: true, queen: true },
    b: { king: true, queen: true }
  };
  enPassant = null;
  pendingPromotion = null;
  soundOn = soundOn ?? true;
  promotionDialog.classList.add("hidden");
  render();
}

function render() {
  boardEl.innerHTML = "";
  const kingInCheck = findKing(turn);

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = document.createElement("button");
      const piece = board[row][col];
      const move = legalMoves.find((item) => item.toRow === row && item.toCol === col);
      square.type = "button";
      square.className = `square ${(row + col) % 2 ? "dark" : "light"}`;
      square.dataset.row = row;
      square.dataset.col = col;
      square.setAttribute("role", "gridcell");
      square.setAttribute("aria-label", squareLabel(row, col, piece));
      square.textContent = piece ? symbols[piece] : "";

      if (selected && selected.row === row && selected.col === col) {
        square.classList.add("selected");
      }
      if (move) {
        square.classList.add(move.capture ? "capture" : "legal");
      }
      if (kingInCheck && kingInCheck.row === row && kingInCheck.col === col && isInCheck(turn, board)) {
        square.classList.add("check");
      }

      square.addEventListener("click", () => onSquareClick(row, col));
      boardEl.appendChild(square);
    }
  }

  statusEl.textContent = getStatusText();
  whiteCapturedEl.textContent = capturedByWhite.map((piece) => symbols[piece]).join("");
  blackCapturedEl.textContent = capturedByBlack.map((piece) => symbols[piece]).join("");
  moveListEl.innerHTML = history.map((move) => `<li>${move}</li>`).join("");
  soundButton.textContent = soundOn ? "Sound on" : "Sound off";
  soundButton.setAttribute("aria-pressed", String(soundOn));
}

function onSquareClick(row, col) {
  unlockAudio();
  if (pendingPromotion) return;

  const piece = board[row][col];
  const move = legalMoves.find((item) => item.toRow === row && item.toCol === col);

  if (move && selected) {
    makeMove(move);
    return;
  }

  if (piece && piece[0] === turn) {
    selected = { row, col };
    legalMoves = getLegalMovesFor(row, col, board, turn);
  } else {
    selected = null;
    legalMoves = [];
  }
  render();
}

function makeMove(move, promotionType) {
  const movingPiece = board[move.fromRow][move.fromCol];
  const capturedPiece = move.enPassant ? board[move.fromRow][move.toCol] : board[move.toRow][move.toCol];
  const beforeTurn = turn;

  if (movingPiece[1] === "p" && (move.toRow === 0 || move.toRow === 7) && !promotionType) {
    pendingPromotion = move;
    promotionDialog.classList.remove("hidden");
    return;
  }

  board[move.fromRow][move.fromCol] = null;
  if (move.enPassant) {
    board[move.fromRow][move.toCol] = null;
  }
  board[move.toRow][move.toCol] = promotionType ? `${movingPiece[0]}${promotionType}` : movingPiece;

  if (move.castle) {
    const rookFromCol = move.toCol === 6 ? 7 : 0;
    const rookToCol = move.toCol === 6 ? 5 : 3;
    board[move.toRow][rookToCol] = board[move.toRow][rookFromCol];
    board[move.toRow][rookFromCol] = null;
  }

  updateCastleRights(movingPiece, move, capturedPiece);
  enPassant = movingPiece[1] === "p" && Math.abs(move.toRow - move.fromRow) === 2
    ? { row: (move.fromRow + move.toRow) / 2, col: move.fromCol }
    : null;

  if (capturedPiece) {
    if (beforeTurn === "w") capturedByWhite.push(capturedPiece);
    else capturedByBlack.push(capturedPiece);
    playFunkyCapture(capturedPiece);
  }

  history.push(formatMove(movingPiece, move, capturedPiece, promotionType));
  turn = opposite(turn);
  selected = null;
  legalMoves = [];
  pendingPromotion = null;
  promotionDialog.classList.add("hidden");
  render();
}

function getLegalMovesFor(row, col, currentBoard, color) {
  return getPseudoMoves(row, col, currentBoard)
    .filter((move) => {
      const testBoard = cloneBoard(currentBoard);
      applyMoveToBoard(testBoard, move);
      return !isInCheck(color, testBoard);
    });
}

function getAllLegalMoves(color, currentBoard) {
  const moves = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (currentBoard[row][col]?.[0] === color) {
        moves.push(...getLegalMovesFor(row, col, currentBoard, color));
      }
    }
  }
  return moves;
}

function getPseudoMoves(row, col, currentBoard) {
  const piece = currentBoard[row][col];
  if (!piece) return [];

  const color = piece[0];
  const type = piece[1];
  const moves = [];

  if (type === "p") addPawnMoves(row, col, color, currentBoard, moves);
  if (type === "n") addStepMoves(row, col, color, currentBoard, moves, [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]);
  if (type === "b") addSlideMoves(row, col, color, currentBoard, moves, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  if (type === "r") addSlideMoves(row, col, color, currentBoard, moves, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
  if (type === "q") addSlideMoves(row, col, color, currentBoard, moves, [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]);
  if (type === "k") {
    addStepMoves(row, col, color, currentBoard, moves, [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
    addCastleMoves(row, col, color, currentBoard, moves);
  }

  return moves;
}

function addPawnMoves(row, col, color, currentBoard, moves) {
  const direction = color === "w" ? -1 : 1;
  const startRow = color === "w" ? 6 : 1;
  const oneRow = row + direction;
  const twoRow = row + direction * 2;

  if (inBounds(oneRow, col) && !currentBoard[oneRow][col]) {
    moves.push(createMove(row, col, oneRow, col));
    if (row === startRow && !currentBoard[twoRow][col]) {
      moves.push(createMove(row, col, twoRow, col));
    }
  }

  for (const offset of [-1, 1]) {
    const targetCol = col + offset;
    if (!inBounds(oneRow, targetCol)) continue;

    const target = currentBoard[oneRow][targetCol];
    if (target && target[0] !== color) {
      moves.push(createMove(row, col, oneRow, targetCol, { capture: true }));
    }
    if (enPassant && enPassant.row === oneRow && enPassant.col === targetCol) {
      moves.push(createMove(row, col, oneRow, targetCol, { capture: true, enPassant: true }));
    }
  }
}

function addStepMoves(row, col, color, currentBoard, moves, offsets) {
  for (const [rowOffset, colOffset] of offsets) {
    const toRow = row + rowOffset;
    const toCol = col + colOffset;
    if (!inBounds(toRow, toCol)) continue;

    const target = currentBoard[toRow][toCol];
    if (!target || target[0] !== color) {
      moves.push(createMove(row, col, toRow, toCol, { capture: Boolean(target) }));
    }
  }
}

function addSlideMoves(row, col, color, currentBoard, moves, directions) {
  for (const [rowDirection, colDirection] of directions) {
    let toRow = row + rowDirection;
    let toCol = col + colDirection;

    while (inBounds(toRow, toCol)) {
      const target = currentBoard[toRow][toCol];
      if (!target) {
        moves.push(createMove(row, col, toRow, toCol));
      } else {
        if (target[0] !== color) {
          moves.push(createMove(row, col, toRow, toCol, { capture: true }));
        }
        break;
      }
      toRow += rowDirection;
      toCol += colDirection;
    }
  }
}

function addCastleMoves(row, col, color, currentBoard, moves) {
  if (row !== (color === "w" ? 7 : 0) || col !== 4 || isInCheck(color, currentBoard)) return;

  if (castleRights[color].king && !currentBoard[row][5] && !currentBoard[row][6]) {
    if (!isSquareAttacked(row, 5, opposite(color), currentBoard) && !isSquareAttacked(row, 6, opposite(color), currentBoard)) {
      moves.push(createMove(row, col, row, 6, { castle: true }));
    }
  }

  if (castleRights[color].queen && !currentBoard[row][1] && !currentBoard[row][2] && !currentBoard[row][3]) {
    if (!isSquareAttacked(row, 3, opposite(color), currentBoard) && !isSquareAttacked(row, 2, opposite(color), currentBoard)) {
      moves.push(createMove(row, col, row, 2, { castle: true }));
    }
  }
}

function createMove(fromRow, fromCol, toRow, toCol, extras = {}) {
  return { fromRow, fromCol, toRow, toCol, ...extras };
}

function applyMoveToBoard(targetBoard, move) {
  const piece = targetBoard[move.fromRow][move.fromCol];
  targetBoard[move.fromRow][move.fromCol] = null;
  if (move.enPassant) {
    targetBoard[move.fromRow][move.toCol] = null;
  }
  targetBoard[move.toRow][move.toCol] = piece;

  if (move.castle) {
    const rookFromCol = move.toCol === 6 ? 7 : 0;
    const rookToCol = move.toCol === 6 ? 5 : 3;
    targetBoard[move.toRow][rookToCol] = targetBoard[move.toRow][rookFromCol];
    targetBoard[move.toRow][rookFromCol] = null;
  }
}

function isInCheck(color, currentBoard) {
  const king = findKing(color, currentBoard);
  return king ? isSquareAttacked(king.row, king.col, opposite(color), currentBoard) : false;
}

function isSquareAttacked(row, col, byColor, currentBoard) {
  for (let fromRow = 0; fromRow < 8; fromRow += 1) {
    for (let fromCol = 0; fromCol < 8; fromCol += 1) {
      const piece = currentBoard[fromRow][fromCol];
      if (!piece || piece[0] !== byColor) continue;
      if (attacksSquare(fromRow, fromCol, row, col, currentBoard)) return true;
    }
  }
  return false;
}

function attacksSquare(fromRow, fromCol, targetRow, targetCol, currentBoard) {
  const piece = currentBoard[fromRow][fromCol];
  const color = piece[0];
  const type = piece[1];
  const rowDelta = targetRow - fromRow;
  const colDelta = targetCol - fromCol;

  if (type === "p") {
    const direction = color === "w" ? -1 : 1;
    return rowDelta === direction && Math.abs(colDelta) === 1;
  }
  if (type === "n") {
    return (Math.abs(rowDelta) === 2 && Math.abs(colDelta) === 1) || (Math.abs(rowDelta) === 1 && Math.abs(colDelta) === 2);
  }
  if (type === "k") {
    return Math.max(Math.abs(rowDelta), Math.abs(colDelta)) === 1;
  }
  if (type === "b") {
    return Math.abs(rowDelta) === Math.abs(colDelta) && pathIsClear(fromRow, fromCol, targetRow, targetCol, currentBoard);
  }
  if (type === "r") {
    return (rowDelta === 0 || colDelta === 0) && pathIsClear(fromRow, fromCol, targetRow, targetCol, currentBoard);
  }
  if (type === "q") {
    const straight = rowDelta === 0 || colDelta === 0;
    const diagonal = Math.abs(rowDelta) === Math.abs(colDelta);
    return (straight || diagonal) && pathIsClear(fromRow, fromCol, targetRow, targetCol, currentBoard);
  }
  return false;
}

function pathIsClear(fromRow, fromCol, targetRow, targetCol, currentBoard) {
  const rowStep = Math.sign(targetRow - fromRow);
  const colStep = Math.sign(targetCol - fromCol);
  let row = fromRow + rowStep;
  let col = fromCol + colStep;

  while (row !== targetRow || col !== targetCol) {
    if (currentBoard[row][col]) return false;
    row += rowStep;
    col += colStep;
  }
  return true;
}

function findKing(color, currentBoard = board) {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (currentBoard[row][col] === `${color}k`) return { row, col };
    }
  }
  return null;
}

function updateCastleRights(piece, move, capturedPiece) {
  const color = piece[0];
  if (piece[1] === "k") {
    castleRights[color].king = false;
    castleRights[color].queen = false;
  }
  if (piece[1] === "r") {
    if (move.fromCol === 0) castleRights[color].queen = false;
    if (move.fromCol === 7) castleRights[color].king = false;
  }
  if (capturedPiece?.[1] === "r") {
    const capturedColor = capturedPiece[0];
    if (move.toCol === 0) castleRights[capturedColor].queen = false;
    if (move.toCol === 7) castleRights[capturedColor].king = false;
  }
}

function getStatusText() {
  const colorName = turn === "w" ? "White" : "Black";
  const legal = getAllLegalMoves(turn, board);
  const check = isInCheck(turn, board);

  if (!legal.length && check) return `Checkmate. ${turn === "w" ? "Black" : "White"} wins`;
  if (!legal.length) return "Stalemate";
  if (check) return `${colorName} is in check`;
  return `${colorName} to move`;
}

function formatMove(piece, move, capturedPiece, promotionType) {
  const from = notation(move.fromRow, move.fromCol);
  const to = notation(move.toRow, move.toCol);
  const capture = capturedPiece ? ` takes ${pieceNames[capturedPiece[1]]}` : "";
  const promotion = promotionType ? ` promotes to ${pieceNames[promotionType]}` : "";
  return `${turn === "w" ? "White" : "Black"} ${pieceNames[piece[1]]} ${from}-${to}${capture}${promotion}`;
}

function notation(row, col) {
  return `${String.fromCharCode(97 + col)}${8 - row}`;
}

function squareLabel(row, col, piece) {
  const label = notation(row, col);
  return piece ? `${label}, ${piece[0] === "w" ? "white" : "black"} ${pieceNames[piece[1]]}` : `${label}, empty`;
}

function playFunkyCapture(capturedPiece) {
  if (!soundOn) return;
  unlockAudio();
  if (!audioContext) return;

  const now = audioContext.currentTime;
  const output = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  const shaper = audioContext.createWaveShaper();
  const pieceBoost = { p: 0, n: 40, b: 80, r: 120, q: 220, k: 300 }[capturedPiece[1]];
  const notes = [160 + pieceBoost, 220 + pieceBoost, 185 + pieceBoost, 310 + pieceBoost];

  shaper.curve = makeDistortionCurve(90);
  shaper.oversample = "4x";
  output.gain.setValueAtTime(0.0001, now);
  output.gain.exponentialRampToValueAtTime(0.72, now + 0.02);
  output.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(600, now);
  filter.frequency.exponentialRampToValueAtTime(2400 + pieceBoost, now + 0.35);
  filter.Q.value = 5;
  filter.connect(shaper);
  shaper.connect(output);
  output.connect(masterGain);

  notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = now + index * 0.07;
    oscillator.type = index % 2 ? "square" : "sawtooth";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.72, start + 0.11);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
    oscillator.connect(gain);
    gain.connect(filter);
    oscillator.start(start);
    oscillator.stop(start + 0.16);
  });
}

function unlockAudio() {
  if (!soundOn) return;
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.85;
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
}

function playTestChirp() {
  if (!soundOn) return;
  unlockAudio();
  if (!audioContext) return;

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(420, now);
  oscillator.frequency.exponentialRampToValueAtTime(760, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.28, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  oscillator.connect(gain);
  gain.connect(masterGain);
  oscillator.start(now);
  oscillator.stop(now + 0.2);
}

function makeDistortionCurve(amount) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / samples - 1;
    curve[index] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function cloneBoard(currentBoard) {
  return currentBoard.map((row) => [...row]);
}

function opposite(color) {
  return color === "w" ? "b" : "w";
}

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

promotionDialog.addEventListener("click", (event) => {
  unlockAudio();
  const button = event.target.closest("button[data-piece]");
  if (!button || !pendingPromotion) return;
  makeMove(pendingPromotion, button.dataset.piece);
});

newGameButton.addEventListener("click", newGame);
soundButton.addEventListener("click", () => {
  soundOn = !soundOn;
  render();
  playTestChirp();
});

newGame();
