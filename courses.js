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

// Line of trees along an edge — never overwrites playable terrain
function treeLine(grid, x1, y1, x2, y2, width) {
    for (let r = y1; r <= y2; r++) {
        for (let c = x1; c <= x2; c++) {
            if (r < 0 || r >= grid.length || c < 0 || c >= grid[0].length) continue;
            const cur = grid[r][c];
            // Trees can line fairways/greens but never sit on them
            if (cur === T.FAIRWAY || cur === T.GREEN || cur === T.TEE ||
                cur === T.SAND || cur === T.WATER || cur === T.PATH) continue;
            grid[r][c] = T.TREE;
        }
    }
}

// ============================================================
//  COURSE 1: Sunny Meadows (Beginner)
//  Teaches: aim, strength, accuracy mini-game
// ============================================================

function makeHole1_1() {
    // Par 3 — "First Swing". Gimmick: dead simple intro. Huge green, no hazards blocking the line.
    const cols = 48, rows = 72;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Generous fairway corridor
    fillRect(g, 14, 8, 33, 58, T.FAIRWAY);
    // Enormous friendly green
    fillCircle(g, 24, 14, 10, T.GREEN);
    // A single cosmetic bunker off to the side (doesn't block the line)
    fillCircle(g, 9, 22, 3, T.SAND);
    // Tee (with rough gap)
    fillRect(g, 22, 63, 26, 68, T.TEE);
    // Tree borders
    treeLine(g, 0, 0, 6, rows - 1);
    treeLine(g, 41, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 24, y: 65 }, hole: { x: 24, y: 14 }, par: 3, name: 'First Swing' };
}

function makeHole1_2() {
    // Par 4 — "The Fork". Gimmick: split fairway. Left = safe + longer. Right = risky + shorter over sand.
    const cols = 56, rows = 195;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Shared tee fairway
    fillRect(g, 22, 130, 33, 178, T.FAIRWAY);
    // LEFT branch — safe, wide, curves around the hazard
    fillRect(g, 8, 55, 24, 135, T.FAIRWAY);
    fillRect(g, 10, 15, 28, 60, T.FAIRWAY);
    // RIGHT branch — narrower, shorter, forces a carry over sand
    fillRect(g, 33, 85, 47, 135, T.FAIRWAY);
    fillRect(g, 28, 15, 44, 90, T.FAIRWAY);
    // Central hazard dividing the two routes (sand islands in rough)
    fillCircle(g, 29, 110, 4, T.SAND);
    fillCircle(g, 30, 95, 4, T.SAND);
    fillCircle(g, 28, 80, 3, T.SAND);
    // Green — favors the left route slightly (pin on left side)
    fillCircle(g, 20, 15, 7, T.GREEN);
    fillCircle(g, 11, 18, 3, T.SAND);
    fillCircle(g, 30, 18, 3, T.SAND);
    // Tee (with rough gap)
    fillRect(g, 25, 183, 30, 188, T.TEE);
    // Tree borders
    treeLine(g, 0, 0, 6, rows - 1);
    treeLine(g, 49, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 27, y: 185 }, hole: { x: 20, y: 15 }, par: 4, name: 'The Fork' };
}

function makeHole1_3() {
    // Par 5 — "Go For It". Gimmick: water bisects fairway. Lay up for 3 easy shots OR carry for reach-in-2.
    const cols = 54, rows = 252;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Upper fairway (after water, running up to green)
    fillRect(g, 16, 15, 38, 92, T.FAIRWAY);
    // Lower fairway (tee side, up to the water's edge)
    fillRect(g, 16, 120, 38, 235, T.FAIRWAY);
    // Water hazard cutting the fairway — forces lay-up or carry
    fillRect(g, 4, 98, 50, 116, T.WATER);
    // Green
    fillCircle(g, 27, 20, 8, T.GREEN);
    fillCircle(g, 13, 22, 3, T.SAND);
    fillCircle(g, 41, 22, 3, T.SAND);
    // Layup target bunker (punishes a sloppy lay-up)
    fillCircle(g, 18, 130, 3, T.SAND);
    // Tee (with rough gap)
    fillRect(g, 25, 241, 29, 246, T.TEE);
    // Tree borders
    treeLine(g, 0, 0, 6, rows - 1);
    treeLine(g, 47, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 27, y: 243 }, hole: { x: 27, y: 20 }, par: 5, name: 'Go For It' };
}

// ============================================================
//  COURSE 2: Oceanside Links (Intermediate)
//  Teaches: water carries, angle decisions
// ============================================================

function makeHole2_1() {
    // Par 4 — "Corner Cut". Gimmick: dogleg left with water on the inside. Cut the corner for a shorter approach.
    const cols = 54, rows = 205;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Tee leg (straight up from tee on the right side)
    fillRect(g, 33, 125, 46, 188, T.FAIRWAY);
    // Corner / bend
    fillRect(g, 10, 80, 46, 130, T.FAIRWAY);
    // Approach to green (upper-left)
    fillRect(g, 10, 15, 30, 85, T.FAIRWAY);
    // Water on the inside of the dogleg (left of tee leg, tempting a shortcut)
    fillRect(g, 4, 135, 30, 188, T.WATER);
    // Green
    fillCircle(g, 18, 18, 7, T.GREEN);
    fillCircle(g, 10, 20, 3, T.SAND);
    fillCircle(g, 26, 22, 3, T.SAND);
    // Fairway bunker rewarding committed cut
    fillCircle(g, 34, 105, 3, T.SAND);
    // Tee (with rough gap)
    fillRect(g, 38, 194, 42, 199, T.TEE);
    // Tree borders
    treeLine(g, 0, 0, 3, 130);
    treeLine(g, 47, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 40, y: 196 }, hole: { x: 18, y: 18 }, par: 4, name: 'Corner Cut' };
}

function makeHole2_2() {
    // Par 3 — "Island Green". Gimmick: pure precision, no bail-out.
    const cols = 50, rows = 90;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Tee area
    fillRect(g, 18, 72, 31, 78, T.FAIRWAY);
    fillRect(g, 22, 81, 27, 86, T.TEE);
    // Water lake (the whole middle)
    fillRect(g, 5, 10, 45, 65, T.WATER);
    // Island green
    fillCircle(g, 25, 25, 9, T.GREEN);
    // Sand on the island (punishes slight miss)
    fillCircle(g, 18, 28, 2, T.SAND);
    fillCircle(g, 32, 22, 2, T.SAND);
    return { grid: g, cols, rows, tee: { x: 25, y: 83 }, hole: { x: 25, y: 25 }, par: 3, name: 'Island Green' };
}

function makeHole2_3() {
    // Par 5 — "Peninsula". Gimmick: fairway snakes between water pockets. Every shot is a risk/reward angle choice.
    const cols = 60, rows = 270;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Tee leg (right side, safe)
    fillRect(g, 32, 200, 46, 258, T.FAIRWAY);
    // Mid fairway — narrows between two water pockets
    fillRect(g, 18, 140, 42, 200, T.FAIRWAY);
    // Approach fairway
    fillRect(g, 16, 70, 40, 145, T.FAIRWAY);
    // Final approach near green
    fillRect(g, 18, 15, 38, 75, T.FAIRWAY);
    // Water pocket 1: left of tee leg
    fillRect(g, 4, 155, 28, 255, T.WATER);
    // Water pocket 2: right of mid fairway
    fillRect(g, 44, 90, 56, 205, T.WATER);
    // Water pocket 3: left of approach
    fillRect(g, 4, 60, 14, 145, T.WATER);
    // Green
    fillCircle(g, 28, 20, 8, T.GREEN);
    fillCircle(g, 19, 22, 3, T.SAND);
    fillCircle(g, 37, 22, 3, T.SAND);
    // Fairway bunkers
    fillCircle(g, 26, 170, 3, T.SAND);
    fillCircle(g, 30, 100, 3, T.SAND);
    // Tee (with rough gap)
    fillRect(g, 37, 263, 41, 268, T.TEE);
    // Tree borders
    treeLine(g, 0, 0, 3, 60);
    treeLine(g, 57, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 39, y: 265 }, hole: { x: 28, y: 20 }, par: 5, name: 'Peninsula' };
}

// ============================================================
//  COURSE 3: Mountain Ridge (Advanced)
//  Teaches: precision, commitment, pressure
// ============================================================

function makeHole3_1() {
    // Par 4 — "The Chute". Gimmick: ultra-narrow tree corridor. Pick driver (risk OB) or iron (safe layup).
    const cols = 42, rows = 200;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Very narrow fairway threaded through dense trees
    fillRect(g, 17, 10, 25, 183, T.FAIRWAY);
    // Tiny green — precision demanded
    fillCircle(g, 21, 14, 5, T.GREEN);
    // Green bunkers pinching the target
    fillCircle(g, 14, 16, 2, T.SAND);
    fillCircle(g, 28, 16, 2, T.SAND);
    // Mid-fairway obstacles (rewards laying back)
    fillCircle(g, 25, 110, 2, T.SAND);
    fillCircle(g, 17, 60, 2, T.SAND);
    // Tee (with rough gap)
    fillRect(g, 19, 188, 23, 193, T.TEE);
    // Dense tree walls enclosing the chute
    treeLine(g, 0, 0, 14, rows - 1);
    treeLine(g, 28, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 21, y: 190 }, hole: { x: 21, y: 14 }, par: 4, name: 'The Chute' };
}

function makeHole3_2() {
    // Par 5 — "Serpent". Gimmick: double dogleg with two water carries — left, right, then green.
    const cols = 60, rows = 275;
    const g = makeGrid(cols, rows, T.ROUGH);
    // First leg — straight up from tee (right side)
    fillRect(g, 34, 200, 48, 258, T.FAIRWAY);
    // First bend — breaks left around water
    fillRect(g, 14, 140, 48, 200, T.FAIRWAY);
    // Second leg — left side, running up
    fillRect(g, 14, 80, 28, 145, T.FAIRWAY);
    // Second bend — breaks right toward green
    fillRect(g, 14, 40, 40, 85, T.FAIRWAY);
    // Green approach
    fillRect(g, 22, 15, 38, 45, T.FAIRWAY);
    // First water carry — inside the first bend
    fillRect(g, 6, 195, 32, 255, T.WATER);
    // Second water carry — inside the second bend (right of second leg)
    fillRect(g, 30, 85, 54, 140, T.WATER);
    // Green
    fillCircle(g, 30, 18, 7, T.GREEN);
    fillCircle(g, 22, 22, 3, T.SAND);
    fillCircle(g, 38, 22, 3, T.SAND);
    // Fairway bunkers on aggressive lines
    fillCircle(g, 20, 170, 3, T.SAND);
    fillCircle(g, 24, 60, 3, T.SAND);
    // Tee (with rough gap)
    fillRect(g, 38, 263, 43, 268, T.TEE);
    // Tree borders
    treeLine(g, 0, 0, 3, 195);
    treeLine(g, 55, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 40, y: 265 }, hole: { x: 30, y: 18 }, par: 5, name: 'Serpent' };
}

function makeHole3_3() {
    // Par 3 — "Abyss". Gimmick: massive water carry to a tiny green. Pure commit-or-splash.
    const cols = 50, rows = 100;
    const g = makeGrid(cols, rows, T.ROUGH);
    // Tee area
    fillRect(g, 18, 80, 31, 88, T.FAIRWAY);
    fillRect(g, 22, 91, 27, 96, T.TEE);
    // Massive water hazard
    fillRect(g, 3, 22, 46, 78, T.WATER);
    // Tiny green with minimal buffer
    fillCircle(g, 25, 14, 5, T.GREEN);
    // Sand pinching the tiny target
    fillCircle(g, 16, 17, 2, T.SAND);
    fillCircle(g, 34, 17, 2, T.SAND);
    // Tree borders
    treeLine(g, 0, 0, 3, rows - 1);
    treeLine(g, 47, 0, cols - 1, rows - 1);
    return { grid: g, cols, rows, tee: { x: 25, y: 93 }, hole: { x: 25, y: 14 }, par: 3, name: 'Abyss' };
}

// ============================================================
//  Career courses
// ============================================================

const CAREER_COURSES = [
    {
        name: 'Sunny Meadows',
        desc: 'Learn the basics — aim, swing, putt',
        color: '#4caf50',
        icon: '\u2600\uFE0F',
        holes: [makeHole1_1(), makeHole1_2(), makeHole1_3()]
    },
    {
        name: 'Oceanside Links',
        desc: 'Water hazards demand sharp angles',
        color: '#3399cc',
        icon: '\u{1F30A}',
        holes: [makeHole2_1(), makeHole2_2(), makeHole2_3()]
    },
    {
        name: 'Mountain Ridge',
        desc: 'Precision and commitment only',
        color: '#666',
        icon: '\u26F0\uFE0F',
        holes: [makeHole3_1(), makeHole3_2(), makeHole3_3()]
    }
];
