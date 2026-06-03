const hands = {
  rock: { label: "グー", icon: "✊", beats: "scissors" },
  scissors: { label: "チョキ", icon: "✌", beats: "paper" },
  paper: { label: "パー", icon: "✋", beats: "rock" },
};

const calls = ["最初はグー", "じゃんけん...", "ぽん!"];
const roundDelay = 2200;
let room = null;
let roomId = "";
let playerId = "";
let callTimer = null;
let channel = null;
let db = null;
let unsubscribeRoom = null;
let cloudReady = false;

const lobby = document.querySelector("#lobby");
const roomView = document.querySelector("#room");
const nameInput = document.querySelector("#nameInput");
const roomInput = document.querySelector("#roomInput");
const createRoomButton = document.querySelector("#createRoomButton");
const joinRoomButton = document.querySelector("#joinRoomButton");
const roomCode = document.querySelector("#roomCode");
const syncStatus = document.querySelector("#syncStatus");
const shareLink = document.querySelector("#shareLink");
const qrCanvas = document.querySelector("#qrCanvas");
const copyButton = document.querySelector("#copyButton");
const leaveButton = document.querySelector("#leaveButton");
const callText = document.querySelector("#callText");
const roundMessage = document.querySelector("#roundMessage");
const playersArea = document.querySelector("#players");
const myStatus = document.querySelector("#myStatus");
const choices = document.querySelectorAll(".choice");
const nextButton = document.querySelector("#nextButton");
const resetButton = document.querySelector("#resetButton");

function storageKey(id) {
  return `janken-room-${id}`;
}

function makeId(size = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: size }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function normalizeRoomId(id) {
  return id.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 8);
}

function getShareUrl(id) {
  const base = location.href.split("#")[0];
  return `${base}#room=${id}`;
}

async function initCloud() {
  const config = window.JANKEN_FIREBASE_CONFIG;
  cloudReady = Boolean(config?.apiKey && config?.projectId && window.firebase?.firestore);
  if (!cloudReady) return false;
  if (!window.firebase.apps.length) window.firebase.initializeApp(config);
  db = window.firebase.firestore();
  return true;
}

async function loadRoom(id) {
  if (cloudReady) {
    const snapshot = await db.collection("jankenRooms").doc(id).get();
    return snapshot.exists ? snapshot.data() : null;
  }
  const saved = localStorage.getItem(storageKey(id));
  return saved ? JSON.parse(saved) : null;
}

async function saveRoom(nextRoom) {
  room = nextRoom;
  if (cloudReady) {
    await db.collection("jankenRooms").doc(room.id).set(JSON.parse(JSON.stringify(room)));
  } else {
    localStorage.setItem(storageKey(room.id), JSON.stringify(room));
    channel?.postMessage({ roomId: room.id });
  }
  render();
}

function createRoom(id) {
  return {
    id,
    createdAt: Date.now(),
    round: 1,
    status: "choosing",
    revealAt: 0,
    scored: false,
    players: [],
  };
}

function getName() {
  return nameInput.value.trim() || `プレイヤー${Math.floor(Math.random() * 90) + 10}`;
}

async function joinRoom(id) {
  roomId = normalizeRoomId(id);
  if (!roomId) return;
  await initCloud();
  room = (await loadRoom(roomId)) || createRoom(roomId);
  playerId = sessionStorage.getItem(`janken-player-${roomId}`) || makeId(10);
  sessionStorage.setItem(`janken-player-${roomId}`, playerId);

  if (!room.players.some((player) => player.id === playerId)) {
    room.players.push({ id: playerId, name: getName(), hand: null, score: 0 });
  }

  history.replaceState(null, "", getShareUrl(roomId));
  setupSync();
  await saveRoom(room);
}

function setupSync() {
  unsubscribeRoom?.();
  unsubscribeRoom = null;
  channel?.close();
  channel = null;

  if (cloudReady) {
    unsubscribeRoom = db.collection("jankenRooms").doc(roomId).onSnapshot((snapshot) => {
      if (!snapshot.exists) return;
      room = snapshot.data();
      render();
    });
    return;
  }

  channel = "BroadcastChannel" in window ? new BroadcastChannel(`janken-${roomId}`) : null;
  if (!channel) return;
  channel.onmessage = () => {
    const latest = localStorage.getItem(storageKey(roomId));
    if (!latest) return;
    room = JSON.parse(latest);
    render();
  };
}

function visiblePlayers() {
  return room.players.filter((player) => player.name);
}

function currentPlayer() {
  return room.players.find((player) => player.id === playerId);
}

async function chooseHand(hand) {
  const player = currentPlayer();
  if (!player || player.hand || room.status !== "choosing") return;

  player.hand = hand;
  if (visiblePlayers().length >= 2 && visiblePlayers().every((item) => item.hand)) {
    room.status = "countdown";
    room.revealAt = Date.now() + roundDelay;
    room.scored = false;
  }
  await saveRoom(room);
}

function judgeRound(players) {
  const unique = [...new Set(players.map((player) => player.hand))];
  if (unique.length !== 2) return [];

  const winnerHand = hands[unique[0]].beats === unique[1] ? unique[0] : unique[1];
  return players.filter((player) => player.hand === winnerHand);
}

async function finishRound() {
  if (!room || room.status !== "countdown" || room.scored || Date.now() < room.revealAt) return;

  const players = visiblePlayers();
  const winners = judgeRound(players);
  winners.forEach((winner) => {
    winner.score += 1;
  });
  room.status = "revealed";
  room.scored = true;
  await saveRoom(room);
}

async function nextRound() {
  room.round += 1;
  room.status = "choosing";
  room.revealAt = 0;
  room.scored = false;
  room.players.forEach((player) => {
    player.hand = null;
  });
  await saveRoom(room);
}

async function resetScores() {
  room.players.forEach((player) => {
    player.score = 0;
  });
  await nextRound();
}

function renderPlayer(player) {
  const isMe = player.id === playerId;
  const selected = Boolean(player.hand);
  const showHand = room.status === "revealed" || isMe;
  const handText = selected && showHand ? hands[player.hand].icon : selected ? "選択中" : "待機中";
  const stateClass = selected ? "is-ready" : "is-waiting";

  return `
    <article class="player-card ${stateClass} ${isMe ? "is-me" : ""}">
      <div>
        <span class="name">${player.name}${isMe ? " / あなた" : ""}</span>
        <strong>${player.score}</strong>
      </div>
      <span class="player-hand">${handText}</span>
    </article>
  `;
}

function renderCall() {
  clearTimeout(callTimer);
  callText.className = "call-text";

  if (visiblePlayers().length < 2) {
    callText.textContent = "待機中";
    roundMessage.textContent = "2人以上集まったら始められます。";
    return;
  }

  if (room.status === "choosing") {
    const ready = visiblePlayers().filter((player) => player.hand).length;
    callText.textContent = "選択中";
    roundMessage.textContent = `${ready} / ${visiblePlayers().length} 人が選択済み`;
    return;
  }

  if (room.status === "countdown") {
    const remaining = Math.max(0, room.revealAt - Date.now());
    const index = Math.min(calls.length - 1, Math.floor((roundDelay - remaining) / 730));
    callText.textContent = calls[index];
    callText.classList.add("is-counting");
    roundMessage.textContent = "全員の手がそろいました。";
    callTimer = setTimeout(() => {
      if (remaining <= 0) finishRound();
      render();
    }, remaining > 0 ? 180 : 0);
    return;
  }

  const winners = judgeRound(visiblePlayers());
  callText.textContent = winners.length ? `${winners.map((winner) => winner.name).join("、")} の勝ち!` : "あいこ";
  callText.classList.add(winners.some((winner) => winner.id === playerId) ? "is-win" : "is-draw");
  roundMessage.textContent = `第${room.round}回戦の結果`;
}

function renderQr(text) {
  const modules = makeQr(text);
  const ctx = qrCanvas.getContext("2d");
  const quiet = 4;
  const cells = modules.length + quiet * 2;
  const size = qrCanvas.width / cells;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
  ctx.fillStyle = "#202124";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        ctx.fillRect((x + quiet) * size, (y + quiet) * size, Math.ceil(size), Math.ceil(size));
      }
    });
  });
}

function makeQr(text) {
  const size = 21;
  const matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const codewords = makeCodewords(text.toUpperCase());
  const bits = codewords.flatMap((word) =>
    Array.from({ length: 8 }, (_, index) => Boolean((word >> (7 - index)) & 1)),
  );

  function set(x, y, dark, reserve = true) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    matrix[y][x] = dark;
    if (reserve) reserved[y][x] = true;
  }

  function finder(x, y) {
    for (let yy = -1; yy <= 7; yy += 1) {
      for (let xx = -1; xx <= 7; xx += 1) {
        const edge = xx === 0 || yy === 0 || xx === 6 || yy === 6;
        const center = xx >= 2 && xx <= 4 && yy >= 2 && yy <= 4;
        set(x + xx, y + yy, edge || center);
      }
    }
  }

  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 8; i < size - 8; i += 1) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  set(8, 13, true);
  reserveFormat(reserved);
  placeData(matrix, reserved, bits);
  applyMask(matrix, reserved);
  placeFormat(matrix);
  return matrix;
}

function makeCodewords(text) {
  const alpha = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  const bits = [0, 0, 1, 0, ...toBits(text.length, 9)];

  for (let i = 0; i < text.length; i += 2) {
    if (i + 1 < text.length) {
      bits.push(...toBits(alpha.indexOf(text[i]) * 45 + alpha.indexOf(text[i + 1]), 11));
    } else {
      bits.push(...toBits(alpha.indexOf(text[i]), 6));
    }
  }

  for (let i = 0; i < 4 && bits.length < 128; i += 1) bits.push(0);
  while (bits.length < 128 && bits.length % 8 !== 0) bits.push(0);
  while (bits.length < 128) bits.push(...toBits(bits.length % 16 === 0 ? 0xec : 0x11, 8));

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(parseInt(bits.slice(i, i + 8).map(Number).join(""), 2));
  }
  return [...data, ...reedSolomon(data, 10)];
}

function toBits(value, length) {
  return Array.from({ length }, (_, index) => Boolean((value >> (length - 1 - index)) & 1));
}

function gfMul(a, b) {
  let result = 0;
  for (; b; b >>= 1) {
    if (b & 1) result ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return result;
}

function gfPow(power) {
  let value = 1;
  for (let i = 0; i < power; i += 1) value = gfMul(value, 2);
  return value;
}

function reedSolomon(data, count) {
  let generator = [1];
  for (let i = 0; i < count; i += 1) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= gfMul(coefficient, gfPow(i));
    });
    generator = next;
  }

  const buffer = [...data, ...Array(count).fill(0)];
  data.forEach((_, index) => {
    const factor = buffer[index];
    if (!factor) return;
    generator.forEach((coefficient, offset) => {
      buffer[index + offset] ^= gfMul(coefficient, factor);
    });
  });
  return buffer.slice(-count);
}

function reserveFormat(reserved) {
  for (let i = 0; i < 9; i += 1) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[20 - i][8] = true;
    reserved[8][20 - i] = true;
  }
}

function placeData(matrix, reserved, bits) {
  let index = 0;
  let up = true;
  for (let x = 20; x > 0; x -= 2) {
    if (x === 6) x -= 1;
    for (let row = 0; row < 21; row += 1) {
      const y = up ? 20 - row : row;
      for (let offset = 0; offset < 2; offset += 1) {
        const xx = x - offset;
        if (!reserved[y][xx]) {
          matrix[y][xx] = bits[index] || false;
          index += 1;
        }
      }
    }
    up = !up;
  }
}

function applyMask(matrix, reserved) {
  for (let y = 0; y < 21; y += 1) {
    for (let x = 0; x < 21; x += 1) {
      if (!reserved[y][x] && (x + y) % 2 === 0) matrix[y][x] = !matrix[y][x];
    }
  }
}

function placeFormat(matrix) {
  const format = 0x5412;
  const bit = (index) => Boolean((format >> index) & 1);
  for (let i = 0; i < 15; i += 1) {
    if (i < 6) matrix[i][8] = bit(i);
    else if (i < 8) matrix[i + 1][8] = bit(i);
    else matrix[8][i === 8 ? 7 : 14 - i] = bit(i);

    if (i < 8) matrix[20 - i][8] = bit(i);
    else matrix[13 + i - 7][8] = bit(i);
  }
}

function render() {
  if (!room) return;
  lobby.classList.add("hidden");
  roomView.classList.remove("hidden");

  const url = getShareUrl(room.id);
  roomCode.textContent = room.id;
  syncStatus.textContent = cloudReady ? "クラウド同期" : "ローカル";
  syncStatus.classList.toggle("is-cloud", cloudReady);
  shareLink.textContent = url;
  shareLink.href = url;
  playersArea.innerHTML = visiblePlayers().map(renderPlayer).join("");
  renderQr(room.id);
  renderCall();

  const me = currentPlayer();
  myStatus.textContent = me?.hand ? hands[me.hand].label : "未選択";
  choices.forEach((button) => {
    const locked = me?.hand === button.dataset.hand;
    button.disabled = Boolean(me?.hand) || room.status !== "choosing";
    button.classList.toggle("locked", locked);
  });
}

createRoomButton.addEventListener("click", () => joinRoom(makeId()));
joinRoomButton.addEventListener("click", () => {
  const id = roomInput.value.trim();
  if (id) joinRoom(id);
});
choices.forEach((button) => button.addEventListener("click", () => chooseHand(button.dataset.hand)));
nextButton.addEventListener("click", nextRound);
resetButton.addEventListener("click", resetScores);
leaveButton.addEventListener("click", () => {
  unsubscribeRoom?.();
  channel?.close();
  location.hash = "";
  location.reload();
});
copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard?.writeText(getShareUrl(room.id));
    copyButton.textContent = "コピー済み";
  } catch {
    copyButton.textContent = "リンク表示中";
  }
  setTimeout(() => {
    copyButton.textContent = "コピー";
  }, 1200);
});

const initialRoom = new URLSearchParams(location.hash.replace(/^#/, "")).get("room");
if (initialRoom) {
  roomInput.value = initialRoom;
  joinRoom(initialRoom);
}
