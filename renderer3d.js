// ============================================================
//  RENDERER3D — Three.js scene for gameplay rendering
// ============================================================

let scene3d, camera3d, renderer3d;
let grassTexture = null;

// Generate a procedural grass noise texture (call once)
function makeGrassTexture() {
    if (grassTexture) return grassTexture;
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    // Base fill
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    // Speckled noise — pixels near white (so vertex color dominates)
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
        const n = 220 + Math.floor((Math.random() - 0.5) * 60);
        img.data[i] = n;
        img.data[i + 1] = n;
        img.data[i + 2] = n;
        img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Short grass blades — scatter dark specks
    for (let i = 0; i < 1500; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const len = 1 + Math.random() * 2;
        ctx.strokeStyle = `rgba(60,60,60,${0.3 + Math.random() * 0.3})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * len, y + (Math.random() - 0.5) * len);
        ctx.stroke();
    }
    grassTexture = new THREE.CanvasTexture(c);
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    return grassTexture;
}
let terrainGroup, ballMesh, flagGroup, holeMesh;
let targetMesh, aimLineMesh, distRingMesh;
let scene3dReady = false;
let threeCanvas;

// Camera modes
let cam3dMode = 'overhead'; // 'overhead' | 'behind' | 'follow'
let cam3dTarget = { x: 0, y: 0, z: 0 };
let cam3dLookAt = { x: 0, y: 0, z: 0 };

// Orbit camera state — when cam3dOrbitMode is true, pan/zoom/rotate/tilt
// helpers manipulate a spherical-coordinate orbit around a pivot point,
// which gives the player a fully dynamic camera (any yaw + any pitch)
// instead of the fixed tilt the gameplay cameras use.
let cam3dOrbitMode = false;
let cam3dPivotX = 0;
let cam3dPivotZ = 0;
let cam3dDistance = 500;                       // camera-to-pivot distance
let cam3dYaw = 0;                              // radians around Y axis
let cam3dPitch = Math.PI / 180 * 50;           // 0 = horizontal, PI/2 = top-down
const CAM3D_PITCH_MIN = Math.PI / 180 * 12;    // not fully horizontal
const CAM3D_PITCH_MAX = Math.PI / 180 * 88;    // almost top-down
// Distance range spans "finger-on-a-tee" close to "whole resort visible" far.
// The render fog / far plane is 12000–15000, so 10000 stays well inside.
const CAM3D_DIST_MIN = 60;
const CAM3D_DIST_MAX = 10000;

function applyOrbitCamera() {
    const d = cam3dDistance;
    const cosP = Math.cos(cam3dPitch), sinP = Math.sin(cam3dPitch);
    const cosY = Math.cos(cam3dYaw),   sinY = Math.sin(cam3dYaw);
    // Camera sits on a sphere of radius d around the pivot, yaw rotates
    // around Y, pitch lifts off the ground plane
    cam3dTarget.x = cam3dPivotX + d * cosP * sinY;
    cam3dTarget.y = d * sinP;
    cam3dTarget.z = cam3dPivotZ + d * cosP * cosY;
    cam3dLookAt.x = cam3dPivotX;
    cam3dLookAt.y = 0;
    cam3dLookAt.z = cam3dPivotZ;
}

function setCameraOrbit(cx, cz, distance, pitch, yaw) {
    cam3dPivotX = cx;
    cam3dPivotZ = cz;
    if (distance != null) cam3dDistance = Math.max(CAM3D_DIST_MIN, Math.min(CAM3D_DIST_MAX, distance));
    if (pitch != null)    cam3dPitch    = Math.max(CAM3D_PITCH_MIN, Math.min(CAM3D_PITCH_MAX, pitch));
    if (yaw != null)      cam3dYaw      = yaw;
    applyOrbitCamera();
}

function panCameraOrbit(dxScreen, dyScreen) {
    // Screen-space drag → world translation of the pivot in the yaw plane.
    // Scale with distance so a flick feels the same at any zoom.
    const scale = cam3dDistance * 0.0022;
    const cosY = Math.cos(cam3dYaw), sinY = Math.sin(cam3dYaw);
    // Screen-right axis in world space (perpendicular to view, on ground)
    const rx =  cosY, rz = -sinY;
    // Screen-up axis (into the scene, flattened to ground)
    const fx =  sinY, fz =  cosY;
    cam3dPivotX -= (dxScreen * rx + dyScreen * fx) * scale;
    cam3dPivotZ -= (dxScreen * rz + dyScreen * fz) * scale;
    applyOrbitCamera();
}

function zoomCameraOrbit(factor) {
    cam3dDistance = Math.max(CAM3D_DIST_MIN, Math.min(CAM3D_DIST_MAX, cam3dDistance * factor));
    applyOrbitCamera();
}

function rotateCameraOrbit(deltaYaw) {
    cam3dYaw += deltaYaw;
    applyOrbitCamera();
}

function tiltCameraOrbit(deltaPitch) {
    cam3dPitch = Math.max(CAM3D_PITCH_MIN, Math.min(CAM3D_PITCH_MAX, cam3dPitch + deltaPitch));
    applyOrbitCamera();
}

// ---- Color conversion ----
function hexToThreeColor(hex) {
    return new THREE.Color(hex);
}

// ---- Initialize Three.js ----
function init3D() {
    threeCanvas = document.getElementById('three-canvas');
    scene3d = new THREE.Scene();
    scene3d.background = new THREE.Color('#87b8d8'); // sky blue, not teal water
    scene3d.fog = new THREE.Fog('#87b8d8', 5000, 12000);

    // Camera
    camera3d = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 15000);
    camera3d.position.set(0, 300, 0);
    camera3d.lookAt(0, 0, 0);

    // Renderer
    renderer3d = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
    renderer3d.setSize(window.innerWidth, window.innerHeight);
    renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer3d.shadowMap.enabled = false;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene3d.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 50);
    scene3d.add(dirLight);

    // Skybox — gradient sky using vertex colors
    const skyGeo = new THREE.SphereGeometry(13000, 32, 32);
    const skyColors = [];
    const posAttr = skyGeo.getAttribute('position');
    for (let i = 0; i < posAttr.count; i++) {
        const y = posAttr.getY(i);
        const t = (y / 2500 + 1) / 2; // 0 = bottom, 1 = top
        if (t > 0.58) {
            // Upper sky: soft blue-grey
            const p = (t - 0.58) / 0.42;
            skyColors.push(0.45 + p * 0.15, 0.58 + p * 0.18, 0.75 + p * 0.1);
        } else if (t > 0.48) {
            // Horizon: bright haze
            const p = (t - 0.48) / 0.1;
            skyColors.push(0.85 - p * 0.4, 0.88 - p * 0.3, 0.9 - p * 0.15);
        } else {
            // Below horizon: soft green haze matching ground
            const p = t / 0.48;
            skyColors.push(0.1 + p * 0.75, 0.25 + p * 0.63, 0.12 + p * 0.78);
        }
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
    const skyMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide
    });
    scene3d.add(new THREE.Mesh(skyGeo, skyMat));

    // Add some clouds (flat planes in the sky)
    for (let i = 0; i < 12; i++) {
        const cloudGeo = new THREE.PlaneGeometry(
            120 + Math.random() * 200,
            40 + Math.random() * 60
        );
        const cloudMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3 + Math.random() * 0.3,
            side: THREE.DoubleSide
        });
        const cloud = new THREE.Mesh(cloudGeo, cloudMat);
        const angle = Math.random() * Math.PI * 2;
        const dist = 600 + Math.random() * 1200;
        cloud.position.set(
            Math.cos(angle) * dist,
            200 + Math.random() * 300,
            Math.sin(angle) * dist
        );
        cloud.rotation.x = -Math.PI / 2;
        cloud.rotation.z = Math.random() * Math.PI;
        scene3d.add(cloud);
    }

    // Ground plane extending beyond the course — dark rough color, pushed way down
    const groundGeo = new THREE.PlaneGeometry(20000, 20000);
    const groundMat = new THREE.MeshStandardMaterial({
        color: 0x1a4020, // dark rough green, matches rough color
        roughness: 0.95,
        metalness: 0
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -200; // way below terrain so nothing pokes through
    scene3d.add(groundMesh);

    // Groups
    terrainGroup = new THREE.Group();
    scene3d.add(terrainGroup);

    flagGroup = new THREE.Group();
    scene3d.add(flagGroup);

    // Ball
    const ballGeo = new THREE.SphereGeometry(1.0, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1 });
    ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true;
    ballMesh.position.set(0, 2.5, 0);
    scene3d.add(ballMesh);

    // Target marker (ring on ground)
    const ringGeo = new THREE.RingGeometry(4, 6, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffff44, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    targetMesh = new THREE.Mesh(ringGeo, ringMat);
    targetMesh.rotation.x = -Math.PI / 2;
    targetMesh.position.y = 0.2;
    targetMesh.visible = false;
    scene3d.add(targetMesh);

    // Hole — dark recessed circle with white rim
    const holeGroup = new THREE.Group();
    // White rim ring
    const rimGeo = new THREE.RingGeometry(1.2, 1.6, 32);
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.rotation.x = -Math.PI / 2;
    rimMesh.position.y = 0.4;
    rimMesh.renderOrder = 1;
    holeGroup.add(rimMesh);
    // Dark hole interior
    const holeGeo = new THREE.CircleGeometry(1.2, 32);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505, depthWrite: false });
    holeMesh = new THREE.Mesh(holeGeo, holeMat);
    holeMesh.rotation.x = -Math.PI / 2;
    holeMesh.position.y = 0.35;
    holeMesh.renderOrder = 1;
    holeGroup.add(holeMesh);
    // Recessed cylinder for depth
    const cupGeo = new THREE.CylinderGeometry(1.2, 1.2, 2, 32, 1, true);
    const cupMat = new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.DoubleSide });
    const cupMesh = new THREE.Mesh(cupGeo, cupMat);
    cupMesh.position.y = -0.8;
    holeGroup.add(cupMesh);
    scene3d.add(holeGroup);
    // Store ref for repositioning
    holeMesh = holeGroup;

    window.addEventListener('resize', onResize3D);
    scene3dReady = true;
}

function onResize3D() {
    if (!camera3d || !renderer3d) return;
    camera3d.aspect = window.innerWidth / window.innerHeight;
    camera3d.updateProjectionMatrix();
    renderer3d.setSize(window.innerWidth, window.innerHeight);
}

// ---- Build terrain from hole grid (INSTANCED for performance) ----
function buildTerrain3D(hole) {
    // Clear existing terrain
    while (terrainGroup.children.length > 0) {
        const child = terrainGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
        }
        terrainGroup.remove(child);
    }
    while (flagGroup.children.length > 0) {
        const child = flagGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        flagGroup.remove(child);
    }

    const cellSize = CELL;

    // ---- Collect tree cells for instancing ----
    const treeCells = [];
    for (let r = 0; r < hole.rows; r++) {
        for (let c = 0; c < hole.cols; c++) {
            if (hole.grid[r][c] === T.TREE) {
                const treeHash = (c * 7 + r * 13) % 5;
                if (treeHash < 4) treeCells.push({ c, r, treeHash });
            }
        }
    }

    // ---- Build ONE continuous terrain mesh with per-vertex colors ----
    // PlaneGeometry(w, h, segX, segY) has (segX+1) * (segY+1) vertices
    const holeW = hole.cols * cellSize;
    const holeH = hole.rows * cellSize;
    const terrainGeo = new THREE.PlaneGeometry(holeW, holeH, hole.cols, hole.rows);
    terrainGeo.rotateX(-Math.PI / 2);
    // Translate so cell (0,0) starts at world origin
    terrainGeo.translate(holeW / 2, 0, holeH / 2);

    // Helper: convert hex string color to RGB 0-1
    function hexToRGB(hex) {
        const c = new THREE.Color(hex);
        return [c.r, c.g, c.b];
    }
    // Pre-compute RGB for each terrain type
    const terrainRGB = {};
    for (const key in TERRAIN_COLORS) {
        terrainRGB[key] = hexToRGB(TERRAIN_COLORS[key]);
    }
    // TREE cells get grass color underneath so the land looks continuous where trees are
    terrainRGB[T.TREE] = hexToRGB(TERRAIN_COLORS[T.ROUGH]);

    // Sample terrain at a vertex — take the 4 neighboring cells (or clamp at edges)
    function sampleCell(c, r, field) {
        const cc = Math.max(0, Math.min(hole.cols - 1, c));
        const rr = Math.max(0, Math.min(hole.rows - 1, r));
        return field[rr][cc];
    }

    const posAttr = terrainGeo.getAttribute('position');
    const colors = new Float32Array(posAttr.count * 3);
    const vertCols = hole.cols + 1;
    const vertRows = hole.rows + 1;

    // Priority — higher = wins the vertex color
    const typePriority = {
        [T.SAND]: 5,
        [T.GREEN]: 4,
        [T.TEE]: 4,
        [T.FAIRWAY]: 3,
        [T.PATH]: 3,
        [T.ROUGH]: 2,
        [T.TREE]: 2,
        [T.WATER]: 1,
        [T.OOB]: 0,
    };

    for (let i = 0; i < posAttr.count; i++) {
        const vr = Math.floor(i / vertCols);
        const vc = i - vr * vertCols;

        // 4 cells that share this vertex
        const neighbors = [
            { c: vc - 1, r: vr - 1 }, { c: vc, r: vr - 1 },
            { c: vc - 1, r: vr     }, { c: vc, r: vr     }
        ];
        let sumH = 0;
        let waterCount = 0;
        let bestType = T.ROUGH;
        let bestPriority = -1;
        let nearSand = false;
        let nearTree = false;
        for (const n of neighbors) {
            const inBounds = n.c >= 0 && n.c < hole.cols && n.r >= 0 && n.r < hole.rows;
            const t = inBounds ? hole.grid[n.r][n.c] : T.ROUGH;
            const h = (inBounds && hole.heights) ? hole.heights[n.r][n.c] : 0;
            sumH += h;
            if (t === T.WATER) waterCount++;
            // Check if sand/tree is within 2 cells for lip effect
            if (inBounds) {
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        const nc = n.c + dx, nr = n.r + dy;
                        if (nc >= 0 && nc < hole.cols && nr >= 0 && nr < hole.rows) {
                            const nt = hole.grid[nr][nc];
                            if (nt === T.SAND && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) nearSand = true;
                        }
                    }
                }
            }
            const pri = typePriority[t] || 0;
            if (pri > bestPriority) {
                bestPriority = pri;
                bestType = t;
            }
            if (t === T.TREE) nearTree = true;
        }
        const avgH = sumH / 4;
        const isAllWater = (waterCount === 4);
        const y = isAllWater ? -4 : avgH;
        posAttr.setY(i, y);

        let rgb = terrainRGB[bestType] || [0.1, 0.3, 0.15];

        // ---- Fairway mowing stripes ----
        if (bestType === T.FAIRWAY) {
            // Alternate every 3 rows — light vs dark green
            const stripe = Math.floor(vr / 3) % 2;
            const stripeMult = stripe === 0 ? 1.15 : 0.85;
            rgb = [rgb[0] * stripeMult, rgb[1] * stripeMult, rgb[2] * stripeMult];
        }

        // ---- Bunker sand lip — darken edges near sand ----
        if (bestType !== T.SAND && nearSand) {
            rgb = [rgb[0] * 0.75, rgb[1] * 0.75, rgb[2] * 0.7];
        }

        // ---- Tree shadow patch — darken rough under tree canopies ----
        if (nearTree && bestType === T.ROUGH) {
            rgb = [rgb[0] * 0.65, rgb[1] * 0.7, rgb[2] * 0.65];
        }

        colors[i * 3]     = rgb[0];
        colors[i * 3 + 1] = rgb[1];
        colors[i * 3 + 2] = rgb[2];
    }
    posAttr.needsUpdate = true;
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.computeVertexNormals();

    // Procedural grass texture tiled over the terrain
    const grassTex = makeGrassTexture();
    grassTex.repeat.set(hole.cols / 4, hole.rows / 4);

    const terrainMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: grassTex,
        roughness: 0.95,
        metalness: 0,
        flatShading: false
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainGroup.add(terrainMesh);

    // Water is handled directly by vertex colors on the continuous mesh

    // ---- Trees as InstancedMeshes (trunks + canopies) ----
    const dummy = new THREE.Object3D();
    if (treeCells.length > 0) {
        // Split trees into 3 variants based on hash: pine, oak, bush
        const pines = [], oaks = [], bushes = [];
        for (const tc of treeCells) {
            const variant = (tc.c * 31 + tc.r * 17) % 4;
            if (variant === 0) bushes.push(tc);
            else if (variant === 1) oaks.push(tc);
            else pines.push(tc);
        }

        // ---- Pines: tall cone on thin cylinder ----
        if (pines.length > 0) {
            const pTrunkGeo = new THREE.CylinderGeometry(1.8, 3, 30, 6);
            const pTrunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3020 });
            const pTrunkInst = new THREE.InstancedMesh(pTrunkGeo, pTrunkMat, pines.length);
            const pConeGeo = new THREE.ConeGeometry(16, 44, 8);
            const pConeMat = new THREE.MeshStandardMaterial({ color: 0x1a5228 });
            const pConeInst = new THREE.InstancedMesh(pConeGeo, pConeMat, pines.length);
            for (let i = 0; i < pines.length; i++) {
                const { c, r } = pines[i];
                const sz = 0.9 + ((c * 11 + r * 23) % 10) / 25;
                const cellH = (hole.heights && hole.heights[r]) ? (hole.heights[r][c] || 0) : 0;
                dummy.position.set((c + 0.5) * cellSize, 15 * sz + cellH, (r + 0.5) * cellSize);
                dummy.scale.set(sz, sz, sz);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                pTrunkInst.setMatrixAt(i, dummy.matrix);
                dummy.position.set((c + 0.5) * cellSize, 30 * sz + 22 * sz + cellH, (r + 0.5) * cellSize);
                dummy.updateMatrix();
                pConeInst.setMatrixAt(i, dummy.matrix);
            }
            pTrunkInst.instanceMatrix.needsUpdate = true;
            pConeInst.instanceMatrix.needsUpdate = true;
            terrainGroup.add(pTrunkInst);
            terrainGroup.add(pConeInst);
        }

        // ---- Oaks: sphere canopy on thick trunk ----
        if (oaks.length > 0) {
            const oTrunkGeo = new THREE.CylinderGeometry(3, 4.5, 20, 6);
            const oTrunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030 });
            const oTrunkInst = new THREE.InstancedMesh(oTrunkGeo, oTrunkMat, oaks.length);
            const oSphereGeo = new THREE.SphereGeometry(18, 8, 6);
            const oSphereMat = new THREE.MeshStandardMaterial({ color: 0x267a3a });
            const oSphereInst = new THREE.InstancedMesh(oSphereGeo, oSphereMat, oaks.length);
            for (let i = 0; i < oaks.length; i++) {
                const { c, r } = oaks[i];
                const sz = 0.9 + ((c * 13 + r * 29) % 10) / 20;
                const cellH = (hole.heights && hole.heights[r]) ? (hole.heights[r][c] || 0) : 0;
                dummy.position.set((c + 0.5) * cellSize, 10 * sz + cellH, (r + 0.5) * cellSize);
                dummy.scale.set(sz, sz, sz);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                oTrunkInst.setMatrixAt(i, dummy.matrix);
                dummy.position.set((c + 0.5) * cellSize, 30 * sz + cellH, (r + 0.5) * cellSize);
                dummy.updateMatrix();
                oSphereInst.setMatrixAt(i, dummy.matrix);
            }
            oTrunkInst.instanceMatrix.needsUpdate = true;
            oSphereInst.instanceMatrix.needsUpdate = true;
            terrainGroup.add(oTrunkInst);
            terrainGroup.add(oSphereInst);
        }

        // ---- Bushes: just a squashed sphere ----
        if (bushes.length > 0) {
            const bGeo = new THREE.SphereGeometry(10, 8, 6);
            const bMat = new THREE.MeshStandardMaterial({ color: 0x2e7340 });
            const bInst = new THREE.InstancedMesh(bGeo, bMat, bushes.length);
            for (let i = 0; i < bushes.length; i++) {
                const { c, r } = bushes[i];
                const sz = 0.7 + ((c * 17 + r * 41) % 10) / 25;
                const cellH = (hole.heights && hole.heights[r]) ? (hole.heights[r][c] || 0) : 0;
                dummy.position.set((c + 0.5) * cellSize, 6 * sz + cellH, (r + 0.5) * cellSize);
                dummy.scale.set(sz, sz * 0.7, sz);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                bInst.setMatrixAt(i, dummy.matrix);
            }
            bInst.instanceMatrix.needsUpdate = true;
            terrainGroup.add(bInst);
        }
        dummy.scale.set(1, 1, 1);
    }

    // ---- Distant scenery — rings of background trees beyond the course ----
    const holeCenterX = (hole.cols * cellSize) / 2;
    const holeCenterZ = (hole.rows * cellSize) / 2;
    const courseRadius = Math.max(hole.cols, hole.rows) * cellSize * 0.7;
    const distantTrees = [];
    // Two rings of fake trees around the perimeter
    for (let ring = 0; ring < 2; ring++) {
        const radius = courseRadius + 200 + ring * 400;
        const count = 60 + ring * 40;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + ring * 0.3;
            const jitter = (Math.sin(i * 12.9898 + ring) * 43758.5453) % 1 * 0.4 + 0.8;
            const r = radius * jitter;
            const x = holeCenterX + Math.cos(angle) * r;
            const z = holeCenterZ + Math.sin(angle) * r;
            distantTrees.push({ x, z, ring });
        }
    }
    if (distantTrees.length > 0) {
        const dtGeo = new THREE.ConeGeometry(25, 70, 7);
        const dtMat = new THREE.MeshStandardMaterial({ color: 0x1a4828 });
        const dtInst = new THREE.InstancedMesh(dtGeo, dtMat, distantTrees.length);
        for (let i = 0; i < distantTrees.length; i++) {
            const t = distantTrees[i];
            const sz = 1.2 + (i % 5) * 0.3;
            dummy.position.set(t.x, 35 * sz, t.z);
            dummy.scale.set(sz, sz, sz);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            dtInst.setMatrixAt(i, dummy.matrix);
        }
        dtInst.instanceMatrix.needsUpdate = true;
        terrainGroup.add(dtInst);
        dummy.scale.set(1, 1, 1);
    }

    // ---- Distant rolling hills — a few large background shapes ----
    const distantHills = [];
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const r = courseRadius + 1200;
        const x = holeCenterX + Math.cos(angle) * r;
        const z = holeCenterZ + Math.sin(angle) * r;
        distantHills.push({ x, z });
    }
    if (distantHills.length > 0) {
        const hillGeo = new THREE.SphereGeometry(500, 10, 6);
        const hillMat = new THREE.MeshStandardMaterial({ color: 0x2e5e32 });
        const hillInst = new THREE.InstancedMesh(hillGeo, hillMat, distantHills.length);
        for (let i = 0; i < distantHills.length; i++) {
            const h = distantHills[i];
            const sx = 1.5 + (i % 3) * 0.5;
            const sz = 1.5 + ((i + 1) % 3) * 0.5;
            const sy = 0.3 + (i % 2) * 0.1;
            dummy.position.set(h.x, -100, h.z);
            dummy.scale.set(sx, sy, sz);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            hillInst.setMatrixAt(i, dummy.matrix);
        }
        hillInst.instanceMatrix.needsUpdate = true;
        terrainGroup.add(hillInst);
        dummy.scale.set(1, 1, 1);
    }

    // Flag pole + flag — sits on terrain elevation. Skipped when rendering
    // an overworld course that has no active hole.
    if (hole.hole) {
        const flagX = (hole.hole.x + 0.5) * cellSize;
        const flagZ = (hole.hole.y + 0.5) * cellSize;
        const flagH = (hole.heights && hole.heights[hole.hole.y]) ? (hole.heights[hole.hole.y][hole.hole.x] || 0) : 0;

        const poleGeo = new THREE.CylinderGeometry(0.3, 0.3, 28, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(flagX, 14 + flagH, flagZ);
        pole.castShadow = true;
        flagGroup.add(pole);

        const flagGeo = new THREE.PlaneGeometry(8, 5);
        const flagMat = new THREE.MeshStandardMaterial({ color: 0xee2222, side: THREE.DoubleSide });
        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(flagX + 4, 25 + flagH, flagZ);
        flagGroup.add(flag);

        // Position hole (raised to terrain height)
        holeMesh.position.set(flagX, flagH + 0.1, flagZ);
    } else if (holeMesh) {
        // Park the cup far off-screen so it doesn't show during overworld view
        holeMesh.position.set(-100000, -1000, -100000);
    }
}

function getTerrainHeight(t) {
    // Flatten most terrain to avoid overlap glitches between adjacent cells
    switch (t) {
        case T.WATER: return -0.3; // handled separately, this is fallback
        case T.SAND: return -0.1;
        case T.GREEN: return 0.05;
        case T.TEE: return 0.05;
        case T.OOB: return -0.2;
        default: return 0;
    }
}

// ---- Update ball position (world coords → 3D coords) ----
// Our 2D world: x = horizontal, y = vertical (down the screen)
// Three.js: x = horizontal, y = up, z = depth (into screen)
function updateBall3D(wx, wy, wz, color, groundY) {
    if (!ballMesh) return;
    // Render at 1:1 world scale — terrain height comes through via wz
    // Scale air portion (height above ground) by 0.5 to keep arcs readable
    const gY = groundY || 0;
    const airHeight = Math.max(0, (wz || 0) - gY);
    ballMesh.position.set(wx, gY + airHeight * 0.5 + 1.0, wy);
    if (color) ballMesh.material.color.set(color);
}

function updateTarget3D(wx, wy, visible) {
    if (!targetMesh) return;
    targetMesh.position.set(wx, 0.3, wy);
    targetMesh.visible = visible;
}

// ---- Camera control ----
function setCameraOverhead(cx, cz, zoom) {
    // Tilted overhead — about 55° from horizontal so hills are visible
    const height = 500 / (zoom || 1);
    cam3dTarget.x = cx;
    cam3dTarget.y = height;
    cam3dTarget.z = cz + height * 0.7; // back it up so we look forward into hills
    cam3dLookAt.x = cx;
    cam3dLookAt.y = 0;
    cam3dLookAt.z = cz - height * 0.15; // look slightly ahead of camera
}

function setCameraBehindBall(bx, bz, targetX, targetZ, distance) {
    const dx = targetX - bx, dz = targetZ - bz;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = dx / len, nz = dz / len;
    // Raised and tilted down — horizon sits at upper ~20% so play field fills frame
    const dist = distance || 24;
    const height = 28;

    cam3dTarget.x = bx - nx * dist;
    cam3dTarget.y = height;
    cam3dTarget.z = bz - nz * dist;
    // Look closer to the ground so less sky, more fairway
    cam3dLookAt.x = bx + nx * 40;
    cam3dLookAt.y = 6;
    cam3dLookAt.z = bz + nz * 40;
}

// Follow-ball camera — low angle chase cam
function setCameraFollowBall(bx, bz, ballVx, ballVy, ballZ) {
    const speed = Math.sqrt(ballVx * ballVx + ballVy * ballVy);
    if (speed < 10) {
        setCameraBehindBall(bx, bz, bx, bz + 1, 30);
        return;
    }
    const nx = ballVx / speed, nz = ballVy / speed;
    const dist = 40;
    const height = 15 + (ballZ || 0) * 0.2;

    cam3dTarget.x = bx - nx * dist;
    cam3dTarget.y = height;
    cam3dTarget.z = bz - nz * dist;
    // Look far ahead and up
    cam3dLookAt.x = bx + nx * 200;
    cam3dLookAt.y = Math.max(20, (ballZ || 0) * 0.2 + 10);
    cam3dLookAt.z = bz + nz * 200;
}

let cam3dSkipLerp = false; // set true during panning to prevent fights

function updateCamera3D(dt) {
    if (!camera3d) return;
    if (!cam3dSkipLerp) {
        const spd = 3 * dt;
        camera3d.position.x += (cam3dTarget.x - camera3d.position.x) * spd;
        camera3d.position.y += (cam3dTarget.y - camera3d.position.y) * spd;
        camera3d.position.z += (cam3dTarget.z - camera3d.position.z) * spd;
    } else {
        // Only lerp Y (height) during panning, X/Z are set directly
        const spd = 3 * dt;
        camera3d.position.y += (cam3dTarget.y - camera3d.position.y) * spd;
    }
    const targetLook = new THREE.Vector3(cam3dLookAt.x, cam3dLookAt.y, cam3dLookAt.z);
    camera3d.lookAt(targetLook);
}

// ---- Raycast screen point to ground plane (y=0) ----
const raycaster3d = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function screenToWorld3D(sx, sy) {
    if (!camera3d) return { x: 0, y: 0 };
    const ndc = new THREE.Vector2(
        (sx / window.innerWidth) * 2 - 1,
        -(sy / window.innerHeight) * 2 + 1
    );
    raycaster3d.setFromCamera(ndc, camera3d);
    const hit = new THREE.Vector3();
    raycaster3d.ray.intersectPlane(groundPlane, hit);
    if (hit) return { x: hit.x, y: hit.z }; // return as 2D world coords (x, z → x, y)
    return { x: 0, y: 0 };
}

// ---- Pan camera by screen delta ----
function panCamera3D(dx, dy) {
    // Orbit camera route (overworld) — move the pivot, preserve view angle
    if (cam3dOrbitMode) { panCameraOrbit(dx, dy); return; }

    // Convert screen delta to world delta based on camera orientation
    const right = new THREE.Vector3();
    const forward = new THREE.Vector3();
    camera3d.getWorldDirection(forward);
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    forward.crossVectors(new THREE.Vector3(0, 1, 0), right).normalize();

    const scale = camera3d.position.y * 0.004;
    const mx = (-dx * right.x + dy * forward.x) * scale;
    const mz = (-dx * right.z + dy * forward.z) * scale;
    cam3dTarget.x += mx;
    cam3dTarget.z += mz;
    cam3dLookAt.x += mx;
    cam3dLookAt.z += mz;
    // Also set immediate position to prevent lerp shakiness
    camera3d.position.x += mx;
    camera3d.position.z += mz;
}

// ---- Zoom camera ----
function zoomCamera3D(factor) {
    if (cam3dOrbitMode) { zoomCameraOrbit(factor); return; }
    cam3dTarget.y = Math.max(30, Math.min(3000, cam3dTarget.y * factor));
}

// ---- Orbit camera around a point ----
function orbitCamera3D(angle, centerX, centerZ) {
    // Rotate camera position around the center point by angle
    const dx = cam3dTarget.x - centerX;
    const dz = cam3dTarget.z - centerZ;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    cam3dTarget.x = centerX + dx * cos - dz * sin;
    cam3dTarget.z = centerZ + dx * sin + dz * cos;
    camera3d.position.x = cam3dTarget.x;
    camera3d.position.z = cam3dTarget.z;
    // Look at stays the same (center point)
    cam3dLookAt.x = centerX;
    cam3dLookAt.z = centerZ;
}

// ---- Project world point to screen ----
function worldToScreen3D(wx, wy) {
    if (!camera3d) return { x: 0, y: 0, behind: true };
    const vec = new THREE.Vector3(wx, 0, wy);
    vec.project(camera3d);
    // Check if point is behind camera (z > 1 after projection)
    const behind = vec.z > 1;
    return {
        x: (vec.x + 1) / 2 * window.innerWidth,
        y: (-vec.y + 1) / 2 * window.innerHeight,
        behind: behind
    };
}

// ---- Render ----
function render3D() {
    if (!renderer3d || !scene3d || !camera3d) return;
    renderer3d.render(scene3d, camera3d);
}

// ---- Show/hide 3D canvas ----
function show3D() {
    if (threeCanvas) threeCanvas.style.display = 'block';
}

function hide3D() {
    if (threeCanvas) threeCanvas.style.display = 'none';
}
