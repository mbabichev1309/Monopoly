const fs = require("fs");
const path = require("path");

function load(name, fallback) {
    try {
        const p = path.join(__dirname, "..", "config", `${name}.json`);
        return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch (e) {
        console.warn(`[config] ${name}.json не найден/невалиден, используется fallback`);
        return fallback;
    }
}

const game = load("game", {
    startBalance: 1500,
    passGoBonus: 200,
    jailFine: 50,
    maxJailTurns: 3,
    boardSize: 40,
    jailPosition: 10,
    disconnectGracePeriodMs: 10000,
    logLimit: 1000,
});

const casino = load("casino", {
    startingJackpot: 200,
    minBet: 50,
    symbols: ["💎", "👑", "⭐", "🍒"],
    tripleMultipliers: { "🍒": 10, "⭐": 20, "👑": 30, "💎": 50 },
    pairMultipliers: { "🍒": 2, "⭐": 3, "👑": 5 },
    jackpotPairSymbol: "💎",
    jackpotBonusMultiplier: 10,
});

const limits = load("limits", {
    giftMaxPerRecipient: 500,
    hurryLapCooldown: 2,
    lobbyCodeLength: 5,
    lobbyMinPlayers: 2,
    lobbyMaxPlayers: 6,
});

const debug = load("debug", { users: [] });

module.exports = { game, casino, limits, debug };
