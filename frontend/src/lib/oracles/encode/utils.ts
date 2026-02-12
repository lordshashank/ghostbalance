import { BYTE_HEX_LEN } from "./constants";

type PaddingDirection = "left" | "right";

export function padArray<T>(
  array: T[],
  len: number,
  pad: T,
  direction: PaddingDirection = "right"
): T[] {
  if (len < array.length) {
    throw new Error(
      `len param: ${len} should be >= array length: ${array.length}`
    );
  }
  const padCount = len - array.length;
  if (padCount === 0) return array.slice();
  // Build result without spread/concat to be safe with large arrays
  const result = new Array<T>(len);
  if (direction === "left") {
    for (let i = 0; i < padCount; i++) result[i] = pad;
    for (let i = 0; i < array.length; i++) result[padCount + i] = array[i];
  } else {
    for (let i = 0; i < array.length; i++) result[i] = array[i];
    for (let i = 0; i < padCount; i++) result[array.length + i] = pad;
  }
  return result;
}

export const RLP_SHORT_ENTITY_MAX_LEN = 55;

export function getMaxRlpHeaderSize(len: number): number {
  if (len <= RLP_SHORT_ENTITY_MAX_LEN) {
    return 1;
  } else {
    return 1 + Math.ceil(len.toString(16).length / BYTE_HEX_LEN);
  }
}

export function getMaxRlpEncodedSize(len: number): number {
  return getMaxRlpHeaderSize(len) + len;
}
