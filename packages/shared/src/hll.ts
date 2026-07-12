/**
 * A tiny HyperLogLog (S12) — approximate distinct count in fixed memory. You can't guard what you don't count,
 * and counting EXACT distinct-per-property over a firehose would cost a set per property (unbounded). HLL
 * estimates cardinality from a small register array (here 2^p registers) at a known error (~1.04/sqrt(m)), for
 * a few KB regardless of how many distinct values pass through. It powers the cardinality guards: "is this
 * property high-cardinality?" answered cheaply, in-stream.
 */
const P = 12; // 4096 registers → ~1.6% standard error
const M = 1 << P;

/** 32-bit hash with a murmur-style finalizer for decent avalanche (FNV-1a alone isn't uniform enough for HLL). */
function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class HyperLogLog {
  private readonly registers = new Uint8Array(M);

  add(value: string): void {
    const x = hash32(value);
    const idx = x >>> (32 - P); // top P bits pick the register
    const w = (x << P) | (1 << (P - 1)); // remaining bits; guard so clz terminates
    const rank = Math.clz32(w >>> 0) + 1; // position of the leftmost 1
    if (rank > this.registers[idx]) this.registers[idx] = rank;
  }

  estimate(): number {
    let sum = 0;
    let zeros = 0;
    for (let i = 0; i < M; i++) {
      sum += 2 ** -this.registers[i];
      if (this.registers[i] === 0) zeros++;
    }
    const alpha = 0.7213 / (1 + 1.079 / M); // bias correction constant for large m
    let est = (alpha * M * M) / sum;
    // Small-range correction: linear counting when many registers are still empty.
    if (est <= 2.5 * M && zeros > 0) est = M * Math.log(M / zeros);
    return Math.round(est);
  }
}
