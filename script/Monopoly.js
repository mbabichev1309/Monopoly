export default class Monopoly {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.width = canvas.width;
        this.height = canvas.height;
        this.step = this.width / 11;
        this.cornerSize = this.step;

        this.stripePattern = this.buildStripePattern();

        this.displayPositions = {};
        this.animationsInFlight = {};
        this.pulsePhase = 0;

        this.currentPlayerId = null;
        this.highlightPlayerId = null;
        this.highlightUntil = 0;

        this.centerOverlay = { topText: null, bottomText: null, topOverride: null, topOverrideUntil: 0 };

        this.attentionCell = null;
    }

    drawAttentionWaves(now) {
        if (!this.attentionCell) return;
        const { cellId, color, waitForPlayerId } = this.attentionCell;
        if (waitForPlayerId !== undefined && this.animationsInFlight[waitForPlayerId]) return;
        const rect = this.getCellRect(cellId);
        const ctx = this.ctx;

        ctx.save();
        const maxExpand = rect.w * 0.28;
        for (let i = 0; i < 2; i++) {
            const phase = ((now / 1600 + i * 0.5) % 1);
            const expand = phase * maxExpand;
            const rx = rect.x - expand;
            const ry = rect.y - expand;
            const rw = rect.w + expand * 2;
            const rh = rect.h + expand * 2;
            const alpha = (1 - phase) * 0.45;
            ctx.strokeStyle = this.hexToRgba(color, alpha);
            ctx.lineWidth = 2;
            ctx.strokeRect(rx, ry, rw, rh);
        }
        ctx.restore();
    }

    buildStripePattern() {
        const size = 18;
        const off = document.createElement("canvas");
        off.width = size;
        off.height = size;
        const c = off.getContext("2d");
        c.strokeStyle = "rgba(0,0,0,0.9)";
        c.lineWidth = 3.5;
        for (let i = -size; i < size * 2; i += 7) {
            c.beginPath();
            c.moveTo(i, -2);
            c.lineTo(i + size + 4, size + 2);
            c.stroke();
        }
        return off;
    }

    getCellRect(index) {
        const s = this.step;
        const W = this.width;
        const H = this.height;

        if (index === 0) return { x: W - s, y: H - s, w: s, h: s, side: "corner" };
        if (index >= 1 && index <= 9) {
            const i = 9 - index;
            return { x: s + i * s, y: H - s, w: s, h: s, side: "bottom" };
        }
        if (index === 10) return { x: 0, y: H - s, w: s, h: s, side: "corner" };
        if (index >= 11 && index <= 19) {
            const i = index - 11;
            return { x: 0, y: H - s - (i + 1) * s, w: s, h: s, side: "left" };
        }
        if (index === 20) return { x: 0, y: 0, w: s, h: s, side: "corner" };
        if (index >= 21 && index <= 29) {
            const i = index - 21;
            return { x: s + i * s, y: 0, w: s, h: s, side: "top" };
        }
        if (index === 30) return { x: W - s, y: 0, w: s, h: s, side: "corner" };
        if (index >= 31 && index <= 39) {
            const i = index - 31;
            return { x: W - s, y: s + i * s, w: s, h: s, side: "right" };
        }
        return { x: 0, y: 0, w: s, h: s, side: "corner" };
    }

    startMoveAnimation(playerId, fromPos, toPos, { delay = 0, durationPerStep = 200 } = {}) {
        if (fromPos === toPos) return;
        let steps = (toPos - fromPos + 40) % 40;
        if (steps === 0) steps = 40;
        const path = [];
        for (let i = 0; i <= steps; i++) path.push((fromPos + i) % 40);
        this.animationsInFlight[playerId] = {
            path,
            startTime: performance.now() + delay,
            durationPerStep,
            total: steps,
        };
    }

    highlightPlayer(playerId, durationMs = 1100) {
        this.highlightPlayerId = playerId;
        this.highlightUntil = performance.now() + durationMs;
    }

    setCenterTopOverride(text, durationMs) {
        this.centerOverlay.topOverride = text;
        this.centerOverlay.topOverrideUntil = performance.now() + durationMs;
    }

    getTokenCenter(rect, index, count) {
        const tokenSize = rect.w * 0.2;
        const row = Math.floor(index / 2);
        const col = index % 2;
        const cx = rect.x + rect.w * 0.22 + col * tokenSize * 1.3;
        const cy = rect.y + rect.h * 0.42 + row * tokenSize * 1.3;
        return { cx, cy, r: tokenSize / 2 };
    }

    updateAnimation(players, now) {
        for (const p of players) {
            if (p.bankrupt) continue;
            const anim = this.animationsInFlight[p.id];
            if (!anim) {
                this.displayPositions[p.id] = { pos: p.position, progress: 0 };
                continue;
            }
            if (now < anim.startTime) {
                const lastPathCell = anim.path[0];
                this.displayPositions[p.id] = { pos: lastPathCell, progress: 0 };
                continue;
            }
            const elapsed = now - anim.startTime;
            const progress = elapsed / (anim.durationPerStep * anim.total);
            if (progress >= 1) {
                delete this.animationsInFlight[p.id];
                this.displayPositions[p.id] = { pos: p.position, progress: 0 };
            } else {
                const stepFloat = progress * anim.total;
                const stepIdx = Math.floor(stepFloat);
                const frac = stepFloat - stepIdx;
                const fromCell = anim.path[stepIdx];
                const toCell = anim.path[stepIdx + 1] ?? anim.path[stepIdx];
                this.displayPositions[p.id] = { pos: fromCell, nextPos: toCell, progress: frac, arc: true };
            }
        }
    }

    hasActiveAnimations() {
        return Object.keys(this.animationsInFlight).length > 0;
    }

    draw_map(board, groupColors, ownership, players) {
        const ctx = this.ctx;

        const bg = ctx.createRadialGradient(this.width / 2, this.height / 2, 100, this.width / 2, this.height / 2, this.width);
        bg.addColorStop(0, "#120a04");
        bg.addColorStop(1, "#060300");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.width, this.height);

        ctx.strokeStyle = "#d4af37";
        ctx.lineWidth = 3;
        const margin = 8;
        ctx.strokeRect(margin, margin, this.width - margin * 2, this.height - margin * 2);
        const innerMargin = this.step - 4;
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(212, 175, 55, 0.5)";
        ctx.strokeRect(innerMargin, innerMargin, this.width - innerMargin * 2, this.height - innerMargin * 2);

        const playerColors = {};
        if (players) for (const p of players) playerColors[p.id] = p.color;

        for (let i = 0; i < board.length; i++) {
            this.drawCell(board[i], groupColors, ownership, playerColors, performance.now());
        }

        this.drawCenter();
    }

    drawCenter() {
        const ctx = this.ctx;
        const cx = this.width / 2;
        const cy = this.height / 2;

        ctx.save();
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, this.width * 0.35);
        gradient.addColorStop(0, "rgba(212, 175, 55, 0.12)");
        gradient.addColorStop(1, "rgba(212, 175, 55, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(this.step, this.step, this.width - this.step * 2, this.height - this.step * 2);

        const now = performance.now();
        const o = this.centerOverlay;
        const hurryActive = o.topOverride && now < o.topOverrideUntil;

        if (hurryActive) {
            ctx.fillStyle = "#ff4444";
            ctx.font = "900 52px 'Cinzel', serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const flash = Math.abs(Math.sin(now / 120));
            ctx.globalAlpha = 0.5 + 0.5 * flash;
            ctx.shadowColor = "rgba(255, 68, 68, 0.9)";
            ctx.shadowBlur = 28;
            ctx.fillText("ПОТОРОПИТЕСЬ!", cx, cy - 80);
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        } else if (o.topText) {
            ctx.fillStyle = "#3aa744";
            ctx.font = "900 48px 'Cinzel', serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.shadowColor = "rgba(58, 167, 68, 0.7)";
            ctx.shadowBlur = 22;
            const pulse = 0.85 + 0.15 * Math.sin(now / 400);
            ctx.globalAlpha = pulse;
            ctx.fillText(o.topText, cx, cy - 80);
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        }

        ctx.fillStyle = "#d4af37";
        ctx.font = "900 84px 'Cinzel', serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(212, 175, 55, 0.5)";
        ctx.shadowBlur = 24;
        ctx.fillText("МОНОПОЛИЯ", cx, cy);
        ctx.shadowBlur = 0;

        if (o.bottomText) {
            ctx.fillStyle = "#c4a040";
            ctx.font = "700 38px 'Cinzel', serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.shadowColor = "rgba(212, 175, 55, 0.4)";
            ctx.shadowBlur = 14;
            const pulse2 = 0.75 + 0.25 * Math.sin(now / 380);
            ctx.globalAlpha = pulse2;
            ctx.fillText(o.bottomText, cx, cy + 80);
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        }

        ctx.restore();
    }

    drawCornerDecoration(cell, x, y, w, h, now) {
        const ctx = this.ctx;

        if (cell.action === "go") {
            const g = ctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, "#bdf05a");
            g.addColorStop(1, "#8ac82f");
            ctx.fillStyle = g;
            ctx.fillRect(x, y, w, h);
        } else if (cell.action === "jail" || cell.action === "go-to-jail") {
            const g = ctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, "#a8a8a8");
            g.addColorStop(1, "#6b6b6b");
            ctx.fillStyle = g;
            ctx.fillRect(x, y, w, h);

            if (cell.action === "jail") {
                ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
                ctx.lineWidth = 2;
                const barGap = w / 6;
                for (let i = 1; i < 6; i++) {
                    ctx.beginPath();
                    ctx.moveTo(x + i * barGap, y + h * 0.28);
                    ctx.lineTo(x + i * barGap, y + h * 0.72);
                    ctx.stroke();
                }
            }
        } else if (cell.action === "casino") {
            const g = ctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, "#e53935");
            g.addColorStop(0.5, "#ff8a3c");
            g.addColorStop(1, "#ffd54f");
            ctx.fillStyle = g;
            ctx.fillRect(x, y, w, h);

            ctx.font = `${w * 0.55}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("🎰", x + w / 2, y + h / 2);
        }
    }

    drawCell(cell, groupColors, ownership, playerColors, now) {
        const ctx = this.ctx;
        const { x, y, w, h, side } = this.getCellRect(cell.id);

        if (side === "corner") {
            this.drawCornerDecoration(cell, x, y, w, h, now);
            ctx.strokeStyle = "rgba(212, 175, 55, 0.7)";
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);

            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            if (cell.action === "go") {
                ctx.fillStyle = "#1a3a0f";
                ctx.font = `900 ${Math.floor(w * 0.5)}px sans-serif`;
                ctx.fillText("←", x + w / 2, y + h * 0.4);

                ctx.fillStyle = "#1a1208";
                ctx.font = `900 ${Math.floor(w * 0.13)}px 'Cinzel', serif`;
                ctx.fillText("СТАРТ", x + w / 2, y + h * 0.72);

                ctx.fillStyle = "#8b0000";
                ctx.font = `700 ${Math.floor(w * 0.1)}px 'Cinzel', serif`;
                ctx.fillText("+$200 ЗА КРУГ", x + w / 2, y + h * 0.88);
            } else if (cell.action === "jail") {
                ctx.fillStyle = "#1a1208";
                ctx.font = `900 ${Math.floor(w * 0.12)}px 'Cinzel', serif`;
                ctx.fillText("ТЮРЬМА", x + w / 2, y + h * 0.15);

                ctx.fillStyle = "#3a2e1a";
                ctx.font = `700 ${Math.floor(w * 0.09)}px 'Cinzel', serif`;
                ctx.fillText("ПРОСТО", x + w / 2, y + h * 0.82);
                ctx.fillText("ПОСЕЩЕНИЕ", x + w / 2, y + h * 0.92);
            } else if (cell.action === "go-to-jail") {
                ctx.fillStyle = "#1a1208";
                ctx.font = `900 ${Math.floor(w * 0.12)}px 'Cinzel', serif`;
                ctx.fillText("ИДИ В", x + w / 2, y + h * 0.22);
                ctx.fillText("ТЮРЬМУ", x + w / 2, y + h * 0.36);

                ctx.font = `${Math.floor(w * 0.38)}px sans-serif`;
                ctx.fillText("🚔", x + w / 2, y + h * 0.62);

                ctx.fillStyle = "#8b0000";
                ctx.font = `700 ${Math.floor(w * 0.09)}px 'Cinzel', serif`;
                ctx.fillText("→ ПЕРЕХОД", x + w / 2, y + h * 0.88);
            } else if (cell.action === "casino") {
                ctx.fillStyle = "#fff";
                ctx.font = `900 ${Math.floor(w * 0.13)}px 'Cinzel', serif`;
                ctx.shadowColor = "rgba(0,0,0,0.8)";
                ctx.shadowBlur = 6;
                ctx.fillText("КАЗИНО", x + w / 2, y + h * 0.88);
            } else {
                ctx.fillStyle = "#1a1208";
                ctx.font = `900 ${Math.floor(w * 0.11)}px 'Cinzel', serif`;
                ctx.fillText((cell.name || "").toUpperCase(), x + w / 2, y + h * 0.8);
            }
            ctx.restore();
            return;
        }

        const cellGradient = ctx.createLinearGradient(x, y, x, y + h);
        cellGradient.addColorStop(0, "#f9f0d4");
        cellGradient.addColorStop(1, "#e8d6a8");
        ctx.fillStyle = cellGradient;
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = "rgba(212, 175, 55, 0.7)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        if (cell.type === "property" && cell.group && groupColors[cell.group]) {
            ctx.fillStyle = groupColors[cell.group];
            if (side === "bottom") ctx.fillRect(x, y, w, h * 0.22);
            else if (side === "top") ctx.fillRect(x, y + h * 0.78, w, h * 0.22);
            else if (side === "left") ctx.fillRect(x + w * 0.78, y, w * 0.22, h);
            else if (side === "right") ctx.fillRect(x, y, w * 0.22, h);

            ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
            ctx.lineWidth = 1;
            if (side === "bottom") ctx.strokeRect(x, y, w, h * 0.22);
            else if (side === "top") ctx.strokeRect(x, y + h * 0.78, w, h * 0.22);
            else if (side === "left") ctx.strokeRect(x + w * 0.78, y, w * 0.22, h);
            else if (side === "right") ctx.strokeRect(x, y, w * 0.22, h);
        }

        const own = ownership && ownership[cell.id];
        if (own && own.ownerId !== null && own.ownerId !== undefined && playerColors) {
            const ownerColor = playerColors[own.ownerId];
            if (ownerColor) {
                const t = h * 0.13;
                let ox = x, oy = y, ow = w, oh = h;
                if (side === "bottom") { oy = y + h - t; oh = t; }
                else if (side === "top") { oh = t; }
                else if (side === "left") { ow = t; }
                else if (side === "right") { ox = x + w - t; ow = t; }

                ctx.fillStyle = ownerColor;
                ctx.fillRect(ox, oy, ow, oh);

                ctx.save();
                const pattern = ctx.createPattern(this.stripePattern, "repeat");
                ctx.fillStyle = pattern;
                ctx.globalAlpha = 0.4;
                ctx.fillRect(ox, oy, ow, oh);
                ctx.restore();

                ctx.strokeStyle = "rgba(212, 175, 55, 0.9)";
                ctx.lineWidth = 1.5;
                ctx.strokeRect(ox, oy, ow, oh);
            }
        }

        ctx.save();
        ctx.fillStyle = "#1a1208";
        ctx.textAlign = "center";

        const shift = h * 0.05;
        let cx = x + w / 2;
        let cy = y + h / 2;
        if (side === "bottom") cy -= shift;
        else if (side === "top") cy += shift;
        else if (side === "left") cx += shift;
        else if (side === "right") cx -= shift;

        if (side === "left") {
            ctx.translate(cx, cy);
            ctx.rotate(Math.PI / 2);
            this.drawCellLabel(cell, 0, 0, w);
        } else if (side === "right") {
            ctx.translate(cx, cy);
            ctx.rotate(-Math.PI / 2);
            this.drawCellLabel(cell, 0, 0, w);
        } else {
            this.drawCellLabel(cell, cx, cy, w);
        }
        ctx.restore();

        if (own && own.ownerId !== null && own.ownerId !== undefined) {
            ctx.fillStyle = "#1a1208";
            ctx.font = `${Math.floor(w * 0.14)}px sans-serif`;
            ctx.textAlign = "left";
            if (own.hotel) {
                ctx.fillText("🏨", x + 6, y + h * 0.35);
            } else if (own.houses > 0) {
                ctx.fillText(`🏠×${own.houses}`, x + 6, y + h * 0.35);
            }
        }
    }

    drawCellLabel(cell, cx, cy, w) {
        const ctx = this.ctx;
        const name = (cell.name || "").toUpperCase();
        const words = name.split(" ");
        const lines = [];
        let cur = "";
        ctx.font = `700 ${Math.floor(w * 0.1)}px 'Cinzel', serif`;
        const maxW = w * 0.9;
        for (const word of words) {
            const test = cur ? cur + " " + word : word;
            if (ctx.measureText(test).width > maxW && cur) {
                lines.push(cur);
                cur = word;
            } else {
                cur = test;
            }
        }
        if (cur) lines.push(cur);

        const lineH = Math.floor(w * 0.13);
        const startY = cy - ((lines.length - 1) * lineH) / 2 - lineH * 0.5;

        ctx.fillStyle = "#1a1208";
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], cx, startY + i * lineH);
        }

        if (cell.price) {
            ctx.fillStyle = "#8b0000";
            ctx.font = `900 ${Math.floor(w * 0.11)}px 'Cinzel', serif`;
            ctx.fillText(`$${cell.price}`, cx, startY + lines.length * lineH + 6);
        }
    }

    draw_tokens(players, currentPlayerId, now) {
        this.currentPlayerId = currentPlayerId;
        this.pulsePhase = (now / 600) % (2 * Math.PI);

        this.updateAnimation(players, now);

        const ctx = this.ctx;
        const visibleByCell = {};
        for (const p of players) {
            if (p.bankrupt) continue;
            const dp = this.displayPositions[p.id] || { pos: p.position, progress: 0 };
            const keyPos = dp.pos;
            if (!visibleByCell[keyPos]) visibleByCell[keyPos] = [];
            visibleByCell[keyPos].push(p);
        }

        const highlightActive = this.highlightPlayerId !== null && now < this.highlightUntil;

        for (const p of players) {
            if (p.bankrupt) continue;
            const dp = this.displayPositions[p.id] || { pos: p.position, progress: 0 };
            const rect1 = this.getCellRect(dp.pos);
            const count = visibleByCell[dp.pos]?.length || 1;
            const pIdx = visibleByCell[dp.pos]?.indexOf(p) ?? 0;
            const t1 = this.getTokenCenter(rect1, pIdx, count);

            let tx = t1.cx, ty = t1.cy, tr = t1.r;

            if (dp.nextPos !== undefined && dp.progress !== undefined) {
                const rect2 = this.getCellRect(dp.nextPos);
                const t2 = this.getTokenCenter(rect2, 0, 1);
                tx = t1.cx + (t2.cx - t1.cx) * dp.progress;
                ty = t1.cy + (t2.cy - t1.cy) * dp.progress;
                if (dp.arc) {
                    const arcH = tr * 1.8;
                    ty -= Math.sin(dp.progress * Math.PI) * arcH;
                }
            }

            const isCurrent = p.id === currentPlayerId;
            const isHighlight = highlightActive && p.id === this.highlightPlayerId;

            if (isCurrent || isHighlight) {
                const amp = isHighlight
                    ? 1 + 0.4 * Math.sin(this.pulsePhase * 1.8)
                    : 1 + 0.2 * Math.sin(this.pulsePhase);
                const glowR = tr * (isHighlight ? 3.3 : 2.4) * amp;
                const grad = ctx.createRadialGradient(tx, ty, tr * 0.8, tx, ty, glowR);
                const alpha = isHighlight ? 0.85 : 0.6;
                grad.addColorStop(0, `${this.hexToRgba(p.color, alpha)}`);
                grad.addColorStop(1, `${this.hexToRgba(p.color, 0)}`);
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(tx, ty, glowR, 0, Math.PI * 2);
                ctx.fill();

                const ringCount = isHighlight ? 4 : 3;
                for (let i = 0; i < ringCount; i++) {
                    const phase = (this.pulsePhase * (isHighlight ? 1.5 : 1) + i * 1.7) % (2 * Math.PI);
                    const wave = (Math.sin(phase) + 1) / 2;
                    const ringR = tr * (1.3 + wave * (isHighlight ? 2 : 1.4));
                    ctx.strokeStyle = this.hexToRgba(p.color, (isHighlight ? 0.8 : 0.6) * (1 - wave));
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(tx, ty, ringR, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }

            ctx.save();
            ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 3;

            ctx.beginPath();
            ctx.arc(tx, ty, tr, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();

            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;

            ctx.strokeStyle = "#d4af37";
            ctx.lineWidth = 2.5;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(tx, ty, tr - 4, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.restore();
        }
    }

    hexToRgba(hex, alpha) {
        const m = hex.replace("#", "");
        const r = parseInt(m.substring(0, 2), 16);
        const g = parseInt(m.substring(2, 4), 16);
        const b = parseInt(m.substring(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
}
