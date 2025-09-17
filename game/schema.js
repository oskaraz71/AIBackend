import { z } from "zod";

export const AiActionSchema = z.object({
    action: z.enum(["ATTACK", "BUY_ITEM", "DRINK_POTION", "REST"]),
    details: z.object({
        item_id: z.string().optional(),
        potion_id: z.string().optional(),
    }).strict(),
}).strict();

export function parseAiAction(raw) {
    try {
        const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
        return { ok: true, value: AiActionSchema.parse(obj) };
    } catch (e) {
        return { ok: false, error: e };
    }
}
