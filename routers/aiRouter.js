// routers/aiRouter.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const { ai } = require("../services/aiModule");

const router = express.Router();

router.get("/health", (_req, res) => {
    res.json({
        ok: true,
        provider: process.env.GEMINI_MODEL || "gemini-2.0-flash",
        hasApiKey: !!process.env.GEMINI_API_KEY,
        time: new Date().toISOString(),
    });
});

// Q->A
router.post("/ask", async (req, res) => {
    try {
        const { question } = req.body || {};
        if (!question || typeof question !== "string") {
            return res.status(400).json({ success: false, message: "Missing question" });
        }
        const r = await ai(question);
        const text = r?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "(no answer)";
        res.json({ success: true, answer: text });
    } catch (e) {
        console.error("[aiRouter] /ask error", e);
        res.status(500).json({ success: false, message: e.message || "AI error" });
    }
});

// ───────────────────────────────────────────────────────────
//  SITE GENERATOR (daug kriterijų)
//  POST /api/ai/generate-site
//  Body pavyzdys:
//  {
//    "topic": "animal shelter",
//    "brand": "Paw Haven",
//    "language": "lt",
//    "primaryColor": "#2563eb",
//    "accentColor": "#16a34a",
//    "tone": "friendly",
//    "sections": ["hero","features","testimonials","faq"],
//    "cta": "Adopt now",
//    "contactEmail": "info@example.com"
//  }
// Sugeneruoja: /site/index.html, /about.html, /contact.html, /terms.html
// ───────────────────────────────────────────────────────────
router.post("/generate-site", async (req, res) => {
    function extractHtmlFromResponse(any) {
        const text = typeof any === "string"
            ? any
            : (any?.candidates?.[0]?.content?.parts?.[0]?.text || "");
        const match = text.match(/```html([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
        return (match ? match[1] : text).trim();
    }
    function ensureDir(dir) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    function createHtmlFile(content, fileName) {
        const outDir = path.join(__dirname, "..", "site");
        ensureDir(outDir);
        const filePath = path.join(outDir, `${fileName}.html`);
        fs.writeFileSync(filePath, content, "utf8");
        console.log(`✅ ${fileName}.html created at: ${filePath}`);
        return { name: fileName, path: filePath, url: `/site/${fileName}.html` };
    }

    // Inputs + defaultai
    const {
        topic = "animal shelter",
        brand = "My Website",
        language = "en",
        primaryColor = "#3b82f6",
        accentColor = "#16a34a",
        tone = "professional",
        sections = ["hero","features","faq"],
        cta = "Get started",
        contactEmail = "info@example.com",
    } = req.body || {};

    const lang = (language || "en").toLowerCase().startsWith("lt") ? "lt" : "en";

    // Bendra dalis promptams
    const common = `
Language: ${lang.toUpperCase()}.
Brand name: ${brand}.
Tone: ${tone}.

Colors: use CSS variables --primary: ${primaryColor}; --accent: ${accentColor}.
Navigation links (absolute):
- Home: /site/index.html
- About: /site/about.html
- Contact: /site/contact.html
- Terms: /site/terms.html

Requirements:
- Return ONLY pure HTML inside a single \`\`\`html fence (no extra prose).
- Include a small <style> in <head> using CSS variables (no external CDNs).
- Modern, responsive layout. Semantic HTML5.
- Header with nav, footer with brand and year.
- Avoid external scripts. Keep icons as plain SVG if needed.
`.trim();

    // Dinaminės dalys
    const sectionsHint = Array.isArray(sections) && sections.length
        ? `Prefer sections: ${sections.join(", ")}.`
        : `Use a simple hero + 2-3 content sections.`;

    const CTA = cta ? `Primary CTA text: "${cta}".` : "";

    // Prompts
    const prompts = {
        index: `
${common}

Create a complete landing page for "${topic}".
${sectionsHint}
${CTA}
Hero must include headline, supporting text, CTA button and illustration placeholder.

`.trim(),

        about: `
${common}

Create an "About" page for "${topic}" with sections:
- Our Mission
- Story
- Values
- Team (simple cards)
Include a small hero/header intro.

`.trim(),

        contact: `
${common}

Create a "Contact" page for "${topic}" with:
- Contact info block (email ${contactEmail}).
- Form (name, email, subject, message, consent checkbox).
- Client-side validation via attributes only (required, type, minlength).
- Map placeholder section.

`.trim(),

        terms: `
${common}

Create a clear "Terms & Conditions" page with headings:
Introduction, Definitions, Use of Service, Privacy, Intellectual Property,
Limitation of Liability, Governing Law, Contact.
Use readable typography.

`.trim(),
    };

    try {
        const files = [];
        // index
        const r1 = await ai(prompts.index);
        files.push(createHtmlFile(extractHtmlFromResponse(r1), "index"));
        // about
        const r2 = await ai(prompts.about);
        files.push(createHtmlFile(extractHtmlFromResponse(r2), "about"));
        // contact
        const r3 = await ai(prompts.contact);
        files.push(createHtmlFile(extractHtmlFromResponse(r3), "contact"));
        // terms
        const r4 = await ai(prompts.terms);
        files.push(createHtmlFile(extractHtmlFromResponse(r4), "terms"));

        res.json({ success: true, files });
    } catch (e) {
        console.error("[aiRouter] /generate-site error", e);
        res.status(500).json({ success: false, message: e.message || "Generate error" });
    }
});

module.exports = router;
