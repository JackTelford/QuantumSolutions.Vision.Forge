/**
 * Deterministic noise for the handheld move. A small 32-bit PRNG
 * (mulberry32) hashes the shot seed, a channel number and a sample index
 * into a value in [-1, 1]; smooth value noise interpolates between
 * consecutive samples with a cosine so the shake has no steps and zero
 * slope at every sample. Nothing here keeps state: the same seed, channel
 * and position always give the same value, in Node and in the browser.
 */

/** The channels of handheld noise, one independent stream each. */
export const noiseChannels = {
  positionRight: 0,
  positionUp: 1,
  positionForward: 2,
  pitch: 3,
  yaw: 4,
  roll: 5,
} as const;

/** One of the handheld noise channels. */
export type NoiseChannel = (typeof noiseChannels)[keyof typeof noiseChannels];

/** 2^32, the range of a 32-bit unsigned integer; divides a hash into a fraction. */
const twoToThirtyTwo = 4294967296;

/**
 * mulberry32: a 32-bit generator by Tommy Ettinger. Each call advances the
 * state by the golden-ratio constant 0x6D2B79F5 and mixes it with two
 * multiply-xorshift rounds; the output is a fraction in [0, 1). Returns the
 * generator for the given seed.
 */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / twoToThirtyTwo;
  };
}

/**
 * One noise sample in [-1, 1] for a seed, channel and integer sample index:
 * the three are folded into one 32-bit state with distinct odd multipliers
 * (so neighbouring indexes and channels land far apart) and mulberry32
 * mixes it once. Pure: no sequence, no state.
 */
export function noiseSample(seed: number, channel: NoiseChannel, index: number): number {
  const folded = (Math.imul(seed | 0, 0x9e3779b1) + Math.imul(channel, 0x85ebca77) + Math.imul(index | 0, 0xc2b2ae3d)) | 0;
  return mulberry32(folded)() * 2 - 1;
}

/**
 * Smooth value noise in [-1, 1] at a continuous sample position: the two
 * samples around `position` blended by cosine interpolation, mu =
 * (1 − cos(π·fraction)) / 2, which gives a continuous curve with zero
 * slope at every integer position.
 */
export function smoothNoise(seed: number, channel: NoiseChannel, position: number): number {
  const index = Math.floor(position);
  const fraction = position - index;
  const before = noiseSample(seed, channel, index);
  const after = noiseSample(seed, channel, index + 1);
  const mu = (1 - Math.cos(Math.PI * fraction)) / 2;
  return before * (1 - mu) + after * mu;
}
