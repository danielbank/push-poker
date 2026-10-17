/* Shared, synthesized sound (no audio files): one audio context, unlocked on the first tap or key,
 * plus small building blocks used by the deal routines (deal.js) and the slap easter egg (slap.js).
 */

let audioCtx = null
// Browsers only allow audio after the page has been interacted with, so unlock on the first tap or key.
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
  } catch {}
}
document.addEventListener('pointerdown', unlockAudio)
document.addEventListener('keydown', unlockAudio)

const audioReady = () => audioCtx?.state === 'running'

// White noise with the decay envelope baked in.
function noise(ctx, seconds, sharpness) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, sharpness)
  const src = ctx.createBufferSource()
  src.buffer = buf
  return src
}

// A filtered noise burst `at` seconds from now. Returns the source (so it can be stopped), or null.
function noiseHit({ at = 0, dur = 0.05, sharp = 4, type = 'bandpass', freq = 2000, toFreq, q = 1, gain = 0.5 }) {
  if (!audioReady()) return null
  const ctx = audioCtx
  const t = ctx.currentTime + at
  const src = noise(ctx, dur, sharp)
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.setValueAtTime(freq, t)
  if (toFreq) filter.frequency.exponentialRampToValueAtTime(toFreq, t + dur)
  filter.Q.value = q
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(filter).connect(g).connect(ctx.destination)
  src.start(t)
  return src
}

// A tone `at` seconds from now, optionally gliding to `toFreq`, with a fast attack and a decay.
function toneHit({ at = 0, dur = 0.1, type = 'sine', freq = 440, toFreq, gain = 0.3, attack = 0.005 }) {
  if (!audioReady()) return null
  const ctx = audioCtx
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq, t + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
  return osc
}
