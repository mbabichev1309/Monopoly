const fs = require("fs");
const path = require("path");

const PRESETS_DIR = path.join(__dirname, "..", "presets");

function loadAll() {
    const result = {};
    try {
        const files = fs.readdirSync(PRESETS_DIR);
        for (const f of files) {
            if (!f.endsWith(".json")) continue;
            const id = f.replace(/\.json$/, "");
            try {
                const raw = fs.readFileSync(path.join(PRESETS_DIR, f), "utf-8");
                const data = JSON.parse(raw);
                if (Array.isArray(data.cells) && data.cells.length === 40) {
                    result[id] = {
                        id,
                        name: data.name || id,
                        description: data.description || "",
                        cells: data.cells,
                    };
                } else {
                    console.warn(`[presets] ${f}: cells должно быть массивом из 40 элементов — пропущен`);
                }
            } catch (e) {
                console.warn(`[presets] ${f}: ошибка чтения (${e.message}) — пропущен`);
            }
        }
    } catch (e) {
        console.warn("[presets] папка presets/ не найдена");
    }
    console.log(`[presets] загружено: ${Object.keys(result).length} — ${Object.keys(result).join(", ")}`);
    return result;
}

const presets = loadAll();

function list() {
    return Object.values(presets).map((p) => ({ id: p.id, name: p.name, description: p.description }));
}

function get(id) {
    return presets[id] || presets.main || null;
}

module.exports = { list, get };
