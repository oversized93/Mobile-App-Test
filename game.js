// ============================================================
//  GAME.JS — Main game loop, all screens, golf physics
// ============================================================

// ---- Game State ----
let state = 'menu';
let player = loadData('player', { name: 'Golfer', ballColor: '#fff', unlocked: [0] });
let currentCourse = null;
let currentHoleIdx = 0;
let currentHole = null;
let ball = { x: 0, y: 0, vx: 0, vy: 0, z: 0, vz: 0, moving: false, airborne: false, topSpin: 0, curl: 0 };
let strokes = 0;
let holeStrokes = [];
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

// ---- Club system ----
// Yard conversion: 1 yard = 3 world units (CELL = 16, so ~5 yards per cell)
const YDS_TO_WORLD = 3;

const CLUBS = [
    { name: 'Driver',  maxPower: 500, launch: 550, airMin: 0.15, maxYds: 230 },
    { name: '3 Wood',  maxPower: 420, launch: 480, airMin: 0.18, maxYds: 195 },
    { name: '5 Iron',  maxPower: 340, launch: 420, airMin: 0.20, maxYds: 160 },
    { name: '7 Iron',  maxPower: 260, launch: 380, airMin: 0.22, maxYds: 120 },
    { name: 'P Wedge', maxPower: 180, launch: 500, airMin: 0.15, maxYds: 80  },
    { name: 'Putter',  maxPower: 120, launch: 0,   airMin: 999,  maxYds: 40  }
];
let selectedClub = 0;

// ---- Wind system ----
let wind = { speed: 0, angle: 0 }; // speed in mph, angle in radians

function generateWind() {
    wind.speed = Math.random() * 12 + 1; // 1-13 mph
    wind.angle = Math.random() * Math.PI * 2;
}

// ---- Flyover & scouting state ----
let flyoverActive = false;
let flyoverTimer = 0;
let flyoverPhase = 'toHole'; // 'toHole' | 'pause' | 'toBall'
let scouting = false;
let scoutCamX = 0, scoutCamY = 0;
let scoutLastX = 0, scoutLastY = 0;

function distToHole() {
    if (!currentHole) return 0;
    const hx = (currentHole.hole.x + 0.5) * CELL;
    const hy = (currentHole.hole.y + 0.5) * CELL;
    const dx = ball.x - hx, dy = ball.y - hy;
    return Math.sqrt(dx * dx + dy * dy);
}

function autoSelectClub() {
    const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;
    if (onGreen) { selectedClub = CLUBS.length - 1; return; } // Putter

    const dist = distToHole();
    // Pick the shortest club whose max range reaches the hole
    for (let i = CLUBS.length - 2; i >= 0; i--) {
        if (CLUBS[i].maxYds * YDS_TO_WORLD >= dist) {
            selectedClub = i;
            return;
        }
    }
    selectedClub = 0; // Driver if nothing else reaches
}

function updateTargetFromClub() {
    if (!currentHole) return;
    const club = CLUBS[selectedClub];
    const hx = (currentHole.hole.x + 0.5) * CELL;
    const hy = (currentHole.hole.y + 0.5) * CELL;
    const dx = hx - ball.x, dy = hy - ball.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxRange = club.maxYds * YDS_TO_WORLD;
    if (dist <= maxRange) {
        targetX = hx; targetY = hy;
    } else {
        targetX = ball.x + (dx / dist) * maxRange;
        targetY = ball.y + (dy / dist) * maxRange;
    }
    aimDirX = targetX - ball.x;
    aimDirY = targetY - ball.y;
    const aDist = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);
    aimPower = Math.min(aDist / (club.maxYds * YDS_TO_WORLD) * club.maxPower, club.maxPower);
}

function cycleClub(dir) {
    const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;
    if (onGreen) return; // Locked to putter on green
    selectedClub = (selectedClub + dir + CLUBS.length) % CLUBS.length;
    // Don't allow putter off the green
    if (selectedClub === CLUBS.length - 1) selectedClub = dir > 0 ? 0 : CLUBS.length - 2;
}

function notify(text) { notification = { text, timer: 2.5 }; }

// ---- Start a hole ----
function startHole(hole) {
    currentHole = hole;
    ball.x = (hole.tee.x + 0.5) * CELL;
    ball.y = (hole.tee.y + 0.5) * CELL;
    ball.vx = 0; ball.vy = 0; ball.z = 0; ball.vz = 0; ball.moving = false; ball.airborne = false;
    strokes = 0;
    aiming = false;
    holeComplete = false;
    shotTrail = [];
    scouting = false;
    generateWind();
    autoSelectClub();

    // Place default target along tee-to-hole line at club range
    const holeWorldX = (hole.hole.x + 0.5) * CELL;
    const holeWorldY = (hole.hole.y + 0.5) * CELL;
    const dx = holeWorldX - ball.x, dy = holeWorldY - ball.y;
    const distToH = Math.sqrt(dx * dx + dy * dy);
    const club = CLUBS[selectedClub];
    const maxRange = club.maxYds * YDS_TO_WORLD;
    if (distToH <= maxRange) {
        targetX = holeWorldX;
        targetY = holeWorldY;
    } else {
        targetX = ball.x + (dx / distToH) * maxRange;
        targetY = ball.y + (dy / distToH) * maxRange;
    }
    // Pre-calculate aim from default target
    aimDirX = targetX - ball.x;
    aimDirY = targetY - ball.y;
    const aDist = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);
    aimPower = Math.min(aDist / (club.maxYds * YDS_TO_WORLD) * club.maxPower, club.maxPower);

    // Reset camera fully for new hole
    cam.targetRot = 0;
    cam.rot = 0;
    manualZoom = false;
    shotLocked = false;
    meterActive = false;

    // Build 3D scene for this hole
    if (typeof buildTerrain3D === 'function') buildTerrain3D(hole);

    // Start flyover: zoom out to show whole hole, pan from hole to ball
    centerCamOnHole();
    cam.zoom = calcZoom();
    cam.x = cam.targetX;
    cam.y = cam.targetY;
    flyoverActive = true;
    flyoverTimer = 0;
    flyoverPhase = 'overview';
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
const GRAVITY = 400; // how fast ball comes back down

function updateBall(dt) {
    if (!ball.moving) return;
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

    // Ball has stopped rolling on ground
    if (speed < 2 && !ball.airborne) {
        ball.vx = 0; ball.vy = 0; ball.z = 0; ball.vz = 0;
        ball.moving = false; ball.airborne = false;
        onBallStopped();
        return;
    }

    // Record trail
    if (shotTrail.length === 0 || Math.abs(ball.x - shotTrail[shotTrail.length-1].x) > 3 ||
        Math.abs(ball.y - shotTrail[shotTrail.length-1].y) > 3) {
        shotTrail.push({ x: ball.x, y: ball.y });
        if (shotTrail.length > 200) shotTrail.shift();
    }

    // Move (sub-stepping for accuracy)
    const steps = Math.max(1, Math.ceil(speed * dt / 2));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
        ball.x += ball.vx * stepDt;
        ball.y += ball.vy * stepDt;

        // Airborne physics
        if (ball.airborne) {
            ball.z += ball.vz * stepDt;
            ball.vz -= GRAVITY * stepDt;

            // Light air drag
            ball.vx *= Math.pow(0.998, stepDt * 60);
            ball.vy *= Math.pow(0.998, stepDt * 60);

            // Curl: continuous lateral force perpendicular to velocity
            if (ball.curl !== 0) {
                const spd = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                if (spd > 1) {
                    const cnx = ball.vx / spd, cny = ball.vy / spd;
                    const cpx = -cny, cpy = cnx; // perpendicular
                    const curlForce = ball.curl * 120 * stepDt;
                    ball.vx += cpx * curlForce;
                    ball.vy += cpy * curlForce;
                }
            }

            // Ball has landed
            if (ball.z <= 0) {
                ball.z = 0;
                ball.vz = 0;
                ball.airborne = false;

                // Check what we landed on
                const ter = terrainAt(ball.x, ball.y);
                if (ter === T.WATER) {
                    ball.vx = 0; ball.vy = 0; ball.moving = false;
                    notify('Splash! +1 stroke');
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
                    // Hit tree canopy — drops straight down with heavy speed loss
                    ball.vx *= 0.15;
                    ball.vy *= 0.15;
                    notify('Landed in trees!');
                }

                // Bounce: heavy speed loss on landing, modified by topspin/backspin
                // Topspin (+1) = more roll, backspin (-1) = less roll / stops faster
                const topSpinMult = ball.topSpin || 0;
                const rollFactor = 0.3 + topSpinMult * 0.2; // range: 0.1 (backspin) to 0.5 (topspin)
                ball.vx *= Math.max(0.05, rollFactor);
                ball.vy *= Math.max(0.05, rollFactor);
                // Don't check hole while landing — need to roll in
            }
            continue; // Skip ground checks while airborne
        }

        // ---- Ground physics ----
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
            ball.vx *= -0.4;
            ball.vy *= -0.4;
            ball.x += ball.vx * stepDt * 3;
            ball.y += ball.vy * stepDt * 3;
            notify('Hit a tree!');
        }

        // Apply terrain friction
        ball.vx *= Math.pow(fric, stepDt * 60);
        ball.vy *= Math.pow(fric, stepDt * 60);

        // Check if ball rolls into hole (only on ground)
        const hx = (currentHole.hole.x + 0.5) * CELL;
        const hy = (currentHole.hole.y + 0.5) * CELL;
        const dx = ball.x - hx, dy = ball.y - hy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 6 && speed < 200) {
            ball.x = hx; ball.y = hy;
            ball.vx = 0; ball.vy = 0; ball.z = 0; ball.vz = 0;
            ball.moving = false; ball.airborne = false;
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
    autoSelectClub();
    updateTargetFromClub(); // reposition target for new ball position
    shotLocked = false;

    // Distance-based zoom: closer to hole = more zoom for precision
    if (!manualZoom) {
        const dist = distToHole();
        const maxDist = 800; // rough max distance on any hole
        const closeness = 1 - Math.min(dist / maxDist, 1); // 0 = far, 1 = very close
        if (ter === T.GREEN) {
            // On green: zoom in tight + rotate behind ball facing hole
            cam.targetZoom = Math.min(calcZoom() * 3 + closeness * 2, 7);
            const hx = (currentHole.hole.x + 0.5) * CELL;
            const hy = (currentHole.hole.y + 0.5) * CELL;
            const dx = hx - ball.x, dy = hy - ball.y;
            cam.targetRot = Math.atan2(dx, -dy); // behind ball, hole is "up"
        } else {
            // Off green: zoom more as you get closer
            const baseZoom = calcZoom();
            cam.targetZoom = baseZoom + closeness * baseZoom * 0.8;
            cam.targetRot = 0; // reset rotation off green
        }
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

// ---- Fire shot from meter results ----
function fireFromMeter(dirX, dirY, powerPct, accuracy, curlAmt) {
    // powerPct: 0-1 from phase 1
    // accuracy: -1 to 1 from phase 2 (0 = perfect)
    // curlAmt: -1 to 1 from dragging during phase 2

    const club = CLUBS[selectedClub];

    // Apply accuracy as hook/slice — scaled by zone
    // Green zone (center 33%): no deviation. Yellow: mild. Red: moderate.
    const absAcc = Math.abs(accuracy);
    let deviation = 0;
    if (absAcc < 0.33) {
        deviation = 0; // green zone — perfect
    } else if (absAcc < 0.66) {
        deviation = ((absAcc - 0.33) / 0.33) * 0.08; // yellow: 0 to ~5°
    } else {
        deviation = 0.08 + ((absAcc - 0.66) / 0.34) * 0.12; // red: 5° to ~12°
    }
    deviation *= Math.sign(accuracy);
    const cos = Math.cos(deviation), sin = Math.sin(deviation);
    const newDirX = dirX * cos - dirY * sin;
    const newDirY = dirX * sin + dirY * cos;

    const finalPower = club.maxPower * powerPct;

    if (absAcc < 0.33) notify('Perfect!');
    else if (absAcc < 0.5) notify('Great!');
    else if (absAcc < 0.66) notify('Good');
    else if (accuracy < -0.66) notify('Hook!');
    else notify('Slice!');

    // Store curl for flight physics
    ball.curl = curlAmt;

    takeShot(finalPower, newDirX, newDirY);
}

// ---- Shot mechanic (Golf Clash style) ----
function takeShot(power, dirX, dirY) {
    const club = CLUBS[selectedClub];
    const p = Math.min(power, club.maxPower);
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len === 0) return;
    const powerPct = p / club.maxPower;

    // Calculate velocity so ball actually travels maxYds at full power
    // For air shots: distance = velocity * airTime, airTime = 2*vz/gravity
    // We want ~85% of maxYds covered in air, 15% roll
    const targetDist = club.maxYds * YDS_TO_WORLD * powerPct;
    let velocity;

    ball.moving = true;
    ball.z = 0;
    ball.vz = 0;
    ball.airborne = false;

    if (club.launch > 0 && powerPct > club.airMin) {
        ball.airborne = true;
        ball.vz = club.launch * powerPct;
        // airTime = 2 * vz / GRAVITY
        const airTime = 2 * ball.vz / GRAVITY;
        // velocity needed to cover 85% of target distance in that air time
        velocity = (targetDist * 0.85) / Math.max(airTime, 0.1);
    } else {
        // Ground shot (putt or low power) — velocity for rolling the full distance
        velocity = targetDist * 2.5; // friction will eat most of this
    }

    ball.vx = (dirX / len) * velocity;
    ball.vy = (dirY / len) * velocity;

    // Apply sidespin — curves flight perpendicular to aim direction
    if (spin.side !== 0 && ball.airborne) {
        const nx = dirX / len, ny = dirY / len;
        // Perpendicular vector
        const perpX = -ny, perpY = nx;
        const sideForce = spin.side * p * 0.15;
        ball.vx += perpX * sideForce;
        ball.vy += perpY * sideForce;
    }

    // Apply wind force to initial velocity (stronger effect on airborne shots)
    const windForce = wind.speed * (ball.airborne ? 1.8 : 0.4);
    ball.vx += Math.cos(wind.angle) * windForce;
    ball.vy += Math.sin(wind.angle) * windForce;

    // Store spin for landing roll adjustment
    ball.topSpin = spin.top;

    strokes++;
    lastSafePos = { x: ball.x, y: ball.y };
    shotTrail = [];
    aiming = false;
    meterActive = false;
    meterPhase = 0;
    shotLocked = false;
    putting = false;
    manualZoom = false;
    spin = { top: 0, side: 0 }; // reset spin after shot
}

// ---- Shot system state ----
let aimDirX = 0, aimDirY = 0, aimPower = 0;
let putting = false;
let puttTargetX = 0, puttTargetY = 0;

// Target-based aiming: player drags a target on the ground
let targetX = 0, targetY = 0; // world coords of the aim target
let draggingTarget = false;
let aiming = false; // true when target is being positioned (replaces old aiming)

// Shot lock: aim is confirmed, ready for shot meter
let shotLocked = false;
let lockedPower = 0, lockedDirX = 0, lockedDirY = 0;

// Shot meter: accuracy arc with sweeping arrow
let meterActive = false;
let meterPhase = 0;
let meterAngle = 0;    // current arrow angle in the arc (-1 to 1, 0 = center)
let meterSpeed = 2.0;
let meterDir = 1;      // sweep direction
let curl = 0;
let curlDragStartX = 0;

// Camera state saved before entering meter mode
let preMeterCam = { x: 0, y: 0, zoom: 1, rot: 0 };

// Ball spin
let spin = { top: 0, side: 0 };
let spinAdjusting = false;

// Green slopes (per-hole, generated from hole data)
let greenSlopes = [];
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
        if (flyoverActive) {
            flyoverActive = false;
            centerCamOnBall();
            cam.targetZoom = calcZoom();
            return;
        }
        if (ball.moving || holeComplete) return;
        const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;

        // ---- Shot meter active: tap to fire ----
        if (meterActive) {
            const accuracy = meterAngle; // -1 to 1, 0 = center = perfect
            const powerPct = lockedPower / CLUBS[selectedClub].maxPower;
            fireFromMeter(lockedDirX, lockedDirY, powerPct, accuracy, curl);
            meterActive = false;
            meterPhase = 0;
            shotLocked = false;
            // Restore camera
            cam.targetRot = preMeterCam.rot;
            cam.targetZoom = preMeterCam.zoom;
            return;
        }

        // ---- Putting: drag back from ball ----
        if (onGreen) {
            const bs = (scene3dReady && typeof worldToScreen3D === 'function') ? worldToScreen3D(ball.x, ball.y) : worldToScreen(ball.x, ball.y);
            const bdx = sx - bs.x, bdy = sy - bs.y;
            if (bdx * bdx + bdy * bdy < 90 * 90) {
                aiming = true;
                putting = true;
                aimStartX = sx; aimStartY = sy;
                return;
            }
            // On green but didn't touch ball — pan camera
            scouting = true;
            scoutLastX = sx;
            scoutLastY = sy;
            return;
        }

        // ---- Target grab: check if touch is near the target crosshair ----
        if (sy < H() - 140) {
            const ts = (scene3dReady && typeof worldToScreen3D === 'function') ? worldToScreen3D(targetX, targetY) : worldToScreen(targetX, targetY);
            const tdx = sx - ts.x, tdy = sy - ts.y;
            const grabRadius = 45; // fixed screen-space radius
            if (tdx * tdx + tdy * tdy < grabRadius * grabRadius) {
                draggingTarget = true;
                aiming = true;
                shotLocked = false;
                return;
            }
        }

        // ---- UI buttons ----
        // SHOOT button (only when locked)
        if (shotLocked) {
            const shootBtnW = 160, shootBtnH = 50;
            const shootBtnX = (W() - shootBtnW) / 2, shootBtnY = H() - 185;
            if (hitBtn(sx, sy, shootBtnX, shootBtnY, shootBtnW, shootBtnH)) {
                // Save camera state
                preMeterCam = { x: cam.targetX, y: cam.targetY, zoom: cam.targetZoom, rot: cam.targetRot };
                // Rotate camera behind ball looking toward target
                const aDx = lockedDirX, aDy = lockedDirY;
                const behindAngle = Math.atan2(aDx, -aDy); // rotate so target is "up"
                cam.targetRot = behindAngle;
                cam.targetX = ball.x;
                cam.targetY = ball.y;
                cam.targetZoom = Math.max(cam.targetZoom * 1.5, 3);
                // Start meter
                meterActive = true;
                meterPhase = 2;
                meterAngle = -1; // start at left edge
                meterDir = 1;
                curl = 0;
                curlDragStartX = W() / 2;
                meterSpeed = (0.75 + (CLUBS[selectedClub].maxPower / 500) * 0.75);
                return;
            }
            const cancelW = 80, cancelH = 36;
            const cancelX = (W() - cancelW) / 2, cancelY = shootBtnY + shootBtnH + 10;
            if (hitBtn(sx, sy, cancelX, cancelY, cancelW, cancelH)) {
                shotLocked = false;
                return;
            }
        }
        // Club switching (not when locked)
        const clubY = H() - 120;
        if (!shotLocked && sy >= clubY && sy <= clubY + 36) {
            if (sx < W() / 2 - 40) { cycleClub(-1); updateTargetFromClub(); return; }
            if (sx > W() / 2 + 40) { cycleClub(1); updateTargetFromClub(); return; }
        }
        // Spin control
        const spinY = shotLocked ? H() - 290 : H() - 190;
        if (!flyoverActive) {
            const spX = W() - 60, spR = 28;
            const sdx = sx - spX, sdy = sy - spinY;
            if (sdx * sdx + sdy * sdy < (spR + 10) * (spR + 10)) {
                spinAdjusting = true;
                spin.side = Math.max(-1, Math.min(1, sdx / (spR * 0.8)));
                spin.top = Math.max(-1, Math.min(1, -sdy / (spR * 0.8)));
                return;
            }
        }

        // ---- Camera pan (fallback — any touch that wasn't caught above) ----
        scouting = true;
        scoutLastX = sx;
        scoutLastY = sy;
    }
}

function onTouchMove(sx, sy) {
    if (state === 'builder' && builderState.painting) { builderPaint(sx, sy); return; }
    if (state === 'playing' && spinAdjusting) {
        const spX = W() - 60, spY = shotLocked ? H() - 290 : H() - 190, spR = 28;
        spin.side = Math.max(-1, Math.min(1, (sx - spX) / (spR * 0.8)));
        spin.top = Math.max(-1, Math.min(1, -(sy - spY) / (spR * 0.8)));
        return;
    }
    if (state === 'playing' && meterActive && meterPhase === 2) {
        // During accuracy phase, drag left/right for curl
        curl = Math.max(-1, Math.min(1, (sx - curlDragStartX) / 80));
        return;
    }
    if (state === 'playing' && draggingTarget) {
        const wp = (scene3dReady && typeof screenToWorld3D === 'function') ? screenToWorld3D(sx, sy) : screenToWorld(sx, sy);
        const club = CLUBS[selectedClub];
        const maxRange = club.maxYds * YDS_TO_WORLD;
        // Clamp target within max club range
        let dx = wp.x - ball.x, dy = wp.y - ball.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxRange) {
            dx = (dx / dist) * maxRange;
            dy = (dy / dist) * maxRange;
        }
        targetX = ball.x + dx;
        targetY = ball.y + dy;
        aimDirX = dx;
        aimDirY = dy;
        const clampedDist = Math.sqrt(dx * dx + dy * dy);
        aimPower = (clampedDist / maxRange) * club.maxPower;
        return;
    }
    if (state === 'playing' && putting) {
        const dx = sx - aimStartX;
        const dy = sy - aimStartY;
        const dragDist = Math.sqrt(dx * dx + dy * dy);

        // Convert screen drag to world direction
        // In 3D behind-ball view, screen "down" = toward ball, "up" = toward hole
        if (scene3dReady && typeof screenToWorld3D === 'function') {
            const startW = screenToWorld3D(aimStartX, aimStartY);
            const curW = screenToWorld3D(sx, sy);
            // Direction from current drag point to start = direction ball should go (opposite of drag)
            aimDirX = startW.x - curW.x;
            aimDirY = startW.y - curW.y;
        } else {
            aimDirX = -dx; aimDirY = -dy;
        }

        aimPower = Math.min(dragDist * 1.8, CLUBS[selectedClub].maxPower);
        const len = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);
        if (len > 0) {
            const puttDist = (aimPower / CLUBS[selectedClub].maxPower) * CLUBS[selectedClub].maxYds * YDS_TO_WORLD;
            puttTargetX = ball.x + (aimDirX / len) * puttDist;
            puttTargetY = ball.y + (aimDirY / len) * puttDist;
        }
        return;
    }
    if (state === 'playing' && scouting) {
        const dx = sx - scoutLastX;
        const dy = sy - scoutLastY;
        scoutLastX = sx;
        scoutLastY = sy;
        if (scene3dReady && typeof panCamera3D === 'function') {
            panCamera3D(dx, dy);
        } else {
            cam.targetX -= dx / cam.zoom;
            cam.targetY -= dy / cam.zoom;
        }
    }
}

function onTouchEnd(sx, sy) {
    if (state === 'builder') { builderState.painting = false; return; }
    if (state === 'playing' && spinAdjusting) { spinAdjusting = false; return; }
    if (state === 'playing' && scouting) {
        scouting = false;
        // Keep camera where user left it — set manualZoom to prevent auto-cam
        manualZoom = true;
        return;
    }
    if (state === 'playing' && draggingTarget) {
        draggingTarget = false;
        if (aimPower > 5) {
            // Lock the aim
            lockedPower = aimPower;
            lockedDirX = aimDirX;
            lockedDirY = aimDirY;
            shotLocked = true;
        }
        aiming = false;
        return;
    }
    if (state === 'playing' && putting) {
        if (aimPower > 8) {
            takeShot(aimPower, aimDirX, aimDirY);
        }
        aiming = false;
        putting = false;
        aimPower = 0;
        return;
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
    // Reset transform to prevent accumulation bugs
    const d = window.devicePixelRatio || 1;
    ctx.setTransform(d, 0, 0, d, 0, 0);

    const is3D = scene3dReady && typeof render3D === 'function';

    if (!is3D) {
        ctx.fillStyle = '#1a472a';
        ctx.fillRect(0, 0, W(), H());
    } else {
        // Clear 2D canvas transparent for HUD overlay on top of 3D
        ctx.clearRect(0, 0, W(), H());
    }

    if (!currentHole) return;

    // Skip 2D world rendering when 3D is active
    if (!is3D) {
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

    // Green slope indicators (subtle arrows showing break direction)
    // Generate pseudo-random slopes based on hole position (deterministic per hole)
    if (terrainAt(ball.x, ball.y) === T.GREEN || shotLocked || meterActive) {
        for (let r = 0; r < hole.rows; r++) {
            for (let c = 0; c < hole.cols; c++) {
                if (hole.grid[r][c] === T.GREEN) {
                    // Slope points toward the hole with some variation
                    const cx = (c + 0.5) * CELL, cy = (r + 0.5) * CELL;
                    const toHoleX = (hole.hole.x + 0.5) * CELL - cx;
                    const toHoleY = (hole.hole.y + 0.5) * CELL - cy;
                    const dist = Math.sqrt(toHoleX * toHoleX + toHoleY * toHoleY);
                    if (dist < 4) continue;
                    // Add seeded variation based on position
                    const seed = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453;
                    const variation = (seed - Math.floor(seed)) * 0.8 - 0.4;
                    const angle = Math.atan2(toHoleY, toHoleX) + variation;
                    const arrowLen = 4;
                    const ax = Math.cos(angle) * arrowLen;
                    const ay = Math.sin(angle) * arrowLen;
                    ctx.strokeStyle = 'rgba(0,80,0,0.25)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(cx - ax, cy - ay);
                    ctx.lineTo(cx + ax, cy + ay);
                    ctx.stroke();
                    // Arrow head
                    ctx.beginPath();
                    ctx.moveTo(cx + ax, cy + ay);
                    ctx.lineTo(cx + ax - Math.cos(angle - 0.5) * 3, cy + ay - Math.sin(angle - 0.5) * 3);
                    ctx.moveTo(cx + ax, cy + ay);
                    ctx.lineTo(cx + ax - Math.cos(angle + 0.5) * 3, cy + ay - Math.sin(angle + 0.5) * 3);
                    ctx.stroke();
                }
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

    // Max distance ring for selected club (not on green)
    if (!ball.moving && !holeComplete && !flyoverActive && terrainAt(ball.x, ball.y) !== T.GREEN) {
        const club = CLUBS[selectedClub];
        const maxDist = club.maxYds * YDS_TO_WORLD; // max range in world units
        ctx.strokeStyle = 'rgba(255,255,100,0.25)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, maxDist, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Landing zone indicator (when aiming, shot locked, or needle)
    // Always show aim guides when we have a target (not putting, not in ball flight)
    const onGreenNow = terrainAt(ball.x, ball.y) === T.GREEN;
    const hasTarget = !onGreenNow && !ball.moving && !holeComplete && !flyoverActive;
    const showAimPower = (shotLocked || meterActive) ? lockedPower : aimPower;
    const showAimDirX = (shotLocked || meterActive) ? lockedDirX : aimDirX;
    const showAimDirY = (shotLocked || meterActive) ? lockedDirY : aimDirY;
    if (showAimPower > 10 && !onGreenNow) {
        const club = CLUBS[selectedClub];
        const len = Math.sqrt(showAimDirX * showAimDirX + showAimDirY * showAimDirY);
        if (len > 0) {
            const nx = showAimDirX / len, ny = showAimDirY / len;
            const landDist = (showAimPower / club.maxPower) * club.maxYds * YDS_TO_WORLD;
            const landX = ball.x + nx * landDist;
            const landY = ball.y + ny * landDist;

            // Accuracy rings (concentric circles around target)
            for (let ring = 3; ring >= 1; ring--) {
                const ringR = ring * 8;
                const ringAlpha = 0.15 + (3 - ring) * 0.1;
                ctx.strokeStyle = `rgba(255,255,255,${ringAlpha})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(landX, landY, ringR, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Landing zone target (crosshair) — larger and bolder
            ctx.strokeStyle = 'rgba(255,255,100,0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(landX, landY, 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(landX - 18, landY); ctx.lineTo(landX - 6, landY);
            ctx.moveTo(landX + 6, landY); ctx.lineTo(landX + 18, landY);
            ctx.moveTo(landX, landY - 18); ctx.lineTo(landX, landY - 6);
            ctx.moveTo(landX, landY + 6); ctx.lineTo(landX, landY + 18);
            ctx.stroke();

            // Center dot
            ctx.fillStyle = 'rgba(255,255,100,0.9)';
            ctx.beginPath();
            ctx.arc(landX, landY, 3, 0, Math.PI * 2);
            ctx.fill();

            // ---- Ball guide: simulate roll after landing ----
            // Match the actual physics: flight velocity * rollFactor
            const topSpinMult = spin.top || 0;
            const simRollFactor = 0.3 + topSpinMult * 0.2;
            const powerPct = Math.min(showAimPower / club.maxPower, 1);
            const simVz = club.launch * powerPct;
            const simAirTime = 2 * simVz / GRAVITY;
            const simFlightVel = simAirTime > 0 ? (landDist * 0.85) / simAirTime : landDist * 2.5;
            let simVx = nx * simFlightVel * simRollFactor;
            let simVy = ny * simFlightVel * simRollFactor;
            let simX = landX, simY = landY;
            const guidePoints = [{ x: simX, y: simY }];
            const simDt = 0.03;
            for (let s = 0; s < 40; s++) {
                const ter = terrainAt(simX, simY);
                if (ter === T.WATER || ter === T.OOB || ter === T.TREE) break;
                const fric = TERRAIN_FRICTION[ter] || 0.97;
                simVx *= Math.pow(fric, simDt * 60);
                simVy *= Math.pow(fric, simDt * 60);
                simX += simVx * simDt;
                simY += simVy * simDt;
                const spd = Math.sqrt(simVx * simVx + simVy * simVy);
                if (spd < 3) break;
                guidePoints.push({ x: simX, y: simY });
            }
            // Draw guide as fading dots
            for (let i = 1; i < guidePoints.length; i++) {
                const alpha = 0.5 * (1 - i / guidePoints.length);
                ctx.fillStyle = `rgba(255,200,50,${alpha})`;
                ctx.beginPath();
                ctx.arc(guidePoints[i].x, guidePoints[i].y, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

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

    // Aim line / Putt guide (visible during aim, locked, or default target)
    const aimVis = (aiming && aimPower > 5) || shotLocked || meterActive || hasTarget;
    // Priority: locked/meter use locked values, everything else uses current aim values
    const visAimDirX = (shotLocked || meterActive) ? lockedDirX : aimDirX;
    const visAimDirY = (shotLocked || meterActive) ? lockedDirY : aimDirY;
    const visAimPower = (shotLocked || meterActive) ? lockedPower : aimPower;
    if (aimVis && (visAimPower > 5 || putting)) {
        const len = Math.sqrt(visAimDirX * visAimDirX + visAimDirY * visAimDirY);
        if (len > 0) {
            const nx = visAimDirX / len, ny = visAimDirY / len;
            const club = CLUBS[selectedClub];

            if (putting) {
                // ---- PUTT GUIDE ----
                // Solid guide line from ball to target
                ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(ball.x, ball.y);
                ctx.lineTo(puttTargetX, puttTargetY);
                ctx.stroke();

                // Distance dots along the line
                const puttDist = Math.sqrt((puttTargetX - ball.x) ** 2 + (puttTargetY - ball.y) ** 2);
                const dotSpacing = 12;
                const numDots = Math.floor(puttDist / dotSpacing);
                for (let i = 1; i <= numDots; i++) {
                    const t = i / numDots;
                    const dx = ball.x + (puttTargetX - ball.x) * t;
                    const dy = ball.y + (puttTargetY - ball.y) * t;
                    ctx.fillStyle = `rgba(255,255,255,${0.3 + t * 0.4})`;
                    ctx.beginPath();
                    ctx.arc(dx, dy, 1.5, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Target circle
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(puttTargetX, puttTargetY, 6, 0, Math.PI * 2);
                ctx.stroke();
                // Target cross
                ctx.beginPath();
                ctx.moveTo(puttTargetX - 4, puttTargetY);
                ctx.lineTo(puttTargetX + 4, puttTargetY);
                ctx.moveTo(puttTargetX, puttTargetY - 4);
                ctx.lineTo(puttTargetX, puttTargetY + 4);
                ctx.stroke();

                // Putt distance in feet (shorter scale for putting)
                const puttFeet = Math.round(puttDist / 1.5);
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = 'bold 8px -apple-system,sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(puttFeet + ' ft', puttTargetX, puttTargetY - 12);
            } else {
                // ---- NORMAL AIM LINE ----
                const lineLen = (visAimPower / club.maxPower) * club.maxYds * YDS_TO_WORLD;

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
    }

    // Draw ball (with air height visual)
    if (ball.airborne && ball.z > 0) {
        // Shadow on ground (gets smaller/fainter as ball goes higher)
        const shadowAlpha = Math.max(0.08, 0.3 - ball.z / 400);
        const shadowScale = Math.max(0.4, 1 - ball.z / 300);
        ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
        ctx.beginPath();
        ctx.ellipse(ball.x, ball.y, 4 * shadowScale, 2.5 * shadowScale, 0, 0, Math.PI * 2);
        ctx.fill();
        // Ball drawn above its ground position
        const visualHeight = ball.z * 0.15; // scale z to visual offset
        drawBall(ball.x, ball.y - visualHeight, 4, player.ballColor);
    } else {
        drawBall(ball.x, ball.y, 4, player.ballColor);
    }

    camRestore();
    } // end if (!is3D) — skip 2D world rendering

    // Reset transform for HUD (screen space)
    const dp = window.devicePixelRatio || 1;
    ctx.setTransform(dp, 0, 0, dp, 0, 0);

    // ---- 3D aim guides (projected to screen) ----
    if (is3D && !ball.moving && !holeComplete) {
        const onGreen3D = terrainAt(ball.x, ball.y) === T.GREEN;
        const club3D = CLUBS[selectedClub];
        const hasTgt = !onGreen3D && !flyoverActive;

        if (hasTgt && aimPower > 5) {
            // Project ball and target to screen
            const bs = worldToScreen3D(ball.x, ball.y);
            const dirLen = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);

            if (dirLen > 0) {
                const nx = aimDirX / dirLen, ny = aimDirY / dirLen;
                const usePower = (shotLocked || meterActive) ? lockedPower : aimPower;
                const useDir = (shotLocked || meterActive) ? { x: lockedDirX, y: lockedDirY } : { x: aimDirX, y: aimDirY };
                const uLen = Math.sqrt(useDir.x * useDir.x + useDir.y * useDir.y);
                const unx = useDir.x / uLen, uny = useDir.y / uLen;
                const landDist = (usePower / club3D.maxPower) * club3D.maxYds * YDS_TO_WORLD;
                const landWx = ball.x + unx * landDist;
                const landWy = ball.y + uny * landDist;
                const ls = worldToScreen3D(landWx, landWy);

                // Aim line (from ball to target)
                ctx.strokeStyle = 'rgba(100,220,255,0.8)';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(bs.x, bs.y);
                ctx.lineTo(ls.x, ls.y);
                ctx.stroke();

                // Target crosshair
                ctx.strokeStyle = 'rgba(255,255,100,0.9)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(ls.x, ls.y, 16, 0, Math.PI * 2);
                ctx.stroke();
                // Crosshair lines
                ctx.beginPath();
                ctx.moveTo(ls.x - 22, ls.y); ctx.lineTo(ls.x - 8, ls.y);
                ctx.moveTo(ls.x + 8, ls.y); ctx.lineTo(ls.x + 22, ls.y);
                ctx.moveTo(ls.x, ls.y - 22); ctx.lineTo(ls.x, ls.y - 8);
                ctx.moveTo(ls.x, ls.y + 8); ctx.lineTo(ls.x, ls.y + 22);
                ctx.stroke();
                // Center dot
                ctx.fillStyle = 'rgba(255,255,100,0.9)';
                ctx.beginPath();
                ctx.arc(ls.x, ls.y, 3, 0, Math.PI * 2);
                ctx.fill();

                // Accuracy rings
                for (let ring = 3; ring >= 1; ring--) {
                    ctx.strokeStyle = `rgba(255,255,255,${0.1 + (3 - ring) * 0.08})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(ls.x, ls.y, ring * 12, 0, Math.PI * 2);
                    ctx.stroke();
                }

                // Distance ring (max club range)
                const maxRangeW = club3D.maxYds * YDS_TO_WORLD;
                // Draw a few points around the ring projected to screen
                ctx.strokeStyle = 'rgba(255,255,100,0.2)';
                ctx.lineWidth = 1;
                ctx.setLineDash([6, 6]);
                ctx.beginPath();
                const ringPts = 36;
                for (let i = 0; i <= ringPts; i++) {
                    const a = (i / ringPts) * Math.PI * 2;
                    const rx = ball.x + Math.cos(a) * maxRangeW;
                    const ry = ball.y + Math.sin(a) * maxRangeW;
                    const rs = worldToScreen3D(rx, ry);
                    if (i === 0) ctx.moveTo(rs.x, rs.y);
                    else ctx.lineTo(rs.x, rs.y);
                }
                ctx.stroke();
                ctx.setLineDash([]);

                // ---- Ball guide dots (bounce/roll prediction, projected to screen) ----
                const topSpinM = spin.top || 0;
                const simRF = 0.3 + topSpinM * 0.2;
                const pctG = Math.min(usePower / club3D.maxPower, 1);
                const simVzG = club3D.launch * pctG;
                const simATG = 2 * simVzG / GRAVITY;
                const simFVG = simATG > 0 ? (landDist * 0.85) / simATG : landDist * 2.5;
                let gvx = unx * simFVG * simRF;
                let gvy = uny * simFVG * simRF;
                let gx = landWx, gy = landWy;
                for (let s = 0; s < 40; s++) {
                    const ter = terrainAt(gx, gy);
                    if (ter === T.WATER || ter === T.OOB || ter === T.TREE) break;
                    const fric = TERRAIN_FRICTION[ter] || 0.97;
                    gvx *= Math.pow(fric, 0.03 * 60);
                    gvy *= Math.pow(fric, 0.03 * 60);
                    gx += gvx * 0.03;
                    gy += gvy * 0.03;
                    if (Math.sqrt(gvx * gvx + gvy * gvy) < 3) break;
                    const gs = worldToScreen3D(gx, gy);
                    const alpha = 0.5 * (1 - s / 40);
                    ctx.fillStyle = `rgba(255,200,50,${alpha})`;
                    ctx.beginPath();
                    ctx.arc(gs.x, gs.y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // ---- Green slope arrows (projected to screen) ----
        if (onGreen3D) {
            const hole = currentHole;
            for (let r = 0; r < hole.rows; r++) {
                for (let c = 0; c < hole.cols; c++) {
                    if (hole.grid[r][c] !== T.GREEN) continue;
                    const wx = (c + 0.5) * CELL, wy = (r + 0.5) * CELL;
                    const thx = (hole.hole.x + 0.5) * CELL - wx;
                    const thy = (hole.hole.y + 0.5) * CELL - wy;
                    const td = Math.sqrt(thx * thx + thy * thy);
                    if (td < 4) continue;
                    const seed = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453;
                    const variation = (seed - Math.floor(seed)) * 0.8 - 0.4;
                    const ang = Math.atan2(thy, thx) + variation;
                    const aLen = 3;
                    const startS = worldToScreen3D(wx - Math.cos(ang) * aLen, wy - Math.sin(ang) * aLen);
                    const endS = worldToScreen3D(wx + Math.cos(ang) * aLen, wy + Math.sin(ang) * aLen);
                    ctx.strokeStyle = 'rgba(0,100,0,0.35)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(startS.x, startS.y);
                    ctx.lineTo(endS.x, endS.y);
                    ctx.stroke();
                    // Arrowhead
                    const hS = worldToScreen3D(wx + Math.cos(ang - 0.5) * (aLen - 1), wy + Math.sin(ang - 0.5) * (aLen - 1));
                    ctx.beginPath();
                    ctx.moveTo(endS.x, endS.y);
                    ctx.lineTo(hS.x, hS.y);
                    ctx.stroke();
                }
            }
        }

        // ---- 3D Putt guide (glowing line with slope curve) ----
        if (onGreen3D && putting && aimPower > 3) {
            // Simulate putt path with slope influence
            const puttLen = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);
            if (puttLen > 0) {
                const puttDist = (aimPower / CLUBS[selectedClub].maxPower) * CLUBS[selectedClub].maxYds * YDS_TO_WORLD;
                let pvx = (aimDirX / puttLen) * puttDist * 2.5;
                let pvy = (aimDirY / puttLen) * puttDist * 2.5;
                let px = ball.x, py = ball.y;
                const puttPts = [{ x: px, y: py }];
                for (let s = 0; s < 60; s++) {
                    // Apply green slope force
                    const holeWx = (currentHole.hole.x + 0.5) * CELL;
                    const holeWy = (currentHole.hole.y + 0.5) * CELL;
                    const toHx = holeWx - px, toHy = holeWy - py;
                    const toHd = Math.sqrt(toHx * toHx + toHy * toHy);
                    if (toHd > 2) {
                        const seed = Math.sin(Math.floor(px / CELL) * 12.9898 + Math.floor(py / CELL) * 78.233) * 43758.5453;
                        const variation = (seed - Math.floor(seed)) * 0.8 - 0.4;
                        const slopeAng = Math.atan2(toHy, toHx) + variation;
                        pvx += Math.cos(slopeAng) * 1.5;
                        pvy += Math.sin(slopeAng) * 1.5;
                    }
                    // Friction
                    pvx *= 0.92; pvy *= 0.92;
                    px += pvx * 0.03; py += pvy * 0.03;
                    if (Math.sqrt(pvx * pvx + pvy * pvy) < 2) break;
                    if (terrainAt(px, py) !== T.GREEN) break;
                    puttPts.push({ x: px, y: py });
                }

                // Project points to screen and draw glowing path
                const screenPts = puttPts.map(p => worldToScreen3D(p.x, p.y));
                if (screenPts.length > 1) {
                    // Wide glow
                    ctx.strokeStyle = 'rgba(0,180,255,0.2)';
                    ctx.lineWidth = 16;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.beginPath();
                    ctx.moveTo(screenPts[0].x, screenPts[0].y);
                    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
                    ctx.stroke();
                    // Medium glow
                    ctx.strokeStyle = 'rgba(0,220,255,0.5)';
                    ctx.lineWidth = 6;
                    ctx.beginPath();
                    ctx.moveTo(screenPts[0].x, screenPts[0].y);
                    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
                    ctx.stroke();
                    // Core
                    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(screenPts[0].x, screenPts[0].y);
                    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
                    ctx.stroke();

                    // Arrow at end
                    const last = screenPts[screenPts.length - 1];
                    const prev = screenPts[Math.max(0, screenPts.length - 3)];
                    const adx = last.x - prev.x, ady = last.y - prev.y;
                    const al = Math.sqrt(adx * adx + ady * ady);
                    if (al > 5) {
                        const anx = adx / al, any = ady / al;
                        ctx.fillStyle = 'rgba(0,200,255,0.8)';
                        ctx.beginPath();
                        ctx.moveTo(last.x, last.y);
                        ctx.lineTo(last.x - anx * 14 - any * 8, last.y - any * 14 + anx * 8);
                        ctx.lineTo(last.x - anx * 14 + any * 8, last.y - any * 14 - anx * 8);
                        ctx.fill();
                    }
                }

                // Distance in feet
                const totalDist = Math.sqrt((puttTargetX - ball.x) ** 2 + (puttTargetY - ball.y) ** 2);
                const puttFeet = Math.round(totalDist / 1.5);
                const midPt = screenPts[Math.floor(screenPts.length / 2)] || screenPts[0];
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 16px -apple-system,sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(puttFeet + ' ft', midPt.x, midPt.y - 15);
            }
        }
    }

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

    // ---- Wind compass ----
    const wcx = W() - 40, wcy = 90, wcr = 24;
    // Background circle
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(wcx, wcy, wcr + 4, 0, Math.PI * 2);
    ctx.fill();
    // Compass ring
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(wcx, wcy, wcr, 0, Math.PI * 2);
    ctx.stroke();
    // Wind arrow
    const arrowLen = Math.min(wind.speed / 13, 1) * (wcr - 4);
    const wax = Math.cos(wind.angle) * arrowLen;
    const way = Math.sin(wind.angle) * arrowLen;
    ctx.strokeStyle = '#4cf';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(wcx - wax * 0.3, wcy - way * 0.3);
    ctx.lineTo(wcx + wax, wcy + way);
    ctx.stroke();
    // Arrow head
    const headLen = 6;
    const aAngle = Math.atan2(way, wax);
    ctx.fillStyle = '#4cf';
    ctx.beginPath();
    ctx.moveTo(wcx + wax, wcy + way);
    ctx.lineTo(wcx + wax - Math.cos(aAngle - 0.5) * headLen, wcy + way - Math.sin(aAngle - 0.5) * headLen);
    ctx.lineTo(wcx + wax - Math.cos(aAngle + 0.5) * headLen, wcy + way - Math.sin(aAngle + 0.5) * headLen);
    ctx.fill();
    // Wind speed text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(wind.speed) + ' mph', wcx, wcy + wcr + 16);

    // Club selector (visible when ball is stopped and NOT in locked/needle mode)
    if (!ball.moving && !holeComplete && !shotLocked && !meterActive) {
        const club = CLUBS[selectedClub];
        const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;
        const clubY = H() - 120;

        // Club display bar
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        roundRect(20, clubY, W() - 40, 36, 10);
        ctx.fill();

        // Left arrow
        if (!onGreen) {
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = 'bold 20px -apple-system,sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('\u25C0', 30, clubY + 24);
        }

        // Club name + max yards + distance to hole
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        const dist = distToHole();
        const distYds = Math.round(dist / YDS_TO_WORLD);
        const canReach = club.maxYds >= distYds;
        const reachColor = canReach ? '#4caf50' : '#f44';
        ctx.fillText(club.name + ' (' + club.maxYds + ' yds)', W() / 2 - 30, clubY + 16);
        ctx.fillStyle = reachColor;
        ctx.font = '12px -apple-system,sans-serif';
        ctx.fillText(distYds + ' yds to hole' + (canReach ? ' \u2713' : ''), W() / 2 - 30, clubY + 32);

        // Right arrow
        if (!onGreen) {
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = 'bold 20px -apple-system,sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('\u25B6', W() - 30, clubY + 24);
        }
    }

    // Power meter (when dragging to aim in Step 1)
    if (aiming && !putting && aimPower > 10 && !meterActive) {
        const club = CLUBS[selectedClub];
        const meterW = W() - 40;
        const meterH = 12;
        const mx = 20, my = H() - 160;
        const pct = Math.min(aimPower / club.maxPower, 1);

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
        const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;
        const willFly = club.launch > 0 && pct > club.airMin;
        const shotLabel = club.name + ' \u2022 ' + (willFly ? 'AIR' : 'ROLL') + ' ' + Math.round(pct * 100) + '%';
        ctx.fillText(shotLabel, W() / 2, my - 8);

    }

    // ---- Step 2: Shot locked — show SHOOT + Cancel buttons ----
    if (shotLocked && !meterActive) {
        const shootBtnW = 160, shootBtnH = 50;
        const shootBtnX = (W() - shootBtnW) / 2, shootBtnY = H() - 185;
        drawBtn(shootBtnX, shootBtnY, shootBtnW, shootBtnH, 'TAKE SHOT', '#e65100');

        const cancelW = 80, cancelH = 36;
        const cancelX = (W() - cancelW) / 2, cancelY = shootBtnY + shootBtnH + 10;
        drawBtn(cancelX, cancelY, cancelW, cancelH, 'Cancel', '#555');

        const club = CLUBS[selectedClub];
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(club.name + ' \u2022 Drag target to re-aim', W() / 2, shootBtnY - 12);
    }

    // ---- Accuracy arc (behind-ball fan view) ----
    if (meterActive) {
        // Fan arc at bottom of screen
        const arcCx = W() / 2;
        const arcCy = H() - 20;
        const arcR = Math.min(W() * 0.28, 120);
        const arcSpread = Math.PI * 0.5;
        const arcStart = -Math.PI / 2 - arcSpread / 2;
        const arcEnd = -Math.PI / 2 + arcSpread / 2;

        // Draw colored fan segments (red → yellow → green → yellow → red)
        const segments = 30;
        for (let i = 0; i < segments; i++) {
            const t = i / segments;
            const a1 = arcStart + t * arcSpread;
            const a2 = arcStart + (t + 1) / segments * arcSpread;
            // Distance from center (0 = center, 1 = edge)
            const fromCenter = Math.abs(t - 0.5) * 2;
            let r, g, b;
            if (fromCenter < 0.3) {
                r = 46; g = 175; b = 80; // green
            } else if (fromCenter < 0.6) {
                const p = (fromCenter - 0.3) / 0.3;
                r = 46 + (255 - 46) * p; g = 175 + (235 - 175) * p; b = 80 - 80 * p; // → yellow
            } else {
                const p = (fromCenter - 0.6) / 0.4;
                r = 255; g = 235 - 175 * p; b = 0; // → red/orange
            }
            ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.85)`;
            ctx.beginPath();
            ctx.moveTo(arcCx, arcCy);
            ctx.arc(arcCx, arcCy, arcR, a1, a2);
            ctx.closePath();
            ctx.fill();
        }

        // Arc outline
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(arcCx, arcCy, arcR, arcStart, arcEnd);
        ctx.stroke();

        // Center target line (perfect zone)
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(arcCx, arcCy);
        ctx.lineTo(arcCx, arcCy - arcR - 8);
        ctx.stroke();

        // Sweeping arrow (meterAngle: -1 to 1 mapped across the arc)
        const arrowAngle = -Math.PI / 2 + meterAngle * (arcSpread / 2);
        const arrowLen = arcR + 15;
        const arrowX = arcCx + Math.cos(arrowAngle) * arrowLen;
        const arrowY = arcCy + Math.sin(arrowAngle) * arrowLen;
        const arrowBaseX = arcCx + Math.cos(arrowAngle) * (arcR * 0.3);
        const arrowBaseY = arcCy + Math.sin(arrowAngle) * (arcR * 0.3);

        // Arrow line
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(arrowBaseX, arrowBaseY);
        ctx.lineTo(arrowX, arrowY);
        ctx.stroke();

        // Arrow head
        const headLen = 10;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - Math.cos(arrowAngle - 0.4) * headLen, arrowY - Math.sin(arrowAngle - 0.4) * headLen);
        ctx.lineTo(arrowX - Math.cos(arrowAngle + 0.4) * headLen, arrowY - Math.sin(arrowAngle + 0.4) * headLen);
        ctx.fill();

        // Ball representation at arc center
        drawBall(arcCx, arcCy, 10, player.ballColor);

        // Target bullseye at top (above arc)
        const bullX = arcCx, bullY = arcCy - arcR - 20;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(bullX, bullY, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(bullX, bullY, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#e33';
        ctx.beginPath(); ctx.arc(bullX, bullY, 3, 0, Math.PI * 2); ctx.fill();

        // "TAP TO SHOOT" text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TAP TO SHOOT', W() / 2, arcCy - arcR - 55);

        // Curl indicator
        if (Math.abs(curl) > 0.05) {
            ctx.fillStyle = '#4cf';
            ctx.font = 'bold 13px -apple-system,sans-serif';
            ctx.fillText(curl < 0 ? '\u21B0 Curl Left' : '\u21B1 Curl Right', W() / 2, arcCy + 30);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = '11px -apple-system,sans-serif';
            ctx.fillText('Drag L/R for curl', W() / 2, arcCy + 30);
        }
    }

    // ---- Spin control (shown when not moving, not in meter mode) ----
    const showSpin = !ball.moving && !holeComplete && !flyoverActive && !meterActive && terrainAt(ball.x, ball.y) !== T.GREEN;
    if (showSpin) {
        const spX = W() - 60, spY = shotLocked ? H() - 290 : H() - 190, spR = 28;

        // Background circle
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.arc(spX, spY, spR + 6, 0, Math.PI * 2);
        ctx.fill();

        // Ball outline
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(spX, spY, spR, 0, Math.PI * 2);
        ctx.stroke();

        // Cross lines
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(spX - spR, spY); ctx.lineTo(spX + spR, spY);
        ctx.moveTo(spX, spY - spR); ctx.lineTo(spX, spY + spR);
        ctx.stroke();

        // Spin dot position
        const dotX = spX + spin.side * spR * 0.8;
        const dotY = spY - spin.top * spR * 0.8; // up = topspin
        ctx.fillStyle = '#f44';
        ctx.beginPath();
        ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
        ctx.fill();

        // Labels
        ctx.fillStyle = '#888';
        ctx.font = '9px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TOP', spX, spY - spR - 8);
        ctx.fillText('BACK', spX, spY + spR + 14);
        ctx.textAlign = 'left';
        ctx.fillText('L', spX - spR - 10, spY + 3);
        ctx.textAlign = 'right';
        ctx.fillText('R', spX + spR + 10, spY + 3);

        ctx.textAlign = 'center';
        ctx.fillStyle = '#aaa';
        ctx.font = '10px -apple-system,sans-serif';
        ctx.fillText('SPIN', spX, spY + spR + 26);
    }

    // Hint text
    if (flyoverActive) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '14px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Tap to skip', W() / 2, H() - 30);
    } else if (!ball.moving && !holeComplete) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '12px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;
        if (meterActive) {
            // shown on the meter itself
        } else if (shotLocked) {
            ctx.fillText('Adjust spin \u2022 Drag to re-aim \u2022 Tap TAKE SHOT', W() / 2, H() - 24);
        } else if (onGreen) {
            ctx.fillText('Drag back from ball to putt \u2022 Release to putt', W() / 2, H() - 24);
        } else if (!aiming) {
            ctx.fillText('Drag target to aim \u2022 Drag elsewhere to pan \u2022 Arrows: club', W() / 2, H() - 24);
        }
    }

    // Zoom, rotate, recenter buttons (left side)
    if (!ball.moving && !flyoverActive) {
        drawBtn(8, 66, 32, 28, '+', 'rgba(255,255,255,0.2)', '#ccc');
        drawBtn(8, 98, 32, 28, '−', 'rgba(255,255,255,0.2)', '#ccc');
        drawBtn(8, 134, 32, 28, '\u21BB', 'rgba(255,255,255,0.2)', '#ccc'); // ↻ rotate right
        drawBtn(8, 166, 32, 28, '\u21BA', 'rgba(255,255,255,0.2)', '#ccc'); // ↺ rotate left
        drawBtn(8, 202, 32, 28, '\u25CE', 'rgba(255,255,255,0.2)', '#ccc'); // ◎ recenter+reset
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
function checkPlayingUI(sx, sy) {
    // Quit button
    if (hitBtn(sx, sy, W() - 58, 62, 50, 30)) {
        if (customCoursePlay) { state = 'builder'; }
        else { state = 'menu'; }
        return true;
    }
    // Zoom buttons
    if (!ball.moving && !flyoverActive) {
        if (hitBtn(sx, sy, 8, 66, 32, 28)) {
            cam.targetZoom = Math.min(cam.targetZoom * 1.4, 8);
            manualZoom = true;
            return true;
        }
        if (hitBtn(sx, sy, 8, 98, 32, 28)) {
            cam.targetZoom = Math.max(cam.targetZoom / 1.4, 0.3);
            manualZoom = true;
            return true;
        }
        if (hitBtn(sx, sy, 8, 134, 32, 28)) {
            cam.targetRot += Math.PI / 4;
            if (scene3dReady && typeof orbitCamera3D === 'function') {
                orbitCamera3D(Math.PI / 4, ball.x, ball.y);
                manualZoom = true;
            }
            return true;
        }
        if (hitBtn(sx, sy, 8, 166, 32, 28)) {
            cam.targetRot -= Math.PI / 4;
            if (scene3dReady && typeof orbitCamera3D === 'function') {
                orbitCamera3D(-Math.PI / 4, ball.x, ball.y);
                manualZoom = true;
            }
            return true;
        }
        if (hitBtn(sx, sy, 8, 202, 32, 28)) {
            centerCamOnBall();
            cam.targetRot = 0;
            manualZoom = false;
            return true;
        }
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
        // Flyover animation
        if (flyoverActive) {
            flyoverTimer += dt;
            if (flyoverPhase === 'overview' && flyoverTimer > 2.0) {
                // After showing overview, zoom to ball
                flyoverPhase = 'toBall';
                centerCamOnBall();
                cam.targetZoom = calcZoom();
                flyoverTimer = 0;
            }
            if (flyoverPhase === 'toBall' && flyoverTimer > 1.0) {
                flyoverActive = false;
            }
            camLerp(dt);
        } else {
            // Update shot meter (arrow sweeps across arc)
            if (meterActive) {
                meterAngle += meterDir * meterSpeed * dt * 2;
                if (meterAngle > 1) { meterAngle = 1; meterDir = -1; }
                if (meterAngle < -1) { meterAngle = -1; meterDir = 1; }
            }
            updateBall(dt);
            camLerp(dt);
            if (holeComplete && !ball.moving) {
                state = 'holeDone';
            }
        }
    }

    // 3D rendering for gameplay states
    const use3D = scene3dReady && (state === 'playing' || state === 'holeDone');
    if (use3D) {
        show3D();
        // Update 3D ball position
        updateBall3D(ball.x, ball.y, ball.z, player.ballColor);
        // Update 3D target
        const onGreenNow = terrainAt(ball.x, ball.y) === T.GREEN;
        updateTarget3D(targetX, targetY, !onGreenNow && !ball.moving && !holeComplete);
        // Update 3D camera
        if (meterActive) {
            const tdx = lockedDirX, tdy = lockedDirY;
            const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
            setCameraBehindBall(ball.x, ball.y, ball.x + tdx / tlen * 80, ball.y + tdy / tlen * 80, 60);
        } else if (onGreenNow && !ball.moving) {
            if (!scouting && !manualZoom) {
                const hx = (currentHole.hole.x + 0.5) * CELL;
                const hy = (currentHole.hole.y + 0.5) * CELL;
                setCameraBehindBall(ball.x, ball.y, hx, hy, 45);
            }
        } else if (ball.moving) {
            manualZoom = false; // reset when ball moves
            setCameraOverhead(ball.x, ball.y, 0.5);
        } else if (!scouting && !manualZoom) {
            const zoomFactor = cam.targetZoom || 1;
            setCameraOverhead(ball.x, ball.y, zoomFactor * 0.5);
        }
        if (typeof cam3dSkipLerp !== 'undefined') cam3dSkipLerp = scouting;
        updateCamera3D(dt);
        render3D();
        // Make 2D canvas transparent for HUD overlay
        canvas.style.background = 'transparent';
    } else {
        hide3D();
        canvas.style.background = '';
    }

    // Draw 2D based on state (HUD overlay when 3D, full render when not)
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
    if (state === 'playing' && checkPlayingUI(sx, sy)) return;
    _origTouchStart(sx, sy);
};

// ---- Start! ----
if (typeof init3D === 'function') init3D();
requestAnimationFrame(gameLoop);
