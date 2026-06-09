import QtQuick
import MuseScore 3.0
import FileIO 3.0

// ============================================================================
// MuseScore MCP - thin WebSocket SHELL (hot-reload host)
//
// This file is intentionally tiny and stable. All command logic lives in
// `mcp-logic.js`, which this shell reads (via FileIO) and eval()s on every
// request. Editing mcp-logic.js takes effect on the next command WITHOUT
// restarting MuseScore.
//
// (Local-file XMLHttpRequest is disabled in MuseScore 4 / Qt6, so FileIO is the
// only way to read the logic file.)
//
// You only ever need to (re)load THIS .qml from the Plugin Manager once (a real
// MuseScore restart), and only when this shell file itself changes.
// ============================================================================
MuseScore {
    id: root
    title: "MuseScore API Server"
    description: "Exposes MuseScore API via WebSocket. Hot-reloads logic from mcp-logic.js."
    version: "3.0"

    // Persistent state, survives logic hot-reloads (held by the shell, not the logic).
    property var pluginState: ({ selection: { startStaff: 0, endStaff: 1, startTick: 0, elements: [] } })

    // Cached compiled logic + the source it was compiled from.
    property var logicModule: null
    property string logicSource: ""
    property var clientConnections: []

    FileIO {
        id: logicFile
        // mcp-logic.js sits next to this plugin file. Strip the URL scheme so
        // FileIO gets a plain filesystem path (Windows: file:///C:/... -> C:/...).
        source: decodeURIComponent(
                    Qt.resolvedUrl("mcp-logic.js").toString()
                      .replace(/^file:\/\/\//, "")
                      .replace(/^file:\/\//, ""))
    }

    // Build the context object that funnels every MuseScore primitive into the
    // logic through closures created here, in real component scope. This makes
    // the logic immune to eval() scoping quirks.
    function buildCtx() {
        return {
            api: api,
            getCurScore: function() { return curScore; },
            cmd: function(c) { return cmd(c); },
            newElement: function(t) { return newElement(t); },
            fraction: function(n, d) { return fraction(n, d); },
            Element: Element,
            Cursor: Cursor,
            Qt: Qt,
            log: function(m) { console.log("[MCP] " + m); }
        };
    }

    // (Re)compile mcp-logic.js if its contents changed.
    function ensureLogic(force) {
        var src = logicFile.read();
        if (!src || src.length === 0) {
            throw new Error("Could not read mcp-logic.js at " + logicFile.source);
        }
        if (force || src !== logicSource || logicModule === null) {
            var factory = eval(src);            // mcp-logic.js is a (function(ctx){...}) expression
            logicModule = factory(buildCtx());
            logicSource = src;
            console.log("[MCP] Loaded logic (" + src.length + " bytes)");
        }
        return logicModule;
    }

    function processMessage(message, clientId) {
        try {
            var command = JSON.parse(message);
            var result;
            if (command.action === "reloadLogic") {
                ensureLogic(true);
                result = { success: true, message: "Logic reloaded" };
            } else {
                var logic = ensureLogic(false);
                result = logic.processCommand(command, pluginState);
            }
            api.websocketserver.send(clientId, JSON.stringify({ status: "success", result: result }));
        } catch (e) {
            console.log("[MCP] Error: " + e.toString());
            api.websocketserver.send(clientId, JSON.stringify({ status: "error", message: e.toString() }));
        }
    }

    onRun: {
        console.log("Starting MuseScore MCP API Server (hot-reload shell) on port 8765");
        api.websocketserver.listen(8765, function(clientId) {
            console.log("Client connected with ID: " + clientId);
            clientConnections.push(clientId);
            api.websocketserver.onMessage(clientId, function(message) {
                processMessage(message, clientId);
            });
        });
    }
}
