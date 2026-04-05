// ============================================================
//  COURSE BUILDER — RCT-style course designer
// ============================================================

let builderState = {
    grid: null,
    cols: 24,
    rows: 40,
    tee: null,
    hole: null,
    selectedTool: T.FAIRWAY,
    brushSize: 2,
    courseName: 'My Course',
    scrollY: 0,
    painting: false,
    showToolbar: true
};

const BUILDER_TOOLS = [
    { type: T.FAIRWAY, label: 'Fairway', color: TERRAIN_COLORS[T.FAIRWAY] },
    { type: T.GREEN,   label: 'Green',   color: TERRAIN_COLORS[T.GREEN] },
    { type: T.ROUGH,   label: 'Rough',   color: TERRAIN_COLORS[T.ROUGH] },
    { type: T.SAND,    label: 'Sand',    color: TERRAIN_COLORS[T.SAND] },
    { type: T.WATER,   label: 'Water',   color: TERRAIN_COLORS[T.WATER] },
    { type: T.TREE,    label: 'Trees',   color: TERRAIN_COLORS[T.TREE] },
    { type: T.TEE,     label: 'Tee Box', color: TERRAIN_COLORS[T.TEE] },
    { type: T.PATH,    label: 'Path',    color: TERRAIN_COLORS[T.PATH] },
    { type: 'SET_TEE', label: 'Set Tee', color: '#fff' },
    { type: 'SET_HOLE',label: 'Set Hole', color: '#e33' },
    { type: T.OOB,     label: 'Erase',   color: TERRAIN_COLORS[T.OOB] }
];

function builderInit(existingHole) {
    if (existingHole) {
        builderState.grid = existingHole.grid.map(r => [...r]);
        builderState.cols = existingHole.cols;
        builderState.rows = existingHole.rows;
        builderState.tee = existingHole.tee ? { ...existingHole.tee } : null;
        builderState.hole = existingHole.hole ? { ...existingHole.hole } : null;
    } else {
        builderState.cols = 24;
        builderState.rows = 40;
        builderState.grid = makeGrid(builderState.cols, builderState.rows, T.ROUGH);
        builderState.tee = null;
        builderState.hole = null;
    }
    builderState.selectedTool = T.FAIRWAY;
    builderState.scrollY = 0;
    builderState.painting = false;
}

function builderPaint(sx, sy) {
    const bs = builderState;
    const toolbarH = 110;
    if (sy < toolbarH) return; // Don't paint on toolbar

    // Convert screen to grid coords
    const cellSize = Math.min((W() - 10) / bs.cols, (H() - toolbarH - 60) / bs.rows);
    const offsetX = (W() - bs.cols * cellSize) / 2;
    const offsetY = toolbarH + 5;

    const gc = Math.floor((sx - offsetX) / cellSize);
    const gr = Math.floor((sy - offsetY) / cellSize);

    if (gc < 0 || gc >= bs.cols || gr < 0 || gr >= bs.rows) return;

    if (bs.selectedTool === 'SET_TEE') {
        bs.tee = { x: gc, y: gr };
    } else if (bs.selectedTool === 'SET_HOLE') {
        bs.hole = { x: gc, y: gr };
    } else {
        // Paint with brush
        const r = bs.brushSize;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy <= r * r) {
                    const px = gc + dx, py = gr + dy;
                    if (px >= 0 && px < bs.cols && py >= 0 && py < bs.rows) {
                        bs.grid[py][px] = bs.selectedTool;
                    }
                }
            }
        }
    }
}

function builderDraw() {
    const bs = builderState;
    ctx.fillStyle = '#1a3d1a';
    ctx.fillRect(0, 0, W(), H());

    const toolbarH = 110;
    const bottomH = 55;

    // Draw grid
    const cellSize = Math.min((W() - 10) / bs.cols, (H() - toolbarH - bottomH) / bs.rows);
    const offsetX = (W() - bs.cols * cellSize) / 2;
    const offsetY = toolbarH + 5;

    for (let r = 0; r < bs.rows; r++) {
        for (let c = 0; c < bs.cols; c++) {
            ctx.fillStyle = TERRAIN_COLORS[bs.grid[r][c]] || '#1a3d1a';
            ctx.fillRect(offsetX + c * cellSize, offsetY + r * cellSize, cellSize + 0.5, cellSize + 0.5);
        }
    }

    // Grid lines (subtle)
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= bs.rows; r++) {
        ctx.beginPath();
        ctx.moveTo(offsetX, offsetY + r * cellSize);
        ctx.lineTo(offsetX + bs.cols * cellSize, offsetY + r * cellSize);
        ctx.stroke();
    }
    for (let c = 0; c <= bs.cols; c++) {
        ctx.beginPath();
        ctx.moveTo(offsetX + c * cellSize, offsetY);
        ctx.lineTo(offsetX + c * cellSize, offsetY + bs.rows * cellSize);
        ctx.stroke();
    }

    // Draw tee marker
    if (bs.tee) {
        const tx = offsetX + (bs.tee.x + 0.5) * cellSize;
        const ty = offsetY + (bs.tee.y + 0.5) * cellSize;
        drawBall(tx, ty, Math.max(cellSize * 0.3, 3), '#fff');
    }

    // Draw hole marker
    if (bs.hole) {
        const hx = offsetX + (bs.hole.x + 0.5) * cellSize;
        const hy = offsetY + (bs.hole.y + 0.5) * cellSize;
        drawFlag(hx, hy, cellSize / 16);
    }

    // Toolbar background
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, W(), toolbarH);

    // Tool buttons (scrollable row)
    const btnW = 62, btnH = 36, btnGap = 6;
    const toolY = 50;
    const startX = 8;

    ctx.font = 'bold 10px -apple-system,sans-serif';
    for (let i = 0; i < BUILDER_TOOLS.length; i++) {
        const tool = BUILDER_TOOLS[i];
        const bx = startX + i * (btnW + btnGap);
        const selected = bs.selectedTool === tool.type;

        ctx.fillStyle = selected ? '#fff' : 'rgba(255,255,255,0.15)';
        roundRect(bx, toolY, btnW, btnH, 8);
        ctx.fill();

        if (tool.type !== 'SET_TEE' && tool.type !== 'SET_HOLE') {
            ctx.fillStyle = tool.color;
            ctx.fillRect(bx + 4, toolY + 4, 12, 12);
        }

        ctx.fillStyle = selected ? '#000' : '#ccc';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tool.label, bx + (tool.type !== 'SET_TEE' && tool.type !== 'SET_HOLE' ? 19 : 5), toolY + btnH / 2);
    }

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Course Builder', 10, 24);

    // Brush size indicator
    ctx.textAlign = 'right';
    ctx.font = '13px -apple-system,sans-serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText(`Brush: ${bs.brushSize}`, W() - 10, 24);

    // Bottom bar
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, H() - bottomH, W(), bottomH);

    const btnY = H() - bottomH + 8;
    const bw = (W() - 50) / 4;
    drawBtn(10, btnY, bw, 38, 'Back', '#555');
    drawBtn(10 + bw + 8, btnY, bw, 38, 'Size +/-', '#666');
    drawBtn(10 + (bw + 8) * 2, btnY, bw, 38, 'Save', '#2a7fff');
    drawBtn(10 + (bw + 8) * 3, btnY, bw, 38, 'Play', '#4caf50');
}

function builderHandleTouch(sx, sy) {
    const bs = builderState;
    const toolbarH = 110;
    const bottomH = 55;

    // Toolbar tool selection
    if (sy >= 40 && sy < toolbarH) {
        const btnW = 62, btnGap = 6;
        const startX = 8;
        for (let i = 0; i < BUILDER_TOOLS.length; i++) {
            const bx = startX + i * (btnW + btnGap);
            if (sx >= bx && sx <= bx + btnW) {
                bs.selectedTool = BUILDER_TOOLS[i].type;
                return 'tool_selected';
            }
        }
    }

    // Bottom buttons
    if (sy >= H() - bottomH) {
        const bw = (W() - 50) / 4;
        const btnY = H() - bottomH + 8;
        if (hitBtn(sx, sy, 10, btnY, bw, 38)) return 'back';
        if (hitBtn(sx, sy, 10 + bw + 8, btnY, bw, 38)) {
            bs.brushSize = bs.brushSize >= 3 ? 1 : bs.brushSize + 1;
            return 'brush_size';
        }
        if (hitBtn(sx, sy, 10 + (bw + 8) * 2, btnY, bw, 38)) return 'save';
        if (hitBtn(sx, sy, 10 + (bw + 8) * 3, btnY, bw, 38)) return 'play';
    }

    return null;
}

function builderGetHole(par) {
    const bs = builderState;
    return {
        grid: bs.grid.map(r => [...r]),
        cols: bs.cols,
        rows: bs.rows,
        tee: bs.tee ? { ...bs.tee } : { x: Math.floor(bs.cols / 2), y: bs.rows - 4 },
        hole: bs.hole ? { ...bs.hole } : { x: Math.floor(bs.cols / 2), y: 4 },
        par: par || 3,
        name: 'Custom Hole'
    };
}

function builderSave() {
    const bs = builderState;
    const saved = loadData('customHoles', []);
    saved.push({
        grid: bs.grid,
        cols: bs.cols,
        rows: bs.rows,
        tee: bs.tee,
        hole: bs.hole,
        par: 3,
        name: 'Custom Hole ' + (saved.length + 1)
    });
    saveData('customHoles', saved);
    return saved.length;
}
