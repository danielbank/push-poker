// Poker hand evaluation. A card is an id 0..51: suit = id / 13 | 0, rank = id % 13 + 1 (1 = Ace).
// Matches deck-of-cards' numbering (suit 0 spades, 1 hearts, 2 clubs, 3 diamonds).

export const HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
]

export const suitOf = (id) => (id / 13) | 0
// Poker value: 2..14, Ace high.
export const valueOf = (id) => (id % 13 === 0 ? 14 : (id % 13) + 1)

// Score a 5-card hand as an array compared lexicographically: [category, ...tiebreakers].
export function scoreFive(cards) {
  const values = cards.map(valueOf).sort((a, b) => b - a)
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]))

  const unique = [...new Set(values)]
  let straightHigh = 0
  if (unique.length === 5) {
    if (values[0] - values[4] === 4) straightHigh = values[0]
    else if (values[0] === 14 && values[1] === 5) straightHigh = 5 // wheel: A-2-3-4-5
  }

  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1)
  // Groups ordered by size, then value: e.g. full house 3-3-3-9-9 -> [[3,3],[9,2]]
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const shape = groups.map((g) => g[1]).join('')
  const byGroup = groups.map((g) => g[0])

  if (straightHigh && flush) return [8, straightHigh]
  if (shape === '41') return [7, ...byGroup]
  if (shape === '32') return [6, ...byGroup]
  if (flush) return [5, ...values]
  if (straightHigh) return [4, straightHigh]
  if (shape === '311') return [3, ...byGroup]
  if (shape === '221') return [2, ...byGroup]
  if (shape === '2111') return [1, ...byGroup]
  return [0, ...values]
}

export function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0)
    if (d) return d
  }
  return 0
}

// Every way to choose k cards from the list.
function choose(cards, k, start = 0, picked = [], out = []) {
  if (picked.length === k) out.push([...picked])
  else for (let i = start; i <= cards.length - (k - picked.length); i++) {
    picked.push(cards[i])
    choose(cards, k, i + 1, picked, out)
    picked.pop()
  }
  return out
}

// Best 5-card hand from 5 or more cards.
export function bestHand(cards) {
  const candidates = cards.length <= 5 ? [cards] : choose(cards, 5)
  let best = null
  for (const five of candidates) {
    const score = scoreFive(five)
    if (!best || compareScores(score, best.score) > 0) best = { score, cards: five }
  }
  return { ...best, name: HAND_NAMES[best.score[0]] }
}
