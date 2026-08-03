// livepatch gt30 — deployed via the GitHub API while this session's
// container has no git push credentials. Redefines paintAlbedoCell
// (teal accent trim on green fringes + tee rims). Source of truth:
// patches/gt30-teal-trim.patch — fold into renderer3d.js and delete
// this file when normal git pushes are restored.
function paintAlbedoCell(hole, c, r) {
    const px = ALBEDO_PX;
    const x = c * px, y = r * px;
    const t = cellType(hole, c, r);
    const g = albedoCtx;

    g.fillStyle = albedoCellColor(hole, c, r);
    g.fillRect(x, y, px, px);

    const n = cellType(hole, c, r - 1), s = cellType(hole, c, r + 1);
    const w = cellType(hole, c - 1, r), e = cellType(hole, c + 1, r);

    // 45° chamfer: when both orthogonal neighbors at a corner share a type
    // different from ours, cut the corner with their color → smooth regions
    const chamfer = (t2, corner) => {
        g.fillStyle = albedoCellColor(hole,
            corner === 'nw' ? c - 1 : corner === 'ne' ? c + 1 : corner === 'sw' ? c - 1 : c + 1,
            corner === 'nw' || corner === 'ne' ? r - 1 : r + 1);
        g.beginPath();
        if (corner === 'nw') { g.moveTo(x, y); g.lineTo(x + px * 0.55, y); g.lineTo(x, y + px * 0.55); }
        if (corner === 'ne') { g.moveTo(x + px, y); g.lineTo(x + px - px * 0.55, y); g.lineTo(x + px, y + px * 0.55); }
        if (corner === 'sw') { g.moveTo(x, y + px); g.lineTo(x + px * 0.55, y + px); g.lineTo(x, y + px - px * 0.55); }
        if (corner === 'se') { g.moveTo(x + px, y + px); g.lineTo(x + px - px * 0.55, y + px); g.lineTo(x + px, y + px - px * 0.55); }
        g.closePath();
        g.fill();
    };
    if (n !== t && w === n && cellType(hole, c - 1, r - 1) === n) chamfer(n, 'nw');
    if (n !== t && e === n && cellType(hole, c + 1, r - 1) === n) chamfer(n, 'ne');
    if (s !== t && w === s && cellType(hole, c - 1, r + 1) === s) chamfer(s, 'sw');
    if (s !== t && e === s && cellType(hole, c + 1, r + 1) === s) chamfer(s, 'se');

    // Boundary strokes: darker rim on OUR side wherever the neighbor differs
    const PRI = TERRAIN_VERT_PRIORITY;
    const rim = (t === T.WATER) ? shadeHex(ALBEDO_COLORS.base[T.WATER], 0.45)
              : shadeHex(albedoCellColor(hole, c, r), -0.28);
    const lw = (t === T.SAND || t === T.WATER || t === T.GREEN) ? 2.5 : 1.5;
    g.fillStyle = rim;
    // Draw rim only from the higher-priority side so lines don't double
    if (n !== t && (PRI[t] || 0) >= (PRI[n] || 0)) g.fillRect(x, y, px, lw);
    if (s !== t && (PRI[t] || 0) >= (PRI[s] || 0)) g.fillRect(x, y + px - lw, px, lw);
    if (w !== t && (PRI[t] || 0) >= (PRI[w] || 0)) g.fillRect(x, y, lw, px);
    if (e !== t && (PRI[t] || 0) >= (PRI[e] || 0)) g.fillRect(x + px - lw, y, lw, px);

    // Per-terrain detail
    // Grass blades: short angled dashes on every grassy surface — THE thing
    // that makes ground read as turf instead of flat paint up close
    if (t === T.ROUGH || t === T.GRASS || t === T.TREE || t === T.FAIRWAY
        || t === T.GREEN || t === T.TEE || t === T.OOB) {
        const dense = (t === T.GREEN || t === T.TEE) ? 2 : 4;
        const dark = shadeHex(albedoCellColor(hole, c, r), -0.18);
        const lite = shadeHex(albedoCellColor(hole, c, r), 0.14);
        for (let i = 0; i < dense; i++) {
            const h1 = ((c * 928371 + r * 123457 + i * 7919) >>> 0);
            const bx = x + (h1 % (px - 4)) + 1;
            const by = y + ((h1 >> 4) % (px - 5)) + 1;
            const len = 2 + (h1 >> 7) % 3;
            const lean = ((h1 >> 9) % 3) - 1;
            g.strokeStyle = (h1 % 3 === 0) ? lite : dark;
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(bx, by + len);
            g.lineTo(bx + lean, by);
            g.stroke();
        }
    }
    if (t === T.PATH) {
        // Stepping-stone ovals + pebble dots
        const h1 = ((c * 4241) ^ (r * 7013)) >>> 0;
        g.fillStyle = shadeHex(albedoCellColor(hole, c, r), 0.13);
        g.beginPath();
        g.ellipse(x + px / 2 + (h1 % 5) - 2, y + px / 2 + ((h1 >> 3) % 5) - 2,
                  px * 0.30, px * 0.22, ((h1 >> 5) % 6) * 0.5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = shadeHex(albedoCellColor(hole, c, r), -0.2);
        g.fillRect(x + (h1 % (px - 3)), y + ((h1 >> 6) % (px - 3)), 2, 2);
    }
    if (t === T.SAND) {
        // Recessed bunker read: inner shadow on the sun side (light comes
        // from +x, so east edges shade), bright lip on the far side
        const shadow = 'rgba(70,52,25,0.35)';
        const lip = shadeHex(ALBEDO_COLORS.base[T.SAND], 0.42);
        const bw = 4;
        if (e !== T.SAND) { g.fillStyle = shadow; g.fillRect(x + px - bw, y, bw, px); }
        if (n !== T.SAND) { g.fillStyle = shadow; g.fillRect(x, y, px, bw); }
        if (w !== T.SAND) { g.fillStyle = lip; g.fillRect(x, y, 2, px); }
        if (s !== T.SAND) { g.fillStyle = lip; g.fillRect(x, y + px - 2, px, 2); }
        g.fillStyle = 'rgba(120,95,50,0.4)';
        for (let i = 0; i < 6; i++) {
            const hx = ((c * 73 + r * 41 + i * 29) % 10) / 10;
            const hy = ((c * 37 + r * 97 + i * 53) % 10) / 10;
            g.fillRect(x + hx * (px - 2), y + hy * (px - 2), 1.6, 1.6);
        }
        // Rake lines: faint horizontal grooming strokes
        g.strokeStyle = 'rgba(255,240,200,0.18)';
        g.lineWidth = 1;
        g.beginPath();
        for (let i = 0; i < 3; i++) {
            const ry = y + 3 + i * ((px - 6) / 2) + ((c * 13 + r * 7 + i) % 3) - 1;
            g.moveTo(x + 1, ry);
            g.lineTo(x + px - 1, ry);
        }
        g.stroke();
    } else if (t === T.GREEN) {
        // Fringe: cells bordering non-green get a darker inset band,
        // finished with a thin teal accent line (reference trim color)
        const fringe = shadeHex(ALBEDO_COLORS.base[T.GREEN], -0.22);
        const fw = 3;
        if (n !== T.GREEN) { g.fillStyle = fringe; g.fillRect(x, y, px, fw);
            g.fillStyle = 'rgba(70,205,222,0.55)'; g.fillRect(x, y, px, 1.4); }
        if (s !== T.GREEN) { g.fillStyle = fringe; g.fillRect(x, y + px - fw, px, fw);
            g.fillStyle = 'rgba(70,205,222,0.55)'; g.fillRect(x, y + px - 1.4, px, 1.4); }
        if (w !== T.GREEN) { g.fillStyle = fringe; g.fillRect(x, y, fw, px);
            g.fillStyle = 'rgba(70,205,222,0.55)'; g.fillRect(x, y, 1.4, px); }
        if (e !== T.GREEN) { g.fillStyle = fringe; g.fillRect(x + px - fw, y, fw, px);
            g.fillStyle = 'rgba(70,205,222,0.55)'; g.fillRect(x + px - 1.4, y, 1.4, px); }
    } else if (t === T.TEE) {
        // Tee pad: bright inset rim + teal accent — a launch platform
        const rim2 = shadeHex(ALBEDO_COLORS.base[T.TEE], 0.4);
        const iw = 2;
        if (n !== T.TEE) { g.fillStyle = rim2; g.fillRect(x, y, px, iw);
            g.fillStyle = 'rgba(70,205,222,0.7)'; g.fillRect(x, y, px, 1); }
        if (s !== T.TEE) { g.fillStyle = rim2; g.fillRect(x, y + px - iw, px, iw);
            g.fillStyle = 'rgba(70,205,222,0.7)'; g.fillRect(x, y + px - 1, px, 1); }
        if (w !== T.TEE) { g.fillStyle = rim2; g.fillRect(x, y, iw, px);
            g.fillStyle = 'rgba(70,205,222,0.7)'; g.fillRect(x, y, 1, px); }
        if (e !== T.TEE) { g.fillStyle = rim2; g.fillRect(x + px - iw, y, iw, px);
            g.fillStyle = 'rgba(70,205,222,0.7)'; g.fillRect(x + px - 1, y, 1, px); }
    } else if (t === T.WATER) {
        // Shore highlight inside the water side
        const lite = shadeHex(ALBEDO_COLORS.base[T.WATER], 0.35);
        g.fillStyle = lite;
        const sw2 = 3;
        if (n !== T.WATER) g.fillRect(x, y, px, sw2);
        if (s !== T.WATER) g.fillRect(x, y + px - sw2, px, sw2);
        if (w !== T.WATER) g.fillRect(x, y, sw2, px);
        if (e !== T.WATER) g.fillRect(x + px - sw2, y, sw2, px);
    }
}
