// server/services/scrapers/uptodown.js
const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("url");

/**
 * Absoliutina href pagal bazinį domeną.
 */
function absolutize(base, href) {
    try {
        if (!href) return null;
        return new URL(href, base).toString();
    } catch {
        return null;
    }
}

/**
 * Iš href ištraukia "slug" po /app/
 * pvz.: /android/app/pac-man-classic  -> "pac-man-classic"
 */
function slugFromAppHref(href = "") {
    try {
        const u = new URL(href, "https://en.uptodown.com");
        const parts = u.pathname.split("/").filter(Boolean);
        const idx = parts.findIndex((p) => p === "app");
        if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    } catch (_) {}
    return null;
}

/**
 * Paima pirmą tinkamiausią paveikslėlio URL iš <img>.
 */
function pickImg($img) {
    if (!$img || $img.length === 0) return null;
    const ds = $img.attr("data-src") || $img.attr("data-lazy") || "";
    if (ds) return ds.trim();
    const srcset = $img.attr("data-srcset") || $img.attr("srcset") || "";
    if (srcset) {
        const first = srcset.split(",")[0]?.trim().split(" ")[0];
        if (first) return first;
    }
    const src = $img.attr("src") || "";
    return src ? src.trim() : null;
}

/**
 * Bando ištraukti pavadinimą iš kortelės.
 */
function pickTitle($, $root) {
    const cand =
        $root.find("h3, h2, .name, .title, [itemprop='name']").first().text().trim() ||
        $root.attr("title") ||
        $root.find("a[title]").attr("title") ||
        $root.text().trim();
    return cand.replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Scrape vieną kategorijos puslapį.
 */
async function scrapeUptodownCategory({ category, page = 1 } = {}) {
    if (!category) throw new Error("Missing category");

    const base = "https://en.uptodown.com";
    const path = `/android/${encodeURIComponent(category)}`;
    const source = `${base}${path}${page && Number(page) > 1 ? `?page=${Number(page)}` : ""}`;

    const res = await axios.get(source, {
        timeout: 15000,
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            Accept: "text/html,application/xhtml+xml",
        },
    });

    const $ = cheerio.load(res.data);

    // Kandidatai – elementai, kuriuose tikėtina yra app nuorodos
    // Darysime robust dedupe pagal href slug'ą
    const seen = new Set();
    const items = [];

    // Imame visas nuorodas, kurios veda į /android/app/
    $('a[href*="/android/app/"], a[href^="/android/app/"]').each((_, a) => {
        const $a = $(a);
        const href = $a.attr("href");
        const abs = absolutize(base, href);
        if (!abs) return;

        const slug = slugFromAppHref(abs);
        if (!slug || seen.has(slug)) return;

        // Kortelės "root" – artimiausias elementas, kuriame yra img + title
        const $card = $a.closest("article, li, .app, .card, .item, .content, .box").length
            ? $a.closest("article, li, .app, .card, .item, .content, .box")
            : $a;

        const title = pickTitle($, $card) || $a.attr("title") || $a.text().trim();

        // Paveikslėlis iš kortelės arba pačios nuorodos
        let img =
            pickImg($card.find("img").first()) ||
            pickImg($a.find("img").first()) ||
            null;

        // Absoliutinam paveikslėlį
        img = img ? absolutize(base, img) : null;

        seen.add(slug);
        items.push({
            id: slug,
            title: title || slug,
            originalUrl: abs,
            image: img,
        });
    });

    // Jei kažką pražiūrėjome – fallback: imti ".app" korteles
    if (items.length === 0) {
        $(".app, .card, article").each((_, el) => {
            const $el = $(el);
            const $a = $el.find('a[href*="/android/app/"], a[href^="/android/app/"]').first();
            if (!$a.length) return;

            const href = $a.attr("href");
            const abs = absolutize(base, href);
            if (!abs) return;

            const slug = slugFromAppHref(abs);
            if (!slug || seen.has(slug)) return;

            const title = pickTitle($, $el) || $a.attr("title") || $a.text().trim();
            let img = pickImg($el.find("img").first()) || pickImg($a.find("img").first()) || null;
            img = img ? absolutize(base, img) : null;

            seen.add(slug);
            items.push({
                id: slug,
                title: title || slug,
                originalUrl: abs,
                image: img,
            });
        });
    }

    return {
        platform: "android",
        category,
        source,
        count: items.length,
        items,
    };
}

module.exports = {
    scrapeUptodownCategory,
};
