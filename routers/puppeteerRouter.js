// routers/puppeteerRouter.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

// Tik prisijungusiems
router.use(requireAuth);

// Kur saugom knygas
const BOOKS_DIR = path.join(__dirname, "..", "books");
try {
    fs.mkdirSync(BOOKS_DIR, { recursive: true });
    console.log("[PUPPETEER] ensured books dir:", BOOKS_DIR);
} catch (e) {
    console.error("[PUPPETEER] mkdir error:", e.message);
}

// Helper: saugus limitas [1..10]
function clampLimit(v) {
    const n = Number(v || 5);
    return Math.max(1, Math.min(10, Number.isFinite(n) ? n : 5));
}

// Formatų prioritetas: EPUB -> PDF -> TXT
const FORMAT_ORDER = [
    { key: "application/epub+zip", label: "EPUB", ext: "epub" },
    { key: "application/pdf",       label: "PDF",  ext: "pdf"  },
    { key: "text/plain; charset=utf-8", label: "TXT", ext: "txt" },
    { key: "text/plain",                label: "TXT", ext: "txt" },
];

// HEAD -> dydis
async function headSize(url, UA) {
    try {
        const res = await fetch(url, { method: "HEAD", headers: { "user-agent": UA } });
        const len = res.headers.get("content-length");
        return len ? Number(len) : null;
    } catch {
        return null;
    }
}

// viršelio URL (jei yra)
function pickCover(formats = {}) {
    const img = formats["image/jpeg"] || formats["image/png"] || "";
    return img || "";
}

// geriausias formatas pagal FORMAT_ORDER
function pickBestFormat(formats = {}) {
    for (const f of FORMAT_ORDER) {
        const url = formats[f.key];
        if (url && typeof url === "string" && !url.endsWith(".zip")) {
            return { format: f.label, url, ext: f.ext };
        }
    }
    return null;
}

// failo vardo sanitarizacija
function sanitizeName(s) {
    return String(s || "")
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
}

// mažas delay tarp siuntimų
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/puppeteer/search
 * Body: { query, limit?:number=5, download?:boolean=false }
 * 2.3: jei download=true -> parsiunčia į /books ir grąžina localUrl
 */
router.post("/search", async (req, res) => {
    const reqId = req.id || "-";
    const { query = "", limit = 5, download = false } = req.body || {};
    const LIM = clampLimit(limit);

    console.log("[PUPPETEER][SEARCH]", { reqId, user: req.user?.email, query, limit: LIM, download: !!download });

    if (!query || typeof query !== "string" || !query.trim()) {
        return res.status(400).json({ success: false, message: "Query required" });
    }

    // Gutendex – patogi JSON paieška Gutenberg duomenims
    let nextUrl = `https://gutendex.com/books/?search=${encodeURIComponent(query.trim())}`;
    const UA = "PagesAI/puppeteer (contact: master@oskaraz.lt)";
    const items = [];
    const downloaded = [];
    const log = [];

    try {
        while (nextUrl && items.length < LIM) {
            console.log("[PUPPETEER][FETCH] →", nextUrl);
            log.push(`FETCH ${nextUrl}`);

            const resp = await fetch(nextUrl, {
                headers: {
                    "user-agent": UA,
                    "accept": "application/json",
                },
            });

            if (!resp.ok) {
                const t = await resp.text().catch(() => "");
                console.error("[PUPPETEER][FETCH] HTTP", resp.status, t.slice(0, 200));
                return res.status(502).json({ success: false, message: "UPSTREAM_ERROR", status: resp.status });
            }

            const data = await resp.json();
            const results = Array.isArray(data.results) ? data.results : [];

            // Rūšiuojam pagal populiarumą (download_count)
            results.sort((a, b) => (b.download_count || 0) - (a.download_count || 0));

            for (const b of results) {
                if (items.length >= LIM) break;

                const best = pickBestFormat(b.formats || {});
                if (!best) {
                    log.push(`SKIP #${b.id} – no preferred format`);
                    continue;
                }

                const pageUrl = `https://www.gutenberg.org/ebooks/${b.id}`;
                const thumb = pickCover(b.formats || {});
                let size = await headSize(best.url, UA); // gali būti null

                const item = {
                    id: b.id,
                    title: b.title || "(Untitled)",
                    authors: (Array.isArray(b.authors) ? b.authors.map(a => a.name).filter(Boolean).join(", ") : "") || "",
                    pageUrl,
                    thumb,
                    format: best.format,
                    fileUrl: best.url,
                    size: size || null,
                    localUrl: null, // nustatysim jei download=true
                };

                // Jei paprašyta – siųsti į /books
                if (download) {
                    const base = sanitizeName(item.title) || `book-${b.id}`;
                    const filename = `${base} - pg${b.id}.${best.ext}`;
                    const full = path.join(BOOKS_DIR, filename);

                    // Jei jau yra – nenaikinam
                    if (fs.existsSync(full)) {
                        const st = await fsp.stat(full).catch(() => null);
                        const fsize = st?.size || item.size || null;
                        item.localUrl = `/books/${encodeURIComponent(filename)}`;
                        item.size = fsize;
                        downloaded.push({ id: b.id, file: filename, status: "exists", size: fsize });
                        console.log("[PUPPETEER][DL][EXISTS]", filename, fsize ? `${fsize} bytes` : "(size?)");
                    } else {
                        try {
                            console.log("[PUPPETEER][DL][START]", filename, "←", best.url);
                            const respFile = await fetch(best.url, { headers: { "user-agent": UA } });
                            if (!respFile.ok) {
                                const t = await respFile.text().catch(() => "");
                                console.warn("[PUPPETEER][DL][HTTP]", respFile.status, best.url, t.slice(0, 120));
                                log.push(`DL_FAIL ${best.url} HTTP ${respFile.status}`);
                            } else {
                                const ws = fs.createWriteStream(full);
                                // Node fetch -> Web stream; konvertuojam į Node Readable
                                await pipeline(Readable.fromWeb(respFile.body), ws);

                                const st = await fsp.stat(full).catch(() => null);
                                const fsize = st?.size || item.size || null;
                                item.localUrl = `/books/${encodeURIComponent(filename)}`;
                                item.size = fsize;
                                downloaded.push({ id: b.id, file: filename, status: "downloaded", size: fsize });
                                console.log("[PUPPETEER][DL][OK]", filename, fsize ? `${fsize} bytes` : "(size?)");
                            }
                        } catch (e) {
                            console.error("[PUPPETEER][DL][ERR]", e.message);
                            log.push(`DL_ERR ${best.url} ${e.message}`);
                        }

                        // Draugiškas tempas (kad nebūtų flood): 800ms
                        await sleep(800);
                    }
                }

                items.push(item);
                console.log(`[PUPPETEER][ITEM] #${b.id}`, {
                    title: item.title, format: item.format, size: item.size, local: !!item.localUrl
                });
            }

            nextUrl = data.next || null;
        }

        console.log("[PUPPETEER][DONE]", { total: items.length, requested: LIM, downloaded: downloaded.length });
        if (download && !downloaded.length) console.log("[PUPPETEER] NOTE: download=true, but nothing was downloaded (maybe existed or errors)");

        return res.json({ success: true, items, downloaded, log });
    } catch (e) {
        console.error("[PUPPETEER][ERROR]", e);
        return res.status(500).json({ success: false, message: "SEARCH_ERROR", error: e.message });
    }
});

module.exports = router;
