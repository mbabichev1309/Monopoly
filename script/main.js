import Monopoly from "./Monopoly.js";

let LOC = {};
window.I18N.load("game").then((dict) => {
    LOC = dict;
    window.I18N.applyTranslations(document, dict);
});
function t(key, params) {
    let s = LOC[key];
    if (s === undefined) return key;
    if (params) for (const k in params) s = s.replace(new RegExp(`\\{${k}\\}`, "g"), params[k]);
    return s;
}

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

let casinoAnimState = null;
let lastCasinoPhase = null;

let viewingOffer = false;
let recentGiftNotif = null;
let giftNotifTimer = null;

socket.on("connect", () => {
    socket.emit("lobby:rejoin", { lobbyId, playerName: me.name });
});

const chatPanelEl = $("chat-panel");
const chatMessagesEl = $("chat-messages");
const chatInputEl = $("chat-input");
const chatFormEl = $("chat-input-row");
const chatBadgeEl = $("chat-unread-badge");

let chatUnreadCount = 0;
let chatActive = false;

function setChatUnread(count) {
    chatUnreadCount = count;
    if (!chatPanelEl) return;
    if (count > 0) {
        chatPanelEl.classList.add("has-unread");
        if (chatBadgeEl) {
            chatBadgeEl.innerText = count > 99 ? "99+" : String(count);
            chatBadgeEl.style.display = "flex";
        }
    } else {
        chatPanelEl.classList.remove("has-unread");
        if (chatBadgeEl) chatBadgeEl.style.display = "none";
    }
}

function clearChatUnread() {
    setChatUnread(0);
}

function appendChatMessage(msg, opts = {}) {
    if (!chatMessagesEl) return;
    const div = document.createElement("div");
    div.className = "chat-msg";
    if (opts.fresh) div.classList.add("fresh");
    const nameSpan = document.createElement("span");
    nameSpan.className = "chat-msg-name";
    nameSpan.style.color = msg.color || "#d4af37";
    nameSpan.innerText = msg.name + ":";
    const textSpan = document.createElement("span");
    textSpan.className = "chat-msg-text";
    textSpan.innerText = " " + msg.text;
    div.appendChild(nameSpan);
    div.appendChild(textSpan);
    chatMessagesEl.appendChild(div);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    if (opts.fresh) {
        setTimeout(() => div.classList.remove("fresh"), 2400);
    }
}

if (chatFormEl) {
    chatFormEl.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = chatInputEl.value.trim();
        if (!text) return;
        socket.emit("chat:send", { text });
        chatInputEl.value = "";
    });
}
if (chatInputEl) {
    chatInputEl.addEventListener("focus", () => {
        chatActive = true;
        clearChatUnread();
    });
    chatInputEl.addEventListener("blur", () => {
        chatActive = false;
    });
}
if (chatPanelEl) {
    chatPanelEl.addEventListener("click", clearChatUnread);
}

const chatExpandBtn = $("chat-expand-btn");
if (chatExpandBtn && chatPanelEl) {
    chatExpandBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const expanded = chatPanelEl.classList.toggle("expanded");
        chatExpandBtn.innerText = expanded ? "▼" : "▲";
        if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    });
}

socket.on("chat:message", (msg) => {
    const myId = me?.name === msg.name;
    appendChatMessage(msg, { fresh: !myId });
    if (!myId && !chatActive) {
        setChatUnread(chatUnreadCount + 1);
    }
});
socket.on("chat:history", (msgs) => {
    if (!chatMessagesEl) return;
    chatMessagesEl.innerHTML = "";
    for (const m of msgs) appendChatMessage(m);
    clearChatUnread();
});

socket.on("game:state", (newState) => {
    const prevState = state;
    state = newState;
    if (prevState) {
        for (const p of state.players) {
            const prev = prevState.players.find((pp) => pp.id === p.id);
            if (prev && prev.position !== p.position && !p.bankrupt) {
                const delay = diceAnimation ? 1000 : 0;
                const backward = state.lastMoveDirection === "backward";
                monopoly.startMoveAnimation(p.id, prev.position, p.position, { delay, durationPerStep: 200, backward });
            }
            if (prev && prev.balance !== p.balance) {
                pendingBalanceDeltas.push({ pid: p.id, delta: p.balance - prev.balance });
            }
        }
    }
    for (const p of state.players) previousBalances[p.id] = p.balance;

    const nowPhase = state.casinoGame?.phase || null;
    if (lastCasinoPhase !== "done" && nowPhase === "done" && state.casinoGame?.slots) {
        casinoAnimState = {
            startTime: performance.now(),
            finalSlots: state.casinoGame.slots.slice(),
        };
    }
    lastCasinoPhase = nowPhase;

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
        monopoly.setCenterTopOverride(t("watermark_hurry"), 2500);
    }
});

socket.on("game:gift-received", ({ toId, fromName, amount }) => {
    const myPlayer = state?.players.find((p) => p.socketId === socket.id);
    if (!myPlayer || toId !== myPlayer.id) return;
    recentGiftNotif = { fromName, amount, at: performance.now() };
    if (giftNotifTimer) clearTimeout(giftNotifTimer);
    giftNotifTimer = setTimeout(() => {
        recentGiftNotif = null;
        giftNotifTimer = null;
        if (state) render();
    }, 4000);
    render();
});

socket.on("game:error", ({ message }) => {
    alert(message);
});

socket.on("game:over", ({ winnerName }) => {
    alert(t("alert_game_over", { name: winnerName }));
});

$("roll-dice-button").onclick = () => socket.emit("game:roll");
$("end-turn-button").onclick = () => socket.emit("game:end-turn");

$("use-jail-card-button").onclick = () => socket.emit("game:use-jail-card");

const historyBtn = $("open-history-btn");
if (historyBtn) {
    historyBtn.onclick = () => window.open("log.html", "_blank");
}

const lobbyCodeBadge = $("lobby-code-badge");
if (lobbyCodeBadge && lobbyId) lobbyCodeBadge.innerText = lobbyId;

const isHost = sessionStorage.getItem("isHost") === "1";
const deleteLobbyBtn = $("delete-lobby-btn");
if (deleteLobbyBtn && isHost) {
    deleteLobbyBtn.style.display = "";
    deleteLobbyBtn.onclick = () => {
        if (!confirm(t("confirm_delete_room"))) return;
        socket.emit("lobby:delete");
    };
}

(function setupResizers() {
    const root = document.documentElement;
    const KEY = "monopoly:side-w";
    const minW = 200, maxW = 600;

    const saved = localStorage.getItem(KEY);
    if (saved) root.style.setProperty("--side-w", saved);

    function bindResizer(el, side) {
        if (!el) return;
        el.addEventListener("mousedown", (e) => {
            e.preventDefault();
            el.classList.add("dragging");
            document.body.style.cursor = "ew-resize";
            document.body.style.userSelect = "none";
            const onMove = (ev) => {
                const x = ev.clientX;
                const w = side === "left" ? x - 15 : window.innerWidth - x - 15;
                const clamped = Math.max(minW, Math.min(maxW, w));
                root.style.setProperty("--side-w", clamped + "px");
            };
            const onUp = () => {
                el.classList.remove("dragging");
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                const w = root.style.getPropertyValue("--side-w").trim();
                if (w) localStorage.setItem(KEY, w);
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        });
        el.addEventListener("dblclick", () => {
            root.style.removeProperty("--side-w");
            localStorage.removeItem(KEY);
        });
    }
    bindResizer($("resizer-left"), "left");
    bindResizer($("resizer-right"), "right");
})();

socket.on("lobby:deleted", () => {
    sessionStorage.removeItem("lobbyId");
    sessionStorage.removeItem("me");
    sessionStorage.removeItem("isHost");
    alert(t("alert_room_deleted"));
    window.location.replace("index.html");
});

$("exit-to-menu-btn").onclick = () => {
    if (!confirm(t("exit_confirm"))) return;
    socket.emit("game:leave");
    sessionStorage.removeItem("lobbyId");
    sessionStorage.removeItem("me");
    sessionStorage.removeItem("isHost");
    setTimeout(() => { window.location.href = "index.html"; }, 150);
};

window.addEventListener("beforeunload", () => {
    try { socket.emit("game:leave"); } catch (e) {}
});

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

    let topText = null;
    if (state.phase === "ended") topText = null;
    else if (canEndTurn) topText = t("watermark_end_turn");
    else if (isMyTurn && state.phase === "roll") topText = t("watermark_your_turn");
    monopoly.centerOverlay.topText = topText;

    monopoly.centerOverlay.bottomText = computeBottomNotif(myPlayer, isMyTurn);

    const myIncomingOffer = myPlayer && state.pendingOffers?.[myPlayer.id];
    if (!myIncomingOffer) viewingOffer = false;

    updateAttentionCell(myPlayer, isMyTurn);
    updateTradeHighlights(myPlayer);
    if (pa?.type === "roll-again" && isMyTurn) {
        $("end-turn-button").querySelector("h4").innerText = t("btn_roll_again");
    } else {
        $("end-turn-button").querySelector("h4").innerText = t("btn_end_turn");
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
    monopoly.setInnerInfo({ jackpot: state.jackpot, round: state.roundNumber });
    monopoly.draw_map(state.board, state.groupColors, state.ownership, state.players);
    monopoly.drawInnerDecor();
    monopoly.drawTradeHighlights(now);
    monopoly.drawAttentionWaves(now);
    monopoly.draw_tokens(state.players, state.currentPlayerId, now);
    drawDice(now);
    updateCasinoSlotAnim(now);
    requestAnimationFrame(boardFrame);
}

const CASINO_SLOT_STOPS = [1400, 1900, 2400];
function updateCasinoSlotAnim(now) {
    if (!casinoAnimState) return;
    const symbols = state?.casinoSymbols || ["💎", "👑", "⭐", "🍒"];
    const slotEls = document.querySelectorAll(".casino-slots .slot");
    if (slotEls.length !== 3) return;
    const elapsed = now - casinoAnimState.startTime;

    for (let i = 0; i < 3; i++) {
        if (elapsed >= CASINO_SLOT_STOPS[i]) {
            slotEls[i].textContent = casinoAnimState.finalSlots[i];
            slotEls[i].classList.remove("spinning");
            slotEls[i].classList.add("locked");
        } else {
            const idx = Math.floor(elapsed / 55 + i * 2) % symbols.length;
            slotEls[i].textContent = symbols[idx];
            slotEls[i].classList.add("spinning");
            slotEls[i].classList.remove("locked");
        }
    }

    if (elapsed >= CASINO_SLOT_STOPS[2] + 200) {
        for (const el of slotEls) el.classList.remove("spinning", "locked");
        casinoAnimState = null;
        render();
    }
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

        const hasOfferFromMe = myPlayer && state.pendingOffers?.[myPlayer.id]?.fromId === p.id;
        if (hasOfferFromMe) div.classList.add("has-pending-offer");

        const isMe = myPlayer && p.id === myPlayer.id;
        const meBadge = isMe ? `<span class="me-badge">${t("tag_me")}</span>` : "";
        const initials = getInitials(p.name);
        const textColor = isDarkHex(p.color) ? "#fff" : "#1a1208";
        const swatch = `<span class="player-avatar" style="background:${p.color};color:${textColor}">${escapeHtml(initials)}</span>`;

        let statusTag = "";
        if (p.bankrupt) statusTag = ` <span class="player-tag tag-bankrupt">${t("tag_bankrupt")}</span>`;
        else if (p.left) statusTag = ` <span class="player-tag tag-left">${t("tag_left")}</span>`;
        else if (p.id === state.currentPlayerId && state.phase !== "ended") statusTag = ` <span class="active-player">${t("tag_turn")}</span>`;

        const jailBadge = p.inJail && !p.bankrupt && !p.left ? ` <span class="player-tag tag-jail">${t("tag_jail")}</span>` : "";
        const goojfBadge = (p.freeJailCards || 0) > 0 ? ` <span class="player-tag tag-key" title="${t("title_jail_cards")}">🔑${p.freeJailCards}</span>` : "";
        const buildBadge = (p.buildAnywhereTokens || 0) > 0 ? ` <span class="player-tag tag-build" title="${t("title_build_tokens")}">🏗${p.buildAnywhereTokens}</span>` : "";

        const isMuted = myPlayer && (myPlayer.mutedIds || []).includes(p.id);

        let controlsHtml = "";
        if (!isMe && myPlayer && !myPlayer.bankrupt && !myPlayer.left && !p.bankrupt && !p.left) {
            const isCurrent = p.id === state.currentPlayerId;
            controlsHtml = `
                <div class="player-controls">
                    <button class="player-ctrl-btn mute-btn ${isMuted ? 'muted' : ''}" data-pid="${p.id}" data-act="mute" title="${isMuted ? t('title_mute_on') : t('title_mute_off')}">${isMuted ? '🔇' : '🔔'}</button>
                    <button class="player-ctrl-btn hurry-btn" data-pid="${p.id}" data-act="hurry" title="${t('title_hurry')}" ${isCurrent ? '' : 'disabled'}>⏰</button>
                </div>
            `;
        }

        div.innerHTML = `
            <div class="player-main">
                <h3>${meBadge}${swatch}<span class="player-name-text">${escapeHtml(p.name)}</span>${statusTag}${jailBadge}${goojfBadge}${buildBadge}</h3>
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
    const log = (state.log || []).slice(-30);
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

function computeBottomNotif(myPlayer, isMyTurn) {
    if (!myPlayer) return null;
    const pa = state.pendingAction;

    if (isMyTurn && pa && (pa.type === "pay-rent" || pa.type === "pay-tax")
        && myPlayer.balance < pa.amount && myPlayer.properties.length > 0) {
        return t("notif_have_property");
    }

    if (recentGiftNotif && (performance.now() - recentGiftNotif.at) < 4000) {
        return t("notif_gift_received", { name: recentGiftNotif.fromName, amount: recentGiftNotif.amount });
    }
    const offer = state.pendingOffers?.[myPlayer.id];
    if (offer) {
        const sender = state.players.find((p) => p.id === offer.fromId);
        return t("notif_offer_from", { name: sender ? sender.name : "?" });
    }
    if (state.auction
        && state.auction.participantIds.includes(myPlayer.id)
        && !state.auction.passedIds.includes(myPlayer.id)) {
        const cell = state.board[state.auction.cardId];
        return t("notif_auction", { name: cell.name });
    }
    if (isMyTurn && pa && ["buy-option", "pay-rent", "pay-tax", "card-draw", "casino-offer"].includes(pa.type)) {
        return t("notif_action_required");
    }
    return null;
}

function updateTradeHighlights(myPlayer) {
    const red = new Set();
    const green = new Set();
    if (!myPlayer) {
        monopoly.tradeHighlights = { red, green };
        return;
    }
    if (offerBuilderTargetId !== null && offerBuilderTargetId !== undefined) {
        for (const cid of offerBuilderMyProps) red.add(cid);
        for (const cid of offerBuilderTheirProps) green.add(cid);
    } else if (viewingOffer) {
        const offer = state.pendingOffers?.[myPlayer.id];
        if (offer) {
            if (Array.isArray(offer.theirProps)) for (const cid of offer.theirProps) red.add(cid);
            if (Array.isArray(offer.myProps)) for (const cid of offer.myProps) green.add(cid);
        }
    }
    monopoly.tradeHighlights = { red, green };
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

    if (pendingCellId === null && state.auction
        && state.auction.participantIds.includes(myPlayer.id)
        && !state.auction.passedIds.includes(myPlayer.id)) {
        pendingCellId = state.auction.cardId;
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
    list.innerHTML = "";
    if (!myPlayer) return;

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

(function preserveInputsOnRerender() {
    const cardEl = $("card");
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(cardEl, "innerHTML", {
        get() { return desc.get.call(cardEl); },
        set(val) {
            const saved = {};
            cardEl.querySelectorAll("input[id]").forEach((el) => {
                saved[el.id] = {
                    value: el.value,
                    focused: document.activeElement === el,
                    start: el.selectionStart,
                    end: el.selectionEnd,
                };
            });
            desc.set.call(cardEl, val);
            for (const id in saved) {
                const el = cardEl.querySelector(`#${CSS.escape(id)}`);
                if (!el) continue;
                el.value = saved[id].value;
                if (saved[id].focused) {
                    el.focus();
                    try { el.setSelectionRange(saved[id].start, saved[id].end); } catch (e) {}
                }
            }
        },
        configurable: true,
    });
})();

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

    // Аукцион — виден по умолчанию, но клик на карту/игрока переключает
    if (state.auction && selectedCardId === null && selectedPlayerId === null
        && offerBuilderTargetId === null && !viewingOffer) {
        renderAuctionView(card, myPlayer);
        return;
    }

    const pa0 = state.pendingAction;
    if (pa0 && pa0.type === "casino-offer" && isMyTurn) {
        renderCasinoOffer(card, myPlayer, pa0.minBet);
        return;
    }

    const incomingOffer = myPlayer && state.pendingOffers?.[myPlayer.id];
    if (incomingOffer && viewingOffer) {
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
        card.innerHTML = `<div class="card-empty">${t("card_empty")}</div>`;
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
        property: t("card_type_property"),
        railroad: t("card_type_railroad"),
        utility: t("card_type_utility"),
        tax: t("card_type_tax"),
        chance: t("card_type_chance"),
        community: t("card_type_community"),
        casino: t("card_type_casino"),
        corner: t("card_type_corner"),
    };

    const rentMult = state.rentMultiplier || 1;
    const rm = (n) => Math.floor(n * rentMult);
    const formatMult = (m) => Math.abs(m - Math.round(m)) < 0.001 ? String(Math.round(m)) : m.toFixed(2).replace(/\.?0+$/, "");
    const rentHintHtml = rentMult !== 1
        ? `<div class="rent-mult-hint">${t("rent_mult_hint", { mult: formatMult(rentMult) })}</div>`
        : "";

    let rentHtml = "";
    if (cell.type === "property") {
        rentHtml = `
            ${rentHintHtml}
            <div class="rent-section">
                <div class="rent-row"><span>${t("rent_base")}</span><b>$${rm(cell.rent[0])}</b></div>
                <div class="rent-row"><span>${t("rent_house_n", { n: 1 })}</span><b>$${rm(cell.rent[1])}</b></div>
                <div class="rent-row"><span>${t("rent_houses_n", { n: 2 })}</span><b>$${rm(cell.rent[2])}</b></div>
                <div class="rent-row"><span>${t("rent_houses_n", { n: 3 })}</span><b>$${rm(cell.rent[3])}</b></div>
                <div class="rent-row"><span>${t("rent_houses_n", { n: 4 })}</span><b>$${rm(cell.rent[4])}</b></div>
                <div class="rent-row"><span>${t("rent_hotel")}</span><b>$${rm(cell.rent[5])}</b></div>
            </div>
        `;
    } else if (cell.type === "railroad") {
        rentHtml = `
            ${rentHintHtml}
            <div class="rent-section">
                <div class="rent-row"><span>${t("rent_railroad_n", { n: 1 })}</span><b>$${rm(cell.rent[0])}</b></div>
                <div class="rent-row"><span>${t("rent_railroad_n", { n: 2 })}</span><b>$${rm(cell.rent[1])}</b></div>
                <div class="rent-row"><span>${t("rent_railroad_n", { n: 3 })}</span><b>$${rm(cell.rent[2])}</b></div>
                <div class="rent-row"><span>${t("rent_railroad_n", { n: 4 })}</span><b>$${rm(cell.rent[3])}</b></div>
            </div>
        `;
    } else if (cell.type === "utility") {
        rentHtml = `${rentHintHtml}<div class="rent-section"><div class="rent-row"><span>${t("rent_utility_one")}</span><b>${t("rent_x_dice", { n: formatMult(4 * rentMult) })}</b></div><div class="rent-row"><span>${t("rent_utility_both")}</span><b>${t("rent_x_dice", { n: formatMult(10 * rentMult) })}</b></div></div>`;
    } else if (cell.type === "tax") {
        rentHtml = `<div class="rent-section"><div class="rent-row"><span>${t("rent_tax")}</span><b>$${cell.amount}</b></div></div>`;
    } else if (cell.type === "chance" || cell.type === "community") {
        const isMatching = state.lastDrawnCard && state.lastDrawnCard.type === cell.type;
        const text = isMatching ? state.lastDrawnCard.text : t("card_draw_default");
        rentHtml = `<div class="card-drawn-text ${isMatching ? 'active' : ''}">${escapeHtml(text)}</div>`;
    } else if (cell.type === "casino") {
        if (state.features && state.features.casino === false) {
            rentHtml = `<div class="card-drawn-text">${t("casino_disabled")}</div>`;
        } else {
            rentHtml = `<div class="card-drawn-text">${t("casino_description")}</div>`;
        }
    } else if (cell.type === "corner") {
        if (cell.action === "go") {
            rentHtml = `<div class="card-drawn-text">${t("start_description")}</div>`;
        } else if (cell.action === "jail") {
            rentHtml = `<div class="card-drawn-text">${t("jail_description")}</div>`;
        } else if (cell.action === "go-to-jail") {
            rentHtml = `<div class="card-drawn-text">${t("gotojail_description")}</div>`;
        }
    }

    let ownerHtml = "";
    if (own) {
        const ownerPlayer = state.players.find((p) => p.id === own.ownerId);
        const ownerText = ownerPlayer ? `<span style="color:${ownerPlayer.color}">${escapeHtml(ownerPlayer.name)}</span>` : `<i>${t("card_owner_free")}</i>`;
        ownerHtml = `
            <div class="card-owner-line">${t("card_owner")}: ${ownerText}</div>
            <div class="card-buildings">
                ${own.hotel ? t("card_hotel") : own.houses > 0 ? t("card_houses_count", { n: own.houses }) : ''}
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
                    <span>${t("card_house")}: <b>$${cell.housePrice}</b></span>
                    <span>${t("card_hotel")}: <b>$${cell.housePrice}</b></span>
                </div>
                <div class="card-sub-price">
                    <span>${t("card_sell")}: <b>$${sellPrice}</b></span>
                </div>
            `;
        } else {
            extras = `<div class="card-sub-price"><span>${t("card_sell")}: <b>$${sellPrice}</b></span></div>`;
        }
        priceHtml = `
            <div class="card-price">${t("card_price")} <b>$${cell.price}</b></div>
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
            const buyBtn = makeBtn(t("btn_buy_for", { amount: pa.price }), () => socket.emit("game:buy"), "primary");
            if (myPlayer && myPlayer.balance < pa.price) {
                buyBtn.disabled = true;
                buyBtn.title = t("tooltip_cannot_afford");
            }
            actions.appendChild(buyBtn);
            actions.appendChild(makeBtn(t("btn_decline"), () => socket.emit("game:decline-buy"), "secondary"));
            return;
        }
        if (pa.type === "card-draw") {
            actions.appendChild(makeBtn(t("btn_accept_card"), () => socket.emit("game:accept-card"), "primary"));
            return;
        }
        if (pa.type === "pay-tax") {
            actions.appendChild(makeBtn(t("btn_pay_for", { amount: pa.amount }), () => socket.emit("game:accept-pay"), "secondary"));
            return;
        }
        if (pa.type === "pay-rent") {
            actions.appendChild(makeBtn(t("btn_pay_rent_for", { amount: pa.amount }), () => socket.emit("game:accept-pay"), "secondary"));
            return;
        }
    }

    if (state.auction && myPlayer
        && state.auction.participantIds.includes(myPlayer.id)
        && !state.auction.passedIds.includes(myPlayer.id)) {
        actions.appendChild(makeBtn(t("btn_to_auction"), () => {
            selectedCardId = null;
            selectedPlayerId = null;
            render();
        }, "primary"));
    }

    if (own && own.ownerId === myPlayer?.id && cell.type === "property") {
        const refund = Math.floor(cell.housePrice / 2);
        const myCell = state.board[myPlayer.position];
        const standingOnGroup = myCell && myCell.type === "property" && myCell.group === cell.group;
        const hasBuildToken = (myPlayer.buildAnywhereTokens || 0) > 0;
        const canBuild = standingOnGroup || hasBuildToken;
        if (!own.hotel && own.houses < 4 && canBuild) {
            const label = !standingOnGroup && hasBuildToken
                ? t("btn_buy_house_token_for", { amount: cell.housePrice })
                : t("btn_buy_house_for", { amount: cell.housePrice });
            actions.appendChild(makeBtn(label, () => {
                socket.emit("game:buy-house", { cardId });
            }));
        }
        if (!own.hotel && own.houses === 4 && canBuild) {
            const label = !standingOnGroup && hasBuildToken
                ? t("btn_buy_hotel_token_for", { amount: cell.housePrice })
                : t("btn_buy_hotel_for", { amount: cell.housePrice });
            actions.appendChild(makeBtn(label, () => {
                socket.emit("game:buy-hotel", { cardId });
            }));
        }
        if (own.houses > 0 && !own.hotel) {
            actions.appendChild(makeBtn(t("btn_demolish_house_for", { amount: refund }), () => {
                socket.emit("game:sell-house", { cardId });
            }, "secondary"));
        }
        if (own.hotel) {
            actions.appendChild(makeBtn(t("btn_demolish_hotel_for", { amount: refund }), () => {
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
        locked ? t("btn_sell_locked_for", { amount: refund }) : t("btn_sell_for", { amount: refund }),
        () => {
            if (locked) {
                alert(t("alert_unlock_first"));
                return;
            }
            socket.emit("game:sell", { cardId });
        },
        "secondary"
    );
    sellBtn.classList.toggle("is-locked", locked);
    if (locked) sellBtn.title = t("title_unlock_warn");

    const lockBtn = document.createElement("button");
    lockBtn.className = `lock-btn ${locked ? "closed" : "open"}`;
    lockBtn.innerText = locked ? "🔒" : "🔓";
    lockBtn.title = locked ? t("title_open_lock") : t("title_close_lock");
    lockBtn.onclick = () => socket.emit("game:toggle-lock", { cardId });

    wrap.appendChild(sellBtn);
    wrap.appendChild(lockBtn);
    actions.appendChild(wrap);
}

function renderPlayerView(card, playerId, myPlayer) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) {
        card.innerHTML = `<div class="card-empty">${t("card_empty_player_not_found")}</div>`;
        return;
    }

    const isMe = myPlayer && player.id === myPlayer.id;
    const status = [];
    if (player.bankrupt) status.push(`<span class="player-tag tag-bankrupt">${t("tag_bankrupt")}</span>`);
    if (player.inJail) status.push(`<span class="player-tag tag-jail">${t("tag_jail")}</span>`);
    if (player.id === state.currentPlayerId) status.push(`<span class="player-tag tag-turn">${t("tag_turn")}</span>`);

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
        propsHtml = `<div class="player-view-empty">${t("player_view_no_props")}</div>`;
    }

    let offerBtnHtml = "";
    const incomingOffer = myPlayer && state.pendingOffers?.[myPlayer.id];
    if (!isMe && incomingOffer && incomingOffer.fromId === player.id) {
        offerBtnHtml = `
            <div class="offer-alert">
                <span>${t("player_view_offer_msg")}</span>
                <button class="card-action-btn primary" id="btn-view-offer">${t("btn_view_offer")}</button>
            </div>
        `;
    }

    let tradeHtml = "";
    if (!isMe && myPlayer && !myPlayer.bankrupt && !player.bankrupt) {
        const limits = state.giftLimits || { maxPerRecipient: 500 };
        const giftAmounts = myPlayer.giftAmounts || {};
        const alreadyToThis = giftAmounts[player.id] || 0;
        const remaining = Math.max(0, limits.maxPerRecipient - alreadyToThis);
        const defaultVal = Math.min(50, remaining) || 1;
        tradeHtml = `
            <h3 class="player-view-section-title">${t("player_view_actions")}</h3>
            <div class="trade-block">
                <div class="trade-row">
                    <label>${t("trade_gift_label")}</label>
                    <input type="number" id="gift-money-input" min="1" max="${remaining}" value="${defaultVal}" step="10">
                    <button class="card-action-btn primary" id="btn-gift-money" ${remaining <= 0 ? "disabled" : ""}>
                        ${t("btn_gift")}
                    </button>
                </div>
                <div class="trade-hint">${t("trade_gift_hint", { given: alreadyToThis, max: limits.maxPerRecipient, remaining })}</div>
                <button class="card-action-btn secondary" id="btn-open-offer" style="width:100%;margin-top:8px">
                    ${t("btn_send_offer")}
                </button>
            </div>
        `;
    }

    const amInAuction = state.auction && myPlayer
        && state.auction.participantIds.includes(myPlayer.id)
        && !state.auction.passedIds.includes(myPlayer.id);
    const auctionReturnHtml = amInAuction
        ? `<button id="player-view-return-auction" class="card-action-btn primary" style="width:100%;margin-top:10px">${t("btn_to_auction")}</button>`
        : "";

    card.innerHTML = `
        <div class="card-header player-view-header" style="background:${player.color}">
            <div class="card-type-label">${isMe ? t("card_type_player_me") : t("card_type_player")}</div>
            <h1>${escapeHtml(player.name)}</h1>
        </div>
        <div class="card-body">
            <div class="player-view-balance">$${player.balance}</div>
            <div class="player-view-status">${status.join(" ") || "&nbsp;"}</div>
            <h3 class="player-view-section-title">${t("player_view_section_props", { n: player.properties.length })}</h3>
            ${propsHtml}
            ${offerBtnHtml}
            ${tradeHtml}
            ${auctionReturnHtml}
            <button id="player-view-close" class="secondary" style="margin-top:15px;width:100%">${t("btn_close")}</button>
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

    const auctionReturnBtn = $("player-view-return-auction");
    if (auctionReturnBtn) {
        auctionReturnBtn.onclick = () => {
            selectedPlayerId = null;
            selectedCardId = null;
            render();
        };
    }

    const viewOfferBtn = $("btn-view-offer");
    if (viewOfferBtn) {
        viewOfferBtn.onclick = () => {
            viewingOffer = true;
            selectedPlayerId = null;
            render();
        };
    }

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
    if (winner) placings.push({ player: winner, place: 1, label: t("victory_winner_label") });
    for (let i = byBankOrder.length - 1; i >= 0; i--) {
        const p = state.players.find((pp) => pp.id === byBankOrder[i]);
        if (!p) continue;
        placings.push({ player: p, place: placings.length + 1, label: p.left ? t("tag_left") : t("tag_bankrupt") });
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
            <div class="card-type-label">${t("victory_title")}</div>
            <h1>${winner ? escapeHtml(winner.name) + " " + t("victory_winner_suffix") : t("victory_title")}</h1>
        </div>
        <div class="card-body">
            <h3 class="player-view-section-title">${t("victory_places")}</h3>
            <div class="victory-list">
                ${placings.map((pl) => `
                    <div class="victory-row ${pl.place === 1 ? 'first' : ''}">
                        <span class="victory-place">${pl.place === 1 ? '🏆' : pl.place}</span>
                        ${playerChip(pl.player)}
                        <span class="victory-label">${pl.label}</span>
                    </div>
                `).join("")}
            </div>

            <h3 class="player-view-section-title">${t("victory_records")}</h3>
            <div class="victory-stats">
                <div class="victory-stat">
                    <div class="vs-label">${t("victory_max_balance")}</div>
                    ${playerChip(maxBalance)}
                    <span class="vs-value">$${maxBalance?.balance || 0}</span>
                </div>
                <div class="victory-stat">
                    <div class="vs-label">${t("victory_max_props")}</div>
                    ${playerChip(maxProps)}
                    <span class="vs-value">${maxProps?.properties?.length || 0}</span>
                </div>
                <div class="victory-stat">
                    <div class="vs-label">${t("victory_max_cap")}</div>
                    ${playerChip(maxCapPlayer)}
                    <span class="vs-value">$${maxCap}</span>
                </div>
            </div>

            <h3 class="player-view-section-title">${t("victory_stats")}</h3>
            <div class="victory-stats">
                <div class="victory-stat">
                    <div class="vs-label">${t("victory_top_bought")}</div>
                    ${playerChip(topBought.player)}
                    <span class="vs-value">${topBought.value} ${t("victory_pcs")}</span>
                </div>
                <div class="victory-stat">
                    <div class="vs-label">${t("victory_top_spent")}</div>
                    ${playerChip(topSpent.player)}
                    <span class="vs-value">$${topSpent.value}</span>
                </div>
                <div class="victory-stat">
                    <div class="vs-label">${t("victory_top_casino")}</div>
                    ${playerChip(topCasino.player)}
                    <span class="vs-value">$${topCasino.value}</span>
                </div>
                <div class="victory-stat">
                    <div class="vs-label">${t("victory_top_rent")}</div>
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
            return `<button class="offer-prop-btn" data-cid="${cid}" style="border-left:5px solid ${color}" title="${t("title_view_card")}">${escapeHtml(cell.name)}</button>`;
        }).join("");
    };

    card.innerHTML = `
        <div class="card-header" style="background:${senderColor}">
            <div class="card-type-label">${t("offer_title")}</div>
            <h1>${t("offer_from_label", { name: escapeHtml(offer.fromName) })}</h1>
        </div>
        <div class="card-body">
            <div class="offer-section">
                <div class="offer-label">${t("offer_take")}</div>
                ${mkPropList(offer.myProps)}
                ${offer.myCash > 0 ? `<div class="offer-cash">+ $${offer.myCash}</div>` : ""}
            </div>
            <div class="offer-arrow">⇅</div>
            <div class="offer-section">
                <div class="offer-label">${t("offer_give")}</div>
                ${mkPropList(offer.theirProps)}
                ${offer.theirCash > 0 ? `<div class="offer-cash debt">− $${offer.theirCash}</div>` : ""}
            </div>
            <div id="card-actions"></div>
        </div>
    `;

    card.querySelectorAll(".offer-prop-btn").forEach((btn) => {
        btn.onclick = () => {
            const cid = parseInt(btn.dataset.cid, 10);
            selectedCardId = cid;
            viewingOffer = false;
            render();
        };
    });

    const actions = $("card-actions");
    actions.appendChild(makeBtn(t("btn_accept_offer"), () => {
        socket.emit("trade:accept");
        viewingOffer = false;
    }, "primary"));
    actions.appendChild(makeBtn(t("btn_decline_offer"), () => {
        socket.emit("trade:decline");
        viewingOffer = false;
    }, "secondary"));
}

function renderOfferBuilder(card, myPlayer) {
    const target = state.players.find((p) => p.id === offerBuilderTargetId);
    if (!target || !myPlayer) {
        offerBuilderTargetId = null;
        render();
        return;
    }

    const mkCheckable = (cids, selected, side) => {
        if (!cids || cids.length === 0) return `<div class="offer-empty">${t("offer_no_cards")}</div>`;
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
                        ${disabled ? `disabled title="${t("title_demolish_first")}"` : ''}>
                    ${escapeHtml(cell.name)}
                </button>
            `;
        }).join("");
    };

    card.innerHTML = `
        <div class="card-header" style="background:${target.color}">
            <div class="card-type-label">${t("offer_title")}</div>
            <h1>${t("offer_to_label", { name: escapeHtml(target.name) })}</h1>
        </div>
        <div class="card-body">
            <div class="offer-section">
                <div class="offer-label">${t("offer_my_props")}</div>
                <div class="offer-props-grid">${mkCheckable(myPlayer.properties, offerBuilderMyProps, 'my')}</div>
                <div class="trade-row">
                    <label>${t("offer_plus_money")}</label>
                    <input type="number" id="offer-my-cash" min="0" max="${myPlayer.balance}" value="0" step="10">
                </div>
            </div>
            <div class="offer-arrow">⇅</div>
            <div class="offer-section">
                <div class="offer-label">${t("offer_their_props")}</div>
                <div class="offer-props-grid">${mkCheckable(target.properties, offerBuilderTheirProps, 'their')}</div>
                <div class="trade-row">
                    <label>${t("offer_plus_money")}</label>
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
    actions.appendChild(makeBtn(t("btn_send"), () => {
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
    actions.appendChild(makeBtn(t("btn_cancel"), () => {
        offerBuilderTargetId = null;
        offerBuilderMyProps = new Set();
        offerBuilderTheirProps = new Set();
        render();
    }, "secondary"));
}

function renderAuctionView(card, myPlayer) {
    const a = state.auction;
    const cell = state.board[a.cardId];
    const groupColor = cell.group ? state.groupColors[cell.group] : "#888";

    const currentBidderPlayer = a.currentBidderId !== null
        ? state.players.find((p) => p.id === a.currentBidderId) : null;

    const bidLines = (a.participantIds || []).map((pid) => {
        const p = state.players.find((pp) => pp.id === pid);
        if (!p) return "";
        const isCurrent = pid === a.currentBidderId;
        const passed = a.passedIds.includes(pid);
        let status;
        if (passed) status = t("casino_passed");
        else if (isCurrent) status = t("auction_status_leading", { amount: a.currentBid });
        else status = t("auction_status_waiting");
        return `
            <div class="auction-player-line ${passed ? 'passed' : ''} ${isCurrent ? 'leading' : ''}">
                <span class="color-swatch" style="background:${p.color};width:14px;height:14px"></span>
                <span class="bet-name">${escapeHtml(p.name)}</span>
                <span class="bet-amount">${status}</span>
            </div>
        `;
    }).join("");

    const amIActive = myPlayer
        && a.participantIds.includes(myPlayer.id)
        && !a.passedIds.includes(myPlayer.id);
    const minBid = a.currentBid === 0 ? a.startPrice : a.currentBid + a.minRaise;

    const myRow = amIActive ? `
        <div class="casino-bet-row">
            <label>${t("auction_bet_min", { amount: minBid })}</label>
            <input type="number" id="auction-bid-input" min="${minBid}" value="${minBid}" step="${a.minRaise}">
        </div>
    ` : "";

    card.innerHTML = `
        <div class="card-header" style="background:${groupColor}">
            <div class="card-type-label">${t("auction_title")}</div>
            <h1>${escapeHtml(cell.name)}</h1>
        </div>
        <div class="card-body">
            <div class="card-price">${t("auction_start_price", { amount: a.startPrice })}</div>
            <div class="casino-stats">
                <div class="casino-stat jackpot">
                    <div class="stat-label">${t("auction_current_bid")}</div>
                    <div class="stat-value">${a.currentBid > 0 ? `$${a.currentBid}` : "—"}</div>
                </div>
                <div class="casino-stat pool">
                    <div class="stat-label">${t("auction_step")}</div>
                    <div class="stat-value">$${a.minRaise}</div>
                </div>
            </div>
            ${currentBidderPlayer ? `<div class="card-owner-line">${t("auction_leader")}: <span style="color:${currentBidderPlayer.color}">${escapeHtml(currentBidderPlayer.name)}</span></div>` : ""}
            <h3 class="player-view-section-title">${t("auction_participants")}</h3>
            <div class="casino-bets">${bidLines}</div>
            ${myRow}
            <div id="card-actions"></div>
        </div>
    `;

    const actions = $("card-actions");
    if (amIActive) {
        actions.appendChild(makeBtn(t("btn_bid"), () => {
            const amount = parseInt($("auction-bid-input").value, 10);
            socket.emit("auction:bid", { amount });
        }, "primary"));
        const passBtn = makeBtn(t("btn_pass"), () => {
            socket.emit("auction:pass");
        }, "secondary");
        if (a.currentBidderId === myPlayer?.id) {
            passBtn.disabled = true;
            passBtn.title = t("tooltip_auction_leader_no_pass");
        }
        actions.appendChild(passBtn);
    }
}

function renderCasinoOffer(card, _myPlayer, minBet) {
    card.innerHTML = `
        <div class="card-header casino-header">
            <div class="card-type-label">${t("casino_header_label")}</div>
            <h1>${t("casino_header_title")}</h1>
        </div>
        <div class="card-body">
            <div class="casino-jackpot-line">
                <span>${t("casino_jackpot")}:</span>
                <b>$${state.jackpot}</b>
            </div>
            <div class="card-drawn-text">${t("casino_brief")}</div>
            <div class="casino-bet-row">
                <label>${t("casino_bet_label", { min: minBet, max: state.casinoMaxBet || 500 })}</label>
                <input type="number" id="casino-bet-input" min="${minBet}" max="${state.casinoMaxBet || 500}" value="${minBet}" step="10">
            </div>
            <div class="casino-mode-row">
                <label class="mode-option">
                    <input type="radio" name="casino-mode" value="group" checked>
                    <span>${t("casino_mode_group")}</span>
                </label>
                <label class="mode-option">
                    <input type="radio" name="casino-mode" value="solo">
                    <span>${t("casino_mode_solo")}</span>
                </label>
            </div>
            <div id="card-actions"></div>
        </div>
    `;
    const actions = $("card-actions");
    actions.appendChild(makeBtn(t("btn_play"), () => {
        const bet = parseInt($("casino-bet-input").value, 10);
        const mode = document.querySelector('input[name="casino-mode"]:checked')?.value;
        socket.emit("casino:accept", { bet, solo: mode === "solo" });
    }, "primary"));
    actions.appendChild(makeBtn(t("btn_decline"), () => {
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
                <span class="bet-name">${escapeHtml(p.name)}${isInit ? ' ' + t("casino_initiator") : ''}</span>
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
                <span class="bet-amount">${t("casino_waiting")}</span>
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
                    <span class="bet-amount">${t("casino_passed")}</span>
                </div>
            `;
        }).join("");

    let resultHtml = "";
    if (game.result && !casinoAnimState) {
        if (game.result.win) {
            const multiText = game.result.jackpotWin
                ? t("casino_combo_jackpot").toLowerCase()
                : `×${game.result.multiplier}`;
            resultHtml = `
                <div class="casino-result win">
                    <div class="result-title">${game.result.jackpotWin ? t("casino_result_jackpot") : t("casino_result_win")}</div>
                    <div>${t("casino_result_prize", { amount: game.result.prize, mult: multiText })}</div>
                    <div>${t("casino_result_per_winner", { amount: game.result.perWinner })}</div>
                </div>
            `;
        } else {
            resultHtml = `
                <div class="casino-result loss">
                    <div class="result-title">${t("casino_result_lose")}</div>
                    <div>${t("casino_result_to_jackpot", { amount: game.result.toJackpot })}</div>
                </div>
            `;
        }
    }

    const amIWaiting = myPlayer && game.phase === "betting" && game.waitingFor.includes(myPlayer.id);
    const maxBet = state.casinoMaxBet || 500;
    const myBetRow = amIWaiting ? `
        <div class="casino-bet-row">
            <label>${t("casino_bet_label", { min: game.minBet, max: maxBet })}</label>
            <input type="number" id="casino-bet-input" min="${game.minBet}" max="${maxBet}" value="${game.minBet}" step="10">
        </div>
    ` : "";

    card.innerHTML = `
        <div class="card-header casino-header">
            <div class="card-type-label">${t("casino_header_label")}</div>
            <h1>${t("casino_header_title")}</h1>
        </div>
        <div class="card-body">
            <div class="casino-slots">
                <div class="slot">${slots[0]}</div>
                <div class="slot">${slots[1]}</div>
                <div class="slot">${slots[2]}</div>
            </div>

            <div class="casino-combos">
                <div class="combo-title">${t("casino_combos")}</div>
                <div class="combo-row combo-divider"><span>💎 💎 💎</span><b>${t("casino_combo_jackpot")} ×20</b></div>
                <div class="combo-row"><span>👑 👑 👑</span><b>×10</b></div>
                <div class="combo-row"><span>⭐ ⭐ ⭐</span><b>×5</b></div>
                <div class="combo-row"><span>🍒 🍒 🍒</span><b>×3</b></div>
                ${state.modifiers?.includes("gambler") ? `
                <div class="combo-row"><span>🍋 🍋 🍋</span><b>×3</b></div>
                <div class="combo-row"><span>🍇 🍇 🍇</span><b>×3</b></div>
                ` : ""}
                <div class="combo-row combo-divider"><span>💎 💎</span><b>×2</b></div>
                <div class="combo-row"><span>👑 👑</span><b>×1.5</b></div>
                <div class="combo-row"><span>⭐ ⭐</span><b>×1.3</b></div>
                <div class="combo-row"><span>🍒 🍒</span><b>×1.2</b></div>
                ${state.modifiers?.includes("gambler") ? `
                <div class="combo-row"><span>🍋 🍋</span><b>×1.2</b></div>
                <div class="combo-row"><span>🍇 🍇</span><b>×1.2</b></div>
                ` : ""}
            </div>

            <div class="casino-stats">
                <div class="casino-stat jackpot">
                    <div class="stat-label">${t("casino_jackpot")}</div>
                    <div class="stat-value">$${state.jackpot}</div>
                </div>
                <div class="casino-stat pool">
                    <div class="stat-label">${t("casino_pool")}</div>
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
        actions.appendChild(makeBtn(t("btn_play"), () => {
            const bet = parseInt($("casino-bet-input").value, 10);
            socket.emit("casino:join", { bet });
        }, "primary"));
        actions.appendChild(makeBtn(t("btn_decline"), () => {
            socket.emit("casino:skip");
        }, "secondary"));
    }

    if (game.phase === "ready-to-spin" && myPlayer?.id === game.initiatorId) {
        actions.appendChild(makeBtn(t("btn_spin"), () => {
            socket.emit("casino:spin");
        }, "primary"));
    }

    if (game.phase === "done" && !casinoAnimState && pa && pa.type === "casino-result" && isMyTurn && myPlayer?.id === game.initiatorId) {
        actions.appendChild(makeBtn(t("btn_continue"), () => {
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

function getInitials(name) {
    if (!name) return "?";
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function isDarkHex(hex) {
    const m = String(hex || "").replace("#", "");
    if (m.length < 6) return false;
    const r = parseInt(m.substring(0, 2), 16);
    const g = parseInt(m.substring(2, 4), 16);
    const b = parseInt(m.substring(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}


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
    kick(player) { this._emit("playerKick", { target: player }); }

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
  d.kick(player)             — выкинуть игрока (помечает "вышел")

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
