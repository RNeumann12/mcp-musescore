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

    # Shifted C major up by an octave so it's playable on the A string!
    # C3 (48), C3 (48), C4 (60), G3 (55), G4 (67), A4 (69), G4 (67), E4 (64)
    m5_notes = [48, 48, 60, 55, 67, 69, 67, 64]
    for n in m5_notes: await play(n, eighth)
    
    # Measure 6
    m6_8ths = [48, 48, 60, 55, 67, 69]
    for n in m6_8ths: await play(n, eighth)
    await play(67, quarter)

    # Shifted B major up by an octave to be playable on the A string!
    # Restored the half-step G natural (67) tension which matches the E minor / A minor patterns
    # B2 (47), B2 (47), B3 (59), F#3 (54), F#4 (66), G4 (67), F#4 (66), D#4 (63)
    m7_notes = [47, 47, 59, 54, 66, 67, 66, 63]
    for n in m7_notes: await play(n, eighth)

    # Measure 8
    m8_8ths = [47, 47, 59, 54, 66, 67]
    for n in m8_8ths: await play(n, eighth)
    await play(66, quarter)

    # Add text
    await client.send_command("goToMeasure", {"measure": 5})
    await client.send_command("addLyrics", {"lyrics": ["C Major"]})
    
    await client.send_command("goToMeasure", {"measure": 7})
    await client.send_command("addLyrics", {"lyrics": ["B Major"]})

    print("Fixed octaves!")
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
