"""End-to-end smoke test for the MuseScore MCP plugin (talks straight to the
WebSocket on 8765, bypassing the Python MCP server). Run after restarting
MuseScore so the new hot-reload shell is loaded.

    .venv/Scripts/python.exe verify_mcp.py
"""
import asyncio
import json
import sys

from src.client.websocket_client import MuseScoreClient
from src.utils.lilypond_converter import json_to_lilypond

PASS, FAIL = "PASS", "FAIL"


def check(name, ok, detail=""):
    ok = bool(ok)
    print(f"[{PASS if ok else FAIL}] {name}" + (f" — {detail}" if detail else ""))
    return ok


async def main():
    client = MuseScoreClient()
    if not await client.connect():
        print("Could not connect to ws://localhost:8765 — is MuseScore running with the plugin?")
        sys.exit(1)
    print("Connected to ws://localhost:8765\n")

    # Warm up: wait for the async logic load to finish.
    for _ in range(20):
        if await client.send_command("ping") == "pong":
            break
        await asyncio.sleep(0.25)

    results = []

    # 1. Hot-reload shell proves itself (old monolithic plugin had no reloadLogic)
    r = await client.send_command("reloadLogic")
    results.append(check("reloadLogic (proves new shell is loaded)",
                         isinstance(r, dict) and r.get("success") is True, json.dumps(r)))

    # 2. ping
    r = await client.send_command("ping")
    results.append(check("ping", r == "pong", repr(r)))

    # 3. getScore full -> compact LilyPond
    r = await client.send_command("getScore")
    ok = isinstance(r, dict) and r.get("success") and "analysis" in r
    if ok:
        lily = json_to_lilypond(r["analysis"])
        nmeas = r["analysis"].get("numMeasures")
        print(f"      getScore: {nmeas} measures -> {len(lily)} bytes of LilyPond")
        print("      " + lily.replace("\n", "\n      "))
    results.append(check("getScore (full) returns analysis", ok, "" if ok else json.dumps(r)))

    # 4. getScore range
    r = await client.send_command("getScore", {"startMeasure": 1, "endMeasure": 2})
    ok = isinstance(r, dict) and r.get("success") and len(r.get("analysis", {}).get("measures", [])) <= 2
    results.append(check("getScore (range 1-2)", ok, json.dumps(r)[:120]))

    # 5. addNote must NOT throw the old `.some` TypeError
    await client.send_command("goToBeginningOfScore")
    r = await client.send_command("addNote", {"pitch": 67, "duration": {"numerator": 1, "denominator": 8},
                                              "advanceCursorAfterAction": True})
    ok = isinstance(r, dict) and r.get("success") is True
    err = (r or {}).get("error", "")
    results.append(check("addNote (no .some crash)", ok, err or r.get("message", "")))
    await client.send_command("undo")  # revert the test note

    # 6. setTempo (newly exposed)
    r = await client.send_command("setTempo", {"bpm": 100})
    results.append(check("setTempo", isinstance(r, dict) and r.get("success") is True, json.dumps(r)))
    await client.send_command("undo")

    # 7. addSystemText (section marker) + read it back via getScore
    await client.send_command("goToBeginningOfScore")
    r = await client.send_command("addSystemText", {"text": "MCP-TEST", "measure": 1})
    ok = isinstance(r, dict) and r.get("success") is True
    if ok:
        gs = await client.send_command("getScore", {"startMeasure": 1, "endMeasure": 1})
        markers = (gs or {}).get("analysis", {}).get("measures", [{}])[0].get("markers", [])
        ok = any(m.get("text") == "MCP-TEST" for m in markers)
    results.append(check("addSystemText (written + read back in getScore)", ok, json.dumps(r)))
    await client.send_command("undo")  # revert the test marker

    # 8. addChordSymbol (Harmony) + read it back via getScore
    await client.send_command("goToBeginningOfScore")
    r = await client.send_command("addChordSymbol", {"text": "Cm7", "measure": 1})
    ok = isinstance(r, dict) and r.get("success") is True
    if ok:
        gs = await client.send_command("getScore", {"startMeasure": 1, "endMeasure": 1})
        markers = (gs or {}).get("analysis", {}).get("measures", [{}])[0].get("markers", [])
        ok = any(m.get("type") == "Harmony" and m.get("text") == "Cm7" for m in markers)
    results.append(check("addChordSymbol (written + read back in getScore)", ok, json.dumps(r)))
    await client.send_command("undo")  # revert the test chord symbol

    # 9. navigation + selection render
    await client.send_command("goToBeginningOfScore")
    r = await client.send_command("getCursorInfo")
    ok = isinstance(r, dict) and r.get("success") and "currentSelection" in r
    results.append(check("getCursorInfo", ok, ""))  # check 10

    await client.close()
    print(f"\n{sum(results)}/{len(results)} checks passed")
    sys.exit(0 if all(results) else 2)


if __name__ == "__main__":
    asyncio.run(main())
