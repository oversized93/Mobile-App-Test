// ============================================================
//  GAME.JS — Main game loop, all screens, golf physics
// ============================================================

// Visible build stamp (menu + overworld top bar) so device caching issues
// are diagnosable at a glance. Bump together with index.html ?v=.
const BUILD_TAG = 'gt9';

// Declared first on purpose: notify() can be reached from early boot code
// and a TDZ here once blanked the whole game on devices with saves.
let notification = { text: '', timer: 0 };

// ---- Game State ----
let state = 'menu';

// Single transition point with per-state enter/exit hooks. Hook functions
// are declared next to the screens they serve; function hoisting makes the
// forward references safe.
const STATE_HOOKS = {
    overworld: { enter: stateEnterOverworld, exit: stateExitOverworld },
    manage:    { enter: stateEnterManage },
};

function setState(next) {
    if (state === next) return;
    const prevHooks = STATE_HOOKS[state];
    if (prevHooks && prevHooks.exit) prevHooks.exit(next);
    state = next;
    const nextHooks = STATE_HOOKS[next];
    if (nextHooks && nextHooks.enter) nextHooks.enter();
}
let player = loadData('player', { name: 'Golfer', ballColor: '#fff', unlocked: [0] });

// ---- Tycoon / Resort State ----
// MVP loop: play or simulate a hole → earn coins → buy amenities → amenities
// add members → members generate passive income while the resort screen is open.
const RESORT_DEFAULT = {
    coins: 100,
    members: 5,
    amenities: {},      // id -> true when built
    lastTickMs: 0,      // unix ms at last income tick (for offline-style catch-up)
    coinsFrac: 0,       // fractional accumulator so we don't lose sub-1 ticks
    worldClock: 0       // total simulated seconds — the resort's persistent time base
};
let resort = Object.assign({}, RESORT_DEFAULT, loadData('resort', {}));

// ---- Overworld Course Data Model ----
// A Course is the player's entire resort world. Instead of each hole owning
// its own grid, the whole resort lives on one big terrain and holes are
// records that reference regions inside it (tee+pin + waypoints polyline).
const COURSE_COLS = 120;
const COURSE_ROWS = 80;

function makeStarterCourse() {
    const cols = COURSE_COLS, rows = COURSE_ROWS;
    const grid = [];
    // Border thickness of OOB around the playable rectangle
    const border = 4;
    for (let r = 0; r < rows; r++) {
        grid[r] = [];
        for (let c = 0; c < cols; c++) {
            const inBounds = r >= border && r < rows - border
                          && c >= border && c < cols - border;
            grid[r][c] = inBounds ? T.ROUGH : T.OOB;
        }
    }
    // Entrance pad: 5x3 paved patch straddling the south boundary
    const entranceCx = Math.floor(cols / 2);
    const entranceR0 = rows - border;
    for (let r = entranceR0 - 1; r <= entranceR0 + 1; r++)
        for (let c = entranceCx - 2; c <= entranceCx + 2; c++)
            if (r >= 0 && r < rows && c >= 0 && c < cols) grid[r][c] = T.PATH;
    // Starter path heading north from entrance ~12 cells
    for (let r = entranceR0 - 12; r < entranceR0 - 1; r++)
        for (let c = entranceCx - 1; c <= entranceCx + 1; c++)
            if (r >= 0 && r < rows && c >= 0 && c < cols) grid[r][c] = T.PATH;
    return {
        id: 'course_1',
        name: 'My Resort',
        biome: 'meadows',
        cols, rows, border,
        grid,
        holes: [],      // { id, par, tee:{x,y}, pin:{x,y}, waypoints:[{x,y}] }
        facilities: [], // future: { type, x, y, rot }
        scenery: []     // future: { type, x, y }
    };
}

let worldCourse = loadData('course', null);
// Invalidate any saved course that predates the bounded-rectangle schema.
// These old saves were 100x100 open fields without a border — start fresh.
if (!worldCourse || worldCourse.cols !== COURSE_COLS || worldCourse.rows !== COURSE_ROWS) {
    worldCourse = makeStarterCourse();
}
// Heights are derived (deterministic noise flattened by terrain type), so
// they are regenerated on load and after painting, never persisted.
function refreshWorldHeights() {
    worldCourse.heights = generateHeights(worldCourse);
}

function saveWorldCourse() {
    // Strip the derived heights array before persisting — ~9,600 floats of
    // pure noise that regenerate identically on load.
    const { heights, ...persistable } = worldCourse;
    saveData('course', persistable);
}

function enterOverworld() { setState('overworld'); }

function stateEnterOverworld() {
    if (!worldCourse.heights) refreshWorldHeights();
    if (scene3dReady) {
        buildTerrain3D(worldCourse, { distantScenery: false });
        const cx = worldCourse.cols * CELL / 2;
        const cz = worldCourse.rows * CELL / 2;
        // Switch the 3D camera into orbit mode so the player has full
        // pitch/yaw/zoom control. Initial framing mimics the overhead
        // tycoon view (~50° pitch, pointed north). FOV resets to default
        // so prior session zoom doesn't leak back in.
        cam3dOrbitMode = true;
        if (typeof resetCameraFov === 'function') resetCameraFov();
        setCameraOrbit(cx, cz, 2600, Math.PI / 180 * 50, 0);
        if (typeof camera3d !== 'undefined' && camera3d) {
            camera3d.position.x = cam3dTarget.x;
            camera3d.position.y = cam3dTarget.y;
            camera3d.position.z = cam3dTarget.z;
        }
    }
    cam.x = cam.targetX = worldCourse.cols * CELL / 2;
    cam.y = cam.targetY = worldCourse.rows * CELL / 2;
    cam.zoom = cam.targetZoom = 1;
    cam.rot = cam.targetRot = 0;
    manualZoom = true;
    scouting = false;
    owTool = 'hand';
    owRailOpen = false;
    owFlyout = null;
    owBrushSize = 3;
    owSelectedHole = null;
    owStrokeDiff = null;
    cancelOwLongPress();
    owCoachVisible = !loadData('coachSeen', false);
    if (typeof setOrbitPanBounds === 'function') {
        setOrbitPanBounds(-300, worldCourse.cols * CELL + 300,
                          -300, worldCourse.rows * CELL + 300);
    }
    holeWizard = null;
    owDragPainting = false;
    owDragLastCell = null;
    owNeedsRebuild = false;
    owLastGhostCell = null;
}

function exitOverworld() { setState('manage'); }

// Runs on ANY transition out of overworld (manage, playtest, ...): drop
// orbit mode + reset FOV so gameplay cameras behave, and bank the course.
function stateExitOverworld(next) {
    cam3dOrbitMode = false;
    if (typeof resetCameraFov === 'function') resetCameraFov();
    saveWorldCourse();
}

// ---- Overworld Builder State ----
// Brush-based placement: every tool paints cells inside an NxN footprint.
// Objects that are conceptually 1x1 (Tee, Pin) lock to size=1 while selected.
const OW_TOOLS = [
    // Navigation — the default. One-finger drag pans; nothing paints until
    // the player deliberately arms a brush.
    { id: 'hand', label: 'Move', icon: '\u270B', color: '#90a4ae', hand: true },
    // Surface brushes
    { id: 'fairway', label: 'Fairway', icon: '\u{1F7E2}', color: '#4caf50', terrain: T.FAIRWAY },
    { id: 'green',   label: 'Green',   icon: '\u{1F3CC}', color: '#66cc66', terrain: T.GREEN },
    { id: 'rough',   label: 'Rough',   icon: '\u{1F33F}', color: '#1e6b35', terrain: T.ROUGH },
    { id: 'sand',    label: 'Sand',    icon: '\u{1F3D6}', color: '#e8d68c', terrain: T.SAND },
    { id: 'water',   label: 'Water',   icon: '\u{1F4A7}', color: '#3399cc', terrain: T.WATER },
    { id: 'trees',   label: 'Trees',   icon: '\u{1F332}', color: '#1a5c2a', terrain: T.TREE },
    { id: 'path',    label: 'Path',    icon: '\u{1F6B6}', color: '#c8b888', terrain: T.PATH },
    { id: 'erase',   label: 'Erase',   icon: '\u{267B}',  color: '#888',    terrain: T.ROUGH },
    // Wizard tool
    { id: 'hole',    label: 'New Hole',icon: '\u{26F3}',  color: '#ff6d00', wizard: true },
];
const OW_BRUSH_SIZES = [1, 3, 5, 7, 9, 11];

// Sims-style bottom bar: tools grouped into filtered categories. Erase and
// brush size live outside the categories as global controls.
// Collapsible build rail (reference-style left column): a toggle button
// shows/hides the parent options; parents with multiple tools open a
// flyout of sub-options. Single-tool parents arm directly.
const OW_RAIL = [
    { id: 'hand',    icon: '\u270B',    label: 'MOVE' },
    { id: 'surface', icon: '\u{1F3A8}', label: 'LAND',   flyout: ['fairway', 'green', 'rough', 'sand'] },
    { id: 'nature',  icon: '\u{1F332}', label: 'NATURE', flyout: ['water', 'trees'] },
    { id: 'path',    icon: '\u{1F6B6}', label: 'PATHS' },
    { id: 'hole',    icon: '\u26F3',    label: 'HOLES' },
    { id: 'erase',   icon: '\u267B',    label: 'ERASE' },
    { id: 'size',    icon: null,         label: 'BRUSH', flyout: 'sizes' },
];
// Parent group of each armable tool (drives rail highlight state)
const OW_TOOL_PARENT = {
    hand: 'hand', fairway: 'surface', green: 'surface', rough: 'surface',
    sand: 'surface', water: 'nature', trees: 'nature', path: 'path', erase: 'erase'
};
let owRailOpen = false;   // build rail expanded?
let owFlyout = null;      // parent id whose sub-options are showing
let owCategory = 'surface'; // retained for save-compat; no longer drives UI

let owTool = 'path';                // currently selected tool id
let owBrushSize = 3;                // current brush diameter (from OW_BRUSH_SIZES)
let owDragPainting = false;         // we are mid-stroke
let owDragLastCell = null;          // {c, r} of last painted cell to avoid redundant work
let owNeedsRebuild = false;         // grid was edited this frame → rebuild terrain mesh

// Hole creation wizard — null when idle. Active shape is a polyline from tee
// through waypoints to pin; par is derived from total length.
let holeWizard = null;
// Shape = { step, tee, pin, waypoints[], draggingIdx, holeId }
// step: 'tee' | 'pin' | 'shape'

// ---- Overworld helpers ----
function screenToCell(sx, sy) {
    const wp = (scene3dReady && typeof screenToWorld3D === 'function')
        ? screenToWorld3D(sx, sy)
        : screenToWorld(sx, sy);
    if (!wp) return null;
    const c = Math.floor(wp.x / CELL);
    const r = Math.floor(wp.y / CELL);
    if (c < 0 || c >= worldCourse.cols || r < 0 || r >= worldCourse.rows) return null;
    return { c, r };
}

function cellCenterScreen(c, r) {
    const wx = (c + 0.5) * CELL;
    const wy = (r + 0.5) * CELL;
    return (scene3dReady && typeof worldToScreen3D === 'function')
        ? worldToScreen3D(wx, wy)
        : worldToScreen(wx, wy);
}

function currentTool() {
    return OW_TOOLS.find(t => t.id === owTool) || OW_TOOLS[0];
}

// Paint a brush footprint centered on (cc, cr). Skips OOB border so the
// player can't accidentally extend the playable rectangle.
function paintBrushAt(cc, cr, size, terrain) {
    const half = Math.floor(size / 2);
    const changed = [];
    const border = worldCourse.border || 0;
    for (let dr = -half; dr <= half; dr++) {
        for (let dc = -half; dc <= half; dc++) {
            const r = cr + dr, c = cc + dc;
            if (r < border || r >= worldCourse.rows - border) continue;
            if (c < border || c >= worldCourse.cols - border) continue;
            if (worldCourse.grid[r][c] !== terrain) {
                // First touch of this cell in the stroke → remember its old
                // value for undo
                if (owStrokeDiff) {
                    const key = r * worldCourse.cols + c;
                    if (!owStrokeDiff.has(key)) {
                        owStrokeDiff.set(key, { c, r, prev: worldCourse.grid[r][c] });
                    }
                }
                worldCourse.grid[r][c] = terrain;
                changed.push({ c, r });
            }
        }
    }
    if (changed.length) owNeedsRebuild = true;
    return changed;
}

// ---- Hole wizard helpers ----
// ---- Playtest a world hole (M1: unified play context) ----
// The physics/camera/HUD all read `currentHole` as {grid, cols, rows,
// heights, tee, hole, par, name}. World hole records store {tee, pin,
// waypoints} against the shared course grid, so this builds a normalized
// context pointing physics directly at the world. No copying.
let worldPlaytest = false;

function holeBounds(rec) {
    const pts = [rec.tee, ...(rec.waypoints || []), rec.pin];
    let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
    for (const p of pts) {
        minC = Math.min(minC, p.x); maxC = Math.max(maxC, p.x);
        minR = Math.min(minR, p.y); maxR = Math.max(maxR, p.y);
    }
    const pad = 10;
    return { minC: minC - pad, minR: minR - pad, maxC: maxC + pad, maxR: maxR + pad };
}

function startWorldHolePlaytest(holeRec) {
    worldPlaytest = true;
    customCoursePlay = false;
    owSelectedHole = null;
    // Transition first — the overworld exit hook drops orbit mode, resets
    // FOV, and saves the course before startHole sets up gameplay cameras
    setState('playing');
    if (!worldCourse.heights) refreshWorldHeights();
    const ctx = {
        grid: worldCourse.grid,
        cols: worldCourse.cols,
        rows: worldCourse.rows,
        heights: worldCourse.heights,
        tee: { x: holeRec.tee.x, y: holeRec.tee.y },
        hole: { x: holeRec.pin.x, y: holeRec.pin.y },
        par: holeRec.par,
        name: 'Hole ' + holeRec.id,
        bounds: holeBounds(holeRec),
        worldHoleId: holeRec.id
    };
    currentCourse = { name: worldCourse.name, holes: [ctx] };
    currentHoleIdx = 0;
    holeStrokes = [];
    startHole(ctx);
}

function endWorldPlaytest() {
    worldPlaytest = false;
    enterOverworld();
}

function startHoleWizard() {
    const nextId = (worldCourse.holes.reduce((m, h) => Math.max(m, h.id || 0), 0) || 0) + 1;
    holeWizard = {
        step: 'tee',
        tee: null,
        pin: null,
        waypoints: [],
        draggingIdx: -1,
        holeId: nextId
    };
}

function cancelHoleWizard() { holeWizard = null; }

function polylineLengthYards(w) {
    if (!w.tee || !w.pin) return 0;
    const pts = [w.tee, ...w.waypoints, w.pin];
    let dist = 0;
    for (let i = 1; i < pts.length; i++) {
        const dx = (pts[i].x - pts[i - 1].x) * CELL;
        const dy = (pts[i].y - pts[i - 1].y) * CELL;
        dist += Math.sqrt(dx * dx + dy * dy);
    }
    return dist / YDS_TO_WORLD;
}

function parFromYards(yds) {
    if (yds < 200) return 3;
    if (yds < 430) return 4;
    return 5;
}

function finalizeHole() {
    if (!holeWizard || !holeWizard.tee || !holeWizard.pin) return;
    const yds = polylineLengthYards(holeWizard);
    const par = parFromYards(yds);
    worldCourse.holes.push({
        id: holeWizard.holeId,
        par,
        tee: { x: holeWizard.tee.x, y: holeWizard.tee.y },
        pin: { x: holeWizard.pin.x, y: holeWizard.pin.y },
        waypoints: holeWizard.waypoints.map(w => ({ x: w.x, y: w.y }))
    });
    saveWorldCourse();
    notify('Hole ' + holeWizard.holeId + ' created \u2022 Par ' + par + ' \u2022 ' + Math.round(yds) + 'y');
    holeWizard = null;
}

const AMENITIES = [
    { id: 'clubhouse', name: 'Clubhouse', icon: '\u{1F3DB}\uFE0F', cost: 200, memberBoost: 10,
      desc: 'Somewhere for golfers to relax after a round.' }
];

function saveResort() { saveData('resort', resort); }

function coinsForScore(par, strokes) {
    // base scales with membership size; great scores reward more, bad scores less
    const diff = strokes - par;
    const base = 30 + resort.members * 2;
    const bonus = Math.max(0, -diff) * 20;
    const penalty = Math.max(0, diff) * 6;
    return Math.max(5, Math.round(base + bonus - penalty));
}

function awardCoins(n) {
    if (n <= 0) return;
    resort.coins += n;
    saveResort();
}

function simulateHole(par) {
    const r = Math.random();
    let strokes;
    if (r < 0.05) strokes = Math.max(1, par - 2);      // eagle
    else if (r < 0.25) strokes = Math.max(1, par - 1); // birdie
    else if (r < 0.65) strokes = par;                   // par
    else if (r < 0.9) strokes = par + 1;                // bogey
    else strokes = par + 2;                             // double
    return { strokes, par };
}

function simulateRound(course) {
    let totalStrokes = 0, totalPar = 0, coins = 0;
    for (const hole of course.holes) {
        const r = simulateHole(hole.par);
        totalStrokes += r.strokes;
        totalPar += r.par;
        coins += coinsForScore(r.par, r.strokes);
    }
    return { totalStrokes, totalPar, coins };
}

function buyAmenity(id) {
    const a = AMENITIES.find(x => x.id === id);
    if (!a) return;
    if (resort.amenities[id]) return;
    if (resort.coins < a.cost) { notify('Not enough coins'); return; }
    resort.coins -= a.cost;
    resort.amenities[id] = true;
    resort.members += a.memberBoost;
    saveResort();
    notify('Built ' + a.name + '! +' + a.memberBoost + ' members');
}

// Passive income: members * 0.2 coins/sec while Manage screen is open.
// On re-entry, we catch up offline time capped at 1 hour so you can't farm too
// hard by leaving it open.
function enterManage() { setState('manage'); }

function stateEnterManage() { saveResort(); }

// Offline catch-up — run ONCE at boot, not per-screen: members earned
// passively while the app was closed (capped at 1 hour).
function applyOfflineCatchup() {
    try {
        const now = Date.now();
        if (resort.lastTickMs) {
            const elapsed = Math.min((now - resort.lastTickMs) / 1000, 3600);
            const income = Math.floor(resort.members * elapsed * 0.2);
            if (income > 0) { resort.coins += income; notify('+' + income + ' coins while away'); }
        }
        resort.lastTickMs = now;
        resort.coinsFrac = 0;
        saveResort();
    } catch (e) {
        // Offline earnings are never worth a failed boot
    }
}

// The world advances on EVERY screen — economy, and later NPCs and daily
// upkeep, all hang off this one clock. (Previously income only ticked while
// the Manage screen was open, which made every economy feature screen-gated.)
let _worldSaveAcc = 0;
function tickWorld(dt) {
    resort.worldClock = (resort.worldClock || 0) + dt;
    resort.coinsFrac = (resort.coinsFrac || 0) + resort.members * 0.2 * dt;
    if (resort.coinsFrac >= 1) {
        const whole = Math.floor(resort.coinsFrac);
        resort.coins += whole;
        resort.coinsFrac -= whole;
    }
    resort.lastTickMs = Date.now();
    // Persist at a gentle cadence so closing the app rarely loses progress
    _worldSaveAcc += dt;
    if (_worldSaveAcc >= 10) {
        _worldSaveAcc = 0;
        saveResort();
    }
}

let currentCourse = null;
let currentHoleIdx = 0;
let currentHole = null;
let ball = { x: 0, y: 0, vx: 0, vy: 0, z: 0, vz: 0, moving: false, airborne: false, topSpin: 0, curl: 0 };
let strokes = 0;
let holeStrokes = [];
let aimStartX = 0, aimStartY = 0;
let shotTrail = [];
let holeComplete = false;
let roundComplete = false;
let lastFrameTime = null;
let menuScroll = 0;
let inBuilder = false;
let customCoursePlay = false;

// Score names
const SCORE_NAMES = {
    '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!',
    '0': 'Par', '1': 'Bogey', '2': 'Double Bogey', '3': 'Triple Bogey'
};

// ---- Club system ----
// Yard conversion: 1 yard = 3 world units (CELL = 16, so ~5 yards per cell)
const YDS_TO_WORLD = 16;

const CLUBS = [
    { name: 'Driver',  maxPower: 500, launch: 780, airMin: 0.15, maxYds: 230 },
    { name: '3 Wood',  maxPower: 420, launch: 680, airMin: 0.18, maxYds: 195 },
    { name: '5 Iron',  maxPower: 340, launch: 500, airMin: 0.20, maxYds: 160 },
    { name: '7 Iron',  maxPower: 260, launch: 420, airMin: 0.22, maxYds: 120 },
    { name: 'P Wedge', maxPower: 180, launch: 560, airMin: 0.15, maxYds: 80  },
    { name: 'Putter',  maxPower: 120, launch: 0,   airMin: 999,  maxYds: 40  }
];
let selectedClub = 0;

// ---- Wind system ----
let wind = { speed: 0, angle: 0 }; // speed in mph, angle in radians

function generateWind() {
    wind.speed = Math.random() * 12 + 1; // 1-13 mph
    wind.angle = Math.random() * Math.PI * 2;
}

// ---- Flyover & scouting state ----
let flyoverActive = false;
let flyoverTimer = 0;
let flyoverPhase = 'toHole'; // 'toHole' | 'pause' | 'toBall'
let scouting = false;
let scoutCamX = 0, scoutCamY = 0;
let scoutLastX = 0, scoutLastY = 0;

function distToHole() {
    if (!currentHole) return 0;
    const hx = (currentHole.hole.x + 0.5) * CELL;
    const hy = (currentHole.hole.y + 0.5) * CELL;
    const dx = ball.x - hx, dy = ball.y - hy;
    return Math.sqrt(dx * dx + dy * dy);
}

function autoSelectClub() {
    const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;
    if (onGreen) { selectedClub = CLUBS.length - 1; return; } // Putter

    const dist = distToHole();
    // Pick the shortest club whose max range reaches the hole
    for (let i = CLUBS.length - 2; i >= 0; i--) {
        if (CLUBS[i].maxYds * YDS_TO_WORLD >= dist) {
            selectedClub = i;
            return;
        }
    }
    selectedClub = 0; // Driver if nothing else reaches
}

function updateTargetFromClub() {
    if (!currentHole) return;
    const club = CLUBS[selectedClub];
    const hx = (currentHole.hole.x + 0.5) * CELL;
    const hy = (currentHole.hole.y + 0.5) * CELL;
    const dx = hx - ball.x, dy = hy - ball.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxRange = club.maxYds * YDS_TO_WORLD;
    if (dist <= maxRange) {
        targetX = hx; targetY = hy;
    } else {
        targetX = ball.x + (dx / dist) * maxRange;
        targetY = ball.y + (dy / dist) * maxRange;
    }
    aimDirX = targetX - ball.x;
    aimDirY = targetY - ball.y;
    const aDist = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);
    aimPower = Math.min(aDist / (club.maxYds * YDS_TO_WORLD) * club.maxPower, club.maxPower);
}

function cycleClub(dir) {
    const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;
    if (onGreen) return; // Locked to putter on green
    selectedClub = (selectedClub + dir + CLUBS.length) % CLUBS.length;
    // Don't allow putter off the green
    if (selectedClub === CLUBS.length - 1) selectedClub = dir > 0 ? 0 : CLUBS.length - 2;
}

function notify(text) { notification = { text, timer: 2.5 }; }

// ---- Start a hole ----
function startHole(hole) {
    currentHole = hole;
    // Generate elevation heightmap if not already present
    if (!hole.heights) hole.heights = generateHeights(hole);
    ball.x = (hole.tee.x + 0.5) * CELL;
    ball.y = (hole.tee.y + 0.5) * CELL;
    ball.vx = 0; ball.vy = 0; ball.vz = 0; ball.moving = false; ball.airborne = false;
    ball.z = terrainHeightAt(ball.x, ball.y);
    strokes = 0;
    aiming = false;
    holeComplete = false;
    shotTrail = [];
    scouting = false;
    generateWind();
    autoSelectClub();

    // Place default target along tee-to-hole line at club range
    const holeWorldX = (hole.hole.x + 0.5) * CELL;
    const holeWorldY = (hole.hole.y + 0.5) * CELL;
    const dx = holeWorldX - ball.x, dy = holeWorldY - ball.y;
    const distToH = Math.sqrt(dx * dx + dy * dy);
    const club = CLUBS[selectedClub];
    const maxRange = club.maxYds * YDS_TO_WORLD;
    if (distToH <= maxRange) {
        targetX = holeWorldX;
        targetY = holeWorldY;
    } else {
        targetX = ball.x + (dx / distToH) * maxRange;
        targetY = ball.y + (dy / distToH) * maxRange;
    }
    // Pre-calculate aim from default target
    aimDirX = targetX - ball.x;
    aimDirY = targetY - ball.y;
    const aDist = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);
    aimPower = Math.min(aDist / (club.maxYds * YDS_TO_WORLD) * club.maxPower, club.maxPower);

    // Reset camera fully for new hole
    cam.targetRot = 0;
    cam.rot = 0;
    manualZoom = false;
    shotLocked = false;
    meterActive = false;

    // Build 3D scene for this hole
    if (typeof buildTerrain3D === 'function') buildTerrain3D(hole);

    // Start flyover: zoom out to show whole hole, pan from hole to ball
    centerCamOnHole();
    cam.zoom = calcZoom();
    cam.x = cam.targetX;
    cam.y = cam.targetY;
    flyoverActive = true;
    flyoverTimer = 0;
    flyoverPhase = 'overview';
}

function calcZoom() {
    // For gameplay overhead — focused on the ball area, not the whole hole.
    // Fixed comfortable height regardless of hole length.
    return 1.0;
}

function centerCamOnBall() {
    cam.targetX = ball.x;
    cam.targetY = ball.y;
}

function centerCamOnHole() {
    if (!currentHole) return;
    if (currentHole.bounds) {
        // World hole — frame the tee→pin corridor, not the whole course
        const b = currentHole.bounds;
        cam.targetX = ((b.minC + b.maxC) / 2 + 0.5) * CELL;
        cam.targetY = ((b.minR + b.maxR) / 2 + 0.5) * CELL;
    } else {
        cam.targetX = (currentHole.cols * CELL) / 2;
        cam.targetY = (currentHole.rows * CELL) / 2;
    }
    cam.targetZoom = calcZoom();
}

// ---- Terrain at world position ----
function terrainAt(wx, wy) {
    if (!currentHole) return T.OOB;
    const gc = Math.floor(wx / CELL);
    const gr = Math.floor(wy / CELL);
    if (gc < 0 || gc >= currentHole.cols || gr < 0 || gr >= currentHole.rows) return T.OOB;
    return currentHole.grid[gr][gc];
}

// Terrain elevation at world position (in world units)
function terrainHeightAt(wx, wy) {
    if (!currentHole || !currentHole.heights) return 0;
    const gc = Math.floor(wx / CELL);
    const gr = Math.floor(wy / CELL);
    if (gc < 0 || gc >= currentHole.cols || gr < 0 || gr >= currentHole.rows) return 0;
    return currentHole.heights[gr][gc] || 0;
}

// Downhill gradient from the heightmap — returns a vector pointing downhill.
// sx/sy are dimensionless (height drop per world unit).
function terrainSlopeAt(wx, wy) {
    const hE = terrainHeightAt(wx + CELL, wy);
    const hW = terrainHeightAt(wx - CELL, wy);
    const hS = terrainHeightAt(wx, wy + CELL);
    const hN = terrainHeightAt(wx, wy - CELL);
    // Negative gradient = downhill direction
    return {
        sx: -(hE - hW) / (2 * CELL),
        sy: -(hS - hN) / (2 * CELL)
    };
}

// Generate a heightmap for a hole using smooth noise
function generateHeights(hole) {
    const h = [];
    // Generate a low-res control grid of random heights, then smoothly interpolate
    // This gives rolling hills instead of jagged pixel noise
    const seed = hole.cols * 137 + hole.rows * 311;
    function hash(x, y) {
        const a = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
        return (a - Math.floor(a)) * 2 - 1; // -1 to 1
    }
    // Low-res control grid (every 15 cells)
    const STEP = 15;
    const ctrlCols = Math.ceil(hole.cols / STEP) + 2;
    const ctrlRows = Math.ceil(hole.rows / STEP) + 2;
    const ctrl = [];
    for (let r = 0; r < ctrlRows; r++) {
        ctrl[r] = [];
        for (let c = 0; c < ctrlCols; c++) {
            // Two octaves of hash noise — dramatic rolling hills
            ctrl[r][c] = hash(c, r) * 60 + hash(c * 2.7, r * 2.7) * 20;
        }
    }
    // Smoothstep curve for interpolation (matches Perlin-style easing)
    function smooth(t) { return t * t * (3 - 2 * t); }
    for (let r = 0; r < hole.rows; r++) {
        h[r] = [];
        for (let c = 0; c < hole.cols; c++) {
            // Bilinear interpolation from control grid
            const fc = c / STEP, fr = r / STEP;
            const cx = Math.floor(fc), cy = Math.floor(fr);
            const tx = smooth(fc - cx), ty = smooth(fr - cy);
            const a = ctrl[cy][cx];
            const b = ctrl[cy][cx + 1];
            const cc = ctrl[cy + 1][cx];
            const d = ctrl[cy + 1][cx + 1];
            let height = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
            // Flatten tees, greens, fairways; paths get gentle grading so
            // walkways don't ride raw noise bumps
            const t = hole.grid[r][c];
            if (t === T.TEE || t === T.GREEN) height *= 0.1;
            else if (t === T.FAIRWAY) height *= 0.5;
            else if (t === T.PATH) height *= 0.35;
            // Water vertices sit at 0 so they match surrounding terrain flat
            if (t === T.WATER) height = 0;
            // Fold valleys up to ground level: land never dips below y=0,
            // so the global water surface (y=-1.4) only ever shows inside
            // carved ponds.
            let q = Math.max(0, height);
            // Terraced plateaus (reference terrain language): flat steps
            // with short steep lips — cliff faces pick up the slope-soil
            // shading automatically
            const STEP_H = 16;
            const stepBase = Math.floor(q / STEP_H) * STEP_H;
            const frac = (q - stepBase) / STEP_H;
            const lip = frac < 0.68 ? 0 : (frac - 0.68) / 0.32;
            h[r][c] = stepBase + lip * lip * STEP_H;
        }
    }
    return h;
}

// ---- Ball physics update ----
const GRAVITY = 304; // tuned for 15% slower flight, 20% higher arc

function updateBall(dt) {
    if (!ball.moving) return;
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

    // Ball has stopped rolling on ground — but only if the slope can't keep it going
    if (speed < 2 && !ball.airborne) {
        const hslope = terrainSlopeAt(ball.x, ball.y);
        const slopeMag = Math.sqrt(hslope.sx * hslope.sx + hslope.sy * hslope.sy);
        // Friction strong enough to hold on this gradient?
        const ter = terrainAt(ball.x, ball.y);
        const staticHold = (1 - (TERRAIN_FRICTION[ter] || 0.97)) * 0.8;
        if (slopeMag < staticHold) {
            ball.vx = 0; ball.vy = 0; ball.vz = 0;
            ball.z = terrainHeightAt(ball.x, ball.y);
            ball.moving = false; ball.airborne = false;
            onBallStopped();
            return;
        }
        // Otherwise: nudge the ball downhill so slope takes over
        ball.vx = hslope.sx * 30;
        ball.vy = hslope.sy * 30;
    }

    // Record trail
    if (shotTrail.length === 0 || Math.abs(ball.x - shotTrail[shotTrail.length-1].x) > 3 ||
        Math.abs(ball.y - shotTrail[shotTrail.length-1].y) > 3) {
        shotTrail.push({ x: ball.x, y: ball.y });
        if (shotTrail.length > 200) shotTrail.shift();
    }

    // Move (sub-stepping for accuracy)
    const steps = Math.max(1, Math.ceil(speed * dt / 2));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
        ball.x += ball.vx * stepDt;
        ball.y += ball.vy * stepDt;

        // Airborne physics
        if (ball.airborne) {
            ball.z += ball.vz * stepDt;
            ball.vz -= GRAVITY * stepDt;

            // Curl: continuous lateral force perpendicular to velocity
            if (ball.curl !== 0) {
                const spd = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                if (spd > 1) {
                    const cnx = ball.vx / spd, cny = ball.vy / spd;
                    const cpx = -cny, cpy = cnx; // perpendicular
                    const curlForce = ball.curl * 120 * stepDt;
                    ball.vx += cpx * curlForce;
                    ball.vy += cpy * curlForce;
                }
            }

            // Wind: continuous force while airborne (strongest when ball is high)
            // Tuned so 10 mph crosswind ≈ 10-15 yd drift on a 230 yd drive
            const heightBoost = Math.min(1 + ball.z / 300, 1.8);
            const windForcePerSec = wind.speed * 1.0 * heightBoost;
            ball.vx += Math.cos(wind.angle) * windForcePerSec * stepDt;
            ball.vy += Math.sin(wind.angle) * windForcePerSec * stepDt;

            // Ball has landed (z below the terrain at current position)
            const groundHeight = terrainHeightAt(ball.x, ball.y);
            if (ball.z <= groundHeight) {
                // Capture the vertical speed BEFORE zeroing so bounce math has it
                const vzImpact = Math.abs(ball.vz);
                ball.z = groundHeight;

                // Check what we landed on
                const ter = terrainAt(ball.x, ball.y);
                if (ter === T.WATER) {
                    ball.vx = 0; ball.vy = 0; ball.vz = 0; ball.moving = false;
                    notify('Splash! +1 stroke');
                    strokes++;
                    resetBallToLastSafe();
                    return;
                }
                if (ter === T.OOB) {
                    ball.vx = 0; ball.vy = 0; ball.vz = 0; ball.moving = false;
                    notify('Out of bounds! +1 stroke');
                    strokes++;
                    resetBallToLastSafe();
                    return;
                }
                if (ter === T.TREE) {
                    // Hit tree canopy — drops straight down with heavy speed loss
                    ball.vx *= 0.15;
                    ball.vy *= 0.15;
                    notify('Landed in trees!');
                }

                ball.bounceCount = (ball.bounceCount || 0) + 1;
                const isFirstBounce = ball.bounceCount === 1;
                const topSpinMult = ball.topSpin || 0;

                // Incoming angle: shallow (rolling in) = 0, steep (dropping in) = near π/2
                const hSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                const cosAngle = hSpeed > 1 ? Math.cos(Math.atan2(vzImpact, hSpeed)) : 0;
                // Cubed — much more aggressive stop on steep shots, runout on flat
                const rollAngleFactor = cosAngle * cosAngle * cosAngle;

                // Horizontal speed retained after bounce
                let rollRetain = 0.15 + rollAngleFactor * 0.78; // ~0.15 (vertical) -> ~0.93 (rolling in)
                // Terrain modifiers
                if (ter === T.FAIRWAY || ter === T.TEE) rollRetain *= 1.05;
                else if (ter === T.GREEN) rollRetain *= 0.55;  // green grabs
                else if (ter === T.ROUGH) rollRetain *= 0.4;   // rough kills forward momentum
                else if (ter === T.SAND) rollRetain = 0.08;    // sand is a brick wall
                else if (ter === T.PATH) rollRetain *= 1.3;    // cartpath is lively
                // Topspin adds, backspin removes
                rollRetain += topSpinMult * 0.12;
                rollRetain = Math.max(0.03, Math.min(0.95, rollRetain));
                ball.vx *= rollRetain;
                ball.vy *= rollRetain;

                // Vertical bounce — preserve some vz so the ball springs up again
                // Uses cosAngle (linear) so steep shots still bounce a little
                const bounceTable = [0.40, 0.22, 0.10, 0];
                let vzRetain = bounceTable[Math.min(ball.bounceCount - 1, 3)] * (0.35 + cosAngle * 0.65);
                if (ter === T.SAND) vzRetain = 0;
                if (ter === T.ROUGH) vzRetain *= 0.3;
                if (ter === T.TREE) vzRetain = 0;
                if (vzRetain > 0 && vzImpact > 40) {
                    ball.vz = vzImpact * vzRetain;
                    ball.airborne = true;
                } else {
                    ball.vz = 0;
                    ball.airborne = false;
                }

                // Backspin check — only on the first bounce on green/fairway
                if (isFirstBounce && topSpinMult < -0.2 && (ter === T.GREEN || ter === T.FAIRWAY)) {
                    const backMag = Math.abs(topSpinMult);
                    const cs = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                    if (cs > 4) {
                        const nx = ball.vx / cs, ny = ball.vy / cs;
                        // Reverse a chunk of the remaining horizontal velocity
                        const backImpulse = (cs + 60) * backMag * 1.6;
                        ball.vx -= nx * backImpulse;
                        ball.vy -= ny * backImpulse;
                    }
                }
                // Don't check hole while landing — need to roll in
            }
            continue; // Skip ground checks while airborne
        }

        // ---- Ground physics ----
        const ter = terrainAt(ball.x, ball.y);
        const fric = TERRAIN_FRICTION[ter];

        if (ter === T.WATER) {
            ball.vx = 0; ball.vy = 0; ball.moving = false;
            notify('Water! +1 stroke');
            strokes++;
            resetBallToLastSafe();
            return;
        }
        if (ter === T.OOB) {
            ball.vx = 0; ball.vy = 0; ball.moving = false;
            notify('Out of bounds! +1 stroke');
            strokes++;
            resetBallToLastSafe();
            return;
        }
        if (ter === T.TREE) {
            ball.vx *= -0.4;
            ball.vy *= -0.4;
            ball.x += ball.vx * stepDt * 3;
            ball.y += ball.vy * stepDt * 3;
            notify('Hit a tree!');
        }

        // Apply terrain friction
        ball.vx *= Math.pow(fric, stepDt * 60);
        ball.vy *= Math.pow(fric, stepDt * 60);

        // Heightmap slope force — downhill gravity on every terrain type.
        // Keeps the ball rolling on slopes and dead-flats it on plateaus.
        const hslope = terrainSlopeAt(ball.x, ball.y);
        // Greens are flatter (10% height) so boost their slope response a bit for feel.
        const slopeGain = (ter === T.GREEN) ? 420 : 350;
        ball.vx += hslope.sx * slopeGain * stepDt;
        ball.vy += hslope.sy * slopeGain * stepDt;
        // Keep the ball in the heightmap pocket (don't let it float off a hill)
        ball.z = terrainHeightAt(ball.x, ball.y);

        // Green slope forces — ball breaks toward hole with variation
        if (ter === T.GREEN && currentHole) {
            const holeWx = (currentHole.hole.x + 0.5) * CELL;
            const holeWy = (currentHole.hole.y + 0.5) * CELL;
            const toHx = holeWx - ball.x, toHy = holeWy - ball.y;
            const toHd = Math.sqrt(toHx * toHx + toHy * toHy);
            if (toHd > 2) {
                const gc = Math.floor(ball.x / CELL), gr = Math.floor(ball.y / CELL);
                const seed = Math.sin(gc * 12.9898 + gr * 78.233) * 43758.5453;
                const variation = (seed - Math.floor(seed)) * 0.8 - 0.4;
                const slopeAng = Math.atan2(toHy, toHx) + variation;
                ball.vx += Math.cos(slopeAng) * 1.5 * stepDt * 60;
                ball.vy += Math.sin(slopeAng) * 1.5 * stepDt * 60;
            }
        }

        // Check if ball rolls into hole (only on ground)
        const hx = (currentHole.hole.x + 0.5) * CELL;
        const hy = (currentHole.hole.y + 0.5) * CELL;
        const dx = ball.x - hx, dy = ball.y - hy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 6 && speed < 200) {
            ball.x = hx; ball.y = hy;
            ball.vx = 0; ball.vy = 0; ball.z = 0; ball.vz = 0;
            ball.moving = false; ball.airborne = false;
            onHoleComplete();
            return;
        }
    }

    centerCamOnBall();
}

let lastSafePos = { x: 0, y: 0 };
let shotStartPos = { x: 0, y: 0 };

function resetBallToLastSafe() {
    ball.x = lastSafePos.x;
    ball.y = lastSafePos.y;
    ball.moving = false;
    centerCamOnBall();
}

function onBallStopped() {
    const ter = terrainAt(ball.x, ball.y);
    if (ter !== T.WATER && ter !== T.OOB) {
        lastSafePos = { x: ball.x, y: ball.y };
    }

    // Announce shot distance traveled
    const dx = ball.x - shotStartPos.x, dy = ball.y - shotStartPos.y;
    const shotYds = Math.round(Math.sqrt(dx * dx + dy * dy) / YDS_TO_WORLD);
    if (shotYds > 1 && !holeComplete) {
        const toHoleYds = Math.round(distToHole() / YDS_TO_WORLD);
        notify(shotYds + ' yd shot \u2022 ' + toHoleYds + ' yds to hole');
    }

    shotTrail = [];
    autoSelectClub();
    updateTargetFromClub(); // reposition target for new ball position
    shotLocked = false;

    // Distance-based zoom: closer to hole = more zoom for precision
    if (!manualZoom) {
        const dist = distToHole();
        const maxDist = 800; // rough max distance on any hole
        const closeness = 1 - Math.min(dist / maxDist, 1); // 0 = far, 1 = very close
        if (ter === T.GREEN) {
            // On green: zoom in tight + rotate behind ball facing hole
            cam.targetZoom = Math.min(calcZoom() * 3 + closeness * 2, 7);
            const hx = (currentHole.hole.x + 0.5) * CELL;
            const hy = (currentHole.hole.y + 0.5) * CELL;
            const dx = hx - ball.x, dy = hy - ball.y;
            cam.targetRot = Math.atan2(dx, -dy); // behind ball, hole is "up"
        } else {
            // Off green: zoom more as you get closer
            const baseZoom = calcZoom();
            cam.targetZoom = baseZoom + closeness * baseZoom * 0.8;
            cam.targetRot = 0; // reset rotation off green
        }
    }
}

function onHoleComplete() {
    holeComplete = true;
    const diff = strokes - currentHole.par;
    const name = SCORE_NAMES[String(diff)] || (diff > 0 ? '+' + diff : '' + diff);
    if (strokes === 1) notify('HOLE IN ONE!!!');
    else notify(name);
    holeStrokes.push(strokes);
    // Tycoon payout — manual play always pays better than auto-sim
    const coins = Math.round(coinsForScore(currentHole.par, strokes) * 1.5);
    awardCoins(coins);
    lastHoleCoinReward = coins;
}

let lastHoleCoinReward = 0;

// ---- Fire shot from meter results ----
function fireFromMeter(dirX, dirY, powerPct, accuracy, curlAmt) {
    // powerPct: 0-1 from phase 1
    // accuracy: -1 to 1 from phase 2 (0 = perfect)
    // curlAmt: -1 to 1 from dragging during phase 2

    const club = CLUBS[selectedClub];

    // Apply accuracy as hook/slice — scaled by zone
    // Green zone (center 33%): no deviation. Yellow: mild. Red: moderate.
    const absAcc = Math.abs(accuracy);
    let deviation = 0;
    if (absAcc < 0.33) {
        deviation = 0; // green zone — perfect
    } else if (absAcc < 0.66) {
        deviation = ((absAcc - 0.33) / 0.33) * 0.08; // yellow: 0 to ~5°
    } else {
        deviation = 0.08 + ((absAcc - 0.66) / 0.34) * 0.12; // red: 5° to ~12°
    }
    deviation *= Math.sign(accuracy);
    const cos = Math.cos(deviation), sin = Math.sin(deviation);
    const newDirX = dirX * cos - dirY * sin;
    const newDirY = dirX * sin + dirY * cos;

    const finalPower = club.maxPower * powerPct;

    if (absAcc < 0.33) notify('Perfect!');
    else if (absAcc < 0.5) notify('Great!');
    else if (absAcc < 0.66) notify('Good');
    else if (accuracy < -0.66) notify('Hook!');
    else notify('Slice!');

    // Store curl for flight physics
    ball.curl = curlAmt;

    takeShot(finalPower, newDirX, newDirY);
}

// ---- Shot mechanic (Golf Clash style) ----
// Lie modifiers — how different terrains affect shot quality
const LIE_MODIFIERS = {
    [T.TEE]:     { power: 1.00, spin: 1.00, launchMult: 1.00, name: 'Tee' },
    [T.FAIRWAY]: { power: 1.00, spin: 1.00, launchMult: 1.00, name: 'Fairway' },
    [T.GREEN]:   { power: 1.00, spin: 1.00, launchMult: 1.00, name: 'Green' },
    [T.ROUGH]:   { power: 0.80, spin: 0.40, launchMult: 0.85, name: 'Rough' },
    [T.SAND]:    { power: 0.55, spin: 0.00, launchMult: 0.70, name: 'Sand' },
    [T.PATH]:    { power: 0.95, spin: 0.80, launchMult: 0.95, name: 'Path' },
};

function getLieModifier(x, y) {
    const t = terrainAt(x, y);
    return LIE_MODIFIERS[t] || LIE_MODIFIERS[T.FAIRWAY];
}

function takeShot(power, dirX, dirY) {
    const club = CLUBS[selectedClub];
    const lie = getLieModifier(ball.x, ball.y);
    // Apply lie power cap — can't hit full shots from rough/sand
    const p = Math.min(power, club.maxPower) * lie.power;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len === 0) return;
    const powerPct = p / club.maxPower;

    const targetDist = club.maxYds * YDS_TO_WORLD * powerPct;
    let velocity;

    ball.moving = true;
    ball.z = terrainHeightAt(ball.x, ball.y);
    ball.vz = 0;
    ball.airborne = false;
    ball.bounceCount = 0;

    if (club.launch > 0 && powerPct > club.airMin) {
        ball.airborne = true;
        // Non-linear launch + lie reduces launch height (ball doesn't pop up as well from rough)
        ball.vz = club.launch * Math.pow(powerPct, 1.4) * lie.launchMult;
        const airTime = 2 * ball.vz / GRAVITY;
        velocity = (targetDist * 0.85) / Math.max(airTime, 0.1);
    } else {
        velocity = targetDist * 1.2;
    }

    ball.vx = (dirX / len) * velocity;
    ball.vy = (dirY / len) * velocity;

    // Apply sidespin — reduced by poor lies
    if (spin.side !== 0 && ball.airborne) {
        const nx = dirX / len, ny = dirY / len;
        const perpX = -ny, perpY = nx;
        const sideForce = spin.side * p * 0.15 * lie.spin;
        ball.vx += perpX * sideForce;
        ball.vy += perpY * sideForce;
    }

    // Store topspin (reduced by lie) for landing roll
    ball.topSpin = spin.top * lie.spin;

    strokes++;
    shotStartPos = { x: ball.x, y: ball.y };
    lastSafePos = { x: ball.x, y: ball.y };
    shotTrail = [];
    aiming = false;
    meterActive = false;
    meterPhase = 0;
    shotLocked = false;
    putting = false;
    dragBackMode = false;
    dragBackActive = false;
    dragBackY = 0;
    manualZoom = false;
    spin = { top: 0, side: 0 }; // reset spin after shot
}

// ---- Shot system state ----
let aimDirX = 0, aimDirY = 0, aimPower = 0;
let putting = false;
let puttTargetX = 0, puttTargetY = 0;

// Target-based aiming: player drags a target on the ground
let targetX = 0, targetY = 0; // world coords of the aim target
let draggingTarget = false;
let aiming = false; // true when target is being positioned (replaces old aiming)

// Shot lock: aim is confirmed, ready for shot meter
let shotLocked = false;
let lockedPower = 0, lockedDirX = 0, lockedDirY = 0;

// Shot meter: accuracy arc with sweeping arrow
let meterActive = false;
let meterPhase = 0;
let meterAngle = 0;    // current arrow angle in the arc (-1 to 1, 0 = center)
let meterSpeed = 2.0;
let meterDir = 1;      // sweep direction
let curl = 0;
let curlDragStartX = 0;

// Putt accuracy mini-game (runs during drag-back on the green)
let puttMeterAngle = 0;
let puttMeterDir = 1;
let puttMeterSpeed = 1.3;

// Drag-back mini-game (TAKE SHOT → drag ball into the circle → accuracy arc)
let dragBackMode = false;   // True once TAKE SHOT pressed, before shot fires
let dragBackActive = false; // True while the player's finger is on the ball
let dragBackY = 0;          // How far (in px) the drag has been pulled back
let dragBackStartSY = 0;    // Screen Y where drag started
const DRAG_BACK_THRESHOLD = 100; // Pixels to pull back before meter engages

// Camera state saved before entering meter mode
let preMeterCam = { x: 0, y: 0, zoom: 1, rot: 0 };

// Ball spin
let spin = { top: 0, side: 0 };
let spinAdjusting = false;

// Green slopes (per-hole, generated from hole data)
let greenSlopes = [];
let builderTouchAction = null;
let charColors = ['#fff','#f44','#ff9800','#ffeb3b','#4caf50','#2196f3','#9c27b0','#e91e63','#00bcd4','#000'];
let charColorIdx = 0;

function onTouchStart(sx, sy) {
    if (state === 'menu') { menuTouchStart(sx, sy); return; }
    if (state === 'manage') { manageTouchStart(sx, sy); return; }
    if (state === 'overworld') { overworldTouchStart(sx, sy); return; }
    if (state === 'character') { charTouchStart(sx, sy); return; }
    if (state === 'career') { careerTouchStart(sx, sy); return; }
    if (state === 'builder') {
        builderTouchAction = builderHandleTouch(sx, sy);
        if (builderTouchAction === 'back') { setState('menu'); return; }
        if (builderTouchAction === 'save') { const n = builderSave(); notify('Saved! (' + n + ' holes)'); return; }
        if (builderTouchAction === 'play') {
            const h = builderGetHole(3);
            if (!h.tee || !h.hole) { notify('Place tee & hole first!'); return; }
            currentCourse = { name: 'Custom', holes: [h] };
            currentHoleIdx = 0; holeStrokes = [];
            startHole(h); customCoursePlay = true; setState('playing'); return;
        }
        if (!builderTouchAction) { builderState.painting = true; builderPaint(sx, sy); }
        return;
    }
    if (state === 'holeDone') { holeDoneTouchStart(sx, sy); return; }
    if (state === 'roundDone') { roundDoneTouchStart(sx, sy); return; }
    if (state === 'playing') {
        // Quit + camera-rail buttons take priority over aim/pan handling
        if (checkPlayingUI(sx, sy)) return;
        if (flyoverActive) {
            flyoverActive = false;
            centerCamOnBall();
            cam.targetZoom = calcZoom();
            return;
        }
        if (ball.moving || holeComplete) return;
        const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;

        // (Legacy tap-to-fire meter replaced by drag-back mini-game below)

        // ---- Putting: drag back from ball ----
        if (onGreen) {
            const bs = (scene3dReady && typeof worldToScreen3D === 'function') ? worldToScreen3D(ball.x, ball.y) : worldToScreen(ball.x, ball.y);
            const bdx = sx - bs.x, bdy = sy - bs.y;
            if (bdx * bdx + bdy * bdy < 90 * 90) {
                aiming = true;
                putting = true;
                aimStartX = sx; aimStartY = sy;
                // Start putt accuracy sweep fresh
                puttMeterAngle = -1;
                puttMeterDir = 1;
                return;
            }
            // On green but didn't touch ball — pan camera
            scouting = true;
            scoutLastX = sx;
            scoutLastY = sy;
            return;
        }

        // ---- Target grab: check if touch is near the target crosshair ----
        if (sy < H() - 140) {
            const ts = (scene3dReady && typeof worldToScreen3D === 'function') ? worldToScreen3D(targetX, targetY) : worldToScreen(targetX, targetY);
            const tdx = sx - ts.x, tdy = sy - ts.y;
            const grabRadius = 45; // fixed screen-space radius
            if (tdx * tdx + tdy * tdy < grabRadius * grabRadius) {
                draggingTarget = true;
                aiming = true;
                shotLocked = false;
                return;
            }
        }

        // ---- Drag-back mini-game: touching the ball begins the drag ----
        if (dragBackMode && !dragBackActive) {
            const bs = (scene3dReady && typeof worldToScreen3D === 'function') ? worldToScreen3D(ball.x, ball.y) : worldToScreen(ball.x, ball.y);
            const bdx = sx - bs.x, bdy = sy - bs.y;
            if (bdx * bdx + bdy * bdy < 110 * 110) {
                dragBackActive = true;
                dragBackStartSY = sy;
                dragBackY = 0;
                meterActive = false;
                return;
            }
            // Re-Aim button: back out of drag-back mode to the overhead aim view
            const reAimW = W() * 0.32, reAimH = 44;
            const reAimX = W() - reAimW - 14, reAimY = H() - 56;
            if (hitBtn(sx, sy, reAimX, reAimY, reAimW, reAimH)) {
                dragBackMode = false;
                dragBackActive = false;
                dragBackY = 0;
                shotLocked = false; // Free aim again
                meterActive = false;
                cam.targetRot = preMeterCam.rot;
                cam.targetZoom = preMeterCam.zoom;
                cam.targetX = preMeterCam.x;
                cam.targetY = preMeterCam.y;
                return;
            }
        }

        // ---- UI buttons ----
        // SHOOT bar: shown either after the player has locked a drag, OR as a shortcut
        // to accept the auto-placed aim without any drag at all.
        const canTakeShot = !dragBackMode && !ball.moving && !holeComplete && !flyoverActive && terrainAt(ball.x, ball.y) !== T.GREEN;
        if (canTakeShot) {
            const shootBtnH = 44;
            const shootBtnX = 102;
            const shootBtnY = H() - 100 + (100 - shootBtnH) / 2;
            const shootBtnW = W() - 204;
            if (hitBtn(sx, sy, shootBtnX, shootBtnY, shootBtnW, shootBtnH)) {
                // Lock from current aim if not already locked
                if (!shotLocked) {
                    if (aimPower <= 5) return; // nothing to fire
                    lockedPower = aimPower;
                    lockedDirX = aimDirX;
                    lockedDirY = aimDirY;
                    shotLocked = true;
                }
                // Enter drag-back mode — camera swings behind, waiting for player to pull the ball back
                preMeterCam = { x: cam.targetX, y: cam.targetY, zoom: cam.targetZoom, rot: cam.targetRot };
                const aDx = lockedDirX, aDy = lockedDirY;
                const behindAngle = Math.atan2(aDx, -aDy);
                cam.targetRot = behindAngle;
                cam.targetX = ball.x;
                cam.targetY = ball.y;
                cam.targetZoom = Math.max(cam.targetZoom * 1.5, 3);
                dragBackMode = true;
                shotLocked = false;
                meterActive = false;
                meterAngle = -1;
                meterDir = 1;
                curl = 0;
                meterSpeed = (0.75 + (CLUBS[selectedClub].maxPower / 500) * 0.75);
                return;
            }
            // Cancel button — right slot of tray when locked
            if (shotLocked) {
                const cancelX = W() - 92, cancelW = 82, cancelH = 44;
                const cancelY = H() - 100 + (100 - cancelH) / 2;
                if (hitBtn(sx, sy, cancelX, cancelY, cancelW, cancelH)) {
                    shotLocked = false;
                    return;
                }
            }
        }
        // Club switching — left slot of tray (up/down arrows)
        const onGreenTap = terrainAt(ball.x, ball.y) === T.GREEN;
        const trayY = H() - 100;
        if (!shotLocked && !dragBackMode && !onGreenTap && !ball.moving && !flyoverActive) {
            const cardX = 10, cardW = 82;
            if (sx >= cardX && sx <= cardX + cardW) {
                if (sy >= trayY + 4 && sy <= trayY + 26) { cycleClub(-1); updateTargetFromClub(); return; }
                if (sy >= trayY + 74 && sy <= trayY + 96) { cycleClub(1); updateTargetFromClub(); return; }
            }
        }
        // Spin control — right slot of tray
        if (!flyoverActive && !dragBackMode && !shotLocked && !onGreenTap) {
            const spX = W() - 50, spY = trayY + 100 / 2 - 4, spR = 26;
            const sdx = sx - spX, sdy = sy - spY;
            if (sdx * sdx + sdy * sdy < (spR + 10) * (spR + 10)) {
                spinAdjusting = true;
                spin.side = Math.max(-1, Math.min(1, sdx / (spR * 0.8)));
                spin.top = Math.max(-1, Math.min(1, -sdy / (spR * 0.8)));
                return;
            }
        }

        // Absorb stray taps inside the tray so they don't start a camera pan
        if (!onGreenTap && sy >= trayY && !flyoverActive) return;

        // ---- Camera pan (fallback — any touch that wasn't caught above) ----
        scouting = true;
        scoutLastX = sx;
        scoutLastY = sy;
    }
}

function onTouchMove(sx, sy) {
    if (state === 'builder' && builderState.painting) { builderPaint(sx, sy); return; }
    if (state === 'overworld') { overworldTouchMove(sx, sy); return; }
    if (state === 'playing' && spinAdjusting) {
        const spX = W() - 50, spY = (H() - 100) + 100 / 2 - 4, spR = 26;
        spin.side = Math.max(-1, Math.min(1, (sx - spX) / (spR * 0.8)));
        spin.top = Math.max(-1, Math.min(1, -(sy - spY) / (spR * 0.8)));
        return;
    }
    if (state === 'playing' && dragBackActive) {
        // Track how far the ball has been pulled back (only downward drag counts)
        const raw = sy - dragBackStartSY;
        dragBackY = Math.max(0, Math.min(raw, DRAG_BACK_THRESHOLD * 1.5));
        // Engage accuracy meter once the drag crosses the threshold
        if (!meterActive && dragBackY >= DRAG_BACK_THRESHOLD) {
            meterActive = true;
            meterPhase = 2;
            meterAngle = -1;
            meterDir = 1;
        }
        return;
    }
    if (state === 'playing' && draggingTarget) {
        const wp = (scene3dReady && typeof screenToWorld3D === 'function') ? screenToWorld3D(sx, sy) : screenToWorld(sx, sy);
        const club = CLUBS[selectedClub];
        const maxRange = club.maxYds * YDS_TO_WORLD;
        // Clamp target within max club range
        let dx = wp.x - ball.x, dy = wp.y - ball.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxRange) {
            dx = (dx / dist) * maxRange;
            dy = (dy / dist) * maxRange;
        }
        targetX = ball.x + dx;
        targetY = ball.y + dy;
        aimDirX = dx;
        aimDirY = dy;
        const clampedDist = Math.sqrt(dx * dx + dy * dy);
        aimPower = (clampedDist / maxRange) * club.maxPower;
        return;
    }
    if (state === 'playing' && putting) {
        const dx = sx - aimStartX;
        const dy = sy - aimStartY;
        const dragDist = Math.sqrt(dx * dx + dy * dy);

        // Convert screen drag to world direction
        // In 3D behind-ball view, screen "down" = toward ball, "up" = toward hole
        if (scene3dReady && typeof screenToWorld3D === 'function') {
            const startW = screenToWorld3D(aimStartX, aimStartY);
            const curW = screenToWorld3D(sx, sy);
            // Direction from current drag point to start = direction ball should go (opposite of drag)
            aimDirX = startW.x - curW.x;
            aimDirY = startW.y - curW.y;
        } else {
            aimDirX = -dx; aimDirY = -dy;
        }

        aimPower = Math.min(dragDist * 1.8, CLUBS[selectedClub].maxPower);
        const len = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);
        if (len > 0) {
            const puttDist = (aimPower / CLUBS[selectedClub].maxPower) * CLUBS[selectedClub].maxYds * YDS_TO_WORLD;
            puttTargetX = ball.x + (aimDirX / len) * puttDist;
            puttTargetY = ball.y + (aimDirY / len) * puttDist;
        }
        return;
    }
    if (state === 'playing' && scouting) {
        const dx = sx - scoutLastX;
        const dy = sy - scoutLastY;
        scoutLastX = sx;
        scoutLastY = sy;
        if (scene3dReady && typeof panCamera3D === 'function') {
            panCamera3D(dx, dy);
        } else {
            cam.targetX -= dx / cam.zoom;
            cam.targetY -= dy / cam.zoom;
        }
    }
}

function onTouchEnd(sx, sy) {
    if (state === 'builder') { builderState.painting = false; return; }
    if (state === 'overworld') { overworldTouchEnd(); return; }
    if (state === 'playing' && spinAdjusting) { spinAdjusting = false; return; }
    if (state === 'playing' && scouting) {
        scouting = false;
        // Keep camera where user left it — set manualZoom to prevent auto-cam
        manualZoom = true;
        return;
    }
    if (state === 'playing' && draggingTarget) {
        draggingTarget = false;
        if (aimPower > 5) {
            // Lock the aim — TAKE SHOT bar appears next
            lockedPower = aimPower;
            lockedDirX = aimDirX;
            lockedDirY = aimDirY;
            shotLocked = true;
        }
        aiming = false;
        return;
    }
    if (state === 'playing' && dragBackActive) {
        dragBackActive = false;
        if (meterActive) {
            // Fire with the current accuracy sweep value
            const accuracy = meterAngle;
            const powerPct = lockedPower / CLUBS[selectedClub].maxPower;
            fireFromMeter(lockedDirX, lockedDirY, powerPct, accuracy, 0);
            meterActive = false;
            meterPhase = 0;
            dragBackMode = false;
            dragBackY = 0;
            // Restore camera after firing
            cam.targetRot = preMeterCam.rot;
            cam.targetZoom = preMeterCam.zoom;
        } else {
            // Released before meter engaged — just reset the drag, stay in dragBackMode
            dragBackY = 0;
        }
        return;
    }
    if (state === 'playing' && putting) {
        if (aimPower > 8) {
            // Apply putt accuracy deviation based on where the sweep was stopped
            let dirX = aimDirX, dirY = aimDirY;
            const absAcc = Math.abs(puttMeterAngle);
            let devRad = 0;
            // Green zone (0-0.33): near-perfect, up to 0.6°
            // Yellow zone (0.33-0.66): slight miss, up to 2.5°
            // Red zone (0.66-1.0): big miss, up to 7°
            if (absAcc < 0.33) {
                devRad = (absAcc / 0.33) * 0.01;
            } else if (absAcc < 0.66) {
                devRad = 0.01 + ((absAcc - 0.33) / 0.33) * 0.033;
            } else {
                devRad = 0.043 + ((absAcc - 0.66) / 0.34) * 0.079;
            }
            devRad *= Math.sign(puttMeterAngle);
            const cosD = Math.cos(devRad), sinD = Math.sin(devRad);
            dirX = aimDirX * cosD - aimDirY * sinD;
            dirY = aimDirX * sinD + aimDirY * cosD;

            // Feedback notify
            if (absAcc > 0.66) notify(puttMeterAngle < 0 ? 'Pulled Left!' : 'Pushed Right!');
            else if (absAcc < 0.15) notify('Pure Strike!');

            takeShot(aimPower, dirX, dirY);
        }
        aiming = false;
        putting = false;
        aimPower = 0;
        return;
    }
}

// ---- Menu Screen ----
// Landscape two-column menu: left = title + player card, right = button list
// Primary path is the resort; the pre-overworld modes are demoted to a
// compact "classic modes" row until they're retired (see ROADMAP.md M2.5).
const MENU_BTNS = [
    { id: 'resort',  label: 'My Resort',      icon: '\u{1F3D6}\uFE0F', colors: ['#2e7d32', '#1b5e20'] },
    { id: 'manage',  label: 'Manage Resort',  icon: '\u{1F3DB}\uFE0F', colors: ['#ff6d00', '#e64a19'] },
    { id: 'char',    label: 'Character',      icon: '\u{1F464}',       colors: ['#1565c0', '#0d47a1'] },
];
const MENU_LEGACY_BTNS = [
    { id: 'career',  label: 'Career' },
    { id: 'builder', label: '2D Builder' },
    { id: 'custom',  label: 'Custom' },
];

function menuLayout() {
    const pad = 20;
    const leftW = Math.min(360, W() * 0.42);
    const leftX = pad;
    const rightX = leftW + pad * 2;
    const rightW = W() - rightX - pad;

    // Primary buttons + a compact legacy row underneath
    const btnCount = MENU_BTNS.length;
    const btnH = Math.min(54, Math.max(42, (H() - pad * 2 - 80) / btnCount - 10));
    const btnGap = 12;
    const legacyH = 30;
    const legacyGapTop = 26; // includes the "CLASSIC MODES" caption
    const totalH = btnCount * btnH + (btnCount - 1) * btnGap + legacyGapTop + legacyH;
    const btnStartY = (H() - totalH) / 2;
    const btnW = Math.min(rightW, 320);
    const btnX = rightX + (rightW - btnW) / 2;
    const legacyY = btnStartY + btnCount * btnH + (btnCount - 1) * btnGap + legacyGapTop;
    const legacyBtnW = (btnW - 16) / 3;

    // Player card on left — large avatar
    const pcW = Math.min(leftW - 20, 240);
    const pcH = 96;
    const pcX = leftX + (leftW - pcW) / 2;
    const pcY = H() * 0.58;

    return { pad, leftX, leftW, rightX, rightW, btnH, btnGap, btnW, btnX, btnStartY,
             legacyY, legacyH, legacyBtnW, pcX, pcY, pcW, pcH };
}

function drawMenu() {
    // Rich gradient background
    const bg = ctx.createLinearGradient(0, 0, 0, H());
    bg.addColorStop(0, '#0d2818');
    bg.addColorStop(0.5, '#1a472a');
    bg.addColorStop(1, '#0a1f10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W(), H());

    // Decorative pattern
    for (let i = 0; i < 18; i++) {
        const px = ((i * 97 + 33) % W());
        const py = ((i * 149 + 77) % H());
        const size = 20 + (i % 5) * 18;
        ctx.strokeStyle = `rgba(255,255,255,${0.02 + (i % 3) * 0.01})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.stroke();
    }

    const L = menuLayout();
    const leftCX = L.leftX + L.leftW / 2;

    // Title — big, left column top
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.font = '800 42px -apple-system,sans-serif';
    ctx.fillText('GOLF TYCOON', leftCX + 2, H() * 0.22 + 2);
    ctx.fillStyle = '#fff';
    ctx.fillText('GOLF TYCOON', leftCX, H() * 0.22);

    // Accent line
    const lineW = 140;
    const lineGrad = ctx.createLinearGradient(leftCX - lineW / 2, 0, leftCX + lineW / 2, 0);
    lineGrad.addColorStop(0, 'rgba(76,175,80,0)');
    lineGrad.addColorStop(0.5, 'rgba(76,175,80,0.8)');
    lineGrad.addColorStop(1, 'rgba(76,175,80,0)');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftCX - lineW / 2, H() * 0.22 + 12);
    ctx.lineTo(leftCX + lineW / 2, H() * 0.22 + 12);
    ctx.stroke();

    // Subtitle
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '300 13px -apple-system,sans-serif';
    ctx.fillText('Build courses. Run a resort. Be a legend.', leftCX, H() * 0.22 + 36);

    // Player card
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(L.pcX, L.pcY, L.pcW, L.pcH, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    roundRect(L.pcX, L.pcY, L.pcW, L.pcH, 18);
    ctx.stroke();
    drawBall(L.pcX + 40, L.pcY + L.pcH / 2, 24, player.ballColor);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px -apple-system,sans-serif';
    ctx.fillText(player.name, L.pcX + 78, L.pcY + 42);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '11px -apple-system,sans-serif';
    ctx.fillText('$ ' + Math.floor(resort.coins).toLocaleString() + '  \u2022  ' + resort.members + ' members',
                 L.pcX + 78, L.pcY + 62);

    // Right column — buttons
    let by = L.btnStartY;
    for (const btn of MENU_BTNS) {
        const btnGrad = ctx.createLinearGradient(L.btnX, by, L.btnX + L.btnW, by);
        btnGrad.addColorStop(0, btn.colors[0]);
        btnGrad.addColorStop(1, btn.colors[1]);
        ctx.fillStyle = btnGrad;
        roundRect(L.btnX, by, L.btnW, L.btnH, L.btnH / 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        roundRect(L.btnX, by, L.btnW, L.btnH, L.btnH / 2);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 17px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(btn.icon + '  ' + btn.label, L.btnX + L.btnW / 2, by + L.btnH / 2 + 6);
        by += L.btnH + L.btnGap;
    }

    // Legacy modes — compact ghost row with caption
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CLASSIC MODES', L.btnX + L.btnW / 2, L.legacyY - 8);
    for (let i = 0; i < MENU_LEGACY_BTNS.length; i++) {
        const lb = MENU_LEGACY_BTNS[i];
        const lx = L.btnX + i * (L.legacyBtnW + 8);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        roundRect(lx, L.legacyY, L.legacyBtnW, L.legacyH, L.legacyH / 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        roundRect(lx, L.legacyY, L.legacyBtnW, L.legacyH, L.legacyH / 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '11px -apple-system,sans-serif';
        ctx.fillText(lb.label, lx + L.legacyBtnW / 2, L.legacyY + L.legacyH / 2 + 4);
    }

    // Version — bottom right
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '11px -apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('build ' + BUILD_TAG, W() - 12, H() - 12);
}

function menuTouchStart(sx, sy) {
    const L = menuLayout();
    let by = L.btnStartY;
    for (const btn of MENU_BTNS) {
        if (hitBtn(sx, sy, L.btnX, by, L.btnW, L.btnH)) {
            if (btn.id === 'resort') enterOverworld();
            else if (btn.id === 'manage') enterManage();
            else if (btn.id === 'char') {
                charColorIdx = charColors.indexOf(player.ballColor);
                if (charColorIdx < 0) charColorIdx = 0;
                setState('character');
            }
            return;
        }
        by += L.btnH + L.btnGap;
    }
    // Legacy row
    for (let i = 0; i < MENU_LEGACY_BTNS.length; i++) {
        const lx = L.btnX + i * (L.legacyBtnW + 8);
        if (hitBtn(sx, sy, lx, L.legacyY, L.legacyBtnW, L.legacyH)) {
            const id = MENU_LEGACY_BTNS[i].id;
            if (id === 'career') setState('career');
            else if (id === 'builder') { builderInit(); setState('builder'); }
            else if (id === 'custom') playCustomCourses();
            return;
        }
    }
}


function playCustomCourses() {
    const saved = loadData('customHoles', []);
    if (saved.length === 0) { notify('No custom courses yet! Build one first.'); return; }
    currentCourse = { name: 'Custom Course', holes: saved };
    currentHoleIdx = 0; holeStrokes = [];
    startHole(saved[0]);
    customCoursePlay = true;
    setState('playing');
}

// ---- Character Creator ----
function drawCharacter() {
    const bg = ctx.createLinearGradient(0, 0, 0, H());
    bg.addColorStop(0, '#0d2818');
    bg.addColorStop(1, '#1a472a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W(), H());

    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '600 24px -apple-system,sans-serif';
    ctx.fillText('Your Golfer', W() / 2, H() * 0.10);

    // Ball preview — large with glow
    const ballY = H() * 0.24;
    ctx.fillStyle = `rgba(${charColors[charColorIdx] === '#000' ? '50,50,50' : '255,255,255'},0.08)`;
    ctx.beginPath();
    ctx.arc(W() / 2, ballY, 50, 0, Math.PI * 2);
    ctx.fill();
    drawBall(W() / 2, ballY, 28, charColors[charColorIdx]);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '15px -apple-system,sans-serif';
    ctx.fillText(player.name, W() / 2, ballY + 48);

    // Section: Ball Color
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '600 12px -apple-system,sans-serif';
    ctx.fillText('BALL COLOR', W() / 2, H() * 0.40);

    const swatchSize = 32, gap = 6;
    const totalW = charColors.length * (swatchSize + gap) - gap;
    const startX = (W() - totalW) / 2;
    const swatchY = H() * 0.43;

    for (let i = 0; i < charColors.length; i++) {
        const sx = startX + i * (swatchSize + gap);
        ctx.fillStyle = charColors[i];
        ctx.beginPath();
        ctx.arc(sx + swatchSize / 2, swatchY + swatchSize / 2, swatchSize / 2 - 1, 0, Math.PI * 2);
        ctx.fill();
        if (i === charColorIdx) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(sx + swatchSize / 2, swatchY + swatchSize / 2, swatchSize / 2 + 2, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Section: Name
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '600 12px -apple-system,sans-serif';
    ctx.fillText('NAME', W() / 2, H() * 0.57);

    const names = ['Golfer', 'Tiger', 'Ace', 'Birdie', 'Eagle', 'Chip', 'Putter', 'Pro'];
    const nameW = 82, nameH = 40, nameGap = 8;
    const namesPerRow = Math.floor((W() - 32) / (nameW + nameGap));
    const nameStartX = (W() - namesPerRow * (nameW + nameGap) + nameGap) / 2;
    const nameY = H() * 0.60;

    for (let i = 0; i < names.length; i++) {
        const row = Math.floor(i / namesPerRow);
        const col = i % namesPerRow;
        const nx = nameStartX + col * (nameW + nameGap);
        const ny = nameY + row * (nameH + nameGap);
        const selected = player.name === names[i];
        if (selected) {
            const sg = ctx.createLinearGradient(nx, ny, nx + nameW, ny);
            sg.addColorStop(0, '#2e7d32');
            sg.addColorStop(1, '#1b5e20');
            ctx.fillStyle = sg;
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
        }
        roundRect(nx, ny, nameW, nameH, nameH / 2);
        ctx.fill();
        if (selected) {
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        }
        ctx.lineWidth = 1;
        roundRect(nx, ny, nameW, nameH, nameH / 2);
        ctx.stroke();
        ctx.fillStyle = selected ? '#fff' : 'rgba(255,255,255,0.6)';
        ctx.font = (selected ? '600 ' : '') + '14px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(names[i], nx + nameW / 2, ny + nameH / 2 + 5);
    }

    // Save button — gradient
    const bw = Math.min(W() - 48, 280);
    const bx = (W() - bw) / 2;
    const saveY = H() * 0.84;
    const saveGrad = ctx.createLinearGradient(bx, saveY, bx + bw, saveY);
    saveGrad.addColorStop(0, '#2e7d32');
    saveGrad.addColorStop(1, '#1b5e20');
    ctx.fillStyle = saveGrad;
    roundRect(bx, saveY, bw, 50, 25);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    roundRect(bx, saveY, bw, 50, 25);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Save & Back', W() / 2, saveY + 31);
}

function charTouchStart(sx, sy) {
    // Color swatches
    const swatchSize = 36, gap = 8;
    const totalW = charColors.length * (swatchSize + gap) - gap;
    const startX = (W() - totalW) / 2;
    const swatchY = H() * 0.48;
    for (let i = 0; i < charColors.length; i++) {
        const cx = startX + i * (swatchSize + gap);
        if (hitBtn(sx, sy, cx, swatchY, swatchSize, swatchSize)) {
            charColorIdx = i;
            player.ballColor = charColors[i];
            return;
        }
    }

    // Name buttons
    const names = ['Golfer', 'Tiger', 'Ace', 'Birdie', 'Eagle', 'Chip', 'Putter', 'Pro'];
    const nameW = 80, nameH = 36, nameGap = 8;
    const namesPerRow = Math.floor((W() - 40) / (nameW + nameGap));
    const nameStartX = (W() - namesPerRow * (nameW + nameGap) + nameGap) / 2;
    const nameY = H() * 0.64;
    for (let i = 0; i < names.length; i++) {
        const row = Math.floor(i / namesPerRow);
        const col = i % namesPerRow;
        const nx = nameStartX + col * (nameW + nameGap);
        const ny = nameY + row * (nameH + nameGap);
        if (hitBtn(sx, sy, nx, ny, nameW, nameH)) { player.name = names[i]; return; }
    }

    // Save button
    const bw = Math.min(W() - 60, 280);
    const bx = (W() - bw) / 2;
    if (hitBtn(sx, sy, bx, H() * 0.84, bw, 48)) {
        saveData('player', player);
        notify('Saved!');
        setState('menu');
    }
}

// ---- Career Select (landscape: cards side-by-side) ----
function careerLayout() {
    const pad = 14;
    const topH = 84;
    const bottomH = 60;
    const cols = CAREER_COURSES.length;
    const totalGap = (cols - 1) * 12;
    const cardW = Math.min(280, (W() - pad * 2 - totalGap) / cols);
    const cardH = Math.min(H() - topH - bottomH - pad, 260);
    const rowW = cardW * cols + totalGap;
    const startX = (W() - rowW) / 2;
    const cy = topH + (H() - topH - bottomH - cardH) / 2;
    return { pad, topH, bottomH, cardW, cardH, startX, cy };
}

function drawCareer() {
    const bg = ctx.createLinearGradient(0, 0, 0, H());
    bg.addColorStop(0, '#0d2818');
    bg.addColorStop(1, '#1a472a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W(), H());

    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '600 24px -apple-system,sans-serif';
    ctx.fillText('Career Mode', W() / 2, 44);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '13px -apple-system,sans-serif';
    ctx.fillText('Choose a course', W() / 2, 66);

    const L = careerLayout();
    const cardW = L.cardW;
    const cardH = L.cardH;
    const cy = L.cy;

    for (let i = 0; i < CAREER_COURSES.length; i++) {
        const startX = L.startX + i * (cardW + 12);
        const course = CAREER_COURSES[i];
        const unlocked = player.unlocked.includes(i);

        // Card background — glass with colored top accent
        ctx.fillStyle = unlocked ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.2)';
        roundRect(startX, cy, cardW, cardH, 18);
        ctx.fill();
        ctx.strokeStyle = unlocked ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        roundRect(startX, cy, cardW, cardH, 18);
        ctx.stroke();

        // Top color accent bar (portrait card style)
        if (unlocked) {
            ctx.fillStyle = course.color;
            roundRect(startX, cy, cardW, 5, 3);
            ctx.fill();
        }

        const cardCx = startX + cardW / 2;

        // Large icon centered at top
        ctx.font = '56px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        if (unlocked) ctx.fillText(course.icon, cardCx, cy + 80);

        // Name
        ctx.fillStyle = unlocked ? '#fff' : 'rgba(255,255,255,0.25)';
        ctx.font = '600 20px -apple-system,sans-serif';
        ctx.fillText(course.name, cardCx, cy + 118);

        // Description
        ctx.fillStyle = unlocked ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.15)';
        ctx.font = '12px -apple-system,sans-serif';
        ctx.fillText(course.desc, cardCx, cy + 140);

        // Holes + par
        const totalPar = course.holes.reduce((s, h) => s + h.par, 0);
        ctx.fillStyle = unlocked ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
        ctx.font = '12px -apple-system,sans-serif';
        ctx.fillText(course.holes.length + ' holes  \u2022  Par ' + totalPar, cardCx, cy + cardH - 40);

        // Best score pill
        const best = loadData('best_' + i, null);
        if (best !== null && unlocked) {
            ctx.fillStyle = 'rgba(255,235,59,0.12)';
            roundRect(cardCx - 42, cy + cardH - 28, 84, 20, 10);
            ctx.fill();
            ctx.fillStyle = '#ffeb3b';
            ctx.font = 'bold 11px -apple-system,sans-serif';
            ctx.fillText('Best: ' + best, cardCx, cy + cardH - 14);
        }

        // Locked overlay
        if (!unlocked) {
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            roundRect(startX, cy, cardW, cardH, 18);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '36px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('\u{1F512}', cardCx, cy + cardH / 2 + 14);
        }
    }

    // Back button — ghost style at bottom
    const bw = Math.min(W() - 48, 280);
    const bx = (W() - bw) / 2;
    const by = H() - L.bottomH + 6;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(bx, by, bw, 44, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    roundRect(bx, by, bw, 44, 22);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '15px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Back', W() / 2, by + 28);
}

function careerTouchStart(sx, sy) {
    const L = careerLayout();
    for (let i = 0; i < CAREER_COURSES.length; i++) {
        const startX = L.startX + i * (L.cardW + 12);
        if (hitBtn(sx, sy, startX, L.cy, L.cardW, L.cardH) && player.unlocked.includes(i)) {
            currentCourse = CAREER_COURSES[i];
            currentHoleIdx = 0;
            holeStrokes = [];
            customCoursePlay = false;
            startHole(currentCourse.holes[0]);
            setState('playing');
            return;
        }
    }

    // Back
    const bw = Math.min(W() - 48, 280);
    const bx = (W() - bw) / 2;
    const by = H() - L.bottomH + 6;
    if (hitBtn(sx, sy, bx, by, bw, 44)) setState('menu');
}

// ---- Manage Resort Screen (Tycoon MVP) ----
// Landscape layout: left sidebar (money + stats + player card) + right content
// area (amenities + actions). Mirrors the reference tycoon UI.
function manageLayout() {
    const pad = 12;
    const topBarH = 40;

    const sidebarW = Math.min(240, Math.max(200, W() * 0.28));
    const sidebarX = pad;
    const sidebarY = topBarH + 8;
    const sidebarH = H() - sidebarY - pad;

    const contentX = sidebarX + sidebarW + pad;
    const contentY = sidebarY;
    const contentW = W() - contentX - pad;
    const contentH = sidebarH;

    // Sidebar stacked items
    const moneyY = sidebarY;
    const moneyH = 56;
    const statsY = moneyY + moneyH + 10;
    const statsH = 108;
    const playerY = statsY + statsH + 10;
    const playerH = 72;

    // Content area: amenity list + bottom actions row (3 buttons side-by-side)
    const amenityLabelY = contentY + 4;
    const amenityStartY = contentY + 28;
    const amenityH = 86;
    const amenityGap = 10;
    const actionsRowH = 52;
    const actionsY = contentY + contentH - actionsRowH;
    const actionBw = (contentW - 20) / 3;
    const resortX = contentX;
    const simX = contentX + (actionBw + 10);
    const playX = contentX + (actionBw + 10) * 2;

    // Close (X) button in top-right of content
    const closeSize = 36;
    const closeX = W() - pad - closeSize;
    const closeY = pad;

    return {
        pad, topBarH,
        sidebarX, sidebarY, sidebarW, sidebarH,
        contentX, contentY, contentW, contentH,
        moneyY, moneyH, statsY, statsH, playerY, playerH,
        amenityLabelY, amenityStartY, amenityH, amenityGap,
        actionsY, actionsRowH, actionBw, resortX, simX, playX,
        closeSize, closeX, closeY
    };
}

function drawManage() {
    // Warm resort-y gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H());
    bg.addColorStop(0, '#0b2a1c');
    bg.addColorStop(0.5, '#144f33');
    bg.addColorStop(1, '#08170f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W(), H());

    const L = manageLayout();

    // ---- Top bar (title left, close right) ----
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '800 20px -apple-system,sans-serif';
    ctx.fillText('Clubhouse', L.pad + 6, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px -apple-system,sans-serif';
    ctx.fillText('Run your resort \u2022 Grow your members', L.pad + 6 + 110, 28);

    // Close X
    ctx.fillStyle = 'rgba(255,70,70,0.85)';
    roundRect(L.closeX, L.closeY, L.closeSize, L.closeSize, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u2715', L.closeX + L.closeSize / 2, L.closeY + L.closeSize / 2 + 6);

    // ---- LEFT SIDEBAR ----
    // Money pill (big, like reference)
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(L.sidebarX, L.moneyY, L.sidebarW, L.moneyH, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    roundRect(L.sidebarX, L.moneyY, L.sidebarW, L.moneyH, 14);
    ctx.stroke();
    // Coin icon circle
    ctx.fillStyle = '#ffb300';
    ctx.beginPath();
    ctx.arc(L.sidebarX + 28, L.moneyY + L.moneyH / 2, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6d4c00';
    ctx.font = 'bold 16px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('$', L.sidebarX + 28, L.moneyY + L.moneyH / 2 + 6);
    // Balance text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(Math.floor(resort.coins).toLocaleString(), L.sidebarX + 56, L.moneyY + L.moneyH / 2 + 7);

    // Stats card — MEMBERS & COINS/SEC stacked
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(L.sidebarX, L.statsY, L.sidebarW, L.statsH, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    roundRect(L.sidebarX, L.statsY, L.sidebarW, L.statsH, 14);
    ctx.stroke();
    const halfH = L.statsH / 2;
    // Members row
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px -apple-system,sans-serif';
    ctx.fillText('MEMBERS', L.sidebarX + 14, L.statsY + 18);
    ctx.fillStyle = '#81d4fa';
    ctx.font = 'bold 22px -apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(resort.members), L.sidebarX + L.sidebarW - 14, L.statsY + 38);
    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(L.sidebarX + 14, L.statsY + halfH);
    ctx.lineTo(L.sidebarX + L.sidebarW - 14, L.statsY + halfH);
    ctx.stroke();
    // Coins/sec row
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px -apple-system,sans-serif';
    ctx.fillText('COINS / SEC', L.sidebarX + 14, L.statsY + halfH + 20);
    ctx.fillStyle = '#a5d6a7';
    ctx.font = 'bold 22px -apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText((resort.members * 0.2).toFixed(1), L.sidebarX + L.sidebarW - 14, L.statsY + halfH + 40);

    // Player card (Mayor-style)
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(L.sidebarX, L.playerY, L.sidebarW, L.playerH, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    roundRect(L.sidebarX, L.playerY, L.sidebarW, L.playerH, 14);
    ctx.stroke();
    // Ball avatar
    drawBall(L.sidebarX + 36, L.playerY + L.playerH / 2, 22, player.ballColor);
    // Player name + subtitle
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px -apple-system,sans-serif';
    ctx.fillText(player.name, L.sidebarX + 72, L.playerY + 32);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px -apple-system,sans-serif';
    ctx.fillText('Club Owner', L.sidebarX + 72, L.playerY + 52);

    // ---- RIGHT CONTENT ----
    // Section label
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 11px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('AMENITIES', L.contentX + 4, L.amenityLabelY + 14);

    // Amenity cards (full-width of content area, stacked)
    for (let i = 0; i < AMENITIES.length; i++) {
        const a = AMENITIES[i];
        const y = L.amenityStartY + (L.amenityH + L.amenityGap) * i;
        const owned = !!resort.amenities[a.id];
        const canAfford = resort.coins >= a.cost;

        ctx.fillStyle = owned ? 'rgba(46,125,50,0.22)' : 'rgba(255,255,255,0.06)';
        roundRect(L.contentX, y, L.contentW, L.amenityH, 14);
        ctx.fill();
        ctx.strokeStyle = owned ? 'rgba(129,199,132,0.35)' : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        roundRect(L.contentX, y, L.contentW, L.amenityH, 14);
        ctx.stroke();

        // Icon
        ctx.textAlign = 'center';
        ctx.font = '32px -apple-system,sans-serif';
        ctx.fillText(a.icon, L.contentX + 38, y + 50);

        // Name + desc + boost
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px -apple-system,sans-serif';
        ctx.fillText(a.name, L.contentX + 76, y + 26);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '11px -apple-system,sans-serif';
        ctx.fillText(a.desc, L.contentX + 76, y + 46);
        ctx.fillStyle = '#81d4fa';
        ctx.font = '11px -apple-system,sans-serif';
        ctx.fillText('+' + a.memberBoost + ' members', L.contentX + 76, y + 66);

        // Buy / Owned button on the right
        const btnW = 100, btnH = 36;
        const btnX = L.contentX + L.contentW - btnW - 12;
        const btnY = y + (L.amenityH - btnH) / 2;
        if (owned) {
            ctx.fillStyle = 'rgba(129,199,132,0.25)';
            roundRect(btnX, btnY, btnW, btnH, 18);
            ctx.fill();
            ctx.fillStyle = '#a5d6a7';
            ctx.font = 'bold 13px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('OWNED', btnX + btnW / 2, btnY + 23);
        } else {
            const g = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
            if (canAfford) { g.addColorStop(0, '#ffb300'); g.addColorStop(1, '#ff8f00'); }
            else { g.addColorStop(0, '#555'); g.addColorStop(1, '#333'); }
            ctx.fillStyle = g;
            roundRect(btnX, btnY, btnW, btnH, 18);
            ctx.fill();
            ctx.fillStyle = canAfford ? '#fff' : 'rgba(255,255,255,0.5)';
            ctx.font = 'bold 14px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('$ ' + a.cost, btnX + btnW / 2, btnY + 23);
        }
    }

    // Actions row — Enter Resort / Simulate / Play
    // Primary: Enter Your Resort (blue → flies you into the 3D overworld)
    const resortGrad = ctx.createLinearGradient(L.resortX, L.actionsY, L.resortX + L.actionBw, L.actionsY);
    resortGrad.addColorStop(0, '#1565c0');
    resortGrad.addColorStop(1, '#0d47a1');
    ctx.fillStyle = resortGrad;
    roundRect(L.resortX, L.actionsY, L.actionBw, L.actionsRowH, L.actionsRowH / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F3D6}\uFE0F  Enter Resort', L.resortX + L.actionBw / 2, L.actionsY + L.actionsRowH / 2 + 6);

    const simGrad = ctx.createLinearGradient(L.simX, L.actionsY, L.simX + L.actionBw, L.actionsY);
    simGrad.addColorStop(0, '#ff6d00');
    simGrad.addColorStop(1, '#ff3d00');
    ctx.fillStyle = simGrad;
    roundRect(L.simX, L.actionsY, L.actionBw, L.actionsRowH, L.actionsRowH / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('\u25B6  Simulate', L.simX + L.actionBw / 2, L.actionsY + L.actionsRowH / 2 + 6);

    const playGrad = ctx.createLinearGradient(L.playX, L.actionsY, L.playX + L.actionBw, L.actionsY);
    playGrad.addColorStop(0, '#2e7d32');
    playGrad.addColorStop(1, '#1b5e20');
    ctx.fillStyle = playGrad;
    roundRect(L.playX, L.actionsY, L.actionBw, L.actionsRowH, L.actionsRowH / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('\u26F3  Play', L.playX + L.actionBw / 2, L.actionsY + L.actionsRowH / 2 + 6);
}

function manageTouchStart(sx, sy) {
    const L = manageLayout();

    // Close X → back to menu
    if (hitBtn(sx, sy, L.closeX, L.closeY, L.closeSize, L.closeSize)) {
        resort.lastTickMs = Date.now();
        saveResort();
        setState('menu');
        return;
    }

    // Amenity buy buttons
    for (let i = 0; i < AMENITIES.length; i++) {
        const a = AMENITIES[i];
        const y = L.amenityStartY + (L.amenityH + L.amenityGap) * i;
        const btnW = 100, btnH = 36;
        const btnX = L.contentX + L.contentW - btnW - 12;
        const btnY = y + (L.amenityH - btnH) / 2;
        if (!resort.amenities[a.id] && hitBtn(sx, sy, btnX, btnY, btnW, btnH)) {
            buyAmenity(a.id);
            return;
        }
    }

    // Enter Your Resort — flies into the 3D overworld
    if (hitBtn(sx, sy, L.resortX, L.actionsY, L.actionBw, L.actionsRowH)) {
        resort.lastTickMs = Date.now();
        saveResort();
        enterOverworld();
        return;
    }

    // Simulate Round — runs over the player's own resort holes
    if (hitBtn(sx, sy, L.simX, L.actionsY, L.actionBw, L.actionsRowH)) {
        if (!worldCourse.holes.length) {
            notify('Design some holes in your resort first!');
            return;
        }
        const res = simulateRound(worldCourse);
        awardCoins(res.coins);
        const diff = res.totalStrokes - res.totalPar;
        const label = (diff === 0 ? 'E' : (diff > 0 ? '+' + diff : String(diff)));
        notify(worldCourse.name + ' simulated: ' + res.totalStrokes + ' (' + label + ') \u2022 +' + res.coins + ' coins');
        return;
    }

    // Play a Round
    if (hitBtn(sx, sy, L.playX, L.actionsY, L.actionBw, L.actionsRowH)) {
        resort.lastTickMs = Date.now();
        saveResort();
        setState('career');
        return;
    }
}

// ---- Overworld Screen (Phase 3 — builder with brush tools + hole wizard) ----
function overworldLayout() {
    const pad = 10;
    const topBarH = 44;
    const closeSize = 36;
    const closeX = W() - pad - closeSize;
    const closeY = pad;
    const undoSize = 36;
    const undoX = closeX - 10 - undoSize;
    const undoY = pad;
    // Collapsible left build rail: toggle at top, parent buttons below,
    // flyout column of sub-options to the right of an open parent.
    const railX = 10;
    const railY = topBarH + 10;
    const railCount = OW_RAIL.length + 1; // + the toggle slot
    const railAvail = H() - railY - 10;
    const railBtn = Math.max(34, Math.min(50, Math.floor(railAvail / railCount) - 6));
    const railGap = 6;
    const railLabels = railBtn >= 42;
    const flyX = railX + railBtn + 10;
    const flyW = 122, flyH = 40, flyGap = 5;
    // Camera controls — right-edge vertical strip (pitch up / down / rotate L / R / reset)
    const camBtnSize = 36;
    const camBtnGap = 4;
    const camBtns = ['tiltUp', 'tiltDown', 'rotL', 'rotR', 'reset'];
    const camTotalH = camBtns.length * camBtnSize + (camBtns.length - 1) * camBtnGap;
    const camX = W() - pad - camBtnSize;
    const camY0 = (H() - camTotalH) / 2;
    return { pad, topBarH, closeSize, closeX, closeY, undoX, undoY, undoSize,
             railX, railY, railBtn, railGap, railLabels, flyX, flyW, flyH, flyGap,
             camX, camY0, camBtnSize, camBtnGap, camBtns };
}

function drawOverworld() {
    // 3D terrain fills the screen behind this HUD overlay.
    // Reset transform + clear the 2D canvas so only the HUD shows here.
    const d = window.devicePixelRatio || 1;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, W(), H());

    const L = overworldLayout();

    // ---- Placed holes: dotted polyline + tee/pin markers on the 3D scene ----
    for (const hole of worldCourse.holes) drawPlacedHole(hole, hole.id === owSelectedHole);

    // ---- Active hole wizard overlay (if any) ----
    if (holeWizard) drawHoleWizardOverlay();

    // ---- Brush ghost at current finger position (if we are painting) ----
    if (!holeWizard && owDragLastCell && (owDragPainting || owLastGhostCell)) {
        drawBrushGhost(owDragLastCell.c, owDragLastCell.r, owBrushSize, currentTool());
    }

    // ---- Top bar ----
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W(), L.topBarH);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, L.topBarH); ctx.lineTo(W(), L.topBarH); ctx.stroke();

    // Course name (left) + subtitle directly to its right — measured so they
    // never overlap
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(worldCourse.name, L.pad + 6, 28);
    const nameW = ctx.measureText(worldCourse.name).width;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px -apple-system,sans-serif';
    const subtitle = worldCourse.holes.length + ' holes \u2022 '
        + worldCourse.facilities.length + ' facilities \u2022 build ' + BUILD_TAG;
    ctx.fillText(subtitle, L.pad + 6 + nameW + 12, 28);

    // Balance chip (top center) — gold glossy
    const bpW = 124, bpH = 30;
    const bpX = (W() - bpW) / 2, bpY = (L.topBarH - bpH) / 2;
    glossyRect(bpX, bpY, bpW, bpH, bpH / 2, '#d9a02a');
    ctx.fillStyle = '#231a05';
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('$ ' + Math.floor(resort.coins).toLocaleString(), W() / 2, bpY + bpH / 2 + 5);

    // Game clock chip — Day N + time, driven by the persistent world clock
    {
        const mins = Math.floor((resort.worldClock || 0) / 1);
        const day = Math.floor(mins / 1440) + 1;
        const hh24 = Math.floor((mins % 1440) / 60);
        const mm = mins % 60;
        const ap = hh24 >= 12 ? 'PM' : 'AM';
        const hh = ((hh24 + 11) % 12) + 1;
        const label = 'Day ' + day + '  ' + hh + ':' + String(mm).padStart(2, '0') + ' ' + ap;
        ctx.font = 'bold 12px -apple-system,sans-serif';
        const cw = ctx.measureText(label).width + 26;
        const cx0 = L.undoX - 10 - cw;
        glossyRect(cx0, L.undoY + 3, cw, 30, 15, '#2c3a42');
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(label, cx0 + cw / 2, L.undoY + 23);
    }

    // Close X — glossy red
    glossyRect(L.closeX, L.closeY, L.closeSize, L.closeSize, 10, '#c0392b');
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u2715', L.closeX + L.closeSize / 2, L.closeY + L.closeSize / 2 + 6);

    // Undo — glossy slate, dimmed when there is nothing to undo
    glossyRect(L.undoX, L.undoY, L.undoSize, L.undoSize, 10,
               owUndoStack.length ? '#3d4f5c' : '#252d33');
    ctx.fillStyle = owUndoStack.length ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
    ctx.font = 'bold 16px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u21A9', L.undoX + L.undoSize / 2, L.undoY + L.undoSize / 2 + 6);

    // ---- Entrance marker — anchors the resort's front door ----
    {
        const eCol = Math.floor(worldCourse.cols / 2);
        const eRow = worldCourse.rows - (worldCourse.border || 4);
        const es = cellCenterScreen(eCol, eRow);
        const entranceBottom = H() - 20;
        if (es && !es.behind && es.y > L.topBarH + 20 && es.y < entranceBottom) {
            ctx.font = 'bold 10px -apple-system,sans-serif';
            const eW = ctx.measureText('ENTRANCE').width + 18;
            ctx.fillStyle = 'rgba(255,255,255,0.92)';
            roundRect(es.x - eW / 2, es.y - 11, eW, 22, 11);
            ctx.fill();
            ctx.fillStyle = '#1a3d1a';
            ctx.textAlign = 'center';
            ctx.fillText('ENTRANCE', es.x, es.y + 4);
        }
    }

    // ---- Camera control rail (right edge) ----
    const camIconLabels = { tiltUp: '\u25B2', tiltDown: '\u25BC', rotL: '\u21BA', rotR: '\u21BB', reset: '\u25CE' };
    for (let i = 0; i < L.camBtns.length; i++) {
        const id = L.camBtns[i];
        const by = L.camY0 + i * (L.camBtnSize + L.camBtnGap);
        glossyRect(L.camX, by, L.camBtnSize, L.camBtnSize, 10, '#2c3a42');
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '16px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(camIconLabels[id], L.camX + L.camBtnSize / 2, by + L.camBtnSize / 2 + 6);
    }

    // ---- Collapsible build rail (hidden during the hole wizard) ----
    if (!holeWizard) {
        const armedTool = OW_TOOLS.find(t => t.id === owTool);
        // Toggle button: hammer to open, ✕ to collapse
        glossyRect(L.railX, L.railY, L.railBtn, L.railBtn, 12,
                   owRailOpen ? '#41535e' : '#2e7d32');
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = Math.round(L.railBtn * 0.42) + 'px -apple-system,sans-serif';
        ctx.fillText(owRailOpen ? '\u2715' : '\u{1F528}',
                     L.railX + L.railBtn / 2, L.railY + L.railBtn * 0.64);

        if (owRailOpen) {
            for (let i = 0; i < OW_RAIL.length; i++) {
                const item = OW_RAIL[i];
                const iy = L.railY + (i + 1) * (L.railBtn + L.railGap);
                const armedHere = OW_TOOL_PARENT[owTool] === item.id;
                const open = owFlyout === item.id;
                const base = armedHere ? (armedTool && armedTool.color) || '#455a64'
                           : open ? '#546e7a' : '#2c3a42';
                glossyRect(L.railX, iy, L.railBtn, L.railBtn, 12, base,
                           armedHere ? { stroke: 'rgba(255,255,255,0.75)' } : undefined);
                ctx.textAlign = 'center';
                ctx.fillStyle = '#fff';
                if (item.id === 'size') {
                    ctx.font = 'bold ' + Math.round(L.railBtn * 0.3) + 'px -apple-system,sans-serif';
                    ctx.fillText(owBrushSize + '\u00D7' + owBrushSize,
                                 L.railX + L.railBtn / 2, iy + L.railBtn * (L.railLabels ? 0.5 : 0.62));
                } else {
                    ctx.font = Math.round(L.railBtn * 0.4) + 'px -apple-system,sans-serif';
                    ctx.fillText(item.icon, L.railX + L.railBtn / 2, iy + L.railBtn * (L.railLabels ? 0.52 : 0.64));
                }
                if (L.railLabels) {
                    ctx.font = (armedHere ? 'bold ' : '') + '7px -apple-system,sans-serif';
                    ctx.fillStyle = armedHere ? '#fff' : 'rgba(255,255,255,0.65)';
                    ctx.fillText(item.label, L.railX + L.railBtn / 2, iy + L.railBtn - 5);
                }
            }

            // Flyout: sub-options of the open parent
            if (owFlyout) {
                const pi = OW_RAIL.findIndex(it => it.id === owFlyout);
                const parent = pi >= 0 ? OW_RAIL[pi] : null;
                if (parent && parent.flyout) {
                    const list = parent.flyout === 'sizes' ? OW_BRUSH_SIZES : parent.flyout;
                    const totalH = list.length * (L.flyH + L.flyGap);
                    let fy = Math.min(L.railY + (pi + 1) * (L.railBtn + L.railGap),
                                      H() - 10 - totalH);
                    for (const entry of list) {
                        if (parent.flyout === 'sizes') {
                            const active = entry === owBrushSize;
                            glossyRect(L.flyX, fy, L.flyW, L.flyH, 10,
                                       active ? '#1976d2' : '#2c3a42',
                                       active ? { stroke: 'rgba(255,255,255,0.75)' } : undefined);
                            ctx.textAlign = 'center';
                            ctx.fillStyle = '#fff';
                            ctx.font = (active ? 'bold ' : '') + '14px -apple-system,sans-serif';
                            ctx.fillText(entry + ' \u00D7 ' + entry, L.flyX + L.flyW / 2, fy + L.flyH / 2 + 5);
                        } else {
                            const tool = OW_TOOLS.find(t => t.id === entry);
                            const active = owTool === entry;
                            glossyRect(L.flyX, fy, L.flyW, L.flyH, 10,
                                       active ? tool.color : '#2c3a42',
                                       active ? { stroke: 'rgba(255,255,255,0.75)' } : undefined);
                            ctx.textAlign = 'left';
                            ctx.fillStyle = '#fff';
                            ctx.font = '15px -apple-system,sans-serif';
                            ctx.fillText(tool.icon, L.flyX + 10, fy + L.flyH / 2 + 6);
                            ctx.font = (active ? 'bold ' : '') + '12px -apple-system,sans-serif';
                            ctx.fillText(tool.label, L.flyX + 36, fy + L.flyH / 2 + 4);
                        }
                        fy += L.flyH + L.flyGap;
                    }
                }
            }
        }
    }

    // ---- Hole inspector card (top right, GolfTopia-style) ----
    if (owSelectedHole != null && !holeWizard) {
        const selHole = worldCourse.holes.find(h => h.id === owSelectedHole);
        if (!selHole) {
            owSelectedHole = null;
        } else {
            const hc = holeCardLayout();
            ctx.fillStyle = 'rgba(16,28,40,0.95)';
            roundRect(hc.x, hc.y, hc.w, hc.h, 14);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.lineWidth = 1.5;
            roundRect(hc.x, hc.y, hc.w, hc.h, 14);
            ctx.stroke();
            // Colored glossy header strip (reference-style panel)
            glossyRect(hc.x + 3, hc.y + 3, hc.w - 6, 26, 11, '#2e7d32');
            ctx.textAlign = 'left';
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px -apple-system,sans-serif';
            ctx.fillText('Hole ' + selHole.id, hc.x + 14, hc.y + 21);
            // Reference-style stat rows: label left, value right, bar fill
            const yds = Math.round(polylineLengthYards(selHole));
            const rows = [
                ['Par', String(selHole.par), Math.min(1, selHole.par / 5), '#66bb6a'],
                ['Length', yds + ' yds', Math.min(1, yds / 550), '#42a5f5'],
                ['Bends', String(selHole.waypoints.length), Math.min(1, selHole.waypoints.length / 4), '#ffca28']
            ];
            let ry = hc.y + 44;
            for (const [label, val, frac, col] of rows) {
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.font = '11px -apple-system,sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(label, hc.x + 14, ry);
                ctx.textAlign = 'right';
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 11px -apple-system,sans-serif';
                ctx.fillText(val, hc.x + hc.w - 14, ry);
                ctx.fillStyle = 'rgba(255,255,255,0.12)';
                roundRect(hc.x + 14, ry + 5, hc.w - 28, 5, 2.5);
                ctx.fill();
                ctx.fillStyle = col;
                roundRect(hc.x + 14, ry + 5, (hc.w - 28) * frac, 5, 2.5);
                ctx.fill();
                ry += 26;
            }
            // Test Play button
            const playGrad = ctx.createLinearGradient(hc.playX, hc.playY, hc.playX + hc.playW, hc.playY);
            playGrad.addColorStop(0, '#2e7d32');
            playGrad.addColorStop(1, '#1b5e20');
            ctx.fillStyle = playGrad;
            roundRect(hc.playX, hc.playY, hc.playW, hc.playH, hc.playH / 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 13px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('\u25B6 Test Play', hc.playX + hc.playW / 2, hc.playY + hc.playH / 2 + 5);
            // Delete button
            const delGrad = ctx.createLinearGradient(hc.delX, hc.delY, hc.delX + hc.delW, hc.delY);
            delGrad.addColorStop(0, '#c62828');
            delGrad.addColorStop(1, '#8e0000');
            ctx.fillStyle = delGrad;
            roundRect(hc.delX, hc.delY, hc.delW, hc.delH, hc.delH / 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 13px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('\u{1F5D1} Delete Hole', hc.delX + hc.delW / 2, hc.delY + hc.delH / 2 + 5);
        }
    }

    // ---- First-run coach overlay — one screen, three lines, one tap ----
    if (owCoachVisible) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(0, 0, W(), H());
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = '800 24px -apple-system,sans-serif';
        ctx.fillText('Welcome to your resort!', W() / 2, H() * 0.26);
        ctx.font = '15px -apple-system,sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        const lines = [
            '\u270B  Drag to move \u2022 pinch to zoom \u2022 twist to rotate',
            '\u{1F528}  Tap the hammer to open build tools and paint terrain',
            '\u26F3  HOLES designs new holes \u2022 tap a marker to inspect or play'
        ];
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], W() / 2, H() * 0.4 + i * 30);
        }
        const gotW = 140, gotH = 44;
        const gotX = (W() - gotW) / 2, gotY = H() * 0.66;
        const g = ctx.createLinearGradient(gotX, gotY, gotX + gotW, gotY);
        g.addColorStop(0, '#2e7d32');
        g.addColorStop(1, '#1b5e20');
        ctx.fillStyle = g;
        roundRect(gotX, gotY, gotW, gotH, gotH / 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px -apple-system,sans-serif';
        ctx.fillText('Got it!', W() / 2, gotY + gotH / 2 + 5);
    }
}

// ---- Brush ghost in screen space ----
function drawBrushGhost(cc, cr, size, tool) {
    if (!tool) return;
    const half = Math.floor(size / 2);
    // Four corners of the NxN square in world, project to screen
    const corners = [
        cellCenterScreen(cc - half - 0.5, cr - half - 0.5),
        cellCenterScreen(cc + half + 0.5, cr - half - 0.5),
        cellCenterScreen(cc + half + 0.5, cr + half + 0.5),
        cellCenterScreen(cc - half - 0.5, cr + half + 0.5)
    ];
    if (corners.some(c => c.behind)) return;
    ctx.fillStyle = tool.color + '66';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

// Finger hover during idle — we remember the last tap cell for ghost
let owLastGhostCell = null;

// ---- Builder QOL state ----
let owUndoStack = [];      // per-stroke cell diffs, most recent last (cap 20)
let owStrokeDiff = null;   // Map cellKey -> {c,r,prev} while a stroke is active
let owSelectedHole = null; // hole id whose inspector card is open
let owCoachVisible = false;// first-run help overlay
let owLongPress = null;    // pending eyedropper {sx, sy, timer}

function cancelOwLongPress() {
    if (owLongPress) { clearTimeout(owLongPress.timer); owLongPress = null; }
}

// Long-press on terrain in navigation mode arms that terrain's brush
function eyedropAt(cell) {
    owLongPress = null;
    const t = worldCourse.grid[cell.r] && worldCourse.grid[cell.r][cell.c];
    const tool = OW_TOOLS.find(x => x.terrain === t && x.id !== 'erase' && !x.wizard && !x.hand);
    if (!tool) return;
    owTool = tool.id;
    owRailOpen = true; // show the rail so the armed tool is visible
    scouting = false; // stop the pan — arming a brush is deliberate
    notify(tool.label + ' brush armed');
}

function undoLastStroke() {
    const stroke = owUndoStack.pop();
    if (!stroke) return;
    for (const cell of stroke.cells) worldCourse.grid[cell.r][cell.c] = cell.prev;
    refreshWorldHeights();
    if (scene3dReady) buildTerrain3D(worldCourse, { distantScenery: false });
    saveWorldCourse();
    notify('Undone');
}

// Hole inspector card geometry (shared by draw + hit-test)
function holeCardLayout() {
    const w = 216, h = 210;
    const x = W() - w - 10, y = 58;
    return { x, y, w, h,
             playX: x + 12, playY: y + h - 88, playW: w - 24, playH: 34,
             delX: x + 12, delY: y + h - 44, delW: w - 24, delH: 34 };
}

// Which camera control button is currently being held down (null when none).
// While set, the game loop applies a continuous rotate/tilt every frame so
// the player can spin through any angle instead of tapping 15° at a time.
let owHeldCamBtn = null;
const OW_ROT_SPEED = Math.PI * 1.1;    // rad/sec — full spin in ~1.8s
const OW_TILT_SPEED = Math.PI * 0.55;  // rad/sec — horizon-to-top in ~2.8s

function tickOverworldCamera(dt) {
    if (!owHeldCamBtn) return;
    if (owHeldCamBtn === 'rotL')     rotateCameraOrbit(-OW_ROT_SPEED * dt);
    else if (owHeldCamBtn === 'rotR') rotateCameraOrbit(OW_ROT_SPEED * dt);
    else if (owHeldCamBtn === 'tiltUp')   tiltCameraOrbit(-OW_TILT_SPEED * dt);
    else if (owHeldCamBtn === 'tiltDown') tiltCameraOrbit(OW_TILT_SPEED * dt);
}

// ---- Placed hole visualization ----
function drawPlacedHole(hole, selected) {
    const pts = [hole.tee, ...hole.waypoints, hole.pin];
    const screens = pts.map(p => cellCenterScreen(p.x, p.y));
    if (screens.some(s => s.behind)) return;

    // Dotted polyline (white, drop-shadowed; amber + thicker when selected)
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = selected ? 'rgba(255,190,60,0.95)' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = selected ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(screens[0].x, screens[0].y);
    for (let i = 1; i < screens.length; i++) ctx.lineTo(screens[i].x, screens[i].y);
    ctx.stroke();
    ctx.restore();

    // Per-hole accent color (rotates through a fixed palette)
    const HOLE_COLORS = ['#42a5f5', '#ec407a', '#ffca28', '#66bb6a', '#ab47bc',
                         '#26c6da', '#ff7043', '#9ccc65', '#5c6bc0'];
    const accent = HOLE_COLORS[(hole.id - 1) % HOLE_COLORS.length];

    // Tee: soft pulsing pad ring + floating numbered badge (subtle glow)
    const t = screens[0];
    const pulse = 0.75 + Math.sin(Date.now() / 480 + hole.id) * 0.25;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.35 * pulse;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(t.x, t.y, 13 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // (Number badge moved into the 3D scene as a floating sprite; the 2D
    // layer keeps the pulsing pad ring + selection highlight only)
    if (selected) {
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(t.x, t.y, 18, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }

    // Pin marker (red flag on a pole, small glow at the cup)
    const p = screens[screens.length - 1];
    ctx.save();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 20);
    ctx.stroke();
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 20);
    ctx.lineTo(p.x + 11, p.y - 15.5);
    ctx.lineTo(p.x, p.y - 11);
    ctx.closePath();
    ctx.fill();

    // Waypoint dots — small, tinted to the hole accent
    for (let i = 1; i < screens.length - 1; i++) {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(screens[i].x, screens[i].y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }
}

// ---- Hole wizard overlay ----
function drawHoleWizardOverlay() {
    const w = holeWizard;
    // Step banner (top center, below the top bar)
    const msg = w.step === 'tee' ? 'Tap to place the Tee'
              : w.step === 'pin' ? 'Tap to place the Pin'
              : 'Shape the hole: drag waypoints, tap + to add, \u2714 to confirm';
    const bannerW = Math.min(W() - 20, 420);
    const bannerH = 32;
    const bannerX = (W() - bannerW) / 2;
    const bannerY = 52;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    roundRect(bannerX, bannerY, bannerW, bannerH, bannerH / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,109,0,0.6)';
    ctx.lineWidth = 1.5;
    roundRect(bannerX, bannerY, bannerW, bannerH, bannerH / 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg, W() / 2, bannerY + bannerH / 2 + 5);

    // Tee ghost (step 1) — follows finger last position
    if (w.step === 'tee' && owLastGhostCell) {
        drawBrushGhost(owLastGhostCell.c, owLastGhostCell.r, 1, { color: '#1b5e20' });
    }

    // Placed tee marker
    if (w.tee) {
        const s = cellCenterScreen(w.tee.x, w.tee.y);
        if (!s.behind) {
            ctx.fillStyle = '#1b5e20';
            ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('TEE', s.x, s.y + 4);
        }
    }

    // Pin ghost (step 2)
    if (w.step === 'pin' && owLastGhostCell) {
        drawBrushGhost(owLastGhostCell.c, owLastGhostCell.r, 1, { color: '#e53935' });
    }

    // Placed pin
    if (w.pin) {
        const s = cellCenterScreen(w.pin.x, w.pin.y);
        if (!s.behind) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - 22);
            ctx.stroke();
            ctx.fillStyle = '#e53935';
            ctx.beginPath();
            ctx.moveTo(s.x, s.y - 22);
            ctx.lineTo(s.x + 12, s.y - 18);
            ctx.lineTo(s.x, s.y - 14);
            ctx.closePath();
            ctx.fill();
        }
    }

    // Shape step — draw polyline + waypoint handles + "+" midpoints
    if (w.step === 'shape' && w.tee && w.pin) {
        const pts = [w.tee, ...w.waypoints, w.pin];
        const screens = pts.map(p => cellCenterScreen(p.x, p.y));

        // Polyline
        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = 'rgba(255,109,0,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(screens[0].x, screens[0].y);
        for (let i = 1; i < screens.length; i++) ctx.lineTo(screens[i].x, screens[i].y);
        ctx.stroke();
        ctx.restore();

        // Waypoint handles (draggable circles) + a "-" badge above each
        for (let i = 1; i < screens.length - 1; i++) {
            const s = screens[i];
            ctx.fillStyle = 'rgba(255,109,0,0.9)';
            ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            // minus badge
            const mx = s.x + 14, my = s.y - 14;
            ctx.fillStyle = '#e53935';
            ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('\u2212', mx, my + 5);
        }

        // "+" midpoint buttons on each segment
        for (let i = 0; i < screens.length - 1; i++) {
            const a = screens[i], b = screens[i + 1];
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            ctx.fillStyle = '#1565c0';
            ctx.beginPath(); ctx.arc(mx, my, 12, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 16px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('+', mx, my + 6);
        }

        // Confirm + Cancel pills at bottom
        const btnW = 120, btnH = 42, bY = H() - btnH - 12;
        // Cancel (left)
        ctx.fillStyle = 'rgba(40,40,40,0.85)';
        roundRect(W() / 2 - btnW - 10, bY, btnW, btnH, btnH / 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('\u2715 Cancel', W() / 2 - btnW / 2 - 10, bY + btnH / 2 + 5);
        // Confirm (right)
        const g = ctx.createLinearGradient(W() / 2 + 10, bY, W() / 2 + 10 + btnW, bY);
        g.addColorStop(0, '#2e7d32'); g.addColorStop(1, '#1b5e20');
        ctx.fillStyle = g;
        roundRect(W() / 2 + 10, bY, btnW, btnH, btnH / 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        const yds = Math.round(polylineLengthYards(w));
        const par = parFromYards(yds);
        ctx.fillText('\u2714 Par ' + par + ' \u2022 ' + yds + 'y', W() / 2 + 10 + btnW / 2, bY + btnH / 2 + 5);
    } else {
        // For tee / pin steps — show a Cancel pill only
        const btnW = 120, btnH = 38, bY = H() - btnH - 12;
        ctx.fillStyle = 'rgba(40,40,40,0.85)';
        roundRect((W() - btnW) / 2, bY, btnW, btnH, btnH / 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('\u2715 Cancel', W() / 2, bY + btnH / 2 + 5);
    }
}

// Pick the button under (sx, sy) if any overworld HUD button is hit. Returns
// null if the tap should fall through to the 3D world (pan / paint / wizard).
function overworldHUDHit(sx, sy) {
    const L = overworldLayout();
    if (hitBtn(sx, sy, L.closeX, L.closeY, L.closeSize, L.closeSize)) return 'close';
    if (hitBtn(sx, sy, L.undoX, L.undoY, L.undoSize, L.undoSize)) return 'undo';
    // Camera control rail
    for (let i = 0; i < L.camBtns.length; i++) {
        const by = L.camY0 + i * (L.camBtnSize + L.camBtnGap);
        if (hitBtn(sx, sy, L.camX, by, L.camBtnSize, L.camBtnSize)) return 'cam:' + L.camBtns[i];
    }
    // Build rail (hidden during wizard)
    if (!holeWizard) {
        if (hitBtn(sx, sy, L.railX, L.railY, L.railBtn, L.railBtn)) return 'rail:toggle';
        if (owRailOpen) {
            for (let i = 0; i < OW_RAIL.length; i++) {
                const iy = L.railY + (i + 1) * (L.railBtn + L.railGap);
                if (hitBtn(sx, sy, L.railX, iy, L.railBtn, L.railBtn)) return 'rail:' + OW_RAIL[i].id;
            }
            if (owFlyout) {
                const pi = OW_RAIL.findIndex(it => it.id === owFlyout);
                const parent = pi >= 0 ? OW_RAIL[pi] : null;
                if (parent && parent.flyout) {
                    const list = parent.flyout === 'sizes' ? OW_BRUSH_SIZES : parent.flyout;
                    const totalH = list.length * (L.flyH + L.flyGap);
                    let fy = Math.min(L.railY + (pi + 1) * (L.railBtn + L.railGap),
                                      H() - 10 - totalH);
                    for (const entry of list) {
                        if (hitBtn(sx, sy, L.flyX, fy, L.flyW, L.flyH)) {
                            return parent.flyout === 'sizes' ? 'size:' + entry : 'tool:' + entry;
                        }
                        fy += L.flyH + L.flyGap;
                    }
                }
            }
        }
    }
    // Hole wizard buttons
    if (holeWizard) {
        const w = holeWizard;
        if (w.step === 'shape' && w.tee && w.pin) {
            const btnW = 120, btnH = 42, bY = H() - btnH - 12;
            if (hitBtn(sx, sy, W() / 2 - btnW - 10, bY, btnW, btnH)) return 'wiz:cancel';
            if (hitBtn(sx, sy, W() / 2 + 10, bY, btnW, btnH)) return 'wiz:confirm';
            // - badges near each waypoint (remove)
            const pts = [w.tee, ...w.waypoints, w.pin];
            const screens = pts.map(p => cellCenterScreen(p.x, p.y));
            for (let i = 1; i < screens.length - 1; i++) {
                const s = screens[i];
                const mx = s.x + 14, my = s.y - 14;
                const dx = sx - mx, dy = sy - my;
                if (dx * dx + dy * dy < 14 * 14) return 'wiz:remove:' + (i - 1);
            }
            // + midpoint buttons
            for (let i = 0; i < screens.length - 1; i++) {
                const a = screens[i], b = screens[i + 1];
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                const dx = sx - mx, dy = sy - my;
                if (dx * dx + dy * dy < 14 * 14) return 'wiz:add:' + i;
            }
            // Waypoint drag handles
            for (let i = 1; i < screens.length - 1; i++) {
                const s = screens[i];
                const dx = sx - s.x, dy = sy - s.y;
                if (dx * dx + dy * dy < 14 * 14) return 'wiz:drag:' + (i - 1);
            }
        } else {
            const btnW = 120, btnH = 38, bY = H() - btnH - 12;
            if (hitBtn(sx, sy, (W() - btnW) / 2, bY, btnW, btnH)) return 'wiz:cancel';
        }
    }
    return null;
}

function overworldTouchStart(sx, sy) {
    // First-run coach overlay swallows its dismissing tap
    if (owCoachVisible) {
        owCoachVisible = false;
        saveData('coachSeen', true);
        return;
    }
    const hit = overworldHUDHit(sx, sy);
    if (hit === 'close') { exitOverworld(); return; }
    if (hit === 'undo') { undoLastStroke(); return; }
    if (hit && hit.startsWith('cam:')) {
        const op = hit.slice(4);
        if (op === 'reset') {
            const cx = worldCourse.cols * CELL / 2;
            const cz = worldCourse.rows * CELL / 2;
            setCameraOrbit(cx, cz, 2600, Math.PI / 180 * 50, 0);
            if (typeof resetCameraFov === 'function') resetCameraFov();
        } else {
            // Start holding — game loop will rotate/tilt continuously until
            // touchend. This replaces the old 15° step so players can spin
            // through any 360° freely by holding the button.
            owHeldCamBtn = op;
        }
        return;
    }
    if (hit && hit.startsWith('rail:')) {
        const id = hit.slice(5);
        if (id === 'toggle') {
            owRailOpen = !owRailOpen;
            owFlyout = null;
        } else if (id === 'hand') {
            owTool = 'hand';
            owFlyout = null;
        } else if (id === 'surface' || id === 'nature' || id === 'size') {
            owFlyout = (owFlyout === id) ? null : id;
        } else if (id === 'path') {
            owTool = (owTool === 'path') ? 'hand' : 'path';
            owFlyout = null;
        } else if (id === 'hole') {
            owFlyout = null;
            startHoleWizard();
        } else if (id === 'erase') {
            owTool = (owTool === 'erase') ? 'hand' : 'erase';
            owFlyout = null;
        }
        return;
    }
    if (hit && hit.startsWith('tool:')) {
        const id = hit.slice(5);
        owFlyout = null;
        // Tapping the already-active tool disarms back to navigation
        owTool = (owTool === id) ? 'hand' : id;
        return;
    }
    if (hit && hit.startsWith('size:')) {
        owBrushSize = parseInt(hit.slice(5), 10);
        owFlyout = null;
        return;
    }
    if (hit === 'wiz:cancel') { cancelHoleWizard(); return; }
    if (hit === 'wiz:confirm') { finalizeHole(); return; }
    if (hit && hit.startsWith('wiz:add:')) {
        const i = parseInt(hit.slice(8), 10);
        const w = holeWizard;
        const pts = [w.tee, ...w.waypoints, w.pin];
        const a = pts[i], b = pts[i + 1];
        const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
        w.waypoints.splice(i, 0, mid);
        return;
    }
    if (hit && hit.startsWith('wiz:remove:')) {
        const i = parseInt(hit.slice(11), 10);
        holeWizard.waypoints.splice(i, 1);
        return;
    }
    if (hit && hit.startsWith('wiz:drag:')) {
        holeWizard.draggingIdx = parseInt(hit.slice(9), 10);
        return;
    }

    // ---- Hole inspector card (open) — taps inside it are handled/absorbed,
    // taps outside close it and fall through to normal handling ----
    if (owSelectedHole != null && !holeWizard) {
        const hc = holeCardLayout();
        const selHole = worldCourse.holes.find(h => h.id === owSelectedHole);
        if (selHole && hitBtn(sx, sy, hc.x, hc.y, hc.w, hc.h)) {
            if (hitBtn(sx, sy, hc.playX, hc.playY, hc.playW, hc.playH)) {
                startWorldHolePlaytest(selHole);
                return;
            }
            if (hitBtn(sx, sy, hc.delX, hc.delY, hc.delW, hc.delH)) {
                worldCourse.holes = worldCourse.holes.filter(h => h.id !== owSelectedHole);
                owSelectedHole = null;
                saveWorldCourse();
                notify('Hole deleted');
            }
            return;
        }
        owSelectedHole = null;
    }

    // ---- Tap a hole marker (navigation mode) to inspect it ----
    if (!holeWizard && owTool === 'hand') {
        for (const hole of worldCourse.holes) {
            const ts = cellCenterScreen(hole.tee.x, hole.tee.y);
            const ps = cellCenterScreen(hole.pin.x, hole.pin.y);
            const near = (pt) => pt && !pt.behind
                && (sx - pt.x) * (sx - pt.x) + (sy - pt.y) * (sy - pt.y) < 22 * 22;
            if (near(ts) || near(ps)) { owSelectedHole = hole.id; return; }
        }
    }

    // Not a HUD hit — action depends on mode
    const cell = screenToCell(sx, sy);
    if (holeWizard) {
        if (!cell) return;
        if (holeWizard.step === 'tee') {
            holeWizard.tee = { x: cell.c, y: cell.r };
            holeWizard.step = 'pin';
            owLastGhostCell = { c: cell.c, r: cell.r };
            return;
        }
        if (holeWizard.step === 'pin') {
            // Prevent placing pin exactly on tee
            if (holeWizard.tee && holeWizard.tee.x === cell.c && holeWizard.tee.y === cell.r) return;
            holeWizard.pin = { x: cell.c, y: cell.r };
            holeWizard.step = 'shape';
            owLastGhostCell = null;
            return;
        }
        // Shape step with no handle hit → pan
        scouting = true; scoutLastX = sx; scoutLastY = sy;
        return;
    }

    // Brush mode — start a paint stroke on the current cell (if inside
    // playable area). The hand tool has no terrain, so navigation falls
    // through to the camera-pan block below.
    if (cell) {
        const tool = currentTool();
        if (tool && tool.terrain != null && !tool.wizard) {
            owDragPainting = true;
            owDragLastCell = cell;
            owLastGhostCell = cell;
            owStrokeDiff = new Map();
            const changed = paintBrushAt(cell.c, cell.r, owBrushSize, tool.terrain);
            if (changed.length && scene3dReady) {
                if (typeof repaintAlbedoCells === 'function') repaintAlbedoCells(worldCourse, changed);
                if (typeof repaintTerrainCells === 'function') repaintTerrainCells(worldCourse, changed);
            }
            return;
        }
    }

    // Fallback: camera pan (+ pending long-press eyedropper in nav mode)
    cancelOwLongPress();
    if (owTool === 'hand' && cell) {
        const pressCell = cell;
        owLongPress = { sx, sy, timer: setTimeout(() => eyedropAt(pressCell), 500) };
    }
    scouting = true;
    scoutLastX = sx;
    scoutLastY = sy;
}

function overworldTouchMove(sx, sy) {
    // Wizard waypoint drag
    if (holeWizard && holeWizard.draggingIdx >= 0) {
        const cell = screenToCell(sx, sy);
        if (cell) holeWizard.waypoints[holeWizard.draggingIdx] = { x: cell.c, y: cell.r };
        return;
    }
    // Brush painting
    if (owDragPainting) {
        const cell = screenToCell(sx, sy);
        if (!cell) return;
        if (!owDragLastCell || cell.c !== owDragLastCell.c || cell.r !== owDragLastCell.r) {
            owDragLastCell = cell;
            owLastGhostCell = cell;
            const changed = paintBrushAt(cell.c, cell.r, owBrushSize, currentTool().terrain);
            if (changed.length && scene3dReady) {
                if (typeof repaintAlbedoCells === 'function') repaintAlbedoCells(worldCourse, changed);
                if (typeof repaintTerrainCells === 'function') repaintTerrainCells(worldCourse, changed);
            }
        }
        return;
    }
    // Camera pan
    if (scouting) {
        // Moving beyond a small slop cancels the pending eyedropper
        if (owLongPress && (Math.abs(sx - owLongPress.sx) > 8 || Math.abs(sy - owLongPress.sy) > 8)) {
            cancelOwLongPress();
        }
        const dx = sx - scoutLastX;
        const dy = sy - scoutLastY;
        scoutLastX = sx;
        scoutLastY = sy;
        if (scene3dReady && typeof panCamera3D === 'function') {
            panCamera3D(dx, dy);
        } else {
            cam.targetX -= dx / cam.zoom;
            cam.targetY -= dy / cam.zoom;
        }
    }
}

function overworldTouchEnd() {
    // Release any held camera-control button so continuous rotate/tilt stops
    owHeldCamBtn = null;
    cancelOwLongPress();
    if (holeWizard && holeWizard.draggingIdx >= 0) {
        holeWizard.draggingIdx = -1;
        return;
    }
    if (owDragPainting) {
        finishPaintStroke();
        return;
    }
    scouting = false;
}

// Finalize the active paint stroke: bank it for undo, settle heights +
// mesh, persist. Called from touch-end AND from the pinch-start cancel
// (a second finger landing mid-stroke must not leave the stroke open).
function finishPaintStroke() {
    owDragPainting = false;
    owDragLastCell = null;
    if (owStrokeDiff && owStrokeDiff.size) {
        owUndoStack.push({ cells: Array.from(owStrokeDiff.values()) });
        if (owUndoStack.length > 20) owUndoStack.shift();
    }
    owStrokeDiff = null;
    if (owNeedsRebuild && scene3dReady) {
        // Terrain-type flattening means painting reshapes elevation too
        // (fairway smooths hills, water sits flat) — refresh heights
        // before the mesh rebuild so the two never desync.
        refreshWorldHeights();
        buildTerrain3D(worldCourse, { distantScenery: false });
        owNeedsRebuild = false;
    }
    saveWorldCourse();
}

// ---- Two-finger gesture begins: cancel all one-finger interactions ----
// Called by the engine before pinch tracking starts. Leaving any of these
// live produced the classic "camera jumps after pinching" bug (stale
// scoutLast coords) and open-ended paint strokes that broke undo.
function onPinchStart() {
    if (state === 'overworld') {
        cancelOwLongPress();
        if (owDragPainting) finishPaintStroke();
        if (holeWizard) holeWizard.draggingIdx = -1;
        scouting = false;
    } else if (state === 'playing') {
        scouting = false;
        spinAdjusting = false;
        if (draggingTarget) { draggingTarget = false; aiming = false; }
        if (dragBackActive) { dragBackActive = false; dragBackY = 0; }
    }
}

// ---- Gameplay Drawing ----
function drawPlaying() {
    // Reset transform to prevent accumulation bugs
    const d = window.devicePixelRatio || 1;
    ctx.setTransform(d, 0, 0, d, 0, 0);

    const is3D = scene3dReady && typeof render3D === 'function';

    if (!is3D) {
        ctx.fillStyle = '#1a472a';
        ctx.fillRect(0, 0, W(), H());
    } else {
        // Clear 2D canvas transparent for HUD overlay on top of 3D
        ctx.clearRect(0, 0, W(), H());
    }

    if (!currentHole) return;

    // Skip 2D world rendering when 3D is active
    if (!is3D) {
    camTransform();

    // Draw terrain
    const hole = currentHole;
    for (let r = 0; r < hole.rows; r++) {
        for (let c = 0; c < hole.cols; c++) {
            const t = hole.grid[r][c];
            ctx.fillStyle = TERRAIN_COLORS[t] || '#1a3d1a';
            ctx.fillRect(c * CELL, r * CELL, CELL + 0.5, CELL + 0.5);
        }
    }

    // Water animation
    for (let r = 0; r < hole.rows; r++) {
        for (let c = 0; c < hole.cols; c++) {
            if (hole.grid[r][c] === T.WATER) {
                const shimmer = Math.sin(Date.now() / 400 + c * 0.5 + r * 0.3) * 0.08;
                ctx.fillStyle = `rgba(255,255,255,${0.05 + shimmer})`;
                ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
            }
        }
    }

    // Tree details
    for (let r = 0; r < hole.rows; r++) {
        for (let c = 0; c < hole.cols; c++) {
            if (hole.grid[r][c] === T.TREE) {
                ctx.fillStyle = '#145222';
                ctx.beginPath();
                ctx.arc((c + 0.5) * CELL, (r + 0.5) * CELL, CELL * 0.45, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Green slope indicators (subtle arrows showing break direction)
    // Generate pseudo-random slopes based on hole position (deterministic per hole)
    if (terrainAt(ball.x, ball.y) === T.GREEN || shotLocked || meterActive || dragBackMode) {
        for (let r = 0; r < hole.rows; r++) {
            for (let c = 0; c < hole.cols; c++) {
                if (hole.grid[r][c] === T.GREEN) {
                    // Slope points toward the hole with some variation
                    const cx = (c + 0.5) * CELL, cy = (r + 0.5) * CELL;
                    const toHoleX = (hole.hole.x + 0.5) * CELL - cx;
                    const toHoleY = (hole.hole.y + 0.5) * CELL - cy;
                    const dist = Math.sqrt(toHoleX * toHoleX + toHoleY * toHoleY);
                    if (dist < 4) continue;
                    // Add seeded variation based on position
                    const seed = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453;
                    const variation = (seed - Math.floor(seed)) * 0.8 - 0.4;
                    const angle = Math.atan2(toHoleY, toHoleX) + variation;
                    const arrowLen = 4;
                    const ax = Math.cos(angle) * arrowLen;
                    const ay = Math.sin(angle) * arrowLen;
                    ctx.strokeStyle = 'rgba(0,80,0,0.25)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(cx - ax, cy - ay);
                    ctx.lineTo(cx + ax, cy + ay);
                    ctx.stroke();
                    // Arrow head
                    ctx.beginPath();
                    ctx.moveTo(cx + ax, cy + ay);
                    ctx.lineTo(cx + ax - Math.cos(angle - 0.5) * 3, cy + ay - Math.sin(angle - 0.5) * 3);
                    ctx.moveTo(cx + ax, cy + ay);
                    ctx.lineTo(cx + ax - Math.cos(angle + 0.5) * 3, cy + ay - Math.sin(angle + 0.5) * 3);
                    ctx.stroke();
                }
            }
        }
    }

    // Draw hole/cup
    const hx = (hole.hole.x + 0.5) * CELL;
    const hy = (hole.hole.y + 0.5) * CELL;
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.fill();
    drawFlag(hx + 1, hy, 0.6);

    // Max distance ring for selected club (not on green)
    if (!ball.moving && !holeComplete && !flyoverActive && terrainAt(ball.x, ball.y) !== T.GREEN) {
        const club = CLUBS[selectedClub];
        const maxDist = club.maxYds * YDS_TO_WORLD; // max range in world units
        ctx.strokeStyle = 'rgba(255,255,100,0.25)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, maxDist, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Landing zone indicator (when aiming, shot locked, or needle)
    // Always show aim guides when we have a target (not putting, not in ball flight)
    const onGreenNow = terrainAt(ball.x, ball.y) === T.GREEN;
    const hasTarget = !onGreenNow && !ball.moving && !holeComplete && !flyoverActive;
    const showAimPower = (shotLocked || meterActive || dragBackMode) ? lockedPower : aimPower;
    const showAimDirX = (shotLocked || meterActive || dragBackMode) ? lockedDirX : aimDirX;
    const showAimDirY = (shotLocked || meterActive || dragBackMode) ? lockedDirY : aimDirY;
    if (showAimPower > 10 && !onGreenNow) {
        const club = CLUBS[selectedClub];
        const len = Math.sqrt(showAimDirX * showAimDirX + showAimDirY * showAimDirY);
        if (len > 0) {
            const nx = showAimDirX / len, ny = showAimDirY / len;
            const landDist = (showAimPower / club.maxPower) * club.maxYds * YDS_TO_WORLD;
            const landX = ball.x + nx * landDist;
            const landY = ball.y + ny * landDist;

            // Accuracy rings (concentric circles around target)
            for (let ring = 3; ring >= 1; ring--) {
                const ringR = ring * 8;
                const ringAlpha = 0.15 + (3 - ring) * 0.1;
                ctx.strokeStyle = `rgba(255,255,255,${ringAlpha})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(landX, landY, ringR, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Landing zone target (crosshair) — larger and bolder
            ctx.strokeStyle = 'rgba(255,255,100,0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(landX, landY, 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(landX - 18, landY); ctx.lineTo(landX - 6, landY);
            ctx.moveTo(landX + 6, landY); ctx.lineTo(landX + 18, landY);
            ctx.moveTo(landX, landY - 18); ctx.lineTo(landX, landY - 6);
            ctx.moveTo(landX, landY + 6); ctx.lineTo(landX, landY + 18);
            ctx.stroke();

            // Center dot
            ctx.fillStyle = 'rgba(255,255,100,0.9)';
            ctx.beginPath();
            ctx.arc(landX, landY, 3, 0, Math.PI * 2);
            ctx.fill();

            // ---- Ball guide: simulate roll after landing ----
            // Match the actual physics: flight velocity * rollFactor
            const topSpinMult = spin.top || 0;
            const simRollFactor = 0.3 + topSpinMult * 0.2;
            const powerPct = Math.min(showAimPower / club.maxPower, 1);
            const simVz = club.launch * powerPct;
            const simAirTime = 2 * simVz / GRAVITY;
            const simFlightVel = simAirTime > 0 ? (landDist * 0.85) / simAirTime : landDist * 2.5;
            let simVx = nx * simFlightVel * simRollFactor;
            let simVy = ny * simFlightVel * simRollFactor;
            let simX = landX, simY = landY;
            const guidePoints = [{ x: simX, y: simY }];
            const simDt = 0.03;
            for (let s = 0; s < 40; s++) {
                const ter = terrainAt(simX, simY);
                if (ter === T.WATER || ter === T.OOB || ter === T.TREE) break;
                const fric = TERRAIN_FRICTION[ter] || 0.97;
                simVx *= Math.pow(fric, simDt * 60);
                simVy *= Math.pow(fric, simDt * 60);
                simX += simVx * simDt;
                simY += simVy * simDt;
                const spd = Math.sqrt(simVx * simVx + simVy * simVy);
                if (spd < 3) break;
                guidePoints.push({ x: simX, y: simY });
            }
            // Draw guide as fading dots
            for (let i = 1; i < guidePoints.length; i++) {
                const alpha = 0.5 * (1 - i / guidePoints.length);
                ctx.fillStyle = `rgba(255,200,50,${alpha})`;
                ctx.beginPath();
                ctx.arc(guidePoints[i].x, guidePoints[i].y, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Shot trail
    if (shotTrail.length > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(shotTrail[0].x, shotTrail[0].y);
        for (let i = 1; i < shotTrail.length; i++) ctx.lineTo(shotTrail[i].x, shotTrail[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Aim line / Putt guide (visible during aim, locked, or default target)
    const aimVis = (aiming && aimPower > 5) || shotLocked || meterActive || hasTarget;
    // Priority: locked/meter use locked values, everything else uses current aim values
    const visAimDirX = (shotLocked || meterActive || dragBackMode) ? lockedDirX : aimDirX;
    const visAimDirY = (shotLocked || meterActive || dragBackMode) ? lockedDirY : aimDirY;
    const visAimPower = (shotLocked || meterActive || dragBackMode) ? lockedPower : aimPower;
    if (aimVis && (visAimPower > 5 || putting)) {
        const len = Math.sqrt(visAimDirX * visAimDirX + visAimDirY * visAimDirY);
        if (len > 0) {
            const nx = visAimDirX / len, ny = visAimDirY / len;
            const club = CLUBS[selectedClub];

            if (putting) {
                // ---- PUTT GUIDE ----
                // Solid guide line from ball to target
                ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(ball.x, ball.y);
                ctx.lineTo(puttTargetX, puttTargetY);
                ctx.stroke();

                // Distance dots along the line
                const puttDist = Math.sqrt((puttTargetX - ball.x) ** 2 + (puttTargetY - ball.y) ** 2);
                const dotSpacing = 12;
                const numDots = Math.floor(puttDist / dotSpacing);
                for (let i = 1; i <= numDots; i++) {
                    const t = i / numDots;
                    const dx = ball.x + (puttTargetX - ball.x) * t;
                    const dy = ball.y + (puttTargetY - ball.y) * t;
                    ctx.fillStyle = `rgba(255,255,255,${0.3 + t * 0.4})`;
                    ctx.beginPath();
                    ctx.arc(dx, dy, 1.5, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Target circle
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(puttTargetX, puttTargetY, 6, 0, Math.PI * 2);
                ctx.stroke();
                // Target cross
                ctx.beginPath();
                ctx.moveTo(puttTargetX - 4, puttTargetY);
                ctx.lineTo(puttTargetX + 4, puttTargetY);
                ctx.moveTo(puttTargetX, puttTargetY - 4);
                ctx.lineTo(puttTargetX, puttTargetY + 4);
                ctx.stroke();

                // Putt distance in feet (shorter scale for putting)
                const puttFeet = Math.round(puttDist / 1.5);
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = 'bold 8px -apple-system,sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(puttFeet + ' ft', puttTargetX, puttTargetY - 12);
            } else {
                // ---- NORMAL AIM LINE ----
                const lineLen = (visAimPower / club.maxPower) * club.maxYds * YDS_TO_WORLD;

                // Dotted aim line
                ctx.strokeStyle = 'rgba(255,255,100,0.7)';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 6]);
                ctx.beginPath();
                ctx.moveTo(ball.x, ball.y);
                ctx.lineTo(ball.x + nx * lineLen, ball.y + ny * lineLen);
                ctx.stroke();
                ctx.setLineDash([]);

                // Arrow head
                const ax = ball.x + nx * lineLen, ay = ball.y + ny * lineLen;
                ctx.fillStyle = 'rgba(255,255,100,0.8)';
                ctx.beginPath();
                ctx.moveTo(ax + nx * 6, ay + ny * 6);
                ctx.lineTo(ax - ny * 4, ay + nx * 4);
                ctx.lineTo(ax + ny * 4, ay - nx * 4);
                ctx.fill();
            }
        }
    }

    // Draw ball (with air height visual)
    if (ball.airborne && ball.z > 0) {
        // Shadow on ground (gets smaller/fainter as ball goes higher)
        const shadowAlpha = Math.max(0.08, 0.3 - ball.z / 400);
        const shadowScale = Math.max(0.4, 1 - ball.z / 300);
        ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
        ctx.beginPath();
        ctx.ellipse(ball.x, ball.y, 4 * shadowScale, 2.5 * shadowScale, 0, 0, Math.PI * 2);
        ctx.fill();
        // Ball drawn above its ground position
        const visualHeight = ball.z * 0.15; // scale z to visual offset
        drawBall(ball.x, ball.y - visualHeight, 4, player.ballColor);
    } else {
        drawBall(ball.x, ball.y, 4, player.ballColor);
    }

    camRestore();
    } // end if (!is3D) — skip 2D world rendering

    // Reset transform for HUD (screen space)
    const dp = window.devicePixelRatio || 1;
    ctx.setTransform(dp, 0, 0, dp, 0, 0);

    // ---- 3D aim guides (projected to screen) ----
    if (is3D && !ball.moving && !holeComplete) {
        const onGreen3D = terrainAt(ball.x, ball.y) === T.GREEN;
        const club3D = CLUBS[selectedClub];
        const hasTgt = !onGreen3D && !flyoverActive;

        if (hasTgt && aimPower > 5) {
            // Project ball and target to screen
            const bs = worldToScreen3D(ball.x, ball.y);
            const dirLen = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);

            if (dirLen > 0) {
                const nx = aimDirX / dirLen, ny = aimDirY / dirLen;
                const usePower = (shotLocked || meterActive || dragBackMode) ? lockedPower : aimPower;
                const useDir = (shotLocked || meterActive || dragBackMode) ? { x: lockedDirX, y: lockedDirY } : { x: aimDirX, y: aimDirY };
                const uLen = Math.sqrt(useDir.x * useDir.x + useDir.y * useDir.y);
                const unx = useDir.x / uLen, uny = useDir.y / uLen;
                const landDist = (usePower / club3D.maxPower) * club3D.maxYds * YDS_TO_WORLD;
                const landWx = ball.x + unx * landDist;
                const landWy = ball.y + uny * landDist;
                const ls = worldToScreen3D(landWx, landWy);

                // Aim line (from ball to target) — skip if ball is behind camera
                if (!bs.behind && !ls.behind) {
                    ctx.strokeStyle = 'rgba(100,220,255,0.8)';
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.moveTo(bs.x, bs.y);
                    ctx.lineTo(ls.x, ls.y);
                    ctx.stroke();
                } else if (!ls.behind) {
                    // Ball behind camera but target visible — draw from screen edge
                    ctx.strokeStyle = 'rgba(100,220,255,0.4)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(ls.x, H());
                    ctx.lineTo(ls.x, ls.y);
                    ctx.stroke();
                }

                // Target — animated concentric rings (Golf Clash style)
                const pulse = Math.sin(Date.now() / 300) * 0.15 + 1;
                const pulse2 = Math.sin(Date.now() / 400 + 1) * 0.12 + 1;
                // Outer rotating ring
                ctx.save();
                ctx.translate(ls.x, ls.y);
                ctx.rotate(Date.now() / 2000);
                ctx.strokeStyle = 'rgba(255,255,255,0.35)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, 24 * pulse, 0, Math.PI * 1.5);
                ctx.stroke();
                ctx.restore();
                // Middle ring
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(ls.x, ls.y, 14 * pulse2, 0, Math.PI * 2);
                ctx.stroke();
                // Inner ring — bright
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(ls.x, ls.y, 6, 0, Math.PI * 2);
                ctx.stroke();
                // Center dot
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(ls.x, ls.y, 2.5, 0, Math.PI * 2);
                ctx.fill();
                // Crosshair spokes (subtle, not touching center)
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(ls.x - 28, ls.y); ctx.lineTo(ls.x - 10, ls.y);
                ctx.moveTo(ls.x + 10, ls.y); ctx.lineTo(ls.x + 28, ls.y);
                ctx.moveTo(ls.x, ls.y - 28); ctx.lineTo(ls.x, ls.y - 10);
                ctx.moveTo(ls.x, ls.y + 10); ctx.lineTo(ls.x, ls.y + 28);
                ctx.stroke();

                // Floating yardage pill near target
                const ydsToTarget = Math.round(landDist / YDS_TO_WORLD);
                const ydStr = ydsToTarget + ' YDS';
                ctx.font = 'bold 12px -apple-system,sans-serif';
                const ydW = ctx.measureText(ydStr).width + 16;
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                roundRect(ls.x - ydW / 2, ls.y - 46, ydW, 22, 11);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.fillText(ydStr, ls.x, ls.y - 30);

                // Accuracy rings + distance ring (only during aiming, not when locked)
                if (!shotLocked && !meterActive) {
                    for (let ring = 3; ring >= 1; ring--) {
                        ctx.strokeStyle = `rgba(255,255,255,${0.1 + (3 - ring) * 0.08})`;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.arc(ls.x, ls.y, ring * 12, 0, Math.PI * 2);
                        ctx.stroke();
                    }

                    const maxRangeW = club3D.maxYds * YDS_TO_WORLD;
                    ctx.strokeStyle = 'rgba(255,255,100,0.2)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([6, 6]);
                    ctx.beginPath();
                    const ringPts = 36;
                    for (let i = 0; i <= ringPts; i++) {
                        const a = (i / ringPts) * Math.PI * 2;
                        const rx = ball.x + Math.cos(a) * maxRangeW;
                        const ry = ball.y + Math.sin(a) * maxRangeW;
                        const rs = worldToScreen3D(rx, ry);
                        if (i === 0) ctx.moveTo(rs.x, rs.y);
                        else ctx.lineTo(rs.x, rs.y);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                // ---- Ball guide dots (bounce/roll prediction, projected to screen) ----
                const topSpinM = spin.top || 0;
                const simRF = 0.3 + topSpinM * 0.2;
                const pctG = Math.min(usePower / club3D.maxPower, 1);
                const simVzG = club3D.launch * pctG;
                const simATG = 2 * simVzG / GRAVITY;
                const simFVG = simATG > 0 ? (landDist * 0.85) / simATG : landDist * 2.5;
                let gvx = unx * simFVG * simRF;
                let gvy = uny * simFVG * simRF;
                let gx = landWx, gy = landWy;
                for (let s = 0; s < 40; s++) {
                    const ter = terrainAt(gx, gy);
                    if (ter === T.WATER || ter === T.OOB || ter === T.TREE) break;
                    const fric = TERRAIN_FRICTION[ter] || 0.97;
                    gvx *= Math.pow(fric, 0.03 * 60);
                    gvy *= Math.pow(fric, 0.03 * 60);
                    gx += gvx * 0.03;
                    gy += gvy * 0.03;
                    if (Math.sqrt(gvx * gvx + gvy * gvy) < 3) break;
                    const gs = worldToScreen3D(gx, gy);
                    const alpha = 0.5 * (1 - s / 40);
                    ctx.fillStyle = `rgba(255,200,50,${alpha})`;
                    ctx.beginPath();
                    ctx.arc(gs.x, gs.y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // ---- Green slope arrows (projected to screen) ----
        if (onGreen3D) {
            const hole = currentHole;
            for (let r = 0; r < hole.rows; r++) {
                for (let c = 0; c < hole.cols; c++) {
                    if (hole.grid[r][c] !== T.GREEN) continue;
                    const wx = (c + 0.5) * CELL, wy = (r + 0.5) * CELL;
                    const thx = (hole.hole.x + 0.5) * CELL - wx;
                    const thy = (hole.hole.y + 0.5) * CELL - wy;
                    const td = Math.sqrt(thx * thx + thy * thy);
                    if (td < 4) continue;
                    const seed = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453;
                    const variation = (seed - Math.floor(seed)) * 0.8 - 0.4;
                    const ang = Math.atan2(thy, thx) + variation;
                    const aLen = 3;
                    const startS = worldToScreen3D(wx - Math.cos(ang) * aLen, wy - Math.sin(ang) * aLen);
                    const endS = worldToScreen3D(wx + Math.cos(ang) * aLen, wy + Math.sin(ang) * aLen);
                    ctx.strokeStyle = 'rgba(0,100,0,0.35)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(startS.x, startS.y);
                    ctx.lineTo(endS.x, endS.y);
                    ctx.stroke();
                    // Arrowhead
                    const hS = worldToScreen3D(wx + Math.cos(ang - 0.5) * (aLen - 1), wy + Math.sin(ang - 0.5) * (aLen - 1));
                    ctx.beginPath();
                    ctx.moveTo(endS.x, endS.y);
                    ctx.lineTo(hS.x, hS.y);
                    ctx.stroke();
                }
            }
        }

        // ---- 3D Putt guide (glowing line with slope curve) ----
        if (onGreen3D && putting && aimPower > 3) {
            // Simulate putt path with slope influence
            const puttLen = Math.sqrt(aimDirX * aimDirX + aimDirY * aimDirY);
            if (puttLen > 0) {
                const puttDist = (aimPower / CLUBS[selectedClub].maxPower) * CLUBS[selectedClub].maxYds * YDS_TO_WORLD;
                let pvx = (aimDirX / puttLen) * puttDist * 2.5;
                let pvy = (aimDirY / puttLen) * puttDist * 2.5;
                let px = ball.x, py = ball.y;
                const puttPts = [{ x: px, y: py }];
                for (let s = 0; s < 60; s++) {
                    // Apply green slope force
                    const holeWx = (currentHole.hole.x + 0.5) * CELL;
                    const holeWy = (currentHole.hole.y + 0.5) * CELL;
                    const toHx = holeWx - px, toHy = holeWy - py;
                    const toHd = Math.sqrt(toHx * toHx + toHy * toHy);
                    if (toHd > 2) {
                        const seed = Math.sin(Math.floor(px / CELL) * 12.9898 + Math.floor(py / CELL) * 78.233) * 43758.5453;
                        const variation = (seed - Math.floor(seed)) * 0.8 - 0.4;
                        const slopeAng = Math.atan2(toHy, toHx) + variation;
                        pvx += Math.cos(slopeAng) * 1.5;
                        pvy += Math.sin(slopeAng) * 1.5;
                    }
                    // Friction
                    pvx *= 0.92; pvy *= 0.92;
                    px += pvx * 0.03; py += pvy * 0.03;
                    if (Math.sqrt(pvx * pvx + pvy * pvy) < 2) break;
                    if (terrainAt(px, py) !== T.GREEN) break;
                    puttPts.push({ x: px, y: py });
                }

                // Project points to screen and draw glowing path
                const screenPts = puttPts.map(p => worldToScreen3D(p.x, p.y));
                if (screenPts.length > 1) {
                    // Wide glow
                    ctx.strokeStyle = 'rgba(0,180,255,0.2)';
                    ctx.lineWidth = 16;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.beginPath();
                    ctx.moveTo(screenPts[0].x, screenPts[0].y);
                    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
                    ctx.stroke();
                    // Medium glow
                    ctx.strokeStyle = 'rgba(0,220,255,0.5)';
                    ctx.lineWidth = 6;
                    ctx.beginPath();
                    ctx.moveTo(screenPts[0].x, screenPts[0].y);
                    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
                    ctx.stroke();
                    // Core
                    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(screenPts[0].x, screenPts[0].y);
                    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
                    ctx.stroke();

                    // Arrow at end
                    const last = screenPts[screenPts.length - 1];
                    const prev = screenPts[Math.max(0, screenPts.length - 3)];
                    const adx = last.x - prev.x, ady = last.y - prev.y;
                    const al = Math.sqrt(adx * adx + ady * ady);
                    if (al > 5) {
                        const anx = adx / al, any = ady / al;
                        ctx.fillStyle = 'rgba(0,200,255,0.8)';
                        ctx.beginPath();
                        ctx.moveTo(last.x, last.y);
                        ctx.lineTo(last.x - anx * 14 - any * 8, last.y - any * 14 + anx * 8);
                        ctx.lineTo(last.x - anx * 14 + any * 8, last.y - any * 14 - anx * 8);
                        ctx.fill();
                    }
                }

                // Distance in feet
                const totalDist = Math.sqrt((puttTargetX - ball.x) ** 2 + (puttTargetY - ball.y) ** 2);
                const puttFeet = Math.round(totalDist / 1.5);
                const midPt = screenPts[Math.floor(screenPts.length / 2)] || screenPts[0];
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 16px -apple-system,sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(puttFeet + ' ft', midPt.x, midPt.y - 15);
            }
        }
    }

    // ---- HUD overlay (compact, game-like) ----

    // Top bar — compact dark strip
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W(), 44);

    // Shots pill (left-center)
    ctx.fillStyle = 'rgba(10,30,60,0.9)';
    roundRect(W() / 2 - 70, 6, 80, 32, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,160,255,0.4)';
    ctx.lineWidth = 1;
    roundRect(W() / 2 - 70, 6, 80, 32, 6);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(strokes + ' SHOTS', W() / 2 - 30, 27);

    // Hole + Par (right of shots)
    ctx.fillStyle = 'rgba(40,40,40,0.9)';
    roundRect(W() / 2 + 16, 6, 44, 32, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,40,40,0.9)';
    roundRect(W() / 2 + 64, 6, 44, 32, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px -apple-system,sans-serif';
    ctx.fillText('HOLE', W() / 2 + 38, 17);
    ctx.fillText('PAR', W() / 2 + 86, 17);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px -apple-system,sans-serif';
    ctx.fillText(String(currentHoleIdx + 1), W() / 2 + 38, 34);
    ctx.fillText(String(currentHole.par), W() / 2 + 86, 34);

    // Wind (compact left side — arrow + number)
    const wcx = 36, wcy = 76;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(6, 58, 60, 38, 10);
    ctx.fill();
    // Arrow
    const arrowLen = 12;
    const wax = Math.cos(wind.angle) * arrowLen;
    const way = Math.sin(wind.angle) * arrowLen;
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(wcx - wax * 0.4, wcy - way * 0.4 - 4);
    ctx.lineTo(wcx + wax * 0.8, wcy + way * 0.8 - 4);
    ctx.stroke();
    ctx.lineCap = 'butt';
    const aAngle = Math.atan2(way, wax);
    ctx.fillStyle = '#ff8c00';
    ctx.beginPath();
    ctx.moveTo(wcx + wax * 0.8, wcy + way * 0.8 - 4);
    ctx.lineTo(wcx + wax * 0.8 - Math.cos(aAngle - 0.6) * 5, wcy + way * 0.8 - 4 - Math.sin(aAngle - 0.6) * 5);
    ctx.lineTo(wcx + wax * 0.8 - Math.cos(aAngle + 0.6) * 5, wcy + way * 0.8 - 4 - Math.sin(aAngle + 0.6) * 5);
    ctx.fill();
    // Speed
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(wind.speed * 10) / 10, wcx, wcy + 14);

    // Terrain (top left)
    const ter = terrainAt(ball.x, ball.y);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '11px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(TERRAIN_NAMES[ter] || '', 10, 34);

    // ---- Unified bottom tray (CR-style: club card • take shot • spin) ----
    const onGreenNow = terrainAt(ball.x, ball.y) === T.GREEN;
    const showTray = !ball.moving && !holeComplete && !flyoverActive && !meterActive && !dragBackMode && !onGreenNow;
    const TRAY_H = 100;
    const TRAY_Y = H() - TRAY_H;
    if (showTray) {
        // Tray background — dark frosted gradient with top highlight
        const trayGrad = ctx.createLinearGradient(0, TRAY_Y, 0, H());
        trayGrad.addColorStop(0, 'rgba(0,0,0,0.55)');
        trayGrad.addColorStop(1, 'rgba(0,0,0,0.82)');
        ctx.fillStyle = trayGrad;
        ctx.fillRect(0, TRAY_Y, W(), TRAY_H);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, TRAY_Y); ctx.lineTo(W(), TRAY_Y); ctx.stroke();
    }

    // Club card (left of tray)
    if (showTray && !shotLocked) {
        const club = CLUBS[selectedClub];
        const cardX = 10, cardW = 82;
        // Up arrow
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        roundRect(cardX, TRAY_Y + 4, cardW, 22, 8);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '12px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('\u25B2', cardX + cardW / 2, TRAY_Y + 20);

        // Card body
        ctx.fillStyle = 'rgba(20,40,70,0.85)';
        roundRect(cardX, TRAY_Y + 30, cardW, 40, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(100,160,255,0.35)';
        ctx.lineWidth = 1;
        roundRect(cardX, TRAY_Y + 30, cardW, 40, 10);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(club.name.split(' ')[0], cardX + cardW / 2, TRAY_Y + 49);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '10px -apple-system,sans-serif';
        ctx.fillText(club.maxYds + 'y', cardX + cardW / 2, TRAY_Y + 63);

        // Down arrow
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        roundRect(cardX, TRAY_Y + 74, cardW, 22, 8);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '12px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('\u25BC', cardX + cardW / 2, TRAY_Y + 90);
    }

    // Power meter (when dragging to aim in Step 1)
    if (aiming && !putting && aimPower > 10 && !meterActive) {
        const club = CLUBS[selectedClub];
        const meterW = W() - 40;
        const meterH = 12;
        const mx = 20, my = H() - 160;
        const pct = Math.min(aimPower / club.maxPower, 1);

        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        roundRect(mx - 4, my - 4, meterW + 8, meterH + 8, 8);
        ctx.fill();

        ctx.fillStyle = '#333';
        roundRect(mx, my, meterW, meterH, 6);
        ctx.fill();

        // Gradient power bar
        const grad = ctx.createLinearGradient(mx, 0, mx + meterW * pct, 0);
        grad.addColorStop(0, '#4caf50');
        grad.addColorStop(0.5, '#ffeb3b');
        grad.addColorStop(1, '#f44336');
        ctx.fillStyle = grad;
        roundRect(mx, my, meterW * pct, meterH, 6);
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;
        const willFly = club.launch > 0 && pct > club.airMin;
        const shotLabel = club.name + ' \u2022 ' + (willFly ? 'AIR' : 'ROLL') + ' ' + Math.round(pct * 100) + '%';
        ctx.fillText(shotLabel, W() / 2, my - 8);

    }

    // ---- TAKE SHOT (center of tray) + Cancel (right slot when locked) ----
    const showTakeShot = !meterActive && !dragBackMode && !draggingTarget && !ball.moving && !holeComplete && !flyoverActive && !onGreenNow && (shotLocked || (aimPower > 5));
    if (showTakeShot) {
        const shootBtnH = 44;
        const shootBtnX = 102;
        const shootBtnY = TRAY_Y + (TRAY_H - shootBtnH) / 2;
        const shootBtnW = W() - 204; // leave 102 on each side for club + spin/cancel slots
        const shootGrad = ctx.createLinearGradient(shootBtnX, shootBtnY, shootBtnX + shootBtnW, shootBtnY);
        shootGrad.addColorStop(0, '#ff6d00');
        shootGrad.addColorStop(1, '#ff3d00');
        ctx.fillStyle = shootGrad;
        roundRect(shootBtnX, shootBtnY, shootBtnW, shootBtnH, 22);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        roundRect(shootBtnX, shootBtnY, shootBtnW, shootBtnH, 22);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 17px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TAKE SHOT', shootBtnX + shootBtnW / 2, shootBtnY + shootBtnH / 2 + 6);

        // Cancel — right slot when locked (replaces spin puck)
        if (shotLocked) {
            const cancelX = W() - 92, cancelY = shootBtnY, cancelW = 82, cancelH = shootBtnH;
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            roundRect(cancelX, cancelY, cancelW, cancelH, 14);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            roundRect(cancelX, cancelY, cancelW, cancelH, 14);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = '14px -apple-system,sans-serif';
            ctx.fillText('Cancel', cancelX + cancelW / 2, cancelY + cancelH / 2 + 5);
        }
    }

    // ---- Accuracy arc (polished behind-ball fan) ----
    if (meterActive) {
        const arcCx = W() / 2;
        const arcCy = H() - 15;
        const arcR = Math.min(W() * 0.28, 120);
        const arcSpread = Math.PI * 0.5;
        const arcStart = -Math.PI / 2 - arcSpread / 2;
        const arcEnd = -Math.PI / 2 + arcSpread / 2;

        // Outer glow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(arcCx, arcCy);
        ctx.arc(arcCx, arcCy, arcR + 8, arcStart - 0.05, arcEnd + 0.05);
        ctx.closePath();
        ctx.fill();

        // Colored fan segments with smoother gradient
        const segments = 40;
        for (let i = 0; i < segments; i++) {
            const t = i / segments;
            const a1 = arcStart + t * arcSpread;
            const a2 = arcStart + (t + 1) / segments * arcSpread;
            const fromCenter = Math.abs(t - 0.5) * 2;
            let r, g, b;
            if (fromCenter < 0.33) {
                r = 56; g = 195; b = 90;
            } else if (fromCenter < 0.66) {
                const p = (fromCenter - 0.33) / 0.33;
                r = 56 + (255 - 56) * p; g = 195 + (220 - 195) * p; b = 90 * (1 - p);
            } else {
                const p = (fromCenter - 0.66) / 0.34;
                r = 255; g = 220 - 160 * p; b = 0;
            }
            ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.9)`;
            ctx.beginPath();
            ctx.moveTo(arcCx, arcCy);
            ctx.arc(arcCx, arcCy, arcR, a1, a2);
            ctx.closePath();
            ctx.fill();
        }

        // Outer arc ring
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(arcCx, arcCy, arcR, arcStart, arcEnd);
        ctx.stroke();

        // Inner arc ring (subtle)
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(arcCx, arcCy, arcR * 0.5, arcStart, arcEnd);
        ctx.stroke();

        // Center target line — white with glow
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(arcCx, arcCy - arcR * 0.3);
        ctx.lineTo(arcCx, arcCy - arcR - 6);
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(arcCx, arcCy - arcR * 0.3);
        ctx.lineTo(arcCx, arcCy - arcR - 6);
        ctx.stroke();

        // Sweeping arrow (meterAngle: -1 to 1 mapped across the arc)
        const arrowAngle = -Math.PI / 2 + meterAngle * (arcSpread / 2);
        const arrowLen = arcR + 15;
        const arrowX = arcCx + Math.cos(arrowAngle) * arrowLen;
        const arrowY = arcCy + Math.sin(arrowAngle) * arrowLen;
        const arrowBaseX = arcCx + Math.cos(arrowAngle) * (arcR * 0.3);
        const arrowBaseY = arcCy + Math.sin(arrowAngle) * (arcR * 0.3);

        // Arrow line
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(arrowBaseX, arrowBaseY);
        ctx.lineTo(arrowX, arrowY);
        ctx.stroke();

        // Arrow head
        const headLen = 10;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - Math.cos(arrowAngle - 0.4) * headLen, arrowY - Math.sin(arrowAngle - 0.4) * headLen);
        ctx.lineTo(arrowX - Math.cos(arrowAngle + 0.4) * headLen, arrowY - Math.sin(arrowAngle + 0.4) * headLen);
        ctx.fill();

        // Ball representation at arc center
        drawBall(arcCx, arcCy, 10, player.ballColor);

        // Target bullseye at top (above arc)
        const bullX = arcCx, bullY = arcCy - arcR - 20;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(bullX, bullY, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(bullX, bullY, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#e33';
        ctx.beginPath(); ctx.arc(bullX, bullY, 3, 0, Math.PI * 2); ctx.fill();

        // "RELEASE ON WHITE" hint (fires when arrow position is captured)
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('RELEASE ON WHITE', W() / 2, arcCy - arcR - 55);
    }

    // Re-Aim button during drag-back mode (back out to free overhead aim)
    if (dragBackMode) {
        const reAimW = W() * 0.32, reAimH = 44;
        const reAimX = W() - reAimW - 14, reAimY = H() - 56;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        roundRect(reAimX, reAimY, reAimW, reAimH, 22);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        roundRect(reAimX, reAimY, reAimW, reAimH, 22);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 15px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('\u21BA Re-Aim', reAimX + reAimW / 2, reAimY + reAimH / 2 + 5);
    }

    // ---- Drag-back target circle (shown after TAKE SHOT, before the drag is engaged) ----
    if (dragBackMode && !meterActive) {
        const bs = (scene3dReady && typeof worldToScreen3D === 'function') ? worldToScreen3D(ball.x, ball.y) : worldToScreen(ball.x, ball.y);
        const cx = bs.x;
        const cy = bs.y + DRAG_BACK_THRESHOLD + 30;
        // Pulsing dashed target circle
        const pulse = 1 + Math.sin(Date.now() / 300) * 0.08;
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 30 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        // Small hint inside
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 12px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('DRAG BACK', cx, cy + 4);

        // If the player is actively dragging but hasn't hit the threshold, draw the trail
        if (dragBackActive && dragBackY > 5) {
            const tY = bs.y + dragBackY;
            // Green glow trail from ball to finger
            const grad = ctx.createLinearGradient(cx, bs.y, cx, tY);
            grad.addColorStop(0, 'rgba(120,255,140,0.0)');
            grad.addColorStop(1, 'rgba(120,255,140,0.6)');
            ctx.fillStyle = grad;
            ctx.fillRect(cx - 22, bs.y, 44, tY - bs.y);
            // Virtual ball at finger position
            drawBall(cx, tY, 12, player.ballColor);
        }
    }

    // ---- Putt accuracy arc (runs during drag-back on the green) ----
    if (putting && aimPower > 10 && !meterActive) {
        const arcCx = W() / 2;
        const arcCy = H() - 15;
        const arcR = Math.min(W() * 0.22, 95);
        const arcSpread = Math.PI * 0.5;
        const arcStart = -Math.PI / 2 - arcSpread / 2;
        const arcEnd = -Math.PI / 2 + arcSpread / 2;

        // Backdrop
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.moveTo(arcCx, arcCy);
        ctx.arc(arcCx, arcCy, arcR + 8, arcStart - 0.05, arcEnd + 0.05);
        ctx.closePath();
        ctx.fill();

        // Colored fan segments
        const segments = 36;
        for (let i = 0; i < segments; i++) {
            const t = i / segments;
            const a1 = arcStart + t * arcSpread;
            const a2 = arcStart + (t + 1) / segments * arcSpread;
            const fromCenter = Math.abs(t - 0.5) * 2;
            let r, g, b;
            if (fromCenter < 0.33) {
                r = 56; g = 195; b = 90;
            } else if (fromCenter < 0.66) {
                const p = (fromCenter - 0.33) / 0.33;
                r = 56 + (255 - 56) * p; g = 195 + (220 - 195) * p; b = 90 * (1 - p);
            } else {
                const p = (fromCenter - 0.66) / 0.34;
                r = 255; g = 220 - 160 * p; b = 0;
            }
            ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.9)`;
            ctx.beginPath();
            ctx.moveTo(arcCx, arcCy);
            ctx.arc(arcCx, arcCy, arcR, a1, a2);
            ctx.closePath();
            ctx.fill();
        }

        // Outer arc ring
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(arcCx, arcCy, arcR, arcStart, arcEnd);
        ctx.stroke();

        // White outline center target line
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(arcCx, arcCy - arcR * 0.3);
        ctx.lineTo(arcCx, arcCy - arcR - 6);
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(arcCx, arcCy - arcR * 0.3);
        ctx.lineTo(arcCx, arcCy - arcR - 6);
        ctx.stroke();

        // Sweeping blue arrow
        const arrowAngle = -Math.PI / 2 + puttMeterAngle * (arcSpread / 2);
        const arrowLen = arcR + 12;
        const arrowX = arcCx + Math.cos(arrowAngle) * arrowLen;
        const arrowY = arcCy + Math.sin(arrowAngle) * arrowLen;
        const arrowBaseX = arcCx + Math.cos(arrowAngle) * (arcR * 0.3);
        const arrowBaseY = arcCy + Math.sin(arrowAngle) * (arcR * 0.3);

        ctx.strokeStyle = '#4cf';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(arrowBaseX, arrowBaseY);
        ctx.lineTo(arrowX, arrowY);
        ctx.stroke();
        const headLen = 9;
        ctx.fillStyle = '#4cf';
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - Math.cos(arrowAngle - 0.4) * headLen, arrowY - Math.sin(arrowAngle - 0.4) * headLen);
        ctx.lineTo(arrowX - Math.cos(arrowAngle + 0.4) * headLen, arrowY - Math.sin(arrowAngle + 0.4) * headLen);
        ctx.fill();

        // Ball at arc pivot
        drawBall(arcCx, arcCy, 8, player.ballColor);

        // Hint
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 12px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('RELEASE ON WHITE', W() / 2, arcCy - arcR - 20);
    }

    // ---- Spin control (right slot of bottom tray) ----
    const showSpin = !ball.moving && !holeComplete && !flyoverActive && !meterActive && !shotLocked && !dragBackMode && !onGreenNow;
    if (showSpin) {
        const spX = W() - 50, spY = TRAY_Y + TRAY_H / 2 - 4, spR = 26;

        // Glass background
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.arc(spX, spY, spR + 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(spX, spY, spR + 8, 0, Math.PI * 2);
        ctx.stroke();

        // Inner ball circle
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(spX, spY, spR, 0, Math.PI * 2);
        ctx.stroke();

        // Subtle cross
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(spX - spR, spY); ctx.lineTo(spX + spR, spY);
        ctx.moveTo(spX, spY - spR); ctx.lineTo(spX, spY + spR);
        ctx.stroke();
        ctx.setLineDash([]);

        // Spin dot — glowing red
        const dotX = spX + spin.side * spR * 0.8;
        const dotY = spY - spin.top * spR * 0.8;
        // Glow
        ctx.fillStyle = 'rgba(255,60,60,0.3)';
        ctx.beginPath();
        ctx.arc(dotX, dotY, 10, 0, Math.PI * 2);
        ctx.fill();
        // Core
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Labels — minimal
        ctx.font = '8px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText('\u25B2', spX, spY - spR - 3);  // ▲ top
        ctx.fillText('\u25BC', spX, spY + spR + 8);  // ▼ back
    }

    // Hint text — sits just above the tray so it doesn't collide with tray contents
    if (flyoverActive) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '14px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Tap to skip', W() / 2, H() - 116);
    } else if (!ball.moving && !holeComplete) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '11px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        const onGreen = terrainAt(ball.x, ball.y) === T.GREEN;
        const hintY = onGreen ? H() - 24 : H() - 110;
        if (meterActive) {
            // shown on the meter itself
        } else if (shotLocked) {
            // button label speaks for itself
        } else if (onGreen) {
            if (!putting) {
                ctx.fillText('Drag back from ball to putt \u2022 Release on white', W() / 2, hintY);
            }
        } else if (!aiming && !showTakeShot) {
            ctx.fillText('Drag target to aim \u2022 Drag elsewhere to pan', W() / 2, hintY);
        }
    }

    // Camera control rail (left side) — single unified pill with 5 icons
    if (!ball.moving && !flyoverActive && !shotLocked && !meterActive && !dragBackMode) {
        const railX = 8, railW = 32;
        const railY = 104, railH = 172; // sits just below wind indicator
        // Rail background
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        roundRect(railX, railY, railW, railH, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        roundRect(railX, railY, railW, railH, 16);
        ctx.stroke();

        const icons = ['+', '\u2212', '\u21BB', '\u21BA', '\u25CE'];
        const slot = railH / icons.length; // 34.4 per slot
        ctx.textAlign = 'center';
        for (let i = 0; i < icons.length; i++) {
            const cy = railY + slot * (i + 0.5);
            // Subtle divider between icons
            if (i > 0) {
                ctx.strokeStyle = 'rgba(255,255,255,0.06)';
                ctx.beginPath();
                ctx.moveTo(railX + 6, railY + slot * i);
                ctx.lineTo(railX + railW - 6, railY + slot * i);
                ctx.stroke();
            }
            ctx.fillStyle = 'rgba(255,255,255,0.78)';
            ctx.font = '15px -apple-system,sans-serif';
            ctx.fillText(icons[i], railX + railW / 2, cy + 5);
        }
    }

    // Quit button — subtle pill top right
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(W() - 62, 64, 52, 26, 13);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Quit', W() - 36, 81);
}

// ---- Hole Complete Screen ----
function drawHoleDone() {
    drawPlaying();

    // Dark vignette overlay
    const vigGrad = ctx.createRadialGradient(W()/2, H()/2, H()*0.2, W()/2, H()/2, H()*0.7);
    vigGrad.addColorStop(0, 'rgba(0,0,0,0.5)');
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, W(), H());

    const diff = strokes - currentHole.par;
    const scoreName = strokes === 1 ? 'HOLE IN ONE!!!' :
        (SCORE_NAMES[String(diff)] || (diff > 0 ? '+' + diff : '' + diff));

    // Card — glass panel
    const cardW = Math.min(W() - 32, 300);
    const cardH = 260;
    const cx = (W() - cardW) / 2;
    const cy = (H() - cardH) / 2 - 10;

    // Card background
    const cardGrad = ctx.createLinearGradient(cx, cy, cx, cy + cardH);
    cardGrad.addColorStop(0, 'rgba(20,50,20,0.95)');
    cardGrad.addColorStop(1, 'rgba(10,30,10,0.95)');
    ctx.fillStyle = cardGrad;
    roundRect(cx, cy, cardW, cardH, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    roundRect(cx, cy, cardW, cardH, 24);
    ctx.stroke();

    ctx.textAlign = 'center';

    // Hole name
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '14px -apple-system,sans-serif';
    ctx.fillText(currentHole.name || 'Hole ' + (currentHoleIdx + 1), W() / 2, cy + 35);

    // Score name — large, colored, with subtle glow
    const scoreColor = diff < 0 ? '#4caf50' : diff === 0 ? '#fff' : '#ff5252';
    ctx.fillStyle = scoreColor;
    ctx.font = 'bold 36px -apple-system,sans-serif';
    ctx.fillText(scoreName, W() / 2, cy + 85);

    // Strokes detail
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '15px -apple-system,sans-serif';
    ctx.fillText(strokes + ' stroke' + (strokes !== 1 ? 's' : '') + '  \u2022  Par ' + currentHole.par, W() / 2, cy + 115);

    // Divider line
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(cx + 30, cy + 135);
    ctx.lineTo(cx + cardW - 30, cy + 135);
    ctx.stroke();

    // Round total
    let totalStrokes = holeStrokes.reduce((a, b) => a + b, 0);
    let totalPar = 0;
    for (let i = 0; i < holeStrokes.length; i++) totalPar += currentCourse.holes[i].par;
    const roundDiff = totalStrokes - totalPar;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px -apple-system,sans-serif';
    ctx.fillText('Round', W() / 2, cy + 160);
    ctx.fillStyle = roundDiff < 0 ? '#4caf50' : roundDiff === 0 ? '#ffeb3b' : '#ff5252';
    ctx.font = 'bold 20px -apple-system,sans-serif';
    ctx.fillText(totalStrokes + ' (' + (roundDiff >= 0 ? '+' : '') + roundDiff + ')', W() / 2, cy + 185);

    // Next button — gradient
    const isLast = currentHoleIdx >= currentCourse.holes.length - 1;
    const btnLabel = worldPlaytest ? 'Back to Resort' : (isLast ? 'Finish Round' : 'Next Hole');
    const btnW = cardW - 48, btnH = 48;
    const btnX = cx + 24, btnY = cy + cardH - 65;
    const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    btnGrad.addColorStop(0, '#2e7d32');
    btnGrad.addColorStop(1, '#1b5e20');
    ctx.fillStyle = btnGrad;
    roundRect(btnX, btnY, btnW, btnH, 24);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px -apple-system,sans-serif';
    ctx.fillText(btnLabel, W() / 2, btnY + btnH / 2 + 6);
}

function holeDoneTouchStart(sx, sy) {
    const cardW = Math.min(W() - 40, 280);
    const cardH = 240;
    const cx = (W() - cardW) / 2;
    const cy = (H() - cardH) / 2 - 20;

    // Next/Finish button
    if (hitBtn(sx, sy, cx + 20, cy + cardH - 60, cardW - 40, 44)) {
        if (worldPlaytest) { endWorldPlaytest(); return; }
        const isLast = currentHoleIdx >= currentCourse.holes.length - 1;
        if (isLast) {
            setState('roundDone');
        } else {
            currentHoleIdx++;
            startHole(currentCourse.holes[currentHoleIdx]);
            setState('playing');
        }
    }
}

// ---- Round Complete Screen ----
function drawRoundDone() {
    // Rich dark gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H());
    bgGrad.addColorStop(0, '#0a1f0a');
    bgGrad.addColorStop(1, '#122212');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W(), H());

    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '600 24px -apple-system,sans-serif';
    ctx.fillText('Round Complete', W() / 2, 44);

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '14px -apple-system,sans-serif';
    ctx.fillText(currentCourse.name, W() / 2, 68);

    // Scorecard — glass panel
    const cardW = Math.min(W() - 24, 340);
    const cx = (W() - cardW) / 2;
    let cy = 88;
    const rowH = 38;

    // Card background
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(cx, cy, cardW, rowH * (holeStrokes.length + 2) + 8, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    roundRect(cx, cy, cardW, rowH * (holeStrokes.length + 2) + 8, 16);
    ctx.stroke();

    // Header
    cy += 4;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '600 11px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('HOLE', cx + 14, cy + 24);
    ctx.textAlign = 'center';
    ctx.fillText('PAR', cx + cardW * 0.55, cy + 24);
    ctx.fillText('SCORE', cx + cardW * 0.72, cy + 24);
    ctx.fillText('+/-', cx + cardW * 0.9, cy + 24);
    cy += rowH;

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + cardW - 10, cy); ctx.stroke();

    let totalStrokes = 0, totalPar = 0;

    for (let i = 0; i < holeStrokes.length; i++) {
        const par = currentCourse.holes[i].par;
        const sc = holeStrokes[i];
        const diff = sc - par;
        totalStrokes += sc;
        totalPar += par;

        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '14px -apple-system,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(currentCourse.holes[i].name || ('Hole ' + (i + 1)), cx + 14, cy + 24);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(String(par), cx + cardW * 0.55, cy + 24);
        ctx.fillStyle = '#fff';
        ctx.font = '600 14px -apple-system,sans-serif';
        ctx.fillText(String(sc), cx + cardW * 0.72, cy + 24);

        // +/- with color pill
        const diffStr = diff === 0 ? 'E' : (diff > 0 ? '+' + diff : String(diff));
        const diffCol = diff < 0 ? '#4caf50' : diff === 0 ? '#888' : '#ff5252';
        ctx.fillStyle = diffCol;
        ctx.font = 'bold 13px -apple-system,sans-serif';
        ctx.fillText(diffStr, cx + cardW * 0.9, cy + 24);

        cy += rowH;
        // Row divider
        if (i < holeStrokes.length - 1) {
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.beginPath(); ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + cardW - 10, cy); ctx.stroke();
        }
    }

    // Total row — emphasized
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + cardW - 10, cy); ctx.stroke();
    cy += 4;
    const totalDiff = totalStrokes - totalPar;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL', cx + 14, cy + 24);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '15px -apple-system,sans-serif';
    ctx.fillText(String(totalPar), cx + cardW * 0.55, cy + 24);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px -apple-system,sans-serif';
    ctx.fillText(String(totalStrokes), cx + cardW * 0.72, cy + 24);
    ctx.fillStyle = totalDiff < 0 ? '#4caf50' : totalDiff === 0 ? '#ffeb3b' : '#ff5252';
    ctx.font = 'bold 15px -apple-system,sans-serif';
    ctx.fillText(totalDiff === 0 ? 'E' : (totalDiff > 0 ? '+' + totalDiff : String(totalDiff)), cx + cardW * 0.9, cy + 24);

    cy += rowH + 20;

    // Check/save best score + unlock
    if (!customCoursePlay) {
        const courseIdx = CAREER_COURSES.indexOf(currentCourse);
        if (courseIdx >= 0) {
            const best = loadData('best_' + courseIdx, null);
            if (best === null || totalStrokes < best) {
                saveData('best_' + courseIdx, totalStrokes);
                // Gold pill badge
                ctx.fillStyle = 'rgba(255,235,59,0.15)';
                roundRect(W() / 2 - 80, cy, 160, 28, 14);
                ctx.fill();
                ctx.fillStyle = '#ffeb3b';
                ctx.font = 'bold 14px -apple-system,sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('\u2605 New Best Score!', W() / 2, cy + 19);
                cy += 38;
            }
            if (courseIdx + 1 < CAREER_COURSES.length && !player.unlocked.includes(courseIdx + 1)) {
                player.unlocked.push(courseIdx + 1);
                saveData('player', player);
                ctx.fillStyle = 'rgba(76,175,80,0.15)';
                roundRect(W() / 2 - 100, cy, 200, 28, 14);
                ctx.fill();
                ctx.fillStyle = '#4caf50';
                ctx.font = 'bold 13px -apple-system,sans-serif';
                ctx.fillText('\u{1F513} ' + CAREER_COURSES[courseIdx + 1].name + ' Unlocked!', W() / 2, cy + 19);
                cy += 38;
            }
        }
    }

    // Buttons — gradient style
    const bw = Math.min(W() - 48, 280);
    const bx = (W() - bw) / 2;
    cy += 12;
    // Play Again
    const paGrad = ctx.createLinearGradient(bx, cy, bx + bw, cy);
    paGrad.addColorStop(0, '#2e7d32');
    paGrad.addColorStop(1, '#1b5e20');
    ctx.fillStyle = paGrad;
    roundRect(bx, cy, bw, 48, 24);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Play Again', W() / 2, cy + 30);

    // Main Menu
    cy += 60;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(bx, cy, bw, 48, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    roundRect(bx, cy, bw, 48, 24);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '15px -apple-system,sans-serif';
    ctx.fillText('Main Menu', W() / 2, cy + 30);
}

function roundDoneTouchStart(sx, sy) {
    const bw = Math.min(W() - 60, 260);
    const bx = (W() - bw) / 2;
    // Estimate button Y positions (approximate from drawRoundDone)
    const baseY = 100 + 34 * (holeStrokes.length + 2) + 50;

    if (hitBtn(sx, sy, bx, baseY, bw, 46)) {
        // Play again
        currentHoleIdx = 0; holeStrokes = [];
        startHole(currentCourse.holes[0]);
        setState('playing');
        return;
    }
    if (hitBtn(sx, sy, bx, baseY + 58, bw, 46)) {
        setState('menu');
    }
}

// ---- Quit button in gameplay ----
function checkPlayingUI(sx, sy) {
    // Quit button
    if (hitBtn(sx, sy, W() - 58, 62, 50, 30)) {
        if (worldPlaytest) { endWorldPlaytest(); }
        else if (customCoursePlay) { setState('builder'); }
        else { setState('menu'); }
        return true;
    }
    // Camera rail buttons — 5 evenly-spaced slots inside a unified pill
    if (!ball.moving && !flyoverActive) {
        const railX = 8, railW = 32, railY = 104, railH = 172;
        const slot = railH / 5;
        if (sx >= railX && sx <= railX + railW) {
            const idx = Math.floor((sy - railY) / slot);
            if (idx >= 0 && idx < 5) {
                if (idx === 0) {
                    cam.targetZoom = Math.min(cam.targetZoom * 1.4, 8);
                    manualZoom = true;
                } else if (idx === 1) {
                    cam.targetZoom = Math.max(cam.targetZoom / 1.4, 0.3);
                    manualZoom = true;
                } else if (idx === 2) {
                    cam.targetRot += Math.PI / 4;
                    if (scene3dReady && typeof orbitCamera3D === 'function') {
                        orbitCamera3D(Math.PI / 4, ball.x, ball.y);
                        manualZoom = true;
                    }
                } else if (idx === 3) {
                    cam.targetRot -= Math.PI / 4;
                    if (scene3dReady && typeof orbitCamera3D === 'function') {
                        orbitCamera3D(-Math.PI / 4, ball.x, ball.y);
                        manualZoom = true;
                    }
                } else {
                    centerCamOnBall();
                    cam.targetRot = 0;
                    manualZoom = false;
                }
                return true;
            }
        }
    }
    return false;
}

// ---- Notification Drawing ----
function drawNotification(dt) {
    if (notification.timer <= 0) return;
    notification.timer -= dt;
    const alpha = Math.min(1, notification.timer / 0.5);

    ctx.globalAlpha = alpha;
    // Green glossy banner just under the top bar (reference style)
    ctx.font = 'bold 12px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(notification.text).width;
    const pillH = 26;
    const pillY = 52;
    glossyRect(W() / 2 - tw / 2 - 14, pillY, tw + 28, pillH, pillH / 2, '#2f7d43');
    ctx.fillStyle = '#fff';
    ctx.fillText(notification.text, W() / 2, pillY + 17);
    ctx.globalAlpha = 1;
}

// ---- Main Game Loop ----
function gameLoop(time) {
    window.__gameAlive = true; // boot watchdog: the loop is running
    requestAnimationFrame(gameLoop);

    if (!lastFrameTime) lastFrameTime = time;
    let dt = (time - lastFrameTime) / 1000;
    lastFrameTime = time;
    if (dt > 0.1) dt = 0.1;

    // Update
    if (state === 'playing') {
        // Flyover animation
        if (flyoverActive) {
            flyoverTimer += dt;
            if (flyoverPhase === 'overview' && flyoverTimer > 2.0) {
                // After showing overview, zoom to ball
                flyoverPhase = 'toBall';
                centerCamOnBall();
                cam.targetZoom = calcZoom();
                flyoverTimer = 0;
            }
            if (flyoverPhase === 'toBall' && flyoverTimer > 1.0) {
                flyoverActive = false;
            }
            camLerp(dt);
        } else {
            // Update shot meter (arrow sweeps across arc)
            if (meterActive) {
                meterAngle += meterDir * meterSpeed * dt * 2;
                if (meterAngle > 1) { meterAngle = 1; meterDir = -1; }
                if (meterAngle < -1) { meterAngle = -1; meterDir = 1; }
            }
            // Update putt accuracy sweep (runs while dragging back on the green)
            if (putting && aimPower > 10) {
                // Sweep faster on longer putts — harder to time
                const pwrPct = aimPower / CLUBS[selectedClub].maxPower;
                puttMeterSpeed = 1.1 + pwrPct * 1.4;
                puttMeterAngle += puttMeterDir * puttMeterSpeed * dt * 2;
                if (puttMeterAngle > 1) { puttMeterAngle = 1; puttMeterDir = -1; }
                if (puttMeterAngle < -1) { puttMeterAngle = -1; puttMeterDir = 1; }
            }
            updateBall(dt);
            camLerp(dt);
            if (holeComplete && !ball.moving) {
                setState('holeDone');
            }
        }
    }

    // 3D rendering for gameplay states AND overworld
    const use3D = scene3dReady && (state === 'playing' || state === 'holeDone' || state === 'overworld');
    if (use3D) {
        show3D();

        // Overworld branch — cam3dTarget is driven directly by panCamera3D /
        // zoomCamera3D from user input; we just flush any pending terrain
        // rebuild, tick the camera lerp, and render.
        if (state === 'overworld') {
            if (ballMesh) ballMesh.visible = false;
            if (typeof cloudsGroup !== 'undefined' && cloudsGroup) cloudsGroup.visible = false;
            if (typeof updateAmbientNPCs3D === 'function') updateAmbientNPCs3D(dt, worldCourse);
            if (typeof updateArcBalls3D === 'function') updateArcBalls3D();
            updateTarget3D(0, 0, false);
            // Continuous rotate/tilt while a HUD button is held
            tickOverworldCamera(dt);
            if (typeof cam3dSkipLerp !== 'undefined') cam3dSkipLerp = scouting || owDragPainting;
            updateCamera3D(dt);
            render3D();
            canvas.style.background = 'transparent';
        } else {
        if (ballMesh) ballMesh.visible = true;
        if (typeof cloudsGroup !== 'undefined' && cloudsGroup) cloudsGroup.visible = true;
        // Update 3D ball position
        updateBall3D(ball.x, ball.y, ball.z, player.ballColor, terrainHeightAt(ball.x, ball.y));
        // Update 3D target
        const onGreenNow = terrainAt(ball.x, ball.y) === T.GREEN;
        updateTarget3D(targetX, targetY, !onGreenNow && !ball.moving && !holeComplete);
        // Update 3D camera
        if (flyoverActive) {
            // Flyover: behind-ball view looking toward the hole — show the whole hole stretched out
            const hx = (currentHole.hole.x + 0.5) * CELL;
            const hy = (currentHole.hole.y + 0.5) * CELL;
            setCameraBehindBall(ball.x, ball.y, hx, hy, 60);
        } else if (meterActive || dragBackMode) {
            const tdx = lockedDirX, tdy = lockedDirY;
            const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
            setCameraBehindBall(ball.x, ball.y, ball.x + tdx / tlen * 80, ball.y + tdy / tlen * 80, 28);
        } else if (ball.moving) {
            manualZoom = false;
            // Low-angle chase cam that follows the ball's trajectory
            setCameraFollowBall(ball.x, ball.y, ball.vx, ball.vy, ball.z);
        } else if (!scouting && !manualZoom) {
            const zoomFactor = cam.targetZoom || 1;
            setCameraOverhead(ball.x, ball.y, zoomFactor * 0.5);
        }
        if (typeof cam3dSkipLerp !== 'undefined') cam3dSkipLerp = scouting;
        updateCamera3D(dt);
        render3D();
        // Make 2D canvas transparent for HUD overlay
        canvas.style.background = 'transparent';
        } // end playing/holeDone sub-branch
    } else {
        hide3D();
        canvas.style.background = '';
    }

    // The world always ticks — economy (and later NPCs) advance on any screen
    tickWorld(dt);

    // Draw 2D based on state (HUD overlay when 3D, full render when not)
    switch (state) {
        case 'menu': drawMenu(); break;
        case 'manage': drawManage(); break;
        case 'overworld': drawOverworld(); break;
        case 'character': drawCharacter(); break;
        case 'career': drawCareer(); break;
        case 'builder': builderDraw(); break;
        case 'playing': drawPlaying(); break;
        case 'holeDone': drawHoleDone(); break;
        case 'roundDone': drawRoundDone(); break;
    }

    drawNotification(dt);
}


// ---- Start! ----
// Offline catch-up runs HERE, not at module evaluation: it can call
// notify(), whose state lives in let-declarations further up the file —
// calling during evaluation crashed every device that had offline
// earnings (TDZ), i.e. every veteran save, while fresh browsers passed.
applyOfflineCatchup();
if (typeof init3D === 'function') init3D();
requestAnimationFrame(gameLoop);
