import asyncio
import json
import logging
import sys
from src.client.websocket_client import MuseScoreClient
from src.utils.lilypond_converter import json_to_lilypond

# Set up logging to console
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

async def main():
    client = MuseScoreClient()
    connected = await client.connect()
    if not connected:
        print("Failed to connect to MuseScore. Please make sure MuseScore is open and the API Server plugin is running.")
        sys.exit(1)
        
    print("Connected successfully to MuseScore WebSocket!\n")
    
    # 1. Get Score Info
    print("--- SCORE INFO ---")
    score_res = await client.send_command("getScore")
    if score_res.get("success"):
        analysis = score_res.get("analysis", {})
        title = analysis.get("title", "Untitled")
        print(f"Title: {title}")
        print(f"Measures: {analysis.get('numMeasures', 0)}")
        staves = analysis.get("staves", [])
        print(f"Staves/Instruments ({len(staves)}):")
        for i, s in enumerate(staves):
            print(f"  - Staff {i}: {s.get('name', 'Unnamed')} ({s.get('shortName', 'No Short Name')})")
            
        print("\n=== LILYPOND REPRESENTATION OF THE SCORE ===")
        try:
            lily_str = json_to_lilypond(analysis)
            print(lily_str)
        except Exception as e:
            print(f"Failed to convert score to LilyPond: {e}")
    else:
        print(f"Error fetching score: {score_res}")
        
    # 2. Get Cursor Info
    print("\n--- CURSOR INFO ---")
    cursor_res = await client.send_command("getCursorInfo")
    if cursor_res.get("success"):
        selection = cursor_res.get("currentSelection", {})
        score_info = cursor_res.get("currentScore", {})
        
        tick = selection.get("startTick", 0)
        measure_num = (tick // 1920) + 1
        beat_num = ((tick % 1920) // 480) + 1
        
        print(f"Current Tick: {tick}")
        print(f"Measure: {measure_num}, Beat: {beat_num}")
        print(f"Start Staff: {selection.get('startStaff', 0)}, End Staff: {selection.get('endStaff', 0)}")
        
        print("\n=== LILYPOND REPRESENTATION OF CURRENT SELECTION ===")
        try:
            sel_lily_str = json_to_lilypond(selection)
            print(sel_lily_str)
        except Exception as e:
            print(f"Failed to convert selection to LilyPond: {e}")
    else:
        print(f"Error fetching cursor info: {cursor_res}")

    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
