// ============================================================
//  COURSES — Pre-built career courses
//  Each course has multiple holes, each hole is a terrain grid
// ============================================================

function makeGrid(cols, rows, fill) {
    const g = [];
    for (let r = 0; r < rows; r++) {
        g[r] = [];
        for (let c = 0; c < cols; c++) g[r][c] = fill;
    }
    return g;
}

function fillRect(grid, x1, y1, x2, y2, t) {
    for (let r = y1; r <= y2 && r < grid.length; r++)
        for (let c = x1; c <= x2 && c < grid[0].length; c++)
            grid[r][c] = t;
}

function fillCircle(grid, cx, cy, rad, t) {
    for (let r = 0; r < grid.length; r++)
        for (let c = 0; c < grid[0].length; c++) {
            const dx = c - cx, dy = r - cy;
            if (dx * dx + dy * dy <= rad * rad) grid[r][c] = t;
        }
}

// ---- Course 1: Sunny Meadows (beginner) ----
function makeHole1_1() {
    const cols = 20, rows = 40;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Fairway straight up
    fillRect(g, 7, 3, 12, 36, T.FAIRWAY);
    // Tee box
    fillRect(g, 8, 32, 11, 35, T.TEE);
    // Green
    fillCircle(g, 10, 6, 4, T.GREEN);
    // Sand traps
    fillCircle(g, 5, 15, 2, T.SAND);
    fillCircle(g, 14, 20, 2, T.SAND);
    return { grid: g, cols, rows, tee: { x: 10, y: 34 }, hole: { x: 10, y: 6 }, par: 3, name: 'Straight Shot' };
}

function makeHole1_2() {
    const cols = 26, rows = 64;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Fairway with dogleg right — longer for par 4
    fillRect(g, 8, 38, 14, 58, T.FAIRWAY);
    fillRect(g, 11, 24, 19, 42, T.FAIRWAY);
    fillRect(g, 14, 5, 20, 28, T.FAIRWAY);
    // Tee
    fillRect(g, 9, 55, 12, 58, T.TEE);
    // Green
    fillCircle(g, 17, 8, 4, T.GREEN);
    // Water hazard on the left
    fillRect(g, 3, 18, 10, 26, T.WATER);
    // Sand
    fillCircle(g, 21, 10, 2, T.SAND);
    fillCircle(g, 13, 8, 2, T.SAND);
    // Trees
    fillCircle(g, 5, 40, 2, T.TREE);
    fillCircle(g, 21, 48, 2, T.TREE);
    fillCircle(g, 4, 30, 2, T.TREE);
    return { grid: g, cols, rows, tee: { x: 10, y: 56 }, hole: { x: 17, y: 8 }, par: 4, name: 'Dogleg Right' };
}

function makeHole1_3() {
    const cols = 22, rows = 80;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Long straight fairway — true par 5
    fillRect(g, 6, 3, 14, 74, T.FAIRWAY);
    // Tee
    fillRect(g, 8, 70, 12, 74, T.TEE);
    // Green
    fillCircle(g, 10, 7, 4, T.GREEN);
    // Water across middle
    fillRect(g, 3, 36, 17, 40, T.WATER);
    // Bridge/path over water
    fillRect(g, 8, 36, 12, 40, T.FAIRWAY);
    // Sand traps near green
    fillCircle(g, 5, 9, 2, T.SAND);
    fillCircle(g, 15, 6, 2, T.SAND);
    // More sand mid-fairway
    fillCircle(g, 16, 50, 2, T.SAND);
    // Trees lining fairway
    fillCircle(g, 2, 20, 2, T.TREE);
    fillCircle(g, 18, 20, 2, T.TREE);
    fillCircle(g, 2, 45, 2, T.TREE);
    fillCircle(g, 18, 45, 2, T.TREE);
    fillCircle(g, 2, 60, 2, T.TREE);
    fillCircle(g, 18, 60, 2, T.TREE);
    return { grid: g, cols, rows, tee: { x: 10, y: 72 }, hole: { x: 10, y: 7 }, par: 5, name: 'The Bridge' };
}

// ---- Course 2: Oceanside Links (intermediate) ----
function makeHole2_1() {
    const cols = 24, rows = 60;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Fairway curving left — stretched for par 4
    fillRect(g, 12, 36, 17, 54, T.FAIRWAY);
    fillRect(g, 8, 22, 16, 40, T.FAIRWAY);
    fillRect(g, 4, 4, 12, 26, T.FAIRWAY);
    // Tee
    fillRect(g, 13, 50, 16, 54, T.TEE);
    // Green
    fillCircle(g, 8, 8, 4, T.GREEN);
    // Ocean (water) on right side
    fillRect(g, 19, 0, 23, 59, T.WATER);
    // Sand
    fillCircle(g, 4, 18, 2, T.SAND);
    fillCircle(g, 12, 8, 2, T.SAND);
    // Trees
    fillCircle(g, 3, 35, 2, T.TREE);
    return { grid: g, cols, rows, tee: { x: 14, y: 52 }, hole: { x: 8, y: 8 }, par: 4, name: 'Coastal Curve' };
}

function makeHole2_2() {
    const cols = 20, rows = 36;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Short par 3 over water
    fillRect(g, 7, 24, 12, 32, T.FAIRWAY);
    fillRect(g, 7, 3, 12, 14, T.FAIRWAY);
    // Tee
    fillRect(g, 8, 29, 11, 32, T.TEE);
    // Green (island green!)
    fillCircle(g, 10, 7, 4, T.GREEN);
    // Water surrounding green
    fillRect(g, 3, 14, 16, 24, T.WATER);
    fillCircle(g, 4, 7, 3, T.WATER);
    fillCircle(g, 16, 7, 3, T.WATER);
    // Re-place green on top of water
    fillCircle(g, 10, 7, 4, T.GREEN);
    // Sand on green edges
    fillCircle(g, 6, 5, 1, T.SAND);
    fillCircle(g, 14, 9, 1, T.SAND);
    return { grid: g, cols, rows, tee: { x: 10, y: 30 }, hole: { x: 10, y: 7 }, par: 3, name: 'Island Green' };
}

function makeHole2_3() {
    const cols = 28, rows = 78;
    const g = makeGrid(cols, rows, T.ROUGH);
    // S-curve fairway — long par 5
    fillRect(g, 6, 56, 14, 72, T.FAIRWAY);
    fillRect(g, 12, 40, 20, 60, T.FAIRWAY);
    fillRect(g, 6, 26, 16, 44, T.FAIRWAY);
    fillRect(g, 14, 14, 22, 30, T.FAIRWAY);
    fillRect(g, 8, 4, 18, 18, T.FAIRWAY);
    // Tee
    fillRect(g, 8, 68, 12, 72, T.TEE);
    // Green
    fillCircle(g, 13, 8, 4, T.GREEN);
    // Water hazards
    fillRect(g, 2, 38, 8, 46, T.WATER);
    fillCircle(g, 23, 24, 3, T.WATER);
    // Sand
    fillCircle(g, 9, 8, 2, T.SAND);
    fillCircle(g, 18, 6, 2, T.SAND);
    fillCircle(g, 16, 58, 2, T.SAND);
    // Trees
    fillCircle(g, 3, 60, 2, T.TREE);
    fillCircle(g, 24, 14, 2, T.TREE);
    fillCircle(g, 4, 20, 2, T.TREE);
    fillCircle(g, 22, 50, 2, T.TREE);
    return { grid: g, cols, rows, tee: { x: 10, y: 70 }, hole: { x: 13, y: 8 }, par: 5, name: 'The Serpent' };
}

// ---- Course 3: Mountain Ridge (advanced) ----
function makeHole3_1() {
    const cols = 24, rows = 66;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Narrow fairway with trees on both sides — long par 4
    fillRect(g, 9, 3, 14, 60, T.FAIRWAY);
    // Tee
    fillRect(g, 10, 56, 13, 60, T.TEE);
    // Green
    fillCircle(g, 12, 6, 3, T.GREEN);
    // Dense trees both sides
    fillRect(g, 2, 5, 7, 55, T.TREE);
    fillRect(g, 16, 5, 21, 55, T.TREE);
    // Gaps in trees (bailout zones)
    fillRect(g, 5, 28, 8, 32, T.ROUGH);
    fillRect(g, 15, 40, 18, 44, T.ROUGH);
    // Sand near green
    fillCircle(g, 8, 5, 2, T.SAND);
    fillCircle(g, 16, 7, 2, T.SAND);
    // Mid-fairway sand
    fillCircle(g, 11, 35, 1, T.SAND);
    return { grid: g, cols, rows, tee: { x: 12, y: 58 }, hole: { x: 12, y: 6 }, par: 4, name: 'The Gauntlet' };
}

function makeHole3_2() {
    const cols = 30, rows = 74;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Sharp dogleg left — true par 5
    fillRect(g, 16, 48, 22, 68, T.FAIRWAY);
    fillRect(g, 10, 34, 20, 52, T.FAIRWAY);
    fillRect(g, 6, 20, 14, 38, T.FAIRWAY);
    fillRect(g, 4, 4, 12, 24, T.FAIRWAY);
    // Tee
    fillRect(g, 17, 64, 20, 68, T.TEE);
    // Green
    fillCircle(g, 8, 8, 3, T.GREEN);
    // Water cutting the corner
    fillRect(g, 2, 30, 8, 40, T.WATER);
    // More water near green
    fillCircle(g, 14, 12, 2, T.WATER);
    // Trees
    fillCircle(g, 24, 38, 3, T.TREE);
    fillCircle(g, 14, 16, 2, T.TREE);
    fillCircle(g, 2, 18, 2, T.TREE);
    fillCircle(g, 26, 56, 2, T.TREE);
    // Sand
    fillCircle(g, 5, 14, 2, T.SAND);
    fillCircle(g, 11, 6, 1, T.SAND);
    fillCircle(g, 18, 44, 2, T.SAND);
    return { grid: g, cols, rows, tee: { x: 18, y: 66 }, hole: { x: 8, y: 8 }, par: 5, name: 'Devils Elbow' };
}

function makeHole3_3() {
    const cols = 20, rows = 34;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Short but treacherous par 3
    fillRect(g, 6, 22, 13, 30, T.FAIRWAY);
    fillRect(g, 6, 3, 13, 12, T.FAIRWAY);
    // Tee
    fillRect(g, 8, 27, 11, 30, T.TEE);
    // Green
    fillCircle(g, 10, 6, 3, T.GREEN);
    // Massive water hazard in middle
    fillRect(g, 3, 12, 16, 22, T.WATER);
    // Sand everywhere near green
    fillCircle(g, 6, 4, 2, T.SAND);
    fillCircle(g, 14, 4, 2, T.SAND);
    fillCircle(g, 6, 9, 1, T.SAND);
    fillCircle(g, 14, 9, 1, T.SAND);
    // Trees
    fillCircle(g, 2, 6, 2, T.TREE);
    fillCircle(g, 17, 6, 2, T.TREE);
    return { grid: g, cols, rows, tee: { x: 10, y: 28 }, hole: { x: 10, y: 6 }, par: 3, name: 'Do or Die' };
}

// ---- Build all courses ----
const CAREER_COURSES = [
    {
        name: 'Sunny Meadows',
        desc: 'A gentle course for beginners',
        color: '#4caf50',
        icon: '\u2600\uFE0F',
        holes: [makeHole1_1(), makeHole1_2(), makeHole1_3()]
    },
    {
        name: 'Oceanside Links',
        desc: 'Wind and water await',
        color: '#3399cc',
        icon: '\u{1F30A}',
        holes: [makeHole2_1(), makeHole2_2(), makeHole2_3()]
    },
    {
        name: 'Mountain Ridge',
        desc: 'Only the brave survive',
        color: '#666',
        icon: '\u26F0\uFE0F',
        holes: [makeHole3_1(), makeHole3_2(), makeHole3_3()]
    }
];
