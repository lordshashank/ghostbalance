# RedactedChat

Privacy-preserving chat identity using zero-knowledge proofs. Users prove they hold a minimum ETH balance without revealing their address or exact balance.

## How It Works

RedactedChat uses a [Noir](https://noir-lang.org/) ZK circuit to generate a proof that:

1. **You control a wallet** -- by verifying an ECDSA signature over a fixed identity message (`"RedactedChat:v0:identity"`)
2. **Your balance meets a threshold** -- by fetching and verifying the account's Ethereum state proof (MPT proof via [eth-proofs](https://github.com/lordshashank/eth-proofs))
3. **You get a pseudonymous identity** -- a deterministic nullifier derived from `poseidon(poseidon(sig_r, sig_s), balance)`, so the same wallet + balance always produces the same identity

The proof reveals only: chain ID, block number, the claimed balance threshold, the block hash, and the nullifier. The address, exact balance, and private key stay hidden.

## Project Structure

```
redactedchat/
├── circuits/verify_balance/     # Noir ZK circuit
│   ├── src/
│   │   ├── main.nr              # Circuit entrypoint
│   │   ├── identity.nr          # EIP-191 signature verification + address derivation
│   │   └── nullifier.nr         # Poseidon-based nullifier computation
│   ├── test/                    # Integration tests (Sepolia)
│   └── Nargo.toml               # Circuit dependencies
├── frontend/                    # Next.js web app
│   ├── src/
│   │   ├── app/                 # Pages + API routes
│   │   │   └── api/verify/      # Server-side proof verification endpoint
│   │   ├── components/          # React components (ProveForm)
│   │   ├── lib/noir/            # noir_js + bb.js proving pipeline
│   │   ├── lib/oracles/         # eth-proofs oracle handlers (browser RPC)
│   │   └── providers/           # RainbowKit + wagmi wallet providers
│   └── public/circuits/         # Compiled circuit JSON
└── docs/                        # Design specs and research
```

## Circuit

The `verify_balance` circuit takes:

| Input | Visibility | Type | Description |
|-------|-----------|------|-------------|
| `chain_id` | public | `u32` | Ethereum chain ID |
| `block_number` | public | `u64` | Block to verify balance at |
| `public_balance` | public | `u128` | Balance threshold (wei) revealed in proof |
| `nullifier_balance` | private | `u128` | Balance used for nullifier derivation |
| `signature` | private | `[u8; 64]` | ECDSA signature (r \|\| s) |
| `public_key_x` | private | `[u8; 32]` | Signer's public key X coordinate |
| `public_key_y` | private | `[u8; 32]` | Signer's public key Y coordinate |

And returns (as public outputs):
- `block_hash: [u8; 32]` -- the block hash from the verified header
- `nullifier: Field` -- pseudonymous identity

The circuit verifies the ECDSA signature, derives the Ethereum address from the public key, fetches the account state via oracle calls (verified by MPT proofs), checks that both `public_balance` and `nullifier_balance` are <= the on-chain balance, and computes the nullifier.

**Stats**: ~218K ACIR opcodes, ~1.5M gates (UltraHonk)

## Frontend

Next.js app with RainbowKit wallet connection. The flow:

1. User connects wallet (Sepolia or mainnet)
2. Wallet signs the identity message via `personal_sign`
3. Public key is recovered from the signature (via `viem.recoverPublicKey`)
4. Circuit executes in-browser using `noir_js` -- oracle calls fetch `eth_getProof` and block headers via the wallet's RPC
5. Proof is generated and sent to the `/api/verify` endpoint for server-side verification
6. Verified results (nullifier, block hash, etc.) are displayed

> **Note**: Browser-based proof generation currently hits a V8 WASM call stack depth limit for this circuit size (~1.5M gates). Server-side proving is the path forward. See `../aztec-packages/WASM_BUILD_NOTES.md` for details on the investigation.

## Prerequisites

- [nargo](https://noir-lang.org/docs/getting_started/installation/) v1.0.0-beta.18+
- [Node.js](https://nodejs.org/) 18+
- An Ethereum RPC endpoint (Alchemy, Infura, etc.)
- A funded wallet on the target chain (for integration tests)

## Getting Started

### Compile the circuit

```bash
cd circuits/verify_balance
~/.nargo/bin/nargo compile --silence-warnings
```

This produces `target/verify_balance.json`. Copy it to the frontend:

```bash
cp target/verify_balance.json ../../frontend/public/circuits/
```

### Run circuit tests

```bash
cd circuits/verify_balance
~/.nargo/bin/nargo test --silence-warnings
```

### Run integration test (Sepolia)

Requires `PRIVATE_KEY` and `ALCHEMY_API_KEY` environment variables:

```bash
cd circuits/verify_balance/test
./run-integration.sh          # Execute only (witness + constraint check)
./run-integration.sh --prove  # Full: execute + prove + verify
```

### Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000, connect a wallet, and generate a proof.

## Dependencies

### Circuit
- [eth-proofs](https://github.com/lordshashank/eth-proofs) -- Ethereum state proof verification in Noir (using local fork with `pub` field visibility)
- [keccak256](https://github.com/noir-lang/keccak256) -- Keccak hash for EIP-191 and address derivation
- [poseidon](https://github.com/noir-lang/poseidon) -- Poseidon hash for nullifier computation

### Frontend
- `@noir-lang/noir_js` -- Circuit execution (witness generation)
- `@aztec/bb.js` -- UltraHonk proof generation/verification (Barretenberg WASM)
- `next`, `react` -- Web framework
- `wagmi`, `viem`, `@rainbow-me/rainbowkit` -- Wallet connection
