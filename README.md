# Монополия Онлайн (Deluxe Edition)

Многопользовательская Монополия через браузер. Один ПК запускает сервер, остальные подключаются по локальной сети или через туннель (ngrok/cloudflare).

## Запуск

```bash
npm install
node server.js
```

После этого:
- локально: http://localhost:3000
- в локальной сети: сервер покажет LAN-IP в терминале

## Структура проекта

```
monopoly/
├── config/              # настройки (редактируй под свои нужды)
│   ├── debug.json       # логины/пароли для DebugTool
│   ├── game.json        # базовая механика игры
│   ├── casino.json      # параметры казино
│   └── limits.json      # лимиты действий игроков
│
├── server/
│   ├── GameState.js     # ядро: state, handleAction, rollDice, resolveCell, endTurn, jail
│   ├── LobbyManager.js  # лобби и комнаты
│   ├── board-data.js    # 40 клеток поля + цвета групп
│   ├── cards.js         # данные карточек Шанс и Казна
│   ├── config.js        # загрузчик конфигов
│   └── logic/           # бизнес-логика по модулям
│       ├── property.js      # покупка/продажа улиц, постройки
│       ├── casino.js        # слот-машина, джекпот
│       ├── trade.js         # подарки, сделки, мут, hurry
│       ├── card-actions.js  # эффекты карточек Шанс/Казна
│       └── debug.js         # DebugTool команды
│
├── script/
│   ├── main.js          # клиент (Socket.IO, render, events)
│   └── Monopoly.js      # отрисовка поля на canvas
│
├── src/
│   ├── style.css        # стили лобби/регистрации/лога
│   └── game.css         # стили игры
│
├── index.html           # лобби (создать/войти)
├── register.html        # комната ожидания
├── game.html            # основная игра
├── log.html             # полная история событий
│
└── server.js            # Express + Socket.IO entrypoint
```

## Конфиги

Все настройки игры вынесены в JSON в папке `config/`. Меняешь → перезапускаешь сервер.

### `config/game.json`
Базовая механика:

| Ключ | Значение по умолчанию | Описание |
|------|----------------------|----------|
| `startBalance` | 1500 | Стартовый баланс каждого игрока |
| `passGoBonus` | 200 | Бонус за проход Старта |
| `jailFine` | 50 | Штраф при выходе из тюрьмы после 3 ходов |
| `maxJailTurns` | 3 | Сколько ходов можно просидеть в тюрьме |
| `boardSize` | 40 | Количество клеток (не трогай, если не меняешь board-data.js) |
| `jailPosition` | 10 | Индекс клетки тюрьмы |
| `disconnectGracePeriodMs` | 10000 | Сколько мс ждать переподключения игрока |
| `logLimit` | 1000 | Максимум записей в логе игры |

### `config/casino.json`
Настройки казино:

| Ключ | Значение | Описание |
|------|----------|----------|
| `startingJackpot` | 200 | Стартовый джекпот |
| `minBet` | 50 | Минимальная ставка |
| `symbols` | `["💎","👑","⭐","🍒"]` | Набор символов на барабане |
| `tripleMultipliers` | `{"🍒":10,"⭐":20,"👑":30,"💎":50}` | Множители за 3 одинаковых |
| `pairMultipliers` | `{"🍒":2,"⭐":3,"👑":5}` | Множители за пару (💎💎 — это джекпот) |
| `jackpotPairSymbol` | `"💎"` | Какая пара даёт джекпот |
| `jackpotBonusMultiplier` | 10 | Множитель бонуса при перекрытой ставкой джекпоте |

Можно полностью переписать символы и множители — клиент возьмёт из `state.casinoSymbols`.

### `config/limits.json`
Ограничения действий:

| Ключ | Значение | Описание |
|------|----------|----------|
| `giftMaxPerRecipient` | 500 | Максимум $ на подарки одному игроку за игру |
| `hurryLapCooldown` | 2 | За сколько кругов один раз можно торопить одного игрока |
| `lobbyCodeLength` | 5 | Длина кода лобби |
| `lobbyMinPlayers` | 2 | Минимум игроков для старта |
| `lobbyMaxPlayers` | 6 | Максимум игроков в лобби |

### `config/debug.json`
Учётные записи для `DebugTool` (консольный отладочный инструмент):

```json
{
    "users": [
        { "login": "dev", "password": "monopoly" }
    ]
}
```

Можно добавить несколько учёток. **Не коммить реальные пароли в git.**

## Использование DebugTool (консоль браузера F12)

```js
const d = new DebugTool("dev", "monopoly");
await d.ready;

d.moveTo("Alice", 20);              // телепорт на клетку
d.moveF("Bob", 5);                  // +5 клеток
d.give("Alice", "balance", 1000);   // +$1000
d.give("Bob", "property", 34);      // подарить карту
d.take("Alice", "property", 34);    // забрать карту
d.turn("Alice");                    // передать ход
d.setJackpot(5000);                 // изменить джекпот
d.help();                           // вся справка
```

## Поле (смена карт доски)

Правки в `server/board-data.js`:
- 40 клеток, по 4 угла и 9 клеток между
- Позиции угловых: 0, 10, 20, 30 (старт, тюрьма, казино, иди-в-тюрьму)
- Свойства улиц: `{ id, type:"property", name, group, price, rent:[base,1h,2h,3h,4h,hotel], housePrice }`

## Карточки Шанс и Казна

Правки в `server/cards.js`:
```js
{ text: "Получите $50.", action: { type: "collect", amount: 50 } }
```

Поддерживаемые типы действий:
- `collect` / `pay` — изменить баланс
- `pay-each` / `collect-each` — от/к каждому игроку
- `pay-per-building` — платить за каждый дом/отель
- `move` — телепорт (с флагом `collectOnPass`)
- `move-relative` — шаги
- `move-nearest` — до ближайшей клетки типа
- `jail` — в тюрьму
- `get-out-jail` — карта освобождения (хранится)

## Игра с другом

### Одна сеть
1. `node server.js`
2. Другу дать `http://192.168.x.x:3000` (IP из терминала)

### Интернет (Cloudflare Tunnel)
1. Скачать `cloudflared.exe`
2. `node server.js`
3. В другом терминале: `cloudflared tunnel --url http://localhost:3000`
4. Отправить другу показанный `.trycloudflare.com` URL

## Технический стек

- **Backend**: Node.js + Express + Socket.IO
- **Frontend**: vanilla JS + HTML Canvas + CSS
- **Транспорт**: WebSocket через Socket.IO
- **Хранение**: in-memory (игра потеряется при рестарте сервера)
