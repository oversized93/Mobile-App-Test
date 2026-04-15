// ============================================================
//  ENGINE — Canvas setup, input, utilities, drawing helpers
// ============================================================
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;

function resize() {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

const W = () => window.innerWidth;
const H = () => window.innerHeight;

// ---- Grid ----
// The grid is the play area. 32px cells.
const CELL = 32;
function gridCols() { return Math.floor(W() / CELL); }
function gridRows() { return Math.floor((H() - 180) / CELL); } // leave room for HUD + picker
function gridOriginX() { return (W() - gridCols() * CELL) / 2; }
function gridOriginY() { return 80; }

function worldToCell(sx, sy) {
    const c = Math.floor((sx - gridOriginX()) / CELL);
    const r = Math.floor((sy - gridOriginY()) / CELL);
    return { col: c, row: r };
}
function cellToWorld(col, row) {
    return { x: gridOriginX() + col * CELL, y: gridOriginY() + row * CELL };
}
function inGrid(col, row) {
    return col >= 0 && col < gridCols() && row >= 0 && row < gridRows();
}

// ---- Save / load ----
function saveData(key, val) {
    try { localStorage.setItem('mr_' + key, JSON.stringify(val)); } catch (e) {}
}
function loadData(key, def) {
    try {
        const v = localStorage.getItem('mr_' + key);
        return v ? JSON.parse(v) : def;
    } catch (e) { return def; }
}

// ---- Drawing helpers ----
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawGlassPill(x, y, w, h, r) {
    // Soft shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(x, y + 2, w, h, r);
    ctx.fill();
    // Glass fill
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(x, y, w, h, r);
    ctx.fill();
    // Inner highlight
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0.02)');
    ctx.fillStyle = grad;
    roundRect(x, y, w, h, r);
    ctx.fill();
    // Hairline border
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    roundRect(x, y, w, h, r);
    ctx.stroke();
}

function drawBtn(x, y, w, h, text, color) {
    drawGlassPill(x, y, w, h, h / 2);
    if (color) {
        ctx.fillStyle = color;
        roundRect(x, y, w, h, h / 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        roundRect(x, y, w, h, h / 2);
        ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.min(h * 0.42, 17)}px -apple-system,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
}

function hitBtn(tx, ty, x, y, w, h) {
    return tx >= x && tx <= x + w && ty >= y && ty <= y + h;
}

// ---- Color palette ----
const PALETTE = {
    bgTop:    '#0a1628',
    bgBottom: '#153247',
    grid:     'rgba(210,240,255,0.055)',
    hud:      'rgba(255,255,255,0.08)',
    accent:   '#6dd9ff',
    accent2:  '#b4f5c8',
    marble:   '#eaf4ff',
    marbleTrail: 'rgba(180,245,200,0.35)',
    piece:    '#7fb8d9',
    pieceHi:  '#e0f4ff',
    collector:'#b4f5c8',
    spawner:  '#6dd9ff',
    money:    '#ffd86d',
    locked:   'rgba(255,255,255,0.25)',
};

function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, H());
    grad.addColorStop(0, PALETTE.bgTop);
    grad.addColorStop(1, PALETTE.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W(), H());
    // Ambient blobs
    for (let i = 0; i < 3; i++) {
        const cx = W() * (0.2 + i * 0.3);
        const cy = H() * (0.3 + (i % 2) * 0.4);
        const r = 220 + i * 40;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(109,217,255,0.06)');
        g.addColorStop(1, 'rgba(109,217,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W(), H());
    }
}

function drawGrid() {
    const ox = gridOriginX(), oy = gridOriginY();
    const cols = gridCols(), rows = gridRows();
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
        ctx.moveTo(ox + c * CELL, oy);
        ctx.lineTo(ox + c * CELL, oy + rows * CELL);
    }
    for (let r = 0; r <= rows; r++) {
        ctx.moveTo(ox, oy + r * CELL);
        ctx.lineTo(ox + cols * CELL, oy + r * CELL);
    }
    ctx.stroke();
    // Subtle outline
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, cols * CELL, rows * CELL);
}

// ---- Input state ----
const touch = { down: false, x: 0, y: 0, startX: 0, startY: 0, moved: false, startT: 0 };

function onTouchStartRaw(x, y) {
    touch.down = true;
    touch.x = x; touch.y = y;
    touch.startX = x; touch.startY = y;
    touch.moved = false;
    touch.startT = performance.now();
    if (typeof onTouchStart === 'function') onTouchStart(x, y);
}
function onTouchMoveRaw(x, y) {
    if (!touch.down) return;
    touch.x = x; touch.y = y;
    const dx = x - touch.startX, dy = y - touch.startY;
    if (dx * dx + dy * dy > 100) touch.moved = true;
    if (typeof onTouchMove === 'function') onTouchMove(x, y);
}
function onTouchEndRaw(x, y) {
    const held = performance.now() - touch.startT;
    touch.down = false;
    if (typeof onTouchEnd === 'function') onTouchEnd(x, y, { moved: touch.moved, held });
}

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    onTouchStartRaw(t.clientX, t.clientY);
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    onTouchMoveRaw(t.clientX, t.clientY);
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    onTouchEndRaw(touch.x, touch.y);
}, { passive: false });

canvas.addEventListener('mousedown', (e) => onTouchStartRaw(e.clientX, e.clientY));
canvas.addEventListener('mousemove', (e) => onTouchMoveRaw(e.clientX, e.clientY));
canvas.addEventListener('mouseup',   (e) => onTouchEndRaw(e.clientX, e.clientY));
