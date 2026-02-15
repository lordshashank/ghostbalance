use shared::link::{compute_link, address_to_field};
use shared::types::{Address, Bytes32};
use shared::fragment::Fragment;
use shared::rlp_decode::decode_list;
use shared::rlp_types::RlpList;
use keccak256::keccak256;
use poseidon::poseidon2::Poseidon2;

global MAX_HEADER_RLP_LEN: u32 = 708;
global MAX_HEADER_FIELDS: u32 = 20;
global STATE_ROOT_INDEX: u32 = 3;
global BLOCK_NUM_INDEX: u32 = 8;

fn main(
    // Public inputs
    block_number: pub u64,
    commitment_in: pub Field,

    // Private inputs
    address: Address,
    nullifier_balance: u128,
    blinding: Field,
    header_rlp: [u8; MAX_HEADER_RLP_LEN],
    header_rlp_len: u32,
    header_state_root: Bytes32,
) -> pub (Bytes32, Field) {
    // 1. Verify commitment matches Circuit A
    let addr_field = address_to_field(address);
    let inner = Poseidon2::hash([addr_field, nullifier_balance as Field], 2);
    let recomputed = Poseidon2::hash([inner, blinding], 2);
    assert(recomputed == commitment_in, "Commitment mismatch");

    // 2. Verify block header RLP
    // MAX_HEADER_FIELDS = 20 supports Sepolia and post-Cancun mainnet (block >= 19,426,587).
    // Pre-Cancun mainnet headers have fewer fields (15-17) but decode_list still works since
    // we only read indices 3 (state_root) and 8 (block_number), which exist in all forks.
    // The block header does not contain chain_id; chain identity is verified off-circuit
    // by checking the public block_hash output against the canonical chain.
    let header_fragment = Fragment::new_with_length(header_rlp_len, header_rlp);
    let header_fields: RlpList<MAX_HEADER_FIELDS> = decode_list(header_fragment);

    // Assert block_number matches
    header_fields.get(BLOCK_NUM_INDEX).assert_eq_value("Block number", header_fragment, block_number);
    // Assert state_root matches
    header_fields.get(STATE_ROOT_INDEX).assert_eq_value("State root", header_fragment, header_state_root);

    // 3. Hash header to get block_hash
    let block_hash: Bytes32 = keccak256(header_rlp, header_rlp_len);

    // 4. Compute address_hash = keccak256(address)
    let address_hash: Bytes32 = keccak256(address, 20);

    // 5. Compute link_out: state_root is curr_hash for first MPT step, key_ptr starts at 0
    let link_out = compute_link(header_state_root, address_hash, 0, nullifier_balance, blinding);

    (block_hash, link_out)
}
