// ============================================================
//  PHYSICS — Marble motion, segment collision, spawn/despawn
// ============================================================

const GRAVITY = 480;       // px / s²
const RESTITUTION = 0.55;  // energy kept after a bounce (normal)
const TANGENT_FRICTION = 0.88; // energy kept along the tangent
const MARBLE_RADIUS = 9;
const MAX_MARBLES = 20;

// Fixed board features — positions computed from grid
let spawnerCell = { col: 4, row: 0 };
let collectorCell = { col: 10, row: 10 };

function recomputeBoardAnchors() {
    spawnerCell.col = Math.max(1, Math.floor(gridCols() / 2) - 4);
    spawnerCell.row = 0;
    collectorCell.col = Math.max(2, gridCols() - 3);
    collectorCell.row = gridRows() - 1;
}

// World position of the spawner drop point
function spawnerPos() {
    const p = cellToWorld(spawnerCell.col, spawnerCell.row);
    return { x: p.x + CELL / 2, y: p.y + CELL / 2 };
}
// World rect for the collector (2 cells wide × 1 cell tall)
function collectorRect() {
    const p = cellToWorld(collectorCell.col, collectorCell.row);
    return { x: p.x, y: p.y, w: CELL * 2, h: CELL };
}

// Marble list
const marbles = [];
const trails = []; // fading points for ASMR vibes

function spawnMarble() {
    if (marbles.length >= MAX_MARBLES) return;
    const s = spawnerPos();
    marbles.push({
        x: s.x + (Math.random() * 4 - 2), // tiny jitter
        y: s.y + 8,
        vx: 0,
        vy: 0,
        r: MARBLE_RADIUS,
        life: 0
    });
}

// Closest point on line segment (ax,ay)-(bx,by) to point (px,py)
function closestPointOnSegment(ax, ay, bx, by, px, py) {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    let t = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return { x: ax + abx * t, y: ay + aby * t };
}

function collideMarbleWithSegments(m, segments) {
    for (const s of segments) {
        const p = closestPointOnSegment(s.ax, s.ay, s.bx, s.by, m.x, m.y);
        const dx = m.x - p.x, dy = m.y - p.y;
        const d2 = dx * dx + dy * dy;
        const r2 = m.r * m.r;
        if (d2 < r2 && d2 > 0.0001) {
            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d;
            // Push marble out of the segment
            const overlap = m.r - d;
            m.x += nx * overlap;
            m.y += ny * overlap;
            // Reflect velocity along the normal
            const vn = m.vx * nx + m.vy * ny;
            if (vn < 0) {
                // Decompose velocity into normal + tangent and apply restitution / friction
                const vnx = vn * nx, vny = vn * ny;
                const vtx = m.vx - vnx, vty = m.vy - vny;
                m.vx = vtx * TANGENT_FRICTION - vnx * RESTITUTION;
                m.vy = vty * TANGENT_FRICTION - vny * RESTITUTION;
            }
        }
    }
}

function collideMarbleWithCollector(m) {
    const r = collectorRect();
    if (m.x + m.r > r.x && m.x - m.r < r.x + r.w &&
        m.y + m.r > r.y && m.y - m.r < r.y + r.h) {
        return true;
    }
    return false;
}

// Update all marbles. dt in seconds.
function updateMarbles(dt) {
    // Build all segments once per frame
    const segs = [];
    for (const p of placedPieces) {
        const ps = pieceSegments(p);
        for (const s of ps) segs.push(s);
    }

    // Side walls of the grid
    const ox = gridOriginX(), oy = gridOriginY();
    const gw = gridCols() * CELL, gh = gridRows() * CELL;
    segs.push({ ax: ox,          ay: oy,        bx: ox,          by: oy + gh });
    segs.push({ ax: ox + gw,     ay: oy,        bx: ox + gw,     by: oy + gh });

    for (let i = marbles.length - 1; i >= 0; i--) {
        const m = marbles[i];
        m.life += dt;

        // Sub-step to avoid tunneling through thin segments
        const speed = Math.sqrt(m.vx * m.vx + m.vy * m.vy) + Math.abs(GRAVITY * dt);
        const steps = Math.max(1, Math.ceil(speed * dt / 3));
        const sdt = dt / steps;
        for (let s = 0; s < steps; s++) {
            m.vy += GRAVITY * sdt;
            m.x += m.vx * sdt;
            m.y += m.vy * sdt;
            collideMarbleWithSegments(m, segs);
        }

        // Trail point
        if (m.life * 60 % 2 < 1) {
            trails.push({ x: m.x, y: m.y, a: 0.45 });
            if (trails.length > 300) trails.shift();
        }

        // Collector
        if (collideMarbleWithCollector(m)) {
            onMarbleCollected(m);
            marbles.splice(i, 1);
            continue;
        }

        // Falls off the board — despawn silently
        if (m.y > gridOriginY() + gridRows() * CELL + 60) {
            marbles.splice(i, 1);
            continue;
        }
    }

    // Fade trails
    for (let i = trails.length - 1; i >= 0; i--) {
        trails[i].a -= dt * 0.9;
        if (trails[i].a <= 0) trails.splice(i, 1);
    }
}

// ---- Drawing ----
function drawSpawner() {
    const s = spawnerPos();
    ctx.save();
    // Pulse ring
    const pulse = 1 + Math.sin(performance.now() / 380) * 0.12;
    ctx.fillStyle = 'rgba(109,217,255,0.15)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 18 * pulse, 0, Math.PI * 2);
    ctx.fill();
    // Core
    ctx.fillStyle = PALETTE.spawner;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(s.x - 2, s.y - 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawCollector() {
    const r = collectorRect();
    ctx.save();
    // Soft glow underlay
    const glow = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 0, r.x + r.w / 2, r.y + r.h / 2, r.w);
    glow.addColorStop(0, 'rgba(180,245,200,0.35)');
    glow.addColorStop(1, 'rgba(180,245,200,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(r.x - r.w / 2, r.y - r.h, r.w * 2, r.h * 3);
    // Basket body
    ctx.fillStyle = 'rgba(180,245,200,0.18)';
    roundRect(r.x + 3, r.y + 4, r.w - 6, r.h - 8, 6);
    ctx.fill();
    ctx.strokeStyle = PALETTE.collector;
    ctx.lineWidth = 2;
    roundRect(r.x + 3, r.y + 4, r.w - 6, r.h - 8, 6);
    ctx.stroke();
    // $ label
    ctx.fillStyle = PALETTE.collector;
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.restore();
}

function drawMarbles() {
    // Trails first
    for (const t of trails) {
        ctx.fillStyle = `rgba(180,245,200,${t.a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    for (const m of marbles) {
        // Soft shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(m.x + 1, m.y + 2, m.r, m.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        // Body
        const g = ctx.createRadialGradient(m.x - 3, m.y - 3, 1, m.x, m.y, m.r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#a0c8e0');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
        // Shine
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(m.x - m.r * 0.35, m.y - m.r * 0.35, m.r * 0.3, 0, Math.PI * 2);
        ctx.fill();
    }
}
