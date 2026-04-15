// ============================================================
//  GAME — State, main loop, screens, input
// ============================================================

let state = 'play';         // 'play' | 'shop'
let isDrawing = false;

// ---- Cherry-blossom burst effects on collection ----
const collectBursts = [];
function spawnCollectBurst(x, y) {
    for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 30 + Math.random() * 60;
        collectBursts.push({
            x, y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.8,
            maxLife: 0.8,
            rot: Math.random() * Math.PI * 2,
            vrot: (Math.random() - 0.5) * 4
        });
    }
}

// ---- Notifications ----
let notification = null;
function notify(text) { notification = { text, timer: 1.6 }; }

// ---- Layout ----
const HUD_TOP = 60;
const BOTTOM_H = 110;

function moneyPillRect() {
    const w = 136, h = 40;
    return { x: 14, y: 12, w, h };
}
function shopBtnRect() {
    const w = 48, h = 40;
    return { x: W() - w - 14, y: 12, w, h };
}
function inkBarRect() {
    const mp = moneyPillRect();
    const sb = shopBtnRect();
    const x = mp.x + mp.w + 10;
    const y = 18;
    const h = 28;
    const w = Math.max(60, sb.x - x - 10);
    return { x, y, w, h };
}
function dropBtnRect() {
    const w = Math.min(W() - 40, 240), h = 52;
    return { x: (W() - w) / 2, y: H() - h - 28, w, h };
}

// ---- Input ----
function onTouchStart(sx, sy) {
    if (state === 'shop') return;

    // HUD hit tests first
    const sb = shopBtnRect();
    if (hitBtn(sx, sy, sb.x, sb.y, sb.w, sb.h)) {
        state = 'shop';
        return;
    }
    const db = dropBtnRect();
    if (hitBtn(sx, sy, db.x, db.y, db.w, db.h)) {
        spawnMarble();
        return;
    }

    // Don't allow drawing across the HUD bars
    if (sy < HUD_TOP + 4) return;
    if (sy > H() - BOTTOM_H) return;

    startLine(sx, sy);
    isDrawing = true;
}

function onTouchMove(sx, sy) {
    if (state === 'shop') return;
    if (isDrawing) extendLine(sx, sy);
}

function onTouchEnd(sx, sy, info) {
    if (state === 'shop') {
        handleShopTouchEnd(sx, sy);
        return;
    }
    if (!isDrawing) return;
    isDrawing = false;
    if (info && info.moved) {
        // Drag committed — either save the line or discard if too short
        if (!commitLine()) cancelLine();
    } else {
        // Tap (no drag) — try to erase a nearby line
        cancelLine();
        if (eraseLineNear(sx, sy)) notify('Line erased');
    }
}

function handleShopTouchEnd(sx, sy) {
    const sb = shopBtnRect();
    if (hitBtn(sx, sy, sb.x, sb.y, sb.w, sb.h)) {
        state = 'play';
        return;
    }
    const upgrades = Object.keys(UPGRADES);
    const cardH = 88, gap = 12;
    let y = 90;
    for (const key of upgrades) {
        const u = UPGRADES[key];
        if (sy >= y && sy <= y + cardH && sx >= 20 && sx <= W() - 20) {
            const btnX = W() - 20 - 120;
            if (sx >= btnX && !u.locked && canAfford(key)) {
                if (buyUpgrade(key)) notify(u.label + ' upgraded');
            }
        }
        y += cardH + gap;
    }
}

// ---- HUD draw ----
function drawHud() {
    // Money pill
    const mp = moneyPillRect();
    drawParchmentPill(mp.x, mp.y, mp.w, mp.h, mp.h / 2);
    ctx.fillStyle = PALETTE.money;
    ctx.beginPath();
    ctx.arc(mp.x + 20, mp.y + mp.h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80, 50, 10, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(40, 24, 10, 0.85)';
    ctx.font = 'bold 11px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', mp.x + 20, mp.y + mp.h / 2 + 1);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 18px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('$' + money, mp.x + 36, mp.y + mp.h / 2 + 1);

    // Ink bar
    const ib = inkBarRect();
    const used = getInkUsed();
    const max = getInkMax();
    const frac = Math.max(0, Math.min(1, used / max));
    // Track
    ctx.fillStyle = 'rgba(40, 24, 10, 0.2)';
    roundRect(ib.x, ib.y, ib.w, ib.h, ib.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80, 50, 20, 0.45)';
    ctx.lineWidth = 1;
    roundRect(ib.x, ib.y, ib.w, ib.h, ib.h / 2);
    ctx.stroke();
    // Ink fill
    if (frac > 0) {
        const fillW = Math.max(0, (ib.w - 4) * frac);
        ctx.save();
        ctx.beginPath();
        roundRect(ib.x + 2, ib.y + 2, ib.w - 4, ib.h - 4, (ib.h - 4) / 2);
        ctx.clip();
        ctx.fillStyle = PALETTE.ink;
        ctx.fillRect(ib.x + 2, ib.y + 2, fillW, ib.h - 4);
        ctx.restore();
    }
    // Label
    const remaining = Math.max(0, Math.round(max - used));
    ctx.fillStyle = frac > 0.55 ? 'rgba(245, 232, 198, 0.95)' : PALETTE.text;
    ctx.font = 'bold 11px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('INK ' + remaining, ib.x + ib.w / 2, ib.y + ib.h / 2 + 1);

    // Shop button
    const sb = shopBtnRect();
    drawParchmentPill(sb.x, sb.y, sb.w, sb.h, 14);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 20px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚙', sb.x + sb.w / 2, sb.y + sb.h / 2 + 1);
}

function drawDropBtn() {
    const db = dropBtnRect();
    // Wooden tray gradient
    const g = ctx.createLinearGradient(db.x, db.y, db.x + db.w, db.y);
    g.addColorStop(0, '#8c6a45');
    g.addColorStop(0.5, '#a07a4f');
    g.addColorStop(1, '#8c6a45');
    ctx.fillStyle = g;
    roundRect(db.x, db.y, db.w, db.h, db.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 36, 18, 0.7)';
    ctx.lineWidth = 2;
    roundRect(db.x, db.y, db.w, db.h, db.h / 2);
    ctx.stroke();
    // Inner highlight line
    ctx.strokeStyle = 'rgba(255, 240, 210, 0.25)';
    ctx.lineWidth = 1;
    roundRect(db.x + 3, db.y + 3, db.w - 6, db.h - 6, (db.h - 6) / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 240, 210, 0.95)';
    ctx.font = 'bold 16px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◉  Release Stone', db.x + db.w / 2, db.y + db.h / 2 + 1);
}

function drawHint() {
    // Only show the hint when no lines are drawn
    if (lines.length > 0) return;
    ctx.fillStyle = 'rgba(40, 24, 10, 0.35)';
    ctx.font = '14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Drag to draw paths · Tap a line to erase', W() / 2, H() / 2);
}

function drawBursts(dt) {
    for (let i = collectBursts.length - 1; i >= 0; i--) {
        const b = collectBursts[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vy += 90 * dt;
        b.rot += b.vrot * dt;
        b.life -= dt;
        if (b.life <= 0) { collectBursts.splice(i, 1); continue; }
        const a = Math.max(0, b.life / b.maxLife);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        // Cherry-blossom petal
        ctx.fillStyle = `rgba(248, 191, 208, ${a})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, 3.6, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 230, 240, ${a * 0.8})`;
        ctx.beginPath();
        ctx.ellipse(-0.4, -0.4, 1.6, 1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawNotification(dt) {
    if (!notification) return;
    notification.timer -= dt;
    if (notification.timer <= 0) { notification = null; return; }
    const a = Math.min(1, notification.timer / 0.4);
    const pad = 14;
    ctx.font = 'bold 13px -apple-system,sans-serif';
    const tw = ctx.measureText(notification.text).width + pad * 2;
    const x = (W() - tw) / 2;
    const y = H() - BOTTOM_H - 38;
    ctx.fillStyle = `rgba(40, 24, 10, ${0.78 * a})`;
    roundRect(x, y, tw, 30, 15);
    ctx.fill();
    ctx.fillStyle = `rgba(245, 232, 198, ${a})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(notification.text, W() / 2, y + 15);
}

// ---- Screens ----
function drawPlay(dt) {
    drawBackground();
    drawCollector();
    drawSpawner();
    drawAllInk();
    drawMarbles();
    drawHint();
    drawHud();
    drawDropBtn();
    drawBursts(dt);
    drawNotification(dt);
}

function drawShop() {
    drawBackground();
    // Darken for focus
    ctx.fillStyle = 'rgba(30, 18, 6, 0.55)';
    ctx.fillRect(0, 0, W(), H());
    // Title
    ctx.fillStyle = 'rgba(245, 232, 198, 0.95)';
    ctx.font = 'bold 24px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Shop', 24, 38);
    // Money
    ctx.fillStyle = PALETTE.money;
    ctx.font = 'bold 18px -apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('$' + money, W() - 82, 38);
    // Close
    const sb = shopBtnRect();
    drawParchmentPill(sb.x, sb.y, sb.w, sb.h, 14);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 22px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('×', sb.x + sb.w / 2, sb.y + sb.h / 2);

    const upgrades = Object.keys(UPGRADES);
    const cardH = 88, gap = 12;
    let y = 90;
    for (const key of upgrades) {
        const u = UPGRADES[key];
        const maxed = u.level >= u.maxLevel;
        const afford = canAfford(key);
        // Card
        ctx.fillStyle = 'rgba(245, 232, 198, 0.08)';
        roundRect(20, y, W() - 40, cardH, 16);
        ctx.fill();
        ctx.strokeStyle = u.locked ? 'rgba(245, 232, 198, 0.12)' : 'rgba(245, 232, 198, 0.25)';
        ctx.lineWidth = 1;
        roundRect(20, y, W() - 40, cardH, 16);
        ctx.stroke();
        // Label
        ctx.fillStyle = u.locked ? 'rgba(245, 232, 198, 0.35)' : 'rgba(245, 232, 198, 0.95)';
        ctx.font = 'bold 17px -apple-system,sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(u.label, 36, y + 26);
        // Description
        ctx.fillStyle = u.locked ? 'rgba(245, 232, 198, 0.25)' : 'rgba(245, 232, 198, 0.6)';
        ctx.font = '13px -apple-system,sans-serif';
        ctx.fillText(u.desc, 36, y + 50);
        // Level pill
        if (!u.locked) {
            ctx.fillStyle = 'rgba(196, 160, 82, 0.2)';
            roundRect(36, y + 64, 60, 16, 8);
            ctx.fill();
            ctx.fillStyle = PALETTE.money;
            ctx.font = 'bold 10px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('LV ' + u.level, 66, y + 73);
        }
        // Buy button
        const btnX = W() - 20 - 120;
        const btnY = y + (cardH - 44) / 2;
        if (u.locked) {
            ctx.fillStyle = 'rgba(245, 232, 198, 0.08)';
            roundRect(btnX, btnY, 110, 44, 22);
            ctx.fill();
            ctx.strokeStyle = 'rgba(245, 232, 198, 0.12)';
            roundRect(btnX, btnY, 110, 44, 22);
            ctx.stroke();
            ctx.fillStyle = 'rgba(245, 232, 198, 0.35)';
            ctx.font = '13px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Locked', btnX + 55, btnY + 22);
        } else if (maxed) {
            ctx.fillStyle = 'rgba(122, 156, 94, 0.28)';
            roundRect(btnX, btnY, 110, 44, 22);
            ctx.fill();
            ctx.fillStyle = PALETTE.moss;
            ctx.font = 'bold 13px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('MAX', btnX + 55, btnY + 22);
        } else {
            const c = u.cost(u.level);
            ctx.fillStyle = afford ? PALETTE.money : 'rgba(245, 232, 198, 0.15)';
            roundRect(btnX, btnY, 110, 44, 22);
            ctx.fill();
            ctx.strokeStyle = afford ? 'rgba(80, 50, 10, 0.55)' : 'rgba(245, 232, 198, 0.12)';
            ctx.lineWidth = 1;
            roundRect(btnX, btnY, 110, 44, 22);
            ctx.stroke();
            ctx.fillStyle = afford ? '#2a1810' : 'rgba(245, 232, 198, 0.35)';
            ctx.font = 'bold 15px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('$' + c, btnX + 55, btnY + 22);
        }
        y += cardH + gap;
    }
}

// ---- Main loop ----
let lastT = performance.now();
function loop() {
    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;

    if (state === 'play') {
        updateMarbles(dt);
        drawPlay(dt);
    } else if (state === 'shop') {
        drawShop();
    }

    requestAnimationFrame(loop);
}

function init() {
    recomputeBoardAnchors();
    loadGame();
    window.addEventListener('resize', recomputeBoardAnchors);
    loop();
}

init();
