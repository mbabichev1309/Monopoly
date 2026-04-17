const BOARD = [
    { id: 0, type: "corner", name: "Старт", action: "go" },

    { id: 1, type: "property", name: "Будапешт", group: "brown", price: 60, rent: [2, 10, 30, 90, 160, 250], housePrice: 50 },
    { id: 2, type: "chance", name: "Шанс" },
    { id: 3, type: "property", name: "Варшава", group: "brown", price: 60, rent: [4, 20, 60, 180, 320, 450], housePrice: 50 },
    { id: 4, type: "community", name: "Казна" },
    { id: 5, type: "railroad", name: "Авиакомпания", price: 200, rent: [25, 50, 100, 200] },
    { id: 6, type: "property", name: "Прага", group: "lightblue", price: 100, rent: [6, 30, 90, 270, 400, 550], housePrice: 50 },
    { id: 7, type: "tax", name: "Дополнительный налог", amount: 100 },
    { id: 8, type: "property", name: "Кейптаун", group: "lightblue", price: 100, rent: [6, 30, 90, 270, 400, 550], housePrice: 50 },
    { id: 9, type: "property", name: "Монреаль", group: "lightblue", price: 120, rent: [8, 40, 100, 300, 450, 600], housePrice: 50 },

    { id: 10, type: "corner", name: "Тюрьма", action: "jail" },

    { id: 11, type: "property", name: "Сеул", group: "pink", price: 140, rent: [10, 50, 150, 450, 625, 750], housePrice: 100 },
    { id: 12, type: "chance", name: "Шанс" },
    { id: 13, type: "property", name: "Мадрид", group: "pink", price: 140, rent: [10, 50, 150, 450, 625, 750], housePrice: 100 },
    { id: 14, type: "property", name: "Гамбург", group: "pink", price: 160, rent: [12, 60, 180, 500, 700, 900], housePrice: 100 },
    { id: 15, type: "railroad", name: "Автотранспортная компания", price: 200, rent: [25, 50, 100, 200] },
    { id: 16, type: "property", name: "Барселона", group: "orange", price: 180, rent: [14, 70, 200, 550, 750, 950], housePrice: 100 },
    { id: 17, type: "community", name: "Казна" },
    { id: 18, type: "property", name: "Шанхай", group: "orange", price: 180, rent: [14, 70, 200, 550, 750, 950], housePrice: 100 },
    { id: 19, type: "property", name: "Стокгольм", group: "orange", price: 200, rent: [16, 80, 220, 600, 800, 1000], housePrice: 100 },

    { id: 20, type: "casino", name: "Казино", action: "casino" },

    { id: 21, type: "property", name: "Мельбурн", group: "red", price: 220, rent: [18, 90, 250, 700, 875, 1050], housePrice: 150 },
    { id: 22, type: "utility", name: "Интернет-компания", price: 150 },
    { id: 23, type: "property", name: "Мюнхен", group: "red", price: 220, rent: [18, 90, 250, 700, 875, 1050], housePrice: 150 },
    { id: 24, type: "property", name: "Осло", group: "red", price: 240, rent: [20, 100, 300, 750, 925, 1100], housePrice: 150 },
    { id: 25, type: "railroad", name: "Судоходная компания", price: 200, rent: [25, 50, 100, 200] },
    { id: 26, type: "property", name: "Копенгаген", group: "yellow", price: 260, rent: [22, 110, 330, 800, 975, 1150], housePrice: 150 },
    { id: 27, type: "chance", name: "Шанс" },
    { id: 28, type: "property", name: "Париж", group: "yellow", price: 260, rent: [22, 110, 330, 800, 975, 1150], housePrice: 150 },
    { id: 29, type: "property", name: "Ванкувер", group: "yellow", price: 280, rent: [24, 120, 360, 850, 1025, 1200], housePrice: 150 },

    { id: 30, type: "corner", name: "Иди в тюрьму", action: "go-to-jail" },

    { id: 31, type: "property", name: "Амстердам", group: "green", price: 300, rent: [26, 130, 390, 900, 1100, 1275], housePrice: 200 },
    { id: 32, type: "property", name: "Женева", group: "green", price: 300, rent: [26, 130, 390, 900, 1100, 1275], housePrice: 200 },
    { id: 33, type: "utility", name: "Компания мобильной связи", price: 150 },
    { id: 34, type: "property", name: "Лондон", group: "green", price: 320, rent: [28, 150, 450, 1000, 1200, 1400], housePrice: 200 },
    { id: 35, type: "railroad", name: "Железнодорожная компания", price: 200, rent: [25, 50, 100, 200] },
    { id: 36, type: "tax", name: "Налог", amount: 200 },
    { id: 37, type: "property", name: "Гонконг", group: "darkblue", price: 350, rent: [35, 175, 500, 1100, 1300, 1500], housePrice: 200 },
    { id: 38, type: "community", name: "Казна" },
    { id: 39, type: "property", name: "Нью-Йорк", group: "darkblue", price: 400, rent: [50, 200, 600, 1400, 1700, 2000], housePrice: 200 },
];

const GROUP_COLORS = {
    brown: "#6b4423",
    lightblue: "#5fb3d1",
    pink: "#c43b7a",
    orange: "#d98027",
    red: "#a01e3a",
    yellow: "#d4a017",
    green: "#1f5f3f",
    darkblue: "#162447",
};

module.exports = { BOARD, GROUP_COLORS };
