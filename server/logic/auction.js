const { BOARD } = require("../board-data");
const CFG = require("../config");

const MIN_RAISE = CFG.limits.auctionMinRaise;

function start(game, cardId) {
    const cell = BOARD[cardId];
    const startPrice = cell.price;

    const others = game.players.filter((p) => !p.bankrupt && !p.left);

    game.auction = {
        cardId,
        startPrice,
        currentBid: 0,
        currentBidderId: null,
        minRaise: MIN_RAISE,
        participantIds: others.map((p) => p.id),
        passedIds: [],
    };

    game.pendingAction = { type: "auction", cardId };
    game.logMsg(`🔨 Аукцион на {c:${cardId}}! Стартовая цена $${startPrice}.`);

    if (others.length === 0) finish(game);
}

function bid(game, player, amount) {
    if (!game.auction) return { error: "Нет активного аукциона." };
    const a = game.auction;
    if (a.passedIds.includes(player.id)) return { error: "Ты уже отказался." };
    if (!a.participantIds.includes(player.id)) return { error: "Ты не участник аукциона." };

    amount = parseInt(amount, 10);
    const minAllowed = a.currentBid === 0 ? a.startPrice : a.currentBid + a.minRaise;
    if (isNaN(amount) || amount < minAllowed) {
        return { error: `Минимальная ставка $${minAllowed}.` };
    }
    if (player.balance < amount) return { error: "Недостаточно денег." };

    a.currentBid = amount;
    a.currentBidderId = player.id;
    game.logMsg(`🔨 {p:${player.id}} ставит $${amount}.`);

    const remaining = a.participantIds.filter((id) => !a.passedIds.includes(id));
    if (remaining.length === 1 && remaining[0] === a.currentBidderId) {
        finish(game);
    }
    return { events: [] };
}

function pass(game, player) {
    if (!game.auction) return { error: "Нет активного аукциона." };
    const a = game.auction;
    if (!a.participantIds.includes(player.id)) return { error: "Ты не участник." };
    if (a.passedIds.includes(player.id)) return { error: "Уже пас." };
    if (a.currentBidderId === player.id) {
        return { error: "Ты ведущий — отказаться нельзя. Жди, пока перебьют." };
    }

    a.passedIds.push(player.id);
    game.logMsg(`{p:${player.id}} отказался от аукциона.`);

    const remaining = a.participantIds.filter((id) => !a.passedIds.includes(id));
    if (remaining.length === 0) {
        finish(game);
    } else if (remaining.length === 1 && a.currentBidderId === remaining[0]) {
        finish(game);
    }
    return { events: [] };
}

function finish(game) {
    const a = game.auction;
    if (!a) return;
    const cardId = a.cardId;

    if (a.currentBidderId !== null && a.currentBid > 0) {
        const winner = game.players.find((p) => p.id === a.currentBidderId);
        winner.balance -= a.currentBid;
        game.ownership[cardId].ownerId = winner.id;
        game.ownership[cardId].locked = true;
        if (!winner.properties.includes(cardId)) winner.properties.push(cardId);
        game.stats[winner.id].bought++;
        game.stats[winner.id].spent += a.currentBid;
        game.logMsg(`🔨 {p:${winner.id}} выиграл аукцион за $${a.currentBid}, взял {c:${cardId}}.`);
    } else {
        game.logMsg(`🔨 Аукцион окончен — никто не поставил, {c:${cardId}} остаётся у банка.`);
    }

    game.auction = null;
    const current = game.players[game.currentPlayerIndex];
    game.phase = "action";
    game.pendingAction = game.doublesCount > 0 && !current.inJail && !current.bankrupt
        ? { type: "roll-again" }
        : { type: "end-turn-only" };
}

module.exports = { start, bid, pass, finish };
