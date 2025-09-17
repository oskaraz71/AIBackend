// routers/booksRouter.js  (BACKEND)
const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

// Aplankas su parsisiųstomis knygomis
const BOOKS_DIR = path.join(__dirname, "..", "books");

// Užtikrinam, kad /books egzistuoja
try {
    fs.mkdirSync(BOOKS_DIR, { recursive: true });
    console.log("[BOOKS] ensured dir:", BOOKS_DIR);
} catch (e) {
    console.error("[BOOKS] mkdir error:", e.message);
}

// Tik prisijungusiems
router.use(requireAuth);

/**
 * GET /api/books
 * Grąžina knygų sąrašą iš /books: [{ name, size, mtime, url, ext }]
 */
router.get("/", async (req, res) => {
    const reqId = req.id || "-";
    console.log("[BOOKS][LIST] reqId=", reqId, "user=", req.user?.email);

    try {
        const entries = await fsp.readdir(BOOKS_DIR, { withFileTypes: true });
        const files = [];
        for (const ent of entries) {
            if (!ent.isFile()) continue;
            if (ent.name.startsWith(".")) continue; // skip .DS_Store ir pan.

            const full = path.join(BOOKS_DIR, ent.name);
            const st = await fsp.stat(full).catch(() => null);
            if (!st) continue;

            const ext = path.extname(ent.name).slice(1).toLowerCase();
            const url = `/books/${encodeURIComponent(ent.name)}`;

            files.push({
                name: ent.name,
                size: st.size,
                mtime: st.mtimeMs,
                url,
                ext,
            });
        }

        // naujausi viršuje
        files.sort((a, b) => b.mtime - a.mtime);

        console.log("[BOOKS][LIST] reqId=", reqId, "count=", files.length);
        res.json({
            success: true,
            dir: BOOKS_DIR,
            count: files.length,
            files,
        });
    } catch (e) {
        console.error("[BOOKS][LIST] reqId=", reqId, "error:", e);
        res.status(500).json({ success: false, message: "LIST_ERROR", error: e.message });
    }
});

module.exports = router;
