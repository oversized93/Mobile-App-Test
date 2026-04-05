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
    const cols = 24, rows = 44;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Fairway with slight dogleg right
    fillRect(g, 8, 25, 13, 40, T.FAIRWAY);
    fillRect(g, 10, 15, 17, 28, T.FAIRWAY);
    fillRect(g, 13, 5, 18, 18, T.FAIRWAY);
    // Tee
    fillRect(g, 9, 37, 12, 39, T.TEE);
    // Green
    fillCircle(g, 15, 8, 4, T.GREEN);
    // Water hazard on the left
    fillRect(g, 3, 12, 9, 18, T.WATER);
    // Sand
    fillCircle(g, 19, 10, 2, T.SAND);
    fillCircle(g, 11, 8, 2, T.SAND);
    // Trees
    fillCircle(g, 5, 25, 2, T.TREE);
    fillCircle(g, 19, 30, 2, T.TREE);
    return { grid: g, cols, rows, tee: { x: 10, y: 38 }, hole: { x: 15, y: 8 }, par: 4, name: 'Dogleg Right' };
}

function makeHole1_3() {
    const cols = 20, rows = 50;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Long straight fairway
    fillRect(g, 6, 3, 13, 46, T.FAIRWAY);
    // Tee
    fillRect(g, 8, 43, 11, 46, T.TEE);
    // Green
    fillCircle(g, 10, 6, 4, T.GREEN);
    // Water across middle
    fillRect(g, 4, 22, 15, 25, T.WATER);
    // Bridge/path over water
    fillRect(g, 8, 22, 11, 25, T.FAIRWAY);
    // Sand traps near green
    fillCircle(g, 6, 8, 2, T.SAND);
    fillCircle(g, 14, 5, 2, T.SAND);
    // Trees lining fairway
    fillCircle(g, 3, 15, 2, T.TREE);
    fillCircle(g, 16, 15, 2, T.TREE);
    fillCircle(g, 3, 35, 2, T.TREE);
    fillCircle(g, 16, 35, 2, T.TREE);
    return { grid: g, cols, rows, tee: { x: 10, y: 44 }, hole: { x: 10, y: 6 }, par: 5, name: 'The Bridge' };
}

// ---- Course 2: Oceanside Links (intermediate) ----
function makeHole2_1() {
    const cols = 22, rows = 38;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Fairway curving left
    fillRect(g, 10, 20, 15, 34, T.FAIRWAY);
    fillRect(g, 6, 12, 14, 24, T.FAIRWAY);
    fillRect(g, 4, 4, 10, 16, T.FAIRWAY);
    // Tee
    fillRect(g, 11, 31, 14, 34, T.TEE);
    // Green
    fillCircle(g, 7, 7, 4, T.GREEN);
    // Ocean (water) on right side
    fillRect(g, 17, 0, 21, 37, T.WATER);
    // Sand
    fillCircle(g, 4, 12, 2, T.SAND);
    fillCircle(g, 11, 7, 2, T.SAND);
    return { grid: g, cols, rows, tee: { x: 12, y: 32 }, hole: { x: 7, y: 7 }, par: 4, name: 'Coastal Curve' };
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
    const cols = 26, rows = 48;
    const g = makeGrid(cols, rows, T.ROUGH);
    // S-curve fairway
    fillRect(g, 6, 34, 12, 44, T.FAIRWAY);
    fillRect(g, 10, 24, 18, 38, T.FAIRWAY);
    fillRect(g, 14, 16, 20, 28, T.FAIRWAY);
    fillRect(g, 8, 4, 16, 20, T.FAIRWAY);
    // Tee
    fillRect(g, 7, 41, 10, 44, T.TEE);
    // Green
    fillCircle(g, 12, 7, 4, T.GREEN);
    // Water hazards
    fillRect(g, 2, 24, 8, 30, T.WATER);
    fillCircle(g, 21, 20, 3, T.WATER);
    // Sand
    fillCircle(g, 8, 7, 2, T.SAND);
    fillCircle(g, 16, 5, 2, T.SAND);
    fillCircle(g, 14, 38, 2, T.SAND);
    // Trees
    fillCircle(g, 3, 38, 2, T.TREE);
    fillCircle(g, 22, 10, 2, T.TREE);
    fillCircle(g, 4, 14, 2, T.TREE);
    return { grid: g, cols, rows, tee: { x: 8, y: 42 }, hole: { x: 12, y: 7 }, par: 5, name: 'The Serpent' };
}

// ---- Course 3: Mountain Ridge (advanced) ----
function makeHole3_1() {
    const cols = 24, rows = 42;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Narrow fairway with trees on both sides
    fillRect(g, 9, 3, 14, 38, T.FAIRWAY);
    // Tee
    fillRect(g, 10, 35, 13, 38, T.TEE);
    // Green
    fillCircle(g, 12, 6, 3, T.GREEN);
    // Dense trees both sides
    fillRect(g, 2, 5, 7, 35, T.TREE);
    fillRect(g, 16, 5, 21, 35, T.TREE);
    // Gaps in trees
    fillRect(g, 5, 18, 8, 21, T.ROUGH);
    fillRect(g, 15, 26, 18, 29, T.ROUGH);
    // Sand near green
    fillCircle(g, 8, 5, 2, T.SAND);
    fillCircle(g, 16, 7, 2, T.SAND);
    return { grid: g, cols, rows, tee: { x: 12, y: 36 }, hole: { x: 12, y: 6 }, par: 4, name: 'The Gauntlet' };
}

function makeHole3_2() {
    const cols = 28, rows = 44;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Sharp dogleg left
    fillRect(g, 14, 28, 20, 40, T.FAIRWAY);
    fillRect(g, 6, 18, 18, 32, T.FAIRWAY);
    fillRect(g, 4, 4, 10, 22, T.FAIRWAY);
    // Tee
    fillRect(g, 15, 37, 18, 40, T.TEE);
    // Green
    fillCircle(g, 7, 7, 3, T.GREEN);
    // Water cutting the corner
    fillRect(g, 2, 20, 8, 28, T.WATER);
    // Trees
    fillCircle(g, 22, 22, 3, T.TREE);
    fillCircle(g, 12, 10, 2, T.TREE);
    fillCircle(g, 2, 14, 2, T.TREE);
    // Sand
    fillCircle(g, 4, 10, 2, T.SAND);
    fillCircle(g, 10, 5, 1, T.SAND);
    return { grid: g, cols, rows, tee: { x: 16, y: 38 }, hole: { x: 7, y: 7 }, par: 5, name: 'Devils Elbow' };
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
