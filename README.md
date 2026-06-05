```markdown
# ⚙️ 0xNeural Shred-Sentry
**Autonomous, AI-Driven Solana Transaction Infrastructure**

Shred-Sentry is an enterprise-grade transaction pipeline designed to navigate the complexities of the Solana mainnet. It combines high-speed Yellowstone gRPC streaming, atomic Jito bundles, and a cognitive AI recovery engine to autonomously diagnose and heal transaction failures in real-time.

## 🧠 System Architecture Overview

This infrastructure is built on four decoupled core pillars:

1. **The Telemetry Engine (Yellowstone gRPC & WSS):** Bypasses standard HTTP polling. It uses raw protocol buffers to establish a direct gRPC stream for slot tracking, and utilizes native WebSocket subscriptions (`connection.onSignature`) to measure exact millisecond latencies across `processed`, `confirmed`, and `finalized` commitment states.
2. **The Execution Worker (Jito Block Engine):** Constructs atomic bundles. It dynamically calculates tips based on an AI-provided multiplier and utilizes the SPL Memo Program to bypass mainnet wash-trading and rent-exemption traps without draining burner wallets.
3. **The Cognitive Engine (Gemini 2.5 Flash):** An autonomous agent that reads raw Solana error strings (e.g., `BlockhashNotFound`, `Timeout: Bundle Evicted`), reasons about the network state, and outputs strict operational JSON parameters (Tip Multipliers, Delay Slots, Blockhash Refresh flags).
4. **The Orchestrator:** Manages the lifecycle, injects simulated network faults to test the AI's recovery capabilities, handles API rate-limit dynamic fallbacks, and writes precise latency data to `lifecycle-log.json`.

*For a detailed visual mapping of the data flow and system components, view the [Notion Document Here](https://www.notion.so/0xNeural-Shred-Sentry-System-Architecture-Document-e2cb0f2262ea458db56dcfd8086e83a6).*

---

## 🚀 Setup & Execution

### Prerequisites
- Node.js (v18+)
- A Solana Mainnet RPC URL
- A funded burner wallet (Minimum `0.02 SOL` for Jito tips)
- Google Gemini API Key

### Installation
```bash
git clone [https://github.com/Ogezi-Emmanuel/solana-shred-sentry.git](https://github.com/Ogezi-Emmanuel/solana-shred-sentry.git)
cd solana-shred-sentry
npm install

```

### Environment Variables

Create a `.env` file in the root directory:

```env
SOLANA_RPC_URL=[https://api.mainnet-beta.solana.com](https://api.mainnet-beta.solana.com)
JITO_BLOCK_ENGINE_URL=[https://mainnet.block-engine.jito.wtf/api/v1](https://mainnet.block-engine.jito.wtf/api/v1)
AGENT_SECRET_KEY=your_base58_encoded_private_key
GEMINI_API_KEY=your_google_gemini_api_key

```

### Run the Pipeline

```bash
npm start

```

The system will run a 10-iteration pipeline, deliberately inject blockhash faults to trigger the AI recovery agent, and generate a final `lifecycle-log.json` containing exact commitment latencies.

---

## 📚 Bounty Protocol Questions & Observations

During the development of this stack, we observed the raw behavior of the Solana network and Jito block engine. Based on those live observations, here are the answers to the core protocol questions:

### Question 1: What does the delta between `processed_at` and `confirmed_at` tell you about network health at the time of submission?

The delta between `processed` and `confirmed` is a direct measure of **consensus friction**.
When a transaction is `processed`, it means a single leader node has executed the transaction and written it to their block. However, `confirmed` means a supermajority (66%+) of the network's validators have voted on that specific block.

* **A small delta (e.g., < 800ms):** Indicates a highly healthy, synchronized network where block propagation (shredding) is fast and validators are voting unanimously without delay.
* **A large delta (or oscillating times):** Indicates poor network health. It suggests heavy network congestion, dropped UDP packets, or an active micro-fork where validators are split on the canonical chain, delaying the supermajority consensus.

### Question 2: Why should you never use `finalized` commitment when fetching a blockhash for a time-sensitive transaction?

A Solana blockhash is only valid for exactly 150 slots (roughly 60 seconds).
The `finalized` commitment state represents the absolute truth of the blockchain, but it lags behind the actual chain tip by roughly 31 to 32 slots (about 12–15 seconds). If you fetch a `finalized` blockhash, you are requesting a blockhash that is *already 15 seconds old*. You instantly burn 20–25% of your transaction's total lifespan before you even sign it. For time-sensitive MEV or arbitrage, you must use `confirmed` (to avoid micro-fork invalidation) or `processed` (for bleeding-edge speed) to maximize your submission window.

### Question 3: What happens to your bundle if the Jito leader skips their slot?

The bundle is **silently evicted and dropped.**
Jito bundles bypass the standard Solana mempool and are submitted directly to the Block Engine, which forwards them to a specific upcoming Jito validator. If that leader's node goes offline or they fail to produce a block for their assigned slot, the auction for that slot is effectively voided. The transaction never touches the blockchain, the tip is never deducted from your wallet, and you pay zero gas fees. The system must detect this timeout and autonomously resubmit the bundle to the *next* available leader.

---

## 🛠️ Engineering Trade-offs & Future Optimizations

* **AI Latency vs. Execution Speed:** To satisfy the bounty constraints, a cloud LLM (Gemini 2.5 Flash) was placed in the critical path for failure recovery. While it perfectly demonstrates cognitive intent parsing, the ~500ms API latency is too slow for production MEV arbitrage. In a live trading environment, this cloud AI would be replaced by a locally-hosted, quantized SLM (Small Language Model) running on the same bare-metal server as the gRPC stream.
* **Dynamic Fallback Integration:** During testing, the LLM hit a `429 Too Many Requests` rate limit, causing a potential fatal crash. We engineered a dynamic mathematical fallback `(2.0 + (attemptCount * 2.0))` that bypasses the offline AI and aggressively scales the Jito tip up to 8x to ensure the transaction survives infrastructure outages.

```

***
