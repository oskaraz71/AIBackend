const { ask: askGemini } = require("../modules/aiModule");

// Health
exports.health = async (_req, res) => {
    return res.json({
        ok: true,
        provider: "gemini-2.0-flash",
        hasApiKey: !!process.env.GEMINI_API_KEY,
        time: new Date().toISOString()
    });
};

// Q&A endpoint
exports.ask = async (req, res) => {
    try {
        const question = (req.body?.question || "").toString().trim();
        if (!question) return res.status(400).json({ error: "Question is required" });

        console.log("[aiController] /ask qLen=", question.length);
        const answer = await askGemini({ question });
        return res.json({ answer: String(answer || "") });
    } catch (e) {
        console.error("[aiController] error", e);
        return res.status(500).json({ error: "AI server error" });
    }
};
