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
const INK_ERASE_RADIUS = 18;      // tap-to-erase-whole-line tolerance
const INK_PARTIAL_ERASE_RADIUS = 18; // eraser-mode drag radius

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

// Build a {pts, len} line from a raw point array, recomputing length.
function rebuildLineFromPts(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        len += Math.sqrt(dx * dx + dy * dy);
    }
    return { pts: pts.slice(), len };
}

// Eraser-mode drag: remove any point within `radius` of (x,y).
// Lines are split into multiple sub-lines when a gap forms in the middle.
// Sub-lines shorter than INK_MIN_LINE_LENGTH are dropped (ink refunded).
// Returns true if anything changed.
function eraseAlongPath(x, y, radius) {
    const rSq = radius * radius;
    const next = [];
    let changed = false;
    for (const line of lines) {
        let segment = [];
        let anyRemoved = false;
        for (const p of line.pts) {
            const dx = p.x - x, dy = p.y - y;
            if (dx * dx + dy * dy < rSq) {
                anyRemoved = true;
                if (segment.length >= 2) {
                    const sub = rebuildLineFromPts(segment);
                    if (sub.len >= INK_MIN_LINE_LENGTH) next.push(sub);
                }
                segment = [];
            } else {
                segment.push(p);
            }
        }
        if (anyRemoved) {
            changed = true;
            if (segment.length >= 2) {
                const sub = rebuildLineFromPts(segment);
                if (sub.len >= INK_MIN_LINE_LENGTH) next.push(sub);
            }
        } else {
            next.push(line);
        }
    }
    if (changed) lines = next;
    return changed;
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
