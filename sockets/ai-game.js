// Backend/sockets/aiGame.js
module.exports = function attachAIGame(io) {
    const rooms = new Map(); // roomId -> { state, timer }

    const makePlayer = (name) => ({
        name, hp: 100, maxHp: 100,
        stamina: 50, maxStamina: 50,
        money: 0, power: 15, defense: 10,
    });

    const snapshot = (players) => ({
        personal: { hp: players.personal.hp, stamina: players.personal.stamina, money: players.personal.money },
        ai:       { hp: players.ai.hp,       stamina: players.ai.stamina,       money: players.ai.money },
    });

    function emitState(roomId, state) { io.to(roomId).emit("game:state", state); }
    function emitLog(roomId, entry)   { io.to(roomId).emit("game:log", entry); }
    function emitOver(roomId, winner, state) { io.to(roomId).emit("game:over", { winner, state }); }

    io.on("connection", (socket) => {
        console.log("[AI-GAME] socket connected", socket.id);
        let joined = null;

        socket.on("game:join", ({ roomId }) => {
            joined = roomId || "ai-game-room-1";
            socket.join(joined);
            console.log("[AI-GAME] join", joined);
            if (!rooms.has(joined)) {
                rooms.set(joined, {
                    state: {
                        phase: "idle",
                        turn: "personal",
                        round: 1,
                        players: {
                            personal: makePlayer("Personal"),
                            ai:       makePlayer("Player 456"),
                        },
                        log: [],
                        winner: null,
                    },
                    timer: null,
                });
            }
        });

        socket.on("game:start", ({ roomId, players }) => {
            const rid = roomId || joined || "ai-game-room-1";
            console.log("[AI-GAME] start", rid);
            const r = rooms.get(rid) || rooms.set(rid, { state: null, timer: null }).get(rid);

            r.state = {
                phase: "playing",
                turn: "personal",
                round: 1,
                players: {
                    personal: { ...makePlayer(players?.personal?.name || "Personal") },
                    ai:       { ...makePlayer(players?.ai?.name || "Player 456") },
                },
                log: [],
                winner: null,
            };

            if (r.timer) clearInterval(r.timer);

            // paprastas pseudo-ciklas kas ~600ms
            r.timer = setInterval(() => {
                if (r.state.phase !== "playing") return;
                const actorKey = r.state.turn;
                const oppKey   = actorKey === "personal" ? "ai" : "personal";
                const A = r.state.players[actorKey];
                const B = r.state.players[oppKey];

                let entry;
                if (A.stamina < 3) {
                    const restored = Math.floor(Math.random() * 11); // 0..10
                    A.stamina = Math.min(A.maxStamina, A.stamina + restored);
                    entry = {
                        t: Date.now(), actor: actorKey, action: "REST", value: restored,
                        after: snapshot(r.state.players),
                    };
                } else {
                    const cost    = Math.floor(Math.random() * (Math.min(10, A.stamina) - 3 + 1)) + 3;
                    const raw     = Math.floor(Math.random() * (A.power + 1));     // 0..power
                    const blocked = Math.floor(Math.random() * (B.defense + 1));   // 0..defense
                    const dmg     = Math.max(0, raw - blocked);
                    const gain    = Math.floor(Math.random() * 11);                // 0..10

                    A.stamina = Math.max(0, A.stamina - cost);
                    A.money  += gain;
                    B.hp      = Math.max(0, B.hp - dmg);

                    entry = {
                        t: Date.now(), actor: actorKey, action: "ATTACK", target: oppKey, value: dmg,
                        info: `cost:${cost}, gain:${gain}, raw:${raw}, blocked:${blocked}`,
                        after: snapshot(r.state.players),
                    };
                }

                r.state.log.push(entry);
                emitLog(rid, entry);

                if (r.state.players[oppKey].hp <= 0) {
                    r.state.phase = "summary";
                    r.state.winner = actorKey;
                    emitOver(rid, actorKey, r.state);
                    clearInterval(r.timer);
                    r.timer = null;
                    return;
                }

                r.state.turn = oppKey;
                if (actorKey === "ai") r.state.round += 1;

                emitState(rid, r.state);
            }, 600);

            emitState(rid, r.state);
        });

        socket.on("game:stop", ({ roomId }) => {
            const rid = roomId || joined || "ai-game-room-1";
            console.log("[AI-GAME] stop", rid);
            const r = rooms.get(rid);
            if (!r) return;
            if (r.timer) { clearInterval(r.timer); r.timer = null; }
            r.state.phase = "idle";
            r.state.winner = null;
            r.state.log = [];
            emitState(rid, r.state);
        });
    });
};
