// ============================================================
//  ENGINE — Canvas setup, input, utilities, rendering helpers
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

// ---- Terrain types ----
const T = {
    GRASS: 0, FAIRWAY: 1, GREEN: 2, ROUGH: 3,
    SAND: 4, WATER: 5, TREE: 6, TEE: 7, OOB: 8, PATH: 9
};

const TERRAIN_COLORS = {
    [T.GRASS]:   '#2d8a4e',
    [T.FAIRWAY]: '#4caf50',
    [T.GREEN]:   '#66cc66',
    [T.ROUGH]:   '#1e6b35',
    [T.SAND]:    '#e8d68c',
    [T.WATER]:   '#3399cc',
    [T.TREE]:    '#1a5c2a',
    [T.TEE]:     '#88cc88',
    [T.OOB]:     '#1a3d1a',
    [T.PATH]:    '#c8b888'
};

const TERRAIN_NAMES = {
    [T.GRASS]: 'Grass', [T.FAIRWAY]: 'Fairway', [T.GREEN]: 'Green',
    [T.ROUGH]: 'Rough', [T.SAND]: 'Sand', [T.WATER]: 'Water',
    [T.TREE]: 'Trees', [T.TEE]: 'Tee Box', [T.OOB]: 'Out of Bounds',
    [T.PATH]: 'Path'
};

// Friction multipliers (lower = ball rolls further)
const TERRAIN_FRICTION = {
    [T.GRASS]:   0.97,
    [T.FAIRWAY]: 0.985,
    [T.GREEN]:   0.992,
    [T.ROUGH]:   0.94,
    [T.SAND]:    0.88,
    [T.WATER]:   0,     // stops + penalty
    [T.TREE]:    0.5,   // heavy stop
    [T.TEE]:     0.985,
    [T.OOB]:     0,     // reset + penalty
    [T.PATH]:    0.97
};

// ---- Cell size for terrain grid ----
const CELL = 16;

// ---- Save/Load ----
function saveData(key, val) { localStorage.setItem('gt_' + key, JSON.stringify(val)); }
function loadData(key, def) {
    try { const v = localStorage.getItem('gt_' + key); return v ? JSON.parse(v) : def; }
    catch(e) { return def; }
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

function drawBtn(x, y, w, h, text, color, textColor) {
    ctx.fillStyle = color || '#2a7fff';
    roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = textColor || '#fff';
    ctx.font = `bold ${Math.min(h * 0.45, 20)}px -apple-system,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
}

function hitBtn(tx, ty, x, y, w, h) {
    return tx >= x && tx <= x + w && ty >= y && ty <= y + h;
}

function drawFlag(x, y, scale) {
    const s = scale || 1;
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 28 * s);
    ctx.stroke();
    ctx.fillStyle = '#e33';
    ctx.beginPath();
    ctx.moveTo(x, y - 28 * s);
    ctx.lineTo(x + 14 * s, y - 22 * s);
    ctx.lineTo(x, y - 16 * s);
    ctx.fill();
}

function drawBall(x, y, r, color) {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(x + 1, y + 2, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ball
    ctx.fillStyle = color || '#fff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
}

// ---- Camera ----
let cam = { x: 0, y: 0, zoom: 1, rot: 0, targetX: 0, targetY: 0, targetZoom: 1, targetRot: 0 };

function camLerp(dt) {
    const spd = 4 * dt;
    cam.x += (cam.targetX - cam.x) * spd;
    cam.y += (cam.targetY - cam.y) * spd;
    cam.zoom += (cam.targetZoom - cam.zoom) * spd;
    cam.rot += (cam.targetRot - cam.rot) * spd;
}

function camTransform() {
    ctx.save();
    ctx.translate(W() / 2, H() / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.rotate(cam.rot);
    ctx.translate(-cam.x, -cam.y);
}

function camRestore() { ctx.restore(); }

function screenToWorld(sx, sy) {
    // Account for rotation
    const dx = (sx - W() / 2) / cam.zoom;
    const dy = (sy - H() / 2) / cam.zoom;
    const cos = Math.cos(-cam.rot), sin = Math.sin(-cam.rot);
    return {
        x: dx * cos - dy * sin + cam.x,
        y: dx * sin + dy * cos + cam.y
    };
}

function worldToScreen(wx, wy) {
    const dx = wx - cam.x, dy = wy - cam.y;
    const cos = Math.cos(cam.rot), sin = Math.sin(cam.rot);
    return {
        x: (dx * cos - dy * sin) * cam.zoom + W() / 2,
        y: (dx * sin + dy * cos) * cam.zoom + H() / 2
    };
}

// ---- Touch state ----
let touch = { down: false, x: 0, y: 0, startX: 0, startY: 0, moved: false };
let pinching = false;
let pinchStartDist = 0;
let pinchStartZoom = 1;
let pinchStartAngle = 0;
let pinchStartRot = 0;
let manualZoom = false;

function getTouchDist(e) {
    const t1 = e.touches[0], t2 = e.touches[1];
    const dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getTouchAngle(e) {
    const t1 = e.touches[0], t2 = e.touches[1];
    return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
}

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
        // Start pinch zoom + rotate
        pinching = true;
        pinchStartDist = getTouchDist(e);
        pinchStartZoom = cam.targetZoom;
        pinchStartAngle = getTouchAngle(e);
        pinchStartRot = cam.targetRot;
        return;
    }
    const t = e.touches[0];
    touch.down = true;
    touch.x = t.clientX;
    touch.y = t.clientY;
    touch.startX = t.clientX;
    touch.startY = t.clientY;
    touch.moved = false;
    if (typeof onTouchStart === 'function') onTouchStart(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (pinching && e.touches.length === 2) {
        // Zoom
        const dist = getTouchDist(e);
        const scale = dist / pinchStartDist;
        cam.targetZoom = Math.max(0.3, Math.min(8, pinchStartZoom * scale));
        cam.zoom = cam.targetZoom;
        // Rotate
        const angle = getTouchAngle(e);
        cam.targetRot = pinchStartRot + (angle - pinchStartAngle);
        cam.rot = cam.targetRot;
        manualZoom = true;
        return;
    }
    const t = e.touches[0];
    touch.x = t.clientX;
    touch.y = t.clientY;
    const dx = touch.x - touch.startX, dy = touch.y - touch.startY;
    if (dx * dx + dy * dy > 100) touch.moved = true;
    if (typeof onTouchMove === 'function') onTouchMove(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (pinching) {
        pinching = false;
        if (e.touches.length === 0) { touch.down = false; }
        return;
    }
    touch.down = false;
    if (typeof onTouchEnd === 'function') onTouchEnd(touch.x, touch.y);
}, { passive: false });

// Also support mouse for testing
canvas.addEventListener('mousedown', (e) => {
    touch.down = true;
    touch.x = e.clientX; touch.y = e.clientY;
    touch.startX = e.clientX; touch.startY = e.clientY;
    touch.moved = false;
    if (typeof onTouchStart === 'function') onTouchStart(e.clientX, e.clientY);
});
canvas.addEventListener('mousemove', (e) => {
    if (!touch.down) return;
    touch.x = e.clientX; touch.y = e.clientY;
    const dx = touch.x - touch.startX, dy = touch.y - touch.startY;
    if (dx * dx + dy * dy > 100) touch.moved = true;
    if (typeof onTouchMove === 'function') onTouchMove(e.clientX, e.clientY);
});
canvas.addEventListener('mouseup', (e) => {
    touch.down = false;
    if (typeof onTouchEnd === 'function') onTouchEnd(touch.x, touch.y);
});
