// ============================================================
//  SHOP — Progression skeleton: 13 upgrades across 5 tiers,
//  milestone unlock system, prestige, totalEarned tracking.
// ============================================================

let money = 0;
let totalEarned = 0;
let prestigeLevel = 0;

function getPrestigeMultiplier() { return Math.pow(1.5, prestigeLevel); }

// ---- Tier layout for the shop UI ----
const UPGRADE_TIERS = [
    { name: 'Basics',      keys: ['koiValue', 'spawnRate', 'flowMult'] },
    { name: 'River',       keys: ['widerRiver', 'expandGarden'] },
    { name: 'Wildlife',    keys: ['fishTree', 'lilypadTree'] },
    { name: 'Obstacles',   keys: ['rock', 'obstacleTree'] },
    { name: 'Garden',      keys: ['gardenTree', 'spawnerTree'] },
    { name: 'Advanced',    keys: ['doubleSpawn', 'goldenCurrent', 'swiftCurrent'] },
    { name: 'Harmony',    keys: ['gardenHarmony'] },
    { name: 'Zen Mastery', keys: ['prestige'] },
];

// ---- Upgrade definitions ----
const UPGRADES = {
    // --- Tier 1: Basics (multiplicative — these compound with each other) ---
    koiValue:   { id: 'koiValue',   label: 'Koi Value',      desc: '\u00d71.15 base income per level',       baseCost: 12,    level: 0, maxLevel: 30, scale: 1.5 },
    spawnRate:  { id: 'spawnRate',  label: 'Spawn Rate',     desc: 'Faster spawning — more koi per min',  baseCost: 25,    level: 0, maxLevel: 15, scale: 1.85 },
    flowMult:   { id: 'flowMult',   label: 'Flow Bonus',     desc: '\u00d71.12 flow-time coefficient / lvl', baseCost: 35,    level: 0, maxLevel: 20, scale: 1.7 },

    // --- Tier 2: River ---
    rock:           { id: 'rock',          label: 'River Rock',     desc: '+1 rock — slows koi, more flow time', baseCost: 80,   level: 0, maxLevel: 99, scale: 1.75 },
    widerRiver:     { id: 'widerRiver',    label: 'Wider River',    desc: '+15% river width per level',          baseCost: 200,  level: 0, maxLevel: 8,  scale: 2.0 },
    expandGarden:   { id: 'expandGarden',  label: 'Expand Garden',  desc: 'Zoom out for more room — forces redraw', baseCost: 2000, level: 0, maxLevel: 6, scale: 4.5 },

    // --- Tier 3: Wildlife trees ---
    fishTree:       { id: 'fishTree',      label: 'River Fish',        desc: 'Unlock rarer fish species',      baseCost: 0, level: 0, maxLevel: 5, scale: 1, isTree: true, requires: { totalEarned: 150 } },
    lilypadTree:    { id: 'lilypadTree',   label: 'Lily Pad Riders',   desc: 'Unlock animals riding lily pads', baseCost: 0, level: 0, maxLevel: 5, scale: 1, isTree: true, requires: { totalEarned: 350 } },

    // --- Tier: Obstacles tree ---
    obstacleTree:   { id: 'obstacleTree',  label: 'Better Obstacles',  desc: 'Unlock stronger obstacles', baseCost: 0, level: 0, maxLevel: 5, scale: 1, isTree: true, requires: { totalEarned: 300 } },

    // --- Tier: Garden (passive income + spawner upgrades) ---
    gardenTree:     { id: 'gardenTree',    label: 'Garden Beauty',     desc: 'Decorations that earn passive income', baseCost: 0, level: 0, maxLevel: 5, scale: 1, isTree: true, requires: { totalEarned: 150 } },
    spawnerTree:    { id: 'spawnerTree',   label: 'More Springs',      desc: 'Multiply your spawn rate',  baseCost: 0, level: 0, maxLevel: 5, scale: 1, isTree: true, requires: { totalEarned: 1000 } },

    // --- Tier: Advanced ---
    doubleSpawn:    { id: 'doubleSpawn',   label: 'Twin Springs',    desc: '15% chance to spawn 2 at once / lvl', baseCost: 800,  level: 0, maxLevel: 5, scale: 2.5, requires: { totalEarned: 500 } },
    goldenCurrent:  { id: 'goldenCurrent', label: 'Golden Current',  desc: '\u00d71.10 to all payouts / lvl',         baseCost: 1000, level: 0, maxLevel: 10, scale: 2.2, requires: { totalEarned: 700 } },
    swiftCurrent:   { id: 'swiftCurrent',  label: 'Swift Current',   desc: 'Animals move 8% faster / lvl',        baseCost: 600,  level: 0, maxLevel: 8,  scale: 1.9, requires: { totalEarned: 400 } },

    // --- Tier 5: Harmony (meta-multiplier — boosts EVERYTHING) ---
    gardenHarmony:  { id: 'gardenHarmony', label: 'Garden Harmony',  desc: '\u00d71.08 to ALL income / lvl (compounds)', baseCost: 500, level: 0, maxLevel: 15, scale: 2.4, requires: { totalEarned: 1500 } },

    // --- Tier 6: Prestige ---
    prestige:       { id: 'prestige',      label: 'Zen Mastery',     desc: 'Reset for a permanent 1.5\u00d7 multiplier', baseCost: 50000, level: 0, maxLevel: 10, scale: 5.0, requires: { totalEarned: 30000 } },
};

// ---- Fish and Lily Pad rarity trees ----
const FISH_TREE = [
    { id: 'goldfish',   label: 'Goldfish',    mult: 2,   weight: 0.35,  cost: 300 },
    { id: 'catfish',    label: 'Catfish',      mult: 5,   weight: 0.15,  cost: 1500 },
    { id: 'dragonfish', label: 'Dragon Fish',  mult: 12,  weight: 0.06,  cost: 8000 },
    { id: 'goldenkoi',  label: 'Golden Koi',   mult: 30,  weight: 0.025, cost: 40000 },
    { id: 'spiritfish', label: 'Spirit Fish',  mult: 80,  weight: 0.01,  cost: 200000 },
];
const LILYPAD_TREE = [
    { id: 'frog',   label: 'Frog',   mult: 3,   weight: 0.28, cost: 500 },
    { id: 'turtle', label: 'Turtle', mult: 8,   weight: 0.12, cost: 2500 },
    { id: 'duck',   label: 'Duck',   mult: 15,  weight: 0.06, cost: 12000 },
    { id: 'crane',  label: 'Crane',  mult: 40,  weight: 0.02, cost: 60000 },
    { id: 'panda',  label: 'Panda',  mult: 100, weight: 0.008, cost: 300000 },
];

const OBSTACLE_TREE = [
    { id: 'log',       label: 'Log',        slowFactor: 0.28, range: 0.045, cost: 400 },
    { id: 'whirlpool', label: 'Whirlpool',  slowFactor: 0.15, range: 0.06,  cost: 3000 },
    { id: 'waterfall', label: 'Waterfall',  slowFactor: 0.08, range: 0.08,  cost: 15000 },
    { id: 'dam',       label: 'Dam',        slowFactor: 0.05, range: 0.10,  cost: 80000 },
    { id: 'zenbridge', label: 'Zen Bridge', slowFactor: 0.02, range: 0.12,  cost: 400000 },
];

const GARDEN_TREE = [
    { id: 'bamboo',   label: 'Bamboo',       incomePerSec: 0.5,  cost: 200 },
    { id: 'bonsai',   label: 'Bonsai Tree',  incomePerSec: 2,    cost: 1000 },
    { id: 'lantern',  label: 'Stone Lantern', incomePerSec: 8,   cost: 5000 },
    { id: 'bridge',   label: 'Moon Bridge',  incomePerSec: 30,   cost: 25000 },
    { id: 'torii',    label: 'Torii Gate',   incomePerSec: 100,  cost: 150000 },
];

const SPAWNER_TREE = [
    { id: 'spring2',   label: 'Second Spring',  spawnMult: 2.0,  cost: 2000 },
    { id: 'spring3',   label: 'Third Spring',   spawnMult: 3.0,  cost: 10000 },
    { id: 'goldspring', label: 'Golden Spring',  spawnMult: 4.0,  cost: 50000 },
    { id: 'sacred',    label: 'Sacred Spring',  spawnMult: 5.5,  cost: 250000 },
    { id: 'eternal',   label: 'Eternal Spring', spawnMult: 8.0,  cost: 1000000 },
];

const TREE_DATA = {
    fishTree: FISH_TREE,
    lilypadTree: LILYPAD_TREE,
    obstacleTree: OBSTACLE_TREE,
    gardenTree: GARDEN_TREE,
    spawnerTree: SPAWNER_TREE,
};

function getTreeNextInfo(id) {
    const tree = TREE_DATA[id];
    if (!tree) return null;
    const lvl = UPGRADES[id].level;
    if (lvl >= tree.length) return { label: 'All discovered', cost: Infinity, done: true };
    const entry = tree[lvl];
    // Build a display string based on what kind of tree it is
    let desc = entry.label;
    if (entry.mult) desc += ' (' + entry.mult + '\u00d7)';
    if (entry.incomePerSec) desc += ' (+$' + entry.incomePerSec + '/s)';
    if (entry.spawnMult) desc += ' (' + entry.spawnMult + '\u00d7 spawns)';
    if (entry.slowFactor) desc += ' (' + Math.round((1 - entry.slowFactor) * 100) + '% slow)';
    return { label: desc, cost: entry.cost, done: false };
}

function upgradeCost(id) {
    const u = UPGRADES[id];
    if (!u) return Infinity;
    // Tree upgrades have per-tier costs instead of scaling formula
    if (u.isTree) {
        const info = getTreeNextInfo(id);
        return info && !info.done ? info.cost : Infinity;
    }
    return Math.round(u.baseCost * Math.pow(u.scale, u.level));
}

// ---- Computed bonuses (ALL multiplicative — they compound with each other) ----
// Layer 1: base koi value × koiMult
function getKoiMultiplier() { return Math.pow(1.15, UPGRADES.koiValue.level); }
// Layer 2: flow time coefficient (how much each second of flow is worth)
function getFlowCoefficient() { return 0.3 * Math.pow(1.12, UPGRADES.flowMult.level); }
// Layer 3: golden current — flat multiplier on ALL income
function getGoldenMultiplier() { return Math.pow(1.10, UPGRADES.goldenCurrent.level); }
// Layer 4: garden harmony — meta-multiplier that boosts everything
function getHarmonyMultiplier() { return Math.pow(1.08, UPGRADES.gardenHarmony.level); }
// Passive income from Garden Beauty tree ($/sec)
function getPassiveIncomePerSec() {
    let total = 0;
    const lvl = UPGRADES.gardenTree.level;
    for (let i = 0; i < lvl && i < GARDEN_TREE.length; i++) {
        total += GARDEN_TREE[i].incomePerSec;
    }
    return total * getHarmonyMultiplier() * getPrestigeMultiplier();
}
// Spawner multiplier from More Springs tree
function getSpawnerMultiplier() {
    const lvl = UPGRADES.spawnerTree.level;
    if (lvl <= 0 || lvl > SPAWNER_TREE.length) return 1;
    return SPAWNER_TREE[lvl - 1].spawnMult;
}
// Best obstacle available (for placement)
function getBestObstacle() {
    const lvl = UPGRADES.obstacleTree.level;
    if (lvl <= 0) return { slowFactor: ROCK_SLOW_FACTOR, range: ROCK_SLOW_RANGE_T, label: 'Rock' };
    const entry = OBSTACLE_TREE[Math.min(lvl - 1, OBSTACLE_TREE.length - 1)];
    return { slowFactor: entry.slowFactor, range: entry.range, label: entry.label };
}
// Utility bonuses (not income multipliers)
function getRiverWidthBonus() { return 1 + UPGRADES.widerRiver.level * 0.15; }
function getSpeedMultiplier() { return 1 + UPGRADES.swiftCurrent.level * 0.08; }
function getDoubleSpawnChance() { return UPGRADES.doubleSpawn.level * 0.15; }

// Final payout: base × koi × flow × golden × harmony × prestige
// Each upgrade layer compounds with all the others — this is what
// creates the "numbers exploding" idle-game feeling.
function animalPayout(a) {
    const type = ANIMAL_TYPES[a.type] || ANIMAL_TYPES.fish;
    const base = type.baseValue;
    const koi = getKoiMultiplier();
    const flow = 1 + a.flowTime * getFlowCoefficient();
    const golden = getGoldenMultiplier();
    const harmony = getHarmonyMultiplier();
    const prestige = getPrestigeMultiplier();
    return Math.max(1, Math.round(base * koi * flow * golden * harmony * prestige));
}

// Estimated income per second (used for offline earnings).
function estimateIncomePerSec() {
    if (!river || !roundStarted) return 0;
    const avgFlowTime = river.totalLen / (BASE_ANIMAL_SPEED * getSpeedMultiplier());
    const dummy = { type: 'fish', flowTime: avgFlowTime };
    const avgPay = animalPayout(dummy);
    const spawnsPerSec = 1 / spawnInterval();
    return avgPay * spawnsPerSec;
}

// ---- Unlock / milestone system ----
function isUpgradeVisible(id) {
    const u = UPGRADES[id];
    if (!u) return false;
    if (!u.requires) return true;
    if (u.requires.totalEarned && totalEarned < u.requires.totalEarned * 0.5) return false;
    return true;
}
function isUpgradeUnlocked(id) {
    const u = UPGRADES[id];
    if (!u) return false;
    if (!u.requires) return true;
    if (u.requires.totalEarned && totalEarned < u.requires.totalEarned) return false;
    if (u.requires.upgrade) {
        const req = UPGRADES[u.requires.upgrade];
        if (!req || req.level < 1) return false;
    }
    return true;
}
function canAfford(id) {
    const u = UPGRADES[id];
    if (!u) return false;
    if (u.level >= u.maxLevel) return false;
    if (!isUpgradeUnlocked(id)) return false;
    return money >= upgradeCost(id);
}

function buyUpgrade(id) {
    const u = UPGRADES[id];
    if (!u) return false;
    if (u.level >= u.maxLevel) return false;
    if (!isUpgradeUnlocked(id)) return false;
    const c = upgradeCost(id);
    if (money < c) return false;
    money -= c;
    u.level++;

    // Side effects
    if (id === 'rock') rockInventory++;
    if (id === 'expandGarden') {
        river = null;
        rocks.length = 0;
        roundStarted = false;
        resetFlow();
        if (typeof notify === 'function') notify('Garden expanded — redraw your river');
    }
    if (id === 'prestige') {
        doPrestige();
        return true;
    }
    // Unlock animal spawn weights when wildlife upgrades are bought
    syncAnimalWeights();

    saveGame();
    return true;
}

function syncAnimalWeights() {
    // Reset all non-koi weights to 0
    for (const key in ANIMAL_TYPES) {
        if (key !== 'fish') ANIMAL_TYPES[key].rollWeight = 0;
    }
    // Fish tree: each level unlocks one species from FISH_TREE
    const fishLvl = UPGRADES.fishTree.level;
    for (let i = 0; i < fishLvl && i < FISH_TREE.length; i++) {
        const entry = FISH_TREE[i];
        if (ANIMAL_TYPES[entry.id]) ANIMAL_TYPES[entry.id].rollWeight = entry.weight;
    }
    // Lily pad tree
    const lilyLvl = UPGRADES.lilypadTree.level;
    for (let i = 0; i < lilyLvl && i < LILYPAD_TREE.length; i++) {
        const entry = LILYPAD_TREE[i];
        if (ANIMAL_TYPES[entry.id]) ANIMAL_TYPES[entry.id].rollWeight = entry.weight;
    }
}

// ---- Prestige ----
function doPrestige() {
    prestigeLevel++;
    money = 0;
    river = null;
    draftRiver = null;
    rocks.length = 0;
    rockInventory = 0;
    roundStarted = false;
    resetFlow();
    // Reset all upgrades EXCEPT prestige level
    for (const key in UPGRADES) {
        if (key !== 'prestige') UPGRADES[key].level = 0;
    }
    // But prestige level persists — set it back after the loop
    UPGRADES.prestige.level = prestigeLevel;
    syncAnimalWeights();
    saveGame();
    if (typeof notify === 'function') notify('Zen Mastery \u00d7' + getPrestigeMultiplier().toFixed(1) + ' — a new beginning');
}

// ---- Milestones (notify at key earning thresholds) ----
const MILESTONES = [
    { at: 50,    msg: 'Your garden begins to grow...' },
    { at: 200,   msg: 'New wildlife spotted nearby' },
    { at: 1000,  msg: 'The river hums with life' },
    { at: 5000,  msg: 'Advanced techniques revealed' },
    { at: 15000, msg: 'The garden approaches harmony' },
    { at: 30000, msg: 'Zen mastery beckons...' },
    { at: 100000,msg: 'A legendary garden' },
];
let lastMilestoneAt = 0;
function checkMilestones() {
    for (const m of MILESTONES) {
        if (totalEarned >= m.at && lastMilestoneAt < m.at) {
            lastMilestoneAt = m.at;
            if (typeof notify === 'function') notify(m.msg);
            break;
        }
    }
}

// ---- Offline earnings ----
let lastPlayTime = Date.now();
function calcOfflineEarnings(elapsedMs) {
    const dt = elapsedMs / 1000;
    const rate = estimateIncomePerSec();
    return Math.round(rate * dt * 0.5); // 50% efficiency while offline
}

// ---- Collection handler ----
function onAnimalCollected(a) {
    const payout = animalPayout(a);
    money += payout;
    totalEarned += payout;
    checkMilestones();
    saveGame();
    if (typeof spawnCollectBurst === 'function') {
        const p = pointAtPathT(river, 1);
        spawnCollectBurst(p.x, p.y);
    }
    if (typeof spawnFloatText === 'function') {
        const p = pointAtPathT(river, 1);
        const label = '+$' + payout + '  ' + a.flowTime.toFixed(1) + 's';
        spawnFloatText(p.x, p.y - 10, label);
    }
}

// ---- Save / load ----
function saveGame() {
    const upgradeState = {};
    for (const key in UPGRADES) upgradeState[key] = UPGRADES[key].level;
    saveData('save', {
        money,
        totalEarned,
        prestigeLevel,
        lastMilestoneAt,
        lastPlayTime: Date.now(),
        river: river ? { pts: river.pts, width: river.width, totalLen: river.totalLen } : null,
        rocks: rocks.map(r => ({ pathT: r.pathT })),
        rockInventory,
        roundStarted,
        upgrades: upgradeState
    });
}

function loadGame() {
    const s = loadData('save', null);
    if (!s) return;
    money = s.money || 0;
    totalEarned = s.totalEarned || 0;
    prestigeLevel = s.prestigeLevel || 0;
    lastMilestoneAt = s.lastMilestoneAt || 0;
    lastPlayTime = s.lastPlayTime || Date.now();
    if (s.river && Array.isArray(s.river.pts) && s.river.pts.length >= 2) {
        river = {
            pts: s.river.pts,
            width: s.river.width || getRiverWidth(),
            totalLen: s.river.totalLen || 0
        };
        if (!river.totalLen || isNaN(river.totalLen)) {
            river.totalLen = riverTotalLength(river);
        }
    }
    if (Array.isArray(s.rocks)) rocks = s.rocks.map(r => ({ pathT: r.pathT }));
    rockInventory = s.rockInventory || 0;
    roundStarted = !!s.roundStarted;
    if (s.upgrades) {
        for (const key in s.upgrades) {
            if (UPGRADES[key]) UPGRADES[key].level = s.upgrades[key] || 0;
        }
    }
    // Restore prestige level into the upgrade object
    UPGRADES.prestige.level = prestigeLevel;
    // Sync animal weights from loaded unlock levels
    syncAnimalWeights();
}
