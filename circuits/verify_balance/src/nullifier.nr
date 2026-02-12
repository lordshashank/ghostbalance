use poseidon::poseidon::bn254::hash_2;

/// Converts a 32-byte big-endian array to a Field element.
/// ECDSA r and s values are < secp256k1 order (~256 bits) but fit in bn254 field
/// since secp256k1 order < bn254 modulus.
pub fn bytes32_to_field(bytes: [u8; 32]) -> Field {
    let mut result: Field = 0;
    for i in 0..32 {
        result = result * 256 + bytes[i] as Field;
    }
    result
}

/// Computes a deterministic nullifier from the ECDSA signature and a balance value (in wei).
///
/// Splits the 64-byte signature into r (first 32 bytes) and s (last 32 bytes),
/// then computes: nullifier = poseidon(poseidon(r, s), nullifier_balance)
///
/// This produces a stable pseudonymous identity: same signature + same balance = same nullifier.
pub fn compute_nullifier(
    signature: [u8; 64],
    nullifier_balance: Field,
) -> Field {
    let mut r_bytes: [u8; 32] = [0; 32];
    let mut s_bytes: [u8; 32] = [0; 32];
    for i in 0..32 {
        r_bytes[i] = signature[i];
        s_bytes[i] = signature[32 + i];
    }

    let r_field = bytes32_to_field(r_bytes);
    let s_field = bytes32_to_field(s_bytes);

    let sig_hash = hash_2([r_field, s_field]);
    hash_2([sig_hash, nullifier_balance])
}

// ============================================================
// Test vectors using the real signature from identity.nr
// (Hardhat account #0 signing "RedactedChat:v0:identity")
// ============================================================

// Same signature as identity::TEST_SIGNATURE
global TEST_SIGNATURE: [u8; 64] = [
    0xac, 0x7c, 0x16, 0x38, 0x2d, 0x05, 0xd1, 0xd5,
    0x7f, 0xb3, 0x46, 0x34, 0xb3, 0x69, 0x9c, 0x41,
    0x06, 0xf9, 0x6d, 0x71, 0x13, 0x2e, 0x52, 0x09,
    0x9d, 0x79, 0x2a, 0x97, 0xc5, 0xb8, 0x82, 0xe8,
    0x09, 0x25, 0xb4, 0x15, 0xae, 0x8d, 0x91, 0x94,
    0x10, 0x99, 0x54, 0xee, 0xfd, 0xb9, 0x9f, 0xd1,
    0xfe, 0x4e, 0x4c, 0x52, 0xd6, 0xf0, 0x79, 0x9b,
    0x01, 0xae, 0x26, 0xd0, 0x40, 0x76, 0x4d, 0x5d,
];

#[test]
fn test_bytes32_to_field_zero() {
    let zero = [0u8; 32];
    assert(bytes32_to_field(zero) == 0);
}

#[test]
fn test_bytes32_to_field_one() {
    let mut one = [0u8; 32];
    one[31] = 1;
    assert(bytes32_to_field(one) == 1);
}

#[test]
fn test_bytes32_to_field_known_value() {
    let mut bytes = [0u8; 32];
    bytes[31] = 0xff;
    assert(bytes32_to_field(bytes) == 255);
}

#[test]
fn test_bytes32_to_field_multi_byte() {
    // 0x0100 = 256
    let mut bytes = [0u8; 32];
    bytes[30] = 1;
    assert(bytes32_to_field(bytes) == 256);

    // 0x0101 = 257
    bytes[31] = 1;
    assert(bytes32_to_field(bytes) == 257);
}

#[test]
fn test_bytes32_to_field_real_signature_r() {
    // r from TEST_SIGNATURE: first 32 bytes
    let r: [u8; 32] = [
        0xac, 0x7c, 0x16, 0x38, 0x2d, 0x05, 0xd1, 0xd5,
        0x7f, 0xb3, 0x46, 0x34, 0xb3, 0x69, 0x9c, 0x41,
        0x06, 0xf9, 0x6d, 0x71, 0x13, 0x2e, 0x52, 0x09,
        0x9d, 0x79, 0x2a, 0x97, 0xc5, 0xb8, 0x82, 0xe8,
    ];
    let r_field = bytes32_to_field(r);
    // Should be non-zero and produce a valid Field
    assert(r_field != 0);
}

#[test]
fn test_nullifier_deterministic() {
    // Same signature + same balance = same nullifier
    let balance: Field = 1000000000000000000; // 1 ETH in wei

    let n1 = compute_nullifier(TEST_SIGNATURE, balance);
    let n2 = compute_nullifier(TEST_SIGNATURE, balance);
    assert(n1 == n2);
}

#[test]
fn test_different_balance_different_nullifier() {
    // Same signature, different balance = different nullifier
    let balance_1eth: Field = 1000000000000000000;
    let balance_10eth: Field = 10000000000000000000;

    let n1 = compute_nullifier(TEST_SIGNATURE, balance_1eth);
    let n2 = compute_nullifier(TEST_SIGNATURE, balance_10eth);
    assert(n1 != n2);
}

#[test]
fn test_different_signature_different_nullifier() {
    // Different signature, same balance = different nullifier
    let mut other_sig = TEST_SIGNATURE;
    other_sig[0] = 0xff;

    let balance: Field = 1000000000000000000;
    let n1 = compute_nullifier(TEST_SIGNATURE, balance);
    let n2 = compute_nullifier(other_sig, balance);
    assert(n1 != n2);
}

#[test]
fn test_nullifier_nonzero() {
    // Nullifier from real data should not be the zero element
    let balance: Field = 1000000000000000000;
    let n = compute_nullifier(TEST_SIGNATURE, balance);
    assert(n != 0);
}
