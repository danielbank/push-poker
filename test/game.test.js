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
  assert.equal(a.hole, 1)
  assert.deepEqual(s.rows[0].cards.slice(0, 5), [0, 2, 3, 4, 5])
  assert.equal(s.rows[0].cards.length, 12)
  G.applyMove(s, b.id, { type: 'pickUp', col: 0, fill: 'left' })
  assert.deepEqual(s.rows[1].cards.slice(0, 5), [25, 14, 15, 16, 17])
  // Hole cards are safe from column shifts.
  G.applyMove(s, a.id, { type: 'shiftCol', col: 0, dir: 'down' })
  assert.equal(a.hole, 1)
  G.applyMove(s, b.id, { type: 'shiftRow', dir: 'left' })
  assert.throws(() => G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'left' }), /already hold/)
  // Insert before slot 2, push out the left end.
  const before = s.rows[0].cards.slice(0, 5)
  G.applyMove(s, a.id, { type: 'putDown', slot: 2, eject: 'left' })
  assert.equal(a.hole, null)
  assert.deepEqual(s.rows[0].cards.slice(0, 5), [before[1], 1, before[2], before[3], before[4]])
  assert.equal(s.rows[0].cards.length, 13)
})

test('turn order is enforced', () => {
  const { s, players } = table()
  assert.throws(() => G.applyMove(s, players[1].id, { type: 'shiftRow', dir: 'left' }), /P0's move/)
})

test('knock unlocks after 5 rounds; everyone else gets one more move, then showdown', () => {
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
  assert.equal(v.players[0].hole, null)
  assert.equal(v.players[0].hasHole, true)
  assert.equal(v.rows[0].inPlay.length, 5)
  assert.equal(G.viewFor(s, players[0].id, new Set()).players[0].hole, 0)
})

test('spectator view with neutral rows does not throw', () => {
  const { s } = table(2)
  assert.doesNotThrow(() => G.viewFor(s, null, new Set()))
})
