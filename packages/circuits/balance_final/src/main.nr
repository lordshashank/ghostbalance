use eth_primitives::mpt;
use eth_primitives::link::compute_link;
use eth_primitives::consts::{MAX_NODE_LEN, MAX_PREFIXED_KEY_NIBBLE_LEN, MAX_ACCOUNT_LEAF_LEN, MAX_ACCOUNT_STATE_LEN};
use eth_primitives::types::Bytes32;
use eth_primitives::bytes::{right_pad, bytes_to_nibbles};
use eth_primitives::fragment::Fragment;

global REMAINING_NODES: u32 = 2;

fn main(
    // Public inputs
    link_in: pub Field,
    public_balance: pub u128,

    // Private inputs
    curr_hash: Bytes32,
    address_hash: Bytes32,
    key_ptr_in: u32,
    nullifier_seed: u128,
    blinding: Field,
    depth: u64,
    nodes: [[u8; MAX_NODE_LEN]; REMAINING_NODES],
    leaf: [u8; MAX_ACCOUNT_LEAF_LEN],
    account_value: [u8; MAX_ACCOUNT_STATE_LEN],
    account_nonce: u64,
    account_balance: Field,
    account_storage_root: Bytes32,
    account_code_hash: Bytes32,
) {
    // 1. Verify incoming link
    assert(
        compute_link(curr_hash, address_hash, key_ptr_in, nullifier_seed, blinding) == link_in,
        "Link mismatch",
    );

    // 2. Construct the MPT key from address_hash (same as in balance_mpt_step)
    let mut key_bytes: [u8; MAX_PREFIXED_KEY_NIBBLE_LEN] = [0; MAX_PREFIXED_KEY_NIBBLE_LEN];
    for i in 0..32 {
        key_bytes[MAX_PREFIXED_KEY_NIBBLE_LEN - 32 + i] = address_hash[i];
    }
    let key_padded = right_pad(key_bytes);
    let key_nibbles = bytes_to_nibbles(Fragment::from_vec(key_padded));

    let mut kp = key_ptr_in;
    let mut hash = curr_hash;

    // 3. Process remaining internal nodes (indices 8-9, if depth > 9)
    for j in 0..REMAINING_NODES {
        let global_idx = 8 + j as u64;
        if global_idx < depth - 1 {
            mpt::verify_node_hash(nodes[j], hash);
            let next = mpt::extract_hash(nodes[j], key_nibbles, &mut kp);
            hash = next.data;
        }
    }

    // 4. Verify leaf node
    mpt::verify_node_hash(leaf, hash);
    mpt::verify_leaf(leaf, key_nibbles, &mut kp, account_value);

    // 5. Verify account RLP matches claimed fields
    eth_primitives::account::assert_account_equals(
        account_value,
        account_nonce,
        account_balance,
        account_storage_root,
        account_code_hash,
    );

    // 6. Balance check
    let balance_wei: u128 = account_balance as u128;
    assert(public_balance <= balance_wei, "public_balance exceeds actual balance");
}
