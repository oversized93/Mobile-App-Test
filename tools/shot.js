// Screenshot harness: serve the repo, drive the game into a state, screenshot.
// Requires playwright-core (npm i playwright-core anywhere) + the Playwright
// chromium at /opt/pw-browsers/chromium (or set PW_CHROMIUM).
// This is how the agent "sees" the game during art iteration.
// Usage: node shot.js <outPath> [state]   state: overworld | menu
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');

const REPO = require('path').resolve(__dirname, '..');
const OUT = process.argv[2] || 'shot.png';
const STATE = process.argv[3] || 'overworld';

(async () => {
    // Static server for the repo
    const server = spawn('python3', ['-m', 'http.server', '8123', '--bind', '127.0.0.1'], { cwd: REPO });
    await new Promise(r => setTimeout(r, 800));

    const browser = await chromium.launch({
        executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium',
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
                for (let i = 0; i < 260; i++) {
                    const c = 8 + (i * 37) % 100, r = 8 + (i * 53) % 62;
                    if (G[r][c] === T_.ROUGH && ((c * 7 + r * 13) % 5) < 3) G[r][c] = T_.TREE;
                }
                paint(58, 40, 60, 74, T_.PATH);
                paint(52, 40, 70, 42, T_.PATH);
                worldCourse.holes.push({
                    id: 1, par: 4,
                    tee: { x: 22, y: 52 }, pin: { x: 48, y: 28 },
                    waypoints: [{ x: 24, y: 36 }]
                });
                refreshWorldHeights();
                enterOverworld();
                // Frame the demo area nicely
                setCameraOrbit(36 * CELL, 40 * CELL, 2000, Math.PI / 180 * 52, 0.35);
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
