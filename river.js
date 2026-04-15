// ============================================================
//  RIVER — Drawing the river polyline, rendering the water,
//  plus source spring and outlet pond decorations.
// ============================================================

const RIVER_MIN_PT_DIST = 3;         // px between stored points
const RIVER_BASE_WIDTH = 132;        // base river width (3x the original stencil, slightly wider)

let river = null;            // committed river: { pts, width, totalLen }
let draftRiver = null;       // in-progress during drag

// ---- Visual scale from the Expand Garden upgrade ----
function getViewScale() {
    const lvl = UPGRADES.expandGarden.level || 0;
    return Math.max(0.45, Math.pow(0.82, lvl));
}

function getRiverWidth() {
    return RIVER_BASE_WIDTH * getViewScale();
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
    draftRiver.pts.push({ x, y });
    draftRiver.totalLen += d;
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
    river = draftRiver;
    draftRiver = null;
    saveGame();
    return true;
}
function cancelDraftRiver() {
    draftRiver = null;
}
function clearRiver() {
    river = null;
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

// ---- River water rendering ----
function strokeRiverLayer(pts, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
}

function drawRiverBody(r, isDraft) {
    const pts = r.pts;
    const w = r.width;
    const a = isDraft ? 0.72 : 1.0;
    // Dark wet earth ring
    strokeRiverLayer(pts, w + 10, 'rgba(18, 30, 10, ' + (0.42 * a) + ')');
    // Mossy green bank
    strokeRiverLayer(pts, w + 4, 'rgba(60, 100, 40, ' + (0.5 * a) + ')');
    // Deep base turquoise
    strokeRiverLayer(pts, w, 'rgba(34, 82, 108, ' + a + ')');
    // Main surface — one broad turquoise color
    strokeRiverLayer(pts, w * 0.9, 'rgba(70, 148, 180, ' + a + ')');
    // Gentle lighter highlight (not a hard center stripe)
    strokeRiverLayer(pts, w * 0.62, 'rgba(128, 190, 212, ' + (0.65 * a) + ')');
    // Very subtle central shimmer
    strokeRiverLayer(pts, w * 0.32, 'rgba(178, 218, 232, ' + (0.35 * a) + ')');
}

function drawRiverRipples(r) {
    const total = r.totalLen;
    if (!total) return;
    const spacing = 26;
    const count = Math.max(6, Math.floor(total / spacing));
    const now = performance.now() / 1000;

    ctx.strokeStyle = 'rgba(220, 240, 250, 0.22)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
        const phase = ((i / count) + now * 0.055) % 1;
        const p = pointAtPathT(r, phase);
        const nx = Math.cos(p.angle + Math.PI / 2);
        const ny = Math.sin(p.angle + Math.PI / 2);
        // Ripple spans a random fraction of the river width
        const spread = r.width * 0.38 * (0.75 + Math.sin(i * 1.7 + now * 1.3) * 0.2);
        // Offset slightly off-center for organic variation
        const centerOff = Math.sin(i * 2.3 + now * 0.7) * r.width * 0.15;
        const cx = p.x + nx * centerOff;
        const cy = p.y + ny * centerOff;
        ctx.beginPath();
        ctx.moveTo(cx - nx * spread, cy - ny * spread);
        ctx.lineTo(cx + nx * spread, cy + ny * spread);
        ctx.stroke();
    }
}

function drawRiverFoam(r) {
    const now = performance.now() / 1000;
    const count = 18;
    for (let i = 0; i < count; i++) {
        const phase = ((now * 0.22) + i / count) % 1;
        const p = pointAtPathT(r, phase);
        const nx = Math.cos(p.angle + Math.PI / 2);
        const ny = Math.sin(p.angle + Math.PI / 2);
        // Wider side variation so foam occupies the whole river
        const off = Math.sin(now * 1.8 + i * 2.1) * r.width * 0.32 + Math.cos(i * 3.1) * r.width * 0.12;
        const px = p.x + nx * off;
        const py = p.y + ny * off;
        const alpha = 0.55 * Math.min(1, phase * 2, (1 - phase) * 3);
        ctx.fillStyle = 'rgba(240, 248, 251, ' + alpha + ')';
        ctx.beginPath();
        ctx.ellipse(px, py, 2.2, 1, p.angle, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawRiver() {
    if (draftRiver && draftRiver.pts.length >= 2) {
        drawRiverBody(draftRiver, true);
    }
    if (!river || river.pts.length < 2) return;
    drawRiverBody(river, false);
    drawRiverRipples(river);
    drawRiverFoam(river);
}
