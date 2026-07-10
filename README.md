# MuseScore MCP Server — Hot-Reload Fork

A Model Context Protocol (MCP) server that gives AI assistants like Claude programmatic
control over **MuseScore 4** through a WebSocket plugin: compose music, add lyrics, navigate
scores, and read the score back as compact LilyPond.

> **This is a fork of [`ghchen99/mcp-musescore`](https://github.com/ghchen99/mcp-musescore)
> by [@ghchen99](https://github.com/ghchen99).** All credit for the original concept and the
> WebSocket-plugin approach goes to the original author (and to
> [@CariacouP](https://github.com/CariacouP) for the lyric/title contributions upstream).
> This fork reworks the plugin architecture, the score representation, and the tool surface —
> see **[What this fork does differently](#what-this-fork-does-differently)** below.

![Demo GIF](./assets/mcp-muse.gif)

---

## What this fork does differently

The original project established the core idea: a MuseScore plugin that exposes the scripting
API over a WebSocket, driven by a Python MCP server. This fork keeps that foundation and
focuses on three things — **iteration speed, token efficiency, and giving the model the
musical context it needs to write well.**

### 1. Hot-reloadable plugin architecture

The plugin is split into two files:

- **`musescore-mcp-websocket.qml`** — a thin, stable *shell*. It runs the WebSocket server
  and, on every request, reads `mcp-logic.js` and `eval()`s it.
- **`mcp-logic.js`** — *all* command logic.

**Why:** MuseScore only reloads a `.qml` plugin via the Plugin Manager (effectively a restart).
By moving the logic into a JS file the shell re-reads on every call, you edit `mcp-logic.js`
and the change takes effect on the **next command — no restart, no clicks**. You load the
`.qml` shell from the Plugin Manager exactly once. (Local-file `XMLHttpRequest` is disabled in
MuseScore 4 / Qt6, so the shell uses `FileIO` to read the logic.)

### 2. Compact LilyPond representation instead of raw JSON

`get_score` returns the score as **compact LilyPond**, not a verbose JSON element dump.

- **Whole-score by default**, one continuous line per staff/voice, `|` bar checks between
  measures. Pass `start_measure`/`end_measure` to fetch only a slice of a large score.
- **Multi-voice polyphony** is mapped correctly: concurrent voices become
  `\voiceOne … \\ \voiceTwo …` arrays, sharded per staff.
- **Temporal padding**: gaps/rests in a voice are filled with LilyPond spacer rests (`s4.`) so
  every voice stays rhythmically aligned.
- **Repeated whole-measure rests collapse** to multi-measure rests — 28 empty bars render as
  `R1*28` instead of 28× `r1 |`.
- **Absent voices** in a measure are padded with a single full-measure spacer rather than
  noisy bare bar checks.

**Why:** LilyPond is dramatically denser than JSON and is a notation the model already
understands, so the same score costs far fewer tokens to read and reason about.

### 3. Musical context the model can actually see

`get_score` now surfaces **key signature, tempo, and per-measure time signatures**, rendered
as `\key` / `\tempo` / `\time` directives (time signature only re-emitted when it changes),
plus a one-line header (`Title | N measures | M staves | 3/4 | 120bpm`).

**Why:** without the time signature the model can't tell whether a bar is 3/4 or 4/4 — which
it must know to write correct rhythms. *(Clef is intentionally omitted: the plugin API has no
reliable per-staff clef accessor, and a guessed clef is worse than none.)*

### 4. Friendlier, more robust tooling

- **Note names**: `add_note` accepts `"C4"`, `"Eb5"`, `"F#3"` (and double accidentals like
  `Fx`/`Abb`) in addition to raw MIDI integers.
- **Self-healing connection**: safe read-only calls transparently reconnect after a dead socket.
  Edits are not blindly retried when delivery is uncertain, preventing duplicated notes/measures.
- **Bounded failures**: configurable connection/command timeouts and response-size limits prevent
  a wedged plugin or very large score read from hanging an agent indefinitely.
- **Clear batch errors**: `processSequence` reports each failed step as
  `{step, action, params, error}`, so you see exactly which input was bad.
- **Honest about deletions**: MuseScore's plugin `undo()` is unreliable for deletions, so
  `delete_selection` and a following `undo` return a warning pointing you to native Ctrl+Z.
- **Slimmer surface**: dropped `set_instrument_sound` (it only opened a dialog) and
  `connect_to_musescore` (every call auto-connects).

### 5. Tested core

The pure LilyPond converter has a [pytest suite](tests/test_lilypond_converter.py) covering
note-name parsing, rest collapsing, voice spacers, and the key/time/tempo header — runnable
without MuseScore. Dependencies are pinned.

---

## Prerequisites

- MuseScore 4.x
- Python 3.8+
- Claude Desktop or a compatible MCP client

## Setup

### 1. Install the MuseScore plugin

**MuseScore 4 requires every plugin to live in its own subfolder** — a loose `.qml` in the
Plugins root is *not* detected. Create a `musescore-mcp/` subfolder and put **both** files in
it (they must sit next to each other; the shell reads `mcp-logic.js` from its own directory):

```
<Plugins>/musescore-mcp/musescore-mcp-websocket.qml
<Plugins>/musescore-mcp/mcp-logic.js
```

Where `<Plugins>` is:

- **Windows**: `%USERPROFILE%\Documents\MuseScore4\Plugins\`
- **macOS**: `~/Documents/MuseScore4/Plugins/`
- **Linux**: `~/Documents/MuseScore4/Plugins/`

### 2. Enable the plugin in MuseScore

1. Open MuseScore.
2. Go to **Plugins → Plugin Manager**.
3. Find **"MuseScore API Server"**, check the box to enable it, click **OK**.

### 3. Set up the Python environment

```bash
git clone https://github.com/RNeumann12/mcp-musescore.git
cd mcp-musescore
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # add -r requirements-dev.txt to run the tests
```

### 4. Configure Claude Desktop

Add to your Claude Desktop config:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "musescore": {
      "command": "/path/to/your/project/.venv/bin/python",
      "args": ["/path/to/your/project/server.py"]
    }
  }
}
```

Update the paths to match your project location.

## Running the system

1. **Start MuseScore first**, with a score open.
2. **Run the plugin**: **Plugins → MuseScore API Server**. You should see
   `Starting MuseScore MCP API Server … on port 8765` in the console.
3. **Start the Python MCP server** (or restart Claude Desktop).

To see plugin console output, launch MuseScore from a terminal:

- **Windows**: `cd "C:\Program Files\MuseScore 4\bin"` then `MuseScore4.exe`
- **macOS**: `/Applications/MuseScore\ 4.app/Contents/MacOS/mscore`
- **Linux**: `musescore4`

## Tools

### Navigation & cursor
- `get_cursor_info()` — current cursor/selection as LilyPond
- `go_to_measure(measure)` — jump to a measure (1-based)
- `go_to_beginning_of_score()` / `go_to_final_measure()`
- `next_element()` / `prev_element()` — move element by element
- `next_staff()` / `prev_staff()` — move between staves
- `select_current_measure()` — select the whole current measure
- `select_custom_range(start_tick, end_tick, start_staff, end_staff)` — precise cross-measure,
  multi-staff slice

### Notes, rests & lyrics
- `add_note(pitch, duration, advance_cursor_after_action)` — `pitch` is a MIDI int (`60`) **or**
  a note name (`"C4"`, `"Eb5"`, `"F#3"`)
- `add_rest(duration, advance_cursor_after_action)`
- `add_tuplet(duration, ratio, advance_cursor_after_action)` — triplets etc.
- `add_lyrics(lyrics_list, verse=0)` — one syllable per note from the cursor

### Text & section markers
Attach real text annotations instead of overloading lyrics. Each takes the text plus
optional positioning — a 1-based `measure`, an absolute `tick`, or (default) the current
cursor. Existing markers are surfaced in `get_score` as `% m9 [RehearsalMark]: B` comment lines.
- `add_system_text(text, measure=None, tick=None, staff=None)` — a label above the system,
  shown on every part; the right way to mark sections (`"Verse"`, `"Chorus"`)
- `add_rehearsal_mark(text, measure=None, tick=None, staff=None)` — the boxed A/B/C markers
- `add_staff_text(text, measure=None, tick=None, staff=None)` — a cue on a single staff
  (`"pizz."`, `"solo"`)
- `add_chord_symbol(text, measure=None, tick=None, staff=None)` — a chord symbol MuseScore
  formats specially (`"Cm7"`, `"G/B"`, `"F#dim"`); pass `tick` for beat-precise placement

### Measures
- `insert_measure()` — insert at the current position
- `append_measure(count=1)` — add measures at the end
- `delete_selection(measure=None)` — *(plugin undo is unreliable for deletes; see below)*

### Staff, time & tempo
- `add_instrument(instrument_id)`
- `set_staff_mute(staff, mute)`
- `set_time_signature(numerator, denominator)`
- `set_tempo(bpm)` — quarter-note BPM marking at the cursor

### Score & connection
- `get_score(start_measure=None, end_measure=None)` — read the score as compact LilyPond with a
  context header (title, counts, time signature, tempo, and `\key`/`\time`/`\tempo` directives)
- `ping_musescore()` — connectivity check (the client also auto-connects on every call)
- `get_mcp_status()` — bridge configuration plus live plugin reachability
- `reload_plugin()` — force-recompile `mcp-logic.js`
- `undo()` — undo the last action
- `process_sequence(sequence)` — validated batch; failures come back per-step
- `processSequence(sequence)` — backwards-compatible alias

### Fretted instruments

- `get_fingering(staff=0, start_measure=None, end_measure=None)` — read tuning and string/fret
  assignments
- `set_note_string(tick, staff, string, voice=0, pitch=None, fret=None)` — choose an absolute
  string while preserving pitch
- `move_note_string(tick, staff, moves, voice=0, pitch=None)` — move relatively across strings
- `remove_notes_at_tick(tick, pitches, staff=0)` — remove selected pitches from a chord

## Optional configuration

Set these environment variables in the MCP server configuration when the defaults are unsuitable:

| Variable | Default |
| --- | ---: |
| `MUSESCORE_MCP_HOST` | `localhost` |
| `MUSESCORE_MCP_PORT` | `8765` |
| `MUSESCORE_MCP_CONNECT_TIMEOUT` | `5` seconds |
| `MUSESCORE_MCP_COMMAND_TIMEOUT` | `30` seconds |
| `MUSESCORE_MCP_MAX_RESPONSE_BYTES` | `8388608` |

If a timeout or `uncertain_delivery` error occurs during an edit, read the affected score range
before retrying because MuseScore may have applied the command before the connection failed.

## Usage examples

### A simple melody with lyrics

```python
await go_to_beginning_of_score()

# pitch as a MIDI int or a note name — both work
await add_note("C4", {"numerator": 1, "denominator": 4}, True)  # quarter note C
await add_note("E4", {"numerator": 1, "denominator": 4}, True)  # quarter note E
await add_note(67,   {"numerator": 1, "denominator": 4}, True)  # quarter note G
await add_note("C5", {"numerator": 1, "denominator": 2}, True)  # half note C

await go_to_beginning_of_score()
await add_lyrics(["Do", "Mi", "Sol", "Do"])
```

### Batch operations

```python
sequence = [
    {"action": "goToBeginningOfScore", "params": {}},
    {"action": "addNote", "params": {"pitch": 60, "duration": {"numerator": 1, "denominator": 4}, "advanceCursorAfterAction": True}},
    {"action": "addNote", "params": {"pitch": 64, "duration": {"numerator": 1, "denominator": 4}, "advanceCursorAfterAction": True}},
    {"action": "addRest", "params": {"duration": {"numerator": 1, "denominator": 4}, "advanceCursorAfterAction": True}},
]
await processSequence(sequence)
```

## Development

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for the prioritized agent-completeness roadmap and
the reliability work already implemented.

```bash
pip install -r requirements-dev.txt
pytest                 # runs the pure-Python converter tests (no MuseScore needed)
```

`verify_mcp.py` is an end-to-end smoke test that talks straight to the WebSocket on port 8765
(bypassing the MCP server) — run it after restarting MuseScore to confirm the live plugin.

## Reference

**MIDI pitches** — Middle C = 60; C major scale = 60, 62, 64, 65, 67, 69, 71, 72;
chromatic: C=60, C#=61, D=62, … B=71.

**Durations** — `{"numerator": int, "denominator": int}`: whole `1/1`, half `1/2`,
quarter `1/4`, eighth `1/8`, dotted quarter `3/8`.

## Troubleshooting

- **"Not connected to MuseScore"** — ensure MuseScore is running with a score open, the plugin
  is started (Plugins → MuseScore API Server), and port 8765 isn't firewalled. The client
  auto-reconnects if MuseScore was restarted.
- **Plugin not appearing** — confirm both files are in their own subfolder under the Plugins
  directory; restart MuseScore after placing them.
- **No console output** — launch MuseScore from a terminal (see above).
- **Deletions don't undo** — MuseScore's plugin `undo()` is unreliable for deleted
  measures/notes; use native **Ctrl+Z** in MuseScore instead.

## File structure

```
mcp-musescore/
├── server.py                       # Python MCP server entry point
├── musescore-mcp-websocket.qml     # MuseScore plugin: thin hot-reload shell
├── mcp-logic.js                    # MuseScore plugin: all command logic (hot-reloadable)
├── requirements.txt / requirements-dev.txt
├── tests/                          # pytest suite for the LilyPond converter
└── src/
    ├── client/websocket_client.py  # WebSocket client (auto-reconnecting)
    ├── tools/                      # MCP tool implementations
    ├── types/                      # action type definitions
    └── utils/lilypond_converter.py # MuseScore JSON → compact LilyPond
```

## Credits

- Original project: **[ghchen99/mcp-musescore](https://github.com/ghchen99/mcp-musescore)** by
  [@ghchen99](https://github.com/ghchen99) — the WebSocket-plugin concept and MCP server this
  fork is built on.
- Upstream lyric/title contributions by [@CariacouP](https://github.com/CariacouP).
- This fork: hot-reload architecture, compact/token-efficient LilyPond rendering, musical
  context, note-name input, connection robustness, and the test suite.

## License

See [LICENSE](LICENSE). This fork retains the original project's license.
