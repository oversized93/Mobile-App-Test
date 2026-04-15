// ============================================================
//  GAME — State, input, main loop (built in chunks)
// ============================================================

// ---- State ----
// Starts at 'play' during chunk 1 so the scene is testable without a menu.
// Chunk 2 adds the main menu and flips the initial state back to 'menu'.
let state = 'play';
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

// ---- Stubbed screens (chunk 2 replaces drawPlay, drawMenu;
//      chunk 3 replaces drawShop and drawResetConfirm) ----
function drawPlay(dt) {
    drawBackground();
    drawSourceSpring();
    drawOutletPond();
    drawRiver();
    drawRocks();
    drawAnimals();
    drawTestDroplet();
}
function drawMenu() {
    drawBackground();
}
function drawResetConfirm() {
    drawMenu();
    ctx.fillStyle = 'rgba(30, 18, 6, 0.55)';
    ctx.fillRect(0, 0, W(), H());
}
function drawShop() {
    drawBackground();
    ctx.fillStyle = 'rgba(30, 18, 6, 0.55)';
    ctx.fillRect(0, 0, W(), H());
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
