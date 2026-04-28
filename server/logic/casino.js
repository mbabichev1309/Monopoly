const CFG = require("../config");

const SYMBOLS = CFG.casino.symbols;
const EXTRA_SYMBOLS = CFG.casino.gamblerExtraSymbols || [];
const MIN_BET = CFG.casino.minBet;
const MAX_BET = CFG.casino.maxBet || 500;
const TRIPLE = CFG.casino.tripleMultipliers;
const PAIR = CFG.casino.pairMultipliers;
const JACKPOT_TRIPLE_SYMBOL = CFG.casino.jackpotTripleSymbol;

function accept(game, player, data) {
    if (!game.pendingAction || game.pendingAction.type !== "casino-offer") {
        return { error: "Сейчас нельзя начать игру." };
    }
    const bet = parseInt(data?.bet, 10);
    const solo = !!data?.solo;
    if (isNaN(bet) || bet < MIN_BET) return { error: `Минимальная ставка $${MIN_BET}.` };
    if (bet > MAX_BET) return { error: `Максимальная ставка $${MAX_BET}.` };
    if (player.balance < bet) return { error: "Недостаточно денег." };

    player.balance -= bet;

    const others = solo ? [] : game.players.filter((p) =>
        p.id !== player.id && !p.bankrupt && !p.left && p.balance > 0
    );

    game.casinoGame = {
        initiatorId: player.id,
        initiatorName: player.name,
        minBet: bet,
        bets: { [player.id]: bet },
        decisions: { [player.id]: "joined" },
        waitingFor: others.map((p) => p.id),
        phase: "betting",
        solo,
        slots: null,
        result: null,
    };

    const suffix = solo ? "(в одиночку)" : "Ждём остальных...";
    game.logMsg(`🎰 {p:${player.id}} зашёл в казино, ставка $${bet}. ${suffix}`);
    game.pendingAction = { type: "casino-betting" };

    if (others.length === 0) {
        game.casinoGame.phase = "ready-to-spin";
    }
    return { events: [] };
}

function decline(game, player) {
    if (!game.pendingAction || game.pendingAction.type !== "casino-offer") {
        return { error: "Сейчас нельзя отказаться." };
    }
    game.logMsg(`{p:${player.id}} прошёл мимо казино.`);
    game.phase = "action";
    game.pendingAction = game.doublesCount > 0 ? { type: "roll-again" } : { type: "end-turn-only" };
    return { events: [] };
}

function join(game, player, bet) {
    if (!game.casinoGame || game.casinoGame.phase !== "betting") {
        return { error: "Казино не принимает ставки." };
    }
    if (!game.casinoGame.waitingFor.includes(player.id)) {
        return { error: "Ты уже решил." };
    }
    const minBet = game.casinoGame.minBet;
    bet = parseInt(bet, 10);
    if (isNaN(bet) || bet < minBet) return { error: `Минимальная ставка $${minBet}.` };
    if (bet > MAX_BET) return { error: `Максимальная ставка $${MAX_BET}.` };
    if (player.balance < bet) return { error: "Недостаточно денег." };

    player.balance -= bet;
    game.casinoGame.bets[player.id] = bet;
    game.casinoGame.decisions[player.id] = "joined";
    game.casinoGame.waitingFor = game.casinoGame.waitingFor.filter((id) => id !== player.id);
    game.logMsg(`🎰 {p:${player.id}} присоединился к казино, ставка $${bet}.`);

    if (game.casinoGame.waitingFor.length === 0) {
        game.casinoGame.phase = "ready-to-spin";
    }
    return { events: [] };
}

function skip(game, player) {
    if (!game.casinoGame || game.casinoGame.phase !== "betting") {
        return { error: "Казино не принимает ставки." };
    }
    if (!game.casinoGame.waitingFor.includes(player.id)) {
        return { error: "Ты уже решил." };
    }
    game.casinoGame.decisions[player.id] = "declined";
    game.casinoGame.waitingFor = game.casinoGame.waitingFor.filter((id) => id !== player.id);
    game.logMsg(`{p:${player.id}} отказался играть в казино.`);

    if (game.casinoGame.waitingFor.length === 0) {
        game.casinoGame.phase = "ready-to-spin";
    }
    return { events: [] };
}

function spin(game, player) {
    if (!game.casinoGame || game.casinoGame.phase !== "ready-to-spin") {
        return { error: "Сейчас нельзя крутить." };
    }
    if (player.id !== game.casinoGame.initiatorId) {
        return { error: "Крутить может только инициатор." };
    }
    roll(game);
    return { events: [] };
}

function roll(game) {
    const gambler = (game.modifiers || []).includes("gambler");
    const activeSymbols = gambler ? [...SYMBOLS, ...EXTRA_SYMBOLS] : SYMBOLS;
    const pick = () => activeSymbols[Math.floor(Math.random() * activeSymbols.length)];
    const slots = [pick(), pick(), pick()];
    game.casinoGame.slots = slots;
    const winMult = gambler ? 1.5 : 1.0;

    const totalBet = Object.values(game.casinoGame.bets).reduce((a, b) => a + b, 0);
    const winnerIds = Object.keys(game.casinoGame.bets).map(Number);

    const counts = {};
    for (const s of slots) counts[s] = (counts[s] || 0) + 1;

    let multiplier = 0;
    let isJackpotWin = false;
    let matchedSymbol = null;
    let matchCount = 0;

    for (const [sym, count] of Object.entries(counts)) {
        if (count === 3) {
            matchedSymbol = sym;
            matchCount = 3;
            multiplier = TRIPLE[sym] || 0;
            if (sym === JACKPOT_TRIPLE_SYMBOL) isJackpotWin = true;
            break;
        }
    }
    if (multiplier === 0) {
        for (const [sym, count] of Object.entries(counts)) {
            if (count === 2) {
                matchedSymbol = sym;
                matchCount = 2;
                multiplier = PAIR[sym] || 0;
                break;
            }
        }
    }

    let result;
    if (isJackpotWin) {
        const n = winnerIds.length;
        const prize = Math.floor((totalBet + game.jackpot) * multiplier * winMult);
        const perWinner = Math.floor(prize / n);
        for (const pid of winnerIds) {
            const p = game.players.find((pp) => pp.id === pid);
            if (p) {
                p.balance += perWinner;
                const bet = game.casinoGame.bets[pid] || 0;
                game.stats[pid].wonCasino += Math.max(0, perWinner - bet);
            }
        }
        game.jackpot = 0;
        result = { win: true, jackpotWin: true, prize, perWinner, bonusPerPlayer: 0, multiplier, matchedSymbol, matchCount, winnerIds };
        game.logMsg(`🎰 ${slots.join(" ")} — 💎💎💎 ДЖЕКПОТ! (ставка + джекпот) ×${multiplier}, каждому по $${perWinner}.`);
    } else if (multiplier > 0) {
        const prize = Math.floor(totalBet * multiplier * winMult);
        const perWinner = Math.floor(prize / winnerIds.length);
        for (const pid of winnerIds) {
            const p = game.players.find((pp) => pp.id === pid);
            if (p) {
                p.balance += perWinner;
                const bet = game.casinoGame.bets[pid] || 0;
                game.stats[pid].wonCasino += Math.max(0, perWinner - bet);
            }
        }
        result = { win: true, jackpotWin: false, prize, perWinner, multiplier, matchedSymbol, matchCount, winnerIds };
        game.logMsg(`🎰 ${slots.join(" ")} — ВЫИГРЫШ ×${multiplier}! $${prize}, каждому по $${perWinner}.`);
    } else {
        game.jackpot += totalBet;
        result = { win: false, toJackpot: totalBet };
        game.logMsg(`🎰 ${slots.join(" ")} — без выигрыша. $${totalBet} → джекпот ($${game.jackpot}).`);
    }

    game.casinoGame.result = result;
    game.casinoGame.phase = "done";
    game.pendingAction = { type: "casino-result" };
}

function cont(game, player) {
    if (!game.casinoGame || game.casinoGame.phase !== "done") {
        return { error: "Нет результата казино." };
    }
    if (player.id !== game.casinoGame.initiatorId) {
        return { error: "Только инициатор может продолжить." };
    }
    game.casinoGame = null;
    game.phase = "action";
    game.pendingAction = game.doublesCount > 0 && !player.bankrupt
        ? { type: "roll-again" }
        : { type: "end-turn-only" };
    return { events: [] };
}

module.exports = { accept, decline, join, skip, spin, continue: cont };
