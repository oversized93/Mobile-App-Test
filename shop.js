// ============================================================
//  SHOP — Money, upgrades, save format
// ============================================================

let money = 0;

const UPGRADES = {
    fishValue: {
        id: 'fishValue',
        label: 'Koi Value',
        desc: '+1 base payout per collected koi',
        baseCost: 15,
        level: 0,
        maxLevel: 30,
        cost(level) { return Math.round(this.baseCost * Math.pow(1.6, level)); }
    },
    spawnRate: {
        id: 'spawnRate',
        label: 'Spawn Rate',
        desc: 'Faster spawning — more koi per minute',
        baseCost: 30,
        level: 0,
        maxLevel: 15,
        cost(level) { return Math.round(this.baseCost * Math.pow(1.9, level)); }
    },
    flowMult: {
        id: 'flowMult',
        label: 'Flow Multiplier',
        desc: '+0.1 bonus per second of flow time',
        baseCost: 50,
        level: 0,
        maxLevel: 20,
        cost(level) { return Math.round(this.baseCost * Math.pow(2.0, level)); }
    },
    rock: {
        id: 'rock',
        label: 'Place Rock',
        desc: '+1 rock in inventory — tap the river to place',
        baseCost: 80,
        level: 0,
        maxLevel: 99,
        cost(level) { return Math.round(this.baseCost * Math.pow(1.75, level)); }
    },
    expandGarden: {
        id: 'expandGarden',
        label: 'Expand Garden',
        desc: 'Scale the garden — more drawing room. Forces a redraw.',
        baseCost: 2000,
        level: 0,
        maxLevel: 6,
        cost(level) { return Math.round(this.baseCost * Math.pow(4.5, level)); }
    }
};

function getFishValue() {
    return 1 + UPGRADES.fishValue.level;
}

function getFlowMultiplier() {
    return 0.3 + UPGRADES.flowMult.level * 0.1;
}

function animalPayout(a) {
    const type = ANIMAL_TYPES[a.type] || ANIMAL_TYPES.fish;
    const base = type.baseValue + UPGRADES.fishValue.level;
    const bonus = 1 + a.flowTime * getFlowMultiplier();
    return Math.max(1, Math.round(base * bonus));
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

    // Side effects per upgrade
    if (upgradeId === 'rock') {
        rockInventory++;
    }
    if (upgradeId === 'expandGarden') {
        // Wipe the river and any in-flight animals, back to drawing phase
        river = null;
        rocks.length = 0;
        roundStarted = false;
        resetFlow();
        if (typeof notify === 'function') notify('The garden grew — redraw your river');
    }

    saveGame();
    return true;
}

function onAnimalCollected(a) {
    const payout = animalPayout(a);
    money += payout;
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
    saveData('save', {
        money,
        river: river ? { pts: river.pts, width: river.width, totalLen: river.totalLen } : null,
        rocks: rocks.map(r => ({ pathT: r.pathT })),
        rockInventory,
        roundStarted,
        upgrades: {
            fishValue: UPGRADES.fishValue.level,
            spawnRate: UPGRADES.spawnRate.level,
            flowMult: UPGRADES.flowMult.level,
            rock: UPGRADES.rock.level,
            expandGarden: UPGRADES.expandGarden.level
        }
    });
}

function loadGame() {
    const s = loadData('save', null);
    if (!s) return;
    money = s.money || 0;
    if (s.river && Array.isArray(s.river.pts) && s.river.pts.length >= 2) {
        river = {
            pts: s.river.pts,
            width: s.river.width || getRiverWidth(),
            totalLen: s.river.totalLen || riverTotalLength({ pts: s.river.pts, totalLen: 0 })
        };
        // Recompute totalLen if it looked wrong
        if (!river.totalLen || isNaN(river.totalLen)) {
            river.totalLen = riverTotalLength(river);
        }
    }
    if (Array.isArray(s.rocks)) {
        rocks = s.rocks.map(r => ({ pathT: r.pathT }));
    }
    rockInventory = s.rockInventory || 0;
    roundStarted = !!s.roundStarted;
    if (s.upgrades) {
        UPGRADES.fishValue.level = s.upgrades.fishValue || 0;
        UPGRADES.spawnRate.level = s.upgrades.spawnRate || 0;
        UPGRADES.flowMult.level = s.upgrades.flowMult || 0;
        UPGRADES.rock.level = s.upgrades.rock || 0;
        UPGRADES.expandGarden.level = s.upgrades.expandGarden || 0;
    }
}
