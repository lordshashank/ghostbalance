use keccak256::keccak256;

/// The fixed identity message: "RedactedChat:v0:identity" (24 bytes)
global IDENTITY_MESSAGE: [u8; 24] = [
    0x52, 0x65, 0x64, 0x61, 0x63, 0x74, 0x65, 0x64, // Redacted
    0x43, 0x68, 0x61, 0x74, 0x3a, 0x76, 0x30, 0x3a, // Chat:v0:
    0x69, 0x64, 0x65, 0x6e, 0x74, 0x69, 0x74, 0x79, // identity
];

/// EIP-191 prefix: "\x19Ethereum Signed Message:\n24" (28 bytes)
global ETH_PREFIX: [u8; 28] = [
    0x19,                                              // \x19
    0x45, 0x74, 0x68, 0x65, 0x72, 0x65, 0x75, 0x6d,  // Ethereum
    0x20, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x20,  //  Signed
    0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x3a,  // Message:
    0x0a, 0x32, 0x34,                                  // \n24
];

/// Total prefixed message length: 28 (prefix) + 24 (message) = 52
global PREFIXED_MSG_LEN: u32 = 52;

/// Verifies an ECDSA secp256k1 signature over the hardcoded identity message
/// and derives the signer's Ethereum address.
///
/// Steps:
/// 1. Constructs the EIP-191 prefixed message
/// 2. Hashes it with keccak256
/// 3. Verifies the ECDSA signature
/// 4. Derives the Ethereum address from the public key
pub fn verify_identity_and_derive_address(
    signature: [u8; 64],
    public_key_x: [u8; 32],
    public_key_y: [u8; 32],
) -> [u8; 20] {
    // Build prefixed message: ETH_PREFIX (28 bytes) ++ IDENTITY_MESSAGE (24 bytes) = 52 bytes
    let mut prefixed_msg: [u8; PREFIXED_MSG_LEN] = [0; PREFIXED_MSG_LEN];
    for i in 0..28 {
        prefixed_msg[i] = ETH_PREFIX[i];
    }
    for i in 0..24 {
        prefixed_msg[28 + i] = IDENTITY_MESSAGE[i];
    }

    // Hash the prefixed message
    let message_hash: [u8; 32] = keccak256(prefixed_msg, PREFIXED_MSG_LEN);

    // Verify ECDSA signature
    let valid = std::ecdsa_secp256k1::verify_signature(
        public_key_x,
        public_key_y,
        signature,
        message_hash,
    );
    assert(valid, "Invalid ECDSA signature for identity message");

    // Derive Ethereum address: keccak256(pubkey_x ++ pubkey_y)[12..32]
    let mut pubkey_bytes: [u8; 64] = [0; 64];
    for i in 0..32 {
        pubkey_bytes[i] = public_key_x[i];
        pubkey_bytes[32 + i] = public_key_y[i];
    }
    let pubkey_hash: [u8; 32] = keccak256(pubkey_bytes, 64);

    let mut address: [u8; 20] = [0; 20];
    for i in 0..20 {
        address[i] = pubkey_hash[12 + i];
    }
    address
}

/// Computes the keccak256 hash of the EIP-191 prefixed identity message.
pub fn compute_message_hash() -> [u8; 32] {
    let mut prefixed_msg: [u8; PREFIXED_MSG_LEN] = [0; PREFIXED_MSG_LEN];
    for i in 0..28 {
        prefixed_msg[i] = ETH_PREFIX[i];
    }
    for i in 0..24 {
        prefixed_msg[28 + i] = IDENTITY_MESSAGE[i];
    }
    keccak256(prefixed_msg, PREFIXED_MSG_LEN)
}

// ============================================================
// Test vectors from Hardhat account #0
// Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
// Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
// Signed message: "RedactedChat:v0:identity" via EIP-191 personal_sign
// ============================================================

global TEST_PUBLIC_KEY_X: [u8; 32] = [
    0x83, 0x18, 0x53, 0x5b, 0x54, 0x10, 0x5d, 0x4a,
    0x7a, 0xae, 0x60, 0xc0, 0x8f, 0xc4, 0x5f, 0x96,
    0x87, 0x18, 0x1b, 0x4f, 0xdf, 0xc6, 0x25, 0xbd,
    0x1a, 0x75, 0x3f, 0xa7, 0x39, 0x7f, 0xed, 0x75,
];

global TEST_PUBLIC_KEY_Y: [u8; 32] = [
    0x35, 0x47, 0xf1, 0x1c, 0xa8, 0x69, 0x66, 0x46,
    0xf2, 0xf3, 0xac, 0xb0, 0x8e, 0x31, 0x01, 0x6a,
    0xfa, 0xc2, 0x3e, 0x63, 0x0c, 0x5d, 0x11, 0xf5,
    0x9f, 0x61, 0xfe, 0xf5, 0x7b, 0x0d, 0x2a, 0xa5,
];

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

global TEST_ADDRESS: [u8; 20] = [
    0xf3, 0x9f, 0xd6, 0xe5, 0x1a, 0xad, 0x88, 0xf6,
    0xf4, 0xce, 0x6a, 0xb8, 0x82, 0x72, 0x79, 0xcf,
    0xff, 0xb9, 0x22, 0x66,
];

global TEST_MESSAGE_HASH: [u8; 32] = [
    0x15, 0xc7, 0x32, 0x9f, 0x7b, 0x31, 0x3a, 0x29,
    0x98, 0x10, 0xbc, 0xb7, 0xbc, 0x0e, 0xc5, 0x8b,
    0xcf, 0xba, 0x1d, 0xc7, 0x22, 0xd6, 0xd0, 0x06,
    0x5f, 0xe9, 0x89, 0x8f, 0xd7, 0x59, 0xbd, 0xa8,
];

#[test]
fn test_message_hash_matches_expected() {
    // Verify the circuit's keccak256(prefix || message) matches the hash
    // computed externally by viem/ethers
    let hash = compute_message_hash();
    for i in 0..32 {
        assert(hash[i] == TEST_MESSAGE_HASH[i]);
    }
}

#[test]
fn test_valid_signature_accepted() {
    // Full end-to-end: verify a real ECDSA signature and derive the address
    let address = verify_identity_and_derive_address(
        TEST_SIGNATURE,
        TEST_PUBLIC_KEY_X,
        TEST_PUBLIC_KEY_Y,
    );
    for i in 0..20 {
        assert(address[i] == TEST_ADDRESS[i]);
    }
}

#[test(should_fail_with = "Invalid ECDSA signature for identity message")]
fn test_invalid_signature_rejected() {
    // Corrupt one byte of the signature - should fail ECDSA verification
    let mut bad_sig = TEST_SIGNATURE;
    bad_sig[0] = 0x00;
    let _ = verify_identity_and_derive_address(
        bad_sig,
        TEST_PUBLIC_KEY_X,
        TEST_PUBLIC_KEY_Y,
    );
}

#[test]
fn test_address_derivation() {
    // Verify keccak256(pubkey_x || pubkey_y)[12..32] matches the known address
    let mut pubkey_bytes: [u8; 64] = [0; 64];
    for i in 0..32 {
        pubkey_bytes[i] = TEST_PUBLIC_KEY_X[i];
        pubkey_bytes[32 + i] = TEST_PUBLIC_KEY_Y[i];
    }
    let pubkey_hash: [u8; 32] = keccak256(pubkey_bytes, 64);
    for i in 0..20 {
        assert(pubkey_hash[12 + i] == TEST_ADDRESS[i]);
    }
}

#[test(should_fail)]
fn test_wrong_pubkey_rejected() {
    // Correct signature but wrong public key - should fail
    let mut wrong_key_x = TEST_PUBLIC_KEY_X;
    wrong_key_x[0] = 0x00;
    let _ = verify_identity_and_derive_address(
        TEST_SIGNATURE,
        wrong_key_x,
        TEST_PUBLIC_KEY_Y,
    );
}
