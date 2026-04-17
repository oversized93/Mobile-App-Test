// ============================================================
//  RIVER — Drawing the river polyline, rendering the water,
//  plus source spring and outlet pond decorations.
// ============================================================

const RIVER_MIN_PT_DIST = 3;         // px between stored points
const RIVER_BASE_WIDTH = 66;        // halved for thinner rivers that can be drawn side-by-side

let rivers = [];              // committed rivers: [{ pts, width, totalLen, samples, particles }, ...]
let draftRiver = null;       // in-progress during drag
const OVERLAP_MIN_DIST_FACTOR = 0.92; // rivers can almost touch but not overlap

// ---- Visual scale from the Expand Garden upgrade ----
function getViewScale() {
    const lvl = UPGRADES.expandGarden.level || 0;
    return Math.max(0.45, Math.pow(0.82, lvl));
}

function getRiverWidth() {
    const widthBonus = typeof getRiverWidthBonus === 'function' ? getRiverWidthBonus() : 1;
    return RIVER_BASE_WIDTH * getViewScale() * widthBonus;
}

// ---- Drawing lifecycle ----
function startDraftRiver(x, y) {
    draftRiver = { pts: [{ x, y }], width: getRiverWidth(), totalLen: 0 };
}
function extendDraftRiver(x, y) {
    if (!draftRiver) return;
    const last = draftRiver.pts[draftRiver.pts.length - 1];
    const dx = x - last.x, dy = y - last.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < RIVER_MIN_PT_DIST) return;
    // Overlap check: reject points too close to any existing river
    const minDist = getRiverWidth() * OVERLAP_MIN_DIST_FACTOR;
    if (isPointTooCloseToRivers(x, y, minDist)) return;
    draftRiver.pts.push({ x, y });
    draftRiver.totalLen += d;
}

function isPointTooCloseToRivers(x, y, minDist) {
    const md2 = minDist * minDist;
    for (const r of rivers) {
        // Check every 4th point for performance (polyline is dense after smoothing)
        for (let i = 0; i < r.pts.length; i += 4) {
            const dx = x - r.pts[i].x, dy = y - r.pts[i].y;
            if (dx * dx + dy * dy < md2) return true;
        }
    }
    return false;
}
function commitDraftRiver() {
    if (!draftRiver || draftRiver.pts.length < 3) {
        draftRiver = null;
        return false;
    }
    // Require last point to be inside the outlet zone (reaches the pond)
    const outlet = outletZoneRect();
    const last = draftRiver.pts[draftRiver.pts.length - 1];
    if (last.y < outlet.y) {
        draftRiver = null;
        return false;
    }
    const newRiver = draftRiver;
    draftRiver = null;
    newRiver.pts = smoothPolyline(newRiver.pts, 2);
    newRiver.totalLen = riverTotalLength(newRiver);
    // Pre-compute per-river samples and particles
    newRiver.samples = buildSamplesForRiver(newRiver);
    newRiver.particles = generateParticlesForRiver(newRiver);
    rivers.push(newRiver);
    saveGame();
    return true;
}
function cancelDraftRiver() {
    draftRiver = null;
}
function clearAllRivers() {
    rivers = [];
    riverSamples = [];
    waterParticles = [];
    saveGame();
}

// ---- Helpers ----
function riverTotalLength(r) {
    let len = 0;
    for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        len += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    }
    return len;
}

// Given a pathT (0..1), return the world-space point along the river polyline.
function pointAtPathT(r, t) {
    if (!r || r.pts.length < 2) return { x: 0, y: 0, angle: 0 };
    const target = t * r.totalLen;
    let acc = 0;
    for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const seg = Math.sqrt(dx * dx + dy * dy);
        if (acc + seg >= target || i === r.pts.length - 1) {
            const k = seg > 0 ? (target - acc) / seg : 0;
            return {
                x: a.x + dx * k,
                y: a.y + dy * k,
                angle: Math.atan2(dy, dx)
            };
        }
        acc += seg;
    }
    const last = r.pts[r.pts.length - 1];
    return { x: last.x, y: last.y, angle: 0 };
}

// ---- Source spring (top) ----
function drawSourceSpring() {
    const s = sourceZoneRect();
    const op = springOpeningRect();
    // Ground highlight on either side (moss-covered banks)
    ctx.fillStyle = 'rgba(30, 60, 20, 0.4)';
    ctx.fillRect(0, s.y, W(), s.h);
    // Soft moss ring across the source zone
    const g = ctx.createLinearGradient(0, s.y, 0, s.y + s.h);
    g.addColorStop(0, 'rgba(122, 179, 88, 0.18)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, s.y, W(), s.h);

    // Two stone outcroppings framing the opening
    drawStoneOutcrop(op.x - 34, op.y + op.h * 0.5 - 10, 52, 36);
    drawStoneOutcrop(op.x + op.w - 18, op.y + op.h * 0.5 - 10, 52, 36);

    // Spring pool (where water emerges) — darker stone basin
    const poolX = op.x + op.w * 0.5;
    const poolY = op.y + op.h * 0.5;
    ctx.fillStyle = PALETTE.stoneDark;
    ctx.beginPath();
    ctx.ellipse(poolX, poolY + 2, op.w * 0.5, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.riverDeep;
    ctx.beginPath();
    ctx.ellipse(poolX, poolY, op.w * 0.44, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.riverMid;
    ctx.beginPath();
    ctx.ellipse(poolX, poolY - 1, op.w * 0.38, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.riverBright;
    ctx.beginPath();
    ctx.ellipse(poolX, poolY - 2, op.w * 0.28, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Animated sparkle on the spring
    const t = performance.now() / 400;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.beginPath();
    ctx.arc(poolX + Math.sin(t) * 8, poolY - 1, 1.6, 0, Math.PI * 2);
    ctx.fill();
}

function drawStoneOutcrop(cx, cy, w, h) {
    ctx.save();
    // Main stone body
    ctx.fillStyle = PALETTE.stoneDark;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, w * 0.5, h * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.stoneMid;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.47, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.stoneLight;
    ctx.beginPath();
    ctx.ellipse(cx - 2, cy - 3, w * 0.35, h * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // Moss cap on top
    ctx.fillStyle = PALETTE.mossDark;
    ctx.beginPath();
    ctx.ellipse(cx, cy - h * 0.3, w * 0.42, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.mossLight;
    ctx.beginPath();
    ctx.ellipse(cx - 1, cy - h * 0.35, w * 0.35, h * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    // Small grass blades on top of moss
    ctx.strokeStyle = 'rgba(90, 135, 52, 0.8)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
        ctx.moveTo(cx + i * 4, cy - h * 0.35);
        ctx.lineTo(cx + i * 4 + 1, cy - h * 0.55);
    }
    ctx.stroke();
    ctx.restore();
}

// ---- Outlet pond (bottom) ----
function drawOutletPond() {
    const p = pondRect();
    ctx.save();
    // Dark earth ring around the pond
    ctx.fillStyle = 'rgba(20, 40, 14, 0.55)';
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2 + 2, p.w * 0.52, p.h * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    // Stone rim
    ctx.fillStyle = PALETTE.stoneDark;
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, p.w * 0.48, p.h * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    // Deep pond water
    ctx.fillStyle = PALETTE.pondDeep;
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, p.w * 0.43, p.h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Surface sheen
    const sg = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
    sg.addColorStop(0, 'rgba(164, 200, 216, 0.55)');
    sg.addColorStop(1, 'rgba(60, 90, 110, 0.15)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, p.w * 0.41, p.h * 0.47, 0, 0, Math.PI * 2);
    ctx.fill();

    // Lily pads
    const pads = [
        { dx: -p.w * 0.22, dy: -p.h * 0.1, r: 9 },
        { dx:  p.w * 0.18, dy:  p.h * 0.08, r: 8 },
        { dx: -p.w * 0.05, dy:  p.h * 0.14, r: 6 },
    ];
    for (const pad of pads) {
        const px = p.x + p.w / 2 + pad.dx;
        const py = p.y + p.h / 2 + pad.dy;
        ctx.fillStyle = PALETTE.mossDark;
        ctx.beginPath();
        ctx.ellipse(px, py + 1, pad.r, pad.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.lily;
        ctx.beginPath();
        ctx.arc(px, py, pad.r, 0.2, Math.PI * 2 - 0.4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(40, 80, 20, 0.4)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + pad.r * 0.8, py - pad.r * 0.2);
        ctx.moveTo(px, py);
        ctx.lineTo(px - pad.r * 0.7, py + pad.r * 0.3);
        ctx.stroke();
    }

    // Subtle animated ripple rings
    const t = performance.now() / 800;
    ctx.strokeStyle = 'rgba(220, 240, 250, 0.22)';
    ctx.lineWidth = 1;
    const rippleR = (t % 1) * p.w * 0.3;
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, rippleR, rippleR * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

// ---- Polyline smoothing (Chaikin corner-cutting) ----
function smoothPolyline(pts, iterations) {
    let result = pts;
    for (let iter = 0; iter < iterations; iter++) {
        const s = [result[0]];
        for (let i = 0; i < result.length - 1; i++) {
            const a = result[i], b = result[i + 1];
            s.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
            s.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
        }
        s.push(result[result.length - 1]);
        result = s;
    }
    return result;
}

// ---- Compute river bank outlines from the center polyline ----
function computeRiverBanks(pts, halfWidth, wobbleSeed) {
    const left = [], right = [];
    const seed = wobbleSeed || 0;
    for (let i = 0; i < pts.length; i++) {
        let nx, ny;
        if (i === 0) {
            const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            nx = -dy / len; ny = dx / len;
        } else if (i === pts.length - 1) {
            const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            nx = -dy / len; ny = dx / len;
        } else {
            const dx1 = pts[i].x - pts[i - 1].x, dy1 = pts[i].y - pts[i - 1].y;
            const dx2 = pts[i + 1].x - pts[i].x, dy2 = pts[i + 1].y - pts[i].y;
            const l1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
            const l2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
            nx = -(dy1 / l1 + dy2 / l2) / 2;
            ny = (dx1 / l1 + dx2 / l2) / 2;
            const nl = Math.sqrt(nx * nx + ny * ny) || 1;
            nx /= nl; ny /= nl;
        }
        // Organic wobble — slight perpendicular variation for natural shoreline
        const wobble = Math.sin(i * 0.22 + seed) * 3.5 + Math.sin(i * 0.55 + seed * 1.7) * 1.5;
        const wL = halfWidth + wobble;
        const wR = halfWidth - wobble * 0.7;
        left.push({ x: pts[i].x + nx * wL, y: pts[i].y + ny * wL });
        right.push({ x: pts[i].x - nx * wR, y: pts[i].y - ny * wR });
    }
    return { left, right };
}

// ---- Fill a closed river-body polygon from bank outlines ----
function fillRiverPoly(banks, color) {
    ctx.beginPath();
    ctx.moveTo(banks.left[0].x, banks.left[0].y);
    for (let i = 1; i < banks.left.length; i++) ctx.lineTo(banks.left[i].x, banks.left[i].y);
    for (let i = banks.right.length - 1; i >= 0; i--) ctx.lineTo(banks.right[i].x, banks.right[i].y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

function strokeBankLine(bank, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bank[0].x, bank[0].y);
    for (let i = 1; i < bank.length; i++) ctx.lineTo(bank[i].x, bank[i].y);
    ctx.stroke();
}

// ---- Pre-rendered soft circle sprite for efficient particle drawing ----
let _softSprite = null;
function getSoftSprite() {
    if (_softSprite) return _softSprite;
    const size = 48;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    _softSprite = c;
    return c;
}

function drawRiverBody(r, isDraft) {
    const pts = r.pts;
    if (pts.length < 2) return;
    const w = r.width;
    const halfW = w / 2;
    const alpha = isDraft ? 0.72 : 1.0;

    const earthBanks = computeRiverBanks(pts, halfW + 10, 42);
    const banks = computeRiverBanks(pts, halfW + 4, 42);
    const mainBanks = computeRiverBanks(pts, halfW, 42);

    // 1. Wet earth shadow
    ctx.globalAlpha = 0.45 * alpha;
    fillRiverPoly(earthBanks, '#0e1808');
    ctx.globalAlpha = 1;

    // 2. Mossy bank fringe
    ctx.globalAlpha = 0.55 * alpha;
    fillRiverPoly(banks, '#2c4a1a');
    ctx.globalAlpha = 1;

    // 3. DARK river bed — particles will light up the surface on top
    ctx.globalAlpha = alpha;
    fillRiverPoly(mainBanks, '#0e2030');
    ctx.globalAlpha = 1;

    // 4. Bank edge outlines
    if (!isDraft) {
        strokeBankLine(mainBanks.left, 'rgba(18, 35, 12, 0.65)', 2.5);
        strokeBankLine(mainBanks.right, 'rgba(18, 35, 12, 0.65)', 2.5);
    }
}

// ---- Pre-sampled river positions for fast particle lookups ----
let riverSamples = [];

function buildSamplesForRiver(r) {
    if (!r || r.pts.length < 2) return [];
    const count = 400;
    const samples = [];
    for (let i = 0; i < count; i++) {
        samples.push(pointAtPathT(r, i / (count - 1)));
    }
    for (let i = 0; i < count; i++) {
        const back = Math.max(0, i - 12);
        const fwd = Math.min(count - 1, i + 12);
        const dx = samples[fwd].x - samples[back].x;
        const dy = samples[fwd].y - samples[back].y;
        samples[i].angle = Math.atan2(dy, dx);
    }
    return samples;
}
function buildRiverSamples() {
    // Rebuild samples for any river that's missing them (e.g. after load)
    for (const r of rivers) {
        if (!r.samples || r.samples.length === 0) r.samples = buildSamplesForRiver(r);
    }
}

function sampleRiverAt(r, t) {
    const samples = r.samples || [];
    if (samples.length < 2) return pointAtPathT(r, t);
    const idx = Math.max(0, Math.min(1, t)) * (samples.length - 1);
    const i = Math.floor(idx);
    const f = idx - i;
    const a = samples[Math.min(i, samples.length - 1)];
    const b = samples[Math.min(i + 1, samples.length - 1)];
    return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        angle: a.angle + (b.angle - a.angle) * f,
    };
}

// ---- Water particle system ----
let waterParticles = [];

function generateParticlesForRiver(r) {
    const particles = [];
    if (!r) return particles;
    const len = r.totalLen;

    // SURFACE BLOBS — large, very transparent, additive-blended
    // These overlap heavily to create a continuous shimmering water surface
    const surfaceCount = Math.min(180, Math.round(len / 4));
    for (let i = 0; i < surfaceCount; i++) {
        particles.push({
            type: 0,
            pathT: Math.random(),
            side: (Math.random() - 0.5) * 1.8,
            speed: 0.06 + Math.random() * 0.05,
            size: 12 + Math.random() * 14, // LARGE — 12-26px
            alpha: 0.025 + Math.random() * 0.025, // VERY transparent
            phase: Math.random() * Math.PI * 2,
            tint: Math.floor(Math.random() * 3), // 0=blue, 1=cyan, 2=teal
        });
    }
    // DETAIL STREAKS — smaller, faster, follow the current visibly
    const streakCount = Math.min(90, Math.round(len / 6));
    for (let i = 0; i < streakCount; i++) {
        particles.push({
            type: 1,
            pathT: Math.random(),
            side: (Math.random() - 0.5) * 1.5,
            speed: 0.09 + Math.random() * 0.07,
            size: 3 + Math.random() * 4,
            alpha: 0.06 + Math.random() * 0.08,
            phase: Math.random() * Math.PI * 2,
        });
    }
    // CAUSTIC SPOTS — dancing light patches
    const causticCount = Math.min(25, Math.round(len / 20));
    for (let i = 0; i < causticCount; i++) {
        particles.push({
            type: 2,
            pathT: Math.random(),
            side: (Math.random() - 0.5) * 1.2,
            speed: 0.02 + Math.random() * 0.03,
            size: 8 + Math.random() * 10,
            phase: Math.random() * Math.PI * 2,
        });
    }
    // BANK FOAM — white specs near the shore
    const foamCount = Math.min(40, Math.round(len / 12));
    for (let i = 0; i < foamCount; i++) {
        const bankSide = Math.random() < 0.5 ? -1 : 1;
        particles.push({
            type: 3,
            pathT: Math.random(),
            side: bankSide * (0.78 + Math.random() * 0.18),
            speed: 0.005 + Math.random() * 0.015,
            size: 1.5 + Math.random() * 2.5,
            phase: Math.random() * Math.PI * 2,
        });
    }
    return particles;
}
function generateWaterParticles() {
    for (const r of rivers) {
        if (!r.particles || r.particles.length === 0) r.particles = generateParticlesForRiver(r);
    }
}

function updateAndDrawWaterParticlesForRiver(r, dt) {
    if (!r || !r.particles || r.particles.length === 0) return;
    const now = performance.now() / 1000;
    const halfW = r.width * 0.46;
    const sprite = getSoftSprite();
    const spriteHalf = sprite.width / 2;

    // --- Pass 1: surface blobs with additive blending (creates the water body) ---
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tints = [
        [30, 90, 140],  // deep blue
        [50, 130, 160], // cyan
        [35, 110, 120], // teal
    ];
    for (const p of r.particles) {
        if (p.type !== 0) continue;
        p.pathT += p.speed * dt;
        if (p.pathT > 1) { p.pathT -= 1; p.side = (Math.random() - 0.5) * 1.8; }
        p.side += Math.sin(now * 0.5 + p.phase) * 0.004;
        p.side = Math.max(-0.96, Math.min(0.96, p.side));

        const pos = sampleRiverAt(r, p.pathT);
        const nx = Math.cos(pos.angle + Math.PI / 2);
        const ny = Math.sin(pos.angle + Math.PI / 2);
        const x = pos.x + nx * p.side * halfW;
        const y = pos.y + ny * p.side * halfW;
        const pulse = 0.8 + Math.sin(now * 1.5 + p.phase) * 0.2;
        const t = tints[p.tint];
        const a = p.alpha * pulse;
        ctx.globalAlpha = a;
        // Tint the white sprite by drawing a colored rect first, then the sprite on top
        const sz = p.size * 2;
        ctx.fillStyle = 'rgb(' + t[0] + ',' + t[1] + ',' + t[2] + ')';
        ctx.globalAlpha = a * 0.7;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Soft highlight via sprite
        ctx.globalAlpha = a * 0.4;
        ctx.drawImage(sprite, x - spriteHalf, y - spriteHalf, sz, sz);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();

    // --- Pass 2: detail streaks (normal blending, visible current lines) ---
    for (const p of r.particles) {
        if (p.type !== 1) continue;
        p.pathT += p.speed * dt;
        if (p.pathT > 1) { p.pathT -= 1; p.side = (Math.random() - 0.5) * 1.5; }

        const pos = sampleRiverAt(r, p.pathT);
        const nx = Math.cos(pos.angle + Math.PI / 2);
        const ny = Math.sin(pos.angle + Math.PI / 2);
        const x = pos.x + nx * p.side * halfW;
        const y = pos.y + ny * p.side * halfW;
        const a = p.alpha * (0.7 + Math.sin(now * 3 + p.phase) * 0.3);
        ctx.fillStyle = 'rgba(180, 220, 240, ' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.ellipse(x, y, p.size, p.size * 0.4, pos.angle, 0, Math.PI * 2);
        ctx.fill();
    }

    // --- Pass 3: caustic light patches ---
    for (const p of r.particles) {
        if (p.type !== 2) continue;
        p.pathT += p.speed * dt;
        if (p.pathT > 1) { p.pathT -= 1; p.side = (Math.random() - 0.5) * 1.2; }

        const pos = sampleRiverAt(r, p.pathT);
        const nx = Math.cos(pos.angle + Math.PI / 2);
        const ny = Math.sin(pos.angle + Math.PI / 2);
        const x = pos.x + nx * p.side * halfW;
        const y = pos.y + ny * p.side * halfW;
        const pulse = Math.sin(now * 2.8 + p.phase) * 0.5 + 0.5;
        ctx.globalAlpha = 0.08 * pulse;
        ctx.drawImage(sprite, x - p.size, y - p.size, p.size * 2, p.size * 2);
        ctx.globalAlpha = 1;
    }

    // --- Pass 4: bank foam bubbles ---
    for (const p of r.particles) {
        if (p.type !== 3) continue;
        p.pathT += p.speed * dt;
        if (p.pathT > 1) { p.pathT -= 1; p.side = (Math.random() < 0.5 ? -1 : 1) * (0.78 + Math.random() * 0.18); }

        const pos = sampleRiverAt(r, p.pathT);
        const nx = Math.cos(pos.angle + Math.PI / 2);
        const ny = Math.sin(pos.angle + Math.PI / 2);
        const x = pos.x + nx * p.side * halfW;
        const y = pos.y + ny * p.side * halfW;
        const a = 0.3 + Math.sin(now * 2 + p.phase) * 0.15;
        ctx.fillStyle = 'rgba(230, 242, 250, ' + a.toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawRiver() {
    if (draftRiver && draftRiver.pts.length >= 2) {
        // Live preview: light smoothing (1 iteration) for responsive feel
        const preview = {
            pts: smoothPolyline(draftRiver.pts, 1),
            width: draftRiver.width,
            totalLen: draftRiver.totalLen
        };
        drawRiverBody(preview, true);
    }
    if (rivers.length === 0) return;
    buildRiverSamples(); // lazy-init any missing samples
    generateWaterParticles(); // lazy-init any missing particles
    for (const r of rivers) {
        if (r.pts.length >= 2) {
            drawRiverBody(r, false);
            updateAndDrawWaterParticlesForRiver(r, 1 / 60);
        }
    }
}
