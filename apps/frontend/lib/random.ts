export function MurmurHash3(string: string) {
  let i = 0;
  let hash: number;
  for (hash = 1779033703 ^ string.length; i < string.length; i++) {
    let bitwise_xor_from_character = hash ^ string.charCodeAt(i);
    hash = Math.imul(bitwise_xor_from_character, 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return () => {
    // Return the hash that you can use as a seed
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

export function SimpleFastCounter32(
  seed1: number,
  seed2: number = 0,
  seed3: number = 0,
  seed4: number = 0
) {
  return () => {
    seed1 >>>= 0;
    seed2 >>>= 0;
    seed3 >>>= 0;
    seed4 >>>= 0;
    let cast32 = (seed1 + seed2) | 0;
    seed1 = seed2 ^ (seed2 >>> 9);
    seed2 = (seed3 + (seed3 << 3)) | 0;
    seed3 = (seed3 << 21) | (seed3 >>> 11);
    seed4 = (seed4 + 1) | 0;
    cast32 = (cast32 + seed4) | 0;
    seed3 = (seed3 + cast32) | 0;
    return (cast32 >>> 0) / 4294967296;
  };
}
