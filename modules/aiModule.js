const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const API_KEY = process.env.GEMINI_API_KEY;

console.log("[aiModule] init Gemini, key set =", !!API_KEY);

function extractText(data) {
    try {
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const text = parts.map(p => (typeof p?.text === "string" ? p.text : "")).join("").trim();
        return text || JSON.stringify(data);
    } catch {
        return JSON.stringify(data);
    }
}

async function ask({ question }) {
    if (!API_KEY) return "GEMINI_API_KEY missing.";

    const payload = {
        contents: [{ role: "user", parts: [{ text: String(question || "") }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
    };

    const res = await fetch(`${API_URL}?key=${encodeURIComponent(API_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("[aiModule] provider !ok", res.status, t);
        return `AI provider error (${res.status}).`;
    }

    const data = await res.json();
    const answer = extractText(data);
    return answer || "No content";
}

module.exports = { ask };
