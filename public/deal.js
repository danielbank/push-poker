/* Fancy deals. When a game is dealt, the real board cards start hidden (ui.dealPending) while stand-in
 * card backs perform one of three routines, picked at random, then land on each card's spot, where
 * the real card flips into view:
 *   slinky    - MS Solitaire style: cards arc out of the deck on parabolic paths, leaving trails
 *   riffle    - the deck splits into two piles that interlace, squares up a few times, then deals
 *   explosion - the deck flashes, compresses and shakes, blasts away, then rains down into place
 * Any tap or key press skips to the end. Relies on `ui` and `$app` from app.js, and on noiseHit() and
 * toneHit() from sound.js for the sound effects.
 */

const DEAL_STYLES = ['slinky', 'riffle', 'explosion']
let dealRun = null // { layer, anims, timers, done } while a deal is playing

// Called by app.js after rendering a freshly dealt board.
function dealShow(style = DEAL_STYLES[(Math.random() * DEAL_STYLES.length) | 0]) {
  stopRoutine() // a deal already playing stops, but the new board's cards stay hidden
  const board = $app.querySelector('.board')
  const els = [...$app.querySelectorAll('.board .card[data-card]')]
  if (!board || !els.length) return finishDeal()

  const b = board.getBoundingClientRect()
  const first = els[0].getBoundingClientRect()
  const w = first.width
  const h = first.height
  // The deck sits in the middle of the board; every stand-in is positioned relative to it.
  const deck = { x: b.left + b.width / 2 - w / 2, y: b.top + b.height / 2 - h / 2 }
  const targets = els.map((el) => {
    const r = el.getBoundingClientRect()
    return { id: el.dataset.card, dx: r.left - deck.x, dy: r.top - deck.y }
  })

  const layer = document.createElement('div')
  layer.className = 'deal-layer'
  document.body.appendChild(layer)
  dealRun = { layer, anims: [], timers: [], sounds: [] }
  dealRun.timers.push(setTimeout(finishDeal, 9000)) // safety net: never leave cards hidden

  const ctx = { layer, deck, w, h, targets }
  const routine = { slinky, riffle, explosion }[style] || riffle
  // Only this deal may finish itself; a deal that was stopped (skipped or replaced) just goes quiet.
  const run = dealRun
  const done = () => { if (dealRun === run) finishDeal() }
  routine(ctx).then(done, (e) => {
    // Stopping a deal cancels its animations (AbortError); anything else is a real bug worth seeing.
    if (e?.name !== 'AbortError' && e?.message !== 'deal stopped') console.error('Deal failed:', e)
    done()
  })
}

function stopRoutine() {
  const run = dealRun
  dealRun = null
  if (!run) return
  run.timers.forEach(clearTimeout)
  run.anims.forEach((a) => { try { a.cancel() } catch {} })
  run.sounds.forEach((src) => { try { src.stop() } catch {} })
  run.layer.remove()
}

// Stop everything and show the real board. Safe to call any time.
function finishDeal() {
  stopRoutine()
  if (ui.dealPending?.size) {
    ui.dealPending = null
    $app.querySelectorAll('.card.deal-pending').forEach((el) => el.classList.remove('deal-pending'))
  }
  // The board's labels, hands and buttons fade in once the deal is over.
  ui.dealing = false
  $app.querySelector('.board.dealing')?.classList.remove('dealing')
}

// Skip on any interaction.
document.addEventListener('pointerdown', () => { if (dealRun) finishDeal() }, true)
document.addEventListener('keydown', () => { if (dealRun) finishDeal() }, true)

/* ---------- Helpers ---------- */

function proxy(ctx, z = 0) {
  const el = document.createElement('div')
  el.className = 'deal-card'
  Object.assign(el.style, { left: `${ctx.deck.x}px`, top: `${ctx.deck.y}px`, width: `${ctx.w}px`, height: `${ctx.h}px`, zIndex: z })
  ctx.layer.appendChild(el)
  return el
}

// Resolves when the animation finishes; rejects if the deal is stopped, so nothing chained after it
// (like revealing a card) runs for a deal that is no longer playing.
function play(el, keyframes, opts) {
  if (!dealRun) return Promise.reject(new Error('deal stopped'))
  const a = el.animate(keyframes, { fill: 'forwards', ...opts })
  dealRun.anims.push(a)
  return a.finished
}
const quietly = (promise) => promise.catch(() => {})

const wait = (ms) => new Promise((resolve) => { if (dealRun) dealRun.timers.push(setTimeout(resolve, ms)); else resolve() })
const rand = (a, b) => a + Math.random() * (b - a)

// The real card for this id flips into view.
function reveal(id) {
  sfx.snap()
  ui.dealPending?.delete(id)
  const el = $app.querySelector(`.board .card[data-card="${id}"]`)
  if (!el) return
  el.classList.remove('deal-pending')
  el.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 160, easing: 'ease-out' })
}

/* ---------- Sound effects (synthesized; cut off if the deal is skipped) ---------- */

// Keep each scheduled sound so a skipped deal can silence it.
const sound = (src) => { if (src && dealRun) dealRun.sounds.push(src) }
const sfx = {
  // A crisp card snap as a card lands.
  snap: (at = 0) => sound(noiseHit({ at, dur: 0.035, sharp: 6, freq: rand(2600, 3600), q: 1.4, gain: 0.55 })),
  // One card slapping onto the others mid-riffle: shorter and softer than a snap.
  click: (at = 0) => sound(noiseHit({ at, dur: 0.018, sharp: 5, freq: rand(3000, 4500), q: 1.2, gain: 0.3 })),
  // Air moving as a card flies: a noise band sweeping up then fading.
  whoosh: (at = 0, dur = 0.5) => sound(noiseHit({ at, dur, sharp: 1.5, freq: 500, toFreq: 2400, q: 0.8, gain: 0.18 })),
  // The deck being split: a short shuffle of noise.
  swish: (at = 0) => sound(noiseHit({ at, dur: 0.16, sharp: 2, freq: 1800, toFreq: 900, q: 0.7, gain: 0.25 })),
  // An 8-bit beep for each flash.
  blip: (at = 0, hi = false) => sound(toneHit({ at, dur: 0.07, type: 'square', freq: hi ? 1320 : 880, gain: 0.08 })),
  // Pressure building: a buzzy tone climbing in pitch, with a rumble under it.
  rumble: (at = 0, dur = 0.6) => {
    sound(toneHit({ at, dur, type: 'sawtooth', freq: 60, toFreq: 240, gain: 0.08, attack: dur * 0.8 }))
    sound(noiseHit({ at, dur, sharp: 0.5, type: 'lowpass', freq: 200, toFreq: 900, q: 0.6, gain: 0.25 }))
  },
  // The blast: a deep falling thump plus a long burst of noise.
  boom: (at = 0) => {
    sound(toneHit({ at, dur: 0.6, type: 'sine', freq: 140, toFreq: 32, gain: 0.6 }))
    sound(noiseHit({ at, dur: 0.9, sharp: 3, type: 'lowpass', freq: 2200, toFreq: 120, q: 0.5, gain: 0.6 }))
  },
}

const at = (x, y, rot = 0, extra = '') => `translate(${x}px, ${y}px) rotate(${rot}deg) ${extra}`

// A neat stack of n backs at the deck spot, bottom first (last = top card).
function stack(ctx, n) {
  return Array.from({ length: n }, (_, i) => {
    const el = proxy(ctx, i)
    el.style.transform = at(0, -i * 0.35)
    return el
  })
}

// Deal the top cards of a stack out to the board, one after another.
async function dealOut(ctx, cards, { stagger = 45, duration = 420 } = {}) {
  const top = cards.slice(-ctx.targets.length).reverse()
  const rest = cards.slice(0, cards.length - ctx.targets.length)
  const flights = ctx.targets.map((t, i) => {
    const el = top[i]
    el.style.zIndex = 100 + i
    return wait(i * stagger).then(() =>
      play(el, [
        { transform: el.style.transform },
        { transform: at(t.dx * 0.55, t.dy * 0.55 - 30, rand(-14, 14)), offset: 0.55 },
        { transform: at(t.dx, t.dy, 0) },
      ], { duration, easing: 'cubic-bezier(.3, .7, .3, 1)' }).then(() => { reveal(t.id); el.remove() }))
  })
  // The leftover cards (the out-of-play part of each row) fade away under the deal.
  rest.forEach((el) => quietly(play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: ctx.targets.length * stagger })))
  await Promise.all(flights)
}

/* ---------- 1. Slinky (MS Solitaire) ---------- */

async function slinky(ctx) {
  const pile = stack(ctx, 6)
  const DURATION = 760
  const flights = ctx.targets.map((t, i) => wait(i * 85).then(() => {
    sfx.whoosh(0, DURATION / 1000)
    // A quadratic arc from the deck up over a peak and down onto the card's spot.
    const lift = rand(140, 260)
    const cx = t.dx / 2 + rand(-80, 80)
    const cy = Math.min(0, t.dy) - lift
    const spin = rand(-30, 30)
    const point = (s) => ({
      x: 2 * (1 - s) * s * cx + s * s * t.dx,
      y: 2 * (1 - s) * s * cy + s * s * t.dy,
      r: Math.sin(Math.PI * s) * spin,
    })
    const el = proxy(ctx, 200 + i)
    const frames = Array.from({ length: 25 }, (_, k) => { const p = point(k / 24); return { transform: at(p.x, p.y, p.r) } })
    // The slinky trail: copies left behind along the path that fade out.
    for (let k = 1; k < 16; k++) {
      dealRun?.timers.push(setTimeout(() => {
        if (!dealRun) return
        const p = point(k / 16)
        const ghost = proxy(ctx, 150 + i)
        ghost.style.transform = at(p.x, p.y, p.r)
        quietly(play(ghost, [{ opacity: 0.85 }, { opacity: 0 }], { duration: 520, easing: 'ease-in' }).then(() => ghost.remove()))
      }, (DURATION * k) / 16))
    }
    return play(el, frames, { duration: DURATION, easing: 'linear' }).then(() => { reveal(t.id); el.remove() })
  }))
  await Promise.all(flights)
  await Promise.all(pile.map((el) => play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 250 })))
}

/* ---------- 2. Riffle shuffle ---------- */

async function riffle(ctx) {
  let order = stack(ctx, 40)
  for (let pass = 0; pass < 3; pass++) {
    const half = order.length / 2
    const left = order.slice(0, half)
    const right = order.slice(half)
    // Split into two piles, angled toward each other.
    sfx.swish()
    await Promise.all([
      ...left.map((el, i) => play(el, [{ transform: el.style.transform }, { transform: at(-ctx.w * 0.62, -i * 0.35, -7) }], { duration: 200, easing: 'ease-out' })
        .then(() => { el.style.transform = at(-ctx.w * 0.62, -i * 0.35, -7) })),
      ...right.map((el, i) => play(el, [{ transform: el.style.transform }, { transform: at(ctx.w * 0.62, -i * 0.35, 7) }], { duration: 200, easing: 'ease-out' })
        .then(() => { el.style.transform = at(ctx.w * 0.62, -i * 0.35, 7) })),
    ])
    // Interlace: cards drop alternately from each pile, in small random clumps, into one stack.
    const merged = []
    let l = 0
    let r = 0
    let fromLeft = Math.random() < 0.5
    while (l < left.length || r < right.length) {
      const clump = 1 + ((Math.random() * 2.2) | 0)
      for (let k = 0; k < clump; k++) {
        if (fromLeft && l < left.length) merged.push(left[l++])
        else if (!fromLeft && r < right.length) merged.push(right[r++])
      }
      fromLeft = !fromLeft
    }
    // The "brrrrt": one click as each card lands on the stack.
    merged.forEach((_, j) => sfx.click((j * 8 + 120) / 1000))
    await Promise.all(merged.map((el, j) => {
      el.style.zIndex = j
      return play(el, [
        { transform: el.style.transform },
        { transform: at(0, -j * 0.35 - 16, 0), offset: 0.5 },
        { transform: at(0, -j * 0.35, 0) },
      ], { duration: 150, delay: j * 8, easing: 'ease-in-out' }).then(() => { el.style.transform = at(0, -j * 0.35, 0) })
    }))
    // Square up the deck.
    await Promise.all(merged.map((el) => play(el, [
      { transform: el.style.transform },
      { transform: `${el.style.transform} scale(1.05, 0.96)` },
      { transform: el.style.transform },
    ], { duration: 110, easing: 'ease-out' })))
    order = merged
  }
  await wait(120)
  await dealOut(ctx, order)
}

/* ---------- 3. Explosion ---------- */

async function explosion(ctx) {
  const cards = stack(ctx, 40)
  // Nintendo-style flashing: hard cuts between normal, blown-out white and inverted, each with a beep.
  for (let k = 0; k < 8; k++) sfx.blip(k * 0.08, k % 2 === 1)
  await Promise.all(cards.map((el) => play(el, [
    { filter: 'none' }, { filter: 'brightness(3)' }, { filter: 'none' }, { filter: 'invert(1)' },
    { filter: 'none' }, { filter: 'brightness(3)' }, { filter: 'none' }, { filter: 'invert(1)' }, { filter: 'none' },
  ], { duration: 640, easing: 'steps(1, end)', fill: 'none' })))

  // Compress and vibrate, building up pressure.
  const squash = []
  for (let k = 0; k <= 14; k++) {
    const p = k / 14
    const j = 2 + p * 5
    squash.push({ transform: `translate(${rand(-j, j)}px, ${rand(-j, j)}px) scale(${1 + 0.12 * p}, ${1 - 0.22 * p})` })
  }
  sfx.rumble(0, 0.62)
  await Promise.all(cards.map((el, i) => play(el, squash.map((f) => ({ transform: `${at(0, -i * 0.35)} ${f.transform}` })), { duration: 620, easing: 'linear' })))

  // Blast: a white flash, a jolt, and every card flies up and away.
  sfx.boom()
  const flash = document.createElement('div')
  flash.className = 'deal-flash'
  ctx.layer.appendChild(flash)
  quietly(play(flash, [{ opacity: 0.85 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' }))
  document.getElementById('app')?.animate([
    { transform: 'translate(0, 0)' }, { transform: 'translate(-10px, 8px)' }, { transform: 'translate(9px, -6px)' },
    { transform: 'translate(-5px, 3px)' }, { transform: 'translate(0, 0)' },
  ], { duration: 300 })
  const vh = innerHeight
  await Promise.all(cards.map((el) => {
    const angle = rand(-170, -10) * (Math.PI / 180)
    const dist = rand(0.7, 1.2) * vh
    return play(el, [
      { transform: el.style.transform },
      { transform: at(Math.cos(angle) * dist, Math.sin(angle) * dist, rand(-540, 540)) },
    ], { duration: 560, easing: 'cubic-bezier(.1, .75, .3, 1)' })
  }))

  // Rain: the dealt cards fall back from above into their spots with a little bounce.
  const top = cards.slice(-ctx.targets.length)
  cards.slice(0, cards.length - ctx.targets.length).forEach((el) => el.remove())
  await Promise.all(ctx.targets.map((t, i) => {
    const el = top[i]
    const startY = -ctx.deck.y - ctx.h - rand(40, 260)
    const tilt = rand(-35, 35)
    // Each segment has its own easing: accelerate down (gravity), then a small bounce.
    return play(el, [
      { transform: at(t.dx + rand(-40, 40), startY, tilt), easing: 'cubic-bezier(.55, 0, .9, .4)' },
      { transform: at(t.dx, t.dy, tilt * 0.2), offset: 0.82, easing: 'ease-out' },
      { transform: at(t.dx, t.dy - 14, 0), offset: 0.92, easing: 'ease-in' },
      { transform: at(t.dx, t.dy, 0) },
    ], { duration: 720, delay: rand(0, 650), easing: 'linear' }).then(() => { reveal(t.id); el.remove() })
  }))
}
