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

The first player to join is the **host**, marked with a Host tag. Only the host can deal, choose whether each player may hold **1 or 2 hole cards**, abandon a game (nobody scores it), return everyone to the lobby, and remove offline players, so a sore loser can't end a game early. The host can hand the job to someone else with **Make host** in the lobby. If the host leaves the table, hosting passes to the next player; if the host's connection drops, anyone else can tap **Become host** so the table never gets stuck.

| Command | What it does |
| --- | --- |
| `npm start` | Runs the server and restarts it automatically if it ever stops. Resumes the saved table. |
| `npm run fresh` | Starts a brand-new table (clears players and scores). |
| `npm run once` | Runs the server once, without the auto-restart loop. |
| `npm test` | Runs the rules and hand-ranking tests. |

Set `PORT` to change the port (default `3000`) and `STATE_FILE` to change where the table is saved (default `game-state.json`).

## How to play

Push Poker is a scoring game. Each game, everyone plays a fresh stack of chips, and whatever you finish with is added to your **session score**. Nobody is ever knocked out: the goal is the highest score at the end of the night.

### The deal

The whole deck is dealt into **4 rows of 13 cards**, with a randomly chosen flourish: a Solitaire-style slinky deal, a riffle shuffle, or an explosion. Tap or press any key to skip it. Only **5 cards in each row are in play**. The rest of the row sits out of play, face up, on a belt under the row, and wraps around like a loop. The card at each end of the belt is the next one in on that side, so you can always see what a shift will bring.

Everyone gets **20 chips** and antes **1** into the pot.

### Choosing rows

After the deal, every row's in-play cards are shown with the hand they make, and players take turns choosing a row. The player with the highest session score picks first; if several players are tied for the lead, one of them is drawn at random. Picking then goes round-robin in seat order. Tap **Take this row**, or press <kbd>1</kbd>–<kbd>4</kbd> on a keyboard.

With fewer than 4 players, the rows nobody takes are **neutral**: nobody plays them, but cards still pass through them. If the player whose pick it is goes offline, anyone can tap **Pick a row for them** to give them a random open row.

Who moves first is separate from who picks first: it rotates around the table each game.

### Your hand

Your hand is the **best 5 cards from your in-play cards plus your hole cards**, like Texas Hold'em.

### Moves

On your turn you make exactly one move. Moves that only touch your own row are free. Moves that change other players' hands cost chips, and those chips go into the pot.

| Move | Cost | What it does |
| --- | --- | --- |
| **◀ ▶ Shift your row** | free | Your in-play cards slide one step. A card drops onto the belt at one end, and the card at the other end of the belt enters play. |
| **Pick up a hole card** | free | Tap a card in your row and choose which side fills the gap (the prompt shows which card each side brings in). Hole cards are hidden, safe from every shift, and still count toward your hand. You can hold 1 or 2, depending on the table setting chosen in the lobby. |
| **🎲 Blind belt draw** | 1 chip | Tap a card in your row and swap it for a random card from your belt. You can see every belt card, so you can count your odds. The card you give up lands face up on your belt. |
| **▲ ▼ Shift a column** | 2 chips | The in-play card in that column moves one row up or down through all 4 rows, wrapping from top to bottom. This changes everyone's hand. |
| **Plant a card** | 3 chips | Tap a hole card, then tap a card in another player's row. Your card replaces theirs, and theirs goes to the middle of their belt. This is the only way a hole card leaves your hand: spend a turn hurting the leader instead of helping yourself. |

### Betting

There are three betting rounds, or streets: the **Flop** after round 3, the **Turn** after round 6, and the **River** after round 9. The player due to move next bets first, then it goes round the table.

- **Check** if nobody has bet, **call** to match the bet, or **bet** / **raise**.
- Raises are capped so that everyone still in can afford to call. Nobody is ever all-in, and there are no side pots.
- **Fold** to drop out of the game. You make no more moves, but you keep every chip you haven't put in.

Every player's row is labelled with what everyone can see: the best hand in its in-play cards, with **+?** when that player holds hidden hole cards. Your own row shows your real hand, hole cards included. 👑 marks whoever looks to be leading from what you can see. Reading the **+?** and the betting is the bluffing game.

### Showdown

After the River betting, the best hand among the players still in takes the pot. Tied players split it, with any odd chip going to the first winner in seat order. If everyone else folds, the last player in takes the pot without showing their cards.

Then every player banks what they have left onto their session score. New players can sit down between games.

### Keyboard shortcuts

On a computer you can play without the mouse. Buttons show their key on screens with a mouse.

| When | Keys | Action |
| --- | --- | --- |
| Your move | <kbd>←</kbd> <kbd>→</kbd> | Move the cursor along your row |
| | <kbd>Enter</kbd> | Open the choices for the card under the cursor |
| | <kbd>Shift</kbd>+<kbd>←</kbd> <kbd>→</kbd> | Shift your row |
| | <kbd>Shift</kbd>+<kbd>↑</kbd> <kbd>↓</kbd> | Shift the column under the cursor (its ▲ ▼ buttons light up) |
| | <kbd>P</kbd> | Plant a hole card |
| Card choices | <kbd>←</kbd> <kbd>→</kbd> | Pick the card up, filling the gap from that side |
| | <kbd>D</kbd> | Swap it for a random belt card |
| Planting | <kbd>←</kbd> <kbd>→</kbd> | Holding two hole cards: choose which to plant |
| | <kbd>↑</kbd> <kbd>↓</kbd> then <kbd>←</kbd> <kbd>→</kbd> | Choose the row, then the card to replace |
| | <kbd>Enter</kbd> | Choose that card, then <kbd>Enter</kbd> again to plant |
| Betting | <kbd>C</kbd> | Check, or call |
| | <kbd>1</kbd> <kbd>2</kbd> <kbd>5</kbd> | Bet or raise by that much (any digit works, up to the cap) |
| | <kbd>M</kbd> | Raise the most allowed |
| | <kbd>F</kbd> | Fold |
| Anytime | <kbd>Esc</kbd> | Cancel |

## Dropped connections

The game is built to cope with closed laptops, sleeping phones, and flaky Wi‑Fi:

- **Your seat belongs to you, not to your connection.** If you drop, your seat is held and you show as offline. The page reconnects by itself when you come back.
- **Switching devices:** open the URL on the new device and tap your name under **Rejoin your seat**.
- **Server restarts:** the table is saved to `game-state.json` after every change. `npm start` restarts the server automatically if it stops, and the game picks up exactly where it left off.
- **Someone leaves for good:** other players can **Skip their move** while they are offline (on a betting turn, a skipped player checks, or folds if there's a bet to call), and the host can **Abandon game** (no winner) or remove offline players in the lobby. If the host is the one who left, anyone can **Become host** first.

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
