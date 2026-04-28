const CHANCE_CARDS = [
    { text: "Отправляйтесь на Старт. Получите $200.", action: { type: "move", position: 0, collectOnPass: true } },
    { text: "Пройдите на случайную тёмно-синюю улицу.", action: { type: "move-random-group", group: "darkblue", collectOnPass: true } },
    { text: "Пройдите на случайную зелёную улицу.", action: { type: "move-random-group", group: "green", collectOnPass: true } },
    { text: "Пройдите на случайную оранжевую улицу.", action: { type: "move-random-group", group: "orange", collectOnPass: true } },
    { text: "Пройдите к ближайшей транспортной компании.", action: { type: "move-nearest", target: "railroad", collectOnPass: true } },
    { text: "Банк выплачивает дивиденды $50.", action: { type: "collect", amount: 50 } },
    { text: "Штраф за превышение скорости $15.", action: { type: "pay", amount: 15 } },
    { text: "Вы выиграли в лотерею $100.", action: { type: "collect", amount: 100 } },
    { text: "Ремонт недвижимости. Платите $50 за каждый дом и $150 за каждый отель.", action: { type: "pay-per-building", perHouse: 50, perHotel: 150 } },
    { text: "Отступите на 3 клетки назад.", action: { type: "move-relative", steps: -3 } },
    { text: "Ваши акции упали. Платите $75.", action: { type: "pay", amount: 75 } },
    { text: "Вас избрали председателем совета. Платите каждому игроку по $50.", action: { type: "pay-each", amount: 50 } },
    { text: "Отправляйтесь в тюрьму. Не проходите Старт.", action: { type: "jail" } },
    { text: "🔑 Карта освобождения из тюрьмы. Сохрани её.", action: { type: "get-out-jail" } },
    { text: "🏗 Разрешение на постройку: построй дом на любой своей улице.", action: { type: "build-anywhere" } },
];

const COMMUNITY_CARDS = [
    { text: "Банковская ошибка в вашу пользу. Получите $200.", action: { type: "collect", amount: 200 } },
    { text: "Оплата услуг врача. Платите $50.", action: { type: "pay", amount: 50 } },
    { text: "С продажи акций вы получаете $50.", action: { type: "collect", amount: 50 } },
    { text: "Налог на имущество. Платите $75.", action: { type: "pay", amount: 75 } },
    { text: "Наследство от дяди. Получите $100.", action: { type: "collect", amount: 100 } },
    { text: "У вас день рождения. Каждый игрок платит вам по $10.", action: { type: "collect-each", amount: 10 } },
    { text: "Возврат налогов. Получите $20.", action: { type: "collect", amount: 20 } },
    { text: "Страховка за пожар. Получите $50.", action: { type: "collect", amount: 50 } },
    { text: "Больничный счёт. Платите $100.", action: { type: "pay", amount: 100 } },
    { text: "Школьная плата. Платите $50.", action: { type: "pay", amount: 50 } },
    { text: "Выигрыш в конкурсе красоты. Получите $10.", action: { type: "collect", amount: 10 } },
    { text: "Отправляйтесь в тюрьму. Не проходите Старт.", action: { type: "jail" } },
    { text: "🔑 Карта освобождения из тюрьмы. Сохрани её.", action: { type: "get-out-jail" } },
];

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

module.exports = { CHANCE_CARDS, COMMUNITY_CARDS, shuffle };
