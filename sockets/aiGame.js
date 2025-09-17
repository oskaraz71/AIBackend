// Backend/sockets/aiGame.js
module.exports = function attachAIGame(io) {
    const rooms = new Map(); // roomId -> { state, prompts, priceMult, sessions, cfg, meta, busy }

    // ========= DEFAULT CONFIG =========
    const DEFAULTS = {
        USE_GEMINI: String(process.env.USE_GEMINI || "1") !== "0",
        PRICE_MULT: Number(process.env.AI_GAME_PRICE_MULT || 0.35),
        TURN_MS: Number(process.env.AI_GAME_TURN_MS || 2500),         // lėtas žaidimas
        GEMINI_EVERY_N: Number(process.env.AI_GAME_GEMINI_EVERY_N || 2), // kas N-ą ėjimą
        GEMINI_MIN_MS: Number(process.env.AI_GAME_GEMINI_MIN_MS || 5000) // min tarpas tarp kvietimų vienam aktoriui
    };

    // ========= GEMINI =========
    let geminiModel = null, GoogleGenerativeAI = null;
    (function initGemini() {
        if (!DEFAULTS.USE_GEMINI) { console.warn("[AI-GAME][BE] Gemini disabled by env"); return; }
        try {
            ({ GoogleGenerativeAI } = require("@google/generative-ai"));
            const key = process.env.GEMINI_API_KEY;
            if (!key) { console.warn("[AI-GAME][BE] GEMINI_API_KEY missing"); return; }
            const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
            const genAI = new GoogleGenerativeAI(key);
            geminiModel = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 256 }
            });
            console.log("[AI-GAME][BE] Gemini model ready:", modelName);
        } catch (e) {
            console.warn("[AI-GAME][BE] Gemini init failed:", e.message);
            geminiModel = null;
        }
    })();

    // ========= SHOP =========
    function makeDefaultShop() {
        return {
            items: [
                { id:"item_001", name:"Iron Sword ⚔️",        price:120, bonus:{ power:5 } },
                { id:"item_002", name:"Steel Shield 🛡️",      price:150, bonus:{ defense:7 } },
                { id:"item_003", name:"Leather Armor 👕",      price:100, bonus:{ defense:4, stamina:2 } },
                { id:"item_004", name:"Ring of Vitality 💍",   price:200, bonus:{ maxHp:10 } },
                { id:"item_005", name:"Boots of Swiftness 👢", price:90,  bonus:{ maxStamina:5 } },
            ],
            potionsHp: [
                { id:"potion_001", name:"Small Healing Potion 🧪",  restore_hp:20,  price:30  },
                { id:"potion_002", name:"Medium Healing Potion 🍶", restore_hp:50,  price:70  },
                { id:"potion_003", name:"Large Healing Potion 🍷",  restore_hp:100, price:150 },
            ],
            potionsSt: [
                { id:"spotion_001", name:"Minor Stamina Potion 🧃",   restore_stamina:10,  price:20  },
                { id:"spotion_002", name:"Lesser Stamina Potion 🥤",  restore_stamina:25,  price:50  },
                { id:"spotion_003", name:"Greater Stamina Potion 🍵", restore_stamina:50,  price:100 },
            ],
        };
    }
    function scaleShopPrices(shop, mult = 1) {
        const s = JSON.parse(JSON.stringify(shop));
        const scale = (p) => Math.max(1, Math.round(p * mult));
        s.items.forEach(i => i.price = scale(i.price));
        s.potionsHp.forEach(p => p.price = scale(p.price));
        s.potionsSt.forEach(p => p.price = scale(p.price));
        return s;
    }

    // ========= HELPERS =========
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

    const makePlayer = (name) => ({
        name,
        stats: { hp:100, maxHp:100, stamina:50, maxStamina:50, money:0, power:15, defense:10 },
        inventory: { items: [], potions: { hp: [], stamina: [] } },
    });

    const snapshot = (players) => ({
        personal: { hp: players.personal.stats.hp, stamina: players.personal.stats.stamina, money: players.personal.stats.money },
        ai:       { hp: players.ai.stats.hp,       stamina: players.ai.stats.stamina,       money: players.ai.stats.money },
    });

    const emitState = (roomId, state) => io.to(roomId).emit("game:state", {
        phase: state.phase, turn: state.turn, round: state.round, winner: state.winner, log: state.log,
        players: {
            personal: { name: state.players.personal.name, ...state.players.personal.stats },
            ai:       { name: state.players.ai.name,       ...state.players.ai.stats },
        },
    });
    const emitLog  = (roomId, entry) => io.to(roomId).emit("game:log", entry);
    const emitOver = (roomId, winner, state) => io.to(roomId).emit("game:over", { winner, state });

    // ========= ACTIONS =========
    function applyAttack(state, actorKey) {
        const Bk = actorKey === "personal" ? "ai" : "personal";
        const A = state.players[actorKey].stats;
        const B = state.players[Bk].stats;

        if (A.stamina < 3) {
            return { entry: { t: Date.now(), actor: actorKey, action: "ATTACK", info: "NOT_ENOUGH_STAMINA", after: snapshot(state.players) }, killed:false };
        }
        const cost    = ri(3, Math.min(10, A.stamina));
        const raw     = ri(0, A.power);
        const blocked = ri(0, B.defense);
        const dmg     = Math.max(0, raw - blocked);
        const gain    = ri(2, 12); // kiek dosniau – greičiau užteks pirkiniams

        A.stamina = Math.max(0, A.stamina - cost);
        A.money  += gain;
        B.hp      = Math.max(0, B.hp - dmg);

        const entry = { t: Date.now(), actor: actorKey, action: "ATTACK", target: Bk, value: dmg,
            info:`cost:${cost}, gain:${gain}, raw:${raw}, blocked:${blocked}`, after: snapshot(state.players) };
        return { entry, killed: B.hp <= 0 };
    }
    function applyRest(state, actorKey) {
        const S = state.players[actorKey].stats;
        const restored = ri(0, 10);
        S.stamina = clamp(S.stamina + restored, 0, S.maxStamina);
        return { entry: { t: Date.now(), actor: actorKey, action: "REST", value: restored, after: snapshot(state.players) } };
    }
    function applyDrink(state, actorKey, potionId) {
        const P = state.players[actorKey];
        let p = null, info = "";
        const iHp = P.inventory.potions.hp.findIndex(x => x.id === potionId);
        if (iHp >= 0) { p = P.inventory.potions.hp.splice(iHp,1)[0]; P.stats.hp = clamp(P.stats.hp + p.restore_hp, 0, P.stats.maxHp); info = `HP +${p.restore_hp}`; }
        const iSt = p ? -1 : P.inventory.potions.stamina.findIndex(x => x.id === potionId);
        if (iSt >= 0) { p = P.inventory.potions.stamina.splice(iSt,1)[0]; P.stats.stamina = clamp(P.stats.stamina + p.restore_stamina, 0, P.stats.maxStamina); info = `Stamina +${p.restore_stamina}`; }
        if (!p) return { entry: { t: Date.now(), actor: actorKey, action:"DRINK_POTION", info:"NOT_FOUND", after: snapshot(state.players) } };
        const passive = ri(0, 10);
        P.stats.stamina = clamp(P.stats.stamina + passive, 0, P.stats.maxStamina);
        return { entry: { t: Date.now(), actor: actorKey, action:"DRINK_POTION", value: p.restore_hp || p.restore_stamina, info:`${info}, passive +${passive}`, after: snapshot(state.players) } };
    }
    function applyBuy(state, actorKey, item) {
        const P = state.players[actorKey], S = P.stats;
        if (!item) return { entry:{ t:Date.now(), actor:actorKey, action:"BUY_ITEM", info:"NOT_FOUND", after:snapshot(state.players)} };
        if ((S.money||0) < (item.price||0)) return { entry:{ t:Date.now(), actor:actorKey, action:"BUY_ITEM", info:`NOT_ENOUGH_MONEY:${item.price}`, after:snapshot(state.players)} };

        if ("restore_hp" in item) { S.money -= item.price; P.inventory.potions.hp.push(item); }
        else if ("restore_stamina" in item) { S.money -= item.price; P.inventory.potions.stamina.push(item); }
        else {
            if (P.inventory.items.some(i => i.id === item.id)) {
                return { entry:{ t:Date.now(), actor:actorKey, action:"BUY_ITEM", info:`ALREADY_OWN:${item.id}`, after:snapshot(state.players)} };
            }
            S.money -= item.price;
            P.inventory.items.push(item);
            const b = item.bonus || {};
            if (b.maxHp)      S.maxHp += b.maxHp;
            if (b.maxStamina) S.maxStamina += b.maxStamina;
            if (b.hp)         S.hp = clamp(S.hp + b.hp, 0, S.maxHp);
            if (b.stamina)    S.stamina = clamp(S.stamina + b.stamina, 0, S.maxStamina);
            if (b.power)      S.power += b.power;
            if (b.defense)    S.defense += b.defense;
            S.hp = clamp(S.hp, 0, S.maxHp); S.stamina = clamp(S.stamina, 0, S.maxStamina);
        }
        const passive = ri(0, 10);
        S.stamina = clamp(S.stamina + passive, 0, S.maxStamina);
        return { entry:{ t:Date.now(), actor:actorKey, action:"BUY_ITEM", info:`Bought ${item.id} for ${item.price}, passive +${passive}`, after:snapshot(state.players)} };
    }

    // ========= HEURISTIC FALLBACK (agresyvesnė) =========
    function chooseActionHeuristic(state, actorKey) {
        const A = state.players[actorKey], S = A.stats, shop = state.shop;
        const missingHp = S.maxHp - S.hp;
        const lowHp = S.hp <= 60 || missingHp >= 25;
        const lowSt = S.stamina <= 5, brokeSt = S.stamina < 3;

        // jei turim potions – naudokim
        if (A.inventory.potions.hp.length && lowHp) {
            const best = [...A.inventory.potions.hp].sort((a,b)=>b.restore_hp - a.restore_hp)[0];
            return { type:"DRINK", id: best.id };
        }
        if (A.inventory.potions.stamina.length && lowSt) {
            const best = [...A.inventory.potions.stamina].sort((a,b)=>b.restore_stamina - a.restore_stamina)[0];
            return { type:"DRINK", id: best.id };
        }

        // pirk pigiausią naudingą potion’ą kai tik įperkama
        const cheapHp = shop.potionsHp.filter(p=>p.price<=S.money).sort((a,b)=>a.price-b.price)[0];
        if (lowHp && cheapHp) return { type:"BUY", item: cheapHp };
        const cheapSt = shop.potionsSt.filter(p=>p.price<=S.money).sort((a,b)=>a.price-b.price)[0];
        if (brokeSt && cheapSt) return { type:"BUY", item: cheapSt };

        // ankstyvas gear prioritetas
        const own = new Set(A.inventory.items.map(i=>i.id));
        const order = ["item_005","item_001","item_002","item_003","item_004"]; // boots→sword→shield...
        for (const id of order) {
            const it = shop.items.find(x=>x.id===id);
            if (it && !own.has(id) && it.price <= S.money) return { type:"BUY", item: it };
        }

        if (brokeSt) return { type:"REST" };
        return { type:"ATTACK" };
    }

    // ========= PROMPTS / SESSIONS =========
    const BASE_RULES = `
Griežtos taisyklės:
- Vienas veiksmas per ėjimą: ATTACK | BUY_ITEM | DRINK_POTION | REST.
- ATTACK: stamina ≥ 3; kaina 3–10; žala 0..power; priešas blokuoja 0..defense; gauni 0..12 money.
- BUY_ITEM: galima tik jei turi pakankamai money; naudok shop ID.
- DRINK_POTION: tik jei turi inventoriuje; nurodyk potion_id.
- REST: neatakuoji; stamina atsistato pasyviai (0..10).
Grąžink TIK JSON:
{ "action":"ATTACK"|"BUY_ITEM"|"DRINK_POTION"|"REST", "details":{"item_id"?: "...", "potion_id"?: "..."} }
`.trim();

    function buildInitialKB(personaText, actorName, shop, priceMult) {
        const persona = (personaText && String(personaText).trim()) ||
            "drąsus, ryžtingas ir greitas — visada siekia pulti ir dominuoti";
        const shopJson = JSON.stringify(shop, null, 2);
        const strategy = `
Strategija: jei HP žemas – pirk/gerk HP potion; jei stamina < 3 – pirk STAMINA potion (jei įperkama), kitaip REST.
Ankstyvas prioritetas: Boots (item_005) → Sword (item_001) → Shield (item_002). Pirk kai tik įperkama ir dar neturi.
`.trim();

        return `
Tu esi ${actorName}: ${persona}
${BASE_RULES}

# Shop (mult=${priceMult} pritaikytas į kainas, atmink ID/kainas/bonusus):
${shopJson}

${strategy}
`.trim();
    }

    function createSessions(room) {
        if (!geminiModel || !room.cfg.useGemini) return null;
        const mk = (key, name) => {
            const persona = room.prompts?.[key] || "";
            const kb = buildInitialKB(persona, name, room.state.shop, room.priceMult);
            return geminiModel.startChat({
                history: [{ role: "user", parts: [{ text: kb }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 256 },
            });
        };
        return { personal: mk("personal", room.state.players.personal.name), ai: mk("ai", room.state.players.ai.name) };
    }

    function buildTurnDelta(state, actorKey) {
        const oppKey = actorKey === "personal" ? "ai" : "personal";
        const last = state.log[state.log.length - 1] || null;
        const you = state.players[actorKey], enemy = state.players[oppKey];
        const inv = {
            items: you.inventory.items.map(i => i.id),
            potions: { hp: you.inventory.potions.hp.map(p => p.id), stamina: you.inventory.potions.stamina.map(p => p.id) }
        };
        return {
            phase: state.phase, round: state.round, turn: actorKey,
            you: { stats: you.stats, inventory: inv },
            enemy: { stats: enemy.stats },
            last_action: last ? { actor: last.actor, action: last.action, value: last.value || 0, info: last.info || "" } : null,
            expect_json: { action:["ATTACK","BUY_ITEM","DRINK_POTION","REST"] }
        };
    }
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error("AI_TIMEOUT")), ms))]);

    async function chooseActionGemini(room, state, actorKey) {
        if (!geminiModel || !room.cfg.useGemini || !room.sessions?.[actorKey]) return null;

        // throttle: kas N-ą ėjimą + min intervalas
        const cnt = (room.meta.geminiTurns[actorKey] = (room.meta.geminiTurns[actorKey] || 0) + 1);
        if (room.cfg.geminiEveryN > 1 && cnt % room.cfg.geminiEveryN !== 0) return null;

        const now = Date.now(), last = room.meta.geminiLastAt[actorKey] || 0;
        if (now - last < room.cfg.geminiMinMs) return null;

        try {
            const delta = buildTurnDelta(state, actorKey);
            const res = await withTimeout(room.sessions[actorKey].sendMessage(JSON.stringify(delta)), room.cfg.geminiMinMs - 50);
            const text = res?.response?.text?.() || "";
            let data = null; try { data = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); if (m) data = JSON.parse(m[0]); }
            if (!data || typeof data !== "object") throw new Error("AI_NOT_JSON");
            room.meta.geminiLastAt[actorKey] = Date.now();
            return sanitizeDecision(state, actorKey, data);
        } catch (e) {
            console.warn("[AI-GAME][BE] Gemini turn failed:", e.message);
            return null;
        }
    }

    function sanitizeDecision(state, actorKey, raw) {
        const act = String(raw?.action || "").toUpperCase();
        if (act === "ATTACK") return { type: "ATTACK" };
        if (act === "REST")   return { type: "REST" };
        if (act === "DRINK_POTION") {
            const id = raw?.details?.potion_id || raw?.potion_id || raw?.id;
            if (!id) return { type:"REST" };
            const P = state.players[actorKey].inventory;
            const has = P.potions.hp.some(p=>p.id===id) || P.potions.stamina.some(p=>p.id===id);
            return has ? { type:"DRINK", id } : { type:"REST" };
        }
        if (act === "BUY_ITEM") {
            const id = raw?.details?.item_id || raw?.item_id || raw?.id;
            if (!id) return { type:"REST" };
            const s = state.shop;
            const item = s.items.find(i=>i.id===id) || s.potionsHp.find(i=>i.id===id) || s.potionsSt.find(i=>i.id===id);
            if (!item) return { type:"REST" };
            if ((item.price || 0) > state.players[actorKey].stats.money) return { type:"REST" };
            return { type:"BUY", item };
        }
        return { type: "REST" };
    }

    // ========= MAIN LOOP =========
    async function tickRoom(rid) {
        const room = rooms.get(rid); if (!room) return;
        if (room.busy) return; room.busy = true;

        try {
            const r = room.state; if (!r || r.phase !== "playing") return;
            const actorKey = r.turn, oppKey = actorKey === "personal" ? "ai" : "personal";

            let decision = await chooseActionGemini(room, r, actorKey);
            if (!decision) decision = chooseActionHeuristic(r, actorKey);
            console.log("[AI-GAME][BE] decide", actorKey, decision);

            let entry;
            if (decision.type === "ATTACK") {
                const res = applyAttack(r, actorKey); entry = res.entry; r.log.push(entry); emitLog(rid, entry);
                if (res.killed) { r.phase = "summary"; r.winner = actorKey; emitOver(rid, actorKey, r); console.log("[AI-GAME][BE] GAME OVER:", actorKey); room.busy=false; return; }
            } else if (decision.type === "REST") {
                entry = applyRest(r, actorKey).entry; r.log.push(entry); emitLog(rid, entry);
            } else if (decision.type === "DRINK") {
                entry = applyDrink(r, actorKey, decision.id).entry; r.log.push(entry); emitLog(rid, entry);
            } else if (decision.type === "BUY") {
                entry = applyBuy(r, actorKey, decision.item).entry; r.log.push(entry); emitLog(rid, entry);
            }

            r.turn = oppKey; if (actorKey === "ai") r.round += 1;
            emitState(rid, r);

            const delay = room.cfg?.turnMs || DEFAULTS.TURN_MS;
            setTimeout(() => { room.busy = false; tickRoom(rid); }, delay);
        } catch (e) {
            console.error("[AI-GAME][BE] tickRoom error:", e);
            room.busy = false;
            setTimeout(() => tickRoom(rid), (room.cfg?.turnMs || DEFAULTS.TURN_MS));
        }
    }

    // ========= SOCKETS =========
    io.on("connection", (socket) => {
        console.log("[AI-GAME][BE] socket connected", socket.id);
        let joined = null;

        socket.on("game:join", ({ roomId }, ack) => {
            joined = roomId || "ai-game-1";
            socket.join(joined);
            console.log("[AI-GAME][BE] join", joined, "by", socket.id);

            if (!rooms.has(joined)) {
                rooms.set(joined, {
                    state: {
                        phase:"idle", turn:"personal", round:1, winner:null, log:[],
                        players: { personal: makePlayer("Personal"), ai: makePlayer("Player 456") },
                        shop: makeDefaultShop()
                    },
                    prompts: null,
                    priceMult: DEFAULTS.PRICE_MULT,
                    sessions: null,
                    cfg: { useGemini: DEFAULTS.USE_GEMINI, turnMs: DEFAULTS.TURN_MS, geminiEveryN: DEFAULTS.GEMINI_EVERY_N, geminiMinMs: DEFAULTS.GEMINI_MIN_MS },
                    meta: { geminiLastAt:{personal:0,ai:0}, geminiTurns:{personal:0,ai:0} },
                    busy: false,
                });
            }
            ack && ack({ ok:true, roomId:joined });
        });

        socket.on("game:start", ({ roomId, players, prompts }, ack) => {
            const rid = roomId || joined || "ai-game-1";
            console.log("[AI-GAME][BE] start ->", rid, "by", socket.id);

            const prev = rooms.get(rid) || {};
            const priceMult = (typeof prompts?.priceMultiplier === "number" ? prompts.priceMultiplier : null) ?? prev.priceMult ?? DEFAULTS.PRICE_MULT;

            rooms.set(rid, {
                ...prev,
                prompts: prompts || prev.prompts || null,
                priceMult,
                cfg: {
                    useGemini: (prompts && "useGemini" in prompts) ? !!prompts.useGemini : (prev.cfg?.useGemini ?? DEFAULTS.USE_GEMINI),
                    turnMs: Number(prompts?.turnDelayMs || prompts?.turnMs || prev.cfg?.turnMs || DEFAULTS.TURN_MS),
                    geminiEveryN: Number(prompts?.geminiEveryNTurns || prev.cfg?.geminiEveryN || DEFAULTS.GEMINI_EVERY_N),
                    geminiMinMs: Number(prompts?.geminiMinMs || prev.cfg?.geminiMinMs || DEFAULTS.GEMINI_MIN_MS),
                },
                meta: { geminiLastAt:{personal:0,ai:0}, geminiTurns:{personal:0,ai:0} },
            });

            const room = rooms.get(rid);
            room.state = {
                phase:"playing", turn:"personal", round:1, winner:null, log:[],
                players: { personal: { ...makePlayer(players?.personal?.name || "Personal") }, ai: { ...makePlayer(players?.ai?.name || "Player 456") } },
                shop: scaleShopPrices(makeDefaultShop(), priceMult)
            };

            console.log("[AI-GAME][BE] cfg:", room.cfg, "priceMult:", room.priceMult);
            emitState(rid, room.state);

            // sessions su pradine „atmintimi“
            room.sessions = createSessions(room);
            console.log("[AI-GAME][BE] sessions:", { personal: !!room.sessions?.personal, ai: !!room.sessions?.ai });

            ack && ack({ ok:true });
            setTimeout(() => tickRoom(rid), room.cfg.turnMs);
        });

        socket.on("game:stop", ({ roomId }, ack) => {
            const rid = roomId || joined || "ai-game-1";
            console.log("[AI-GAME][BE] stop", rid, "by", socket.id);
            const room = rooms.get(rid); if (!room) return ack && ack({ ok:true });
            room.busy = false;
            room.state.phase = "idle"; room.state.winner = null; room.state.log = [];
            emitState(rid, room.state);
            ack && ack({ ok:true });
        });
    });
};
