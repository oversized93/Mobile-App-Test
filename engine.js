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
    // Keep the 3D layer in sync — without this, rotating or Safari chrome
    // showing/hiding leaves a letterboxed band
    if (typeof renderer3d !== 'undefined' && renderer3d) {
        renderer3d.setSize(window.innerWidth, window.innerHeight);
        if (typeof camera3d !== 'undefined' && camera3d) {
            camera3d.aspect = window.innerWidth / window.innerHeight;
            camera3d.updateProjectionMatrix();
        }
    }
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
const CELL = 32;

// ---- Save/Load (versioned) ----
// Every payload is wrapped in {__v, data}. Pre-versioning saves (raw JSON)
// are treated as version 0 and run through the migration chain, so a schema
// change upgrades old resorts instead of silently wiping them.
const SAVE_VERSION = 1;
// Per-key migration chains: SAVE_MIGRATIONS[key][n] upgrades version n → n+1.
// Missing entries are identity (shape unchanged that version).
// Example: SAVE_MIGRATIONS['course'] = [ (v0Data) => ({...v0Data, biome: 'meadows'}) ];
const SAVE_MIGRATIONS = {};

function migrateSave(key, fromV, data) {
    const chain = SAVE_MIGRATIONS[key] || [];
    let v = fromV, d = data;
    while (v < SAVE_VERSION) {
        const step = chain[v];
        if (step) d = step(d);
        v++;
    }
    return d;
}

function saveData(key, val) {
    localStorage.setItem('gt_' + key, JSON.stringify({ __v: SAVE_VERSION, data: val }));
}

function loadData(key, def) {
    try {
        const raw = localStorage.getItem('gt_' + key);
        if (!raw) return def;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            && parsed.__v != null && 'data' in parsed) {
            return migrateSave(key, parsed.__v, parsed.data);
        }
        // Legacy raw payload — migrate from version 0
        return migrateSave(key, 0, parsed);
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

// ---- Glossy UI helpers — chunky beveled reference-style chrome ----
function shadeColor(hex, f) {
    // hex '#rrggbb'; f > 0 lightens toward white, f < 0 darkens toward black
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
}

// Beveled button/panel: vertical body gradient, dark outer edge, soft top
// highlight band. The one visual primitive behind all polished chrome.
function glossyRect(x, y, w, h, r, hex, opts) {
    opts = opts || {};
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, shadeColor(hex, 0.26));
    grad.addColorStop(0.45, hex);
    grad.addColorStop(1, shadeColor(hex, -0.34));
    ctx.fillStyle = grad;
    roundRect(x, y, w, h, r);
    ctx.fill();
    const hl = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
    hl.addColorStop(0, 'rgba(255,255,255,' + (opts.topGlow != null ? opts.topGlow : 0.30) + ')');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    roundRect(x + 1.5, y + 1.5, w - 3, h * 0.55, Math.max(2, r - 2));
    ctx.fill();
    ctx.strokeStyle = opts.stroke || 'rgba(0,0,0,0.5)';
    ctx.lineWidth = opts.lineWidth || 1.5;
    roundRect(x, y, w, h, r);
    ctx.stroke();
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
let pinchStartMidX = 0, pinchStartMidY = 0;
let pinchStartCamX = 0, pinchStartCamY = 0;
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
        // A second finger landed — let the game cleanly cancel any in-flight
        // one-finger interaction (pan, paint stroke, drags). Without this,
        // stale drag state fires after the pinch and the camera jumps.
        if (typeof onPinchStart === 'function') onPinchStart();
        // Start pinch zoom + rotate + pan
        pinching = true;
        pinchStartDist = getTouchDist(e);
        pinchStartZoom = cam.targetZoom;
        pinchStartAngle = getTouchAngle(e);
        pinchStartRot = cam.targetRot;
        const t1 = e.touches[0], t2 = e.touches[1];
        pinchStartMidX = (t1.clientX + t2.clientX) / 2;
        pinchStartMidY = (t1.clientY + t2.clientY) / 2;
        pinchStartCamX = cam.targetX;
        pinchStartCamY = cam.targetY;
        // Orbit baseline — we snapshot orbit state once so move deltas are
        // computed as absolutes from this baseline (prevents compounding).
        if (typeof cam3dOrbitMode !== 'undefined' && cam3dOrbitMode) {
            cam._pinchOrbitDist  = cam3dDistance;
            cam._pinchOrbitPitch = cam3dPitch;
            cam._pinchOrbitYaw   = cam3dYaw;
            cam._pinchOrbitPivotX = cam3dPivotX;
            cam._pinchOrbitPivotZ = cam3dPivotZ;
            cam._pinchOrbitFov   = (typeof cam3dFov !== 'undefined') ? cam3dFov : 75;
            cam._pinchOrbitZoomAbs = (typeof cam3dZoom !== 'undefined') ? cam3dZoom : 1;
        }
        cam._lastPinchDx = 0; cam._lastPinchDy = 0;
        cam._lastPinchRot = 0;
        // Accumulated twist tracking — prevents atan2 wrap-around when the
        // user rotates past the ±π boundary mid-gesture.
        cam._pinchLastAngle = pinchStartAngle;
        cam._pinchAccumRot = 0;
        // Intent gates: zoom/rotate/pan each engage only after crossing a
        // threshold, then rebase so there is no snap at the engage moment.
        // Stops micro-twist-while-zooming and micro-zoom-while-panning.
        cam._pinchZoomEngaged = false;
        cam._pinchRotEngaged = false;
        cam._pinchPanEngaged = false;
        cam._pinchZoomBase = 1;
        cam._pinchRotBase = 0;
        // Recent applied pans {t, dx, dy} — rewound on release to cancel the
        // finger-liftoff artifact (contact points smear as fingers peel off,
        // dragging the midpoint a few px in the travel direction).
        cam._panHistory = [];
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
        const dist = getTouchDist(e);
        const scale = dist / pinchStartDist;
        const angle = getTouchAngle(e);
        const t1 = e.touches[0], t2 = e.touches[1];
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;

        // ---- Orbit mode (overworld) — recompute absolutes from pinch start ----
        if (typeof cam3dOrbitMode !== 'undefined' && cam3dOrbitMode && typeof setCameraOrbit === 'function') {
            const baseYaw = (cam._pinchOrbitYaw != null) ? cam._pinchOrbitYaw : cam3dYaw;
            const baseFov = (cam._pinchOrbitFov != null) ? cam._pinchOrbitFov : 75;
            // Intent thresholds — tuned to Maps-like feel
            const ZOOM_GATE = 0.07;   // 7% finger-distance change
            const ROT_GATE = 0.10;    // ~6° of twist
            const PAN_GATE = 12;      // px of midpoint travel

            // Zoom (FOV-driven — camera stays put, lens narrows as fingers
            // spread). Engages after the gate; rebased so there's no snap.
            if (!cam._pinchZoomEngaged && Math.abs(Math.log(scale)) > Math.log(1 + ZOOM_GATE)) {
                cam._pinchZoomEngaged = true;
                cam._pinchZoomBase = scale;
            }
            if (cam._pinchZoomEngaged) {
                const baseZoomAbs = (cam._pinchOrbitZoomAbs != null) ? cam._pinchOrbitZoomAbs : 1;
                if (typeof setCameraZoomAbs === 'function') {
                    // Hybrid zoom: lens first, then dolly — much deeper range
                    setCameraZoomAbs(baseZoomAbs * (scale / cam._pinchZoomBase));
                } else if (typeof setCameraFov === 'function') {
                    setCameraFov(baseFov / (scale / cam._pinchZoomBase));
                }
            }

            // Yaw — accumulate frame-to-frame angle delta, normalizing across
            // the ±π boundary so twisting past 180° in one gesture doesn't
            // snap back the wrong direction. Applies only after the gate.
            let frameRot = angle - (cam._pinchLastAngle != null ? cam._pinchLastAngle : angle);
            if (frameRot > Math.PI)  frameRot -= 2 * Math.PI;
            if (frameRot < -Math.PI) frameRot += 2 * Math.PI;
            cam._pinchAccumRot = (cam._pinchAccumRot || 0) + frameRot;
            cam._pinchLastAngle = angle;
            if (!cam._pinchRotEngaged && Math.abs(cam._pinchAccumRot) > ROT_GATE) {
                cam._pinchRotEngaged = true;
                cam._pinchRotBase = cam._pinchAccumRot;
            }
            if (cam._pinchRotEngaged) {
                setCameraOrbit(cam3dPivotX, cam3dPivotZ, cam3dDistance, cam3dPitch,
                               baseYaw + (cam._pinchAccumRot - cam._pinchRotBase));
            }

            // Two-finger drag = pan — engages after the gate, then applies
            // per-frame deltas (rebased at engage → no jump), which also
            // composes correctly with simultaneous twisting.
            const pdx = midX - pinchStartMidX;
            const pdy = midY - pinchStartMidY;
            if (!cam._pinchPanEngaged && (pdx * pdx + pdy * pdy) > PAN_GATE * PAN_GATE) {
                cam._pinchPanEngaged = true;
                cam._lastPinchDx = pdx; cam._lastPinchDy = pdy;
            }
            if (cam._pinchPanEngaged && typeof panCameraOrbit === 'function') {
                const stepDx = pdx - (cam._lastPinchDx || 0);
                const stepDy = pdy - (cam._lastPinchDy || 0);
                panCameraOrbit(stepDx, stepDy);
                cam._lastPinchDx = pdx; cam._lastPinchDy = pdy;
                if (cam._panHistory) {
                    cam._panHistory.push({ t: e.timeStamp, dx: stepDx, dy: stepDy });
                    if (cam._panHistory.length > 12) cam._panHistory.shift();
                }
            }
            cam.targetZoom = Math.max(0.3, Math.min(8, pinchStartZoom * scale));
            cam.zoom = cam.targetZoom;
            manualZoom = true;
            return;
        }

        // ---- Legacy (gameplay) pinch — unchanged ----
        // 3D zoom
        if (typeof zoomCamera3D === 'function' && typeof scene3dReady !== 'undefined' && scene3dReady) {
            zoomCamera3D(pinchStartZoom / (cam.targetZoom || 1));
        }
        cam.targetZoom = Math.max(0.3, Math.min(8, pinchStartZoom * scale));
        cam.zoom = cam.targetZoom;
        // Rotate
        const totalRot = angle - pinchStartAngle;
        cam.targetRot = pinchStartRot + totalRot;
        cam.rot = cam.targetRot;
        // Pan (two-finger drag)
        const pdx = midX - pinchStartMidX;
        const pdy = midY - pinchStartMidY;
        if (typeof panCamera3D === 'function' && typeof scene3dReady !== 'undefined' && scene3dReady) {
            panCamera3D(pdx - (cam._lastPinchDx || 0), pdy - (cam._lastPinchDy || 0));
            cam._lastPinchDx = pdx; cam._lastPinchDy = pdy;
        }
        // 2D fallback
        const dx = pdx / cam.zoom;
        const dy = pdy / cam.zoom;
        const cos = Math.cos(-cam.rot), sin = Math.sin(-cam.rot);
        cam.targetX = pinchStartCamX - (dx * cos - dy * sin);
        cam.targetY = pinchStartCamY - (dx * sin + dy * cos);
        cam.x = cam.targetX;
        cam.y = cam.targetY;
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

// Cancel the finger-liftoff smear: revert pan applied in the final 60ms of
// a two-finger gesture. Deliberate pans lose a couple px at most; the
// release-direction jump disappears.
function rewindLiftoffPan(timeStamp) {
    if (!cam._panHistory || !cam._panHistory.length) return;
    if (typeof cam3dOrbitMode === 'undefined' || !cam3dOrbitMode) { cam._panHistory = null; return; }
    if (typeof panCameraOrbit !== 'function') { cam._panHistory = null; return; }
    let sumDx = 0, sumDy = 0;
    for (const h of cam._panHistory) {
        if (timeStamp - h.t <= 60) { sumDx += h.dx; sumDy += h.dy; }
    }
    if (sumDx !== 0 || sumDy !== 0) panCameraOrbit(-sumDx, -sumDy);
    cam._panHistory = null;
}

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (pinching) {
        pinching = false;
        rewindLiftoffPan(e.timeStamp);
        if (e.touches.length === 0) { touch.down = false; }
        else {
            // One finger remains — re-baseline it so any later handling
            // starts from where the finger actually is
            const t = e.touches[0];
            touch.x = t.clientX; touch.y = t.clientY;
            touch.startX = t.clientX; touch.startY = t.clientY;
        }
        return;
    }
    touch.down = false;
    if (typeof onTouchEnd === 'function') onTouchEnd(touch.x, touch.y);
}, { passive: false });

canvas.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    if (pinching) {
        pinching = false;
        rewindLiftoffPan(e.timeStamp);
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
