import asyncio
from src.client.websocket_client import MuseScoreClient

async def main():
    client = MuseScoreClient()
    connected = await client.connect()
    if not connected: return

    # Go to measure 1 and add "VERSE" as a lyric (since system/staff text isn't directly exposed in this MCP)
    await client.send_command("goToMeasure", {"measure": 1})
    await client.send_command("addLyrics", {"lyrics": ["[VERSE]"]})

    print("Added VERSE marker!")
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
