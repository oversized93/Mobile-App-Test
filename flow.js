// ============================================================
//  FLOW — Animal spawning, parametric flow along river,
//  obstacles, payouts. (replaces physics.js from marble run)
// ============================================================

const MAX_ANIMALS = 40;
const BASE_SPAWN_INTERVAL = 3.8;   // seconds
const BASE_ANIMAL_SPEED = 70;      // pixels/sec along the polyline
const ROCK_SLOW_RANGE_T = 0.035;   // pathT range affected by a rock
const ROCK_SLOW_FACTOR = 0.35;     // multiplier when inside a rock's range

// ---- Animal data ----
// More species will be added later; only 'fish' is active in MVP.
const ANIMAL_TYPES = {
    fish: {
        id: 'fish',
        label: 'Koi',
        baseValue: 1,
        baseSpeed: 1.0,    // multiplier on BASE_ANIMAL_SPEED
        rollWeight: 1.0,
        color: 'koi',
    },
    // Placeholder stubs — art / behaviour will be injected in later commits
    frog:       { id: 'frog',       label: 'Frog',      baseValue: 3,  baseSpeed: 1.1, rollWeight: 0, color: 'frog' },
    turtle:     { id: 'turtle',     label: 'Turtle',    baseValue: 8,  baseSpeed: 0.55, rollWeight: 0, color: 'turtle' },
    lilypad:    { id: 'lilypad',    label: 'Lily Pad',  baseValue: 5,  baseSpeed: 0.85, rollWeight: 0, color: 'lilypad' },
    rareBig:    { id: 'rareBig',    label: 'Visitor',   baseValue: 50, baseSpeed: 0.4, rollWeight: 0, color: 'rare' },
};

// Pick an animal type based on the weight table.
function rollAnimalType() {
    let total = 0;
    for (const k in ANIMAL_TYPES) total += ANIMAL_TYPES[k].rollWeight;
    let r = Math.random() * total;
    for (const k in ANIMAL_TYPES) {
        r -= ANIMAL_TYPES[k].rollWeight;
        if (r <= 0) return ANIMAL_TYPES[k];
    }
    return ANIMAL_TYPES.fish;
}

// ---- State ----
const animals = [];
let spawnTimer = 0;

// The single "test flow" droplet — separate from animals, no payout
let testDroplet = null;
let lastTestFlowTime = null;

// Rocks placed on the river — stored by their pathT position
let rocks = [];

// Pending rock inventory — from shop purchase, waiting to be placed
let rockInventory = 0;

// ---- Spawn logic ----
function spawnInterval() {
    const lvl = UPGRADES.spawnRate.level || 0;
    return Math.max(0.5, BASE_SPAWN_INTERVAL * Math.pow(0.85, lvl));
}

function tickSpawn(dt) {
    if (!river || !roundStarted) return;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnAnimal();
        spawnTimer = spawnInterval();
    }
}

function spawnAnimal(forcedType) {
    if (!river) return;
    if (animals.length >= MAX_ANIMALS) return;
    const type = forcedType || rollAnimalType();
    animals.push({
        type: type.id,
        pathT: 0,
        speed: BASE_ANIMAL_SPEED * type.baseSpeed,
        flowTime: 0,
        side: (Math.random() - 0.5) * 0.5,
        wobble: Math.random() * Math.PI * 2,
    });
}

// ---- Test droplet ----
function startTestFlow() {
    if (!river) return;
    testDroplet = { pathT: 0, flowTime: 0 };
}
function cancelTestFlow() {
    testDroplet = null;
}

// ---- Per-frame update ----
function updateFlow(dt) {
    if (!river) return;
    const total = river.totalLen;

    // Test droplet
    if (testDroplet) {
        const spd = applyRockSlowdown(testDroplet.pathT, BASE_ANIMAL_SPEED);
        testDroplet.pathT += (spd / total) * dt;
        testDroplet.flowTime += dt;
        if (testDroplet.pathT >= 1) {
            lastTestFlowTime = testDroplet.flowTime;
            testDroplet = null;
            if (typeof notify === 'function') {
                notify('Flow time: ' + lastTestFlowTime.toFixed(1) + 's');
            }
        }
    }

    // Real animals
    for (let i = animals.length - 1; i >= 0; i--) {
        const a = animals[i];
        const type = ANIMAL_TYPES[a.type] || ANIMAL_TYPES.fish;
        const baseSpd = BASE_ANIMAL_SPEED * type.baseSpeed;
        const spd = applyRockSlowdown(a.pathT, baseSpd);
        a.pathT += (spd / total) * dt;
        a.flowTime += dt;
        a.wobble += dt * 3;
        if (a.pathT >= 1) {
            onAnimalCollected(a);
            animals.splice(i, 1);
        }
    }
}

// Return effective speed given a list of rocks near this pathT
function applyRockSlowdown(t, baseSpeed) {
    for (const rk of rocks) {
        if (Math.abs(t - rk.pathT) < ROCK_SLOW_RANGE_T) {
            return baseSpeed * ROCK_SLOW_FACTOR;
        }
    }
    return baseSpeed;
}

// ---- Rocks ----
function placeRockAtPoint(sx, sy) {
    if (!river) return false;
    if (rockInventory <= 0) return false;
    // Find the nearest pathT position on the river to (sx, sy)
    const target = projectOntoRiver(sx, sy);
    if (!target || target.dist > 35) return false;
    rocks.push({ pathT: target.t });
    rockInventory--;
    saveGame();
    return true;
}
function projectOntoRiver(x, y) {
    if (!river || river.pts.length < 2) return null;
    let bestDist = Infinity;
    let bestT = 0;
    let acc = 0;
    for (let i = 1; i < river.pts.length; i++) {
        const a = river.pts[i - 1], b = river.pts[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        let k = 0;
        if (lenSq > 0) {
            k = ((x - a.x) * dx + (y - a.y) * dy) / lenSq;
            if (k < 0) k = 0;
            if (k > 1) k = 1;
        }
        const px = a.x + dx * k;
        const py = a.y + dy * k;
        const pd = (x - px) ** 2 + (y - py) ** 2;
        if (pd < bestDist) {
            bestDist = pd;
            const segLen = Math.sqrt(lenSq);
            bestT = (acc + segLen * k) / river.totalLen;
        }
        acc += Math.sqrt(lenSq);
    }
    return { t: bestT, dist: Math.sqrt(bestDist) };
}

// ---- Rendering ----
function drawAnimals() {
    if (!river) return;
    for (const a of animals) {
        const p = pointAtPathT(river, a.pathT);
        const off = a.side * river.width * 0.35;
        const x = p.x + Math.cos(p.angle + Math.PI / 2) * off;
        const y = p.y + Math.sin(p.angle + Math.PI / 2) * off;
        const wig = Math.sin(a.wobble) * 0.3;
        drawKoi(x, y, p.angle + wig);
    }
}

function drawTestDroplet() {
    if (!testDroplet || !river) return;
    const p = pointAtPathT(river, testDroplet.pathT);
    // Glow
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 22);
    glow.addColorStop(0, 'rgba(200, 240, 255, 0.7)');
    glow.addColorStop(1, 'rgba(200, 240, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
    ctx.fill();
    // Core
    ctx.fillStyle = '#d8f4ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x - 1.4, p.y - 1.4, 2.2, 0, Math.PI * 2);
    ctx.fill();
}

function drawKoi(x, y, angle) {
    const scale = getViewScale();
    const len = 10 * scale;
    const wid = 5 * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0.5, 1, len, wid * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body — cream koi
    const g = ctx.createLinearGradient(-len, -wid, len, wid);
    g.addColorStop(0, PALETTE.koiBody);
    g.addColorStop(1, '#e8dcc0');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
    ctx.fill();
    // Orange spots
    ctx.fillStyle = PALETTE.koiSpot;
    ctx.beginPath();
    ctx.ellipse(-len * 0.3, -wid * 0.25, len * 0.35, wid * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(len * 0.15, wid * 0.2, len * 0.3, wid * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tail
    ctx.fillStyle = PALETTE.koiBody;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(-len * 1.6, -wid * 0.7);
    ctx.lineTo(-len * 1.6, wid * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(214, 90, 42, 0.7)';
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(-len * 1.5, -wid * 0.4);
    ctx.lineTo(-len * 1.5, wid * 0.4);
    ctx.closePath();
    ctx.fill();
    // Eye
    ctx.fillStyle = '#1a1a20';
    ctx.beginPath();
    ctx.arc(len * 0.55, -wid * 0.2, wid * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawRocks() {
    if (!river) return;
    const scale = getViewScale();
    for (const rk of rocks) {
        const p = pointAtPathT(river, rk.pathT);
        const r = 9 * scale;
        // Dark base
        ctx.fillStyle = PALETTE.stoneDark;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + r * 0.2, r * 1.1, r * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        // Lighter cap
        ctx.fillStyle = PALETTE.stoneMid;
        ctx.beginPath();
        ctx.ellipse(p.x - r * 0.15, p.y - r * 0.1, r * 0.95, r * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.stoneLight;
        ctx.beginPath();
        ctx.ellipse(p.x - r * 0.25, p.y - r * 0.25, r * 0.55, r * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        // Moss on top
        ctx.fillStyle = PALETTE.mossLight;
        ctx.beginPath();
        ctx.ellipse(p.x - r * 0.2, p.y - r * 0.45, r * 0.75, r * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        // Small foam eddies where water hits
        ctx.strokeStyle = 'rgba(240, 248, 251, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x + r * 0.6, p.y, r * 0.8, -0.5, 0.5);
        ctx.stroke();
    }
}

// Reset flow state (used at round start or after resetAllProgress)
function resetFlow() {
    animals.length = 0;
    testDroplet = null;
    lastTestFlowTime = null;
    spawnTimer = spawnInterval();
}
