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

    # Measure 5: C minor over Open A string (Am7b5)
    # Notes: A2(45), A2(45), C4(60), G3(55), G4(67), Ab4(68), G4(67), Eb4(63)
    m5_notes = [45, 45, 60, 55, 67, 68, 67, 63]
    for n in m5_notes: await play(n, eighth)
    
    # Measure 6
    m6_8ths = [45, 45, 60, 55, 67, 68]
    for n in m6_8ths: await play(n, eighth)
    await play(67, quarter)

    # Measure 7: B major over Open E string (B/E)
    # Notes: E2(40), E2(40), B3(59), F#3(54), F#4(66), G4(67), F#4(66), D#4(63)
    m7_notes = [40, 40, 59, 54, 66, 67, 66, 63]
    for n in m7_notes: await play(n, eighth)

    # Measure 8
    m8_8ths = [40, 40, 59, 54, 66, 67]
    for n in m8_8ths: await play(n, eighth)
    await play(66, quarter)

    # Add text
    await client.send_command("goToMeasure", {"measure": 5})
    await client.send_command("addLyrics", {"lyrics": ["Cm / A"]})
    
    await client.send_command("goToMeasure", {"measure": 7})
    await client.send_command("addLyrics", {"lyrics": ["B / E"]})

    print("Added pedal points!")
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
