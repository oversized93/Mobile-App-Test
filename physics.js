// ============================================================
//  PHYSICS — Marble motion, segment collision, spawn/despawn
// ============================================================

const GRAVITY = 480;           // px / s²
const RESTITUTION = 0.55;      // energy kept after a bounce (normal component)
const TANGENT_FRICTION = 0.88; // energy kept along the tangent
const MARBLE_RADIUS = 5;       // scaled 50% from original — twice the play area
const MAX_MARBLES = 30;        // generous ceiling for idle mechanics later

// Board anchors in pixel space — recomputed on resize
let spawner = { x: 0, y: 0 };
let collector = { x: 0, y: 0, w: 64, h: 18 };

function recomputeBoardAnchors() {
    spawner.x = Math.max(70, Math.round(W() * 0.18));
    spawner.y = 92;
    collector.w = 64;
    collector.h = 18;
    collector.x = W() - 24 - collector.w;
    collector.y = Math.max(200, H() - 180);
}

// ---- Marble state ----
const marbles = [];
const trails = []; // fading trail points

function spawnMarble() {
    if (marbles.length >= MAX_MARBLES) return;
    marbles.push({
        x: spawner.x + (Math.random() * 3 - 1.5),
        y: spawner.y + 6,
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
            // Push out of the segment
            const overlap = m.r - d;
            m.x += nx * overlap;
            m.y += ny * overlap;
            // Reflect velocity along the normal
            const vn = m.vx * nx + m.vy * ny;
            if (vn < 0) {
                const vnx = vn * nx, vny = vn * ny;
                const vtx = m.vx - vnx, vty = m.vy - vny;
                m.vx = vtx * TANGENT_FRICTION - vnx * RESTITUTION;
                m.vy = vty * TANGENT_FRICTION - vny * RESTITUTION;
            }
        }
    }
}

function collideMarbleWithCollector(m) {
    const r = collector;
    if (m.x + m.r > r.x && m.x - m.r < r.x + r.w &&
        m.y + m.r > r.y && m.y - m.r < r.y + r.h) {
        return true;
    }
    return false;
}

function buildActiveSegments() {
    const segs = [];
    // Committed ink lines
    for (const l of lines) {
        for (let i = 0; i < l.pts.length - 1; i++) {
            const a = l.pts[i], b = l.pts[i + 1];
            segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
        }
    }
    // The line currently being drawn also collides (immediate feedback)
    if (currentLine) {
        for (let i = 0; i < currentLine.pts.length - 1; i++) {
            const a = currentLine.pts[i], b = currentLine.pts[i + 1];
            segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
        }
    }
    // Side walls of the play area
    const playTop = 70;
    const playBottom = H() - 120;
    segs.push({ ax: 0,   ay: playTop, bx: 0,   by: playBottom });
    segs.push({ ax: W(), ay: playTop, bx: W(), by: playBottom });
    return segs;
}

function updateMarbles(dt) {
    const segs = buildActiveSegments();

    for (let i = marbles.length - 1; i >= 0; i--) {
        const m = marbles[i];
        m.life += dt;

        const speed = Math.sqrt(m.vx * m.vx + m.vy * m.vy) + Math.abs(GRAVITY * dt);
        const steps = Math.max(1, Math.ceil(speed * dt / 2.5));
        const sdt = dt / steps;
        for (let s = 0; s < steps; s++) {
            m.vy += GRAVITY * sdt;
            m.x += m.vx * sdt;
            m.y += m.vy * sdt;
            collideMarbleWithSegments(m, segs);
        }

        // Trail points
        if ((m.life * 120) % 2 < 1) {
            trails.push({ x: m.x, y: m.y, a: 0.4 });
            if (trails.length > 500) trails.shift();
        }

        // Collected
        if (collideMarbleWithCollector(m)) {
            onMarbleCollected(m);
            marbles.splice(i, 1);
            continue;
        }

        // Off board
        if (m.y > H() - 90 || m.x < -20 || m.x > W() + 20) {
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
    ctx.save();
    const pulse = 1 + Math.sin(performance.now() / 460) * 0.1;
    // Bamboo rim glow
    ctx.fillStyle = 'rgba(122, 140, 77, 0.22)';
    ctx.beginPath();
    ctx.arc(spawner.x, spawner.y, 13 * pulse, 0, Math.PI * 2);
    ctx.fill();
    // Stone rim
    ctx.fillStyle = 'rgba(40, 28, 18, 0.6)';
    ctx.beginPath();
    ctx.arc(spawner.x, spawner.y, 8, 0, Math.PI * 2);
    ctx.fill();
    // Bamboo core
    ctx.fillStyle = PALETTE.spawner;
    ctx.beginPath();
    ctx.arc(spawner.x, spawner.y, 6, 0, Math.PI * 2);
    ctx.fill();
    // Shine
    ctx.fillStyle = 'rgba(255, 250, 200, 0.55)';
    ctx.beginPath();
    ctx.arc(spawner.x - 1.5, spawner.y - 1.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawCollector() {
    const r = collector;
    ctx.save();
    // Pond glow below
    const glow = ctx.createRadialGradient(
        r.x + r.w / 2, r.y + r.h / 2, 0,
        r.x + r.w / 2, r.y + r.h / 2, r.w
    );
    glow.addColorStop(0, 'rgba(74, 107, 140, 0.35)');
    glow.addColorStop(1, 'rgba(74, 107, 140, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(r.x - r.w / 2, r.y - r.h, r.w * 2, r.h * 3);
    // Wooden bowl outer
    ctx.fillStyle = PALETTE.collector;
    roundRect(r.x, r.y, r.w, r.h, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 36, 18, 0.7)';
    ctx.lineWidth = 1.5;
    roundRect(r.x, r.y, r.w, r.h, 4);
    ctx.stroke();
    // Water inside
    const pondGrad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    pondGrad.addColorStop(0, '#6a90b0');
    pondGrad.addColorStop(1, '#3a587a');
    ctx.fillStyle = pondGrad;
    roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 3);
    ctx.fill();
    // Water shimmer
    ctx.strokeStyle = 'rgba(220, 240, 250, 0.4)';
    ctx.lineWidth = 0.6;
    const shimmerY = r.y + 3 + Math.sin(performance.now() / 600) * 1.5 + r.h * 0.3;
    ctx.beginPath();
    ctx.moveTo(r.x + 6, shimmerY);
    ctx.lineTo(r.x + r.w - 6, shimmerY);
    ctx.stroke();
    ctx.restore();
}

function drawMarbles() {
    // Trail
    for (const t of trails) {
        ctx.fillStyle = `rgba(60, 42, 24, ${t.a * 0.5})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }
    // Stones
    for (const m of marbles) {
        // Shadow
        ctx.fillStyle = 'rgba(30, 18, 8, 0.35)';
        ctx.beginPath();
        ctx.ellipse(m.x + 0.5, m.y + 1.2, m.r, m.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        // Body — smooth river stone gradient
        const g = ctx.createRadialGradient(m.x - 1.4, m.y - 1.4, 0.5, m.x, m.y, m.r);
        g.addColorStop(0, PALETTE.stoneHi);
        g.addColorStop(0.55, '#5a6670');
        g.addColorStop(1, '#2a323a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
        // Shine
        ctx.fillStyle = 'rgba(230, 238, 245, 0.8)';
        ctx.beginPath();
        ctx.arc(m.x - m.r * 0.32, m.y - m.r * 0.32, m.r * 0.28, 0, Math.PI * 2);
        ctx.fill();
    }
}
