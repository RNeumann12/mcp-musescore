"""Unit tests for the pure LilyPond converter (no MuseScore required)."""

import pytest

from src.utils.lilypond_converter import (
    note_name_to_midi,
    midi_to_lilypond_pitch,
    ticks_to_lilypond_duration,
    ticks_to_spacers,
    json_to_lilypond,
    _key_signature_to_lily,
)


# --------------------------------------------------------------------------- #
# note_name_to_midi
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("name,expected", [
    ("C4", 60),       # middle C
    ("c4", 60),       # case-insensitive
    ("C-1", 0),       # lowest MIDI
    ("G9", 127),      # highest MIDI
    ("A4", 69),       # tuning reference
    ("Eb5", 75),
    ("D#5", 75),      # enharmonic of Eb5
    ("F#3", 54),
    ("Gb3", 54),      # enharmonic of F#3
    ("Bbb3", 57),     # double flat
    ("Fx4", 67),      # double sharp (F## = G)
    ("F##4", 67),
])
def test_note_name_to_midi_valid(name, expected):
    assert note_name_to_midi(name) == expected


@pytest.mark.parametrize("bad", ["H4", "C", "4", "C#", "", "Cq4", "C99", "C-2"])
def test_note_name_to_midi_invalid(bad):
    with pytest.raises(ValueError):
        note_name_to_midi(bad)


def test_note_name_to_midi_non_string():
    with pytest.raises(ValueError):
        note_name_to_midi(60)  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# pitch / duration primitives
# --------------------------------------------------------------------------- #

def test_midi_to_lilypond_pitch_octaves():
    assert midi_to_lilypond_pitch(60) == "c'"
    assert midi_to_lilypond_pitch(72) == "c''"
    assert midi_to_lilypond_pitch(48) == "c"


def test_midi_to_lilypond_pitch_uses_tpc_for_spelling():
    # MIDI 61 spelled as C# (tpc 21) vs Db (tpc 9)
    assert midi_to_lilypond_pitch(61, 21) == "cis'"
    assert midi_to_lilypond_pitch(61, 9) == "des'"


def test_ticks_to_duration():
    assert ticks_to_lilypond_duration(1920) == "1"
    assert ticks_to_lilypond_duration(480) == "4"
    assert ticks_to_lilypond_duration(720) == "4."


def test_ticks_to_spacers_whole_measure():
    assert ticks_to_spacers(1920) == ["s1"]
    assert ticks_to_spacers(0) == []


def test_key_signature_mapping():
    assert _key_signature_to_lily(0) == "\\key c \\major"
    assert _key_signature_to_lily(2) == "\\key d \\major"
    assert _key_signature_to_lily(-3) == "\\key es \\major"
    assert _key_signature_to_lily(99) is None


# --------------------------------------------------------------------------- #
# json_to_lilypond helpers
# --------------------------------------------------------------------------- #

def _chord(pitch, ticks, tick, voice=0, tpc=None):
    note = {"pitchMidi": pitch}
    if tpc is not None:
        note["tpc"] = tpc
    return {"name": "Chord", "durationTicks": ticks, "startTick": tick,
            "voice": voice, "notes": [note]}


def _rest(ticks, tick, voice=0):
    return {"name": "Rest", "durationTicks": ticks, "startTick": tick, "voice": voice}


def _measure(idx, start, elements, timesig=None):
    m = {"measure": idx, "startTick": start, "elements": elements}
    if timesig:
        m["timeSig"] = {"numerator": timesig[0], "denominator": timesig[1]}
    return m


def test_single_voice_melody():
    data = {
        "staves": [{"name": "staff0", "visible": True}],
        "measures": [
            _measure(1, 0, {"staff0": [_chord(60, 480, 0), _chord(62, 480, 480),
                                       _chord(64, 480, 960), _chord(65, 480, 1440)]}),
        ],
    }
    out = json_to_lilypond(data)
    assert "c'4 d'4 e'4 f'4" in out
    assert out.startswith("<<")


def test_repeated_rests_collapse():
    """28 empty (whole-measure rest) measures should collapse to R1*28."""
    measures = []
    for i in range(28):
        start = i * 1920
        measures.append(_measure(i + 1, start, {"staff0": [_rest(1920, start)]}))
    data = {"staves": [{"name": "staff0", "visible": True}], "measures": measures}
    out = json_to_lilypond(data)
    assert "R1*28" in out
    # Should NOT contain 28 separate bar-checked rests.
    assert out.count("r1") == 0


def test_two_rest_runs_collapse_separately():
    # measure 1: rest, measure 2: note, measure 3+4: rests -> R1 (single) and R1*2
    measures = [
        _measure(1, 0, {"staff0": [_rest(1920, 0)]}),
        _measure(2, 1920, {"staff0": [_chord(60, 1920, 1920)]}),
        _measure(3, 3840, {"staff0": [_rest(1920, 3840)]}),
        _measure(4, 5760, {"staff0": [_rest(1920, 5760)]}),
    ]
    data = {"staves": [{"name": "staff0", "visible": True}], "measures": measures}
    out = json_to_lilypond(data)
    assert "R1*2" in out      # the trailing run of two
    assert "c'1" in out       # MIDI 60 = c'


def test_multi_voice_empty_measure_gets_spacer():
    """A voice absent in a measure is padded with a full-measure skip, not a
    bare bar check."""
    measures = [
        _measure(1, 0, {"staff0": [_chord(60, 1920, 0, voice=0),
                                   _chord(67, 1920, 0, voice=1)]}),
        # voice 1 is absent in measure 2
        _measure(2, 1920, {"staff0": [_chord(62, 1920, 1920, voice=0)]}),
    ]
    data = {"staves": [{"name": "staff0", "visible": True}], "measures": measures}
    out = json_to_lilypond(data)
    assert "\\voiceOne" in out and "\\voiceTwo" in out
    # voice two holds its place in measure 2 with a spacer
    assert "s1" in out


def test_musical_context_header_rendered():
    data = {
        "keySig": 0,
        "tempo": 120,
        "staves": [{"name": "staff0", "visible": True}],
        "measures": [
            _measure(1, 0, {"staff0": [_chord(60, 1920, 0)]}, timesig=(4, 4)),
        ],
    }
    out = json_to_lilypond(data)
    assert "\\key c \\major" in out
    assert "\\time 4/4" in out
    assert "\\tempo 4 = 120" in out


def test_time_signature_change_emitted_once():
    measures = [
        _measure(1, 0, {"staff0": [_chord(60, 1920, 0)]}, timesig=(4, 4)),
        _measure(2, 1920, {"staff0": [_chord(62, 1920, 1920)]}, timesig=(4, 4)),
        _measure(3, 3840, {"staff0": [_chord(64, 1440, 3840)]}, timesig=(3, 4)),
    ]
    data = {"staves": [{"name": "staff0", "visible": True}], "measures": measures}
    out = json_to_lilypond(data)
    assert out.count("\\time 4/4") == 1   # only at the start, not repeated
    assert out.count("\\time 3/4") == 1   # at the change


def test_selection_shape_list_elements():
    """The selection payload shape (elements as a flat list) still renders."""
    data = {
        "startStaff": 0,
        "startTick": 0,
        "elements": [_chord(60, 480, 0), _chord(64, 480, 480)],
    }
    out = json_to_lilypond(data)
    assert "c'4" in out and "e'4" in out


def test_empty_input_does_not_crash():
    assert json_to_lilypond({}) == "<<\n>>"


def test_section_markers_rendered_as_comments():
    """System text / rehearsal marks attached to measures surface as comments."""
    m1 = _measure(1, 0, {"staff0": [_chord(60, 1920, 0)]})
    m1["markers"] = [{"type": "SystemText", "text": "Verse", "startTick": 0}]
    m2 = _measure(2, 1920, {"staff0": [_chord(62, 1920, 1920)]})
    m2["markers"] = [{"type": "RehearsalMark", "text": "A", "startTick": 1920}]
    data = {"staves": [{"name": "staff0", "visible": True}], "measures": [m1, m2]}
    out = json_to_lilypond(data)
    assert "% m1 [SystemText]: Verse" in out
    assert "% m2 [RehearsalMark]: A" in out
    # Comments precede the music tree and don't disturb note rendering.
    assert out.index("% m1") < out.index("<<")
    assert "c'1" in out and "d'1" in out


def test_blank_marker_text_skipped():
    m = _measure(1, 0, {"staff0": [_chord(60, 1920, 0)]})
    m["markers"] = [{"type": "SystemText", "text": "  "}]
    data = {"staves": [{"name": "staff0", "visible": True}], "measures": [m]}
    out = json_to_lilypond(data)
    assert "%" not in out


# --------------------------------------------------------------------------- #
# instrument metadata -> per-staff comment
# --------------------------------------------------------------------------- #

def test_staff_instrument_comment_rendered():
    """A staff carrying instrument metadata is labelled with a comment line that
    precedes its \\new Staff, including string count and capo when present."""
    data = {
        "staves": [{
            "name": "staff0", "visible": True,
            "instrument": "Rhythm Guitar", "instrumentId": "guitar.electric",
            "strings": 6, "capo": 6,
        }],
        "measures": [_measure(1, 0, {"staff0": [_chord(60, 1920, 0)]})],
    }
    out = json_to_lilypond(data)
    assert "% staff0: Rhythm Guitar (guitar.electric) [6-str, capo 6]" in out
    # The label must sit just above its staff, not pollute the music.
    assert out.index("% staff0:") < out.index("\\new Staff")
    assert "c'1" in out


def test_staff_without_instrument_has_no_comment():
    """Backwards compatibility: staves lacking instrument metadata render exactly
    as before (no stray comment)."""
    data = {
        "staves": [{"name": "staff0", "visible": True}],
        "measures": [_measure(1, 0, {"staff0": [_chord(60, 1920, 0)]})],
    }
    out = json_to_lilypond(data)
    assert "%" not in out
