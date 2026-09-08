# SPILL THE LETTERS

A live, phone-controlled party game for the **Unified Greek Council at VCU**. Built for a room
of about 25 people and a projector.

**Live:** https://qwendor.github.io/spill/

---

## How it plays

1. The **big screen** (a laptop on the projector) opens the site and hits **Host on this screen**.
   It gets a 4-letter room code and a QR code.
2. **Everyone else** scans the QR, or types the code at the same URL. They pick a name, their
   chapter, and a colour.
3. Each round the screen shows one fill-in-the-blank prompt. **Everyone answers it at the same
   time** on their phone.
4. The screen then puts up a few of those answers, one at a time, anonymously and huge.
   **The whole room votes on who wrote it** from their phones.
   - Whoever wrote it gets a "this one is yours, poker face" screen instead of the vote grid.
5. Dramatic reveal, points, scoreboard, next round. Podium and superlatives at the end.

### Scoring

| Event | Points |
| --- | --- |
| You guessed the author correctly | 1000, plus up to 400 for answering fast |
| Someone guessed **you** correctly | 150 each (Open Book) |
| Nobody guessed you at all | 600 (The Enigma) |

Both playstyles score, so a brand-new member who nobody knows yet is not punished for it.

### End-of-game awards

Mind Reader (most correct guesses) · Open Book (everybody knows you) ·
The Enigma (hardest to figure out) · Vote Magnet (most votes received).

---

## Running it at an event

**The easy way** — open https://qwendor.github.io/spill/ on the projector laptop and click
**Host on this screen**. Nothing to install, and the certificate is trusted so phones just work.

**Locally** (no internet at the venue is *not* an option, see below):

```bash
python serve.py
```

Then open `http://localhost:4246/?host=1` on the projector. Phones need the HTTPS address
(`https://<LAN IP>:4245/`) because WebRTC will not run on a plain-HTTP page, and they have to tap
through the self-signed certificate warning once.

The cert is not in this repo. Generate one next to `serve.py` if you want the HTTPS side:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=spill"
```

Without `cert.pem` / `key.pem` the server still runs, HTTP only.

### Host controls

| Key / button | What it does |
| --- | --- |
| `Space` | Start the game, skip the timer, advance the reveal or scoreboard |
| `M` | Mute everything |
| `B` | Background music on / off |
| **Skip to voting** | Ends the answer phase early |
| **Skip this one** | Drops the current answer without scoring it (use if something is out of pocket) |
| **Reveal now** | Ends voting early |

In the lobby the host also picks the **packs** (Classic, Campus, Greek Life, Deep Cuts, Chaos)
and the **length** (5, 8 or 12 rounds). With 25 people that lands around 20, 28 and 36 minutes
at the outside, though phases end as soon as everyone is in, so expect noticeably less.
Those settings are remembered on that laptop.

### Things worth knowing before you run it

- **It needs internet.** Phones connect to the host browser peer-to-peer over WebRTC, and the
  handshake goes through the public PeerJS signalling server. There is no game server and no
  database, but the room cannot be created offline.
- **Keep the host tab in front.** Browsers throttle timers in background tabs. The screen also
  requests a wake lock so the laptop does not sleep.
- **Phones can drop and come back.** A locked or backgrounded phone reconnects on its own and
  keeps its name and score, because identity lives in `localStorage` and the host keeps the seat
  warm. Players can also join late and start playing the next round.
- **Reloading the host ends the game.** All state lives in that tab.
- Up to 40 people can join. 32 distinct player colours, so a room of 25 never has a repeat, and
  the lobby roster shrinks its cards to keep everybody's name on screen.
- Voting time scales with the roster (26 to 45 seconds) because picking from 24 names takes
  longer than picking from 5. It still ends early once everyone has voted.

---

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Shell plus the router: `#CODE` is a player, `?host=1` is the big screen |
| `css/style.css` | The whole design system |
| `js/prompts.js` | ~110 prompts across 5 packs, the chapter list, and bot filler answers |
| `js/net.js` | PeerJS wrapper: room codes, reconnects, keepalive |
| `js/host.js` | Game state machine, scoring, and every big-screen view |
| `js/player.js` | Phone client |
| `js/ui.js` | Shared helpers: colours, sound effects, confetti, timer ring |
| `js/music.js` | The background music, synthesised live (see below) |
| `vendor/` | PeerJS and the QR encoder, vendored so nothing loads from a CDN at showtime |
| `serve.py` | Local HTTP + HTTPS server for testing on the LAN |

## Test hooks

Add to the host URL:

| Param | Effect |
| --- | --- |
| `?bots=20` | Fills the lobby with 20 simulated players that answer and vote on their own |
| `?fast` | Runs every timer at ~22% length |
| `?auto` | With `bots`, starts the game by itself |
| `?peerhost=<host>` | Point at your own PeerJS server instead of the public one |

From the console on the host screen:

```js
SPILL.state()      // phase, round, scores
SPILL.addBots(10)
SPILL.skip()       // end the current phase
SPILL.jumpToEnd()  // straight to the podium
SPILL.game         // raw state
```

On a phone: `SPILL_PLAYER.answer("text")`, `SPILL_PLAYER.vote(playerId)`, `SPILL_PLAYER.view`.

---

## Music

The background bed is **synthesised live in Web Audio**, not played from a file. Nothing to
license, nothing to download at the venue, and it follows the game: mellow in the lobby, driving
while people answer, tense while the room votes, and ducked under the reveal so the sting cuts
through. A dembow groove in A minor over Am - F - C - G at 100 BPM.

Browsers block audio until the host interacts with the page, so it starts on the first click or
key press. `MUSIC.level()` in the console returns the RMS actually reaching the speakers, which
answers "is the music on?" without having to hear it.

To use a real track instead, drop a file in and set `FILE_OVERRIDE` at the bottom of
`js/music.js` (or call `MUSIC.useFile("audio/whatever.mp3")`). It still ducks on the reveal.

## Design

Built to match the UGC at VCU flyer look: black ground, gold sunburst from the council seal,
crimson accents, heavy condensed uppercase type, halftone corners, print registration marks, and
Greek letterforms drifting behind everything. Answers go up as taped-up flyer cards.

**On the chapter crests:** each UGC chapter is represented by its **Greek letters** set in the
game's own display face. No chapter's actual crest, badge or logo is reproduced anywhere, and the
crest colours are this game's palette, not any chapter's official colours. Those marks belong to
the organisations, so if UGC wants their real artwork in here, that has to come from them.
