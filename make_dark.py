import asyncio
from src.client.websocket_client import MuseScoreClient

async def main():
    client = MuseScoreClient()
    connected = await client.connect()
    if not connected: return

    # Clear measures 5 to 6
    for m in range(5, 7):
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

    # Measure 5 (C minor, all 8th)
    # Replaced E natural with Eb (63) and A natural with Ab (68)
    # Notes: C3(48), C3(48), C4(60), G3(55), G4(67), Ab4(68), G4(67), Eb4(63)
    cm_notes = [48, 48, 60, 55, 67, 68, 67, 63]
    for n in cm_notes: await play(n, eighth)
    
    # Measure 6 (C minor ending in quarter)
    cm_8ths = [48, 48, 60, 55, 67, 68]
    for n in cm_8ths: await play(n, eighth)
    await play(67, quarter)

    # Re-add text
    await client.send_command("goToMeasure", {"measure": 5})
    await client.send_command("addLyrics", {"lyrics": ["C Minor"]})

    print("Changed C major to C minor!")
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
