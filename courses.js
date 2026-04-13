// ============================================================
//  COURSES — Pre-built career courses
//  Each cell = 2 yards. Par 3 ~80 rows, Par 4 ~200 rows, Par 5 ~270 rows
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

// Line of trees along an edge
function treeLine(grid, x1, y1, x2, y2, width) {
    for (let r = y1; r <= y2; r++) {
        for (let c = x1; c <= x2; c++) {
            if (r < 0 || r >= grid.length || c < 0 || c >= grid[0].length) continue;
            grid[r][c] = T.TREE;
        }
    }
}

// ============================================================
//  COURSE 1: Sunny Meadows (Beginner)
// ============================================================

function makeHole1_1() {
    // Par 3 — 150 yds straight shot
    const cols = 50, rows = 85;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Fairway lane
    fillRect(g, 18, 8, 31, 80, T.FAIRWAY);
    // Tee
    fillRect(g, 22, 75, 27, 80, T.TEE);
    // Green
    fillCircle(g, 25, 12, 8, T.GREEN);
    // Sand bunkers near green
    fillCircle(g, 14, 14, 3, T.SAND);
    fillCircle(g, 36, 16, 3, T.SAND);
    // Tree borders
    treeLine(g, 0, 0, 10, rows - 1);
    treeLine(g, 40, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 25, y: 77 }, hole: { x: 25, y: 12 }, par: 3, name: 'Straight Shot' };
}

function makeHole1_2() {
    // Par 4 — 380 yds gentle dogleg right
    const cols = 50, rows = 200;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Fairway with subtle dogleg
    fillRect(g, 14, 150, 26, 195, T.FAIRWAY); // tee section
    fillRect(g, 16, 100, 30, 155, T.FAIRWAY); // middle
    fillRect(g, 20, 50, 35, 110, T.FAIRWAY);  // approach curving right
    fillRect(g, 22, 10, 34, 55, T.FAIRWAY);   // landing area
    // Tee
    fillRect(g, 18, 190, 23, 195, T.TEE);
    // Green
    fillCircle(g, 28, 14, 7, T.GREEN);
    // Bunkers
    fillCircle(g, 20, 18, 3, T.SAND);
    fillCircle(g, 36, 20, 3, T.SAND);
    fillCircle(g, 12, 130, 3, T.SAND);
    // Tree borders
    treeLine(g, 0, 0, 10, rows - 1);
    treeLine(g, 40, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 20, y: 192 }, hole: { x: 28, y: 14 }, par: 4, name: 'Dogleg Right' };
}

function makeHole1_3() {
    // Par 5 — 540 yds with water hazard
    const cols = 55, rows = 270;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Long fairway
    fillRect(g, 18, 15, 35, 265, T.FAIRWAY);
    // Tee
    fillRect(g, 24, 258, 29, 265, T.TEE);
    // Green
    fillCircle(g, 26, 20, 8, T.GREEN);
    // Water hazard mid-fairway
    fillRect(g, 10, 110, 45, 135, T.WATER);
    // Bridge
    fillRect(g, 22, 110, 31, 135, T.FAIRWAY);
    // Bunkers near green
    fillCircle(g, 15, 22, 3, T.SAND);
    fillCircle(g, 38, 22, 3, T.SAND);
    // Mid-fairway bunker (force layup)
    fillCircle(g, 20, 170, 4, T.SAND);
    // Tree borders
    treeLine(g, 0, 0, 10, rows - 1);
    treeLine(g, 45, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 26, y: 261 }, hole: { x: 26, y: 20 }, par: 5, name: 'The Bridge' };
}

// ============================================================
//  COURSE 2: Oceanside Links (Intermediate)
// ============================================================

function makeHole2_1() {
    // Par 4 — 400 yds curving with ocean
    const cols = 55, rows = 210;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Fairway curving left
    fillRect(g, 25, 150, 40, 205, T.FAIRWAY);
    fillRect(g, 15, 90, 35, 160, T.FAIRWAY);
    fillRect(g, 10, 15, 28, 100, T.FAIRWAY);
    // Tee
    fillRect(g, 30, 200, 35, 205, T.TEE);
    // Green
    fillCircle(g, 18, 20, 7, T.GREEN);
    // Ocean on right side
    fillRect(g, 42, 0, 54, 210, T.WATER);
    // Bunkers
    fillCircle(g, 26, 22, 3, T.SAND);
    fillCircle(g, 10, 25, 3, T.SAND);
    fillCircle(g, 22, 120, 3, T.SAND);
    // Tree border left
    treeLine(g, 0, 0, 5, rows - 1);
    return { grid: g, cols, rows, tee: { x: 32, y: 202 }, hole: { x: 18, y: 20 }, par: 4, name: 'Coastal Curve' };
}

function makeHole2_2() {
    // Par 3 — 170 yds Island Green
    const cols = 50, rows = 90;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Tee area
    fillRect(g, 18, 72, 31, 85, T.FAIRWAY);
    fillRect(g, 22, 80, 27, 85, T.TEE);
    // Water lake
    fillRect(g, 5, 10, 45, 65, T.WATER);
    // Island green in the middle
    fillCircle(g, 25, 25, 9, T.GREEN);
    // Small approach landing
    fillRect(g, 22, 35, 28, 40, T.ROUGH);
    // Sand on island
    fillCircle(g, 18, 28, 2, T.SAND);
    fillCircle(g, 32, 22, 2, T.SAND);
    return { grid: g, cols, rows, tee: { x: 25, y: 82 }, hole: { x: 25, y: 25 }, par: 3, name: 'Island Green' };
}

function makeHole2_3() {
    // Par 5 — 560 yds S-curve
    const cols = 60, rows = 280;
    const g = makeGrid(cols, rows, T.ROUGH);
    // S-curve fairway
    fillRect(g, 15, 215, 30, 275, T.FAIRWAY); // tee leg
    fillRect(g, 20, 150, 40, 220, T.FAIRWAY); // first bend right
    fillRect(g, 15, 80, 35, 160, T.FAIRWAY);  // middle back left
    fillRect(g, 22, 15, 42, 90, T.FAIRWAY);   // approach
    // Tee
    fillRect(g, 19, 268, 25, 275, T.TEE);
    // Green
    fillCircle(g, 32, 20, 8, T.GREEN);
    // Water hazards
    fillRect(g, 5, 120, 15, 160, T.WATER);
    fillRect(g, 44, 160, 55, 200, T.WATER);
    // Bunkers
    fillCircle(g, 24, 22, 3, T.SAND);
    fillCircle(g, 40, 26, 3, T.SAND);
    fillCircle(g, 30, 180, 3, T.SAND);
    // Tree borders
    treeLine(g, 0, 0, 6, rows - 1);
    treeLine(g, 52, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 22, y: 271 }, hole: { x: 32, y: 20 }, par: 5, name: 'The Serpent' };
}

// ============================================================
//  COURSE 3: Mountain Ridge (Advanced)
// ============================================================

function makeHole3_1() {
    // Par 4 — 410 yds narrow fairway
    const cols = 45, rows = 215;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Narrow fairway
    fillRect(g, 17, 10, 27, 205, T.FAIRWAY);
    // Tee
    fillRect(g, 19, 198, 25, 205, T.TEE);
    // Green
    fillCircle(g, 22, 14, 6, T.GREEN);
    // Dense tree walls
    treeLine(g, 0, 0, 12, rows - 1);
    treeLine(g, 32, 0, cols - 1, rows - 1);
    // Bunkers near green
    fillCircle(g, 14, 16, 3, T.SAND);
    fillCircle(g, 30, 16, 3, T.SAND);
    // Mid-fairway bunker
    fillCircle(g, 18, 120, 3, T.SAND);
    return { grid: g, cols, rows, tee: { x: 22, y: 201 }, hole: { x: 22, y: 14 }, par: 4, name: 'The Gauntlet' };
}

function makeHole3_2() {
    // Par 5 — 580 yds sharp dogleg left
    const cols = 65, rows = 290;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Sharp dogleg left
    fillRect(g, 30, 220, 48, 285, T.FAIRWAY); // tee leg
    fillRect(g, 22, 140, 50, 230, T.FAIRWAY); // turn area
    fillRect(g, 12, 60, 35, 150, T.FAIRWAY);  // down the left
    fillRect(g, 10, 10, 28, 70, T.FAIRWAY);   // approach
    // Tee
    fillRect(g, 35, 278, 42, 285, T.TEE);
    // Green
    fillCircle(g, 18, 16, 7, T.GREEN);
    // Water cutting the corner
    fillRect(g, 3, 180, 25, 230, T.WATER);
    // Bunkers
    fillCircle(g, 10, 18, 3, T.SAND);
    fillCircle(g, 26, 20, 3, T.SAND);
    fillCircle(g, 40, 160, 3, T.SAND);
    // Tree borders
    treeLine(g, 0, 0, 4, 175);
    treeLine(g, 55, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 38, y: 281 }, hole: { x: 18, y: 16 }, par: 5, name: 'Devils Elbow' };
}

function makeHole3_3() {
    // Par 3 — 195 yds over water
    const cols = 50, rows = 105;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Tee area
    fillRect(g, 18, 88, 31, 100, T.FAIRWAY);
    fillRect(g, 22, 95, 27, 100, T.TEE);
    // Massive water hazard
    fillRect(g, 3, 25, 46, 85, T.WATER);
    // Approach area
    fillRect(g, 20, 15, 30, 30, T.FAIRWAY);
    // Green
    fillCircle(g, 25, 12, 6, T.GREEN);
    // Bunkers guarding green
    fillCircle(g, 15, 16, 3, T.SAND);
    fillCircle(g, 35, 16, 3, T.SAND);
    // Tree borders
    treeLine(g, 0, 0, 3, rows - 1);
    treeLine(g, 47, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 25, y: 97 }, hole: { x: 25, y: 12 }, par: 3, name: 'Do or Die' };
}

// ============================================================
//  Career courses
// ============================================================

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
