# Push Poker

Push 4 meets poker. A web card game for 2–4 players sitting at the same table, each on their own phone or laptop. One player hosts the server, and everyone else joins from a shared URL. Every move shows up on every screen instantly.

## Quick start

Requires Node.js 18 or newer.

```sh
npm install
npm start            # serves http://localhost:3000
ngrok http 3000      # in another terminal; share the https URL with the table
```

Everyone opens the URL, picks a name and a color (the name generates their [DiceBear critter](https://www.dicebear.com/styles/critters/) avatar), and takes a seat. Once two or more players are seated, the host presses **Deal!**.

### The host

The first player to join is the **host**, marked with a Host tag. Only the host can deal, choose whether each player may hold **1 or 2 hole cards**, abandon a game, return everyone to the lobby, and remove offline players, so a sore loser can't end a game early. The host can hand the job to someone else with **Make host** in the lobby. If the host leaves the table, hosting passes to the next player; if the host's connection drops, anyone else can tap **Become host** so the table never gets stuck.

| Command | What it does |
| --- | --- |
| `npm start` | Runs the server and restarts it automatically if it ever stops. Resumes the saved table. |
| `npm run fresh` | Starts a brand-new table (clears players and win counts). |
| `npm run once` | Runs the server once, without the auto-restart loop. |
| `npm test` | Runs the rules and hand-ranking tests. |

Set `PORT` to change the port (default `3000`) and `STATE_FILE` to change where the table is saved (default `game-state.json`).

## How to play

### The deal

The whole deck is dealt into **4 rows of 13 cards**, with a randomly chosen flourish: a Solitaire-style slinky deal, a riffle shuffle, or an explosion. Tap or press any key to skip it. Only **5 cards in each row are in play**. The rest of the row sits out of play, face up, on a belt under the row, and wraps around like a loop. The card at each end of the belt is the next one in on that side, so you can always see what a shift will bring.

### Choosing rows

After the deal, every row's in-play cards are shown with the hand they make, and players take turns choosing a row. The player with the most wins picks first; if several players are tied for the lead, one of them is drawn at random. Picking then goes round-robin in seat order. Tap **Take this row**, or press <kbd>1</kbd>–<kbd>4</kbd> on a keyboard.

With fewer than 4 players, the rows nobody takes are **neutral**: nobody plays them, but cards still pass through them. If the player whose pick it is goes offline, anyone can tap **Pick a row for them** to give them a random open row.

Who moves first is separate from who picks first: it rotates around the table each game.

Your goal is to have the best poker hand in your row when the game ends.

### Moves

On your turn you make exactly one move:

- **◀ ▶ Shift your row.** Your in-play cards slide one step left or right. A card drops onto the belt at one end, and the card at the other end of the belt enters play. The row wraps, so you can always shift.
- **▲ ▼ Shift a column.** Pick one of the 5 columns. The in-play card in that column moves one row up or down through all 4 rows, wrapping from top to bottom. This is how cards change hands between players.
- **Pick up a hole card.** Tap a card in your row to take it as a hole card. It is hidden from the other players, safe from every shift, and still counts toward your hand. Choose whether the gap fills from the left or the right (the prompt shows which card each side brings in), so you still have 5 cards in play. You can hold 1 or 2 hole cards at a time, depending on the table setting chosen in the lobby.
- **Put a hole card down.** Tap the hole card you want to place, tap a **+** to choose where it goes in your row, then choose which end card gets pushed out of play. If you put it at the very start or end of the row, the card at the other end is pushed out automatically, so your hole card can never go straight back out of play.
- **Knock.** Allowed once 5 full rounds are done (every player has moved 5 times). Knocking uses up your move. Then everyone, including you, gets one last move, and then the hands are compared.

### Reading the table

Your own row is labelled with your real hand, hole cards included. Other rows show the best hand in their in-play cards, with **+?** when that player holds hidden hole cards that could improve it. 👑 marks whoever looks to be leading from what you can see.

### Keyboard shortcuts

On a computer you can play without the mouse:

| Keys | Action |
| --- | --- |
| <kbd>←</kbd> <kbd>→</kbd> | Move the cursor along your row: over your cards while you can pick one up, and over the **+** markers while you hold a hole card |
| <kbd>Enter</kbd> | Pick up the card under the cursor, or put a hole card down at the focused **+** (holding two, you're asked which one: <kbd>←</kbd> <kbd>→</kbd>) |
| <kbd>Shift</kbd>+<kbd>←</kbd> <kbd>→</kbd> | Shift your row |
| <kbd>Shift</kbd>+<kbd>↑</kbd> <kbd>↓</kbd> | Shift the column under the cursor (its ▲ ▼ buttons light up) |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Knock |
| <kbd>←</kbd> <kbd>→</kbd> / <kbd>Esc</kbd> | When asked which side fills the gap or which end gets pushed out: choose a side, or cancel |

### Showdown

Your hand is the **best 5 cards from your in-play cards plus your hole cards**, like Texas Hold'em. Standard poker rankings apply, from high card up to straight flush, and an ace can play high or low in a straight. The best hand wins the game. Tied players each get a win.

Win counts carry over from game to game. The first player rotates each game, and new players can sit down between games.

## Dropped connections

The game is built to cope with closed laptops, sleeping phones, and flaky Wi‑Fi:

- **Your seat belongs to you, not to your connection.** If you drop, your seat is held and you show as offline. The page reconnects by itself when you come back.
- **Switching devices:** open the URL on the new device and tap your name under **Rejoin your seat**.
- **Server restarts:** the table is saved to `game-state.json` after every change. `npm start` restarts the server automatically if it stops, and the game picks up exactly where it left off.
- **Someone leaves for good:** other players can **Skip their move** while they are offline, and the host can **Abandon game** (no winner) or remove offline players in the lobby. If the host is the one who left, anyone can **Become host** first.

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

The server owns the game state and enforces every rule. Each player is sent only what they may see: every card in every row, and their own hole cards. All hole cards are revealed at the showdown.

## Credits

- Card art from [deck-of-cards](https://deck-of-cards.js.org/) by Juha Lindstedt (MIT).
- Avatars from [DiceBear](https://www.dicebear.com/), Critters style.

## License

[MIT](LICENSE)
