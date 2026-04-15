// ============================================================
//  GAME — State, main loop, screens, input
// ============================================================

let state = 'menu';         // 'menu' | 'play' | 'shop' | 'resetConfirm'
let isDrawing = false;
let isErasing = false;
let eraserMode = false;

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

// ---- Floaty text (shown on collection to reward bounces) ----
const floatTexts = [];
function spawnFloatText(x, y, text) {
    floatTexts.push({
        x, y,
        text,
        life: 1.1,
        maxLife: 1.1,
        vy: -36
    });
}
function updateFloatTexts(dt) {
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        const t = floatTexts[i];
        t.y += t.vy * dt;
        t.vy *= 0.96;
        t.life -= dt;
        if (t.life <= 0) floatTexts.splice(i, 1);
    }
}
function drawFloatTexts() {
    for (const t of floatTexts) {
        const a = Math.max(0, Math.min(1, t.life / t.maxLife));
        ctx.font = 'bold 14px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Shadow
        ctx.fillStyle = `rgba(30, 18, 6, ${a * 0.5})`;
        ctx.fillText(t.text, t.x + 1, t.y + 1);
        // Gold text
        ctx.fillStyle = `rgba(196, 160, 82, ${a})`;
        ctx.fillText(t.text, t.x, t.y);
    }
}

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
function homeBtnRect() {
    const w = 40, h = 40;
    const sb = shopBtnRect();
    return { x: sb.x - w - 8, y: sb.y, w, h };
}
function inkBarRect() {
    const mp = moneyPillRect();
    const hb = homeBtnRect();
    const x = mp.x + mp.w + 10;
    const y = 18;
    const h = 28;
    const w = Math.max(60, hb.x - x - 10);
    return { x, y, w, h };
}
function dropBtnRect() {
    // Make room for the eraser button to the right
    const h = 52;
    const w = Math.min(W() - 40 - 76, 220);
    return { x: (W() - w - 76) / 2, y: H() - h - 28, w, h };
}
function eraserBtnRect() {
    const db = dropBtnRect();
    const w = 64, h = 52;
    return { x: db.x + db.w + 12, y: db.y, w, h };
}

// ---- Menu layout ----
function menuPlayBtnRect() {
    const w = Math.min(280, W() - 60), h = 58;
    return { x: (W() - w) / 2, y: H() / 2 + 40, w, h };
}
function menuResetBtnRect() {
    const w = 170, h = 38;
    return { x: (W() - w) / 2, y: H() - 60, w, h };
}

// ---- Reset confirm modal layout ----
function resetCardRect() {
    const cw = Math.min(W() - 40, 340);
    const ch = 220;
    return { x: (W() - cw) / 2, y: (H() - ch) / 2, w: cw, h: ch };
}
function resetCancelBtnRect() {
    const c = resetCardRect();
    const btnW = c.w * 0.42, btnH = 44;
    return { x: c.x + 20, y: c.y + c.h - btnH - 20, w: btnW, h: btnH };
}
function resetConfirmBtnRect() {
    const c = resetCardRect();
    const btnW = c.w * 0.42, btnH = 44;
    return { x: c.x + c.w - btnW - 20, y: c.y + c.h - btnH - 20, w: btnW, h: btnH };
}

// ---- Input ----
function onTouchStart(sx, sy) {
    if (state !== 'play') return;

    // HUD hit tests first
    const sb = shopBtnRect();
    if (hitBtn(sx, sy, sb.x, sb.y, sb.w, sb.h)) {
        state = 'shop';
        return;
    }
    const hb = homeBtnRect();
    if (hitBtn(sx, sy, hb.x, hb.y, hb.w, hb.h)) {
        state = 'menu';
        return;
    }
    const db = dropBtnRect();
    if (hitBtn(sx, sy, db.x, db.y, db.w, db.h)) {
        spawnMarble();
        return;
    }
    const eb = eraserBtnRect();
    if (hitBtn(sx, sy, eb.x, eb.y, eb.w, eb.h)) {
        eraserMode = !eraserMode;
        notify(eraserMode ? 'Eraser on' : 'Drawing on');
        return;
    }

    // Don't allow drawing across the HUD bars
    if (sy < HUD_TOP + 4) return;
    if (sy > H() - BOTTOM_H) return;

    if (eraserMode) {
        isErasing = true;
        eraseAlongPath(sx, sy, INK_PARTIAL_ERASE_RADIUS);
    } else {
        startLine(sx, sy);
        isDrawing = true;
    }
}

function onTouchMove(sx, sy) {
    if (state !== 'play') return;
    if (isDrawing) extendLine(sx, sy);
    if (isErasing) eraseAlongPath(sx, sy, INK_PARTIAL_ERASE_RADIUS);
}

function onTouchEnd(sx, sy, info) {
    if (state === 'menu') { handleMenuTouchEnd(sx, sy); return; }
    if (state === 'resetConfirm') { handleResetConfirmTouchEnd(sx, sy); return; }
    if (state === 'shop') { handleShopTouchEnd(sx, sy); return; }
    if (isErasing) {
        isErasing = false;
        saveGame();
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

// ---- Menu + reset handlers ----
function handleMenuTouchEnd(sx, sy) {
    const pb = menuPlayBtnRect();
    if (hitBtn(sx, sy, pb.x, pb.y, pb.w, pb.h)) {
        state = 'play';
        return;
    }
    const rb = menuResetBtnRect();
    if (hitBtn(sx, sy, rb.x, rb.y, rb.w, rb.h)) {
        state = 'resetConfirm';
        return;
    }
}

function handleResetConfirmTouchEnd(sx, sy) {
    const cancel = resetCancelBtnRect();
    if (hitBtn(sx, sy, cancel.x, cancel.y, cancel.w, cancel.h)) {
        state = 'menu';
        return;
    }
    const confirm = resetConfirmBtnRect();
    if (hitBtn(sx, sy, confirm.x, confirm.y, confirm.w, confirm.h)) {
        resetAllProgress();
        state = 'menu';
        notify('Garden reset');
    }
}

function resetAllProgress() {
    money = 0;
    lines.length = 0;
    currentLine = null;
    marbles.length = 0;
    trails.length = 0;
    bouncePulses.length = 0;
    collectBursts.length = 0;
    floatTexts.length = 0;
    UPGRADES.ink.level = 0;
    UPGRADES.marbleValue.level = 0;
    UPGRADES.autoDrop.level = 0;
    autoDropTimer = 1.0;
    try { localStorage.removeItem('mr_save'); } catch (e) {}
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

    // Home button (back to menu)
    const hb = homeBtnRect();
    drawParchmentPill(hb.x, hb.y, hb.w, hb.h, 14);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 20px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⌂', hb.x + hb.w / 2, hb.y + hb.h / 2 + 1);

    // Shop button
    const sb = shopBtnRect();
    drawParchmentPill(sb.x, sb.y, sb.w, sb.h, 14);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 20px -apple-system,sans-serif';
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

function drawEraserBtn() {
    const eb = eraserBtnRect();
    if (eraserMode) {
        // Active — terracotta warning gradient
        const g = ctx.createLinearGradient(eb.x, eb.y, eb.x + eb.w, eb.y);
        g.addColorStop(0, '#c46a4a');
        g.addColorStop(1, '#a8543a');
        ctx.fillStyle = g;
        roundRect(eb.x, eb.y, eb.w, eb.h, eb.h / 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(80, 20, 10, 0.6)';
        ctx.lineWidth = 2;
        roundRect(eb.x, eb.y, eb.w, eb.h, eb.h / 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 240, 210, 0.3)';
        ctx.lineWidth = 1;
        roundRect(eb.x + 3, eb.y + 3, eb.w - 6, eb.h - 6, (eb.h - 6) / 2);
        ctx.stroke();
        ctx.fillStyle = '#fff';
    } else {
        // Inactive — parchment pill
        drawParchmentPill(eb.x, eb.y, eb.w, eb.h, eb.h / 2);
        ctx.fillStyle = PALETTE.text;
    }
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Erase', eb.x + eb.w / 2, eb.y + eb.h / 2 + 1);
}

function drawEraserCursor() {
    if (!eraserMode) return;
    if (!isErasing && !touch.down) return;
    // Only draw within the play area
    if (touch.y < HUD_TOP + 4 || touch.y > H() - BOTTOM_H) return;
    ctx.save();
    ctx.fillStyle = 'rgba(200, 122, 92, 0.18)';
    ctx.beginPath();
    ctx.arc(touch.x, touch.y, INK_PARTIAL_ERASE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 80, 50, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(touch.x, touch.y, INK_PARTIAL_ERASE_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

function drawHint() {
    // Only show the hint when no lines are drawn
    if (lines.length > 0) return;
    ctx.fillStyle = 'rgba(40, 24, 10, 0.35)';
    ctx.font = '14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Drag to draw paths', W() / 2, H() / 2);
    ctx.font = '12px -apple-system,sans-serif';
    ctx.fillText('Tap Erase to remove parts of a line', W() / 2, H() / 2 + 20);
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
    drawBouncePulses();
    drawMarbles();
    drawHint();
    drawEraserCursor();
    drawHud();
    drawDropBtn();
    drawEraserBtn();
    drawBursts(dt);
    updateFloatTexts(dt);
    drawFloatTexts();
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

// ---- Menu screen ----
function drawMenu() {
    drawBackground();

    const cx = W() / 2;

    // Enso circle (zen calligraphy brush ring) above the title
    ctx.save();
    ctx.translate(cx, H() / 2 - 120);
    ctx.strokeStyle = 'rgba(30, 18, 8, 0.22)';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, 44, -Math.PI * 0.4, Math.PI * 1.55);
    ctx.stroke();
    // Inner shine
    ctx.strokeStyle = 'rgba(255, 245, 215, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 44, -Math.PI * 0.4, Math.PI * 1.55);
    ctx.stroke();
    ctx.restore();

    // Title
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 40px -apple-system,"SF Pro Display",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Marble Flow', cx, H() / 2 - 50);

    // Subtitle
    ctx.fillStyle = PALETTE.textSoft;
    ctx.font = '15px -apple-system,sans-serif';
    ctx.fillText('— a zen garden —', cx, H() / 2 - 20);

    // Stats pill
    const autoRate = UPGRADES.autoDrop.level > 0
        ? '   •   auto ' + autoDropInterval().toFixed(1) + 's'
        : '';
    const stats = '$' + money + '   •   ' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + '   •   ink ' + (UPGRADES.ink.level + 1) + autoRate;
    ctx.font = '13px -apple-system,sans-serif';
    const sw = ctx.measureText(stats).width + 40;
    drawParchmentPill((W() - sw) / 2, H() / 2 + 4, sw, 32, 16);
    ctx.fillStyle = PALETTE.text;
    ctx.font = '13px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(stats, cx, H() / 2 + 20);

    // Play button — wooden tray style
    const pb = menuPlayBtnRect();
    const g = ctx.createLinearGradient(pb.x, pb.y, pb.x + pb.w, pb.y);
    g.addColorStop(0, '#8c6a45');
    g.addColorStop(0.5, '#a07a4f');
    g.addColorStop(1, '#8c6a45');
    ctx.fillStyle = g;
    roundRect(pb.x, pb.y, pb.w, pb.h, pb.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 36, 18, 0.7)';
    ctx.lineWidth = 2;
    roundRect(pb.x, pb.y, pb.w, pb.h, pb.h / 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 240, 210, 0.25)';
    ctx.lineWidth = 1;
    roundRect(pb.x + 3, pb.y + 3, pb.w - 6, pb.h - 6, (pb.h - 6) / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 240, 210, 0.96)';
    ctx.font = 'bold 22px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(money > 0 || lines.length > 0 ? 'Continue' : 'Begin', pb.x + pb.w / 2, pb.y + pb.h / 2 + 1);

    // Reset button — small, muted
    const rb = menuResetBtnRect();
    ctx.fillStyle = 'rgba(40, 24, 10, 0.1)';
    roundRect(rb.x, rb.y, rb.w, rb.h, rb.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80, 50, 20, 0.35)';
    ctx.lineWidth = 1;
    roundRect(rb.x, rb.y, rb.w, rb.h, rb.h / 2);
    ctx.stroke();
    ctx.fillStyle = PALETTE.textSoft;
    ctx.font = '13px -apple-system,sans-serif';
    ctx.fillText('Reset Progress', rb.x + rb.w / 2, rb.y + rb.h / 2 + 1);
}

// ---- Reset confirmation modal ----
function drawResetConfirm() {
    // Render the menu underneath so the modal feels layered
    drawMenu();
    // Dim the scene
    ctx.fillStyle = 'rgba(30, 18, 6, 0.6)';
    ctx.fillRect(0, 0, W(), H());

    const c = resetCardRect();
    // Parchment card
    ctx.fillStyle = 'rgba(248, 232, 198, 0.97)';
    roundRect(c.x, c.y, c.w, c.h, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80, 50, 20, 0.55)';
    ctx.lineWidth = 1.5;
    roundRect(c.x, c.y, c.w, c.h, 20);
    ctx.stroke();

    // Title
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 21px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Reset everything?', c.x + c.w / 2, c.y + 48);

    // Body
    ctx.fillStyle = PALETTE.textSoft;
    ctx.font = '13px -apple-system,sans-serif';
    ctx.fillText('Money, lines, and upgrades', c.x + c.w / 2, c.y + 86);
    ctx.fillText('will be erased. This cannot', c.x + c.w / 2, c.y + 104);
    ctx.fillText('be undone.', c.x + c.w / 2, c.y + 122);

    // Cancel button
    const cancel = resetCancelBtnRect();
    ctx.fillStyle = 'rgba(40, 24, 10, 0.08)';
    roundRect(cancel.x, cancel.y, cancel.w, cancel.h, cancel.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80, 50, 20, 0.4)';
    ctx.lineWidth = 1;
    roundRect(cancel.x, cancel.y, cancel.w, cancel.h, cancel.h / 2);
    ctx.stroke();
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 15px -apple-system,sans-serif';
    ctx.fillText('Cancel', cancel.x + cancel.w / 2, cancel.y + cancel.h / 2 + 1);

    // Confirm button — terracotta warning color
    const confirm = resetConfirmBtnRect();
    ctx.fillStyle = '#c87a5c';
    roundRect(confirm.x, confirm.y, confirm.w, confirm.h, confirm.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80, 20, 10, 0.55)';
    ctx.lineWidth = 1.5;
    roundRect(confirm.x, confirm.y, confirm.w, confirm.h, confirm.h / 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px -apple-system,sans-serif';
    ctx.fillText('Reset', confirm.x + confirm.w / 2, confirm.y + confirm.h / 2 + 1);
}

// ---- Main loop ----
let lastT = performance.now();
function loop() {
    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;

    if (state === 'play') {
        tickAutoDrop(dt);
        updateMarbles(dt);
        drawPlay(dt);
    } else if (state === 'shop') {
        drawShop();
    } else if (state === 'menu') {
        drawMenu();
    } else if (state === 'resetConfirm') {
        drawResetConfirm();
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
