const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();

/**
 * GET /api/scrape/android?url=https://en.uptodown.com/android/rpg
 *   arba
 * GET /api/scrape/android?category=rpg
 *
 * Grąžina:
 * {
 *   category: "rpg",
 *   source: "https://en.uptodown.com/android/rpg",
 *   count: N,
 *   items: [{ title, description, image, originalUrl }]
 * }
 */
router.get("/android", async (req, res) => {
    try {
        const rawUrl = req.query.url
            ? String(req.query.url)
            : `https://en.uptodown.com/android/${encodeURIComponent(String(req.query.category || ""))}`;

        if (!rawUrl || /\/android\/?$/.test(rawUrl)) {
            return res.status(400).json({ error: "MISSING_URL_OR_CATEGORY", message: "Provide ?url=... or ?category=..." });
        }

        // Kategorija – paskutinis kelio segmentas
        let category = "unknown";
        try {
            const u = new URL(rawUrl);
            const parts = u.pathname.split("/").filter(Boolean);
            category = parts[parts.length - 1] || category;
        } catch (_) {}

        const { data: html, status } = await axios.get(rawUrl, {
            timeout: 15000,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9",
                Accept: "text/html,application/xhtml+xml",
            },
            validateStatus: () => true, // patys valdome 404 ir pan.
        });

        if (status !== 200 || typeof html !== "string") {
            return res.status(502).json({
                error: "UPSTREAM_BAD_STATUS",
                message: `Upstream ${status}`,
                source: rawUrl,
            });
        }

        const $ = cheerio.load(html);
        const items = [];

        // Tik .item kortelės – kaip nurodei
        $(".item").each((_, el) => {
            const $el = $(el);

            // Nuoroda į originalų žaidimo puslapį
            const $a = $el.find("a").first();
            const href = $a.attr("href") || "";
            let originalUrl = "";
            try {
                originalUrl = new URL(href, rawUrl).toString();
            } catch (_) {
                originalUrl = href || "";
            }

            // Pavadinimas
            const title =
                $el.find(".name, .title, h3, h2").first().text().trim() ||
                $a.attr("title") ||
                $a.text().trim() ||
                "";

            // Aprašymas
            const description =
                $el.find(".description, .desc, p").first().text().trim() || "";

            // Paveikslėlis (support data-src/srcset/src)
            const $img = $el.find("img").first();
            let img =
                $img.attr("data-src") ||
                ($img.attr("srcset") || "").split(",")[0]?.trim().split(" ")[0] ||
                $img.attr("src") ||
                "";
            try {
                img = img ? new URL(img, rawUrl).toString() : "";
            } catch (_) {}

            if (title || originalUrl) {
                items.push({
                    title,
                    description,
                    image: img || null,
                    originalUrl: originalUrl || null,
                });
            }
        });

        res.json({
            category,
            source: rawUrl,
            count: items.length,
            items,
        });
    } catch (err) {
        res.status(500).json({
            error: "SCRAPE_FAILED",
            message: err?.message || "Unknown error",
        });
    }
});

module.exports = router;
