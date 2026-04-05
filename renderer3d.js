// ============================================================
//  RENDERER3D — Three.js scene for gameplay rendering
// ============================================================

let scene3d, camera3d, renderer3d;
let terrainGroup, ballMesh, flagGroup, holeMesh;
let targetMesh, aimLineMesh, distRingMesh;
let scene3dReady = false;
let threeCanvas;

// Camera modes
let cam3dMode = 'overhead'; // 'overhead' | 'behind' | 'follow'
let cam3dTarget = { x: 0, y: 0, z: 0 };
let cam3dLookAt = { x: 0, y: 0, z: 0 };

// ---- Color conversion ----
function hexToThreeColor(hex) {
    return new THREE.Color(hex);
}

// ---- Initialize Three.js ----
function init3D() {
    threeCanvas = document.getElementById('three-canvas');
    scene3d = new THREE.Scene();
    scene3d.background = new THREE.Color('#1a472a');
    scene3d.fog = new THREE.Fog('#1a472a', 1500, 3000);

    // Camera
    camera3d = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 5000);
    camera3d.position.set(0, 300, 0);
    camera3d.lookAt(0, 0, 0);

    // Renderer
    renderer3d = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
    renderer3d.setSize(window.innerWidth, window.innerHeight);
    renderer3d.setPixelRatio(window.devicePixelRatio);
    renderer3d.shadowMap.enabled = true;
    renderer3d.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene3d.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 600;
    dirLight.shadow.camera.left = -300;
    dirLight.shadow.camera.right = 300;
    dirLight.shadow.camera.top = 300;
    dirLight.shadow.camera.bottom = -300;
    scene3d.add(dirLight);

    // Skybox (simple gradient)
    const skyGeo = new THREE.SphereGeometry(2500, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({
        color: 0x87ceeb,
        side: THREE.BackSide
    });
    scene3d.add(new THREE.Mesh(skyGeo, skyMat));

    // Groups
    terrainGroup = new THREE.Group();
    scene3d.add(terrainGroup);

    flagGroup = new THREE.Group();
    scene3d.add(flagGroup);

    // Ball
    const ballGeo = new THREE.SphereGeometry(1.2, 16, 16);
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
    const rimGeo = new THREE.RingGeometry(3.5, 4.5, 32);
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.rotation.x = -Math.PI / 2;
    rimMesh.position.y = 0.25;
    holeGroup.add(rimMesh);
    // Dark hole interior
    const holeGeo = new THREE.CircleGeometry(3.5, 32);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
    holeMesh = new THREE.Mesh(holeGeo, holeMat);
    holeMesh.rotation.x = -Math.PI / 2;
    holeMesh.position.y = 0.2;
    holeGroup.add(holeMesh);
    // Recessed cylinder for depth
    const cupGeo = new THREE.CylinderGeometry(3.5, 3.5, 3, 32, 1, true);
    const cupMat = new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.DoubleSide });
    const cupMesh = new THREE.Mesh(cupGeo, cupMat);
    cupMesh.position.y = -1.3;
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

// ---- Build terrain from hole grid ----
function buildTerrain3D(hole) {
    // Clear existing terrain
    while (terrainGroup.children.length > 0) {
        const child = terrainGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        terrainGroup.remove(child);
    }
    while (flagGroup.children.length > 0) {
        const child = flagGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        flagGroup.remove(child);
    }

    const cellSize = CELL; // 16 world units = 16 3D units

    // Create terrain cells as flat planes
    for (let r = 0; r < hole.rows; r++) {
        for (let c = 0; c < hole.cols; c++) {
            const t = hole.grid[r][c];
            const color = TERRAIN_COLORS[t] || '#1a3d1a';
            const height = getTerrainHeight(t);

            const geo = new THREE.PlaneGeometry(cellSize, cellSize);
            const mat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(color),
                roughness: 0.9,
                metalness: 0
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(
                (c + 0.5) * cellSize,
                height,
                (r + 0.5) * cellSize
            );
            mesh.receiveShadow = true;
            terrainGroup.add(mesh);

            // Trees — sparse placement (skip some for natural look)
            if (t === T.TREE) {
                const treeHash = (c * 7 + r * 13) % 5;
                if (treeHash < 2) { // only ~40% of tree cells get actual trees
                    const sizeVar = 0.8 + ((c * 31 + r * 17) % 10) / 20; // 0.8 to 1.3
                    const trunkH = 12 * sizeVar;
                    const canopyR = 10 * sizeVar;
                    const canopyH = 18 * sizeVar;

                    const trunkGeo = new THREE.CylinderGeometry(1.2, 2, trunkH, 6);
                    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030 });
                    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
                    trunk.position.set((c + 0.5) * cellSize, trunkH / 2 + height, (r + 0.5) * cellSize);
                    trunk.castShadow = true;
                    terrainGroup.add(trunk);

                    const leafGeo = new THREE.ConeGeometry(canopyR, canopyH, 8);
                    const leafColors = [0x1a6b2a, 0x1a5c2a, 0x227a32, 0x1e6830];
                    const leafMat = new THREE.MeshStandardMaterial({ color: leafColors[treeHash % leafColors.length] });
                    const leaf = new THREE.Mesh(leafGeo, leafMat);
                    leaf.position.set((c + 0.5) * cellSize, trunkH + canopyH / 2 - 2 + height, (r + 0.5) * cellSize);
                    leaf.castShadow = true;
                    terrainGroup.add(leaf);
                }
            }

            // Water shimmer plane (slightly above water)
            if (t === T.WATER) {
                const waterGeo = new THREE.PlaneGeometry(cellSize, cellSize);
                const waterMat = new THREE.MeshStandardMaterial({
                    color: 0x3399cc,
                    transparent: true,
                    opacity: 0.7,
                    roughness: 0.1,
                    metalness: 0.3
                });
                const waterMesh = new THREE.Mesh(waterGeo, waterMat);
                waterMesh.rotation.x = -Math.PI / 2;
                waterMesh.position.set((c + 0.5) * cellSize, height + 0.3, (r + 0.5) * cellSize);
                terrainGroup.add(waterMesh);
            }

            // Sand: slightly raised bumpy look
            if (t === T.SAND) {
                mesh.position.y = height - 0.3;
            }
        }
    }

    // Flag pole + flag
    const flagX = (hole.hole.x + 0.5) * cellSize;
    const flagZ = (hole.hole.y + 0.5) * cellSize;

    const poleGeo = new THREE.CylinderGeometry(0.4, 0.4, 35, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(flagX, 17.5, flagZ);
    pole.castShadow = true;
    flagGroup.add(pole);

    const flagGeo = new THREE.PlaneGeometry(12, 7);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xee2222, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(flagX + 6, 31, flagZ);
    flagGroup.add(flag);

    // Position hole
    holeMesh.position.set(flagX, 0, flagZ);
}

function getTerrainHeight(t) {
    switch (t) {
        case T.WATER: return -1.5;
        case T.SAND: return -0.3;
        case T.GREEN: return 0.2;
        case T.TEE: return 0.3;
        case T.OOB: return -0.5;
        default: return 0;
    }
}

// ---- Update ball position (world coords → 3D coords) ----
// Our 2D world: x = horizontal, y = vertical (down the screen)
// Three.js: x = horizontal, y = up, z = depth (into screen)
function updateBall3D(wx, wy, wz, color) {
    if (!ballMesh) return;
    ballMesh.position.set(wx, (wz || 0) * 0.15 + 1.2, wy);
    if (color) ballMesh.material.color.set(color);
}

function updateTarget3D(wx, wy, visible) {
    if (!targetMesh) return;
    targetMesh.position.set(wx, 0.3, wy);
    targetMesh.visible = visible;
}

// ---- Camera control ----
function setCameraOverhead(cx, cz, zoom) {
    // Overhead: camera looks straight down (or slightly angled)
    const height = 150 / (zoom || 1);
    cam3dTarget.x = cx;
    cam3dTarget.y = height;
    cam3dTarget.z = cz + height * 0.3; // slight offset so we see "ahead"
    cam3dLookAt.x = cx;
    cam3dLookAt.y = 0;
    cam3dLookAt.z = cz;
}

function setCameraBehindBall(bx, bz, targetX, targetZ, distance) {
    // Behind ball looking toward target
    const dx = targetX - bx, dz = targetZ - bz;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = dx / len, nz = dz / len;
    const dist = distance || 40;
    const height = dist * 0.5;

    cam3dTarget.x = bx - nx * dist;
    cam3dTarget.y = height;
    cam3dTarget.z = bz - nz * dist;
    cam3dLookAt.x = bx + nx * 30;
    cam3dLookAt.y = 0;
    cam3dLookAt.z = bz + nz * 30;
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
    cam3dTarget.y = Math.max(20, Math.min(1500, cam3dTarget.y * factor));
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
    if (!camera3d) return { x: 0, y: 0 };
    const vec = new THREE.Vector3(wx, 0, wy);
    vec.project(camera3d);
    return {
        x: (vec.x + 1) / 2 * window.innerWidth,
        y: (-vec.y + 1) / 2 * window.innerHeight
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
