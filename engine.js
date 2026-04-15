// ============================================================
//  ENGINE — Canvas setup, input, drawing helpers, save/load
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

function drawParchmentPill(x, y, w, h, r) {
    // Shadow
    ctx.fillStyle = 'rgba(40, 24, 10, 0.22)';
    roundRect(x, y + 2, w, h, r);
    ctx.fill();
    // Parchment base
    ctx.fillStyle = 'rgba(248, 232, 198, 0.85)';
    roundRect(x, y, w, h, r);
    ctx.fill();
    // Inner warm highlight
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(255, 248, 220, 0.6)');
    grad.addColorStop(1, 'rgba(215, 188, 140, 0.2)');
    ctx.fillStyle = grad;
    roundRect(x, y, w, h, r);
    ctx.fill();
    // Deep brown hairline
    ctx.strokeStyle = 'rgba(80, 50, 20, 0.45)';
    ctx.lineWidth = 1;
    roundRect(x, y, w, h, r);
    ctx.stroke();
}

function hitBtn(tx, ty, x, y, w, h) {
    return tx >= x && tx <= x + w && ty >= y && ty <= y + h;
}

// ---- Color palette — Japanese zen garden ----
const PALETTE = {
    bgTop:    '#f2e3c0',  // warm cream sand
    bgBottom: '#d4b584',  // deeper tan
    rake:     'rgba(130, 95, 55, 0.10)',
    text:     '#2a1810',  // deep sumi brown
    textSoft: 'rgba(40, 24, 10, 0.65)',
    ink:      '#1a0f08',  // sumi black ink
    inkShadow:'rgba(30, 18, 8, 0.45)',
    stone:    '#4a5560',
    stoneHi:  '#9cacb8',
    spawner:  '#7a8c4d',  // bamboo green
    collector:'#8c6a45',  // wooden bowl brown
    water:    '#4a6b8c',  // koi pond blue
    money:    '#c4a052',  // aged gold
    blossom:  '#f8bfd0',  // cherry blossom
    moss:     '#7a9c5e',
    locked:   'rgba(40, 24, 10, 0.3)',
};

function drawBackground() {
    // Base sand gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H());
    grad.addColorStop(0, PALETTE.bgTop);
    grad.addColorStop(1, PALETTE.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W(), H());

    // Raked sand — horizontal wavy lines
    ctx.strokeStyle = PALETTE.rake;
    ctx.lineWidth = 1.2;
    const step = 14;
    for (let y = 20; y < H(); y += step) {
        ctx.beginPath();
        for (let x = 0; x <= W(); x += 20) {
            const wave = Math.sin(x * 0.018 + y * 0.035) * 2.5;
            if (x === 0) ctx.moveTo(x, y + wave);
            else ctx.lineTo(x, y + wave);
        }
        ctx.stroke();
    }

    // Soft vignette edges
    const vg = ctx.createRadialGradient(
        W() / 2, H() / 2, Math.min(W(), H()) * 0.35,
        W() / 2, H() / 2, Math.max(W(), H()) * 0.75
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(80, 50, 20, 0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W(), H());
}

// ---- Touch / mouse input ----
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
