import Monopoly from "./Monopoly.js";

const socket = io();

const lobbyId = sessionStorage.getItem("lobbyId");
const me = JSON.parse(sessionStorage.getItem("me") || "null");

if (!lobbyId || !me) {
    window.location.replace("index.html");
}

const $ = (id) => document.getElementById(id);

const canvas = $("main-canvas");
const ctx = canvas.getContext("2d");

const monopoly = new Monopoly(canvas, ctx);

let state = null;
let selectedCardId = null;
let selectedPlayerId = null;
let ownCardsExpanded = false;
let offerBuilderTargetId = null;
let offerBuilderMyProps = new Set();
let offerBuilderTheirProps = new Set();

const diceCanvas = $("dice-canvas");
const diceCtx = diceCanvas.getContext("2d");
let currentDice = [1, 1];
let diceAnimation = null;

let previousPositions = {};
let previousBalances = {};
let pendingBalanceDeltas = [];

socket.on("connect", () => {
    socket.emit("lobby:rejoin", { lobbyId, playerName: me.name });
});

socket.on("game:state", (newState) => {
    const prevState = state;
    state = newState;
    if (prevState) {
        for (const p of state.players) {
            const prev = prevState.players.find((pp) => pp.id === p.id);
            if (prev && prev.position !== p.position && !p.bankrupt) {
                const delay = diceAnimation ? 1000 : 0;
                monopoly.startMoveAnimation(p.id, prev.position, p.position, { delay, durationPerStep: 200 });
            }
            if (prev && prev.balance !== p.balance) {
                pendingBalanceDeltas.push({ pid: p.id, delta: p.balance - prev.balance });
            }
        }
    }
    for (const p of state.players) previousBalances[p.id] = p.balance;
    render();
    flushBalanceDeltas();
});

function flushBalanceDeltas() {
    for (const { pid, delta } of pendingBalanceDeltas) {
        const row = document.querySelector(`.clickable-player[data-pid="${pid}"] .player-row-balance`);
        if (!row) continue;
        const el = document.createElement("span");
        el.className = `balance-delta ${delta > 0 ? "pos" : "neg"}`;
        el.textContent = (delta > 0 ? "+" : "") + delta;
        row.appendChild(el);
        setTimeout(() => el.remove(), 2600);
    }
    pendingBalanceDeltas = [];
}

socket.on("game:rolled", ({ dice }) => {
    startDiceAnimation(dice);
});

socket.on("game:hurry", ({ toId, fromName }) => {
    const myPlayer = state?.players.find((p) => p.socketId === socket.id);
    if (myPlayer && toId === myPlayer.id) {
        monopoly.setCenterTopOverride("ПОТОРОПИТЕСЬ!", 2500);
    }
});

socket.on("game:error", ({ message }) => {
    alert(message);
});

socket.on("game:over", ({ winnerName }) => {
    alert(`Игра окончена! Победитель: ${winnerName}`);
});

$("roll-dice-button").onclick = () => socket.emit("game:roll");
$("end-turn-button").onclick = () => socket.emit("game:end-turn");

$("use-jail-card-button").onclick = () => socket.emit("game:use-jail-card");

const historyBtn = $("open-history-btn");
if (historyBtn) {
    historyBtn.onclick = () => window.open("log.html", "_blank");
}

$("exit-to-menu-btn").onclick = () => {
    if (!confirm("Выйти из игры? Твои данные будут потеряны.")) return;
    sessionStorage.removeItem("lobbyId");
    sessionStorage.removeItem("me");
    sessionStorage.removeItem("isHost");
    window.location.href = "index.html";
};

canvas.addEventListener("click", (e) => {
    if (!state) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    for (let i = 0; i < 40; i++) {
        const r = monopoly.getCellRect(i);
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
            selectedCardId = i;
            selectedPlayerId = null;
            render();
            break;
        }
    }
});

function render() {
    if (!state) return;

    const myPlayer = state.players.find((p) => p.socketId === socket.id)
        || state.players.find((p) => p.name === me.name);

    const isMyTurn = myPlayer && state.currentPlayerId === myPlayer.id;

    $("roll-dice-button").disabled = !(isMyTurn && state.phase === "roll");

    const useJailBtn = $("use-jail-card-button");
    if (useJailBtn) {
        const canUse = myPlayer && myPlayer.inJail && (myPlayer.freeJailCards || 0) > 0 && state.phase === "roll" && isMyTurn;
        useJailBtn.style.display = canUse ? "" : "none";
    }

    const pa = state.pendingAction;
    const canEndTurn = isMyTurn && state.phase === "action"
        && (pa?.type === "end-turn-only" || pa?.type === "roll-again");
    $("end-turn-button").disabled = !canEndTurn;

    monopoly.centerOverlay.topText = (isMyTurn && state.phase === "roll") ? "ВАШ ХОД" : null;
    monopoly.centerOverlay.bottomText = canEndTurn ? "ЗАВЕРШИТЕ ХОД" : null;

    updateAttentionCell(myPlayer, isMyTurn);
    if (pa?.type === "roll-again" && isMyTurn) {
        $("end-turn-button").querySelector("h4").innerText = "Ходить снова";
    } else {
        $("end-turn-button").querySelector("h4").innerText = "Конец хода";
    }

    renderPlayerList(myPlayer);
    renderEventLog();
    renderOwnCards(myPlayer);
    renderCardDisplay(myPlayer, isMyTurn);
}

function boardFrame() {
    if (!state) {
        requestAnimationFrame(boardFrame);
        return;
    }
    const now = performance.now();
    monopoly.draw_map(state.board, state.groupColors, state.ownership, state.players);
    monopoly.drawAttentionWaves(now);
    monopoly.draw_tokens(state.players, state.currentPlayerId, now);
    drawDice(now);
    requestAnimationFrame(boardFrame);
}
requestAnimationFrame(boardFrame);

function startDiceAnimation(finalDice) {
    diceAnimation = {
        startTime: performance.now(),
        duration: 1400,
        finalDice,
    };
}

function drawDice(now) {
    const ctx = diceCtx;
    const W = diceCanvas.width;
    const H = diceCanvas.height;
    ctx.clearRect(0, 0, W, H);

    let d1, d2;
    let animating = false;
    if (diceAnimation) {
        animating = true;
        const elapsed = now - diceAnimation.startTime;
        const p = elapsed / diceAnimation.duration;
        if (p >= 1) {
            currentDice = diceAnimation.finalDice;
            diceAnimation = null;
            d1 = currentDice[0];
            d2 = currentDice[1];
            animating = false;
        } else {
            const eased = 1 - Math.pow(1 - p, 3);
            const interval = 40 + eased * 200;
            const cycles = Math.floor(elapsed / interval);
            d1 = 1 + (cycles % 6);
            d2 = 1 + ((cycles + 3) % 6);
        }
    } else {
        d1 = currentDice[0];
        d2 = currentDice[1];
    }

    const isDouble = !animating && d1 === d2;
    const doublesCount = state?.doublesCount || 0;

    if (isDouble && doublesCount > 0) {
        const flash = 0.5 + 0.5 * Math.sin(now / 180);
        ctx.save();
        ctx.strokeStyle = `rgba(212, 175, 55, ${0.6 + 0.4 * flash})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = "#d4af37";
        ctx.shadowBlur = 14;
        ctx.strokeRect(3, 3, 130, 64);
        ctx.restore();
    }

    drawDie(ctx, 8, 5, 60, d1);
    drawDie(ctx, 72, 5, 60, d2);

    if (doublesCount > 0) {
        ctx.save();
        ctx.fillStyle = "#d4af37";
        ctx.font = "900 26px 'Cinzel', serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(212, 175, 55, 0.6)";
        ctx.shadowBlur = 8;
        ctx.fillText(`×${doublesCount}`, 160, H / 2);
        ctx.restore();
    }
}

function drawDie(ctx, x, y, size, value) {
    const r = 10;
    ctx.save();
    const grad = ctx.createLinearGradient(x, y, x, y + size);
    grad.addColorStop(0, "#fbf4dd");
    grad.addColorStop(1, "#d4c091");
    ctx.fillStyle = grad;
    ctx.strokeStyle = "#8b6914";
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, size, size, r);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#1a1208";
    const pip = (dx, dy) => {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, size * 0.08, 0, Math.PI * 2);
        ctx.fill();
    };
    const c = size / 2;
    const q = size * 0.25;
    const t = size * 0.75;
    const positions = {
        1: [[c, c]],
        2: [[q, q], [t, t]],
        3: [[q, q], [c, c], [t, t]],
        4: [[q, q], [t, q], [q, t], [t, t]],
        5: [[q, q], [t, q], [c, c], [q, t], [t, t]],
        6: [[q, q], [t, q], [q, c], [t, c], [q, t], [t, t]],
    };
    for (const [dx, dy] of positions[value] || []) pip(dx, dy);
    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function renderPlayerList(myPlayer) {
    const container = $("players-container");
    container.innerHTML = "";
    for (const p of state.players) {
        const div = document.createElement("div");
        div.className = "player-border clickable-player";
        div.dataset.pid = p.id;
        if (p.id === selectedPlayerId) div.classList.add("selected-player");
        if (p.id === state.currentPlayerId && !p.bankrupt && !p.left) div.classList.add("active-player-row");

        const isMe = myPlayer && p.id === myPlayer.id;
        const meBadge = isMe ? `<span class="me-badge">Я</span>` : "";
        const swatch = `<span class="color-swatch" style="background:${p.color}"></span>`;

        let statusTag = "";
        if (p.bankrupt) statusTag = ' <span class="player-tag tag-bankrupt">банкрот</span>';
        else if (p.left) statusTag = ' <span class="player-tag tag-left">вышел</span>';
        else if (p.id === state.currentPlayerId && state.phase !== "ended") statusTag = ' <span class="active-player">Ходит</span>';

        const jailBadge = p.inJail && !p.bankrupt && !p.left ? ' <span class="player-tag tag-jail">в тюрьме</span>' : "";
        const goojfBadge = (p.freeJailCards || 0) > 0 ? ` <span class="player-tag tag-key" title="Карт освобождения из тюрьмы">🔑${p.freeJailCards}</span>` : "";

        const isMuted = myPlayer && (myPlayer.mutedIds || []).includes(p.id);

        let controlsHtml = "";
        if (!isMe && myPlayer && !myPlayer.bankrupt && !myPlayer.left && !p.bankrupt && !p.left) {
            const isCurrent = p.id === state.currentPlayerId;
            controlsHtml = `
                <div class="player-controls">
                    <button class="player-ctrl-btn mute-btn ${isMuted ? 'muted' : ''}" data-pid="${p.id}" data-act="mute" title="${isMuted ? 'Размутить' : 'Замутить предложения'}">${isMuted ? '🔇' : '🔔'}</button>
                    <button class="player-ctrl-btn hurry-btn" data-pid="${p.id}" data-act="hurry" title="Поторопить ход" ${isCurrent ? '' : 'disabled'}>⏰</button>
                </div>
            `;
        }

        div.innerHTML = `
            <div class="player-main">
                <h3>${meBadge}${swatch}<span class="player-name-text">${escapeHtml(p.name)}</span>${statusTag}${jailBadge}${goojfBadge}</h3>
                <div class="player-row-balance">$${p.balance}</div>
            </div>
            ${controlsHtml}
        `;
        div.onclick = (e) => {
            if (e.target.closest(".player-ctrl-btn")) return;
            selectedPlayerId = selectedPlayerId === p.id ? null : p.id;
            selectedCardId = null;
            monopoly.highlightPlayer(p.id, 1100);
            render();
        };

        div.querySelectorAll(".player-ctrl-btn").forEach((btn) => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const pid = parseInt(btn.dataset.pid, 10);
                const act = btn.dataset.act;
                if (act === "mute") socket.emit("trade:toggle-mute", { targetId: pid });
                else if (act === "hurry") socket.emit("game:hurry", { targetId: pid });
            };
        });

        container.appendChild(div);
    }
}

function renderEventLog() {
    const container = $("event-log");
    if (!container) return;
    const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 30;
    const log = state.log || [];
    container.innerHTML = log.map((e) => {
        const text = typeof e === "string" ? e : e.text;
        const cat = categorizeLog(text);
        const icon = LOG_CATEGORY_ICONS[cat] || "";
        const cleanText = stripLeadingEmoji(text);
        return `<div class="log-entry"><span class="log-cat-icon">${icon}</span><span class="log-text">${formatLogEntry(cleanText)}</span></div>`;
    }).join("");
    if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

const LOG_CATEGORY_ICONS = {
    roll: "🎲",
    buy: "🏠",
    build: "🏗️",
    pay: "💵",
    card: "🃏",
    casino: "🎰",
    trade: "🤝",
    jail: "🔒",
    debug: "🛠",
    "game-end": "🏆",
    other: "ℹ️",
};

function categorizeLog(text) {
    if (/🎰|казино|ДЖЕКПОТ|ВЫИГРЫШ/.test(text)) return "casino";
    if (/🏆|Победитель|Игра окончена/i.test(text)) return "game-end";
    if (/🤝|💝|торопит|подарил|предложение|сделка|отклонил|отменил/i.test(text)) return "trade";
    if (/🛠/.test(text)) return "debug";
    if (/тюрь|🔑|освоб|вышел из тюрьмы/i.test(text)) return "jail";
    if (/бросил|прошёл Старт|выбросил дубль|ходит снова/i.test(text)) return "roll";
    if (/купил|продал/i.test(text)) return "buy";
    if (/построил|снёс/i.test(text)) return "build";
    if (/заплатил|получил|обанкрот|ремонт/i.test(text)) return "pay";
    if (/вытянул|Банк выплачивает/i.test(text)) return "card";
    return "other";
}

function stripLeadingEmoji(text) {
    return text.replace(/^(🎰|💝|🤝|⏰|🛠|🏆|🔑|🔓|👋|💨)\s*/u, "");
}

function formatLogEntry(raw) {
    const escaped = escapeHtml(raw);
    return escaped
        .replace(/\{p:(\d+)\}/g, (m, id) => {
            const p = state.players.find((pp) => pp.id === parseInt(id, 10));
            if (!p) return m;
            return `<span class="log-player"><span class="log-dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</span>`;
        })
        .replace(/\{c:(\d+)\}/g, (m, id) => {
            const cell = state.board[parseInt(id, 10)];
            if (!cell) return m;
            const color = cellLogColor(cell);
            return `<span class="log-card"><span class="log-dot" style="background:${color}"></span>${escapeHtml(cell.name)}</span>`;
        });
}

function updateAttentionCell(myPlayer, isMyTurn) {
    if (!myPlayer) { monopoly.attentionCell = null; return; }
    const pa = state.pendingAction;
    let pendingCellId = null;

    if (pa && isMyTurn) {
        if (pa.type === "buy-option" || pa.type === "pay-rent") {
            pendingCellId = pa.cardId;
        } else if (pa.type === "pay-tax" || pa.type === "card-draw" || pa.type === "casino-offer") {
            pendingCellId = myPlayer.position;
        }
    }

    if (pendingCellId === null && state.casinoGame
        && state.casinoGame.phase === "betting"
        && (state.casinoGame.waitingFor || []).includes(myPlayer.id)) {
        const casinoCell = state.board.find((c) => c.type === "casino");
        if (casinoCell) pendingCellId = casinoCell.id;
    }

    const currentlyViewing = (selectedPlayerId !== null && selectedPlayerId !== undefined)
        || (offerBuilderTargetId !== null && offerBuilderTargetId !== undefined)
        || !!(state.pendingOffers && state.pendingOffers[myPlayer.id]);

    let viewedCellId = null;
    if (!currentlyViewing) {
        viewedCellId = selectedCardId !== null ? selectedCardId : pendingCellId ?? myPlayer.position;
    }

    if (pendingCellId !== null && pendingCellId !== viewedCellId) {
        const cell = state.board[pendingCellId];
        monopoly.attentionCell = {
            cellId: pendingCellId,
            color: cellLogColor(cell),
            waitForPlayerId: myPlayer.id,
        };
    } else {
        monopoly.attentionCell = null;
    }
}

function cellLogColor(cell) {
    if (cell.group) return state.groupColors[cell.group];
    switch (cell.type) {
        case "chance":
        case "community": return "#9a9a9a";
        case "casino": return "#8b0000";
        case "tax": return "#3a2e1a";
        case "railroad": return "#2a2a2a";
        case "utility": return "#2d6b3f";
        case "corner":
            if (cell.action === "go") return "#8ac82f";
            if (cell.action === "jail" || cell.action === "go-to-jail") return "#9a9a9a";
            return "#b8860b";
        default: return "#888";
    }
}

function renderOwnCards(myPlayer) {
    const list = $("own-cards-list");
    const wrapper = $("own-cards");
    list.innerHTML = "";
    wrapper.classList.toggle("expanded", ownCardsExpanded);

    if (!myPlayer) return;

    const toggle = $("own-cards-toggle");
    if (myPlayer.properties.length > 0) {
        toggle.style.display = "";
        toggle.innerText = ownCardsExpanded ? "Свернуть ▼" : "Развернуть ▲";
    } else {
        toggle.style.display = "none";
    }

    for (const cid of myPlayer.properties) {
        const cell = state.board[cid];
        const own = state.ownership[cid];
        const btn = document.createElement("button");
        btn.className = "own-card-btn";
        if (cid === selectedCardId) btn.classList.add("selected-card");
        const color = cell.group ? state.groupColors[cell.group] : "#888";
        btn.style.borderLeft = `6px solid ${color}`;
        let extras = "";
        if (own.hotel) extras = " 🏨";
        else if (own.houses > 0) extras = ` 🏠×${own.houses}`;
        btn.innerText = cell.name + extras;
        btn.onclick = (e) => {
            e.stopPropagation();
            selectedCardId = cid;
            selectedPlayerId = null;
            render();
        };
        list.appendChild(btn);
    }
}

function renderCardDisplay(myPlayer, isMyTurn) {
    const card = $("card");

    if (state.phase === "ended") {
        renderVictoryView(card);
        return;
    }

    if (state.casinoGame) {
        renderCasinoView(card, myPlayer, isMyTurn);
        return;
    }

    const pa0 = state.pendingAction;
    if (pa0 && pa0.type === "casino-offer" && isMyTurn) {
        renderCasinoOffer(card, myPlayer, pa0.minBet);
        return;
    }

    const incomingOffer = myPlayer && state.pendingOffers?.[myPlayer.id];
    if (incomingOffer) {
        renderIncomingOffer(card, incomingOffer, myPlayer);
        return;
    }

    if (offerBuilderTargetId !== null && offerBuilderTargetId !== undefined) {
        renderOfferBuilder(card, myPlayer);
        return;
    }

    if (selectedPlayerId !== null && selectedPlayerId !== undefined) {
        renderPlayerView(card, selectedPlayerId, myPlayer);
        return;
    }

    const pa = state.pendingAction;
    let cardId = null;

    const autoFocusTypes = ["buy-option", "card-draw", "pay-tax", "pay-rent"];
    const pendingFocusCellId = pa && isMyTurn && autoFocusTypes.includes(pa.type)
        ? (pa.cardId !== undefined ? pa.cardId : (myPlayer ? myPlayer.position : null))
        : null;

    if (selectedCardId !== null) {
        cardId = selectedCardId;
    } else if (pendingFocusCellId !== null) {
        cardId = pendingFocusCellId;
    } else if (myPlayer) {
        cardId = myPlayer.position;
    }

    if (cardId === null || cardId === undefined) {
        card.innerHTML = `<div class="card-empty">Нажми на клетку поля или игрока</div>`;
        return;
    }

    renderCellView(card, cardId, myPlayer, isMyTurn);
}

function renderCellView(card, cardId, myPlayer, isMyTurn) {
    const cell = state.board[cardId];
    const own = state.ownership[cardId];
    const typeColors = {
        chance: "#d98027",
        community: "#5fb3d1",
        casino: "#8b0000",
        tax: "#2a1f14",
        railroad: "#1a1a1a",
        utility: "#2d6b3f",
        corner: "#b8860b",
    };
    const groupColor = cell.group
        ? state.groupColors[cell.group]
        : (typeColors[cell.type] || "#555");

    const cardTypeLabels = {
        property: "Улица",
        railroad: "Аэропорт",
        utility: "Коммунальная",
        tax: "Налог",
        chance: "Шанс",
        community: "Казна",
        casino: "Казино",
        corner: "Угловая",
    };

    let rentHtml = "";
    if (cell.type === "property") {
        rentHtml = `
            <div class="rent-section">
                <div class="rent-row"><span>Базовая</span><b>$${cell.rent[0]}</b></div>
                <div class="rent-row"><span>1 дом</span><b>$${cell.rent[1]}</b></div>
                <div class="rent-row"><span>2 дома</span><b>$${cell.rent[2]}</b></div>
                <div class="rent-row"><span>3 дома</span><b>$${cell.rent[3]}</b></div>
                <div class="rent-row"><span>4 дома</span><b>$${cell.rent[4]}</b></div>
                <div class="rent-row"><span>Отель</span><b>$${cell.rent[5]}</b></div>
            </div>
        `;
    } else if (cell.type === "railroad") {
        rentHtml = `
            <div class="rent-section">
                <div class="rent-row"><span>1 вокзал</span><b>$${cell.rent[0]}</b></div>
                <div class="rent-row"><span>2 вокзала</span><b>$${cell.rent[1]}</b></div>
                <div class="rent-row"><span>3 вокзала</span><b>$${cell.rent[2]}</b></div>
                <div class="rent-row"><span>4 вокзала</span><b>$${cell.rent[3]}</b></div>
            </div>
        `;
    } else if (cell.type === "utility") {
        rentHtml = `<div class="rent-section"><div class="rent-row"><span>Одна</span><b>×4 кубика</b></div><div class="rent-row"><span>Обе</span><b>×10 кубика</b></div></div>`;
    } else if (cell.type === "tax") {
        rentHtml = `<div class="rent-section"><div class="rent-row"><span>Налог</span><b>$${cell.amount}</b></div></div>`;
    } else if (cell.type === "chance" || cell.type === "community") {
        const isMatching = state.lastDrawnCard && state.lastDrawnCard.type === cell.type;
        const text = isMatching ? state.lastDrawnCard.text : "Вытяните карту, попав на эту клетку.";
        rentHtml = `<div class="card-drawn-text ${isMatching ? 'active' : ''}">${escapeHtml(text)}</div>`;
    } else if (cell.type === "casino") {
        rentHtml = `
            <div class="card-drawn-text">
                🎰 Казино слот-машина. Сделай ставку и крути барабан из 3 слотов.
                Символы: 💎 алмаз, 👑 корона, ⭐ звезда, 🍒 вишня.
                Можно играть одному или позвать остальных.
                Не совпало — ставка уходит в джекпот. При 💎💎 джекпот твой + бонус, если ставка его превысила.
            </div>
        `;
    } else if (cell.type === "corner") {
        if (cell.action === "go") {
            rentHtml = `
                <div class="card-drawn-text">
                    🟢 Стартовая клетка. Каждый раз когда фишка проходит через Старт,
                    игрок получает <b>+$200</b> за круг.
                    Стрелка указывает направление движения.
                </div>
            `;
        } else if (cell.action === "jail") {
            rentHtml = `
                <div class="card-drawn-text">
                    🔒 Тюрьма. Если ты попал сюда обычным ходом — ты здесь
                    <b>просто в гостях</b>, никакого эффекта.
                    Сидишь в тюрьме только если сюда <b>отправляют</b>
                    (карта "Иди в тюрьму", 3 дубля подряд или клетка "Иди в тюрьму").
                </div>
            `;
        } else if (cell.action === "go-to-jail") {
            rentHtml = `
                <div class="card-drawn-text">
                    🚔 Попав сюда, фишка сразу <b>переходит в Тюрьму</b>.
                    Старт не засчитывается, бонус не выдаётся.
                    Чтобы выйти: дубль на кубиках, 3 хода + штраф $50,
                    или карта "Освобождение".
                </div>
            `;
        }
    }

    let ownerHtml = "";
    if (own) {
        const ownerPlayer = state.players.find((p) => p.id === own.ownerId);
        const ownerText = ownerPlayer ? `<span style="color:${ownerPlayer.color}">${escapeHtml(ownerPlayer.name)}</span>` : `<i>свободна</i>`;
        ownerHtml = `
            <div class="card-owner-line">Владелец: ${ownerText}</div>
            <div class="card-buildings">
                ${own.hotel ? '🏨 Отель' : own.houses > 0 ? `🏠 Домов: ${own.houses}` : ''}
            </div>
        `;
    }

    let priceHtml = "";
    if (cell.price) {
        const sellPrice = Math.floor(cell.price / 2);
        let extras = "";
        if (cell.type === "property" && cell.housePrice) {
            extras = `
                <div class="card-sub-price">
                    <span>🏠 Дом: <b>$${cell.housePrice}</b></span>
                    <span>🏨 Отель: <b>$${cell.housePrice}</b></span>
                </div>
                <div class="card-sub-price">
                    <span>Продажа: <b>$${sellPrice}</b></span>
                </div>
            `;
        } else {
            extras = `<div class="card-sub-price"><span>Продажа: <b>$${sellPrice}</b></span></div>`;
        }
        priceHtml = `
            <div class="card-price">Цена <b>$${cell.price}</b></div>
            ${extras}
        `;
    }

    card.innerHTML = `
        <div class="card-header" style="background:${groupColor}">
            <div class="card-type-label">${cardTypeLabels[cell.type] || cell.type}</div>
            <h1>${escapeHtml(cell.name)}</h1>
        </div>
        <div class="card-body">
            ${priceHtml}
            ${rentHtml}
            ${ownerHtml}
            <div id="card-actions"></div>
        </div>
    `;

    const actions = $("card-actions");
    const pa = state.pendingAction;

    const pendingTypes = ["buy-option", "card-draw", "pay-tax", "pay-rent"];
    const hasPending = pa && isMyTurn && pendingTypes.includes(pa.type);
    const pendingCellId = hasPending
        ? (pa.cardId !== undefined ? pa.cardId : (myPlayer ? myPlayer.position : null))
        : null;
    const viewingPending = hasPending && pendingCellId === cardId;

    if (viewingPending) {
        if (pa.type === "buy-option") {
            actions.appendChild(makeBtn(`Купить за $${pa.price}`, () => socket.emit("game:buy"), "primary"));
            actions.appendChild(makeBtn("Отказаться", () => socket.emit("game:decline-buy"), "secondary"));
            return;
        }
        if (pa.type === "card-draw") {
            actions.appendChild(makeBtn("Принять", () => socket.emit("game:accept-card"), "primary"));
            return;
        }
        if (pa.type === "pay-tax") {
            actions.appendChild(makeBtn(`Заплатить $${pa.amount}`, () => socket.emit("game:accept-pay"), "secondary"));
            return;
        }
        if (pa.type === "pay-rent") {
            actions.appendChild(makeBtn(`Заплатить аренду $${pa.amount}`, () => socket.emit("game:accept-pay"), "secondary"));
            return;
        }
    }

    if (own && own.ownerId === myPlayer?.id && cell.type === "property") {
        const refund = Math.floor(cell.housePrice / 2);
        if (!own.hotel && own.houses < 4) {
            actions.appendChild(makeBtn(`Купить дом ($${cell.housePrice})`, () => {
                socket.emit("game:buy-house", { cardId });
            }));
        }
        if (!own.hotel && own.houses === 4) {
            actions.appendChild(makeBtn(`Купить отель ($${cell.housePrice})`, () => {
                socket.emit("game:buy-hotel", { cardId });
            }));
        }
        if (own.houses > 0 && !own.hotel) {
            actions.appendChild(makeBtn(`Снести дом (+$${refund})`, () => {
                socket.emit("game:sell-house", { cardId });
            }, "secondary"));
        }
        if (own.hotel) {
            actions.appendChild(makeBtn(`Снести отель (+$${refund})`, () => {
                socket.emit("game:sell-hotel", { cardId });
            }, "secondary"));
        }
        if (own.houses === 0 && !own.hotel) {
            addSellWithLock(actions, cardId, Math.floor(cell.price / 2), !!own.locked);
        }
    }

    if (own && own.ownerId === myPlayer?.id && (cell.type === "railroad" || cell.type === "utility")) {
        addSellWithLock(actions, cardId, Math.floor(cell.price / 2), !!own.locked);
    }
}

function addSellWithLock(actions, cardId, refund, locked) {
    const wrap = document.createElement("div");
    wrap.className = "sell-lock-wrap";

    const sellBtn = makeBtn(
        locked ? `🔒 Продать за $${refund}` : `Продать за $${refund}`,
        () => {
            if (locked) {
                alert("Сначала открой замочек.");
                return;
            }
            socket.emit("game:sell", { cardId });
        },
        "secondary"
    );
    sellBtn.classList.toggle("is-locked", locked);
    if (locked) sellBtn.title = "Продажа заблокирована. Открой замочек.";

    const lockBtn = document.createElement("button");
    lockBtn.className = `lock-btn ${locked ? "closed" : "open"}`;
    lockBtn.innerText = locked ? "🔒" : "🔓";
    lockBtn.title = locked ? "Открыть замок" : "Закрыть замок";
    lockBtn.onclick = () => socket.emit("game:toggle-lock", { cardId });

    wrap.appendChild(sellBtn);
    wrap.appendChild(lockBtn);
    actions.appendChild(wrap);
}

function renderPlayerView(card, playerId, myPlayer) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) {
        card.innerHTML = `<div class="card-empty">Игрок не найден</div>`;
        return;
    }

    const isMe = myPlayer && player.id === myPlayer.id;
    const status = [];
    if (player.bankrupt) status.push('<span class="player-tag tag-bankrupt">банкрот</span>');
    if (player.inJail) status.push('<span class="player-tag tag-jail">в тюрьме</span>');
    if (player.id === state.currentPlayerId) status.push('<span class="player-tag tag-turn">ходит</span>');

    let propsHtml = "";
    if (player.properties.length > 0) {
        const items = player.properties.map((cid) => {
            const cell = state.board[cid];
            const own = state.ownership[cid];
            const color = cell.group ? state.groupColors[cell.group] : "#888";
            let extras = "";
            if (own.hotel) extras = " 🏨";
            else if (own.houses > 0) extras = ` 🏠×${own.houses}`;
            return `<button class="own-card-btn" data-cid="${cid}" style="border-left:6px solid ${color}">${escapeHtml(cell.name)}${extras}</button>`;
        }).join("");
        propsHtml = `<div class="player-view-props">${items}</div>`;
    } else {
        propsHtml = `<div class="player-view-empty">Нет собственности</div>`;
    }

    let tradeHtml = "";
    if (!isMe && myPlayer && !myPlayer.bankrupt && !player.bankrupt) {
        const limits = state.giftLimits || { maxPerRecipient: 500 };
        const giftAmounts = myPlayer.giftAmounts || {};
        const alreadyToThis = giftAmounts[player.id] || 0;
        const remaining = Math.max(0, limits.maxPerRecipient - alreadyToThis);
        const defaultVal = Math.min(50, remaining) || 1;
        tradeHtml = `
            <h3 class="player-view-section-title">Действия</h3>
            <div class="trade-block">
                <div class="trade-row">
                    <label>Подарить деньги:</label>
                    <input type="number" id="gift-money-input" min="1" max="${remaining}" value="${defaultVal}" step="10">
                    <button class="card-action-btn primary" id="btn-gift-money" ${remaining <= 0 ? "disabled" : ""}>
                        Подарить
                    </button>
                </div>
                <div class="trade-hint">Подарено: $${alreadyToThis} / $${limits.maxPerRecipient} · осталось $${remaining}</div>
                <button class="card-action-btn secondary" id="btn-open-offer" style="width:100%;margin-top:8px">
                    Предложить сделку
                </button>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="card-header player-view-header" style="background:${player.color}">
            <div class="card-type-label">Игрок${isMe ? " (ты)" : ""}</div>
            <h1>${escapeHtml(player.name)}</h1>
        </div>
        <div class="card-body">
            <div class="player-view-balance">$${player.balance}</div>
            <div class="player-view-status">${status.join(" ") || "&nbsp;"}</div>
            <h3 class="player-view-section-title">Собственность (${player.properties.length})</h3>
            ${propsHtml}
            ${tradeHtml}
            <button id="player-view-close" class="secondary" style="margin-top:15px;width:100%">Закрыть</button>
        </div>
    `;

    card.querySelectorAll(".own-card-btn").forEach((btn) => {
        btn.onclick = () => {
            const cid = parseInt(btn.dataset.cid, 10);
            selectedCardId = cid;
            selectedPlayerId = null;
            render();
        };
    });

    $("player-view-close").onclick = () => {
        selectedPlayerId = null;
        render();
    };

    const giftBtn = $("btn-gift-money");
    if (giftBtn) {
        giftBtn.onclick = () => {
            const amount = parseInt($("gift-money-input").value, 10);
            socket.emit("trade:gift-money", { toId: player.id, amount });
        };
    }

    const offerBtn = $("btn-open-offer");
    if (offerBtn) {
        offerBtn.onclick = () => {
            offerBuilderTargetId = player.id;
            offerBuilderMyProps = new Set();
            offerBuilderTheirProps = new Set();
            render();
        };
    }
}

function calcCapitalization(playerId) {
    let total = 0;
    for (const cell of state.board) {
        const own = state.ownership[cell.id];
        if (!own || own.ownerId !== playerId) continue;
        if (cell.price) total += Math.floor(cell.price / 2);
        if (cell.housePrice) {
            const houseRefund = Math.floor(cell.housePrice / 2);
            if (own.hotel) total += houseRefund * 5;
            else total += houseRefund * own.houses;
        }
    }
    return total;
}

function renderVictoryView(card) {
    const winner = state.players.find((p) => p.id === state.winnerId);
    const byBankOrder = (state.bankruptcyOrder || []).slice();
    const placings = [];
    if (winner) placings.push({ player: winner, place: 1, label: "🏆 Победитель" });
    for (let i = byBankOrder.length - 1; i >= 0; i--) {
        const p = state.players.find((pp) => pp.id === byBankOrder[i]);
        if (!p) continue;
        placings.push({ player: p, place: placings.length + 1, label: p.left ? "вышел" : "банкрот" });
    }

    const maxBalance = state.players.reduce((best, p) => (!best || p.balance > best.balance) ? p : best, null);
    const maxProps = state.players.reduce((best, p) => (!best || (p.properties?.length || 0) > (best.properties?.length || 0)) ? p : best, null);
    let maxCapPlayer = null, maxCap = -1;
    for (const p of state.players) {
        const c = calcCapitalization(p.id);
        if (c > maxCap) { maxCap = c; maxCapPlayer = p; }
    }

    const stats = state.stats || {};
    const findTopStat = (field) => {
        let best = null, bestVal = -1;
        for (const p of state.players) {
            const v = stats[p.id]?.[field] || 0;
            if (v > bestVal) { bestVal = v; best = p; }
        }
        return { player: best, value: bestVal };
    };
    const topBought = findTopStat("bought");
    const topSpent = findTopStat("spent");
    const topCasino = findTopStat("wonCasino");
    const topRentTax = findTopStat("paidRentTax");

    const playerChip = (p) => p ? `<span class="victory-chip"><span class="color-swatch" style="background:${p.color};width:14px;height:14px"></span>${escapeHtml(p.name)}</span>` : "—";

    card.innerHTML = `
        <div class="card-header" style="background:${winner ? winner.color : "#b8860b"}">
            <div class="card-type-label">🏆 Игра окончена</div>
            <h1>${winner ? escapeHtml(winner.name) + " победил!" : "Финал"}</h1>
        </div>
        <div class="card-body">
            <h3 class="player-view-section-title">Места</h3>
            <div class="victory-list">
                ${placings.map((pl) => `
                    <div class="victory-row ${pl.place === 1 ? 'first' : ''}">
                        <span class="victory-place">${pl.place === 1 ? '🏆' : pl.place}</span>
                        ${playerChip(pl.player)}
                        <span class="victory-label">${pl.label}</span>
                    </div>
                `).join("")}
            </div>

            <h3 class="player-view-section-title">Рекорды</h3>
            <div class="victory-stats">
                <div class="victory-stat">
                    <div class="vs-label">💰 Максимум на счету</div>
                    ${playerChip(maxBalance)}
                    <span class="vs-value">$${maxBalance?.balance || 0}</span>
                </div>
                <div class="victory-stat">
                    <div class="vs-label">🏘️ Больше всего карт</div>
                    ${playerChip(maxProps)}
                    <span class="vs-value">${maxProps?.properties?.length || 0}</span>
                </div>
                <div class="victory-stat">
                    <div class="vs-label">🏰 Макс. капитализация</div>
                    ${playerChip(maxCapPlayer)}
                    <span class="vs-value">$${maxCap}</span>
                </div>
            </div>

            <h3 class="player-view-section-title">Статистика</h3>
            <div class="victory-stats">
                <div class="victory-stat">
                    <div class="vs-label">🛍️ Купил больше всех карт</div>
                    ${playerChip(topBought.player)}
                    <span class="vs-value">${topBought.value} шт.</span>
                </div>
                <div class="victory-stat">
                    <div class="vs-label">💸 Потратил больше всех</div>
                    ${playerChip(topSpent.player)}
                    <span class="vs-value">$${topSpent.value}</span>
                </div>
                <div class="victory-stat">
                    <div class="vs-label">🎰 Выигрыш в казино</div>
                    ${playerChip(topCasino.player)}
                    <span class="vs-value">$${topCasino.value}</span>
                </div>
                <div class="victory-stat">
                    <div class="vs-label">🏚️ Аренда и налоги</div>
                    ${playerChip(topRentTax.player)}
                    <span class="vs-value">$${topRentTax.value}</span>
                </div>
            </div>
        </div>
    `;
}

function renderIncomingOffer(card, offer, _myPlayer) {
    const sender = state.players.find((p) => p.id === offer.fromId);
    const senderColor = sender ? sender.color : "#555";

    const mkPropList = (cids) => {
        if (!cids || cids.length === 0) return '<div class="offer-empty">—</div>';
        return cids.map((cid) => {
            const cell = state.board[cid];
            const color = cell.group ? state.groupColors[cell.group] : "#888";
            return `<div class="offer-prop" style="border-left:5px solid ${color}">${escapeHtml(cell.name)}</div>`;
        }).join("");
    };

    card.innerHTML = `
        <div class="card-header" style="background:${senderColor}">
            <div class="card-type-label">🤝 Предложение сделки</div>
            <h1>От ${escapeHtml(offer.fromName)}</h1>
        </div>
        <div class="card-body">
            <div class="offer-section">
                <div class="offer-label">Ты получаешь:</div>
                ${mkPropList(offer.myProps)}
                ${offer.myCash > 0 ? `<div class="offer-cash">+ $${offer.myCash}</div>` : ""}
            </div>
            <div class="offer-arrow">⇅</div>
            <div class="offer-section">
                <div class="offer-label">Ты отдаёшь:</div>
                ${mkPropList(offer.theirProps)}
                ${offer.theirCash > 0 ? `<div class="offer-cash debt">− $${offer.theirCash}</div>` : ""}
            </div>
            <div id="card-actions"></div>
        </div>
    `;

    const actions = $("card-actions");
    actions.appendChild(makeBtn("Принять", () => socket.emit("trade:accept"), "primary"));
    actions.appendChild(makeBtn("Отклонить", () => socket.emit("trade:decline"), "secondary"));
}

function renderOfferBuilder(card, myPlayer) {
    const target = state.players.find((p) => p.id === offerBuilderTargetId);
    if (!target || !myPlayer) {
        offerBuilderTargetId = null;
        render();
        return;
    }

    const mkCheckable = (cids, selected, side) => {
        if (!cids || cids.length === 0) return '<div class="offer-empty">нет карт</div>';
        return cids.map((cid) => {
            const cell = state.board[cid];
            const own = state.ownership[cid];
            const color = cell.group ? state.groupColors[cell.group] : "#888";
            const isSel = selected.has(cid);
            const disabled = own.houses > 0 || own.hotel;
            return `
                <button class="offer-toggle ${isSel ? 'selected' : ''}"
                        data-side="${side}" data-cid="${cid}"
                        style="border-left:5px solid ${color}"
                        ${disabled ? 'disabled title="Сначала снеси постройки"' : ''}>
                    ${escapeHtml(cell.name)}
                </button>
            `;
        }).join("");
    };

    card.innerHTML = `
        <div class="card-header" style="background:${target.color}">
            <div class="card-type-label">🤝 Предложение сделки</div>
            <h1>Для ${escapeHtml(target.name)}</h1>
        </div>
        <div class="card-body">
            <div class="offer-section">
                <div class="offer-label">Я отдаю (мои карты):</div>
                <div class="offer-props-grid">${mkCheckable(myPlayer.properties, offerBuilderMyProps, 'my')}</div>
                <div class="trade-row">
                    <label>+ деньги:</label>
                    <input type="number" id="offer-my-cash" min="0" max="${myPlayer.balance}" value="0" step="10">
                </div>
            </div>
            <div class="offer-arrow">⇅</div>
            <div class="offer-section">
                <div class="offer-label">Я хочу (его карты):</div>
                <div class="offer-props-grid">${mkCheckable(target.properties, offerBuilderTheirProps, 'their')}</div>
                <div class="trade-row">
                    <label>+ деньги:</label>
                    <input type="number" id="offer-their-cash" min="0" max="${target.balance}" value="0" step="10">
                </div>
            </div>
            <div id="card-actions"></div>
        </div>
    `;

    card.querySelectorAll(".offer-toggle").forEach((btn) => {
        btn.onclick = () => {
            const cid = parseInt(btn.dataset.cid, 10);
            const side = btn.dataset.side;
            const set = side === "my" ? offerBuilderMyProps : offerBuilderTheirProps;
            if (set.has(cid)) set.delete(cid);
            else set.add(cid);
            render();
        };
    });

    const actions = $("card-actions");
    actions.appendChild(makeBtn("Отправить", () => {
        const myCash = parseInt($("offer-my-cash")?.value, 10) || 0;
        const theirCash = parseInt($("offer-their-cash")?.value, 10) || 0;
        socket.emit("trade:send-offer", {
            toId: target.id,
            myProps: [...offerBuilderMyProps],
            theirProps: [...offerBuilderTheirProps],
            myCash,
            theirCash,
        });
        offerBuilderTargetId = null;
        offerBuilderMyProps = new Set();
        offerBuilderTheirProps = new Set();
    }, "primary"));
    actions.appendChild(makeBtn("Отмена", () => {
        offerBuilderTargetId = null;
        offerBuilderMyProps = new Set();
        offerBuilderTheirProps = new Set();
        render();
    }, "secondary"));
}

function renderCasinoOffer(card, _myPlayer, minBet) {
    card.innerHTML = `
        <div class="card-header casino-header">
            <div class="card-type-label">🎰 Казино</div>
            <h1>Казино</h1>
        </div>
        <div class="card-body">
            <div class="casino-jackpot-line">
                <span>Джекпот:</span>
                <b>$${state.jackpot}</b>
            </div>
            <div class="card-drawn-text">
                Барабан из 3 слотов: 💎 👑 ⭐ 🍒. Сделай ставку и крути.
                Проигрыш → джекпот. 💎💎 — забираешь джекпот + бонус.
            </div>
            <div class="casino-bet-row">
                <label>Ставка:</label>
                <input type="number" id="casino-bet-input" min="${minBet}" value="${minBet}" step="10">
            </div>
            <div class="casino-mode-row">
                <label class="mode-option">
                    <input type="radio" name="casino-mode" value="group" checked>
                    <span>С другими игроками</span>
                </label>
                <label class="mode-option">
                    <input type="radio" name="casino-mode" value="solo">
                    <span>Одному</span>
                </label>
            </div>
            <div id="card-actions"></div>
        </div>
    `;
    const actions = $("card-actions");
    actions.appendChild(makeBtn("Играть", () => {
        const bet = parseInt($("casino-bet-input").value, 10);
        const mode = document.querySelector('input[name="casino-mode"]:checked')?.value;
        socket.emit("casino:accept", { bet, solo: mode === "solo" });
    }, "primary"));
    actions.appendChild(makeBtn("Отказаться", () => {
        socket.emit("casino:decline");
    }, "secondary"));
}

function renderCasinoView(card, myPlayer, isMyTurn) {
    const game = state.casinoGame;
    const slots = game.slots || ["?", "?", "?"];

    const totalBet = Object.values(game.bets).reduce((a, b) => a + b, 0);

    const betLines = Object.keys(game.bets).map((pidStr) => {
        const pid = parseInt(pidStr, 10);
        const p = state.players.find((pp) => pp.id === pid);
        if (!p) return "";
        const isInit = pid === game.initiatorId;
        return `
            <div class="casino-bet-line${isInit ? ' init' : ''}">
                <span class="color-swatch" style="background:${p.color};width:14px;height:14px"></span>
                <span class="bet-name">${escapeHtml(p.name)}${isInit ? ' (инициатор)' : ''}</span>
                <span class="bet-amount">$${game.bets[pid]}</span>
            </div>
        `;
    }).join("");

    const pendingLines = game.waitingFor.map((pid) => {
        const p = state.players.find((pp) => pp.id === pid);
        if (!p) return "";
        return `
            <div class="casino-bet-line pending">
                <span class="color-swatch" style="background:${p.color};width:14px;height:14px"></span>
                <span class="bet-name">${escapeHtml(p.name)}</span>
                <span class="bet-amount">ждём...</span>
            </div>
        `;
    }).join("");

    const declinedLines = Object.keys(game.decisions)
        .filter((pid) => game.decisions[pid] === "declined")
        .map((pidStr) => {
            const pid = parseInt(pidStr, 10);
            const p = state.players.find((pp) => pp.id === pid);
            if (!p) return "";
            return `
                <div class="casino-bet-line declined">
                    <span class="color-swatch" style="background:${p.color};width:14px;height:14px"></span>
                    <span class="bet-name">${escapeHtml(p.name)}</span>
                    <span class="bet-amount">пас</span>
                </div>
            `;
        }).join("");

    let resultHtml = "";
    if (game.result) {
        if (game.result.win) {
            const multiText = game.result.jackpotWin
                ? "джекпот"
                : `×${game.result.multiplier}`;
            resultHtml = `
                <div class="casino-result win">
                    <div class="result-title">${game.result.jackpotWin ? "🎊 ДЖЕКПОТ! 🎊" : "🎉 ВЫИГРЫШ! 🎉"}</div>
                    <div>Приз: <b>$${game.result.prize}</b> (${multiText})</div>
                    <div>Каждому: <b>$${game.result.perWinner}</b></div>
                </div>
            `;
        } else {
            resultHtml = `
                <div class="casino-result loss">
                    <div class="result-title">💨 Без выигрыша</div>
                    <div>$${game.result.toJackpot} уходит в джекпот</div>
                </div>
            `;
        }
    }

    const amIWaiting = myPlayer && game.phase === "betting" && game.waitingFor.includes(myPlayer.id);
    const myBetRow = amIWaiting ? `
        <div class="casino-bet-row">
            <label>Ставка (мин $${game.minBet}):</label>
            <input type="number" id="casino-bet-input" min="${game.minBet}" value="${game.minBet}" step="10">
        </div>
    ` : "";

    card.innerHTML = `
        <div class="card-header casino-header">
            <div class="card-type-label">🎰 Казино</div>
            <h1>Казино</h1>
        </div>
        <div class="card-body">
            <div class="casino-slots">
                <div class="slot">${slots[0]}</div>
                <div class="slot">${slots[1]}</div>
                <div class="slot">${slots[2]}</div>
            </div>

            <div class="casino-combos">
                <div class="combo-title">Комбинации</div>
                <div class="combo-row"><span>💎 💎 💎</span><b>×50</b></div>
                <div class="combo-row"><span>👑 👑 👑</span><b>×30</b></div>
                <div class="combo-row"><span>⭐ ⭐ ⭐</span><b>×20</b></div>
                <div class="combo-row"><span>🍒 🍒 🍒</span><b>×10</b></div>
                <div class="combo-row combo-divider"><span>💎 💎</span><b>ДЖЕКПОТ</b></div>
                <div class="combo-row"><span>👑 👑</span><b>×5</b></div>
                <div class="combo-row"><span>⭐ ⭐</span><b>×3</b></div>
                <div class="combo-row"><span>🍒 🍒</span><b>×2</b></div>
            </div>

            <div class="casino-stats">
                <div class="casino-stat jackpot">
                    <div class="stat-label">Джекпот</div>
                    <div class="stat-value">$${state.jackpot}</div>
                </div>
                <div class="casino-stat pool">
                    <div class="stat-label">Сумма ставок</div>
                    <div class="stat-value">$${totalBet}</div>
                </div>
            </div>

            <div class="casino-bets">
                ${betLines}
                ${pendingLines}
                ${declinedLines}
            </div>

            ${resultHtml}
            ${myBetRow}

            <div id="card-actions"></div>
        </div>
    `;

    const actions = $("card-actions");
    const pa = state.pendingAction;

    if (amIWaiting) {
        actions.appendChild(makeBtn("Играть", () => {
            const bet = parseInt($("casino-bet-input").value, 10);
            socket.emit("casino:join", { bet });
        }, "primary"));
        actions.appendChild(makeBtn("Отказаться", () => {
            socket.emit("casino:skip");
        }, "secondary"));
    }

    if (game.phase === "done" && pa && pa.type === "casino-result" && isMyTurn && myPlayer?.id === game.initiatorId) {
        actions.appendChild(makeBtn("Продолжить", () => {
            socket.emit("casino:continue");
        }, "primary"));
    }
}

function makeBtn(label, onClick, variant = "primary") {
    const b = document.createElement("button");
    b.innerText = label;
    b.className = `card-action-btn ${variant}`;
    b.onclick = onClick;
    return b;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

$("own-cards-toggle").onclick = () => {
    ownCardsExpanded = !ownCardsExpanded;
    render();
};

class DebugTool {
    constructor(login, password) {
        this._socket = socket;
        this._authenticated = false;
        this._authError = null;

        this.ready = new Promise((resolve) => {
            this._socket.emit("debug:auth", { login, password }, (res) => {
                if (res?.success) {
                    this._authenticated = true;
                    console.log("%c🛠 DebugTool авторизован", "color:#3aa744;font-weight:bold");
                    resolve(true);
                } else {
                    this._authError = res?.error || "Неверные данные.";
                    console.error(`❌ DebugTool: ${this._authError}`);
                    resolve(false);
                }
            });
        });
    }

    _guard() {
        if (!this._authenticated) {
            const msg = this._authError
                ? `DebugTool: ${this._authError}`
                : "DebugTool: не авторизован (await .ready)";
            throw new Error(msg);
        }
    }

    _emit(cmd, extra = {}) {
        this._guard();
        this._socket.emit("debug:cmd", { cmd, ...extra });
    }

    moveTo(player, n) {
        if (n === undefined) { this._emit("moveTo", { position: player }); return; }
        this._emit("playerMoveTo", { target: player, position: n });
    }
    moveF(player, n) { this._emit("playerMoveF", { target: player, steps: n }); }
    moveB(player, n) { this._emit("playerMoveB", { target: player, steps: n }); }
    give(player, type, data) { this._emit("playerGive", { target: player, type, data }); }
    take(player, type, data) { this._emit("playerTake", { target: player, type, data }); }
    turn(player) { this._emit("playerTurn", { target: player }); }

    setJackpot(amount) { this._emit("setJackpot", { amount }); }

    board() {
        this._guard();
        if (!state) return console.warn("нет состояния");
        console.table(state.board.map((c, i) => ({ id: i, name: c.name, type: c.type, group: c.group || "", price: c.price || "" })));
    }
    players() {
        this._guard();
        if (!state) return console.warn("нет состояния");
        console.table(state.players.map((p) => ({ id: p.id, name: p.name, pos: p.position, cell: state.board[p.position].name, balance: p.balance, bankrupt: p.bankrupt, inJail: p.inJail })));
    }
    state() {
        this._guard();
        return state;
    }

    help() {
        console.log("%cDebugTool КОМАНДЫ", "color:#d4af37;font-weight:bold;font-size:14px");
        console.log(`
Создание:
  const d = new DebugTool("login", "password")
  await d.ready    // дождись ответа сервера

player — имя игрока (строка) или id (число)

Управление игроком:
  d.moveTo(player, n)        — телепорт игрока на клетку n (0-39)
  d.moveF(player, n)         — сдвинуть игрока вперёд на n клеток
  d.moveB(player, n)         — сдвинуть игрока назад на n клеток
  d.give(player, "balance", amt)      — добавить игроку денег
  d.give(player, "property", cardId)  — дать игроку карту
  d.take(player, "balance", amt)      — снять с игрока деньги
  d.take(player, "property", cardId)  — забрать у игрока карту (в банк)
  d.turn(player)             — передать ход игроку

Общее:
  d.setJackpot(amt)          — изменить джекпот казино
  d.board()                  — список клеток
  d.players()                — список игроков
  d.state()                  — полное состояние игры
  d.help()                   — эта справка

Примеры:
  d.moveTo("Alice", 20)               → Alice на Казино
  d.moveF("Bob", 5)                   → Bob вперёд на 5
  d.give("Alice", "balance", 1000)    → +$1000 Alice
  d.give(0, "property", 34)           → игрок id=0 получает Лондон
  d.take("Bob", "property", 39)       → забрать Нью-Йорк у Bob
  d.turn("Alice")                     → ходит Alice
        `);
    }
}

window.DebugTool = DebugTool;
console.log("%c🛠 Доступен DebugTool. Новый: const d = new DebugTool('login', 'password')", "color:#d4af37");
