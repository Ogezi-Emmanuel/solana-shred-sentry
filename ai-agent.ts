import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

// 1. Define the exact operational schema the AI must output
const recoverySchema = z.object({
    diagnosis: z.string().describe("A brief 1-2 sentence technical explanation of why the transaction failed on Solana."),
    refreshBlockhash: z.boolean().describe("Whether to fetch a new blockhash before retrying (true for timeouts/expirations)."),
    tipMultiplier: z.number().describe("The multiplier to apply to the base Jito tip to ensure landing (e.g., 1.5, 2.0). Max 5.0."),
    delaySlots: z.number().describe("How many slots to wait before submitting the retry to target a better leader (0 for immediate).")
});

export class FaultRecoveryAgent {
    private model: any;

    constructor() {
        // We use gemini-2.5-flash for blazing fast, low-latency operational decisions
        this.model = new ChatGoogleGenerativeAI({
            model: "gemini-2.5-flash",
            temperature: 0.1, 
            maxRetries: 2,
        }).withStructuredOutput(recoverySchema);
    }

    /**
     * Takes raw execution errors and context, outputs actionable recovery parameters.
     */
    public async evaluateFailure(
        errorString: string,
        currentSlot: number,
        attemptCount: number
    ): Promise<z.infer<typeof recoverySchema> | null> {
        
        console.log(`\n[AI_AGENT] 🧠 Analyzing network failure... (Attempt: ${attemptCount})`);
        console.log(`[AI_AGENT] 📥 Raw Error: "${errorString}"`);

        const systemPrompt = `You are an autonomous Solana transaction recovery agent operating inside a high-performance Jito bundle stack.
Your job is to read raw error logs from failed transactions and determine the optimal recovery strategy.

RULES:
- If the error is 'BlockhashNotFound' or 'Transaction expired', it implies network congestion or dropped packets. You MUST recommend refreshing the blockhash (true) and bumping the tip slightly (e.g., 1.2 - 1.5).
- If the error implies a Jito bundle eviction, leader skip, or tip undervaluation, you MUST recommend a higher tip multiplier (e.g., 2.0 - 3.0) and consider a 1-2 slot delay to hit the next leader.
- If the attempt count is > 2, increase aggression (higher tip, no delay).
Return strict JSON matching the provided schema.`;

        const humanPrompt = `Error: ${errorString}\nCurrent Slot: ${currentSlot}\nAttempt Number: ${attemptCount}`;

        try {
            // The AI acts as a pure operational function mapping errors to parameters
            const response = await this.model.invoke([
                ["system", systemPrompt],
                ["human", humanPrompt]
            ]);

            console.log(`[AI_AGENT] 🎯 Diagnosis: ${response.diagnosis}`);
            console.log(`[AI_AGENT] 🛠️ Action Plan -> Refresh Blockhash: ${response.refreshBlockhash} | Tip Multiplier: ${response.tipMultiplier}x | Delay: ${response.delaySlots} slots\n`);
            
            return response;
        } catch (error) {
            console.error("[AI_AGENT_CRITICAL] Cognitive engine failed to parse recovery schema.", error);
            
            // Dynamic fallback: aggressively scale the tip if the LLM is rate-limited
            // Attempt 1 -> 1.5x | Attempt 2 -> 2.5x | Attempt 3 -> 3.5x
            const aggressiveFallback = 0.5 + (attemptCount * 1.0);
            
            return {
                diagnosis: `API Rate Limit hit. Engaging dynamic fallback logic (Attempt ${attemptCount}).`,
                refreshBlockhash: true,
                tipMultiplier: aggressiveFallback,
                delaySlots: 0
            };
        }
    }
}