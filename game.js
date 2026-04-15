// ============================================================
//  GAME — State, main loop, all screens
// ============================================================

// Possible states: 'play', 'shop'
let state = 'play';

// Which piece type is selected from the picker (null = none, tap to select)
let selectedPieceType = 'straight';

// Hover cell during a tap (for placement preview)
let hoverCell = null;

// Collection burst effects — short-lived particles
const collectBursts = [];
function spawnCollectBurst(x, y) {
    for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 80;
        collectBursts.push({
            x, y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.6,
            maxLife: 0.6
        });
    }
}

// Brief feedback notifications
let notification = null;
function notify(text) { notification = { text, timer: 1.8 }; }

// Per-tap bookkeeping (used for double-tap + long-press detection)
let lastTapCell = null;
let lastTapTime = 0;

// ---- Layout constants ----
const HUD_TOP = 60;
const PICKER_H = 84;
const DROP_BTN_H = 56;

function moneyPillRect() {
    const w = 150, h = 44;
    return { x: 14, y: 14, w, h };
}
function shopBtnRect() {
    const w = 56, h = 44;
    return { x: W() - w - 14, y: 14, w, h };
}
function dropBtnRect() {
    const w = Math.min(W() - 28, 340), h = DROP_BTN_H;
    return { x: (W() - w) / 2, y: H() - h - 14, w, h };
}
function pickerRect() {
    return { x: 0, y: H() - DROP_BTN_H - PICKER_H - 14, w: W(), h: PICKER_H };
}

// ---- Input handling ----
function onTouchStart(sx, sy) {
    if (state === 'shop') {
        handleShopTouchStart(sx, sy);
        return;
    }
    // Shop button
    const sb = shopBtnRect();
    if (hitBtn(sx, sy, sb.x, sb.y, sb.w, sb.h)) {
        state = 'shop';
        return;
    }
    // Drop button
    const db = dropBtnRect();
    if (hitBtn(sx, sy, db.x, db.y, db.w, db.h)) {
        spawnMarble();
        return;
    }
    // Piece picker
    const pr = pickerRect();
    if (sy >= pr.y) {
        handlePickerTap(sx, sy);
        return;
    }
    // Grid area
    const cell = worldToCell(sx, sy);
    if (inGrid(cell.col, cell.row)) {
        hoverCell = cell;
    }
}
function onTouchMove(sx, sy) {
    if (state === 'shop') return;
    const cell = worldToCell(sx, sy);
    if (inGrid(cell.col, cell.row)) {
        hoverCell = cell;
    }
}
function onTouchEnd(sx, sy, info) {
    const held = info ? info.held : 0;
    const moved = info ? info.moved : false;
    if (state === 'shop') {
        handleShopTouchEnd(sx, sy);
        return;
    }
    // Only grid taps past this point
    if (sy < HUD_TOP) return;
    const pr = pickerRect();
    if (sy >= pr.y) return;
    if (moved) { hoverCell = null; return; }

    const cell = worldToCell(sx, sy);
    if (!inGrid(cell.col, cell.row)) { hoverCell = null; return; }

    // Long press → remove piece
    if (held > 500) {
        if (pieceAt(cell.col, cell.row)) {
            removePieceAt(cell.col, cell.row);
            notify('Piece removed');
        }
        hoverCell = null;
        return;
    }

    // Double tap → rotate existing piece
    const now = performance.now();
    const sameCell = lastTapCell && lastTapCell.col === cell.col && lastTapCell.row === cell.row;
    if (sameCell && (now - lastTapTime) < 360) {
        if (pieceAt(cell.col, cell.row)) {
            rotatePieceAt(cell.col, cell.row);
            notify('Rotated');
        }
        lastTapCell = null;
        lastTapTime = 0;
        hoverCell = null;
        return;
    }
    lastTapCell = cell;
    lastTapTime = now;

    // Single tap → place selected piece (if empty cell)
    if (!pieceAt(cell.col, cell.row)) {
        if (placedPieces.length >= getMaxPieces()) {
            notify('Max pieces — buy more slots in shop');
        } else if (selectedPieceType) {
            if (!placePiece(selectedPieceType, cell.col, cell.row)) {
                notify('Cannot place here');
            }
        }
    }
    hoverCell = null;
}

function handlePickerTap(sx, sy) {
    const pr = pickerRect();
    const types = Object.keys(PIECE_TYPES);
    const slotW = Math.min(100, pr.w / types.length);
    const totalW = slotW * types.length;
    const ox = (pr.w - totalW) / 2;
    for (let i = 0; i < types.length; i++) {
        const x = ox + i * slotW;
        if (sx >= x && sx <= x + slotW) {
            selectedPieceType = types[i];
            return;
        }
    }
}

// ---- Shop modal ----
let shopScroll = 0;
function handleShopTouchStart(sx, sy) {}
function handleShopTouchEnd(sx, sy) {
    // Close button
    const closeW = 56, closeH = 44;
    if (hitBtn(sx, sy, W() - closeW - 14, 14, closeW, closeH)) {
        state = 'play';
        return;
    }
    // Upgrade buttons
    const upgrades = Object.keys(UPGRADES);
    const cardH = 88, gap = 12;
    let y = 90;
    for (const key of upgrades) {
        const u = UPGRADES[key];
        if (sy >= y && sy <= y + cardH && sx >= 20 && sx <= W() - 20) {
            // Buy button region (right 40% of card)
            const btnX = W() - 20 - 120;
            if (sx >= btnX && !u.locked && canAfford(key)) {
                if (buyUpgrade(key)) notify(u.label + ' upgraded!');
            }
        }
        y += cardH + gap;
    }
}

// ---- Main draw ----
function drawHud() {
    // Money pill
    const mp = moneyPillRect();
    drawGlassPill(mp.x, mp.y, mp.w, mp.h, mp.h / 2);
    // Coin dot
    ctx.fillStyle = PALETTE.money;
    ctx.beginPath();
    ctx.arc(mp.x + 22, mp.y + mp.h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = 'bold 11px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', mp.x + 22, mp.y + mp.h / 2 + 1);
    // Money text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('$' + money, mp.x + 40, mp.y + mp.h / 2 + 1);

    // Shop button
    const sb = shopBtnRect();
    drawGlassPill(sb.x, sb.y, sb.w, sb.h, 14);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚙', sb.x + sb.w / 2, sb.y + sb.h / 2 + 1);
}

function drawPicker() {
    const pr = pickerRect();
    // Background strip
    ctx.fillStyle = 'rgba(10,22,40,0.65)';
    ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x + pr.w, pr.y);
    ctx.stroke();

    const types = Object.keys(PIECE_TYPES);
    const slotW = Math.min(100, pr.w / types.length);
    const totalW = slotW * types.length;
    const ox = (pr.w - totalW) / 2;
    for (let i = 0; i < types.length; i++) {
        const def = PIECE_TYPES[types[i]];
        const x = ox + i * slotW + 6;
        const y = pr.y + 10;
        const w = slotW - 12, h = pr.h - 20;
        const selected = selectedPieceType === types[i];
        ctx.fillStyle = selected ? 'rgba(109,217,255,0.22)' : 'rgba(255,255,255,0.05)';
        roundRect(x, y, w, h, 12);
        ctx.fill();
        ctx.strokeStyle = selected ? PALETTE.accent : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = selected ? 2 : 1;
        roundRect(x, y, w, h, 12);
        ctx.stroke();
        // Preview
        drawPiecePreview(types[i], x + 12, y + 8, w - 24);
        // Label
        ctx.fillStyle = '#dfeeff';
        ctx.font = '11px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(def.label, x + w / 2, y + h - 12);
    }
}

function drawDropBtn() {
    const db = dropBtnRect();
    // Vibrant gradient
    const g = ctx.createLinearGradient(db.x, db.y, db.x + db.w, db.y);
    g.addColorStop(0, '#5fb0d8');
    g.addColorStop(1, '#6dd9ff');
    ctx.fillStyle = g;
    roundRect(db.x, db.y, db.w, db.h, db.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    roundRect(db.x, db.y, db.w, db.h, db.h / 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◉  Drop Marble', db.x + db.w / 2, db.y + db.h / 2 + 1);
}

function drawHoverCell() {
    if (!hoverCell) return;
    if (!inGrid(hoverCell.col, hoverCell.row)) return;
    const { x, y } = cellToWorld(hoverCell.col, hoverCell.row);
    ctx.fillStyle = 'rgba(109,217,255,0.18)';
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    ctx.strokeStyle = 'rgba(109,217,255,0.6)';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
    ctx.setLineDash([]);
}

function drawBursts(dt) {
    for (let i = collectBursts.length - 1; i >= 0; i--) {
        const b = collectBursts[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vy += 120 * dt;
        b.life -= dt;
        if (b.life <= 0) { collectBursts.splice(i, 1); continue; }
        const a = Math.max(0, b.life / b.maxLife);
        ctx.fillStyle = `rgba(255,216,109,${a})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawNotification(dt) {
    if (!notification) return;
    notification.timer -= dt;
    if (notification.timer <= 0) { notification = null; return; }
    const a = Math.min(1, notification.timer / 0.4);
    ctx.fillStyle = `rgba(10,22,40,${0.8 * a})`;
    const pad = 14;
    ctx.font = 'bold 14px -apple-system,sans-serif';
    const tw = ctx.measureText(notification.text).width + pad * 2;
    const x = (W() - tw) / 2;
    const y = HUD_TOP + 8;
    roundRect(x, y, tw, 32, 16);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.2 * a})`;
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(notification.text, W() / 2, y + 16);
}

function drawPlay(dt) {
    drawBackground();
    drawGrid();
    drawCollector();
    drawSpawner();
    // Placed pieces
    for (const p of placedPieces) drawPiece(p);
    // Hover
    drawHoverCell();
    // Marbles
    drawMarbles();
    // HUD
    drawPicker();
    drawDropBtn();
    drawHud();
    // Piece count pill in upper-middle
    const text = placedPieces.length + ' / ' + getMaxPieces();
    ctx.font = '12px -apple-system,sans-serif';
    const tw = ctx.measureText(text).width + 24;
    const px = (W() - tw) / 2;
    drawGlassPill(px, 22, tw, 28, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W() / 2, 36);
    // Bursts + notifications
    drawBursts(dt);
    drawNotification(dt);
}

function drawShop() {
    drawBackground();
    // Dim overlay
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, W(), H());
    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Shop', 20, 38);
    // Money
    ctx.fillStyle = PALETTE.money;
    ctx.font = 'bold 18px -apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('$' + money, W() - 90, 38);
    // Close button
    const sb = shopBtnRect();
    drawGlassPill(sb.x, sb.y, sb.w, sb.h, 14);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('×', sb.x + sb.w / 2, sb.y + sb.h / 2);

    // Upgrade cards
    const upgrades = Object.keys(UPGRADES);
    const cardH = 88, gap = 12;
    let y = 90;
    for (const key of upgrades) {
        const u = UPGRADES[key];
        const maxed = u.level >= u.maxLevel;
        const afford = canAfford(key);
        // Card background
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        roundRect(20, y, W() - 40, cardH, 16);
        ctx.fill();
        ctx.strokeStyle = u.locked ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        roundRect(20, y, W() - 40, cardH, 16);
        ctx.stroke();
        // Label
        ctx.fillStyle = u.locked ? PALETTE.locked : '#fff';
        ctx.font = 'bold 17px -apple-system,sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(u.label, 36, y + 26);
        // Description
        ctx.fillStyle = u.locked ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.55)';
        ctx.font = '13px -apple-system,sans-serif';
        ctx.fillText(u.desc, 36, y + 50);
        // Level pill
        if (!u.locked) {
            ctx.fillStyle = 'rgba(109,217,255,0.18)';
            roundRect(36, y + 64, 56, 16, 8);
            ctx.fill();
            ctx.fillStyle = PALETTE.accent;
            ctx.font = 'bold 10px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('LV ' + u.level + (u.maxLevel < 99 ? '/' + u.maxLevel : ''), 64, y + 73);
        }
        // Buy button / locked label
        const btnX = W() - 20 - 120;
        const btnY = y + (cardH - 44) / 2;
        if (u.locked) {
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            roundRect(btnX, btnY, 110, 44, 22);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            roundRect(btnX, btnY, 110, 44, 22);
            ctx.stroke();
            ctx.fillStyle = PALETTE.locked;
            ctx.font = '13px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Locked', btnX + 55, btnY + 22);
        } else if (maxed) {
            ctx.fillStyle = 'rgba(180,245,200,0.18)';
            roundRect(btnX, btnY, 110, 44, 22);
            ctx.fill();
            ctx.fillStyle = PALETTE.collector;
            ctx.font = 'bold 13px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('MAX', btnX + 55, btnY + 22);
        } else {
            const c = u.cost(u.level);
            ctx.fillStyle = afford ? '#6dd9ff' : 'rgba(255,255,255,0.1)';
            roundRect(btnX, btnY, 110, 44, 22);
            ctx.fill();
            ctx.strokeStyle = afford ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            roundRect(btnX, btnY, 110, 44, 22);
            ctx.stroke();
            ctx.fillStyle = afford ? '#0a1628' : 'rgba(255,255,255,0.3)';
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
    if (dt > 0.05) dt = 0.05; // cap

    if (state === 'play') {
        updateMarbles(dt);
        drawPlay(dt);
    } else if (state === 'shop') {
        drawShop();
    }

    requestAnimationFrame(loop);
}

// ---- Init ----
function init() {
    recomputeBoardAnchors();
    loadGame();
    // If the saved spawner/collector are stale (window resized since save), recompute
    window.addEventListener('resize', recomputeBoardAnchors);
    loop();
}

init();
