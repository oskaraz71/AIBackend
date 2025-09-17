import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Viena nuolatinė Gemini chat sesija kiekvienam AI žaidėjui.
 * initialPrompt – tavo vienkartinis taisyklių+personos tekstas (iš FE per game:start).
 */
export class AIAgent {
    constructor({ apiKey, model, initialPrompt, playerId }) {
        this.playerId = playerId;
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model });
        this.chat = this.model.startChat({
            history: [
                {
                    role: "user",
                    parts: [
                        {
                            text:
                                `You are an autonomous RPG player.
RULES & PERSONA (one-time setup):
${initialPrompt}

OUTPUT: Return ONLY ONE JSON object that matches the required schema.
Do not include any extra text, reasoning or comments.`,
                        },
                    ],
                },
            ],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.6,
            },
        });
    }

    /**
     * Kiekvienam savo ėjimui agentas gauna TIK santrauką (delta) – neperrašom taisyklių.
     * payload pvz.: { now:{self,opponent}, lastOpponentAction, shop }
     */
    async sendTurn(payload) {
        const msg = JSON.stringify({
            type: "TURN_INPUT",
            you_are: this.playerId, // "personal" | "ai"
            ...payload,
            note: "Respond ONLY with the JSON action object."
        });
        const res = await this.chat.sendMessage({ parts: [{ text: msg }] });
        return await res.response.text(); // grįžta JSON tekstas
    }
}
