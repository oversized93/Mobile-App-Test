// ============================================================
//  GAME.JS — Main game loop, all screens, golf physics
// ============================================================

// Visible build stamp (menu + overworld top bar) so device caching issues
// are diagnosable at a glance. Bump together with index.html ?v=.
const BUILD_TAG = 'gt325';

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
    menu:      { enter: function () { menuOrbitReady = false; } },
};

// Live 3D resort backdrop behind the main menu — re-framed on each entry
let menuOrbitReady = false;

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
    worldClock: 9 * 60  // simulated minutes; new resorts open at 9:00 AM, not midnight
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
    // A finished opening hole so a new resort feels alive from minute one:
    // tee by the path, dogleg fairway, crowned green, guard bunker, pond.
    const paint = (c0, r0, c1, r1, t) => {
        for (let r = r0; r <= r1; r++)
            for (let c = c0; c <= c1; c++)
                if (r >= border && r < rows - border && c >= border && c < cols - border)
                    grid[r][c] = t;
    };
    paint(entranceCx - 8, entranceR0 - 16, entranceCx - 4, entranceR0 - 12, T.TEE);
    paint(entranceCx - 10, entranceR0 - 34, entranceCx - 2, entranceR0 - 16, T.FAIRWAY);
    paint(entranceCx - 2, entranceR0 - 40, entranceCx + 10, entranceR0 - 30, T.FAIRWAY);
    paint(entranceCx + 10, entranceR0 - 42, entranceCx + 16, entranceR0 - 36, T.GREEN);
    paint(entranceCx + 2, entranceR0 - 30, entranceCx + 7, entranceR0 - 26, T.SAND);
    paint(entranceCx - 20, entranceR0 - 30, entranceCx - 13, entranceR0 - 20, T.WATER);
    // Path spur from the entrance walk to the tee
    paint(entranceCx - 6, entranceR0 - 13, entranceCx - 1, entranceR0 - 12, T.PATH);
    // A young forest framing the fairway's north side
    for (let r = entranceR0 - 44; r < entranceR0 - 36; r++)
        for (let c = entranceCx - 14; c < entranceCx + 8; c++)
            if (grid[r] && grid[r][c] === T.ROUGH && ((c * 7 + r * 13) % 5) < 3)
                grid[r][c] = T.TREE;
    return {
        id: 'course_1',
        name: 'My Resort',
        biome: 'meadows',
        freshDefault: true, // first overworld visit routes to the creator
        cols, rows, border,
        grid,
        holes: [{
            id: 1, par: 4,
            tee: { x: entranceCx - 6, y: entranceR0 - 14 },
            pin: { x: entranceCx + 13, y: entranceR0 - 39 },
            waypoints: [{ x: entranceCx - 5, y: entranceR0 - 25 }]
        }],
        facilities: [], // future: { type, x, y, rot }
        scenery: []     // future: { type, x, y }
    };
}

// ---- Procedural island generator (Create Your Island) ----
// Seeded and fully deterministic: same params + seed = same island.
// Coastline is a radial profile of 6 sine harmonics (roundness pulls it
// toward a circle), sea fills the outside, a beach ring hugs the coast,
// and low-frequency value noise carves interior ponds and forests.
function makeIsland(params) {
    const p = Object.assign({
        seed: 2990, water: 0.35, hills: 0.5, trees: 0.6,
        rocks: 0.4, roundness: 0.6, grass: 0.7
    }, params || {});
    const cols = COURSE_COLS, rows = COURSE_ROWS;
    const frame = 2; // hard OOB frame so pan clamps stay sane
    const seed = p.seed | 0;
    const rand = (n) => {
        const a = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
        return a - Math.floor(a);
    };
    const harm = [];
    for (let k = 0; k < 6; k++) {
        harm.push({ a: rand(k + 1), ph: rand(k + 40) * Math.PI * 2 });
    }
    const ccx = cols / 2, ccy = rows / 2;
    const baseR = Math.min(cols, rows) / 2 - frame - 3;
    const coastR = (theta) => {
        let n = 0;
        for (let k = 0; k < 6; k++) {
            n += harm[k].a * Math.sin((k + 1) * theta + harm[k].ph) / (k + 1);
        }
        const wob = 1 + (n / 1.6) * (1 - p.roundness) * 0.9;
        return baseR * Math.max(0.35, wob);
    };
    const lat = (x, y) => rand(x * 731 + y * 1237);
    const s2 = (x, y, per) => {
        const gx = x / per, gy = y / per;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        return lat(x0, y0) * (1 - ux) * (1 - uy) + lat(x0 + 1, y0) * ux * (1 - uy)
             + lat(x0, y0 + 1) * (1 - ux) * uy + lat(x0 + 1, y0 + 1) * ux * uy;
    };
    const pondCut = 1 - p.water * 0.45;
    const grid = [];
    for (let r = 0; r < rows; r++) {
        grid[r] = [];
        for (let c = 0; c < cols; c++) {
            if (r < frame || r >= rows - frame || c < frame || c >= cols - frame) {
                grid[r][c] = T.WATER; // open sea to the map edge, no frame
                continue;
            }
            const dx = c - ccx, dy = r - ccy;
            const k = Math.sqrt(dx * dx + dy * dy) / coastR(Math.atan2(dy, dx));
            if (k >= 1) { grid[r][c] = T.WATER; continue; }      // open sea
            if (k > 0.93) { grid[r][c] = T.SAND; continue; }     // beach ring
            if (k < 0.8 && s2(c, r, 11) > pondCut) {             // ponds
                grid[r][c] = T.WATER;
                continue;
            }
            if (s2(c + 199, r + 71, 8) > 1 - p.trees * 0.5) {    // forests
                grid[r][c] = T.TREE;
                continue;
            }
            grid[r][c] = T.ROUGH;
        }
    }
    // Entrance: the starting property picks the gate's column — the
    // southernmost land in that parcel column carries the entrance
    const startParcel = (p.startParcel != null)
        ? p.startParcel : (PARCEL_ROWS - 1) * PARCEL_COLS + 1;
    const startColIdx = startParcel % PARCEL_COLS;
    const entC = Math.min(cols - frame - 4, Math.max(frame + 4,
        Math.round((startColIdx + 0.5) * cols / PARCEL_COLS)));
    let entR = rows - frame - 1;
    while (entR > ccy && grid[entR][entC] === T.WATER) entR--;
    entR -= 1; // one row inland of the beach
    for (let r = entR - 1; r <= entR + 1; r++)
        for (let c = entC - 2; c <= entC + 2; c++)
            if (grid[r] && grid[r][c] !== undefined) grid[r][c] = T.PATH;
    for (let r = entR - 12; r < entR - 1; r++)
        for (let c = entC - 1; c <= entC + 1; c++)
            if (grid[r] && grid[r][c] !== undefined) grid[r][c] = T.PATH;
    // Starter hole northwest of the walkway so day one has play running
    const paint = (c0, r0, c1, r1, t) => {
        for (let r = r0; r <= r1; r++)
            for (let c = c0; c <= c1; c++)
                if (grid[r] && grid[r][c] !== undefined && grid[r][c] !== T.OOB)
                    grid[r][c] = t;
    };
    paint(entC - 8, entR - 16, entC - 4, entR - 12, T.TEE);
    paint(entC - 10, entR - 34, entC - 2, entR - 16, T.FAIRWAY);
    paint(entC - 2, entR - 40, entC + 10, entR - 30, T.FAIRWAY);
    paint(entC + 10, entR - 42, entC + 16, entR - 36, T.GREEN);
    paint(entC + 2, entR - 30, entC + 7, entR - 26, T.SAND);
    paint(entC - 6, entR - 13, entC - 1, entR - 12, T.PATH);
    return {
        id: 'course_1',
        name: 'My Resort',
        biome: 'meadows',
        cols, rows,
        border: rows - entR,      // keeps the ENTRANCE marker on the pad
        grid,
        terrainSeed: seed,
        parcels: (() => {
            const pIdx = (c, r) => Math.min(PARCEL_ROWS - 1, Math.floor(r / (rows / PARCEL_ROWS)))
                * PARCEL_COLS + Math.min(PARCEL_COLS - 1, Math.floor(c / (cols / PARCEL_COLS)));
            return { owned: [...new Set([startParcel, pIdx(entC, entR),
                pIdx(entC, entR - 22)])], bought: 0 };
        })(),
        hillAmp: 0.4 + p.hills * 1.2,
        rockDensity: p.rocks,
        grassDensity: p.grass,
        islandParams: p,          // so the create screen can re-roll
        holes: [{
            id: 1, par: 4,
            tee: { x: entC - 6, y: entR - 14 },
            pin: { x: entC + 13, y: entR - 39 },
            waypoints: [{ x: entC - 5, y: entR - 25 }]
        }],
        facilities: [],
        scenery: []
    };
}

let worldCourse = loadData('course', null);
// Invalidate any saved course that predates the bounded-rectangle schema.
// These old saves were 100x100 open fields without a border — start fresh.
if (!worldCourse || worldCourse.cols !== COURSE_COLS || worldCourse.rows !== COURSE_ROWS) {
    worldCourse = makeStarterCourse();
}

// Build prices per decor type; erase refunds half. Terrain painting
// stays free — sculpting is the core fantasy, decor is the money sink.
const DECOR_COSTS = {
    bench: 25, flowers: 10, kiosk: 150, stall: 150, cart: 75,
    arch: 200, windmill: 300, lighthouse: 400, gazebo: 120, clubhouse: 500,
    statue: 250, grandstand: 350
};

// ---- Player-placeable decor ----
// Saves that predate the decor system get the old auto-dressed layout
// seeded as editable data, so nothing vanishes — it becomes movable.
function seedDefaultDecor(course) {
    const ec = Math.floor(course.cols / 2);
    const er = course.rows - course.border;
    const decor = [
        { t: 'arch', x: ec + 0.5, y: er - 1.2, rot: 0 },
        { t: 'clubhouse', x: ec - 8.5, y: er - 7.5, rot: Math.PI / 2 },
        { t: 'cart', x: ec + 4.2, y: er - 14.6, rot: -Math.PI / 3 },
        { t: 'bench', x: ec - 2.1, y: er - 5, rot: Math.PI / 2 },
        { t: 'bench', x: ec + 2.6, y: er - 7.5, rot: -Math.PI / 2 },
        { t: 'kiosk', x: ec - 4.6, y: er - 10.5, rot: Math.PI / 2 },
        { t: 'stall', x: ec + 4.9, y: er - 11.5, rot: -Math.PI / 2 },
        { t: 'flowers', x: ec - 2.2, y: er - 3.2, rot: 0 },
        { t: 'flowers', x: ec + 2.7, y: er - 3.6, rot: 0 },
        { t: 'flowers', x: ec + 2.7, y: er - 10.2, rot: 0 },
        { t: 'lighthouse', x: course.cols - 4.5, y: 3.5, rot: Math.PI }
    ];
    // Windmill on the first pond bank, mirroring the old auto-placement
    outer: for (let r = 2; r < course.rows - 2; r++) {
        for (let c = 2; c < course.cols - 2; c++) {
            if (course.grid[r][c] !== T.WATER) continue;
            if (course.grid[r][c + 1] !== T.WATER && course.grid[r][c + 2] !== T.WATER) {
                decor.push({ t: 'windmill', x: c + 2.6, y: r + 0.5, rot: -Math.PI / 2 });
                break outer;
            }
        }
    }
    return decor;
}
if (!worldCourse.decor) worldCourse.decor = seedDefaultDecor(worldCourse);
// Heights are derived (deterministic noise flattened by terrain type), so
// they are regenerated on load and after painting, never persisted.
function refreshWorldHeights() {
    worldCourse.heights = generateHeights(worldCourse);
}

// Sim -> design feedback (pillar 2): golfers who suffer out there pin a
// complaint to the map where it happened. Tap a pin to read it (which
// acknowledges + clears it); unread ones age out after ~3 game hours.
function addComplaint(c, r, holeId, text, kind) {
    worldCourse.complaints = worldCourse.complaints || [];
    worldCourse.complaints.push({ x: c, y: r, holeId: holeId, text: text,
        kind: kind || 'gripe',
        t: (typeof resort !== 'undefined' && resort) ? (resort.worldClock || 0) : 0 });
    if (worldCourse.complaints.length > 12) worldCourse.complaints.shift();
}

function saveWorldCourse() {
    // Strip the derived heights array before persisting — ~9,600 floats of
    // pure noise that regenerate identically on load.
    const { heights, ...persistable } = worldCourse;
    saveData('course', persistable);
}

function enterOverworld() {
    // A brand-new resort starts at Create Your Island (reference flow).
    // Backing out keeps the default island; the flag clears either way so
    // this only ever intercepts once.
    if (worldCourse.freshDefault && typeof startIslandCreator === 'function') {
        delete worldCourse.freshDefault;
        saveWorldCourse();
        startIslandCreator();
        return;
    }
    setState('overworld');
}

function stateEnterOverworld() {
    // owRosterOpen intentionally persists — peeking at Manage and coming
    // back shouldn't close the panel you were reading
    owRosterChip = null;
    owComplaintChip = null;
    owSelectedGolfer = null;
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
    // Decor stamps: tap to place, erase tool removes
    { id: 'dbench',      label: 'Bench',      icon: '\u{1FA91}', color: '#8d6e63', decor: 'bench' },
    { id: 'dflowers',    label: 'Flowers',    icon: '\u{1F490}', color: '#ec407a', decor: 'flowers' },
    { id: 'dkiosk',      label: 'Kiosk',      icon: '\u{1F3EA}', color: '#ef6c00', decor: 'kiosk' },
    { id: 'dstall',      label: 'Drinks',     icon: '\u{1F964}', color: '#29b6f6', decor: 'stall' },
    { id: 'dcart',       label: 'Cart',       icon: '\u{1F6FA}', color: '#9ccc65', decor: 'cart' },
    { id: 'darch',       label: 'Arch',       icon: '⛩️', color: '#a1887f', decor: 'arch' },
    { id: 'dwindmill',   label: 'Windmill',   icon: '\u{1F3E1}', color: '#ffb74d', decor: 'windmill' },
    { id: 'dlighthouse', label: 'Lighthouse', icon: '\u{1F5FC}', color: '#ef5350', decor: 'lighthouse' },
    { id: 'dgazebo',     label: 'Gazebo',     icon: '\u26FA', color: '#26a69a', decor: 'gazebo' },
    { id: 'dstatue',     label: 'Statue',     icon: '\u{1F3C6}', color: '#b8860b', decor: 'statue' },
    { id: 'dclubhouse',  label: 'Clubhouse',  icon: '\u{1F3DB}️', color: '#66bb6a', decor: 'clubhouse' },
    { id: 'dgrandstand', label: 'Grandstand', icon: '\u{1F3DF}️', color: '#3f7a4d', decor: 'grandstand' },
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
    { id: 'decor',   icon: '\u{1FA91}', label: 'DECOR',
      flyout: ['dbench', 'dflowers', 'dkiosk', 'dstall', 'dcart', 'darch',
               'dwindmill', 'dlighthouse', 'dgazebo', 'dstatue', 'dclubhouse', 'dgrandstand'] },
    { id: 'hole',    icon: '\u26F3',    label: 'HOLES' },
    { id: 'erase',   icon: '\u267B',    label: 'ERASE' },
    { id: 'size',    icon: null,         label: 'BRUSH', flyout: 'sizes' },
];
// Parent group of each armable tool (drives rail highlight state)
const OW_TOOL_PARENT = {
    hand: 'hand', fairway: 'surface', green: 'surface', rough: 'surface',
    sand: 'surface', water: 'nature', trees: 'nature', path: 'path', erase: 'erase',
    dbench: 'decor', dflowers: 'decor', dkiosk: 'decor', dstall: 'decor',
    dcart: 'decor', darch: 'decor', dwindmill: 'decor', dlighthouse: 'decor',
    dclubhouse: 'decor', dgazebo: 'decor', dstatue: 'decor', dgrandstand: 'decor'
};
let owRailOpen = false;   // build rail expanded?
let owRosterOpen = false; // golfer roster panel visible?
let owSelectedGolfer = null; // name of golfer whose inspector is open
let owFollowGolfer = false;  // camera tracks the selected golfer
let owFollowRect = null;
let gameSpeed = 1;        // 0 = paused, 1 = normal, 4 = fast-forward
let owSpeedRects = null;  // screen rects of the speed strip (set each draw)
let owRosterChip = null;  // screen rect of the roster chip (set each draw)
let owComplaintChip = null; // screen rect of the top-bar complaint badge
let owSelectedFacility = null; // decor index of the inspected kiosk/stall
let owFacilityCardRect = null;
let manageBiomeRects = []; // biome chips on the Manage screen

// ---- Birds-eye minimap (bottom-left, toggled, persisted) ----
let owMinimapOn = loadData('minimapOn', false);
let owMiniCanvas = null, owMiniKey = null;
let owMiniLamps = []; // lamp cells cached with the canvas rebuild
let owMiniRect = null, owMiniBtnRect = null;
let owMuteBtnRect = null;

// The grid renders to an offscreen canvas at 2px/cell, rebuilt only
// when terrain edits (terrainRev) or the biome change — never per frame
function ensureMiniCanvas() {
    const key = (worldCourse.terrainRev || 0) + ':' + (worldCourse.biome || '');
    if (owMiniCanvas && owMiniKey === key) return;
    owMiniKey = key;
    if (!owMiniCanvas) owMiniCanvas = document.createElement('canvas');
    owMiniCanvas.width = worldCourse.cols * 2;
    owMiniCanvas.height = worldCourse.rows * 2;
    const g = owMiniCanvas.getContext('2d');
    const bio = (typeof BIOME_ALBEDO !== 'undefined'
        && BIOME_ALBEDO[worldCourse.biome]) || {};
    const base = (typeof ALBEDO_COLORS !== 'undefined')
        ? ALBEDO_COLORS.base : {};
    owMiniLamps = [];
    for (let r = 0; r < worldCourse.rows; r++) {
        for (let c = 0; c < worldCourse.cols; c++) {
            const t = worldCourse.grid[r][c];
            g.fillStyle = bio[t] || base[t] || '#2c6a31';
            g.fillRect(c * 2, r * 2, 2, 2);
            // Mirror the 3D lamp formula so night dots match real lamps
            if (t === T.PATH && (c * 7 + r * 13) % 9 === 0
                && owMiniLamps.length < 60) {
                owMiniLamps.push({ c, r });
            }
        }
    }
}
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
// ---- Property parcels (reference-style land sections) ----
// The island is a 4x3 grid of parcels. New islands start with the two
// entrance parcels; veteran saves own everything (no rug-pulls). Each
// additional section costs more than the last.
const PARCEL_COLS = 4, PARCEL_ROWS = 3;
function ensureParcels() {
    if (!worldCourse.parcels) {
        worldCourse.parcels = {
            owned: Array.from({ length: PARCEL_COLS * PARCEL_ROWS }, (_, i) => i),
            bought: 0
        };
    }
    return worldCourse.parcels;
}
function parcelIndexAt(c, r) {
    const pc = Math.min(PARCEL_COLS - 1, Math.floor(c / (worldCourse.cols / PARCEL_COLS)));
    const pr = Math.min(PARCEL_ROWS - 1, Math.floor(r / (worldCourse.rows / PARCEL_ROWS)));
    return pr * PARCEL_COLS + pc;
}
function parcelOwned(c, r) {
    return ensureParcels().owned.includes(parcelIndexAt(c, r));
}
function parcelPrice() {
    // Land is the pacing gate (GolfTopia-style): measured early income
    // is ~$100-120/game-hour with plot-one built out (re-measured after
    // clubhouse upkeep landed), so $750 puts the second plot ~6-7 real
    // minutes into running the resort, and 1.7x growth keeps later
    // plots pressing
    return Math.round(750 * Math.pow(1.7, ensureParcels().bought || 0));
}
let owBalanceRect = null;   // balance chip rect (tap -> finances)
let owFinancesRect = null;  // open finances panel rect
let owFinancesOpen = false;
let owWeatherRect = null;  // weather chip rect (tap for forecast)
let owWeatherPanelRect = null;
let owWeatherOpen = false;
let owMarkerTap = null;    // { id, t } for double-tap flyover detection
let owRecordLineRect = null; // hole-card record line (tap -> holder)
let owNameRect = null;     // resort name rect in the top bar (tap to rename)
let owDecorDrag = null;    // { i, moved } while repositioning a decor item
let owBuyRect = null;  // screen rect of the buy chip
let owBuyOffer = null; // { parcel, t0 } — buy chip shown after a blocked tap
function offerParcel(c, r) {
    owBuyOffer = { parcel: parcelIndexAt(c, r), t0: performance.now() };
}
function buyOfferedParcel() {
    const p = ensureParcels();
    const price = parcelPrice();
    if (resort.coins < price) {
        notify('Need $' + price + ' for that property');
        return;
    }
    resort.coins -= price;
    if (typeof playChime === 'function') playChime();
    p.owned.push(owBuyOffer.parcel);
    p.bought = (p.bought || 0) + 1;
    // New ground deserves a moment: fly the camera to the fresh plot
    // and burst fireworks over it (a land deal is a milestone here)
    {
        const pc = owBuyOffer.parcel % PARCEL_COLS;
        const pr = Math.floor(owBuyOffer.parcel / PARCEL_COLS);
        const wx = (pc + 0.5) * worldCourse.cols / PARCEL_COLS * CELL;
        const wz = (pr + 0.5) * worldCourse.rows / PARCEL_ROWS * CELL;
        if (typeof setCameraOrbit === 'function') {
            setCameraOrbit(wx, wz, Math.max(1100,
                (typeof cam3dDistance !== 'undefined') ? cam3dDistance : 1100),
                null, null);
        }
        if (typeof spawnFirework3D === 'function') {
            spawnFirework3D(wx - 80, wz - 50, 0xffd24a);
            spawnFirework3D(wx + 70, wz + 40, 0x3adbe8);
            spawnFirework3D(wx, wz - 90, 0x8be06a);
        }
    }
    owBuyOffer = null;
    saveResort();
    saveWorldCourse();
    notify('\u{1F4CB} Property purchased! The resort grows');
}

// Human names for the tile tooltip while painting
const T_NAMES = {};
for (const k in T) T_NAMES[T[k]] = k.charAt(0) + k.slice(1).toLowerCase();

function paintBrushAt(cc, cr, size, terrain) {
    const half = Math.floor(size / 2);
    const changed = [];
    const border = worldCourse.border || 0;
    for (let dr = -half; dr <= half; dr++) {
        for (let dc = -half; dc <= half; dc++) {
            const r = cr + dr, c = cc + dc;
            if (r < border || r >= worldCourse.rows - border) continue;
            if (c < border || c >= worldCourse.cols - border) continue;
            if (!parcelOwned(c, r)) { offerParcel(c, r); continue; }
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
    if (changed.length) {
        owNeedsRebuild = true;
        // Invalidate sim-measured difficulty ratings — terrain changed
        worldCourse.terrainRev = (worldCourse.terrainRev || 0) + 1;
    }
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
        name: holeRec.name || ('Hole ' + holeRec.id),
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
    owRosterOpen = false; // the wizard owns the top of the screen
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

// Design difficulty 1-5, derived from what the route actually crosses:
// hazard density in a corridor along the polyline, green size, and raw
// length. Pure grid analysis — no physics fork.
// Resort star rating: holes + variety + decor + vendors + golfer mood.
// 0-5 in half-star steps; shown on the Manage screen.
// Fireworks over the entrance for landmark celebrations
// The daily tournament takes its name from the island's biome — links
// resorts host The Island Open, autumn ones the Fall Classic
function tourneyTitle() {
    const b = worldCourse.biome || 'meadows';
    return b === 'links' ? 'The Island Open'
        : b === 'autumn' ? 'The Fall Classic'
        : 'The Meadows Cup';
}

function celebrateFireworks() {
    if (typeof spawnFirework3D !== 'function') return;
    const ex = (Math.floor(worldCourse.cols / 2) + 0.5) * CELL;
    const ez = (worldCourse.rows - (worldCourse.border || 4) + 0.5) * CELL;
    spawnFirework3D(ex - 90, ez - 60, 0xffd24a);
    spawnFirework3D(ex + 70, ez - 110, 0xff6a5a);
    spawnFirework3D(ex, ez - 30, 0x3adbe8);
}

function computeCourseRating() {
    let r = Math.min(2.5, worldCourse.holes.length * 0.4);
    const diffs = new Set(worldCourse.holes.map(h => holeDifficulty(h)));
    r += Math.min(1, diffs.size * 0.35);
    const decorVal = (worldCourse.decor || []).reduce(
        (s, d) => s + (DECOR_COSTS[d.t] || 0), 0);
    r += Math.min(1, decorVal / 1000);
    if ((worldCourse.decor || []).some(d => d.t === 'kiosk' || d.t === 'stall')) r += 0.5;
    // Clubhouse level lifts the resort's prestige (reference-style):
    // each upgrade tier is worth a quarter star
    if (resort.amenities) {
        if (resort.amenities.clubhouse2) r += 0.25;
        if (resort.amenities.clubhouse3) r += 0.25;
    }
    if (typeof npcStates !== 'undefined' && npcStates.length) {
        const moods = npcStates.filter(s => s.mood != null).map(s => s.mood);
        if (moods.length) {
            r += Math.min(1, (moods.reduce((a, b) => a + b, 0) / moods.length) / 100);
        }
    }
    return Math.max(0, Math.min(5, Math.round(r * 2) / 2));
}

// Sim-measured stars: a background queue plays each hole ~6 times with
// an average golfer and rates it by strokes over par. The corridor
// heuristic answers instantly until a fresh measurement lands (and
// whenever terrain edits invalidate one). Draw paths never simulate.
function queueSimRating(rec) {
    window.__simRateQueue = window.__simRateQueue || [];
    if (!window.__simRateQueue.includes(rec.id)) window.__simRateQueue.push(rec.id);
}
function drainSimRating() {
    const q = window.__simRateQueue;
    if (!q || !q.length) return;
    const id = q.shift();
    const rec = worldCourse.holes.find(h => h.id === id);
    if (!rec) return;
    try {
        let total = 0;
        const runs = 6;
        for (let k = 0; k < runs; k++) {
            total += simulateWorldHoleRound(rec, 2.5).strokes;
        }
        // Computed par (M2): par is the expert standard, ~0.6 under the
        // average golfer's measured mean, clamped to the 3-5 range
        rec.par = Math.max(3, Math.min(5, Math.round(total / runs - 0.6)));
        const over = total / runs - rec.par;
        rec.simAvg = +(total / runs).toFixed(1); // measured mean, for the card
        rec.simDiff = {
            rev: worldCourse.terrainRev || 0,
            stars: Math.max(1, Math.min(5, Math.round(1 + over * 1.4)))
        };
        saveWorldCourse();
    } catch (e) {}
}

function holeDifficulty(rec) {
    if (rec.simDiff) {
        if (rec.simDiff.rev === (worldCourse.terrainRev || 0)) {
            return rec.simDiff.stars;
        }
        queueSimRating(rec); // stale — remeasure in the background
    } else if (rec.id != null && worldCourse.holes
        && worldCourse.holes.some(h => h.id === rec.id)) {
        queueSimRating(rec);
    }
    return holeDifficultyHeuristic(rec);
}

function holeDifficultyHeuristic(rec) {
    if (!rec || !rec.tee || !rec.pin) return 1;
    const pts = [rec.tee, ...(rec.waypoints || []), rec.pin];
    let samples = 0, hazard = 0;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(2, Math.ceil(segLen * 2));
        for (let s = 0; s <= steps; s++) {
            const cx = Math.round(a.x + (b.x - a.x) * (s / steps));
            const cy = Math.round(a.y + (b.y - a.y) * (s / steps));
            // 2-cell corridor around the line
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const r = cy + dy, c = cx + dx;
                    if (r < 0 || r >= worldCourse.rows || c < 0 || c >= worldCourse.cols) continue;
                    const t = worldCourse.grid[r][c];
                    samples++;
                    if (t === T.WATER) hazard += 1.6;
                    else if (t === T.SAND) hazard += 1.0;
                    else if (t === T.TREE) hazard += 0.8;
                    else if (t === T.ROUGH || t === T.GRASS) hazard += 0.25;
                }
            }
        }
    }
    const hazardFrac = samples ? hazard / samples : 0;
    // Small greens putt harder
    let greenCells = 0;
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            const r = rec.pin.y + dy, c = rec.pin.x + dx;
            if (r >= 0 && r < worldCourse.rows && c >= 0 && c < worldCourse.cols
                && worldCourse.grid[r][c] === T.GREEN) greenCells++;
        }
    }
    const yds = polylineLengthYards(rec);
    let score = 1
        + Math.min(1.5, yds / 380)          // length pressure
        + hazardFrac * 3.2                   // corridor danger
        + Math.max(0, (20 - greenCells)) / 14; // tiny target
    return Math.max(1, Math.min(5, Math.round(score)));
}

// Par labels on the island's compressed scale (1 cell = 2 yds, one
// land parcel spans ~60x53 yds). Tuned so the wizard's instant label
// agrees with what the physics sim later measures: plot-one holes are
// honest par 3s, a real par 4 needs the room a second parcel buys.
// The background sim still re-rates from measured strokes afterwards.
function parFromYards(yds) {
    if (yds < 95) return 3;
    if (yds < 160) return 4;
    return 5;
}

function finalizeHole() {
    {
        const w = holeWizard;
        const pts = [w.tee, ...(w.waypoints || []), w.pin].filter(Boolean);
        for (const pt of pts) {
            if (!parcelOwned(pt.x, pt.y)) {
                notify('\u{1F512} That land is not yours yet \u2014 buy the property first');
                offerParcel(pt.x, pt.y);
                return;
            }
        }
    }
    if (!holeWizard || !holeWizard.tee || !holeWizard.pin) return;
    const yds = polylineLengthYards(holeWizard);
    const par = holeWizard.simParEst || parFromYards(yds);
    const recNew = {
        id: holeWizard.holeId,
        par,
        tee: { x: holeWizard.tee.x, y: holeWizard.tee.y },
        pin: { x: holeWizard.pin.x, y: holeWizard.pin.y },
        waypoints: holeWizard.waypoints.map(w => ({ x: w.x, y: w.y }))
    };
    if (holeWizard.editing != null) {
        const idx = worldCourse.holes.findIndex(h => h.id === holeWizard.editing);
        if (idx >= 0) {
            // Preserve name + open state; the reshaped line re-measures
            recNew.name = worldCourse.holes[idx].name;
            recNew.open = worldCourse.holes[idx].open;
            worldCourse.holes[idx] = recNew;
        } else {
            worldCourse.holes.push(recNew);
        }
    } else {
        worldCourse.holes.push(recNew);
    }
    saveWorldCourse();
    // The confirm tap's touch-end consumes this: arcs, tee signs, and
    // route golfers for the new line appear immediately instead of
    // waiting for the next unrelated terrain edit
    owNeedsRebuild = true;
    notify('Hole ' + holeWizard.holeId
        + (holeWizard.editing != null ? ' reshaped' : ' created')
        + ' \u2022 Par ' + par + ' \u2022 ' + Math.round(yds) + 'y');
    holeWizard = null;
}

// What the resort "deserves": holes draw players, decor draws
// hangers-on, amenities hold their boost permanently. Membership
// drifts toward this — shown on the Manage screen as capacity.
function memberCapacity() {
    const amenityMembers = AMENITIES.reduce((sum, a) =>
        sum + (resort.amenities && resort.amenities[a.id] ? a.memberBoost : 0), 0);
    return 5 + worldCourse.holes.length * 4 + amenityMembers
        + Math.floor((worldCourse.decor || []).reduce(
            (s, d) => s + (DECOR_COSTS[d.t] || 0), 0) / 100);
}

const AMENITIES = [
    { id: 'clubhouse', name: 'Clubhouse', icon: '\u{1F3DB}\uFE0F', cost: 200, memberBoost: 10,
      upkeep: 5, desc: 'Somewhere for golfers to relax after a round.' },
    { id: 'clubhouse2', name: 'Grand Clubhouse', icon: '\u{1F3E8}', cost: 1500,
      memberBoost: 20, feeBoost: 0.1, requires: 'clubhouse', upkeep: 15,
      desc: 'Upgrade: pro shop + restaurant. Green fees +10%.' },
    { id: 'clubhouse3', name: 'Resort Lodge', icon: '\u{1F3F0}', cost: 6000,
      memberBoost: 40, feeBoost: 0.2, requires: 'clubhouse2', upkeep: 35,
      desc: 'Upgrade: spa, suites, prestige. Green fees +20% more.' }
];

// Clubhouse level lifts every green fee collected (multiplier stacks)
function clubhouseFeeMul() {
    return 1 + (resort.amenities.clubhouse2 ? 0.1 : 0)
             + (resort.amenities.clubhouse3 ? 0.2 : 0);
}

function saveResort() { saveData('resort', resort); }

function coinsForScore(par, strokes) {
    // Payouts sit inside the fee economy instead of scaling with
    // membership — the old base of 30 + 2/member let a big resort's
    // owner farm ~\$300 per Test Play hole, dwarfing all real income
    const under = Math.max(0, par - strokes);
    const over = Math.max(0, strokes - par);
    if (worldPlaytest) {
        // Owner testing their own course: pays like the green fee it is
        const rec = (worldCourse.holes || []).find(h => currentHole
            && h.tee && currentHole.tee
            && h.tee.x === currentHole.tee.x && h.tee.y === currentHole.tee.y);
        const fee = 3 + 2 * (rec ? holeDifficulty(rec) : 2);
        return fee * 2 + under * 8;
    }
    // Away rounds (career/custom): a score-based tour prize
    return Math.max(6, 18 + under * 14 - over * 4);
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
        // Pillar 5: the exhibition plays the REAL physics per hole (this
        // was the last statistical dice-roll fork). Closed holes sit out;
        // the dice survive only as a fallback if a sim throws.
        if (hole.open === false) continue;
        let r;
        try {
            const sim = simulateWorldHoleRound(hole, 2.5);
            r = { strokes: sim.strokes, par: hole.par || 4 };
        } catch (e) {
            r = simulateHole(hole.par);
        }
        totalStrokes += r.strokes;
        totalPar += r.par;
        // Exhibition payout aligned with the green-fee economy: double
        // the hole's fee, plus a birdie/eagle bonus. The old per-score
        // formula printed ~6x what ambient golfers earn.
        const fee = 3 + 2 * holeDifficulty(hole);
        const under = Math.max(0, r.par - r.strokes);
        coins += fee * 2 + under * 5;
    }
    return { totalStrokes, totalPar, coins };
}

function buyAmenity(id) {
    const a = AMENITIES.find(x => x.id === id);
    if (!a) return;
    if (resort.amenities[id]) return;
    if (a.requires && !resort.amenities[a.requires]) {
        const req = AMENITIES.find(x => x.id === a.requires);
        notify('Build the ' + (req ? req.name : 'previous tier') + ' first');
        return;
    }
    if (resort.coins < a.cost) { notify('Not enough coins'); return; }
    resort.coins -= a.cost;
    resort.amenities[id] = true;
    resort.members += a.memberBoost;
    saveResort();
    // Clubhouse upgrades change the building itself — rebuild the live
    // scene so the bigger clubhouse shows immediately
    if (a.requires && scene3dReady) {
        buildTerrain3D(worldCourse, { distantScenery: false });
    }
    notify('Built ' + a.name + '! +' + a.memberBoost + ' members');
}

// Passive income: members * 0.03 coins/sec — membership dues are a
// gentle drip; the real money is fees, stalls, and tournaments.
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
            const income = Math.floor(resort.members * elapsed * 0.03);
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
let _worldStatsDirty = false;

// ---- Finances ledger: daily income/expenses like the reference ----
function ensureLedger() {
    if (!resort.ledger) {
        resort.ledger = { day: Math.floor((resort.worldClock || 0) / 1440),
                          income: 0, expenses: 0, prevIncome: 0, prevExpenses: 0 };
    }
    return resort.ledger;
}
function ledgerIncome(amt) {
    if (amt > 0) ensureLedger().income += amt;
}
function dailyUpkeep() {
    const holeCost = worldCourse.holes.length * 25;
    const decorCost = Math.floor((worldCourse.decor || []).reduce(
        (s, d) => s + (DECOR_COSTS[d.t] || 0), 0) * 0.04);
    // A grander clubhouse costs more to run each day
    const amenityCost = AMENITIES.reduce((sum, a) =>
        sum + (resort.amenities && resort.amenities[a.id] ? (a.upkeep || 0) : 0), 0);
    return { holes: holeCost, decor: decorCost, amenities: amenityCost,
             total: holeCost + decorCost + amenityCost };
}

function tickWorld(dt) {
    resort.worldClock = (resort.worldClock || 0) + dt;
    // Complaints age out after ~3 in-game hours (checked every 10 min)
    if (worldCourse.complaints && worldCourse.complaints.length
        && resort.worldClock - (window.__cmpTick || 0) > 10) {
        window.__cmpTick = resort.worldClock;
        const cut = resort.worldClock - 180;
        const keep = worldCourse.complaints.filter(c => c.t > cut);
        if (keep.length !== worldCourse.complaints.length) {
            worldCourse.complaints = keep;
        }
    }
    // 9 PM: announce the close once per day and teach the night skip
    {
        const dayC = Math.floor((resort.worldClock || 0) / 1440);
        const minC = ((resort.worldClock % 1440) + 1440) % 1440;
        if (minC >= 21 * 60 && window.__closeNoteDay !== dayC
            && state === 'overworld') {
            window.__closeNoteDay = dayC;
            notify('\u{1F319} Course closed for the night \u2014 the roster panel can skip to morning');
        }
    }
    // 6 AM: fresh tee sheet — golfers who stormed off yesterday come
    // back each morning (roster reseeds via the leak-free rebuild, only
    // when someone actually left)
    {
        const day6 = Math.floor(((resort.worldClock || 0) - 360) / 1440);
        if (window.__teeSheetDay == null) window.__teeSheetDay = day6;
        if (day6 > window.__teeSheetDay) {
            window.__teeSheetDay = day6;
            if (state === 'overworld' && scene3dReady
                && typeof npcStates !== 'undefined'
                && npcStates.some(n => n.gone)) {
                buildTerrain3D(worldCourse, { distantScenery: false });
                notify('\u26C5 Fresh tee sheet \u2014 everyone\u2019s back for a new day');
            }
        }
    }
    // Autosave: progress accrues while the player just watches (fees,
    // members, records, careers) but saves only fired on interactions —
    // a killed tab lost everything since the last tap. Every ~30 game
    // minutes the world persists itself.
    if (window.__autosaveAt == null) window.__autosaveAt = resort.worldClock;
    if (Math.abs(resort.worldClock - window.__autosaveAt) > 30) {
        window.__autosaveAt = resort.worldClock;
        // Everything up to this instant is banked live — stamp the tick
        // clock so the next boot's offline catch-up doesn't pay again
        resort.lastTickMs = Date.now();
        saveResort();
        saveWorldCourse();
    }
    // Expansion nudge: the first time the bank covers the next parcel,
    // invite the player onward (once per tier, per session)
    if (state === 'overworld' && worldCourse.parcels) {
        const pn = ensureParcels();
        if (pn.owned.length < PARCEL_COLS * PARCEL_ROWS
            && resort.coins >= parcelPrice()
            && (window.__landNudge == null
                || window.__landNudge < pn.owned.length + 1)) {
            window.__landNudge = pn.owned.length + 1;
            notify('\u{1F3DE} You can afford new land! Tap past the dashed border to buy ($' + parcelPrice() + ')');
            if (typeof playChime === 'function') playChime();
        }
    }
    // Drain one difficulty measurement per second (6 sims each)
    if (state === 'overworld'
        && performance.now() - (window.__lastRateDrain || 0) > 1000) {
        window.__lastRateDrain = performance.now();
        drainSimRating();
    }
    // Drain one queued ambient round-sim per half-second (each costs
    // ~1-2k physics steps; rounds take 45s+, so this never backlogs)
    if (state === 'overworld' && typeof npcStates !== 'undefined'
        && performance.now() - (window.__lastSimDrain || 0) > 500) {
        const q = npcStates.find(n => n.pendingSim && n.name);
        if (q) {
            window.__lastSimDrain = performance.now();
            q.pendingSim = false;
            const rec2 = worldCourse.holes.find(h => h.id === q.holeId);
            if (rec2) {
                const sk2 = ((q.driverSkill || 2) + (q.putterSkill || 2)
                    + (q.recoverySkill || 2)) / 3;
                try {
                    const tr2 = [];
                    q.simResult = simulateWorldHoleRound(rec2, sk2, tr2);
                    const sp2 = tr2.find(p => p.splash);
                    if (q.simResult && sp2) {
                        q.simResult.splashAt = { x: sp2.x, y: sp2.y };
                    }
                } catch (e) {
                    q.simResult = null;
                }
            }
        }
    }
    // Green fees: ambient golfers holing out pay per-hole fees scaled by
    // difficulty (the renderer accumulates the dollar amounts)
    if (window.__golfFees) {
        // Clubhouse tiers lift what the resort collects per fee
        const feeTake = Math.round(window.__golfFees * clubhouseFeeMul());
        resort.coins += feeTake;
        resort.feesEarned = (resort.feesEarned || 0) + feeTake;
        ledgerIncome(feeTake);
        window.__golfFees = 0;
        // Track the tip share separately for the finance panel
        if (window.__tipFees) {
            resort.tipsEarned = (resort.tipsEarned || 0)
                + Math.round(window.__tipFees * clubhouseFeeMul());
            window.__tipFees = 0;
        }
    }
    // Day rollover: archive today's books, charge the new day's upkeep
    {
        const led = ensureLedger();
        const today = Math.floor((resort.worldClock || 0) / 1440);
        if (led.day !== today) {
            led.prevIncome = led.income;
            led.prevExpenses = led.expenses;
            led.income = 0;
            led.expenses = 0;
            led.day = today;
            // Vendors start the day with fresh books
            for (const d of (worldCourse.decor || [])) {
                if (d.salesToday || d.revToday) { d.salesToday = 0; d.revToday = 0; }
            }
            const up = dailyUpkeep();
            const charged = Math.min(resort.coins, up.total);
            resort.coins -= charged;
            led.expenses += charged;
            if (up.total > 0) {
                notify('\u{1F9FE} Daily upkeep: -$' + charged
                    + '  (holes $' + up.holes + ' \u2022 decor $' + up.decor + ')');
            }
            // Anniversaries: the resort's journey has birthdays with gifts
            const dayNum = today + 1;
            const ANNIV = { 7: ['One week', 150], 30: ['One month', 500],
                            100: ['100 days', 1500], 365: ['One YEAR', 5000] };
            if (ANNIV[dayNum] && (resort.dayMilestone || 0) < dayNum) {
                resort.dayMilestone = dayNum;
                const [label, gift] = ANNIV[dayNum];
                resort.coins += gift;
                ledgerIncome(gift);
                notify('\u{1F382} ' + label + ' of ' + worldCourse.name
                    + '! Members chip in $' + gift);
                if (typeof playFanfare === 'function') playFanfare();
                celebrateFireworks();
            }
        }
    }
    if (window.__stallSales) {
        resort.stallSales = (resort.stallSales || 0) + window.__stallSales;
        window.__stallSales = 0;
    }
    // Daily tournament: noon to 3 PM, every finished round counts toward
    // the leaderboard (score relative to par so mixed holes compare fairly)
    const minsOfDay = Math.floor((resort.worldClock || 0) % 1440);
    const tourneyActive = minsOfDay >= 720 && minsOfDay < 900
        && worldCourse.holes.length > 0;
    if (tourneyActive && !window.__tourney) {
        window.__tourney = { board: {} };
        notify('\u{1F3C6} ' + tourneyTitle() + ' teed off! Runs noon\u20133 PM');
    }
    // Per-hole play stats: fold finished ambient rounds into the course
    // record so the hole inspector can show how each hole really plays
    if (window.__holeOuts && window.__holeOuts.length) {
        worldCourse.holeStats = worldCourse.holeStats || {};
        for (const ho of window.__holeOuts) {
            const st = worldCourse.holeStats[ho.holeId]
                || (worldCourse.holeStats[ho.holeId] = { n: 0, sum: 0, sub: 0 });
            st.n++;
            st.sum += ho.score;
            if (ho.score < ho.par) st.sub++; // rounds under par
            st.recent = st.recent || [];
            st.recent.push(ho.score - ho.par); // sparkline history
            if (st.recent.length > 12) st.recent.shift();
            if (ho.name && (st.best == null || ho.score < st.best)) {
                const hadRecord = st.best != null && st.n >= 5;
                const prevBy = st.bestBy;
                st.best = ho.score;   // course record for this hole
                st.bestBy = ho.name;
                // A standing record falling is an event worth celebrating
                if (hadRecord) {
                    // Rivalry: the dethroned golfer takes it personally, the
                    // new holder savors it — both react in their thought logs
                    if (typeof npcStates !== 'undefined' && typeof golferThink === 'function') {
                        const loser = npcStates.find(n => n.name === prevBy);
                        const winner = npcStates.find(n => n.name === ho.name);
                        if (loser && prevBy !== ho.name) {
                            golferThink(loser, ho.name.split(' ')[0] + ' took MY record!', -8);
                        }
                        if (winner) {
                            golferThink(winner, 'Course record \u2014 mine now!', 12);
                        }
                    }
                    const rec = worldCourse.holes.find(h => h.id === ho.holeId);
                    notify('\u{1F3C5} COURSE RECORD! ' + ho.name + ' shoots '
                        + ho.score + ' on ' + ((rec && rec.name) || ('Hole ' + ho.holeId)));
                    if (typeof playFanfare === 'function') playFanfare();
                    if (rec) {
                        (window.__scorePopups = window.__scorePopups || []).push({
                            x: (rec.pin.x + 0.5) * CELL, z: (rec.pin.y + 0.5) * CELL,
                            t0: performance.now(), txt: '\u{1F3C5} RECORD!',
                            col: '#ffd24a', name: ho.name, stack: 1
                        });
                        // Fireworks burst right over the record pin
                        if (typeof spawnFirework3D === 'function') {
                            const fpx = (rec.pin.x + 0.5) * CELL;
                            const fpz = (rec.pin.y + 0.5) * CELL;
                            spawnFirework3D(fpx - 60, fpz - 40, 0xffd24a);
                            spawnFirework3D(fpx + 55, fpz + 30, 0xff6a5a);
                            spawnFirework3D(fpx, fpz - 80, 0x3adbe8);
                        }
                    }
                }
            }
            if (window.__tourney && ho.name) {
                const tb = window.__tourney.board[ho.name]
                    || (window.__tourney.board[ho.name] = { n: 0, rel: 0 });
                tb.n++;
                tb.rel += ho.score - ho.par;
            }
            // Lifetime careers: rounds played and best score, per name,
            // persisted with the course
            if (ho.name) {
                worldCourse.golferCareers = worldCourse.golferCareers || {};
                const car = worldCourse.golferCareers[ho.name]
                    || (worldCourse.golferCareers[ho.name] = { rounds: 0, best: null });
                car.rounds++;
                if (car.best == null || ho.score < car.best) car.best = ho.score;
            }
        }
        window.__holeOuts = [];
        _worldStatsDirty = true;
    }
    if (!tourneyActive && window.__tourney) {
        // Award ceremony: best total-to-par with at least 2 rounds (falls
        // back to anyone) — winner's crowd spends a purse at the resort
        const entries = Object.entries(window.__tourney.board);
        window.__tourney = null;
        const qualified = entries.filter(e => e[1].n >= 2);
        const pool = qualified.length ? qualified : entries;
        if (!pool.length) resort.tourneyStreak = 0; // a dead event cools off
        if (pool.length) {
            pool.sort((a, b) => (a[1].rel / a[1].n) - (b[1].rel / b[1].n));
            const name = pool[0][0], tb = pool[0][1];
            // Purse scales with reputation AND momentum: each consecutive
            // hosted day grows the gallery's spend 8% (caps at +80%)
            resort.tourneyStreak = (resort.tourneyStreak || 0) + 1;
            const streakMul = 1 + Math.min(10, resort.tourneyStreak - 1) * 0.08;
            const purse = Math.round((40 + 2 * (resort.members || 0))
                * (0.6 + computeCourseRating() * 0.2) * streakMul);
            resort.coins += purse;
            resort.purseEarned = (resort.purseEarned || 0) + purse;
            ledgerIncome(purse);
            const relAvg = tb.rel / tb.n;
            const relTxt = (relAvg <= 0 ? '' : '+') + relAvg.toFixed(1);
            resort.lastTourney = {
                winner: name, rel: relTxt, rounds: tb.n, purse: purse,
                title: tourneyTitle(),
                day: Math.floor((resort.worldClock || 0) / 1440) + 1
            };
            resort.tourneyHistory = resort.tourneyHistory || [];
            resort.tourneyHistory.unshift(resort.lastTourney);
            if (resort.tourneyHistory.length > 5) resort.tourneyHistory.pop();
            notify('\u{1F3C6} ' + name + ' wins ' + tourneyTitle() + ' ('
                + relTxt + ' avg)! Gallery spends $' + purse);
            if (typeof playFanfare === 'function') playFanfare();
            // Your title gets the fireworks (there's no NPC to hop for you)
            if (name === 'You') celebrateFireworks();
            // The champion celebrates on the spot — hop, glow, and a
            // proud thought for the record
            if (typeof npcStates !== 'undefined') {
                const champ = npcStates.find(n => n.name === name);
                if (champ) {
                    champ.greet = 3;
                    if (typeof golferThink === 'function') {
                        golferThink(champ, "I'm the champion!", 18);
                    }
                    if (typeof spawnSwingFlash3D === 'function') {
                        const gy = 14;
                        spawnSwingFlash3D(champ.x, gy, champ.z);
                    }
                    (window.__scorePopups = window.__scorePopups || []).push({
                        x: champ.x, z: champ.z, t0: performance.now(),
                        txt: '\u{1F3C6} CHAMPION!', col: '#ffd24a',
                        name: name, stack: 0
                    });
                }
            }
        }
    }
    // Membership drifts toward what the resort deserves: holes draw
    // players, decor investment draws hangers-on. One member per game
    // minute so growth feels earned, not instant.
    const memberTarget = memberCapacity();
    if (resort.__memTick == null) resort.__memTick = resort.worldClock;
    if (resort.worldClock - resort.__memTick > 60) {
        resort.__memTick = resort.worldClock;
        if (resort.members < memberTarget) resort.members++;
        else if (resort.members > memberTarget) resort.members--;
        // Milestone celebrations: fanfare + a golden burst at the gate
        const MILESTONES = [25, 50, 100, 200, 400];
        if (MILESTONES.includes(resort.members)
            && (resort.memMilestone || 0) < resort.members) {
            resort.memMilestone = resort.members;
            notify('\u{1F389} ' + resort.members + ' members! The resort is thriving');
            if (typeof playFanfare === 'function') playFanfare();
            const ex = (Math.floor(worldCourse.cols / 2) + 0.5) * CELL;
            const ez = (worldCourse.rows - (worldCourse.border || 4) + 0.5) * CELL;
            (window.__scorePopups = window.__scorePopups || []).push({
                x: ex, z: ez, t0: performance.now(),
                txt: '\u{1F389} ' + resort.members + ' MEMBERS!',
                col: '#ffd24a', name: 'Welcome to the club', stack: 0
            });
        }
    }
    resort.coinsFrac = (resort.coinsFrac || 0) + resort.members * 0.03 * dt;
    if (resort.coinsFrac >= 1) {
        const whole = Math.floor(resort.coinsFrac);
        resort.coins += whole;
        resort.coinsFrac -= whole;
        ledgerIncome(whole);
    }
    resort.lastTickMs = Date.now();
    // Persist at a gentle cadence so closing the app rarely loses progress
    _worldSaveAcc += dt;
    if (_worldSaveAcc >= 10) {
        _worldSaveAcc = 0;
        saveResort();
        if (_worldStatsDirty) {
            _worldStatsDirty = false;
            saveWorldCourse();
        }
        // Star-rating milestones: crossing 3 then 5 stars celebrates once
        const rating = computeCourseRating();
        const tier = rating >= 5 ? 5 : rating >= 3 ? 3 : 0;
        if (tier > (resort.ratingTier || 0)) {
            resort.ratingTier = tier;
            notify(tier === 5
                ? '\u{1F31F} FIVE STARS \u2014 a world-class resort!'
                : '\u2B50 Three stars \u2014 ' + worldCourse.name + ' is on the map!');
            if (typeof playFanfare === 'function') playFanfare();
            celebrateFireworks();
            const ex = (Math.floor(worldCourse.cols / 2) + 0.5) * CELL;
            const ez = (worldCourse.rows - (worldCourse.border || 4) + 0.5) * CELL;
            (window.__scorePopups = window.__scorePopups || []).push({
                x: ex, z: ez, t0: performance.now(),
                txt: tier === 5 ? '\u{1F31F} 5-STAR RESORT!' : '\u2B50 3-STAR RESORT!',
                col: '#ffd24a', name: worldCourse.name, stack: 0
            });
        }
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
    { name: 'Driver',  short: 'Driver', maxPower: 500, launch: 780, airMin: 0.15, maxYds: 230 },
    { name: '3 Wood',  short: '3W',     maxPower: 420, launch: 680, airMin: 0.18, maxYds: 195 },
    { name: '5 Iron',  short: '5i',     maxPower: 340, launch: 500, airMin: 0.20, maxYds: 160 },
    { name: '7 Iron',  short: '7i',     maxPower: 260, launch: 420, airMin: 0.22, maxYds: 120 },
    { name: 'P Wedge', short: 'Wedge',  maxPower: 180, launch: 560, airMin: 0.15, maxYds: 80  },
    { name: 'Putter',  short: 'Putter', maxPower: 120, launch: 0,   airMin: 999,  maxYds: 40  }
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
    const seed = hole.cols * 137 + hole.rows * 311 + (hole.terrainSeed || 0);
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
            // Two octaves of hash noise — dramatic rolling hills, scaled
            // by the island's Hills slider when one was chosen
            ctrl[r][c] = (hash(c, r) * 85 + hash(c * 2.7, r * 2.7) * 28)
                * (hole.hillAmp || 1);
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
            else if (t === T.FAIRWAY) height *= 0.35;
            else if (t === T.PATH) height *= 0.28;
            if (t === T.GREEN) {
                // Crowned green: rises gently toward the center (distance
                // to the nearest non-green cell, ring-scanned to 3)
                let d = 4;
                outer: for (let ring = 1; ring <= 3; ring++) {
                    for (let dy = -ring; dy <= ring; dy++) {
                        for (let dx = -ring; dx <= ring; dx++) {
                            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                            const nr = r + dy, nc = c + dx;
                            const nt = (nr >= 0 && nr < hole.rows && nc >= 0 && nc < hole.cols)
                                ? hole.grid[nr][nc] : T.OOB;
                            if (nt !== T.GREEN) { d = ring; break outer; }
                        }
                    }
                }
                height += (Math.min(d, 4) - 1) * 1.4;
            }
            // Water vertices sit at 0 so they match surrounding terrain flat
            if (t === T.WATER) height = 0;
            // Fold valleys up to ground level: land never dips below y=0,
            // so the global water surface (y=-1.4) only ever shows inside
            // carved ponds.
            let q = Math.max(0, height);
            if (t === T.SAND) {
                // Bunkers dip into a shallow bowl below the surrounding
                // turf. Floor stays above the global water plane (-1.4)
                // so the sea never peeks through the sand.
                h[r][c] = Math.max(q * 0.4 - 6, -1.1);
                continue;
            }
            if (t === T.GREEN) {
                // Keep the crown smooth — terracing would flatten it away
                h[r][c] = q;
                continue;
            }
            // Terraced plateaus (reference terrain language): flat steps
            // with short steep lips — cliff faces pick up the slope-soil
            // shading automatically
            const STEP_H = 20;
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

// Headless shot simulation over the REAL physics (design pillar: one
// simulator powers everything, never fork the physics). simMode
// suppresses the human-facing side effects (notify, strokes, splash,
// hole ceremony) while updateBall runs off-screen.
let simMode = false;
function simulateShot(fromX, fromY, dirX, dirY, powerPct, clubIdx) {
    const snap = {
        ball: Object.assign({}, ball),
        strokes: strokes,
        holeComplete: holeComplete,
        trail: shotTrail,
        club: selectedClub,
        windSpeed: wind.speed
    };
    // Ratings are measured in neutral conditions: live gusts must not
    // bake today's weather into a hole's par or difficulty stars
    wind.speed = 0;
    simMode = true;
    window.__simHoled = false;
    try {
        selectedClub = clubIdx != null ? clubIdx : 0; // default: Driver
        ball.x = fromX; ball.y = fromY;
        ball.topSpin = 0; ball.curl = 0;
        shotTrail = [];
        takeShot(CLUBS[selectedClub].maxPower * Math.min(1, powerPct || 1),
                 dirX, dirY);
        let guard = 0;
        while (ball.moving && guard++ < 1800) updateBall(1 / 60);
        return {
            x: ball.x, y: ball.y,
            terrain: terrainAt(ball.x, ball.y),
            holed: !!window.__simHoled,
            settled: !ball.moving
        };
    } finally {
        simMode = false;
        Object.assign(ball, snap.ball);
        strokes = snap.strokes;
        holeComplete = snap.holeComplete;
        shotTrail = snap.trail;
        selectedClub = snap.club;
        wind.speed = snap.windSpeed;
    }
}

// Play one hole with chained real-physics shots (sim-rounds arc B).
// Club by distance, waypoint-then-pin aim with skill-based scatter,
// water/OOB re-hit penalties, statistical putt-out inside 12 yds.
// Returns { strokes, holed }. Dormant until NPC rounds adopt it.
function simulateHoleRound(rec, skill, clubScale, trace) {
    const sk = skill == null ? 2.5 : skill;
    // World scale: island holes measure 40-150 yds, so NPC "clubs" swing
    // shorter than the player's full bag (default 45% reach) to make
    // rounds multi-shot journeys instead of single-wedge holes
    const cs = clubScale == null ? 0.45 : clubScale;
    const pin = { x: (rec.pin.x + 0.5) * CELL, y: (rec.pin.y + 0.5) * CELL };
    let px = (rec.tee.x + 0.5) * CELL, py = (rec.tee.y + 0.5) * CELL;
    const wps = (rec.waypoints || []).map(p =>
        ({ x: (p.x + 0.5) * CELL, y: (p.y + 0.5) * CELL }));
    let wpIdx = 0, used = 0, holed = false, penalties = 0, layup = 0;
    let powerAdapt = 1; // golfers club down on fast/downhill conditions
    while (used < 9 && !holed) {
        const distYds = Math.hypot(pin.x - px, pin.y - py) / YDS_TO_WORLD;
        if (distYds < 12) {
            // Green statistics: sim putting uses the meter minigame, so
            // putt-out is modeled — one putt or two, skill-weighted
            used += (Math.random() < Math.max(0.12, 0.72 - distYds * 0.035
                + sk * 0.045)) ? 1 : 2;
            holed = true;
            break;
        }
        let tx = pin.x, ty = pin.y;
        // Waypoints are dogleg guides: only route through them on long
        // approaches, and only while they're still ahead of us
        if (distYds > 100 && wpIdx < wps.length) {
            tx = wps[wpIdx].x;
            ty = wps[wpIdx].y;
        }
        const eff = (i2) => CLUBS[i2].maxYds * cs;
        const clubIdx = distYds > eff(0) * 0.83 ? 0 : distYds > eff(1) * 0.77 ? 1
            : distYds > eff(2) * 0.69 ? 2 : distYds > eff(3) * 0.58 ? 3 : 4;
        const err = (Math.random() * 2 - 1) * (0.16 - sk * 0.022);
        const dx = tx - px, dy = ty - py;
        const adx = dx * Math.cos(err) - dy * Math.sin(err);
        const ady = dx * Math.sin(err) + dy * Math.cos(err);
        const aimYds = Math.hypot(tx - px, ty - py) / YDS_TO_WORLD;
        let powerPct = Math.min(1,
            (aimYds / (CLUBS[clubIdx].maxYds * cs)) * (0.92 + Math.random() * 0.12));
        if (layup > 0) { powerPct *= 0.62; layup--; } // club down after water
        const r = simulateShot(px, py, adx, ady, powerPct * powerAdapt, clubIdx);
        used++;
        // Downhill/firm lies carry shots far past the aim — a golfer
        // notices and swings easier next time instead of ping-ponging
        // across the valley all round
        const traveled = Math.hypot(r.x - px, r.y - py) / YDS_TO_WORLD;
        if (traveled > aimYds * 1.35 + 8) {
            powerAdapt = Math.max(0.45, powerAdapt * 0.72);
        } else if (traveled < aimYds * 0.6 && powerAdapt < 1) {
            powerAdapt = Math.min(1, powerAdapt * 1.15); // eased too much
        }
        if (trace) trace.push({ x: r.x, y: r.y, n: used, holed: r.holed,
            splash: r.terrain === T.WATER || r.terrain === T.OOB });
        if (r.holed) { holed = true; break; }
        if (r.terrain === T.WATER || r.terrain === T.OOB) {
            used++; // penalty; replay from the same lie
            penalties++;
            layup = 2; // a burned golfer lays up short of the trouble
            continue;
        }
        px = r.x; py = r.y;
        // Progress-based advance: drop any waypoint that's no longer
        // closer to the pin than we are
        const myPinD = Math.hypot(pin.x - px, pin.y - py);
        while (wpIdx < wps.length
            && Math.hypot(pin.x - wps[wpIdx].x, pin.y - wps[wpIdx].y) >= myPinD - 60) {
            wpIdx++;
        }
    }
    return { strokes: used, holed: holed, penalties: penalties };
}

// World-context binding: the physics reads currentHole, so ambient sims
// temporarily point it at the resort grid + this hole's tee/pin
function simulateWorldHoleRound(rec, skill, trace) {
    const prev = currentHole;
    if (!worldCourse.heights) worldCourse.heights = generateHeights(worldCourse);
    currentHole = {
        grid: worldCourse.grid, cols: worldCourse.cols, rows: worldCourse.rows,
        heights: worldCourse.heights,
        tee: rec.tee, hole: rec.pin, par: rec.par || 4
    };
    try {
        return simulateHoleRound(rec, skill, null, trace);
    } finally {
        currentHole = prev;
    }
}

function updateBall(dt) {
    if (!ball.moving) return;
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

    // Ball has stopped rolling on ground — but only if the slope can't keep it going
    if (speed < 2 && !ball.airborne) {
        const hslope = terrainSlopeAt(ball.x, ball.y);
        const slopeMag = Math.sqrt(hslope.sx * hslope.sx + hslope.sy * hslope.sy);
        // Friction strong enough to hold on this gradient?
        const ter = terrainAt(ball.x, ball.y);
        // Grabby surfaces hold a resting ball on steeper gradients
        const holdMul = (ter === T.ROUGH || ter === T.GRASS
            || ter === T.SAND) ? 2.2 : 1;
        const staticHold = (1 - (TERRAIN_FRICTION[ter] || 0.97)) * 0.8 * holdMul;
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
                    if (simMode) return;
                    if (typeof spawnSplash3D === 'function') spawnSplash3D(ball.x, ball.y);
                    notify('Splash! +1 stroke');
                    strokes++;
                    resetBallToLastSafe();
                    return;
                }
                if (ter === T.OOB) {
                    ball.vx = 0; ball.vy = 0; ball.vz = 0; ball.moving = false;
                    if (simMode) return;
                    notify('Out of bounds! +1 stroke');
                    strokes++;
                    resetBallToLastSafe();
                    return;
                }
                if (ter === T.TREE) {
                    // Hit tree canopy — drops straight down with heavy speed loss
                    ball.vx *= 0.15;
                    ball.vy *= 0.15;
                    if (!simMode) notify('Landed in trees!');
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
            if (simMode) { ball.moving = false; return; }
            notify('Water! +1 stroke');
            strokes++;
            resetBallToLastSafe();
            return;
        }
        if (ter === T.OOB) {
            ball.vx = 0; ball.vy = 0; ball.moving = false;
            if (simMode) { ball.moving = false; return; }
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
            if (!simMode) notify('Hit a tree!');
        }

        // Apply terrain friction
        ball.vx *= Math.pow(fric, stepDt * 60);
        ball.vy *= Math.pow(fric, stepDt * 60);

        // Heightmap slope force — downhill gravity on every terrain type.
        // Keeps the ball rolling on slopes and dead-flats it on plateaus.
        const hslope = terrainSlopeAt(ball.x, ball.y);
        // Greens are flatter (10% height) so boost their slope response a
        // bit for feel. Tall rough and sand grab the ball instead — without
        // this, hillside rough turns into an ice rink and balls run out
        // 40+ yards to the valley floor (ping-ponging past the hole).
        const slopeGain = (ter === T.GREEN) ? 420
            : (ter === T.ROUGH || ter === T.GRASS) ? 190
            : (ter === T.SAND) ? 110 : 350;
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
    // Headless sims settle thousands of balls: none of the human-facing
    // side effects below (shot banner, camera zoom, club/target updates)
    // may leak into the live game
    if (simMode) return;
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
    if (simMode) {
        window.__simHoled = true;
        ball.moving = false;
        return;
    }
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
    if (state === 'islandgen') { islandTouchStart(sx, sy); return; }
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
    if (state === 'islandgen') { islandTouchMove(sx, sy); return; }
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
    if (state === 'islandgen') { islandTouchEnd(); return; }
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
    if (menuOrbitReady && scene3dReady) {
        // Live 3D backdrop is rendering underneath: darken just enough
        // for text legibility, heavier at the edges. Must clear first or
        // the translucent scrim compounds toward black frame over frame.
        ctx.clearRect(0, 0, W(), H());
        const bg = ctx.createLinearGradient(0, 0, 0, H());
        bg.addColorStop(0, 'rgba(7,22,13,0.78)');
        bg.addColorStop(0.45, 'rgba(10,28,17,0.35)');
        bg.addColorStop(1, 'rgba(6,18,11,0.7)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W(), H());
    } else {
        // Rich gradient background (3D not ready yet)
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
    if (menuOrbitReady && scene3dReady) {
        ctx.clearRect(0, 0, W(), H());
        const bg = ctx.createLinearGradient(0, 0, 0, H());
        bg.addColorStop(0, 'rgba(8,26,16,0.85)');
        bg.addColorStop(1, 'rgba(10,30,19,0.7)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W(), H());
    } else {
        const bg = ctx.createLinearGradient(0, 0, 0, H());
        bg.addColorStop(0, '#0d2818');
        bg.addColorStop(1, '#1a472a');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W(), H());
    }

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
    const biomeY = playerY + playerH + 10;
    const biomeH = 62;

    // Content area: amenity list + bottom actions row (3 buttons side-by-side)
    const amenityLabelY = contentY + 4;
    const amenityStartY = contentY + 28;
    const amenityH = H() < 430 ? 68 : 86;   // 3 tiers must clear the actions row
    const amenityGap = H() < 430 ? 6 : 10;
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
        moneyY, moneyH, statsY, statsH, playerY, playerH, biomeY, biomeH,
        amenityLabelY, amenityStartY, amenityH, amenityGap,
        actionsY, actionsRowH, actionBw, resortX, simX, playX,
        closeSize, closeX, closeY
    };
}

function drawManage() {
    if (menuOrbitReady && scene3dReady) {
        // Live resort orbits underneath — heavier scrim than the menu
        // since this screen carries dense text
        ctx.clearRect(0, 0, W(), H());
        const bg = ctx.createLinearGradient(0, 0, 0, H());
        bg.addColorStop(0, 'rgba(8,26,16,0.88)');
        bg.addColorStop(0.5, 'rgba(12,36,22,0.62)');
        bg.addColorStop(1, 'rgba(6,18,11,0.85)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W(), H());
    } else {
        // Warm resort-y gradient
        const bg = ctx.createLinearGradient(0, 0, 0, H());
        bg.addColorStop(0, '#0b2a1c');
        bg.addColorStop(0.5, '#144f33');
        bg.addColorStop(1, '#08170f');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W(), H());
    }

    const L = manageLayout();

    // ---- Top bar (title left, close right) ----
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '800 20px -apple-system,sans-serif';
    ctx.fillText('Clubhouse', L.pad + 6, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px -apple-system,sans-serif';
    // Subtitle clips under the header buttons on phone widths \u2014 skip it there
    if (W() > 780) ctx.fillText('Run your resort \u2022 Grow your members', L.pad + 6 + 110, 28);

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
    {
        const cap = memberCapacity();
        ctx.fillStyle = '#81d4fa';
        ctx.font = 'bold 22px -apple-system,sans-serif';
        ctx.textAlign = 'right';
        const capTxt = ' / ' + cap;
        ctx.font = '12px -apple-system,sans-serif';
        const capW = ctx.measureText(capTxt).width;
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(capTxt, L.sidebarX + L.sidebarW - 14, L.statsY + 38);
        ctx.fillStyle = '#81d4fa';
        ctx.font = 'bold 22px -apple-system,sans-serif';
        ctx.fillText(String(resort.members),
            L.sidebarX + L.sidebarW - 14 - capW, L.statsY + 38);
        // Room to grow reads as an invitation, not a bare number
        if (resort.members >= cap) {
            ctx.fillStyle = 'rgba(255,210,74,0.7)';
            ctx.font = '9px -apple-system,sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('at capacity \u2014 holes, decor + clubhouse raise it',
                L.sidebarX + 14, L.statsY + 50);
        }
    }
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
    ctx.fillText((resort.members * 0.03).toFixed(1), L.sidebarX + L.sidebarW - 14, L.statsY + halfH + 40);

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
    {
        const myCar = (worldCourse.golferCareers || {})['You'];
        const tourneyWins = (resort.tourneyHistory || [])
            .filter(t => t.winner === 'You').length;
        let sub = 'Club Owner';
        if (myCar) {
            sub += ' \u2022 ' + myCar.rounds + ' rds \u2022 best ' + myCar.best;
        }
        if (tourneyWins) sub += ' \u2022 \u{1F3C6}\u00D7' + tourneyWins;
        ctx.fillText(sub, L.sidebarX + 72, L.playerY + 52);
    }

    // ---- Island biome switcher: restyle the resort without regenerating ----
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(L.sidebarX, L.biomeY, L.sidebarW, L.biomeH, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    roundRect(L.sidebarX, L.biomeY, L.sidebarW, L.biomeH, 14); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px -apple-system,sans-serif';
    ctx.fillText('ISLAND BIOME' + (worldCourse.terrainSeed != null
        ? '  \u2022  SEED ' + worldCourse.terrainSeed : ''),
        L.sidebarX + 14, L.biomeY + 18);
    manageBiomeRects = [];
    {
        const bws = (L.sidebarW - 28 - 12) / 3;
        const cur = worldCourse.biome || 'meadows';
        for (let i = 0; i < ISLAND_BIOMES.length; i++) {
            const bid = ISLAND_BIOMES[i][0];
            const blab = bid.charAt(0).toUpperCase() + bid.slice(1);
            const bx = L.sidebarX + 14 + i * (bws + 6);
            const by = L.biomeY + 26;
            const active = cur === bid;
            ctx.fillStyle = active ? 'rgba(58,219,232,0.28)'
                : 'rgba(255,255,255,0.10)';
            roundRect(bx, by, bws, 24, 12); ctx.fill();
            if (active) {
                ctx.strokeStyle = 'rgba(58,219,232,0.9)';
                ctx.lineWidth = 1.5;
                roundRect(bx, by, bws, 24, 12); ctx.stroke();
            }
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(blab, bx + bws / 2, by + 16);
            manageBiomeRects.push({ id: bid, x: bx, y: by, w: bws, h: 24 });
        }
    }

    // ---- RIGHT CONTENT ----
    // Section label
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 11px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    // Share / Load buttons beside the close X, New Island to their left
    glossyRect(L.closeX - 312, L.closeY, 104, L.closeSize, 10, '#2c5c74');
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F3DD} New Island', L.closeX - 260, L.closeY + L.closeSize / 2 + 4);
    glossyRect(L.closeX - 200, L.closeY, 92, L.closeSize, 10, '#00695c');
    glossyRect(L.closeX - 100, L.closeY, 92, L.closeSize, 10, '#37474f');
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F4E4} Share', L.closeX - 154, L.closeY + L.closeSize / 2 + 4);
    ctx.fillText('\u{1F4E5} Load', L.closeX - 54, L.closeY + L.closeSize / 2 + 4);

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px -apple-system,sans-serif';
    ctx.fillText('AMENITIES', L.contentX + 4, L.amenityLabelY + 14);
    // Course report: holes and lifetime green fees, right-aligned
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '11px -apple-system,sans-serif';
    {
        const rating = computeCourseRating();
        const full = Math.floor(rating);
        const stars = '\u2605'.repeat(full) + (rating % 1 ? '\u00BD' : '')
            + '\u2606'.repeat(5 - Math.ceil(rating));
        ctx.fillText(stars + '  •  ' + worldCourse.holes.length + ' holes  •  fees $'
            + (resort.feesEarned || 0), L.contentX + L.contentW - 4, L.amenityLabelY + 14);
        // Next-star hint: name the weakest rating ingredient
        if (rating < 5) {
            const parts = [];
            parts.push(['build more holes', Math.min(2.5, worldCourse.holes.length * 0.4) / 2.5]);
            const diffs = new Set(worldCourse.holes.map(h => holeDifficulty(h)));
            parts.push(['vary hole difficulty', Math.min(1, diffs.size * 0.35)]);
            const decorVal = (worldCourse.decor || []).reduce(
                (s, d) => s + (DECOR_COSTS[d.t] || 0), 0);
            parts.push(['invest in decor', Math.min(1, decorVal / 1000)]);
            parts.push(['add a kiosk or stall',
                (worldCourse.decor || []).some(d => d.t === 'kiosk' || d.t === 'stall') ? 1 : 0]);
            parts.push(['upgrade the clubhouse',
                resort.amenities.clubhouse3 ? 1
                    : resort.amenities.clubhouse2 ? 0.5
                    : resort.amenities.clubhouse ? 0.2 : 0]);
            parts.sort((a, b) => a[1] - b[1]);
            ctx.fillStyle = 'rgba(255,210,74,0.75)';
            ctx.font = '10px -apple-system,sans-serif';
            ctx.fillText('next star: ' + parts[0][0],
                L.contentX + L.contentW - 4, L.amenityLabelY + 28);
        }
    }
    ctx.textAlign = 'left';

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

        // Icon (compact cards on phone shrink and lift everything)
        const cmp = L.amenityH < 80;
        ctx.textAlign = 'center';
        ctx.font = (cmp ? '24px' : '32px') + ' -apple-system,sans-serif';
        ctx.fillText(a.icon, L.contentX + 38, y + (cmp ? 42 : 50));

        // Name + desc + boost
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + (cmp ? 14 : 16) + 'px -apple-system,sans-serif';
        ctx.fillText(a.name, L.contentX + 76, y + (cmp ? 20 : 26));
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = (cmp ? '10px' : '11px') + ' -apple-system,sans-serif';
        ctx.fillText(a.desc, L.contentX + 76, y + (cmp ? 34 : 46));
        ctx.fillStyle = '#81d4fa';
        ctx.font = (cmp ? '10px' : '11px') + ' -apple-system,sans-serif';
        const lock = !owned && a.requires && !resort.amenities[a.requires];
        ctx.fillText('+' + a.memberBoost + ' members'
            + (a.feeBoost ? '  \u2022  fees +' + Math.round(a.feeBoost * 100) + '%' : '')
            + (a.upkeep ? '  \u2022  $' + a.upkeep + '/day' : '')
            + (cmp && lock ? '  \u2022  \u{1F512} locked' : ''),
            L.contentX + 76, y + (cmp ? 48 : 66));
        if (!cmp && lock) {
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = 'bold 10px -apple-system,sans-serif';
            const reqA = AMENITIES.find(x => x.id === a.requires);
            ctx.fillText('\u{1F512} Requires ' + (reqA ? reqA.name : ''),
                L.contentX + 76, y + 80);
        }

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

// ---- Course share codes: the whole resort design in the clipboard ----
// Heights are derived, so a code is just grid + holes + decor. Unicode-
// safe base64 keeps it paste-able anywhere.
function exportCourseCode() {
    try {
        // Share the DESIGN: strip regenerable heights, your play history
        // (the receiver's golfers write their own records), and parcel
        // ownership (receivers get the whole island as a gift)
        // ...plus complaints, careers, and vendor sales books — all of
        // it is the sender's play history, not the design
        const { heights, holeStats, parcels, freshDefault,
                complaints, golferCareers, ...persistable } = worldCourse;
        persistable.decor = (worldCourse.decor || []).map(d =>
            ({ t: d.t, x: d.x, y: d.y, rot: d.rot || 0 }));
        const code = 'GTC1.' + btoa(unescape(encodeURIComponent(JSON.stringify(persistable))));
        if (navigator.clipboard && navigator.clipboard.writeText) {
            const kb = Math.round(code.length / 102.4) / 10;
            const toast = '\u{1F4E4} Copied! ' + worldCourse.holes.length
                + ' holes \u2022 ' + computeCourseRating() + '\u2605 \u2022 '
                + kb + ' KB \u2014 send it to a friend';
            navigator.clipboard.writeText(code).then(
                () => notify(toast),
                () => notify('Could not reach the clipboard'));
        } else {
            notify('Clipboard not available in this browser');
        }
    } catch (e) {
        notify('Share failed');
    }
}

function importCourseCode() {
    if (!(navigator.clipboard && navigator.clipboard.readText)) {
        notify('Clipboard not available in this browser');
        return;
    }
    navigator.clipboard.readText().then((txt) => {
        try {
            if (!txt || txt.indexOf('GTC1.') !== 0) {
                notify('No course code in the clipboard');
                return;
            }
            const data = JSON.parse(decodeURIComponent(escape(atob(txt.slice(5)))));
            if (!data || data.cols !== COURSE_COLS || data.rows !== COURSE_ROWS
                || !Array.isArray(data.grid) || !Array.isArray(data.holes)) {
                notify('That code is not a valid course');
                return;
            }
            // Loading REPLACES the current design — never silently
            if (worldCourse && worldCourse.holes && worldCourse.holes.length
                && !confirm('Load "' + (data.name || 'shared course') + '" ('
                    + data.holes.length + ' holes)? Your current design will be replaced.')) {
                notify('Load cancelled');
                return;
            }
            worldCourse = data;
            refreshWorldHeights();
            saveWorldCourse();
            if (scene3dReady) buildTerrain3D(worldCourse, { distantScenery: false });
            notify('Course loaded! Enter the resort to see it');
        } catch (e) {
            notify('That code could not be read');
        }
    }, () => notify('Clipboard read was blocked'));
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

    // Biome chips: restyle in place (terrain rebuilds live + on return)
    for (const bc of manageBiomeRects) {
        if (hitBtn(sx, sy, bc.x, bc.y, bc.w, bc.h)) {
            if ((worldCourse.biome || 'meadows') !== bc.id) {
                worldCourse.biome = bc.id;
                saveWorldCourse();
                if (scene3dReady) {
                    buildTerrain3D(worldCourse, { distantScenery: false });
                }
                notify('\u{1F3DD} Island restyled \u2014 '
                    + bc.id.charAt(0).toUpperCase() + bc.id.slice(1));
            }
            return;
        }
    }
    // New Island / Share / Load (buttons left of the close X)
    if (hitBtn(sx, sy, L.closeX - 312, L.closeY, 104, L.closeSize)) {
        startIslandCreator();
        return;
    }
    if (hitBtn(sx, sy, L.closeX - 200, L.closeY, 92, L.closeSize)) {
        exportCourseCode();
        return;
    }
    if (hitBtn(sx, sy, L.closeX - 100, L.closeY, 92, L.closeSize)) {
        importCourseCode();
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
        if (!worldCourse.holes.some(h => h.open !== false)) {
            notify('Every hole is closed \u2014 open one to host an exhibition');
            return;
        }
        const res = simulateRound(worldCourse);
        awardCoins(res.coins);
        const diff = res.totalStrokes - res.totalPar;
        const label = (diff === 0 ? 'E' : (diff > 0 ? '+' + diff : String(diff)));
        notify('\u26F3 Exhibition at ' + worldCourse.name + ': '
            + res.totalStrokes + ' (' + label + ') \u2022 +' + res.coins + ' coins');
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
// ---- Create Your Island screen (reference-style island generator) ----
let islandDraft = null;        // { params, course, confirm } while open
let islandUIRects = null;      // slider/button rects rebuilt each draw
let islandDragSlider = null;   // key of the slider being dragged

const ISLAND_DEFAULTS = { water: 0.35, hills: 0.5, trees: 0.6,
                          rocks: 0.4, roundness: 0.6, grass: 0.7 };
const ISLAND_SLIDERS = [
    ['water', 'Water'], ['hills', 'Hills'], ['trees', 'Trees'],
    ['rocks', 'Rocks'], ['roundness', 'Roundness'], ['grass', 'Grass']
];
const ISLAND_BIOMES = [
    ['meadows', '\u{1F33F} Meadows'],
    ['autumn', '\u{1F342} Autumn'],
    ['links', '\u{1F33E} Links']
];

function startIslandCreator() {
    islandDraft = {
        params: Object.assign({ seed: 1000 + Math.floor(Math.random() * 9000),
                                biome: 'meadows' },
                              ISLAND_DEFAULTS),
        confirm: false
    };
    regenIslandDraft();
    setState('islandgen');
}

function regenIslandDraft() {
    islandDraft.confirm = false;
    islandDraft.course = makeIsland(islandDraft.params);
    islandDraft.course.biome = islandDraft.params.biome || 'meadows';
    islandDraft.course.heights = generateHeights(islandDraft.course);
    // Island fact sheet: land share, forest share, and pond count (flood
    // fill from the map edge marks the sea; leftover water = ponds)
    {
        const g = islandDraft.course.grid;
        const rows = islandDraft.course.rows, cols = islandDraft.course.cols;
        const sea = new Uint8Array(rows * cols);
        const stack = [];
        for (let c = 0; c < cols; c++) { stack.push(c); stack.push((rows - 1) * cols + c); }
        for (let r = 0; r < rows; r++) { stack.push(r * cols); stack.push(r * cols + cols - 1); }
        while (stack.length) {
            const k = stack.pop();
            const r = Math.floor(k / cols), c = k % cols;
            if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
            if (sea[k] || g[r][c] !== T.WATER) continue;
            sea[k] = 1;
            stack.push(k - 1, k + 1, k - cols, k + cols);
        }
        let land = 0, forest = 0, pondCells = 0;
        const pondSeen = new Uint8Array(rows * cols);
        let ponds = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const t = g[r][c], k = r * cols + c;
                if (t !== T.WATER) { land++; if (t === T.TREE) forest++; }
                else if (!sea[k]) {
                    pondCells++;
                    if (!pondSeen[k]) {
                        ponds++;
                        const st2 = [k];
                        while (st2.length) {
                            const k2 = st2.pop();
                            const r2 = Math.floor(k2 / cols), c2 = k2 % cols;
                            if (r2 < 0 || r2 >= rows || c2 < 0 || c2 >= cols) continue;
                            if (pondSeen[k2] || sea[k2] || g[r2][c2] !== T.WATER) continue;
                            pondSeen[k2] = 1;
                            st2.push(k2 - 1, k2 + 1, k2 - cols, k2 + cols);
                        }
                    }
                }
            }
        }
        islandDraft.stats = {
            landPct: Math.round(100 * land / (rows * cols)),
            forestPct: land ? Math.round(100 * forest / land) : 0,
            ponds: ponds
        };
    }
    if (scene3dReady) {
        buildTerrain3D(islandDraft.course, { distantScenery: false });
        cam3dOrbitMode = true;
        if (typeof resetCameraFov === 'function') resetCameraFov();
        setCameraOrbit(islandDraft.course.cols * CELL / 2,
                       islandDraft.course.rows * CELL / 2,
                       2700, Math.PI / 180 * 46, 0.5);
        if (typeof camera3d !== 'undefined' && camera3d) {
            camera3d.position.set(cam3dTarget.x, cam3dTarget.y, cam3dTarget.z);
        }
    }
}

function islandLevelWord(v) {
    return v < 0.2 ? 'Low' : v < 0.45 ? 'Medium' : v < 0.7 ? 'High' : 'Very High';
}

function drawIslandCreator() {
    const d = window.devicePixelRatio || 1;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, W(), H());
    if (!islandDraft) return;
    const pw = Math.min(300, Math.floor(W() * 0.44));
    const px = 12, py = 12, ph = H() - 24;
    ctx.fillStyle = 'rgba(12,24,32,0.88)';
    roundRect(px, py, pw, ph, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    roundRect(px, py, pw, ph, 14); ctx.stroke();
    glossyRect(px + 4, py + 4, pw - 8, 28, 12, '#2c5c74');
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Create Your Island', px + pw / 2, py + 23);

    islandUIRects = { sliders: {}, buttons: {} };
    const inX = px + 12, inW = pw - 24;
    let y = py + 42;
    // Short screens (phone landscape) compact every vertical metric so
    // the button rows never clip past the panel
    const compact = H() < 430;
    const rowH = Math.max(compact ? 19 : 22,
        Math.min(30, Math.floor((ph - 46 - 204) / 7)));
    for (const [key, label] of ISLAND_SLIDERS) {
        const v = islandDraft.params[key];
        const trackH = rowH - 8;
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        roundRect(inX, y, inW, trackH, trackH / 2); ctx.fill();
        ctx.fillStyle = 'rgba(70,140,190,0.55)';
        roundRect(inX, y, Math.max(trackH, inW * v), trackH, trackH / 2); ctx.fill();
        const kx = inX + trackH / 2 + (inW - trackH) * v;
        ctx.fillStyle = '#dfeefb';
        ctx.beginPath();
        ctx.arc(kx, y + trackH / 2, trackH / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px -apple-system,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(label, inX + 9, y + trackH / 2 + 4);
        ctx.textAlign = 'right';
        ctx.fillStyle = islandDragSlider === key ? '#5ff0ff' : 'rgba(255,255,255,0.85)';
        ctx.font = islandDragSlider === key
            ? 'bold 11px -apple-system,sans-serif' : '11px -apple-system,sans-serif';
        ctx.fillText(islandDragSlider === key
            ? Math.round(v * 100) + '%' : islandLevelWord(v),
            inX + inW - 9, y + trackH / 2 + 4);
        islandUIRects.sliders[key] = { x: inX, y: y - 3, w: inW, h: trackH + 6 };
        y += rowH;
    }
    // Seed row — tap to type a custom seed
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(inX, y, inW, 22, 11); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = 'bold 10px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SEED (tap to set)', inX + 9, y + 15);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px -apple-system,sans-serif';
    ctx.fillText(String(islandDraft.params.seed), inX + inW - 9, y + 15);
    islandUIRects.buttons.seed = { x: inX, y: y, w: inW, h: 22 };
    y += compact ? 24 : 26;
    // Biome chips — the island's whole palette in one tap
    islandUIRects.biomes = [];
    {
        const bws = (inW - 12) / 3;
        for (let i = 0; i < ISLAND_BIOMES.length; i++) {
            const bid = ISLAND_BIOMES[i][0], blab = ISLAND_BIOMES[i][1];
            const bx3 = inX + i * (bws + 6);
            const active = (islandDraft.params.biome || 'meadows') === bid;
            ctx.fillStyle = active ? 'rgba(58,219,232,0.28)'
                : 'rgba(255,255,255,0.10)';
            roundRect(bx3, y, bws, 20, 10); ctx.fill();
            if (active) {
                ctx.strokeStyle = 'rgba(58,219,232,0.9)';
                ctx.lineWidth = 1.5;
                roundRect(bx3, y, bws, 20, 10); ctx.stroke();
            }
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(blab, bx3 + bws / 2, y + 14);
            islandUIRects.biomes.push({ id: bid, x: bx3, y: y, w: bws, h: 20 });
        }
        y += compact ? 24 : 26;
    }
    // Starting property picker: mini parcel map shaded by land coverage;
    // tap a section to put your gate (and first deed) there
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 9px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SELECT STARTING PROPERTY', inX, y + 8);
    y += 13;
    islandUIRects.parcels = [];
    {
        const course = islandDraft.course;
        const tw4 = (inW - (PARCEL_COLS - 1) * 3) / PARCEL_COLS;
        const th4 = compact ? 13 : 15;
        const chosen = islandDraft.params.startParcel != null
            ? islandDraft.params.startParcel : (PARCEL_ROWS - 1) * PARCEL_COLS + 1;
        for (let pr = 0; pr < PARCEL_ROWS; pr++) {
            for (let pc = 0; pc < PARCEL_COLS; pc++) {
                const pi = pr * PARCEL_COLS + pc;
                // Land fraction shades the tile: sea tiles read dark
                let land = 0, tot = 0;
                const c0 = Math.floor(pc * course.cols / PARCEL_COLS);
                const c1 = Math.floor((pc + 1) * course.cols / PARCEL_COLS);
                const r0 = Math.floor(pr * course.rows / PARCEL_ROWS);
                const r1 = Math.floor((pr + 1) * course.rows / PARCEL_ROWS);
                for (let r = r0; r < r1; r += 3)
                    for (let c = c0; c < c1; c += 3) {
                        tot++;
                        if (course.grid[r][c] !== T.WATER) land++;
                    }
                const frac = tot ? land / tot : 0;
                const tx4 = inX + pc * (tw4 + 3);
                const ty4 = y + pr * (th4 + 3);
                ctx.fillStyle = pi === chosen ? 'rgba(58,219,232,0.85)'
                    : 'rgba(' + Math.round(60 + 30 * frac) + ','
                      + Math.round(90 + 90 * frac) + ','
                      + Math.round(70 + 40 * frac) + ',' + (0.35 + frac * 0.5) + ')';
                roundRect(tx4, ty4, tw4, th4, 4);
                ctx.fill();
                if (course.parcels && course.parcels.owned.includes(pi) && pi !== chosen) {
                    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
                    ctx.lineWidth = 1;
                    roundRect(tx4, ty4, tw4, th4, 4);
                    ctx.stroke();
                }
                islandUIRects.parcels.push({ pi, x: tx4, y: ty4, w: tw4, h: th4 });
            }
        }
        y += PARCEL_ROWS * (th4 + 3) + 4;
    }
    if (islandDraft.stats) {
        const st = islandDraft.stats;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '10px -apple-system,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Land ' + st.landPct + '%  \u2022  forest ' + st.forestPct
            + '%  \u2022  ' + st.ponds + ' pond' + (st.ponds === 1 ? '' : 's'),
            inX, y + 8);
        y += 14;
    }
    // Buttons: top row thirds (dice / surprise / restore), bottom halves
    const bh = compact ? 28 : 34;
    {
        const bw3 = (inW - 12) / 3;
        const topBtns = [
            ['regen', '\u{1F3B2} Seed', '#2c5c74'],
            ['surprise', '\u{1F381} Surprise', '#6a3f8f'],
            ['reset', '\u21BA Reset', '#37474f']
        ];
        for (let i = 0; i < topBtns.length; i++) {
            const bx = inX + i * (bw3 + 6);
            glossyRect(bx, y, bw3, bh, 10, topBtns[i][2]);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(topBtns[i][1], bx + bw3 / 2, y + bh / 2 + 4);
            islandUIRects.buttons[topBtns[i][0]] = { x: bx, y: y, w: bw3, h: bh };
        }
        const bw2 = (inW - 8) / 2;
        const botBtns = [
            ['back', '\u2190 Back', '#5d4037'],
            ['create', islandDraft.confirm ? 'Replace resort?!' : '\u2714 Create Island',
             islandDraft.confirm ? '#c0392b' : '#2e7d32']
        ];
        for (let i = 0; i < botBtns.length; i++) {
            const bx = inX + i * (bw2 + 8);
            const by = y + bh + (compact ? 5 : 8);
            glossyRect(bx, by, bw2, bh, 10, botBtns[i][2]);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(botBtns[i][1], bx + bw2 / 2, by + bh / 2 + 4);
            islandUIRects.buttons[botBtns[i][0]] = { x: bx, y: by, w: bw2, h: bh };
        }
    }
    // Hint under the preview
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '11px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Drag sliders, then release to preview \u2022 same seed = same island',
        px + pw + (W() - px - pw) / 2, H() - 16);
}

function islandTouchStart(sx, sy) {
    if (!islandDraft || !islandUIRects) return;
    for (const key in islandUIRects.sliders) {
        const r = islandUIRects.sliders[key];
        if (hitBtn(sx, sy, r.x, r.y, r.w, r.h)) {
            islandDragSlider = key;
            islandDraft.params[key] = Math.max(0, Math.min(1, (sx - r.x) / r.w));
            return;
        }
    }
    if (islandUIRects.biomes) {
        for (const bc of islandUIRects.biomes) {
            if (hitBtn(sx, sy, bc.x, bc.y, bc.w, bc.h)) {
                if (islandDraft.params.biome !== bc.id) {
                    islandDraft.params.biome = bc.id;
                    regenIslandDraft();
                }
                return;
            }
        }
    }
    if (islandUIRects.parcels) {
        for (const t of islandUIRects.parcels) {
            if (hitBtn(sx, sy, t.x, t.y, t.w, t.h)) {
                islandDraft.params.startParcel = t.pi;
                regenIslandDraft();
                return;
            }
        }
    }
    const b = islandUIRects.buttons;
    if (hitBtn(sx, sy, b.seed.x, b.seed.y, b.seed.w, b.seed.h)) {
        const inp = prompt('Island seed (a number):', String(islandDraft.params.seed));
        const n = parseInt(inp, 10);
        if (!isNaN(n)) { islandDraft.params.seed = n; regenIslandDraft(); }
        return;
    }
    if (hitBtn(sx, sy, b.regen.x, b.regen.y, b.regen.w, b.regen.h)) {
        islandDraft.params.seed = 1000 + Math.floor(Math.random() * 9000);
        regenIslandDraft();
        return;
    }
    if (b.surprise && hitBtn(sx, sy, b.surprise.x, b.surprise.y,
        b.surprise.w, b.surprise.h)) {
        // One tap, whole new island: sliders inside sane bands, any
        // biome, fresh seed
        const R = Math.random;
        const P = islandDraft.params;
        P.water = 0.15 + R() * 0.5;
        P.hills = R();
        P.trees = 0.25 + R() * 0.7;
        P.rocks = R();
        P.roundness = 0.3 + R() * 0.7;
        P.grass = 0.4 + R() * 0.6;
        P.biome = ['meadows', 'autumn', 'links'][Math.floor(R() * 3)];
        P.seed = 1000 + Math.floor(R() * 9000);
        regenIslandDraft();
        return;
    }
    if (hitBtn(sx, sy, b.reset.x, b.reset.y, b.reset.w, b.reset.h)) {
        Object.assign(islandDraft.params, ISLAND_DEFAULTS);
        regenIslandDraft();
        return;
    }
    if (hitBtn(sx, sy, b.back.x, b.back.y, b.back.w, b.back.h)) {
        islandDraft = null;
        menuOrbitReady = false;
        setState('manage');
        return;
    }
    if (hitBtn(sx, sy, b.create.x, b.create.y, b.create.w, b.create.h)) {
        if (!islandDraft.confirm) {
            islandDraft.confirm = true; // second tap commits
            return;
        }
        // Commit: the draft becomes the resort's world. Holes, decor and
        // per-hole stats start fresh; money and members carry over.
        worldCourse = islandDraft.course;
        islandDraft = null;
        owUndoStack = [];
        owSelectedHole = null;
        owSelectedGolfer = null;
        saveWorldCourse();
        menuOrbitReady = false;
        enterOverworld();
        notify('\u{1F3DD} Welcome to your new island!');
        return;
    }
    if (islandDraft) islandDraft.confirm = false; // tap elsewhere cancels
}

function islandTouchMove(sx, sy) {
    if (!islandDraft || !islandDragSlider || !islandUIRects) return;
    const r = islandUIRects.sliders[islandDragSlider];
    islandDraft.params[islandDragSlider] =
        Math.max(0, Math.min(1, (sx - r.x) / r.w));
}

function islandTouchEnd() {
    if (islandDragSlider) {
        islandDragSlider = null;
        regenIslandDraft(); // rebuild the preview on release
    }
}

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

    // ---- Complaint pins: sim-sourced gripes pinned where they happened ----
    owComplaintRects = [];
    if (!holeWizard && worldCourse.complaints && worldCourse.complaints.length) {
        const bob = Math.sin(Date.now() / 320) * 2;
        for (const cm of worldCourse.complaints) {
            const p = cellCenterScreen(cm.x, cm.y);
            if (!p || p.behind) continue;
            const py = p.y - 18 + bob;
            const col = cm.kind === 'freakout' ? '#e53935' : '#f0a860';
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(p.x, py, 9, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(p.x - 4, py + 7);
            ctx.lineTo(p.x, py + 16);
            ctx.lineTo(p.x + 4, py + 7);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(p.x, py, 9, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('!', p.x, py + 4);
            owComplaintRects.push({ x: p.x, y: py, cm: cm });
        }
    }

    // ---- Decor handles: with a decor tool armed, ring every placed item
    // so taps have a visible target. Same-type items brighten (they rotate
    // on tap); others dim (switch tool or use erase).
    if (OW_TOOL_PARENT[owTool] === 'decor' && worldCourse.decor) {
        const armed = currentTool();
        for (const d of worldCourse.decor) {
            const p = cellCenterScreen(d.x - 0.5, d.y - 0.5);
            if (!p || p.behind) continue;
            const same = armed && armed.decor === d.t;
            ctx.strokeStyle = same ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
            ctx.lineWidth = same ? 2 : 1;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, same ? 17 : 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // ---- Property lines: dashed parcel grid while any build tool is
    // armed; unowned sections carry a lock and price at their center ----
    const buildingNow = (owTool && owTool !== 'hand') || holeWizard;
    if (buildingNow
        && ensureParcels().owned.length < PARCEL_COLS * PARCEL_ROWS) {
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([7, 7]);
        const drawGridLine = (fixed, isCol) => {
            ctx.beginPath();
            let started = false;
            const maxIt = isCol ? worldCourse.rows : worldCourse.cols;
            for (let i = 0; i <= maxIt; i += 3) {
                const c = isCol ? fixed : i, r = isCol ? i : fixed;
                const p = cellCenterScreen(c - 0.5, r - 0.5);
                if (!p || p.behind) { started = false; continue; }
                if (!started) { ctx.moveTo(p.x, p.y); started = true; }
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        };
        for (let pc = 1; pc < PARCEL_COLS; pc++) {
            drawGridLine(Math.round(worldCourse.cols * pc / PARCEL_COLS), true);
        }
        for (let pr = 1; pr < PARCEL_ROWS; pr++) {
            drawGridLine(Math.round(worldCourse.rows * pr / PARCEL_ROWS), false);
        }
        ctx.setLineDash([]);
        for (let pi = 0; pi < PARCEL_COLS * PARCEL_ROWS; pi++) {
            if (worldCourse.parcels.owned.includes(pi)) continue;
            const cc = (pi % PARCEL_COLS + 0.5) * worldCourse.cols / PARCEL_COLS;
            const cr = (Math.floor(pi / PARCEL_COLS) + 0.5) * worldCourse.rows / PARCEL_ROWS;
            const p = cellCenterScreen(cc, cr);
            if (!p || p.behind) continue;
            ctx.font = 'bold 12px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            const txt = '\u{1F512} $' + parcelPrice();
            const tw2 = ctx.measureText(txt).width + 20;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            roundRect(p.x - tw2 / 2, p.y - 12, tw2, 24, 12);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(txt, p.x, p.y + 4);
        }
    }
    // Buy-property chip after a blocked tap (auto-hides)
    owBuyRect = null;
    if (owBuyOffer) {
        if (performance.now() - owBuyOffer.t0 > 6000
            || worldCourse.parcels.owned.includes(owBuyOffer.parcel)) {
            owBuyOffer = null;
        } else {
            ctx.font = 'bold 12px -apple-system,sans-serif';
            const price = parcelPrice();
            const short = price - Math.floor(resort.coins);
            const bTxt = short > 0
                ? '\u{1F512} Buy for $' + price + '  (need $' + short + ' more)'
                : '\u{1F512} Unowned land \u2014 buy for $' + price;
            const bw2 = ctx.measureText(bTxt).width + 30;
            // The wizard's shape step parks its readout (and possibly a
            // carry warning) in the default slot — drop below them
            const by2 = (holeWizard && holeWizard.step === 'shape')
                ? L.topBarH + 108 : L.topBarH + 44;
            const bx2 = (W() - bw2) / 2;
            glossyRect(bx2, by2, bw2, 30, 15, short > 0 ? '#7a4a3a' : '#8a6d1d');
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.fillText(bTxt, W() / 2, by2 + 19);
            owBuyRect = { x: bx2, y: by2, w: bw2, h: 30 };
        }
    }
    // Tile tooltip: what's under the brush, bottom-right like the reference
    if (buildingNow && !holeWizard && owDragLastCell) {
        const tCell = worldCourse.grid[owDragLastCell.r]
            && worldCourse.grid[owDragLastCell.r][owDragLastCell.c];
        if (tCell !== undefined) {
            ctx.font = 'bold 11px -apple-system,sans-serif';
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            const ttTxt = (T_NAMES[tCell] || '?') + '  \u2022  brush ' + owBrushSize;
            const tw3 = ctx.measureText(ttTxt).width + 22;
            roundRect(W() - tw3 - 10, H() - 34, tw3, 24, 12);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillText(ttTxt, W() - 21, H() - 18);
        }
    }

    // ---- Floating green-fee popups over pins as golfers hole out ----
    if (window.__feePopups && window.__feePopups.length) {
        const now = performance.now();
        window.__feePopups = window.__feePopups.filter(p => now - p.t0 < 1500);
        for (const p of window.__feePopups) {
            const k = (now - p.t0) / 1500;
            const sp = (scene3dReady && typeof worldToScreen3D === 'function')
                ? worldToScreen3D(p.x, p.z) : null;
            if (!sp || sp.behind) continue;
            ctx.globalAlpha = 1 - k;
            ctx.font = 'bold 15px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.lineWidth = 3;
            const feeTxt = (p.tag ? p.tag + ' ' : '') + '+$' + (p.amt || 5);
            const fy3 = sp.y - 20 - k * 34 - (p.stack || 0) * 16;
            ctx.strokeText(feeTxt, sp.x, fy3);
            ctx.fillStyle = '#8be06a';
            ctx.fillText(feeTxt, sp.x, fy3);
            ctx.globalAlpha = 1;
        }
    }

    // ---- Score callouts (Birdie! / Bogey / ACE!!) as rounds finish ----
    if (window.__scorePopups && window.__scorePopups.length) {
        const now = performance.now();
        window.__scorePopups = window.__scorePopups.filter(p => now - p.t0 < 2200);
        for (const p of window.__scorePopups) {
            const k = (now - p.t0) / 2200;
            const sp = (scene3dReady && typeof worldToScreen3D === 'function')
                ? worldToScreen3D(p.x, p.z) : null;
            if (!sp || sp.behind) continue;
            // Pop in (overshoot scale), drift up, fade out at the end
            const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.55 : 1.15 - Math.min(0.15, (k - 0.12) * 0.5);
            ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
            ctx.textAlign = 'center';
            ctx.font = 'bold ' + Math.round(19 * pop) + 'px -apple-system,sans-serif';
            ctx.strokeStyle = 'rgba(0,0,0,0.65)';
            ctx.lineWidth = 4;
            const yy = sp.y - 46 - k * 26 - (p.stack || 0) * 34;
            ctx.strokeText(p.txt, sp.x, yy);
            ctx.fillStyle = p.col;
            ctx.fillText(p.txt, sp.x, yy);
            if (p.name) {
                ctx.font = 'bold 10px -apple-system,sans-serif';
                ctx.lineWidth = 3;
                ctx.strokeText(p.name, sp.x, yy + 13);
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                ctx.fillText(p.name, sp.x, yy + 13);
            }
            ctx.globalAlpha = 1;
        }
    }

    // ---- Floating name labels over golfers (reference-style). Gated by
    // zoom so a pulled-back view stays clean ----
    if (scene3dReady && typeof npcStates !== 'undefined'
        && typeof worldToScreen3D === 'function'
        && typeof cam3dDistance !== 'undefined' && cam3dDistance < 1700) {
        ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        const champName = resort.lastTourney && resort.lastTourney.winner;
        // Queued foursomes stack labels on top of each other — nudge
        // colliding labels up a line instead (up to three tiers)
        const placed = [];
        for (const s of npcStates) {
            if (!s.name) continue;
            const p = worldToScreen3D(s.x, s.z);
            if (!p || p.behind) continue;
            let ly = p.y - 26;
            for (let tier = 0; tier < 3; tier++) {
                const clash = placed.some(q =>
                    Math.abs(q.x - p.x) < 58 && Math.abs(q.y - ly) < 12);
                if (!clash) break;
                ly -= 13;
            }
            placed.push({ x: p.x, y: ly });
            const label = (s.name === champName ? '\u{1F451} ' : '') + s.name;
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.lineWidth = 3;
            ctx.strokeText(label, p.x, ly);
            ctx.fillStyle = s.name === champName ? '#ffd24a' : 'rgba(255,255,255,0.92)';
            ctx.fillText(label, p.x, ly);
        }
    }

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
    owNameRect = { x: L.pad + 2, y: 8, w: nameW + 12, h: 28 };
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px -apple-system,sans-serif';
    // Facilities are the working buildings in decor, not the dead
    // legacy array (which always read 0)
    const facN = (worldCourse.decor || []).filter(d =>
        d.t === 'kiosk' || d.t === 'stall' || d.t === 'clubhouse'
        || d.t === 'gazebo' || d.t === 'grandstand').length;
    const hN = worldCourse.holes.length;
    let subtitle = hN + (hN === 1 ? ' hole' : ' holes') + ' \u2022 '
        + facN + (facN === 1 ? ' facility' : ' facilities')
        + ' \u2022 build ' + BUILD_TAG;
    if (location.search.indexOf('fps=1') >= 0) {
        subtitle += ' \u2022 ' + Math.round(window.__fps || 0) + ' fps';
    }
    ctx.fillText(subtitle, L.pad + 6 + nameW + 12, 28);

    // Balance chip (top center) — gold glossy; tap for the finances panel
    const bpW = 124, bpH = 30;
    const bpX = (W() - bpW) / 2, bpY = (L.topBarH - bpH) / 2;
    owBalanceRect = { x: bpX, y: bpY, w: bpW, h: bpH };
    glossyRect(bpX, bpY, bpW, bpH, bpH / 2, '#d9a02a');
    ctx.fillStyle = '#231a05';
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('$ ' + Math.floor(resort.coins).toLocaleString(), W() / 2, bpY + bpH / 2 + 5);

    // Speed strip — pause / play / fast-forward, reference-style
    {
        const bs = 30, gap = 6;
        // Right-aligned just under the close/undo buttons — clear of the
        // build rail (left) and the camera strip (starts mid-screen)
        const sx0 = W() - L.pad - (bs * 3 + gap * 2), sy0 = L.topBarH + 8;
        const btns = [[0, '⏸'], [1, '▶'], [4, '⏩']];
        owSpeedRects = [];
        for (let i = 0; i < btns.length; i++) {
            const [spd, icon] = btns[i];
            const bx = sx0 + i * (bs + gap);
            glossyRect(bx, sy0, bs, bs, 9,
                gameSpeed === spd ? (spd === 0 ? '#b0483c' : '#3f7a4d') : '#2c3a42');
            ctx.fillStyle = gameSpeed === spd ? '#fff' : 'rgba(255,255,255,0.65)';
            ctx.font = '13px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(icon, bx + bs / 2, sy0 + bs / 2 + 5);
            owSpeedRects.push({ spd, x: bx, y: sy0, w: bs, h: bs });
        }
    }
    // Finances panel under the balance chip
    owFinancesRect = null;
    if (owFinancesOpen) {
        ensureLedger();
        const led = resort.ledger;
        const up = dailyUpkeep();
        const fw = 250;
        const hasStreak = resort.tourneyStreak > 1;
        const hasClubMul = (typeof clubhouseFeeMul === 'function')
            && clubhouseFeeMul() > 1;
        const fh = 146 + (hasStreak ? 18 : 0) + (hasClubMul ? 18 : 0);
        const fx = (W() - fw) / 2, fy = L.topBarH + 8;
        ctx.fillStyle = 'rgba(12,24,32,0.94)';
        roundRect(fx, fy, fw, fh, 12); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1;
        roundRect(fx, fy, fw, fh, 12); ctx.stroke();
        ctx.font = 'bold 11px -apple-system,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText('FINANCES', fx + 14, fy + 20);
        const line = (label, val, col, yy) => {
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = '11px -apple-system,sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(label, fx + 14, yy);
            ctx.fillStyle = col;
            ctx.font = 'bold 11px -apple-system,sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(val, fx + fw - 14, yy);
        };
        line("Today's income", '+$' + Math.round(led.income), '#8be06a', fy + 40);
        line("Today's expenses", '-$' + Math.round(led.expenses), '#e77d6a', fy + 56);
        line("Yesterday's income", '+$' + Math.round(led.prevIncome), '#8be06a', fy + 76);
        line("Yesterday's expenses", '-$' + Math.round(led.prevExpenses), '#e77d6a', fy + 92);
        line('Upkeep/day', '$' + up.total + '  (' + worldCourse.holes.length
            + ' holes + decor' + (up.amenities ? ' + clubhouse' : '') + ')',
            'rgba(255,255,255,0.8)', fy + 112);
        line('Lifetime', 'fees $' + (resort.feesEarned || 0)
            + (resort.tipsEarned ? ' (incl. $' + resort.tipsEarned + ' tips)' : '')
            + ' \u2022 stalls $'
            + (resort.stallSales || 0) + ' \u2022 purses $'
            + (resort.purseEarned || 0), 'rgba(255,255,255,0.8)', fy + 130);
        let extraY = fy + 148;
        if (hasClubMul) {
            line('\u{1F3E8} Clubhouse bonus', 'fees collect at '
                + Math.round(clubhouseFeeMul() * 100) + '%', '#81d4fa', extraY);
            extraY += 18;
        }
        if (hasStreak) {
            const pct = Math.min(10, resort.tourneyStreak - 1) * 8;
            line('\u{1F3C6} Tourney streak', resort.tourneyStreak
                + ' days \u2022 +' + pct + '% purse', '#ffd24a', extraY);
        }
        owFinancesRect = { x: fx, y: fy, w: fw, h: fh };
    }

    // Weather chip — the rain oscillator is deterministic, so this is a
    // true forecast: scan ahead for the next crossing and show when the
    // weather turns (1s of wind clock = 1 game minute)
    if (scene3dReady && typeof windClock !== 'undefined') {
        const wAt = (tt) => Math.sin(tt * 0.011) + Math.sin(tt * 0.0073);
        const t0 = windClock.value;
        const rainingNow = (typeof rainEnvNow !== 'undefined' && rainEnvNow > 0.25)
            || wAt(t0) > 1.15;
        let cross = null;
        for (let d = 15; d <= 7200; d += 15) {
            if ((wAt(t0 + d) > 1.15) !== rainingNow) { cross = d; break; }
        }
        const fmt = (m) => m >= 90 ? Math.round(m / 60) + 'h' : Math.round(m) + 'm';
        const rainbowNow = typeof rainbowUntil !== 'undefined'
            && rainbowUntil > performance.now();
        const wTxt = rainingNow
            ? '\u{1F327} clears in ' + (cross ? fmt(cross) : '?')
            : rainbowNow ? '\u{1F308} clearing skies'
            : (cross && cross <= 300 ? '\u26C5 rain in ' + fmt(cross)
                                     : '\u2600\uFE0F clear skies');
        ctx.font = 'bold 11px -apple-system,sans-serif';
        const ww = ctx.measureText(wTxt).width + 24;
        const wx = W() - L.pad - (30 * 3 + 6 * 2) - 10 - ww;
        glossyRect(wx, L.topBarH + 8, ww, 30, 15, rainingNow ? '#3a5876' : '#2c3a42');
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(wTxt, wx + ww / 2, L.topBarH + 27);
        owWeatherRect = { x: wx, y: L.topBarH + 8, w: ww, h: 30 };
        // Tap-open forecast: the next few rain windows with durations
        if (owWeatherOpen) {
            const windows = [];
            let inRain = wAt(t0) > 1.15, start = null;
            for (let d = 15; d <= 14400 && windows.length < 3; d += 15) {
                const r = wAt(t0 + d) > 1.15;
                if (r && !inRain) start = d;
                if (!r && inRain && start == null && windows.length === 0) {
                    windows.push({ from: 0, len: d }); // current rain ending
                }
                if (!r && inRain && start != null) {
                    windows.push({ from: start, len: d - start });
                    start = null;
                }
                inRain = r;
            }
            const fw2 = 190, fh2 = 26 + Math.max(windows.length, 1) * 18 + 8;
            const fx2 = Math.min(wx, W() - fw2 - 8), fy2 = L.topBarH + 44;
            ctx.fillStyle = 'rgba(12,24,32,0.94)';
            roundRect(fx2, fy2, fw2, fh2, 10); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = 'bold 9px -apple-system,sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('RAIN FORECAST', fx2 + 12, fy2 + 17);
            const fmt2 = (m) => m >= 90 ? Math.round(m / 60) + 'h' : Math.round(m) + 'm';
            if (!windows.length) {
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.font = '10px -apple-system,sans-serif';
                ctx.fillText('Clear for the next day \u2600\uFE0F', fx2 + 12, fy2 + 34);
            }
            windows.forEach((wnd, i) => {
                ctx.fillStyle = '#9fd6ff';
                ctx.font = '10px -apple-system,sans-serif';
                ctx.fillText(wnd.from === 0
                    ? '\u{1F327} now \u2014 ends in ' + fmt2(wnd.len)
                    : '\u{1F327} in ' + fmt2(wnd.from) + ' \u2022 lasts ' + fmt2(wnd.len),
                    fx2 + 12, fy2 + 34 + i * 18);
            });
            owWeatherPanelRect = { x: fx2, y: fy2, w: fw2, h: fh2 };
        } else {
            owWeatherPanelRect = null;
        }
        // Tournament countdown chip when tee-off is under 3 game-hours out
        // (suppressed while the roster panel occupies that corner)
        if (!window.__tourney && worldCourse.holes.length && !owRosterOpen) {
            const mod = Math.floor((resort.worldClock || 0) % 1440);
            const until = (720 - mod + 1440) % 1440;
            if (until > 0 && until <= 180) {
                ctx.font = 'bold 11px -apple-system,sans-serif';
                const tTxt = '\u{1F3C6} tee-off in '
                    + (until >= 90 ? Math.round(until / 60) + 'h' : until + 'm');
                const tw2 = ctx.measureText(tTxt).width + 24;
                const tx2 = W() - L.pad - (30 * 3 + 6 * 2) - 10 - tw2;
                glossyRect(tx2, L.topBarH + 42, tw2, 30, 15, '#8a6d1d');
                ctx.fillStyle = '#fff';
                ctx.fillText(tTxt, tx2 + tw2 / 2, L.topBarH + 61);
            }
        }
    }

    // Paused banner, center-top like the reference
    if (gameSpeed === 0) {
        ctx.font = 'bold 13px -apple-system,sans-serif';
        const pw = ctx.measureText('GAME PAUSED').width + 44;
        glossyRect((W() - pw) / 2, L.topBarH + 46, pw, 28, 14, '#20535e');
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('GAME PAUSED', W() / 2, L.topBarH + 65);
    }

    // Tournament banner — live leader while the daily event runs
    if (window.__tourney) {
        const entries = Object.entries(window.__tourney.board)
            .sort((a, b) => (a[1].rel / a[1].n) - (b[1].rel / b[1].n));
        let tTxt = '\u{1F3C6} ' + tourneyTitle().toUpperCase();
        if (entries.length) {
            // Rotate through the top three every few seconds
            const top = entries.slice(0, 3);
            const idx = Math.floor(performance.now() / 2600) % top.length;
            const [nm, tb] = top[idx];
            const rel = tb.rel / tb.n;
            const place = ['leads', '2nd', '3rd'][idx];
            tTxt += ' • ' + nm + ' ' + place + ' ('
                + (rel <= 0 ? '' : '+') + rel.toFixed(1) + ')';
        } else {
            tTxt += ' • first scores coming in…';
        }
        ctx.font = 'bold 11px -apple-system,sans-serif';
        const tw = ctx.measureText(tTxt).width + 24;
        glossyRect((W() - tw) / 2, L.topBarH + 8, tw, 24, 12, '#8a6d1d');
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(tTxt, W() / 2, L.topBarH + 24);
    }

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

        // Golfer roster chip — how many named golfers are out playing.
        // Tap toggles the roster panel below.
        const onCourse = (typeof npcStates !== 'undefined')
            ? npcStates.filter(s => s.name) : [];
        const rLabel = '⛳ ' + onCourse.length;
        const rw = ctx.measureText(rLabel).width + 26;
        const rx0 = cx0 - 10 - rw;
        glossyRect(rx0, L.undoY + 3, rw, 30, 15, owRosterOpen ? '#3f7a4d' : '#2c3a42');
        ctx.fillStyle = '#fff';
        ctx.fillText(rLabel, rx0 + rw / 2, L.undoY + 23);
        owRosterChip = { x: rx0, y: L.undoY + 3, w: rw, h: 30 };

        // Complaint badge — angry-face count; tap pans to the oldest gripe
        const cmpl = worldCourse.complaints || [];
        if (cmpl.length) {
            const bLabel = '\u{1F4A2} ' + cmpl.length;
            const bw = ctx.measureText(bLabel).width + 26;
            const bx0 = rx0 - 10 - bw;
            glossyRect(bx0, L.undoY + 3, bw, 30, 15, '#8e2f28');
            ctx.fillStyle = '#fff';
            ctx.fillText(bLabel, bx0 + bw / 2, L.undoY + 23);
            owComplaintChip = { x: bx0, y: L.undoY + 3, w: bw, h: 30 };
        } else {
            owComplaintChip = null;
        }

        // Roster panel — everyone on the course and how their round is going
        if (owRosterOpen) {
            const rows = onCourse.slice(0, 8);
            // Course report: aggregate every recorded round for a
            // two-line summary under the header (skipped until data)
            let crText1 = null, crText2 = null;
            {
                let totN = 0, totSum = 0, totPar = 0, busiest = null;
                for (const [hid, st] of Object.entries(worldCourse.holeStats || {})) {
                    totN += st.n;
                    totSum += st.sum;
                    const rec3 = worldCourse.holes.find(h => h.id === +hid);
                    totPar += (rec3 ? (rec3.par || 4) : 4) * st.n;
                    if (!busiest || st.n > busiest.n) busiest = { id: hid, n: st.n };
                }
                if (totN > 0) {
                    const rel = (totSum - totPar) / totN;
                    crText1 = '\u{1F4CA} ' + totN.toLocaleString() + ' rounds \u2022 avg '
                        + (rel >= 0 ? '+' : '') + rel.toFixed(1) + ' vs par';
                    const cmpN = (worldCourse.complaints || []).length;
                    const bRec = busiest && worldCourse.holes.find(h => h.id === +busiest.id);
                    crText2 = '\u{1F525} busiest: '
                        + ((bRec && bRec.name) || ('Hole ' + busiest.id))
                        + (cmpN ? ' \u2022 \u{1F4A2} ' + cmpN + ' open complaint'
                            + (cmpN === 1 ? '' : 's') : '');
                }
            }
            const pw = 258, rowH = 30, headH = crText1 ? 64 : 34;
            // Hall of fame: up to 3 recent champions (1 when the roster is
            // long, so the panel always fits a phone screen)
            const champs = (resort.tourneyHistory || (resort.lastTourney ? [resort.lastTourney] : []))
                .slice(0, rows.length >= 7 ? 1 : 3);
            const footH = champs.length ? 14 + champs.length * 16 : 0;
            const moreH = onCourse.length > 8 ? 14 : 0;
            const ph = headH + Math.max(rows.length, 1) * rowH + footH
                + moreH + 10;
            // Clear of the right-edge camera rail (which draws after us)
            const px = Math.min(rx0, W() - pw - 54);
            const py = L.undoY + 40;
            ctx.fillStyle = 'rgba(12,22,28,0.92)';
            roundRect(px, py, pw, ph, 12); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.14)';
            ctx.lineWidth = 1;
            roundRect(px, py, pw, ph, 12); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = 'bold 11px -apple-system,sans-serif';
            ctx.textAlign = 'left';
            const walkers = (typeof npcWalkerCount !== 'undefined') ? npcWalkerCount : 0;
            ctx.fillText('ON THE COURSE \u2014 ' + onCourse.length + ' playing'
                + (walkers ? ' \u2022 ' + walkers + ' visiting' : ''), px + 14, py + 21);
            if (crText1) {
                ctx.fillStyle = '#ffd24a';
                ctx.font = 'bold 10px -apple-system,sans-serif';
                ctx.fillText(crText1, px + 14, py + 38);
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.font = '10px -apple-system,sans-serif';
                ctx.fillText(crText2, px + 14, py + 52);
            }
            owRosterChip.skipNight = null;
            if (!rows.length) {
                const hrR = (((resort.worldClock || 0) / 60) % 24 + 24) % 24;
                const closed = hrR >= 21 || hrR < 5.5;
                if (closed) {
                    // A tappable shortcut through the quiet hours
                    glossyRect(px + 12, py + headH + 2, pw - 24, 26, 13, '#3a4d6b');
                    ctx.fillStyle = '#cfe3ff';
                    ctx.font = 'bold 11px -apple-system,sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('\u{1F319} Course closed \u2014 tap to skip to 6 AM',
                        px + pw / 2, py + headH + 19);
                    ctx.textAlign = 'left';
                    owRosterChip.skipNight = { x: px + 12, y: py + headH + 2,
                        w: pw - 24, h: 26 };
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,0.5)';
                    ctx.font = '12px -apple-system,sans-serif';
                    ctx.fillText('No golfers out — build more holes!',
                        px + 14, py + headH + 18);
                }
            }
            owRosterChip.rows = [];
            for (let i = 0; i < rows.length; i++) {
                const s = rows[i];
                const ry = py + headH + i * rowH;
                owRosterChip.rows.push({ name: s.name, x: px, y: ry, w: pw, h: rowH });
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 12px -apple-system,sans-serif';
                ctx.textAlign = 'left';
                const isHolder = Object.values(worldCourse.holeStats || {})
                    .some(st => st.bestBy === s.name);
                // Mood face up front: happy, neutral, or miserable —
                // who's struggling reads at a glance
                const face = s.mood == null ? ''
                    : s.mood >= 65 ? '\u{1F600} '
                    : s.mood >= 35 ? '\u{1F610} ' : '\u{1F61E} ';
                ctx.fillText(face + s.name + (isHolder ? ' \u{1F3C5}' : ''),
                    px + 14, ry + 19);
                ctx.fillStyle = (s.mood != null && s.mood < 35)
                    ? 'rgba(240,140,120,0.85)' : 'rgba(255,255,255,0.55)';
                ctx.font = '11px -apple-system,sans-serif';
                ctx.textAlign = 'right';
                const car2 = (worldCourse.golferCareers || {})[s.name];
                // Live activity: snack runs, strolls to the next tee, and
                // early exits read as themselves instead of 'tee'
                const act = s.leaving ? 'heading home'
                    : s.detour ? '\u{1F964} snack run'
                    : s.returning ? 'walking in'
                    : (s.strokes ? s.strokes + ' str' : 'tee');
                const prog = 'H' + s.holeId + ' • ' + act
                    + (car2 && car2.best != null
                        ? ' • best ' + car2.best : '');
                let progRight = px + pw - 14;
                // Last-round chip: score vs par in sparkline colors
                if (s.lastRel != null) {
                    const relTxt = s.lastRel === 0 ? 'E'
                        : s.lastRel > 0 ? '+' + s.lastRel : '' + s.lastRel;
                    const cw = 26;
                    const col = s.lastRel < 0 ? '#3f7a3a'
                        : s.lastRel === 0 ? '#5b6c80'
                        : s.lastRel === 1 ? '#8a6a30' : '#8e3f30';
                    glossyRect(px + pw - 14 - cw, ry + 5, cw, 18, 9, col);
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 10px -apple-system,sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(relTxt, px + pw - 14 - cw / 2, ry + 18);
                    progRight = px + pw - 20 - cw;
                    ctx.fillStyle = (s.mood != null && s.mood < 35)
                        ? 'rgba(240,140,120,0.85)' : 'rgba(255,255,255,0.55)';
                    ctx.font = '11px -apple-system,sans-serif';
                    ctx.textAlign = 'right';
                }
                ctx.fillText(prog, progRight, ry + 19);
            }
            if (onCourse.length > rows.length) {
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.font = '10px -apple-system,sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('+ ' + (onCourse.length - rows.length)
                    + ' more out on the course', px + 14,
                    py + headH + rows.length * rowH + 4);
            }
            if (champs.length) {
                let fy = py + headH + Math.max(rows.length, 1) * rowH + 12
                    + (onCourse.length > rows.length ? 14 : 0);
                ctx.fillStyle = 'rgba(255,255,255,0.45)';
                ctx.font = 'bold 9px -apple-system,sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('CHAMPIONS', px + 14, fy);
                fy += 14;
                champs.forEach((lt, ci) => {
                    ctx.fillStyle = ci === 0 ? '#ffd24a' : 'rgba(255,210,74,0.6)';
                    ctx.font = (ci === 0 ? 'bold ' : '') + '10px -apple-system,sans-serif';
                    ctx.fillText((ci === 0 ? '\u{1F451}' : '\u{1F3C6}') + ' Day '
                        + lt.day + '  ' + lt.winner + '  (' + lt.rel + ')'
                        + (lt.title ? ' \u2022 ' + lt.title : ''), px + 14, fy);
                    owRosterChip.rows.push({ name: lt.winner, x: px, y: fy - 12,
                        w: pw, h: 16 });
                    fy += 16;
                });
            }
            owRosterChip.panel = { x: px, y: py, w: pw, h: ph };
        } else if (owRosterChip) {
            owRosterChip.panel = null;
        }
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

    // ---- Minimap toggle chip + map (bottom-left) ----
    owMiniBtnRect = null;
    owMiniRect = null;
    if (!holeWizard) {
        const bs2 = 34;
        const bx2 = 12, by2 = H() - 12 - bs2;
        glossyRect(bx2, by2, bs2, bs2, 10, owMinimapOn ? '#3f7a4d' : '#2c3a42');
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = '16px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('\u{1F5FA}', bx2 + bs2 / 2, by2 + bs2 / 2 + 6);
        owMiniBtnRect = { x: bx2, y: by2, w: bs2, h: bs2 };
        // Mute chip: every synth routes through audioMaster, one switch
        const mx3 = bx2 + bs2 + 8;
        glossyRect(mx3, by2, bs2, bs2, 10, audioMuted ? '#7a3b30' : '#2c3a42');
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = '15px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(audioMuted ? '\u{1F507}' : '\u{1F50A}',
            mx3 + bs2 / 2, by2 + bs2 / 2 + 6);
        owMuteBtnRect = { x: mx3, y: by2, w: bs2, h: bs2 };
        if (owMinimapOn && !owRailOpen) {
            ensureMiniCanvas();
            const mw = Math.min(190, Math.floor(W() * 0.22));
            const mh = Math.round(mw * worldCourse.rows / worldCourse.cols);
            const mx = 12, my = by2 - 8 - mh;
            ctx.save();
            roundRect(mx - 3, my - 3, mw + 6, mh + 6, 10);
            ctx.fillStyle = 'rgba(10,22,30,0.85)';
            ctx.fill();
            roundRect(mx, my, mw, mh, 7);
            ctx.clip();
            ctx.drawImage(owMiniCanvas, mx, my, mw, mh);
            // Hole pins as dots
            for (const hrec of worldCourse.holes) {
                ctx.fillStyle = hrec.open === false ? '#9e9e9e' : '#ff5252';
                ctx.beginPath();
                ctx.arc(mx + (hrec.pin.x + 0.5) / worldCourse.cols * mw,
                        my + (hrec.pin.y + 0.5) / worldCourse.rows * mh,
                        2.5, 0, Math.PI * 2);
                ctx.fill();
            }
            // Day/night: the map darkens with the world clock, and the
            // path lamps glow as warm dots after lighting-up time
            {
                const hr2 = (((resort.worldClock || 0) / 60) % 24 + 24) % 24;
                let dark = 0;
                if (hr2 < 5.5 || hr2 >= 20.5) dark = 1;
                else if (hr2 < 7) dark = (7 - hr2) / 1.5;
                else if (hr2 >= 19) dark = (hr2 - 19) / 1.5;
                dark = Math.max(0, Math.min(1, dark));
                if (dark > 0.02) {
                    ctx.fillStyle = 'rgba(10,16,44,' + (0.5 * dark).toFixed(3) + ')';
                    ctx.fillRect(mx, my, mw, mh);
                }
                if (dark > 0.3) {
                    ctx.fillStyle = 'rgba(255,204,110,'
                        + (0.9 * dark).toFixed(3) + ')';
                    for (const lp of owMiniLamps) {
                        ctx.beginPath();
                        ctx.arc(mx + (lp.c + 0.5) / worldCourse.cols * mw,
                                my + (lp.r + 0.5) / worldCourse.rows * mh,
                                1.6, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
            // Live layer: golfers as colored dots, complaints as pins
            if (typeof npcStates !== 'undefined') {
                for (const gs of npcStates) {
                    if (!gs.name) continue;
                    ctx.fillStyle = '#ffe082';
                    ctx.beginPath();
                    ctx.arc(mx + gs.x / (worldCourse.cols * CELL) * mw,
                            my + gs.z / (worldCourse.rows * CELL) * mh,
                            1.8, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            const cmPulse = 1.8 + Math.abs(Math.sin(Date.now() / 320)) * 1.3;
            for (const cm2 of (worldCourse.complaints || [])) {
                ctx.fillStyle = cm2.kind === 'freakout' ? '#ff5252' : '#ffb74d';
                ctx.beginPath();
                ctx.arc(mx + (cm2.x + 0.5) / worldCourse.cols * mw,
                        my + (cm2.y + 0.5) / worldCourse.rows * mh,
                        cmPulse, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }
            // Camera pivot: dot + a wedge pointing along the view yaw
            if (typeof cam3dPivotX !== 'undefined') {
                const px2 = mx + cam3dPivotX / (worldCourse.cols * CELL) * mw;
                const pz2 = my + cam3dPivotZ / (worldCourse.rows * CELL) * mh;
                const yw = (typeof cam3dYaw !== 'undefined') ? cam3dYaw : 0;
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.beginPath();
                ctx.arc(px2, pz2, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.65)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(px2, pz2);
                ctx.lineTo(px2 - Math.sin(yw) * 11, pz2 - Math.cos(yw) * 11);
                ctx.stroke();
            }
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1;
            roundRect(mx, my, mw, mh, 7);
            ctx.stroke();
            owMiniRect = { x: mx, y: my, w: mw, h: mh };
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
                    const FL = flyoutColsLayout(pi, list, L);
                    for (let li = 0; li < list.length; li++) {
                        const entry = list[li];
                        const fx = L.flyX + Math.floor(li / FL.perCol) * (L.flyW + 8);
                        const fy = FL.fy0 + (li % FL.perCol) * (L.flyH + L.flyGap);
                        if (parent.flyout === 'sizes') {
                            const active = entry === owBrushSize;
                            glossyRect(fx, fy, L.flyW, L.flyH, 10,
                                       active ? '#1976d2' : '#2c3a42',
                                       active ? { stroke: 'rgba(255,255,255,0.75)' } : undefined);
                            ctx.textAlign = 'center';
                            ctx.fillStyle = '#fff';
                            ctx.font = (active ? 'bold ' : '') + '14px -apple-system,sans-serif';
                            ctx.fillText(entry + ' \u00D7 ' + entry, fx + L.flyW / 2, fy + L.flyH / 2 + 5);
                        } else {
                            const tool = OW_TOOLS.find(t => t.id === entry);
                            const active = owTool === entry;
                            glossyRect(fx, fy, L.flyW, L.flyH, 10,
                                       active ? tool.color : '#2c3a42',
                                       active ? { stroke: 'rgba(255,255,255,0.75)' } : undefined);
                            ctx.textAlign = 'left';
                            ctx.fillStyle = '#fff';
                            ctx.font = '15px -apple-system,sans-serif';
                            ctx.fillText(tool.icon, fx + 10, fy + L.flyH / 2 + 6);
                            ctx.font = (active ? 'bold ' : '') + '12px -apple-system,sans-serif';
                            const priceTag = tool.decor && DECOR_COSTS[tool.decor]
                                ? '  $' + DECOR_COSTS[tool.decor] : '';
                            ctx.fillText(tool.label + priceTag, fx + 36, fy + L.flyH / 2 + 4);
                            // Placed-count badge for decor you already own
                            if (tool.decor && worldCourse.decor) {
                                const n = worldCourse.decor.reduce(
                                    (a, d) => a + (d.t === tool.decor ? 1 : 0), 0);
                                if (n > 0) {
                                    ctx.textAlign = 'right';
                                    ctx.fillStyle = 'rgba(140,220,160,0.9)';
                                    ctx.font = 'bold 10px -apple-system,sans-serif';
                                    ctx.fillText('\u00D7' + n, fx + L.flyW - 8,
                                        fy + L.flyH / 2 + 4);
                                    ctx.textAlign = 'left';
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ---- Hole inspector card (top right, GolfTopia-style) ----
    // ---- Facility inspector card: a vendor's daily + lifetime books ----
    owFacilityCardRect = null;
    if (owSelectedFacility != null && !holeWizard) {
        const fd = worldCourse.decor && worldCourse.decor[owSelectedFacility];
        if (!fd || (fd.t !== 'kiosk' && fd.t !== 'stall')) {
            owSelectedFacility = null;
        } else {
            const w0 = 216, h0 = 148;
            const x0 = W() - w0 - 10, y0 = 58;
            ctx.fillStyle = 'rgba(16,28,40,0.95)';
            roundRect(x0, y0, w0, h0, 14); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.lineWidth = 1.5;
            roundRect(x0, y0, w0, h0, 14); ctx.stroke();
            glossyRect(x0 + 3, y0 + 3, w0 - 6, 26, 11, '#7a5a24');
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px -apple-system,sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(fd.t === 'kiosk' ? '\u{1F964} Drinks Kiosk'
                : '\u{1F32D} Snack Stall', x0 + 14, y0 + 21);
            const rows2 = [
                ['Sales today', (fd.salesToday || 0) + ' \u2022 $' + (fd.revToday || 0)],
                ['Lifetime', (fd.salesLife || 0) + ' \u2022 $' + (fd.revLife || 0)]
            ];
            // Busiest hour from the per-hour sale histogram
            if (fd.hourHist) {
                let bh = -1, bn = 0;
                for (const [h2, n2] of Object.entries(fd.hourHist)) {
                    if (n2 > bn) { bn = n2; bh = +h2; }
                }
                if (bh >= 0) {
                    const ap2 = bh >= 12 ? 'PM' : 'AM';
                    rows2.push(['Busiest hour',
                        (((bh + 11) % 12) + 1) + ' ' + ap2]);
                }
            }
            let ry2 = y0 + 50;
            for (const [lab, val] of rows2) {
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.font = '11px -apple-system,sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(lab, x0 + 14, ry2);
                ctx.textAlign = 'right';
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 11px -apple-system,sans-serif';
                ctx.fillText(val, x0 + w0 - 14, ry2);
                ry2 += 24;
            }
            if (!(fd.salesLife > 0)) {
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.font = '10px -apple-system,sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('No sales yet \u2014 golfers buy between rounds',
                    x0 + 14, ry2);
            }
            owFacilityCardRect = { x: x0, y: y0, w: w0, h: h0 };
        }
    }


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
            const isOpen = selHole.open !== false;
            glossyRect(hc.x + 3, hc.y + 3, hc.w - 6, 26, 11,
                isOpen ? '#2e7d32' : '#78542a');
            ctx.textAlign = 'left';
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px -apple-system,sans-serif';
            ctx.fillText((selHole.name || ('Hole ' + selHole.id)) + '  \u270E',
                hc.x + 14, hc.y + 21);
            // Tappable status chip toggles the hole open/closed
            ctx.fillStyle = isOpen ? 'rgba(27,94,32,0.95)' : 'rgba(183,28,28,0.95)';
            roundRect(hc.x + hc.w - 68, hc.y + 6, 58, 20, 10);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 1;
            roundRect(hc.x + hc.w - 68, hc.y + 6, 58, 20, 10);
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(isOpen ? 'OPEN' : 'CLOSED', hc.x + hc.w - 39, hc.y + 20);
            // Reference-style stat rows: label left, value right, bar fill
            const yds = Math.round(polylineLengthYards(selHole));
            const diff = holeDifficulty(selHole);
            // Open complaints pinned to this hole flag its difficulty row
            const cmpN = (worldCourse.complaints || [])
                .filter(c => c.holeId === selHole.id).length;
            const rows = [
                ['Par', String(selHole.par), Math.min(1, selHole.par / 5), '#66bb6a'],
                ['Length', yds + ' yds', Math.min(1, yds / 550), '#42a5f5'],
                ['Difficulty', '★'.repeat(diff) + '☆'.repeat(5 - diff)
                    + (cmpN >= 2 ? '  \u{1F4A2}' + cmpN : ''), diff / 5,
                 cmpN >= 2 ? '#ef5350'
                     : diff <= 2 ? '#66bb6a' : diff <= 3 ? '#f0a860' : '#ef5350']
            ];
            // Measured reality: what the physics sim says an average
            // golfer actually shoots here (design pillar made visible)
            if (selHole.simAvg != null) {
                const overPar = selHole.simAvg - selHole.par;
                rows.push(['Sim average', selHole.simAvg + ' strokes',
                    Math.min(1, selHole.simAvg / 8),
                    overPar <= 0.7 ? '#66bb6a'
                        : overPar <= 1.5 ? '#f0a860' : '#ef5350']);
            }
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
            // Play record from ambient rounds — how the hole ACTUALLY plays
            {
                const st = (worldCourse.holeStats || {})[selHole.id];
                ctx.textAlign = 'left';
                ctx.font = '10px -apple-system,sans-serif';
                if (st && st.n) {
                    const avg = (st.sum / st.n).toFixed(1);
                    const pct = Math.round(100 * st.sub / st.n);
                    ctx.fillStyle = '#ffd24a';
                    ctx.font = 'bold 10px -apple-system,sans-serif';
                    ctx.fillText('Avg ' + avg + ' • ' + pct + '% under par • '
                        + st.n + ' rounds', hc.x + 14, ry);
                    if (st.best != null) {
                        ctx.fillStyle = 'rgba(255,255,255,0.6)';
                        ctx.font = '9px -apple-system,sans-serif';
                        ctx.fillText('\u{1F3C5} Record: ' + st.best + ' \u2014 '
                            + (st.bestBy || '?'), hc.x + 14, ry + 12);
                        owRecordLineRect = { x: hc.x + 10, y: ry + 2,
                            w: hc.w - 20, h: 14, name: st.bestBy };
                    } else {
                        owRecordLineRect = null;
                    }
                    // Sparkline: last dozen rounds, one bar each — green
                    // under par, white par, amber bogey, red worse; taller
                    // means further from par
                    if (st.recent && st.recent.length) {
                        const base = ry + 28;
                        for (let si = 0; si < st.recent.length; si++) {
                            const rel = st.recent[si];
                            const bh = 4 + Math.min(3, Math.abs(rel)) * 2.5;
                            ctx.fillStyle = rel < 0 ? '#8be06a'
                                : rel === 0 ? 'rgba(255,255,255,0.7)'
                                : rel === 1 ? '#f0a860' : '#e77d6a';
                            ctx.fillRect(hc.x + 14 + si * 8, base - bh, 6, bh);
                        }
                    }
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,0.35)';
                    ctx.fillText('No rounds played yet', hc.x + 14, ry);
                }
            }
            // Flyover button
            const flyGrad = ctx.createLinearGradient(hc.flyX, hc.flyY, hc.flyX + hc.flyW, hc.flyY);
            flyGrad.addColorStop(0, '#0097a7');
            flyGrad.addColorStop(1, '#006064');
            ctx.fillStyle = flyGrad;
            roundRect(hc.flyX, hc.flyY, hc.flyW, hc.flyH, hc.flyH / 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 13px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('\u{1F3A5} Flyover', hc.flyX + hc.flyW / 2, hc.flyY + hc.flyH / 2 + 5);
            // Edit layout: reopen the wizard on this hole's line
            glossyRect(hc.editX, hc.editY, hc.editW, hc.editH, 10, '#5d4a8f');
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('\u270E', hc.editX + hc.editW / 2, hc.editY + hc.editH / 2 + 5);
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

    // ---- Golfer inspector panel (right side, like the hole card) ----
    if (owSelectedGolfer && !holeWizard) {
        const gs = (scene3dReady && typeof npcStates !== 'undefined')
            ? npcStates.find(n => n.name === owSelectedGolfer) : null;
        if (!gs) {
            owSelectedGolfer = null; // golfer despawned on a rebuild
        } else {
            drawGolferPanel(gs);
            // Selection beam: teal shaft of light over the selected golfer
            const bp = worldToScreen3D(gs.x, gs.z);
            if (bp && !bp.behind) {
                const grad = ctx.createLinearGradient(0, bp.y - 110, 0, bp.y - 6);
                grad.addColorStop(0, 'rgba(58,219,232,0)');
                grad.addColorStop(1, 'rgba(58,219,232,0.55)');
                ctx.fillStyle = grad;
                ctx.fillRect(bp.x - 5, bp.y - 110, 10, 104);
                ctx.strokeStyle = 'rgba(58,219,232,0.8)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.ellipse(bp.x, bp.y, 14, 6, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
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
let owComplaintRects = []; // tappable complaint pins, rebuilt per frame
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
// Focus the camera on a golfer chosen from a list (roster, champions,
// record line) — direct taps already have them on screen
function focusGolfer(name) {
    const s = (typeof npcStates !== 'undefined')
        ? npcStates.find(n => n.name === name) : null;
    if (!s || typeof setCameraOrbit !== 'function') return;
    const dist = (typeof cam3dDistance !== 'undefined')
        ? Math.min(cam3dDistance, 1000) : 900;
    const pitch = (typeof cam3dPitch !== 'undefined') ? cam3dPitch : Math.PI / 180 * 52;
    const yaw = (typeof cam3dYaw !== 'undefined') ? cam3dYaw : 0;
    setCameraOrbit(s.x, s.z + 30, dist, pitch, yaw);
}

// ---- Golfer inspector (reference-style right panel) ----
function golferPanelLayout() {
    const w = 232, h = 312;
    return { x: W() - w - 10, y: 58, w, h };
}

// Skills are innate per golfer — a stable hash of the name keeps them
// consistent across sessions with zero saved state
function golferSkills(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return [['Driver', h % 6], ['Irons', (h >>> 3) % 6],
            ['Putter', (h >>> 6) % 6], ['Recovery', (h >>> 9) % 6]];
}

function drawGolferPanel(s) {
    const gp = golferPanelLayout();
    ctx.fillStyle = 'rgba(16,28,40,0.95)';
    roundRect(gp.x, gp.y, gp.w, gp.h, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    roundRect(gp.x, gp.y, gp.w, gp.h, 14); ctx.stroke();
    glossyRect(gp.x + 3, gp.y + 3, gp.w - 6, 26, 11, '#2e7d32');
    // Follow toggle in the header corner
    glossyRect(gp.x + gp.w - 34, gp.y + 5, 26, 22, 8,
        owFollowGolfer ? '#1976d2' : 'rgba(0,0,0,0.25)');
    ctx.font = '12px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('\u{1F4CD}', gp.x + gp.w - 21, gp.y + 21);
    owFollowRect = { x: gp.x + gp.w - 34, y: gp.y + 5, w: 26, h: 22 };
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    const isChamp = resort.lastTourney && resort.lastTourney.winner === s.name;
    ctx.fillText((isChamp ? '\u{1F451} ' : '') + s.name, gp.x + gp.w / 2, gp.y + 21);
    const lx = gp.x + 13, rx = gp.x + gp.w - 13;
    let y = gp.y + 45;
    const row = (label, val) => {
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '11px -apple-system,sans-serif';
        ctx.fillText(label, lx, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px -apple-system,sans-serif';
        ctx.fillText(val, rx, y);
        y += 16;
    };
    const task = s.leaving ? 'Heading home'
        : s.detour ? 'Buying a ' + (s.detour.need === 'thirst' ? 'drink' : 'snack')
        : s.returning ? 'Walking to the tee'
        : s.pause > 0 && s.ptIdx >= s.route.length - 1 ? 'Celebrating'
        : s.pause > 0 ? 'Hitting' : 'Walking to ball';
    row('Hole ' + s.holeId + '  •  Stroke ' + ((s.strokes || 0) + 1), task);
    // Slim tee-to-pin progress bar under the first row
    if (s.route && s.route.length > 1) {
        const prog = Math.min(1, s.ptIdx / (s.route.length - 1));
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        roundRect(lx, y - 12, gp.w - 26, 3, 1.5); ctx.fill();
        ctx.fillStyle = '#3adbe8';
        roundRect(lx, y - 12, (gp.w - 26) * prog, 3, 1.5); ctx.fill();
    }
    {
        const car = (worldCourse.golferCareers || {})[s.name];
        // Two facts share one row: keep both short enough that they
        // never collide on the phone-width panel
        row('Today: ' + (s.rounds || 0)
            + (s.lastRound ? ' (last ' + s.lastRound + ')' : ''),
            car ? 'Career ' + car.rounds + ' \u2022 best ' + car.best
                : 'First round');
    }
    const tierName = s.tier === 'gold' ? 'Gold ★★' : s.tier === 'silver' ? 'Silver ★' : 'Basic';
    row('Membership: ' + tierName, 'Freakouts: ' + (s.freakouts || 0));
    {
        const held = Object.entries(worldCourse.holeStats || {})
            .filter(([, st]) => st.bestBy === s.name)
            .map(([id, st]) => 'H' + id + ' (' + st.best + ')');
        if (held.length) {
            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffd24a';
            ctx.font = 'bold 10px -apple-system,sans-serif';
            ctx.fillText('\u{1F3C5} Record holder: ' + held.join(', ').slice(0, 34), lx, y);
            y += 14;
        }
    }
    y += 4;
    // Skill bars, levels 0-5; the signature (highest) skill gets a star
    const skills = golferSkills(s.name);
    const bestLvl = Math.max(...skills.map(p => p[1]));
    for (const [label, lvl] of skills) {
        const signature = lvl === bestLvl && bestLvl > 0;
        ctx.textAlign = 'left';
        ctx.fillStyle = signature ? 'rgba(255,220,120,0.9)' : 'rgba(255,255,255,0.55)';
        ctx.font = signature ? 'bold 10px -apple-system,sans-serif'
                             : '10px -apple-system,sans-serif';
        ctx.fillText(label + ' skill' + (signature ? ' \u2B50' : ''), lx, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.fillText('Lv ' + lvl, rx, y);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        roundRect(lx, y + 4, gp.w - 26, 4, 2); ctx.fill();
        ctx.fillStyle = '#42a5f5';
        if (lvl) { roundRect(lx, y + 4, (gp.w - 26) * lvl / 5, 4, 2); ctx.fill(); }
        y += 15;
    }
    y += 4;
    // Needs drift up with time on the course (2x2 mini grid)
    const age = s.age || 0;
    const needs = [
        ['Hunger', Math.round(s.hunger || 0)],
        ['Thirst', Math.round(s.thirst || 0)],
        ['Fatigue', Math.min(90, Math.round(3 + age * 0.4))],
        ['Boredom', Math.min(60, Math.round(age * 0.15))]
    ];
    for (let n = 0; n < needs.length; n += 2) {
        for (let c = 0; c < 2; c++) {
            const [label, pct] = needs[n + c];
            const nx = lx + c * ((gp.w - 26) / 2 + 4);
            const critical = pct > 75;
            const pulse = critical
                ? 0.6 + 0.4 * Math.sin(performance.now() / 180) : 1;
            ctx.textAlign = 'left';
            ctx.fillStyle = critical
                ? 'rgba(240,120,100,' + (0.6 + 0.4 * pulse) + ')'
                : 'rgba(255,255,255,0.55)';
            ctx.font = critical ? 'bold 10px -apple-system,sans-serif'
                                : '10px -apple-system,sans-serif';
            ctx.fillText(label + ' ' + pct + '%' + (critical ? ' !' : ''), nx, y);
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            roundRect(nx, y + 4, (gp.w - 26) / 2 - 8, 4, 2); ctx.fill();
            ctx.globalAlpha = pulse;
            ctx.fillStyle = pct > 60 ? '#ef5350' : pct > 35 ? '#f0a860' : '#66bb6a';
            roundRect(nx, y + 4, ((gp.w - 26) / 2 - 8) * pct / 100, 4, 2); ctx.fill();
            ctx.globalAlpha = 1;
        }
        y += 17;
    }
    // Mood bar
    const mood = s.mood != null ? s.mood : 50;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 10px -apple-system,sans-serif';
    ctx.fillText('Mood: ' + mood, lx, y);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(lx + 62, y - 6, gp.w - 26 - 62, 7, 3.5); ctx.fill();
    ctx.fillStyle = mood < 35 ? '#ef5350' : mood < 60 ? '#d4c236' : '#66bb6a';
    roundRect(lx + 62, y - 6, (gp.w - 26 - 62) * mood / 100, 7, 3.5); ctx.fill();
    y += 12;
    // Thought log — the reference sim's signature storytelling
    const thoughts = (s.thoughts || []).slice(0, 4);
    if (!thoughts.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '10px -apple-system,sans-serif';
        ctx.fillText('No thoughts yet — just teed off', lx, y + 10);
    }
    for (const th of thoughts) {
        ctx.fillStyle = th.v >= 0 ? 'rgba(60,140,70,0.45)' : 'rgba(150,50,45,0.45)';
        roundRect(lx, y, gp.w - 26, 15, 5); ctx.fill();
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = '9px -apple-system,sans-serif';
        ctx.fillText((th.v >= 0 ? '😊 ' : '😠 ') + th.t + ': '
            + (th.v >= 0 ? '+' : '') + th.v, lx + 6, y + 11);
        if (th.at != null) {
            const ago = Math.max(0, Math.round((resort.worldClock || 0) - th.at));
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillText(ago < 60 ? ago + 'm' : Math.round(ago / 60) + 'h',
                lx + gp.w - 32, y + 11);
        }
        y += 18;
    }
}

function holeCardLayout() {
    // One extra stat row when the sim has measured this hole
    const sel = worldCourse.holes.find(h2 => h2.id === owSelectedHole);
    const st0 = sel ? (worldCourse.holeStats || {})[sel.id] : null;
    const w = 216, h = 278 + ((sel && sel.simAvg != null) ? 26 : 0)
        + ((st0 && st0.recent && st0.recent.length) ? 18 : 0);
    const x = W() - w - 10, y = 58;
    return { x, y, w, h,
             flyX: x + 12, flyY: y + h - 132, flyW: w - 24 - 42, flyH: 34,
             editX: x + w - 12 - 34, editY: y + h - 132, editW: 34, editH: 34,
             playX: x + 12, playY: y + h - 88, playW: w - 24, playH: 34,
             delX: x + 12, delY: y + h - 44, delW: w - 24, delH: 34 };
}

// ---- Hole flyover: camera sweeps tee -> waypoints -> pin, then restores ----
let owFlyover = null;

function startHoleFlyover(rec) {
    const pts = [rec.tee, ...(rec.waypoints || []), rec.pin]
        .map(p => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL }));
    if (pts.length < 2) return;
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const L = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
        segs.push(L);
        total += L;
    }
    if (total < 1) return;
    owFlyover = {
        pts: pts, segs: segs, total: total,
        t0: performance.now(),
        dur: 2500 + total * 1.1,
        yaw: cam3dYaw,
        saved: { px: cam3dPivotX, pz: cam3dPivotZ, dist: cam3dDistance,
                 pitch: cam3dPitch, yaw: cam3dYaw }
    };
}

function tickHoleFlyover() {
    if (!owFlyover) return;
    const f = owFlyover;
    const u = (performance.now() - f.t0) / f.dur;
    if (u >= 1) {
        setCameraOrbit(f.saved.px, f.saved.pz, f.saved.dist, f.saved.pitch, f.saved.yaw);
        owFlyover = null;
        return;
    }
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    let d = e * f.total, i = 0;
    while (i < f.segs.length - 1 && d > f.segs[i]) { d -= f.segs[i]; i++; }
    const L = Math.max(1e-6, f.segs[i]);
    const k = Math.min(1, d / L);
    const a = f.pts[i], b = f.pts[i + 1];
    const x = a.x + (b.x - a.x) * k;
    const z = a.z + (b.z - a.z) * k;
    // Ease the yaw toward each leg's heading so doglegs pan smoothly
    const heading = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI;
    let dy = heading - f.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    f.yaw += dy * 0.06;
    // Swoop low over the route, rising near the ends
    const dist = 640 - Math.sin(Math.PI * e) * 200;
    setCameraOrbit(x, z, dist, 0.62, f.yaw);
}

// Flyout entries wrap into columns when the list is taller than the
// screen (11 decor items vs a 375px phone). Shared by draw + hit-test.
function flyoutColsLayout(pi, list, L) {
    const perCol = Math.max(1, Math.floor((H() - 20) / (L.flyH + L.flyGap)));
    const rows = Math.min(list.length, perCol);
    const totalH = rows * (L.flyH + L.flyGap);
    let fy0 = Math.min(L.railY + (pi + 1) * (L.railBtn + L.railGap),
                       H() - 10 - totalH);
    if (fy0 < 10) fy0 = 10;
    return { perCol: perCol, fy0: fy0 };
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
    const closed = hole.open === false;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = closed ? 'rgba(160,160,160,0.55)'
        : selected ? 'rgba(255,190,60,0.95)' : 'rgba(255,255,255,0.85)';
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
    if (closed) {
        ctx.fillStyle = 'rgba(183,28,28,0.92)';
        roundRect(t.x - 26, t.y - 34, 52, 16, 8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('CLOSED', t.x, t.y - 22);
    }
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
    ctx.fillStyle = closed ? '#9e9e9e' : '#e53935'; // grey flag = closed
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

    // Pin step: ghost ring + live yardage from the tee while aiming
    if (w.step === 'pin' && w.tee && owLastGhostCell) {
        drawBrushGhost(owLastGhostCell.c, owLastGhostCell.r, 1, { color: '#b71c1c' });
        const yds = Math.round(polylineLengthYards({
            tee: w.tee, pin: { x: owLastGhostCell.c, y: owLastGhostCell.r },
            waypoints: [] }));
        const par = parFromYards(yds);
        const info = yds + ' yds  \u2022  Par ' + par;
        const infoW = 180;
        const infoY = bannerY + bannerH + 8;
        ctx.fillStyle = 'rgba(10,26,38,0.85)';
        roundRect((W() - infoW) / 2, infoY, infoW, 26, 13);
        ctx.fill();
        ctx.fillStyle = '#8fe3ec';
        ctx.font = 'bold 12px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(info, W() / 2, infoY + 17);
    }

    // Live design readout while shaping: length, par, stars, fee
    if (w.step === 'shape' && w.tee && w.pin) {
        const yds = Math.round(polylineLengthYards(w));
        const par = w.simParEst || parFromYards(yds);
        const diff = holeDifficulty(w);
        const fee = 3 + 2 * diff;
        let info = yds + ' yds  •  Par ' + par + '  •  '
            + '★'.repeat(diff) + '☆'.repeat(5 - diff) + '  •  $' + fee + ' fee';
        if (w.simAvg3) {
            // Provenance on the label: par comes from played test rounds
            info += '  •  plays ~' + w.simAvg3;
        } else if (w.traceRes && w.traceRes.strokes) {
            info += '  •  sim ' + w.traceRes.strokes;
        }
        const infoW = Math.min(W() - 20, 340);
        const infoY = bannerY + bannerH + 8;
        ctx.fillStyle = 'rgba(10,26,38,0.85)';
        roundRect((W() - infoW) / 2, infoY, infoW, 26, 13);
        ctx.fill();
        ctx.fillStyle = '#8fe3ec';
        ctx.font = 'bold 12px -apple-system,sans-serif';
        ctx.fillText(info, W() / 2, infoY + 17);
        // Hazard verdict from the physics trace: repeated splashes in
        // the test round mean the line punishes an average golfer
        if (w.traceRes && (w.traceRes.penalties || 0) >= 2) {
            const warn = '\u26A0 Brutal carry \u2014 '
                + w.traceRes.penalties + ' splashes in the test round';
            ctx.font = 'bold 11px -apple-system,sans-serif';
            const ww2 = ctx.measureText(warn).width + 26;
            const wy2 = infoY + 32;
            ctx.fillStyle = 'rgba(84,48,8,0.9)';
            roundRect((W() - ww2) / 2, wy2, ww2, 24, 12);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,183,77,0.8)';
            ctx.lineWidth = 1.2;
            roundRect((W() - ww2) / 2, wy2, ww2, 24, 12);
            ctx.stroke();
            ctx.fillStyle = '#ffb74d';
            ctx.fillText(warn, W() / 2, wy2 + 16);
        }
    }

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

        // Sim shot trace: replay the hole once with real physics whenever
        // the design changes (throttled to 1/sec; cheap key compare per
        // frame, the sim itself only runs on edits)
        const tKey = JSON.stringify([w.tee, w.pin, w.waypoints]);
        if (tKey !== w.traceKey
            && performance.now() - (w.traceAt || 0) > 1000) {
            w.traceKey = tKey;
            w.traceAt = performance.now();
            const tr = [];
            try {
                const recT = { tee: w.tee, pin: w.pin, waypoints: w.waypoints,
                    par: parFromYards(polylineLengthYards(w)) };
                w.traceRes = simulateWorldHoleRound(recT, 3, tr);
                // Par is what golfers actually shoot, not a yardage table:
                // two extra untraced rounds steady the estimate
                let totT = w.traceRes.strokes;
                for (let k = 0; k < 2; k++) {
                    totT += simulateWorldHoleRound(recT, 3).strokes;
                }
                w.simAvg3 = +(totT / 3).toFixed(1);
                w.simParEst = Math.max(3, Math.min(5, Math.round(totT / 3 - 0.6)));
            } catch (e) { w.traceRes = null; w.simParEst = null; }
            w.trace = tr;
        }

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

        // Numbered landing dots from the physics trace
        if (w.trace && w.trace.length) {
            ctx.save();
            ctx.setLineDash([3, 5]);
            ctx.strokeStyle = 'rgba(255,255,255,0.45)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let started = false;
            const t0 = cellCenterScreen(w.tee.x, w.tee.y);
            if (!t0.behind) { ctx.moveTo(t0.x, t0.y); started = true; }
            for (const t of w.trace) {
                const s = cellCenterScreen(t.x / CELL - 0.5, t.y / CELL - 0.5);
                if (s.behind) continue;
                if (started) ctx.lineTo(s.x, s.y);
                else { ctx.moveTo(s.x, s.y); started = true; }
            }
            ctx.stroke();
            ctx.setLineDash([]);
            for (const t of w.trace) {
                const s = cellCenterScreen(t.x / CELL - 0.5, t.y / CELL - 0.5);
                if (s.behind) continue;
                ctx.fillStyle = t.splash ? '#29b6f6'
                    : t.holed ? '#ffd54f' : '#ff6d00';
                ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.fillStyle = t.holed ? '#4e2600' : '#fff';
                ctx.font = 'bold 9px -apple-system,sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(t.splash ? '\u26F2' : String(t.n), s.x, s.y + 3);
            }
            ctx.restore();
        }

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
        const par = w.simParEst || parFromYards(yds);
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
    if (owBuyOffer && owBuyRect
        && hitBtn(sx, sy, owBuyRect.x, owBuyRect.y, owBuyRect.w, owBuyRect.h)) {
        return 'buyparcel';
    }
    if (owBalanceRect && hitBtn(sx, sy, owBalanceRect.x, owBalanceRect.y,
        owBalanceRect.w, owBalanceRect.h)) return 'finances';
    if (owNameRect && hitBtn(sx, sy, owNameRect.x, owNameRect.y,
        owNameRect.w, owNameRect.h)) return 'rename';
    if (owWeatherRect && hitBtn(sx, sy, owWeatherRect.x, owWeatherRect.y,
        owWeatherRect.w, owWeatherRect.h)) return 'weather';
    if (owWeatherOpen && owWeatherPanelRect && hitBtn(sx, sy, owWeatherPanelRect.x,
        owWeatherPanelRect.y, owWeatherPanelRect.w, owWeatherPanelRect.h)) return 'weather:panel';
    if (owFinancesOpen && owFinancesRect && hitBtn(sx, sy, owFinancesRect.x,
        owFinancesRect.y, owFinancesRect.w, owFinancesRect.h)) return 'finances:panel';
    // An open golfer panel owns its screen area (it draws over the
    // speed strip's corner) — its taps must not fall through to HUD chips
    if (owSelectedGolfer && !holeWizard) {
        if (owFollowRect && hitBtn(sx, sy, owFollowRect.x, owFollowRect.y,
            owFollowRect.w, owFollowRect.h)) return 'follow';
        const gpr = golferPanelLayout();
        if (hitBtn(sx, sy, gpr.x, gpr.y, gpr.w, gpr.h)) return 'golferpanel';
    }
    if (owSpeedRects) {
        for (const sr of owSpeedRects) {
            if (hitBtn(sx, sy, sr.x, sr.y, sr.w, sr.h)) return 'speed:' + sr.spd;
        }
    }
    if (owRosterChip && hitBtn(sx, sy, owRosterChip.x, owRosterChip.y,
        owRosterChip.w, owRosterChip.h)) return 'roster';
    if (owComplaintChip && hitBtn(sx, sy, owComplaintChip.x, owComplaintChip.y,
        owComplaintChip.w, owComplaintChip.h)) return 'complaints';
    if (owMiniBtnRect && hitBtn(sx, sy, owMiniBtnRect.x, owMiniBtnRect.y,
        owMiniBtnRect.w, owMiniBtnRect.h)) return 'mini:toggle';
    if (owMuteBtnRect && hitBtn(sx, sy, owMuteBtnRect.x, owMuteBtnRect.y,
        owMuteBtnRect.w, owMuteBtnRect.h)) return 'mute:toggle';
    if (owMiniRect && hitBtn(sx, sy, owMiniRect.x, owMiniRect.y,
        owMiniRect.w, owMiniRect.h)) return 'mini:go';
    if (owRosterOpen && owRosterChip && owRosterChip.panel
        && hitBtn(sx, sy, owRosterChip.panel.x, owRosterChip.panel.y,
            owRosterChip.panel.w, owRosterChip.panel.h)) return 'roster:panel';
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
                    const FL = flyoutColsLayout(pi, list, L);
                    for (let li = 0; li < list.length; li++) {
                        const entry = list[li];
                        const fx = L.flyX + Math.floor(li / FL.perCol) * (L.flyW + 8);
                        const fy = FL.fy0 + (li % FL.perCol) * (L.flyH + L.flyGap);
                        if (hitBtn(sx, sy, fx, fy, L.flyW, L.flyH)) {
                            return parent.flyout === 'sizes' ? 'size:' + entry : 'tool:' + entry;
                        }
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
    // Any touch cancels a running flyover, leaving the camera where it is
    if (owFlyover) owFlyover = null;
    const hit = overworldHUDHit(sx, sy);
    if (hit === 'close') { exitOverworld(); return; }
    if (hit === 'undo') { undoLastStroke(); return; }
    if (hit === 'buyparcel') { buyOfferedParcel(); return; }
    if (hit === 'rename') {
        const inp = prompt('Name your resort:', worldCourse.name);
        if (inp != null && inp.trim()) {
            worldCourse.name = inp.trim().slice(0, 24);
            saveWorldCourse();
            notify('\u26F3 Welcome to ' + worldCourse.name + '!');
        }
        return;
    }
    if (hit === 'weather') { owWeatherOpen = !owWeatherOpen; return; }
    if (hit === 'weather:panel') return;
    if (owWeatherOpen) { owWeatherOpen = false; return; }
    if (hit === 'finances') { owFinancesOpen = !owFinancesOpen; return; }
    if (hit === 'finances:panel') return;
    if (owFinancesOpen) { owFinancesOpen = false; return; }
    if (hit === 'follow') {
        owFollowGolfer = !owFollowGolfer;
        if (owFollowGolfer) focusGolfer(owSelectedGolfer);
        return;
    }
    if (hit === 'golferpanel') return; // absorbed by the open panel
    if (hit && hit.startsWith('speed:')) {
        gameSpeed = parseInt(hit.slice(6), 10);
        return;
    }
    if (hit === 'roster') { owRosterOpen = !owRosterOpen; return; }
    if (hit === 'mute:toggle') {
        setAudioMuted(!audioMuted);
        return;
    }
    if (hit === 'mini:toggle') {
        owMinimapOn = !owMinimapOn;
        saveData('minimapOn', owMinimapOn);
        return;
    }
    if (hit === 'mini:go') {
        // Tap the map to fly the camera there (zoom level preserved)
        const wx2 = (sx - owMiniRect.x) / owMiniRect.w * worldCourse.cols * CELL;
        const wz2 = (sy - owMiniRect.y) / owMiniRect.h * worldCourse.rows * CELL;
        if (typeof setCameraOrbit === 'function') {
            setCameraOrbit(wx2, wz2,
                (typeof cam3dDistance !== 'undefined') ? cam3dDistance : null,
                null, null);
        }
        return;
    }
    if (hit === 'complaints') {
        const cs = worldCourse.complaints || [];
        if (cs.length && typeof setCameraOrbit === 'function') {
            const cm = cs[0]; // oldest — they evict first, read them first
            setCameraOrbit((cm.x + 0.5) * CELL, (cm.y + 0.5) * CELL,
                420, null, null);
            notify('\u{1F4CD} ' + cm.text
                + (cm.holeId ? ' (Hole ' + cm.holeId + ')' : ''));
        }
        return;
    }
    if (hit === 'roster:panel') {
        // Night shortcut: jump the world clock to opening time
        if (owRosterChip && owRosterChip.skipNight
            && hitBtn(sx, sy, owRosterChip.skipNight.x, owRosterChip.skipNight.y,
                owRosterChip.skipNight.w, owRosterChip.skipNight.h)) {
            const mins = ((resort.worldClock % 1440) + 1440) % 1440;
            const dayBase = Math.floor(resort.worldClock / 1440) * 1440;
            resort.worldClock = (mins < 360 ? dayBase : dayBase + 1440) + 359.5;
            tickWorld(0.5); // rollovers, upkeep, and the tee sheet fire here
            notify('\u26C5 Good morning \u2014 6:00 AM');
            return;
        }
        // Tapping a golfer's row jumps straight to their inspector
        if (owRosterChip && owRosterChip.rows) {
            for (const rr of owRosterChip.rows) {
                if (hitBtn(sx, sy, rr.x, rr.y, rr.w, rr.h)) {
                    // Champions from past days may no longer be on the
                    // course — selecting a ghost would leave an invisible
                    // panel hit-zone floating over the map
                    if (!npcStates.some(n => n.name === rr.name)) {
                        notify(rr.name === 'You'
                            ? '\u{1F3C6} That\u2019s YOUR title \u2014 well played'
                            : rr.name + ' isn\u2019t on the course right now');
                        return;
                    }
                    owSelectedGolfer = rr.name;
                    owRosterOpen = false;
                    owSelectedHole = null;
                    window.__greetGolfer = rr.name;
                    focusGolfer(rr.name);
                    return;
                }
            }
        }
        return; // absorb other taps on the open panel
    }
    // Tapping anywhere else dismisses the roster (and absorbs the tap so a
    // stray dismiss can't paint terrain underneath)
    if (owRosterOpen) { owRosterOpen = false; return; }
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
        // Same ownership rule as every other wizard placement
        if (!parcelOwned(mid.x, mid.y)) {
            offerParcel(mid.x, mid.y);
            return;
        }
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

    // ---- Golfer inspector (open) — taps inside are absorbed; outside
    // closes it but still falls through (so tapping another golfer works) ----
    if (owSelectedGolfer && !holeWizard) {
        const gp = golferPanelLayout();
        if (owFollowRect && hitBtn(sx, sy, owFollowRect.x, owFollowRect.y,
            owFollowRect.w, owFollowRect.h)) {
            owFollowGolfer = !owFollowGolfer;
            if (owFollowGolfer) focusGolfer(owSelectedGolfer);
            return;
        }
        if (hitBtn(sx, sy, gp.x, gp.y, gp.w, gp.h)) return;
        owSelectedGolfer = null;
        owFollowGolfer = false;
    }

    // ---- Hole inspector card (open) — taps inside it are handled/absorbed,
    // taps outside close it and fall through to normal handling ----
    if (owSelectedHole != null && !holeWizard) {
        const hc = holeCardLayout();
        const selHole = worldCourse.holes.find(h => h.id === owSelectedHole);
        if (selHole && hitBtn(sx, sy, hc.x, hc.y, hc.w, hc.h)) {
            if (owRecordLineRect && owRecordLineRect.name
                && hitBtn(sx, sy, owRecordLineRect.x, owRecordLineRect.y,
                    owRecordLineRect.w, owRecordLineRect.h)) {
                const holder = npcStates.find(n => n.name === owRecordLineRect.name);
                if (holder) {
                    owSelectedGolfer = holder.name;
                    owSelectedHole = null;
                    window.__greetGolfer = holder.name;
                    focusGolfer(holder.name);
                } else {
                    notify(owRecordLineRect.name === 'You'
                        ? '\u{1F3C5} That\u2019s YOUR record \u2014 set in a playtest'
                        : owRecordLineRect.name + ' isn\u2019t on the course right now');
                }
                return;
            }
            if (hitBtn(sx, sy, hc.x + hc.w - 72, hc.y + 3, 66, 26)) {
                selHole.open = selHole.open === false; // toggle
                saveWorldCourse();
                owNeedsRebuild = true; // golfers + arcs respawn without it
                notify(selHole.open === false
                    ? '\u26D4 Hole ' + selHole.id + ' closed \u2014 no rounds, no fees'
                    : '\u26F3 Hole ' + selHole.id + ' is open for play');
                return;
            }
            if (hitBtn(sx, sy, hc.x + 3, hc.y + 3, hc.w - 6, 26)) {
                const cur = selHole.name || ('Hole ' + selHole.id);
                const inp = prompt('Name this hole:', cur);
                if (inp != null && inp.trim()) {
                    selHole.name = inp.trim().slice(0, 18);
                    saveWorldCourse();
                    notify('\u26F3 ' + selHole.name);
                }
                return;
            }
            if (hitBtn(sx, sy, hc.flyX, hc.flyY, hc.flyW, hc.flyH)) {
                startHoleFlyover(selHole);
                return;
            }
            if (hitBtn(sx, sy, hc.editX, hc.editY, hc.editW, hc.editH)) {
                // Rework the line without delete-and-recreate: the wizard
                // opens on the shape step with this hole preloaded and
                // Create replaces it in place (id, records, stats kept)
                startHoleWizard();
                holeWizard.holeId = selHole.id;
                holeWizard.editing = selHole.id;
                holeWizard.tee = { x: selHole.tee.x, y: selHole.tee.y };
                holeWizard.pin = { x: selHole.pin.x, y: selHole.pin.y };
                holeWizard.waypoints = (selHole.waypoints || [])
                    .map(w2 => ({ x: w2.x, y: w2.y }));
                holeWizard.step = 'shape';
                owSelectedHole = null;
                return;
            }
            if (hitBtn(sx, sy, hc.playX, hc.playY, hc.playW, hc.playH)) {
                startWorldHolePlaytest(selHole);
                return;
            }
            if (hitBtn(sx, sy, hc.delX, hc.delY, hc.delW, hc.delH)) {
                const deadId = owSelectedHole;
                worldCourse.holes = worldCourse.holes.filter(h => h.id !== deadId);
                owNeedsRebuild = true; // the dead hole's arcs must go too
                // A deleted hole takes its records with it: complaints
                // pinned to it and its play stats (otherwise the course
                // report can name a hole that no longer exists)
                worldCourse.complaints = (worldCourse.complaints || [])
                    .filter(c => c.holeId !== deadId);
                if (worldCourse.holeStats) delete worldCourse.holeStats[deadId];
                owSelectedHole = null;
                saveWorldCourse();
                notify('Hole deleted');
            }
            return;
        }
        owSelectedHole = null;
    }

    if (owSelectedFacility != null && !holeWizard) {
        if (owFacilityCardRect && hitBtn(sx, sy, owFacilityCardRect.x,
            owFacilityCardRect.y, owFacilityCardRect.w, owFacilityCardRect.h)) {
            return; // card is read-only; swallow the tap
        }
        owSelectedFacility = null;
    }

    // ---- Tap a golfer (navigation mode) — checked before hole markers so
    // a golfer standing on the tee is still selectable. Only route golfers
    // carry a name; ambient walkers are anonymous.
    if (!holeWizard && owTool === 'hand') {
        // ---- Tap a complaint pin: read it, which acknowledges + clears.
        // Finger-friendly: 24px reach, nearest pin wins when they cluster
        {
            let bestPin = null, bestD = 24 * 24;
            for (const pr of owComplaintRects) {
                const dd0 = (sx - pr.x) * (sx - pr.x) + (sy - pr.y) * (sy - pr.y);
                if (dd0 < bestD) { bestD = dd0; bestPin = pr; }
            }
            if (bestPin) {
                notify('\u{1F4AC} ' + bestPin.cm.text
                    + (bestPin.cm.holeId ? ' (Hole ' + bestPin.cm.holeId + ')' : ''));
                worldCourse.complaints =
                    (worldCourse.complaints || []).filter(c => c !== bestPin.cm);
                saveWorldCourse();
                // Reading a gripe opens the offending hole's card, so the
                // fix (edit, close, or shrug) is one tap away
                if (bestPin.cm.holeId != null
                    && worldCourse.holes.some(h => h.id === bestPin.cm.holeId)) {
                    owSelectedHole = bestPin.cm.holeId;
                    owSelectedGolfer = null;
                }
                return;
            }
        }
        if (scene3dReady && typeof npcStates !== 'undefined'
            && typeof worldToScreen3D === 'function') {
            let best = null, bd = 26 * 26;
            for (const s of npcStates) {
                if (!s.name) continue;
                const gp = worldToScreen3D(s.x, s.z);
                if (!gp || gp.behind) continue;
                const dd = (sx - gp.x) * (sx - gp.x) + (sy - gp.y) * (sy - gp.y);
                if (dd < bd) { bd = dd; best = s; }
            }
            if (best) {
                owSelectedGolfer = best.name;
                owSelectedHole = null;
                window.__greetGolfer = best.name;
                return;
            }
        }
        // ---- Tap a kiosk/stall to inspect its sales ----
        if (worldCourse.decor) {
            let fb = -1, fdd = 24 * 24;
            for (let i = 0; i < worldCourse.decor.length; i++) {
                const d = worldCourse.decor[i];
                if (d.t !== 'kiosk' && d.t !== 'stall') continue;
                const p = cellCenterScreen(d.x - 0.5, d.y - 0.5);
                if (!p || p.behind) continue;
                const dd = (sx - p.x) * (sx - p.x) + (sy - p.y) * (sy - p.y);
                if (dd < fdd) { fdd = dd; fb = i; }
            }
            if (fb >= 0) {
                owSelectedFacility = fb;
                owSelectedHole = null;
                owSelectedGolfer = null;
                return;
            }
        }
        // ---- Tap a hole marker to inspect it ----
        for (const hole of worldCourse.holes) {
            const ts = cellCenterScreen(hole.tee.x, hole.tee.y);
            const ps = cellCenterScreen(hole.pin.x, hole.pin.y);
            const near = (pt) => pt && !pt.behind
                && (sx - pt.x) * (sx - pt.x) + (sy - pt.y) * (sy - pt.y) < 22 * 22;
            if (near(ts) || near(ps)) {
                // Double-tap a marker to launch its flyover directly
                const now = performance.now();
                if (owMarkerTap && owMarkerTap.id === hole.id
                    && now - owMarkerTap.t < 450) {
                    owMarkerTap = null;
                    owSelectedHole = null;
                    startHoleFlyover(hole);
                    return;
                }
                owMarkerTap = { id: hole.id, t: now };
                owSelectedHole = hole.id;
                return;
            }
        }
    }

    // Not a HUD hit — action depends on mode
    const cell = screenToCell(sx, sy);
    if (holeWizard) {
        if (!cell) return;
        if (holeWizard.step === 'tee') {
            // Drag to aim, same feel as the pin: ghost follows, lift drops
            holeWizard.teeDrag = true;
            owLastGhostCell = { c: cell.c, r: cell.r };
            return;
        }
        if (holeWizard.step === 'pin') {
            // Drag to aim: the pin ghost follows the finger with a live
            // yardage readout; the pin drops where you lift
            holeWizard.pinDrag = true;
            owLastGhostCell = { c: cell.c, r: cell.r };
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
        // Decor stamp: tap places the selected prop at the tapped cell.
        // Tapping an existing item of the same type rotates it 45° so
        // placement and orientation share one gesture.
        if (tool && tool.decor) {
            worldCourse.decor = worldCourse.decor || [];
            let near = -1, nd = 1.44;
            for (let i = 0; i < worldCourse.decor.length; i++) {
                const d = worldCourse.decor[i];
                if (d.t !== tool.decor) continue;
                const dd = (d.x - cell.c - 0.5) * (d.x - cell.c - 0.5)
                         + (d.y - cell.r - 0.5) * (d.y - cell.r - 0.5);
                if (dd < nd) { nd = dd; near = i; }
            }
            if (near >= 0) {
                // Grab it: drag repositions, a motionless tap rotates (on
                // release, so dragging never spins the piece)
                owDecorDrag = { i: near, moved: false };
                return;
            } else {
                if (!parcelOwned(cell.c, cell.r)) {
                    offerParcel(cell.c, cell.r);
                    return;
                }
                const cost = DECOR_COSTS[tool.decor] || 0;
                if (resort.coins < cost) {
                    notify('Need $' + cost + ' for a ' + tool.label.toLowerCase());
                    return;
                }
                resort.coins -= cost;
                saveData('resort', resort);
                if (typeof playChime === 'function') playChime();
                worldCourse.decor.push({ t: tool.decor, x: cell.c + 0.5, y: cell.r + 0.5, rot: 0 });
                notify(tool.label + ' placed  −$' + cost);
            }
            if (scene3dReady) buildTerrain3D(worldCourse, { distantScenery: false });
            saveWorldCourse();
            return;
        }
        // Erase tap on a decor item removes it instead of painting
        if (tool && tool.id === 'erase' && worldCourse.decor && worldCourse.decor.length) {
            let best = -1, bd = 2.25; // within 1.5 cells
            for (let i = 0; i < worldCourse.decor.length; i++) {
                const d = worldCourse.decor[i];
                const dd = (d.x - cell.c - 0.5) * (d.x - cell.c - 0.5)
                         + (d.y - cell.r - 0.5) * (d.y - cell.r - 0.5);
                if (dd < bd) { bd = dd; best = i; }
            }
            if (best >= 0) {
                const gone = worldCourse.decor.splice(best, 1)[0];
                const refund = Math.floor((DECOR_COSTS[gone.t] || 0) / 2);
                resort.coins += refund;
                saveData('resort', resort);
                if (scene3dReady) buildTerrain3D(worldCourse, { distantScenery: false });
                saveWorldCourse();
                notify('Removed ' + gone.t + (refund ? '  +$' + refund : ''));
                return;
            }
        }
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
    if (owFollowGolfer && scouting) owFollowGolfer = false; // pan breaks follow
    if (owDecorDrag) {
        const cell = screenToCell(sx, sy);
        if (cell && parcelOwned(cell.c, cell.r)) {
            const d = worldCourse.decor[owDecorDrag.i];
            if (d && (d.x !== cell.c + 0.5 || d.y !== cell.r + 0.5)) {
                d.x = cell.c + 0.5;
                d.y = cell.r + 0.5;
                owDecorDrag.moved = true;
            }
        }
        return;
    }
    // Wizard tee/pin drag-to-aim
    if (holeWizard && holeWizard.teeDrag) {
        const cell = screenToCell(sx, sy);
        if (cell) owLastGhostCell = { c: cell.c, r: cell.r };
        return;
    }
    if (holeWizard && holeWizard.pinDrag) {
        const cell = screenToCell(sx, sy);
        if (cell) owLastGhostCell = { c: cell.c, r: cell.r };
        return;
    }
    // Wizard waypoint drag
    if (holeWizard && holeWizard.draggingIdx >= 0) {
        const cell = screenToCell(sx, sy);
        if (cell && parcelOwned(cell.c, cell.r)) {
            holeWizard.waypoints[holeWizard.draggingIdx] = { x: cell.c, y: cell.r };
        }
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
    if (holeWizard && holeWizard.teeDrag) {
        holeWizard.teeDrag = false;
        if (owLastGhostCell) {
            // Holes only route over land you own — same rule as painting
            if (!parcelOwned(owLastGhostCell.c, owLastGhostCell.r)) {
                offerParcel(owLastGhostCell.c, owLastGhostCell.r);
                return;
            }
            holeWizard.tee = { x: owLastGhostCell.c, y: owLastGhostCell.r };
            holeWizard.step = 'pin';
        }
        return;
    }
    if (holeWizard && holeWizard.pinDrag) {
        holeWizard.pinDrag = false;
        const g = owLastGhostCell;
        if (g && !(holeWizard.tee && holeWizard.tee.x === g.c && holeWizard.tee.y === g.r)) {
            if (!parcelOwned(g.c, g.r)) {
                offerParcel(g.c, g.r);
                return;
            }
            holeWizard.pin = { x: g.c, y: g.r };
            holeWizard.step = 'shape';
            owLastGhostCell = null;
        }
        return;
    }
    if (owDecorDrag) {
        const d = worldCourse.decor[owDecorDrag.i];
        if (d && owDecorDrag.moved) {
            if (scene3dReady) buildTerrain3D(worldCourse, { distantScenery: false });
            saveWorldCourse();
            notify('Moved ' + d.t);
        } else if (d) {
            d.rot = ((d.rot || 0) + Math.PI / 4) % (Math.PI * 2);
            if (scene3dReady) buildTerrain3D(worldCourse, { distantScenery: false });
            saveWorldCourse();
            notify('Rotated \u21BB tap again for more');
        }
        owDecorDrag = null;
        return;
    }
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
    // Non-paint taps also request rebuilds (hole confirm/delete, the
    // open/closed toggle) — consume the flag here, not only inside
    // paint strokes, or those changes stay stale until the next brush
    if (owNeedsRebuild && scene3dReady) {
        refreshWorldHeights();
        buildTerrain3D(worldCourse, { distantScenery: false });
        owNeedsRebuild = false;
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
    roundRect(6, 58, 60, 44, 10);
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
    // Speed with units — a bare number reads as a mystery stat
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(wind.speed * 10) / 10, wcx, wcy + 12);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '8px -apple-system,sans-serif';
    ctx.fillText('WIND mph', wcx, wcy + 21);

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
        ctx.fillText(club.short || club.name, cardX + cardW / 2, TRAY_Y + 49);
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
        // Pill chip, not bare text — readable over any terrain/golfer
        ctx.font = 'bold 13px -apple-system,sans-serif';
        const skW = ctx.measureText('Tap to skip').width + 30;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        roundRect((W() - skW) / 2, H() - 134, skW, 28, 14);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        roundRect((W() - skW) / 2, H() - 134, skW, 28, 14);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('Tap to skip', W() / 2, H() - 115);
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
    if (strokes === 1) {
        ctx.fillStyle = '#ffd24a';
        ctx.font = 'bold 15px -apple-system,sans-serif';
        ctx.fillText('\u26A1 HOLE IN ONE!', W() / 2, cy + 15);
    }
    if (worldPlaytest && currentHole.worldHoleId != null) {
        const st = (worldCourse.holeStats || {})[currentHole.worldHoleId];
        if (st && st.best != null) {
            ctx.fillStyle = strokes < st.best ? '#ffd24a' : 'rgba(255,255,255,0.55)';
            ctx.font = 'bold 11px -apple-system,sans-serif';
            ctx.fillText(strokes < st.best
                ? '\u{1F3C5} NEW COURSE RECORD! (was ' + st.best + ' \u2014 ' + (st.bestBy || '?') + ')'
                : 'Course record: ' + st.best + ' \u2014 ' + (st.bestBy || '?'),
                W() / 2, cy + 52);
        }
    }

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
    ctx.fillText(totalStrokes + ' (' + (roundDiff === 0 ? 'E'
        : (roundDiff > 0 ? '+' : '') + roundDiff) + ')', W() / 2, cy + 185);

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
        if (worldPlaytest) {
            // The owner's round counts: feed it to the same stats/records
            // pipeline the ambient golfers use
            if (currentHole.worldHoleId != null && strokes > 0) {
                (window.__holeOuts = window.__holeOuts || []).push({
                    holeId: currentHole.worldHoleId, score: strokes,
                    par: currentHole.par || 4, name: 'You'
                });
                if (window.__tourney) {
                    notify('\u{1F3C6} Your ' + strokes
                        + ' is on the tournament board!');
                }
            }
            endWorldPlaytest();
            return;
        }
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
    // Quit button — mid-hole quits ask once (double-tap to confirm) so a
    // stray tap can't throw away a round in progress
    if (hitBtn(sx, sy, W() - 58, 62, 50, 30)) {
        if (strokes > 0 && !holeComplete) {
            const now = performance.now();
            if (!window.__quitArm || now - window.__quitArm > 2500) {
                window.__quitArm = now;
                notify('Quit mid-hole? Tap again to confirm');
                return true;
            }
        }
        window.__quitArm = null;
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
    // The hole-done card says it bigger — a duplicate toast peeking out
    // from behind the card is just noise
    if (state === 'holeDone') return;
    const alpha = Math.min(1, notification.timer / 0.5);

    ctx.globalAlpha = alpha;
    // Green glossy banner just under the top bar (reference style)
    ctx.font = 'bold 12px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(notification.text).width;
    const pillH = 26;
    // Drop to the bottom edge when a top panel (finances, inspector,
    // roster) would be covered by the banner
    const topBusy = state === 'overworld'
        && (owFinancesOpen || owSelectedGolfer || owRosterOpen);
    // The wizard owns the top (step banner + readout) AND the bottom
    // (Cancel/Confirm), so toasts slot between them instead
    const pillY = (state === 'overworld' && holeWizard) ? 126
        : (state === 'overworld' && window.__tourney) ? 86 // clear the live banner
        : topBusy ? H() - 44 : 52;
    glossyRect(W() / 2 - tw / 2 - 14, pillY, tw + 28, pillH, pillH / 2, '#2f7d43');
    ctx.fillStyle = '#fff';
    ctx.fillText(notification.text, W() / 2, pillY + 17);
    ctx.globalAlpha = 1;
}

// ---- Main Game Loop ----
function gameLoop(time) {
    window.__gameAlive = true; // boot watchdog: the loop is running
    // First live frame dismisses the boot splash
    if (!window.__splashGone) {
        window.__splashGone = true;
        const sp = document.getElementById('boot-splash');
        if (sp) {
            sp.style.transition = 'opacity 0.4s';
            sp.style.opacity = '0';
            setTimeout(() => sp.remove(), 450);
        }
    }
    requestAnimationFrame(gameLoop);

    if (!lastFrameTime) lastFrameTime = time;
    let dt = (time - lastFrameTime) / 1000;
    lastFrameTime = time;
    // Smoothed FPS for the ?fps=1 diagnostic readout (raw dt, pre-clamp)
    if (dt > 0) window.__fps = (window.__fps || 60) * 0.95 + (1 / dt) * 0.05;
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
                // The gallery applauds an under-par hole from the owner —
                // and erupts (applause + fanfare) for a hole-in-one
                if (worldPlaytest && strokes < (currentHole.par || 4)
                    && typeof playApplause === 'function') {
                    playApplause();
                    if (strokes === 1 && typeof playFanfare === 'function') {
                        playFanfare();
                    }
                }
                setState('holeDone');
            }
        }
    }

    // 3D rendering for gameplay states, overworld, AND the menu backdrop
    const use3D = scene3dReady && (state === 'playing' || state === 'holeDone'
        || state === 'overworld' || state === 'menu' || state === 'manage'
        || state === 'character' || state === 'islandgen');
    if (use3D) {
        show3D();

        // Island creator: the draft island slowly orbits under the panel
        if (state === 'islandgen') {
            if (ballMesh) ballMesh.visible = false;
            if (typeof cloudsGroup !== 'undefined' && cloudsGroup) cloudsGroup.visible = false;
            if (typeof setDistantSceneryVisible === 'function') setDistantSceneryVisible(true);
            if (typeof setBuildGridVisible === 'function') setBuildGridVisible(false);
            if (typeof rotateCameraOrbit === 'function') rotateCameraOrbit(0.05 * dt);
            updateCamera3D(dt);
            render3D();
            canvas.style.background = 'transparent';
        } else
        // Menu/manage backdrop: the live resort slowly orbiting under the UI
        if (state === 'menu' || state === 'manage' || state === 'character') {
            if (!menuOrbitReady) {
                if (!worldCourse.heights) refreshWorldHeights();
                buildTerrain3D(worldCourse, { distantScenery: false });
                cam3dOrbitMode = true;
                if (typeof resetCameraFov === 'function') resetCameraFov();
                setCameraOrbit(worldCourse.cols * CELL / 2, worldCourse.rows * CELL / 2,
                               2100, Math.PI / 180 * 46, 0.5);
                if (typeof camera3d !== 'undefined' && camera3d) {
                    camera3d.position.set(cam3dTarget.x, cam3dTarget.y, cam3dTarget.z);
                }
                menuOrbitReady = true;
            }
            if (ballMesh) ballMesh.visible = false;
            if (typeof cloudsGroup !== 'undefined' && cloudsGroup) cloudsGroup.visible = false;
            if (typeof setDistantSceneryVisible === 'function') setDistantSceneryVisible(true);
            if (typeof setBuildGridVisible === 'function') setBuildGridVisible(false);
            if (typeof rotateCameraOrbit === 'function') rotateCameraOrbit(0.045 * dt);
            if (typeof updateAmbientNPCs3D === 'function') updateAmbientNPCs3D(dt, worldCourse);
            if (typeof updateArcBalls3D === 'function') updateArcBalls3D();
            if (typeof updateDayNightTint === 'function') updateDayNightTint(resort.worldClock || 0);
            updateCamera3D(dt);
            render3D();
            canvas.style.background = 'transparent';
        } else
        // Overworld branch — cam3dTarget is driven directly by panCamera3D /
        // zoomCamera3D from user input; we just flush any pending terrain
        // rebuild, tick the camera lerp, and render.
        if (state === 'overworld') {
            if (ballMesh) ballMesh.visible = false;
            if (typeof cloudsGroup !== 'undefined' && cloudsGroup) cloudsGroup.visible = false;
            if (typeof setDistantSceneryVisible === 'function') setDistantSceneryVisible(true);
            if (typeof updateAmbientNPCs3D === 'function') updateAmbientNPCs3D(dt * gameSpeed, worldCourse);
            if (typeof updateArcBalls3D === 'function') updateArcBalls3D();
            if (typeof updateDayNightTint === 'function') updateDayNightTint(resort.worldClock || 0);
            if (typeof setBuildGridVisible === 'function') setBuildGridVisible((owTool && owTool !== 'hand') || !!holeWizard);
            updateTarget3D(0, 0, false);
            // Follow-cam: glide the pivot with the selected golfer
            if (owFollowGolfer && owSelectedGolfer && typeof npcStates !== 'undefined') {
                const fg = npcStates.find(n => n.name === owSelectedGolfer);
                if (fg && typeof setCameraOrbit === 'function') {
                    setCameraOrbit(fg.x, fg.z + 30,
                        Math.min(cam3dDistance, 1000), cam3dPitch, cam3dYaw);
                }
            }
            // Continuous rotate/tilt while a HUD button is held
            tickOverworldCamera(dt);
            tickHoleFlyover();
            if (typeof cam3dSkipLerp !== 'undefined') cam3dSkipLerp = scouting || owDragPainting;
            updateCamera3D(dt);
            render3D();
            canvas.style.background = 'transparent';
        } else {
        if (ballMesh) ballMesh.visible = true;
        if (typeof cloudsGroup !== 'undefined' && cloudsGroup) cloudsGroup.visible = true;
        // Horizon-ring scenery only reads right from the high overworld
        // camera; from low play cameras it looks like floating debris
        if (typeof setDistantSceneryVisible === 'function') setDistantSceneryVisible(false);
        // The ambient world keeps living while playing — world playtests
        // tick against the resort, classic rounds against their own
        // course terrain (leaves, critters, fountains, rain, light)
        {
            const ambientHole = worldPlaytest ? worldCourse : currentHole;
            if (ambientHole) {
                if (typeof updateAmbientNPCs3D === 'function') updateAmbientNPCs3D(dt, ambientHole);
                if (typeof updateArcBalls3D === 'function') updateArcBalls3D();
                if (typeof updateDayNightTint === 'function') updateDayNightTint(resort.worldClock || 0);
            }
        }
        // Update 3D ball position
        updateBall3D(ball.x, ball.y, ball.z, player.ballColor, terrainHeightAt(ball.x, ball.y));
        // Golden trail while the ball is airborne
        if (ball.moving && ball.z > 3 && typeof spawnTrailPuff3D === 'function') {
            spawnTrailPuff3D(ball.x, terrainHeightAt(ball.x, ball.y) + ball.z + 3, ball.y);
        }
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

    // The world always ticks — economy (and later NPCs) advance on any
    // screen, scaled by the speed strip (0 pauses, 4 fast-forwards)
    tickWorld(dt * gameSpeed);

    // Draw 2D based on state (HUD overlay when 3D, full render when not)
    switch (state) {
        case 'menu': drawMenu(); break;
        case 'manage': drawManage(); break;
        case 'overworld': drawOverworld(); break;
        case 'islandgen': drawIslandCreator(); break;
        case 'character': drawCharacter(); break;
        case 'career': drawCareer(); break;
        case 'builder': builderDraw(); break;
        case 'playing': drawPlaying(); break;
        case 'holeDone': drawHoleDone(); break;
        case 'roundDone': drawRoundDone(); break;
    }

    drawNotification(dt);
}


// ---- Ambient audio: synthesized wind bed + birdsong ----
// Created lazily on the first touch (iOS blocks AudioContext until a
// user gesture). Everything is generated — no audio assets to load.
let audioCtx = null, audioMaster = null;
let audioMuted = loadData('muted', false);

function setAudioMuted(m) {
    audioMuted = m;
    saveData('muted', m);
    if (audioCtx && audioMaster) {
        audioMaster.gain.linearRampToValueAtTime(
            m ? 0 : 0.13, audioCtx.currentTime + 0.15);
    }
}

function initAmbientAudio() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioMaster = audioCtx.createGain();
        audioMaster.gain.value = audioMuted ? 0 : 0.13;
        audioMaster.connect(audioCtx.destination);
        // Wind bed: looped pink-ish noise through a slowly-swept lowpass
        const len = audioCtx.sampleRate * 2;
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
            data[i] = last * 3.5;
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buf;
        noise.loop = true;
        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        lp.Q.value = 0.4;
        const windGain = audioCtx.createGain();
        windGain.gain.value = 0.5;
        const lfo = audioCtx.createOscillator();
        lfo.frequency.value = 0.09;
        const lfoGain = audioCtx.createGain();
        lfoGain.gain.value = 180;
        lfo.connect(lfoGain);
        lfoGain.connect(lp.frequency);
        noise.connect(lp);
        lp.connect(windGain);
        windGain.connect(audioMaster);
        noise.start();
        lfo.start();
        // Rain patter: high-passed copy of the noise bed, faded in and
        // out by the renderer's shower envelope
        const rainNoise = audioCtx.createBufferSource();
        rainNoise.buffer = buf;
        rainNoise.loop = true;
        const hp = audioCtx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1400;
        const rainGain = audioCtx.createGain();
        rainGain.gain.value = 0;
        rainNoise.connect(hp);
        hp.connect(rainGain);
        rainGain.connect(audioMaster);
        rainNoise.start();
        setInterval(() => {
            if (!audioCtx) return;
            const env = (typeof rainEnvNow === 'number') ? rainEnvNow : 0;
            rainGain.gain.linearRampToValueAtTime(env * 0.5, audioCtx.currentTime + 0.25);
        }, 250);
        scheduleChirp();
        scheduleGullCry();
        scheduleFrogCroak();
        // Thunder rolls once as each shower sets in
        let prevRainLevel = 0;
        setInterval(() => {
            if (!audioCtx) return;
            const env = (typeof rainEnvNow === 'number') ? rainEnvNow : 0;
            if (env > 0.5 && prevRainLevel <= 0.5
                && (state === 'overworld' || state === 'playing' || state === 'menu')) {
                playThunder();
                window.__lightningAt = performance.now(); // renderer flickers
            }
            prevRainLevel = env;
        }, 1000);
        // Courtesy honk when the cart rolls close past someone (8s cooldown)
        let lastHonk = 0;
        setInterval(() => {
            if (!audioCtx || state !== 'overworld') return;
            if (typeof cartState === 'undefined' || !cartState) return;
            if (typeof npcStates === 'undefined' || !npcStates.length) return;
            const now = performance.now();
            if (now - lastHonk < 8000) return;
            for (const s of npcStates) {
                const dx = s.x - cartState.x, dz = s.z - cartState.z;
                if (dx * dx + dz * dz < 42 * 42) {
                    lastHonk = now;
                    playHonk();
                    break;
                }
            }
        }, 600);
        // Club strikes: poll the tee-launch cycles (same math as the
        // renderer's synced swings) and play a soft tock on each wrap
        const prevCycles = {};
        setInterval(() => {
            if (!audioCtx || state !== 'overworld') return;
            if (typeof npcStates === 'undefined' || !npcStates.length) return;
            const t = performance.now() / 1000;
            for (const s of npcStates) {
                if (!s.idle || s.arcIdx == null) continue;
                const cyc = (t * 0.45 + s.arcIdx * 0.37) % 1.6;
                if (prevCycles[s.arcIdx] != null && cyc < prevCycles[s.arcIdx]
                    && Math.random() < 0.7) {
                    playStrikeTock();
                }
                prevCycles[s.arcIdx] = cyc;
            }
        }, 90);
    } catch (e) { audioCtx = null; }
}

function playStrikeTock() {
    try {
        const t0 = audioCtx.currentTime;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(950, t0);
        o.frequency.exponentialRampToValueAtTime(320, t0 + 0.05);
        g.gain.setValueAtTime(0.18, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
        o.connect(g);
        g.connect(audioMaster);
        o.start(t0);
        o.stop(t0 + 0.08);
    } catch (e) {}
}

// Bright two-note coin chime for player purchases
function playChime() {
    if (!audioCtx) return;
    try {
        const t0 = audioCtx.currentTime;
        [[880, 0], [1318.5, 0.07]].forEach(([f, dt]) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'triangle';
            o.frequency.setValueAtTime(f, t0 + dt);
            g.gain.setValueAtTime(0.0001, t0 + dt);
            g.gain.exponentialRampToValueAtTime(0.14, t0 + dt + 0.015);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.22);
            o.connect(g);
            g.connect(audioMaster);
            o.start(t0 + dt);
            o.stop(t0 + dt + 0.25);
        });
    } catch (e) {}
}

// Little rising fanfare for tournament ceremonies
function playFanfare() {
    if (!audioCtx) return;
    try {
        const t0 = audioCtx.currentTime;
        [[523.3, 0], [659.3, 0.12], [784, 0.24], [1046.5, 0.36]].forEach(([f, dt]) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'square';
            o.frequency.setValueAtTime(f, t0 + dt);
            g.gain.setValueAtTime(0.0001, t0 + dt);
            g.gain.exponentialRampToValueAtTime(0.055, t0 + dt + 0.02);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.3);
            o.connect(g);
            g.connect(audioMaster);
            o.start(t0 + dt);
            o.stop(t0 + dt + 0.32);
        });
    } catch (e) {}
}

// Distant thunder: a slow swell of deep filtered noise
function playThunder() {
    if (!audioCtx) return;
    try {
        const t0 = audioCtx.currentTime;
        const len = 2.2;
        const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * len, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        let last = 0;
        for (let k = 0; k < d.length; k++) {
            // Brown-ish noise: integrate white noise
            last = (last + (Math.random() * 2 - 1) * 0.02);
            last *= 0.998;
            d[k] = last * 3;
        }
        const srcN = audioCtx.createBufferSource();
        srcN.buffer = buf;
        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 140;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.22, t0 + 0.5);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
        srcN.connect(lp);
        lp.connect(g);
        g.connect(audioMaster);
        srcN.start(t0);
    } catch (e) {}
}

// Crowd applause: a decaying burst of filtered noise claps
function playApplause() {
    if (!audioCtx) return;
    try {
        const t0 = audioCtx.currentTime;
        for (let i = 0; i < 16; i++) {
            const ts = t0 + Math.random() * 1.1 * (0.3 + i / 16);
            const len = 0.03;
            const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * len, audioCtx.sampleRate);
            const d = buf.getChannelData(0);
            for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1);
            const srcN = audioCtx.createBufferSource();
            srcN.buffer = buf;
            const bp = audioCtx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 900 + Math.random() * 900;
            const g = audioCtx.createGain();
            g.gain.setValueAtTime(0.05 * (1 - i / 20), ts);
            g.gain.exponentialRampToValueAtTime(0.001, ts + len);
            srcN.connect(bp);
            bp.connect(g);
            g.connect(audioMaster);
            srcN.start(ts);
        }
    } catch (e) {}
}

// Cart honk: two friendly beeps
function playHonk() {
    if (!audioCtx) return;
    try {
        const t0 = audioCtx.currentTime;
        [[620, 0], [495, 0.13]].forEach(([f, dt]) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'triangle';
            o.frequency.setValueAtTime(f, t0 + dt);
            g.gain.setValueAtTime(0.0001, t0 + dt);
            g.gain.linearRampToValueAtTime(0.07, t0 + dt + 0.015);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.12);
            o.connect(g);
            g.connect(audioMaster);
            o.start(t0 + dt);
            o.stop(t0 + dt + 0.14);
        });
    } catch (e) {}
}

// Night frog croaks from the ponds — low pulsing ribbits after dark
function scheduleFrogCroak() {
    if (!audioCtx) return;
    setTimeout(() => {
        if (!audioCtx) return;
        try {
            const h = ((((resort.worldClock || 0) / 60) % 24) + 24) % 24;
            const night = h >= 20 || h < 5.5;
            const pondsAbout = typeof dragonStates !== 'undefined'
                && dragonStates && dragonStates.length > 0; // dragonflies mark ponds
            const sceneOk = state === 'overworld' || state === 'menu';
            if (night && sceneOk && pondsAbout) {
                const t0 = audioCtx.currentTime;
                const croaks = 2 + Math.floor(Math.random() * 3);
                for (let i = 0; i < croaks; i++) {
                    const o = audioCtx.createOscillator();
                    const g = audioCtx.createGain();
                    const ts = t0 + i * (0.16 + Math.random() * 0.05);
                    const f0 = 95 + Math.random() * 30;
                    o.type = 'square';
                    o.frequency.setValueAtTime(f0, ts);
                    o.frequency.exponentialRampToValueAtTime(f0 * 0.75, ts + 0.11);
                    const lp = audioCtx.createBiquadFilter();
                    lp.type = 'lowpass';
                    lp.frequency.value = 500;
                    g.gain.setValueAtTime(0, ts);
                    g.gain.linearRampToValueAtTime(0.05, ts + 0.02);
                    g.gain.exponentialRampToValueAtTime(0.001, ts + 0.13);
                    o.connect(lp);
                    lp.connect(g);
                    g.connect(audioMaster);
                    o.start(ts);
                    o.stop(ts + 0.15);
                }
            }
        } catch (e) {}
        scheduleFrogCroak();
    }, 6000 + Math.random() * 9000);
}

// Occasional gull cries — descending mewing squawks, daytime + gulls only
function scheduleGullCry() {
    if (!audioCtx) return;
    setTimeout(() => {
        if (!audioCtx) return;
        try {
            const h = ((((resort.worldClock || 0) / 60) % 24) + 24) % 24;
            const gullsAbout = typeof gullStates !== 'undefined'
                && gullStates && gullStates.length > 0;
            const sceneOk = state === 'overworld' || state === 'menu' || state === 'playing';
            if (h > 6 && h < 20 && sceneOk && gullsAbout) {
                const t0 = audioCtx.currentTime;
                const cries = 1 + Math.floor(Math.random() * 3);
                for (let i = 0; i < cries; i++) {
                    const o = audioCtx.createOscillator();
                    const g = audioCtx.createGain();
                    const ts = t0 + i * (0.28 + Math.random() * 0.1);
                    const f0 = 900 + Math.random() * 250;
                    o.type = 'sawtooth';
                    o.frequency.setValueAtTime(f0, ts);
                    o.frequency.exponentialRampToValueAtTime(f0 * 1.35, ts + 0.07);
                    o.frequency.exponentialRampToValueAtTime(f0 * 0.62, ts + 0.3);
                    const lp = audioCtx.createBiquadFilter();
                    lp.type = 'lowpass';
                    lp.frequency.value = 2400;
                    g.gain.setValueAtTime(0, ts);
                    g.gain.linearRampToValueAtTime(0.045, ts + 0.03);
                    g.gain.exponentialRampToValueAtTime(0.001, ts + 0.32);
                    o.connect(lp);
                    lp.connect(g);
                    g.connect(audioMaster);
                    o.start(ts);
                    o.stop(ts + 0.35);
                }
            }
        } catch (e) {}
        scheduleGullCry();
    }, 9000 + Math.random() * 16000);
}

function scheduleChirp() {
    if (!audioCtx) return;
    setTimeout(() => {
        if (!audioCtx) return;
        try {
            const h = ((((resort.worldClock || 0) / 60) % 24) + 24) % 24;
            const sceneOk = state === 'overworld' || state === 'menu' || state === 'playing';
            const raining = typeof rainEnvNow === 'number' && rainEnvNow > 0.3;
            if (h > 5.5 && h < 20 && sceneOk && !raining) {
                // A short randomized birdsong phrase
                const t0 = audioCtx.currentTime;
                const notes = 2 + Math.floor(Math.random() * 3);
                for (let i = 0; i < notes; i++) {
                    const o = audioCtx.createOscillator();
                    const g = audioCtx.createGain();
                    const f = 2300 + Math.random() * 1800;
                    const ts = t0 + i * (0.09 + Math.random() * 0.06);
                    o.frequency.setValueAtTime(f, ts);
                    o.frequency.exponentialRampToValueAtTime(f * (1.25 + Math.random() * 0.3), ts + 0.06);
                    g.gain.setValueAtTime(0, ts);
                    g.gain.linearRampToValueAtTime(0.16, ts + 0.02);
                    g.gain.exponentialRampToValueAtTime(0.001, ts + 0.11);
                    o.connect(g);
                    g.connect(audioMaster);
                    o.start(ts);
                    o.stop(ts + 0.13);
                }
            } else if (sceneOk) {
                // Night: sparse cricket trills, quieter and lower
                const t0 = audioCtx.currentTime;
                for (let i = 0; i < 3; i++) {
                    const o = audioCtx.createOscillator();
                    const g = audioCtx.createGain();
                    const ts = t0 + i * 0.045;
                    o.frequency.setValueAtTime(1450 + Math.random() * 250, ts);
                    g.gain.setValueAtTime(0, ts);
                    g.gain.linearRampToValueAtTime(0.07, ts + 0.012);
                    g.gain.exponentialRampToValueAtTime(0.001, ts + 0.04);
                    o.connect(g);
                    g.connect(audioMaster);
                    o.start(ts);
                    o.stop(ts + 0.05);
                }
            }
        } catch (e) {}
        scheduleChirp();
    }, 1800 + Math.random() * 4200);
}
document.addEventListener('touchstart', initAmbientAudio, { once: true });
// iOS suspends the AudioContext when the app backgrounds and does NOT
// resume it by itself — without these, all sound dies permanently after
// the first app switch until a full reload
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    // Backgrounding may be the last thing this tab ever does on iOS —
    // bank everything right now instead of hoping for the next autosave
    if (document.hidden) {
        try {
            resort.lastTickMs = Date.now();
            saveResort();
            saveWorldCourse();
        } catch (e) {}
    }
});
window.addEventListener('pagehide', () => {
    try {
        resort.lastTickMs = Date.now();
        saveResort();
        saveWorldCourse();
    } catch (e) {}
});
document.addEventListener('touchstart', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
});
document.addEventListener('mousedown', initAmbientAudio, { once: true });

// ---- Start! ----
// Offline catch-up runs HERE, not at module evaluation: it can call
// notify(), whose state lives in let-declarations further up the file —
// calling during evaluation crashed every device that had offline
// earnings (TDZ), i.e. every veteran save, while fresh browsers passed.
applyOfflineCatchup();
if (typeof init3D === 'function') init3D();
requestAnimationFrame(gameLoop);
