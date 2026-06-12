import asyncio
from src.client.websocket_client import MuseScoreClient

async def main():
    client = MuseScoreClient()
    connected = await client.connect()
    if not connected: return

    # Clear measures 5 to 8
    for m in range(5, 9):
        await client.send_command("deleteSelection", {"measure": m})

    # Go to measure 5
    await client.send_command("goToMeasure", {"measure": 5})

    eighth = {"numerator": 1, "denominator": 8}
    quarter = {"numerator": 1, "denominator": 4}

    async def play(pitch, dur):
        await client.send_command("addNote", {
            "pitch": pitch,
            "duration": dur,
            "advanceCursorAfterAction": True
        })

    # Measure 5 (C major, all 8th)
    m5_notes = [36, 36, 48, 43, 55, 57, 55, 52]
    for n in m5_notes: await play(n, eighth)
    
    # Measure 6 (C major ending in quarter)
    m6_8ths = [36, 36, 48, 43, 55, 57]
    for n in m6_8ths: await play(n, eighth)
    await play(55, quarter)

    # Measure 7 (B major, all 8th)
    # Fixing the 6th to be G# (56) instead of G natural (55) to be a pure B major sound
    m7_notes = [35, 35, 47, 42, 54, 56, 54, 51]
    for n in m7_notes: await play(n, eighth)

    # Measure 8 (B major ending in quarter)
    m8_8ths = [35, 35, 47, 42, 54, 56]
    for n in m8_8ths: await play(n, eighth)
    await play(54, quarter)

    # Add text (using lyrics to label chords)
    await client.send_command("goToMeasure", {"measure": 5})
    await client.send_command("addLyrics", {"lyrics": ["C Major"]})
    
    await client.send_command("goToMeasure", {"measure": 7})
    await client.send_command("addLyrics", {"lyrics": ["B Major"]})

    print("Fixed notes and added text!")
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
