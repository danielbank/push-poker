/* Push Poker client. The server owns all state; this file renders it and sends intents. */

const SUITS = ['♠', '♥', '♣', '♦']
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const COLORS = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#4cc9f0', '#4361ee', '#9b5de5', '#f15bb5', '#ffffff', '#222222']
// ?p=<anything> gives a tab its own seat, for testing several players from one browser.
const SEAT_SUFFIX = new URLSearchParams(location.search).get('p') || ''
const TOKEN_KEY = 'push-poker-token' + SEAT_SUFFIX
const PROFILE_KEY = 'push-poker-profile' + SEAT_SUFFIX

const $app = document.getElementById('app')
const $conn = document.getElementById('conn')
const $toast = document.getElementById('toast')

let view = null
let playerId = null
const saved = readJSON(PROFILE_KEY) || {}
const ui = {
  name: saved.name || '',
  color: saved.color || COLORS[Math.floor(Math.random() * 6)],
  sel: null,            // {kind:'pick', col} | {kind:'put', slot?}
  motion: null,         // what the latest state update did, for animating it once: {move} or {deal}
  flashRow: null,
  flashCol: null,
  hideShowdown: false,
  abandonArmed: false,
  kbd: false,           // keyboard cursor visible (after an arrow key; hidden again on mouse/touch)
  cursor: 2,            // keyboard cursor in your row: a card 0..4, or a + slot 0..5 while holding a hole card
}

function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } }
function store(key, val) { try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)) } catch {} }
function getToken() { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }

/* ---------- Connection (auto-reconnects; every reconnect re-identifies and pulls full state) ---------- */

const socket = io({ reconnectionDelay: 500, reconnectionDelayMax: 3000, timeout: 8000 })

socket.on('connect', () => {
  setConn(true)
  socket.emit('hello', { token: getToken() })
})
socket.on('disconnect', () => setConn(false))
socket.io.on('reconnect_attempt', () => setConn(false, 'Reconnecting…'))

socket.on('session', (s) => {
  playerId = s.playerId
  store(TOKEN_KEY, s.token)
  render()
})

socket.on('state', (next) => {
  const prev = view
  view = next
  diff(prev, next)
  if (prev?.phase !== 'showdown' && next.phase === 'showdown') ui.hideShowdown = false
  if (next.phase !== 'playing') ui.sel = null
  // Buzz the phone when it becomes your move.
  const myTurn = (v) => v?.phase === 'playing' && v.players[v.game.turn]?.id === playerId
  if (myTurn(next) && !myTurn(prev)) navigator.vibrate?.(150)
  render()
})

// Phones suspend sockets when backgrounded; nudge a reconnect the moment the page is visible again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !socket.connected) socket.connect()
})
window.addEventListener('online', () => { if (!socket.connected) socket.connect() })

function setConn(ok, text) {
  $conn.classList.toggle('ok', ok)
  $conn.textContent = ok ? 'Connected' : text || 'Offline, reconnecting…'
}

function send(event, payload = {}) {
  return new Promise((resolve) => {
    if (!socket.connected) { toast('Not connected yet. Hang on…'); return resolve(false) }
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) { toast('The server did not answer. Try again.'); return resolve(false) }
      if (!res.ok) toast(res.error)
      resolve(res.ok)
    })
  })
}

let toastTimer
function toast(msg) {
  $toast.textContent = msg
  $toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($toast.hidden = true), 3500)
}

function diff(prev, next) {
  ui.motion = null
  ui.flashRow = ui.flashCol = null
  if (next.phase !== 'playing') return
  if (prev && (prev.phase !== 'playing' || prev.gameNumber !== next.gameNumber)) { ui.motion = { deal: true }; return }
  if (!prev) return
  const lm = next.game.lastMove
  if (lm && next.game.movesMade !== prev.game.movesMade) {
    ui.motion = { move: lm }
    if (lm.type === 'shiftCol') ui.flashCol = lm.col
    else ui.flashRow = next.rows.findIndex((r) => r.owner === lm.playerId)
  }
}

/* ---------- Helpers ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
const avatarUrl = (name) => `https://api.dicebear.com/10.x/critters/svg?seed=${encodeURIComponent(name)}`
const avatar = (p, size = '') =>
  `<img class="avatar ${size}" style="--pc:${p.color}" src="${avatarUrl(p.name)}" alt="">`
const player = (id) => view.players.find((p) => p.id === id)
const me = () => view && playerId && player(playerId)
// Dark text on light player colors, white on dark ones.
function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1a1a1a' : '#fff'
}
const leading = (id) => view.phase === 'playing' && view.game?.leaders?.includes(id)
const cardName = (id) => `${RANKS[(id % 13) + 1]}${SUITS[(id / 13) | 0]}`

function cardHTML(id, cls = '', attrs = '') {
  if (id === null || id === undefined) return `<div class="card empty ${cls}" ${attrs}></div>`
  const suit = (id / 13) | 0
  const rank = (id % 13) + 1
  const color = suit % 2 ? 'red' : 'black'
  return `<div class="card ${color} ${cls}" ${attrs} data-card="${id}" title="${cardName(id)}">
    <div class="face" style="background-image:url(/faces/${suit}_${rank}.svg)"></div>
    <div class="idx">${RANKS[rank]}</div><div class="idx br">${RANKS[rank]}</div>
  </div>`
}

/* ---------- Render ---------- */

function render() {
  if (!view) return
  const focusId = document.activeElement?.id
  const p = me()

  let html
  if (!p) html = renderJoin() + (view.phase === 'lobby' ? renderLobbyList() : renderTable(true))
  else if (view.phase === 'lobby') html = renderLobby()
  else html = renderTable(false)
  const before = snapshotCards()
  $app.innerHTML = html
  if (p && view.phase === 'showdown' && !ui.hideShowdown) $app.insertAdjacentHTML('beforeend', renderShowdown())
  animateCards(before, ui.motion)

  // Keep typing focus across live re-renders.
  if (focusId) {
    const el = document.getElementById(focusId)
    if (el) { el.focus(); if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length) }
  }
  ui.motion = null
  ui.flashRow = ui.flashCol = null
}

function renderJoin() {
  const open = view.phase !== 'playing' && view.players.length < 4
  const offline = view.players.filter((p) => !p.online)
  const preview = { name: ui.name || 'Your name', color: ui.color }
  return `
    ${offline.length ? `
      <section class="panel">
        <h2>Rejoin your seat</h2>
        <p class="muted">Lost your connection or switched devices? Tap your name.</p>
        <div class="players" style="margin-top:12px">
          ${offline.map((p) => `
            <button class="player" style="--pc:${p.color}; text-align:left" data-act="claim" data-id="${p.id}">
              ${avatar(p)}<div class="grow"><div class="name">${esc(p.name)}</div><div class="meta">${p.wins} win${p.wins === 1 ? '' : 's'} · offline</div></div>
              <span class="btn small">That's me</span>
            </button>`).join('')}
        </div>
      </section>` : ''}
    ${open ? `
      <section class="panel">
        <h2>Take a seat</h2>
        <div class="join-preview">
          ${avatar(preview, 'lg')}
          <div class="muted">Your critter is generated from your name.</div>
        </div>
        <label class="field"><span>Name</span>
          <input id="name" type="text" maxlength="20" autocomplete="off" value="${esc(ui.name)}" placeholder="e.g. Ace" data-input="name">
        </label>
        <div class="field"><span>Color</span>
          <div class="swatches">${COLORS.map((c) => `<button class="swatch ${c === ui.color ? 'on' : ''}" style="background:${c}" data-act="color" data-color="${c}" aria-label="${c}"></button>`).join('')}</div>
        </div>
        <button class="btn" data-act="join" ${ui.name.trim() ? '' : 'disabled'}>Join the table</button>
      </section>` : view.phase === 'playing' ? `<p class="muted" style="margin-bottom:12px">A game is in progress. You can join when it ends, or rejoin your seat above.</p>` : `<p class="muted">The table is full.</p>`}
  `
}

function renderLobbyList() {
  if (!view.players.length) return ''
  return `<section class="panel"><h2>At the table</h2>${playerList(false)}</section>`
}

function playerList(canKick) {
  return `<div class="players">${view.players.map((p) => `
    <div class="player" style="--pc:${p.color}">
      ${avatar(p)}
      <div class="grow">
        <div class="name">${esc(p.name)}${p.id === playerId ? ' (you)' : ''}</div>
        <div class="meta"><span class="dot ${p.online ? '' : 'off'}"></span>${p.online ? 'online' : 'offline'} · ${p.wins} win${p.wins === 1 ? '' : 's'}</div>
      </div>
      ${canKick && !p.online ? `<button class="btn ghost small" data-act="kick" data-id="${p.id}">Remove</button>` : ''}
    </div>`).join('')}</div>`
}

function renderLobby() {
  const n = view.players.length
  return `
    <section class="panel">
      <h2>${view.gameNumber ? `Game ${view.gameNumber + 1}` : 'Waiting for players'}</h2>
      <p class="muted" style="margin-bottom:12px">${n}/4 seated. Others join from this same URL.</p>
      ${playerList(true)}
      <div class="row-btns">
        <button class="btn" data-act="start" ${n < 2 ? 'disabled' : ''}>${n < 2 ? 'Need 2+ players' : 'Deal!'}</button>
        <button class="btn ghost" data-act="leave">Leave table</button>
      </div>
    </section>
    ${rulesPanel()}
  `
}

function rulesPanel() {
  return `<details class="panel"><summary style="cursor:pointer;font-weight:700">How to play</summary>
    <div class="muted" style="margin-top:10px;line-height:1.6">
      Each player owns a row of 13 cards; 5 are in play. Make the best poker hand in your row.<br>
      <b>◀ ▶</b> Shift your row (it wraps).<br>
      <b>▲ ▼</b> Rotate a column through all four rows.<br>
      <b>Tap a card</b> in your row to take it as your hole card, safe from everyone. Tap your hole card to put it back.<br>
      <b>Knock</b> once 5 full rounds are done: everyone else gets one last move, then hands are compared
      (your 5 in-play cards + hole card, best 5 count).
    </div></details>`
}

function renderTable(spectator) {
  const g = view.game
  const turnPlayer = view.players[g.turn]
  const mine = !spectator && view.phase === 'playing' && turnPlayer.id === playerId
  const myRow = view.rows.findIndex((r) => r.owner === playerId)
  const p = me()

  return `
    <div class="scores">${view.players.map((q, i) => `
      <div class="score ${view.phase === 'playing' && i === g.turn ? 'turn' : ''} ${q.online ? '' : 'offline'}" style="--pc:${q.color}" data-pid="${q.id}">
        ${avatar(q, 'sm')}<span>${leading(q.id) ? '<span class="crown" title="Best hand on the table">👑</span>' : ''}${esc(q.name)}</span><span class="wins">${q.wins}</span>
        ${q.hasHole ? '<span class="mini-back" title="Holding a hole card"></span>' : ''}
        ${q.online ? '' : '<span class="dot off" title="offline"></span>'}
      </div>`).join('')}
    </div>
    ${renderStatus(mine, turnPlayer)}
    ${view.phase === 'playing' && !turnPlayer.online && !spectator ? `
      <div class="banner-off"><span class="grow">${esc(turnPlayer.name)} is offline. Their seat is held; they can rejoin from the same URL.</span>
      <button class="btn small ghost" data-act="skip">Skip their move</button></div>` : ''}
    <div class="board">
      <div class="grid5">${[0, 1, 2, 3, 4].map((c) => `<button class="arrow ${kbdColumn(mine) === c ? 'kbd-target' : ''}" data-act="col" data-col="${c}" data-dir="up" ${mine && !ui.sel ? '' : 'disabled'} aria-label="Shift column ${c + 1} up">▲</button>`).join('')}</div>
      ${view.rows.map((row, r) => renderRow(row, r, mine && r === myRow, mine)).join('')}
      <div class="grid5">${[0, 1, 2, 3, 4].map((c) => `<button class="arrow ${kbdColumn(mine) === c ? 'kbd-target' : ''}" data-act="col" data-col="${c}" data-dir="down" ${mine && !ui.sel ? '' : 'disabled'} aria-label="Shift column ${c + 1} down">▼</button>`).join('')}</div>
    </div>
    ${!spectator && p ? renderMineBar(mine, p) : ''}
    ${ui.sel ? renderPrompt() : ''}
    ${!spectator && view.phase === 'playing' ? `<p class="kbd-hint">
      <kbd>←</kbd><kbd>→</kbd> select · <kbd>Enter</kbd> pick up / put down ·
      <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd> shift row · <kbd>Shift</kbd>+<kbd>↑</kbd><kbd>↓</kbd> shift column ·
      <kbd>Shift</kbd>+<kbd>Enter</kbd> knock · <kbd>Esc</kbd> cancel</p>` : ''}
    <ul class="log">${view.log.map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul>
    ${!spectator && view.phase === 'playing' ? `<div class="footer-actions">
      <button class="link" data-act="abandon">${ui.abandonArmed ? 'Tap again to abandon this game (no winner)' : 'Abandon game'}</button></div>` : ''}
    ${view.phase === 'showdown' && ui.hideShowdown ? `<div class="row-btns" style="justify-content:center"><button class="btn" data-act="showResults">Show results</button></div>` : ''}
  `
}

function renderStatus(mine, turnPlayer) {
  const g = view.game
  if (view.phase === 'showdown') return `<div class="status">Showdown!</div>`
  const knocker = g.knockedBy && player(g.knockedBy)
  const sub = knocker
    ? `${esc(knocker.name)} knocked · ${g.finalMovesLeft} final move${g.finalMovesLeft === 1 ? '' : 's'} left`
    : g.canKnock ? `Round ${g.round} · knocking is open` : `Round ${g.round} · knocking opens after round ${g.roundsBeforeKnock}`
  if (mine) return `<div class="status mine" style="--pc:${turnPlayer.color}; --on-pc:${textOn(turnPlayer.color)}">Your move!<span class="sub">${sub}</span></div>`
  return `<div class="status ${knocker ? 'knocked' : ''}">${avatar(turnPlayer, 'sm').replace('<img', '<img style="vertical-align:middle;margin-right:6px;--pc:' + turnPlayer.color + '"')}Waiting for ${esc(turnPlayer.name)}…<span class="sub">${sub}</span></div>`
}

function renderRow(row, r, myActiveRow, myTurn) {
  const owner = row.owner && player(row.owner)
  const isMine = row.owner === playerId
  const result = (view.phase === 'showdown' && view.game.result?.hands.find((h) => h.playerId === row.owner)) || null
  const sel = ui.sel
  const canPick = myActiveRow && !me().hasHole && !sel
  const kbdOn = ui.kbd && myActiveRow && !sel
  const label = owner
    ? `${avatar(owner, 'sm')}<span class="grow">${leading(owner.id) ? '<span class="crown" title="Best hand on the table">👑</span>' : ''}${esc(owner.name)}${isMine ? ' (you)' : ''}</span>
       ${row.hand ? `<span class="hand" title="Best hand from the cards on the table">${row.hand}</span>` : ''}
       ${isMine && me().hasHole && view.game.yourHand && view.game.yourHand !== row.hand ? `<span class="hand secret" title="Your real hand, counting your hole card. Only you can see this."><span class="mini-back"></span>${view.game.yourHand}</span>` : ''}
       ${result ? `<span class="hand">${result.name}</span>` : ''}`
    : `<span class="grow neutral">Neutral row</span>`
  const arrows = myActiveRow && !sel
    ? `<button class="arrow" data-act="row" data-dir="left" aria-label="Shift your row left">◀</button>
       <button class="arrow" data-act="row" data-dir="right" aria-label="Shift your row right">▶</button>`
    : ''

  const cards = row.inPlay.map((id, c) => {
    const cls = [
      ui.flashCol === c ? 'col-flash' : '',
      canPick ? 'pickable' : '',
      sel?.kind === 'pick' && myActiveRow && sel.col === c ? 'selected' : '',
      kbdOn && !me().hasHole && cursor() === c ? 'kbd-focus' : '',
      result?.cards.includes(id) ? 'win' : '',
    ].join(' ')
    const attrs = canPick ? `data-act="pick" data-col="${c}" role="button" tabindex="0" aria-label="Take ${cardName(id)} as hole card"` : ''
    return cardHTML(id, cls, `${attrs} data-pos="${c}"`)
  }).join('')

  // Insert markers between cards when putting a hole card back down.
  const showSlots = myActiveRow && (sel?.kind === 'put' || (kbdOn && me().hasHole))
  const slots = showSlots
    ? [0, 1, 2, 3, 4, 5].map((s) => `<button class="slot ${sel?.slot === s || (kbdOn && cursor() === s) ? 'on' : ''}" data-act="slot" data-slot="${s}"
        style="left: calc(${s} * (var(--cw) + var(--gap)) - var(--gap) / 2 + ${s === 0 ? '6px' : s === 5 ? '-6px' : '0px'})" aria-label="Insert at position ${s + 1}">+</button>`).join('')
    : ''

  return `<div class="row ${isMine ? 'mine' : ''} ${ui.flashRow === r ? 'flash' : ''}" style="--pc:${owner?.color || 'transparent'}">
    <div class="row-label">${label}${arrows}</div>
    <div class="grid5">${cards}${slots}</div>
  </div>`
}

function renderMineBar(mine, p) {
  const g = view.game
  const canPut = mine && p.hole !== null && !ui.sel
  const holeCard = p.hole !== null
    ? cardHTML(p.hole, canPut ? 'pickable' : ui.sel?.kind === 'put' ? 'selected' : '', canPut ? 'data-act="hole" role="button" tabindex="0" aria-label="Put your hole card down"' : '')
    : cardHTML(null)
  return `<div class="mine-bar">
    <div class="hole">${holeCard}
      <div class="label"><b>Hole card</b><br>${p.hole !== null ? (canPut ? 'Tap to put it back' : 'Safe from shifts') : mine ? 'Tap a card in your row<br>to pick one up' : 'None held'}</div>
    </div>
    <div class="spacer"></div>
    ${view.phase === 'playing' && !g.knockedBy ? `<button class="btn danger knock" data-act="knock" ${mine && g.canKnock && !ui.sel ? '' : 'disabled'}>Knock</button>` : ''}
  </div>`
}

function renderPrompt() {
  const s = ui.sel
  const p = me()
  if (s.kind === 'pick') {
    const id = view.rows.find((r) => r.owner === playerId).inPlay[s.col]
    return `<div class="prompt"><p>Pick up ${cardName(id)} as your hole card. Which side fills the gap? <span class="keys"><kbd>←</kbd> <kbd>→</kbd></span></p>
      <div class="row-btns">
        <button class="btn" data-act="pickFill" data-fill="left">◀ From the left</button>
        <button class="btn" data-act="pickFill" data-fill="right">From the right ▶</button>
        <button class="btn ghost" data-act="cancel">Cancel</button>
      </div></div>`
  }
  if (s.slot === undefined) {
    return `<div class="prompt"><p>Put ${cardName(p.hole)} back. Tap a <b style="color:var(--gold)">+</b> in your row to choose where it goes.</p>
      <div class="row-btns"><button class="btn ghost" data-act="cancel">Cancel</button></div></div>`
  }
  return `<div class="prompt"><p>Six cards don't fit. Which end gets pushed out of play? <span class="keys"><kbd>←</kbd> <kbd>→</kbd></span></p>
    <div class="row-btns">
      <button class="btn" data-act="eject" data-dir="left">◀ Left end</button>
      <button class="btn" data-act="eject" data-dir="right">Right end ▶</button>
      <button class="btn ghost" data-act="cancel">Cancel</button>
    </div></div>`
}

function renderShowdown() {
  const res = view.game.result
  const hands = [...res.hands].sort((a, b) => res.winners.includes(b.playerId) - res.winners.includes(a.playerId))
  const names = res.winners.map((id) => esc(player(id)?.name ?? '?')).join(' & ')
  return `<div class="overlay"><div class="showdown">
    <h2>${names} win${res.winners.length === 1 ? 's' : ''}!</h2>
    ${hands.map((h) => {
      const q = player(h.playerId)
      if (!q) return ''
      const won = res.winners.includes(h.playerId)
      return `<div class="result ${won ? 'won' : ''}" style="--pc:${q.color}">
        <div class="head">${avatar(q, 'sm')}<span style="flex:1">${esc(q.name)} · ${h.name}</span>${won ? '🏆' : ''}<span class="muted">${q.wins} win${q.wins === 1 ? '' : 's'}</span></div>
        <div class="cards">${h.cards.map((id) => cardHTML(id)).join('')}</div>
        ${q.hole !== null ? `<div class="muted" style="margin-top:6px">Hole card: ${cardName(q.hole)}</div>` : ''}
      </div>`
    }).join('')}
    <div class="row-btns" style="justify-content:center">
      <button class="btn" data-act="nextGame">Deal next game</button>
      <button class="btn ghost" data-act="hideResults">View table</button>
      <button class="btn ghost" data-act="lobby">Back to lobby</button>
    </div>
  </div></div>`
}

/* ---------- Events ---------- */

$app.addEventListener('input', (e) => {
  if (e.target.dataset.input === 'name') {
    ui.name = e.target.value
    store(PROFILE_KEY, { name: ui.name, color: ui.color })
    // Update only the dependent bits so typing stays smooth.
    const img = $app.querySelector('.join-preview img')
    if (img) img.src = avatarUrl(ui.name || 'Your name')
    const btn = $app.querySelector('[data-act=join]')
    if (btn) btn.disabled = !ui.name.trim()
  }
})

$app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'name' && ui.name.trim()) act('join', {})
  else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card[data-act]')) { e.preventDefault(); e.target.click() }
})

/* Keyboard shortcuts (only on your own seat during a game):
 *   ← →            move the cursor along your row (cards, or the + slots while holding a hole card)
 *   Enter / Space  pick up the card under the cursor, or put your hole card down at the cursor's +
 *   Shift + ← →    shift your row
 *   Shift + ↑ ↓    shift the cursor's column
 *   Shift + Enter  knock
 *   While choosing a side: ← → choose, Esc cancels
 */
const holding = () => me()?.hasHole === true
const cursor = () => Math.min(ui.cursor, holding() ? 5 : 4)
// The column Shift+↑↓ acts on: the card under the cursor, or the card right of the focused + (the last + uses the last card).
const cursorColumn = () => Math.min(cursor(), 4)
const kbdColumn = (mine) => (ui.kbd && mine && !ui.sel ? cursorColumn() : -1)

document.addEventListener('pointerdown', () => { ui.kbd = false })

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input, textarea, select')) return
  if (!view || view.phase !== 'playing' || !me()) return
  const { key, shiftKey } = e
  const side = key === 'ArrowLeft' ? 'left' : key === 'ArrowRight' ? 'right' : null
  const vertical = key === 'ArrowUp' ? 'up' : key === 'ArrowDown' ? 'down' : null
  const sel = ui.sel

  // A pick-up or put-down choice is open: arrows choose the side.
  if (sel && (sel.kind === 'pick' || sel.slot !== undefined)) {
    if (side) { e.preventDefault(); return sel.kind === 'pick' ? act('pickFill', { fill: side }) : act('eject', { dir: side }) }
    if (key === 'Escape') { e.preventDefault(); return act('cancel') }
    return
  }
  if (key === 'Escape') { if (sel) { e.preventDefault(); act('cancel') } return }

  if (shiftKey) {
    if (side) { e.preventDefault(); return act('row', { dir: side }) }
    if (vertical) { e.preventDefault(); ui.kbd = true; return act('col', { col: cursorColumn(), dir: vertical }) }
    if (key === 'Enter') { e.preventDefault(); return act('knock') }
    return
  }

  if (side) {
    e.preventDefault()
    ui.cursor = Math.max(0, Math.min(cursor() + (side === 'left' ? -1 : 1), holding() ? 5 : 4))
    ui.kbd = true
    return render()
  }
  // Let Enter/Space on a focused button do its own thing.
  if ((key === 'Enter' || key === ' ') && ui.kbd && !e.target.closest('button, [data-act]')) {
    e.preventDefault()
    if (view.players[view.game.turn]?.id !== playerId) return toast(`It is ${view.players[view.game.turn].name}'s move`)
    return holding() ? act('slot', { slot: cursor() }) : act('pick', { col: cursor() })
  }
})

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]')
  if (!el || el.disabled) return
  act(el.dataset.act, el.dataset)
})

async function act(name, d) {
  if (name !== 'abandon') ui.abandonArmed = false
  switch (name) {
    case 'color':
      ui.color = d.color
      store(PROFILE_KEY, { name: ui.name, color: ui.color })
      return render()
    case 'join': return send('join', { name: ui.name, color: ui.color })
    case 'claim': return send('claimSeat', { playerId: d.id })
    case 'start': return send('start')
    case 'leave': return send('leave')
    case 'kick': return send('kick', { playerId: d.id })
    case 'skip': return send('skip')
    case 'nextGame': return send('nextGame')
    case 'lobby': return send('lobby')
    case 'hideResults': ui.hideShowdown = true; return render()
    case 'showResults': ui.hideShowdown = false; return render()
    case 'abandon':
      if (!ui.abandonArmed) { ui.abandonArmed = true; return render() }
      ui.abandonArmed = false
      return send('abandon')
    case 'row': return move({ type: 'shiftRow', dir: d.dir })
    case 'col': return move({ type: 'shiftCol', col: Number(d.col), dir: d.dir })
    case 'knock': return move({ type: 'knock' })
    case 'pick': ui.sel = { kind: 'pick', col: Number(d.col) }; return render()
    case 'pickFill': return move({ type: 'pickUp', col: ui.sel.col, fill: d.fill })
    case 'hole': ui.sel = { kind: 'put' }; return render()
    case 'slot': {
      const slot = Number(d.slot)
      // At either end only the far end can be pushed out, so there's nothing to ask.
      if (slot === 0) return move({ type: 'putDown', slot, eject: 'right' })
      if (slot === 5) return move({ type: 'putDown', slot, eject: 'left' })
      ui.sel = { kind: 'put', slot }
      return render()
    }
    case 'eject': return move({ type: 'putDown', slot: ui.sel.slot, eject: d.dir })
    case 'cancel': ui.sel = null; return render()
  }
}

async function move(m) {
  // Clear the prompt up front so the incoming state render doesn't need a second render
  // (which would restart the card animations mid-flight).
  const sel = ui.sel
  ui.sel = null
  if (!(await send('move', m))) { ui.sel = sel; render() }
}

/* ---------- Card animation ----------
 * Every render, remember where each card was, then animate each card from its old spot to its new one
 * (FLIP). Cards that enter or leave play slide in or out at the row's ends; another player's hidden
 * hole card flies to or from their scoreboard chip; a new game deals cards out from the middle of the table.
 * A render that interrupts an animation picks it up from the card's mid-flight position.
 */

const DURATION = 420
const EASE = 'cubic-bezier(.2, .75, .25, 1)'
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const CARD_SELECTOR = '.board .card[data-card], .hole .card[data-card]'

// Positions are stored relative to the board, so a banner above it changing height
// doesn't make every card on the table twitch.
const boardOrigin = () => {
  const b = $app.querySelector('.board')?.getBoundingClientRect()
  return b ? { x: b.left, y: b.top } : { x: 0, y: 0 }
}

function snapshotCards() {
  const snap = new Map()
  const o = boardOrigin()
  for (const el of $app.querySelectorAll(CARD_SELECTOR)) {
    const r = el.getBoundingClientRect()
    snap.set(el.dataset.card, { x: r.left - o.x, y: r.top - o.y, width: r.width, height: r.height, html: el.outerHTML, pos: Number(el.dataset.pos ?? 2) })
  }
  return snap
}

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
const chipRect = (pid) => $app.querySelector(`.score[data-pid="${pid}"]`)?.getBoundingClientRect()

function animateCards(before, motion) {
  // Hidden tabs (a phone with its screen off) don't run animations; don't queue up stale ones.
  if (reducedMotion.matches || document.hidden) return
  const els = [...$app.querySelectorAll(CARD_SELECTOR)]
  const lm = motion?.move
  const otherPlayersHole = lm && lm.playerId !== playerId
  const o = boardOrigin()
  // Turn a snapshot back into a viewport rect against the board's current position.
  for (const old of before.values()) old.rect = { left: o.x + old.x, top: o.y + old.y, width: old.width, height: old.height }
  const grid = $app.querySelector('.board .grid5')
  const gap = grid ? parseFloat(getComputedStyle(grid).columnGap) || 8 : 8
  const step = (r) => r.width + gap

  // Cards that stayed in view: glide from where they were.
  els.forEach((el, i) => {
    const now = el.getBoundingClientRect()
    const old = before.get(el.dataset.card)
    if (old) {
      const dx = old.rect.left - now.left
      const dy = old.rect.top - now.top
      const sx = old.rect.width / now.width
      const sy = old.rect.height / now.height
      if (Math.abs(dx) + Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) return
      lift(el, [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }])
      return
    }
    if (motion?.deal) {
      // Deal from the middle of the board, one card after another.
      const board = $app.querySelector('.board')?.getBoundingClientRect()
      if (!board) return
      const from = center(board)
      const to = center(now)
      lift(el, [
        { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) rotate(-12deg) scale(0.6)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ], { delay: i * 28, fill: 'backwards', duration: 360, origin: 'center' })
      return
    }
    if (!lm) return
    if (lm.type === 'putDown' && otherPlayersHole && chipRect(lm.playerId)) {
      // Their hidden hole card comes out of their scoreboard chip.
      const from = center(chipRect(lm.playerId))
      const to = center(now)
      lift(el, [
        { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(0.25)`, opacity: 0.2 },
        { transform: 'none', opacity: 1 },
      ], { origin: 'center' })
      return
    }
    // A card entering play slides in from the end of the row it comes from.
    const dir = Number(el.dataset.pos ?? 2) >= 2 ? 1 : -1
    lift(el, [{ transform: `translateX(${dir * step(now)}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }])
  })

  // Cards that left view: animate a ghost out of their old spot.
  if (!lm) return
  const nowIds = new Set(els.map((el) => el.dataset.card))
  for (const [id, old] of before) {
    if (nowIds.has(id)) continue
    const ghost = makeGhost(old)
    let to
    if (lm.type === 'pickUp' && otherPlayersHole && chipRect(lm.playerId)) {
      // Their new hole card disappears into their scoreboard chip.
      const target = center(chipRect(lm.playerId))
      const from = center(old.rect)
      to = { transform: `translate(${target.x - from.x}px, ${target.y - from.y}px) scale(0.25)`, opacity: 0 }
    } else {
      const dir = old.pos >= 2 ? 1 : -1
      to = { transform: `translateX(${dir * step(old.rect)}px)`, opacity: 0 }
    }
    ghost.animate([{ transform: 'none', opacity: 1 }, to], { duration: DURATION, easing: EASE }).onfinish = () => ghost.remove()
  }
}

// Raise a card above its neighbours while it moves.
function lift(el, keyframes, opts = {}) {
  const { origin = '0 0', ...timing } = opts
  el.style.transformOrigin = origin
  el.style.zIndex = 3
  const anim = el.animate(keyframes, { duration: DURATION, easing: EASE, ...timing })
  anim.onfinish = anim.oncancel = () => { el.style.zIndex = '' }
  return anim
}

function makeGhost(old) {
  const wrap = document.createElement('div')
  wrap.innerHTML = old.html
  const ghost = wrap.firstElementChild
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${old.rect.left}px`,
    top: `${old.rect.top}px`,
    width: `${old.rect.width}px`,
    height: `${old.rect.height}px`,
    margin: 0,
    zIndex: 4,
    pointerEvents: 'none',
    transformOrigin: 'center',
  })
  document.body.appendChild(ghost)
  return ghost
}
