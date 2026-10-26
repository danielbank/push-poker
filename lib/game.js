// Push Poker rules. Pure state transitions; the server owns persistence and networking.
//
// A row is a circular list of cards stored so that cards[0..4] are always the in-play cards
// and the rest are out of play, in wrap order. Every card in every row is face up. Holding hole
// cards removes them from the row, so a row has 13 cards, minus however many hole cards its
// owner holds. A player's hand is the best 5 of their in-play cards plus their hole cards.

import { randomUUID, randomInt } from 'node:crypto'
import { bestHand, compareScores } from './hands.js'

export const ROWS = 4
export const IN_PLAY = 5
export const MAX_PLAYERS = 4
export const MIN_PLAYERS = 2
export const ROUNDS_BEFORE_KNOCK = 5
export const HOLE_CARD_OPTIONS = [1, 2]

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg) }

export function createState() {
  return { phase: 'lobby', settings: { holeCards: 1 }, hostId: null, players: [], rows: [], game: null, gameNumber: 0, log: [] }
}

// Bring a saved table from an older version up to date (it may predate settings or multiple hole cards).
export function normalizeState(state) {
  state.settings = { holeCards: 1, ...state.settings }
  if (!state.players.some((p) => p.id === state.hostId)) state.hostId = state.players[0]?.id ?? null
  for (const p of state.players) {
    if (!Array.isArray(p.holes)) p.holes = p.hole === null || p.hole === undefined ? [] : [p.hole]
    delete p.hole
  }
  return state
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
    wins: 0,
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

// Deal, then let players choose rows: most wins picks first (a random leader on a tie), then
// round-robin in seat order. Rows nobody picks stay neutral.
export function startGame(state) {
  if (inGame(state)) fail('A game is already in progress')
  const n = state.players.length
  if (n < MIN_PLAYERS) fail(`Need at least ${MIN_PLAYERS} players`)
  const deck = shuffledDeck()
  state.rows = Array.from({ length: ROWS }, (_, r) => ({ owner: null, cards: deck.slice(r * 13, r * 13 + 13) }))
  for (const p of state.players) p.holes = []

  const most = Math.max(...state.players.map((p) => p.wins))
  const leaders = state.players.map((p, i) => (p.wins === most ? i : -1)).filter((i) => i >= 0)
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
    movesMade: 0,
    knockedBy: null,
    finalMovesLeft: null,
    lastMove: null,
    result: null,
  }
  const why = leaders.length === 1
    ? (most ? `most wins (${most})` : 'drawn at random')
    : `tied for most wins (${most}), drawn at random`
  pushLog(state, `Game ${state.gameNumber} dealt. ${state.players[firstPicker].name} picks a row first: ${why}.`)
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

export const currentPlayer = (state) => state.players[state.game.turn]

export const roundsCompleted = (state) => Math.floor(state.game.movesMade / state.players.length)

export const canKnock = (state) =>
  state.phase === 'playing' && state.game.knockedBy === null && roundsCompleted(state) >= ROUNDS_BEFORE_KNOCK

const dirOk = (d, a, b) => (d === a || d === b ? d : fail('Bad direction'))
const colOk = (c, max = IN_PLAY - 1) => (Number.isInteger(c) && c >= 0 && c <= max ? c : fail('Bad column'))

function rotateLeft(cards) { cards.push(cards.shift()) }
function rotateRight(cards) { cards.unshift(cards.pop()) }

// Apply one move for playerId. move.type is one of:
//   shiftRow {dir: 'left'|'right'}         cards slide that way; a new card enters from the other side
//   shiftCol {col, dir: 'up'|'down'}       that column's in-play cards rotate one row through all 4 rows
//   pickUp   {col, fill: 'left'|'right'}   take the card as a hole card; fill from that side
//   putDown  {hole, slot: 0..5, eject: 'left'|'right'}  insert hole card #hole (0 or 1) before in-play
//                                          slot; push out that end
//   knock    {}
//   pass     {}                            only used when skipping an offline player
export function applyMove(state, playerId, move) {
  if (state.phase === 'picking') fail('Wait for everyone to choose a row')
  if (state.phase !== 'playing') fail('No game in progress')
  const player = currentPlayer(state)
  if (player.id !== playerId) fail(`It is ${player.name}'s move`)
  const row = rowOf(state, playerId)
  let text

  switch (move?.type) {
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
      const col = colOk(move.col)
      const fill = dirOk(move.fill, 'left', 'right')
      player.holes.push(row.cards.splice(col, 1)[0])
      // Splicing pulls the next card in from the right; filling from the left wraps the last card to the front.
      if (fill === 'left') rotateRight(row.cards)
      text = `picked up a hole card (filled from the ${fill})`
      break
    }
    case 'putDown': {
      if (!player.holes.length) fail('You have no hole card')
      const hole = move.hole ?? 0
      if (!Number.isInteger(hole) || hole < 0 || hole >= player.holes.length) fail('Pick which hole card to put down')
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
    case 'knock': {
      if (!canKnock(state)) {
        if (state.game.knockedBy !== null) fail('Someone already knocked')
        fail(`Knocking unlocks after ${ROUNDS_BEFORE_KNOCK} full rounds`)
      }
      state.game.knockedBy = playerId
      // One more full round, knocker included: decremented below to n.
      state.game.finalMovesLeft = state.players.length + 1
      text = 'KNOCKED! Everyone gets one last move.'
      break
    }
    case 'pass':
      text = 'was skipped (offline)'
      break
    default:
      fail('Unknown move')
  }

  state.game.lastMove = { playerId, type: move.type, col: move.col, dir: move.dir }
  pushLog(state, `${player.name} ${text}`)
  state.game.movesMade++
  state.game.turn = (state.game.turn + 1) % state.players.length
  if (state.game.knockedBy !== null) {
    state.game.finalMovesLeft--
    if (state.game.finalMovesLeft === 0) showdown(state)
  }
}

// A hand is the best 5 cards from the in-play cards plus the player's hole cards, like
// Texas Hold'em. Hole cards are hidden and safe from shifts, and they still count.
export function handFor(state, player) {
  return bestHand([...rowOf(state, player.id).cards.slice(0, IN_PLAY), ...player.holes])
}

// The hand everyone can see: in-play cards only, since other players' hole cards are hidden.
const showingHand = (row) => bestHand(row.cards.slice(0, IN_PLAY))

// Who looks to be leading, from what viewerId can see: their own full hand, and everyone else's
// in-play cards. Hidden hole cards can still change the result at the showdown.
export function tableLeaders(state, viewerId = null) {
  const hands = state.rows.filter((r) => r.owner).map((r) => ({
    id: r.owner,
    score: (r.owner === viewerId ? handFor(state, getPlayer(state, viewerId)) : showingHand(r)).score,
  }))
  let top = hands[0].score
  for (const h of hands) if (compareScores(h.score, top) > 0) top = h.score
  return hands.filter((h) => compareScores(h.score, top) === 0).map((h) => h.id)
}

function showdown(state) {
  const hands = state.players.map((p) => ({ playerId: p.id, ...handFor(state, p) }))
  let top = hands[0].score
  for (const h of hands) if (compareScores(h.score, top) > 0) top = h.score
  const winners = hands.filter((h) => compareScores(h.score, top) === 0).map((h) => h.playerId)
  for (const p of state.players) if (winners.includes(p.id)) p.wins++
  state.phase = 'showdown'
  state.game.result = { hands, winners }
  const names = winners.map((id) => getPlayer(state, id).name).join(' & ')
  pushLog(state, `Showdown! ${names} win${winners.length === 1 ? 's' : ''} with ${hands.find((h) => h.playerId === winners[0]).name}.`)
}

// Abandon the current game without awarding wins.
export function abandonGame(state) {
  if (!inGame(state)) fail('No game in progress')
  for (const p of state.players) p.holes = []
  state.phase = 'lobby'
  state.game = null
  state.rows = []
  pushLog(state, 'The game was abandoned')
}

export function backToLobby(state) {
  if (state.phase !== 'showdown') fail('No finished game')
  for (const p of state.players) p.holes = []
  state.phase = 'lobby'
  state.game = null
  state.rows = []
}

function pushLog(state, text) {
  state.log.push({ t: Date.now(), text })
  if (state.log.length > 50) state.log.splice(0, state.log.length - 50)
}

// What a given viewer is allowed to see: every card in every row, in wrap order, and only their
// own hole cards (everyone's hole cards are revealed at showdown).
export function viewFor(state, viewerId, onlineIds) {
  const reveal = state.phase === 'showdown'
  const g = state.game
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
      wins: p.wins,
      online: onlineIds.has(p.id),
      holeCount: p.holes.length,
      holes: p.id === viewerId || reveal ? p.holes : null,
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
      movesMade: g.movesMade,
      round: roundsCompleted(state) + 1,
      canKnock: canKnock(state),
      roundsBeforeKnock: ROUNDS_BEFORE_KNOCK,
      knockedBy: g.knockedBy,
      finalMovesLeft: g.finalMovesLeft,
      lastMove: g.lastMove,
      result: g.result && {
        winners: g.result.winners,
        hands: g.result.hands.map(({ playerId, name, cards }) => ({ playerId, name, cards })),
      },
      leaders: state.phase === 'playing' ? tableLeaders(state, viewerId) : [],
      // The viewer's own hand, hole cards included.
      yourHand: state.phase === 'playing' && viewerId && rowOf(state, viewerId) ? handFor(state, getPlayer(state, viewerId)).name : null,
      picker: state.phase === 'picking' ? g.pickOrder[g.picks] : null,
      pickOrder: g.pickOrder,
    },
    log: state.log.slice(-30),
  }
}
