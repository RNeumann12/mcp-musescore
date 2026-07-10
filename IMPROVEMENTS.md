# MuseScore MCP improvement plan

This plan is based on an audit of the Python MCP server, WebSocket client, QML
shell, JavaScript dispatcher, public tool schemas, README, and automated tests.
The goal is not merely to add many tools: connected agents need a bridge that is
observable, safe to retry, complete enough for real score work, and precise
enough to verify what changed.

## Current strengths

- Compact LilyPond score reads are token-efficient and include musical context.
- The WebSocket reconnects after MuseScore or the plugin restarts.
- Plugin logic hot-reloads without restarting MuseScore.
- Note names, multi-voice reads, markers, chord symbols, diagnosis, slides, and
  fretted-instrument metadata already cover useful composition workflows.
- Mutations use MuseScore command groups, and the bridge warns about unreliable
  deletion undo behavior.

## Started in this pass

- [x] Bound connection attempts and command waits so an agent cannot hang forever.
- [x] Do not automatically retry a timed-out mutation: it may already have applied.
- [x] Retry transport failures only for explicitly safe read-only actions; report
  uncertain delivery for edits instead of risking duplicate notes or measures.
- [x] Enforce a configurable maximum WebSocket response size.
- [x] Return structured error codes, retryability, and recovery context while
  retaining the existing `error` string for compatibility.
- [x] Move host, port, timeouts, and response limit to validated environment
  configuration.
- [x] Add `get_mcp_status` to distinguish MCP configuration from live plugin state.
- [x] Add MCP server instructions that describe indexing, verification, batching,
  and timeout uncertainty to every connected agent.
- [x] Add MCP read-only/destructive/idempotency annotations.
- [x] Expose plugin features that agents could not previously call:
  `get_fingering`, `set_note_string`, `move_note_string`, and
  `remove_notes_at_tick`.
- [x] Add a consistent `process_sequence` name while retaining `processSequence`.
- [x] Preflight the structure of action batches before any edit is sent.
- [x] Add offline tests for configuration, transport failures, tool registration,
  and safety annotations.

Configuration variables introduced here:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `MUSESCORE_MCP_HOST` | `localhost` | Plugin WebSocket host |
| `MUSESCORE_MCP_PORT` | `8765` | Plugin WebSocket port |
| `MUSESCORE_MCP_CONNECT_TIMEOUT` | `5` | Connection deadline in seconds |
| `MUSESCORE_MCP_COMMAND_TIMEOUT` | `30` | Reply deadline in seconds |
| `MUSESCORE_MCP_MAX_RESPONSE_BYTES` | `8388608` | Maximum reply size |

## Priority 0 — trustworthy editing

These are prerequisites for autonomous multi-step work.

### Versioned, correlated protocol

- Add a protocol version, request ID, plugin version, MuseScore version, and score
  identity/revision to every command and reply.
- Add a `get_capabilities` handshake generated from the plugin dispatcher rather
  than maintaining a second hand-written action list.
- Reject incompatible MCP/plugin versions with an actionable error.
- Echo request IDs so delayed or out-of-order replies can never be attributed to
  the wrong command.

Acceptance: the client detects version mismatch before editing and every log/error
can identify one command without exposing its full musical content.

### Atomic batches and optimistic concurrency

- Make `process_sequence` one MuseScore undo transaction with `stop_on_error` and
  rollback on failure.
- Add `dry_run`, `expected_score_revision`, and optional per-step preconditions.
- Return every step result, not only failures, plus the final score revision.
- Add idempotency keys for commands that are safe to deduplicate.

Acceptance: a failed atomic batch leaves the score byte-for-byte unchanged; an
agent editing a stale score receives a conflict rather than overwriting user work.

### Uniform validation and error taxonomy

- Validate positive durations, supported denominators, MIDI range, tick/range
  bounds, measure/staff/voice indexes, tempo, text length, and sequence limits in
  Python before crossing the WebSocket.
- Mirror critical validation in JavaScript because the plugin may be called
  directly.
- Standardize codes such as `no_score`, `invalid_argument`, `not_found`,
  `conflict`, `unsupported`, `connection_lost`, and `internal_error`.
- Include `action`, safe parameter details, and suggested recovery in failures.

Acceptance: invalid input never partially edits a score and errors do not require
parsing English text.

### Connection security and ownership

- Confirm whether MuseScore's WebSocket API binds only to loopback on every
  platform. If not, restrict it to loopback.
- Add an optional shared session token/handshake and reject unknown clients when
  enabled.
- Define one active editor lease or serialize multiple MCP clients explicitly;
  surface the current score and client ownership in status.
- Rate-limit commands and cap request size in the QML shell.

Acceptance: another machine or local web page cannot silently edit a score, and
two agents cannot interleave cursor-dependent operations unknowingly.

This item needs a compatibility decision before implementation: whether secure
handshake mode should be opt-in initially or required by default.

## Priority 1 — complete score workflows

### Score and file lifecycle

Add explicit tools for:

- new score from template/instruments, open, close, save, and save-as;
- export PDF, MusicXML, MIDI, audio, and individual parts;
- score metadata (title, subtitle, composer, lyricist, copyright);
- list open scores and select the active score without relying on UI focus.

File tools must use allowlisted roots, canonical paths, overwrite flags, and
clear user confirmation semantics. Arbitrary filesystem access should not be a
side effect of a score tool.

### Addressable, cursor-independent editing

Cursor state is convenient for humans but fragile for agents. Add stable location
objects such as `{measure, beat, staff, voice, pitch}` and return element IDs when
MuseScore can support them. Then add:

- read element/range as structured JSON as well as LilyPond;
- insert, replace, transpose, copy, move, and delete by location/range;
- set pitch, duration, spelling, voice, velocity, visibility, and color;
- find elements by type/text/pitch/range;
- selection bookmarks or named anchors.

Acceptance: every edit can be expressed without first moving a shared cursor and
can be verified by reading the same address.

### Notation coverage

Add typed tools for the notation agents routinely need:

- key signatures, clefs, transposition, pickup measures, local time signatures;
- ties, slurs, articulations, ornaments, fermatas, breath marks, grace notes;
- dynamics, hairpins, expressions, technique text, fingering, figured bass;
- beams, tremolos, tuplets with contents, cross-staff notation, multiple voices;
- repeats, voltas, jumps, markers, barlines, measure numbers;
- guitar bends, palm mute, let-ring, harmonics, vibrato, and capo changes;
- drum pitches/sticking and percussion mappings;
- layout breaks, spacers, staff/part visibility, brackets, and system formatting.

Each write feature should also be readable through `get_score` or structured
inspection; write-only notation cannot be reliably verified by an agent.

### Instrument, part, and playback control

- List valid MuseScore instrument IDs before `add_instrument` is called.
- Rename/reorder/remove staves and parts; configure transposition, tuning, capo,
  channels, program, volume, pan, solo, and mute.
- Add playback position, play/pause/stop, loop range, tempo multiplier, and
  synthesizer/render status where the plugin API supports them.

## Priority 2 — efficient observation and quality

### Scalable reads

- Add pagination and filters for staff, voice, element type, changed-since
  revision, and summary/detail level.
- Return exact measure boundaries and rational beat positions so clients never
  assume 480 ticks per quarter or 4/4.
- Add score fingerprints and compact diffs after edits.
- Provide resources for large immutable exports rather than forcing them through
  one tool result when the MCP SDK/client supports it.

### Musical validation

Extend `diagnose_score` with configurable checks for parallel octaves/fifths,
voice crossing, impossible leaps, chord-range/stretch, lyric alignment, empty
parts, collision/layout warnings, invalid repeats, and unplayable techniques.
Distinguish objective engraving errors from optional style checks.

### Observability

- Structured stderr logs with request ID, action, duration, result code, score
  revision, and response size; never log lyrics or score contents at INFO.
- Counters for reconnects, timeouts, command latency, failures, and loaded logic
  version in `get_mcp_status`.
- Optional recent-event ring buffer and a redacted diagnostic bundle.

## Engineering plan

1. Define protocol v1 and golden request/reply fixtures.
2. Add a fake WebSocket plugin and contract-test every Python tool/action mapping.
3. Split `mcp-logic.js` by domain or generate its dispatcher/capability manifest so
   Python schemas and JavaScript actions cannot drift.
4. Add JavaScript unit tests for pure validation/addressing helpers.
5. Build disposable-score integration fixtures in MuseScore for mutation tests.
6. Run a capability matrix in CI against supported Python, MCP SDK, websockets,
   operating-system, and MuseScore versions.
7. Add end-to-end tests that create, edit, diagnose, export, undo, and reopen a
   score, with visual/export checks for notation that the scripting API cannot
   introspect reliably.

## Definition of “agent-complete”

The MCP is ready for unattended score work when an agent can discover supported
features, select or create a score, address edits without UI focus, batch them
atomically, detect concurrent changes, verify all written notation, save/export
the result, and recover from connection failures without duplicating edits. Any
MuseScore API limitation should return `unsupported` with a documented manual or
file-format fallback rather than silently opening a dialog or claiming success.
