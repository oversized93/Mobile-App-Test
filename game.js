// ============================================================
//  GAME — State, input, main loop (built in chunks)
// ============================================================

// ---- State ----
let state = 'menu';
let roundStarted = false;
let isDrawingRiver = false;
let notification = null;

// ---- Collection burst effects ----
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
            vrot: (Math.random() - 0.5) * 5,
            red: Math.random() < 0.5
        });
    }
}

// ---- Floating payout text ----
const floatTexts = [];
function spawnFloatText(x, y, text) {
    floatTexts.push({ x, y, text, life: 1.4, maxLife: 1.4, vy: -34 });
}

function notify(text) { notification = { text, timer: 2.2 }; }

// ---- Layout constants ----
function moneyPillRect() {
    return { x: 14, y: 12, w: 130, h: 38 };
}
function shopBtnRect() {
    const w = 46, h = 38;
    return { x: W() - w - 14, y: 12, w, h };
}
function homeBtnRect() {
    const sb = shopBtnRect();
    const w = 38, h = 38;
    return { x: sb.x - w - 8, y: sb.y, w, h };
}
function rockPillRect() {
    const mp = moneyPillRect();
    return { x: mp.x + mp.w + 8, y: mp.y, w: 72, h: 38 };
}

// Pre-round buttons (Draw Again / Test Flow / Start Round)
function drawAgainBtnRect() {
    const h = 46;
    const w = Math.min((W() - 48) / 3, 130);
    return { x: 14, y: H() - 14 - h, w, h };
}
function testFlowBtnRect() {
    const db = drawAgainBtnRect();
    return { x: db.x + db.w + 10, y: db.y, w: db.w, h: db.h };
}
function startRoundBtnRect() {
    const tb = testFlowBtnRect();
    return { x: tb.x + tb.w + 10, y: tb.y, w: tb.w, h: tb.h };
}

// Menu buttons
function menuBeginBtnRect() {
    const w = Math.min(280, W() - 60), h = 58;
    return { x: (W() - w) / 2, y: H() / 2 + 40, w, h };
}
function menuResetBtnRect() {
    const w = 170, h = 38;
    return { x: (W() - w) / 2, y: H() - 60, w, h };
}

// Reset confirm modal
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

    // HUD buttons first
    const sb = shopBtnRect();
    if (hitBtn(sx, sy, sb.x, sb.y, sb.w, sb.h)) { state = 'shop'; return; }
    const hb = homeBtnRect();
    if (hitBtn(sx, sy, hb.x, hb.y, hb.w, hb.h)) { state = 'menu'; return; }

    // Pre-round buttons
    if (!roundStarted && river) {
        const da = drawAgainBtnRect();
        if (hitBtn(sx, sy, da.x, da.y, da.w, da.h)) {
            clearRiver();
            resetFlow();
            notify('Draw a new river');
            return;
        }
        const tb = testFlowBtnRect();
        if (hitBtn(sx, sy, tb.x, tb.y, tb.w, tb.h)) {
            startTestFlow();
            return;
        }
        const rb = startRoundBtnRect();
        if (hitBtn(sx, sy, rb.x, rb.y, rb.w, rb.h)) {
            roundStarted = true;
            resetFlow();
            notify('The river flows');
            saveGame();
            return;
        }
    }

    // Tap on the river with rock inventory → place a rock
    if (river && rockInventory > 0 && roundStarted) {
        if (placeRockAtPoint(sx, sy)) {
            notify('Rock placed');
            return;
        }
    }

    // Ignore touches over HUD bars
    if (sy < HUD_TOP_H + 2) return;
    const preRoundUI = !roundStarted && river;
    if (preRoundUI && sy > H() - HUD_BOTTOM_H) return;

    // Begin drawing the river — only when there's no committed river and the
    // touch starts inside the spring opening at the top of the source zone.
    if (!river) {
        const op = springOpeningRect();
        if (sx >= op.x - 10 && sx <= op.x + op.w + 10 &&
            sy >= op.y - 12 && sy <= op.y + op.h + 24) {
            startDraftRiver(sx, sy);
            isDrawingRiver = true;
        } else {
            notify('Start at the spring');
        }
    }
}

function onTouchMove(sx, sy) {
    if (state !== 'play') return;
    if (isDrawingRiver) extendDraftRiver(sx, sy);
}

function onTouchEnd(sx, sy, info) {
    if (state === 'menu') { handleMenuTouchEnd(sx, sy); return; }
    if (state === 'resetConfirm') { handleResetConfirmTouchEnd(sx, sy); return; }
    if (state === 'shop') { handleShopTouchEnd(sx, sy); return; }
    if (!isDrawingRiver) return;
    isDrawingRiver = false;
    if (!commitDraftRiver()) {
        cancelDraftRiver();
        notify('Reach the pond');
    } else {
        notify('River drawn — tap Test Flow or Start Round');
    }
}

function handleMenuTouchEnd(sx, sy) {
    const pb = menuBeginBtnRect();
    if (hitBtn(sx, sy, pb.x, pb.y, pb.w, pb.h)) { state = 'play'; return; }
    const rb = menuResetBtnRect();
    if (hitBtn(sx, sy, rb.x, rb.y, rb.w, rb.h)) { state = 'resetConfirm'; return; }
}

function handleResetConfirmTouchEnd(sx, sy) {
    const cancel = resetCancelBtnRect();
    if (hitBtn(sx, sy, cancel.x, cancel.y, cancel.w, cancel.h)) { state = 'menu'; return; }
    const confirm = resetConfirmBtnRect();
    if (hitBtn(sx, sy, confirm.x, confirm.y, confirm.w, confirm.h)) {
        resetAllProgress();
        state = 'menu';
        notify('The garden rests');
    }
}

function handleShopTouchEnd(sx, sy) {
    const sb = shopBtnRect();
    if (hitBtn(sx, sy, sb.x, sb.y, sb.w, sb.h)) { state = 'play'; return; }
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

function resetAllProgress() {
    money = 0;
    river = null;
    draftRiver = null;
    rocks.length = 0;
    rockInventory = 0;
    roundStarted = false;
    isDrawingRiver = false;
    collectBursts.length = 0;
    floatTexts.length = 0;
    notification = null;
    resetFlow();
    UPGRADES.fishValue.level = 0;
    UPGRADES.spawnRate.level = 0;
    UPGRADES.flowMult.level = 0;
    UPGRADES.rock.level = 0;
    UPGRADES.expandGarden.level = 0;
    try { localStorage.removeItem('zr_save'); } catch (e) {}
}

// ---- HUD helpers ----
function drawHud() {
    // Money pill
    const mp = moneyPillRect();
    drawParchmentPill(mp.x, mp.y, mp.w, mp.h, mp.h / 2);
    ctx.fillStyle = PALETTE.money;
    ctx.beginPath();
    ctx.arc(mp.x + 20, mp.y + mp.h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80, 50, 10, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(40, 24, 10, 0.85)';
    ctx.font = 'bold 11px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', mp.x + 20, mp.y + mp.h / 2 + 1);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 17px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('$' + money, mp.x + 36, mp.y + mp.h / 2 + 1);

    // Rock inventory pill (only while you have rocks)
    if (rockInventory > 0) {
        const rp = rockPillRect();
        drawParchmentPill(rp.x, rp.y, rp.w, rp.h, rp.h / 2);
        ctx.fillStyle = PALETTE.stoneDark;
        ctx.beginPath();
        ctx.ellipse(rp.x + 20, rp.y + rp.h / 2, 9, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.mossLight;
        ctx.beginPath();
        ctx.ellipse(rp.x + 19, rp.y + rp.h / 2 - 3, 6, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.text;
        ctx.font = 'bold 15px -apple-system,sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u00d7' + rockInventory, rp.x + 34, rp.y + rp.h / 2 + 1);
    }

    // Home button
    const hb = homeBtnRect();
    drawParchmentPill(hb.x, hb.y, hb.w, hb.h, 12);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 18px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2302', hb.x + hb.w / 2, hb.y + hb.h / 2 + 1);

    // Shop button
    const sb = shopBtnRect();
    drawParchmentPill(sb.x, sb.y, sb.w, sb.h, 12);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 20px -apple-system,sans-serif';
    ctx.fillText('\u2699', sb.x + sb.w / 2, sb.y + sb.h / 2 + 1);
}

function drawPreRoundButtons() {
    if (roundStarted || !river) return;
    const da = drawAgainBtnRect();
    const tb = testFlowBtnRect();
    const rb = startRoundBtnRect();

    // Draw Again — muted parchment
    drawParchmentPill(da.x, da.y, da.w, da.h, da.h / 2);
    ctx.fillStyle = PALETTE.text;
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Draw Again', da.x + da.w / 2, da.y + da.h / 2 + 1);

    // Test Flow — water blue gradient
    const g2 = ctx.createLinearGradient(tb.x, tb.y, tb.x + tb.w, tb.y);
    g2.addColorStop(0, '#5a8aa8');
    g2.addColorStop(1, '#7dbcdc');
    ctx.fillStyle = g2;
    roundRect(tb.x, tb.y, tb.w, tb.h, tb.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 40, 60, 0.7)';
    ctx.lineWidth = 2;
    roundRect(tb.x, tb.y, tb.w, tb.h, tb.h / 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.fillText('Test Flow', tb.x + tb.w / 2, tb.y + tb.h / 2 + 1);

    // Start Round — wooden tray gradient (primary action)
    const g3 = ctx.createLinearGradient(rb.x, rb.y, rb.x + rb.w, rb.y);
    g3.addColorStop(0, '#8c6a45');
    g3.addColorStop(0.5, '#a07a4f');
    g3.addColorStop(1, '#8c6a45');
    ctx.fillStyle = g3;
    roundRect(rb.x, rb.y, rb.w, rb.h, rb.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 36, 18, 0.75)';
    ctx.lineWidth = 2;
    roundRect(rb.x, rb.y, rb.w, rb.h, rb.h / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 240, 210, 0.96)';
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.fillText('Start Round', rb.x + rb.w / 2, rb.y + rb.h / 2 + 1);
}

function drawHintText() {
    if (river) return;
    ctx.fillStyle = 'rgba(245, 232, 198, 0.85)';
    ctx.font = 'bold 15px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Drag from the spring to the pond', W() / 2, H() / 2);
    ctx.fillStyle = 'rgba(245, 232, 198, 0.55)';
    ctx.font = '12px -apple-system,sans-serif';
    ctx.fillText('in one continuous motion', W() / 2, H() / 2 + 22);
}

function updateCollectBursts(dt) {
    for (let i = collectBursts.length - 1; i >= 0; i--) {
        const b = collectBursts[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vy += 100 * dt;
        b.rot += b.vrot * dt;
        b.life -= dt;
        if (b.life <= 0) collectBursts.splice(i, 1);
    }
}
function drawCollectBursts() {
    for (const b of collectBursts) {
        const a = Math.max(0, b.life / b.maxLife);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.red
            ? 'rgba(200, 68, 42, ' + a + ')'
            : 'rgba(224, 122, 44, ' + a + ')';
        ctx.beginPath();
        ctx.ellipse(0, 0, 4, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 220, 150, ' + (a * 0.8) + ')';
        ctx.beginPath();
        ctx.ellipse(-0.5, -0.5, 1.8, 1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
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
        ctx.font = 'bold 15px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(30, 18, 6, ' + (a * 0.5) + ')';
        ctx.fillText(t.text, t.x + 1, t.y + 1);
        ctx.fillStyle = 'rgba(200, 160, 79, ' + a + ')';
        ctx.fillText(t.text, t.x, t.y);
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
    const y = HUD_TOP_H + 12;
    ctx.fillStyle = 'rgba(30, 18, 6, ' + (0.78 * a) + ')';
    roundRect(x, y, tw, 30, 15);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245, 232, 198, ' + (a * 0.3) + ')';
    ctx.lineWidth = 1;
    roundRect(x, y, tw, 30, 15);
    ctx.stroke();
    ctx.fillStyle = 'rgba(245, 232, 198, ' + a + ')';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(notification.text, W() / 2, y + 15);
}

// ---- Play screen ----
function drawPlay(dt) {
    drawBackground();
    drawSourceSpring();
    drawOutletPond();
    drawRiver();
    drawRocks();
    drawAnimals();
    drawTestDroplet();
    drawHintText();
    drawPreRoundButtons();
    drawHud();
    updateCollectBursts(dt);
    drawCollectBursts();
    updateFloatTexts(dt);
    drawFloatTexts();
    drawNotification(dt);
}

// ---- Menu screen ----
function drawMenu() {
    drawBackground();
    drawSourceSpring();
    drawOutletPond();

    const cx = W() / 2;

    // Enso brush ring above the title
    ctx.save();
    ctx.translate(cx, H() / 2 - 120);
    ctx.strokeStyle = 'rgba(245, 232, 198, 0.55)';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, 44, -Math.PI * 0.4, Math.PI * 1.55);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 44, -Math.PI * 0.4, Math.PI * 1.55);
    ctx.stroke();
    ctx.restore();

    // Title with soft shadow
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 42px -apple-system,"SF Pro Display",serif';
    ctx.fillStyle = 'rgba(10, 20, 6, 0.65)';
    ctx.fillText('Zen River', cx + 2, H() / 2 - 48);
    ctx.fillStyle = 'rgba(245, 232, 198, 0.96)';
    ctx.fillText('Zen River', cx, H() / 2 - 50);

    // Subtitle
    ctx.fillStyle = 'rgba(245, 232, 198, 0.7)';
    ctx.font = '15px -apple-system,sans-serif';
    ctx.fillText('— a flowing garden —', cx, H() / 2 - 18);

    // Stats pill
    const hasRiver = !!river;
    const stateLabel = hasRiver ? (roundStarted ? 'round active' : 'river drawn') : 'no river';
    const stats = '$' + money + '   \u2022   ' + stateLabel;
    ctx.font = '13px -apple-system,sans-serif';
    const sw = ctx.measureText(stats).width + 40;
    drawParchmentPill((W() - sw) / 2, H() / 2 + 4, sw, 32, 16);
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(stats, cx, H() / 2 + 20);

    // Begin / Continue button — wooden tray
    const pb = menuBeginBtnRect();
    const g = ctx.createLinearGradient(pb.x, pb.y, pb.x + pb.w, pb.y);
    g.addColorStop(0, '#8c6a45');
    g.addColorStop(0.5, '#a07a4f');
    g.addColorStop(1, '#8c6a45');
    ctx.fillStyle = g;
    roundRect(pb.x, pb.y, pb.w, pb.h, pb.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 36, 18, 0.75)';
    ctx.lineWidth = 2;
    roundRect(pb.x, pb.y, pb.w, pb.h, pb.h / 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 240, 210, 0.25)';
    ctx.lineWidth = 1;
    roundRect(pb.x + 3, pb.y + 3, pb.w - 6, pb.h - 6, (pb.h - 6) / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 240, 210, 0.97)';
    ctx.font = 'bold 22px -apple-system,sans-serif';
    ctx.fillText(money > 0 || hasRiver ? 'Continue' : 'Begin', pb.x + pb.w / 2, pb.y + pb.h / 2 + 1);

    // Reset button — muted
    const rb = menuResetBtnRect();
    ctx.fillStyle = 'rgba(245, 232, 198, 0.18)';
    roundRect(rb.x, rb.y, rb.w, rb.h, rb.h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245, 232, 198, 0.4)';
    ctx.lineWidth = 1;
    roundRect(rb.x, rb.y, rb.w, rb.h, rb.h / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(245, 232, 198, 0.82)';
    ctx.font = '13px -apple-system,sans-serif';
    ctx.fillText('Reset Progress', rb.x + rb.w / 2, rb.y + rb.h / 2 + 1);
}

// ---- Stubbed (chunk 3) ----
function drawResetConfirm() {
    drawMenu();
    ctx.fillStyle = 'rgba(30, 18, 6, 0.55)';
    ctx.fillRect(0, 0, W(), H());
    ctx.fillStyle = 'rgba(245, 232, 198, 0.95)';
    ctx.font = 'bold 18px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Reset? Tap to cancel — chunk 3 adds the real modal', W() / 2, H() / 2);
}
function drawShop() {
    drawBackground();
    ctx.fillStyle = 'rgba(30, 18, 6, 0.55)';
    ctx.fillRect(0, 0, W(), H());
    ctx.fillStyle = 'rgba(245, 232, 198, 0.95)';
    ctx.font = 'bold 18px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Shop — chunk 3 adds the real cards', W() / 2, H() / 2);
    // Let the user back out of the shop by tapping the gear
    drawHud();
}

// ---- Main loop ----
let lastT = performance.now();
function loop() {
    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;

    if (state === 'play') {
        tickSpawn(dt);
        updateFlow(dt);
        drawPlay(dt);
    } else if (state === 'menu') {
        drawMenu();
    } else if (state === 'shop') {
        drawShop();
    } else if (state === 'resetConfirm') {
        drawResetConfirm();
    }

    requestAnimationFrame(loop);
}

function init() {
    loadGame();
    loop();
}

init();
