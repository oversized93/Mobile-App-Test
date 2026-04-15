// ============================================================
//  ENGINE — Canvas, input, palette, save/load, zen garden background
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
    try { localStorage.setItem('zr_' + key, JSON.stringify(val)); } catch (e) {}
}
function loadData(key, def) {
    try {
        const v = localStorage.getItem('zr_' + key);
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
    ctx.fillStyle = 'rgba(30, 20, 6, 0.3)';
    roundRect(x, y + 2, w, h, r);
    ctx.fill();
    ctx.fillStyle = 'rgba(245, 230, 196, 0.88)';
    roundRect(x, y, w, h, r);
    ctx.fill();
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(255, 248, 220, 0.55)');
    grad.addColorStop(1, 'rgba(215, 188, 140, 0.15)');
    ctx.fillStyle = grad;
    roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 36, 18, 0.55)';
    ctx.lineWidth = 1;
    roundRect(x, y, w, h, r);
    ctx.stroke();
}

function hitBtn(tx, ty, x, y, w, h) {
    return tx >= x && tx <= x + w && ty >= y && ty <= y + h;
}

// ---- Palette — deep zen garden ----
const PALETTE = {
    grassTop:   '#4c7a3a',
    grassMid:   '#3a6a2a',
    grassBot:   '#274a18',
    grassDark:  '#1d3812',
    mossLight:  '#7ab358',
    mossDark:   '#2e5220',
    stoneDark:  '#32343a',
    stoneMid:   '#4a4d55',
    stoneLight: '#6e7178',
    riverDeep:  '#1d3c55',
    riverMid:   '#4a8fb5',
    riverBright:'#a5d8e8',
    foam:       '#f0f8fb',
    pondDeep:   '#1a3244',
    pondSurf:   '#3e6a8a',
    mapleRed:   '#c8442a',
    mapleOrange:'#e07a2c',
    mapleGold:  '#e5a838',
    lily:       '#6ea848',
    koiBody:    '#f6ede0',
    koiSpot:    '#d65a2a',
    text:       '#1f120a',
    textSoft:   'rgba(30, 18, 6, 0.65)',
    parchment:  '#f5e6c4',
    money:      '#c8a04f',
    danger:     '#c65540',
    ink:        '#1a0f08',
};

// ---- Layout regions (15% source, 75% draw, 10% outlet) ----
const HUD_TOP_H = 60;
const HUD_BOTTOM_H = 110;

function sourceZoneRect() {
    const top = HUD_TOP_H;
    const h = Math.max(70, Math.round((H() - HUD_TOP_H - HUD_BOTTOM_H) * 0.15));
    return { x: 0, y: top, w: W(), h };
}
function outletZoneRect() {
    const h = Math.max(60, Math.round((H() - HUD_TOP_H - HUD_BOTTOM_H) * 0.10));
    return { x: 0, y: H() - HUD_BOTTOM_H - h, w: W(), h };
}
function drawZoneRect() {
    const s = sourceZoneRect();
    const o = outletZoneRect();
    return { x: 0, y: s.y + s.h, w: W(), h: o.y - (s.y + s.h) };
}

function springOpeningRect() {
    const s = sourceZoneRect();
    const w = Math.min(180, W() * 0.45);
    return { x: (W() - w) / 2, y: s.y + s.h - 24, w, h: 30 };
}
function pondRect() {
    const o = outletZoneRect();
    const w = Math.min(220, W() * 0.6);
    return { x: (W() - w) / 2, y: o.y + 6, w, h: o.h - 12 };
}

// ---- Deterministic decorations (sampled once) ----
const decorations = { grass: [], moss: [], pebbles: [], ready: false };
function rng(seed) {
    let s = seed;
    return function () {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
}
function bakeDecorations() {
    decorations.grass.length = 0;
    decorations.moss.length = 0;
    decorations.pebbles.length = 0;
    const r = rng(1337);
    const src = sourceZoneRect();
    const out = outletZoneRect();
    const areaH = H();
    const areaW = W();
    // Moss patches — big blobs
    const mossCount = Math.round(areaW * areaH / 22000);
    for (let i = 0; i < mossCount; i++) {
        decorations.moss.push({
            x: r() * areaW,
            y: HUD_TOP_H + r() * (H() - HUD_TOP_H - HUD_BOTTOM_H),
            rx: 40 + r() * 80,
            ry: 22 + r() * 40,
            shade: 0.5 + r() * 0.5,
            dark: r() < 0.4
        });
    }
    // Grass tufts
    const tuftCount = Math.round(areaW * areaH / 9000);
    for (let i = 0; i < tuftCount; i++) {
        decorations.grass.push({
            x: r() * areaW,
            y: HUD_TOP_H + 20 + r() * (H() - HUD_TOP_H - HUD_BOTTOM_H - 40),
            h: 5 + r() * 8,
            lean: (r() - 0.5) * 4,
            shade: 0.6 + r() * 0.4
        });
    }
    // Pebbles
    const pebbleCount = Math.round(areaW * areaH / 30000);
    for (let i = 0; i < pebbleCount; i++) {
        decorations.pebbles.push({
            x: r() * areaW,
            y: HUD_TOP_H + 20 + r() * (H() - HUD_TOP_H - HUD_BOTTOM_H - 40),
            r: 1.5 + r() * 2.5,
            shade: 0.3 + r() * 0.6
        });
    }
    decorations.ready = true;
}

// ---- Background ----
function drawBackground() {
    if (!decorations.ready) bakeDecorations();

    // Base grass gradient — richer moss greens
    const grad = ctx.createLinearGradient(0, 0, 0, H());
    grad.addColorStop(0, PALETTE.grassTop);
    grad.addColorStop(0.55, PALETTE.grassMid);
    grad.addColorStop(1, PALETTE.grassBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W(), H());

    // Big soft moss blobs (depth)
    for (const m of decorations.moss) {
        ctx.fillStyle = m.dark
            ? `rgba(20, 40, 14, ${0.25 * m.shade})`
            : `rgba(122, 179, 88, ${0.18 * m.shade})`;
        ctx.beginPath();
        ctx.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Grass tufts
    for (const g of decorations.grass) {
        ctx.strokeStyle = `rgba(90, 135, 52, ${g.shade})`;
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = -1; i <= 1; i++) {
            ctx.moveTo(g.x + i * 2, g.y);
            ctx.quadraticCurveTo(g.x + i * 2 + g.lean * 0.5, g.y - g.h * 0.5, g.x + i * 2 + g.lean, g.y - g.h);
        }
        ctx.stroke();
    }

    // Pebbles
    for (const p of decorations.pebbles) {
        ctx.fillStyle = `rgba(30, 28, 20, ${0.4 * p.shade})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Corner maple silhouettes — fiery autumn color pop
    drawMapleSilhouette(-30, -20, 200, 0.9);
    drawMapleSilhouette(W() + 30, -10, 180, -0.95);

    // Vignette
    const vg = ctx.createRadialGradient(
        W() / 2, H() / 2, Math.min(W(), H()) * 0.35,
        W() / 2, H() / 2, Math.max(W(), H()) * 0.75
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10, 25, 8, 0.4)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W(), H());
}

// Decorative Japanese maple silhouette — trunk + foliage clusters
function drawMapleSilhouette(cx, cy, size, flip) {
    ctx.save();
    ctx.translate(cx, cy);
    if (flip < 0) ctx.scale(-1, 1);
    // Trunk
    ctx.strokeStyle = 'rgba(30, 18, 8, 0.55)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, size * 0.6);
    ctx.quadraticCurveTo(size * 0.15, size * 0.3, size * 0.25, size * 0.1);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(size * 0.18, size * 0.2);
    ctx.lineTo(size * 0.42, size * 0.05);
    ctx.moveTo(size * 0.22, size * 0.15);
    ctx.lineTo(size * 0.1, -size * 0.05);
    ctx.stroke();
    // Foliage clusters — layered autumn colors
    const blobs = [
        { x: size * 0.25, y: 0,            r: size * 0.55, c: PALETTE.mapleRed,    a: 0.85 },
        { x: size * 0.1,  y: -size * 0.1,  r: size * 0.48, c: PALETTE.mapleOrange, a: 0.8 },
        { x: size * 0.45, y: -size * 0.05, r: size * 0.42, c: PALETTE.mapleGold,   a: 0.7 },
        { x: size * 0.3,  y: size * 0.15,  r: size * 0.38, c: PALETTE.mapleRed,    a: 0.6 }
    ];
    for (const b of blobs) {
        ctx.fillStyle = b.c;
        ctx.globalAlpha = b.a;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Leaf speckle highlights
    ctx.fillStyle = 'rgba(255, 220, 140, 0.35)';
    const r2 = rng(flip < 0 ? 77 : 31);
    for (let i = 0; i < 14; i++) {
        ctx.beginPath();
        ctx.arc(size * (0.1 + r2() * 0.5), (r2() - 0.5) * size * 0.7, 2 + r2() * 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
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

window.addEventListener('resize', () => { decorations.ready = false; });
