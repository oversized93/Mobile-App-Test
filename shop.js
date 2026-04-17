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
    { name: 'River',       keys: ['rock', 'widerRiver', 'expandGarden'] },
    { name: 'Wildlife',    keys: ['fishTree', 'lilypadTree'] },
    { name: 'Advanced',    keys: ['doubleSpawn', 'goldenCurrent', 'swiftCurrent'] },
    { name: 'Zen Mastery', keys: ['prestige'] },
];

// ---- Upgrade definitions ----
const UPGRADES = {
    // --- Tier 1: Basics ---
    koiValue:   { id: 'koiValue',   label: 'Koi Value',      desc: '+1 base payout per koi',              baseCost: 15,    level: 0, maxLevel: 30, scale: 1.6 },
    spawnRate:  { id: 'spawnRate',  label: 'Spawn Rate',     desc: 'Faster spawning — more koi per min',  baseCost: 30,    level: 0, maxLevel: 15, scale: 1.85 },
    flowMult:   { id: 'flowMult',   label: 'Flow Bonus',     desc: '+0.1 per-second flow time bonus',     baseCost: 50,    level: 0, maxLevel: 20, scale: 2.0 },

    // --- Tier 2: River ---
    rock:           { id: 'rock',          label: 'River Rock',     desc: '+1 rock — slows koi, more flow time', baseCost: 80,   level: 0, maxLevel: 99, scale: 1.75 },
    widerRiver:     { id: 'widerRiver',    label: 'Wider River',    desc: '+15% river width per level',          baseCost: 200,  level: 0, maxLevel: 8,  scale: 2.0 },
    expandGarden:   { id: 'expandGarden',  label: 'Expand Garden',  desc: 'Zoom out for more room — forces redraw', baseCost: 2000, level: 0, maxLevel: 6, scale: 4.5 },

    // --- Tier 3: Wildlife trees ---
    fishTree:       { id: 'fishTree',      label: 'River Fish',        desc: 'Unlock rarer fish species',      baseCost: 0, level: 0, maxLevel: 5, scale: 1, isTree: true, requires: { totalEarned: 150 } },
    lilypadTree:    { id: 'lilypadTree',   label: 'Lily Pad Riders',   desc: 'Unlock animals riding lily pads', baseCost: 0, level: 0, maxLevel: 5, scale: 1, isTree: true, requires: { totalEarned: 350 } },

    // --- Tier 4: Advanced ---
    doubleSpawn:    { id: 'doubleSpawn',   label: 'Twin Springs',    desc: '15% chance to spawn 2 at once / lvl', baseCost: 800,  level: 0, maxLevel: 5, scale: 2.5, requires: { totalEarned: 500 } },
    goldenCurrent:  { id: 'goldenCurrent', label: 'Golden Current',  desc: '+10% bonus to all payouts / lvl',     baseCost: 1000, level: 0, maxLevel: 10, scale: 2.2, requires: { totalEarned: 700 } },
    swiftCurrent:   { id: 'swiftCurrent',  label: 'Swift Current',   desc: 'Animals move 8% faster / lvl',        baseCost: 600,  level: 0, maxLevel: 8,  scale: 1.9, requires: { totalEarned: 400 } },

    // --- Tier 5: Prestige ---
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

function getTreeNextInfo(id) {
    const tree = id === 'fishTree' ? FISH_TREE : id === 'lilypadTree' ? LILYPAD_TREE : null;
    if (!tree) return null;
    const lvl = UPGRADES[id].level;
    if (lvl >= tree.length) return { label: 'All discovered', mult: 0, cost: Infinity, done: true };
    return tree[lvl];
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

// ---- Computed bonuses from upgrades ----
function getFishBaseValue() { return 1 + UPGRADES.koiValue.level; }
function getFlowMultiplier() { return 0.3 + UPGRADES.flowMult.level * 0.1; }
function getRiverWidthBonus() { return 1 + UPGRADES.widerRiver.level * 0.15; }
function getSpeedMultiplier() { return 1 + UPGRADES.swiftCurrent.level * 0.08; }
function getPayoutBonus() { return 1 + UPGRADES.goldenCurrent.level * 0.10; }
function getDoubleSpawnChance() { return UPGRADES.doubleSpawn.level * 0.15; }

function animalPayout(a) {
    const type = ANIMAL_TYPES[a.type] || ANIMAL_TYPES.fish;
    const base = type.baseValue + UPGRADES.koiValue.level;
    const flowBonus = 1 + a.flowTime * getFlowMultiplier();
    const golden = getPayoutBonus();
    const prestige = getPrestigeMultiplier();
    return Math.max(1, Math.round(base * flowBonus * golden * prestige));
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

// ---- Collection handler ----
function onAnimalCollected(a) {
    const payout = animalPayout(a);
    money += payout;
    totalEarned += payout;
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
