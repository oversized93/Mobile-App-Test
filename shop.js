// ============================================================
//  SHOP — Money, upgrades, save format
// ============================================================

let money = 0;

const BASE_INK_MAX = 1400;        // starting ink budget (pixels)
const BASE_MARBLE_VALUE = 1;

const UPGRADES = {
    ink: {
        id: 'ink',
        label: 'More Ink',
        desc: '+400 ink budget for drawing',
        baseCost: 20,
        level: 0,
        maxLevel: 15,
        cost(level) { return Math.round(this.baseCost * Math.pow(1.85, level)); }
    },
    marbleValue: {
        id: 'marbleValue',
        label: 'Stone Value',
        desc: 'Each collected stone pays +$1',
        baseCost: 15,
        level: 0,
        maxLevel: 30,
        cost(level) { return Math.round(this.baseCost * Math.pow(1.6, level)); }
    },
    autoDrop: {
        id: 'autoDrop',
        label: 'Auto Drop',
        desc: 'Release stones on their own — faster per level',
        baseCost: 60,
        level: 0,
        maxLevel: 13,
        cost(level) { return Math.round(this.baseCost * Math.pow(1.95, level)); }
    }
};

function getInkMax() {
    return BASE_INK_MAX + UPGRADES.ink.level * 400;
}
function getInkUsed() {
    let total = 0;
    for (const l of lines) total += l.len;
    return total;
}
function getInkRemaining() {
    return Math.max(0, getInkMax() - getInkUsed());
}
function getMarbleValue() {
    return BASE_MARBLE_VALUE + UPGRADES.marbleValue.level;
}

// Final payout for a marble, factoring in bounces.
// Each counted bounce adds 25% value up to a 16-bounce cap (5× max).
function marblePayout(m) {
    const base = getMarbleValue();
    const capped = Math.min(m.bounces || 0, 16);
    const mult = 1 + capped * 0.25;
    return Math.max(1, Math.round(base * mult));
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
    const payout = marblePayout(m);
    money += payout;
    saveGame();
    if (typeof spawnCollectBurst === 'function') {
        spawnCollectBurst(m.x, m.y);
    }
    if (typeof spawnFloatText === 'function') {
        const label = m.bounces > 0 ? '+$' + payout + '  ×' + m.bounces : '+$' + payout;
        spawnFloatText(m.x, m.y - 8, label);
    }
}

// ---- Save / load ----
function saveGame() {
    saveData('save', {
        money,
        lines: lines.map(l => ({ pts: l.pts, len: l.len })),
        upgrades: {
            ink: UPGRADES.ink.level,
            marbleValue: UPGRADES.marbleValue.level,
            autoDrop: UPGRADES.autoDrop.level
        }
    });
}

function loadGame() {
    const s = loadData('save', null);
    if (!s) return;
    money = s.money || 0;
    if (Array.isArray(s.lines)) {
        lines = s.lines
            .filter(l => l && Array.isArray(l.pts) && l.pts.length >= 2)
            .map(l => ({ pts: l.pts, len: l.len || 0 }));
    }
    if (s.upgrades) {
        UPGRADES.ink.level = s.upgrades.ink || 0;
        UPGRADES.marbleValue.level = s.upgrades.marbleValue || 0;
        UPGRADES.autoDrop.level = s.upgrades.autoDrop || 0;
    }
}
