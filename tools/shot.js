// Screenshot harness: serve the repo, drive the game into a state, screenshot.
// Usage: node shot.js <outPath> [state]   state: overworld | menu
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');

const REPO = '/home/user/Mobile-App-Test';
const OUT = process.argv[2] || 'shot.png';
const STATE = process.argv[3] || 'overworld';
const DIST = parseInt(process.argv[4] || '2000', 10);
const PC = parseFloat(process.argv[5] || '36');
const PR = parseFloat(process.argv[6] || '40');

(async () => {
    // Static server for the repo
    const server = spawn('python3', ['-m', 'http.server', '8123', '--bind', '127.0.0.1'], { cwd: REPO });
    await new Promise(r => setTimeout(r, 800));

    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium',
        args: [
            '--no-sandbox',
            '--enable-unsafe-swiftshader',
            '--use-gl=angle',
            '--use-angle=swiftshader',
        ]
    });
    try {
        const ctx = await browser.newContext({
            viewport: { width: 1280, height: 590 },
            deviceScaleFactor: 2,
        });
        const page = await ctx.newPage();
        await page.route('**cdn.jsdelivr.net/gh/oversized93/Mobile-App-Test@*/**', (route) => {
            const fs = require('fs');
            const url = route.request().url();
            const path = url.split(/@[0-9a-f]+\//)[1];
            try {
                const body = fs.readFileSync('/home/user/Mobile-App-Test/' + path);
                const type = path.endsWith('.js') ? 'application/javascript'
                           : path.endsWith('.glb') ? 'model/gltf-binary'
                           : path.endsWith('.json') ? 'application/json'
                           : 'application/octet-stream';
                route.fulfill({ body, contentType: type });
            } catch (e) { route.fulfill({ status: 404, body: 'nf' }); }
        });

        page.on('console', m => { if (m.type() === 'error') console.log('[page]', m.text()); });
        page.on('pageerror', e => console.log('[pageerror]', e.message));

        // Pre-seed storage: skip coach overlay
        await page.addInitScript(() => {
            localStorage.setItem('gt_coachSeen', JSON.stringify({ __v: 1, data: true }));
        });

        await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'load' });
        await page.waitForTimeout(1500); // init3D + first frames

        const diag = await page.evaluate(() => ({
            three: typeof THREE !== 'undefined',
            sceneReady: typeof scene3dReady !== 'undefined' && scene3dReady,
            state: typeof state !== 'undefined' ? state : 'n/a',
            webgl: (() => {
                try {
                    const c = document.createElement('canvas');
                    return !!(c.getContext('webgl2') || c.getContext('webgl'));
                } catch (e) { return false; }
            })()
        }));
        console.log('diag:', JSON.stringify(diag));

        await page.evaluate((a) => { window.__SHOT_DIST = a.d; window.__SHOT_PC = a.pc; window.__SHOT_PR = a.pr; }, { d: DIST, pc: PC, pr: PR });
        if (STATE === 'overworld') {
            // Build a representative demo resort, then enter it
            await page.evaluate(() => {
                worldCourse = makeStarterCourse();
                const G = worldCourse.grid, T_ = T;
                const paint = (c0, r0, c1, r1, t) => {
                    for (let r = r0; r <= r1; r++)
                        for (let c = c0; c <= c1; c++)
                            if (G[r] && G[r][c] !== undefined) G[r][c] = t;
                };
                // A hole: tee pad, fairway dogleg, green; sand; water; trees; path
                paint(20, 50, 24, 54, T_.TEE);
                paint(18, 34, 30, 50, T_.FAIRWAY);
                paint(28, 26, 44, 38, T_.FAIRWAY);
                paint(44, 24, 52, 32, T_.GREEN);
                paint(34, 40, 40, 45, T_.SAND);
                paint(12, 20, 22, 30, T_.WATER);
                // Dense forest bands framing the hole (reference-style woods)
                for (let r = 8; r <= 22; r++)
                    for (let c = 30; c <= 66; c++)
                        if (G[r][c] === T_.ROUGH && ((c * 7 + r * 13) % 5) < 4) G[r][c] = T_.TREE;
                for (let r = 44; r <= 58; r++)
                    for (let c = 10; c <= 50; c++)
                        if (G[r][c] === T_.ROUGH && ((c * 11 + r * 3) % 5) < 4) G[r][c] = T_.TREE;
                for (let i = 0; i < 200; i++) {
                    const c = 8 + (i * 37) % 100, r = 8 + (i * 53) % 62;
                    if (G[r][c] === T_.ROUGH && ((c * 7 + r * 13) % 6) < 2) G[r][c] = T_.TREE;
                }
                paint(58, 40, 60, 74, T_.PATH);
                paint(52, 40, 70, 42, T_.PATH);
                // Walkway spur crossing the pond (bridge showcase)
                paint(10, 24, 24, 25, T_.PATH);
                worldCourse.holes.push({
                    id: 1, par: 4,
                    tee: { x: 22, y: 52 }, pin: { x: 48, y: 28 },
                    waypoints: [{ x: 24, y: 36 }]
                });
                // Hole 2: southeast dogleg
                paint(58, 62, 62, 66, T_.TEE);
                paint(60, 56, 78, 64, T_.FAIRWAY);
                paint(76, 48, 88, 58, T_.FAIRWAY);
                paint(86, 46, 92, 52, T_.GREEN);
                paint(70, 66, 76, 70, T_.SAND);
                worldCourse.holes.push({
                    id: 2, par: 4,
                    tee: { x: 60, y: 64 }, pin: { x: 89, y: 49 },
                    waypoints: [{ x: 78, y: 60 }]
                });
                // Hole 3: short north par 3
                paint(98, 18, 102, 22, T_.TEE);
                paint(84, 12, 98, 20, T_.FAIRWAY);
                paint(78, 10, 84, 16, T_.GREEN);
                paint(90, 22, 96, 26, T_.SAND);
                worldCourse.holes.push({
                    id: 3, par: 3,
                    tee: { x: 100, y: 20 }, pin: { x: 80, y: 12 },
                    waypoints: []
                });
                paint(60, 42, 62, 62, T_.PATH);
                paint(96, 26, 98, 42, T_.PATH);
                paint(62, 42, 96, 44, T_.PATH);
                refreshWorldHeights();
                enterOverworld();
                // Frame the demo area nicely
                setCameraOrbit((window.__SHOT_PC || 36) * CELL, (window.__SHOT_PR || 40) * CELL, window.__SHOT_DIST || 2000, Math.PI / 180 * 52, 0.35);
            });
            await page.waitForTimeout(1200);
        }

        await page.screenshot({ path: OUT });
        console.log('saved', OUT);
    } finally {
        await browser.close();
        server.kill();
    }
})().catch(e => { console.error(e); process.exit(1); });
