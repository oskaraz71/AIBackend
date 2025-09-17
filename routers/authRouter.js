// routers/authRouter.js  (BACKEND)
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { requireAuth, requireAdmin, JWT_SECRET } = require("../middleware/requireAuth");

const router = express.Router();

const L = (...a) => console.log("[AUTH]", ...a);
const W = (...a) => console.warn("[AUTH]", ...a);
const E = (...a) => console.error("[AUTH]", ...a);

function issueToken(u) {
    const token = jwt.sign(
        { uid: u._id.toString(), email: u.email, isAdmin: !!u.isAdmin },
        JWT_SECRET,
        { expiresIn: "24h" }
    );
    L("[issueToken]", "uid=", u._id.toString(), "email=", u.email);
    return token;
}

/** DB -> FE normalizacija (be dubliavimo) */
function publicUser(u) {
    if (!u) return null;
    const id = (u._id || u.id || "").toString();
    // imu TIK senus DB laukus PIRMI, o FE pavadinimus palieku kaip fallback (jei kur nors sukurta naujais)
    const username = u.userName ?? u.username ?? "";
    const avatar   = u.avatar_url ?? u.avatar ?? "";
    const balance  = (u.money ?? u.balance ?? 0) * 1;
    return {
        id,
        email: u.email || "",
        name: u.name || "",
        username,
        avatar,
        city: u.city || "",
        phone: u.phone || "",
        balance,
        extras: u.extras ?? {},
        purchases: u.purchases ?? [],
        createdAt: u.createdAt || u.created_at,
        updatedAt: u.updatedAt || u.updated_at,
    };
}

/** FE -> DB patch (jokio dubliavimo: rašom TIK senus DB laukus) */
function mapPatchToDb(patch = {}) {
    const out = {};
    if (patch.name !== undefined) out.name = String(patch.name);
    if (patch.username !== undefined) out.userName = String(patch.username);
    if (patch.avatar !== undefined) out.avatar_url = String(patch.avatar);
    if (patch.city !== undefined) out.city = String(patch.city);
    if (patch.phone !== undefined) out.phone = String(patch.phone);
    if (patch.balance !== undefined) out.money = Number(patch.balance) || 0;
    if (patch.extras !== undefined) out.extras = patch.extras;
    return out;
}

function preview(obj) {
    const o = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (typeof v === "string") o[k] = v.length > 120 ? v.slice(0, 117) + "..." : v;
        else o[k] = v;
    }
    return o;
}

// REGISTER
router.post("/register", async (req, res) => {
    try {
        const { email, password, name, username } = req.body || {};
        L("[REGISTER]", "reqId=", req.id, "email=", email, "name=", name, "username=", username, "pwdLen=", (password || "").length);

        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password required" });
        }

        const exists = await User.findOne({ email });
        if (exists) {
            W("[REGISTER] email exists:", email);
            return res.status(409).json({ success: false, message: "Email already registered" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        // KURIAM TIK SENUS DB LAUKUS (be jokio dubliavimo)
        const user = await User.create({
            email,
            passwordHash,
            name: name || "",
            userName: username || "",   // ← senasis DB laukas
            avatar_url: "",             // ← senasis DB laukas
            phone: "",
            city: "",
            money: 0,
        });

        const token = issueToken(user);
        L("[REGISTER] OK uid=", user._id.toString());
        res.json({ success: true, token, user: publicUser(user) });
    } catch (e) {
        E("[REGISTER] error:", e);
        res.status(500).json({ success: false, message: "Register error" });
    }
});

// LOGIN
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};
        L("[LOGIN]", "reqId=", req.id, "email=", email, "pwdLen=", (password || "").length);

        const user = await User.findOne({ email });
        if (!user) {
            W("[LOGIN] user not found:", email);
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        const ok = await bcrypt.compare(password || "", user.passwordHash);
        if (!ok) {
            W("[LOGIN] bad password for:", email);
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        const token = issueToken(user);
        L("[LOGIN] OK uid=", user._id.toString());
        res.json({ success: true, token, user: publicUser(user) });
    } catch (e) {
        E("[LOGIN] error:", e);
        res.status(500).json({ success: false, message: "Login error" });
    }
});

// ME
router.get("/me", requireAuth, async (req, res) => {
    L("[ME]", "reqId=", req.id, "uid=", req.user?._id?.toString());
    // requireAuth turėtų atnešti req.user; jei nori – galima perskaityti šviežiai iš DB:
    // const fresh = await User.findById(req.user._id);
    // return res.json({ success: true, user: publicUser(fresh) });
    res.json({ success: true, user: publicUser(req.user) });
});

// UPDATE PROFILE (FE: name, username, avatar, city, phone, balance)
router.put("/profile", requireAuth, async (req, res) => {
    try {
        const body = req.body || {};
        const patchDb = mapPatchToDb(body);

        L("[PROFILE]", "reqId=", req.id, "uid=", req.user?._id?.toString(), "inKeys=", Object.keys(body));
        L("[PROFILE] dbPatch=", preview(patchDb));

        const user = await User.findByIdAndUpdate(req.user._id, { $set: patchDb }, { new: true });
        if (!user) {
            W("[PROFILE] not found uid=", req.user?._id?.toString());
            return res.status(404).json({ success: false, message: "User not found" });
        }
        res.json({ success: true, user: publicUser(user) });
    } catch (e) {
        E("[PROFILE] error:", e);
        res.status(500).json({ success: false, message: "Update error" });
    }
});

// ADMIN: LIST
router.get("/users", requireAuth, requireAdmin, async (req, res) => {
    L("[ADMIN][LIST] by =", req.user?.email);
    const list = await User.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, users: list.map(publicUser) });
});

// ADMIN: UPDATE USER (be dubliavimo – mapuojam tik į senus DB laukus)
router.put("/users/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const patchDb = mapPatchToDb(body);

        L("[ADMIN][UPDATE]", "reqId=", req.id, "id=", req.params.id, "inKeys=", Object.keys(body));
        L("[ADMIN][UPDATE] dbPatch=", preview(patchDb));

        const user = await User.findByIdAndUpdate(req.params.id, { $set: patchDb }, { new: true });
        if (!user) {
            W("[ADMIN][UPDATE] not found id=", req.params.id);
            return res.status(404).json({ success: false, message: "User not found" });
        }
        res.json({ success: true, user: publicUser(user) });
    } catch (e) {
        E("[ADMIN][UPDATE] error:", e);
        res.status(500).json({ success: false, message: "Update error" });
    }
});

// ADMIN: DELETE USER
router.delete("/users/:id", requireAuth, requireAdmin, async (req, res) => {
    L("[ADMIN][DELETE]", "reqId=", req.id, "id=", req.params.id);
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

module.exports = router;
