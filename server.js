const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const os = require("os");

const LobbyManager = require("./server/LobbyManager");
const CFG = require("./server/config");
const presets = require("./server/presets");
const debugLogic = require("./server/logic/debug");

const debugUsers = CFG.debug.users || [];
console.log(`[debug] загружено учёток: ${debugUsers.length}`);

const debugAuthSockets = new Set();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const lobbyManager = new LobbyManager(io);

io.on("connection", (socket) => {
    console.log(`[+] connected: ${socket.id}`);

    socket.on("presets:list", (data, cb) => {
        if (typeof cb === "function") cb(presets.list());
    });

    socket.on("lobby:create", (data) => {
        lobbyManager.createLobby(socket, data);
    });

    socket.on("lobby:join", (data) => {
        lobbyManager.joinLobby(socket, data);
    });

    socket.on("lobby:rejoin", (data) => {
        lobbyManager.rejoinLobby(socket, data);
    });

    socket.on("lobby:start", (data) => {
        lobbyManager.startGame(socket, data);
    });

    socket.on("game:roll", () => {
        lobbyManager.handleGameAction(socket, "roll");
    });

    socket.on("game:buy", () => {
        lobbyManager.handleGameAction(socket, "buy");
    });

    socket.on("game:decline-buy", () => {
        lobbyManager.handleGameAction(socket, "declineBuy");
    });

    socket.on("game:sell", (data) => {
        lobbyManager.handleGameAction(socket, "sell", data);
    });

    socket.on("game:buy-house", (data) => {
        lobbyManager.handleGameAction(socket, "buyHouse", data);
    });

    socket.on("game:buy-hotel", (data) => {
        lobbyManager.handleGameAction(socket, "buyHotel", data);
    });

    socket.on("game:sell-house", (data) => {
        lobbyManager.handleGameAction(socket, "sellHouse", data);
    });

    socket.on("game:sell-hotel", (data) => {
        lobbyManager.handleGameAction(socket, "sellHotel", data);
    });

    socket.on("game:toggle-lock", (data) => {
        lobbyManager.handleGameAction(socket, "toggleLock", data);
    });

    socket.on("game:end-turn", () => {
        lobbyManager.handleGameAction(socket, "endTurn");
    });

    socket.on("game:accept-card", () => {
        lobbyManager.handleGameAction(socket, "acceptCard");
    });

    socket.on("game:accept-pay", () => {
        lobbyManager.handleGameAction(socket, "acceptPay");
    });

    socket.on("game:use-jail-card", () => {
        lobbyManager.handleGameAction(socket, "useJailCard");
    });

    socket.on("log:fetch", (data, cb) => {
        const lobbyId = lobbyManager.socketToLobby.get(socket.id);
        if (!lobbyId) return cb?.({ error: "Не в лобби." });
        const lobby = lobbyManager.lobbies.get(lobbyId);
        if (!lobby || !lobby.game) return cb?.({ error: "Нет активной игры." });
        cb?.({
            log: lobby.game.log,
            players: lobby.game.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
            board: lobby.game.getPublicState().board,
            groupColors: lobby.game.getPublicState().groupColors,
        });
    });

    socket.on("casino:accept", (data) => {
        lobbyManager.handleGameAction(socket, "casinoAccept", data);
    });

    socket.on("casino:decline", () => {
        lobbyManager.handleGameAction(socket, "casinoDecline");
    });

    socket.on("casino:join", (data) => {
        lobbyManager.handleGameAction(socket, "casinoJoin", data);
    });

    socket.on("casino:skip", () => {
        lobbyManager.handleGameAction(socket, "casinoSkip");
    });

    socket.on("casino:spin", () => {
        lobbyManager.handleGameAction(socket, "casinoSpin");
    });

    socket.on("auction:bid", (data) => {
        lobbyManager.handleGameAction(socket, "auctionBid", data);
    });

    socket.on("auction:pass", () => {
        lobbyManager.handleGameAction(socket, "auctionPass");
    });

    socket.on("casino:continue", () => {
        lobbyManager.handleGameAction(socket, "casinoContinue");
    });

    socket.on("debug:auth", ({ login, password }, cb) => {
        const ok = debugUsers.some((u) => u.login === login && u.password === password);
        if (ok) {
            debugAuthSockets.add(socket.id);
            console.log(`[debug] авторизован сокет ${socket.id} как ${login}`);
            if (typeof cb === "function") cb({ success: true });
        } else {
            console.log(`[debug] отказ авторизации для ${login}`);
            if (typeof cb === "function") cb({ success: false, error: "Неверный логин или пароль." });
        }
    });

    socket.on("debug:cmd", (data) => {
        if (!debugAuthSockets.has(socket.id)) {
            socket.emit("game:error", { message: "DebugTool не авторизован." });
            return;
        }
        lobbyManager.handleGameAction(socket, "debug", data);
    });

    socket.on("debug:list-lobbies", (data, cb) => {
        if (!debugAuthSockets.has(socket.id)) {
            return typeof cb === "function" && cb({ error: "Не авторизован" });
        }
        const list = [];
        for (const [id, lobby] of lobbyManager.lobbies) {
            list.push({
                id,
                state: lobby.state,
                players: lobby.players.map((p) => p.name),
                count: lobby.players.length,
                max: lobby.maxPlayers,
                mode: lobby.mode,
                preset: lobby.preset,
            });
        }
        if (typeof cb === "function") cb({ lobbies: list });
    });

    socket.on("debug:run", (data, cb) => {
        if (!debugAuthSockets.has(socket.id)) {
            return typeof cb === "function" && cb({ error: "Не авторизован" });
        }
        const { lobbyId, cmd } = data || {};
        const lobby = lobbyManager.lobbies.get(lobbyId);
        if (!lobby || !lobby.game) {
            return typeof cb === "function" && cb({ error: "Лобби не найдено или игра не запущена" });
        }
        const isReadOnly = !cmd || !cmd.cmd || cmd.cmd === "info" || cmd.cmd === "noop";
        let result = { events: [] };
        if (!isReadOnly) {
            const fakePlayer = lobby.game.players[0];
            try {
                result = debugLogic.run(lobby.game, fakePlayer, cmd);
            } catch (e) {
                console.error("[debug] crash:", e);
                return typeof cb === "function" && cb({ error: `Сервер упал: ${e.message}` });
            }
            if (result.error) {
                return typeof cb === "function" && cb({ error: result.error });
            }
            io.to(lobbyId).emit("game:state", lobby.game.getPublicState());
        }
        const snapshot = {
            players: lobby.game.players.map((p) => ({
                id: p.id,
                name: p.name,
                balance: p.balance,
                position: p.position,
                cell: lobby.game.board[p.position]?.name,
                bankrupt: p.bankrupt,
                left: p.left,
                inJail: p.inJail,
            })),
            currentPlayerId: lobby.game.players[lobby.game.currentPlayerIndex].id,
            jackpot: lobby.game.jackpot,
            phase: lobby.game.phase,
        };
        if (typeof cb === "function") cb({ ok: true, state: snapshot });
    });

    socket.on("trade:gift-money", (data) => {
        lobbyManager.handleGameAction(socket, "giftMoney", data);
    });

    socket.on("trade:send-offer", (data) => {
        lobbyManager.handleGameAction(socket, "sendOffer", data);
    });

    socket.on("trade:accept", () => {
        lobbyManager.handleGameAction(socket, "acceptOffer");
    });

    socket.on("trade:decline", () => {
        lobbyManager.handleGameAction(socket, "declineOffer");
    });

    socket.on("trade:cancel", () => {
        lobbyManager.handleGameAction(socket, "cancelOffer");
    });

    socket.on("trade:toggle-mute", (data) => {
        lobbyManager.handleGameAction(socket, "toggleMute", data);
    });

    socket.on("game:hurry", (data) => {
        lobbyManager.handleGameAction(socket, "hurryPlayer", data);
    });

    socket.on("game:leave", () => {
        lobbyManager.handleLeave(socket);
    });

    socket.on("chat:send", (data) => {
        lobbyManager.handleChat(socket, data);
    });

    socket.on("lobby:delete", () => {
        lobbyManager.deleteLobby(socket);
    });

    socket.on("disconnect", () => {
        console.log(`[-] disconnected: ${socket.id}`);
        debugAuthSockets.delete(socket.id);
        lobbyManager.handleDisconnect(socket);
    });
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`\nMonopoly server running on port ${PORT}`);
    console.log("Open in browser:");
    console.log(`  http://localhost:${PORT}`);

    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === "IPv4" && !net.internal) {
                console.log(`  http://${net.address}:${PORT}  (LAN)`);
            }
        }
    }
    console.log();
});
