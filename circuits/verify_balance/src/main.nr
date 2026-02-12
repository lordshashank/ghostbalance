mod identity;
mod nullifier;

use ethereum::account::{get_account, AccountWithinBlock};
use ethereum::misc::types::Address;

fn main(
    // Public inputs
    chain_id: pub u32,
    block_number: pub u64,
    public_balance: pub u128,    // Wei - the balance claim exposed in the proof

    // Private inputs
    nullifier_balance: u128,     // Wei - balance used to derive the nullifier identity
    signature: [u8; 64],        // ECDSA signature (r || s) over the identity message
    public_key_x: [u8; 32],
    public_key_y: [u8; 32],
) -> pub ([u8; 32], Field) {     // Returns (block_hash, nullifier)

    // Step 1: Verify ECDSA signature over the identity message and derive Ethereum address
    let address: Address = identity::verify_identity_and_derive_address(
        signature, public_key_x, public_key_y,
    );

    // Step 2: Fetch and verify account state via eth-proofs oracle + MPT proof
    let result: AccountWithinBlock = get_account(chain_id, block_number, address);

    // Step 3: Balance checks
    // Account.balance is Field - cast to u128 for safe integer comparison.
    // ETH total supply (~120M * 10^18 ~ 1.2e26) fits well within u128 (max 3.4e38).
    let balance_wei: u128 = result.account.balance as u128;
    assert(public_balance <= balance_wei, "public_balance exceeds actual balance");
    assert(nullifier_balance <= balance_wei, "nullifier_balance exceeds actual balance");

    // Step 4: Compute deterministic nullifier from signature + nullifier balance
    let nullifier = nullifier::compute_nullifier(
        signature, nullifier_balance as Field,
    );

    // Return public outputs
    (result.block_hash, nullifier)
}
