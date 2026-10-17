/* Easter egg: Shift+S slaps the table. Everyone else sees a giant hand swoop across their screen
 * with comic-book POW/BLAM bursts and hears a slap. Purely cosmetic; it never touches the game.
 * Relies on `socket` and `me` from app.js.
 */

const SLAP_DURATION = 900
const IMPACT_AT = 0.5 // fraction of the swipe where the hand changes direction and lands
const BURST_WORDS = ['POW!', 'BLAM!', 'WHAM!', 'SMACK!', 'THWACK!']
const BURST_COLORS = [['#ffd60a', '#e63946'], ['#ff6b35', '#ffd60a'], ['#4cc9f0', '#ffd60a'], ['#f15bb5', '#fff3b0']]

// A cartoon open hand, drawn as vector art so it stays crisp at any size. The outline is a thick
// stroke drawn under the fill, so overlapping fingers merge into one clean silhouette.
const HAND_SHAPES = `
  <rect x="44" y="104" width="122" height="112" rx="48"/>
  <rect x="48" y="30" width="30" height="104" rx="15"/>
  <rect x="82" y="12" width="30" height="118" rx="15"/>
  <rect x="116" y="20" width="30" height="110" rx="15"/>
  <rect x="148" y="48" width="26" height="90" rx="13"/>
  <rect x="2" y="104" width="32" height="92" rx="16" transform="rotate(-38 18 150)"/>`
const HAND_SVG = `<svg viewBox="-20 0 210 230" aria-hidden="true">
  <g fill="#3b2314" stroke="#3b2314" stroke-width="14" stroke-linejoin="round">${HAND_SHAPES}</g>
  <g fill="#ffcf9e">${HAND_SHAPES}</g>
  <g fill="none" stroke="#c98f5c" stroke-width="4" stroke-linecap="round">
    <path d="M70 160 q30 18 70 -6"/>
    <path d="M78 186 q22 8 46 -2"/>
    <path d="M63 46 v20 M97 30 v20 M131 38 v20"/>
  </g>
  <g fill="#ff9e9e" opacity="0.45"><ellipse cx="105" cy="172" rx="34" ry="20"/></g>
</svg>`

document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyS' || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.target.matches('input, textarea, select') || !me()) return
  e.preventDefault()
  socket.emit('slap')
})

socket.on('slap', () => {
  if (document.hidden) return
  slapScreen()
})

/* ---------- Visuals ---------- */

function slapScreen() {
  const layer = document.createElement('div')
  layer.className = 'slap-layer'
  document.body.appendChild(layer)

  const hand = document.createElement('div')
  hand.className = 'slap-hand'
  hand.innerHTML = HAND_SVG
  layer.appendChild(hand)

  // A V-shaped swipe: swoop down from the upper left to the impact point, then swing back up
  // and out to the right, so the hand visibly changes direction halfway like a real slap.
  hand.animate([
    { transform: 'translate(-75vw, -55vh) rotate(-50deg) scale(0.8)', easing: 'cubic-bezier(.55, 0, 1, .45)' },
    { transform: 'translate(0, 6vh) rotate(-8deg) scale(1.15)', offset: IMPACT_AT, easing: 'cubic-bezier(0, .55, .45, 1)' },
    { transform: 'translate(75vw, -60vh) rotate(55deg) scale(0.9)' },
  ], { duration: SLAP_DURATION, fill: 'forwards' })

  const impact = SLAP_DURATION * IMPACT_AT
  setTimeout(() => {
    playSlapSound()
    shake()
  }, impact - 30)

  // Comic bursts pop up around the impact while the hand is on screen.
  const words = shuffle([...BURST_WORDS]).slice(0, 3)
  words.forEach((word, i) => setTimeout(() => burst(layer, word, i), impact - 120 + i * 140))

  setTimeout(() => layer.remove(), SLAP_DURATION + 900)
}

function burst(layer, word, i) {
  const [fill, ink] = BURST_COLORS[(Math.random() * BURST_COLORS.length) | 0]
  const el = document.createElement('div')
  el.className = 'slap-burst'
  // Spread the bursts around the centre: one left, one right, one above.
  const spots = [[-22, 4], [20, -6], [-2, -22]]
  const [x, y] = spots[i % spots.length]
  el.style.left = `calc(50% + ${x + (Math.random() * 8 - 4)}vw)`
  el.style.top = `calc(50% + ${y + (Math.random() * 6 - 3)}vh)`
  const tilt = Math.random() * 30 - 15
  el.innerHTML = `
    <svg viewBox="-100 -100 200 200" aria-hidden="true">
      <polygon points="${starPoints(14, 96, 62)}" fill="${fill}" stroke="#111" stroke-width="7" stroke-linejoin="round"/>
    </svg>
    <span style="color:${ink}">${word}</span>`
  layer.appendChild(el)
  el.animate([
    { transform: `translate(-50%, -50%) scale(0) rotate(${tilt - 40}deg)`, opacity: 1 },
    { transform: `translate(-50%, -50%) scale(1.25) rotate(${tilt}deg)`, opacity: 1, offset: 0.25 },
    { transform: `translate(-50%, -50%) scale(1) rotate(${tilt}deg)`, opacity: 1, offset: 0.7 },
    { transform: `translate(-50%, -50%) scale(1.1) rotate(${tilt}deg)`, opacity: 0 },
  ], { duration: 1000, easing: 'ease-out', fill: 'forwards' })
}

// Points for a spiky comic starburst.
function starPoints(spikes, outer, inner) {
  const pts = []
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? inner * (0.85 + Math.random() * 0.3) : outer * (0.85 + Math.random() * 0.15)
    const a = (Math.PI * i) / spikes
    pts.push(`${(Math.sin(a) * r).toFixed(1)},${(-Math.cos(a) * r).toFixed(1)}`)
  }
  return pts.join(' ')
}

function shake() {
  document.getElementById('app')?.animate([
    { transform: 'translate(0, 0)' },
    { transform: 'translate(-14px, 6px) rotate(-0.6deg)' },
    { transform: 'translate(12px, -5px) rotate(0.5deg)' },
    { transform: 'translate(-8px, 3px)' },
    { transform: 'translate(4px, -2px)' },
    { transform: 'translate(0, 0)' },
  ], { duration: 320, easing: 'ease-out' })
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/* ---------- Sound (synthesized, no audio files) ---------- */

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

function playSlapSound() {
  if (!audioCtx || audioCtx.state !== 'running') return
  const ctx = audioCtx
  const t = ctx.currentTime
  // Master level: the layers sum to a peak of about 1.7, so this keeps the hit loud without clipping.
  const out = ctx.createGain()
  out.gain.value = 0.5
  out.connect(ctx.destination)

  // The crack: a burst of noise with a very fast decay, band-passed to sound like skin.
  const crack = noise(ctx, 0.22, 5)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 1700
  band.Q.value = 0.7
  crack.connect(band).connect(out)
  crack.start(t)

  // The sting: a thinner, brighter layer on top.
  const sting = noise(ctx, 0.08, 8)
  const high = ctx.createBiquadFilter()
  high.type = 'highpass'
  high.frequency.value = 3500
  const stingGain = ctx.createGain()
  stingGain.gain.value = 0.5
  sting.connect(high).connect(stingGain).connect(out)
  sting.start(t)

  // The thump: a quick low sine drop for body.
  const osc = ctx.createOscillator()
  const thump = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(170, t)
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.14)
  thump.gain.setValueAtTime(0.9, t)
  thump.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
  osc.connect(thump).connect(out)
  osc.start(t)
  osc.stop(t + 0.2)
}

// White noise with the decay envelope baked in.
function noise(ctx, seconds, sharpness) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, sharpness)
  const src = ctx.createBufferSource()
  src.buffer = buf
  return src
}
