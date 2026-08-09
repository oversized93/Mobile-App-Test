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
    grassTexture.encoding = THREE.sRGBEncoding; // match renderer output encoding
    return grassTexture;
}
let terrainGroup, ballMesh, flagGroup, holeMesh;
let cloudsGroup = null;
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
// Zoom in the overworld is FOV-driven (camera stays put, lens narrows)
// which reads as "magnify what's in front of me" rather than "camera
// dives down toward the ground pivot." Dolly-distance only changes via
// the reset button.
const CAM3D_FOV_DEFAULT = 75;
const CAM3D_FOV_MIN = 14;  // most zoomed-in (lens stage)
const CAM3D_FOV_MAX = 85;  // most zoomed-out
let cam3dFov = CAM3D_FOV_DEFAULT;

// Hybrid zoom: one absolute zoom value drives the lens until FOV_MIN,
// then keeps going by dollying the orbit distance in. Gives "inspect a
// single bunker" range without the ground-dive feel at normal zooms.
let cam3dZoom = 1;
const CAM3D_DIST_DEFAULT = 2600;
const CAM3D_DOLLY_MIN = 420;
const CAM3D_ZOOM_MIN = CAM3D_FOV_DEFAULT / CAM3D_FOV_MAX;
const CAM3D_ZOOM_MAX = (CAM3D_FOV_DEFAULT / CAM3D_FOV_MIN) * (CAM3D_DIST_DEFAULT / CAM3D_DOLLY_MIN);

function setCameraZoomAbs(z) {
    cam3dZoom = Math.max(CAM3D_ZOOM_MIN, Math.min(CAM3D_ZOOM_MAX, z));
    const fovWanted = CAM3D_FOV_DEFAULT / cam3dZoom;
    if (fovWanted >= CAM3D_FOV_MIN) {
        setCameraFov(fovWanted);
        cam3dDistance = CAM3D_DIST_DEFAULT;
    } else {
        setCameraFov(CAM3D_FOV_MIN);
        cam3dDistance = Math.max(CAM3D_DOLLY_MIN,
            CAM3D_DIST_DEFAULT * (fovWanted / CAM3D_FOV_MIN));
    }
    applyOrbitCamera();
}

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
    // Snap the Three.js camera directly to the target every time we touch
    // orbit state. This makes every pan/tilt/rotate input immediate —
    // without this, updateCamera3D's smoothing lerp introduces a "push
    // and release" lag where the camera drifts after the finger lifts.
    if (cam3dOrbitMode && typeof camera3d !== 'undefined' && camera3d) {
        camera3d.position.set(cam3dTarget.x, cam3dTarget.y, cam3dTarget.z);
        camera3d.lookAt(cam3dLookAt.x, cam3dLookAt.y, cam3dLookAt.z);
    }
}

function setCameraOrbit(cx, cz, distance, pitch, yaw) {
    cam3dPivotX = cx;
    cam3dPivotZ = cz;
    if (distance != null) cam3dDistance = Math.max(CAM3D_DIST_MIN, Math.min(CAM3D_DIST_MAX, distance));
    if (pitch != null)    cam3dPitch    = Math.max(CAM3D_PITCH_MIN, Math.min(CAM3D_PITCH_MAX, pitch));
    if (yaw != null)      cam3dYaw      = yaw;
    applyOrbitCamera();
}

// Pan bounds — set on entering the overworld so the player can never pan
// the resort fully off-screen and get lost.
let cam3dPanBounds = null; // {minX, maxX, minZ, maxZ}
function setOrbitPanBounds(minX, maxX, minZ, maxZ) {
    cam3dPanBounds = { minX, maxX, minZ, maxZ };
}

function panCameraOrbit(dxScreen, dyScreen) {
    // Screen-space drag → world translation of the pivot in the yaw plane.
    // Scale with distance AND lens zoom so a flick moves the same fraction
    // of the visible area at any zoom level (narrow FOV = slower pan).
    const zoomScale = (typeof cam3dFov !== 'undefined') ? cam3dFov / CAM3D_FOV_DEFAULT : 1;
    const scale = cam3dDistance * 0.0022 * zoomScale;
    const cosY = Math.cos(cam3dYaw), sinY = Math.sin(cam3dYaw);
    // Screen-right axis in world space (perpendicular to view, on ground)
    const rx =  cosY, rz = -sinY;
    // Screen-up axis (into the scene, flattened to ground)
    const fx =  sinY, fz =  cosY;
    cam3dPivotX -= (dxScreen * rx + dyScreen * fx) * scale;
    cam3dPivotZ -= (dxScreen * rz + dyScreen * fz) * scale;
    if (cam3dPanBounds) {
        cam3dPivotX = Math.max(cam3dPanBounds.minX, Math.min(cam3dPanBounds.maxX, cam3dPivotX));
        cam3dPivotZ = Math.max(cam3dPanBounds.minZ, Math.min(cam3dPanBounds.maxZ, cam3dPivotZ));
    }
    applyOrbitCamera();
}

function zoomCameraOrbit(factor) {
    // FOV zoom — narrow lens on pinch-spread (factor<1), widen on pinch-close
    cam3dFov = Math.max(CAM3D_FOV_MIN, Math.min(CAM3D_FOV_MAX, cam3dFov * factor));
    if (typeof camera3d !== 'undefined' && camera3d) {
        camera3d.fov = cam3dFov;
        camera3d.updateProjectionMatrix();
    }
}

// Absolute FOV setter — used by the pinch handler to apply zoom from its
// captured start baseline (prevents compounding drift).
function setCameraFov(fov) {
    cam3dFov = Math.max(CAM3D_FOV_MIN, Math.min(CAM3D_FOV_MAX, fov));
    if (typeof camera3d !== 'undefined' && camera3d) {
        camera3d.fov = cam3dFov;
        camera3d.updateProjectionMatrix();
    }
}

// Restore the default FOV — called when leaving overworld so gameplay
// cameras get their expected field of view back.
function resetCameraFov() {
    cam3dZoom = 1;
    cam3dDistance = CAM3D_DIST_DEFAULT;
    setCameraFov(CAM3D_FOV_DEFAULT);
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

// r128 has no color management: hex colors are stored raw, and with sRGB
// output encoding they get gamma-lifted a second time → washed-out pastels.
// Every authored color must be converted to linear once so the renderer's
// output conversion lands back on the intended sRGB value.
function linC(hex) {
    return new THREE.Color(hex).convertSRGBToLinear();
}

// ---- Initialize Three.js ----
function init3D() {
    threeCanvas = document.getElementById('three-canvas');
    scene3d = new THREE.Scene();
    scene3d.background = linC('#87b8d8'); // sky blue, not teal water
    scene3d.fog = new THREE.Fog(linC('#87b8d8'), 5000, 12000);

    // Camera
    camera3d = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 15000);
    camera3d.position.set(0, 300, 0);
    camera3d.lookAt(0, 0, 0);

    // Renderer — sRGB output + filmic tone mapping. Without these, every
    // hex color renders in linear space and the whole scene reads flat/milky.
    renderer3d = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
    renderer3d.setSize(window.innerWidth, window.innerHeight);
    // Full retina sharpness on modern phones; instancing keeps draw calls
    // low enough that fill rate is the only cost, and A-series GPUs have
    // headroom for this scene at 2x
    renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer3d.outputEncoding = THREE.sRGBEncoding;
    renderer3d.toneMapping = THREE.ACESFilmicToneMapping;
    renderer3d.toneMappingExposure = 1.0;
    renderer3d.shadowMap.enabled = true;
    renderer3d.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting — hemisphere (sky bounce + ground bounce) sells the stylized
    // low-poly look far better than flat ambient; sun light casts soft shadows.
    const hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x3a7d44, 0.85);
    scene3d.add(hemiLight);
    hemiLightRef = hemiLight;

    const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.25);
    dirLightRef = dirLight;
    dirLight.position.set(1400, 2200, 900);
    dirLight.castShadow = true;
    // Ortho shadow frustum sized to cover the 120x80-cell course (~3840x2560
    // world units) with some margin. 2048 map ≈ 2.5 units/texel — chunky but
    // reads as intentional soft stylized shadowing.
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.left = -2600;
    dirLight.shadow.camera.right = 2600;
    dirLight.shadow.camera.top = 2600;
    dirLight.shadow.camera.bottom = -2600;
    dirLight.shadow.camera.near = 100;
    dirLight.shadow.camera.far = 7000;
    dirLight.shadow.bias = -0.0005;
    // Aim the sun at the course center (target defaults to origin; course
    // spans positive X/Z so re-target explicitly)
    dirLight.target.position.set(1920, 0, 1280);
    scene3d.add(dirLight);
    scene3d.add(dirLight.target);

    // Skybox — gradient sky using vertex colors
    const skyGeo = new THREE.SphereGeometry(13000, 32, 32);
    const skyColors = [];
    const posAttr = skyGeo.getAttribute('position');
    // Sky colors are authored in sRGB — store linear so output encoding
    // restores them (same double-lift issue as material colors)
    const lin = (v) => Math.pow(Math.max(0, v), 2.2);
    for (let i = 0; i < posAttr.count; i++) {
        const y = posAttr.getY(i);
        const t = (y / 2500 + 1) / 2; // 0 = bottom, 1 = top
        if (t > 0.58) {
            // Upper sky: soft blue-grey
            const p = (t - 0.58) / 0.42;
            skyColors.push(lin(0.45 + p * 0.15), lin(0.58 + p * 0.18), lin(0.75 + p * 0.1));
        } else if (t > 0.48) {
            // Horizon: bright haze
            const p = (t - 0.48) / 0.1;
            skyColors.push(lin(0.85 - p * 0.4), lin(0.88 - p * 0.3), lin(0.9 - p * 0.15));
        } else {
            // Below horizon: bright sea-mist haze (island world, no dark band)
            const p = t / 0.48;
            skyColors.push(lin(0.34 + p * 0.51), lin(0.5 + p * 0.38), lin(0.52 + p * 0.38));
        }
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
    const skyMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        // The dome sits at ~13000 units — beyond the fog far distance —
        // so with fog on it renders as a flat fog-colored wall
        fog: false
    });
    scene3d.add(new THREE.Mesh(skyGeo, skyMat));
    skyMatRef = skyMat;

    // Starfield: fades in after dark via the day/night pass
    {
        const starPos = [];
        for (let i = 0; i < 220; i++) {
            // Deterministic scatter over the upper hemisphere
            const a = (i * 2.39996) % (Math.PI * 2); // golden angle
            const u = 0.15 + ((i * 73) % 100) / 118;  // elevation bias upward
            const r = 11000;
            starPos.push(
                Math.cos(a) * Math.sqrt(1 - u * u) * r,
                u * r,
                Math.sin(a) * Math.sqrt(1 - u * u) * r
            );
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({
            color: 0xeef4ff, size: 70, sizeAttenuation: true,
            transparent: true, opacity: 0, depthWrite: false
        });
        starMat.toneMapped = false;
        starMatRef = starMat;
        const stars = new THREE.Points(starGeo, starMat);
        stars.renderOrder = -9;
        stars.frustumCulled = false;
        scene3d.add(stars);
    }

    // Add some clouds (flat planes in the sky) — grouped so the overworld
    // camera can hide them (seen from above they read as white debris)
    cloudsGroup = new THREE.Group();
    scene3d.add(cloudsGroup);
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
        cloudsGroup.add(cloud);
    }

    // Ocean backdrop — the resort reads as an island in the sea (reference
    // horizon language) instead of floating over a dark void
    const groundGeo = new THREE.PlaneGeometry(20000, 20000);
    const groundMat = new THREE.MeshStandardMaterial({
        color: linC(0x1f7fb4),
        roughness: 0.6,
        metalness: 0
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -2.5; // just below course level: island-in-ocean
    scene3d.add(groundMesh);
    oceanMatRef = groundMat;

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
    const ringMat = new THREE.MeshBasicMaterial({ color: linC(0xffff44), side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
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
    const cupMat = new THREE.MeshStandardMaterial({ color: linC(0x111111), side: THREE.DoubleSide });
    const cupMesh = new THREE.Mesh(cupGeo, cupMat);
    cupMesh.position.y = -0.8;
    holeGroup.add(cupMesh);
    scene3d.add(holeGroup);
    // Store ref for repositioning
    holeMesh = holeGroup;

    window.addEventListener('resize', onResize3D);
    scene3dReady = true;
    loadWorldAssets();
}

function onResize3D() {
    if (!camera3d || !renderer3d) return;
    camera3d.aspect = window.innerWidth / window.innerHeight;
    camera3d.updateProjectionMatrix();
    renderer3d.setSize(window.innerWidth, window.innerHeight);
}

// ============================================================
//  WORLD ASSETS — curated CC0 GLB models (Kenney), instanced
// ============================================================
// Species lists reference assets/kenney/*.glb. Each model is normalized to
// a target world height at load; per-instance hash variation on top.
const ASSET_SPECIES = {
    pine:  ['tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineRoundA', 'tree_pineRoundC', 'tree_pineTallA', 'tree_pineSmallA'],
    leafy: ['tree_default', 'tree_oak', 'tree_detailed', 'tree_fat'],
    fall:  ['tree_default_fall', 'tree_oak_fall', 'tree_detailed_fall', 'tree_fat_fall'],
    palm:  ['tree_palm', 'tree_palmShort', 'tree_palmTall', 'tree_palmDetailedTall', 'tree_palmBend'],
    bush:  ['plant_bush', 'plant_bushLarge'],
    flower:['flower_redA', 'flower_yellowA', 'flower_purpleA'],
    rockL: ['rock_largeA', 'rock_largeB', 'stone_largeA'],
    rockS: ['rock_smallA', 'rock_smallB', 'rock_smallE'],
    tuft:  ['grass', 'grass_large', 'grass_leafs'],
    flag:  ['flag-red'],
    prop:  ['bench', 'trash', 'flowers', 'park-entrance', 'stall-food',
            'stall-drinks', 'station-fence', 'bridge_wood', 'bridge_woodRound'],
    hero:  ['clubhouse', 'golfcart', 'windmill', 'archsign', 'fountainstatue', 'lighthouse', 'kiosk', 'gazebo', 'statue', 'grandstand', 'golfer']
};
// Non-Kenney asset locations
const ASSET_PATH_NAME = {
    'clubhouse': 'assets/meshy/clubhouse.glb',
    'golfcart': 'assets/meshy/golfcart.glb',
    'windmill': 'assets/meshy/windmill.glb',
    'archsign': 'assets/meshy/archsign.glb',
    'fountainstatue': 'assets/meshy/fountainstatue.glb',
    'lighthouse': 'assets/meshy/lighthouse.glb',
    'kiosk': 'assets/meshy/kiosk.glb',
    'gazebo': 'assets/meshy/gazebo.glb',
    'statue': 'assets/meshy/statue.glb',
    'grandstand': 'assets/meshy/grandstand.glb',
    'golfer': 'assets/meshy/golfer.glb'
};
// Per-model height overrides (props vary too much for one species target)
// Sized to the world's stylized chunky proportions (realistic scale reads
// ant-like next to 3-cell trees)
const ASSET_TARGET_H_NAME = {
    'bench': 22, 'trash': 18, 'flowers': 10, 'park-entrance': 92,
    'stall-food': 62, 'stall-drinks': 62, 'station-fence': 18,
    'clubhouse': 148, 'golfcart': 34, 'windmill': 170,
    'bridge_wood': 26, 'bridge_woodRound': 30, 'archsign': 110,
    'fountainstatue': 52, 'lighthouse': 210, 'kiosk': 68, 'gazebo': 84, 'statue': 58,
    'grandstand': 72,
    'golfer': 34
};
// Target world heights per species (CELL = 32; a good tree spans ~2 cells)
const ASSET_TARGET_H = {
    pine: 118, leafy: 96, fall: 96, palm: 104,
    bush: 26, flower: 15, rockL: 30, rockS: 13, tuft: 11, flag: 46
};

// name -> { parts: [{geometry, material}], scale } once loaded
let worldAssets = null;
let worldAssetsLoading = false;

function loadWorldAssets() {
    if (worldAssets || worldAssetsLoading || typeof THREE.GLTFLoader === 'undefined') return;
    worldAssetsLoading = true;
    const names = [];
    for (const k in ASSET_SPECIES) names.push(...ASSET_SPECIES[k]);
    const loader = new THREE.GLTFLoader();
    const loaded = {};
    let remaining = names.length;
    // Two-phase swap: the two multi-MB heroes (golfer, grandstand) must
    // not gate every tree and bench — when only they remain, the world
    // upgrades immediately and they slot in on arrival
    const HEAVY = { golfer: true, grandstand: true };
    let heavyRemaining = names.filter(n => HEAVY[n]).length;
    let midSwapDone = false;
    const noteDone = (name) => {
        if (HEAVY[name]) heavyRemaining--;
        remaining--;
        if (remaining === 0) {
            finishAssets(loaded);
        } else if (!midSwapDone && heavyRemaining > 0
            && remaining === heavyRemaining) {
            midSwapDone = true;
            finishAssets(loaded);
            worldAssetsLoading = true; // still waiting on the heroes
        }
    };
    const targetOf = (name) => {
        if (ASSET_TARGET_H_NAME[name]) return ASSET_TARGET_H_NAME[name];
        for (const k in ASSET_SPECIES) if (ASSET_SPECIES[k].includes(name)) return ASSET_TARGET_H[k];
        return 40;
    };
    const speciesOf = (name) => {
        for (const k in ASSET_SPECIES) if (ASSET_SPECIES[k].includes(name)) return k;
        return null;
    };
    for (const name of names) {
        const species = speciesOf(name);
        loader.load((window.ASSET_BASE || '') + (ASSET_PATH_NAME[name] || ('assets/kenney/' + name + '.glb')), (gltf) => {
            const parts = [];
            gltf.scene.updateMatrixWorld(true);
            gltf.scene.traverse((node) => {
                if (node.isMesh) {
                    const geo = node.geometry.clone();
                    geo.applyMatrix4(node.matrixWorld);
                    const mats = Array.isArray(node.material) ? node.material : [node.material];
                    if (Array.isArray(node.material) && geo.groups && geo.groups.length) {
                        // Split multi-material geometry into per-material parts
                        for (let gi = 0; gi < geo.groups.length; gi++) {
                            const g = geo.groups[gi];
                            const sub = geo.clone();
                            sub.setDrawRange(g.start, g.count);
                            parts.push({ geometry: sub, material: prepMat(mats[g.materialIndex], species) });
                        }
                    } else {
                        parts.push({ geometry: geo, material: prepMat(mats[0], species) });
                    }
                }
            });
            // Normalize scale from bounding box height, and rebase the
            // geometry so x/z center and the BASE sit at the origin —
            // generated (Meshy) models arrive origin-centered and would
            // otherwise sink half-underground
            const box = new THREE.Box3();
            for (const p of parts) {
                p.geometry.computeBoundingBox();
                box.union(p.geometry.boundingBox);
            }
            const ctr = new THREE.Vector3();
            box.getCenter(ctr);
            for (const p of parts) {
                p.geometry.translate(-ctr.x, -box.min.y, -ctr.z);
            }
            const h = Math.max(0.001, box.max.y - box.min.y);
            loaded[name] = { parts, scale: targetOf(name) / h };
            noteDone(name);
        }, undefined, () => {
            noteDone(name);
        });
    }
}

// Kenney kits ship metallicFactor=1 (frosty sky-reflection look with no
// envmap) and a pastel mint palette that reads washed-out against our
// saturated terrain. Recolor by material name into our art direction;
// leaf hue varies per species. Fall/flower colors keep their authored hue.
const LEAF_TINT = {
    pine: '#2c7a41', leafy: '#4aa254', palm: '#3c9c52', bush: '#459a4e',
    fall: '#cf6a2b'
};
function prepMat(mat, species) {
    const m = mat.clone();
    m.metalness = 0;
    m.roughness = 0.9;
    // Coaster/City kit models use a shared palette texture — leave it alone
    if (m.map) return m;
    const n = (m.name || '').toLowerCase();
    let tint = null;
    if (/leaf/.test(n)) {
        tint = LEAF_TINT[species] || '#3f9a4f';
        // Canopy wind sway: displace vertices by height with a per-instance
        // phase — trunks stay planted, foliage breathes
        m.onBeforeCompile = (shader) => {
            shader.uniforms.uWind = windClock;
            shader.uniforms.uWindAmp = windAmp;
            shader.vertexShader = 'uniform float uWind;\nuniform float uWindAmp;\n'
                + shader.vertexShader.replace(
                '#include <begin_vertex>',
                [
                    '#include <begin_vertex>',
                    '#ifdef USE_INSTANCING',
                    '    float windPhase = instanceMatrix[3].x * 0.045 + instanceMatrix[3].z * 0.06;',
                    '#else',
                    '    float windPhase = 0.0;',
                    '#endif',
                    'transformed.x += sin(uWind * 1.5 + windPhase) * position.y * 0.04 * uWindAmp;',
                    'transformed.z += cos(uWind * 1.15 + windPhase) * position.y * 0.028 * uWindAmp;'
                ].join('\n')
            );
        };
    } else if (/bark|wood/.test(n)) {
        tint = '#6f4a2a';
    } else if (/dirt|stone|rock|_defaultmat/.test(n) && (species === 'rockL' || species === 'rockS')) {
        tint = '#8f8678';                              // rocks: grey, not tan
    } else if (/grass|leafs/.test(n) && species === 'tuft') {
        tint = '#3f9a4a';                              // tufts pop slightly above rough
    } else if (/grass/.test(n)) {
        tint = '#4b8f44';                              // rock-top grass matches rough
    }
    if (tint) m.color.set(tint).convertSRGBToLinear();
    return m;
}

function finishAssets(loaded) {
    worldAssets = loaded;
    worldAssetsLoading = false;
    // Rebuild whatever scene is showing so real models replace primitives
    if (typeof scene3dReady !== 'undefined' && scene3dReady && typeof state !== 'undefined') {
        if ((state === 'overworld' || state === 'menu' || state === 'manage' || state === 'character') && typeof worldCourse !== 'undefined') {
            buildTerrain3D(worldCourse, { distantScenery: false });
        } else if ((state === 'playing' || state === 'holeDone') && typeof currentHole !== 'undefined' && currentHole) {
            buildTerrain3D(currentHole);
        }
    }
}

// Place one species list as instanced meshes. cells: [{c, r, hash}]; each
// cell picks a model from the list by hash. One InstancedMesh per model part.
function placeAssetInstances(hole, cells, speciesKey, opts) {
    if (!worldAssets || !cells.length) return false;
    const list = ASSET_SPECIES[speciesKey].filter(n => worldAssets[n]);
    if (!list.length) return false;
    const cellSize = CELL;
    // Tree species clump: 1-3 stems per cell with sub-cell jitter — forests
    // read as woods, not evenly-spaced orchards
    const clumpy = (speciesKey === 'pine' || speciesKey === 'leafy' || speciesKey === 'fall');
    const placements = [];
    for (const cell of cells) {
        const h = ((cell.c * 92837111) ^ (cell.r * 68998117)) >>> 0;
        const count = clumpy ? 2 + (h % 2) : 1;   // woods: 2-3 stems per cell
        for (let k = 0; k < count; k++) {
            const hx = ((h >> (3 * k)) % 19) / 19 - 0.5;
            const hz = ((h >> (3 * k + 5)) % 17) / 17 - 0.5;
            placements.push({
                c: cell.c, r: cell.r, k,
                ox: count > 1 ? hx * 0.95 : hx * 0.4,
                oz: count > 1 ? hz * 0.95 : hz * 0.4,
                szMul: count > 1 ? 0.85 + ((h >> (2 * k)) % 10) / 30 : 1
            });
        }
    }
    const buckets = {}; // modelName -> placements
    for (const p of placements) {
        const idx = Math.abs(p.c * 41 + p.r * 59 + (p.k || 0) * 23) % list.length;
        const name = list[idx];
        (buckets[name] = buckets[name] || []).push(p);
    }
    const dummy = new THREE.Object3D();
    for (const name in buckets) {
        const model = worldAssets[name];
        const group = buckets[name];
        for (const part of model.parts) {
            const inst = new THREE.InstancedMesh(part.geometry, part.material, group.length);
            for (let i = 0; i < group.length; i++) {
                const p = group[i];
                const { c, r } = p;
                const szVar = (0.82 + ((c * 11 + r * 23) % 12) / 32) * (p.szMul || 1);
                const s = model.scale * szVar * ((opts && opts.scaleMul) || 1);
                const cellH = (hole.heights && hole.heights[r]) ? (hole.heights[r][c] || 0) : 0;
                dummy.position.set((c + 0.5 + (p.ox || 0)) * cellSize, cellH,
                                   (r + 0.5 + (p.oz || 0)) * cellSize);
                dummy.scale.set(s, s, s);
                dummy.rotation.set(0, ((c * 13 + r * 7 + i) % 12) * (Math.PI / 6), 0);
                dummy.updateMatrix();
                inst.setMatrixAt(i, dummy.matrix);
            }
            inst.instanceMatrix.needsUpdate = true;
            inst.castShadow = true;
            terrainGroup.add(inst);
        }
    }
    // Contact blob shadow — grounds every prop (the poor man's AO, and on
    // mobile the better trade than SSAO)
    const blobSize = BLOB_SHADOW_SIZE[speciesKey];
    if (blobSize) {
        const bGeo = new THREE.PlaneGeometry(1, 1);
        bGeo.rotateX(-Math.PI / 2);
        const bMat = new THREE.MeshBasicMaterial({
            map: getBlobShadowTexture(),
            transparent: true,
            depthWrite: false,
            opacity: 0.34
        });
        const bInst = new THREE.InstancedMesh(bGeo, bMat, cells.length);
        for (let i = 0; i < cells.length; i++) {
            const { c, r } = cells[i];
            const szVar = 0.82 + ((c * 11 + r * 23) % 12) / 32;
            const s = blobSize * szVar;
            const cellH = (hole.heights && hole.heights[r]) ? (hole.heights[r][c] || 0) : 0;
            dummy.position.set((c + 0.5) * cellSize + 3, cellH + 0.35, (r + 0.5) * cellSize + 2);
            dummy.scale.set(s, 1, s);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            bInst.setMatrixAt(i, dummy.matrix);
        }
        bInst.instanceMatrix.needsUpdate = true;
        bInst.renderOrder = 1;
        terrainGroup.add(bInst);
    }
    return true;
}

// ============================================================
//  G4 ATMOSPHERE — animated water, wind sway, contact shadows
// ============================================================
// One shared clock drives water ripples and canopy sway
const windClock = { value: 0 };
// Biome wind gain: links islands blow harder (set per terrain build)
const windAmp = { value: 1 };

let waterMesh = null;
let waterMat = null;
let shoreTexture = null;

// Shore-distance map: white=land, black=open water, blurred so the water
// shader can draw an animated foam/glow band hugging every shoreline.
function buildShoreTexture(hole) {
    const c1 = document.createElement('canvas');
    c1.width = hole.cols; c1.height = hole.rows;
    const g1 = c1.getContext('2d');
    g1.fillStyle = '#000';
    g1.fillRect(0, 0, hole.cols, hole.rows);
    g1.fillStyle = '#fff';
    for (let r = 0; r < hole.rows; r++)
        for (let cc = 0; cc < hole.cols; cc++)
            if (hole.grid[r][cc] !== T.WATER) g1.fillRect(cc, r, 1, 1);
    const c2 = document.createElement('canvas');
    c2.width = hole.cols; c2.height = hole.rows;
    const g2 = c2.getContext('2d');
    g2.filter = 'blur(1.6px)';
    g2.drawImage(c1, 0, 0);
    if (shoreTexture) shoreTexture.dispose();
    shoreTexture = new THREE.CanvasTexture(c2);
    shoreTexture.flipY = false;
    shoreTexture.minFilter = THREE.LinearFilter;
    shoreTexture.magFilter = THREE.LinearFilter;
    return shoreTexture;
}

// Water surface: a single translucent plane at y=-1.4 across the whole
// course. Land sits at y>=0 and water cells sink to -4, so the plane is
// only visible inside ponds — no per-region bookkeeping needed.
function buildWaterSurface(hole) {
    if (!waterMat) {
        waterMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: {
                uTime: windClock,
                uDeep: { value: new THREE.Color('#177fb4') },
                uLite: { value: new THREE.Color('#45c8e8') },
                uShore: { value: null },
                uWorld: { value: new THREE.Vector2(1, 1) },
                uNight: { value: 1.0 }
            },
            vertexShader: [
                'varying vec2 vPos;',
                'void main() {',
                '    vec4 wp = modelMatrix * vec4(position, 1.0);',
                '    vPos = wp.xz;',
                '    gl_Position = projectionMatrix * viewMatrix * wp;',
                '}'
            ].join('\n'),
            fragmentShader: [
                'uniform float uTime;',
                'uniform vec3 uDeep;',
                'uniform vec3 uLite;',
                'uniform sampler2D uShore;',
                'uniform vec2 uWorld;',
                'uniform float uNight;',
                'varying vec2 vPos;',
                'void main() {',
                '    float w1 = sin(vPos.x * 0.085 + uTime * 1.1)',
                '             + sin(vPos.y * 0.062 + uTime * 0.85);',
                '    float w2 = sin((vPos.x + vPos.y) * 0.046 + uTime * 1.6);',
                '    float rip = (w1 + w2) * 0.22;',
                '    vec3 col = mix(uDeep, uLite, clamp(0.5 + rip * 0.6, 0.0, 1.0));',
                '    float sp = sin(vPos.x * 0.31 + uTime * 2.2)',
                '             * sin(vPos.y * 0.27 - uTime * 1.9);',
                '    col += smoothstep(0.965, 1.0, sp) * 0.35;',
                '    float shore = texture2D(uShore, vPos / uWorld).r;',
                '    float band = smoothstep(0.18, 0.62, shore);',
                '    float pulse = 0.75 + 0.25 * sin(uTime * 1.8 + shore * 14.0);',
                '    col = mix(col, vec3(0.55, 0.93, 0.98), band * 0.28 * pulse);',
                // Electric teal shoreline rim — the reference's signature
                // glowing pond outline (bright by day, luminous at night)
                '    float rim = smoothstep(0.30, 0.52, shore)',
                '              * (1.0 - smoothstep(0.52, 0.78, shore));',
                '    col += vec3(0.22, 0.95, 1.05) * rim * (0.85 + 0.55 * pulse);',
                '    col += band * 0.10;',
                '    gl_FragColor = vec4(col * mix(uNight, 1.0, rim * 0.8), 0.86);',
                '}'
            ].join('\n')
        });
    }
    waterMat.uniforms.uShore.value = buildShoreTexture(hole);
    waterMat.uniforms.uWorld.value.set(hole.cols * CELL, hole.rows * CELL);
    const geo = new THREE.PlaneGeometry(hole.cols * CELL, hole.rows * CELL);
    geo.rotateX(-Math.PI / 2);
    geo.translate(hole.cols * CELL / 2, -1.4, hole.rows * CELL / 2);
    waterMesh = new THREE.Mesh(geo, waterMat);
    waterMesh.renderOrder = 2;
    terrainGroup.add(waterMesh);
}

// Radial contact-shadow sprite shared by every prop
let blobShadowTexture = null;
function getBlobShadowTexture() {
    if (blobShadowTexture) return blobShadowTexture;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    blobShadowTexture = new THREE.CanvasTexture(c);
    return blobShadowTexture;
}
const BLOB_SHADOW_SIZE = {
    pine: 40, leafy: 50, fall: 50, palm: 44,
    bush: 20, rockL: 32, rockS: 15
};

// ============================================================
//  TERRAIN ALBEDO — crisp painted ground texture (G3)
// ============================================================
// All terrain HUE lives here, painted into an offscreen canvas at
// ALBEDO_PX per cell: chamfered region edges, boundary outlines, mow
// stripes, green fringe, sand speckle, water shore. Vertex colors are
// shading-only on top (slope soil, canopy shade, water depth).
const ALBEDO_PX = 18;
let albedoCanvas = null, albedoCtx = null, albedoTexture = null;
let albedoHoleRef = null;

// NOTE: authored dark on purpose — scene lighting roughly doubles these
// before ACES tone mapping (the tree tints were picked the same way).
const ALBEDO_COLORS = {
    base: {
        [T.GRASS]:   '#2c6a31',
        [T.FAIRWAY]: '#2f8742',   // stripe A; B derived darker
        [T.GREEN]:   '#39a04f',
        [T.ROUGH]:   '#295c2b',
        [T.SAND]:    '#c2a15c',
        [T.WATER]:   '#1a6fae',
        [T.TREE]:    '#20502a',   // forest floor under canopies
        [T.TEE]:     '#43aa58',
        [T.OOB]:     '#16381b',
        [T.PATH]:    '#8f7347'
    }
};

// Island biomes tint the wild terrain; play surfaces (fairway, green,
// sand, water, path) stay identical so course reading never changes.
// Veteran saves have no biome field and resolve to the meadows look.
const BIOME_ALBEDO = {
    autumn: {
        [T.GRASS]: '#5f682c',
        [T.ROUGH]: '#5d5a26',
        [T.TREE]:  '#4a4a20',
        [T.OOB]:   '#31391a',
        [T.TEE]:   '#5fa050'
    },
    links: {
        [T.GRASS]: '#5e7442',
        [T.ROUGH]: '#6b7549',
        [T.TREE]:  '#42582f',
        [T.OOB]:   '#3d472b',
        [T.TEE]:   '#57a45f'
    }
};
function biomeOf(hole) {
    return (hole && hole.biome) || 'meadows';
}

// Low-frequency smooth value noise for organic dirt blotches in the
// rough (reference maps are mottled brown/green, not uniform lawn)
function dirtNoise(c, r) {
    const lat = (x, y) => {
        let h = ((x * 374761393) ^ (y * 668265263)) >>> 0;
        h = (h ^ (h >>> 13)) >>> 0;
        return (h % 1000) / 1000;
    };
    const sm = (x, y, p) => {
        const gx = x / p, gy = y / p;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        return lat(x0, y0) * (1 - ux) * (1 - uy) + lat(x0 + 1, y0) * ux * (1 - uy)
             + lat(x0, y0 + 1) * (1 - ux) * uy + lat(x0 + 1, y0 + 1) * ux * uy;
    };
    return sm(c, r, 13) * 0.65 + sm(c + 57, r + 91, 6) * 0.35;
}

function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

function albedoCellColor(hole, c, r) {
    // Chamfers ask for corner-neighbor colors that can sit off-grid on
    // classic course maps (the overworld's OOB ring masked this)
    if (r < 0 || r >= hole.rows || c < 0 || c >= hole.cols) {
        return (BIOME_ALBEDO[biomeOf(hole)] || {})[T.OOB]
            || ALBEDO_COLORS.base[T.OOB];
    }
    const t = hole.grid[r][c];
    let col = (BIOME_ALBEDO[biomeOf(hole)] || {})[t]
        || ALBEDO_COLORS.base[t] || '#3e9e53';
    if (t === T.FAIRWAY) {
        // Crisp diagonal mow stripes — reads more dynamic than row bands
        if (Math.floor((c + r) / 3) % 2 === 1) col = shadeHex(col, -0.14);
    } else if (t === T.GREEN) {
        // Checkerboard mow in 2-cell blocks
        if ((Math.floor(c / 2) + Math.floor(r / 2)) % 2 === 1) col = shadeHex(col, -0.07);
    } else if (t === T.ROUGH || t === T.GRASS || t === T.TREE || t === T.OOB) {
        // Organic tone variation — scrambled hash + tiny amplitude so it
        // reads as texture, not a checkerboard
        const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
        const j = (h % 9) - 4;
        col = shadeHex(col, j * 0.006);
        if (t === T.OOB) {
            // Sandy cove stretches along the outer coastline break up the
            // dark boundary ring (hash-picked ~40% of 9-cell segments)
            const edge = Math.min(c, r, hole.cols - 1 - c, hole.rows - 1 - r);
            if (edge <= 3
                && ((Math.floor(c / 9) * 73 + Math.floor(r / 9) * 131) % 5) < 2) {
                col = shadeHex('#7d6b45', j * 0.008);
            }
        }
        if (t === T.ROUGH || t === T.GRASS || t === T.TREE) {
            // Organic dirt blotches sweep through the rough
            const dn = dirtNoise(c, r);
            if (dn > 0.54) {
                const k = Math.min(1, (dn - 0.54) / 0.16);
                col = mixHex(col, '#7c5636', 0.62 * k);
            }
        }
        if (t === T.ROUGH || t === T.GRASS) {
            // First cut: a lighter semi-rough band hugging mowed surfaces
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (!dr && !dc) continue;
                    const nt = cellType(hole, c + dc, r + dr);
                    if (nt === T.FAIRWAY || nt === T.GREEN || nt === T.TEE) {
                        col = shadeHex(col, 0.16);
                        dr = 2; // break both loops
                        break;
                    }
                }
            }
        }
    } else if (t === T.PATH) {
        const h = ((c * 83492791) ^ (r * 2654435761)) >>> 0;
        const j = (h % 5) - 2;
        col = shadeHex(col, j * 0.012);
    }
    return col;
}

function shadeHex(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    r = Math.round(Math.max(0, Math.min(255, r)));
    g = Math.round(Math.max(0, Math.min(255, g)));
    b = Math.round(Math.max(0, Math.min(255, b)));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

const cellType = (hole, c, r) => {
    if (c < 0 || c >= hole.cols || r < 0 || r >= hole.rows) return T.OOB;
    return hole.grid[r][c];
};

// Paint one cell (fill + chamfers + boundary strokes + detail) into ctx2d.
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

function buildTerrainAlbedo(hole) {
    const wpx = hole.cols * ALBEDO_PX, hpx = hole.rows * ALBEDO_PX;
    if (!albedoCanvas || albedoCanvas.width !== wpx || albedoCanvas.height !== hpx) {
        albedoCanvas = document.createElement('canvas');
        albedoCanvas.width = wpx;
        albedoCanvas.height = hpx;
        albedoCtx = albedoCanvas.getContext('2d');
        if (albedoTexture) albedoTexture.dispose();
        albedoTexture = new THREE.CanvasTexture(albedoCanvas);
        albedoTexture.encoding = THREE.sRGBEncoding;
        albedoTexture.anisotropy = 4;
    }
    for (let r = 0; r < hole.rows; r++)
        for (let c = 0; c < hole.cols; c++)
            paintAlbedoCell(hole, c, r);
    albedoTexture.needsUpdate = true;
    albedoHoleRef = hole;
    return albedoTexture;
}

// Dirty-rect repaint for live painting (cells ±2 covers chamfer/rim reach)
function repaintAlbedoCells(hole, cells) {
    if (!albedoCtx || albedoHoleRef !== hole || !cells.length) return;
    const seen = new Set();
    for (const cell of cells) {
        for (let r = cell.r - 2; r <= cell.r + 2; r++) {
            for (let c = cell.c - 2; c <= cell.c + 2; c++) {
                if (c < 0 || c >= hole.cols || r < 0 || r >= hole.rows) continue;
                const k = r * hole.cols + c;
                if (seen.has(k)) continue;
                seen.add(k);
                paintAlbedoCell(hole, c, r);
            }
        }
    }
    albedoTexture.needsUpdate = true;
}

// ---- Per-vertex terrain shading — shared by the full build and the live
// mid-stroke repaint so painting feedback is instant without a mesh rebuild.
const TERRAIN_VERT_PRIORITY = {
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
let _terrainRGBTable = null;
function terrainRGBTable() {
    if (_terrainRGBTable) return _terrainRGBTable;
    const m = {};
    for (const key in TERRAIN_COLORS) {
        const c = new THREE.Color(TERRAIN_COLORS[key]).convertSRGBToLinear();
        m[key] = [c.r, c.g, c.b];
    }
    // TREE cells get grass color underneath so land looks continuous
    m[T.TREE] = m[T.ROUGH].slice();
    return _terrainRGBTable = m;
}

function computeVertexColorHeight(hole, vc, vr) {
    // Shading-only since G3: hue lives in the albedo texture. Vertex color
    // multiplies it — 1.0 = untouched, darker for soil/canopy/depth.
    const neighbors = [
        { c: vc - 1, r: vr - 1 }, { c: vc, r: vr - 1 },
        { c: vc - 1, r: vr     }, { c: vc, r: vr     }
    ];
    let sumH = 0;
    let waterCount = 0;
    let nearTree = false;
    let anyRoughish = false;
    for (const n of neighbors) {
        const inBounds = n.c >= 0 && n.c < hole.cols && n.r >= 0 && n.r < hole.rows;
        const t = inBounds ? hole.grid[n.r][n.c] : T.ROUGH;
        const h = (inBounds && hole.heights) ? hole.heights[n.r][n.c] : 0;
        sumH += h;
        if (t === T.WATER) waterCount++;
        if (t === T.TREE) nearTree = true;
        if (t === T.ROUGH || t === T.GRASS || t === T.TREE) anyRoughish = true;
    }
    const avgH = sumH / 4;
    const isAllWater = (waterCount === 4);
    const y = isAllWater ? -4 : avgH;

    let shade = 1.0;
    // (Canopy shade removed: at cell resolution it stamped dark squares —
    // the instanced contact blobs ground the trees instead)
    // Deep water reads darker
    if (isAllWater) shade *= 0.72;
    // Steep-slope soil: darken + warm (carved-bank read)
    let soil = 0;
    if (hole.heights && anyRoughish) {
        let minH = Infinity, maxH = -Infinity;
        for (const n of neighbors) {
            const cc2 = Math.max(0, Math.min(hole.cols - 1, n.c));
            const rr2 = Math.max(0, Math.min(hole.rows - 1, n.r));
            const hh = hole.heights[rr2] ? (hole.heights[rr2][cc2] || 0) : 0;
            if (hh < minH) minH = hh;
            if (hh > maxH) maxH = hh;
        }
        const steep = maxH - minH;
        if (steep > 7) soil = Math.min(1, (steep - 7) / 16) * 0.6;
    }
    const rgb = [
        shade * (1 - soil * 0.55),
        shade * (1 - soil * 0.74),
        shade * (1 - soil * 0.85)
    ];
    return { y, rgb };
}

// Live repaint refs — the currently-built terrain mesh + its source course
let terrainColorAttrRef = null;
let terrainMatRef = null;
let terrainHoleRef = null;

// Recompute vertex colors around edited cells only. Heights/geometry are
// intentionally untouched — those settle at stroke end via buildTerrain3D.
function repaintTerrainCells(hole, cells) {
    if (!terrainColorAttrRef || terrainHoleRef !== hole || !cells.length) return;
    const vertCols = hole.cols + 1;
    const seen = new Set();
    for (const cell of cells) {
        for (let vr = cell.r - 2; vr <= cell.r + 3; vr++) {
            for (let vc = cell.c - 2; vc <= cell.c + 3; vc++) {
                if (vc < 0 || vc > hole.cols || vr < 0 || vr > hole.rows) continue;
                const i = vr * vertCols + vc;
                if (seen.has(i)) continue;
                seen.add(i);
                const { rgb } = computeVertexColorHeight(hole, vc, vr);
                terrainColorAttrRef.setXYZ(i, rgb[0], rgb[1], rgb[2]);
            }
        }
    }
    terrainColorAttrRef.needsUpdate = true;
}

// ---- Build terrain from hole grid (INSTANCED for performance) ----
// opts.distantScenery: false skips the fake perimeter trees/hills — used by
// the overworld, where the course IS the world and the backdrop shapes read
// as floating blobs from a free camera.
function buildTerrain3D(hole, opts) {
    // Clear existing terrain. Traverse the whole subtree: props are nested
    // Groups whose meshes the old shallow loop never disposed, which leaked
    // ~16 geometries per rebuild. Shared GLB geometries re-upload lazily on
    // next use, so disposing them here is safe.
    while (terrainGroup.children.length > 0) {
        const child = terrainGroup.children[0];
        child.traverse((node) => {
            if (node.geometry) node.geometry.dispose();
            if (node.material) {
                const mats = Array.isArray(node.material) ? node.material : [node.material];
                for (const m of mats) m.dispose();
            }
        });
        terrainGroup.remove(child);
    }
    // Canvas textures minted for this build (hole signs, green glows):
    // material.dispose() never frees textures, so track and free explicitly
    for (const tex of perBuildTextures) tex.dispose();
    perBuildTextures = [];
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

    // uv2 drives the tiling micro-noise aoMap (~1 tile per 2 cells)
    const uvAttr = terrainGeo.getAttribute('uv');
    const uv2 = new Float32Array(uvAttr.count * 2);
    for (let i = 0; i < uvAttr.count; i++) {
        uv2[i * 2] = uvAttr.getX(i) * hole.cols / 2;
        uv2[i * 2 + 1] = uvAttr.getY(i) * hole.rows / 2;
    }
    terrainGeo.setAttribute('uv2', new THREE.BufferAttribute(uv2, 2));

    const posAttr = terrainGeo.getAttribute('position');
    const colors = new Float32Array(posAttr.count * 3);
    const vertCols = hole.cols + 1;

    for (let i = 0; i < posAttr.count; i++) {
        const vr = Math.floor(i / vertCols);
        const vc = i - vr * vertCols;
        const { y, rgb } = computeVertexColorHeight(hole, vc, vr);
        posAttr.setY(i, y);
        colors[i * 3]     = rgb[0];
        colors[i * 3 + 1] = rgb[1];
        colors[i * 3 + 2] = rgb[2];
    }
    posAttr.needsUpdate = true;
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.computeVertexNormals();

    // Crisp painted albedo (G3) — vertex colors provide shading on top
    const terrainMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: buildTerrainAlbedo(hole),
        aoMap: makeGrassTexture(),      // tiling micro-noise via uv2
        aoMapIntensity: 0.55,
        roughness: 0.95,
        metalness: 0,
        flatShading: false
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainGroup.add(terrainMesh);
    terrainMatRef = terrainMat;
    // Register refs for the live mid-stroke color repaint
    terrainColorAttrRef = terrainGeo.getAttribute('color');
    terrainHoleRef = hole;

    // ---- Build-mode grid overlay: cell lines draped over the terrain,
    // shown only while a paint tool or the hole wizard is active ----
    {
        const gpos = [];
        const hAtV = (vc, vr) => computeVertexColorHeight(hole, vc, vr).y;
        for (let r = 0; r <= hole.rows; r++) {
            for (let c = 0; c < hole.cols; c++) {
                gpos.push(c * cellSize, hAtV(c, r) + 0.7, r * cellSize,
                          (c + 1) * cellSize, hAtV(c + 1, r) + 0.7, r * cellSize);
            }
        }
        for (let c = 0; c <= hole.cols; c++) {
            for (let r = 0; r < hole.rows; r++) {
                gpos.push(c * cellSize, hAtV(c, r) + 0.7, r * cellSize,
                          c * cellSize, hAtV(c, r + 1) + 0.7, (r + 1) * cellSize);
            }
        }
        const gridGeo = new THREE.BufferGeometry();
        gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
        const gridMat = new THREE.LineBasicMaterial({
            color: 0x08230f, transparent: true, opacity: 0.22
        });
        buildGridRef = new THREE.LineSegments(gridGeo, gridMat);
        buildGridRef.visible = false;
        terrainGroup.add(buildGridRef);
    }

    // ---- Rocky cliff skirt around the island edge ----
    // Perimeter strip from the terrain lip down past the waterline: soil
    // lip, jittered rock mid-band, dark base. Flat shading gives facets.
    {
        const rows = hole.rows, cols = hole.cols;
        const per = [];
        for (let vc = 0; vc <= cols; vc++) per.push({ vc: vc, vr: 0, nx: 0, nz: -1 });
        for (let vr = 1; vr <= rows; vr++) per.push({ vc: cols, vr: vr, nx: 1, nz: 0 });
        for (let vc = cols - 1; vc >= 0; vc--) per.push({ vc: vc, vr: rows, nx: 0, nz: 1 });
        for (let vr = rows - 1; vr >= 1; vr--) per.push({ vc: 0, vr: vr, nx: -1, nz: 0 });
        const N = per.length;
        const pos = new Float32Array(N * 9);
        const colArr = new Float32Array(N * 9);
        const soil = new THREE.Color('#6b5138').convertSRGBToLinear();
        const rock = new THREE.Color('#7d7264').convertSRGBToLinear();
        const rockD = new THREE.Color('#524a42').convertSRGBToLinear();
        for (let i = 0; i < N; i++) {
            const p = per[i];
            const x = p.vc * cellSize, z = p.vr * cellSize;
            const ty = computeVertexColorHeight(hole, p.vc, p.vr).y;
            const h = ((p.vc * 92821) ^ (p.vr * 68917)) >>> 0;
            // Flared talus profile — near-vertical walls subtend nothing
            // from the game's steep camera, so the rock band must lean out
            const j1 = 8 + (h % 10), j2 = 16 + ((h >> 3) % 14);
            const shade = 0.85 + ((h >> 5) % 30) / 100;
            pos.set([x, ty, z], i * 9);
            colArr.set([soil.r, soil.g, soil.b], i * 9);
            pos.set([x + p.nx * j1, Math.max(ty * 0.45, 2) - 6, z + p.nz * j1], i * 9 + 3);
            colArr.set([rock.r * shade, rock.g * shade, rock.b * shade], i * 9 + 3);
            pos.set([x + p.nx * j2, -22, z + p.nz * j2], i * 9 + 6);
            colArr.set([rockD.r * shade, rockD.g * shade, rockD.b * shade], i * 9 + 6);
        }
        const idx = [];
        for (let i = 0; i < N; i++) {
            const a = i * 3, b = ((i + 1) % N) * 3;
            idx.push(a, a + 1, b, b, a + 1, b + 1,
                     a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
        }
        const cliffGeo = new THREE.BufferGeometry();
        cliffGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        cliffGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
        cliffGeo.setIndex(idx);
        cliffGeo.computeVertexNormals();
        const cliffMat = new THREE.MeshStandardMaterial({
            vertexColors: true, flatShading: true, roughness: 1,
            metalness: 0, side: THREE.DoubleSide
        });
        terrainGroup.add(new THREE.Mesh(cliffGeo, cliffMat));
    }

    // Animated water surface (visible only inside sunken water cells)
    buildWaterSurface(hole);

    // Water is handled directly by vertex colors on the continuous mesh

    // ---- Trees as InstancedMeshes (trunks + canopies) ----
    const dummy = new THREE.Object3D();
    if (treeCells.length > 0 && worldAssets) {
        // Real Kenney models — split into species by placement + hash
        const pines = [], leafy = [], fall = [], bushCells = [], palmCells = [];
        const nearSandOrWaterA = (c, r) => {
            for (let dy = -3; dy <= 3; dy++)
                for (let dx = -3; dx <= 3; dx++) {
                    const nc = c + dx, nr = r + dy;
                    if (nc >= 0 && nc < hole.cols && nr >= 0 && nr < hole.rows) {
                        const t = hole.grid[nr][nc];
                        if (t === T.SAND || t === T.WATER) return true;
                    }
                }
            return false;
        };
        // Biome steering: autumn floods the canopy with fall colors;
        // links thins the forest to scattered wind-swept copses
        const biomeA = biomeOf(hole);
        const fallBar = biomeA === 'autumn' ? 4 : 2;
        for (const tc of treeCells) {
            if (biomeA === 'links' && (tc.c * 7 + tc.r * 11) % 3 !== 0) continue;
            const variant = (tc.c * 31 + tc.r * 17) % 4;
            if (nearSandOrWaterA(tc.c, tc.r) && (tc.c * 5 + tc.r * 3) % 10 < 7) palmCells.push(tc);
            else if (variant === 0) bushCells.push(tc);
            else if (variant === 1) ((biomeA === 'autumn'
                || ((tc.c * 19 + tc.r * 7) % 5) < 3) ? fall : leafy).push(tc);
            else if (variant === 2) (((tc.c * 11 + tc.r * 23) % 5) < fallBar ? fall : pines).push(tc);
            else (((tc.c * 29 + tc.r * 13) % 5) < fallBar ? fall : pines).push(tc);
        }
        placeAssetInstances(hole, pines, 'pine');
        placeAssetInstances(hole, leafy, 'leafy');
        placeAssetInstances(hole, fall, 'fall');
        placeAssetInstances(hole, bushCells, 'bush');
        placeAssetInstances(hole, palmCells, 'palm');
        // Ground cover: flower sprinkles + grass tufts fill the rough so
        // close zoom never reads as empty flat color
        const flowerCells = [], tuftCells = [];
        for (let r = 1; r < hole.rows - 1; r++) {
            for (let c = 1; c < hole.cols - 1; c++) {
                const t = hole.grid[r][c];
                if (t !== T.ROUGH && t !== T.GRASS) continue;
                const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
                const nearPath = hole.grid[r][c - 1] === T.PATH || hole.grid[r][c + 1] === T.PATH
                              || hole.grid[r - 1][c] === T.PATH || hole.grid[r + 1][c] === T.PATH;
                if (h % (nearPath ? 7 : 29) === 0) flowerCells.push({ c, r });
                else if (h % 6 === 0) tuftCells.push({ c, r });
            }
        }
        placeAssetInstances(hole, flowerCells, 'flower');
        placeAssetInstances(hole, tuftCells, 'tuft');
    } else if (treeCells.length > 0) {
        // Species + palette mix (reference look): conifers and oaks in
        // several green/autumn shades, palms near sand and water.
        const pines = [], bushes = [], palms = [];
        const oakGroups = {}; // paletteIdx -> cells
        const OAK_PALETTE = [0x267a3a, 0x1e6b35, 0xb0421f, 0xc96a1b, 0xd39a24];
        const biome2 = biomeOf(hole);
        // Weighted pick: meadows ~60/40 green/autumn; autumn nearly all fire
        const OAK_PICK = biome2 === 'autumn'
            ? [2, 3, 4, 2, 3, 4, 0, 3, 2, 4]
            : [0, 1, 0, 2, 1, 3, 0, 4, 1, 2];
        const cellsF = biome2 === 'links'
            ? treeCells.filter(tc => (tc.c * 7 + tc.r * 11) % 3 === 0)
            : treeCells;
        const nearSandOrWater = (c, r) => {
            for (let dy = -3; dy <= 3; dy++) {
                for (let dx = -3; dx <= 3; dx++) {
                    const nc = c + dx, nr = r + dy;
                    if (nc >= 0 && nc < hole.cols && nr >= 0 && nr < hole.rows) {
                        const t = hole.grid[nr][nc];
                        if (t === T.SAND || t === T.WATER) return true;
                    }
                }
            }
            return false;
        };
        for (const tc of cellsF) {
            const variant = (tc.c * 31 + tc.r * 17) % 4;
            if (nearSandOrWater(tc.c, tc.r) && (tc.c * 5 + tc.r * 3) % 10 < 7) {
                palms.push(tc);
            } else if (variant === 0) {
                bushes.push(tc);
            } else if (variant === 1 || (biome2 === 'autumn' && variant === 2)) {
                const pi = OAK_PICK[(tc.c * 19 + tc.r * 7) % OAK_PICK.length];
                (oakGroups[pi] = oakGroups[pi] || []).push(tc);
            } else {
                pines.push(tc);
            }
        }

        // ---- Pines: tall cone on thin cylinder, two green shades ----
        if (pines.length > 0) {
            const pTrunkGeo = new THREE.CylinderGeometry(1.8, 3, 30, 6);
            const pTrunkMat = new THREE.MeshStandardMaterial({ color: linC(0x4a3020) });
            const pTrunkInst = new THREE.InstancedMesh(pTrunkGeo, pTrunkMat, pines.length);
            const pConeGeo = new THREE.ConeGeometry(16, 44, 8);
            const pConeMat = new THREE.MeshStandardMaterial({ color: linC(0x1a5228) });
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
            pTrunkInst.castShadow = true;
            pConeInst.castShadow = true;
            terrainGroup.add(pTrunkInst);
            terrainGroup.add(pConeInst);
        }

        // ---- Oaks: sphere canopy on thick trunk, one draw per palette ----
        const oakTrunkCells = [];
        for (const k in oakGroups) oakTrunkCells.push(...oakGroups[k]);
        if (oakTrunkCells.length > 0) {
            const oTrunkGeo = new THREE.CylinderGeometry(3, 4.5, 20, 6);
            const oTrunkMat = new THREE.MeshStandardMaterial({ color: linC(0x5a4030) });
            const oTrunkInst = new THREE.InstancedMesh(oTrunkGeo, oTrunkMat, oakTrunkCells.length);
            for (let i = 0; i < oakTrunkCells.length; i++) {
                const { c, r } = oakTrunkCells[i];
                const sz = 0.9 + ((c * 13 + r * 29) % 10) / 20;
                const cellH = (hole.heights && hole.heights[r]) ? (hole.heights[r][c] || 0) : 0;
                dummy.position.set((c + 0.5) * cellSize, 10 * sz + cellH, (r + 0.5) * cellSize);
                dummy.scale.set(sz, sz, sz);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                oTrunkInst.setMatrixAt(i, dummy.matrix);
            }
            oTrunkInst.instanceMatrix.needsUpdate = true;
            oTrunkInst.castShadow = true;
            terrainGroup.add(oTrunkInst);
        }
        const oSphereGeo = new THREE.SphereGeometry(18, 8, 6);
        for (const k in oakGroups) {
            const cells = oakGroups[k];
            const mat = new THREE.MeshStandardMaterial({ color: linC(OAK_PALETTE[k]) });
            const inst = new THREE.InstancedMesh(oSphereGeo, mat, cells.length);
            for (let i = 0; i < cells.length; i++) {
                const { c, r } = cells[i];
                const sz = 0.9 + ((c * 13 + r * 29) % 10) / 20;
                const cellH = (hole.heights && hole.heights[r]) ? (hole.heights[r][c] || 0) : 0;
                dummy.position.set((c + 0.5) * cellSize, 30 * sz + cellH, (r + 0.5) * cellSize);
                dummy.scale.set(sz, sz, sz);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                inst.setMatrixAt(i, dummy.matrix);
            }
            inst.instanceMatrix.needsUpdate = true;
            inst.castShadow = true;
            terrainGroup.add(inst);
        }

        // ---- Bushes: squashed spheres, green or gold ----
        if (bushes.length > 0) {
            const bGeo = new THREE.SphereGeometry(10, 8, 6);
            const greens = [], golds = [];
            for (const b of bushes) (((b.c * 3 + b.r * 11) % 5 === 0) ? golds : greens).push(b);
            for (const [cells, colHex] of [[greens, 0x2e7340], [golds, 0xc4952c]]) {
                if (!cells.length) continue;
                const bMat = new THREE.MeshStandardMaterial({ color: linC(colHex) });
                const bInst = new THREE.InstancedMesh(bGeo, bMat, cells.length);
                for (let i = 0; i < cells.length; i++) {
                    const { c, r } = cells[i];
                    const sz = 0.7 + ((c * 17 + r * 41) % 10) / 25;
                    const cellH = (hole.heights && hole.heights[r]) ? (hole.heights[r][c] || 0) : 0;
                    dummy.position.set((c + 0.5) * cellSize, 6 * sz + cellH, (r + 0.5) * cellSize);
                    dummy.scale.set(sz, sz * 0.7, sz);
                    dummy.rotation.set(0, 0, 0);
                    dummy.updateMatrix();
                    bInst.setMatrixAt(i, dummy.matrix);
                }
                bInst.instanceMatrix.needsUpdate = true;
                bInst.castShadow = true;
                terrainGroup.add(bInst);
            }
        }

        // ---- Palms: leaning trunk + three crossed frond blades ----
        if (palms.length > 0) {
            const palmTrunkGeo = new THREE.CylinderGeometry(1.6, 2.6, 38, 6);
            const palmTrunkMat = new THREE.MeshStandardMaterial({ color: linC(0x8a6b45) });
            const trunkInst = new THREE.InstancedMesh(palmTrunkGeo, palmTrunkMat, palms.length);
            const frondGeo = new THREE.SphereGeometry(1, 6, 4);
            const frondMat = new THREE.MeshStandardMaterial({ color: linC(0x3d8f3d) });
            const frondInsts = [0, 1, 2].map(() => new THREE.InstancedMesh(frondGeo, frondMat, palms.length));
            for (let i = 0; i < palms.length; i++) {
                const { c, r } = palms[i];
                const sz = 0.85 + ((c * 7 + r * 31) % 10) / 22;
                const lean = (((c * 13 + r * 5) % 7) - 3) * 0.035;
                const cellH = (hole.heights && hole.heights[r]) ? (hole.heights[r][c] || 0) : 0;
                const px = (c + 0.5) * cellSize, pz = (r + 0.5) * cellSize;
                dummy.position.set(px, 19 * sz + cellH, pz);
                dummy.scale.set(sz, sz, sz);
                dummy.rotation.set(0, 0, lean);
                dummy.updateMatrix();
                trunkInst.setMatrixAt(i, dummy.matrix);
                // Crown: 3 flattened, elongated blades at 60° offsets
                const crownX = px - Math.sin(lean) * 38 * sz * 0.5;
                const crownY = 38 * sz + cellH;
                for (let f = 0; f < 3; f++) {
                    dummy.position.set(crownX, crownY, pz);
                    dummy.scale.set(26 * sz, 3.5 * sz, 8 * sz);
                    dummy.rotation.set(0, f * Math.PI / 3 + (c + r) * 0.7, 0.12);
                    dummy.updateMatrix();
                    frondInsts[f].setMatrixAt(i, dummy.matrix);
                }
            }
            trunkInst.instanceMatrix.needsUpdate = true;
            trunkInst.castShadow = true;
            terrainGroup.add(trunkInst);
            for (const fi of frondInsts) {
                fi.instanceMatrix.needsUpdate = true;
                fi.castShadow = true;
                terrainGroup.add(fi);
            }
        }
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
    }

        // ---- Entrance plaza dressing (props once assets are loaded) ----
    if (worldAssets && hole.border != null) {
        const ec = Math.floor(hole.cols / 2);
        const er = hole.rows - hole.border;
        const hAt = (c, r) => (hole.heights && hole.heights[Math.round(r)])
            ? (hole.heights[Math.round(r)][Math.round(c)] || 0) : 0;
        const put = (name, c, r, yaw, scaleMul) => {
            const model = worldAssets[name];
            if (!model) return;
            const grp = new THREE.Group();
            for (const part of model.parts) {
                const mesh = new THREE.Mesh(part.geometry, part.material);
                mesh.castShadow = true;
                grp.add(mesh);
            }
            const s = model.scale * (scaleMul || 1);
            grp.scale.set(s, s, s);
            grp.position.set(c * CELL, hAt(c, r), r * CELL);
            grp.rotation.y = yaw || 0;
            terrainGroup.add(grp);
        };
        // Player-placeable decor, data-driven from worldCourse.decor.
        // Legacy auto-layouts are seeded into decor on load (game.js).
        const DECOR_MODELS = {
            bench: 'bench', flowers: 'flowers', kiosk: 'kiosk',
            stall: 'stall-drinks', cart: 'golfcart', arch: 'archsign',
            windmill: 'windmill', lighthouse: 'lighthouse',
            clubhouse: 'clubhouse', gazebo: 'gazebo', statue: 'statue',
            grandstand: 'grandstand'
        };
        beaconGroups = [];
        beaconMats = [];
        windowGlowMatRef = null;
        if (hole.decor) {
            for (const d of hole.decor) {
                const name = DECOR_MODELS[d.t];
                if (!name) continue;
                // The clubhouse grows with its amenity tier so upgrades
                // read on the island itself, not just the Manage screen
                let scaleMul = 1;
                if (d.t === 'clubhouse' && typeof resort !== 'undefined' && resort) {
                    scaleMul = resort.amenities && resort.amenities.clubhouse3 ? 1.34
                        : resort.amenities && resort.amenities.clubhouse2 ? 1.17 : 1;
                }
                put(name, d.x, d.y, d.rot || 0, scaleMul);
                if (d.t === 'lighthouse') addLighthouseBeacon(d.x * CELL, hAt(d.x, d.y) + 195, d.y * CELL);
                // Buildings glow from the inside after dark
                const tierUp = d.t === 'clubhouse'
                    && typeof resort !== 'undefined' && resort
                    && resort.amenities && resort.amenities.clubhouse2;
                const WINDOW_GLOWS = { clubhouse: [46, 64], kiosk: [24, 34],
                    stall: [22, 32], windmill: [40, 40], gazebo: [26, 36] };
                const wg = WINDOW_GLOWS[d.t];
                if (wg) {
                    addWindowGlow(d.x * CELL, hAt(d.x, d.y) + wg[0] * scaleMul,
                        d.y * CELL, wg[1] * scaleMul);
                    // Upgraded clubhouses glow from a second storey too
                    if (tierUp) {
                        addWindowGlow(d.x * CELL,
                            hAt(d.x, d.y) + wg[0] * scaleMul + 26,
                            d.y * CELL, wg[1] * 0.7);
                    }
                }
            }
        }
        // Wooden bridges wherever the walkway crosses water
        for (let r = 1; r < hole.rows - 1; r++) {
            for (let c = 1; c < hole.cols - 1; c++) {
                if (hole.grid[r][c] !== T.PATH) continue;
                const nWater = hole.grid[r - 1][c] === T.WATER && hole.grid[r + 1][c] === T.WATER;
                const eWater = hole.grid[r][c - 1] === T.WATER && hole.grid[r][c + 1] === T.WATER;
                if (nWater) put('bridge_woodRound', c + 0.5, r + 0.5, Math.PI / 2, 1.4);
                else if (eWater) put('bridge_woodRound', c + 0.5, r + 0.5, 0, 1.4);
            }
        }
        // Site furniture that stays automatic: trash bin + fence runs at
        // the entrance mouth (tied to entrance geometry, not decor)
        put('trash', ec - 2.1, er - 6.2, 0);
        for (let i = 0; i < 4; i++) {
            put('station-fence', ec - 2.6, er - 4.5 - i * 1.6, Math.PI / 2, 1.2);
            put('station-fence', ec + 3.1, er - 4.9 - i * 1.6, Math.PI / 2, 1.2);
        }
    }

        // ---- Teal shot-arc trails over each hole (signature reference look) ----
    arcCurves = [];
    pinRings = [];
    teeSignMats = [];
    greenGlowMats = [];
    if (hole.holes && hole.holes.length) {
        const arcMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color('#3adbe8'),
            transparent: true,
            opacity: 0.55,
            depthWrite: false
        });
        arcMat.toneMapped = false;
        const hAt2 = (p) => (hole.heights && hole.heights[p.y])
            ? (hole.heights[p.y][p.x] || 0) : 0;
        for (const rec of hole.holes) {
            if (rec.open === false) continue; // closed holes go quiet
            const pts = [rec.tee, ...(rec.waypoints || []), rec.pin];
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i], b = pts[i + 1];
                const ax = (a.x + 0.5) * CELL, az = (a.y + 0.5) * CELL;
                const bx = (b.x + 0.5) * CELL, bz = (b.y + 0.5) * CELL;
                const segLen = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2);
                const apex = Math.min(220, 40 + segLen * 0.28);
                const curve = new THREE.QuadraticBezierCurve3(
                    new THREE.Vector3(ax, hAt2(a) + 6, az),
                    new THREE.Vector3((ax + bx) / 2, Math.max(hAt2(a), hAt2(b)) + apex, (az + bz) / 2),
                    new THREE.Vector3(bx, hAt2(b) + 6, bz)
                );
                const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 1.7, 6, false), arcMat);
                tube.renderOrder = 3;
                terrainGroup.add(tube);
                arcCurves.push(curve);
            }
        }
        setupArcBalls();
        // Pulsing beacon ring around every pin (open holes only)
        for (const rec of hole.holes) {
            if (rec.open === false) continue;
            const ringGeo = new THREE.RingGeometry(5.5, 8.5, 20);
            ringGeo.rotateX(-Math.PI / 2);
            const ringMat = new THREE.MeshBasicMaterial({
                color: 0x3adbe8, transparent: true, opacity: 0.7,
                depthWrite: false, side: THREE.DoubleSide
            });
            ringMat.toneMapped = false;
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.set((rec.pin.x + 0.5) * CELL, hAt2(rec.pin) + 0.9,
                              (rec.pin.y + 0.5) * CELL);
            ring.renderOrder = 3;
            terrainGroup.add(ring);
            pinRings.push(ring);
        }
        // Neon hole-number signs at every tee (reference night look):
        // dark rounded panel on a post, teal number, unlit so it pops
        // after dark when everything else dims
        for (const rec of hole.holes) {
            const cnv = document.createElement('canvas');
            cnv.width = 64; cnv.height = 64;
            const g = cnv.getContext('2d');
            g.fillStyle = 'rgba(8,20,26,0.92)';
            g.beginPath();
            if (g.roundRect) g.roundRect(4, 4, 56, 56, 14); else g.rect(4, 4, 56, 56);
            g.fill();
            g.strokeStyle = '#3adbe8';
            g.lineWidth = 3;
            g.beginPath();
            if (g.roundRect) g.roundRect(4, 4, 56, 56, 14); else g.rect(4, 4, 56, 56);
            g.stroke();
            g.fillStyle = '#5ff0ff';
            g.font = 'bold 40px sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(String(rec.id), 32, 35);
            const tex = new THREE.CanvasTexture(cnv);
            perBuildTextures.push(tex);
            const mat = new THREE.MeshBasicMaterial({
                map: tex, transparent: true, opacity: 0.85,
                side: THREE.DoubleSide, depthWrite: false
            });
            mat.toneMapped = false;
            const next = (rec.waypoints && rec.waypoints[0]) || rec.pin;
            const yawS = Math.atan2(next.x - rec.tee.x, next.y - rec.tee.y);
            const sx2 = (rec.tee.x + 1.8) * CELL, sz2 = (rec.tee.y + 1.4) * CELL;
            const sy2 = hAt2(rec.tee);
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.9, 1.1, 16, 6),
                new THREE.MeshStandardMaterial({ color: linC(0x4a4038), roughness: 0.9 }));
            post.position.set(sx2, sy2 + 8, sz2);
            terrainGroup.add(post);
            const panel = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), mat);
            panel.position.set(sx2, sy2 + 20, sz2);
            panel.rotation.y = yawS + Math.PI;
            panel.renderOrder = 3;
            terrainGroup.add(panel);
            teeSignMats.push(mat);
        }
        // Soft luminous wash over each green after dark — additive radial
        // sprite sized to the green's cell cluster, invisible by day
        for (const rec of hole.holes) {
            const cells = [];
            for (let dr = -10; dr <= 10; dr++) {
                for (let dc = -10; dc <= 10; dc++) {
                    const c = rec.pin.x + dc, r = rec.pin.y + dr;
                    if (hole.grid[r] && hole.grid[r][c] === T.GREEN) cells.push({ c, r });
                }
            }
            if (!cells.length) continue;
            let mnC = 1e9, mxC = -1e9, mnR = 1e9, mxR = -1e9;
            for (const cl of cells) {
                mnC = Math.min(mnC, cl.c); mxC = Math.max(mxC, cl.c);
                mnR = Math.min(mnR, cl.r); mxR = Math.max(mxR, cl.r);
            }
            const gcx = (mnC + mxC) / 2 + 0.5, gcr = (mnR + mxR) / 2 + 0.5;
            const rad = (Math.max(mxC - mnC, mxR - mnR) / 2 + 2) * CELL;
            const gcnv = document.createElement('canvas');
            gcnv.width = 128; gcnv.height = 128;
            const gg = gcnv.getContext('2d');
            const grad = gg.createRadialGradient(64, 64, 8, 64, 64, 62);
            grad.addColorStop(0, 'rgba(120,255,170,0.55)');
            grad.addColorStop(0.7, 'rgba(80,230,150,0.22)');
            grad.addColorStop(1, 'rgba(60,210,140,0)');
            gg.fillStyle = grad;
            gg.fillRect(0, 0, 128, 128);
            const gtex = new THREE.CanvasTexture(gcnv);
            perBuildTextures.push(gtex);
            const gmat = new THREE.MeshBasicMaterial({
                map: gtex, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            gmat.toneMapped = false;
            const glow = new THREE.Mesh(new THREE.PlaneGeometry(rad * 2.2, rad * 2.2), gmat);
            glow.rotation.x = -Math.PI / 2;
            glow.position.set(gcx * CELL, hAt2(rec.pin) + 1.4, gcr * CELL);
            glow.renderOrder = 2;
            terrainGroup.add(glow);
            greenGlowMats.push(gmat);
        }
        // Tee marker balls flanking each tee, set perpendicular to the
        // opening leg so they frame the drive line
        const teeMarkGeo = new THREE.SphereGeometry(1.8, 8, 6);
        const teeMarkMat = new THREE.MeshStandardMaterial({ color: linC(0xe53935), roughness: 0.5 });
        const teeMarks = new THREE.InstancedMesh(teeMarkGeo, teeMarkMat, hole.holes.length * 2);
        const tmDummy = new THREE.Object3D();
        let tmIdx = 0;
        for (const rec of hole.holes) {
            const next = (rec.waypoints && rec.waypoints[0]) || rec.pin;
            const ddx = next.x - rec.tee.x, ddy = next.y - rec.tee.y;
            const dl = Math.hypot(ddx, ddy) || 1;
            const perpX = -ddy / dl, perpZ = ddx / dl;
            const cx = (rec.tee.x + 0.5) * CELL, cz = (rec.tee.y + 0.5) * CELL;
            const ty = hAt2(rec.tee);
            for (let side = -1; side <= 1; side += 2) {
                tmDummy.position.set(cx + perpX * side * CELL * 0.42, ty + 1.6,
                                     cz + perpZ * side * CELL * 0.42);
                tmDummy.rotation.set(0, 0, 0);
                tmDummy.scale.set(1, 1, 1);
                tmDummy.updateMatrix();
                teeMarks.setMatrixAt(tmIdx++, tmDummy.matrix);
            }
        }
        teeMarks.castShadow = true;
        terrainGroup.add(teeMarks);
        // Yardage plates on the route: white = 100y out, red = 150y out
        // (YDS_TO_WORLD = 16 world units per yard, matching game.js)
        const plateGeo = new THREE.CylinderGeometry(3.2, 3.2, 1.2, 10);
        for (const rec of hole.holes) {
            const rpts = [rec.tee, ...(rec.waypoints || []), rec.pin]
                .map(p => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL }));
            for (const spec of [[100, 0xf5f5f5], [150, 0xd63b2f]]) {
                let remain = spec[0] * 16;
                for (let i = rpts.length - 1; i > 0 && remain > 0; i--) {
                    const a = rpts[i], b = rpts[i - 1];
                    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
                    if (segLen >= remain) {
                        const k = remain / segLen;
                        const mx = a.x + (b.x - a.x) * k;
                        const mz = a.z + (b.z - a.z) * k;
                        const cy = Math.floor(mz / CELL), cx2 = Math.floor(mx / CELL);
                        const gy = (hole.heights && hole.heights[cy])
                            ? (hole.heights[cy][cx2] || 0) : 0;
                        const plate = new THREE.Mesh(plateGeo,
                            new THREE.MeshStandardMaterial({ color: linC(spec[1]), roughness: 0.5 }));
                        plate.position.set(mx, gy + 0.6, mz);
                        terrainGroup.add(plate);
                        remain = 0;
                    } else {
                        remain -= segLen;
                    }
                }
            }
        }
    }

    // ---- Floating 3D hole numbers over each tee (reference-style) ----
    if (hole.holes && hole.holes.length) {
        const HOLE_COLORS3D = ['#42a5f5', '#ec407a', '#ffca28', '#66bb6a',
            '#ab47bc', '#26c6da', '#ff7043', '#9ccc65', '#5c6bc0'];
        for (const rec of hole.holes) {
            const cnv = document.createElement('canvas');
            cnv.width = cnv.height = 128;
            const g = cnv.getContext('2d');
            const col = rec.open === false ? '#8a8f94'
                : HOLE_COLORS3D[(rec.id - 1) % HOLE_COLORS3D.length];
            g.shadowColor = col;
            g.shadowBlur = 18;
            g.fillStyle = col;
            g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.fill();
            g.shadowBlur = 0;
            g.strokeStyle = 'rgba(255,255,255,0.95)';
            g.lineWidth = 6;
            g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.stroke();
            g.fillStyle = '#fff';
            g.font = 'bold 56px -apple-system,Arial,sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(String(rec.id), 64, 68);
            const tex = new THREE.CanvasTexture(cnv);
            perBuildTextures.push(tex);
            const sprMat = new THREE.SpriteMaterial({
                map: tex, transparent: true, depthTest: true
            });
            sprMat.toneMapped = false; // full-saturation badge, no ACES wash
            const spr = new THREE.Sprite(sprMat);
            const th = (hole.heights && hole.heights[rec.tee.y])
                ? (hole.heights[rec.tee.y][rec.tee.x] || 0) : 0;
            spr.position.set((rec.tee.x + 0.5) * CELL, th + 58, (rec.tee.y + 0.5) * CELL);
            spr.scale.set(42, 42, 1);
            terrainGroup.add(spr);
        }
    }

        // ---- Ambient visitors: little walkers on the paths bring life ----
    setupAmbientNPCs(hole);

    // ---- Boulders: sparse grey rocks on rough (reference-style scenery) ----
    {
        const rockCells = [];
        for (let r = 0; r < hole.rows; r++) {
            for (let c = 0; c < hole.cols; c++) {
                const dens0 = (hole.rockDensity != null ? hole.rockDensity : 0.5)
                    * (biomeOf(hole) === 'links' ? 1.8 : 1);
                const rockMod = Math.max(28, Math.round(149 / (0.35 + dens0 * 1.6)));
                if (hole.grid[r][c] === T.ROUGH && (c * 53 + r * 97) % rockMod === 0) {
                    rockCells.push({ c, r });
                }
            }
        }
        if (rockCells.length > 0 && worldAssets) {
            const large = [], small = [];
            for (const rc of rockCells) (((rc.c * 3 + rc.r) % 3 === 0) ? large : small).push(rc);
            placeAssetInstances(hole, large, 'rockL');
            placeAssetInstances(hole, small, 'rockS');
        } else if (rockCells.length > 0) {
            const rockGeo = new THREE.DodecahedronGeometry(9, 0);
            const rockMat = new THREE.MeshStandardMaterial({ color: linC(0x6f6a63), roughness: 1 });
            const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockCells.length);
            for (let i = 0; i < rockCells.length; i++) {
                const { c, r } = rockCells[i];
                const sz = 0.7 + ((c * 29 + r * 13) % 10) / 8;
                const cellH = (hole.heights && hole.heights[r]) ? (hole.heights[r][c] || 0) : 0;
                dummy.position.set((c + 0.5) * cellSize, 3.5 * sz + cellH, (r + 0.5) * cellSize);
                dummy.scale.set(sz, sz * 0.75, sz);
                dummy.rotation.set(0, (c * 7 + r) % 7, 0);
                dummy.updateMatrix();
                rockInst.setMatrixAt(i, dummy.matrix);
            }
            rockInst.instanceMatrix.needsUpdate = true;
            rockInst.castShadow = true;
            terrainGroup.add(rockInst);
        }
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
    }

    // ---- Distant scenery — rings of background trees beyond the course ----
    const wantScenery = !(opts && opts.distantScenery === false);
    const holeCenterX = (hole.cols * cellSize) / 2;
    const holeCenterZ = (hole.rows * cellSize) / 2;
    const courseRadius = Math.max(hole.cols, hole.rows) * cellSize * 0.7;
    const distantTrees = [];
    if (wantScenery) {
    // Two rings of fake trees around the perimeter
    for (let ring = 0; ring < 2; ring++) {
        // Far enough out that the ring never overlaps the island silhouette
        // from low playtest cameras (half-diagonal is ~0.86 * courseRadius)
        const radius = courseRadius + 700 + ring * 500;
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
    } // end wantScenery tree collection
    if (distantTrees.length > 0) {
        const dtGeo = new THREE.ConeGeometry(25, 70, 7);
        const dtMat = new THREE.MeshStandardMaterial({ color: linC(0x1a4828) });
        const dtInst = new THREE.InstancedMesh(dtGeo, dtMat, distantTrees.length);
        for (let i = 0; i < distantTrees.length; i++) {
            const t = distantTrees[i];
            const sz = 1.2 + (i % 5) * 0.3;
            // Base sunk below the waterline so trees rise out of the sea
            // haze instead of hovering on an invisible shelf
            dummy.position.set(t.x, 35 * sz - 14, t.z);
            dummy.scale.set(sz, sz, sz);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            dtInst.setMatrixAt(i, dummy.matrix);
        }
        dtInst.instanceMatrix.needsUpdate = true;
        distantGroupRef = new THREE.Group();
        distantGroupRef.add(dtInst);
        terrainGroup.add(distantGroupRef);
        dummy.scale.set(1, 1, 1);
    }

    // ---- Distant rolling hills — a few large background shapes ----
    const distantHills = [];
    if (wantScenery) for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const r = courseRadius + 1200;
        const x = holeCenterX + Math.cos(angle) * r;
        const z = holeCenterZ + Math.sin(angle) * r;
        distantHills.push({ x, z });
    }
    if (distantHills.length > 0) {
        const hillGeo = new THREE.SphereGeometry(500, 10, 6);
        const hillMat = new THREE.MeshStandardMaterial({ color: linC(0x2e5e32) });
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
        if (distantGroupRef) distantGroupRef.add(hillInst);
        else terrainGroup.add(hillInst);
        dummy.scale.set(1, 1, 1);
    }

    // Flag pole + flag — sits on terrain elevation. Skipped when rendering
    // an overworld course that has no active hole.
    if (hole.hole) {
        const flagX = (hole.hole.x + 0.5) * cellSize;
        const flagZ = (hole.hole.y + 0.5) * cellSize;
        const flagH = (hole.heights && hole.heights[hole.hole.y]) ? (hole.heights[hole.hole.y][hole.hole.x] || 0) : 0;

        const poleGeo = new THREE.CylinderGeometry(0.3, 0.3, 28, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: linC(0xaaaaaa) });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(flagX, 14 + flagH, flagZ);
        pole.castShadow = true;
        flagGroup.add(pole);

        const flagGeo = new THREE.PlaneGeometry(8, 5);
        flagGeo.translate(4, 0, 0); // pivot at the pole edge so it can wave
        const flagMat = new THREE.MeshStandardMaterial({ color: linC(0xee2222), side: THREE.DoubleSide });
        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(flagX, 25 + flagH, flagZ);
        flag.userData.pinFlag = true;
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
    if (color) ballMesh.material.color.set(color).convertSRGBToLinear();
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
    camera3d.lookAt(cam3dLookAt.x, cam3dLookAt.y, cam3dLookAt.z);
}

// ---- Raycast screen point to ground plane (y=0) ----
const raycaster3d = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
// Scratch objects reused by the per-frame/per-event math below — these
// paths run for every golfer, pin, popup, and touch-move, so allocating
// fresh vectors in them was steady GC churn
const _tmpVecA = new THREE.Vector3();
const _tmpVecB = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _tmpVec2 = new THREE.Vector2();

function screenToWorld3D(sx, sy) {
    if (!camera3d) return { x: 0, y: 0 };
    _tmpVec2.set(
        (sx / window.innerWidth) * 2 - 1,
        -(sy / window.innerHeight) * 2 + 1
    );
    raycaster3d.setFromCamera(_tmpVec2, camera3d);
    const hit = raycaster3d.ray.intersectPlane(groundPlane, _tmpVecA);
    if (hit) return { x: hit.x, y: hit.z }; // return as 2D world coords (x, z → x, y)
    return { x: 0, y: 0 };
}

// ---- Pan camera by screen delta ----
function panCamera3D(dx, dy) {
    // Orbit camera route (overworld) — move the pivot, preserve view angle
    if (cam3dOrbitMode) { panCameraOrbit(dx, dy); return; }

    // Convert screen delta to world delta based on camera orientation
    const right = _tmpVecA;
    const forward = _tmpVecB;
    camera3d.getWorldDirection(forward);
    right.crossVectors(forward, _upVec).normalize();
    forward.crossVectors(_upVec, right).normalize();

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
    const vec = _tmpVecA.set(wx, 0, wy);
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
    // Shared atmosphere clock: water ripples + canopy sway
    windClock.value = performance.now() / 1000;
    // Pin flag flutter: swings around the pole and ripples its cloth.
    // Looked up by tag each frame — terrain rebuilds replace the mesh.
    if (typeof flagGroup !== 'undefined' && flagGroup) {
        const t = windClock.value;
        for (const ch of flagGroup.children) {
            if (ch.userData && ch.userData.pinFlag) {
                ch.rotation.y = Math.sin(t * 1.1) * 0.35
                    + Math.sin(t * 3.3) * 0.12;
                ch.scale.x = 0.92 + Math.sin(t * 5.1) * 0.08;
            }
        }
    }
    renderer3d.render(scene3d, camera3d);
}

// ---- Show/hide 3D canvas ----
function show3D() {
    if (threeCanvas) threeCanvas.style.display = 'block';
}

function hide3D() {
    if (threeCanvas) threeCanvas.style.display = 'none';
}

// ============================================================
//  AMBIENT NPC WALKERS — capsule visitors wandering the paths
// ============================================================
// Shared scratch object for every per-frame instance-matrix update —
// allocating Object3Ds each frame churns GC on mobile. Every user must
// set position/rotation/scale before updateMatrix (no field survives).
const sharedDummy3D = new THREE.Object3D();
let npcBodyInst = null, npcHeadInst = null, npcClubInst = null, npcUmbrellaInst = null;
let npcBagInst = null; // golf bags standing beside waiting players
let npcHatInst = null;
let npcStates = [];
let npcPathCells = [];
let npcPathIdx = null; // "c,r" -> npcPathCells index, built lazily
let npcHoleRoutes = {}; // holeId -> route data, for hole rotation

// Water-aware walking step: golfers on cross-course strolls skirt
// pond edges instead of striding over open water. Tries the direct
// step, then two side-deflections; worst case (surrounded) steps
// through so nobody deadlocks.
function walkStepAvoid(hole, s, gx, gz, dt) {
    const dx = gx - s.x, dz = gz - s.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    const st = Math.min(d, s.speed * dt);
    const passable = (x, z) => {
        const row = hole.grid[Math.floor(z / CELL)];
        const t2 = row && row[Math.floor(x / CELL)];
        return t2 !== undefined && t2 !== T.WATER;
    };
    const nx = s.x + (dx / d) * st, nz = s.z + (dz / d) * st;
    if (passable(nx, nz)) { s.x = nx; s.z = nz; return; }
    // Slide along the shoreline: perpendicular deflections
    const px2 = -dz / d, pz2 = dx / d;
    for (const side of [1, -1]) {
        const ax = s.x + ((dx / d) * 0.35 + px2 * side * 0.93) * st;
        const az = s.z + ((dz / d) * 0.35 + pz2 * side * 0.93) * st;
        if (passable(ax, az)) { s.x = ax; s.z = az; return; }
    }
    s.x = nx; s.z = nz; // boxed in — wade rather than freeze
}

// Shortest walkway route between two world points (BFS over path cells,
// 4-connected). Returns world-space waypoints, or null when either end
// is far from the network or no connected route exists — callers then
// beeline like before. One small array per call; calls happen only when
// a golfer starts a detour, never per frame.
function pathRoute(fromX, fromZ, toX, toZ) {
    const cells = npcPathCells;
    if (!cells || cells.length < 2) return null;
    if (!npcPathIdx) {
        npcPathIdx = new Map();
        for (let i = 0; i < cells.length; i++) {
            npcPathIdx.set(cells[i].c + ',' + cells[i].r, i);
        }
    }
    const near = (x, z) => {
        let bi = -1, bd = Infinity;
        for (let i = 0; i < cells.length; i++) {
            const dx = (cells[i].c + 0.5) * CELL - x;
            const dz = (cells[i].r + 0.5) * CELL - z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bd) { bd = d2; bi = i; }
        }
        return { i: bi, d: bd };
    };
    const a = near(fromX, fromZ), b = near(toX, toZ);
    const reach = (CELL * 14) * (CELL * 14);
    if (a.i < 0 || b.i < 0 || a.i === b.i || a.d > reach || b.d > reach) return null;
    const prev = new Int32Array(cells.length).fill(-1);
    const seen = new Uint8Array(cells.length);
    const queue = [a.i];
    seen[a.i] = 1;
    let qh = 0, found = false;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (qh < queue.length) {
        const cur = queue[qh++];
        if (cur === b.i) { found = true; break; }
        const cc = cells[cur];
        for (let k = 0; k < 4; k++) {
            const ni = npcPathIdx.get((cc.c + DIRS[k][0]) + ','
                + (cc.r + DIRS[k][1]));
            if (ni != null && !seen[ni]) {
                seen[ni] = 1;
                prev[ni] = cur;
                queue.push(ni);
            }
        }
    }
    if (!found) return null;
    const out = [];
    for (let cur = b.i; cur !== -1; cur = prev[cur]) {
        out.push({ x: (cells[cur].c + 0.5) * CELL,
                   z: (cells[cur].r + 0.5) * CELL });
    }
    out.reverse();
    // Every 2nd cell keeps turns smooth and the array half as long
    const thin = out.filter((p, k) => k % 2 === 0 || k === out.length - 1);
    return thin.length >= 2 ? thin : null;
}
let npcSocialSpots = [];
let npcVendorSpots = [];  // kiosks/stalls that sell food & drink
let npcStandSpots = [];   // grandstands: tournament galleries fill them
let npcModelInsts = null;   // instanced GLB golfer parts (capsules hidden)
let golferModelScale = 1;
let npcWalkerCount = 0;
const NPC_COUNT = 10;
const NPC_COLORS = [0xe5533d, 0x3d7de5, 0xe5b13d, 0x8e44ad,
                    0x2ecc71, 0xe67e22, 0x16a085, 0xd35400];

function setupAmbientNPCs(hole) {
    npcPathCells = [];
    npcPathIdx = null;
    for (let r = 0; r < hole.rows; r++)
        for (let c = 0; c < hole.cols; c++)
            if (hole.grid[r][c] === T.PATH) npcPathCells.push({ c, r });
    npcStates = [];
    npcBodyInst = null;
    npcHeadInst = null;
    npcClubInst = null;
    npcBagInst = null;
    setupHoverBots(hole);
    setupFountains(hole);
    setupCartDrive(hole);
    setupShuttle(hole);
    setupCritters(hole);
    setupPathLamps(hole);
    setupFireflies(hole);
    setupBuoys(hole);
    setupBoat(hole);
    setupLeaves(hole);
    setupHazardStakes(hole);

    // Walkers on paths + golfers stationed at every hole's tee and green
    const golfers = [];
    if (hole.holes) {
        // arcIdx ties the primary tee golfer's swing to the launch cycle
        // of that hole's first shot arc (same iteration order as the arc
        // builder, so segment indices line up)
        let segBase = 0;
        for (const rec of hole.holes) {
            if (rec.open === false) continue; // matches the arc builder's skip
            golfers.push({ c: rec.tee.x + 0.9, r: rec.tee.y + 0.4, arcIdx: segBase });
            golfers.push({ c: rec.tee.x - 0.5, r: rec.tee.y + 1.1, arcIdx: null });
            golfers.push({ c: rec.pin.x - 0.8, r: rec.pin.y + 0.7, arcIdx: null });
            segBase += (rec.waypoints ? rec.waypoints.length : 0) + 1;
        }
    }
    // Playing groups: pairs that walk each hole's route, pausing to hit
    const routeGolfers = [];
    npcHoleRoutes = {};
    if (hole.holes) {
        for (const rec of hole.holes) {
            if (rec.open === false) continue; // closed: no rounds, no fees
            const pts = [rec.tee, ...(rec.waypoints || []), rec.pin]
                .map(p => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL }));
            if (pts.length >= 2) {
                // Harder holes command higher green fees — and punish play:
                // the same star rating scales duff/missed-putt odds below
                const diff = (typeof holeDifficulty === 'function')
                    ? holeDifficulty(rec) : 2;
                const fee = 3 + 2 * diff;
                const grp = { pts: pts, fee: fee, holeId: rec.id,
                              par: rec.par || 4, diff: diff };
                npcHoleRoutes[rec.id] = grp;
                routeGolfers.push(Object.assign({ off: 0 }, grp));
                routeGolfers.push(Object.assign({ off: 1 }, grp));
                // Popular resorts send out foursomes, not just pairs
                if (typeof resort !== 'undefined' && resort && resort.members >= 30) {
                    routeGolfers.push(Object.assign({ off: 2 }, grp));
                    routeGolfers.push(Object.assign({ off: 3 }, grp));
                }
            }
        }
    }
    // Crowd size follows membership: a young resort feels quiet, a big
    // one bustles (refreshes on the next terrain rebuild)
    const memberCrowd = (typeof resort !== 'undefined' && resort && resort.members)
        ? Math.min(24, 4 + Math.floor(resort.members / 3)) : NPC_COUNT;
    const walkerCount = npcPathCells.length >= 4 ? memberCrowd : 0;
    npcWalkerCount = walkerCount;
    // Dawn sprinklers: spaced across the fairways, rebuilt with the terrain
    sprinklerSpots = [];
    for (let r = 0; r < hole.rows && sprinklerSpots.length < 14; r++) {
        for (let c = 0; c < hole.cols; c++) {
            if (r % 6 === 2 && c % 6 === 4 && hole.grid[r][c] === T.FAIRWAY) {
                const hy = (hole.heights && hole.heights[r])
                    ? (hole.heights[r][c] || 0) : 0;
                sprinklerSpots.push({
                    x: (c + 0.5) * CELL, z: (r + 0.5) * CELL, y: hy,
                    phase: (r * 7 + c) % 10
                });
                if (sprinklerSpots.length >= 14) break;
            }
        }
    }
    const total = walkerCount + golfers.length + routeGolfers.length;
    if (total === 0) return;

    const bodyGeo = new THREE.CylinderGeometry(3.4, 4.2, 15, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    npcBodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, total);
    const headGeo = new THREE.SphereGeometry(3.8, 8, 6);
    const headMat = new THREE.MeshStandardMaterial({ color: linC(0xf0c8a0), roughness: 0.85 });
    npcHeadInst = new THREE.InstancedMesh(headGeo, headMat, total);
    npcBodyInst.castShadow = true;
    // Real golfer model when the Meshy asset is loaded: one InstancedMesh
    // per material part, all driven by the same per-visitor matrix. The
    // capsule body/head stay as the physics/anchor but render hidden.
    npcModelInsts = null;
    if (worldAssets && worldAssets.golfer) {
        golferModelScale = worldAssets.golfer.scale;
        // NOTE: no setColorAt here — r128's VAO cache chokes when a
        // geometry is shared between colored InstancedMeshes and anything
        // else; the shared texture already reads well
        npcModelInsts = worldAssets.golfer.parts.map((part) => {
            const im = new THREE.InstancedMesh(part.geometry, part.material, total);
            im.castShadow = true;
            im.frustumCulled = false;
            terrainGroup.add(im);
            return im;
        });
        npcBodyInst.visible = false;
        npcHeadInst.visible = false;
    }
    // Social rest spots: placed benches and gazebos attract walkers
    npcSocialSpots = [];
    npcVendorSpots = [];
    npcStandSpots = [];
    if (hole.decor) {
        for (const d of hole.decor) {
            if (d.t === 'bench' || d.t === 'gazebo'
                || d.t === 'kiosk' || d.t === 'stall') {
                npcSocialSpots.push({ x: d.x * CELL, z: d.y * CELL });
            }
            if (d.t === 'kiosk' || d.t === 'stall') {
                npcVendorSpots.push({ x: d.x * CELL, z: d.y * CELL, t: d.t });
            }
            if (d.t === 'grandstand') {
                npcStandSpots.push({ x: d.x * CELL, z: d.y * CELL });
            }
        }
    }
    for (let i = 0; i < walkerCount; i++) {
        const start = npcPathCells[(i * 37) % npcPathCells.length];
        npcStates.push({
            x: (start.c + 0.5) * CELL, z: (start.r + 0.5) * CELL,
            tx: (start.c + 0.5) * CELL, tz: (start.r + 0.5) * CELL,
            speed: 11 + (i % 4) * 2.5, phase: i * 1.7, idle: false,
            pause: 0
        });
    }
    for (let g = 0; g < golfers.length; g++) {
        const gp = golfers[g];
        npcStates.push({
            x: (gp.c + 0.5) * CELL, z: (gp.r + 0.5) * CELL,
            tx: (gp.c + 0.5) * CELL, tz: (gp.r + 0.5) * CELL,
            speed: 0, phase: g * 2.3, idle: true,
            arcIdx: gp.arcIdx != null ? gp.arcIdx : null
        });
    }
    // 12 firsts x 8 lasts = 96 unique regulars before any name repeats —
    // a big resort no longer fields three golfers who share one name,
    // one career record, and one inspector entry. Deterministic order
    // keeps early names identical to the classic roster.
    const GOLFER_FIRSTS = ['Ace', 'Birdie', 'Chip', 'Divot',
        'Eagle', 'Fairway', 'Gimme', 'Hook',
        'Iron', 'Jorge', 'Kara', 'Loft'];
    const GOLFER_LASTS = ['Watson', 'Chen', 'Alvarez', 'Dan',
        'Kim', 'Fran', 'Grace', 'Harper'];
    const golferName = (i) => GOLFER_FIRSTS[i % 12] + ' '
        + GOLFER_LASTS[(Math.floor(i / 12) + i) % 8];
    let gnIdx = 0;
    for (const rg of routeGolfers) {
        const gname = golferName(gnIdx);
        // Innate skills shape play: strong Recovery duffs less, a silky
        // Putter lips out fewer first putts (same hash as the inspector)
        const sk = (typeof golferSkills === 'function') ? golferSkills(gname) : null;
        gnIdx++;
        // Tee queue: playing partners wait in a small arc BEHIND the
        // tee (opposite the first shot direction) instead of stacking
        const qdx = rg.pts[1].x - rg.pts[0].x, qdz = rg.pts[1].z - rg.pts[0].z;
        const qd = Math.hypot(qdx, qdz) || 1;
        const qbx = -qdx / qd, qbz = -qdz / qd;   // unit "behind"
        const qsx = -qbz, qsz = qbx;              // unit "sideways"
        const QUEUE = [[0, 0], [13, -8], [17, 0], [13, 8]];
        const qOff = QUEUE[rg.off % QUEUE.length];
        const queueOff = {
            x: qbx * qOff[0] + qsx * qOff[1],
            z: qbz * qOff[0] + qsz * qOff[1]
        };
        npcStates.push({
            x: rg.pts[0].x + queueOff.x, z: rg.pts[0].z + queueOff.z,
            tx: rg.pts[1].x, tz: rg.pts[1].z,
            speed: 14 + rg.off * 3, phase: rg.off * 2.1, idle: false,
            queueOff: queueOff,
            route: rg.pts, ptIdx: 0, pause: 2 + rg.off * 2.5, fee: rg.fee,
            name: gname,
            putterSkill: sk ? sk[2][1] : 2,
            recoverySkill: sk ? sk[3][1] : 2,
            driverSkill: sk ? sk[0][1] : 2,
            holeId: rg.holeId, strokes: 0, lastRound: null, par: rg.par,
            diff: rg.diff,
            hunger: 8 + (gnIdx * 11) % 25, thirst: 6 + (gnIdx * 17) % 25,
            pendingSim: true, simResult: null,
            tier: ['basic', 'silver', 'gold'][(rg.holeId * 7 + rg.off * 3 + gnIdx) % 3]
        });
    }
    for (let i = 0; i < total; i++) {
        if (npcBodyInst.setColorAt) {
            npcBodyInst.setColorAt(i, new THREE.Color(NPC_COLORS[i % NPC_COLORS.length]).convertSRGBToLinear());
        }
    }
    if (npcBodyInst.instanceColor) npcBodyInst.instanceColor.needsUpdate = true;
    terrainGroup.add(npcBodyInst);
    terrainGroup.add(npcHeadInst);
    // Leather golf bag: stands beside a player who's waiting to hit
    const bagGeo = new THREE.CylinderGeometry(1.7, 1.9, 11, 7);
    const bagMat = new THREE.MeshStandardMaterial({
        color: linC(0x8a5a30), roughness: 0.85 });
    npcBagInst = new THREE.InstancedMesh(bagGeo, bagMat, total);
    npcBagInst.castShadow = true;
    npcBagInst.frustumCulled = false;
    terrainGroup.add(npcBagInst);
    // Sun hats on every other walker — cheap silhouette variety
    npcHatInst = null;
    if (walkerCount > 0) {
        const hatGeo = new THREE.CylinderGeometry(4.4, 4.4, 0.9, 8);
        const hatMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
        npcHatInst = new THREE.InstancedMesh(hatGeo, hatMat, walkerCount);
        const hatCols = [0xf2e3c0, 0xe57373, 0x90caf9, 0xfff176];
        for (let i = 0; i < walkerCount; i++) {
            if (npcHatInst.setColorAt) {
                npcHatInst.setColorAt(i,
                    new THREE.Color(hatCols[i % hatCols.length]).convertSRGBToLinear());
            }
        }
        if (npcHatInst.instanceColor) npcHatInst.instanceColor.needsUpdate = true;
        terrainGroup.add(npcHatInst);
    }
    // Umbrellas: popped open over walkers AND route golfers between
    // shots while a shower passes (stationed swingers keep both hands
    // on the club). Capacity covers every NPC; unused slots stay hidden.
    npcUmbrellaInst = null;
    if (total > 0) {
        const umbGeo = new THREE.ConeGeometry(6.5, 3.2, 8);
        const umbMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
        npcUmbrellaInst = new THREE.InstancedMesh(umbGeo, umbMat, total);
        for (let i = 0; i < total; i++) {
            if (npcUmbrellaInst.setColorAt) {
                npcUmbrellaInst.setColorAt(i,
                    new THREE.Color(NPC_COLORS[(i + 3) % NPC_COLORS.length]).convertSRGBToLinear());
            }
        }
        if (npcUmbrellaInst.instanceColor) npcUmbrellaInst.instanceColor.needsUpdate = true;
        terrainGroup.add(npcUmbrellaInst);
    }
    if (golfers.length) {
        // Club shaft held by each stationed golfer, grip at origin so
        // rotating the instance swings the club around the hands
        const clubGeo = new THREE.CylinderGeometry(0.45, 0.85, 15, 5);
        clubGeo.translate(0, -7.5, 0);
        const clubMat = new THREE.MeshStandardMaterial({ color: linC(0xb8bfc6), roughness: 0.4 });
        npcClubInst = new THREE.InstancedMesh(clubGeo, clubMat, golfers.length);
        terrainGroup.add(npcClubInst);
    }
}

// Golfer inner life: push a thought (capped log) and recompute mood.
// The inspector panel in game.js renders these verbatim.
// Chance a rain-soaked golfer quits at hole-out: a clubhouse and
// gazebo/bench shelters talk them into waiting the shower out
function rainQuitChance() {
    const shelters = (typeof npcSocialSpots !== 'undefined')
        ? npcSocialSpots.length : 0;
    const club = (typeof resort !== 'undefined' && resort && resort.amenities
        && resort.amenities.clubhouse) ? 0.08 : 0;
    return Math.max(0.08, 0.3 - 0.04 * shelters - club);
}

function golferThink(s, text, v) {
    s.thoughts = s.thoughts || [];
    s.thoughts.unshift({ t: text, v: v,
        at: (typeof resort !== 'undefined' && resort) ? (resort.worldClock || 0) : 0 });
    if (s.thoughts.length > 6) s.thoughts.pop();
    let m = 50;
    for (const th of s.thoughts) m += th.v * 0.8;
    s.mood = Math.max(5, Math.min(95, Math.round(m)));
    // Too many bad breaks in a row: a full tantrum on the spot. Venting
    // clears the head — mood recovers afterwards, but it's on the record.
    if (s.mood <= 25 && !(s.freakout > 0) && s.name) {
        s.freakout = 3;
        s.freakouts = (s.freakouts || 0) + 1;
        // Tantrums cost the resort: an annoyed member cancels
        if (typeof resort !== 'undefined' && resort && resort.members > 5) {
            resort.members--;
        }
        s.thoughts.unshift({ t: 'FREAKOUT! Lost my cool out there', v: 0 });
        if (s.thoughts.length > 6) s.thoughts.pop();
        s.mood = 45;
        (window.__scorePopups = window.__scorePopups || []).push({
            x: s.x, z: s.z, t0: performance.now(),
            txt: '\u{1F4A2} FREAKOUT!', col: '#ff5040', name: s.name, stack: 0
        });
        if (typeof addComplaint === 'function') {
            addComplaint(Math.floor(s.x / CELL), Math.floor(s.z / CELL),
                s.holeId, (s.name || 'A golfer')
                + ' stormed off in a rage here', 'freakout');
        }
    }
}

// ---- Glowing shot trail: golden puffs shed by the ball in flight ----
let trailPuffs = [];
let trailPuffTex = null;
let trailLastX = 0, trailLastY = 0, trailLastZ = 0;
function spawnTrailPuff3D(wx, wy, wz) {
    if (typeof scene3d === 'undefined' || !scene3d) return;
    const dx = wx - trailLastX, dy = wy - trailLastY, dz = wz - trailLastZ;
    if (dx * dx + dy * dy + dz * dz < 64) return; // throttle by distance
    trailLastX = wx; trailLastY = wy; trailLastZ = wz;
    if (!trailPuffTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 32;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(16, 16, 2, 16, 16, 15);
        grad.addColorStop(0, 'rgba(255,235,150,0.9)');
        grad.addColorStop(0.5, 'rgba(255,205,90,0.4)');
        grad.addColorStop(1, 'rgba(255,190,60,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 32, 32);
        trailPuffTex = new THREE.CanvasTexture(c);
    }
    const mat = new THREE.SpriteMaterial({
        map: trailPuffTex, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    mat.toneMapped = false;
    const spr = new THREE.Sprite(mat);
    spr.position.set(wx, wy, wz);
    spr.scale.set(7, 7, 1);
    scene3d.add(spr);
    trailPuffs.push({ spr, mat, t0: performance.now() });
    if (trailPuffs.length > 48) {
        const old2 = trailPuffs.shift();
        scene3d.remove(old2.spr);
        old2.mat.dispose();
    }
}
function updateTrailPuffs3D() {
    const now = performance.now();
    for (let i = trailPuffs.length - 1; i >= 0; i--) {
        const p = trailPuffs[i];
        const k = (now - p.t0) / 800;
        if (k >= 1) {
            scene3d.remove(p.spr);
            p.mat.dispose();
            trailPuffs.splice(i, 1);
            continue;
        }
        p.mat.opacity = 0.85 * (1 - k);
        const sc = (p.bs || 7) * (1 - k * 0.5);
        p.spr.scale.set(sc, sc, 1);
    }
}

// ---- Dawn sprinklers: rotating water jets over the fairways ----
let sprinklerSpots = [];
let sprinklerPool = [];
let sprinklerTex = null;
const SPRK_DROPS = 9;
function updateSprinklers3D(hole) {
    if (typeof scene3d === 'undefined' || !scene3d) return;
    const hr = (typeof resort !== 'undefined' && resort)
        ? ((((resort.worldClock || 0) / 60) % 24) + 24) % 24 : 12;
    const on = hr >= 5.5 && hr < 7.5 && sprinklerSpots.length > 0;
    if (!on) {
        for (const d of sprinklerPool) d.visible = false;
        return;
    }
    if (!sprinklerTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(8, 8, 1, 8, 8, 7);
        grad.addColorStop(0, 'rgba(235,250,255,0.95)');
        grad.addColorStop(0.6, 'rgba(160,215,245,0.5)');
        grad.addColorStop(1, 'rgba(140,200,240,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 16, 16);
        sprinklerTex = new THREE.CanvasTexture(c);
    }
    const need = sprinklerSpots.length * SPRK_DROPS;
    while (sprinklerPool.length < need) {
        const mat = new THREE.SpriteMaterial({
            map: sprinklerTex, transparent: true, opacity: 0.8,
            depthWrite: false
        });
        mat.toneMapped = false;
        const spr = new THREE.Sprite(mat);
        scene3d.add(spr);
        sprinklerPool.push(spr);
    }
    const t = performance.now() / 1000;
    for (let i = 0; i < sprinklerPool.length; i++) {
        const spr = sprinklerPool[i];
        const si = Math.floor(i / SPRK_DROPS);
        if (si >= sprinklerSpots.length) { spr.visible = false; continue; }
        const spot = sprinklerSpots[si];
        const j = i % SPRK_DROPS;
        // Two opposing arms per head (classic impact sprinkler)
        const arm = j % 2;
        const kk = (Math.floor(j / 2) + 0.5) / (SPRK_DROPS / 2);
        const az = t * 1.3 + spot.phase + arm * Math.PI;
        const rad = 3 + kk * 19;
        spr.visible = true;
        spr.position.set(
            spot.x + Math.cos(az) * rad,
            spot.y + 2 + 30 * kk * (1 - kk),
            spot.z + Math.sin(az) * rad);
        const sc = 3.6 - kk * 1.5;
        spr.scale.set(sc, sc, 1);
        spr.material.opacity = 0.95 * (1 - kk * 0.45);
    }
}

// ---- Sand puff: a ball plugging into a bunker kicks up grit ----
function spawnSandPuff3D(wx, wy, wz) {
    if (typeof scene3d === 'undefined' || !scene3d || !trailPuffTex) return;
    for (let i = 0; i < 6; i++) {
        const mat = new THREE.SpriteMaterial({
            map: trailPuffTex, color: 0xc9a05e, transparent: true,
            opacity: 0.9, depthWrite: false
        });
        mat.toneMapped = false;
        const spr = new THREE.Sprite(mat);
        spr.position.set(wx + Math.random() * 8 - 4, wy + Math.random() * 3,
            wz + Math.random() * 8 - 4);
        scene3d.add(spr);
        trailPuffs.push({ spr, mat, t0: performance.now(),
            bs: 4 + Math.random() * 3 });
    }
    while (trailPuffs.length > 48) {
        const old2 = trailPuffs.shift();
        scene3d.remove(old2.spr);
        old2.mat.dispose();
    }
}

// ---- Turf divot: flecks kicked forward when a full swing strikes ----
function spawnDivot3D(wx, wy, wz, ux, uz) {
    if (typeof scene3d === 'undefined' || !scene3d || !trailPuffTex) return;
    for (let i = 0; i < 5; i++) {
        const mat = new THREE.SpriteMaterial({
            map: trailPuffTex, color: i % 2 ? 0x5d8a34 : 0x6b4d2a,
            transparent: true, opacity: 0.9, depthWrite: false
        });
        mat.toneMapped = false;
        const spr = new THREE.Sprite(mat);
        const along = 2 + Math.random() * 6;
        spr.position.set(
            wx + ux * along + (Math.random() * 3 - 1.5),
            wy + 1 + Math.random() * 3,
            wz + uz * along + (Math.random() * 3 - 1.5));
        scene3d.add(spr);
        trailPuffs.push({ spr, mat, t0: performance.now(),
            bs: 2.5 + Math.random() * 1.5 });
    }
    while (trailPuffs.length > 48) {
        const old2 = trailPuffs.shift();
        scene3d.remove(old2.spr);
        old2.mat.dispose();
    }
}

// ---- Fireworks: bursts for the resort's biggest moments ----
let fwParticles = [];
function spawnFirework3D(wx, wz, colHex) {
    if (typeof scene3d === 'undefined' || !scene3d) return;
    if (!trailPuffTex) spawnTrailPuff3D(-99999, -99999, -99999);
    if (!trailPuffTex) return;
    const h = 130 + Math.random() * 60;
    for (let i = 0; i < 16; i++) {
        const mat = new THREE.SpriteMaterial({
            map: trailPuffTex, color: colHex || 0xffd24a, transparent: true,
            opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
        });
        mat.toneMapped = false;
        const spr = new THREE.Sprite(mat);
        spr.position.set(wx, h, wz);
        spr.scale.set(6, 6, 1);
        scene3d.add(spr);
        const th = (i / 16) * Math.PI * 2;
        const sp = 26 + Math.random() * 22;
        fwParticles.push({
            spr, mat, t0: performance.now(),
            vx: Math.cos(th) * sp, vy: 18 + Math.random() * 14,
            vz: Math.sin(th) * sp
        });
    }
    while (fwParticles.length > 120) {
        const old2 = fwParticles.shift();
        scene3d.remove(old2.spr);
        old2.mat.dispose();
    }
}
let fwLastT = 0;
function updateFireworks3D() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (fwLastT || now)) / 1000);
    fwLastT = now;
    for (let i = fwParticles.length - 1; i >= 0; i--) {
        const p = fwParticles[i];
        const k = (now - p.t0) / 1500;
        if (k >= 1) {
            scene3d.remove(p.spr);
            p.mat.dispose();
            fwParticles.splice(i, 1);
            continue;
        }
        p.vy -= 55 * dt;
        p.spr.position.x += p.vx * dt;
        p.spr.position.y += p.vy * dt;
        p.spr.position.z += p.vz * dt;
        p.mat.opacity = 1 - k;
        const sc = 6 * (1 - k * 0.4);
        p.spr.scale.set(sc, sc, 1);
    }
}

// ---- Swing flash: a quick white glint when an ambient golfer strikes ----
let swingFlashes = [];
function spawnSwingFlash3D(wx, wy, wz) {
    if (typeof scene3d === 'undefined' || !scene3d || !trailPuffTex) return;
    const mat = new THREE.SpriteMaterial({
        map: trailPuffTex, color: 0xffffff, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    mat.toneMapped = false;
    const spr = new THREE.Sprite(mat);
    spr.position.set(wx, wy, wz);
    spr.scale.set(4, 4, 1);
    scene3d.add(spr);
    swingFlashes.push({ spr, mat, t0: performance.now() });
    if (swingFlashes.length > 24) {
        const old2 = swingFlashes.shift();
        scene3d.remove(old2.spr);
        old2.mat.dispose();
    }
}
function updateSwingFlashes3D() {
    const now = performance.now();
    for (let i = swingFlashes.length - 1; i >= 0; i--) {
        const f = swingFlashes[i];
        const k = (now - f.t0) / 350;
        if (k >= 1) {
            scene3d.remove(f.spr);
            f.mat.dispose();
            swingFlashes.splice(i, 1);
            continue;
        }
        f.mat.opacity = 1 - k;
        const sc = 4 + k * 9;
        f.spr.scale.set(sc, sc, 1);
    }
}

// ---- NPC ball flights: white balls arcing down the fairways ----
// The signature living-course visual: every ambient strike launches a
// real airborne ball toward the next landing spot, shedding vapor.
let npcFlights = [];
function spawnNpcFlight3D(x0, y0, z0, x1, y1, z1, pin, skill, drama) {
    if (typeof scene3d === 'undefined' || !scene3d || !trailPuffTex) return;
    const dx = x1 - x0, dz = z1 - z0;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 3) return;
    const putt = dist < 20; // short game: a low roll, not a flight
    const mat = new THREE.SpriteMaterial({
        map: trailPuffTex, color: 0xffffff, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    mat.toneMapped = false;
    const spr = new THREE.Sprite(mat);
    spr.position.set(x0, putt ? y1 + 1.5 : y0, z0);
    spr.scale.set(putt ? 2.4 : 3.4, putt ? 2.4 : 3.4, 1);
    scene3d.add(spr);
    // Shot shape: everyone curves the ball a little; weaker drivers
    // curve it a lot. Sign picks draw vs fade per swing.
    const sk = Math.max(1, Math.min(4, skill || 2));
    const bend = putt ? 0
        : (Math.random() * 2 - 1) * Math.min(10, dist * 0.10) * (1.25 - sk * 0.22);
    npcFlights.push({
        spr, mat, x0, y0: putt ? y1 + 1.5 : y0, z0, x1, y1, z1, putt,
        bend, perpX: -dz / dist, perpZ: dx / dist, drama: !!drama,
        px: pin ? pin.x : null, pz: pin ? pin.z : null,
        apex: putt ? 0.7 : Math.min(60, 10 + dist * 0.28),
        t0: performance.now(),
        dur: putt ? 420 + dist * 22 : 700 + dist * 5.5,
        puffAt: 0
    });
    if (npcFlights.length > 20) {
        const old2 = npcFlights.shift();
        scene3d.remove(old2.spr);
        old2.mat.dispose();
    }
}
function updateNpcFlights3D(hole) {
    const now = performance.now();
    for (let i = npcFlights.length - 1; i >= 0; i--) {
        const f = npcFlights[i];
        const k = (now - f.t0) / f.dur;
        if (k < 0) continue; // hanging on the lip: wait out the beat
        if (k >= 1) {
            if (f.putt) { // a roll just stops where it stops
                scene3d.remove(f.spr);
                f.mat.dispose();
                npcFlights.splice(i, 1);
                continue;
            }
            // Touchdown: splash out in water, else two dampened hops
            const wc = Math.floor(f.x1 / CELL), wr = Math.floor(f.z1 / CELL);
            const wet = f.bounce == null && typeof T !== 'undefined'
                && hole && hole.grid && hole.grid[wr]
                && hole.grid[wr][wc] === T.WATER;
            if (wet) {
                spawnSplash3D(f.x1, f.z1);
                scene3d.remove(f.spr);
                f.mat.dispose();
                npcFlights.splice(i, 1);
                continue;
            }
            const sandy = f.bounce == null && typeof T !== 'undefined'
                && hole && hole.grid && hole.grid[wr]
                && hole.grid[wr][wc] === T.SAND;
            if (sandy) {
                spawnSandPuff3D(f.x1, f.y1, f.z1); // plugged lie: no hops
                scene3d.remove(f.spr);
                f.mat.dispose();
                npcFlights.splice(i, 1);
                continue;
            }
            // Approach shots roll out toward the cup instead of hopping
            // through: one low trickle that settles beside the pin
            if (f.px != null && f.bounce == null && typeof T !== 'undefined'
                && hole && hole.grid && hole.grid[wr]
                && hole.grid[wr][wc] === T.GREEN) {
                if (f.lip === 1) {
                    // The miss sits for a beat, then the tap-in drops
                    f.lip = 2;
                    f.x0 = f.x1; f.z0 = f.z1; f.y0 = f.y1;
                    f.x1 = f.px; f.z1 = f.pz;
                    f.apex = 0.7;
                    f.t0 = now + 480; // the groan-and-reset beat
                    f.dur = 460;
                    continue;
                }
                if (f.lip === 2) { // tap-in falls: done
                    scene3d.remove(f.spr);
                    f.mat.dispose();
                    npcFlights.splice(i, 1);
                    continue;
                }
                if (f.drama && !f.lip) {
                    // Lip-out: race to the cup, curl around it, slide past
                    f.lip = 1;
                    const dx3 = f.px - f.x1, dz3 = f.pz - f.z1;
                    const dd3 = Math.hypot(dx3, dz3) || 1;
                    f.x0 = f.x1; f.z0 = f.z1; f.y0 = f.y1;
                    f.x1 = f.px + (dx3 / dd3) * 3.6 - (dz3 / dd3) * 1.6;
                    f.z1 = f.pz + (dz3 / dd3) * 3.6 + (dx3 / dd3) * 1.6;
                    f.apex = 1.1;
                    f.t0 = now;
                    f.dur = 620;
                    continue;
                }
                // Stiff one: an approach dropped inside ~4.5 units of the
                // cup draws an appreciative murmur over the pin
                if (Math.hypot(f.x1 - f.px, f.z1 - f.pz) < 4.5) {
                    (window.__scorePopups = window.__scorePopups || []).push({
                        x: f.px, z: f.pz, t0: performance.now(),
                        txt: 'Ooh!', col: '#9fd7ff', name: '', stack: 0
                    });
                    if (window.__tourney && typeof playApplause === 'function'
                        && performance.now() - (window.__lastClap || 0) > 10000) {
                        window.__lastClap = performance.now();
                        playApplause();
                    }
                }
                f.bounce = 2; // final fading phase
                f.x0 = f.x1; f.z0 = f.z1; f.y0 = f.y1;
                f.x1 = f.px + Math.random() * 4 - 2;
                f.z1 = f.pz + Math.random() * 4 - 2;
                f.apex = 1.4;
                f.t0 = now;
                f.dur = 520;
                continue;
            }
            f.bounce = (f.bounce || 0) + 1;
            if (f.bounce > 2) {
                scene3d.remove(f.spr);
                f.mat.dispose();
                npcFlights.splice(i, 1);
                continue;
            }
            const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0) || 1;
            const ux = (f.x1 - f.x0) / len, uz = (f.z1 - f.z0) / len;
            const hop = f.bounce === 1 ? 8 : 4;
            f.x0 = f.x1; f.z0 = f.z1; f.y0 = f.y1;
            f.x1 += ux * hop; f.z1 += uz * hop;
            f.apex = Math.max(1.2, f.apex * (f.bounce === 1 ? 0.09 : 0.045));
            f.t0 = now;
            f.dur = f.bounce === 1 ? 320 : 260;
            continue;
        }
        let x = f.x0 + (f.x1 - f.x0) * k;
        let z = f.z0 + (f.z1 - f.z0) * k;
        const y = f.y0 + (f.y1 - f.y0) * k + f.apex * 4 * k * (1 - k);
        if (f.bend && f.bounce == null) {
            const sway = f.bend * Math.sin(Math.PI * k);
            x += f.perpX * sway;
            z += f.perpZ * sway;
        }
        f.spr.position.set(x, y, z);
        if (f.bounce === 2) f.mat.opacity = 1 - k; // roll-out fade
        if (!f.bounce && !f.putt && now - f.puffAt > 130 && k < 0.75) {
            f.puffAt = now;
            spawnTrailPuff3D(x, y, z);
        }
    }
}

// ---- Ball water splash: expanding foam ring at the entry point ----
let ballSplashes = [];
function spawnSplash3D(wx, wz) {
    if (typeof scene3d === 'undefined' || !scene3d) return;
    const ringGeo = new THREE.RingGeometry(1.5, 3.4, 18);
    ringGeo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
        color: 0xdffcff, transparent: true, opacity: 0.95,
        depthWrite: false, side: THREE.DoubleSide
    });
    mat.toneMapped = false;
    const m = new THREE.Mesh(ringGeo, mat);
    m.position.set(wx, -1.0, wz); // a hair above the water plane
    m.renderOrder = 3;
    scene3d.add(m);
    ballSplashes.push({ m, mat, t0: performance.now() });
}
function updateSplashes3D() {
    const now = performance.now();
    for (let i = ballSplashes.length - 1; i >= 0; i--) {
        const s = ballSplashes[i];
        const k = (now - s.t0) / 900;
        if (k >= 1) {
            scene3d.remove(s.m);
            s.m.geometry.dispose();
            s.mat.dispose();
            ballSplashes.splice(i, 1);
            continue;
        }
        const sc = 1 + k * 5.5;
        s.m.scale.set(sc, 1, sc);
        s.mat.opacity = 0.95 * (1 - k) * (1 - k);
    }
}

// Called from the game loop each frame while the overworld is visible
function updateAmbientNPCs3D(dt, hole) {
    updateSplashes3D();
    updateTrailPuffs3D();
    updateSwingFlashes3D();
    updateNpcFlights3D(hole);
    updateSprinklers3D(hole);
    updateFireworks3D();
    // A freshly inspected golfer greets the camera (set by the game UI)
    if (window.__greetGolfer && npcStates.length) {
        const g = npcStates.find(n => n.name === window.__greetGolfer);
        if (g) g.greet = 1.3;
        window.__greetGolfer = null;
    }
    updateHoverBots3D(dt, hole);
    updateFountains3D();
    updatePinRings3D();
    updateCartDrive3D(dt, hole);
    updateShuttle3D(dt, hole);
    updateCritters3D(hole);
    updateFireflies3D(hole);
    updateBuoys3D();
    updateBoat3D(hole);
    updateLeaves3D(hole);
    updateRain3D(dt);
    for (const bg of beaconGroups) bg.rotation.y = windClock.value * 0.9;
    if (!npcBodyInst || !npcStates.length) return;
    const dummy = sharedDummy3D;
    const t = windClock.value;
    for (let i = 0; i < npcStates.length; i++) {
        const s = npcStates[i];
        if (s.gone) {
            // Left the resort: park every instanced part out of sight
            dummy.position.set(0, -900, 0);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(0.001, 0.001, 0.001);
            dummy.updateMatrix();
            npcBodyInst.setMatrixAt(i, dummy.matrix);
            npcHeadInst.setMatrixAt(i, dummy.matrix);
            if (npcModelInsts) {
                for (const im of npcModelInsts) im.setMatrixAt(i, dummy.matrix);
            }
            if (npcHatInst && i < npcWalkerCount) npcHatInst.setMatrixAt(i, dummy.matrix);
            if (npcUmbrellaInst) npcUmbrellaInst.setMatrixAt(i, dummy.matrix);
            if (npcBagInst) npcBagInst.setMatrixAt(i, dummy.matrix);
            dummy.scale.set(1, 1, 1);
            continue;
        }
        const dx = s.tx - s.x, dz = s.tz - s.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (s.idle) {
            // Stationed golfer: gentle sway + slow turn, no wandering
        } else if (s.route) {
            // Round-in-progress golfer: walk the hole route, pause to hit,
            // restart at the tee after holing out
            s.age = (s.age || 0) + dt;
            s.hunger = Math.min(100, (s.hunger || 0) + dt * 0.3);
            s.thirst = Math.min(100, (s.thirst || 0) + dt * 0.45);
            // Close of play: after ~9 PM golfers call it a day and walk
            // out (quietly — no drama toast). The 6 AM fresh tee sheet
            // brings everyone back for the new day.
            if (!s.leaving && typeof resort !== 'undefined' && resort) {
                const hr9 = (((resort.worldClock || 0) / 60) % 24 + 24) % 24;
                if (hr9 >= 21 || hr9 < 5.5) {
                    s.leaving = true;
                    s.detour = null;
                    s.returning = false;
                    const eCol9 = Math.floor(hole.cols / 2);
                    const eRow9 = hole.rows - (hole.border || 4);
                    s.leaveX = (eCol9 + 0.5) * CELL;
                    s.leaveZ = (eRow9 + 0.5) * CELL;
                    s.walkPath = pathRoute(s.x, s.z, s.leaveX, s.leaveZ);
                    golferThink(s, 'That\u2019s the day \u2014 heading home', 2);
                }
            }
            // Storming out: walkway route to the entrance, then gone
            // (the slot stays parked until the next terrain rebuild
            // reseeds a fresh roster)
            if (s.leaving) {
                const pth2 = s.walkPath;
                if (pth2 && pth2.length) {
                    const wp2 = pth2[0];
                    if ((wp2.x - s.x) * (wp2.x - s.x)
                        + (wp2.z - s.z) * (wp2.z - s.z) < 42) pth2.shift();
                }
                const on2 = s.walkPath && s.walkPath.length;
                const gx2 = on2 ? s.walkPath[0].x : s.leaveX;
                const gz2 = on2 ? s.walkPath[0].z : s.leaveZ;
                const dd2x = gx2 - s.x, dd2z = gz2 - s.z;
                const dd2 = Math.sqrt(dd2x * dd2x + dd2z * dd2z) || 1;
                s.tx = gx2; s.tz = gz2;
                if (!on2 && dd2 < 10) {
                    s.gone = true;
                    s.name = null; // rosters, taps and sims all ignore them
                } else {
                    walkStepAvoid(hole, s, gx2, gz2, dt);
                }
            } else
            // Detour to a kiosk/stall: walk over, buy, walk back to the tee
            if (s.detour || s.returning) {
                // Returning golfers head straight for their queue slot
                const fx = s.detour ? s.detour.x
                    : s.route[0].x + (s.queueOff ? s.queueOff.x : 0);
                const fz = s.detour ? s.detour.z
                    : s.route[0].z + (s.queueOff ? s.queueOff.z : 0);
                // Walkway waypoints first, then the short off-path leg
                const pth = s.walkPath;
                if (pth && pth.length) {
                    const wp = pth[0];
                    if ((wp.x - s.x) * (wp.x - s.x)
                        + (wp.z - s.z) * (wp.z - s.z) < 42) pth.shift();
                }
                const onPath = s.walkPath && s.walkPath.length;
                const gx = onPath ? s.walkPath[0].x : fx;
                const gz = onPath ? s.walkPath[0].z : fz;
                const ddx = gx - s.x, ddz = gz - s.z;
                const dd = Math.sqrt(ddx * ddx + ddz * ddz);
                s.tx = gx; s.tz = gz;
                if (!onPath && dd < 6) {
                    if (s.detour) {
                        // Buy for the triggering need — and top up the other
                        // one too if it's also run high (one stop, two sales)
                        let price = 0;
                        const wantDrink = (s.thirst || 0) > 55;
                        const wantFood = (s.hunger || 0) > 55;
                        if (wantDrink) { price += 5; s.thirst = 5; }
                        if (wantFood) { price += 8; s.hunger = 5; }
                        if (!price) { price = 5; s.thirst = 5; }
                        window.__golfFees = (window.__golfFees || 0) + price;
                        window.__stallSales = (window.__stallSales || 0) + price;
                        // Per-facility books: credit the vendor that served
                        if (typeof worldCourse !== 'undefined' && worldCourse.decor) {
                            const fac = worldCourse.decor.find(d2 =>
                                (d2.t === 'kiosk' || d2.t === 'stall')
                                && Math.abs(d2.x * CELL - gx) < 2
                                && Math.abs(d2.y * CELL - gz) < 2);
                            if (fac) {
                                const n = ((wantDrink ? 1 : 0) + (wantFood ? 1 : 0)) || 1;
                                fac.salesToday = (fac.salesToday || 0) + n;
                                fac.salesLife = (fac.salesLife || 0) + n;
                                fac.revToday = (fac.revToday || 0) + price;
                                fac.revLife = (fac.revLife || 0) + price;
                                const hr = Math.floor(((typeof resort !== 'undefined'
                                    && resort) ? (resort.worldClock || 0) : 0) % 1440 / 60);
                                fac.hourHist = fac.hourHist || {};
                                fac.hourHist[hr] = (fac.hourHist[hr] || 0) + n;
                            }
                        }
                        (window.__feePopups = window.__feePopups || []).push({
                            x: gx, z: gz, t0: performance.now(), amt: price,
                            tag: wantFood && wantDrink ? '\u{1F32D}\u{1F964}'
                                : wantFood ? '\u{1F32D}' : '\u{1F964}'
                        });
                        golferThink(s, wantFood && wantDrink
                            ? 'Snack and a drink — recharged!'
                            : wantFood ? 'Grabbed a bite — much better'
                            : 'Cold drink — just what I needed', 9);
                        s.detour = null;
                        s.returning = true;
                        s.walkPath = pathRoute(s.x, s.z,
                            s.route[0].x, s.route[0].z);
                        s.pause = 2.5;
                    } else {
                        s.returning = false;
                        s.walkPath = null;
                        s.ptIdx = 0;
                        s.pause = 2;
                    }
                } else if (s.pause > 0) {
                    s.pause -= dt;
                } else {
                    if (s.celeb != null) s.celeb = null;
                    walkStepAvoid(hole, s, gx, gz, dt);
                }
            } else {
            if (rainEnvNow > 0.4 && !s.rainMood) {
                s.rainMood = true;
                golferThink(s, 'Playing through the rain', -4);
            } else if (rainEnvNow < 0.1) s.rainMood = false;
            if (s.pause > 0) {
                s.pause -= dt;
                if (s.pause <= 0 && s.name && s.ptIdx < s.route.length - 1) {
                    // Strike! A quick club glint at hand height
                    const gr = Math.floor(s.z / CELL), gc = Math.floor(s.x / CELL);
                    const gy2 = (hole.heights && hole.heights[gr])
                        ? (hole.heights[gr][gc] || 0) : 0;
                    if (!trailPuffTex) spawnTrailPuff3D(-9999, -9999, -9999); // build tex
                    spawnSwingFlash3D(s.x + 3, gy2 + 14, s.z);
                    const np2 = s.route[s.ptIdx + 1];
                    if (np2) {
                        const lx = np2.x + Math.random() * 14 - 7;
                        const lz = np2.z + Math.random() * 14 - 7;
                        const nr2 = Math.floor(lz / CELL), nc2 = Math.floor(lx / CELL);
                        const ny2 = (hole.heights && hole.heights[nr2])
                            ? (hole.heights[nr2][nc2] || 0) : 0;
                        const toPin = (s.ptIdx + 2 === s.route.length)
                            ? s.route[s.route.length - 1] : null;
                        const lr3 = Math.floor(lz / CELL);
                        const lc3 = Math.floor(lx / CELL);
                        if (typeof T !== 'undefined' && hole.grid
                            && hole.grid[lr3]
                            && hole.grid[lr3][lc3] === T.WATER) {
                            s.fishAt = { x: lx, z: lz }; // stop to look for it
                        }
                        const badRound = s.simResult && s.par
                            && s.simResult.strokes > s.par;
                        const lipDrama = !!(toPin && badRound
                            && Math.random() < 0.5);
                        s.lipDrama = lipDrama;
                        spawnNpcFlight3D(s.x + 3, gy2 + 14, s.z,
                            lx, ny2 + 2, lz, toPin, s.driverSkill, lipDrama);
                        const ddx = lx - s.x, ddz = lz - s.z;
                        const dd = Math.hypot(ddx, ddz) || 1;
                        if (dd >= 20) {
                            spawnDivot3D(s.x + 3, gy2 + 1.5, s.z,
                                ddx / dd, ddz / dd);
                        }
                    }
                }
            } else {
                const nxt = s.route[s.ptIdx + 1];
                if (!nxt) {
                    // Holed out: bank the green fee, then restart at the tee
                    if (s.simResult && s.simResult.strokes > 0) {
                        // Real-physics round: the presimulated score IS the
                        // round (design pillar: one simulator powers all)
                        s.lastRound = s.simResult.strokes;
                        if (s.simResult.penalties > 0) {
                            golferThink(s, 'Found the water out there', -6);
                            // Pin the gripe at the actual splash landing
                            if (typeof addComplaint === 'function'
                                && Math.random() < 0.55) {
                                const sp = s.simResult.splashAt;
                                const cc = sp ? Math.floor(sp.x / CELL)
                                    : Math.floor(s.x / CELL);
                                const cr = sp ? Math.floor(sp.y / CELL)
                                    : Math.floor(s.z / CELL);
                                const oob = typeof T !== 'undefined'
                                    && hole.grid && hole.grid[cr]
                                    && hole.grid[cr][cc] === T.OOB;
                                const gripes = oob
                                    ? ['Knocked one out of bounds here',
                                       'This hole needs more room to miss']
                                    : ['Lost my ball in the water here',
                                       'This carry is brutal \u2014 splash!',
                                       'The water keeps eating my drives'];
                                addComplaint(cc, cr, s.holeId,
                                    (s.name || 'A golfer') + ': '
                                    + gripes[(s.freakouts || 0
                                        + s.holeId + cc) % gripes.length],
                                    'hazard');
                            }
                        }
                    } else {
                        s.lastRound = (s.strokes || 0) + 1; // statistical fallback
                        // Trickier greens lip out more first putts
                        if (s.lastRound > 1 && Math.random() < Math.max(0.04,
                            0.13 + 0.05 * (s.diff || 2) - (s.putterSkill || 2) * 0.022)) s.lastRound++;
                    }
                    // Hole-in-one: real physics can drop the tee shot; the
                    // fallback keeps a rare skill-nudged roll
                    if (s.lastRound === 1
                        || (!s.simResult && s.lastRound === 2 && s.strokes === 1
                            && Math.random() < 0.005 + 0.002 * (s.driverSkill || 2))) {
                        s.lastRound = 1;
                        golferThink(s, 'I ACED IT!!', 20);
                        if (typeof notify === 'function') {
                            notify('\u26A1 ACE! ' + (s.name || 'A golfer')
                                + ' holes the tee shot on hole ' + s.holeId + '!');
                        }
                        if (typeof playFanfare === 'function') playFanfare();
                    }
                    s.strokes = 0;
                    const tierMult = s.tier === 'gold' ? 2
                        : s.tier === 'silver' ? 1.5 : 1;
                    const paid = Math.round((s.fee || 5) * tierMult);
                    window.__golfFees = (window.__golfFees || 0) + paid;
                    const pinPt = s.route[s.route.length - 1];
                    window.__feePopups = window.__feePopups || [];
                    const feeStack = window.__feePopups.filter(q =>
                        Math.abs(q.x - pinPt.x) < 30 && Math.abs(q.z - pinPt.z) < 30
                        && performance.now() - q.t0 < 1500).length;
                    window.__feePopups.push({
                        x: pinPt.x, z: pinPt.z, t0: performance.now(), amt: paid,
                        stack: feeStack
                    });
                    // Caddie tip: a round under par leaves a gratuity on
                    // top of the fee — eagles tip double
                    if (s.par && s.lastRound && s.lastRound < s.par) {
                        const tip = (s.par - s.lastRound) >= 2 ? 4 : 2;
                        window.__golfFees += tip;
                        window.__tipFees = (window.__tipFees || 0) + tip;
                        window.__feePopups.push({
                            x: pinPt.x, z: pinPt.z, t0: performance.now(),
                            amt: tip, tag: '\u{1F4B5} tip',
                            stack: feeStack + 1
                        });
                    }
                    // Score callout vs par — the little dopamine hit that
                    // makes the ambient sim feel like real rounds
                    if (s.par) {
                        const diff = s.lastRound - s.par;
                        const call = s.lastRound === 1 ? ['ACE!!', '#ffd24a']
                            : diff <= -2 ? ['Eagle!', '#ffd24a']
                            : diff === -1 ? ['Birdie!', '#8be06a']
                            : diff === 0 ? ['Par', '#eaf4ff']
                            : diff === 1 ? ['Bogey', '#f0a860']
                            : ['+' + diff, '#e77d6a'];
                        // The tournament gallery applauds the great ones
                        // (eagles and better; 10s cooldown so back-to-back
                        // hole-outs don't stack claps)
                        if (window.__tourney && diff <= -2
                            && typeof playApplause === 'function'
                            && performance.now() - (window.__lastClap || 0) > 10000) {
                            window.__lastClap = performance.now();
                            playApplause();
                        }
                        // Stack callouts that land on the same pin within a
                        // couple seconds (playing partners holing out together)
                        window.__scorePopups = window.__scorePopups || [];
                        const live = window.__scorePopups.filter(q =>
                            Math.abs(q.x - pinPt.x) < 30 && Math.abs(q.z - pinPt.z) < 30
                            && performance.now() - q.t0 < 2200).length;
                        window.__scorePopups.push({
                            x: pinPt.x, z: pinPt.z, t0: performance.now(),
                            txt: call[0], col: call[1], name: s.name || '',
                            stack: live
                        });
                        // Feed the round into per-hole play statistics
                        (window.__holeOuts = window.__holeOuts || []).push({
                            holeId: s.holeId, score: s.lastRound, par: s.par,
                            name: s.name || ''
                        });
                        s.celeb = diff; // drives green-side body language
                        s.lastRel = diff; // roster chip: last round vs par
                        if (s.lipDrama && diff > 0) {
                            // The horseshoe still stings on the walk off
                            s.freakout = 2.2;
                            golferThink(s, 'It lipped OUT. Unbelievable.', -6);
                        }
                        s.lipDrama = false;
                        s.fishAt = null; // next round starts clean
                        s.rounds = (s.rounds || 0) + 1;
                        golferThink(s,
                            diff <= -1 ? 'What a hole — loved it!'
                            : diff === 0 ? 'Solid par out there'
                            : 'That hole beat me up',
                            diff <= -1 ? 14 : diff === 0 ? 6 : -5);
                    }
                    // A truly rotten day ends early: mood in the gutter
                    // after several rounds sends them to the exit. Heavy
                    // rain thins the field too — a soaked golfer finishing
                    // a hole sometimes just calls it.
                    const rainQuit = rainEnvNow > 0.55 && (s.rounds || 0) >= 1
                        && Math.random() < rainQuitChance();
                    if (((s.mood != null && s.mood <= 20
                        && (s.rounds || 0) >= 3) || rainQuit) && !s.leaving) {
                        s.leaving = true;
                        s.detour = null;
                        s.returning = false;
                        const eCol2 = Math.floor(hole.cols / 2);
                        const eRow2 = hole.rows - (hole.border || 4);
                        s.leaveX = (eCol2 + 0.5) * CELL;
                        s.leaveZ = (eRow2 + 0.5) * CELL;
                        s.walkPath = pathRoute(s.x, s.z, s.leaveX, s.leaveZ);
                        if (rainQuit) {
                            // Hustle out of the wet — a visible dash
                            if (!s.dashing) {
                                s.dashing = true;
                                s.speed = (s.speed || 12) * 1.6;
                            }
                            golferThink(s, 'Not playing through THIS', -2);
                            if (typeof notify === 'function') {
                                notify('\u{1F327}\uFE0F ' + s.name
                                    + ' called it a day \u2014 too wet');
                            }
                        } else {
                            golferThink(s, "That's it \u2014 going home early", -2);
                            if (typeof notify === 'function') {
                                notify('\u{1F61E} ' + s.name
                                    + ' had a rough day and left early');
                            }
                        }
                    }
                    // Variety: a third of finished rounds move the group
                    // to a different open hole — golfers migrate around
                    // the course instead of grinding one hole all day
                    // (also resets the boredom clock)
                    {
                        const ids = Object.keys(npcHoleRoutes);
                        if (ids.length > 1 && Math.random() < 0.35) {
                            const others = ids.filter(k => +k !== s.holeId);
                            const pick = npcHoleRoutes[
                                others[Math.floor(Math.random() * others.length)]];
                            if (pick) {
                                s.route = pick.pts;
                                s.holeId = pick.holeId;
                                s.par = pick.par;
                                s.fee = pick.fee;
                                s.diff = pick.diff;
                                s.age = 0;
                                golferThink(s, 'Let\u2019s try hole '
                                    + pick.holeId + ' next', 4);
                            }
                        }
                    }
                    s.ptIdx = 0;
                    // No teleporting: stroll from the green back to the
                    // (possibly new) tee along the walkways — the same
                    // returning walk the kiosk detours use
                    s.returning = true;
                    s.walkPath = pathRoute(s.x, s.z,
                        s.route[0].x, s.route[0].z);
                    s.pause = 2.5; // a beat on the green first
                    s.pendingSim = true;   // presimulate the next round
                    s.simResult = null;
                    // Hungry or thirsty? Walk to the nearest kiosk/stall
                    // between rounds (that's the stall owner's income)
                    // Serve the *larger* need so neither starves behind the
                    // faster-growing one
                    const need = Math.max(s.hunger || 0, s.thirst || 0) <= 60 ? null
                        : (s.hunger || 0) >= (s.thirst || 0) ? 'hunger' : 'thirst';
                    if (need && npcVendorSpots.length) {
                        // Food cravings head for the snack stall, thirst
                        // for the drinks kiosk — both vendors earn their
                        // keep instead of the nearest one taking every
                        // sale. Falls back to any vendor when the right
                        // type isn't built yet.
                        const wantT = need === 'hunger' ? 'stall' : 'kiosk';
                        let vb = null, vd = Infinity;
                        for (const v of npcVendorSpots) {
                            if (v.t !== wantT) continue;
                            const dv = (v.x - s.x) * (v.x - s.x)
                                     + (v.z - s.z) * (v.z - s.z);
                            if (dv < vd) { vd = dv; vb = v; }
                        }
                        if (!vb) {
                            for (const v of npcVendorSpots) {
                                const dv = (v.x - s.x) * (v.x - s.x)
                                         + (v.z - s.z) * (v.z - s.z);
                                if (dv < vd) { vd = dv; vb = v; }
                            }
                        }
                        s.detour = { x: vb.x, z: vb.z, need: need };
                        s.walkPath = pathRoute(s.x, s.z, vb.x, vb.z);
                        s.pause = 1;
                    } else if (need && !s.grumbled) {
                        s.grumbled = true;
                        golferThink(s, 'Nowhere to grab a bite out here', -7);
                    }
                } else {
                    if (s.fishAt && Math.hypot(s.x - s.fishAt.x,
                        s.z - s.fishAt.z) < 30) {
                        // Ball went in here somewhere — peer into the water
                        s.fishAt = null;
                        s.pause = 1.8; // expiry re-strikes: the penalty drop
                        golferThink(s, 'There goes another ball...', -3);
                    }
                    s.tx = nxt.x;
                    s.tz = nxt.z;
                    const rdx = nxt.x - s.x, rdz = nxt.z - s.z;
                    const rd = Math.sqrt(rdx * rdx + rdz * rdz);
                    if (rd < 2.5) {
                        s.ptIdx++;
                        s.pause = 3;
                        s.strokes = (s.strokes || 0) + 1; // playing the next shot
                        // Occasional duff: an extra recovery stroke keeps
                        // scores varied — and harder holes duff more often,
                        // so a hole's play record tracks its star rating
                        const duffP = Math.max(0.05,
                            0.12 + 0.07 * (s.diff || 2) - (s.recoverySkill || 2) * 0.02);
                        if (Math.random() < duffP) {
                            s.strokes++;
                            s.pause += 2;
                            golferThink(s, 'My ball found trouble', -6);
                        } else if (Math.random() < 0.1) {
                            // Varied musings — sometimes complimenting decor
                            // they can actually see on this course
                            const POOL = ['I love coming to play golf',
                                'What a gorgeous day out here',
                                'This course keeps getting better',
                                'Best little resort on the coast',
                                'I should bring my cousin next time'];
                            const NICE = { windmill: 'That windmill is charming',
                                lighthouse: 'Love that lighthouse',
                                statue: 'Classy statue by the path',
                                gazebo: 'The gazebo is a lovely touch',
                                clubhouse: 'What a grand clubhouse',
                                grandstand: 'Big-event energy today',
                                arch: 'Grand entrance, this place' };
                            let line = POOL[(Math.random() * POOL.length) | 0];
                            if (hole.decor && hole.decor.length && Math.random() < 0.5) {
                                const d2 = hole.decor[(Math.random() * hole.decor.length) | 0];
                                if (NICE[d2.t]) line = NICE[d2.t];
                            }
                            golferThink(s, line, 8);
                        }
                    } else {
                        // Walk toward the next point, but sidestep water:
                        // slide perpendicular along the shore instead of
                        // wading straight through a hazard
                        let mx = (rdx / rd) * s.speed * dt;
                        let mz = (rdz / rd) * s.speed * dt;
                        const tc = Math.floor((s.x + mx * 8) / CELL);
                        const tr = Math.floor((s.z + mz * 8) / CELL);
                        if (hole.grid[tr] && hole.grid[tr][tc] === T.WATER) {
                            const px2 = -rdz / rd, pz2 = rdx / rd;
                            for (let side = 1; side >= -1; side -= 2) {
                                const oc = Math.floor((s.x + px2 * side * CELL) / CELL);
                                const orr = Math.floor((s.z + pz2 * side * CELL) / CELL);
                                if (hole.grid[orr] && hole.grid[orr][oc] !== T.WATER) {
                                    mx = px2 * side * s.speed * dt;
                                    mz = pz2 * side * s.speed * dt;
                                    break;
                                }
                            }
                        }
                        s.x += mx;
                        s.z += mz;
                    }
                }
            }
            }
        } else if (s.pause > 0) {
            s.pause -= dt; // resting at a bench/gazebo
        } else if (d < 3) {
            if (s.arriveSit) {
                // Reached the rest spot: linger a while
                s.pause = 3.5 + (i % 3) * 1.5;
                s.arriveSit = false;
            } else {
                const h = Math.floor(t * 7 + i * 131);
                // In the rain, nearly everyone makes for a gazebo or kiosk
                if (npcSocialSpots.length && rainEnvNow > 0.4 && h % 5 !== 0) {
                    const sp2 = npcSocialSpots[(i * 17 + h) % npcSocialSpots.length];
                    s.tx = sp2.x;
                    s.tz = sp2.z;
                    s.arriveSit = true;
                } else if (npcSocialSpots.length && h % 4 === 0) {
                    // Detour to a bench or gazebo for a rest
                    const sp = npcSocialSpots[(i * 31 + h) % npcSocialSpots.length];
                    s.tx = sp.x;
                    s.tz = sp.z;
                    s.arriveSit = true;
                } else if (window.__tourney && hole.holes && hole.holes.length
                    && (i % 3) !== 0) {
                    // Tournament gallery: grandstands fill first (half the
                    // crowd packs the stands when any are built), the rest
                    // ring a pin like walking spectators
                    if (npcStandSpots.length && i % 2 === 0) {
                        const st3 = npcStandSpots[(i * 7 + (h >> 5)) % npcStandSpots.length];
                        s.tx = st3.x + ((i * 13) % 5 - 2) * 6;
                        s.tz = st3.z + 10 + ((i * 7) % 3) * 5;
                        s.arriveSit = true;
                    } else {
                    const rec = hole.holes[(i * 13 + (h >> 4)) % hole.holes.length];
                    const ang = i * 2.4 + (h % 8) * 0.35;
                    const rad = CELL * (1.6 + (i % 4) * 0.45);
                    s.tx = (rec.pin.x + 0.5) * CELL + Math.cos(ang) * rad;
                    s.tz = (rec.pin.y + 0.5) * CELL + Math.sin(ang) * rad;
                    s.arriveSit = true;
                    }
                } else {
                    // Pick a new stroll target on the path network
                    const next = npcPathCells[h % npcPathCells.length];
                    s.tx = (next.c + 0.5) * CELL;
                    s.tz = (next.r + 0.5) * CELL;
                }
            }
        } else {
            // Strollers skirt ponds too (bench/gazebo detours cut
            // across open ground between path cells)
            walkStepAvoid(hole, s, s.tx, s.tz, dt);
        }
        const gy = (hole && hole.heights)
            ? ((hole.heights[Math.floor(s.z / CELL)] || [])[Math.floor(s.x / CELL)] || 0) : 0;
        const still = s.idle || s.pause > 0;
        let bob = still ? Math.sin(t * 2.2 + s.phase) * 0.3
                        : Math.sin(t * 9 + s.phase) * 0.7;
        // Tournament crowd wave: settled spectators do the wave — a
        // crest travels through the gallery by spatial phase
        if (window.__tourney && !s.route && !s.idle && s.pause > 0) {
            bob = Math.max(0, Math.sin(t * 2.4 - (s.x + s.z) * 0.015)) * 3.4;
        }
        // Holed out: celebratory hops at the pin before the walk back
        if (s.route && s.pause > 0 && s.ptIdx === s.route.length - 1) {
            bob = Math.abs(Math.sin(t * 8 + s.phase)) * 4;
        }
        // Post-round beat on the green: the score decides the body
        // language — birdies leap, pars hop politely, doubles just stand
        // there staring at the card
        if (s.returning && s.pause > 0 && s.celeb != null) {
            bob = s.celeb <= -1 ? Math.abs(Math.sin(t * 11 + s.phase)) * 7.5
                : s.celeb >= 2 ? Math.sin(t * 1.2 + s.phase) * 0.15
                : Math.abs(Math.sin(t * 7 + s.phase)) * 2.5;
        }
        // Mid-tantrum: furious stomping hops, twice the celebration rate
        if (s.freakout > 0) {
            s.freakout -= dt;
            bob = Math.abs(Math.sin(t * 14 + s.phase)) * 6;
        }
        // Greeting: quick double-hop facing the camera when inspected
        if (s.greet > 0) {
            s.greet -= dt;
            bob = Math.abs(Math.sin(t * 10 + s.phase)) * 3.5;
            if (typeof camera3d !== 'undefined' && camera3d) {
                s.dispYaw = Math.atan2(camera3d.position.x - s.x,
                                       camera3d.position.z - s.z);
            }
        }
        // Smoothed heading: lerp toward the walk direction (with wrap)
        // so waypoint turns read as turns, not teleport snaps
        let yawT = s.idle ? Math.sin(t * 0.7 + s.phase) * 0.6 + s.phase
                          : Math.atan2(s.tx - s.x, s.tz - s.z);
        // Waiting to hit: square up toward the next shot target so the
        // launched ball flies the way the golfer is facing
        if (s.route && s.pause > 0 && s.ptIdx < s.route.length - 1
            && !s.returning && !s.leaving) {
            const nsp = s.route[s.ptIdx + 1];
            yawT = Math.atan2(nsp.x - s.x, nsp.z - s.z);
        }
        // Settled spectators track the nearest ball in flight — the
        // grandstand turns its heads as one when a drive sails past
        if (!s.route && !s.idle && s.pause > 0 && npcFlights.length) {
            let bfx = 0, bfz = 0, bfd = 300 * 300, bfOk = false;
            for (const f2 of npcFlights) {
                const fdx = f2.spr.position.x - s.x;
                const fdz = f2.spr.position.z - s.z;
                const fd2 = fdx * fdx + fdz * fdz;
                if (fd2 < bfd) {
                    bfd = fd2; bfx = f2.spr.position.x;
                    bfz = f2.spr.position.z; bfOk = true;
                }
            }
            if (bfOk) yawT = Math.atan2(bfx - s.x, bfz - s.z);
        }
        if (s.dispYaw == null) s.dispYaw = yawT;
        let yawD = yawT - s.dispYaw;
        while (yawD > Math.PI) yawD -= Math.PI * 2;
        while (yawD < -Math.PI) yawD += Math.PI * 2;
        s.dispYaw += yawD * Math.min(1, dt * 7);
        const yaw = s.dispYaw;
        dummy.position.set(s.x, gy + 7.5 + bob, s.z);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        npcBodyInst.setMatrixAt(i, dummy.matrix);
        dummy.position.y = gy + 18.5 + bob;
        dummy.updateMatrix();
        npcHeadInst.setMatrixAt(i, dummy.matrix);
        if (npcModelInsts) {
            dummy.position.set(s.x, gy + bob, s.z);
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(golferModelScale, golferModelScale, golferModelScale);
            dummy.updateMatrix();
            for (const im of npcModelInsts) im.setMatrixAt(i, dummy.matrix);
            dummy.scale.set(1, 1, 1);
        }
        if (npcHatInst && i < npcWalkerCount) {
            // Every other walker wears a hat; the rest hide theirs
            if (i % 2 === 0) {
                dummy.position.y = gy + 22 + bob;
                dummy.scale.set(1, 1, 1);
            } else {
                dummy.position.set(0, -500, 0);
                dummy.scale.set(0.001, 0.001, 0.001);
            }
            dummy.updateMatrix();
            npcHatInst.setMatrixAt(i, dummy.matrix);
            dummy.position.set(s.x, gy + 18.5 + bob, s.z);
            dummy.scale.set(1, 1, 1);
        }
        if (npcBagInst) {
            const showBag = s.route && !s.returning && !s.leaving
                && s.pause > 0 && s.name;
            if (showBag) {
                dummy.position.set(s.x + Math.cos(yaw + 2.2) * 7,
                    gy + 5.2, s.z - Math.sin(yaw + 2.2) * 7);
                dummy.rotation.set(0.22, yaw, 0);
                dummy.scale.set(1, 1, 1);
            } else {
                dummy.position.set(0, -500, 0);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(0.001, 0.001, 0.001);
            }
            dummy.updateMatrix();
            npcBagInst.setMatrixAt(i, dummy.matrix);
            dummy.position.set(s.x, gy + 7.5 + bob, s.z);
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(1, 1, 1);
        }
        if (npcUmbrellaInst) {
            // Strollers always shelter; playing golfers only between
            // shots (walking), never mid-swing at a pause
            const wantsUmb = rainEnvNow > 0.4
                && (i < npcWalkerCount || (s.route && s.pause <= 0));
            if (wantsUmb) {
                dummy.position.y = gy + 25 + bob;
                dummy.scale.set(1, 1, 1);
            } else {
                dummy.position.set(0, -500, 0);
                dummy.scale.set(0.001, 0.001, 0.001);
            }
            dummy.updateMatrix();
            npcUmbrellaInst.setMatrixAt(i, dummy.matrix);
            dummy.scale.set(1, 1, 1);
        }
        if (s.idle && npcClubInst) {
            let ang = 0.55;
            if (s.arcIdx != null && arcCurves.length) {
                // Synced to the shot arc: strike lands exactly when the
                // arc ball launches from this tee (cycle wrap = launch)
                const u = ((t * 0.45 + s.arcIdx * 0.37) % 1.6) / 1.6;
                const w = (((u - 0.96) % 1) + 1) % 1; // time since strike
                if (u >= 0.86 && u < 0.96) ang = 0.55 - ((u - 0.86) / 0.10) * 2.9;
                else if (w < 0.07) ang = -2.35 + (w / 0.07) * 4.5;
                else if (w < 0.22) ang = 2.15 - ((w - 0.07) / 0.15) * 1.6;
            } else {
                // Free-running swing loop: long address, quick backswing,
                // snap through, settle
                const cyc = (t * 0.5 + s.phase) % 4;
                if (cyc > 3.0 && cyc < 3.35) ang = 0.55 - ((cyc - 3.0) / 0.35) * 2.9;
                else if (cyc >= 3.35 && cyc < 3.5) ang = -2.35 + ((cyc - 3.35) / 0.15) * 4.5;
                else if (cyc >= 3.5 && cyc < 3.95) ang = 2.15 - ((cyc - 3.5) / 0.45) * 1.6;
            }
            dummy.position.set(s.x + Math.cos(yaw) * 4.2, gy + 12.5 + bob, s.z - Math.sin(yaw) * 4.2);
            dummy.rotation.set(0, yaw, ang);
            dummy.updateMatrix();
            npcClubInst.setMatrixAt(i - npcWalkerCount, dummy.matrix);
        }
    }
    npcBodyInst.instanceMatrix.needsUpdate = true;
    npcHeadInst.instanceMatrix.needsUpdate = true;
    if (npcModelInsts) {
        for (const im of npcModelInsts) im.instanceMatrix.needsUpdate = true;
        if (npcHatInst) npcHatInst.visible = false;   // model wears its own cap
        if (npcClubInst) npcClubInst.visible = false; // model holds its own club
    }
    if (npcClubInst) npcClubInst.instanceMatrix.needsUpdate = true;
    if (npcBagInst) npcBagInst.instanceMatrix.needsUpdate = true;
    if (npcUmbrellaInst) npcUmbrellaInst.instanceMatrix.needsUpdate = true;
    if (npcHatInst) npcHatInst.instanceMatrix.needsUpdate = true;
}

// ---- Pond fountains — animated jets on the largest water bodies ----
let fountainInst = null, splashInst = null;
let fountainSpots = [];
const FOUNTAIN_DROPS = 16;
const SPLASH_TMP_COLOR = new THREE.Color();

function setupFountains(hole) {
    fountainInst = null;
    splashInst = null;
    fountainSpots = [];
    // Flood-fill water into blobs, crown the two largest with a fountain
    const seen = [];
    for (let r = 0; r < hole.rows; r++) seen.push(new Array(hole.cols).fill(false));
    const blobs = [];
    for (let r = 0; r < hole.rows; r++) {
        for (let c = 0; c < hole.cols; c++) {
            if (hole.grid[r][c] !== T.WATER || seen[r][c]) continue;
            const cells = [];
            const stack = [{ c: c, r: r }];
            seen[r][c] = true;
            while (stack.length) {
                const cur = stack.pop();
                cells.push(cur);
                const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                for (let k = 0; k < 4; k++) {
                    const nc = cur.c + nb[k][0], nr = cur.r + nb[k][1];
                    if (nr >= 0 && nr < hole.rows && nc >= 0 && nc < hole.cols
                        && hole.grid[nr][nc] === T.WATER && !seen[nr][nc]) {
                        seen[nr][nc] = true;
                        stack.push({ c: nc, r: nr });
                    }
                }
            }
            blobs.push(cells);
        }
    }
    blobs.sort((a, b) => b.length - a.length);
    for (const cells of blobs.slice(0, 2)) {
        if (cells.length < 16) continue;
        let sc = 0, sr = 0;
        for (const p of cells) { sc += p.c; sr += p.r; }
        const cc = sc / cells.length, cr = sr / cells.length;
        let best = cells[0], bd = Infinity;
        for (const p of cells) {
            const d = (p.c - cc) * (p.c - cc) + (p.r - cr) * (p.r - cr);
            if (d < bd) { bd = d; best = p; }
        }
        fountainSpots.push({ x: (best.c + 0.5) * CELL, z: (best.r + 0.5) * CELL });
    }
    if (!fountainSpots.length) return;
    // Tiered stone centerpiece at each fountain spot, base just under water
    if (worldAssets && worldAssets.fountainstatue) {
        const model = worldAssets.fountainstatue;
        for (const spot of fountainSpots) {
            const grp = new THREE.Group();
            for (const part of model.parts) {
                const mesh = new THREE.Mesh(part.geometry, part.material);
                mesh.castShadow = true;
                grp.add(mesh);
            }
            grp.scale.setScalar(model.scale);
            grp.position.set(spot.x, -3.2, spot.z);
            terrainGroup.add(grp);
        }
    }
    const geo = new THREE.SphereGeometry(2.0, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xdff4fb, transparent: true, opacity: 0.85 });
    mat.toneMapped = false;
    fountainInst = new THREE.InstancedMesh(geo, mat, fountainSpots.length * FOUNTAIN_DROPS);
    fountainInst.renderOrder = 3;
    terrainGroup.add(fountainInst);
    // Splash rings expanding where the droplets land
    const ringGeo = new THREE.RingGeometry(0.8, 1.15, 14);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xdff4fb, transparent: true, opacity: 0.45,
        depthWrite: false, side: THREE.DoubleSide
    });
    ringMat.toneMapped = false;
    splashInst = new THREE.InstancedMesh(ringGeo, ringMat, fountainSpots.length * 3);
    splashInst.renderOrder = 3;
    terrainGroup.add(splashInst);
}

// ---- Red hazard stakes ringing the water hazards ----
let stakeInst = null;

function setupHazardStakes(hole) {
    stakeInst = null;
    const spots = [];
    for (let r = 1; r < hole.rows - 1 && spots.length < 90; r++) {
        for (let c = 1; c < hole.cols - 1 && spots.length < 90; c++) {
            if (hole.grid[r][c] !== T.WATER) continue;
            if ((c * 13 + r * 29) % 3 !== 0) continue;
            const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (let k = 0; k < 4; k++) {
                const dc = nb[k][0], dr = nb[k][1];
                const nt = hole.grid[r + dr][c + dc];
                if (nt !== T.WATER && nt !== T.OOB) {
                    spots.push({
                        x: (c + 0.5 + dc * 0.65) * CELL,
                        z: (r + 0.5 + dr * 0.65) * CELL,
                        c: c + dc, r: r + dr
                    });
                    break;
                }
            }
        }
    }
    if (!spots.length) return;
    const geo = new THREE.CylinderGeometry(0.55, 0.55, 12, 5);
    geo.translate(0, 6, 0);
    const mat = new THREE.MeshStandardMaterial({ color: linC(0xd63b2f), roughness: 0.6 });
    stakeInst = new THREE.InstancedMesh(geo, mat, spots.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < spots.length; i++) {
        const sp = spots[i];
        const gy = (hole.heights && hole.heights[sp.r]) ? (hole.heights[sp.r][sp.c] || 0) : 0;
        dummy.position.set(sp.x, gy, sp.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        stakeInst.setMatrixAt(i, dummy.matrix);
    }
    stakeInst.castShadow = true;
    terrainGroup.add(stakeInst);
}

// ---- Ocean buoys bobbing off the coastline ----
let buoyInst = null, buoySpots = [];

function setupBuoys(hole) {
    buoyInst = null;
    buoySpots = [];
    const worldW = hole.cols * CELL, worldH = hole.rows * CELL;
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + ((i * 37) % 10) / 20;
        buoySpots.push({
            x: worldW / 2 + Math.cos(a) * (worldW / 2 + 90 + (i * 53) % 180),
            z: worldH / 2 + Math.sin(a) * (worldH / 2 + 90 + (i * 91) % 180),
            phase: i * 1.7
        });
    }
    const geo = new THREE.CylinderGeometry(1.2, 9, 26, 6);
    const mat = new THREE.MeshStandardMaterial({ color: linC(0xd94f3d), roughness: 0.6 });
    buoyInst = new THREE.InstancedMesh(geo, mat, buoySpots.length);
    terrainGroup.add(buoyInst);
}

function updateBuoys3D() {
    if (!buoyInst || !buoySpots.length) return;
    const t = windClock.value;
    const dummy = sharedDummy3D;
    for (let i = 0; i < buoySpots.length; i++) {
        const s = buoySpots[i];
        dummy.position.set(s.x, -2.5 + 3.5 + Math.sin(t * 1.3 + s.phase) * 1.4, s.z);
        dummy.rotation.set(Math.sin(t * 0.9 + s.phase) * 0.14, 0,
                           Math.cos(t * 1.1 + s.phase) * 0.14);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        buoyInst.setMatrixAt(i, dummy.matrix);
    }
    buoyInst.instanceMatrix.needsUpdate = true;
}

// ---- Autumn leaves drifting down over the forests ----
let leafInst = null, leafStates = [];

function setupLeaves(hole) {
    leafInst = null;
    leafStates = [];
    // Biome ambience knobs (this runs on every terrain build):
    // links blows nearly twice as hard; autumn sheds leaves everywhere
    const biomeL = biomeOf(hole);
    windAmp.value = biomeL === 'links' ? 1.9 : 1;
    const leafMod = biomeL === 'autumn' ? 7 : 83;
    const spots = [];
    for (let r = 2; r < hole.rows - 2; r++) {
        for (let c = 2; c < hole.cols - 2; c++) {
            if (hole.grid[r][c] === T.TREE
                && ((((c * 40503) ^ (r * 88651)) >>> 0) % leafMod) === 0) {
                spots.push({ c: c, r: r });
            }
        }
    }
    const n = Math.min(biomeL === 'autumn' ? 44 : 16, spots.length);
    if (!n) return;
    const geo = new THREE.PlaneGeometry(2.4, 1.7);
    const mat = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide, transparent: true, opacity: 0.85
    });
    mat.toneMapped = false;
    leafInst = new THREE.InstancedMesh(geo, mat, n);
    const leafCols = [0xd8842f, 0xe0a63b, 0xb35c26, 0x76a83a];
    for (let i = 0; i < n; i++) {
        const sp = spots[Math.floor(i * spots.length / n)];
        leafStates.push({
            x: (sp.c + 0.5) * CELL, z: (sp.r + 0.5) * CELL, phase: i * 1.31
        });
        if (leafInst.setColorAt) {
            leafInst.setColorAt(i, new THREE.Color(leafCols[i % leafCols.length]).convertSRGBToLinear());
        }
    }
    if (leafInst.instanceColor) leafInst.instanceColor.needsUpdate = true;
    terrainGroup.add(leafInst);
}

function updateLeaves3D(hole) {
    if (!leafInst || !leafStates.length) return;
    const t = windClock.value;
    const dummy = sharedDummy3D;
    for (let i = 0; i < leafStates.length; i++) {
        const s = leafStates[i];
        // Each leaf loops a slow tumbling fall from canopy height,
        // drifting downwind (+x) with a lateral sway
        const cyc = (t * 0.14 + s.phase) % 1;
        const x = s.x + cyc * 55 + Math.sin(t * 1.7 + s.phase) * 6;
        const z = s.z + Math.sin(t * 0.9 + s.phase * 2) * 5;
        const gy = (hole && hole.heights)
            ? ((hole.heights[Math.floor(z / CELL)] || [])[Math.floor(x / CELL)] || 0) : 0;
        dummy.position.set(x, gy + 80 - cyc * 74, z);
        dummy.rotation.set(t * 2.1 + s.phase, s.phase * 3, t * 1.4 + s.phase * 2);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        leafInst.setMatrixAt(i, dummy.matrix);
    }
    leafInst.instanceMatrix.needsUpdate = true;
}

// ---- A sailboat slowly circling the island ----
let boatGroupRef = null;

function setupBoat(hole) {
    boatGroupRef = null;
    const grp = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(34, 8, 12),
        new THREE.MeshStandardMaterial({ color: linC(0x7a4b2c), roughness: 0.8 }));
    hull.position.y = 2;
    grp.add(hull);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 34, 5),
        new THREE.MeshStandardMaterial({ color: linC(0x5d4630), roughness: 0.8 }));
    mast.position.y = 22;
    grp.add(mast);
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 6, 0, 0, 36, 0, 16, 10, 0
    ], 3));
    sailGeo.computeVertexNormals();
    const sail = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({
        color: linC(0xf2efe6), side: THREE.DoubleSide, roughness: 0.9
    }));
    grp.add(sail);
    grp.scale.setScalar(2); // island-scale silhouette, not a rowboat
    terrainGroup.add(grp);
    boatGroupRef = grp;
}

function updateBoat3D(hole) {
    if (!boatGroupRef) return;
    const t = windClock.value;
    const w2 = hole.cols * CELL / 2, h2 = hole.rows * CELL / 2;
    const rad = Math.sqrt(w2 * w2 + h2 * h2) + 260;
    const a = t * 0.02;
    boatGroupRef.position.set(w2 + Math.cos(a) * rad,
                              -2.5 + Math.sin(t * 1.1) * 1.2,
                              h2 + Math.sin(a) * rad);
    boatGroupRef.rotation.set(Math.sin(t * 0.8) * 0.05, -a,
                              Math.sin(t * 1.3) * 0.06);
}

// ---- Build-mode grid overlay toggle ----
let buildGridRef = null;
function setBuildGridVisible(v) {
    if (buildGridRef) buildGridRef.visible = !!v;
}

// ---- Distant horizon scenery toggle (overworld only) ----
let distantGroupRef = null;
function setDistantSceneryVisible(v) {
    if (distantGroupRef) distantGroupRef.visible = !!v;
}

// ---- Fireflies: warm motes drifting over the rough after dark ----
let fireflyInst = null, fireflyStates = [], fireflyMatRef = null;

function setupFireflies(hole) {
    fireflyInst = null;
    fireflyStates = [];
    fireflyMatRef = null;
    const spots = [];
    for (let r = 2; r < hole.rows - 2; r++) {
        for (let c = 2; c < hole.cols - 2; c++) {
            const t = hole.grid[r][c];
            if ((t === T.ROUGH || t === T.TREE)
                && ((((c * 48611) ^ (r * 75503)) >>> 0) % 131) === 0) {
                spots.push({ c: c, r: r });
            }
        }
    }
    const n = Math.min(24, spots.length);
    if (!n) return;
    const geo = new THREE.SphereGeometry(1.1, 5, 4);
    const mat = new THREE.MeshBasicMaterial({
        color: 0xd8f26a, transparent: true, opacity: 0
    });
    mat.toneMapped = false;
    fireflyMatRef = mat;
    fireflyInst = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) {
        const sp = spots[Math.floor(i * spots.length / n)];
        fireflyStates.push({
            x: (sp.c + 0.5) * CELL, z: (sp.r + 0.5) * CELL,
            phase: i * 2.7, rad: 5 + (i % 4) * 3
        });
    }
    terrainGroup.add(fireflyInst);
}

function updateFireflies3D(hole) {
    if (!fireflyInst || !fireflyStates.length) return;
    if (fireflyMatRef && fireflyMatRef.opacity <= 0.01) return; // daytime: skip
    const t = windClock.value;
    const dummy = sharedDummy3D;
    for (let i = 0; i < fireflyStates.length; i++) {
        const s = fireflyStates[i];
        const a = t * 0.55 + s.phase;
        const x = s.x + Math.cos(a) * s.rad + Math.sin(a * 2.3) * 2;
        const z = s.z + Math.sin(a * 0.8) * s.rad;
        const gy = (hole && hole.heights)
            ? ((hole.heights[Math.floor(z / CELL)] || [])[Math.floor(x / CELL)] || 0) : 0;
        // Blink: each mote pulses scale on its own rhythm
        const blink = 0.4 + 0.6 * Math.max(0, Math.sin(t * 2.6 + s.phase * 3));
        dummy.position.set(x, gy + 6 + Math.sin(t * 1.4 + s.phase) * 2.5, z);
        dummy.scale.set(blink, blink, blink);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        fireflyInst.setMatrixAt(i, dummy.matrix);
    }
    fireflyInst.instanceMatrix.needsUpdate = true;
}

// ---- Path lamps: warm globes on posts along the walkways ----
// The head material brightens at night via updateDayNightTint.
let windowGlowMatRef = null; // building window light, night-driven
let windowGlowTex = null;

// Warm interior-light sprite hovering at a building's window line —
// invisible by day, faded in by the night pass alongside the lamps
function addWindowGlow(wx, wy, wz, scale) {
    if (!windowGlowTex) {
        const cv = document.createElement('canvas');
        cv.width = 64; cv.height = 64;
        const g = cv.getContext('2d');
        const rg = g.createRadialGradient(32, 32, 2, 32, 32, 30);
        rg.addColorStop(0, 'rgba(255,214,140,0.95)');
        rg.addColorStop(0.45, 'rgba(255,190,100,0.5)');
        rg.addColorStop(1, 'rgba(255,170,80,0)');
        g.fillStyle = rg;
        g.fillRect(0, 0, 64, 64);
        windowGlowTex = new THREE.CanvasTexture(cv);
    }
    if (!windowGlowMatRef) {
        windowGlowMatRef = new THREE.SpriteMaterial({
            map: windowGlowTex, transparent: true, opacity: 0,
            depthWrite: false
        });
        windowGlowMatRef.toneMapped = false;
    }
    const sp = new THREE.Sprite(windowGlowMatRef);
    sp.position.set(wx, wy, wz);
    sp.scale.set(scale, scale * 0.7, 1);
    sp.renderOrder = 4;
    terrainGroup.add(sp);
}

let lampHeadMatRef = null;
let lampPoolMatRef = null;  // warm light pools under lamps (night only)
let moonSprite = null;      // crescent riding opposite the sun
let sunGlowSprite = null;   // warm horizon glow at dawn and dusk

function setupPathLamps(hole) {
    lampHeadMatRef = null;
    lampPoolMatRef = null;
    const spots = [];
    for (let r = 1; r < hole.rows - 1; r++) {
        for (let c = 1; c < hole.cols - 1; c++) {
            if (hole.grid[r][c] !== T.PATH) continue;
            if ((c * 7 + r * 13) % 9 !== 0) continue;
            spots.push({ c: c, r: r });
            if (spots.length >= 60) break;
        }
        if (spots.length >= 60) break;
    }
    if (!spots.length) return;
    const poleGeo = new THREE.CylinderGeometry(0.7, 0.9, 24, 6);
    poleGeo.translate(0, 12, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: linC(0x3c4148), roughness: 0.6 });
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
    poleInst.castShadow = true;
    const headGeo = new THREE.SphereGeometry(2.6, 8, 6);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xbdb49e });
    headMat.toneMapped = false;
    lampHeadMatRef = headMat;
    const headInst = new THREE.InstancedMesh(headGeo, headMat, spots.length);
    const dummy = sharedDummy3D;
    for (let i = 0; i < spots.length; i++) {
        const sp = spots[i];
        // Offset toward a cell corner so posts hug the walkway edge
        const ox = ((sp.c * 31 + sp.r) % 2) ? 0.82 : 0.18;
        const x = (sp.c + ox) * CELL, z = (sp.r + 0.15) * CELL;
        const gy = (hole.heights && hole.heights[sp.r]) ? (hole.heights[sp.r][sp.c] || 0) : 0;
        dummy.position.set(x, gy, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poleInst.setMatrixAt(i, dummy.matrix);
        dummy.position.y = gy + 25.5;
        dummy.updateMatrix();
        headInst.setMatrixAt(i, dummy.matrix);
    }
    terrainGroup.add(poleInst);
    terrainGroup.add(headInst);
    // Warm light pools on the walkway, faded in after dark
    const pc = document.createElement('canvas');
    pc.width = pc.height = 64;
    const pg = pc.getContext('2d');
    const pgrad = pg.createRadialGradient(32, 32, 4, 32, 32, 31);
    pgrad.addColorStop(0, 'rgba(255,214,140,0.65)');
    pgrad.addColorStop(0.6, 'rgba(255,190,110,0.25)');
    pgrad.addColorStop(1, 'rgba(255,180,90,0)');
    pg.fillStyle = pgrad;
    pg.fillRect(0, 0, 64, 64);
    const ptex = new THREE.CanvasTexture(pc);
    perBuildTextures.push(ptex);
    const pmat = new THREE.MeshBasicMaterial({
        map: ptex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    pmat.toneMapped = false;
    lampPoolMatRef = pmat;
    const poolGeo = new THREE.PlaneGeometry(CELL * 2.4, CELL * 2.4);
    poolGeo.rotateX(-Math.PI / 2);
    const poolInst = new THREE.InstancedMesh(poolGeo, pmat, spots.length);
    for (let i = 0; i < spots.length; i++) {
        const sp = spots[i];
        const ox = ((sp.c * 31 + sp.r) % 2) ? 0.82 : 0.18;
        const gy = (hole.heights && hole.heights[sp.r]) ? (hole.heights[sp.r][sp.c] || 0) : 0;
        dummy.position.set((sp.c + ox) * CELL, gy + 0.9, (sp.r + 0.15) * CELL);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poolInst.setMatrixAt(i, dummy.matrix);
    }
    poolInst.renderOrder = 2;
    terrainGroup.add(poolInst);
}

// ---- Passing rain showers ----
// Deterministic episodes from the wind clock (two slow sines beating);
// streaks live in scene3d so terrain rebuilds don't kill them, and they
// respawn around the camera pivot so rain always falls in view.
let rainInst = null, rainDrops = [], rainEnvNow = 0;
let rainPrevEnv = 0;
let rainbowSprite = null, rainbowUntil = 0;
const RAIN_COUNT = 240;

function updateRain3D(dt) {
    const t = windClock.value;
    const w = Math.sin(t * 0.011) + Math.sin(t * 0.0073);
    const target = w > 1.15 ? 1 : 0;
    rainEnvNow += (target - rainEnvNow) * Math.min(1, dt * 0.3);
    // A clearing shower leaves a rainbow (daytime only)
    if (rainPrevEnv > 0.3 && rainEnvNow <= 0.3) {
        const hh = (typeof resort !== 'undefined' && resort)
            ? ((((resort.worldClock || 0) / 60) % 24) + 24) % 24 : 12;
        if (hh > 7 && hh < 18) rainbowUntil = performance.now() + 75000;
    }
    rainPrevEnv = rainEnvNow;
    if (rainEnvNow < 0.02) {
        if (rainInst) rainInst.visible = false;
        return;
    }
    if (!rainInst && typeof scene3d !== 'undefined' && scene3d) {
        const geo = new THREE.BoxGeometry(0.5, 15, 0.5);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xbcd8ea, transparent: true, opacity: 0.3, depthWrite: false
        });
        mat.toneMapped = false;
        rainInst = new THREE.InstancedMesh(geo, mat, RAIN_COUNT);
        rainInst.renderOrder = 5;
        scene3d.add(rainInst);
        for (let i = 0; i < RAIN_COUNT; i++) {
            rainDrops.push({ x: 0, y: (i * 97) % 240, z: 0, spd: 340 + (i * 37) % 120, live: false });
        }
    }
    if (!rainInst) return;
    rainInst.visible = true;
    rainInst.material.opacity = 0.3 * rainEnvNow;
    const px = (typeof cam3dPivotX !== 'undefined') ? cam3dPivotX : 1920;
    const pz = (typeof cam3dPivotZ !== 'undefined') ? cam3dPivotZ : 1280;
    const dummy = sharedDummy3D;
    for (let i = 0; i < RAIN_COUNT; i++) {
        const d = rainDrops[i];
        if (!d.live) {
            d.x = px + ((i * 131) % 1400) - 700 + Math.sin(t + i) * 40;
            d.z = pz + ((i * 211) % 1400) - 700;
            d.live = true;
        }
        d.y -= d.spd * dt;
        if (d.y < 0) {
            d.y += 240;
            d.x = px + ((i * 131 + Math.floor(t * 13)) % 1400) - 700;
            d.z = pz + ((i * 211 + Math.floor(t * 7)) % 1400) - 700;
        }
        dummy.position.set(d.x, d.y, d.z);
        dummy.rotation.set(0, 0, 0.06);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        rainInst.setMatrixAt(i, dummy.matrix);
    }
    rainInst.instanceMatrix.needsUpdate = true;
}

// ---- Day/night lighting cycle driven by the resort world clock ----
// Never goes truly dark: night floors keep the resort readable, the cycle
// reads through warm dawns/dusks, sweeping shadows, and a dimmed sky.
let hemiLightRef = null, dirLightRef = null, skyMatRef = null, oceanMatRef = null;
let starMatRef = null;
let beaconGroups = [], beaconMats = [];

// Rotating lighthouse beacon: two opposed light cones from the lantern
// room, faded in after dark by the day/night pass. One per lighthouse.
function addLighthouseBeacon(x, y, z) {
    const beamGeo = new THREE.ConeGeometry(22, 300, 8, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(150, 0, 0); // apex at lantern, base outward
    const beamMat = new THREE.MeshBasicMaterial({
        color: 0xfff2c0, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide
    });
    beamMat.toneMapped = false;
    const grp = new THREE.Group();
    const b1 = new THREE.Mesh(beamGeo, beamMat);
    const b2 = new THREE.Mesh(beamGeo, beamMat);
    b2.rotation.y = Math.PI;
    grp.add(b1);
    grp.add(b2);
    grp.position.set(x, y, z);
    terrainGroup.add(grp);
    beaconGroups.push(grp);
    beaconMats.push(beamMat);
}
const OCEAN_BASE_COLOR = new THREE.Color(0x1f7fb4).convertSRGBToLinear();

function updateDayNightTint(minutes) {
    if (!dirLightRef || !hemiLightRef) return;
    const h = (((minutes / 60) % 24) + 24) % 24;
    // 1 at 13:00, 0 at 01:00 — then remapped so the cosine's long dusk
    // compresses: proper night lands by ~21:00 (reference look) instead
    // of drifting toward 1 AM, while midday is untouched
    const dayW0 = 0.5 + 0.5 * Math.cos((h - 13) / 24 * Math.PI * 2);
    const dayW = Math.max(0, Math.min(1, (dayW0 - 0.2) / 0.7));
    // Golden-hour bumps near 07:00 and 19:00
    const gold = Math.exp(-Math.pow(h - 7, 2) / 2) + Math.exp(-Math.pow(h - 19, 2) / 2);
    dirLightRef.intensity = (0.55 + 0.75 * dayW) * (1 - rainEnvNow * 0.45);
    hemiLightRef.intensity = (0.5 + 0.4 * dayW) * (1 - rainEnvNow * 0.2);
    // Lightning: a double-flicker of the whole sky when thunder rolls
    if (window.__lightningAt) {
        const dtL = performance.now() - window.__lightningAt;
        if (dtL < 420) {
            const fl = (dtL < 90 || (dtL > 180 && dtL < 260)) ? 1 : 0;
            dirLightRef.intensity += fl * 1.3;
            hemiLightRef.intensity += fl * 0.9;
        } else {
            window.__lightningAt = null;
        }
    }
    // Sun color: day white -> gold at the rims -> cool moonlight
    const day = [1.0, 0.955, 0.88], gd = [1.0, 0.72, 0.45], night = [0.66, 0.74, 1.0];
    const m = (a, b, k) => a + (b - a) * k;
    let rr = m(night[0], day[0], dayW), gg = m(night[1], day[1], dayW), bb = m(night[2], day[2], dayW);
    const gk = Math.min(1, gold);
    rr = m(rr, gd[0], gk * 0.7); gg = m(gg, gd[1], gk * 0.7); bb = m(bb, gd[2], gk * 0.7);
    dirLightRef.color.setRGB(rr, gg, bb);
    // Sun sweeps an arc over the course; low at the rims, high at noon
    const az = (h - 13) / 24 * Math.PI * 2;
    dirLightRef.position.set(1920 + Math.sin(az) * 2000,
                             800 + 1500 * dayW,
                             1280 + Math.cos(az) * 2000);
    // Sky dome + ocean dim with the light (material color multiplies
    // the authored vertex/base colors)
    const dim = (0.34 + 0.66 * dayW) * (1 - rainEnvNow * 0.3);
    if (skyMatRef) skyMatRef.color.setRGB(dim * 0.8, dim * 0.88, dim);
    if (oceanMatRef) oceanMatRef.color.copy(OCEAN_BASE_COLOR).multiplyScalar(0.35 + 0.65 * dayW);
    // Stars pierce through once the sky is properly dark
    if (starMatRef) starMatRef.opacity = Math.max(0, 1 - dayW * 3) * (1 - rainEnvNow);
    // Rainbow: spectral arc over the island while the air clears
    if (!rainbowSprite && typeof scene3d !== 'undefined' && scene3d) {
        const rc = document.createElement('canvas');
        rc.width = 256; rc.height = 128;
        const rg = rc.getContext('2d');
        const bands = ['#ff5a5a', '#ffb54a', '#ffe95a', '#6ade6a', '#5ab8ff', '#9a6aff'];
        for (let i = 0; i < bands.length; i++) {
            rg.strokeStyle = bands[i];
            rg.globalAlpha = 0.55;
            rg.lineWidth = 5;
            rg.beginPath();
            rg.arc(128, 128, 112 - i * 6, Math.PI, 0);
            rg.stroke();
        }
        const rtex = new THREE.CanvasTexture(rc);
        const rmat = new THREE.SpriteMaterial({
            map: rtex, transparent: true, opacity: 0, depthWrite: false
        });
        rmat.toneMapped = false;
        rainbowSprite = new THREE.Sprite(rmat);
        rainbowSprite.scale.set(2400, 1200, 1);
        rainbowSprite.position.set(1920, 620, -900);
        scene3d.add(rainbowSprite);
    }
    if (rainbowSprite) {
        const left = rainbowUntil - performance.now();
        const rbK = Math.max(0, Math.min(1, left / 15000));
        rainbowSprite.material.opacity = 0.5 * Math.min(1, rbK) * dayW;
    }
    // Golden-hour horizon glow where the sun sits at dawn/dusk
    if (!sunGlowSprite && typeof scene3d !== 'undefined' && scene3d) {
        const sc = document.createElement('canvas');
        sc.width = sc.height = 128;
        const sg = sc.getContext('2d');
        const sgrad = sg.createRadialGradient(64, 64, 4, 64, 64, 62);
        sgrad.addColorStop(0, 'rgba(255,214,140,0.95)');
        sgrad.addColorStop(0.4, 'rgba(255,170,80,0.45)');
        sgrad.addColorStop(1, 'rgba(255,140,60,0)');
        sg.fillStyle = sgrad;
        sg.fillRect(0, 0, 128, 128);
        const stex = new THREE.CanvasTexture(sc);
        const smat = new THREE.SpriteMaterial({
            map: stex, transparent: true, opacity: 0, depthWrite: false
        });
        smat.toneMapped = false;
        sunGlowSprite = new THREE.Sprite(smat);
        sunGlowSprite.scale.set(900, 900, 1);
        scene3d.add(sunGlowSprite);
    }
    if (sunGlowSprite) {
        sunGlowSprite.material.opacity = Math.min(1, gold) * 0.75 * (1 - rainEnvNow * 0.6);
        sunGlowSprite.position.set(1920 + Math.sin(az) * 2700, 260, 1280 + Math.cos(az) * 2700);
    }
    // Moon: a soft crescent riding opposite the sun, fading in at dusk
    if (!moonSprite && typeof scene3d !== 'undefined' && scene3d) {
        const mc = document.createElement('canvas');
        mc.width = mc.height = 128;
        const mg = mc.getContext('2d');
        const grad = mg.createRadialGradient(64, 64, 20, 64, 64, 62);
        grad.addColorStop(0, 'rgba(235,240,255,1)');
        grad.addColorStop(0.75, 'rgba(215,225,250,0.9)');
        grad.addColorStop(1, 'rgba(200,215,245,0)');
        mg.fillStyle = grad;
        mg.beginPath(); mg.arc(64, 64, 62, 0, Math.PI * 2); mg.fill();
        mg.globalCompositeOperation = 'destination-out';
        mg.beginPath(); mg.arc(92, 44, 48, 0, Math.PI * 2); mg.fill();
        const mtex = new THREE.CanvasTexture(mc);
        const mmat = new THREE.SpriteMaterial({
            map: mtex, transparent: true, opacity: 0, depthWrite: false
        });
        mmat.toneMapped = false;
        moonSprite = new THREE.Sprite(mmat);
        moonSprite.scale.set(300, 300, 1);
        scene3d.add(moonSprite);
    }
    if (moonSprite) {
        moonSprite.material.opacity = Math.max(0, 1 - dayW * 2.2) * (1 - rainEnvNow * 0.7);
        moonSprite.position.set(1920 - Math.sin(az2Moon()) * 2600,
            700 + 1100 * (1 - dayW), 1280 - Math.cos(az2Moon()) * 2600);
    }
    function az2Moon() { return (h - 13) / 24 * Math.PI * 2; }
    // Night course dressing: tee signs brighten, greens glow after dark
    const darkK = Math.max(0, 1 - dayW * 1.6);
    for (const sm of teeSignMats) sm.opacity = 0.55 + 0.45 * darkK;
    for (const gm of greenGlowMats) gm.opacity = darkK * darkK * 0.5;
    if (lampPoolMatRef) lampPoolMatRef.opacity = darkK * darkK * 0.85;
    if (windowGlowMatRef) windowGlowMatRef.opacity = darkK * darkK * 0.9;
    // Lamp globes: dull stone by day, warm glow after dark
    if (lampHeadMatRef) {
        const nw = 1 - dayW;
        lampHeadMatRef.color.setRGB(m(0.74, 1.0, nw), m(0.71, 0.85, nw), m(0.62, 0.5, nw));
    }
    if (waterMat) waterMat.uniforms.uNight.value = 0.35 + 0.65 * dayW;
    // Wet ground: turf darkens while a shower passes
    if (terrainMatRef) terrainMatRef.color.setScalar(1 - rainEnvNow * 0.18);
    // Dew sheen: the sprinkler-hour ground catches the low sun until it
    // burns off mid-morning; rain re-wets the turf at any hour
    if (terrainMatRef) {
        const hrT = ((minutes / 60) % 24 + 24) % 24;
        const dew = Math.max(0, 1 - Math.abs(hrT - 6.5) / 1.5);
        terrainMatRef.roughness = 0.95 - 0.23 * Math.max(dew, rainEnvNow);
    }
    // Fireflies fade in after dark, invisible by day
    if (fireflyMatRef) fireflyMatRef.opacity = Math.max(0, 1 - dayW * 2.2);
    // Lighthouse beams only show after dark
    for (const bm of beaconMats) bm.opacity = Math.max(0, 1 - dayW * 1.6) * 0.4;
}

// ---- Ambient critters: butterflies over meadows, gulls over ponds ----
let bflyInst = null, bflyStates = [];
let gullInst = null, gullStates = [];
let dragonInst = null, dragonStates = [];

function setupCritters(hole) {
    bflyInst = null;
    bflyStates = [];
    gullInst = null;
    gullStates = [];
    const spots = [];
    for (let r = 2; r < hole.rows - 2; r++) {
        for (let c = 2; c < hole.cols - 2; c++) {
            const t = hole.grid[r][c];
            if ((t === T.ROUGH || t === T.GRASS)
                && ((((c * 73856093) ^ (r * 19349663)) >>> 0) % 197) === 0) {
                spots.push({ c: c, r: r });
            }
        }
    }
    const nB = Math.min(14, spots.length);
    if (nB) {
        const geo = new THREE.PlaneGeometry(3.2, 2.4);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
        mat.toneMapped = false;
        bflyInst = new THREE.InstancedMesh(geo, mat, nB);
        const wingCols = [0xffd54f, 0xff8a65, 0xba68c8, 0x4fc3f7, 0xfff176];
        for (let i = 0; i < nB; i++) {
            const sp = spots[Math.floor(i * spots.length / nB)];
            bflyStates.push({
                x: (sp.c + 0.5) * CELL, z: (sp.r + 0.5) * CELL,
                phase: i * 1.93, rad: 6 + (i % 5) * 2.5
            });
            if (bflyInst.setColorAt) {
                bflyInst.setColorAt(i, new THREE.Color(wingCols[i % wingCols.length]).convertSRGBToLinear());
            }
        }
        if (bflyInst.instanceColor) bflyInst.instanceColor.needsUpdate = true;
        terrainGroup.add(bflyInst);
    }
    // Dragonflies dart over interior ponds (water away from the map rim)
    dragonStates = [];
    dragonInst = null;
    {
        const pondCells = [];
        for (let r = 6; r < hole.rows - 6 && pondCells.length < 10; r += 3) {
            for (let c = 6; c < hole.cols - 6 && pondCells.length < 10; c += 3) {
                if (hole.grid[r][c] === T.WATER) pondCells.push({ c, r });
            }
        }
        if (pondCells.length) {
            const nD = Math.min(8, pondCells.length * 2);
            const geo = new THREE.PlaneGeometry(3.4, 0.7);
            const mat = new THREE.MeshBasicMaterial({
                color: 0x55e0ff, side: THREE.DoubleSide,
                transparent: true, opacity: 0.9
            });
            mat.toneMapped = false;
            dragonInst = new THREE.InstancedMesh(geo, mat, nD);
            for (let i = 0; i < nD; i++) {
                const sp = pondCells[i % pondCells.length];
                const x = (sp.c + 0.5) * CELL, z = (sp.r + 0.5) * CELL;
                dragonStates.push({ x, z, hx: x, hz: z, ox: x, oz: z, phase: i * 1.7 });
            }
            terrainGroup.add(dragonInst);
        }
    }
    // Gulls circle fountains AND the shoreline — sample beach sand that
    // borders open water for coastal flocks
    const beachSpots = [];
    for (let r = 2; r < hole.rows - 2 && beachSpots.length < 6; r += 5) {
        for (let c = 2; c < hole.cols - 2 && beachSpots.length < 6; c += 5) {
            if (hole.grid[r][c] !== T.SAND) continue;
            if (hole.grid[r][c + 1] === T.WATER || hole.grid[r][c - 1] === T.WATER
                || hole.grid[r + 1][c] === T.WATER || hole.grid[r - 1][c] === T.WATER) {
                beachSpots.push({ x: (c + 0.5) * CELL, z: (r + 0.5) * CELL });
            }
        }
    }
    const gullAnchors = fountainSpots.concat(beachSpots);
    if (gullAnchors.length) {
        const seaside = biomeOf(hole) === 'links';
        const nG = Math.min(seaside ? 26 : 13,
            gullAnchors.length * (seaside ? 4 : 2) + 1);
        const geo = new THREE.PlaneGeometry(6.5, 1.8);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: 0xf5f7f9, side: THREE.DoubleSide });
        mat.toneMapped = false;
        gullInst = new THREE.InstancedMesh(geo, mat, nG);
        for (let i = 0; i < nG; i++) {
            const spot = gullAnchors[i % gullAnchors.length];
            gullStates.push({
                x: spot.x, z: spot.z, phase: i * 2.4,
                rad: 45 + (i * 23) % 50, h: 105 + (i * 17) % 40,
                spd: 0.25 + (i % 3) * 0.07
            });
        }
        terrainGroup.add(gullInst);
    }
}

function updateCritters3D(hole) {
    const t = windClock.value;
    const dummy = sharedDummy3D;
    if (bflyInst && bflyStates.length) {
        for (let i = 0; i < bflyStates.length; i++) {
            const s = bflyStates[i];
            const a = t * 0.8 + s.phase;
            const x = s.x + Math.cos(a) * s.rad;
            const z = s.z + Math.sin(a * 1.3) * s.rad;
            const gy = (hole && hole.heights)
                ? ((hole.heights[Math.floor(z / CELL)] || [])[Math.floor(x / CELL)] || 0) : 0;
            dummy.position.set(x, gy + 9 + Math.sin(t * 2.1 + s.phase) * 3, z);
            dummy.rotation.set(0, -a, 0);
            // Wing flap faked as lateral scale shimmer
            const flap = 0.35 + Math.abs(Math.sin(t * 9 + s.phase)) * 0.65;
            dummy.scale.set(flap, 1, 1);
            dummy.updateMatrix();
            bflyInst.setMatrixAt(i, dummy.matrix);
        }
        bflyInst.instanceMatrix.needsUpdate = true;
    }
    if (gullInst && gullStates.length) {
        for (let i = 0; i < gullStates.length; i++) {
            const s = gullStates[i];
            const a = t * s.spd + s.phase;
            // Occasional fishing swoop: a slow per-gull cycle spikes
            // (sixth power keeps it rare), plunging the gull toward the
            // water with a banked dive, then climbing back out
            const dv = Math.max(0, Math.sin(t * 0.13 + s.phase * 3.7));
            const diveK = dv * dv * dv * dv * dv * dv;
            dummy.position.set(s.x + Math.cos(a) * s.rad,
                               s.h + Math.sin(t * 0.7 + s.phase) * 6
                                   - diveK * Math.max(0, s.h - 12),
                               s.z + Math.sin(a) * s.rad);
            dummy.rotation.set(diveK * 0.7, -a,
                Math.sin(t * 3 + s.phase) * 0.25 + diveK * 0.5);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            gullInst.setMatrixAt(i, dummy.matrix);
        }
        gullInst.instanceMatrix.needsUpdate = true;
    }
    if (dragonInst && dragonStates.length) {
        for (let i = 0; i < dragonStates.length; i++) {
            const s = dragonStates[i];
            const dx = s.hx - s.x, dz = s.hz - s.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < 1.5) {
                // Pick a new darting point near the home pond cell
                const h = Math.floor(t * 13 + i * 97);
                s.hx = s.ox + ((h % 21) - 10) * 1.6;
                s.hz = s.oz + (((h >> 3) % 21) - 10) * 1.6;
            } else {
                s.x += (dx / d) * 26 * 0.016;
                s.z += (dz / d) * 26 * 0.016;
            }
            dummy.position.set(s.x, 4.5 + Math.sin(t * 6 + s.phase) * 1.2, s.z);
            dummy.rotation.set(0, Math.atan2(dx, dz), 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            dragonInst.setMatrixAt(i, dummy.matrix);
        }
        dragonInst.instanceMatrix.needsUpdate = true;
    }
}

// ---- A golf cart cruising the walkway network ----
let cartGroup = null, cartState = null, cartPathSet = null;
let cartRiders = [];

function setupCartDrive(hole) {
    cartGroup = null;
    cartState = null;
    if (!worldAssets || !worldAssets.golfcart) return;
    if (npcPathCells.length < 10) return;
    cartPathSet = new Set(npcPathCells.map(p => p.c + ',' + p.r));
    const model = worldAssets.golfcart;
    const grp = new THREE.Group();
    for (const part of model.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.castShadow = true;
        grp.add(mesh);
    }
    grp.scale.setScalar(model.scale);
    terrainGroup.add(grp);
    cartGroup = grp;
    // Two riders follow the cart (world-space so the GLB scale doesn't
    // shrink them): side-by-side on the bench seat
    cartRiders = [];
    const riderCols = [0xe5533d, 0x3d7de5];
    for (let k = 0; k < 2; k++) {
        const rider = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.9, 9, 7),
            new THREE.MeshStandardMaterial({ color: new THREE.Color(riderCols[k]).convertSRGBToLinear(), roughness: 0.9 }));
        body.position.y = 4.5;
        rider.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(2.5, 7, 6),
            new THREE.MeshStandardMaterial({ color: linC(0xf0c8a0), roughness: 0.85 }));
        head.position.y = 11;
        rider.add(head);
        terrainGroup.add(rider);
        cartRiders.push({ grp: rider, side: k === 0 ? 2.6 : -2.6 });
    }
    const start = npcPathCells[Math.floor(npcPathCells.length / 2)];
    cartState = {
        c: start.c, r: start.r,
        x: (start.c + 0.5) * CELL, z: (start.r + 0.5) * CELL,
        tx: (start.c + 0.5) * CELL, tz: (start.r + 0.5) * CELL,
        dc: 1, dr: 0, yaw: 0
    };
}

function updateCartDrive3D(dt, hole) {
    if (!cartGroup || !cartState) return;
    const s = cartState;
    // The cart clocks off with the golfers: parked overnight wherever
    // its route ended, rolling again at opening time
    if (typeof resort !== 'undefined' && resort) {
        const hrC = (((resort.worldClock || 0) / 60) % 24 + 24) % 24;
        if (hrC >= 21 || hrC < 5.5) {
            const gyP = (hole && hole.heights)
                ? ((hole.heights[Math.floor(s.z / CELL)] || [])[Math.floor(s.x / CELL)] || 0) : 0;
            cartGroup.position.set(s.x, gyP, s.z);
            cartGroup.rotation.y = s.yaw;
            const fwdXp = Math.sin(s.yaw), fwdZp = Math.cos(s.yaw);
            const sideXp = Math.cos(s.yaw), sideZp = -Math.sin(s.yaw);
            for (const rider of cartRiders) {
                rider.grp.position.set(
                    s.x - fwdXp * 2 + sideXp * rider.side, gyP + 7,
                    s.z - fwdZp * 2 + sideZp * rider.side);
                rider.grp.rotation.y = s.yaw;
            }
            return;
        }
    }
    // Courtesy stop: a golfer near the cart gets right of way — the
    // cart halts ~1.5s with a friendly honk, then a cooldown so it
    // doesn't stutter through a walking group
    if (s.coolT > 0) s.coolT -= dt;
    if (s.stopT > 0) {
        s.stopT -= dt;
        if (s.stopT <= 0) s.coolT = 5;
    } else if (!(s.coolT > 0) && typeof npcStates !== 'undefined') {
        for (const g of npcStates) {
            if (!g.name || g.gone) continue;
            const dgx = g.x - s.x, dgz = g.z - s.z;
            if (dgx * dgx + dgz * dgz < 26 * 26) {
                s.stopT = 1.5;
                if (typeof playHonk === 'function') playHonk();
                break;
            }
        }
    }
    const dx = s.tx - s.x, dz = s.tz - s.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (s.stopT > 0) {
        // Holding for the crossing golfer — position/rotation writes
        // below still run so the cart sits planted, not frozen mid-lerp
    } else if (d < 2) {
        // At a cell center: mostly keep heading, turn at junctions/corners
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const opts = [];
        for (let k = 0; k < 4; k++) {
            const dc = dirs[k][0], dr = dirs[k][1];
            if (dc === -s.dc && dr === -s.dr) continue; // no casual U-turns
            if (cartPathSet.has((s.c + dc) + ',' + (s.r + dr))) opts.push(dirs[k]);
        }
        let pick;
        const straightOk = opts.some(o => o[0] === s.dc && o[1] === s.dr);
        if (!opts.length) pick = [-s.dc, -s.dr]; // dead end: back out
        else if (straightOk && (s.c * 7 + s.r * 13) % 4 !== 0) pick = [s.dc, s.dr];
        else pick = opts[(s.c * 31 + s.r * 17) % opts.length];
        s.dc = pick[0]; s.dr = pick[1];
        s.c += s.dc; s.r += s.dr;
        s.tx = (s.c + 0.5) * CELL;
        s.tz = (s.r + 0.5) * CELL;
    } else {
        s.x += (dx / d) * 46 * dt;
        s.z += (dz / d) * 46 * dt;
    }
    const gy = (hole && hole.heights)
        ? ((hole.heights[Math.floor(s.z / CELL)] || [])[Math.floor(s.x / CELL)] || 0) : 0;
    const targetYaw = Math.atan2(s.tx - s.x, s.tz - s.z);
    let dy = targetYaw - s.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    s.yaw += dy * Math.min(1, dt * 8);
    cartGroup.position.set(s.x, gy, s.z);
    cartGroup.rotation.y = s.yaw;
    // Seat the riders: slightly behind center, side by side, facing forward
    const fwdX = Math.sin(s.yaw), fwdZ = Math.cos(s.yaw);
    const sideX = Math.cos(s.yaw), sideZ = -Math.sin(s.yaw);
    for (const rider of cartRiders) {
        rider.grp.position.set(
            s.x - fwdX * 2 + sideX * rider.side,
            gy + 7,
            s.z - fwdZ * 2 + sideZ * rider.side);
        rider.grp.rotation.y = s.yaw;
    }
}

// ---- Shuttle arrivals: a cart rolls up the entrance drive, drops off
// visitors who wander onto the paths, and heads back out. Everything is
// built once at setup (one group + two walker figures, reused each
// arrival) so repeated arrivals allocate nothing.
let shuttleGroup = null, shuttleState = null;
let shuttleWalkers = [];

function setupShuttle(hole) {
    shuttleGroup = null;
    shuttleState = null;
    shuttleWalkers = [];
    if (!worldAssets || !worldAssets.golfcart) return;
    if (!npcPathCells || npcPathCells.length < 6) return;
    const model = worldAssets.golfcart;
    const grp = new THREE.Group();
    for (const part of model.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.castShadow = true;
        grp.add(mesh);
    }
    grp.scale.setScalar(model.scale * 1.25); // reads as the bigger shuttle
    grp.visible = false;
    terrainGroup.add(grp);
    shuttleGroup = grp;
    const walkCols = [0x3d9e5a, 0xd9a03c];
    for (let k = 0; k < 2; k++) {
        const w = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.9, 9, 7),
            new THREE.MeshStandardMaterial({
                color: new THREE.Color(walkCols[k]).convertSRGBToLinear(),
                roughness: 0.9 }));
        body.position.y = 4.5;
        w.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(2.5, 7, 6),
            new THREE.MeshStandardMaterial({ color: linC(0xf0c8a0), roughness: 0.85 }));
        head.position.y = 11;
        w.add(head);
        w.visible = false;
        terrainGroup.add(w);
        shuttleWalkers.push({ grp: w, walking: false, x: 0, z: 0, tz: 0 });
    }
    const eCol = Math.floor(hole.cols / 2);
    const eRow = hole.rows - (hole.border || 4);
    shuttleState = {
        phase: 'hidden',
        // First bus shows up quickly so new resorts feel alive; later
        // intervals stretch out (and shrink again as membership grows)
        timer: 20 + Math.random() * 15,
        ex: (eCol + 0.5) * CELL,
        startZ: (hole.rows - 0.5) * CELL,
        endZ: (eRow + 1.4) * CELL
    };
}

function updateShuttle3D(dt, hole) {
    if (!shuttleGroup || !shuttleState) return;
    const s = shuttleState;
    const gy = (z) => (hole && hole.heights)
        ? ((hole.heights[Math.floor(z / CELL)] || [])[Math.floor(s.ex / CELL)] || 0) : 0;
    if (s.phase === 'hidden') {
        s.timer -= dt;
        if (s.timer <= 0) {
            // No arrivals while the course sleeps — hold until morning
            const hrS = (typeof resort !== 'undefined' && resort)
                ? ((((resort.worldClock || 0) / 60) % 24 + 24) % 24) : 12;
            if (hrS >= 21 || hrS < 5.5) {
                s.timer = 20;
                return;
            }
            s.phase = 'arrive';
            s.z = s.startZ;
            shuttleGroup.visible = true;
        }
        return;
    }
    if (s.phase === 'arrive') {
        s.z -= 42 * dt;
        if (s.z <= s.endZ) {
            s.z = s.endZ;
            s.phase = 'unload';
            s.timer = 2.6;
            // Visitors hop out and head up the entrance walk
            for (let k = 0; k < shuttleWalkers.length; k++) {
                const w = shuttleWalkers[k];
                w.walking = true;
                w.x = s.ex + (k === 0 ? -7 : 7);
                w.z = s.z - 4;
                w.tz = s.z - CELL * (5 + k * 2);
                w.grp.visible = true;
            }
            // The honk + the bus itself carry the moment; the toast only
            // fires for the first visit and every third one after, so the
            // banner strip isn't permanently occupied by shuttle news
            s.visits = (s.visits || 0) + 1;
            if (typeof notify === 'function'
                && (s.visits === 1 || s.visits % 3 === 0)) {
                notify('\u{1F68C} New arrivals! Visitors at the gate');
            }
            if (typeof playHonk === 'function') playHonk();
        }
    } else if (s.phase === 'unload') {
        s.timer -= dt;
        if (s.timer <= 0) s.phase = 'depart';
    } else if (s.phase === 'depart') {
        s.z += 42 * dt;
        if (s.z >= s.startZ) {
            s.phase = 'hidden';
            shuttleGroup.visible = false;
            const members = (typeof resort !== 'undefined' && resort)
                ? (resort.members || 0) : 0;
            s.timer = Math.max(55, 170 - members * 1.5) + Math.random() * 25;
        }
    }
    shuttleGroup.position.set(s.ex, gy(s.z), s.z);
    // Nose points along the direction of travel
    shuttleGroup.rotation.y = s.phase === 'depart' ? 0 : Math.PI;
    // Dropped-off visitors stroll north up the walk, then melt into the
    // crowd (hidden until the next arrival reuses them)
    for (const w of shuttleWalkers) {
        if (!w.walking) continue;
        w.z -= 13 * dt;
        const wy = (hole && hole.heights)
            ? ((hole.heights[Math.floor(w.z / CELL)] || [])[Math.floor(w.x / CELL)] || 0) : 0;
        const bob = Math.abs(Math.sin(w.z * 0.12)) * 1.6;
        w.grp.position.set(w.x, wy + bob, w.z);
        if (w.z <= w.tz) {
            w.walking = false;
            w.grp.visible = false;
        }
    }
}

function updateFountains3D() {
    if (!fountainInst) return;
    const dummy = sharedDummy3D;
    const t = windClock.value;
    let idx = 0;
    for (let f = 0; f < fountainSpots.length; f++) {
        const spot = fountainSpots[f];
        for (let i = 0; i < FOUNTAIN_DROPS; i++) {
            // Each droplet loops its own arc: up out of the pond, outward, back in
            const ci = (t * 0.55 + i / FOUNTAIN_DROPS + f * 0.5) % 1;
            const ang = i * 2.4 + f;
            const rad = 1 + ci * 7;
            const h = -1.4 + Math.sin(Math.PI * ci) * (20 + (i % 3) * 6);
            dummy.position.set(spot.x + Math.cos(ang) * rad, h, spot.z + Math.sin(ang) * rad);
            const sc = 1.15 - ci * 0.5;
            dummy.scale.set(sc, sc * (1.3 - Math.sin(Math.PI * ci) * 0.4), sc);
            dummy.updateMatrix();
            fountainInst.setMatrixAt(idx++, dummy.matrix);
        }
    }
    fountainInst.instanceMatrix.needsUpdate = true;
    if (splashInst) {
        let si = 0;
        for (let f = 0; f < fountainSpots.length; f++) {
            const spot = fountainSpots[f];
            for (let k = 0; k < 3; k++) {
                const ck = (t * 0.5 + k / 3 + f * 0.31) % 1;
                const rad = 3 + ck * 10;
                dummy.position.set(spot.x, -1.1, spot.z);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(rad, 1, rad);
                dummy.updateMatrix();
                splashInst.setMatrixAt(si, dummy.matrix);
                // Fade by darkening toward the water as the ring expands
                if (splashInst.setColorAt) {
                    splashInst.setColorAt(si, SPLASH_TMP_COLOR.setScalar(1 - ck * 0.85));
                }
                si++;
            }
        }
        splashInst.instanceMatrix.needsUpdate = true;
        if (splashInst.instanceColor) splashInst.instanceColor.needsUpdate = true;
    }
}

// ---- Hover bots — groundskeeper drones skimming the fairways ----
let botBodyInst = null, botGlowInst = null;
let botStates = [], botCells = [];
const BOT_COUNT = 4;

function setupHoverBots(hole) {
    botBodyInst = null;
    botGlowInst = null;
    botStates = [];
    botCells = [];
    for (let r = 0; r < hole.rows; r++)
        for (let c = 0; c < hole.cols; c++)
            if (hole.grid[r][c] === T.FAIRWAY) botCells.push({ c, r });
    if (botCells.length < 12) return;
    const n = Math.min(BOT_COUNT, Math.max(1, Math.floor(botCells.length / 60)));
    const bodyGeo = new THREE.SphereGeometry(7.5, 12, 9);
    bodyGeo.scale(1, 0.5, 1);
    const bodyMat = new THREE.MeshStandardMaterial({ color: linC(0xe8ecef), roughness: 0.35 });
    botBodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, n);
    botBodyInst.castShadow = true;
    const glowGeo = new THREE.CircleGeometry(11.5, 16);
    glowGeo.rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x3adbe8, transparent: true, opacity: 0.55, depthWrite: false
    });
    glowMat.toneMapped = false;
    botGlowInst = new THREE.InstancedMesh(glowGeo, glowMat, n);
    botGlowInst.renderOrder = 3;
    for (let i = 0; i < n; i++) {
        const start = botCells[(i * 97) % botCells.length];
        botStates.push({
            x: (start.c + 0.5) * CELL, z: (start.r + 0.5) * CELL,
            tx: (start.c + 0.5) * CELL, tz: (start.r + 0.5) * CELL,
            phase: i * 2.1
        });
    }
    terrainGroup.add(botBodyInst);
    terrainGroup.add(botGlowInst);
}

function updateHoverBots3D(dt, hole) {
    if (!botBodyInst || !botStates.length) return;
    const dummy = sharedDummy3D;
    const t = windClock.value;
    for (let i = 0; i < botStates.length; i++) {
        const s = botStates[i];
        const dx = s.tx - s.x, dz = s.tz - s.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 4) {
            const next = botCells[Math.floor((t * 3 + i * 211) % botCells.length)];
            s.tx = (next.c + 0.5) * CELL;
            s.tz = (next.r + 0.5) * CELL;
        } else {
            s.x += (dx / d) * 26 * dt;
            s.z += (dz / d) * 26 * dt;
        }
        const gy = (hole && hole.heights)
            ? ((hole.heights[Math.floor(s.z / CELL)] || [])[Math.floor(s.x / CELL)] || 0) : 0;
        dummy.position.set(s.x, gy + 13 + Math.sin(t * 1.8 + s.phase) * 2.2, s.z);
        // Slow spin plus a lean into the direction of travel
        dummy.rotation.set(d > 4 ? (dz / d) * 0.14 : 0, t * 0.9 + s.phase,
                           d > 4 ? -(dx / d) * 0.14 : 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        botBodyInst.setMatrixAt(i, dummy.matrix);
        const pulse = 1 + Math.sin(t * 3 + s.phase) * 0.15;
        dummy.position.set(s.x, gy + 2.6, s.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(pulse, 1, pulse);
        dummy.updateMatrix();
        botGlowInst.setMatrixAt(i, dummy.matrix);
    }
    botBodyInst.instanceMatrix.needsUpdate = true;
    botGlowInst.instanceMatrix.needsUpdate = true;
}

// ---- Balls flying the shot arcs — one glint per arc segment ----
let arcCurves = [];
let arcBallInst = null;
let arcEndSand = [];
let pinRings = [];
let perBuildTextures = []; // canvas textures minted this build (disposed on rebuild)
let teeSignMats = [];    // neon hole-number panels (bright at night)
let greenGlowMats = [];  // additive green-surface glow (night only)

function updatePinRings3D() {
    if (!pinRings.length) return;
    const t = windClock.value;
    for (let i = 0; i < pinRings.length; i++) {
        const ring = pinRings[i];
        const p = 1 + Math.sin(t * 2.4 + i) * 0.18;
        ring.scale.set(p, 1, p);
        ring.material.opacity = 0.5 + Math.sin(t * 2.4 + i) * 0.25;
    }
}

function setupArcBalls() {
    arcBallInst = null;
    if (!arcCurves.length) return;
    // Landing surface per arc: sand deadens the touchdown bounce
    arcEndSand = arcCurves.map((curve) => {
        const p = curve.getPoint(1);
        const c = Math.floor(p.x / CELL), r = Math.floor(p.z / CELL);
        return !!(terrainHoleRef && terrainHoleRef.grid[r]
                  && terrainHoleRef.grid[r][c] === T.SAND);
    });
    const geo = new THREE.SphereGeometry(2.6, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    mat.toneMapped = false;
    arcBallInst = new THREE.InstancedMesh(geo, mat, arcCurves.length);
    arcBallInst.renderOrder = 4;
    terrainGroup.add(arcBallInst);
}

function updateArcBalls3D() {
    if (!arcBallInst || !arcCurves.length) return;
    const dummy = sharedDummy3D;
    const t = windClock.value;
    for (let i = 0; i < arcCurves.length; i++) {
        // Each segment fires every ~4s, staggered; ball hidden between shots
        const cycle = ((t * 0.45 + i * 0.37) % 1.6);
        if (cycle < 1) {
            const p = arcCurves[i].getPoint(cycle);
            dummy.position.copy(p);
            dummy.scale.set(1, 1, 1);
        } else if (cycle < 1.3) {
            // Touchdown: two decaying bounces — unless it's a bunker,
            // where the ball plugs with barely a hop
            const p = arcCurves[i].getPoint(1);
            const b = (cycle - 1) / 0.3;
            const amp = arcEndSand[i] ? 1.8 : 7;
            const waves = arcEndSand[i] ? 1.2 : 2.5;
            dummy.position.set(p.x,
                p.y + Math.abs(Math.sin(b * Math.PI * waves)) * amp * (1 - b), p.z);
            dummy.scale.set(1, 1, 1);
        } else {
            dummy.position.set(0, -500, 0);
            dummy.scale.set(0.001, 0.001, 0.001);
        }
        dummy.updateMatrix();
        arcBallInst.setMatrixAt(i, dummy.matrix);
    }
    arcBallInst.instanceMatrix.needsUpdate = true;
}
