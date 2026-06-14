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
//
// The plugin shows a small persistent status window so you can tell at a glance
// whether the server is running, on which port, and what it's doing. Closing
// the window stops the plugin (and the server).
// ============================================================================
MuseScore {
    id: root
    title: "MuseScore API Server"
    description: "Exposes MuseScore API via WebSocket. Hot-reloads logic from mcp-logic.js."
    version: "3.0"

    // Make the plugin a small windowed UI instead of an invisible background task.
    // MuseScore 4 only renders a window when pluginType is "dialog"; without it the
    // plugin runs headless and the UI below is never shown.
    pluginType: "dialog"
    width: 340
    height: 250

    // Port the WebSocket server listens on.
    property int port: 8765

    // --- Live status surfaced in the window -------------------------------
    property bool   serverRunning: false
    property string serverError: ""
    property int    clientCount: 0
    property int    messageCount: 0
    property string lastCommand: ""
    property string lastStatus: ""      // "ok" | "error"
    property int    logicBytes: 0

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

    // ----------------------------------------------------------------------
    // Status window UI
    // ----------------------------------------------------------------------
    Rectangle {
        anchors.fill: parent
        color: "#1e1e1e"

        Column {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 9

            Row {
                spacing: 9
                Rectangle {
                    width: 13; height: 13; radius: 7
                    anchors.verticalCenter: parent.verticalCenter
                    color: root.serverError !== "" ? "#e05252"
                         : (root.serverRunning ? "#4caf50" : "#bbbbbb")
                }
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: root.serverError !== "" ? "Error"
                        : (root.serverRunning ? ("Running on :" + root.port) : "Starting…")
                    color: "#f0f0f0"
                    font.pixelSize: 17
                    font.bold: true
                }
            }

            Text {
                text: "Clients connected: " + root.clientCount
                color: "#cccccc"; font.pixelSize: 13
            }
            Text {
                text: "Commands handled: " + root.messageCount
                color: "#cccccc"; font.pixelSize: 13
            }
            Text {
                visible: root.lastCommand !== ""
                text: "Last: " + root.lastCommand
                      + (root.lastStatus !== "" ? "  (" + root.lastStatus + ")" : "")
                color: root.lastStatus === "error" ? "#e0a052" : "#cccccc"
                font.pixelSize: 13
            }

            Item { width: 1; height: 4 }   // spacer

            Text {
                text: "Logic: " + (root.logicBytes > 0
                        ? ((root.logicBytes / 1024).toFixed(1) + " KB loaded")
                        : "not loaded")
                color: "#999999"; font.pixelSize: 12
            }
            Text {
                visible: root.serverError !== ""
                width: parent.width
                wrapMode: Text.WordWrap
                text: root.serverError
                color: "#e05252"; font.pixelSize: 12
            }
            Text {
                visible: root.serverError === "" && root.serverRunning
                width: parent.width
                wrapMode: Text.WordWrap
                text: "Close this window to stop the server."
                color: "#777777"; font.pixelSize: 11
            }
        }
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
        root.logicBytes = src.length;
        return logicModule;
    }

    function processMessage(message, clientId) {
        try {
            var command = JSON.parse(message);
            root.lastCommand = command.action || "?";
            root.messageCount += 1;
            var result;
            if (command.action === "reloadLogic") {
                ensureLogic(true);
                result = { success: true, message: "Logic reloaded" };
            } else {
                var logic = ensureLogic(false);
                result = logic.processCommand(command, pluginState);
            }
            root.lastStatus = "ok";
            api.websocketserver.send(clientId, JSON.stringify({ status: "success", result: result }));
        } catch (e) {
            root.lastStatus = "error";
            console.log("[MCP] Error: " + e.toString());
            api.websocketserver.send(clientId, JSON.stringify({ status: "error", message: e.toString() }));
        }
    }

    onRun: {
        console.log("Starting MuseScore MCP API Server (hot-reload shell) on port " + port);

        // Preload the logic so the window shows its size immediately and a
        // missing/broken logic file surfaces as a visible error on startup
        // (the server still listens, so a fix + reloadLogic can recover).
        try {
            ensureLogic(false);
        } catch (e) {
            root.serverError = "Logic load failed: " + e.toString();
            console.log("[MCP] " + root.serverError);
        }

        try {
            var ret = api.websocketserver.listen(port, function(clientId) {
                console.log("Client connected with ID: " + clientId);
                clientConnections.push(clientId);
                root.clientCount = clientConnections.length;
                api.websocketserver.onMessage(clientId, function(message) {
                    processMessage(message, clientId);
                });
            });
            if (ret === false) {
                root.serverError = "Could not bind port " + port
                    + " — already in use? (Is another MuseScore/plugin instance running?)";
                console.log("[MCP] " + root.serverError);
            } else {
                root.serverRunning = true;
                console.log("[MCP] Listening on port " + port);
            }
        } catch (e) {
            root.serverError = "Failed to start server: " + e.toString();
            console.log("[MCP] " + root.serverError);
        }
    }
}
