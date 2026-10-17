import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../lib/game.js'
import { bestHand } from '../lib/hands.js'

// Card helpers: c('A','s') etc. Suit indices follow deck-of-cards: s=0 h=1 c=2 d=3.
const RANKS = { A: 1, J: 11, Q: 12, K: 13 }
const c = (r, s) => 'shcd'.indexOf(s) * 13 + (RANKS[r] ?? Number(r)) - 1

function table(n = 2) {
  const s = G.createState()
  const players = Array.from({ length: n }, (_, i) => G.addPlayer(s, { name: `P${i}`, color: '#123456' }))
  G.startGame(s)
  // Deterministic rows: row r holds ids r*13 .. r*13+12.
  s.rows.forEach((row, r) => { row.cards = Array.from({ length: 13 }, (_, i) => r * 13 + i) })
  return { s, players }
}

test('hand ranking', () => {
  assert.equal(bestHand([c('A','s'), c('K','s'), c('Q','s'), c('J','s'), c(10,'s')]).name, 'Straight Flush')
  assert.equal(bestHand([c('A','s'), c(2,'h'), c(3,'s'), c(4,'d'), c(5,'s')]).name, 'Straight')
  assert.equal(bestHand([c(9,'s'), c(9,'h'), c(9,'d'), c(4,'d'), c(4,'s')]).name, 'Full House')
  assert.equal(bestHand([c(9,'s'), c(9,'h'), c(3,'d'), c(4,'d'), c(4,'s')]).name, 'Two Pair')
  // Best 5 of 6: hole card makes the flush.
  assert.equal(bestHand([c(2,'h'), c(5,'h'), c(9,'h'), c('J','h'), c('K','s'), c(3,'h')]).name, 'Flush')
})

test('shift row wraps both ways', () => {
  const { s, players } = table()
  G.applyMove(s, players[0].id, { type: 'shiftRow', dir: 'left' })
  assert.deepEqual(s.rows[0].cards.slice(0, 5), [1, 2, 3, 4, 5])
  G.applyMove(s, players[1].id, { type: 'shiftRow', dir: 'right' })
  assert.deepEqual(s.rows[1].cards.slice(0, 5), [25, 13, 14, 15, 16])
})

test('shift column rotates through all four rows, including neutral ones', () => {
  const { s, players } = table()
  G.applyMove(s, players[0].id, { type: 'shiftCol', col: 2, dir: 'down' })
  assert.deepEqual(s.rows.map((r) => r.cards[2]), [41, 2, 15, 28])
  G.applyMove(s, players[1].id, { type: 'shiftCol', col: 2, dir: 'up' })
  assert.deepEqual(s.rows.map((r) => r.cards[2]), [2, 15, 28, 41])
})

test('pick up and put down keep five in play', () => {
  const { s, players } = table()
  const [a, b] = players
  G.applyMove(s, a.id, { type: 'pickUp', col: 1, fill: 'right' })
  assert.deepEqual(a.holes, [1])
  assert.deepEqual(s.rows[0].cards.slice(0, 5), [0, 2, 3, 4, 5])
  assert.equal(s.rows[0].cards.length, 12)
  G.applyMove(s, b.id, { type: 'pickUp', col: 0, fill: 'left' })
  assert.deepEqual(s.rows[1].cards.slice(0, 5), [25, 14, 15, 16, 17])
  // Hole cards are safe from column shifts.
  G.applyMove(s, a.id, { type: 'shiftCol', col: 0, dir: 'down' })
  assert.deepEqual(a.holes, [1])
  G.applyMove(s, b.id, { type: 'shiftRow', dir: 'left' })
  assert.throws(() => G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'left' }), /already hold/)
  // Insert before slot 2, push out the left end.
  const before = s.rows[0].cards.slice(0, 5)
  G.applyMove(s, a.id, { type: 'putDown', slot: 2, eject: 'left' })
  assert.deepEqual(a.holes, [])
  assert.deepEqual(s.rows[0].cards.slice(0, 5), [before[1], 1, before[2], before[3], before[4]])
  assert.equal(s.rows[0].cards.length, 13)
})

test('turn order is enforced', () => {
  const { s, players } = table()
  assert.throws(() => G.applyMove(s, players[1].id, { type: 'shiftRow', dir: 'left' }), /P0's move/)
})

test('knock unlocks after 5 rounds; everyone, knocker included, gets one more move, then showdown', () => {
  const { s, players } = table(3)
  const move = (p) => G.applyMove(s, p.id, { type: 'shiftRow', dir: 'left' })
  for (let i = 0; i < 14; i++) move(players[i % 3])
  // 14 moves = 4 full rounds + 2. P2 cannot knock yet.
  assert.throws(() => G.applyMove(s, players[2].id, { type: 'knock' }), /unlocks/)
  move(players[2])
  G.applyMove(s, players[0].id, { type: 'knock' })
  assert.equal(s.phase, 'playing')
  move(players[1])
  assert.throws(() => G.applyMove(s, players[2].id, { type: 'knock' }), /already knocked/)
  move(players[2])
  assert.equal(s.phase, 'playing')
  assert.equal(s.game.finalMovesLeft, 1)
  move(players[0]) // the knocker's last move
  assert.equal(s.phase, 'showdown')
  const winners = s.game.result.winners
  assert.ok(winners.length >= 1)
  assert.equal(players.reduce((sum, p) => sum + p.wins, 0), winners.length)
})

test('first player rotates each game and players can join between games', () => {
  const { s, players } = table()
  assert.equal(s.game.turn, 0)
  G.abandonGame(s)
  G.addPlayer(s, { name: 'Late', color: '#000000' })
  G.startGame(s)
  assert.equal(s.game.turn, 1)
  assert.equal(s.rows.filter((r) => r.owner).length, 3)
  assert.throws(() => G.addPlayer(s, { name: 'Later' }), /in progress/)
  assert.ok(players)
})

test('views hide other hole cards and out-of-play cards', () => {
  const { s, players } = table()
  G.applyMove(s, players[0].id, { type: 'pickUp', col: 0, fill: 'right' })
  const v = G.viewFor(s, players[1].id, new Set())
  assert.equal(v.players[0].holes, null)
  assert.equal(v.players[0].holeCount, 1)
  assert.equal(v.rows[0].inPlay.length, 5)
  assert.deepEqual(G.viewFor(s, players[0].id, new Set()).players[0].holes, [0])
})

test('spectator view with neutral rows does not throw', () => {
  const { s } = table(2)
  assert.doesNotThrow(() => G.viewFor(s, null, new Set()))
})

test('putting the hole card down at an end cannot push it straight back out', () => {
  const { s, players } = table()
  const [a, b] = players
  G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'right' })
  G.applyMove(s, b.id, { type: 'shiftRow', dir: 'left' })
  assert.throws(() => G.applyMove(s, a.id, { type: 'putDown', slot: 0, eject: 'left' }), /straight out of play/)
  assert.throws(() => G.applyMove(s, a.id, { type: 'putDown', slot: 5, eject: 'right' }), /straight out of play/)
  G.applyMove(s, a.id, { type: 'putDown', slot: 0, eject: 'right' })
  assert.equal(s.rows[0].cards[0], 0)
  assert.deepEqual(a.holes, [])
})

test('table hands and leaders use in-play cards only', () => {
  const { s, players } = table()
  const [a, b] = players
  // Row 0: A-2-3-4-5 of spades (straight flush). Row 1: plain high card.
  s.rows[0].cards = [0, 1, 2, 3, 4, ...s.rows[0].cards.slice(5)]
  s.rows[1].cards = [13, 15, 30, 44, 8, ...s.rows[1].cards.slice(5)] // A♥ 3♥ 5♣ 6♦ 9♠
  let v = G.viewFor(s, b.id, new Set())
  assert.equal(v.rows[0].hand, 'Straight Flush')
  assert.deepEqual(v.game.leaders, [a.id])
  assert.equal(v.rows[1].hand, 'High Card')
  assert.equal(v.rows[2].hand, null) // neutral rows have no hand
  // Picking up a hole card changes the public hand but the hole card stays hidden from it.
  G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'left' }) // K♠ wraps in: K-2-3-4-5 of spades
  v = G.viewFor(s, b.id, new Set())
  assert.equal(v.rows[0].hand, 'Flush')
  assert.equal(G.viewFor(s, a.id, new Set()).game.yourHand, 'Straight Flush')
})

test('with 2 hole cards you can hold two, choose which to put down, and use both in your hand', () => {
  const s = G.createState()
  const [a, b] = ['A', 'B'].map((name) => G.addPlayer(s, { name }))
  G.setHoleCards(s, 2)
  G.startGame(s)
  s.rows.forEach((row, r) => { row.cards = Array.from({ length: 13 }, (_, i) => r * 13 + i) })
  const pass = () => G.applyMove(s, b.id, { type: 'shiftRow', dir: 'left' })

  G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'right' }) // A♠
  pass()
  G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'right' }) // 2♠
  assert.deepEqual(a.holes, [0, 1])
  assert.equal(s.rows[0].cards.length, 11)
  pass()
  assert.throws(() => G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'right' }), /already hold 2/)
  // Best 5 of 7: in play 3-4-5-6-7♠ plus A♠ 2♠ hole cards.
  assert.equal(G.handFor(s, a).name, 'Straight Flush')

  // Put down the second hole card (2♠) at slot 1.
  assert.throws(() => G.applyMove(s, a.id, { type: 'putDown', hole: 2, slot: 1, eject: 'right' }), /which hole card/)
  G.applyMove(s, a.id, { type: 'putDown', hole: 1, slot: 1, eject: 'right' })
  assert.deepEqual(a.holes, [0])
  assert.equal(s.rows[0].cards[1], 1)
  assert.equal(s.rows[0].cards.length, 12)
})

test('hole card setting only changes between games and survives old saves', () => {
  const s = G.createState()
  G.addPlayer(s, { name: 'A' })
  G.addPlayer(s, { name: 'B' })
  assert.throws(() => G.setHoleCards(s, 3), /1 or 2/)
  G.startGame(s)
  assert.throws(() => G.setHoleCards(s, 2), /between games/)
  // A save from before this feature: no settings, single nullable hole.
  const old = { phase: 'lobby', players: [{ id: 'x', hole: 7 }, { id: 'y', hole: null }], rows: [], game: null, gameNumber: 0, log: [] }
  const fixed = G.normalizeState(old)
  assert.equal(fixed.settings.holeCards, 1)
  assert.deepEqual(fixed.players.map((p) => p.holes), [[7], []])
})
