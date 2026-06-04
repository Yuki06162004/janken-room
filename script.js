const hands = {
  rock: { label: "グー", icon: "✊", beats: "scissors" },
  scissors: { label: "チョキ", icon: "✌", beats: "paper" },
  paper: { label: "パー", icon: "✋", beats: "rock" },
};

const firstCalls = ["最初はグー", "じゃんけん...", "ぽん!"];
const aikoCalls = ["あいこで...", "しょ!"];
const roundDelay = 2200;
let room = null;
let roomId = "";
let playerId = "";
let callTimer = null;
let channel = null;
let db = null;
let unsubscribeRoom = null;
let cloudReady = false;
let wasLocked = false;
let moveTimer = null;
let callOverlayTimer = null;
let lastCallOverlayText = "";

const lobby = document.querySelector("#lobby");
const roomView = document.querySelector("#room");
const nameInput = document.querySelector("#nameInput");
const targetCountInput = document.querySelector("#targetCountInput");
const roomInput = document.querySelector("#roomInput");
const createRoomButton = document.querySelector("#createRoomButton");
const joinRoomButton = document.querySelector("#joinRoomButton");
const lobbyMessage = document.querySelector("#lobbyMessage");
const roomCode = document.querySelector("#roomCode");
const syncStatus = document.querySelector("#syncStatus");
const roomMeta = document.querySelector("#roomMeta");
const sharePanel = document.querySelector(".share-panel");
const shareLink = document.querySelector("#shareLink");
const qrImage = document.querySelector("#qrImage");
const copyButton = document.querySelector("#copyButton");
const leaveButton = document.querySelector("#leaveButton");
const moveOverlay = document.querySelector("#moveOverlay");
const callOverlay = document.querySelector("#callOverlay");
const callOverlayText = document.querySelector("#callOverlayText");
const callText = document.querySelector("#callText");
const roundMessage = document.querySelector("#roundMessage");
const playersArea = document.querySelector("#players");
const historyTitle = document.querySelector("#historyTitle");
const historyList = document.querySelector("#historyList");
const startPanel = document.querySelector("#startPanel");
const startStatus = document.querySelector("#startStatus");
const startYesButton = document.querySelector("#startYesButton");
const startWaitButton = document.querySelector("#startWaitButton");
const myNameInput = document.querySelector("#myNameInput");
const saveNameButton = document.querySelector("#saveNameButton");
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
    return snapshot.exists ? hydrateRoom(snapshot.data()) : null;
  }
  const saved = localStorage.getItem(storageKey(id));
  return saved ? hydrateRoom(JSON.parse(saved)) : null;
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

function createRoom(id, targetCount = 2) {
  return {
    id,
    createdAt: Date.now(),
    round: 1,
    attempt: 1,
    targetCount,
    locked: false,
    aiko: false,
    status: "choosing",
    startVotes: {},
    revealAt: 0,
    scored: false,
    history: [],
    players: [],
  };
}

function hydrateRoom(nextRoom) {
  const players = nextRoom.players || [];
  const targetCount = nextRoom.targetCount || Math.max(2, players.length || 2);
  return {
    ...nextRoom,
    attempt: nextRoom.attempt || 1,
    targetCount,
    locked: Boolean(nextRoom.locked) || players.filter((player) => player.name).length >= targetCount,
    aiko: Boolean(nextRoom.aiko),
    startVotes: nextRoom.startVotes || {},
    history: nextRoom.history || [],
    players,
  };
}

function getName() {
  return nameInput.value.trim() || `プレイヤー${Math.floor(Math.random() * 90) + 10}`;
}

async function joinRoom(id) {
  roomId = normalizeRoomId(id);
  if (!roomId) return;
  await initCloud();
  const existingRoom = await loadRoom(roomId);
  room = existingRoom || createRoom(roomId, Number(targetCountInput.value) || 2);
  playerId = sessionStorage.getItem(`janken-player-${roomId}`) || makeId(10);
  sessionStorage.setItem(`janken-player-${roomId}`, playerId);

  const alreadyJoined = room.players.some((player) => player.id === playerId);
  if (!alreadyJoined && isRoomFull(room)) {
    lobbyMessage.textContent = "このルームは締め切られています。";
    return;
  }

  if (!alreadyJoined) {
    room.players.push({ id: playerId, name: getName(), hand: null, score: 0 });
  }
  room.locked = isRoomFull(room);
  if (room.locked && room.status === "choosing" && !room.players.some((player) => player.hand)) {
    room.status = "ready";
    room.startVotes = room.startVotes || {};
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
      room = hydrateRoom(snapshot.data());
      render();
    });
    return;
  }

  channel = "BroadcastChannel" in window ? new BroadcastChannel(`janken-${roomId}`) : null;
  if (!channel) return;
  channel.onmessage = () => {
    const latest = localStorage.getItem(storageKey(roomId));
    if (!latest) return;
    room = hydrateRoom(JSON.parse(latest));
    render();
  };
}

function visiblePlayers() {
  return room.players.filter((player) => player.name);
}

function isRoomFull(nextRoom = room) {
  return nextRoom.players.filter((player) => player.name).length >= nextRoom.targetCount;
}

function currentPlayer() {
  return room.players.find((player) => player.id === playerId);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function chooseHand(hand) {
  room = (await loadRoom(room.id)) || room;
  const player = currentPlayer();
  if (!player || player.hand || room.status !== "choosing" || !room.locked) return;

  player.hand = hand;
  if (visiblePlayers().length === room.targetCount && visiblePlayers().every((item) => item.hand)) {
    room.status = "countdown";
    room.revealAt = Date.now() + roundDelay;
    room.scored = false;
  }
  await saveRoom(room);
}

async function voteStart(isReady) {
  room = (await loadRoom(room.id)) || room;
  const player = currentPlayer();
  if (!player || room.status !== "ready") return;

  room.startVotes = room.startVotes || {};
  room.startVotes[player.id] = isReady;

  const players = visiblePlayers();
  if (players.length === room.targetCount && players.every((item) => room.startVotes[item.id] === true)) {
    room.status = "choosing";
    room.aiko = false;
    room.scored = false;
    room.revealAt = 0;
    room.players.forEach((item) => {
      item.hand = null;
    });
  }

  await saveRoom(room);
}

async function updateMyName() {
  room = (await loadRoom(room.id)) || room;
  const player = currentPlayer();
  const nextName = myNameInput.value.trim();
  if (!player || !nextName) return;

  player.name = nextName;
  await saveRoom(room);
  saveNameButton.textContent = "変更済み";
  setTimeout(() => {
    saveNameButton.textContent = "変更";
  }, 1200);
}

function judgeRound(players) {
  const unique = [...new Set(players.map((player) => player.hand))];
  if (unique.length !== 2) return [];

  const winnerHand = hands[unique[0]].beats === unique[1] ? unique[0] : unique[1];
  const winners = players.filter((player) => player.hand === winnerHand);
  return winners.length === 1 ? winners : [];
}

async function finishRound() {
  room = (await loadRoom(room.id)) || room;
  if (!room || room.status !== "countdown" || room.scored || Date.now() < room.revealAt) return;

  const players = visiblePlayers();
  const winners = judgeRound(players);
  const historyItem = {
    round: room.round,
    attempt: room.attempt,
    type: winners.length === 1 ? "win" : "continue",
    winners: winners.map((winner) => winner.name),
    hands: players.map((player) => ({
      name: player.name,
      hand: player.hand,
    })),
    at: Date.now(),
  };

  if (winners.length === 1) {
    winners[0].score += 1;
    room.status = "revealed";
    room.aiko = false;
  } else {
    room.status = "aiko";
    room.aiko = true;
  }

  room.history = [historyItem, ...room.history].slice(0, 12);
  room.scored = true;
  await saveRoom(room);
}

async function nextRound() {
  room = (await loadRoom(room.id)) || room;
  lastCallOverlayText = "";
  room.round += 1;
  room.attempt = 1;
  room.status = "choosing";
  room.startVotes = {};
  room.revealAt = 0;
  room.scored = false;
  room.aiko = false;
  room.players.forEach((player) => {
    player.hand = null;
  });
  await saveRoom(room);
}

async function continueAiko() {
  room = (await loadRoom(room.id)) || room;
  if (!room || room.status !== "aiko") return;
  lastCallOverlayText = "";
  room.attempt += 1;
  room.status = "choosing";
  room.revealAt = 0;
  room.scored = false;
  room.aiko = true;
  room.players.forEach((player) => {
    player.hand = null;
  });
  await saveRoom(room);
}

async function resetScores() {
  room = (await loadRoom(room.id)) || room;
  room.players.forEach((player) => {
    player.score = 0;
  });
  room.history = [];
  await nextRound();
}

function renderPlayer(player) {
  const isMe = player.id === playerId;
  const selected = Boolean(player.hand);
  const showHand = room.status === "revealed" || isMe;
  const handText = selected && showHand ? hands[player.hand].icon : selected ? "選択済み" : "選択中";
  const stateClass = selected ? "is-ready" : "is-waiting";

  return `
    <article class="player-card ${stateClass} ${isMe ? "is-me" : ""}">
      <div>
        <span class="name">${escapeHtml(player.name)}${isMe ? " / あなた" : ""}</span>
        <strong>${player.score}</strong>
      </div>
      <span class="player-hand">${handText}</span>
    </article>
  `;
}

function renderCall() {
  clearTimeout(callTimer);
  callText.className = "call-text";

  if (!room.locked) {
    hideCallOverlay();
    const joined = visiblePlayers().length;
    callText.textContent = "募集中";
    roundMessage.textContent = `${joined} / ${room.targetCount} 人が参加中`;
    return;
  }

  if (room.status === "choosing") {
    hideCallOverlay();
    const ready = visiblePlayers().filter((player) => player.hand).length;
    callText.textContent = room.aiko ? "あいこで..." : "手を選択";
    roundMessage.textContent = `${ready} / ${room.targetCount} 人が選択済み`;
    return;
  }

  if (room.status === "ready") {
    hideCallOverlay();
    const yesCount = visiblePlayers().filter((player) => room.startVotes?.[player.id] === true).length;
    callText.textContent = "開始確認";
    roundMessage.textContent = `${yesCount} / ${room.targetCount} 人が開始OK`;
    return;
  }

  if (room.status === "countdown") {
    const remaining = Math.max(0, room.revealAt - Date.now());
    const calls = room.aiko ? aikoCalls : firstCalls;
    const step = room.aiko ? 1000 : 730;
    const index = Math.min(calls.length - 1, Math.floor((roundDelay - remaining) / step));
    callText.textContent = calls[index];
    callText.classList.add("is-counting");
    showCallOverlay(calls[index], room.aiko);
    roundMessage.textContent = "全員の手がそろいました。";
    callTimer = setTimeout(() => {
      if (remaining <= 0) finishRound();
      render();
    }, remaining > 0 ? 180 : 0);
    return;
  }

  if (room.status === "aiko") {
    hideCallOverlay();
    callText.textContent = "あいこ";
    callText.classList.add("is-draw");
    roundMessage.textContent = "勝者が出るまで続けます。";
    callTimer = setTimeout(() => {
      continueAiko();
    }, 1500);
    return;
  }

  const winners = judgeRound(visiblePlayers());
  hideCallOverlay();
  callText.textContent = winners.length ? `${winners.map((winner) => winner.name).join("、")} の勝ち!` : "あいこ";
  callText.classList.add(winners.some((winner) => winner.id === playerId) ? "is-win" : "is-draw");
  roundMessage.textContent = `第${room.round}回戦の結果`;
}

function renderQr(text) {
  qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(text)}`;
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

function renderMeta() {
  const joined = visiblePlayers().length;
  const closed = room.locked;
  roomMeta.innerHTML = `
    <span class="meta-pill ${closed ? "is-closed" : "is-live"}">${closed ? "参加締切" : "参加受付中"}</span>
    <span class="meta-pill">${joined} / ${room.targetCount} 人</span>
    <span class="meta-pill">第${room.round}回戦${room.attempt > 1 ? ` ${room.attempt}投目` : ""}</span>
  `;
}

function renderHistory() {
  const history = room.history || [];
  historyTitle.textContent = history.length ? `${history.length}件` : "まだ結果はありません";
  historyList.innerHTML = history
    .map((item) => {
      const handsText = item.hands.map((entry) => `${entry.name}:${hands[entry.hand]?.label || "?"}`).join(" / ");
      const resultText =
        item.type === "win" ? `${item.winners.join("、")} 勝ち` : item.type === "continue" ? "勝者未確定" : "あいこ";
      return `<li><span>${escapeHtml(`第${item.round}回 ${item.attempt}投目 ${resultText}`)}</span><span>${escapeHtml(handsText)}</span></li>`;
    })
    .join("");
}

function renderStartPanel() {
  const isReadyStatus = room.status === "ready";
  startPanel.classList.toggle("hidden", !isReadyStatus);
  if (!isReadyStatus) return;

  const players = visiblePlayers();
  const yesCount = players.filter((player) => room.startVotes?.[player.id] === true).length;
  const waitCount = players.filter((player) => room.startVotes?.[player.id] === false).length;
  const myVote = room.startVotes?.[playerId];

  startStatus.textContent =
    waitCount > 0
      ? `${waitCount}人が待機中です。準備できたら「はい」を押してください。`
      : `${yesCount} / ${room.targetCount} 人が「はい」を選択しました。`;
  startYesButton.classList.toggle("is-selected", myVote === true);
  startWaitButton.classList.toggle("is-selected", myVote === false);
}

function showMoveOverlay() {
  clearTimeout(moveTimer);
  moveOverlay.classList.remove("hidden");
  moveTimer = setTimeout(() => {
    moveOverlay.classList.add("hidden");
  }, 2400);
}

function showCallOverlay(text, isAiko) {
  if (text === lastCallOverlayText && !callOverlay.classList.contains("hidden")) return;
  lastCallOverlayText = text;
  callOverlayText.textContent = text;
  callOverlay.classList.toggle("is-aiko", isAiko);
  callOverlay.classList.remove("hidden");
  callOverlayText.classList.remove("is-changing");
  void callOverlayText.offsetWidth;
  callOverlayText.classList.add("is-changing");
}

function hideCallOverlay() {
  clearTimeout(callOverlayTimer);
  callOverlay.classList.add("hidden");
  lastCallOverlayText = "";
}

function render() {
  if (!room) return;
  lobby.classList.add("hidden");
  roomView.classList.remove("hidden");

  const url = getShareUrl(room.id);
  roomCode.textContent = room.id;
  syncStatus.textContent = cloudReady ? "クラウド同期" : "ローカル";
  syncStatus.classList.toggle("is-cloud", cloudReady);
  renderMeta();
  shareLink.textContent = url;
  shareLink.href = url;
  sharePanel.classList.toggle("is-closed", room.locked);
  playersArea.innerHTML = visiblePlayers().map(renderPlayer).join("");
  renderHistory();
  renderStartPanel();
  renderQr(url);
  renderCall();

  if (room.locked && !wasLocked) {
    showMoveOverlay();
  }
  wasLocked = room.locked;

  const me = currentPlayer();
  if (me && document.activeElement !== myNameInput) {
    myNameInput.value = me.name;
  }
  myStatus.textContent = me?.hand ? hands[me.hand].label : "未選択";
  choices.forEach((button) => {
    const locked = me?.hand === button.dataset.hand;
    button.disabled = Boolean(me?.hand) || room.status !== "choosing" || !room.locked;
    button.classList.toggle("locked", locked);
  });
  nextButton.disabled = room.status !== "revealed";
}

createRoomButton.addEventListener("click", () => joinRoom(makeId()));
joinRoomButton.addEventListener("click", () => {
  const id = roomInput.value.trim();
  if (id) joinRoom(id);
});
choices.forEach((button) => button.addEventListener("click", () => chooseHand(button.dataset.hand)));
startYesButton.addEventListener("click", () => voteStart(true));
startWaitButton.addEventListener("click", () => voteStart(false));
saveNameButton.addEventListener("click", updateMyName);
myNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") updateMyName();
});
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
