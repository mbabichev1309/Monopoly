const CFG = require("../config");
const BOARD_SIZE = CFG.game.boardSize;

function resolvePlayer(game, target) {
    if (target === undefined || target === null) return null;
    if (typeof target === "number") {
        return game.players.find((p) => p.id === target) || null;
    }
    if (typeof target === "string") {
        const asNum = parseInt(target, 10);
        if (!isNaN(asNum) && String(asNum) === target.trim()) {
            const byId = game.players.find((p) => p.id === asNum);
            if (byId) return byId;
        }
        const lower = target.toLowerCase();
        return game.players.find((p) => p.name === target || p.name.toLowerCase() === lower) || null;
    }
    return null;
}

function run(game, player, data) {
    const cmd = data?.cmd;
    switch (cmd) {
        case "moveTo": {
            const pos = parseInt(data.position, 10);
            if (isNaN(pos) || pos < 0 || pos >= BOARD_SIZE) return { error: "Неверная позиция." };
            player.position = pos;
            game.logMsg(`🛠 [DEBUG] {p:${player.id}} → {c:${pos}}`);
            game.resolveCell(player);
            return { events: [] };
        }
        case "moveBy": {
            const steps = parseInt(data.steps, 10);
            if (isNaN(steps)) return { error: "Неверное число шагов." };
            const oldPos = player.position;
            player.position = ((player.position + steps) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
            if (steps > 0 && player.position < oldPos && !player.inJail) game.passGo(player);
            game.logMsg(`🛠 [DEBUG] {p:${player.id}} на ${steps > 0 ? "+" : ""}${steps} → {c:${player.position}}`);
            game.resolveCell(player);
            return { events: [] };
        }
        case "setBalance": {
            const amount = parseInt(data.amount, 10);
            if (isNaN(amount)) return { error: "Неверная сумма." };
            player.balance = amount;
            game.logMsg(`🛠 [DEBUG] {p:${player.id}}: баланс = $${amount}`);
            return { events: [] };
        }
        case "setJackpot": {
            const amount = parseInt(data.amount, 10);
            if (isNaN(amount)) return { error: "Неверная сумма." };
            game.jackpot = amount;
            game.logMsg(`🛠 [DEBUG] джекпот = $${amount}`);
            return { events: [] };
        }
        case "giveProperty": {
            const cardId = parseInt(data.cardId, 10);
            if (isNaN(cardId) || !game.ownership[cardId]) return { error: "Нет такой собственности." };
            const own = game.ownership[cardId];
            if (own.ownerId !== null) {
                const oldOwner = game.players.find((p) => p.id === own.ownerId);
                if (oldOwner) oldOwner.properties = oldOwner.properties.filter((c) => c !== cardId);
            }
            own.ownerId = player.id;
            own.houses = 0;
            own.hotel = false;
            if (!player.properties.includes(cardId)) player.properties.push(cardId);
            game.logMsg(`🛠 [DEBUG] {p:${player.id}} получил {c:${cardId}}`);
            return { events: [] };
        }
        case "setTurn": {
            const targetId = parseInt(data.playerId, 10);
            const idx = game.players.findIndex((p) => p.id === targetId);
            if (idx < 0) return { error: "Игрок не найден." };
            game.currentPlayerIndex = idx;
            game.phase = "roll";
            game.pendingAction = null;
            game.doublesCount = 0;
            game.logMsg(`🛠 [DEBUG] ход передан: {p:${game.players[idx].id}}`);
            return { events: [] };
        }
        case "playerMoveTo": {
            const target = resolvePlayer(game, data.target);
            if (!target) return { error: "Игрок не найден." };
            const pos = parseInt(data.position, 10);
            if (isNaN(pos) || pos < 0 || pos >= BOARD_SIZE) return { error: "Неверная позиция." };
            target.position = pos;
            game.logMsg(`🛠 [DEBUG] {p:${target.id}} → {c:${pos}}`);
            game.resolveCell(target);
            return { events: [] };
        }
        case "playerMoveF": {
            const target = resolvePlayer(game, data.target);
            if (!target) return { error: "Игрок не найден." };
            const steps = parseInt(data.steps, 10);
            if (isNaN(steps) || steps <= 0) return { error: "Неверное число шагов." };
            const oldPos = target.position;
            target.position = (target.position + steps) % BOARD_SIZE;
            if (target.position < oldPos && !target.inJail) game.passGo(target);
            game.logMsg(`🛠 [DEBUG] {p:${target.id}} +${steps} → {c:${target.position}}`);
            game.resolveCell(target);
            return { events: [] };
        }
        case "playerMoveB": {
            const target = resolvePlayer(game, data.target);
            if (!target) return { error: "Игрок не найден." };
            const steps = parseInt(data.steps, 10);
            if (isNaN(steps) || steps <= 0) return { error: "Неверное число шагов." };
            target.position = ((target.position - steps) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
            game.logMsg(`🛠 [DEBUG] {p:${target.id}} -${steps} → {c:${target.position}}`);
            game.resolveCell(target);
            return { events: [] };
        }
        case "playerGive": {
            const target = resolvePlayer(game, data.target);
            if (!target) return { error: "Игрок не найден." };
            const type = data.type;
            if (type === "balance") {
                const amount = parseInt(data.data, 10);
                if (isNaN(amount)) return { error: "Неверная сумма." };
                target.balance += amount;
                game.logMsg(`🛠 [DEBUG] {p:${target.id}} +$${amount}`);
            } else if (type === "property") {
                const cardId = parseInt(data.data, 10);
                if (!game.ownership[cardId]) return { error: "Нет такой собственности." };
                const own = game.ownership[cardId];
                if (own.ownerId !== null && own.ownerId !== target.id) {
                    const oldOwner = game.players.find((p) => p.id === own.ownerId);
                    if (oldOwner) oldOwner.properties = oldOwner.properties.filter((c) => c !== cardId);
                }
                own.ownerId = target.id;
                own.houses = 0;
                own.hotel = false;
                own.locked = true;
                if (!target.properties.includes(cardId)) target.properties.push(cardId);
                game.logMsg(`🛠 [DEBUG] {p:${target.id}} получил {c:${cardId}}`);
            } else {
                return { error: "type должен быть 'balance' или 'property'." };
            }
            return { events: [] };
        }
        case "playerTake": {
            const target = resolvePlayer(game, data.target);
            if (!target) return { error: "Игрок не найден." };
            const type = data.type;
            if (type === "balance") {
                const amount = parseInt(data.data, 10);
                if (isNaN(amount)) return { error: "Неверная сумма." };
                target.balance -= amount;
                game.logMsg(`🛠 [DEBUG] {p:${target.id}} -$${amount}`);
            } else if (type === "property") {
                const cardId = parseInt(data.data, 10);
                const own = game.ownership[cardId];
                if (!own) return { error: "Нет такой собственности." };
                if (own.ownerId !== target.id) return { error: "У игрока нет этой карты." };
                own.ownerId = null;
                own.houses = 0;
                own.hotel = false;
                own.locked = true;
                target.properties = target.properties.filter((c) => c !== cardId);
                game.logMsg(`🛠 [DEBUG] у {p:${target.id}} забрана {c:${cardId}}`);
            } else {
                return { error: "type должен быть 'balance' или 'property'." };
            }
            return { events: [] };
        }
        case "playerTurn": {
            const target = resolvePlayer(game, data.target);
            if (!target) return { error: "Игрок не найден." };
            game.currentPlayerIndex = game.players.indexOf(target);
            game.phase = "roll";
            game.pendingAction = null;
            game.doublesCount = 0;
            game.logMsg(`🛠 [DEBUG] ход: {p:${target.id}}`);
            return { events: [] };
        }
        default:
            return { error: "Неизвестная debug-команда." };
    }
}

module.exports = { run };
