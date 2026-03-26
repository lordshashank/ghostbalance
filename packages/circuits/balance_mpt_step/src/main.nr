use eth_primitives::mpt;
use eth_primitives::link::compute_link;
use eth_primitives::consts::{MAX_NODE_LEN, MAX_PREFIXED_KEY_NIBBLE_LEN};
use eth_primitives::types::Bytes32;
use eth_primitives::bytes::{right_pad, bytes_to_nibbles};
use eth_primitives::fragment::Fragment;

global NODES_PER_STEP: u32 = 4;

fn main(
    // Public inputs
    link_in: pub Field,

    // Private inputs
    curr_hash: Bytes32,
    address_hash: Bytes32,
    key_ptr_in: u32,
    nullifier_seed: u128,
    blinding: Field,
    depth: u64,
    start_index: u64,
    nodes: [[u8; MAX_NODE_LEN]; NODES_PER_STEP],
) -> pub Field {
    // Verify incoming link
    assert(
        compute_link(curr_hash, address_hash, key_ptr_in, nullifier_seed, blinding) == link_in,
        "Link mismatch",
    );

    // Construct the MPT key from address_hash.
    // The key is address_hash left-padded to 33 bytes (66 nibbles).
    // key_bytes = [0x00, address_hash[0], ..., address_hash[31]]
    let mut key_bytes: [u8; MAX_PREFIXED_KEY_NIBBLE_LEN] = [0; MAX_PREFIXED_KEY_NIBBLE_LEN];
    for i in 0..32 {
        key_bytes[MAX_PREFIXED_KEY_NIBBLE_LEN - 32 + i] = address_hash[i];
    }
    let key_padded = right_pad(key_bytes);
    let key_nibbles = bytes_to_nibbles(Fragment::from_vec(key_padded));

    let mut kp = key_ptr_in;
    let mut hash = curr_hash;

    // Process up to 4 nodes
    for j in 0..NODES_PER_STEP {
        let global_idx = start_index + j as u64;
        if global_idx < depth - 1 {
            mpt::verify_node_hash(nodes[j], hash);
            let next = mpt::extract_hash(nodes[j], key_nibbles, &mut kp);
            hash = next.data;
        }
    }

    // Compute outgoing link
    compute_link(hash, address_hash, kp, nullifier_seed, blinding)
}
