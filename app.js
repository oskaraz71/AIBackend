// app.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const crypto = require("crypto");
try { require("dotenv").config(); } catch (_) {}

const app = express();
const PORT = Number(process.env.PORT || 2500);

// ── BOOT LOG
console.log("──────────────────────────────────────────");
console.log("[BOOT] backend start", new Date().toISOString());

const allowedOrigins = (process.env.CORS_ORIGIN ||
    "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:5173")
    .split(",").map(s => s.trim());

console.log("[ENV] PORT        =", PORT);
console.log("[ENV] CORS_ORIGIN =", allowedOrigins.join(", "));

// NEW: aiškiai nurodom DB pavadinimą (kai URI be /dbname)
const DB_NAME = process.env.MONGO_DB_NAME || "blog";
console.log("[ENV] MONGO_DB_NAME =", DB_NAME);
console.log("──────────────────────────────────────────");

// ── basic req id + inbound log
app.use((req, _res, next) => {
    req.id = (req.headers["x-request-id"] || "").toString().slice(0, 12) ||
        crypto.randomBytes(6).toString("hex");
    const origin = req.headers.origin || "(no-origin)";
    const ua = (req.headers["user-agent"] || "").slice(0, 60);
    console.log(`[IN] ${req.id} ${req.method} ${req.url} origin=${origin} ua="${ua}"`);
    next();
});

// ── CORS + parsers
app.use(cors({
    origin(origin, cb) {
        if (!origin) return cb(null, true);
        const ok = allowedOrigins.includes(origin);
        console.log(`[CORS] ${ok ? "ALLOW" : "BLOCK"} ${origin}`);
        cb(null, ok);
    }
}));
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
    if (req.method !== "GET") {
        const safe = JSON.parse(JSON.stringify(req.body || {}));
        ["password","password1","password2"].forEach(k => safe[k] && (safe[k] = "***"));
        console.log(`[BODY] ${req.id}`, safe);
    }
    next();
});
app.use((req, res, next) => {
    const t0 = Date.now();
    res.on("finish", () => {
        console.log(`[OUT] ${req.id} ${req.method} ${req.url} -> ${res.statusCode} in ${Date.now() - t0}ms`);
    });
    next();
});

// NEW: visuose atsakymuose parodom, prie kokios DB prisijungta
app.use((req, res, next) => {
    res.setHeader("x-db-used", mongoose.connection?.name || "unknown");
    next();
});

console.log("[ROUTER] mounting /api/ai");
app.use("/api/ai", (req, _res, next) => { console.log(`[HIT] /api/ai ${req.method} ${req.url}`); next(); }, require("./routers/aiRouter"));

console.log("[ROUTER] mounting /api/auth");
app.use("/api/auth", (req, _res, next) => { console.log(`[HIT] /api/auth ${req.method} ${req.url}`); next(); }, require("./routers/authRouter"));

/* ── NEW: /api/books – grąžina /books turinį (su requireAuth) */
console.log("[ROUTER] mounting /api/books");
app.use(
    "/api/books",
    (req, _res, next) => { console.log(`[HIT] /api/books ${req.method} ${req.url}`); next(); },
    require("./routers/booksRouter")
);
/* ── /NEW ── */

/* ── NEW: SCRAPER router (Cheerio) — jei jau turėjai, palik kaip buvo */
console.log("[ROUTER] mounting /api/scrape");
app.use(
    "/api/scrape",
    (req, _res, next) => { console.log(`[HIT] /api/scrape ${req.method} ${req.url}`); next(); },
    require("./routers/scrapeRouter")
);

console.log("Books list  → http://localhost:" + PORT + "/api/books");

console.log("[ROUTER] mounting /api/puppeteer");
app.use(
    "/api/puppeteer",
    (req, _res, next) => { console.log(`[HIT] /api/puppeteer ${req.method} ${req.url}`); next(); },
    require("./routers/puppeteerRouter")
);
console.log("Puppeteer → http://localhost:" + PORT + "/api/puppeteer/search");

// ── Mongo
const uri = process.env.MONGO_URI || "";
if (!uri || /<.+>/.test(uri)) {
    console.error("[Mongo] MONGO_URI missing or contains placeholders <...>");
}
console.log("[Mongo] connecting...", { uri: uri.replace(/\/\/[^@]+@/, "//***:***@"), dbName: DB_NAME });

mongoose.connection.on("connected", () => {
    console.log("[Mongo] connected → db:", mongoose.connection.name, "host:", mongoose.connection.host);
});
mongoose.connection.on("disconnected", () => {
    console.warn("[Mongo] disconnected");
});
mongoose.connection.on("error", (e) => {
    console.error("[Mongo] event error:", e.message);
});

mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, dbName: DB_NAME })
    .then(() => console.log("[Mongo] connect() OK"))
    .catch(e => console.error("[Mongo] connect() error:", e.message));

// Admin seed (vieną kartą po prisijungimo)
const User = require("./models/User");
mongoose.connection.once("open", async () => {
    try {
        console.log("[Admin seed] using db:", mongoose.connection.name);
        const email = process.env.ADMIN_EMAIL || "master@oskaraz.lt";
        const pass = process.env.ADMIN_PASSWORD || "Master1234!";
        const exists = await User.findOne({ email });
        if (exists) {
            console.log("[Admin] exists:", email);
        } else {
            const bcrypt = require("bcryptjs");
            const hash = await bcrypt.hash(pass, 10);
            await User.create({ email, passwordHash: hash, name: "Admin", isAdmin: true });
            console.log(`[Admin] created ${email} (temp password: ${pass})`);
        }
    } catch (e) {
        console.error("[Admin seed error]", e);
    }
});

// (Pastaba: žemiau buvo dubliai /api mount'ų — palikta kaip pas tave)

// ── Static generated HTML
const siteDir = path.join(__dirname, "site");
console.log("[STATIC] /site ->", siteDir);
app.use("/site", express.static(siteDir));

/* === NEW: static /books (parsisiųstiems failams) === */
const booksDir = path.join(__dirname, "books");
console.log("[STATIC] /books ->", booksDir);
app.use("/books", express.static(booksDir, {
    index: false,
    maxAge: "1h",
    setHeaders(res) {
        res.setHeader("x-dir", "books");
    }
}));
/* === /NEW === */

// Health (NEW: grąžina db info)
app.get("/health", (_req, res) => res.json({
    ok: true,
    time: Date.now(),
    db: mongoose.connection?.name || null,
    host: mongoose.connection?.host || null,
}));

// NEW: explicit debug endpoint su db info
app.get("/debug/db", (_req, res) => {
    res.json({
        ok: true,
        db: mongoose.connection?.name,
        host: mongoose.connection?.host,
        readyState: mongoose.connection?.readyState, // 1=connected
        time: Date.now(),
    });
});

// 404
app.use((req, res) => {
    console.warn("[404]", req.method, req.url);
    res.status(404).json({ success: false, message: "Not Found" });
});

// ── Optional Socket.IO (safe)
let server = null;
try {
    const { createServer } = require("http");
    const { Server } = require("socket.io");
    server = createServer(app);
    const io = new Server(server, { cors: { origin: allowedOrigins, methods: ["GET","POST"] } });

    // agents chat sockets (jei yra failas)
    try {
        require("./sockets/agentsChat")(io);
        console.log("[SOCKET.IO] agents chat attached");
    } catch (e) {
        console.warn("[SOCKET.IO] agentsChat attach failed:", e.code || e.message);
    }

    // 👉 AI Game sockets (tas pats io, jokių naujų serverių/portų)
    try {
        require("./sockets/aiGame")(io);
        console.log("[SOCKET.IO] ai-game attached");
    } catch (e) {
        console.warn("[SOCKET.IO] ai-game attach failed:", e.code || e.message);
    }
} catch (e) {
    console.warn("[SOCKET.IO] not installed, skipping sockets:", e.code || e.message);
}

// listen (naudojam server jei yra, kitaip app)
const target = server || app;
const srv = target.listen(PORT, () => {
    console.log("Server ready → http://localhost:" + PORT);
    console.log("AI health   → http://localhost:" + PORT + "/api/ai/health");
    console.log("Auth base   → http://localhost:" + PORT + "/api/auth");
    console.log("Scrape base → http://localhost:" + PORT + "/api/scrape/android?category=arcade");
    console.log("DB current  →", mongoose.connection?.name, "@", mongoose.connection?.host);
});

srv.on("error", (err) => {
    console.error("[SERVER ERROR]", err.code, err.message);
    if (err.code === "EADDRINUSE") {
        console.error(`Port ${PORT} užimtas. Atlaisvink: netstat -ano | findstr :${PORT} -> taskkill /PID <PID> /F`);
    }
});

// NEW: global unhandled rejections/logs
process.on("unhandledRejection", (reason) => {
    console.error("[UNHANDLED REJECTION]", reason);
});
process.on("uncaughtException", (err) => {
    console.error("[UNCAUGHT EXCEPTION]", err);
});
