# Push Poker

Push 4 meets poker. A web card game for 2–4 players sitting at the same table, each on their own phone or laptop. One player hosts the server, and everyone else joins from a shared URL. Every move shows up on every screen instantly.

## Quick start

Requires Node.js 18 or newer.

```sh
npm install
npm start            # serves http://localhost:3000
ngrok http 3000      # in another terminal; share the https URL with the table
```

Everyone opens the URL, picks a name and a color (the name generates their [DiceBear critter](https://www.dicebear.com/styles/critters/) avatar), and takes a seat. Once two or more players are seated, anyone can press **Deal!**.

| Command | What it does |
| --- | --- |
| `npm start` | Runs the server and restarts it automatically if it ever stops. Resumes the saved table. |
| `npm run fresh` | Starts a brand-new table (clears players and win counts). |
| `npm run once` | Runs the server once, without the auto-restart loop. |
| `npm test` | Runs the rules and hand-ranking tests. |

Set `PORT` to change the port (default `3000`) and `STATE_FILE` to change where the table is saved (default `game-state.json`).

## How to play

### The deal

The whole deck is dealt into **4 rows of 13 cards**. Each player owns one row. With fewer than 4 players, the leftover rows are **neutral**: nobody plays them, but cards still pass through them.

Only **5 cards in each row are in play**, and those are the only ones anyone can see. The rest of the row sits out of play, in order, and wraps around like a loop.

Your goal is to have the best poker hand in your row when the game ends.

### Moves

On your turn you make exactly one move:

- **◀ ▶ Shift your row.** Your in-play cards slide one step left or right. A card leaves play at one end, and the next out-of-play card enters at the other. The row wraps, so you can always shift.
- **▲ ▼ Shift a column.** Pick one of the 5 columns. The in-play card in that column moves one row up or down through all 4 rows, wrapping from top to bottom. This is how cards change hands between players.
- **Pick up a hole card.** Tap a card in your row to take it as your hole card. It is hidden from the other players and safe from every shift. Choose whether the gap fills from the left or the right, so you still have 5 cards in play. You can hold one hole card at a time.
- **Put your hole card down.** Tap your hole card, tap a **+** to choose where it goes in your row, then choose which end card gets pushed out of play. If you put it at the very start or end of the row, the card at the other end is pushed out automatically, so your hole card can never go straight back out of play.
- **Knock.** Allowed once 5 full rounds are done (every player has moved 5 times). Knocking uses up your move. Then everyone, including you, gets one last move, and then the hands are compared.

### Reading the table

Every player's row is labelled with the best hand showing in their 5 in-play cards, and 👑 marks whoever is leading. Both are worked out from the cards on the table only, so they never give away a hole card. While you hold a hole card that improves your hand, your own row also shows your real hand next to a card-back icon. Only you can see that label.

### Keyboard shortcuts

On a computer you can play without the mouse:

| Keys | Action |
| --- | --- |
| <kbd>←</kbd> <kbd>→</kbd> | Move the cursor along your row: over your cards, or over the **+** markers while you hold a hole card |
| <kbd>Enter</kbd> | Pick up the card under the cursor, or put your hole card down at the focused **+** |
| <kbd>Shift</kbd>+<kbd>←</kbd> <kbd>→</kbd> | Shift your row |
| <kbd>Shift</kbd>+<kbd>↑</kbd> <kbd>↓</kbd> | Shift the column under the cursor (its ▲ ▼ buttons light up) |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Knock |
| <kbd>←</kbd> <kbd>→</kbd> / <kbd>Esc</kbd> | When asked which side fills the gap or which end gets pushed out: choose a side, or cancel |

### Showdown

Your hand is the **best 5 cards** from your 5 in-play cards plus your hole card, if you have one. Standard poker rankings apply, from high card up to straight flush, and an ace can play high or low in a straight. The best hand wins the game. Tied players each get a win.

Win counts carry over from game to game. The first player rotates each game, and new players can sit down between games.

## Dropped connections

The game is built to cope with closed laptops, sleeping phones, and flaky Wi‑Fi:

- **Your seat belongs to you, not to your connection.** If you drop, your seat is held and you show as offline. The page reconnects by itself when you come back.
- **Switching devices:** open the URL on the new device and tap your name under **Rejoin your seat**.
- **Server restarts:** the table is saved to `game-state.json` after every change. `npm start` restarts the server automatically if it stops, and the game picks up exactly where it left off.
- **Someone leaves for good:** other players can **Skip their move** while they are offline, or **Abandon game** (no winner). Offline players can be removed in the lobby.

## Testing on one machine

Each browser tab normally shares one seat. Add `?p=<anything>` to the URL to give a tab its own seat, for example `http://localhost:3000/?p=alice` and `http://localhost:3000/?p=bob`.

## Project layout

```
server.js         Express + Socket.IO server: seats, reconnection, persistence
lib/game.js       Game rules as pure state transitions, and per-player views
lib/hands.js      Poker hand evaluation
public/           The browser client (index.html, app.js, style.css)
test/             Rules and hand-ranking tests (node:test)
```

The server owns the game state and enforces every rule. Each player is sent only what they may see: the in-play cards and their own hole card. All hole cards are revealed at the showdown.

## Credits

- Card art from [deck-of-cards](https://deck-of-cards.js.org/) by Juha Lindstedt (MIT).
- Avatars from [DiceBear](https://www.dicebear.com/), Critters style.

## License

[MIT](LICENSE)
