// ============================================================
//  GAME.JS — Main game loop, all screens, golf physics
// ============================================================

// ---- Game State ----
let state = 'menu';
let player = loadData('player', { name: 'Golfer', ballColor: '#fff', unlocked: [0] });
let currentCourse = null;
let currentHoleIdx = 0;
let currentHole = null;
let ball = { x: 0, y: 0, vx: 0, vy: 0, moving: false };
let strokes = 0;
let holeStrokes = [];
let aiming = false;
let aimStartX = 0, aimStartY = 0;
let shotTrail = [];
let holeComplete = false;
let roundComplete = false;
let lastFrameTime = null;
let notification = { text: '', timer: 0 };
let menuScroll = 0;
let inBuilder = false;
let customCoursePlay = false;

// Score names
const SCORE_NAMES = {
    '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!',
    '0': 'Par', '1': 'Bogey', '2': 'Double Bogey', '3': 'Triple Bogey'
};

function notify(text) { notification = { text, timer: 2.5 }; }

// ---- Start a hole ----
function startHole(hole) {
    currentHole = hole;
    ball.x = (hole.tee.x + 0.5) * CELL;
    ball.y = (hole.tee.y + 0.5) * CELL;
    ball.vx = 0; ball.vy = 0; ball.moving = false;
    strokes = 0;
    aiming = false;
    holeComplete = false;
    shotTrail = [];
    cam.targetZoom = calcZoom();
    cam.zoom = cam.targetZoom;
    centerCamOnBall();
    cam.x = cam.targetX; cam.y = cam.targetY;
}

function calcZoom() {
    if (!currentHole) return 1;
    const holeW = currentHole.cols * CELL;
    const holeH = currentHole.rows * CELL;
    const zx = (W() - 20) / holeW;
    const zy = (H() - 100) / holeH;
    return Math.min(zx, zy, 3);
}

function centerCamOnBall() {
    cam.targetX = ball.x;
    cam.targetY = ball.y;
}

function centerCamOnHole() {
    if (!currentHole) return;
    cam.targetX = (currentHole.cols * CELL) / 2;
    cam.targetY = (currentHole.rows * CELL) / 2;
    cam.targetZoom = calcZoom();
}

// ---- Terrain at world position ----
function terrainAt(wx, wy) {
    if (!currentHole) return T.OOB;
    const gc = Math.floor(wx / CELL);
    const gr = Math.floor(wy / CELL);
    if (gc < 0 || gc >= currentHole.cols || gr < 0 || gr >= currentHole.rows) return T.OOB;
    return currentHole.grid[gr][gc];
}

// ---- Ball physics update ----
function updateBall(dt) {
    if (!ball.moving) return;
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (speed < 2) {
        ball.vx = 0; ball.vy = 0; ball.moving = false;
        onBallStopped();
        return;
    }

    // Record trail
    if (shotTrail.length === 0 || Math.abs(ball.x - shotTrail[shotTrail.length-1].x) > 3 ||
        Math.abs(ball.y - shotTrail[shotTrail.length-1].y) > 3) {
        shotTrail.push({ x: ball.x, y: ball.y });
        if (shotTrail.length > 200) shotTrail.shift();
    }

    // Move
    const steps = Math.max(1, Math.ceil(speed * dt / 2));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
        ball.x += ball.vx * stepDt;
        ball.y += ball.vy * stepDt;

        // Check terrain
        const ter = terrainAt(ball.x, ball.y);
        const fric = TERRAIN_FRICTION[ter];

        if (ter === T.WATER) {
            ball.vx = 0; ball.vy = 0; ball.moving = false;
            notify('Water! +1 stroke');
            strokes++;
            resetBallToLastSafe();
            return;
        }
        if (ter === T.OOB) {
            ball.vx = 0; ball.vy = 0; ball.moving = false;
            notify('Out of bounds! +1 stroke');
            strokes++;
            resetBallToLastSafe();
            return;
        }
        if (ter === T.TREE) {
            // Bounce back
            ball.vx *= -0.4;
            ball.vy *= -0.4;
            ball.x += ball.vx * stepDt * 3;
            ball.y += ball.vy * stepDt * 3;
            notify('Hit a tree!');
        }

        // Apply friction
        ball.vx *= Math.pow(fric, stepDt * 60);
        ball.vy *= Math.pow(fric, stepDt * 60);

        // Check if ball is in the hole
        const hx = (currentHole.hole.x + 0.5) * CELL;
        const hy = (currentHole.hole.y + 0.5) * CELL;
        const dx = ball.x - hx, dy = ball.y - hy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 6 && speed < 200) {
            ball.x = hx; ball.y = hy;
            ball.vx = 0; ball.vy = 0; ball.moving = false;
            onHoleComplete();
            return;
        }
    }

    centerCamOnBall();
}

let lastSafePos = { x: 0, y: 0 };

function resetBallToLastSafe() {
    ball.x = lastSafePos.x;
    ball.y = lastSafePos.y;
    ball.moving = false;
    centerCamOnBall();
}

function onBallStopped() {
    const ter = terrainAt(ball.x, ball.y);
    if (ter !== T.WATER && ter !== T.OOB) {
        lastSafePos = { x: ball.x, y: ball.y };
    }
    shotTrail = [];
    centerCamOnBall();
    // Zoom in a bit more when on green
    if (ter === T.GREEN) {
        cam.targetZoom = Math.min(calcZoom() * 1.8, 5);
    } else {
        cam.targetZoom = calcZoom();
    }
}

function onHoleComplete() {
    holeComplete = true;
    const diff = strokes - currentHole.par;
    const name = SCORE_NAMES[String(diff)] || (diff > 0 ? '+' + diff : '' + diff);
    if (strokes === 1) notify('HOLE IN ONE!!!');
    else notify(name);
    holeStrokes.push(strokes);
}

// ---- Shot mechanic (Golf Clash style) ----
function takeShot(power, dirX, dirY) {
    const maxPower = 500;
    const p = Math.min(power, maxPower);
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len === 0) return;
    ball.vx = (dirX / len) * p;
    ball.vy = (dirY / len) * p;
    ball.moving = true;
    strokes++;
    lastSafePos = { x: ball.x, y: ball.y };
    shotTrail = [];
    aiming = false;
}

// ---- Touch Handlers (Golf Clash aiming) ----
let aimDirX = 0, aimDirY = 0, aimPower = 0;
let dragStartWorldX = 0, dragStartWorldY = 0;
let builderTouchAction = null;
let charColors = ['#fff','#f44','#ff9800','#ffeb3b','#4caf50','#2196f3','#9c27b0','#e91e63','#00bcd4','#000'];
let charColorIdx = 0;

function onTouchStart(sx, sy) {
    if (state === 'menu') { menuTouchStart(sx, sy); return; }
    if (state === 'character') { charTouchStart(sx, sy); return; }
    if (state === 'career') { careerTouchStart(sx, sy); return; }
    if (state === 'builder') {
        builderTouchAction = builderHandleTouch(sx, sy);
        if (builderTouchAction === 'back') { state = 'menu'; return; }
        if (builderTouchAction === 'save') { const n = builderSave(); notify('Saved! (' + n + ' holes)'); return; }
        if (builderTouchAction === 'play') {
            const h = builderGetHole(3);
            if (!h.tee || !h.hole) { notify('Place tee & hole first!'); return; }
            currentCourse = { name: 'Custom', holes: [h] };
            currentHoleIdx = 0; holeStrokes = [];
            startHole(h); customCoursePlay = true; state = 'playing'; return;
        }
        if (!builderTouchAction) { builderState.painting = true; builderPaint(sx, sy); }
        return;
    }
    if (state === 'holeDone') { holeDoneTouchStart(sx, sy); return; }
    if (state === 'roundDone') { roundDoneTouchStart(sx, sy); return; }
    if (state === 'playing') {
        if (ball.moving || holeComplete) return;
        // Check if touching near the ball (screen coords)
        const bs = worldToScreen(ball.x, ball.y);
        const dx = sx - bs.x, dy = sy - bs.y;
        if (dx * dx + dy * dy < 80 * 80) {
            aiming = true;
            aimStartX = sx; aimStartY = sy;
            dragStartWorldX = ball.x; dragStartWorldY = ball.y;
        }
    }
}

function onTouchMove(sx, sy) {
    if (state === 'builder' && builderState.painting) { builderPaint(sx, sy); return; }
    if (state === 'playing' && aiming) {
        const dx = sx - aimStartX;
        const dy = sy - aimStartY;
        const dragDist = Math.sqrt(dx * dx + dy * dy);
        // Direction is OPPOSITE of drag (drag back to shoot forward)
        aimDirX = -dx;
        aimDirY = -dy;
        aimPower = Math.min(dragDist * 3.5, 500);
    }
}

function onTouchEnd(sx, sy) {
    if (state === 'builder') { builderState.painting = false; return; }
    if (state === 'playing' && aiming) {
        if (aimPower > 15) {
            takeShot(aimPower, aimDirX, aimDirY);
        }
        aiming = false;
        aimPower = 0;
    }
}

// ---- Menu Screen ----
function drawMenu() {
    ctx.fillStyle = '#1a472a';
    ctx.fillRect(0, 0, W(), H());

    // Decorative background
    ctx.fillStyle = '#1e5230';
    for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(W() * (0.15 + i * 0.18), H() * 0.15, 30 + i * 5, 0, Math.PI * 2);
        ctx.fill();
    }

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 38px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GOLF TYCOON', W() / 2, H() * 0.18);

    ctx.fillStyle = '#8fbc8f';
    ctx.font = '15px -apple-system,sans-serif';
    ctx.fillText('Build courses. Play career. Be a legend.', W() / 2, H() * 0.18 + 30);

    // Golf ball icon
    drawBall(W() / 2, H() * 0.32, 20, player.ballColor);

    // Player name
    ctx.fillStyle = '#cde6cd';
    ctx.font = '16px -apple-system,sans-serif';
    ctx.fillText(player.name, W() / 2, H() * 0.32 + 36);

    // Buttons
    const bw = Math.min(W() - 60, 280);
    const bx = (W() - bw) / 2;
    const bh = 52;
    const gap = 14;
    let by = H() * 0.44;

    drawBtn(bx, by, bw, bh, 'Play Career', '#2e7d32'); by += bh + gap;
    drawBtn(bx, by, bw, bh, 'Course Builder', '#1565c0'); by += bh + gap;
    drawBtn(bx, by, bw, bh, 'Custom Courses', '#6a1b9a'); by += bh + gap;
    drawBtn(bx, by, bw, bh, 'Character', '#e65100');

    // Version
    ctx.fillStyle = '#4a6a4a';
    ctx.font = '11px -apple-system,sans-serif';
    ctx.fillText('v0.1 \u2022 WIP', W() / 2, H() - 20);
}

function menuTouchStart(sx, sy) {
    const bw = Math.min(W() - 60, 280);
    const bx = (W() - bw) / 2;
    const bh = 52, gap = 14;
    let by = H() * 0.44;

    if (hitBtn(sx, sy, bx, by, bw, bh)) { state = 'career'; return; } by += bh + gap;
    if (hitBtn(sx, sy, bx, by, bw, bh)) { builderInit(); state = 'builder'; return; } by += bh + gap;
    if (hitBtn(sx, sy, bx, by, bw, bh)) { playCustomCourses(); return; } by += bh + gap;
    if (hitBtn(sx, sy, bx, by, bw, bh)) { charColorIdx = charColors.indexOf(player.ballColor); if (charColorIdx < 0) charColorIdx = 0; state = 'character'; return; }
}

function playCustomCourses() {
    const saved = loadData('customHoles', []);
    if (saved.length === 0) { notify('No custom courses yet! Build one first.'); return; }
    currentCourse = { name: 'Custom Course', holes: saved };
    currentHoleIdx = 0; holeStrokes = [];
    startHole(saved[0]);
    customCoursePlay = true;
    state = 'playing';
}

// ---- Character Creator ----
function drawCharacter() {
    ctx.fillStyle = '#1a472a';
    ctx.fillRect(0, 0, W(), H());

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Your Golfer', W() / 2, H() * 0.12);

    // Ball preview
    drawBall(W() / 2, H() * 0.28, 30, charColors[charColorIdx]);

    ctx.fillStyle = '#cde6cd';
    ctx.font = '16px -apple-system,sans-serif';
    ctx.fillText(player.name, W() / 2, H() * 0.28 + 50);

    // Color picker
    ctx.fillStyle = '#8fbc8f';
    ctx.font = '14px -apple-system,sans-serif';
    ctx.fillText('Ball Color', W() / 2, H() * 0.44);

    const swatchSize = 36, gap = 8;
    const totalW = charColors.length * (swatchSize + gap) - gap;
    const startX = (W() - totalW) / 2;
    const swatchY = H() * 0.48;

    for (let i = 0; i < charColors.length; i++) {
        const sx = startX + i * (swatchSize + gap);
        ctx.fillStyle = charColors[i];
        roundRect(sx, swatchY, swatchSize, swatchSize, 8);
        ctx.fill();
        if (i === charColorIdx) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            roundRect(sx, swatchY, swatchSize, swatchSize, 8);
            ctx.stroke();
        }
    }

    // Name options
    const names = ['Golfer', 'Tiger', 'Ace', 'Birdie', 'Eagle', 'Chip', 'Putter', 'Pro'];
    ctx.fillStyle = '#8fbc8f';
    ctx.font = '14px -apple-system,sans-serif';
    ctx.fillText('Name', W() / 2, H() * 0.60);

    const nameW = 80, nameH = 36, nameGap = 8;
    const namesPerRow = Math.floor((W() - 40) / (nameW + nameGap));
    const nameStartX = (W() - namesPerRow * (nameW + nameGap) + nameGap) / 2;
    const nameY = H() * 0.64;

    for (let i = 0; i < names.length; i++) {
        const row = Math.floor(i / namesPerRow);
        const col = i % namesPerRow;
        const nx = nameStartX + col * (nameW + nameGap);
        const ny = nameY + row * (nameH + nameGap);
        const selected = player.name === names[i];
        drawBtn(nx, ny, nameW, nameH, names[i], selected ? '#2e7d32' : '#555');
    }

    // Save + Back
    const bw = Math.min(W() - 60, 280);
    const bx = (W() - bw) / 2;
    drawBtn(bx, H() * 0.84, bw, 48, 'Save & Back', '#2e7d32');
}

function charTouchStart(sx, sy) {
    // Color swatches
    const swatchSize = 36, gap = 8;
    const totalW = charColors.length * (swatchSize + gap) - gap;
    const startX = (W() - totalW) / 2;
    const swatchY = H() * 0.48;
    for (let i = 0; i < charColors.length; i++) {
        const cx = startX + i * (swatchSize + gap);
        if (hitBtn(sx, sy, cx, swatchY, swatchSize, swatchSize)) {
            charColorIdx = i;
            player.ballColor = charColors[i];
            return;
        }
    }

    // Name buttons
    const names = ['Golfer', 'Tiger', 'Ace', 'Birdie', 'Eagle', 'Chip', 'Putter', 'Pro'];
    const nameW = 80, nameH = 36, nameGap = 8;
    const namesPerRow = Math.floor((W() - 40) / (nameW + nameGap));
    const nameStartX = (W() - namesPerRow * (nameW + nameGap) + nameGap) / 2;
    const nameY = H() * 0.64;
    for (let i = 0; i < names.length; i++) {
        const row = Math.floor(i / namesPerRow);
        const col = i % namesPerRow;
        const nx = nameStartX + col * (nameW + nameGap);
        const ny = nameY + row * (nameH + nameGap);
        if (hitBtn(sx, sy, nx, ny, nameW, nameH)) { player.name = names[i]; return; }
    }

    // Save button
    const bw = Math.min(W() - 60, 280);
    const bx = (W() - bw) / 2;
    if (hitBtn(sx, sy, bx, H() * 0.84, bw, 48)) {
        saveData('player', player);
        notify('Saved!');
        state = 'menu';
    }
}

// ---- Career Select ----
function drawCareer() {
    ctx.fillStyle = '#1a472a';
    ctx.fillRect(0, 0, W(), H());

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Career Mode', W() / 2, 50);

    const cardW = Math.min(W() - 40, 300);
    const cardH = 100;
    const gap = 16;
    const startX = (W() - cardW) / 2;
    let cy = 80;

    for (let i = 0; i < CAREER_COURSES.length; i++) {
        const course = CAREER_COURSES[i];
        const unlocked = player.unlocked.includes(i);

        ctx.fillStyle = unlocked ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)';
        roundRect(startX, cy, cardW, cardH, 14);
        ctx.fill();

        if (unlocked) {
            ctx.strokeStyle = course.color;
            ctx.lineWidth = 2;
            roundRect(startX, cy, cardW, cardH, 14);
            ctx.stroke();
        }

        // Icon
        ctx.font = '32px -apple-system,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(course.icon, startX + 14, cy + 48);

        // Name + desc
        ctx.fillStyle = unlocked ? '#fff' : '#666';
        ctx.font = 'bold 18px -apple-system,sans-serif';
        ctx.fillText(course.name, startX + 58, cy + 32);

        ctx.fillStyle = unlocked ? '#aaa' : '#555';
        ctx.font = '13px -apple-system,sans-serif';
        ctx.fillText(course.desc, startX + 58, cy + 52);

        // Holes + par info
        const totalPar = course.holes.reduce((s, h) => s + h.par, 0);
        ctx.fillText(course.holes.length + ' holes \u2022 Par ' + totalPar, startX + 58, cy + 72);

        // Best score
        const best = loadData('best_' + i, null);
        if (best !== null && unlocked) {
            ctx.textAlign = 'right';
            ctx.fillStyle = '#ffeb3b';
            ctx.font = 'bold 14px -apple-system,sans-serif';
            ctx.fillText('Best: ' + best, startX + cardW - 14, cy + 72);
        }

        if (!unlocked) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            roundRect(startX, cy, cardW, cardH, 14);
            ctx.fill();
            ctx.fillStyle = '#888';
            ctx.font = '24px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('\u{1F512}', startX + cardW / 2, cy + cardH / 2 + 8);
        }

        cy += cardH + gap;
    }

    // Back button
    const bw = Math.min(W() - 60, 280);
    drawBtn((W() - bw) / 2, cy + 10, bw, 48, 'Back', '#555');
}

function careerTouchStart(sx, sy) {
    const cardW = Math.min(W() - 40, 300);
    const cardH = 100;
    const gap = 16;
    const startX = (W() - cardW) / 2;
    let cy = 80;

    for (let i = 0; i < CAREER_COURSES.length; i++) {
        if (hitBtn(sx, sy, startX, cy, cardW, cardH) && player.unlocked.includes(i)) {
            currentCourse = CAREER_COURSES[i];
            currentHoleIdx = 0;
            holeStrokes = [];
            customCoursePlay = false;
            startHole(currentCourse.holes[0]);
            state = 'playing';
            return;
        }
        cy += cardH + gap;
    }

    // Back
    const bw = Math.min(W() - 60, 280);
    if (hitBtn(sx, sy, (W() - bw) / 2, cy + 10, bw, 48)) state = 'menu';
}

// ---- Gameplay Drawing ----
function drawPlaying() {
    ctx.fillStyle = '#1a472a';
    ctx.fillRect(0, 0, W(), H());

    if (!currentHole) return;

    camTransform();

    // Draw terrain
    const hole = currentHole;
    for (let r = 0; r < hole.rows; r++) {
        for (let c = 0; c < hole.cols; c++) {
            const t = hole.grid[r][c];
            ctx.fillStyle = TERRAIN_COLORS[t] || '#1a3d1a';
            ctx.fillRect(c * CELL, r * CELL, CELL + 0.5, CELL + 0.5);
        }
    }

    // Water animation
    for (let r = 0; r < hole.rows; r++) {
        for (let c = 0; c < hole.cols; c++) {
            if (hole.grid[r][c] === T.WATER) {
                const shimmer = Math.sin(Date.now() / 400 + c * 0.5 + r * 0.3) * 0.08;
                ctx.fillStyle = `rgba(255,255,255,${0.05 + shimmer})`;
                ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
            }
        }
    }

    // Tree details
    for (let r = 0; r < hole.rows; r++) {
        for (let c = 0; c < hole.cols; c++) {
            if (hole.grid[r][c] === T.TREE) {
                ctx.fillStyle = '#145222';
                ctx.beginPath();
                ctx.arc((c + 0.5) * CELL, (r + 0.5) * CELL, CELL * 0.45, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Draw hole/cup
    const hx = (hole.hole.x + 0.5) * CELL;
    const hy = (hole.hole.y + 0.5) * CELL;
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.fill();
    drawFlag(hx + 1, hy, 0.6);

    // Shot trail
    if (shotTrail.length > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(shotTrail[0].x, shotTrail[0].y);
        for (let i = 1; i < shotTrail.length; i++) ctx.lineTo(shotTrail[i].x, shotTrail[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Aim line
    if (aiming && aimPower > 10) {
        const len = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);
        if (len > 0) {
            const nx = aimDirX / len, ny = aimDirY / len;
            const lineLen = aimPower * 0.4;

            // Dotted aim line
            ctx.strokeStyle = 'rgba(255,255,100,0.7)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            ctx.moveTo(ball.x, ball.y);
            ctx.lineTo(ball.x + nx * lineLen, ball.y + ny * lineLen);
            ctx.stroke();
            ctx.setLineDash([]);

            // Arrow head
            const ax = ball.x + nx * lineLen, ay = ball.y + ny * lineLen;
            ctx.fillStyle = 'rgba(255,255,100,0.8)';
            ctx.beginPath();
            ctx.moveTo(ax + nx * 6, ay + ny * 6);
            ctx.lineTo(ax - ny * 4, ay + nx * 4);
            ctx.lineTo(ax + ny * 4, ay - nx * 4);
            ctx.fill();
        }
    }

    // Draw ball
    drawBall(ball.x, ball.y, 4, player.ballColor);

    camRestore();

    // ---- HUD overlay ----
    // Top bar
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, W(), 55);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(currentHole.name || ('Hole ' + (currentHoleIdx + 1)), 12, 22);

    ctx.fillStyle = '#aaa';
    ctx.font = '13px -apple-system,sans-serif';
    ctx.fillText('Par ' + currentHole.par, 12, 42);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px -apple-system,sans-serif';
    ctx.fillText('Stroke ' + strokes, W() / 2, 34);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ccc';
    ctx.font = '13px -apple-system,sans-serif';
    ctx.fillText('Hole ' + (currentHoleIdx + 1) + '/' + currentCourse.holes.length, W() - 12, 22);

    // Terrain indicator
    const ter = terrainAt(ball.x, ball.y);
    ctx.fillText(TERRAIN_NAMES[ter] || '', W() - 12, 42);

    // Power meter (when aiming)
    if (aiming && aimPower > 10) {
        const meterW = W() - 40;
        const meterH = 12;
        const mx = 20, my = H() - 80;
        const pct = Math.min(aimPower / 500, 1);

        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        roundRect(mx - 4, my - 4, meterW + 8, meterH + 8, 8);
        ctx.fill();

        ctx.fillStyle = '#333';
        roundRect(mx, my, meterW, meterH, 6);
        ctx.fill();

        // Gradient power bar
        const grad = ctx.createLinearGradient(mx, 0, mx + meterW * pct, 0);
        grad.addColorStop(0, '#4caf50');
        grad.addColorStop(0.5, '#ffeb3b');
        grad.addColorStop(1, '#f44336');
        ctx.fillStyle = grad;
        roundRect(mx, my, meterW * pct, meterH, 6);
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(pct * 100) + '%', W() / 2, my - 8);
    }

    // Hint text when not moving
    if (!ball.moving && !aiming && !holeComplete) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '14px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Drag from ball to aim', W() / 2, H() - 30);
    }

    // Back button (small)
    drawBtn(W() - 58, 62, 50, 30, 'Quit', 'rgba(255,255,255,0.15)', '#aaa');
}

// ---- Hole Complete Screen ----
function drawHoleDone() {
    drawPlaying(); // Keep course visible behind

    // Overlay
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W(), H());

    const diff = strokes - currentHole.par;
    const scoreName = strokes === 1 ? 'HOLE IN ONE!!!' :
        (SCORE_NAMES[String(diff)] || (diff > 0 ? '+' + diff : '' + diff));

    // Score card
    const cardW = Math.min(W() - 40, 280);
    const cardH = 240;
    const cx = (W() - cardW) / 2;
    const cy = (H() - cardH) / 2 - 20;

    ctx.fillStyle = 'rgba(30,60,30,0.95)';
    roundRect(cx, cy, cardW, cardH, 20);
    ctx.fill();
    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 2;
    roundRect(cx, cy, cardW, cardH, 20);
    ctx.stroke();

    ctx.textAlign = 'center';

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px -apple-system,sans-serif';
    ctx.fillText(currentHole.name || 'Hole ' + (currentHoleIdx + 1), W() / 2, cy + 40);

    // Score name (colored)
    const scoreColor = diff < 0 ? '#4caf50' : diff === 0 ? '#fff' : '#f44336';
    ctx.fillStyle = scoreColor;
    ctx.font = 'bold 28px -apple-system,sans-serif';
    ctx.fillText(scoreName, W() / 2, cy + 85);

    ctx.fillStyle = '#ccc';
    ctx.font = '16px -apple-system,sans-serif';
    ctx.fillText(strokes + ' stroke' + (strokes !== 1 ? 's' : '') + '  (Par ' + currentHole.par + ')', W() / 2, cy + 118);

    // Scorecard so far
    ctx.fillStyle = '#888';
    ctx.font = '13px -apple-system,sans-serif';
    let totalStrokes = holeStrokes.reduce((a, b) => a + b, 0);
    let totalPar = 0;
    for (let i = 0; i < holeStrokes.length; i++) totalPar += currentCourse.holes[i].par;
    ctx.fillText('Round total: ' + totalStrokes + ' (' + (totalStrokes - totalPar >= 0 ? '+' : '') + (totalStrokes - totalPar) + ')', W() / 2, cy + 150);

    // Next button
    const isLast = currentHoleIdx >= currentCourse.holes.length - 1;
    const btnLabel = isLast ? 'Finish Round' : 'Next Hole';
    drawBtn(cx + 20, cy + cardH - 60, cardW - 40, 44, btnLabel, '#2e7d32');
}

function holeDoneTouchStart(sx, sy) {
    const cardW = Math.min(W() - 40, 280);
    const cardH = 240;
    const cx = (W() - cardW) / 2;
    const cy = (H() - cardH) / 2 - 20;

    // Next/Finish button
    if (hitBtn(sx, sy, cx + 20, cy + cardH - 60, cardW - 40, 44)) {
        const isLast = currentHoleIdx >= currentCourse.holes.length - 1;
        if (isLast) {
            state = 'roundDone';
        } else {
            currentHoleIdx++;
            startHole(currentCourse.holes[currentHoleIdx]);
            state = 'playing';
        }
    }
}

// ---- Round Complete Screen ----
function drawRoundDone() {
    ctx.fillStyle = '#1a472a';
    ctx.fillRect(0, 0, W(), H());

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Round Complete!', W() / 2, 50);

    ctx.fillStyle = '#8fbc8f';
    ctx.font = '16px -apple-system,sans-serif';
    ctx.fillText(currentCourse.name, W() / 2, 78);

    // Scorecard
    const cardW = Math.min(W() - 30, 320);
    const cx = (W() - cardW) / 2;
    let cy = 100;
    const rowH = 34;

    // Header
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(cx, cy, cardW, rowH);
    ctx.fillStyle = '#aaa';
    ctx.font = 'bold 13px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Hole', cx + 10, cy + 22);
    ctx.textAlign = 'center';
    ctx.fillText('Par', cx + cardW * 0.5, cy + 22);
    ctx.fillText('Score', cx + cardW * 0.7, cy + 22);
    ctx.fillText('+/-', cx + cardW * 0.9, cy + 22);
    cy += rowH;

    let totalStrokes = 0, totalPar = 0;

    for (let i = 0; i < holeStrokes.length; i++) {
        const par = currentCourse.holes[i].par;
        const sc = holeStrokes[i];
        const diff = sc - par;
        totalStrokes += sc;
        totalPar += par;

        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.15)';
        ctx.fillRect(cx, cy, cardW, rowH);

        ctx.fillStyle = '#ccc';
        ctx.font = '14px -apple-system,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(currentCourse.holes[i].name || ('Hole ' + (i + 1)), cx + 10, cy + 22);
        ctx.textAlign = 'center';
        ctx.fillText(String(par), cx + cardW * 0.5, cy + 22);
        ctx.fillText(String(sc), cx + cardW * 0.7, cy + 22);

        ctx.fillStyle = diff < 0 ? '#4caf50' : diff === 0 ? '#fff' : '#f44336';
        ctx.fillText(diff === 0 ? 'E' : (diff > 0 ? '+' + diff : String(diff)), cx + cardW * 0.9, cy + 22);

        cy += rowH;
    }

    // Total row
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(cx, cy, cardW, rowH + 4);
    const totalDiff = totalStrokes - totalPar;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL', cx + 10, cy + 24);
    ctx.textAlign = 'center';
    ctx.fillText(String(totalPar), cx + cardW * 0.5, cy + 24);
    ctx.fillText(String(totalStrokes), cx + cardW * 0.7, cy + 24);
    ctx.fillStyle = totalDiff < 0 ? '#4caf50' : totalDiff === 0 ? '#ffeb3b' : '#f44336';
    ctx.fillText(totalDiff === 0 ? 'E' : (totalDiff > 0 ? '+' + totalDiff : String(totalDiff)), cx + cardW * 0.9, cy + 24);

    cy += rowH + 20;

    // Check/save best score + unlock next course
    if (!customCoursePlay) {
        const courseIdx = CAREER_COURSES.indexOf(currentCourse);
        if (courseIdx >= 0) {
            const best = loadData('best_' + courseIdx, null);
            if (best === null || totalStrokes < best) {
                saveData('best_' + courseIdx, totalStrokes);
                ctx.fillStyle = '#ffeb3b';
                ctx.font = 'bold 16px -apple-system,sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('New Best Score!', W() / 2, cy);
                cy += 24;
            }
            // Unlock next course
            if (courseIdx + 1 < CAREER_COURSES.length && !player.unlocked.includes(courseIdx + 1)) {
                player.unlocked.push(courseIdx + 1);
                saveData('player', player);
                ctx.fillStyle = '#4caf50';
                ctx.font = 'bold 14px -apple-system,sans-serif';
                ctx.fillText('Unlocked: ' + CAREER_COURSES[courseIdx + 1].name + '!', W() / 2, cy);
                cy += 24;
            }
        }
    }

    // Buttons
    const bw = Math.min(W() - 60, 260);
    const bx = (W() - bw) / 2;
    cy += 10;
    drawBtn(bx, cy, bw, 46, 'Play Again', '#2e7d32');
    drawBtn(bx, cy + 58, bw, 46, 'Main Menu', '#555');
}

function roundDoneTouchStart(sx, sy) {
    const bw = Math.min(W() - 60, 260);
    const bx = (W() - bw) / 2;
    // Estimate button Y positions (approximate from drawRoundDone)
    const baseY = 100 + 34 * (holeStrokes.length + 2) + 50;

    if (hitBtn(sx, sy, bx, baseY, bw, 46)) {
        // Play again
        currentHoleIdx = 0; holeStrokes = [];
        startHole(currentCourse.holes[0]);
        state = 'playing';
        return;
    }
    if (hitBtn(sx, sy, bx, baseY + 58, bw, 46)) {
        state = 'menu';
    }
}

// ---- Quit button in gameplay ----
function checkQuitBtn(sx, sy) {
    if (hitBtn(sx, sy, W() - 58, 62, 50, 30)) {
        if (customCoursePlay) { state = 'builder'; }
        else { state = 'menu'; }
        return true;
    }
    return false;
}

// ---- Notification Drawing ----
function drawNotification(dt) {
    if (notification.timer <= 0) return;
    notification.timer -= dt;
    const alpha = Math.min(1, notification.timer / 0.5);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    const tw = ctx.measureText(notification.text).width;
    roundRect(W() / 2 - tw / 2 - 16, H() * 0.4 - 18, tw + 32, 40, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(notification.text, W() / 2, H() * 0.4 + 8);
    ctx.globalAlpha = 1;
}

// ---- Main Game Loop ----
function gameLoop(time) {
    requestAnimationFrame(gameLoop);

    if (!lastFrameTime) lastFrameTime = time;
    let dt = (time - lastFrameTime) / 1000;
    lastFrameTime = time;
    if (dt > 0.1) dt = 0.1;

    // Update
    if (state === 'playing') {
        updateBall(dt);
        camLerp(dt);
        if (holeComplete && !ball.moving) {
            state = 'holeDone';
        }
    }

    // Draw based on state
    switch (state) {
        case 'menu': drawMenu(); break;
        case 'character': drawCharacter(); break;
        case 'career': drawCareer(); break;
        case 'builder': builderDraw(); break;
        case 'playing': drawPlaying(); break;
        case 'holeDone': drawHoleDone(); break;
        case 'roundDone': drawRoundDone(); break;
    }

    drawNotification(dt);
}

// Override onTouchStart to also check quit button during play
const _origTouchStart = onTouchStart;
onTouchStart = function(sx, sy) {
    if (state === 'playing' && checkQuitBtn(sx, sy)) return;
    _origTouchStart(sx, sy);
};

// ---- Start! ----
requestAnimationFrame(gameLoop);
