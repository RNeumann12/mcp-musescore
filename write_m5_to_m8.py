import asyncio
from src.client.websocket_client import MuseScoreClient

async def main():
    client = MuseScoreClient()
    connected = await client.connect()
    if not connected:
        print("Failed to connect.")
        return

    # Go to measure 5
    await client.send_command("goToMeasure", {"measure": 5})

    # Duration helpers
    eighth = {"numerator": 1, "denominator": 8}
    quarter = {"numerator": 1, "denominator": 4}

    # Helper function to add notes
    async def play(pitch, dur):
        await client.send_command("addNote", {
            "pitch": pitch,
            "duration": dur,
            "advanceCursorAfterAction": True
        })

    # Measure 5 (C major, all 8th)
    # C2, C2, C3, G2, G3, A3, G3, E3
    m5_notes = [36, 36, 48, 43, 55, 57, 55, 52]
    for n in m5_notes:
        await play(n, eighth)

    # Measure 6 (C major ending in quarter)
    # C2, C2, C3, G2, G3, A3 (8ths), G3 (quarter)
    m6_8ths = [36, 36, 48, 43, 55, 57]
    for n in m6_8ths:
        await play(n, eighth)
    await play(55, quarter)

    # Measure 7 (B major, all 8th)
    # B1(35), B1(35), B2(47), F#2(42), F#3(54), G3(55), F#3(54), D#3(51)
    m7_notes = [35, 35, 47, 42, 54, 55, 54, 51]
    for n in m7_notes:
        await play(n, eighth)

    # Measure 8 (B major ending in quarter)
    m8_8ths = [35, 35, 47, 42, 54, 55]
    for n in m8_8ths:
        await play(n, eighth)
    await play(54, quarter)

    print("Successfully wrote notes for Measures 5-8!")
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
