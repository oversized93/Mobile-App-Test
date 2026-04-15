// ============================================================
//  INK — Player-drawn freehand lines (sumi-ink on sand)
// ============================================================
//
//  Each line is an array of world-space points { x, y } plus its
//  total length. Collision treats consecutive points as line
//  segments. The player draws by dragging; taps (without drag)
//  erase the nearest line.

const INK_MIN_POINT_DIST = 3;     // px between consecutive points
const INK_MIN_LINE_LENGTH = 16;   // shorter = discard (stray tap)
const INK_ERASE_RADIUS = 18;      // tap-to-erase tolerance

let lines = [];          // committed lines: { pts, len }
let currentLine = null;  // line currently being drawn

function startLine(x, y) {
    currentLine = { pts: [{ x, y }], len: 0 };
}

function extendLine(x, y) {
    if (!currentLine) return;
    const last = currentLine.pts[currentLine.pts.length - 1];
    const dx = x - last.x, dy = y - last.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < INK_MIN_POINT_DIST) return;
    // Respect ink budget — stop adding points when we would exceed it
    if (currentLine.len + d > getInkRemaining()) return;
    currentLine.pts.push({ x, y });
    currentLine.len += d;
}

function commitLine() {
    if (!currentLine) return false;
    if (currentLine.len >= INK_MIN_LINE_LENGTH) {
        lines.push(currentLine);
        currentLine = null;
        saveGame();
        return true;
    }
    currentLine = null;
    return false;
}

function cancelLine() {
    currentLine = null;
}

function eraseLineNear(x, y) {
    const rSq = INK_ERASE_RADIUS * INK_ERASE_RADIUS;
    for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        for (let j = 0; j < l.pts.length - 1; j++) {
            const a = l.pts[j], b = l.pts[j + 1];
            const cp = closestPointOnSegment(a.x, a.y, b.x, b.y, x, y);
            const dx = x - cp.x, dy = y - cp.y;
            if (dx * dx + dy * dy < rSq) {
                lines.splice(i, 1);
                saveGame();
                return true;
            }
        }
    }
    return false;
}

// ---- Drawing ----
function strokeLinePath(pts, width, color) {
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

function drawInkLine(line, opts = {}) {
    if (!line || line.pts.length < 2) return;
    // Soft shadow offset down-right
    ctx.save();
    ctx.translate(1, 1.5);
    strokeLinePath(line.pts, 5, PALETTE.inkShadow);
    ctx.restore();
    // Main ink stroke
    strokeLinePath(line.pts, 3.5, opts.preview ? 'rgba(40, 24, 12, 0.65)' : PALETTE.ink);
    // Subtle highlight along the stroke for a wet-ink shine
    strokeLinePath(line.pts, 1, 'rgba(255, 240, 210, 0.22)');
}

function drawAllInk() {
    for (const l of lines) drawInkLine(l);
    if (currentLine) drawInkLine(currentLine, { preview: true });
}
