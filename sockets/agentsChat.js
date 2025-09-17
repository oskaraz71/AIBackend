// sockets/agentsChat.js
const { ai } = require("../services/aiModule");

module.exports = function attachAgentsChat(io) {
    console.log("[AgentsChat] init");
    //Agentų laukų ilgiai---
    const NAME_MAX    = Number(process.env.AGENT_NAME_MAX || 80);
    const PERSONA_MAX = Number(process.env.AGENT_PERSONA_MAX || 1000); // 400 per trumpas


    // Vienos sesijos (vieno socket) būsena
    const sessions = new Map(); // socket.id -> { agents, history, timer, nextAt }

    // Defaultiniai 5 agentai (per FE keitaliosim)
    const defaultAgents = [
        { id: "a1", name: "Jonas", persona: "Short, witty, makes jokes. Keeps replies under 50 words." },
        { id: "a2", name: "Angelė", persona: "big mama,longer thoughtful, a bit philosophical. 80–120 words." },
        { id: "a3", name: "Ignas", persona: "Nerdy engineer, cites facts, precise and concise." },
        { id: "a4", name: "Dominykas", persona: "Human-rights advocate, empathetic, inclusive language." },
        { id: "a5", name: "Karolina", persona: "Chill, cool girl, colloquial, friendly." }
    ];

    function newSession(username = "User") {
        return {
            username,
            agents: JSON.parse(JSON.stringify(defaultAgents)),
            history: [], // {id, role:'user'|'agent', name, agentId?, text, ts}
            timer: null,
            nextAt: 0
        };
    }

    // Sudedam paskutinį pokalbį į eilutes
    function renderHistory(history) {
        const last = history.slice(-12);
        return last.map(m => `${m.name}: ${m.text}`).join("\n");
    }

    // Iš Gemini atsakymo nuogas tekstąs---
    function extractText(r) {
        try {
            const t = r?.candidates?.[0]?.content?.parts?.[0]?.text || "";
            return (t || "").trim();
        } catch (_) {
            return "";
        }
    }

    function scheduleNext(socket, reason = "auto") {
        const sess = sessions.get(socket.id);
        if (!sess) return;

        if (sess.timer) {
            clearTimeout(sess.timer);
            sess.timer = null;
        }

        const now = Date.now();
        const base = Math.max(10000, (sess.nextAt || 0) - now); // ne greičiau negu 10 sek
        const jitter = 5000 + Math.floor(Math.random() * 15000); // +5..30s
        const delay = base + jitter;

        sess.nextAt = now + delay;
        console.log(`[AgentsChat] scheduleNext in ${delay}ms (reason=${reason}) for`, socket.id);

        sess.timer = setTimeout(async () => {
            try {
                const s = sessions.get(socket.id);
                if (!s) return;

                // Parenkame atsitiktinį agentą---
                const agent = s.agents[Math.floor(Math.random() * s.agents.length)];
                const chatText = renderHistory(s.history);

                const prompt = `
You are ${agent.name}.
Persona: ${agent.persona}
You are participating in a roundtable discussion with 4 other AIs and a human named "${s.username}".
Reply in your own voice. Provide a coherent response to the most recent posts. If you were mentioned, reply by expanding on the topic.
Format as plain text. No bullets, lists, unless necessary.

Recent chat:
${chatText}

Your reply:
`.trim();

                console.log("[AgentsChat] prompting", agent.name);
                const r = await ai(prompt);
                const text = extractText(r) || "(no answer)";

                const msg = {
                    id: socket.id + ":" + Date.now(),
                    role: "agent",
                    agentId: agent.id,
                    name: agent.name,
                    text,
                    ts: Date.now()
                };

                s.history.push(msg);
                socket.emit("agents:message", msg);

                // ir toliau
                scheduleNext(socket, "after-agent-reply");
            } catch (e) {
                console.error("[AgentsChat] agent error:", e?.message || e);
                // bandom vėliau dar kartą
                scheduleNext(socket, "agent-error");
            }
        }, delay);
    }

    io.on("connection", (socket) => {
        console.log("[AgentsChat] socket connected", socket.id);

        socket.on("agents:join", ({ username } = {}) => {
            const sess = newSession(username || "User");
            sessions.set(socket.id, sess);

            console.log("[AgentsChat] join", socket.id, "username=", username);

            socket.emit("agents:init", {
                agents: sess.agents,
                history: sess.history
            });
        });

        socket.on("agents:update", ({ id, name, persona } = {}) => {
            const s = sessions.get(socket.id);
            if (!s) return;
            const ag = s.agents.find(a => a.id === id);
            if (!ag) return;
            if (typeof name === "string")    ag.name    = name.trim().slice(0, NAME_MAX);
            if (typeof persona === "string") ag.persona = persona.trim().slice(0, PERSONA_MAX);
            console.log("[AgentsChat] update agent", id, "->", ag.name);
            socket.emit("agents:agents", s.agents);
        });

        socket.on("agents:user_message", ({ text } = {}) => {
            const s = sessions.get(socket.id);
            if (!s) return;

            const body = (text || "").toString().trim().slice(0, 1000);
            if (!body) return;

            const msg = {
                id: socket.id + ":" + Date.now(),
                role: "user",
                name: s.username || "User",
                text: body,
                ts: Date.now()
            };

            s.history.push(msg);
            socket.emit("agents:message", msg);

            // paleidžiam agentų „rato“ laikmatį (jei dar neplanuotas)
            scheduleNext(socket, "user-message");
        });

        socket.on("disconnect", () => {
            console.log("[AgentsChat] socket disconnected", socket.id);
            const s = sessions.get(socket.id);
            if (s?.timer) clearTimeout(s.timer);
            sessions.delete(socket.id);
        });
    });
};
