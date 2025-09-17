// middleware/requireAuth.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function maskToken(t) {
        if (!t || typeof t !== "string") return "";
        return t.slice(0, 12) + "...";
}

async function requireAuth(req, res, next) {
        try {
                const h = req.headers.authorization || req.headers.Authorization || "";
                console.log("[AUTH] header =", h ? "Bearer " + maskToken(h.replace(/^Bearer\s+/i, "")) : "(none)");
                if (!h.startsWith("Bearer ")) {
                        return res.status(401).json({ success: false, message: "Missing token" });
                }

                const token = h.slice(7);
                let payload;
                try {
                        payload = jwt.verify(token, JWT_SECRET);
                } catch (e) {
                        console.warn("[AUTH] jwt verify error:", e.message);
                        return res.status(401).json({ success: false, message: "Invalid token" });
                }

                const user = await User.findById(payload.uid).lean();
                if (!user) return res.status(401).json({ success: false, message: "User not found" });

                req.user = user;
                req.auth = payload;
                next();
        } catch (e) {
                console.error("[AUTH] unexpected error:", e);
                res.status(401).json({ success: false, message: "Auth error" });
        }
}

function hasRole(user, role) {
        return Array.isArray(user?.roles) && user.roles.includes(role);
}

function requireAdmin(req, res, next) {
        const isAdmin = !!req.user?.isAdmin || hasRole(req.user, "admin");
        console.log("[AUTH] requireAdmin", { email: req.user?.email, isAdmin, roles: req.user?.roles || [] });
        if (!isAdmin) return res.status(403).json({ success: false, message: "Admins only" });
        next();
}

function requireRole(...roles) {
        return (req, res, next) => {
                const ok = roles.some(r => hasRole(req.user, r));
                console.log("[AUTH] requireRole", roles, "user roles:", req.user?.roles || []);
                if (!ok) return res.status(403).json({ success: false, message: "Insufficient role" });
                next();
        };
}

module.exports = { requireAuth, requireAdmin, requireRole, JWT_SECRET };
