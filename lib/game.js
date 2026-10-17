// Push Poker rules. Pure state transitions; the server owns persistence and networking.
//
// A row is a circular list of cards stored so that cards[0..4] are always the in-play cards
// and the rest are out of play, in wrap order. Holding a hole card removes it from the row,
// so a row has 13 cards, or 12 while its owner holds a hole card.

import { randomUUID, randomInt } from 'node:crypto'
import { bestHand, compareScores } from './hands.js'

export const ROWS = 4
export const IN_PLAY = 5
export const MAX_PLAYERS = 4
export const MIN_PLAYERS = 2
export const ROUNDS_BEFORE_KNOCK = 5

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg) }

export function createState() {
  return { phase: 'lobby', players: [], rows: [], game: null, gameNumber: 0, log: [] }
}

export function addPlayer(state, { name, color }) {
  name = String(name || '').trim().slice(0, 20)
  if (!name) fail('Pick a name')
  if (state.phase === 'playing') fail('A game is in progress. Join after it ends.')
  if (state.players.length >= MAX_PLAYERS) fail('The table is full (4 players)')
  if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail('That name is taken')
  const player = {
    id: randomUUID(),
    token: randomUUID(),
    name,
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#e63946',
    wins: 0,
    hole: null,
  }
  state.players.push(player)
  pushLog(state, `${name} joined the table`)
  return player
}

export function removePlayer(state, playerId) {
  if (state.phase === 'playing') fail('Cannot remove a player mid-game')
  const p = getPlayer(state, playerId)
  state.players = state.players.filter((x) => x.id !== playerId)
  pushLog(state, `${p.name} left the table`)
}

function shuffledDeck() {
  const deck = Array.from({ length: 52 }, (_, i) => i)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

export function startGame(state) {
  if (state.phase === 'playing') fail('A game is already in progress')
  const n = state.players.length
  if (n < MIN_PLAYERS) fail(`Need at least ${MIN_PLAYERS} players`)
  const deck = shuffledDeck()
  state.rows = Array.from({ length: ROWS }, (_, r) => ({
    owner: state.players[r]?.id ?? null, // rows beyond the player count are neutral
    cards: deck.slice(r * 13, r * 13 + 13),
  }))
  for (const p of state.players) p.hole = null
  // First player rotates each game.
  const first = state.gameNumber % n
  state.gameNumber++
  state.phase = 'playing'
  state.game = {
    turn: first,
    movesMade: 0,
    knockedBy: null,
    finalMovesLeft: null,
    lastMove: null,
    result: null,
  }
  pushLog(state, `Game ${state.gameNumber} dealt. ${state.players[first].name} moves first.`)
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
//   pickUp   {col, fill: 'left'|'right'}   take the card as your hole card; fill from that side
//   putDown  {slot: 0..5, eject: 'left'|'right'}  insert hole card before in-play slot; push out that end
//   knock    {}
//   pass     {}                            only used when skipping an offline player
export function applyMove(state, playerId, move) {
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
      if (player.hole !== null) fail('You already hold a hole card')
      const col = colOk(move.col)
      const fill = dirOk(move.fill, 'left', 'right')
      player.hole = row.cards.splice(col, 1)[0]
      // Splicing pulls the next card in from the right; filling from the left wraps the last card to the front.
      if (fill === 'left') rotateRight(row.cards)
      text = `picked up a hole card (filled from the ${fill})`
      break
    }
    case 'putDown': {
      if (player.hole === null) fail('You have no hole card')
      const slot = colOk(move.slot, IN_PLAY)
      const eject = dirOk(move.eject, 'left', 'right')
      // Inserting at an end and pushing out that same end would send the hole card straight out of play.
      if ((slot === 0 && eject === 'left') || (slot === IN_PLAY && eject === 'right')) {
        fail('That would push your hole card straight out of play. Push out the other end.')
      }
      row.cards.splice(slot, 0, player.hole)
      player.hole = null
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
      state.game.finalMovesLeft = state.players.length // decremented below to n - 1
      text = 'KNOCKED! Everyone else gets one last move.'
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

export function handFor(state, player) {
  const row = rowOf(state, player.id)
  const cards = row.cards.slice(0, IN_PLAY)
  if (player.hole !== null) cards.push(player.hole)
  return bestHand(cards)
}

function showdown(state) {
  const hands = state.players.map((p) => ({ playerId: p.id, hole: p.hole, ...handFor(state, p) }))
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
  if (state.phase !== 'playing') fail('No game in progress')
  for (const p of state.players) p.hole = null
  state.phase = 'lobby'
  state.game = null
  state.rows = []
  pushLog(state, 'The game was abandoned')
}

export function backToLobby(state) {
  if (state.phase !== 'showdown') fail('No finished game')
  for (const p of state.players) p.hole = null
  state.phase = 'lobby'
  state.game = null
  state.rows = []
}

function pushLog(state, text) {
  state.log.push({ t: Date.now(), text })
  if (state.log.length > 50) state.log.splice(0, state.log.length - 50)
}

// What a given viewer is allowed to see: in-play cards only, and only their own hole card
// (everyone's hole cards are revealed at showdown).
export function viewFor(state, viewerId, onlineIds) {
  const reveal = state.phase === 'showdown'
  const g = state.game
  return {
    phase: state.phase,
    you: viewerId,
    gameNumber: state.gameNumber,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      wins: p.wins,
      online: onlineIds.has(p.id),
      hasHole: p.hole !== null,
      hole: p.id === viewerId || reveal ? p.hole : null,
    })),
    rows: state.rows.map((r) => ({ owner: r.owner, inPlay: r.cards.slice(0, IN_PLAY), outOfPlay: r.cards.length - IN_PLAY })),
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
      yourHand: state.phase === 'playing' && viewerId && rowOf(state, viewerId) ? handFor(state, getPlayer(state, viewerId)).name : null,
    },
    log: state.log.slice(-12),
  }
}
