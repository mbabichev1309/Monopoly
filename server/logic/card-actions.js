const { BOARD } = require("../board-data");
const CFG = require("../config");

const BOARD_SIZE = CFG.game.boardSize;

function apply(game, player, action) {
    const chanceMult = (game.modifiers || []).includes("chances") ? 1.25 : 1.0;
    const adj = (amount) => Math.floor(amount * chanceMult);

    const postSettle = () => {
        game.phase = "action";
        game.pendingAction = game.doublesCount > 0 && !player.inJail && !player.bankrupt
            ? { type: "roll-again" }
            : { type: "end-turn-only" };
    };

    if (action.type === "collect") {
        const a = adj(action.amount);
        player.balance += a;
        game.logMsg(`{p:${player.id}} получил $${a}.`);
        postSettle();
        return;
    }
    if (action.type === "pay") {
        const a = adj(action.amount);
        if (player.balance < a && player.properties.length > 0) {
            const paid = Math.max(0, player.balance);
            player.balance -= paid;
            game.logMsg(`{p:${player.id}} частично заплатил $${paid} (требовалось $${a}). Баланс ${player.balance}.`);
        } else {
            player.balance -= a;
            game.logMsg(`{p:${player.id}} заплатил $${a} в банк.`);
            if (player.balance < 0 && player.properties.length === 0) game.bankruptPlayer(player, null);
        }
        postSettle();
        return;
    }
    if (action.type === "collect-each") {
        const perPlayer = adj(action.amount);
        const skipped = [];
        let totalReceived = 0;
        for (const other of game.players) {
            if (other.id === player.id || other.bankrupt || other.left) continue;
            if (other.balance < perPlayer) {
                skipped.push(other);
                continue;
            }
            other.balance -= perPlayer;
            player.balance += perPlayer;
            totalReceived += perPlayer;
        }
        game.logMsg(`{p:${player.id}} получил $${totalReceived} (по $${perPlayer} с игроков).`);
        for (const s of skipped) {
            game.logMsg(`{p:${s.id}} не смог заплатить $${perPlayer} (второй шанс).`);
        }
        postSettle();
        return;
    }
    if (action.type === "pay-each") {
        for (const other of game.players) {
            if (other.id === player.id || other.bankrupt || other.left) continue;
            game.payMoney(player, other, action.amount);
        }
        game.logMsg(`{p:${player.id}} заплатил по $${action.amount} каждому игроку.`);
        postSettle();
        return;
    }
    if (action.type === "pay-per-building") {
        let totalHouses = 0;
        let totalHotels = 0;
        for (const cid of player.properties) {
            const own = game.ownership[cid];
            if (own.hotel) totalHotels++;
            else totalHouses += own.houses;
        }
        const amount = totalHouses * action.perHouse + totalHotels * action.perHotel;
        if (amount > 0) {
            if (player.balance < amount && player.properties.length > 0) {
                const paid = Math.max(0, player.balance);
                player.balance -= paid;
                game.logMsg(`{p:${player.id}} частично заплатил $${paid} за ремонт (требовалось $${amount}).`);
            } else {
                player.balance -= amount;
                game.logMsg(`{p:${player.id}} заплатил $${amount} за ремонт (${totalHouses}🏠 + ${totalHotels}🏨).`);
                if (player.balance < 0 && player.properties.length === 0) game.bankruptPlayer(player, null);
            }
        } else {
            game.logMsg(`У {p:${player.id}} нет построек, ремонт бесплатно.`);
        }
        postSettle();
        return;
    }
    if (action.type === "jail") {
        game.sendToJail(player);
        postSettle();
        return;
    }
    if (action.type === "get-out-jail") {
        player.freeJailCards = (player.freeJailCards || 0) + 1;
        game.logMsg(`🔑 {p:${player.id}} получил карту освобождения из тюрьмы (всего: ${player.freeJailCards}).`);
        postSettle();
        return;
    }
    if (action.type === "build-anywhere") {
        player.buildAnywhereTokens = (player.buildAnywhereTokens || 0) + 1;
        game.logMsg(`🏗 {p:${player.id}} получил разрешение на постройку дома.`);
        postSettle();
        return;
    }
    if (action.type === "move") {
        const oldPos = player.position;
        player.position = action.position;
        if (action.collectOnPass && player.position < oldPos) game.passGo(player);
        game.resolveCell(player);
        return;
    }
    if (action.type === "move-relative") {
        const oldPos = player.position;
        player.position = ((player.position + action.steps) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
        if (action.collectOnPass && action.steps > 0 && player.position < oldPos) game.passGo(player);
        if (action.steps < 0) game.lastMoveDirection = "backward";
        game.resolveCell(player);
        return;
    }
    if (action.type === "move-nearest") {
        const targetType = action.target;
        let nearest = null;
        for (let offset = 1; offset < BOARD_SIZE; offset++) {
            const pos = (player.position + offset) % BOARD_SIZE;
            if (BOARD[pos].type === targetType) { nearest = pos; break; }
        }
        if (nearest !== null) {
            const oldPos = player.position;
            player.position = nearest;
            if (action.collectOnPass && player.position < oldPos) game.passGo(player);
            game.resolveCell(player);
            return;
        }
        postSettle();
        return;
    }
    postSettle();
}

module.exports = { apply };
