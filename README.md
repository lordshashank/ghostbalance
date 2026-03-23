# GhostBalance

Privacy-preserving chat identity using zero-knowledge proofs. Users prove they hold a minimum ETH balance without revealing their address or exact balance.

## How It Works

GhostBalance uses [Noir](https://noir-lang.org/) ZK circuits to generate a proof that:

1. **You control a wallet** -- by verifying an ECDSA signature over a fixed identity message (`"ghostbalance:v0:identity"`)
2. **Your balance meets a threshold** -- by verifying the account's Ethereum state proof (block header RLP + MPT proof) entirely inside the circuit
3. **You get a pseudonymous identity** -- a deterministic nullifier derived from `poseidon2(poseidon2(sig_r, sig_s), balance)`, so the same wallet + balance always produces the same identity

The proof reveals only: chain ID, block number, the claimed balance threshold, the block hash, and the nullifier. The address, exact balance, and private key stay hidden.

## Architecture

The proof is split across 5 sub-circuits to fit within the browser's bb.js WASM proving limit (2^19 gates). All Ethereum data is pre-fetched in JavaScript and passed as circuit inputs -- no oracle server needed.

```
Circuit A (identity_nullifier)     63K gates
    |  commitment
Circuit B1 (balance_header)       221K gates
    |  link_1
Circuit B2 (balance_mpt_step)     434K gates   -- MPT nodes 0-3
    |  link_2
Circuit B3 (balance_mpt_step)     434K gates   -- MPT nodes 4-7 (same circuit)
    |  link_3
Circuit B4 (balance_final)        284K gates   -- remaining nodes + leaf + balance check
```

Inter-circuit integrity is maintained through Poseidon2 commitments (A -> B1) and blinded link commitments (B1 -> B2 -> B3 -> B4) that bind all private state across circuits.

For the full design -- how linking works, what's public vs private, the soundness argument, and the eth-primitives library -- see **[packages/circuits/ARCHITECTURE.md](packages/circuits/ARCHITECTURE.md)**.

## Project Structure

```
ghostbalance/
├── packages/
│   ├── circuits/
│   │   ├── ARCHITECTURE.md           # Detailed sharding design doc
│   │   ├── identity_nullifier/       # Circuit A: ECDSA + commitment + nullifier
│   │   ├── balance_header/           # Circuit B1: block header RLP + block hash
│   │   ├── balance_mpt_step/         # Circuit B2/B3: MPT node traversal (4 nodes each)
│   │   ├── balance_final/            # Circuit B4: remaining nodes + leaf + account + balance
│   │   ├── eth-primitives/           # Noir lib: link commitments, MPT, RLP, account
│   │   └── test/                     # Integration test against Sepolia
│   └── frontend/                     # Next.js web app
│       ├── src/
│       │   ├── app/                  # Pages + API routes
│       │   │   └── api/verify/       # Server-side 5-proof verification + link chain check
│       │   ├── components/           # React components (ProveForm)
│       │   ├── lib/noir/             # Proving pipeline, data fetching, MPT replay
│       │   └── providers/            # RainbowKit + wagmi wallet providers
│       └── public/circuits/          # Compiled circuit JSONs
├── scripts/
│   └── build-circuits.sh             # Compile circuits + copy artifacts to frontend
└── package.json                      # npm workspaces root
```

## Frontend Flow

1. User connects wallet (Sepolia or mainnet)
2. Wallet signs the identity message via `personal_sign`
3. Public key is recovered from the signature
4. Ethereum data is pre-fetched: block header + account state proof via `eth_getProof`
5. All 5 circuits are executed sequentially (chaining return values), then proved sequentially via bb.js WASM
6. 5 proofs are sent to `/api/verify` which verifies each proof and checks the cross-circuit link chain
7. Verified results (nullifier, block hash, balance threshold) are displayed

## Prerequisites

- [nargo](https://noir-lang.org/docs/getting_started/installation/) v1.0.0-beta.18+
- [Node.js](https://nodejs.org/) 18+
- An Ethereum RPC endpoint (Alchemy, Infura, etc.)
- A funded wallet on the target chain (for integration tests)

## Getting Started

### Compile the circuits

```bash
./scripts/build-circuits.sh
```

This compiles all circuits and copies the JSON artifacts to `packages/frontend/public/circuits/`.

### Run circuit tests

```bash
cd packages/circuits/identity_nullifier
~/.nargo/bin/nargo test --silence-warnings
```

### Run integration test (Sepolia)

Requires `PRIVATE_KEY` and `ALCHEMY_API_KEY` environment variables:

```bash
npm run test:integration           # Execute only (witness + constraint check)
npm run test:integration:prove     # Full: execute + prove + verify
```

### Run the frontend

```bash
npm install
npm run dev
```

Open http://localhost:3000, connect a wallet, and generate a proof.

## Dependencies

### Circuits
- [keccak256](https://github.com/noir-lang/keccak256) v0.1.2 -- Keccak hash for EIP-191, address derivation, block hash, MPT node hashing
- [poseidon](https://github.com/noir-lang/poseidon) v0.1.1 -- Poseidon2 hash for commitments, links, and nullifiers
- `eth-primitives/` -- Vendored from [eth-proofs](https://github.com/lordshashank/eth-proofs): MPT verification, RLP decoding, account state parsing

### Frontend
- `@noir-lang/noir_js` -- Circuit execution (witness generation)
- `@aztec/bb.js` -- UltraHonk proof generation/verification (Barretenberg WASM)
- `next`, `react` -- Web framework
- `wagmi`, `viem`, `@rainbow-me/rainbowkit` -- Wallet connection
