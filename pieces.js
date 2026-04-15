// ============================================================
//  PIECES — Track piece definitions (shape as line segments)
// ============================================================
//
//  Each piece is defined in "unit" coordinates where (0,0) is the
//  piece's top-left cell corner and (1,1) is the bottom-right.
//  At render / collision time, these are scaled by CELL.
//
//  A piece can occupy one or more cells (MVP uses 1-cell pieces).
//
//  Shape = array of {x1,y1,x2,y2} line segments (unit coords).
//
//  Rotation: 0°, 90°, 180°, 270°, rotating around the piece center.

const PIECE_TYPES = {
    straight: {
        id: 'straight',
        label: 'Ramp',
        cost: 0,
        unlocked: true,
        w: 1, h: 1,
        shape: [
            { x1: 0.05, y1: 0.2, x2: 0.95, y2: 0.8 }
        ],
        color: '#7fb8d9'
    },
    curve: {
        id: 'curve',
        label: 'Curve',
        cost: 5,
        unlocked: true,
        w: 1, h: 1,
        // Quarter-circle approximated with three segments
        shape: [
            { x1: 0.05, y1: 0.5, x2: 0.20, y2: 0.80 },
            { x1: 0.20, y1: 0.80, x2: 0.50, y2: 0.95 },
            { x1: 0.50, y1: 0.95, x2: 0.95, y2: 0.95 }
        ],
        color: '#9fc9e0'
    },
    funnel: {
        id: 'funnel',
        label: 'Funnel',
        cost: 15,
        unlocked: true,
        w: 1, h: 1,
        shape: [
            { x1: 0.05, y1: 0.15, x2: 0.40, y2: 0.85 },
            { x1: 0.95, y1: 0.15, x2: 0.60, y2: 0.85 }
        ],
        color: '#b4dbee'
    }
};

// Rotate a unit-space point (px, py) by `rot` quarter-turns around (0.5, 0.5).
function rotateUnit(px, py, rot) {
    let x = px - 0.5, y = py - 0.5;
    for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
        const nx = -y, ny = x;
        x = nx; y = ny;
    }
    return { x: x + 0.5, y: y + 0.5 };
}

// World-space segments for a placed piece, taking rotation into account.
// Returns [{ax, ay, bx, by}, ...].
function pieceSegments(piece) {
    const def = PIECE_TYPES[piece.type];
    if (!def) return [];
    const { x: ox, y: oy } = cellToWorld(piece.col, piece.row);
    const out = [];
    for (const s of def.shape) {
        const a = rotateUnit(s.x1, s.y1, piece.rot || 0);
        const b = rotateUnit(s.x2, s.y2, piece.rot || 0);
        out.push({
            ax: ox + a.x * CELL,
            ay: oy + a.y * CELL,
            bx: ox + b.x * CELL,
            by: oy + b.y * CELL
        });
    }
    return out;
}

// ---- Placed piece state ----
// Each element: { type, col, row, rot }
let placedPieces = [];

function canPlace(col, row) {
    if (!inGrid(col, row)) return false;
    for (const p of placedPieces) {
        if (p.col === col && p.row === row) return false;
    }
    // Don't allow placement over the spawner or collector cell
    if (col === spawnerCell.col && row === spawnerCell.row) return false;
    if (col >= collectorCell.col && col <= collectorCell.col + 1 && row === collectorCell.row) return false;
    return true;
}

function placePiece(type, col, row) {
    if (!canPlace(col, row)) return false;
    if (placedPieces.length >= getMaxPieces()) return false;
    placedPieces.push({ type, col, row, rot: 0 });
    saveGame();
    return true;
}

function pieceAt(col, row) {
    for (let i = placedPieces.length - 1; i >= 0; i--) {
        const p = placedPieces[i];
        if (p.col === col && p.row === row) return { piece: p, idx: i };
    }
    return null;
}

function rotatePieceAt(col, row) {
    const hit = pieceAt(col, row);
    if (!hit) return false;
    hit.piece.rot = ((hit.piece.rot || 0) + 1) % 4;
    saveGame();
    return true;
}

function removePieceAt(col, row) {
    const hit = pieceAt(col, row);
    if (!hit) return false;
    placedPieces.splice(hit.idx, 1);
    saveGame();
    return true;
}

// ---- Drawing ----
function drawPiece(piece, opts = {}) {
    const def = PIECE_TYPES[piece.type];
    if (!def) return;
    const segs = pieceSegments(piece);
    // Base cell highlight (subtle)
    const { x, y } = cellToWorld(piece.col, piece.row);
    ctx.fillStyle = 'rgba(109,217,255,0.06)';
    roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 6);
    ctx.fill();

    // Outer stroke (dark base for depth)
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of segs) {
        ctx.moveTo(s.ax, s.ay);
        ctx.lineTo(s.bx, s.by);
    }
    ctx.stroke();

    // Main stroke
    ctx.strokeStyle = opts.highlight ? '#ffffff' : def.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (const s of segs) {
        ctx.moveTo(s.ax, s.ay);
        ctx.lineTo(s.bx, s.by);
    }
    ctx.stroke();

    // Inner highlight shine
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const s of segs) {
        ctx.moveTo(s.ax, s.ay);
        ctx.lineTo(s.bx, s.by);
    }
    ctx.stroke();
}

function drawPiecePreview(type, x, y, size) {
    const def = PIECE_TYPES[type];
    if (!def) return;
    ctx.save();
    ctx.translate(x, y);
    const scale = size;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of def.shape) {
        ctx.moveTo(s.x1 * scale, s.y1 * scale);
        ctx.lineTo(s.x2 * scale, s.y2 * scale);
    }
    ctx.stroke();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const s of def.shape) {
        ctx.moveTo(s.x1 * scale, s.y1 * scale);
        ctx.lineTo(s.x2 * scale, s.y2 * scale);
    }
    ctx.stroke();
    ctx.restore();
}
