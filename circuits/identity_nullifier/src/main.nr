mod identity;
mod nullifier;

use poseidon::poseidon2::Poseidon2;

fn address_to_field(address: [u8; 20]) -> Field {
    let mut result: Field = 0;
    for i in 0..20 {
        result = result * 256 + address[i] as Field;
    }
    result
}

fn main(
    // All private inputs
    nullifier_balance: u128,
    signature: [u8; 64],
    public_key_x: [u8; 32],
    public_key_y: [u8; 32],
    blinding: Field,
) -> pub (Field, Field) {   // (commitment, nullifier)

    // Step 1: ECDSA verify + derive address
    let address = identity::verify_identity_and_derive_address(
        signature, public_key_x, public_key_y,
    );

    // Blinded commitment binding address + nullifier_balance
    let inner = Poseidon2::hash([address_to_field(address), nullifier_balance as Field], 2);
    let commitment = Poseidon2::hash([inner, blinding], 2);

    // Step 4: Compute nullifier
    let nullifier = nullifier::compute_nullifier(signature, nullifier_balance as Field);

    (commitment, nullifier)
}
