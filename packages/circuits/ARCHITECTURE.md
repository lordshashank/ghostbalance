# Sharded Circuit Architecture

GhostBalance proves ETH balance ownership in the browser without revealing the user's address or exact balance. The proof runs entirely client-side using [Noir](https://noir-lang.org/) circuits compiled to UltraHonk and proved via bb.js WASM.

## Why Shard?

UltraHonk circuits are padded to the next power-of-2 size. bb.js WASM in the browser can prove circuits up to 2^19 (524,288) gates but fails at 2^20 due to WASM memory constraints (the native `bb` binary supports up to 2^23). A monolithic circuit that does ECDSA + block header verification + full MPT traversal + account RLP decoding exceeds 1M gates. Sharding splits the work into 5 sub-circuits, each fitting within 2^19:

| Circuit | Gates | Padded to | Role |
|---------|-------|-----------|------|
| A: `identity_nullifier` | 63,350 | 2^17 (131K) | ECDSA signature verify, address derivation, commitment, nullifier |
| B1: `balance_header` | 221,318 | 2^18 (262K) | Block header RLP verify, block hash, state root extraction |
| B2: `balance_mpt_step` | 434,451 | 2^19 (524K) | MPT traversal nodes 0-3 |
| B3: `balance_mpt_step` | 434,451 | 2^19 (524K) | MPT traversal nodes 4-7 (same circuit, different inputs) |
| B4: `balance_final` | 284,421 | 2^19 (524K) | MPT nodes 8-9, leaf verification, account RLP, balance assertion |

Gate counts measured with `bb gates` (UltraHonk scheme). The largest circuit (B2/B3) uses 434K of the 524K available gates at 2^19.

## Circuit Dependency Graph

```
                    +-----------------------+
                    |   Circuit A           |
                    |   identity_nullifier  |
                    |                       |
                    |  ECDSA verify         |
                    |  address derivation   |
                    |  commitment output    |
                    |  nullifier output     |
                    +-----------+-----------+
                                |
                          commitment
                                |
                    +-----------v-----------+
                    |   Circuit B1          |
                    |   balance_header      |
                    |                       |
                    |  commitment binding   |
                    |  header RLP verify    |
                    |  block_hash output    |
                    |  link_1 output        |
                    +-----------+-----------+
                                |
                             link_1
                                |
                    +-----------v-----------+
                    |   Circuit B2          |
                    |   balance_mpt_step    |
                    |                       |
                    |  MPT nodes 0-3        |
                    |  link_2 output        |
                    +-----------+-----------+
                                |
                             link_2
                                |
                    +-----------v-----------+
                    |   Circuit B3          |
                    |   balance_mpt_step    |
                    |   (same circuit)      |
                    |                       |
                    |  MPT nodes 4-7        |
                    |  link_3 output        |
                    +-----------+-----------+
                                |
                             link_3
                                |
                    +-----------v-----------+
                    |   Circuit B4          |
                    |   balance_final       |
                    |                       |
                    |  MPT nodes 8-9        |
                    |  leaf verification    |
                    |  account RLP decode   |
                    |  balance >= threshold |
                    +-----------------------+
```

## Inter-Circuit Linking

The core challenge of sharding is: how does a verifier know that 5 independent proofs were generated from the **same** private data? Two mechanisms handle this.

### 1. Commitment (A -> B1)

Circuit A outputs a blinded Poseidon2 commitment over the user's address and nullifier balance:

```
inner      = Poseidon2(address_as_field, nullifier_balance)
commitment = Poseidon2(inner, blinding)
```

Circuit B1 takes `commitment_in` as a **public input**, then recomputes the same commitment from its private inputs (`address`, `nullifier_balance`, `blinding`) and asserts equality. This binds the identity proven in A to the balance proven in B1-B4 without revealing the address.

### 2. Link Commitments (B1 -> B2 -> B3 -> B4)

Circuits B1-B4 pass intermediate MPT traversal state through **link commitments**. Each link is a Poseidon2 hash over the full private state at the circuit boundary:

```noir
// eth-primitives/src/link.nr
pub fn compute_link(
    curr_hash: [u8; 32],       // current MPT node hash
    address_hash: [u8; 32],    // keccak256(address)
    key_ptr: u32,              // position in MPT key nibbles
    nullifier_balance: u128,   // private balance for nullifier
    blinding: Field,           // random blinding factor
) -> Field {
    h1 = Poseidon2(curr_hash_hi, curr_hash_lo)
    h2 = Poseidon2(address_hash_hi, address_hash_lo)
    h3 = Poseidon2(key_ptr, nullifier_balance)
    Poseidon2(Poseidon2(h1, h2), Poseidon2(h3, blinding))
}
```

Each circuit:
- Takes `link_in` as a **public input**
- Recomputes `link_in` from its private inputs and asserts it matches
- Does its work (MPT node traversal)
- Outputs `link_out` as a **public output** (computed from the updated state)

The verifier checks that each circuit's `link_out` equals the next circuit's `link_in`:

```
B1.link_out == B2.link_in
B2.link_out == B3.link_in
B3.link_out == B4.link_in
```

### Why the Blinding Factor?

Without blinding, an attacker could brute-force the link values. The state committed in a link (curr_hash, address_hash, key_ptr) has limited entropy -- there are only ~2M Ethereum addresses with nonzero balances, and MPT paths are deterministic from the address. The blinding factor (a random 248-bit Field element, generated fresh per proof session) makes links computationally indistinguishable from random, preventing offline dictionary attacks.

The same blinding factor is used in both the commitment (A -> B1) and all link commitments (B1 -> B4). It is a private input to every circuit and never appears in any public output.

## What Each Circuit Does

### Circuit A: `identity_nullifier`

**Private inputs:** `signature`, `public_key_x`, `public_key_y`, `nullifier_balance`, `blinding`
**Public outputs:** `commitment`, `nullifier`

1. Constructs the EIP-191 prefixed message: `\x19Ethereum Signed Message:\n24` + `ghostbalance:v0:identity`
2. Hashes it with keccak256
3. Verifies the ECDSA secp256k1 signature against the provided public key
4. Derives the Ethereum address: `keccak256(pubkey_x || pubkey_y)[12..32]`
5. Computes `commitment = Poseidon2(Poseidon2(address, nullifier_balance), blinding)`
6. Computes `nullifier = Poseidon2(Poseidon2(sig_r, sig_s), nullifier_balance)`

The nullifier is deterministic for a given wallet + balance tier, enabling double-spend prevention without revealing identity.

### Circuit B1: `balance_header`

**Public inputs:** `block_number`, `commitment_in`
**Private inputs:** `address`, `nullifier_balance`, `blinding`, `header_rlp`, `header_rlp_len`, `header_state_root`
**Public outputs:** `block_hash` (Bytes32), `link_out` (Field)

1. Recomputes commitment from private inputs; asserts it matches `commitment_in`
2. RLP-decodes the block header, asserts `block_number` and `state_root` match
3. Computes `block_hash = keccak256(header_rlp)`
4. Computes `address_hash = keccak256(address)`
5. Outputs `link_out = compute_link(state_root, address_hash, 0, nullifier_balance, blinding)`

### Circuit B2: `balance_mpt_step` (nodes 0-3)

**Public inputs:** `link_in`
**Private inputs:** `curr_hash`, `address_hash`, `key_ptr_in`, `nullifier_balance`, `blinding`, `depth`, `start_index`, `nodes[4][532]`
**Public outputs:** `link_out` (Field)

1. Asserts `compute_link(curr_hash, address_hash, key_ptr_in, ...) == link_in`
2. For each of the 4 node slots (skipping if `global_idx >= depth - 1`):
   - Verifies `keccak256(node) == curr_hash`
   - Extracts next hash from branch node (follow key nibble) or extension node (match + skip key segment)
   - Advances `key_ptr`
3. Outputs `link_out = compute_link(updated_hash, address_hash, updated_key_ptr, ...)`

### Circuit B3: `balance_mpt_step` (nodes 4-7)

Same circuit binary as B2, just called with `start_index = 4` and the intermediate state from after B2's traversal.

### Circuit B4: `balance_final`

**Public inputs:** `link_in`, `public_balance`
**Private inputs:** `curr_hash`, `address_hash`, `key_ptr_in`, `nullifier_balance`, `blinding`, `depth`, `nodes[2][532]`, `leaf[148]`, `account_value[110]`, `account_nonce`, `account_balance`, `account_storage_root`, `account_code_hash`
**Public outputs:** none (all assertions, no return value)

1. Asserts link_in matches
2. Processes remaining internal nodes (indices 8-9, if they exist)
3. Verifies the MPT leaf: `keccak256(leaf) == curr_hash`, key nibbles consumed
4. Verifies account RLP: decodes `account_value` and asserts fields match (`nonce`, `balance`, `storage_root`, `code_hash`)
5. Asserts `public_balance <= account_balance` (the public threshold claim)
6. Asserts `nullifier_balance <= account_balance` (the private nullifier claim)

## Public vs Private Data

| Data | Visibility | Why |
|------|-----------|-----|
| `block_number` | Public | Verifier needs to know which block |
| `block_hash` | Public | Proves the header is real (can check against chain) |
| `public_balance` | Public | The threshold claim ("I have >= X ETH") |
| `commitment` | Public | Binds identity to balance without revealing either |
| `nullifier` | Public | Sybil resistance without revealing identity |
| `link_in`, `link_out` | Public | Chain integrity between sub-circuits |
| `address` | Private | The whole point -- address stays hidden |
| `signature`, `public_key` | Private | Would reveal the address |
| `nullifier_balance` | Private | Could narrow down identity if revealed |
| `blinding` | Private | Protects commitment and links from brute-force |
| `header_rlp`, `state_root` | Private | Prevents linking proof to specific state trie path |
| MPT nodes, leaf, account | Private | Would reveal the address via the trie path |

## Soundness Argument

A valid set of 5 proofs guarantees:

1. **Identity binding**: The prover knows a private key that signed `ghostbalance:v0:identity`, and the derived address is committed in `commitment` (Circuit A).

2. **Commitment consistency**: The same `(address, nullifier_balance, blinding)` tuple is used in both Circuit A (via commitment) and Circuit B1 (via commitment recomputation). Poseidon2 collision resistance ensures these must be identical.

3. **State root binding**: The block header RLP-decodes to the claimed `block_number` and `state_root`, and hashes to `block_hash` (Circuit B1). The verifier can check `block_hash` against the canonical chain.

4. **MPT path integrity**: The link chain `B1 -> B2 -> B3 -> B4` ensures the same `(address_hash, nullifier_balance, blinding)` threads through all MPT steps, and the traversal state (`curr_hash`, `key_ptr`) is carried faithfully. Each internal node's keccak256 hash matches the parent's reference. Poseidon2 collision resistance on the links prevents substituting different intermediate states.

5. **Account verification**: The MPT leaf is verified against the final traversal hash, the account RLP is decoded and field-checked, and the account's balance is asserted to be >= both `public_balance` and `nullifier_balance` (Circuit B4).

6. **No oracle trust**: All Ethereum data (block header, state proof) is pre-fetched in JavaScript and passed as private circuit inputs. The circuits verify everything cryptographically -- no trusted oracle.

## Eth Primitives Library (`eth-primitives/`)

A Noir library vendored from [eth-proofs](https://github.com/nomad-xyz/eth-proofs), providing:

| Module | Purpose |
|--------|---------|
| `link` | `compute_link()` -- Poseidon2 commitment for inter-circuit linking |
| `mpt` | `verify_node_hash()`, `extract_hash()`, `verify_leaf()` -- MPT traversal |
| `account` | `assert_account_equals()` -- RLP decode + field assertions for account state |
| `rlp_decode` | General RLP list decoding |
| `rlp_types` | `RlpList` type for decoded RLP data |
| `fragment` | `Fragment` type -- a windowed view into a fixed-size array |
| `bytes` | `right_pad()`, `bytes_to_nibbles()` -- byte manipulation |
| `consts` | `MAX_NODE_LEN=532`, `MAX_ACCOUNT_LEAF_LEN=148`, `MAX_ACCOUNT_STATE_LEN=110`, etc. |
| `types` | `Address=[u8;20]`, `Bytes32=[u8;32]` type aliases |

All B-series circuits depend on `eth_primitives`. Circuit A is standalone (only uses `keccak256` and `poseidon2` directly).

## Frontend Proving Flow

```
Browser                                          Server
  |                                                 |
  |  1. Sign "ghostbalance:v0:identity"             |
  |  2. Recover pubkey from signature               |
  |  3. Fetch block header + account proof (RPC)    |
  |  4. Execute A  -> (commitment, nullifier)       |
  |  5. Execute B1 -> (block_hash, link_1)          |
  |  6. Execute B2 -> link_2                        |
  |  7. Execute B3 -> link_3                        |
  |  8. Execute B4 -> (witness only)                |
  |  9. Prove A  (bb.js WASM, ~10s)                 |
  | 10. Prove B1 (bb.js WASM, ~15s)                 |
  | 11. Prove B2 (bb.js WASM, ~25s)                 |
  | 12. Prove B3 (bb.js WASM, ~25s)                 |
  | 13. Prove B4 (bb.js WASM, ~20s)                 |
  |                                                 |
  |  POST /api/verify {proofA..B4, publicInputs}    |
  |------------------------------------------------>|
  |                                                 |  Verify 5 proofs
  |                                                 |  Check link chain
  |                                                 |  Return {valid, chainId,
  |                                                 |    blockNumber, balance,
  |  <-- {valid: true, ...}                         |    blockHash, nullifier}
  |                                                 |
```

The execution phase (steps 4-8) chains `returnValue` from each circuit as input to the next, avoiding the need for Poseidon2 in JavaScript. The MPT replay module (`mptReplay.ts`) computes intermediate `curr_hash`/`key_ptr` values needed for B3 and B4 inputs by replaying the path in JS using keccak256.

## Future: Recursive Proof for On-Chain Verification

The current system verifies 5 proofs server-side. For on-chain (Solidity) verification, submitting 5 separate proofs would be prohibitively expensive (~300K+ gas per `verifyProof` call). The path forward is **recursive proving**: a wrapper circuit that takes all 5 proofs as private inputs, verifies them, checks the link chain, and outputs a single proof.

```
Recursive circuit
  Private inputs: proof_A, proof_B1, proof_B2, proof_B3, proof_B4 + all public inputs
  Logic:
    - Verify all 5 proofs
    - Check A.commitment == B1.commitment_in
    - Check B1.link_out == B2.link_in == ... == B4.link_in
  Public outputs: block_number, block_hash, public_balance, nullifier
```

The smart contract then verifies a single proof. The commitment and link values become internal to the recursive circuit and never appear on-chain, which is actually a privacy improvement -- less public data exposed.

Recursive proving is too heavy for the browser (the verifier circuit itself would exceed the 2^19 gate limit), so it would run on a server. This introduces no privacy leak: the server only sees the 5 proofs and their public inputs, which are the same data the current `/api/verify` endpoint already receives. The proofs are zero-knowledge -- they reveal nothing beyond the public inputs, all of which are either intentionally public (chain_id, block_number, etc.) or opaque due to blinding (commitment, links).

## File Layout

```
circuits/
  identity_nullifier/     # Circuit A (standalone)
    src/main.nr
    src/identity.nr       # ECDSA verify + address derivation
    src/nullifier.nr      # Poseidon2-based nullifier
  balance_header/         # Circuit B1
    src/main.nr
  balance_mpt_step/       # Circuit B2 & B3 (reused)
    src/main.nr
  balance_final/          # Circuit B4
    src/main.nr
  eth-primitives/         # Noir lib (link, mpt, account, rlp, etc.)
    src/lib.nr
    src/*.nr
  test/
    integration.mjs       # End-to-end test against Sepolia
    fetchProofData.mjs    # Ethereum data fetcher
    mptReplay.mjs         # MPT path replay for intermediate state
    constants.mjs
    utils.mjs
```
