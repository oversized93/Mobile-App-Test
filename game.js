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
