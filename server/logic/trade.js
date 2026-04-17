const { BOARD } = require("../board-data");
const CFG = require("../config");

const GIFT_MAX_PER_RECIPIENT = CFG.limits.giftMaxPerRecipient;
const HURRY_COOLDOWN = CFG.limits.hurryLapCooldown;

function giftMoney(game, fromPlayer, data) {
    const toId = parseInt(data?.toId, 10);
    const amount = parseInt(data?.amount, 10);

    if (isNaN(toId)) return { error: "Не указан получатель." };
    if (isNaN(amount) || amount <= 0) return { error: "Неверная сумма." };

    fromPlayer.giftAmounts = fromPlayer.giftAmounts || {};
    const alreadyToThis = fromPlayer.giftAmounts[toId] || 0;
    const remaining = GIFT_MAX_PER_RECIPIENT - alreadyToThis;
    if (remaining <= 0) {
        return { error: `Лимит подарков этому игроку исчерпан ($${GIFT_MAX_PER_RECIPIENT}).` };
    }
    if (amount > remaining) {
        return { error: `Максимум можно подарить этому игроку ещё $${remaining}.` };
    }
    if (fromPlayer.balance < amount) return { error: "Недостаточно денег." };

    const to = game.players.find((p) => p.id === toId);
    if (!to) return { error: "Игрок не найден." };
    if (to.bankrupt) return { error: "Игрок обанкротился." };
    if (to.left) return { error: "Игрок вышел." };
    if (to.id === fromPlayer.id) return { error: "Нельзя себе." };

    fromPlayer.balance -= amount;
    to.balance += amount;
    fromPlayer.giftAmounts[toId] = alreadyToThis + amount;

    game.logMsg(`💝 {p:${fromPlayer.id}} подарил $${amount} игроку {p:${to.id}}. (всего: $${fromPlayer.giftAmounts[toId]}/$${GIFT_MAX_PER_RECIPIENT})`);
    return { events: [] };
}

function sendOffer(game, fromPlayer, data) {
    const toId = parseInt(data?.toId, 10);
    const myProps = (data?.myProps || []).map((c) => parseInt(c, 10)).filter((c) => !isNaN(c));
    const theirProps = (data?.theirProps || []).map((c) => parseInt(c, 10)).filter((c) => !isNaN(c));
    const myCash = Math.max(0, parseInt(data?.myCash, 10) || 0);
    const theirCash = Math.max(0, parseInt(data?.theirCash, 10) || 0);

    const to = game.players.find((p) => p.id === toId);
    if (!to) return { error: "Игрок не найден." };
    if (to.bankrupt) return { error: "Игрок обанкротился." };
    if (to.left) return { error: "Игрок вышел." };
    if (to.id === fromPlayer.id) return { error: "Нельзя себе." };
    if ((to.mutedIds || []).includes(fromPlayer.id)) {
        return { error: "Этот игрок тебя замутил." };
    }

    if (myProps.length === 0 && theirProps.length === 0 && myCash === 0 && theirCash === 0) {
        return { error: "Пустое предложение." };
    }

    for (const cid of myProps) {
        if (!fromPlayer.properties.includes(cid)) return { error: "Эта карта не твоя." };
        const own = game.ownership[cid];
        if (own.houses > 0 || own.hotel) return { error: `На "${BOARD[cid].name}" есть постройки.` };
    }
    for (const cid of theirProps) {
        if (!to.properties.includes(cid)) return { error: "У получателя нет этой карты." };
        const own = game.ownership[cid];
        if (own.houses > 0 || own.hotel) return { error: `На "${BOARD[cid].name}" есть постройки.` };
    }
    if (myCash > fromPlayer.balance) return { error: "Недостаточно денег для предложения." };

    game.pendingOffers[to.id] = {
        fromId: fromPlayer.id,
        fromName: fromPlayer.name,
        toId: to.id,
        toName: to.name,
        myProps, theirProps, myCash, theirCash,
    };

    game.logMsg(`🤝 {p:${fromPlayer.id}} отправил предложение игроку {p:${to.id}}.`);
    return { events: [] };
}

function acceptOffer(game, player) {
    const offer = game.pendingOffers[player.id];
    if (!offer) return { error: "Нет предложения." };

    const sender = game.players.find((p) => p.id === offer.fromId);
    if (!sender || sender.bankrupt || sender.left) {
        delete game.pendingOffers[player.id];
        return { error: "Отправитель недоступен." };
    }

    if (offer.theirCash > player.balance) return { error: "У тебя недостаточно денег." };
    if (offer.myCash > sender.balance) return { error: "У отправителя недостаточно денег." };

    for (const cid of offer.myProps) {
        if (!sender.properties.includes(cid)) return { error: "Отправитель больше не владеет картой." };
        const own = game.ownership[cid];
        if (own.houses > 0 || own.hotel) return { error: `На "${BOARD[cid].name}" постройки.` };
    }
    for (const cid of offer.theirProps) {
        if (!player.properties.includes(cid)) return { error: "Ты больше не владеешь картой." };
        const own = game.ownership[cid];
        if (own.houses > 0 || own.hotel) return { error: `На "${BOARD[cid].name}" постройки.` };
    }

    sender.balance -= offer.myCash;
    player.balance += offer.myCash;
    player.balance -= offer.theirCash;
    sender.balance += offer.theirCash;

    for (const cid of offer.myProps) {
        game.ownership[cid].ownerId = player.id;
        sender.properties = sender.properties.filter((c) => c !== cid);
        if (!player.properties.includes(cid)) player.properties.push(cid);
    }
    for (const cid of offer.theirProps) {
        game.ownership[cid].ownerId = sender.id;
        player.properties = player.properties.filter((c) => c !== cid);
        if (!sender.properties.includes(cid)) sender.properties.push(cid);
    }

    delete game.pendingOffers[player.id];

    const parts = [];
    if (offer.myProps.length) parts.push(`${offer.myProps.length} карт → {p:${player.id}}`);
    if (offer.theirProps.length) parts.push(`${offer.theirProps.length} карт → {p:${sender.id}}`);
    if (offer.myCash) parts.push(`$${offer.myCash}: {p:${sender.id}} → {p:${player.id}}`);
    if (offer.theirCash) parts.push(`$${offer.theirCash}: {p:${player.id}} → {p:${sender.id}}`);
    game.logMsg(`🤝 Сделка принята. ${parts.join(", ")}.`);
    return { events: [] };
}

function declineOffer(game, player) {
    const offer = game.pendingOffers[player.id];
    if (!offer) return { error: "Нет предложения." };
    delete game.pendingOffers[player.id];
    game.logMsg(`{p:${player.id}} отклонил предложение от {p:${offer.fromId}}.`);
    return { events: [] };
}

function cancelOffer(game, player) {
    const recipientId = Object.keys(game.pendingOffers).find(
        (toId) => game.pendingOffers[toId].fromId === player.id
    );
    if (!recipientId) return { error: "У тебя нет отправленных предложений." };
    const offer = game.pendingOffers[recipientId];
    delete game.pendingOffers[recipientId];
    game.logMsg(`{p:${player.id}} отменил предложение к {p:${offer.toId}}.`);
    return { events: [] };
}

function toggleMute(game, player, data) {
    const targetId = parseInt(data?.targetId, 10);
    if (isNaN(targetId) || targetId === player.id) return { error: "Неверная цель." };
    player.mutedIds = player.mutedIds || [];
    if (player.mutedIds.includes(targetId)) {
        player.mutedIds = player.mutedIds.filter((id) => id !== targetId);
    } else {
        player.mutedIds.push(targetId);
    }
    return { events: [] };
}

function hurryPlayer(game, caller, data) {
    const targetId = parseInt(data?.targetId, 10);
    if (isNaN(targetId) || targetId === caller.id) return { error: "Неверная цель." };
    const target = game.players.find((p) => p.id === targetId);
    if (!target) return { error: "Игрок не найден." };
    if (target.bankrupt || target.left) return { error: "Игрок выбыл." };
    if (game.players[game.currentPlayerIndex].id !== targetId) {
        return { error: "Сейчас не его ход." };
    }

    caller.hurryHistory = caller.hurryHistory || {};
    const lastLap = caller.hurryHistory[targetId];
    if (lastLap !== undefined && (caller.lapCount - lastLap) < HURRY_COOLDOWN) {
        const wait = HURRY_COOLDOWN - (caller.lapCount - lastLap);
        return { error: `Можешь торопить только через ${wait} круг(а).` };
    }
    caller.hurryHistory[targetId] = caller.lapCount;

    game.logMsg(`⏰ {p:${caller.id}} торопит игрока {p:${target.id}}.`);
    return {
        events: [{
            name: "game:hurry",
            data: { fromId: caller.id, fromName: caller.name, toId: target.id, toSocketId: target.socketId },
        }],
    };
}

module.exports = {
    giftMoney, sendOffer, acceptOffer, declineOffer, cancelOffer, toggleMute, hurryPlayer,
};
