const { BOARD } = require("../board-data");

function hasFullGroup(game, player, group) {
    const groupCells = BOARD.filter((c) => c.type === "property" && c.group === group);
    return groupCells.every((c) => game.ownership[c.id].ownerId === player.id);
}

function canBuildEvenly(game, group, cardId, action) {
    const groupCells = BOARD.filter((c) => c.type === "property" && c.group === group);
    const counts = groupCells.map((c) => {
        const o = game.ownership[c.id];
        return o.hotel ? 5 : o.houses;
    });
    const thisIdx = groupCells.findIndex((c) => c.id === cardId);
    const thisCount = counts[thisIdx];
    if (action === "buy") return thisCount <= Math.min(...counts);
    return thisCount >= Math.max(...counts);
}

function buy(game, player) {
    if (!game.pendingAction || game.pendingAction.type !== "buy-option") {
        return { error: "Сейчас нельзя покупать." };
    }
    const cardId = game.pendingAction.cardId;
    const cell = BOARD[cardId];
    if (player.balance < cell.price) return { error: "Недостаточно денег." };

    player.balance -= cell.price;
    game.ownership[cardId].ownerId = player.id;
    game.ownership[cardId].locked = true;
    player.properties.push(cardId);
    game.stats[player.id].bought++;
    game.stats[player.id].spent += cell.price;
    game.logMsg(`{p:${player.id}} купил {c:${cardId}} за $${cell.price}.`);

    game.phase = "action";
    game.pendingAction = game.doublesCount > 0 ? { type: "roll-again" } : { type: "end-turn-only" };
    return { events: [] };
}

function declineBuy(game, player) {
    if (!game.pendingAction || game.pendingAction.type !== "buy-option") {
        return { error: "Нечего отклонять." };
    }
    game.logMsg(`{p:${player.id}} отказался покупать.`);
    game.phase = "action";
    game.pendingAction = game.doublesCount > 0 ? { type: "roll-again" } : { type: "end-turn-only" };
    return { events: [] };
}

function sell(game, player, cardId) {
    if (cardId === undefined || cardId === null) return { error: "Не указана карта." };
    const own = game.ownership[cardId];
    if (!own || own.ownerId !== player.id) return { error: "Это не твоя карта." };
    if (own.locked) return { error: "🔒 Карта заблокирована. Открой замок перед продажей." };
    if (own.houses > 0 || own.hotel) return { error: "Сначала снеси постройки." };

    const cell = BOARD[cardId];
    const refund = Math.floor(cell.price / 2);
    player.balance += refund;
    own.ownerId = null;
    own.locked = true;
    player.properties = player.properties.filter((c) => c !== cardId);
    game.logMsg(`{p:${player.id}} продал {c:${cardId}} за $${refund}.`);
    return { events: [] };
}

function buyHouse(game, player, cardId) {
    const own = game.ownership[cardId];
    const cell = BOARD[cardId];
    if (!own || own.ownerId !== player.id) return { error: "Это не твоя карта." };
    if (cell.type !== "property") return { error: "На этой карте нельзя строить." };
    if (own.hotel) return { error: "Уже отель." };
    if (own.houses >= 4) return { error: "Максимум 4 дома." };
    if (player.balance < cell.housePrice) return { error: "Недостаточно денег." };

    if (!hasFullGroup(game, player, cell.group)) {
        return { error: "Нужен полный набор цвета." };
    }
    if (!canBuildEvenly(game, cell.group, cardId, "buy")) {
        return { error: "Строй равномерно. Достройй на других улицах группы сначала." };
    }

    player.balance -= cell.housePrice;
    own.houses++;
    game.stats[player.id].spent += cell.housePrice;
    game.logMsg(`{p:${player.id}} построил дом на {c:${cardId}}. Домов: ${own.houses}.`);
    return { events: [] };
}

function sellHouse(game, player, cardId) {
    const own = game.ownership[cardId];
    const cell = BOARD[cardId];
    if (!own || own.ownerId !== player.id) return { error: "Это не твоя карта." };
    if (own.hotel) return { error: "Сначала снеси отель." };
    if (own.houses <= 0) return { error: "Нет домов для сноса." };
    if (!canBuildEvenly(game, cell.group, cardId, "sell")) {
        return { error: "Сноси равномерно. Сначала снеси на улицах с бóльшим числом домов." };
    }

    const refund = Math.floor(cell.housePrice / 2);
    player.balance += refund;
    own.houses--;
    game.logMsg(`{p:${player.id}} снёс дом на {c:${cardId}}, +$${refund}. Осталось домов: ${own.houses}.`);
    return { events: [] };
}

function buyHotel(game, player, cardId) {
    const own = game.ownership[cardId];
    const cell = BOARD[cardId];
    if (!own || own.ownerId !== player.id) return { error: "Это не твоя карта." };
    if (cell.type !== "property") return { error: "Тут нельзя построить отель." };
    if (own.hotel) return { error: "Уже отель." };
    if (own.houses < 4) return { error: "Нужно 4 дома." };
    if (player.balance < cell.housePrice) return { error: "Недостаточно денег." };

    const groupCells = BOARD.filter((c) => c.type === "property" && c.group === cell.group);
    const others = groupCells.filter((c) => c.id !== cardId);
    const allMaxed = others.every((c) => {
        const o = game.ownership[c.id];
        return o.hotel || o.houses === 4;
    });
    if (!allMaxed) {
        return { error: "На других улицах группы должно быть по 4 дома или отель." };
    }

    player.balance -= cell.housePrice;
    own.houses = 0;
    own.hotel = true;
    game.stats[player.id].spent += cell.housePrice;
    game.logMsg(`{p:${player.id}} построил отель на {c:${cardId}}.`);
    return { events: [] };
}

function sellHotel(game, player, cardId) {
    const own = game.ownership[cardId];
    const cell = BOARD[cardId];
    if (!own || own.ownerId !== player.id) return { error: "Это не твоя карта." };
    if (!own.hotel) return { error: "Нет отеля." };

    const refund = Math.floor(cell.housePrice / 2);
    player.balance += refund;
    own.hotel = false;
    own.houses = 4;
    game.logMsg(`{p:${player.id}} снёс отель на {c:${cardId}}, +$${refund}. Отель → 4 дома.`);
    return { events: [] };
}

function toggleLock(game, player, cardId) {
    const own = game.ownership[cardId];
    if (!own || own.ownerId !== player.id) return { error: "Это не твоя карта." };
    own.locked = !own.locked;
    return { events: [] };
}

module.exports = {
    buy, declineBuy, sell,
    buyHouse, sellHouse, buyHotel, sellHotel,
    toggleLock, hasFullGroup, canBuildEvenly,
};
