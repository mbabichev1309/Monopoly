const GameState = require("./GameState");
const CFG = require("./config");

function generateLobbyId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let id = "";
    for (let i = 0; i < CFG.limits.lobbyCodeLength; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

class LobbyManager {
    constructor(io) {
        this.io = io;
        this.lobbies = new Map();
        this.socketToLobby = new Map();
    }

    createLobby(socket, { maxPlayers, playerName, playerColor }) {
        const max = parseInt(maxPlayers, 10);
        const MIN = CFG.limits.lobbyMinPlayers;
        const MAX = CFG.limits.lobbyMaxPlayers;
        if (isNaN(max) || max < MIN || max > MAX) {
            socket.emit("lobby:error", { message: `Количество игроков должно быть от ${MIN} до ${MAX}.` });
            return;
        }
        if (!playerName || !playerName.trim()) {
            socket.emit("lobby:error", { message: "Укажи имя." });
            return;
        }

        let lobbyId;
        do {
            lobbyId = generateLobbyId();
        } while (this.lobbies.has(lobbyId));

        const lobby = {
            id: lobbyId,
            hostSocketId: socket.id,
            maxPlayers: max,
            players: [{
                socketId: socket.id,
                name: playerName.trim(),
                color: playerColor || "#ffffff",
                slot: 1,
            }],
            state: "waiting",
            game: null,
        };

        this.lobbies.set(lobbyId, lobby);
        this.socketToLobby.set(socket.id, lobbyId);
        socket.join(lobbyId);

        socket.emit("lobby:created", { lobbyId, you: lobby.players[0] });
        this.broadcastLobbyUpdate(lobbyId);
    }

    joinLobby(socket, { lobbyId, playerName, playerColor }) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) {
            socket.emit("lobby:error", { message: "Лобби не найдено." });
            return;
        }
        if (lobby.state !== "waiting") {
            socket.emit("lobby:error", { message: "Игра уже началась." });
            return;
        }
        if (lobby.players.length >= lobby.maxPlayers) {
            socket.emit("lobby:error", { message: "Лобби заполнено." });
            return;
        }
        if (!playerName || !playerName.trim()) {
            socket.emit("lobby:error", { message: "Укажи имя." });
            return;
        }

        const usedSlots = new Set(lobby.players.map((p) => p.slot));
        let slot = 1;
        while (usedSlots.has(slot)) slot++;

        const player = {
            socketId: socket.id,
            name: playerName.trim(),
            color: playerColor || "#ffffff",
            slot,
        };

        lobby.players.push(player);
        this.socketToLobby.set(socket.id, lobbyId);
        socket.join(lobbyId);

        socket.emit("lobby:joined", { lobbyId, you: player });
        this.broadcastLobbyUpdate(lobbyId);
    }

    rejoinLobby(socket, { lobbyId, playerName }) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) {
            socket.emit("lobby:error", { message: "Лобби не найдено." });
            return;
        }

        socket.join(lobbyId);
        this.socketToLobby.set(socket.id, lobbyId);

        if (playerName) {
            const existing = lobby.players.find((p) => p.name === playerName);
            if (existing) {
                const oldSocketId = existing.socketId;
                existing.socketId = socket.id;
                if (lobby.hostSocketId === oldSocketId) {
                    lobby.hostSocketId = socket.id;
                }
                if (lobby.game) {
                    const gp = lobby.game.players.find((p) => p.name === playerName);
                    if (gp) gp.socketId = socket.id;
                }
            }
        }

        if (lobby.state === "waiting") {
            this.broadcastLobbyUpdate(lobbyId);
        } else if (lobby.state === "playing" && lobby.game) {
            socket.emit("game:state", lobby.game.getPublicState());
        }
    }

    broadcastLobbyUpdate(lobbyId) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;

        const payload = {
            lobbyId,
            maxPlayers: lobby.maxPlayers,
            hostSocketId: lobby.hostSocketId,
            players: lobby.players.map((p) => ({
                socketId: p.socketId,
                name: p.name,
                color: p.color,
                slot: p.slot,
            })),
        };

        this.io.to(lobbyId).emit("lobby:updated", payload);
    }

    startGame(socket, { lobbyId }) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) {
            socket.emit("lobby:error", { message: "Лобби не найдено." });
            return;
        }
        if (lobby.hostSocketId !== socket.id) {
            socket.emit("lobby:error", { message: "Только хост может начать игру." });
            return;
        }
        if (lobby.players.length < CFG.limits.lobbyMinPlayers) {
            socket.emit("lobby:error", { message: `Нужно минимум ${CFG.limits.lobbyMinPlayers} игрока.` });
            return;
        }

        lobby.state = "playing";
        lobby.game = new GameState(lobby.players);

        this.io.to(lobbyId).emit("game:start", { lobbyId });

        setTimeout(() => {
            this.io.to(lobbyId).emit("game:state", lobby.game.getPublicState());
        }, 500);
    }

    handleGameAction(socket, action, data) {
        const lobbyId = this.socketToLobby.get(socket.id);
        if (!lobbyId) return;
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || lobby.state !== "playing" || !lobby.game) return;

        const result = lobby.game.handleAction(socket.id, action, data);

        if (result.error) {
            socket.emit("game:error", { message: result.error });
            return;
        }

        if (result.events) {
            for (const ev of result.events) {
                this.io.to(lobbyId).emit(ev.name, ev.data);
            }
        }

        this.io.to(lobbyId).emit("game:state", lobby.game.getPublicState());
    }

    handleDisconnect(socket) {
        const lobbyId = this.socketToLobby.get(socket.id);
        this.socketToLobby.delete(socket.id);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;

        const disconnectedSocketId = socket.id;

        setTimeout(() => {
            const stillThere = this.lobbies.get(lobbyId);
            if (!stillThere) return;

            const player = stillThere.players.find((p) => p.socketId === disconnectedSocketId);
            if (!player) return;

            if (stillThere.state === "waiting") {
                stillThere.players = stillThere.players.filter((p) => p.socketId !== disconnectedSocketId);

                if (stillThere.players.length === 0) {
                    this.lobbies.delete(lobbyId);
                    return;
                }

                if (stillThere.hostSocketId === disconnectedSocketId) {
                    stillThere.hostSocketId = stillThere.players[0].socketId;
                }

                this.broadcastLobbyUpdate(lobbyId);
            } else if (stillThere.state === "playing" && stillThere.game) {
                const gamePlayer = stillThere.game.players.find((pp) => pp.socketId === disconnectedSocketId);
                if (gamePlayer && !gamePlayer.bankrupt && !gamePlayer.left) {
                    stillThere.game.markLeft(gamePlayer);
                    this.io.to(lobbyId).emit("game:state", stillThere.game.getPublicState());
                }
            }
        }, CFG.game.disconnectGracePeriodMs);
    }
}

module.exports = LobbyManager;
