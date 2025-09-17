// models/User.js  (BACKEND)
// Suderinimas su esama DB struktūra (userName, avatar_url, money, phone)
// ir FE laukais (username, avatar, balance) per Mongoose alias.

const mongoose = require("mongoose");

console.log("[Model/User] init → mapping: username↔userName, avatar↔avatar_url, balance↔money");

const PurchaseSchema = new mongoose.Schema(
    {
            item: String,
            qty:   { type: Number, default: 1 },
            price: { type: Number, default: 0 },
            at:    { type: Date,   default: Date.now },
    },
    { _id: false }
);

const UserSchema = new mongoose.Schema(
    {
            email:        { type: String, required: true, unique: true, index: true },
            passwordHash: { type: String, required: true },

            name:   { type: String, default: "" },

            // *** IMPORTANT: alias'ai į egzistuojančius DB laukus ***
            // DB saugo kaip userName, FE gali naudoti .username
            userName:   { type: String, default: "", alias: "username" },

            // DB saugo kaip avatar_url, FE gali naudoti .avatar
            avatar_url: { type: String, default: "", alias: "avatar" },

            // DB turi phone (pagal tavo dump'ą)
            phone: { type: String, default: "" },

            // DB gali turėti money; FE naudos .balance
            money:   { type: Number, default: 0, alias: "balance" },

            // role/flags
            roles:   { type: [String], default: [] },
            isAdmin: { type: Boolean, default: false },

            // istorija / papildomi duomenys
            purchases: { type: [PurchaseSchema], default: [] },
            extras:    { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    {
            // naudosim timestamps vietoje rankinių created_at/updated_at
            timestamps: true,
            collection: "users", // prisirišam prie teisingos kolekcijos
            toJSON:   { virtuals: true },
            toObject: { virtuals: true },
    }
);

// virtual "id" FE patogumui
UserSchema.virtual("id").get(function () {
        return this._id.toHexString();
});

// DEBUG/helpful logs on save
UserSchema.pre("save", function (next) {
        try {
                // parodome, kaip atrodo alias'ai prieš įrašymą
                console.log("[Model/User] pre-save", {
                        _id: String(this._id || ""),
                        email: this.email,
                        userName: this.userName,     // DB field
                        username: this.username,     // alias
                        avatar_url: this.avatar_url, // DB field
                        avatar: this.avatar,         // alias
                        money: this.money,           // DB field
                        balance: this.balance,       // alias
                        phone: this.phone,
                });
        } catch (e) {}
        next();
});

// Guard – neperregistruoti modelio
module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
