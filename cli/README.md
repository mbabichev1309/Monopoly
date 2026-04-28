# DebugTool CLI

Консольный клиент для управления игрой через SSH (Termius на телефоне).

## Запуск

```bash
node cli/debug.js [URL]
```

`URL` — адрес сервера. По умолчанию `http://localhost:3000`.

Примеры:
```bash
# Сервер запущен на той же машине
node cli/debug.js

# Удалённо (через cloudflare/ngrok туннель или LAN)
node cli/debug.js http://192.168.1.13:3000
```

## Команды

```
help                       — справка
auth <login> <password>    — авторизоваться (см. config/debug.json)
lobbies                    — список активных игр
use <lobbyId>              — выбрать активную игру
players                    — игроки в игре

# Управление игроком (target = имя или id):
moveTo <player> <pos>      — телепорт на клетку 0-39
moveF <player> <n>         — сдвиг вперёд
moveB <player> <n>         — сдвиг назад
give <player> balance <amt>     — дать денег
give <player> property <id>     — дать карту (0-39)
take <player> balance <amt>     — снять денег
take <player> property <id>     — забрать карту
turn <player>              — передать ход
kick <player>              — выкинуть (помечает "вышел")

jackpot <amt>              — изменить джекпот казино

quit                       — выход
```

## Использование через Termius (SSH)

### Настройка SSH-сервера на Windows (если играешь на Windows)

1. Открой "Параметры → Приложения → Дополнительные компоненты"
2. Найди и установи **OpenSSH Server**
3. Запусти службу: PowerShell как админ → `Start-Service sshd`
4. Узнай свой IP: `ipconfig` → IPv4

### С телефона через Termius

1. Создай host: твой IP + Windows-логин/пароль
2. Подключайся
3. В сессии:
```bash
cd Path\To\Monopoly
node cli/debug.js
```

4. В REPL:
```
> auth dev monopoly
✓ Авторизован

> lobbies
▶ ABCDE  3/4  classic  [Alice, Bob, Charlie]

> use ABCDE
✓ Активное лобби: ABCDE

> players
◀ 0: Alice — $1500, on Будапешт
  1: Bob — $1200, on Шанс
  2: Charlie — $800, on Тюрьма [jail]

> moveTo Alice 20
✓ Выполнено

> give Bob balance 5000
✓ Выполнено

> kick Charlie
✓ Выполнено
```

### Альтернатива: туннель Cloudflare

Если играешь не дома, а через cloudflare tunnel — CLI тоже работает удалённо:
```bash
# На своём ПК
node cli/debug.js https://your-tunnel.trycloudflare.com
```

## Безопасность

- Пароли в `config/debug.json` — храни в тайне
- Не публикуй CLI URL — любой с паролем может управлять игрой
- На каждое подключение нужна авторизация заново (нет персистентных токенов)
