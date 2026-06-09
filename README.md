# MuseScore MCP Server

A Model Context Protocol (MCP) server that provides programmatic control over MuseScore, via a WebSocket-based plugin system. This allows AI assistants like Claude to compose music, add lyrics, navigate scores, and control MuseScore directly.

![Demo GIF](./assets/mcp-muse.gif)

## Prerequisites

- MuseScore 4.x
- Python 3.8+
- Claude Desktop or compatible MCP client

## Architecture & Hot-Reload

The plugin is split into two files so logic can be updated **without restarting MuseScore**:

- **`musescore-mcp-websocket.qml`** — a thin, stable *shell*. It runs the WebSocket server
  and, on every request, reads `mcp-logic.js` and `eval()`s it. You only ever load this
  file from the Plugin Manager **once**.
- **`mcp-logic.js`** — all the command logic. Edit this file and the change takes effect on
  the very next command — no MuseScore restart, no Plugin Manager clicks. You can also force
  a recompile with the `reload_plugin()` MCP tool.

Both files must live **in the same folder** (the MuseScore Plugins directory).

## Setup

### 1. Install the MuseScore Plugin

**MuseScore 4 requires every plugin to live in its own subfolder** — a loose `.qml` in the
Plugins root is *not* detected. Create a `musescore-mcp/` subfolder and put **both** files in
it (keep them together; `mcp-logic.js` must sit next to the `.qml`):

```
<Plugins>/musescore-mcp/musescore-mcp-websocket.qml
<Plugins>/musescore-mcp/mcp-logic.js
```

Where `<Plugins>` is:

**macOS**: `~/Documents/MuseScore4/Plugins/`
**Windows**: `%USERPROFILE%\Documents\MuseScore4\Plugins\`
**Linux**: `~/Documents/MuseScore4/Plugins/`

### 2. Enable the Plugin in MuseScore

1. Open MuseScore
2. Go to **Plugins → Plugin Manager**
3. Find "MuseScore API Server" and check the box to enable it
4. Click **OK**

### 3. Setup Python Environment

```bash
git clone <your-repo>
cd mcp-agents-demo
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Configure Claude Desktop

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "musescore": {
      "command": "/path/to/your/project/.venv/bin/python",
      "args": [
        "/path/to/your/project/server.py"
      ]
    }
  }
}
```

**Note**: Update the paths to match your actual project location.

## Running the System

### Order of Operations

1. **Start MuseScore first** with a score open
2. **Run the MuseScore plugin**: Go to **Plugins → MuseScore API Server**
   - You should see console output: `"Starting MuseScore API Server on port 8765"`
3. **Then start the Python MCP server** or restart Claude Desktop

[insert screenshot of different functionality, harmonisation, melodywriting, as zoomed in GIFs]

### Development and Testing

For development, use the MCP development tools:

```bash
# Install MCP dev tools
pip install mcp

# Test your server
mcp dev server.py

# Check connection status
mcp dev server.py --inspect
```

### Viewing Console Output

To see MuseScore plugin console output, run MuseScore from terminal:

**macOS**:
```bash
/Applications/MuseScore\ 4.app/Contents/MacOS/mscore
```

**Windows**:
```cmd
cd "C:\Program Files\MuseScore 4\bin"
MuseScore.exe
```

**Linux**:
```bash
musescore4
```

## Features

This MCP server provides comprehensive MuseScore control. 

**🌟 NEW in this fork:** Built-in automatic, flawless multi-voice Polyphony & Temporal layout mapping to LilyPond!

### **Navigation & Cursor Control**
- `get_cursor_info()` - Get current cursor position and selection info
- `go_to_measure(measure)` - Navigate to specific measure
- `go_to_beginning_of_score()` / `go_to_final_measure()` - Navigate to start/end
- `next_element()` / `prev_element()` - Move cursor element by element
- `next_staff()` / `prev_staff()` - Move between staves
- `select_current_measure()` - Select entire current measure
- `select_custom_range(start_tick, end_tick, start_staff, end_staff)` - Slicing tool to extract cross-measure, multi-staff phrasing

### **Polyphony & LilyPond Integration**
- **Temporal Rhythm Padding**: Voices with gaps or rests automatically receive LilyPond spacer sequences (`s4.`) to hold their mathematical place accurately.
- **Concurrent Voice Rendering**: Full 4-voice (`\voiceOne`, `\voiceTwo`, etc.) arrays correctly structured and sharded per staff for advanced Agent processing.

### **Note & Rest Creation**
- `add_note(pitch, duration, advance_cursor_after_action)` - Add notes by MIDI pitch (e.g. `60`) **or** scientific note name (e.g. `"C4"`, `"Eb5"`, `"F#3"`)
- `add_rest(duration, advance_cursor_after_action)` - Add rests
- `add_tuplet(duration, ratio, advance_cursor_after_action)` - Add tuplets (triplets, etc.)

### **Measure Management**
- `insert_measure()` - Insert measure at current position
- `append_measure(count)` - Add measures to end of score
- `delete_selection(measure)` - Delete current selection or specific measure

### **Lyrics & Text**
- `add_lyrics(lyrics_list, verse=0)` - Add lyric syllables to consecutive notes from the cursor

### **Score Information**
- `get_score(start_measure=None, end_measure=None)` - Read the **whole** score as compact
  LilyPond (with a one-line header showing title, measure/staff counts, time signature and
  tempo, plus `\key`/`\time`/`\tempo` directives in the LilyPond itself). Pass a measure range
  to fetch only a slice of a large score and save tokens.
- `ping_musescore()` - Test connection to MuseScore (the client also auto-connects on every call)
- `reload_plugin()` - Hot-reload `mcp-logic.js` without restarting MuseScore

### **Utilities**
- `undo()` - Undo last action *(note: unreliable for deleted measures — prefer MuseScore's
  native Ctrl+Z there)*
- `set_time_signature(numerator, denominator)` - Change time signature
- `set_tempo(bpm)` - Add a quarter-note BPM tempo marking at the cursor
- `processSequence(sequence)` - Execute multiple commands in batch

## Sample Music

Check out the `/examples` folder for sample MuseScore files demonstrating various musical styles:

- **Asian Instrumental** - Traditional Asian-inspired instrumental piece
- **String Quartet** - Classical string quartet arrangement

Each example includes:
- `.mscz` - MuseScore file (editable)
- `.pdf` - Sheet music
- `.mp3` - Audio preview

## Usage Examples

### Creating a Simple Melody

```python
# Set up the score
await go_to_beginning_of_score()

# Add notes — pass a MIDI pitch (60=C, 64=E, ...) or a note name ("C4", "E4", ...)
await add_note("C4", {"numerator": 1, "denominator": 4}, True)  # Quarter note C
await add_note("E4", {"numerator": 1, "denominator": 4}, True)  # Quarter note E
await add_note(67,   {"numerator": 1, "denominator": 4}, True)  # Quarter note G
await add_note("C5", {"numerator": 1, "denominator": 2}, True)  # Half note C

# Add lyrics to the notes just written (one syllable per note from the cursor)
await go_to_beginning_of_score()
await add_lyrics(["Do", "Mi", "Sol", "Do"])
```
### Batch Operations

```python
# Add multiple lyrics at once
await add_lyrics(["Twin-", "kle", "twin-", "kle", "lit-", "tle", "star"])

# Use sequence processing for complex operations
sequence = [
    {"action": "goToBeginningOfScore", "params": {}},
    {"action": "addNote", "params": {"pitch": 60, "duration": {"numerator": 1, "denominator": 4}, "advanceCursorAfterAction": True}},
    {"action": "addNote", "params": {"pitch": 64, "duration": {"numerator": 1, "denominator": 4}, "advanceCursorAfterAction": True}},
    {"action": "addRest", "params": {"duration": {"numerator": 1, "denominator": 4}, "advanceCursorAfterAction": True}}
]
await processSequence(sequence)
```

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=ghchen99/mcp-musescore&type=date&legend=top-left)](https://www.star-history.com/?repos=ghchen99%2Fmcp-musescore&type=date&legend=top-left)

## Troubleshooting

### Connection Issues
- **"Not connected to MuseScore"**: 
  - Ensure MuseScore is running with a score open
  - Run the MuseScore plugin (Plugins → MuseScore API Server)
  - Check that port 8765 isn't blocked by firewall

### Plugin Issues
- **Plugin not appearing**: Check the `.qml` file is in the correct plugins directory
- **Plugin won't enable**: Restart MuseScore after placing the plugin file
- **No console output**: Run MuseScore from terminal to see debug messages

### Python Server Issues
- **"No server object found"**: The server object must be named `mcp`, `server`, or `app` at module level
- **WebSocket errors**: Make sure MuseScore plugin is running before starting Python server
- **Connection timeout**: The MuseScore plugin must be actively running, not just enabled

### API Limitations
- **Deletions & undo**: MuseScore's plugin `undo()` is unreliable for deleted measures/notes —
  `delete_selection()` and `undo()` return a warning; prefer MuseScore's native Ctrl+Z there
- **Selection persistence**: Some operations may affect current selection

## File Structure

```
mcp-agents-demo/
├── .venv/
├── server.py                           # Python MCP server entry point
├── musescore-mcp-websocket.qml         # MuseScore plugin: thin hot-reload shell
├── mcp-logic.js                        # MuseScore plugin: all command logic (hot-reloadable)
├── requirements.txt
├── README.md
└── src/                                # Source code modules
    ├── __init__.py
    ├── client/                         # WebSocket client functionality
    │   ├── __init__.py
    │   └── websocket_client.py
    ├── tools/                          # MCP tool implementations
    │   ├── __init__.py
    │   ├── connection.py               # Connection management tools
    │   ├── navigation.py               # Score navigation tools
    │   ├── notes_measures.py           # Note and measure manipulation
    │   ├── sequences.py                # Batch operation tools
    │   ├── staff_instruments.py        # Staff and instrument tools
    │   └── time_tempo.py               # Timing and tempo tools
    └── types/                          # Type definitions
        ├── __init__.py
        └── action_types.py             # WebSocket action type definitions
```

## MIDI Pitch Reference

Common MIDI pitch values for reference:
- **Middle C**: 60
- **C Major Scale**: 60, 62, 64, 65, 67, 69, 71, 72
- **Chromatic**: C=60, C#=61, D=62, D#=63, E=64, F=65, F#=66, G=67, G#=68, A=69, A#=70, B=71

## Duration Reference

Duration format: `{"numerator": int, "denominator": int}`
- **Whole note**: `{"numerator": 1, "denominator": 1}`
- **Half note**: `{"numerator": 1, "denominator": 2}`
- **Quarter note**: `{"numerator": 1, "denominator": 4}`
- **Eighth note**: `{"numerator": 1, "denominator": 8}`
- **Dotted quarter**: `{"numerator": 3, "denominator": 8}`
