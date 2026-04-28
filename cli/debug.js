#!/usr/bin/env node

const { io } = require("socket.io-client");
const readline = require("readline");

const SERVER_URL = process.argv[2] || "http://localhost:3000";

const C = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
};

let socket = null;
let authed = false;
let activeLobbyId = null;
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
});

function out(text, color = "") {
    console.log(color + text + C.reset);
}
function err(text) { out("✗ " + text, C.red); }
function ok(text) { out("✓ " + text, C.green); }
function info(text) { out(text, C.cyan); }

function prompt() {
    const tag = activeLobbyId ? `[${activeLobbyId}]` : authed ? "[*]" : "[?]";
    rl.setPrompt(C.gray + tag + C.reset + " > ");
    rl.prompt();
}

function help() {
    out(`
${C.bold}DebugTool CLI команды${C.reset}

  ${C.cyan}help${C.reset}                       — эта справка
  ${C.cyan}auth <login> <password>${C.reset}    — авторизоваться
  ${C.cyan}lobbies${C.reset}                    — список активных игр
  ${C.cyan}use <lobbyId>${C.reset}              — выбрать активную игру
  ${C.cyan}players${C.reset}                    — игроки в активной игре

  ${C.bold}Управление игроком (player = имя или id):${C.reset}
  ${C.cyan}moveTo <player> <pos>${C.reset}      — телепорт на клетку (0-39)
  ${C.cyan}moveF <player> <n>${C.reset}         — сдвинуть вперёд на n
  ${C.cyan}moveB <player> <n>${C.reset}         — сдвинуть назад на n
  ${C.cyan}give <player> balance <amt>${C.reset}    — дать деньги
  ${C.cyan}give <player> property <id>${C.reset}    — дать карту
  ${C.cyan}take <player> balance <amt>${C.reset}    — снять деньги
  ${C.cyan}take <player> property <id>${C.reset}    — забрать карту
  ${C.cyan}turn <player>${C.reset}              — передать ход
  ${C.cyan}kick <player>${C.reset}              — выкинуть (помечает "вышел")

  ${C.bold}Глобальное:${C.reset}
  ${C.cyan}jackpot <amt>${C.reset}              — изменить джекпот казино

  ${C.cyan}quit / exit${C.reset}                — выход
`);
}

function connect() {
    out(`Подключаюсь к ${SERVER_URL}...`, C.dim);
    socket = io(SERVER_URL, { reconnection: true });

    socket.on("connect", () => {
        ok(`Соединение установлено (socket ${socket.id})`);
        info(`Авторизуйся: ${C.bold}auth <login> <password>${C.reset}${C.cyan}`);
        prompt();
    });

    socket.on("disconnect", () => {
        err("Соединение разорвано. Жду переподключения...");
        authed = false;
    });

    socket.on("connect_error", (e) => {
        err(`Ошибка соединения: ${e.message}`);
        process.exit(1);
    });

    socket.on("game:error", ({ message }) => {
        err(message);
        prompt();
    });
}

function emitWithCallback(event, data) {
    return new Promise((resolve) => {
        socket.emit(event, data, (response) => resolve(response));
    });
}

function parseTarget(s) {
    if (s === undefined) return null;
    const n = parseInt(s, 10);
    if (!isNaN(n) && String(n) === s.trim()) return n;
    return s;
}

async function execCmd(line) {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    if (!cmd) return prompt();

    if (cmd === "help" || cmd === "?") {
        help();
        return prompt();
    }

    if (cmd === "quit" || cmd === "exit") {
        info("Пока!");
        process.exit(0);
    }

    if (cmd === "auth") {
        if (parts.length < 3) return err("Использование: auth <login> <password>"), prompt();
        const res = await emitWithCallback("debug:auth", { login: parts[1], password: parts[2] });
        if (res?.success) {
            authed = true;
            ok("Авторизован");
        } else {
            err(res?.error || "Авторизация не удалась");
        }
        return prompt();
    }

    if (!authed) {
        err("Сначала авторизуйся: auth <login> <password>");
        return prompt();
    }

    if (cmd === "lobbies") {
        const res = await emitWithCallback("debug:list-lobbies", {});
        if (res?.error) return err(res.error), prompt();
        if (!res.lobbies?.length) {
            info("Нет активных лобби.");
        } else {
            for (const l of res.lobbies) {
                const tag = l.state === "playing" ? C.green + "▶" : C.yellow + "◯";
                out(`${tag}${C.reset} ${C.bold}${l.id}${C.reset}  ${l.count}/${l.max}  ${l.mode}  ${C.dim}[${l.players.join(", ")}]${C.reset}`);
            }
        }
        return prompt();
    }

    if (cmd === "use") {
        if (parts.length < 2) return err("Использование: use <lobbyId>"), prompt();
        activeLobbyId = parts[1].toUpperCase();
        ok(`Активное лобби: ${activeLobbyId}`);
        return prompt();
    }

    if (cmd === "players") {
        if (!activeLobbyId) return err("Сначала выбери лобби: use <lobbyId>"), prompt();
        const res = await runDebug({ cmd: "info" });
        if (res?.state) {
            for (const p of res.state.players) {
                const turn = p.id === res.state.currentPlayerId ? C.yellow + "◀" : " ";
                const status = p.bankrupt ? " [bankrupt]" : p.left ? " [left]" : p.inJail ? " [jail]" : "";
                out(`${turn} ${C.bold}${p.id}${C.reset}: ${p.name} — $${p.balance}, on ${p.cell}${C.dim}${status}${C.reset}`);
            }
        } else if (res?.error) {
            err(res.error);
        }
        return prompt();
    }

    if (!activeLobbyId) {
        err("Сначала выбери лобби: use <lobbyId>");
        return prompt();
    }

    let cmdObj = null;
    if (cmd === "moveTo") {
        cmdObj = { cmd: "playerMoveTo", target: parseTarget(parts[1]), position: parseInt(parts[2], 10) };
    } else if (cmd === "moveF") {
        cmdObj = { cmd: "playerMoveF", target: parseTarget(parts[1]), steps: parseInt(parts[2], 10) };
    } else if (cmd === "moveB") {
        cmdObj = { cmd: "playerMoveB", target: parseTarget(parts[1]), steps: parseInt(parts[2], 10) };
    } else if (cmd === "give" || cmd === "take") {
        const target = parseTarget(parts[1]);
        const type = parts[2];
        const data = parseInt(parts[3], 10);
        cmdObj = { cmd: cmd === "give" ? "playerGive" : "playerTake", target, type, data };
    } else if (cmd === "turn") {
        cmdObj = { cmd: "playerTurn", target: parseTarget(parts[1]) };
    } else if (cmd === "kick") {
        cmdObj = { cmd: "playerKick", target: parseTarget(parts[1]) };
    } else if (cmd === "jackpot") {
        cmdObj = { cmd: "setJackpot", amount: parseInt(parts[1], 10) };
    } else {
        err(`Неизвестная команда: ${cmd}. Введи "help" для справки.`);
        return prompt();
    }

    const res = await runDebug(cmdObj);
    if (res?.error) err(res.error);
    else ok("Выполнено");
    return prompt();
}

async function runDebug(cmd) {
    return emitWithCallback("debug:run", { lobbyId: activeLobbyId, cmd });
}

connect();

rl.on("line", (line) => {
    execCmd(line);
});

rl.on("close", () => {
    info("Пока!");
    process.exit(0);
});
