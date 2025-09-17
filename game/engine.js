export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const randInt = (min, max) => Math.floor(Math.random()*(max-min+1))+min;

export function mkLog({ actor, action, value, target, info, after }) {
    return { t: Date.now(), actor, action, value, target, info, after };
}

export function makePlayer(id, name, avatar) {
    return {
        id, name, avatar,
        stats: { hp:100, maxHp:100, stamina:50, maxStamina:50, money:0, power:15, defense:10 },
        inventory: { items: [], potions: { hp: [], stamina: [] } },
    };
}

export function makeDefaultShop() {
    return {
        items: [
            { id:"item_001", name:"Iron Sword ⚔️",  price:120, bonus:{ power:5 } },
            { id:"item_002", name:"Steel Shield 🛡️", price:150, bonus:{ defense:7 } },
            { id:"item_003", name:"Leather Armor 👕", price:100, bonus:{ defense:4, stamina:2 } },
            { id:"item_004", name:"Ring of Vitality 💍", price:200, bonus:{ maxHp:10 } },
            { id:"item_005", name:"Boots of Swiftness 👢", price:90,  bonus:{ maxStamina:5 } },
        ],
        potionsHp: [
            { id:"potion_001", name:"Small Healing Potion 🧪",  restore_hp:20,  price:30 },
            { id:"potion_002", name:"Medium Healing Potion 🍶", restore_hp:50,  price:70 },
            { id:"potion_003", name:"Large Healing Potion 🍷",  restore_hp:100, price:150 },
            { id:"potion_004", name:"Elixir of Life 🌟",       restore_hp:200, price:300 },
        ],
        potionsSt: [
            { id:"spotion_001", name:"Minor Stamina Potion 🧃",   restore_stamina:10,  price:20 },
            { id:"spotion_002", name:"Lesser Stamina Potion 🥤",  restore_stamina:25,  price:50 },
            { id:"spotion_003", name:"Greater Stamina Potion 🍵", restore_stamina:50,  price:100 },
            { id:"spotion_004", name:"Elixir of Endurance ⚡",    restore_stamina:100, price:200 },
        ],
    };
}

export const snapshot = (players) => ({
    personal: {
        hp: players.personal.stats.hp,
        stamina: players.personal.stats.stamina,
        money: players.personal.stats.money,
    },
    ai: {
        hp: players.ai.stats.hp,
        stamina: players.ai.stats.stamina,
        money: players.ai.stats.money,
    },
});

export function applyAttack(state, actorId) {
    const actor = state.players[actorId];
    const targetId = actorId === "personal" ? "ai" : "personal";
    const target = state.players[targetId];

    if (actor.stats.stamina < 3) {
        return { ok:false, entry: mkLog({ actor:actorId, action:"ATTACK", info:"NOT_ENOUGH_STAMINA" }) };
    }

    const cost    = randInt(3, Math.min(10, actor.stats.stamina));
    const raw     = randInt(0, actor.stats.power);
    const blocked = randInt(0, target.stats.defense);
    const damage  = Math.max(0, raw - blocked);
    const gain    = randInt(0, 10);

    actor.stats.stamina = Math.max(0, actor.stats.stamina - cost);
    actor.stats.money  += gain;
    target.stats.hp     = Math.max(0, target.stats.hp - damage);

    const entry = mkLog({
        actor: actorId, action:"ATTACK", target: targetId, value: damage,
        info: `cost:${cost}, gain:${gain}, raw:${raw}, blocked:${blocked}`,
        after: snapshot(state.players),
    });
    return { ok:true, killed: target.stats.hp <= 0, entry };
}

export function applyRest(state, actorId) {
    const actor = state.players[actorId];
    const restored = randInt(0, 10);
    actor.stats.stamina = clamp(actor.stats.stamina + restored, 0, actor.stats.maxStamina);
    return { entry: mkLog({ actor:actorId, action:"REST", value: restored, after: snapshot(state.players) }) };
}

export function applyDrink(state, actorId, potion_id) {
    const A = state.players[actorId];

    const iHp = A.inventory.potions.hp.findIndex(p => p.id === potion_id);
    if (iHp >= 0) {
        const p = A.inventory.potions.hp.splice(iHp,1)[0];
        A.stats.hp = clamp(A.stats.hp + p.restore_hp, 0, A.stats.maxHp);
        const rest = randInt(0, 10);
        A.stats.stamina = clamp(A.stats.stamina + rest, 0, A.stats.maxStamina);
        return { ok:true, entry: mkLog({
                actor:actorId, action:"DRINK_POTION", value:p.restore_hp,
                info:`HP +${p.restore_hp}, passive stamina +${rest}`, after: snapshot(state.players)
            })};
    }

    const iSt = A.inventory.potions.stamina.findIndex(p => p.id === potion_id);
    if (iSt >= 0) {
        const p = A.inventory.potions.stamina.splice(iSt,1)[0];
        A.stats.stamina = clamp(A.stats.stamina + p.restore_stamina, 0, A.stats.maxStamina);
        const rest = randInt(0, 10);
        A.stats.stamina = clamp(A.stats.stamina + rest, 0, A.stats.maxStamina);
        return { ok:true, entry: mkLog({
                actor:actorId, action:"DRINK_POTION", value:p.restore_stamina,
                info:`Stamina +${p.restore_stamina}, passive +${rest}`, after: snapshot(state.players)
            })};
    }

    return { ok:false, entry: mkLog({ actor:actorId, action:"DRINK_POTION", info:"NOT_FOUND" }) };
}

export function applyBuy(state, actorId, item_id) {
    const A = state.players[actorId];
    const item =
        state.shop.items.find(i => i.id === item_id) ||
        state.shop.potionsHp.find(p => p.id === item_id) ||
        state.shop.potionsSt.find(p => p.id === item_id);

    if (!item) return { ok:false, entry: mkLog({ actor:actorId, action:"BUY_ITEM", info:"NOT_FOUND" }) };
    const price = item.price ?? 0;
    if ((A.stats.money ?? 0) < price) {
        return { ok:false, entry: mkLog({ actor:actorId, action:"BUY_ITEM", info:"NOT_ENOUGH_MONEY" }) };
    }

    A.stats.money -= price;

    // potion?
    if ("restore_hp" in item) {
        A.inventory.potions.hp.push(item);
    } else if ("restore_stamina" in item) {
        A.inventory.potions.stamina.push(item);
    } else {
        // item – pastovūs bonusai
        A.inventory.items.push(item);
        const b = item.bonus || {};
        if (b.maxHp)       A.stats.maxHp += b.maxHp;
        if (b.maxStamina)  A.stats.maxStamina += b.maxStamina;
        if (b.hp)          A.stats.hp = clamp(A.stats.hp + b.hp, 0, A.stats.maxHp);
        if (b.stamina)     A.stats.stamina = clamp(A.stats.stamina + b.stamina, 0, A.stats.maxStamina);
        if (b.power)       A.stats.power += b.power;
        if (b.defense)     A.stats.defense += b.defense;
    }

    const rest = randInt(0, 10); // ne-attack – pasyvus stamina atkūrimas
    A.stats.stamina = clamp(A.stats.stamina + rest, 0, A.stats.maxStamina);

    return { ok:true, entry: mkLog({
            actor:actorId, action:"BUY_ITEM",
            info:`Bought ${item.id} for ${price}, passive stamina +${rest}`,
            after: snapshot(state.players),
        })};
}
