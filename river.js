// ============================================================
//  RIVER — Drawing the river polyline, rendering the water,
//  plus source spring and outlet pond decorations.
// ============================================================

const RIVER_MIN_PT_DIST = 3;         // px between stored points
const RIVER_BASE_WIDTH = 34;         // base river width (level 0)

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

function drawRiver() {
    if (draftRiver && draftRiver.pts.length >= 2) {
        // Draft preview — slightly translucent
        strokeRiverLayer(draftRiver.pts, draftRiver.width + 4, 'rgba(20, 40, 55, 0.55)');
        strokeRiverLayer(draftRiver.pts, draftRiver.width,     'rgba(74, 143, 181, 0.75)');
        strokeRiverLayer(draftRiver.pts, draftRiver.width * 0.55, 'rgba(165, 216, 232, 0.85)');
        strokeRiverLayer(draftRiver.pts, draftRiver.width * 0.25, 'rgba(240, 248, 251, 0.9)');
    }
    if (!river || river.pts.length < 2) return;

    // Dark edge — wet ground around the water
    strokeRiverLayer(river.pts, river.width + 6, 'rgba(18, 30, 10, 0.45)');
    // Deep bed
    strokeRiverLayer(river.pts, river.width, PALETTE.riverDeep);
    // Mid surface
    strokeRiverLayer(river.pts, river.width * 0.72, PALETTE.riverMid);
    // Bright highlight stripe
    strokeRiverLayer(river.pts, river.width * 0.42, PALETTE.riverBright);
    // Thin white center
    strokeRiverLayer(river.pts, river.width * 0.18, PALETTE.foam);

    // Animated foam flecks sliding along the current (depth-ordered, small)
    const now = performance.now() / 1000;
    const flecks = 14;
    for (let i = 0; i < flecks; i++) {
        const phase = ((now * 0.25) + i / flecks) % 1;
        const p = pointAtPathT(river, phase);
        // Small perpendicular offset for organic feel
        const off = Math.sin(now * 2 + i) * river.width * 0.18;
        const px = p.x + Math.cos(p.angle + Math.PI / 2) * off;
        const py = p.y + Math.sin(p.angle + Math.PI / 2) * off;
        const alpha = 0.7 * Math.min(1, phase * 2, (1 - phase) * 3);
        ctx.fillStyle = `rgba(240, 248, 251, ${alpha})`;
        ctx.beginPath();
        ctx.ellipse(px, py, 2.2, 1, p.angle, 0, Math.PI * 2);
        ctx.fill();
    }
}
