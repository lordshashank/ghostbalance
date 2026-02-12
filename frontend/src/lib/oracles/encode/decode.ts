import type { Address, Hex } from "viem";
import { isAddress, isHex, getAddress } from "viem";
import { BYTE_HEX_LEN, ADDRESS_LEN, BYTES32_LEN, MAX_U8 } from "./constants";

function decodeHexValue(arg: string[]): Hex {
  return ("0x" +
    arg
      .map((e) => parseInt(e, 16))
      .map((e) => e.toString(16).padStart(BYTE_HEX_LEN, "0"))
      .join("")) as Hex;
}

export function decodeBytes32(arg: string[]): Hex {
  if (arg.length !== BYTES32_LEN)
    throw new Error(`Invalid Bytes32 length: ${arg.length}`);
  for (const e of arg) {
    const d = parseInt(e, 16);
    if (d < 0 || d > MAX_U8 || !isHex(e))
      throw new Error(`Invalid Bytes32 byte: ${e}`);
  }
  const result = decodeHexValue(arg);
  if (!isHex(result)) throw new Error(`Invalid Bytes32: ${result}`);
  return result;
}

export function decodeAddress(arg: string[]): Address {
  if (arg.length !== ADDRESS_LEN)
    throw new Error(`Invalid address length: ${arg.length}`);
  for (const e of arg) {
    const d = parseInt(e, 16);
    if (d < 0 || d > MAX_U8 || !isHex(e))
      throw new Error(`Invalid address byte: ${e}`);
  }
  const result = getAddress(decodeHexValue(arg));
  if (!isAddress(result)) throw new Error(`Invalid address: ${result}`);
  return result;
}

export function decodeField(arg: string): bigint {
  if (!isHex(arg)) throw new Error(`Field should be hex: ${arg}`);
  return BigInt(arg);
}
