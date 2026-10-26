import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../lib/game.js'
import { bestHand } from '../lib/hands.js'

// Card helpers: c('A','s') etc. Suit indices follow deck-of-cards: s=0 h=1 c=2 d=3.
const RANKS = { A: 1, J: 11, Q: 12, K: 13 }
const c = (r, s) => 'shcd'.indexOf(s) * 13 + (RANKS[r] ?? Number(r)) - 1

// Deal, then have each player take the row matching their seat (P0 -> row 0, ...).
function deal(s) {
  G.startGame(s)
  for (const id of [...s.game.pickOrder]) G.pickRow(s, id, s.players.findIndex((p) => p.id === id))
}

function table(n = 2) {
  const s = G.createState()
  const players = Array.from({ length: n }, (_, i) => G.addPlayer(s, { name: `P${i}`, color: '#123456' }))
  deal(s)
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

test('picking up keeps five in play, and hole cards cannot go back into your own row', () => {
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
  assert.throws(() => G.applyMove(s, a.id, { type: 'putDown', hole: 0, slot: 2, eject: 'left' }), /Unknown move/)
})

test('turn order is enforced', () => {
  const { s, players } = table()
  assert.throws(() => G.applyMove(s, players[1].id, { type: 'shiftRow', dir: 'left' }), /P0's move/)
})

// Play out the rest of the game: free row shifts on move turns, checks or calls on betting turns.
function playOut(s) {
  while (s.phase === 'playing') {
    const p = G.currentPlayer(s)
    if (!s.game.betting) G.applyMove(s, p.id, { type: 'shiftRow', dir: 'left' })
    else {
      const toCall = s.game.betting.bet - (s.game.betting.put[p.id] || 0)
      G.applyMove(s, p.id, { type: 'bet', action: toCall ? 'call' : 'check' })
    }
  }
}

// Make free moves until a betting round opens.
function toStreet(s) {
  while (!s.game.betting) G.applyMove(s, G.currentPlayer(s).id, { type: 'shiftRow', dir: 'left' })
}

test('everyone antes from a fresh stack; strong moves cost chips that go into the pot', () => {
  const { s, players } = table()
  const [a, b] = players
  assert.equal(s.game.pot, 2)
  assert.deepEqual(players.map((p) => p.chips), [G.STACK - 1, G.STACK - 1])
  G.applyMove(s, a.id, { type: 'shiftCol', col: 0, dir: 'down' })
  assert.equal(a.chips, G.STACK - 3)
  assert.equal(s.game.pot, 4)
  G.applyMove(s, b.id, { type: 'shiftRow', dir: 'left' })
  assert.equal(b.chips, G.STACK - 1)
  a.chips = 1
  assert.throws(() => G.applyMove(s, a.id, { type: 'shiftCol', col: 0, dir: 'down' }), /costs 2 chips and you have 1/)
  assert.equal(s.game.pot, 4)
})

test('a blind belt draw swaps an in-play card with a random belt card', () => {
  const { s, players } = table()
  const [a] = players
  for (let i = 0; i < 30; i++) {
    const before = [...s.rows[0].cards]
    s.game.turn = 0
    a.chips = 10
    G.applyMove(s, a.id, { type: 'beltDraw', col: 2 })
    const after = s.rows[0].cards
    assert.equal(after.length, 13)
    assert.ok(before.slice(5).includes(after[2]), 'the new card came from the belt')
    assert.ok(after.slice(5).includes(before[2]), 'the old card went onto the belt')
    assert.deepEqual([...after].sort(), [...before].sort())
    assert.equal(a.chips, 9)
  }
})

test("planting puts a hole card in another player's row and pushes theirs to the middle of their belt", () => {
  const { s, players } = table(3)
  const [a, b, c] = players
  G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'right' }) // A holds card 0
  G.applyMove(s, b.id, { type: 'shiftRow', dir: 'left' })
  G.applyMove(s, c.id, { type: 'shiftRow', dir: 'left' })
  assert.throws(() => G.applyMove(s, a.id, { type: 'plant', hole: 0, row: 0, col: 1 }), /another player/)
  assert.throws(() => G.applyMove(s, a.id, { type: 'plant', hole: 0, row: 3, col: 1 }), /another player/)
  const before = [...s.rows[1].cards]
  G.applyMove(s, a.id, { type: 'plant', hole: 0, row: 1, col: 1 })
  assert.deepEqual(a.holes, [])
  assert.equal(a.chips, G.STACK - 1 - 3)
  const after = s.rows[1].cards
  assert.equal(after[1], 0)
  assert.equal(after.length, 14)
  assert.equal(after[5 + 4], before[1]) // belt of 8: inserted 4 cards in
})

test('streets: betting opens after rounds 3, 6 and 9, and the showdown follows the last one', () => {
  const { s, players } = table()
  toStreet(s)
  assert.equal(s.game.betting.street, 0)
  assert.equal(s.game.round, 4)
  assert.throws(() => G.applyMove(s, players[0].id, { type: 'shiftRow', dir: 'left' }), /betting round/)
  G.applyMove(s, players[0].id, { type: 'bet', action: 'check' })
  G.applyMove(s, players[1].id, { type: 'bet', action: 'check' })
  assert.equal(s.game.betting, null)
  toStreet(s)
  assert.equal(s.game.betting.street, 1)
  playOut(s)
  assert.equal(s.phase, 'showdown')
  assert.equal(s.game.round, 10)
})

test('bet, raise, call and fold; raises are capped so everyone can always call', () => {
  const { s, players } = table(3)
  const [a, b, c] = players
  const bet = (p, action, amount) => G.applyMove(s, p.id, { type: 'bet', action, amount })
  toStreet(s)
  assert.equal(G.currentPlayer(s).id, a.id)
  assert.throws(() => bet(a, 'call'), /Nothing to call/)
  bet(a, 'raise', 3)
  assert.throws(() => bet(b, 'check'), /Call 3/)
  c.chips = 6
  // C can put in at most 6, so the bet can reach 6 at most: B may raise by 3, not 4.
  assert.throws(() => bet(b, 'raise', 4), /most you can raise is 3/)
  bet(b, 'raise', 2) // to 5
  bet(c, 'fold')
  bet(a, 'call')
  assert.equal(s.game.betting, null)
  assert.equal(a.chips, G.STACK - 1 - 5)
  assert.equal(b.chips, G.STACK - 1 - 5)
  assert.equal(s.game.pot, 3 + 10)
  // C has folded: no more moves for C.
  G.applyMove(s, a.id, { type: 'shiftRow', dir: 'left' })
  G.applyMove(s, b.id, { type: 'shiftRow', dir: 'left' })
  assert.equal(G.currentPlayer(s).id, a.id)
  assert.equal(G.viewFor(s, a.id, new Set()).players[2].folded, true)
})

test('when everyone else folds, the last player takes the pot unseen', () => {
  const { s, players } = table()
  const [a, b] = players
  toStreet(s)
  G.applyMove(s, a.id, { type: 'bet', action: 'raise', amount: 4 })
  G.applyMove(s, b.id, { type: 'bet', action: 'fold' })
  assert.equal(s.phase, 'showdown')
  assert.deepEqual(s.game.result.winners, [a.id])
  assert.equal(s.game.result.byFold, true)
  // A gets back the bet plus both antes; B banks what they had left.
  assert.equal(a.score, G.STACK - 1 - 4 + 6)
  assert.equal(b.score, G.STACK - 1)
  assert.equal(G.viewFor(s, b.id, new Set()).players[0].holes, null)
})

test('an offline bettor is skipped with a check, or a fold if they face a bet', () => {
  const { s, players } = table()
  const [a, b] = players
  toStreet(s)
  G.applyMove(s, a.id, { type: 'pass' })
  assert.equal(G.currentPlayer(s).id, b.id)
  G.applyMove(s, b.id, { type: 'bet', action: 'raise', amount: 2 })
  G.applyMove(s, a.id, { type: 'pass' })
  assert.equal(a.folded, true)
  assert.equal(s.phase, 'showdown')
})

test('the pot goes to the best hand, splits on a tie, and every stack is banked to the score', () => {
  const { s, players } = table(3)
  playOut(s)
  const r = s.game.result
  assert.equal(r.pot, 3)
  const paid = Object.values(r.payouts).reduce((x, y) => x + y, 0)
  assert.equal(paid, 3)
  for (const p of players) assert.equal(p.score, G.STACK - 1 + (r.payouts[p.id] || 0))
  assert.equal(players.reduce((t, p) => t + p.score, 0), 3 * G.STACK)
})

test('first player rotates each game and players can join between games', () => {
  const { s, players } = table()
  assert.equal(s.game.turn, 0)
  G.abandonGame(s)
  G.addPlayer(s, { name: 'Late', color: '#000000' })
  deal(s)
  assert.equal(s.game.turn, 1)
  assert.equal(s.rows.filter((r) => r.owner).length, 3)
  assert.throws(() => G.addPlayer(s, { name: 'Later' }), /in progress/)
  assert.ok(players)
})

test('views hide other hole cards but show every card in every row', () => {
  const { s, players } = table()
  G.applyMove(s, players[0].id, { type: 'pickUp', col: 0, fill: 'right' })
  const v = G.viewFor(s, players[1].id, new Set())
  assert.equal(v.players[0].holes, null)
  assert.equal(v.players[0].holeCount, 1)
  assert.equal(v.rows[0].inPlay.length, 5)
  // Out-of-play cards are face up, in wrap order: [0] enters next on the right.
  assert.deepEqual(v.rows[0].outOfPlay, s.rows[0].cards.slice(5))
  assert.equal(v.rows[1].outOfPlay.length, 8)
  assert.deepEqual(G.viewFor(s, players[0].id, new Set()).players[0].holes, [0])
})

test('spectator view with neutral rows does not throw', () => {
  const { s } = table(2)
  assert.doesNotThrow(() => G.viewFor(s, null, new Set()))
})

test('table labels show in-play cards; your own hand and leaders include your hole cards', () => {
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
  // A picks up A♠. Others now see only K-2-3-4-5 of spades, but A♠ still counts for A.
  G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'left' }) // K♠ wraps in
  v = G.viewFor(s, b.id, new Set())
  assert.equal(v.rows[0].hand, 'Flush')
  assert.equal(v.game.yourHand, 'High Card')
  assert.equal(G.handFor(s, a).name, 'Straight Flush')
  assert.equal(G.viewFor(s, a.id, new Set()).game.yourHand, 'Straight Flush')
  assert.equal(G.viewFor(s, null, new Set()).game.yourHand, null)
})

test('with 2 hole cards you can hold two and choose which to plant', () => {
  const s = G.createState()
  const [a, b] = ['A', 'B'].map((name) => G.addPlayer(s, { name }))
  G.setHoleCards(s, 2)
  deal(s)
  s.rows.forEach((row, r) => { row.cards = Array.from({ length: 13 }, (_, i) => r * 13 + i) })
  const pass = () => G.applyMove(s, b.id, { type: 'shiftRow', dir: 'left' })

  G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'right' }) // A♠
  pass()
  G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'right' }) // 2♠
  assert.deepEqual(a.holes, [0, 1])
  assert.equal(s.rows[0].cards.length, 11)
  pass()
  assert.throws(() => G.applyMove(s, a.id, { type: 'pickUp', col: 0, fill: 'right' }), /already hold 2/)

  // Plant the second hole card (2♠) in B's row.
  assert.throws(() => G.applyMove(s, a.id, { type: 'plant', hole: 2, row: 1, col: 1 }), /which hole card/)
  G.applyMove(s, a.id, { type: 'plant', hole: 1, row: 1, col: 1 })
  assert.deepEqual(a.holes, [0])
  assert.equal(s.rows[1].cards[1], 1)
  assert.equal(s.rows[1].cards.length, 14)
})

test('hole card setting only changes between games', () => {
  const s = G.createState()
  G.addPlayer(s, { name: 'A' })
  G.addPlayer(s, { name: 'B' })
  assert.throws(() => G.setHoleCards(s, 3), /1 or 2/)
  G.startGame(s)
  assert.throws(() => G.setHoleCards(s, 2), /between games/)
})

test('players pick rows: highest score first, then round-robin; leftover rows stay neutral', () => {
  const s = G.createState()
  const [a, b, c] = ['A', 'B', 'C'].map((name) => G.addPlayer(s, { name }))
  b.score = 30
  a.score = 10
  G.startGame(s)
  assert.equal(s.phase, 'picking')
  assert.ok(s.rows.every((r) => r.owner === null))
  assert.deepEqual(s.game.pickOrder, [b.id, c.id, a.id])
  // No moves until rows are chosen, and only the current picker may pick.
  assert.throws(() => G.applyMove(s, b.id, { type: 'shiftRow', dir: 'left' }), /choose a row/)
  assert.throws(() => G.pickRow(s, a.id, 0), /B's pick/)
  G.pickRow(s, b.id, 2)
  assert.throws(() => G.pickRow(s, c.id, 2), /belongs to B/)
  G.pickRow(s, c.id, 0)
  G.pickRow(s, a.id, 3)
  assert.equal(s.phase, 'playing')
  assert.deepEqual(s.rows.map((r) => r.owner), [c.id, null, b.id, a.id])
  // The game plays on the chosen rows.
  const mover = G.currentPlayer(s)
  G.applyMove(s, mover.id, { type: 'shiftRow', dir: 'left' })
})

test('a tie for highest score is broken at random among the leaders only', () => {
  const firsts = new Set()
  for (let i = 0; i < 60; i++) {
    const s = G.createState()
    const [a, b, c] = ['A', 'B', 'C'].map((name) => G.addPlayer(s, { name }))
    a.score = 20
    c.score = 20
    b.score = 10
    G.startGame(s)
    firsts.add(G.getPlayer(s, s.game.pickOrder[0]).name)
    // Round-robin from the first picker in seat order.
    const seat = s.players.findIndex((p) => p.id === s.game.pickOrder[0])
    assert.deepEqual(s.game.pickOrder, [0, 1, 2].map((k) => s.players[(seat + k) % 3].id))
  }
  assert.deepEqual([...firsts].sort(), ['A', 'C'])
})

test('an offline picker can be given a random open row', () => {
  const s = G.createState()
  G.addPlayer(s, { name: 'A' })
  G.addPlayer(s, { name: 'B' })
  G.startGame(s)
  const picker = G.currentPicker(s)
  G.pickRandomRow(s, picker.id)
  assert.equal(s.rows.filter((r) => r.owner === picker.id).length, 1)
  assert.equal(s.game.picks, 1)
})

test('the first player to join hosts; hosting passes on when the host leaves', () => {
  const s = G.createState()
  const a = G.addPlayer(s, { name: 'A' })
  const b = G.addPlayer(s, { name: 'B' })
  assert.equal(s.hostId, a.id)
  assert.doesNotThrow(() => G.requireHost(s, a.id))
  assert.throws(() => G.requireHost(s, b.id), /Only the host \(A\)/)
  G.setHost(s, b.id)
  assert.equal(s.hostId, b.id)
  G.removePlayer(s, b.id)
  assert.equal(s.hostId, a.id)
  G.removePlayer(s, a.id)
  assert.equal(s.hostId, null)
})

test('hole cards count toward a hand, including at the showdown', () => {
  const { s, players } = table()
  const [a, b] = players
  // A's in-play cards: A♠ 2♥ 4♣ 7♦ 10♠ (high card). Holding A♥ makes a pair of aces.
  s.rows[0].cards = [0, 14, 29, 45, 9, ...s.rows[0].cards.slice(5).filter((c) => c !== 13)]
  for (const r of s.rows.slice(1)) r.cards = r.cards.filter((c) => c !== 13)
  a.holes = [13]
  assert.equal(G.handFor(s, a).name, 'Pair')

  playOut(s)

  for (const p of [a, b]) {
    const scored = s.game.result.hands.find((h) => h.playerId === p.id)
    const pool = [...s.rows.find((r) => r.owner === p.id).cards.slice(0, 5), ...p.holes]
    assert.ok(scored.cards.every((c) => pool.includes(c)))
    assert.deepEqual(scored.score, G.handFor(s, p).score)
  }
  // A still holds A♥ and it can be part of the scored hand.
  assert.deepEqual(a.holes, [13])
})
