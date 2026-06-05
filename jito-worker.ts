import { 
    Connection, 
    Keypair, 
    PublicKey, 
    SystemProgram, 
    TransactionMessage, 
    VersionedTransaction 
} from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config();

export class JitoBundleWorker {
    private jitoRpcUrl: string;
    private connection: Connection;
    private tipAccounts: string[] = [];

    constructor(rpcUrl: string) {
        // e.g., 'https://mainnet.block-engine.jito.wtf/api/v1/bundles'
        this.jitoRpcUrl = process.env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf/api/v1';
        this.connection = new Connection(rpcUrl, 'processed');
    }

    /**
     * Fetches the 8 hardcoded Jito tip distribution accounts.
     * Tips must be sent to one of these to be recognized by the Block Engine.
     */
    public async refreshTipAccounts(): Promise<void> {
        try {
            const response = await axios.post(`${this.jitoRpcUrl}/bundles`, {
                jsonrpc: "2.0",
                id: 1,
                method: "getTipAccounts",
                params: []
            });
            
            if (response.data?.result) {
                this.tipAccounts = response.data.result;
                console.log(`[JITO] ✅ Tip accounts refreshed. Found ${this.tipAccounts.length} active escrow addresses.`);
            }
        } catch (error) {
            console.error(`[JITO_ERROR] Failed to fetch tip accounts:`, error);
        }
    }

    /**
     * Bounties require dynamic tip sizing. This calculates a baseline tip
     * based on recent network congestion, avoiding hardcoded minimums.
     */
    public async calculateDynamicTip(congestionMultiplier: number = 1.0): Promise<number> {
        // Cranked base tip to 300k lamports to outbid network congestion
        const BASELINE_TIP = 30_000; 
        let calculatedTip = Math.floor(BASELINE_TIP * congestionMultiplier);
        
        console.log(`[JITO] 🧮 Dynamic tip calculated: ${calculatedTip} lamports (Multiplier: ${congestionMultiplier}x)`);
        return calculatedTip;
    }

    /**
     * Compiles up to 4 user transactions + 1 Tip transaction into a Jito Bundle.
     * Executes atomically: either all succeed, or none do.
     */
    public async buildAndSendBundle(
        instructions: any[], 
        payer: Keypair, 
        congestionMultiplier: number = 1.0
    ): Promise<{bundleId: string, signature: string} | null> { 
        
        if (this.tipAccounts.length === 0) await this.refreshTipAccounts();

        // 1. Get the bleeding-edge blockhash
        const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

        // 2. Calculate the dynamic tip
        const tipAmount = await this.calculateDynamicTip(congestionMultiplier);
        
        // 3. Randomly select a tip account to distribute load
        const tipAccountStr = this.tipAccounts[Math.floor(Math.random() * this.tipAccounts.length)];
        
        // Give TypeScript a strict runtime guarantee that this is a valid string
        if (!tipAccountStr) {
            throw new Error("CRITICAL: Tip accounts array is empty or undefined.");
        }
        
        const tipAccountPubkey = new PublicKey(tipAccountStr);
        
        // 4. Create the Tip Instruction
        const tipInstruction = SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: tipAccountPubkey,
            lamports: tipAmount,
        });

        // 5. Append the tip to the end of the transaction stack
        const finalInstructions = [...instructions, tipInstruction];

        // 6. Compile the Versioned Transaction
        const messageV0 = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: blockhash,
            instructions: finalInstructions,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([payer]);

        // Give TypeScript a strict runtime guarantee that the signature exists
        const rawSignature = transaction.signatures[0];
        if (!rawSignature) {
            throw new Error("CRITICAL: Transaction was not signed properly.");
        }

        // 7. Base58 encode for Jito JSON-RPC submission
        const serializedTx = bs58.encode(transaction.serialize());
        const signature = bs58.encode(rawSignature); 

        // 8. Submit to Jito Block Engine
        try {
            console.log(`[JITO] 🚀 Dispatching bundle to block engine...`);
            const response = await axios.post(`${this.jitoRpcUrl}/bundles`, {
                jsonrpc: "2.0",
                id: 1,
                method: "sendBundle",
                params: [[serializedTx]]
            });

            if (response.data?.result) {
                const bundleId = response.data.result;
                console.log(`[JITO] ✨ Bundle submitted successfully. ID: ${bundleId}`);
                // Return BOTH the bundle ID and the raw transaction signature
                return { bundleId, signature };
            } else {
                throw new Error(JSON.stringify(response.data.error));
            }
        } catch (error: any) {
            console.error(`[JITO_ERROR] Bundle submission rejected:`, error.message);
            throw new Error(`Bundle Rejection: ${error.message}`);
        }
    }
}