// services/aiModule.js
// -> Naudoja global fetch (Node 18+). Jokio 'node-fetch' nebereikia.

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

async function ai(prompt) {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }]}],
        }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Gemini error ${res.status}: ${text}`);
    }
    return res.json();
}

module.exports = { ai };
