import logging
import re
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("LilyPondConverter")

# A bare whole-measure rest token: r1, r2, r2., r4 ... (no tuplet "*", no lyric).
# Runs of identical such measures collapse into multi-measure rests (R<dur>*N).
_PURE_REST_RE = re.compile(r"^r(\d+\.?)$")

# Note name -> semitone offset within an octave (C = 0).
_NOTE_BASE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def note_name_to_midi(name: str) -> int:
    """Convert a scientific-pitch note name like "C4", "Eb5", "F#3", "Gbb2"
    into a MIDI pitch integer (C4 = 60).

    Accepts ``#``/``s`` for sharp and ``b``/``-`` for flat (repeatable), e.g.
    "C#4", "Bb3", "Fx5"/"F##5" (double sharp), "Abb2" (double flat). Raises
    ValueError on anything it can't parse so the caller can report it cleanly.
    """
    if not isinstance(name, str):
        raise ValueError(f"Note name must be a string, got {type(name).__name__}")
    token = name.strip()
    # Note '-' is NOT an accidental here: it would collide with negative octaves
    # (e.g. "C-1" = MIDI 0). Use 'b'/'♭' for flats.
    m = re.match(r"^([A-Ga-g])([#sbx♯♭]*)(-?\d+)$", token)
    if not m:
        raise ValueError(f"Unrecognized note name: {name!r} (expected e.g. 'C4', 'Eb5', 'F#3')")
    letter, accidentals, octave_str = m.groups()
    semitone = _NOTE_BASE[letter.lower()]
    for ch in accidentals:
        if ch in ("#", "s", "♯"):
            semitone += 1
        elif ch == "x":  # double sharp
            semitone += 2
        elif ch in ("b", "♭"):
            semitone -= 1
        else:
            raise ValueError(f"Unrecognized accidental {ch!r} in note name {name!r}")
    octave = int(octave_str)
    midi = (octave + 1) * 12 + semitone
    if not 0 <= midi <= 127:
        raise ValueError(f"Note {name!r} is out of MIDI range (0-127): got {midi}")
    return midi


def _key_signature_to_lily(sharps: int) -> Optional[str]:
    """Map a MuseScore key signature (sharp count, negative = flats) to a
    LilyPond ``\\key`` directive, assuming a major key."""
    order = {
        0: "c", 1: "g", 2: "d", 3: "a", 4: "e", 5: "b", 6: "fis", 7: "cis",
        -1: "f", -2: "bes", -3: "es", -4: "as", -5: "des", -6: "ges", -7: "ces",
    }
    tonic = order.get(sharps)
    if tonic is None:
        return None
    return f"\\key {tonic} \\major"

def midi_to_lilypond_pitch(midi_pitch: int, tpc: Optional[int] = None) -> str:
    """
    Convert a MIDI pitch to LilyPond pitch syntax.
    If TPC (Tonal Pitch Class) is provided, uses it to determine enharmonic spelling (flats vs sharps).
    Example: 60 -> c', 67 -> g', 74 -> d''
    """
    try:
        # Fallback names if no TPC provided
        pitch_names = ['c', 'cis', 'd', 'dis', 'e', 'f', 'fis', 'g', 'gis', 'a', 'ais', 'b']
        
        if tpc is not None:
            # MuseScore TPC map (circle of fifths where 14 = C, 15 = G)
            tpc_map = {
                6: 'fes', 7: 'ces', 8: 'ges', 9: 'des', 10: 'as', 11: 'es', 12: 'bes', 13: 'f',
                14: 'c', 15: 'g', 16: 'd', 17: 'a', 18: 'e', 19: 'b', 20: 'fis',
                21: 'cis', 22: 'gis', 23: 'dis', 24: 'ais', 25: 'eis', 26: 'bis',
                27: 'fisis', 28: 'cisis', 29: 'gisis', 30: 'disis', 31: 'aisis', 32: 'eisis', 33: 'bisis',
                -1: 'feses', 0: 'ceses', 1: 'geses', 2: 'deses', 3: 'ases', 4: 'eses', 5: 'beses'
            }
            base_note = tpc_map.get(tpc, pitch_names[midi_pitch % 12])
        else:
            base_note = pitch_names[midi_pitch % 12]
            
        octave = (midi_pitch // 12) - 1
        
        # Mapping MIDI octaves to LilyPond octaves (C4 = MIDI 60 = c')
        if octave == 4:
            octave_mark = "'"
        elif octave == 5:
            octave_mark = "''"
        elif octave == 6:
            octave_mark = "'''"
        elif octave == 7:
            octave_mark = "''''"
        elif octave == 3:
            octave_mark = ""
        elif octave == 2:
            octave_mark = ","
        elif octave == 1:
            octave_mark = ",,"
        elif octave == 0:
            octave_mark = ",,,"
        else:
            octave_mark = ""  # Fallback for out-of-bounds
            
        return f"{base_note}{octave_mark}"
    except Exception as e:
        logger.error(f"Error converting MIDI pitch {midi_pitch}: {e}")
        return "c'"  # Safe fallback

def ticks_to_lilypond_duration(ticks: int) -> str:
    """
    Convert MuseScore ticks to LilyPond rhythmic duration.
    MuseScore defines a quarter note as 480 ticks.
    """
    try:
        mapping = {
            1920: "1",    # Whole note
            1440: "2.",   # Dotted half note
            960: "2",     # Half note
            720: "4.",    # Dotted quarter note
            480: "4",     # Quarter note
            360: "8.",    # Dotted eighth note
            320: "2*2/3", # Half triplet
            240: "8",     # Eighth note
            180: "16.",   # Dotted 16th note
            160: "4*2/3", # Quarter triplet
            120: "16",    # 16th note
            80: "8*2/3",  # Eighth triplet
            60: "32",     # 32nd note
            30: "64"      # 64th note
        }
        return mapping.get(ticks, "4")  # Default to quarter note if not mapped
    except Exception as e:
        logger.error(f"Error converting ticks {ticks}: {e}")
        return "4"

def ticks_to_spacers(ticks: int) -> List[str]:
    """
    Greedily consume temporal gap into valid Lilypond spacer rests.
    """
    if ticks <= 0:
        return []
    
    spacers = []
    # Using standard valid LilyPond rhythm sizes sorted by size descending
    mapping = [
        (1920, "1"), (1440, "2."), (960, "2"), (720, "4."), 
        (480, "4"), (360, "8."), (240, "8"), (180, "16."), 
        (120, "16"), (60, "32"), (30, "64")
    ]
    
    remaining = ticks
    for tick_val, duration_str in mapping:
        while remaining >= tick_val:
            spacers.append(f"s{duration_str}")
            remaining -= tick_val
            
    if remaining > 0:
        logger.warning(f"Could not cleanly pad ticks, remainder {remaining} ignored.")
        
    return spacers

def process_element(element: Dict[str, Any]) -> str:
    """
    Process a single JSON element dictionary into LilyPond syntax.
    Handles 'Chord' (with notes) and 'Rest'.
    """
    try:
        elem_name = element.get("name", "")
        duration_ticks = element.get("durationTicks", 480)
        lily_duration = ticks_to_lilypond_duration(duration_ticks)

        if elem_name == "Rest":
            return f"r{lily_duration}"
        
        elif elem_name == "Chord":
            notes = element.get("notes", [])
            lyrics_data = element.get("lyrics", [])
            lyric_str = ""
            if lyrics_data:
                texts = [lyr.get("text", "") for lyr in lyrics_data if lyr.get("text")]
                if texts:
                    # Sanitize quotes
                    safe_texts = "-".join(texts).replace('"', "'")
                    lyric_str = f'^"{safe_texts}"'

            if not notes:
                return f"r{lily_duration}{lyric_str}"
            
            lily_notes = []
            for note in notes:
                pitch = note.get("pitchMidi")
                tpc = note.get("tpc")
                if pitch is not None:
                    lily_notes.append(midi_to_lilypond_pitch(pitch, tpc))
            
            if not lily_notes:
                return f"r{lily_duration}{lyric_str}"
            elif len(lily_notes) == 1:
                return f"{lily_notes[0]}{lily_duration}{lyric_str}"
            else:
                joined_notes = " ".join(lily_notes)
                return f"<{joined_notes}>{lily_duration}{lyric_str}"
        else:
            return ""  # Ignore other elements without crashing
    except Exception as e:
        logger.error(f"Error parsing element: {e}")
        return ""

def _render_voice_tokens(elements: List[Dict[str, Any]], region_start: int) -> List[str]:
    """Render one voice's temporally-sorted elements into LilyPond tokens,
    filling any leading/internal gaps with spacer rests."""
    tokens: List[str] = []
    elements = sorted(elements, key=lambda x: x.get("startTick", 0))
    current_tick = region_start
    for e in elements:
        e_tick = e.get("startTick")
        if e_tick is not None and e_tick > current_tick:
            tokens.extend(ticks_to_spacers(e_tick - current_tick))
            current_tick = e_tick
        processed = process_element(e)
        if processed:
            tokens.append(processed)
        duration = e.get("durationTicks", 480)
        current_tick = (e_tick if e_tick is not None else current_tick) + duration
    return tokens


def _normalize_to_measures(score_data: Dict[str, Any]):
    """Normalize any plugin response shape into (staff_names, measures), where
    each measure is {startTick, elements: {staffN: [elem, ...]}}.

    Handles three shapes:
      * getScore analysis: {staves, measures:[{startTick, elements:{...}}]}
      * range selection:   {startStaff, startTick, elements:{staffN:[...]}}
      * single selection:  {startStaff, startTick, elements:[elem, ...]}
    """
    # getScore analysis
    if "measures" in score_data and isinstance(score_data["measures"], list):
        measures = sorted(score_data["measures"], key=lambda m: m.get("startTick", 0))
        staves_info = score_data.get("staves", [])
        staff_names = [st.get("name") for st in staves_info if st.get("visible", True)]
        if not staff_names:
            keys = set()
            for m in measures:
                keys.update(m.get("elements", {}).keys())
            staff_names = sorted(keys, key=lambda x: int(x.replace("staff", "") or 0))
        return staff_names, measures

    # selection shapes -> a single pseudo-measure
    start_tick = score_data.get("startTick", 0)
    elements = score_data.get("elements", {})
    if isinstance(elements, list):
        by_staff: Dict[str, List[Dict[str, Any]]] = {}
        for elem in elements:
            s_idx = elem.get("staff", score_data.get("startStaff", 0))
            by_staff.setdefault(f"staff{s_idx}", []).append(elem)
    elif isinstance(elements, dict):
        by_staff = elements
    else:
        by_staff = {}

    staff_names = sorted(by_staff.keys(), key=lambda x: int(x.replace("staff", "") or 0))
    measures = [{"startTick": start_tick, "elements": by_staff}]
    return staff_names, measures


def _measure_content_span(measure: Dict[str, Any]) -> int:
    """Largest (startTick + durationTicks) - measureStart over all elements in a
    measure, i.e. how far its content reaches. 0 if the measure has no elements."""
    start = measure.get("startTick", 0)
    span = 0
    for elems in measure.get("elements", {}).values():
        for e in elems:
            e_tick = e.get("startTick", start)
            end = e_tick + e.get("durationTicks", 0)
            span = max(span, end - start)
    return span


def _measure_length_map(measures: List[Dict[str, Any]]) -> Dict[int, Optional[int]]:
    """Map each measure's startTick to its tick length (next.startTick - start).
    The final measure has no following boundary, so its length is inferred from
    its own content, falling back to the previous measure's length."""
    lengths: Dict[int, Optional[int]] = {}
    prev_len: Optional[int] = None
    for idx, m in enumerate(measures):
        start = m.get("startTick", 0)
        if idx + 1 < len(measures):
            length = measures[idx + 1].get("startTick", 0) - start
        else:
            length = _measure_content_span(m) or prev_len
        lengths[start] = length
        if length:
            prev_len = length
    return lengths


def _time_signature_tokens(measures: List[Dict[str, Any]]) -> Dict[int, str]:
    """Build a {measure_index: '\\time n/d'} map carrying the initial time
    signature and any later changes (only where the signature actually changes)."""
    tokens: Dict[int, str] = {}
    prev: Optional[Tuple[int, int]] = None
    for idx, m in enumerate(measures):
        ts = m.get("timeSig")
        if not ts:
            continue
        cur = (ts.get("numerator"), ts.get("denominator"))
        if None in cur:
            continue
        if cur != prev:
            tokens[idx] = f"\\time {cur[0]}/{cur[1]}"
            prev = cur
    return tokens


def _collapse_rest_runs(chunks: List[List[str]], multi_measure: bool) -> List[str]:
    """Join per-measure token lists with ``|`` bar checks, collapsing runs of
    identical whole-measure rests into a single ``R<dur>*<count>``."""
    units: List[List[str]] = []
    i, n = 0, len(chunks)
    while i < n:
        chunk = chunks[i]
        rest_match = _PURE_REST_RE.match(chunk[0]) if len(chunk) == 1 else None
        if rest_match:
            j = i + 1
            while j < n and chunks[j] == chunk:
                j += 1
            count = j - i
            units.append([f"R{rest_match.group(1)}*{count}"] if count >= 2 else list(chunk))
            i = j
        else:
            units.append(list(chunk))
            i += 1

    tokens: List[str] = []
    for k, unit in enumerate(units):
        tokens.extend(unit)
        if multi_measure and k < len(units) - 1:
            tokens.append("|")
    return tokens


def _section_marker_comments(measures: List[Dict[str, Any]]) -> List[str]:
    """Render section labels / rehearsal marks / staff cues (segment
    annotations) as LilyPond comment lines, e.g. ``% m9 [RehearsalMark]: B``.
    Comments keep them visible to the model without disturbing the music tree."""
    lines: List[str] = []
    for m in measures:
        markers = m.get("markers")
        if not markers:
            continue
        loc = f"m{m['measure']}" if m.get("measure") is not None else f"tick{m.get('startTick', 0)}"
        for mk in markers:
            text = (mk.get("text") or "").strip()
            if not text:
                continue
            lines.append(f"% {loc} [{mk.get('type', 'Text')}]: {text}")
    return lines


def json_to_lilypond(score_data: Dict[str, Any]) -> str:
    """Convert any MuseScore plugin response (full score or selection) into a
    compact LilyPond tree. The whole score is rendered, one continuous line per
    staff/voice, with ``|`` bar checks between measures.

    When the payload carries musical context (``keySig``/``tempo`` and per-measure
    ``timeSig``) it is rendered as ``\\key``/``\\tempo``/``\\time`` directives so the
    model can see what it is writing against."""
    try:
        staff_names, measures = _normalize_to_measures(score_data)
        voice_commands = {0: "\\voiceOne", 1: "\\voiceTwo", 2: "\\voiceThree", 3: "\\voiceFour"}
        multi_measure = len(measures) > 1
        measure_lengths = _measure_length_map(measures)
        time_tokens = _time_signature_tokens(measures)

        # Score-level header directives (key / tempo), prepended to each staff.
        header_tokens: List[str] = []
        key_sig = score_data.get("keySig")
        if isinstance(key_sig, int):
            key_directive = _key_signature_to_lily(key_sig)
            if key_directive:
                header_tokens.append(key_directive)
        tempo = score_data.get("tempo")
        if isinstance(tempo, (int, float)) and tempo > 0:
            header_tokens.append(f"\\tempo 4 = {int(round(tempo))}")

        def build_chunks(staff: str, voice: int) -> List[List[str]]:
            """One token list per measure for a single voice, with time-signature
            changes injected and absent measures padded with a full-measure skip."""
            chunks: List[List[str]] = []
            for idx, m in enumerate(measures):
                m_start = m.get("startTick", 0)
                v_elems = [e for e in m.get("elements", {}).get(staff, [])
                           if e.get("voice", 0) == voice]
                chunk: List[str] = []
                if idx in time_tokens:
                    chunk.append(time_tokens[idx])
                if v_elems:
                    chunk.extend(_render_voice_tokens(v_elems, m_start))
                else:
                    # Absent voice in this measure: hold its place with a
                    # full-measure spacer instead of leaving bare bar checks.
                    m_len = measure_lengths.get(m_start)
                    if m_len:
                        chunk.extend(ticks_to_spacers(m_len))
                chunks.append(chunk)
            return chunks

        lily_parts = list(_section_marker_comments(measures))
        lily_parts.append("<<")
        for staff in staff_names:
            voices_present = set()
            for m in measures:
                for e in m.get("elements", {}).get(staff, []):
                    voices_present.add(e.get("voice", 0))
            if not voices_present:
                continue

            sorted_voices = sorted(voices_present)
            if len(sorted_voices) == 1:
                chunks = build_chunks(staff, sorted_voices[0])
                if header_tokens:
                    chunks[0] = header_tokens + chunks[0]
                tokens = _collapse_rest_runs(chunks, multi_measure)
                lily_parts.append(f"  \\new Staff {{ {' '.join(tokens)} }}")
            else:
                lily_parts.append("  \\new Staff {")
                lily_parts.append("    <<")
                voice_strings = []
                for vi, v in enumerate(sorted_voices):
                    cmd = voice_commands.get(v, "\\voiceOne")
                    chunks = build_chunks(staff, v)
                    # Header on the first voice only (key/tempo are score-level).
                    if vi == 0 and header_tokens:
                        chunks[0] = header_tokens + chunks[0]
                    tokens = _collapse_rest_runs(chunks, multi_measure)
                    voice_strings.append(f"      \\new Voice {{ {cmd} {' '.join(tokens)} }}")
                lily_parts.append(" \\\\\n".join(voice_strings))
                lily_parts.append("    >>")
                lily_parts.append("  }")

        lily_parts.append(">>")
        return "\n".join(lily_parts)

    except Exception as e:
        logger.error(f"Failed to convert JSON to LilyPond: {e}")
        return "<< >>"
