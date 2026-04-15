// ============================================================
//  SHOP — Economy, upgrades, save format
// ============================================================

let money = 0;

const UPGRADES = {
    slots: {
        id: 'slots',
        label: 'Piece Slots',
        desc: '+4 more pieces you can place',
        baseCost: 25,
        level: 0,
        maxLevel: 12,
        cost(level) { return Math.round(this.baseCost * Math.pow(1.85, level)); }
    },
    marbleValue: {
        id: 'marbleValue',
        label: 'Marble Value',
        desc: 'Each collected marble pays +$1',
        baseCost: 15,
        level: 0,
        maxLevel: 30,
        cost(level) { return Math.round(this.baseCost * Math.pow(1.6, level)); }
    },
    autoDrop: {
        id: 'autoDrop',
        label: 'Auto-Drop',
        desc: 'Coming soon — idle mechanics',
        baseCost: 0,
        level: 0,
        maxLevel: 1,
        locked: true,
        cost() { return 0; }
    }
};

// Base values — upgrades add to these
const BASE_MAX_PIECES = 8;
const BASE_MARBLE_VALUE = 1;

function getMaxPieces() {
    return BASE_MAX_PIECES + UPGRADES.slots.level * 4;
}
function getMarbleValue() {
    return BASE_MARBLE_VALUE + UPGRADES.marbleValue.level;
}

function canAfford(upgradeId) {
    const u = UPGRADES[upgradeId];
    if (!u || u.locked) return false;
    if (u.level >= u.maxLevel) return false;
    return money >= u.cost(u.level);
}

function buyUpgrade(upgradeId) {
    const u = UPGRADES[upgradeId];
    if (!u || u.locked) return false;
    if (u.level >= u.maxLevel) return false;
    const c = u.cost(u.level);
    if (money < c) return false;
    money -= c;
    u.level++;
    saveGame();
    return true;
}

function onMarbleCollected(m) {
    money += getMarbleValue();
    saveGame();
    // Fire a tiny burst effect (handled in game.js via collectedBursts)
    if (typeof spawnCollectBurst === 'function') {
        spawnCollectBurst(m.x, m.y);
    }
}

// ---- Save / load ----
function saveGame() {
    saveData('save', {
        money,
        pieces: placedPieces,
        upgrades: {
            slots: UPGRADES.slots.level,
            marbleValue: UPGRADES.marbleValue.level
        }
    });
}

function loadGame() {
    const s = loadData('save', null);
    if (!s) return;
    money = s.money || 0;
    placedPieces = Array.isArray(s.pieces) ? s.pieces : [];
    if (s.upgrades) {
        UPGRADES.slots.level = s.upgrades.slots || 0;
        UPGRADES.marbleValue.level = s.upgrades.marbleValue || 0;
    }
}
