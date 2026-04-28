const { BOARD, GROUP_COLORS } = require("./board-data");
const { CHANCE_CARDS, COMMUNITY_CARDS, shuffle } = require("./cards");
const shuffleArr = shuffle;
const CFG = require("./config");
const presets = require("./presets");

const casino = require("./logic/casino");
const trade = require("./logic/trade");
const debug = require("./logic/debug");
const property = require("./logic/property");
const cardActions = require("./logic/card-actions");
const auction = require("./logic/auction");

const START_BALANCE = CFG.game.startBalance;
const PASS_GO_BONUS = CFG.game.passGoBonus;
const BOARD_SIZE = CFG.game.boardSize;
const JAIL_POSITION = CFG.game.jailPosition;
const JAIL_FINE = CFG.game.jailFine;
const MAX_JAIL_TURNS = CFG.game.maxJailTurns;
const LOG_LIMIT = CFG.game.logLimit;

const CASINO_MIN_BET = CFG.casino.minBet;
const CASINO_STARTING_JACKPOT = CFG.casino.startingJackpot;
const GIFT_MONEY_MAX_PER_RECIPIENT = CFG.limits.giftMaxPerRecipient;

class GameState {
    constructor(lobbyPlayers, settings = {}) {
        this.mode = settings.mode || "classic";
        this.modifiers = settings.modifiers || [];
        this.features = {
            casino: settings.features?.casino !== false,
            auction: settings.features?.auction !== false,
        };
        this.presetId = settings.preset || "main";
        this.preset = presets.get(this.presetId) || presets.get("main");
        const modeCfg = CFG.modes[this.mode] || CFG.modes.classic;
        const effectiveStartBalance = modeCfg.startBalance ?? START_BALANCE;
        this.rentMultiplier = modeCfg.rentMultiplier || 1.0;

        this.board = this.preset && Array.isArray(this.preset.cells)
            ? BOARD.map((c, i) => ({ ...c, name: this.preset.cells[i] || c.name }))
            : BOARD;

        const shuffled = shuffleArr(lobbyPlayers);
        this.players = shuffled.map((p, idx) => ({
            id: idx,
            socketId: p.socketId,
            name: p.name,
            color: p.color,
            balance: effectiveStartBalance,
            position: 0,
            properties: [],
            inJail: false,
            jailTurns: 0,
            bankrupt: false,
            left: false,
            leftAtRound: null,
            giftAmounts: {},
            lapCount: 0,
            mutedIds: [],
            hurryHistory: {},
            freeJailCards: 0,
            buildAnywhereTokens: 0,
        }));

        this.bankruptcyOrder = [];
        this.winnerId = null;
        this.stats = {};
        for (const p of this.players) {
            this.stats[p.id] = { bought: 0, spent: 0, wonCasino: 0, paidRentTax: 0 };
        }

        this.currentPlayerIndex = 0;
        this.phase = "roll";
        this.lastDice = [1, 1];
        this.doublesCount = 0;
        this.pendingAction = null;
        this.log = [];
        this.roundNumber = 1;

        this.chanceDeck = shuffle(CHANCE_CARDS);
        this.chanceIndex = 0;
        this.communityDeck = shuffle(COMMUNITY_CARDS);
        this.communityIndex = 0;
        this.lastDrawnCard = null;

        this.jackpot = CASINO_STARTING_JACKPOT;
        this.casinoGame = null;
        this.pendingOffers = {};
        this.auction = null;
        this.lastMoveDirection = "forward";

        this.ownership = {};
        for (const cell of BOARD) {
            if (cell.type === "property" || cell.type === "railroad" || cell.type === "utility") {
                this.ownership[cell.id] = { ownerId: null, houses: 0, hotel: false, locked: true };
            }
        }
    }

    getPublicState() {
        return {
            players: this.players.map((p) => ({
                id: p.id,
                socketId: p.socketId,
                name: p.name,
                color: p.color,
                balance: p.balance,
                position: p.position,
                properties: p.properties,
                inJail: p.inJail,
                bankrupt: p.bankrupt,
                left: p.left || false,
                leftAtRound: p.leftAtRound ?? null,
                giftAmounts: p.giftAmounts || {},
                lapCount: p.lapCount,
                mutedIds: p.mutedIds || [],
                freeJailCards: p.freeJailCards || 0,
                buildAnywhereTokens: p.buildAnywhereTokens || 0,
            })),
            bankruptcyOrder: this.bankruptcyOrder || [],
            winnerId: this.winnerId,
            stats: this.stats,
            doublesCount: this.doublesCount,
            roundNumber: this.roundNumber,
            mode: this.mode,
            modifiers: this.modifiers,
            features: this.features,
            rentMultiplier: this.rentMultiplier * (this.modifiers.includes("magnate") ? 1.1 : 1),
            lastMoveDirection: this.lastMoveDirection,
            currentPlayerIndex: this.currentPlayerIndex,
            currentPlayerId: this.players[this.currentPlayerIndex].id,
            currentPlayerSocketId: this.players[this.currentPlayerIndex].socketId,
            phase: this.phase,
            lastDice: this.lastDice,
            pendingAction: this.pendingAction,
            lastDrawnCard: this.lastDrawnCard,
            jackpot: this.jackpot,
            casinoGame: this.casinoGame,
            casinoSymbols: this.modifiers.includes("gambler")
                ? [...CFG.casino.symbols, ...(CFG.casino.gamblerExtraSymbols || [])]
                : CFG.casino.symbols,
            casinoMinBet: CASINO_MIN_BET,
            casinoMaxBet: CFG.casino.maxBet || 500,
            auction: this.auction,
            pendingOffers: this.pendingOffers,
            giftLimits: { maxPerRecipient: GIFT_MONEY_MAX_PER_RECIPIENT },
            board: this.board,
            groupColors: GROUP_COLORS,
            presetId: this.presetId,
            presetName: this.preset ? this.preset.name : "Мир",
            ownership: this.ownership,
            log: this.log.slice(-50),
        };
    }

    handleAction(socketId, action, data) {
        const player = this.players.find((p) => p.socketId === socketId);
        if (!player) return { error: "Игрок не найден." };
        if (player.bankrupt) return { error: "Ты выбыл из игры." };

        // Actions allowed from any player (not just current turn)
        if (action === "casinoJoin") return casino.join(this, player, data?.bet);
        if (action === "casinoSkip") return casino.skip(this, player);
        if (action === "auctionBid") return auction.bid(this, player, data?.amount);
        if (action === "auctionPass") return auction.pass(this, player);
        if (action === "debug") return debug.run(this, player, data);
        if (action === "giftMoney") return trade.giftMoney(this, player, data);
        if (action === "sendOffer") return trade.sendOffer(this, player, data);
        if (action === "acceptOffer") return trade.acceptOffer(this, player);
        if (action === "declineOffer") return trade.declineOffer(this, player);
        if (action === "cancelOffer") return trade.cancelOffer(this, player);
        if (action === "toggleMute") return trade.toggleMute(this, player, data);
        if (action === "hurryPlayer") return trade.hurryPlayer(this, player, data);

        // Actions only for current player
        const current = this.players[this.currentPlayerIndex];
        if (player.id !== current.id) return { error: "Сейчас не твой ход." };

        switch (action) {
            case "roll": return this.rollDice(player);
            case "endTurn": return this.endTurn(player);
            case "buy": return property.buy(this, player);
            case "declineBuy": return property.declineBuy(this, player);
            case "sell": return property.sell(this, player, data?.cardId);
            case "buyHouse": return property.buyHouse(this, player, data?.cardId);
            case "sellHouse": return property.sellHouse(this, player, data?.cardId);
            case "buyHotel": return property.buyHotel(this, player, data?.cardId);
            case "sellHotel": return property.sellHotel(this, player, data?.cardId);
            case "toggleLock": return property.toggleLock(this, player, data?.cardId);
            case "acceptCard": return this.acceptCard(player);
            case "acceptPay": return this.acceptPay(player);
            case "useJailCard": return this.useJailCard(player);
            case "casinoAccept": return casino.accept(this, player, data);
            case "casinoDecline": return casino.decline(this, player);
            case "casinoSpin": return casino.spin(this, player);
            case "casinoContinue": return casino.continue(this, player);
            default: return { error: "Неизвестное действие." };
        }
    }

    // ============ CORE TURN/MOVEMENT ============

    passGo(player) {
        player.balance += PASS_GO_BONUS;
        player.lapCount = (player.lapCount || 0) + 1;
        this.logMsg(`{p:${player.id}} прошёл Старт, +$${PASS_GO_BONUS}.`);
    }

    rollDice(player) {
        if (this.phase !== "roll") return { error: "Сейчас не фаза броска." };
        this.lastMoveDirection = "forward";

        const d1 = 1 + Math.floor(Math.random() * 6);
        const d2 = 1 + Math.floor(Math.random() * 6);
        this.lastDice = [d1, d2];
        const sum = d1 + d2;
        const isDouble = d1 === d2;

        const events = [{ name: "game:rolled", data: { playerId: player.id, dice: [d1, d2] } }];

        if (player.inJail) {
            if (isDouble) {
                player.inJail = false;
                player.jailTurns = 0;
                this.logMsg(`{p:${player.id}} выбросил дубль и вышел из тюрьмы.`);
            } else {
                player.jailTurns++;
                if (player.jailTurns >= MAX_JAIL_TURNS) {
                    player.inJail = false;
                    player.jailTurns = 0;
                    player.balance -= JAIL_FINE;
                    this.logMsg(`{p:${player.id}} просидел ${MAX_JAIL_TURNS} хода, заплатил $${JAIL_FINE} и вышел.`);
                } else {
                    this.logMsg(`{p:${player.id}} в тюрьме, остался там. (${player.jailTurns}/${MAX_JAIL_TURNS})`);
                    this.phase = "action";
                    this.pendingAction = { type: "end-turn-only" };
                    return { events };
                }
            }
        }

        if (isDouble) {
            this.doublesCount++;
            if (this.doublesCount >= 3) {
                this.sendToJail(player);
                this.logMsg(`{p:${player.id}} выбросил 3 дубля подряд — в тюрьму!`);
                this.phase = "action";
                this.pendingAction = { type: "end-turn-only" };
                return { events };
            }
        } else {
            this.doublesCount = 0;
        }

        const oldPos = player.position;
        player.position = (player.position + sum) % BOARD_SIZE;
        if (player.position < oldPos && !player.inJail) this.passGo(player);

        this.logMsg(`{p:${player.id}} бросил ${d1}+${d2}=${sum}, встал на {c:${player.position}}.`);
        this.resolveCell(player);
        return { events };
    }

    resolveCell(player) {
        const cell = BOARD[player.position];

        if (cell.type === "corner") {
            if (cell.action === "go-to-jail") {
                const text = "Отправляйся в тюрьму. Не проходи Старт.";
                this.lastDrawnCard = { type: "corner", text };
                this.phase = "action";
                this.pendingAction = {
                    type: "card-draw",
                    cardType: "corner",
                    text,
                    pendingCardAction: { type: "jail" },
                };
                this.logMsg(`{p:${player.id}} попал на «Иди в тюрьму».`);
                return;
            }
            this.phase = "action";
            this.pendingAction = this.doublesCount > 0 && !player.inJail
                ? { type: "roll-again" } : { type: "end-turn-only" };
            return;
        }

        if (cell.type === "tax") {
            this.phase = "action";
            this.pendingAction = { type: "pay-tax", amount: cell.amount, cellName: cell.name };
            return;
        }

        if (cell.type === "chance" || cell.type === "community") {
            const deck = cell.type === "chance" ? this.chanceDeck : this.communityDeck;
            const deckKey = cell.type === "chance" ? "chanceIndex" : "communityIndex";
            const card = deck[this[deckKey] % deck.length];
            this[deckKey]++;

            let resolvedAction = card.action;
            let resolvedText = card.text;
            if (card.action.type === "move-random-group") {
                const group = card.action.group;
                const groupCells = this.board.filter((c) => c.type === "property" && c.group === group);
                if (groupCells.length > 0) {
                    const target = groupCells[Math.floor(Math.random() * groupCells.length)];
                    resolvedAction = { type: "move", position: target.id, collectOnPass: card.action.collectOnPass };
                    resolvedText = `Пройдите на ${target.name}.`;
                }
            }

            this.lastDrawnCard = { type: cell.type, text: resolvedText };
            this.logMsg(`{p:${player.id}} вытянул: "${resolvedText}"`);
            this.phase = "action";
            this.pendingAction = {
                type: "card-draw",
                cardType: cell.type,
                text: resolvedText,
                pendingCardAction: resolvedAction,
            };
            return;
        }

        if (cell.type === "casino") {
            if (!this.features.casino) {
                this.logMsg(`{p:${player.id}} в казино (отключено).`);
                this.phase = "action";
                this.pendingAction = this.doublesCount > 0 ? { type: "roll-again" } : { type: "end-turn-only" };
                return;
            }
            this.logMsg(`{p:${player.id}} зашёл в казино.`);
            this.phase = "action";
            this.pendingAction = { type: "casino-offer", minBet: CASINO_MIN_BET };
            return;
        }

        if (cell.type === "property" || cell.type === "railroad" || cell.type === "utility") {
            const own = this.ownership[cell.id];

            if (own.ownerId === null) {
                this.phase = "action";
                this.pendingAction = { type: "buy-option", cardId: cell.id, price: cell.price };
                return;
            }

            if (own.ownerId === player.id) {
                this.phase = "action";
                this.pendingAction = this.doublesCount > 0 ? { type: "roll-again" } : { type: "end-turn-only" };
                return;
            }

            const rent = this.calculateRent(cell, own);
            const owner = this.players.find((p) => p.id === own.ownerId);

            this.phase = "action";
            this.pendingAction = {
                type: "pay-rent",
                amount: rent,
                ownerId: owner.id,
                ownerName: owner.name,
                cardId: cell.id,
            };
        }
    }

    calculateRent(cell, own) {
        let base = 0;
        if (cell.type === "property") {
            if (own.hotel) base = cell.rent[5];
            else if (own.houses > 0) base = cell.rent[own.houses];
            else base = cell.rent[0];
        } else if (cell.type === "railroad") {
            const ownerId = own.ownerId;
            const count = BOARD.filter((c) =>
                c.type === "railroad" && this.ownership[c.id].ownerId === ownerId
            ).length;
            base = cell.rent[Math.min(count - 1, 3)] || cell.rent[0];
        } else if (cell.type === "utility") {
            const diceSum = this.lastDice[0] + this.lastDice[1];
            base = diceSum * 4;
        }

        let mult = this.rentMultiplier;
        if (this.modifiers.includes("magnate")) mult *= 1.1;
        return Math.floor(base * mult);
    }

    endTurn(player) {
        if (this.phase !== "action") return { error: "Сейчас нельзя завершить ход." };

        if (this.pendingAction && this.pendingAction.type === "roll-again" && !player.inJail) {
            this.phase = "roll";
            this.pendingAction = null;
            this.logMsg(`{p:${player.id}} ходит снова (дубль).`);
            return { events: [] };
        }

        this.doublesCount = 0;
        this.pendingAction = null;

        const oldIdx = this.currentPlayerIndex;
        let next = oldIdx;
        for (let i = 0; i < this.players.length; i++) {
            next = (next + 1) % this.players.length;
            if (!this.players[next].bankrupt && !this.players[next].left) break;
        }
        if (next <= oldIdx) {
            this.roundNumber++;
            this.sweepLeftPlayers();
        }
        this.currentPlayerIndex = next;
        this.phase = "roll";

        const alive = this.players.filter((p) => !p.bankrupt);
        if (alive.length === 1 && this.players.length > 1) {
            this.phase = "ended";
            this.winnerId = alive[0].id;
            this.logMsg(`🏆 Победитель: {p:${alive[0].id}}!`, "game-end");
            return { events: [{ name: "game:over", data: { winnerId: alive[0].id, winnerName: alive[0].name } }] };
        }

        return { events: [] };
    }

    // ============ MONEY / BANKRUPTCY ============

    payMoney(from, to, amount) {
        const actual = Math.min(from.balance, amount);
        from.balance -= actual;
        to.balance += actual;
        // Банкрот только если не смог заплатить полностью И нет имущества на продажу
        if (actual < amount && from.properties.length === 0) {
            this.bankruptPlayer(from, to);
        }
    }

    bankruptPlayer(player, creditor) {
        if (player.bankrupt) return;
        player.bankrupt = true;
        this.bankruptcyOrder.push(player.id);
        this.logMsg(`{p:${player.id}} обанкротился!`);
        for (const cid of [...player.properties]) {
            this.ownership[cid].ownerId = creditor ? creditor.id : null;
            this.ownership[cid].houses = 0;
            this.ownership[cid].hotel = false;
            this.ownership[cid].locked = true;
            if (creditor) creditor.properties.push(cid);
        }
        player.properties = [];

        if (this.players[this.currentPlayerIndex].id === player.id) {
            this.forceNextTurn();
        }
        this.checkGameOver();
    }

    // ============ JAIL ============

    sendToJail(player) {
        player.position = JAIL_POSITION;
        player.inJail = true;
        player.jailTurns = 0;
        this.doublesCount = 0;
    }

    useJailCard(player) {
        if (!player.inJail) return { error: "Ты не в тюрьме." };
        if (!player.freeJailCards || player.freeJailCards <= 0) return { error: "Нет карты освобождения." };
        player.freeJailCards--;
        player.inJail = false;
        player.jailTurns = 0;
        this.logMsg(`🔓 {p:${player.id}} использовал карту освобождения. Осталось карт: ${player.freeJailCards}.`);
        return { events: [] };
    }

    // ============ PENDING PAYMENTS ============

    acceptCard(player) {
        if (!this.pendingAction || this.pendingAction.type !== "card-draw") {
            return { error: "Нет карты для принятия." };
        }
        const action = this.pendingAction.pendingCardAction;
        this.pendingAction = null;
        cardActions.apply(this, player, action);
        return { events: [] };
    }

    acceptPay(player) {
        if (!this.pendingAction) return { error: "Нет платежа." };

        if (this.pendingAction.type === "pay-tax") {
            const amount = this.pendingAction.amount;
            if (player.balance < amount && player.properties.length > 0) {
                return { error: "💼 У тебя есть имущество — продай его, чтобы заплатить." };
            }
            player.balance -= amount;
            this.stats[player.id].paidRentTax += amount;
            this.logMsg(`{p:${player.id}} заплатил налог $${amount}.`);
            if (player.balance <= 0) this.bankruptPlayer(player, null);
            if (player.bankrupt) return { events: [] };

            this.phase = "action";
            this.pendingAction = this.doublesCount > 0 ? { type: "roll-again" } : { type: "end-turn-only" };
            return { events: [] };
        }

        if (this.pendingAction.type === "pay-rent") {
            const { amount, ownerId } = this.pendingAction;
            if (player.balance < amount && player.properties.length > 0) {
                return { error: "💼 У тебя есть имущество — продай его, чтобы заплатить." };
            }
            const owner = this.players.find((p) => p.id === ownerId);
            this.payMoney(player, owner, amount);
            this.stats[player.id].paidRentTax += amount;
            this.logMsg(`{p:${player.id}} заплатил аренду $${amount} игроку {p:${owner.id}}.`);
            if (player.bankrupt) return { events: [] };

            this.phase = "action";
            this.pendingAction = this.doublesCount > 0 ? { type: "roll-again" } : { type: "end-turn-only" };
            return { events: [] };
        }

        return { error: "Нет платежа." };
    }

    // ============ LEAVE / GAME OVER ============

    markLeft(player) {
        if (player.bankrupt || player.left) return;
        player.left = true;
        player.leftAtRound = this.roundNumber;
        this.logMsg(`👋 {p:${player.id}} вышел. Имущество сохранится 3 круга — может вернуться.`);

        if (this.players[this.currentPlayerIndex].id === player.id) this.forceNextTurn();
        this.checkGameOver();
    }

    finalizeLeft(player) {
        if (!player.left || player.bankrupt) return;
        for (const cid of [...player.properties]) {
            const own = this.ownership[cid];
            own.ownerId = null;
            own.houses = 0;
            own.hotel = false;
            own.locked = true;
        }
        player.properties = [];
        player.balance = 0;
        player.bankrupt = true;
        if (!this.bankruptcyOrder.includes(player.id)) this.bankruptcyOrder.push(player.id);
        this.logMsg(`🏚 {p:${player.id}} не вернулся за 3 круга — имущество ушло банку.`);
        this.checkGameOver();
    }

    returnToGame(player) {
        if (!player.left || player.bankrupt) return false;
        player.left = false;
        player.leftAtRound = null;
        this.logMsg(`🔄 {p:${player.id}} вернулся в игру.`);
        return true;
    }

    sweepLeftPlayers() {
        for (const p of this.players) {
            if (p.left && !p.bankrupt && typeof p.leftAtRound === "number") {
                if (this.roundNumber - p.leftAtRound >= 3) {
                    this.finalizeLeft(p);
                }
            }
        }
    }

    forceNextTurn() {
        let next = this.currentPlayerIndex;
        for (let i = 0; i < this.players.length; i++) {
            next = (next + 1) % this.players.length;
            if (!this.players[next].bankrupt && !this.players[next].left) break;
        }
        this.currentPlayerIndex = next;
        this.phase = "roll";
        this.pendingAction = null;
        this.doublesCount = 0;
    }

    checkGameOver() {
        const alive = this.players.filter((p) => !p.bankrupt);
        if (alive.length === 1 && this.players.length > 1) {
            this.phase = "ended";
            this.winnerId = alive[0].id;
            this.logMsg(`🏆 Победитель: {p:${alive[0].id}}!`, "game-end");
        }
    }

    // ============ LOG ============

    logMsg(text, type = "info") {
        this.log.push({ text, type, ts: Date.now() });
        if (this.log.length > LOG_LIMIT) this.log.shift();
    }
}

module.exports = GameState;
