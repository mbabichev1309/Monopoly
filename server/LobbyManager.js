const GameState = require("./GameState");
const CFG = require("./config");

const MIN_COLOR_DISTANCE = 90;

function hexToRgb(hex) {
    const m = String(hex || "").replace("#", "");
    if (m.length < 6) return { r: 128, g: 128, b: 128 };
    return {
        r: parseInt(m.substring(0, 2), 16),
        g: parseInt(m.substring(2, 4), 16),
        b: parseInt(m.substring(4, 6), 16),
    };
}

function colorDistance(hex1, hex2) {
    const c1 = hexToRgb(hex1);
    const c2 = hexToRgb(hex2);
    const rMean = (c1.r + c2.r) / 2;
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return Math.sqrt(
        (2 + rMean / 256) * dr * dr +
        4 * dg * dg +
        (2 + (255 - rMean) / 256) * db * db
    );
}

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

    createLobby(socket, { playerName, playerColor, mode, modifiers, features, preset }) {
        const MAX = CFG.limits.lobbyMaxPlayers;
        if (!playerName || !playerName.trim()) {
            socket.emit("lobby:error", { message: "Укажи имя." });
            return;
        }
        const max = MAX;

        const validMode = CFG.modes[mode] ? mode : "classic";
        const validModifiers = Array.isArray(modifiers)
            ? modifiers.filter((m) => ["magnate", "chances", "gambler"].includes(m))
            : [];
        const validFeatures = {
            casino: features?.casino !== false,
            auction: features?.auction !== false,
        };

        let lobbyId;
        do {
            lobbyId = generateLobbyId();
        } while (this.lobbies.has(lobbyId));

        const lobby = {
            id: lobbyId,
            hostSocketId: socket.id,
            maxPlayers: max,
            mode: validMode,
            modifiers: validModifiers,
            features: validFeatures,
            preset: typeof preset === "string" ? preset : "main",
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
        if (!playerName || !playerName.trim()) {
            socket.emit("lobby:error", { message: "Укажи имя." });
            return;
        }
        const trimmedName = playerName.trim();

        if (lobby.state === "playing" && lobby.game) {
            const gp = lobby.game.players.find((p) => p.name === trimmedName);
            if (gp && gp.left && !gp.bankrupt) {
                const oldSocketId = gp.socketId;
                gp.socketId = socket.id;
                lobby.game.returnToGame(gp);
                const lp = lobby.players.find((p) => p.name === trimmedName);
                if (lp) lp.socketId = socket.id;
                if (lobby.hostSocketId === oldSocketId) lobby.hostSocketId = socket.id;
                this.socketToLobby.set(socket.id, lobbyId);
                socket.join(lobbyId);
                socket.emit("lobby:returned", { lobbyId, you: { name: gp.name, color: gp.color, slot: lp?.slot ?? gp.id + 1 } });
                this.io.to(lobbyId).emit("game:state", lobby.game.getPublicState());
                return;
            }
            if (gp && gp.bankrupt) {
                socket.emit("lobby:error", { message: "Этот игрок уже банкрот — возврат невозможен." });
                return;
            }
            socket.emit("lobby:error", { message: "Игра уже началась. Войти можно только тем, кто играл и вышел." });
            return;
        }
        if (lobby.players.length >= lobby.maxPlayers) {
            socket.emit("lobby:error", { message: "Лобби заполнено." });
            return;
        }
        const nameTaken = lobby.players.some(
            (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
        );
        if (nameTaken) {
            socket.emit("lobby:error", { message: "Игрок с таким именем уже в лобби. Возьми другое имя." });
            return;
        }
        const requestedColor = playerColor || "#ffffff";
        const colorClash = lobby.players.find(
            (p) => colorDistance(p.color, requestedColor) < MIN_COLOR_DISTANCE
        );
        if (colorClash) {
            socket.emit("lobby:error", {
                message: `Слишком похожий цвет на цвет игрока ${colorClash.name}. Выбери более контрастный.`,
            });
            return;
        }

        const usedSlots = new Set(lobby.players.map((p) => p.slot));
        let slot = 1;
        while (usedSlots.has(slot)) slot++;

        const player = {
            socketId: socket.id,
            name: trimmedName,
            color: requestedColor,
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
        if (lobby.chatLog && lobby.chatLog.length) {
            socket.emit("chat:history", lobby.chatLog);
        }
    }

    broadcastLobbyUpdate(lobbyId) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;

        const payload = {
            lobbyId,
            maxPlayers: lobby.maxPlayers,
            hostSocketId: lobby.hostSocketId,
            mode: lobby.mode || "classic",
            modifiers: lobby.modifiers || [],
            features: lobby.features || { casino: true, auction: true },
            preset: lobby.preset || "main",
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
        lobby.game = new GameState(lobby.players, {
            mode: lobby.mode || "classic",
            modifiers: lobby.modifiers || [],
            features: lobby.features || { casino: true, auction: true },
            preset: lobby.preset || "main",
        });

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
            }
            // В playing state НЕ помечаем как left автоматически —
            // только по явному событию game:leave (кнопка или закрытие вкладки).
        }, CFG.game.disconnectGracePeriodMs);
    }

    handleChat(socket, data) {
        const lobbyId = this.socketToLobby.get(socket.id);
        if (!lobbyId) return;
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;
        const text = String(data?.text || "").trim().slice(0, 200);
        if (!text) return;

        let name, color, id;
        if (lobby.game) {
            const gp = lobby.game.players.find((p) => p.socketId === socket.id);
            if (!gp) return;
            id = gp.id; name = gp.name; color = gp.color;
        } else {
            const lp = lobby.players.find((p) => p.socketId === socket.id);
            if (!lp) return;
            id = lp.slot; name = lp.name; color = lp.color;
        }

        const msg = { id, name, color, text, ts: Date.now() };
        if (!lobby.chatLog) lobby.chatLog = [];
        lobby.chatLog.push(msg);
        if (lobby.chatLog.length > 200) lobby.chatLog.shift();
        this.io.to(lobbyId).emit("chat:message", msg);
    }

    deleteLobby(socket) {
        const lobbyId = this.socketToLobby.get(socket.id);
        if (!lobbyId) return;
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;
        if (lobby.hostSocketId !== socket.id) {
            socket.emit("game:error", { message: "Только хост может удалить комнату." });
            return;
        }
        this.io.to(lobbyId).emit("lobby:deleted");
        this.lobbies.delete(lobbyId);
        for (const [sid, lid] of this.socketToLobby) {
            if (lid === lobbyId) this.socketToLobby.delete(sid);
        }
    }

    handleLeave(socket) {
        const lobbyId = this.socketToLobby.get(socket.id);
        if (!lobbyId) return;
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || !lobby.game) return;
        const player = lobby.game.players.find((p) => p.socketId === socket.id);
        if (!player || player.bankrupt || player.left) return;
        lobby.game.markLeft(player);
        this.io.to(lobbyId).emit("game:state", lobby.game.getPublicState());
    }
}

module.exports = LobbyManager;
