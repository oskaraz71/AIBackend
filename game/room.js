import { AIAgent } from "../ai/agent.js";
import { parseAiAction } from "./schema.js";
import { makePlayer, makeDefaultShop, applyAttack, applyBuy, applyDrink, applyRest } from "./engine.js";

const withTimeout = (p, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("AI_TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
});

export class GameRoom {
    constructor({ io, roomId, apiKey, model = "gemini-1.5-flash" }) {
        this.io = io;
        this.id = roomId;
        this.apiKey = apiKey;
        this.model = model;

        this.state = {
            phase: "idle",
            turn: "personal",
            round: 1,
            players: {
                personal: makePlayer("personal", "Personal"),
                ai:       makePlayer("ai", "Player 456"),
            },
            shop: makeDefaultShop(),
            log: [],
            winner: null,
        };

        this.running = false;
        this.locked  = false;
        this.agents  = { personal: null, ai: null };
    }

    async start({ personalPrompt, aiPrompt, personalAvatar, aiAvatar }) {
        if (this.running) return;
        this.running = true;
        this.state.phase = "playing";
        this.state.turn  = "personal";
        this.state.round = 1;
        if (personalAvatar) this.state.players.personal.avatar = personalAvatar;
        if (aiAvatar)       this.state.players.ai.avatar       = aiAvatar;

        this.agents.personal = new AIAgent({
            apiKey: this.apiKey, model: this.model, initialPrompt: personalPrompt, playerId: "personal",
        });
        this.agents.ai = new AIAgent({
            apiKey: this.apiKey, model: this.model, initialPrompt: aiPrompt, playerId: "ai",
        });

        this.broadcastState();
        this.loop();
    }

    stop() {
        this.running = false;
        this.state.phase = "idle";
        this.state.winner = null;
        this.state.log = [];
        this.broadcastState();
    }

    broadcastState() {
        this.io.to(this.id).emit("game:state", {
            phase: this.state.phase, turn: this.state.turn, round: this.state.round,
            players: this.state.players, log: this.state.log, winner: this.state.winner,
        });
    }
    broadcastLog(entry) { this.io.to(this.id).emit("game:log", entry); }
    broadcastOver(winner){ this.io.to(this.id).emit("game:over", { winner, state: this.state }); }

    async loop() {
        if (!this.running || this.locked) return;
        this.locked = true;

        try {
            const actorId = this.state.turn;
            const oppId   = actorId === "personal" ? "ai" : "personal";
            const agent   = this.agents[actorId];

            const input = {
                now: {
                    self: this.state.players[actorId].stats,
                    opponent: this.state.players[oppId].stats,
                },
                lastOpponentAction: this.state.log.at(-1) || null,
                shop: this.state.shop, // gali siųsti rečiau, jei norėsi
            };

            let raw = null;
            try { raw = await withTimeout(agent.sendTurn(input), 4000); } catch (_) {}

            let action = null;
            if (raw) {
                const parsed = parseAiAction(raw);
                if (parsed.ok) action = parsed.value;
            }
            if (!action) {
                action = this.state.players[actorId].stats.stamina >= 3
                    ? { action: "ATTACK", details: {} }
                    : { action: "REST", details: {} };
            }

            let res;
            if (action.action === "ATTACK") {
                res = applyAttack(this.state, actorId);
                if (!res.ok) res = applyRest(this.state, actorId);
            } else if (action.action === "BUY_ITEM") {
                res = applyBuy(this.state, actorId, action.details.item_id);
            } else if (action.action === "DRINK_POTION") {
                res = applyDrink(this.state, actorId, action.details.potion_id);
                if (!res.ok) res = applyRest(this.state, actorId);
            } else {
                res = applyRest(this.state, actorId);
            }

            this.state.log.push(res.entry);
            this.broadcastLog(res.entry);

            if (res.killed) {
                this.state.phase = "summary";
                this.state.winner = actorId;
                this.broadcastOver(actorId);
                this.locked = false;
                return;
            }

            this.state.turn = oppId;
            if (actorId === "ai") this.state.round += 1;

            this.broadcastState();

            setTimeout(() => {
                this.locked = false;
                this.loop();
            }, 450);
        } catch (e) {
            this.locked = false;
            this.io.to(this.id).emit("game:error", { code: "LOOP_ERROR", message: String(e?.message || e) });
            this.stop();
        }
    }
}
