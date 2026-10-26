// Push Poker rules. Pure state transitions; the server owns persistence and networking.
//
// A row is a circular list of cards stored so that cards[0..4] are always the in-play cards
// and the rest are out of play (the belt), in wrap order. Every card in every row is face up.
// Holding hole cards removes them from a row and planting adds them to one, so row lengths vary.
// A player's hand is the best 5 of their in-play cards plus their hole cards.
//
// Chips: every game, each player gets a fresh stack and antes into the pot. Strong moves cost
// chips, which also go into the pot. Betting rounds (streets) follow set rounds of moves, and
// the showdown follows the last one. Whatever a player ends the game with is added to their
// session score, so nobody is ever knocked out of the table.

import { randomUUID, randomInt } from 'node:crypto'
import { bestHand, compareScores } from './hands.js'

export const ROWS = 4
export const IN_PLAY = 5
export const MAX_PLAYERS = 4
export const MIN_PLAYERS = 2
export const HOLE_CARD_OPTIONS = [1, 2]
export const STACK = 20
export const ANTE = 1
// A betting round follows each of these rounds of moves; the showdown follows the last one.
export const STREET_ROUNDS = [3, 6, 9]
export const STREET_NAMES = ['Flop', 'Turn', 'River']
// What each move costs. Moves that change other players' hands cost more.
export const COSTS = { shiftRow: 0, pickUp: 0, putDown: 0, beltDraw: 1, shiftCol: 2, plant: 3, pass: 0 }

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg) }

const RANK_NAMES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUIT_NAMES = ['♠', '♥', '♣', '♦']
export const cardName = (id) => `${RANK_NAMES[id % 13]}${SUIT_NAMES[(id / 13) | 0]}`

export function createState() {
  return { phase: 'lobby', settings: { holeCards: 1 }, hostId: null, players: [], rows: [], game: null, gameNumber: 0, log: [] }
}

export function setHoleCards(state, n) {
  if (inGame(state)) fail('Settings can only change between games')
  if (!HOLE_CARD_OPTIONS.includes(n)) fail('Hole cards must be 1 or 2')
  if (state.settings.holeCards === n) return
  state.settings.holeCards = n
  pushLog(state, `Hole cards set to ${n}`)
}

export function addPlayer(state, { name, color }) {
  name = String(name || '').trim().slice(0, 20)
  if (!name) fail('Pick a name')
  if (inGame(state)) fail('A game is in progress. Join after it ends.')
  if (state.players.length >= MAX_PLAYERS) fail('The table is full (4 players)')
  if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail('That name is taken')
  const player = {
    id: randomUUID(),
    token: randomUUID(),
    name,
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#e63946',
    score: 0,
    chips: 0,
    folded: false,
    holes: [],
  }
  state.players.push(player)
  pushLog(state, `${name} joined the table`)
  // The first player to join hosts the table.
  if (!state.hostId) {
    state.hostId = player.id
    pushLog(state, `${name} is the host`)
  }
  return player
}

export function removePlayer(state, playerId) {
  if (inGame(state)) fail('Cannot remove a player mid-game')
  const p = getPlayer(state, playerId)
  state.players = state.players.filter((x) => x.id !== playerId)
  pushLog(state, `${p.name} left the table`)
  // Hosting passes to the next player in seat order.
  if (state.hostId === playerId) {
    state.hostId = state.players[0]?.id ?? null
    if (state.hostId) pushLog(state, `${state.players[0].name} is now the host`)
  }
}

// The host deals, picks the game mode, and can abandon a game, so a sore loser can't end one.
export function requireHost(state, playerId) {
  if (state.hostId !== playerId) fail(`Only the host (${getPlayer(state, state.hostId).name}) can do that`)
}

export function setHost(state, playerId) {
  const p = getPlayer(state, playerId)
  if (state.hostId === playerId) return
  state.hostId = playerId
  pushLog(state, `${p.name} is now the host`)
}

function shuffledDeck() {
  const deck = Array.from({ length: 52 }, (_, i) => i)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

// A game is underway while players pick rows ('picking') and while they play ('playing').
const inGame = (state) => state.phase === 'picking' || state.phase === 'playing'

// Deal, ante, then let players choose rows: highest session score picks first (a random leader
// on a tie), then round-robin in seat order. Rows nobody picks stay neutral.
export function startGame(state) {
  if (inGame(state)) fail('A game is already in progress')
  const n = state.players.length
  if (n < MIN_PLAYERS) fail(`Need at least ${MIN_PLAYERS} players`)
  const deck = shuffledDeck()
  state.rows = Array.from({ length: ROWS }, (_, r) => ({ owner: null, cards: deck.slice(r * 13, r * 13 + 13) }))
  for (const p of state.players) {
    p.holes = []
    p.folded = false
    p.chips = STACK - ANTE
  }

  const most = Math.max(...state.players.map((p) => p.score))
  const leaders = state.players.map((p, i) => (p.score === most ? i : -1)).filter((i) => i >= 0)
  const firstPicker = leaders[randomInt(leaders.length)]
  const pickOrder = Array.from({ length: n }, (_, k) => state.players[(firstPicker + k) % n].id)

  // Who moves first still rotates each game, independent of who picks first.
  const first = state.gameNumber % n
  state.gameNumber++
  state.phase = 'picking'
  state.game = {
    turn: first,
    pickOrder,
    picks: 0,
    round: 1,
    moved: [],
    pot: ANTE * n,
    betting: null,
    seq: 0, // counts actions, so clients can tell each new one apart
    lastMove: null,
    result: null,
  }
  const why = leaders.length === 1
    ? (most ? `highest score (${most})` : 'drawn at random')
    : `tied for highest score (${most}), drawn at random`
  pushLog(state, `Game ${state.gameNumber} dealt. Everyone antes ${ANTE}. ${state.players[firstPicker].name} picks a row first: ${why}.`)
}

export const currentPicker = (state) => getPlayer(state, state.game.pickOrder[state.game.picks])

export function pickRow(state, playerId, rowIndex) {
  if (state.phase !== 'picking') fail('Rows have already been chosen')
  const picker = currentPicker(state)
  if (picker.id !== playerId) fail(`It is ${picker.name}'s pick`)
  const row = state.rows[rowIndex] || fail('No such row')
  if (row.owner) fail(`That row belongs to ${getPlayer(state, row.owner).name}`)
  row.owner = playerId
  state.game.picks++
  pushLog(state, `${picker.name} took row ${rowIndex + 1}`)
  if (state.game.picks === state.players.length) {
    state.phase = 'playing'
    pushLog(state, `Rows chosen. ${state.players[state.game.turn].name} moves first.`)
  }
}

// Used when the player whose pick it is has gone offline.
export function pickRandomRow(state, playerId) {
  const open = state.rows.map((r, i) => (r.owner ? -1 : i)).filter((i) => i >= 0)
  pickRow(state, playerId, open[randomInt(open.length)])
}

export function rowOf(state, playerId) {
  return state.rows.find((r) => r.owner === playerId)
}

export function getPlayer(state, playerId) {
  return state.players.find((p) => p.id === playerId) || fail('Unknown player')
}

const activePlayers = (state) => state.players.filter((p) => !p.folded)

// The next seat after `from` whose player hasn't folded.
function nextActiveSeat(state, from) {
  const n = state.players.length
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n
    if (!state.players[i].folded) return i
  }
  return from
}

// Whoever has to act now: the next bettor during a betting round, otherwise the next mover.
export const currentPlayer = (state) =>
  state.game.betting ? getPlayer(state, state.game.betting.toAct[0]) : state.players[state.game.turn]

// The most anyone may raise by: every player still in must be able to afford the call, so
// nobody is ever all-in and there are no side pots.
function maxRaise(state) {
  const b = state.game.betting
  return Math.max(0, Math.min(...activePlayers(state).map((p) => p.chips + (b.put[p.id] || 0))) - b.bet)
}

const dirOk = (d, a, b) => (d === a || d === b ? d : fail('Bad direction'))
const colOk = (c, max = IN_PLAY - 1) => (Number.isInteger(c) && c >= 0 && c <= max ? c : fail('Bad column'))

function rotateLeft(cards) { cards.push(cards.shift()) }
function rotateRight(cards) { cards.unshift(cards.pop()) }

function pay(state, player, amount) {
  if (amount > player.chips) fail(`That costs ${amount} chip${amount === 1 ? '' : 's'} and you have ${player.chips}`)
  player.chips -= amount
  state.game.pot += amount
}

// Apply one action for playerId. During a betting round move.type is 'bet' (or 'pass' when
// skipping an offline player); otherwise it is one of:
//   shiftRow {dir: 'left'|'right'}         cards slide that way; a new card enters from the other side
//   shiftCol {col, dir: 'up'|'down'}       that column's in-play cards rotate one row through all 4 rows
//   pickUp   {col, fill: 'left'|'right'}   take the card as a hole card; fill from that side
//   putDown  {hole, slot: 0..5, eject: 'left'|'right'}  insert hole card #hole before in-play
//                                          slot; push out that end
//   beltDraw {col}                         swap that in-play card with a random card from your belt
//   plant    {hole, row, col}              put hole card #hole into another player's row at col;
//                                          the card it replaces goes to the middle of their belt
//   pass     {}                            only used when skipping an offline player
export function applyMove(state, playerId, move) {
  if (state.phase === 'picking') fail('Wait for everyone to choose a row')
  if (state.phase !== 'playing') fail('No game in progress')
  if (state.game.betting) return applyBet(state, playerId, move)
  const player = currentPlayer(state)
  if (player.id !== playerId) fail(`It is ${player.name}'s move`)
  if (move?.type === 'bet') fail('Betting opens after a street')
  const row = rowOf(state, playerId)
  const cost = COSTS[move?.type]
  if (cost === undefined) fail('Unknown move')
  if (cost > player.chips) fail(`That costs ${cost} chip${cost === 1 ? '' : 's'} and you have ${player.chips}`)
  let text

  switch (move.type) {
    case 'shiftRow': {
      const dir = dirOk(move.dir, 'left', 'right')
      dir === 'left' ? rotateLeft(row.cards) : rotateRight(row.cards)
      text = `shifted their row ${dir}`
      break
    }
    case 'shiftCol': {
      const col = colOk(move.col)
      const dir = dirOk(move.dir, 'up', 'down')
      const column = state.rows.map((r) => r.cards[col])
      state.rows.forEach((r, i) => {
        const from = dir === 'down' ? (i - 1 + ROWS) % ROWS : (i + 1) % ROWS
        r.cards[col] = column[from]
      })
      text = `shifted column ${col + 1} ${dir}`
      break
    }
    case 'pickUp': {
      const max = state.settings.holeCards
      if (player.holes.length >= max) fail(max === 1 ? 'You already hold a hole card' : `You already hold ${max} hole cards`)
      if (row.cards.length <= IN_PLAY) fail('Your belt is empty, so nothing can fill the gap')
      const col = colOk(move.col)
      const fill = dirOk(move.fill, 'left', 'right')
      player.holes.push(row.cards.splice(col, 1)[0])
      // Splicing pulls the next card in from the right; filling from the left wraps the last card to the front.
      if (fill === 'left') rotateRight(row.cards)
      text = `picked up a hole card (filled from the ${fill})`
      break
    }
    case 'putDown': {
      const hole = holeOk(player, move.hole)
      const slot = colOk(move.slot, IN_PLAY)
      const eject = dirOk(move.eject, 'left', 'right')
      // Inserting at an end and pushing out that same end would send the hole card straight out of play.
      if ((slot === 0 && eject === 'left') || (slot === IN_PLAY && eject === 'right')) {
        fail('That would push your hole card straight out of play. Push out the other end.')
      }
      row.cards.splice(slot, 0, player.holes.splice(hole, 1)[0])
      // Six cards now sit at the front; pushing out the left end rotates it to the back.
      if (eject === 'left') rotateLeft(row.cards)
      text = `put their hole card down (pushed out the ${eject} end)`
      break
    }
    case 'beltDraw': {
      const col = colOk(move.col)
      const belt = row.cards.length - IN_PLAY
      if (!belt) fail('Your belt is empty')
      const at = IN_PLAY + randomInt(belt)
      const gave = row.cards[col]
      ;[row.cards[col], row.cards[at]] = [row.cards[at], row.cards[col]]
      text = `drew ${cardName(row.cards[col])} from their belt, giving up ${cardName(gave)}`
      break
    }
    case 'plant': {
      const hole = holeOk(player, move.hole)
      const target = state.rows[move.row] || fail('No such row')
      if (!target.owner || target.owner === playerId) fail("Plant in another player's row")
      const victim = getPlayer(state, target.owner)
      if (victim.folded) fail(`${victim.name} has folded`)
      const col = colOk(move.col)
      const card = player.holes.splice(hole, 1)[0]
      const replaced = target.cards[col]
      target.cards[col] = card
      // The pushed-out card goes to the far side of the belt, as far from play as it can be.
      const belt = target.cards.length - IN_PLAY
      target.cards.splice(IN_PLAY + Math.ceil(belt / 2), 0, replaced)
      text = `planted ${cardName(card)} in ${victim.name}'s row, pushing out ${cardName(replaced)}`
      break
    }
    case 'pass':
      text = 'was skipped (offline)'
      break
  }

  if (cost) pay(state, player, cost)
  state.game.lastMove = { seq: ++state.game.seq, playerId, type: move.type, col: move.col, dir: move.dir, row: move.row }
  pushLog(state, `${player.name} ${text}${cost ? ` (${cost} chip${cost === 1 ? '' : 's'})` : ''}`)
  endTurn(state, playerId)
}

function holeOk(player, hole = 0) {
  if (!player.holes.length) fail('You have no hole card')
  if (!Number.isInteger(hole) || hole < 0 || hole >= player.holes.length) fail('Pick which hole card to use')
  return hole
}

// Pass the turn on; when every player still in has moved this round, the round ends, and a
// street's betting round opens if this was one of the street rounds.
function endTurn(state, playerId) {
  const g = state.game
  g.moved.push(playerId)
  g.turn = nextActiveSeat(state, g.turn)
  if (!activePlayers(state).every((p) => g.moved.includes(p.id))) return
  const street = STREET_ROUNDS.indexOf(g.round)
  g.round++
  g.moved = []
  if (street >= 0) openBetting(state, street)
}

function openBetting(state, street) {
  const g = state.game
  // Betting starts with whoever would move next, then goes round in seat order.
  const n = state.players.length
  const toAct = []
  for (let k = 0; k < n; k++) {
    const p = state.players[(g.turn + k) % n]
    if (!p.folded) toAct.push(p.id)
  }
  g.betting = { street, bet: 0, put: {}, toAct }
  pushLog(state, `${STREET_NAMES[street]}! Betting opens with ${getPlayer(state, toAct[0]).name}.`)
}

//   bet {action: 'check'|'call'|'raise'|'fold', amount}  amount is how much to raise by
function applyBet(state, playerId, move) {
  const g = state.game
  const b = g.betting
  const player = currentPlayer(state)
  if (player.id !== playerId) fail(`It is ${player.name}'s turn to bet`)
  let action = move?.type === 'pass' ? null : move?.type === 'bet' ? move.action : fail('It is a betting round: check, call, raise or fold')
  const put = b.put[playerId] || 0
  const toCall = b.bet - put
  // An offline player checks if they can, and folds otherwise.
  if (move.type === 'pass') action = toCall ? 'fold' : 'check'

  switch (action) {
    case 'check':
      if (toCall) fail(`Call ${toCall} or fold`)
      pushLog(state, `${player.name} checks`)
      b.toAct.shift()
      break
    case 'call':
      if (!toCall) fail('Nothing to call. Check instead.')
      pay(state, player, toCall)
      b.put[playerId] = b.bet
      pushLog(state, `${player.name} calls ${toCall}`)
      b.toAct.shift()
      break
    case 'raise': {
      const amount = move.amount
      const max = maxRaise(state)
      const opening = b.bet === 0
      if (!Number.isInteger(amount) || amount < 1) fail('Raise by at least 1')
      if (amount > max) fail(max ? `Everyone has to be able to call, so the most you can raise is ${max}` : 'Nobody can afford a raise. Check or call.')
      b.bet += amount
      pay(state, player, b.bet - put)
      b.put[playerId] = b.bet
      pushLog(state, opening ? `${player.name} bets ${amount}` : `${player.name} raises to ${b.bet}`)
      // Everyone else still in has to answer the raise, in seat order from the raiser.
      const seat = state.players.indexOf(player)
      const n = state.players.length
      b.toAct = []
      for (let k = 1; k < n; k++) {
        const p = state.players[(seat + k) % n]
        if (!p.folded) b.toAct.push(p.id)
      }
      break
    }
    case 'fold':
      // Folded hole cards stay hidden for good.
      player.folded = true
      pushLog(state, `${player.name} folds`)
      b.toAct.shift()
      break
    default:
      fail('Check, call, raise or fold')
  }

  g.lastMove = { seq: ++g.seq, playerId, type: 'bet', action }
  if (activePlayers(state).length === 1) return showdown(state)
  if (b.toAct.length) return
  g.betting = null
  if (b.street === STREET_ROUNDS.length - 1) return showdown(state)
  if (state.players[g.turn].folded) g.turn = nextActiveSeat(state, g.turn)
  pushLog(state, `Betting closed. Pot: ${g.pot}. ${state.players[g.turn].name} moves next.`)
}

// A hand is the best 5 cards from the in-play cards plus the player's hole cards, like
// Texas Hold'em. Hole cards are hidden and safe from shifts, and they still count.
export function handFor(state, player) {
  return bestHand([...rowOf(state, player.id).cards.slice(0, IN_PLAY), ...player.holes])
}

// The hand everyone can see: in-play cards only, since other players' hole cards are hidden.
const showingHand = (row) => bestHand(row.cards.slice(0, IN_PLAY))

// Who looks to be leading among players still in, from what viewerId can see: their own full
// hand, and everyone else's in-play cards. Hidden hole cards can still change the result.
export function tableLeaders(state, viewerId = null) {
  const hands = activePlayers(state).map((p) => ({
    id: p.id,
    score: (p.id === viewerId ? handFor(state, p) : showingHand(rowOf(state, p.id))).score,
  }))
  let top = hands[0].score
  for (const h of hands) if (compareScores(h.score, top) > 0) top = h.score
  return hands.filter((h) => compareScores(h.score, top) === 0).map((h) => h.id)
}

// The best hand among players still in takes the pot (split on a tie, odd chips to the first
// winners in seat order). If everyone else folded, the last player in takes it unseen.
// Then every player banks what they have left onto their session score.
function showdown(state) {
  const g = state.game
  const contenders = activePlayers(state)
  const byFold = contenders.length === 1
  const hands = contenders.map((p) => ({ playerId: p.id, ...handFor(state, p) }))
  let winners
  if (byFold) winners = [contenders[0].id]
  else {
    let top = hands[0].score
    for (const h of hands) if (compareScores(h.score, top) > 0) top = h.score
    winners = hands.filter((h) => compareScores(h.score, top) === 0).map((h) => h.playerId)
  }
  const payouts = {}
  const share = Math.floor(g.pot / winners.length)
  winners.forEach((id, i) => { payouts[id] = share + (i < g.pot % winners.length ? 1 : 0) })
  const banked = {}
  for (const p of state.players) {
    p.chips += payouts[p.id] || 0
    banked[p.id] = p.chips
    p.score += p.chips
  }
  state.phase = 'showdown'
  g.betting = null
  g.result = { hands: byFold ? [] : hands, winners, pot: g.pot, payouts, banked, byFold }
  const names = winners.map((id) => getPlayer(state, id).name).join(' & ')
  const how = byFold ? 'Everyone else folded' : `Showdown! ${names} win${winners.length === 1 ? 's' : ''} with ${hands.find((h) => h.playerId === winners[0]).name}`
  pushLog(state, byFold ? `${how}. ${names} takes the pot of ${g.pot}.` : `${how} and take${winners.length === 1 ? 's' : ''} the pot of ${g.pot}.`)
}

// Abandon the current game: nobody banks anything and the pot is returned unscored.
export function abandonGame(state) {
  if (!inGame(state)) fail('No game in progress')
  for (const p of state.players) { p.holes = []; p.folded = false; p.chips = 0 }
  state.phase = 'lobby'
  state.game = null
  state.rows = []
  pushLog(state, 'The game was abandoned')
}

export function backToLobby(state) {
  if (state.phase !== 'showdown') fail('No finished game')
  for (const p of state.players) { p.holes = []; p.folded = false; p.chips = 0 }
  state.phase = 'lobby'
  state.game = null
  state.rows = []
}

function pushLog(state, text) {
  state.log.push({ t: Date.now(), text })
  if (state.log.length > 50) state.log.splice(0, state.log.length - 50)
}

// What a given viewer is allowed to see: every card in every row, in wrap order, and only their
// own hole cards (at the showdown, everyone still in shows theirs; folded hands stay hidden).
export function viewFor(state, viewerId, onlineIds) {
  const g = state.game
  const reveal = (p) => p.id === viewerId || (state.phase === 'showdown' && !p.folded && !g.result.byFold)
  const b = g?.betting
  const viewer = viewerId && state.players.find((p) => p.id === viewerId)
  return {
    phase: state.phase,
    settings: state.settings,
    hostId: state.hostId,
    you: viewerId,
    gameNumber: state.gameNumber,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      chips: p.chips,
      folded: p.folded,
      put: b?.put[p.id] || 0,
      online: onlineIds.has(p.id),
      holeCount: p.holes.length,
      holes: reveal(p) ? p.holes : null,
    })),
    rows: state.rows.map((r) => ({
      owner: r.owner,
      inPlay: r.cards.slice(0, IN_PLAY),
      // Out-of-play cards in wrap order: [0] enters on the right when the row shifts left, and
      // the last one enters on the left when it shifts right.
      outOfPlay: r.cards.slice(IN_PLAY),
      // The hand showing on the table (in-play cards only). While picking, every row shows its
      // hand to help players choose.
      hand: (state.phase === 'playing' && r.owner) || state.phase === 'picking' ? showingHand(r).name : null,
    })),
    game: g && {
      turn: g.turn,
      current: state.phase === 'playing' ? currentPlayer(state).id : null,
      round: g.round,
      pot: g.pot,
      costs: COSTS,
      streetRounds: STREET_ROUNDS,
      streetNames: STREET_NAMES,
      // The next street still to come, if any.
      nextStreet: STREET_ROUNDS.findIndex((r) => r >= g.round),
      betting: b && {
        street: b.street,
        name: STREET_NAMES[b.street],
        bet: b.bet,
        toAct: b.toAct[0],
        toCall: viewer ? b.bet - (b.put[viewerId] || 0) : 0,
        maxRaise: maxRaise(state),
      },
      lastMove: g.lastMove,
      result: g.result && {
        winners: g.result.winners,
        pot: g.result.pot,
        payouts: g.result.payouts,
        banked: g.result.banked,
        byFold: g.result.byFold,
        hands: g.result.hands.map(({ playerId, name, cards }) => ({ playerId, name, cards })),
      },
      leaders: state.phase === 'playing' ? tableLeaders(state, viewerId) : [],
      // The viewer's own hand, hole cards included.
      yourHand: state.phase === 'playing' && viewer && rowOf(state, viewerId) ? handFor(state, viewer).name : null,
      picker: state.phase === 'picking' ? g.pickOrder[g.picks] : null,
      pickOrder: g.pickOrder,
    },
    log: state.log.slice(-30),
  }
}
