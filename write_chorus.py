import asyncio
from src.client.websocket_client import MuseScoreClient

async def main():
    client = MuseScoreClient()
    connected = await client.connect()
    if not connected: return

    # Clear measures 9 to 16
    for m in range(9, 17):
        await client.send_command("deleteSelection", {"measure": m})

    # Go to measure 9
    await client.send_command("goToMeasure", {"measure": 9})

    half = {"numerator": 1, "denominator": 2}
    quarter = {"numerator": 1, "denominator": 4}
    whole = {"numerator": 1, "denominator": 1}

    async def play_chord(pitches, dur, advance=True):
        pitch_str = ",".join(str(p) for p in pitches)
        await client.send_command("addNote", {
            "pitch": pitch_str,
            "duration": dur,
            "advanceCursorAfterAction": advance
        })

    async def play_rest(dur):
        await client.send_command("addRest", {
            "duration": dur,
            "advanceCursorAfterAction": True
        })

    # Chord voicings (4-note pinches for acoustic guitar)
    cmaj7 = [48, 52, 55, 59]  # C3, E3, G3, B3
    bm7 = [47, 54, 57, 58]    # B2, F#3, A3, D4
    am7 = [45, 52, 55, 60]    # A2, E3, G3, C4
    em = [40, 52, 55, 59]     # E2, E3, G3, B3

    # Measure 9: Cmaj7
    await play_chord(cmaj7, half)
    await play_rest(quarter)
    await play_chord(cmaj7, quarter)

    # Measure 10: Cmaj7
    await play_chord(cmaj7, whole)

    # Measure 11: Bm7
    await play_chord(bm7, half)
    await play_rest(quarter)
    await play_chord(bm7, quarter)

    # Measure 12: Bm7
    await play_chord(bm7, whole)

    # Measure 13: Am7
    await play_chord(am7, half)
    await play_rest(quarter)
    await play_chord(am7, quarter)

    # Measure 14: Am7
    await play_chord(am7, whole)

    # Measure 15: Em
    await play_chord(em, half)
    await play_rest(quarter)
    await play_chord(em, quarter)

    # Measure 16: Em
    await play_chord(em, whole)

    # Add lyrics to mark the Chorus
    await client.send_command("goToMeasure", {"measure": 9})
    await client.send_command("addLyrics", {"lyrics": ["[CHORUS] Cmaj7"]})

    await client.send_command("goToMeasure", {"measure": 11})
    await client.send_command("addLyrics", {"lyrics": ["Bm7"]})

    await client.send_command("goToMeasure", {"measure": 13})
    await client.send_command("addLyrics", {"lyrics": ["Am7"]})

    await client.send_command("goToMeasure", {"measure": 15})
    await client.send_command("addLyrics", {"lyrics": ["Em"]})

    print("Added Chorus block chords!")
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
