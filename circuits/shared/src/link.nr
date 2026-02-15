use poseidon::poseidon2::Poseidon2;

// Convert 16 bytes from a byte array starting at `start` into a Field element
pub fn bytes16_to_field(arr: [u8; 32], start: u32) -> Field {
    let mut result: Field = 0;
    for i in 0..16 {
        result = result * 256 + arr[start + i] as Field;
    }
    result
}

// Convert a 20-byte address into a Field element
pub fn address_to_field(address: [u8; 20]) -> Field {
    let mut result: Field = 0;
    for i in 0..20 {
        result = result * 256 + address[i] as Field;
    }
    result
}

// Compute a privacy-preserving link commitment between sub-circuits.
// The blinding factor prevents brute-force attacks on the intermediate state.
pub fn compute_link(
    curr_hash: [u8; 32],
    address_hash: [u8; 32],
    key_ptr: u32,
    nullifier_balance: u128,
    blinding: Field,
) -> Field {
    let ch_hi = bytes16_to_field(curr_hash, 0);
    let ch_lo = bytes16_to_field(curr_hash, 16);
    let ah_hi = bytes16_to_field(address_hash, 0);
    let ah_lo = bytes16_to_field(address_hash, 16);
    let h1 = Poseidon2::hash([ch_hi, ch_lo], 2);
    let h2 = Poseidon2::hash([ah_hi, ah_lo], 2);
    let h3 = Poseidon2::hash([key_ptr as Field, nullifier_balance as Field], 2);
    Poseidon2::hash([Poseidon2::hash([h1, h2], 2), Poseidon2::hash([h3, blinding], 2)], 2)
}
