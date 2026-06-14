// ============================================================================
// MuseScore MCP - command logic (HOT-RELOADABLE)
//
// This file holds ALL command logic for the MuseScore MCP bridge. The thin QML
// shell (musescore-mcp-websocket.qml) reads and eval()s this file on every
// request, so editing this file takes effect WITHOUT restarting MuseScore.
//
// It is a single factory expression: (function(ctx){ ... return {...}; })
// `ctx` is supplied by the shell and funnels every MuseScore API primitive
// through closures created in real component scope, so nothing here depends on
// eval scoping quirks.
// ============================================================================
(function(ctx) {
    "use strict";

    // --- MuseScore primitives, injected from the shell -----------------------
    var api        = ctx.api;
    var Element    = ctx.Element;
    var Cursor     = ctx.Cursor;
    var cmd        = ctx.cmd;          // cmd("undo") etc.
    var newElement = ctx.newElement;
    var fraction   = ctx.fraction;
    var log        = ctx.log || function() {};

    // --- Per-call mutable state ---------------------------------------------
    // `curScore` is refreshed on every processCommand call (the user may switch
    // scores). `selectionState` is restored from / persisted to the shell's
    // pluginState so it survives hot reloads.
    var curScore = null;
    var selectionState = { startStaff: 0, endStaff: 1, startTick: 0, elements: [] };

    // Name of the last mutating action dispatched (excluding undo itself). Used
    // to warn that MuseScore's plugin undo is unreliable for deletions.
    var lastAction = null;
    var DELETE_ACTIONS = { deleteSelection: true };
    var UNDO_DELETE_WARNING =
        "MuseScore's plugin undo is unreliable for deletions; deleted measures/notes " +
        "may not be restored. Use Ctrl+Z directly in MuseScore if this did not take effect.";

    // ========================================================================
    // ENTRY POINTS
    // ========================================================================

    function processCommand(command, state) {
        curScore = ctx.getCurScore();
        if (!state.selection) {
            state.selection = { startStaff: 0, endStaff: 1, startTick: 0, elements: [] };
        }
        selectionState = state.selection;
        var result = dispatch(command);
        state.selection = selectionState;   // persist (survives reload)
        return result;
    }

    // Wrapper around the action switch that records the last mutating action
    // (so undo() can detect a preceding delete). Both processCommand and
    // processSequence route through here.
    function dispatch(command) {
        var result = dispatchAction(command);
        if (command.action !== "undo") lastAction = command.action;
        return result;
    }

    function dispatchAction(command) {
        switch (command.action) {
            // Core
            case "getScore":             return getScore(command.params);
            case "ping":                 return "pong";
            case "removeNotesAtTick":    return executeWithUndo(function() {
                var c = inputCursorAt(command.params.tick || 0, command.params.staff || 0);
                var el = c.element;
                if (!el || el.name !== "Chord") return { error: "No chord at tick" };
                var toRemove = command.params.pitches.slice();
                var removed = [];
                var keys = Object.keys(el.notes);
                for (var i = keys.length - 1; i >= 0; i--) {
                    var note = el.notes[keys[i]];
                    var idx = toRemove.indexOf(note.pitch);
                    if (idx >= 0) { el.remove(note); removed.push(note.pitch); toRemove.splice(idx, 1); }
                }
                return { success: true, removed: removed };
            });
            case "undo":                 return undo();
            case "goToBeginningOfScore": return goToBeginningOfScore();
            case "processSequence":      return processSequence(command.params);
            case "syncStateToSelection": return syncStateToSelection();

            // Navigation
            case "getCursorInfo":        return getCursorInfo(command.params);
            case "goToMeasure":          return goToMeasure(command.params);
            case "goToFinalMeasure":     return goToFinalMeasure(command.params);
            case "nextElement":          return nextElement(command.params);
            case "prevElement":          return prevElement(command.params);
            case "nextStaff":            return nextStaff(command.params);
            case "prevStaff":            return prevStaff(command.params);

            // Selection
            case "selectCurrentMeasure": return selectCurrentMeasure(command.params);
            case "selectCustomRange":    return selectCustomRange(command.params);

            // Notes & music
            case "addNote":              return addNote(command.params);
            case "addRest":              return addRest(command.params);
            case "addTuplet":            return addTuplet(command.params);
            case "addLyrics":            return addLyrics(command.params);
            case "addSystemText":        return addSystemText(command.params);
            case "addStaffText":         return addStaffText(command.params);
            case "addRehearsalMark":     return addRehearsalMark(command.params);
            case "addChordSymbol":       return addChordSymbol(command.params);

            // Measures
            case "appendMeasure":        return appendMeasure(command.params);
            case "insertMeasure":        return insertMeasure(command.params);
            case "deleteSelection":      return deleteSelection(command.params);

            // Staff / instrument / time / tempo
            case "addInstrument":        return addInstrument(command.params);
            case "setStaffMute":         return setStaffMute(command.params);
            case "setInstrumentSound":   return setInstrumentSound(command.params);
            case "setTimeSignature":     return setTimeSignature(command.params);
            case "setTempo":             return setTempo(command.params);

            default:
                return { error: "Unknown action: " + command.action };
        }
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    function validateParams(params, required) {
        var missing = [];
        params = params || {};
        for (var i = 0; i < required.length; i++) {
            if (params[required[i]] === undefined) missing.push(required[i]);
        }
        return missing.length > 0
            ? { error: "Missing required parameters: " + missing.join(", ") }
            : { valid: true };
    }

    function executeWithUndo(operation) {
        if (!curScore) return { error: "No score open" };
        curScore.startCmd();
        try {
            var result = operation();
            curScore.endCmd();
            return result;
        } catch (e) {
            curScore.endCmd(true);
            return { error: e.toString() };
        }
    }

    function getTpcName(tpc) {
        if (tpc === -1) return "Fbb";
        var tpcNames = [
            "Cbb", "Gbb", "Dbb", "Abb", "Ebb", "Bbb", "Fb",
            "Cb",  "Gb",  "Db",  "Ab",  "Eb",  "Bb",  "F",
            "C",   "G",   "D",   "A",   "E",   "B",   "F#",
            "C#",  "G#",  "D#",  "A#",  "E#",  "B#",  "F##",
            "C##", "G##", "D##", "A##", "E##", "B##", "F###"
        ];
        if (tpc >= 0 && tpc < tpcNames.length) return tpcNames[tpc];
        return "Unknown";
    }

    // ========================================================================
    // CURSOR MANAGEMENT
    // ========================================================================

    function createCursor(params) {
        if (!curScore) throw new Error("No score open");

        if (!params || Object.keys(params).length === 0) {
            params = selectionState;
        }

        var cursor = curScore.newCursor();
        cursor.inputStateMode = Cursor.INPUT_STATE_SYNC_WITH_SCORE;

        if (params.startStaff !== undefined) cursor.staffIdx = params.startStaff;
        if (params.voice !== undefined) cursor.voice = params.voice;

        if (params.rewindMode !== undefined) {
            cursor.rewind(params.rewindMode);
        } else if (params.startTick !== undefined) {
            try {
                cursor.rewindToTick(params.startTick);
            } catch (e) {
                cursor.rewind(0);
                while (cursor.tick < params.startTick && cursor.next()) {}
            }
        } else if (params.measure !== undefined) {
            cursor.rewind(0);
            for (var i = 0; i < params.measure && cursor.nextMeasure(); i++) {}
        } else {
            cursor.rewind(0);
        }

        if (params.duration) {
            cursor.setDuration(params.duration.numerator || 1, params.duration.denominator || 4);
        }

        return cursor;
    }

    // A fresh, independent input cursor positioned at a tick on a staff. Used by
    // the note/rest/tuplet writers (avoids the .some() bug from the old code).
    function inputCursorAt(startTick, staffIdx) {
        var cursor = curScore.newCursor();
        cursor.inputStateMode = Cursor.INPUT_STATE_INDEPENDENT;
        cursor.staffIdx = staffIdx || 0;
        cursor.voice = 0;
        cursor.rewind(0);
        cursor.rewindToTick(startTick);
        return cursor;
    }

    function initCursorState() {
        if (!curScore) return "No score open";
        return executeWithUndo(function() {
            var cursor = curScore.newCursor();
            cursor.rewind(0);
            var startTick = cursor.tick;
            cursor.next();
            var endTick = cursor.tick;
            var element = cursor.element;

            selectionState = {
                startStaff: cursor.staffIdx,
                endStaff: cursor.staffIdx + 1,
                startTick: startTick,
                elements: element ? [processElement(element)] : []
            };

            curScore.selection.clear();
            curScore.selection.selectRange(startTick, endTick, 0, 0);
            return "Initialized at " + [startTick, endTick, 0, 0].join(",");
        });
    }

    // ========================================================================
    // ELEMENT PROCESSING (kept lean: only what the LilyPond converter needs)
    // ========================================================================

    function processElement(element) {
        if (!element) return null;
        if (element.name !== "Chord" && element.name !== "Rest") return null;

        var base = {
            name: element.name,
            durationTicks: element.actualDuration ? element.actualDuration.ticks : 0
        };

        if (element.lyrics && element.lyrics.length > 0) {
            base.lyrics = [];
            for (var l = 0; l < element.lyrics.length; l++) {
                var lyr = element.lyrics[l];
                if (lyr) base.lyrics.push({ text: lyr.text, no: lyr.no, syllabic: lyr.syllabic });
            }
        }

        if (element.name === "Chord") {
            base.notes = [];
            var notesObj = element.notes || {};
            var keys = Object.keys(notesObj);
            for (var k = 0; k < keys.length; k++) {
                var note = notesObj[keys[k]];
                base.notes.push({ pitchMidi: note.pitch, tpc: note.tpc });
            }
        }

        return base;
    }

    // ========================================================================
    // CORE OPERATIONS
    // ========================================================================

    function undo() {
        if (!curScore) return { error: "No score open" };
        var wasDelete = lastAction && DELETE_ACTIONS[lastAction];
        // Must NOT run inside startCmd/endCmd (that would open a fresh, empty
        // undo transaction). Plain cmd("undo") is "not a registered action" in
        // MS 4.7 — the legacy-name table lacks undo, so use the action URI.
        cmd("action://notation/undo");
        var result = { success: true, message: "Undo successful" };
        if (wasDelete) result.warning = UNDO_DELETE_WARNING;
        return result;
    }

    function goToBeginningOfScore() {
        var response = initCursorState();
        return {
            success: true,
            message: response,
            currentSelection: selectionState,
            currentScore: getScoreSummary()
        };
    }

    function processSequence(params) {
        if (!curScore) return { error: "No score open" };
        if (!params || !params.sequence) return { error: "No sequence specified" };

        var errors = [];
        for (var i = 0; i < params.sequence.length; i++) {
            var command = params.sequence[i];
            var res = dispatch(command);
            if (res && res.error) {
                // Surface the exact step, action AND the params that failed so
                // the caller can see which input was bad without guessing.
                errors.push({
                    step: i,
                    action: command.action,
                    params: command.params || {},
                    error: res.error
                });
            }
        }
        if (errors.length > 0) {
            return {
                success: false,
                message: errors.length + " of " + params.sequence.length + " step(s) failed",
                errors: errors,
                currentSelection: selectionState
            };
        }
        return { success: true, message: "Sequence processed", currentSelection: selectionState };
    }

    // ========================================================================
    // NAVIGATION
    // ========================================================================

    function syncStateToSelection() {
        if (!curScore) return { error: "No score open" };
        try {
            var selection = curScore.selection;
            var startSegment = selection.startSegment;
            var endSegment = selection.endSegment;

            if (startSegment && endSegment) {
                var elementsMap = {};
                for (var st = selection.startStaff; st < selection.endStaff; st++) {
                    elementsMap["staff" + st] = [];
                }

                var currentSegment = startSegment;
                while (currentSegment && currentSegment.tick < endSegment.tick) {
                    for (var s = selection.startStaff; s < selection.endStaff; s++) {
                        for (var v = 0; v < 4; v++) {
                            var track = s * 4 + v;
                            var el = currentSegment.elementAt(track);
                            if (el) {
                                var processed = processElement(el);
                                if (processed) {
                                    processed.voice = v;
                                    processed.startTick = currentSegment.tick;
                                    elementsMap["staff" + s].push(processed);
                                }
                            }
                        }
                    }
                    currentSegment = currentSegment.next;
                }

                selectionState = {
                    startStaff: selection.startStaff,
                    endStaff: selection.endStaff,
                    startTick: startSegment.tick,
                    elements: elementsMap,
                    totalDuration: endSegment.tick - startSegment.tick
                };
            } else {
                var c = createCursor();
                if (c && c.element) {
                    var elElement = processElement(c.element);
                    elElement.startTick = c.tick;
                    var sStart = selection.startStaff || 0;
                    var singleMap = {};
                    singleMap["staff" + sStart] = [elElement];

                    selectionState = {
                        startStaff: sStart,
                        endStaff: sStart + 1,
                        startTick: c.tick,
                        elements: singleMap,
                        totalDuration: elElement.durationTicks
                    };
                } else {
                    return { error: "No valid selection or cursor elements found" };
                }
            }

            return { success: true, currentSelection: selectionState };
        } catch (e) {
            return { success: false, error: e.toString() };
        }
    }

    function getCursorInfo(params) {
        if (!curScore) return { error: "No score open" };
        syncStateToSelection();
        return {
            success: true,
            currentSelection: selectionState,
            // verbose score dump only on explicit request (saves payload)
            currentScore: (params && params.verbose === true) ? getScoreSummary() : null
        };
    }

    function goToMeasure(params) {
        var validation = validateParams(params, ["measure"]);
        if (!validation.valid) return validation;

        return executeWithUndo(function() {
            var score = getScoreSummary();
            if (params.measure < 1 || params.measure > score.measures.length) {
                return { error: "Invalid measure number" };
            }
            var measureIdx = params.measure - 1;
            var measure = score.measures[measureIdx];
            var startTick = measure.startTick;
            var endTick = (measureIdx + 1 < score.measures.length)
                ? score.measures[measureIdx + 1].startTick
                : curScore.lastSegment.tick;

            curScore.selection.clear();
            curScore.selection.selectRange(startTick, endTick, 0, curScore.nstaves);

            var res = syncStateToSelection();
            if (res.error) return res;
            return { success: true, currentSelection: selectionState };
        });
    }

    function nextElement(params) {
        return executeWithUndo(function() {
            syncStateToSelection();
            var cursor = createCursor({ startTick: selectionState.startTick, startStaff: selectionState.startStaff });

            var numElements = (params && params.numElements) || 1;
            var success = true;
            for (var i = 0; i < numElements && success; i++) success = cursor.next();

            if (success) {
                var element = processElement(cursor.element);
                var startTick = cursor.tick;
                var staffIdx = cursor.staffIdx;

                if (startTick + element.durationTicks >= curScore.lastSegment.tick) {
                    cmd("append-measure");
                }

                curScore.selection.clear();
                curScore.selection.selectRange(startTick, startTick + element.durationTicks, staffIdx, staffIdx + 1);

                selectionState = {
                    startStaff: staffIdx, endStaff: staffIdx + 1, startTick: startTick,
                    elements: [element], totalDuration: element.durationTicks
                };
                return { success: true, currentSelection: selectionState };
            }
            return { success: false, message: "End of score reached" };
        });
    }

    function prevElement(params) {
        return executeWithUndo(function() {
            syncStateToSelection();
            var cursor = createCursor({ startTick: selectionState.startTick, startStaff: selectionState.startStaff });

            var endTick = cursor.tick;
            var numElements = (params && params.numElements) || 1;
            var success = true;
            for (var i = 0; i < numElements && success; i++) success = cursor.prev();

            if (success) {
                var element = processElement(cursor.element);
                var startTick = cursor.tick;
                var staffIdx = cursor.staffIdx;

                curScore.selection.clear();
                curScore.selection.selectRange(startTick, endTick, staffIdx, staffIdx + 1);

                selectionState = {
                    startStaff: staffIdx, endStaff: staffIdx + 1, startTick: startTick,
                    elements: [element], totalDuration: endTick - startTick
                };
                return { success: true, currentSelection: selectionState };
            }
            return { success: false, message: "Beginning of score reached" };
        });
    }

    function nextStaff(params) {
        return executeWithUndo(function() {
            syncStateToSelection();
            if (selectionState.endStaff >= curScore.nstaves) {
                return { success: false, message: "Already at last staff" };
            }
            var newStaff = selectionState.endStaff;
            var cursor = createCursor({ startTick: selectionState.startTick, startStaff: newStaff });
            var element = processElement(cursor.element);

            curScore.selection.clear();
            curScore.selection.selectRange(selectionState.startTick, selectionState.startTick + element.durationTicks, newStaff, newStaff + 1);

            selectionState = {
                startStaff: newStaff, endStaff: newStaff + 1, startTick: selectionState.startTick,
                elements: [element], totalDuration: element.durationTicks
            };
            return { success: true, currentSelection: selectionState };
        });
    }

    function prevStaff(params) {
        return executeWithUndo(function() {
            syncStateToSelection();
            if (selectionState.startStaff <= 0) {
                return { success: false, message: "Already at first staff" };
            }
            var newStaff = selectionState.startStaff - 1;
            var cursor = createCursor({ startTick: selectionState.startTick, startStaff: newStaff });
            var element = processElement(cursor.element);

            curScore.selection.clear();
            curScore.selection.selectRange(selectionState.startTick, selectionState.startTick + element.durationTicks, newStaff, newStaff + 1);

            selectionState = {
                startStaff: newStaff, endStaff: newStaff + 1, startTick: selectionState.startTick,
                elements: [element], totalDuration: element.durationTicks
            };
            return { success: true, currentSelection: selectionState };
        });
    }

    function goToFinalMeasure(params) {
        return executeWithUndo(function() {
            var cursor = createCursor({ startTick: 0 });
            var count = 0;
            var startTick = 0;
            while (cursor.nextMeasure()) { startTick = cursor.tick; count++; }
            if (count === 0) return { success: false, message: "Already at the last measure" };

            cursor.rewindToTick(startTick);
            cursor.next();
            var endTick = cursor.tick;
            var staffIdx = cursor.staffIdx;

            curScore.selection.clear();
            curScore.selection.selectRange(startTick, endTick, staffIdx, staffIdx + 1);

            selectionState = {
                startStaff: staffIdx, endStaff: staffIdx + 1, startTick: startTick,
                elements: [processElement(cursor.element)], totalDuration: endTick - startTick
            };
            return { success: true, currentSelection: selectionState };
        });
    }

    // ========================================================================
    // SELECTION
    // ========================================================================

    function selectCurrentMeasure() {
        return executeWithUndo(function() {
            var cursor = createCursor({
                startTick: selectionState.startTick || 0,
                startStaff: selectionState.startStaff || 0
            });
            var currTick = cursor.tick;
            var scoreSummary = getScoreSummary();

            var measureIdx = scoreSummary.measures.filter(function(m) { return m.startTick <= currTick; }).length - 1;
            if (measureIdx < 0) return { error: "Invalid cursor position" };

            var measure = scoreSummary.measures[measureIdx];
            var startTick = measure.startTick;
            var endTick = (measureIdx + 1 < scoreSummary.measures.length)
                ? scoreSummary.measures[measureIdx + 1].startTick
                : curScore.lastSegment.tick;

            curScore.selection.clear();
            curScore.selection.selectRange(startTick, endTick, 0, curScore.nstaves);

            var res = syncStateToSelection();
            if (res.error) return res;
            return { success: true, message: "Selected measure " + (measureIdx + 1), currentSelection: selectionState };
        });
    }

    function selectCustomRange(params) {
        var validation = validateParams(params, ["startTick", "endTick", "startStaff", "endStaff"]);
        if (!validation.valid) return validation;

        return executeWithUndo(function() {
            var startTick = params.startTick, endTick = params.endTick;
            var startStaff = params.startStaff, endStaff = params.endStaff;

            curScore.selection.clear();
            curScore.selection.selectRange(startTick, endTick, startStaff, endStaff);

            var elementsMap = {};
            for (var st = startStaff; st <= endStaff; st++) elementsMap["staff" + st] = [];

            var c = createCursor({ startTick: 0, startStaff: startStaff });
            c.rewind(0);
            var currentSegment = c.segment;
            while (currentSegment && currentSegment.tick < startTick) currentSegment = currentSegment.next;

            while (currentSegment && currentSegment.tick < endTick) {
                for (var s = startStaff; s <= endStaff; s++) {
                    for (var v = 0; v < 4; v++) {
                        var track = s * 4 + v;
                        var el = currentSegment.elementAt(track);
                        if (el) {
                            var processed = processElement(el);
                            if (processed) {
                                processed.voice = v;
                                processed.startTick = currentSegment.tick;
                                elementsMap["staff" + s].push(processed);
                            }
                        }
                    }
                }
                currentSegment = currentSegment.next;
            }

            selectionState = {
                startStaff: startStaff, endStaff: endStaff, startTick: startTick,
                elements: elementsMap, totalDuration: endTick - startTick
            };
            return { success: true, message: "Custom range mapped", currentSelection: selectionState };
        });
    }

    // ========================================================================
    // NOTE & MUSIC OPERATIONS
    // ========================================================================

    function addNote(params) {
        var validation = validateParams(params, ["pitch", "duration", "advanceCursorAfterAction"]);
        if (!validation.valid) return validation;
        if (!params.duration.numerator || !params.duration.denominator) {
            return { error: "Duration must be specified as { numerator: int, denominator: int }" };
        }
        return executeWithUndo(function() {
            syncStateToSelection();
            var cursor = inputCursorAt(selectionState.startTick, selectionState.startStaff || 0);
            cursor.setDuration(params.duration.numerator, params.duration.denominator);
            var pitchStr = params.pitch.toString();
            var pitchArr = [];
            if (pitchStr.indexOf(',') !== -1) {
                var parts = pitchStr.split(',');
                for (var j = 0; j < parts.length; j++) {
                    pitchArr.push(parseInt(parts[j], 10));
                }
            } else {
                pitchArr = [parseInt(pitchStr, 10)];
            }
            cursor.addNote(pitchArr[0], false);
            for (var i = 1; i < pitchArr.length; i++) {
                cursor.addNote(pitchArr[i], true);
            }
            cursor.rewindToTick(selectionState.startTick);
            if (params.advanceCursorAfterAction) cursor.next();

            var element = processElement(cursor.element);
            var startTick = cursor.tick;
            var staffIdx = cursor.staffIdx;

            curScore.selection.clear();
            curScore.selection.selectRange(startTick, startTick + element.durationTicks, staffIdx, staffIdx + 1);

            selectionState = {
                startStaff: staffIdx, endStaff: staffIdx + 1, startTick: startTick,
                elements: [element], totalDuration: element.durationTicks
            };
            return { success: true, message: "Note added with pitch " + params.pitch, currentSelection: selectionState };
        });
    }

    function addRest(params) {
        var validation = validateParams(params, ["duration", "advanceCursorAfterAction"]);
        if (!validation.valid) return validation;
        if (!params.duration.numerator || !params.duration.denominator) {
            return { error: "Duration must be specified as { numerator: int, denominator: int }" };
        }

        return executeWithUndo(function() {
            syncStateToSelection();
            var cursor = inputCursorAt(selectionState.startTick, selectionState.startStaff || 0);
            cursor.setDuration(params.duration.numerator, params.duration.denominator);
            cursor.addRest();
            cursor.rewindToTick(selectionState.startTick);
            if (params.advanceCursorAfterAction) cursor.next();

            var element = processElement(cursor.element);
            var startTick = cursor.tick;
            var staffIdx = cursor.staffIdx;

            curScore.selection.clear();
            curScore.selection.selectRange(startTick, startTick + element.durationTicks, staffIdx, staffIdx + 1);

            selectionState = {
                startStaff: staffIdx, endStaff: staffIdx + 1, startTick: startTick,
                elements: [element], totalDuration: element.durationTicks
            };
            return { success: true, message: "Rest added", currentSelection: selectionState };
        });
    }

    function addTuplet(params) {
        var validation = validateParams(params, ["ratio", "duration", "advanceCursorAfterAction"]);
        if (!validation.valid) return validation;
        if (!params.ratio.numerator || !params.ratio.denominator ||
            !params.duration.numerator || !params.duration.denominator) {
            return { error: "Ratio and duration must be specified as { numerator: int, denominator: int }" };
        }

        return executeWithUndo(function() {
            syncStateToSelection();
            var cursor = inputCursorAt(selectionState.startTick, selectionState.startStaff || 0);
            cursor.setDuration(params.duration.numerator, params.duration.denominator);

            var ratio = fraction(params.ratio.numerator, params.ratio.denominator);
            var duration = fraction(params.duration.numerator, params.duration.denominator);
            cursor.addTuplet(ratio, duration);
            cursor.next();
            if (params.advanceCursorAfterAction) cursor.next();

            var element = processElement(cursor.element);
            var startTick = cursor.tick;
            var staffIdx = cursor.staffIdx;

            selectionState = {
                startStaff: staffIdx, endStaff: staffIdx + 1, startTick: startTick,
                elements: [element], totalDuration: element.durationTicks
            };
            return {
                success: true,
                message: "Tuplet " + params.ratio.numerator + ":" + params.ratio.denominator + " added",
                currentSelection: selectionState
            };
        });
    }

    function addLyrics(params) {
        if (!params || !params.lyrics || !Array.isArray(params.lyrics) || params.lyrics.length === 0) {
            return { error: "Lyrics must be specified as an array of strings" };
        }

        return executeWithUndo(function() {
            syncStateToSelection();
            var cursor = createCursor({ startTick: selectionState.startTick, startStaff: selectionState.startStaff });

            var lyricsArray = params.lyrics.slice();
            var verse = params.verse || 0;
            var addedCount = 0, skippedCount = 0;

            while (cursor.element && lyricsArray.length > 0) {
                var element = cursor.element;
                if (element.type === Element.CHORD || element.name === "Chord") {
                    var lyr = newElement(Element.LYRICS);
                    lyr.text = lyricsArray.shift();
                    lyr.verse = verse;
                    cursor.add(lyr);
                    addedCount++;
                } else if (element.type === Element.REST || element.name === "Rest") {
                    skippedCount++;
                }
                if (!cursor.next()) break;
            }

            var finalElement = processElement(cursor.element) || selectionState.elements[0];
            var finalTick = cursor.tick;
            var staffIdx = cursor.staffIdx;

            selectionState = {
                startStaff: staffIdx, endStaff: staffIdx + 1, startTick: finalTick,
                elements: [finalElement], totalDuration: (finalElement && finalElement.durationTicks) || selectionState.totalDuration
            };

            curScore.selection.clear();
            curScore.selection.selectRange(finalTick, finalTick + ((finalElement && finalElement.durationTicks) || 0), staffIdx, staffIdx + 1);

            var message = "Added " + addedCount + " lyrics";
            if (skippedCount > 0) message += ", skipped " + skippedCount + " rests";
            if (lyricsArray.length > 0) message += ", " + lyricsArray.length + " lyrics remaining";

            return {
                success: true, message: message, addedCount: addedCount,
                skippedCount: skippedCount, remainingLyrics: lyricsArray, currentSelection: selectionState
            };
        });
    }

    // ------------------------------------------------------------------------
    // TEXT MARKERS (section labels, rehearsal marks, staff cues)
    //
    // All three are "annotation" elements attached to a segment (the same way
    // setTempo attaches a TEMPO_TEXT). They differ only by element type and
    // intended use:
    //   - SYSTEM_TEXT    one label above the system, shows on every part —
    //                    the natural way to mark sections ("Verse", "Chorus").
    //   - REHEARSAL_MARK the boxed A/B/C section markers.
    //   - STAFF_TEXT     a cue attached to a single staff only.
    //
    // Position resolution (first match wins):
    //   params.measure (1-based) -> params.tick -> current selection.
    // `staff` defaults per element type (system text / rehearsal marks belong
    // on the top staff) but can be overridden.
    // ------------------------------------------------------------------------
    function addTextMarker(params, elementType, label, defaultStaff) {
        var validation = validateParams(params, ["text"]);
        if (!validation.valid) return validation;

        return executeWithUndo(function() {
            var staff = (params.staff !== undefined) ? params.staff : defaultStaff;
            var cursor;
            if (params.measure !== undefined) {
                // 1-based to match go_to_measure / get_score numbering.
                cursor = createCursor({ measure: params.measure - 1, startStaff: staff || 0 });
            } else if (params.tick !== undefined) {
                cursor = createCursor({ startTick: params.tick, startStaff: staff || 0 });
            } else {
                syncStateToSelection();
                cursor = createCursor({
                    startTick: selectionState.startTick,
                    startStaff: (staff !== undefined ? staff : selectionState.startStaff) || 0
                });
            }
            if (!cursor.segment) return { error: "No valid position to attach " + label };

            var el = newElement(elementType);
            el.text = params.text;
            cursor.add(el);

            return {
                success: true,
                message: label + " added: \"" + params.text + "\"",
                currentSelection: selectionState
            };
        });
    }

    function addSystemText(params)    { return addTextMarker(params, Element.SYSTEM_TEXT,    "System text",    0); }
    function addStaffText(params)     { return addTextMarker(params, Element.STAFF_TEXT,     "Staff text",     undefined); }
    function addRehearsalMark(params) { return addTextMarker(params, Element.REHEARSAL_MARK, "Rehearsal mark", 0); }

    // Chord symbols are HARMONY annotations: the .text ("Cm7", "G/B", "F#dim")
    // is parsed by MuseScore into a properly formatted chord symbol. Defaults to
    // the top staff (where chord symbols conventionally sit); for precise beat
    // placement pass `tick` rather than `measure`.
    //
    // HARMONY needs special handling and CANNOT go through addTextMarker:
    // setting .text on an un-parented Harmony hard-CRASHES MuseScore 4. The
    // element must be added to the score FIRST, then its text set in a separate
    // command so the parse/layout commits cleanly.
    function addChordSymbol(params) {
        var validation = validateParams(params, ["text"]);
        if (!validation.valid) return validation;
        if (!curScore) return { error: "No score open" };
        try {
            var staff = (params.staff !== undefined) ? params.staff : 0;
            var cursor;
            if (params.measure !== undefined) {
                cursor = createCursor({ measure: params.measure - 1, startStaff: staff || 0 });
            } else if (params.tick !== undefined) {
                cursor = createCursor({ startTick: params.tick, startStaff: staff || 0 });
            } else {
                syncStateToSelection();
                cursor = createCursor({ startTick: selectionState.startTick, startStaff: staff || 0 });
            }
            if (!cursor.segment) return { error: "No valid position to attach chord symbol" };

            var harmony = newElement(Element.HARMONY);
            cursor.add(harmony);                 // add BEFORE setting text (else crash)
            curScore.startCmd();
            harmony.text = params.text;          // parse/layout commits on endCmd
            curScore.endCmd();

            return {
                success: true,
                message: "Chord symbol added: \"" + params.text + "\"",
                currentSelection: selectionState
            };
        } catch (e) {
            return { error: e.toString() };
        }
    }

    // ========================================================================
    // MEASURE OPERATIONS
    // ========================================================================

    function appendMeasure(params) {
        return executeWithUndo(function() {
            var count = (params && params.count) || 1;
            for (var i = 0; i < count; i++) cmd("append-measure");
            return { success: true, message: count + " measure(s) appended", currentSelection: selectionState };
        });
    }

    function insertMeasure(params) {
        return executeWithUndo(function() {
            cmd("insert-measure");
            syncStateToSelection();
            return { success: true, message: "Measure inserted", currentSelection: selectionState };
        });
    }

    function deleteSelection(params) {
        return executeWithUndo(function() {
            if (params && params.measure) createCursor({ measure: params.measure });
            cmd("delete");
            return {
                success: true,
                message: "Selection deleted",
                warning: UNDO_DELETE_WARNING,
                currentSelection: selectionState
            };
        });
    }

    // ========================================================================
    // STAFF & INSTRUMENT OPERATIONS
    // ========================================================================

    function addInstrument(params) {
        var validation = validateParams(params, ["instrumentId"]);
        if (!validation.valid) return validation;
        return executeWithUndo(function() {
            curScore.appendPart(params.instrumentId);
            return { success: true, message: "Instrument " + params.instrumentId + " added" };
        });
    }

    function setStaffMute(params) {
        var validation = validateParams(params, ["staff"]);
        if (!validation.valid) return validation;
        return executeWithUndo(function() {
            var staff = (curScore.staves && curScore.staves[params.staff]) ||
                        (typeof curScore.staff === "function" ? curScore.staff(params.staff) : null);
            if (staff) {
                staff.invisible = Boolean(params.mute);
                return { success: true, message: "Staff " + (params.mute ? "muted" : "unmuted") };
            }
            return { error: "Staff not found" };
        });
    }

    function setInstrumentSound(params) {
        var validation = validateParams(params, ["staff", "instrumentId"]);
        if (!validation.valid) return validation;
        return executeWithUndo(function() {
            cmd("instruments");
            return { success: true, message: "Instrument dialog opened, manual selection required" };
        });
    }

    function setTimeSignature(params) {
        var validation = validateParams(params, ["numerator", "denominator"]);
        if (!validation.valid) return validation;
        return executeWithUndo(function() {
            var cursor = createCursor();
            var ts = newElement(Element.TIMESIG);
            ts.timesig = fraction(params.numerator, params.denominator);
            cursor.add(ts);
            return { success: true, message: "Time signature set to " + params.numerator + "/" + params.denominator };
        });
    }

    function setTempo(params) {
        var validation = validateParams(params, ["bpm"]);
        if (!validation.valid) return validation;
        return executeWithUndo(function() {
            var cursor = createCursor();
            var tempo = newElement(Element.TEMPO_TEXT);
            tempo.tempo = params.bpm / 60.0;
            tempo.text = "♩ = " + params.bpm;
            cursor.add(tempo);
            return { success: true, message: "Tempo set to " + params.bpm + " BPM" };
        });
    }

    // ========================================================================
    // SCORE ANALYSIS
    // ========================================================================

    function getScore(params) {
        if (!curScore) return { error: "No score open" };
        try {
            return { success: true, analysis: getScoreSummary(params) };
        } catch (e) {
            return { error: e.toString() };
        }
    }

    // Optional params.startMeasure / params.endMeasure (1-based, inclusive)
    // limit the returned measures to slim the payload.
    function getScoreSummary(params) {
        if (!curScore) return { error: "No score open" };

        return executeWithUndo(function() {
            var tempState = selectionState;
            var score = {
                title: curScore.metaTag("workTitle") || curScore.title || "",
                numMeasures: curScore.nmeasures,
                measures: [],
                staves: []
            };

            // Musical context (key / tempo) read at the start of the score, so the
            // model can see what it's writing against. Per-measure time signatures
            // are captured in the measure loop below (they can change mid-score).
            var ctxCursor = createCursor({ startTick: 0 });
            try {
                if (ctxCursor.keySignature !== undefined && ctxCursor.keySignature !== null) {
                    score.keySig = ctxCursor.keySignature;   // sharps (+) / flats (-)
                }
            } catch (eKey) {}
            try {
                if (ctxCursor.tempo) score.tempo = Math.round(ctxCursor.tempo * 60);
            } catch (eTempo) {}

            for (var i = 0; i < curScore.nstaves; i++) {
                var staff = (curScore.staves && curScore.staves[i]) ||
                            (typeof curScore.staff === "function" ? curScore.staff(i) : null);
                score.staves.push({
                    name: "staff" + i,
                    shortName: staff ? staff.shortName : "",
                    visible: staff ? !staff.invisible : true
                });
            }

            var cursor = createCursor({ startTick: 0 });
            var measureBoundaries = [];
            for (var m = 0; m < curScore.nmeasures; m++) {
                var measure = { measure: m + 1, startTick: cursor.tick, numElements: 0, elements: {} };
                for (var j = 0; j < curScore.nstaves; j++) measure.elements["staff" + j] = [];
                // Nominal time signature of this measure (may differ from neighbours).
                try {
                    var tsObj = cursor.measure ? cursor.measure.timesigNominal : null;
                    if (tsObj) measure.timeSig = { numerator: tsObj.numerator, denominator: tsObj.denominator };
                } catch (eTs) {}
                measureBoundaries.push(cursor.tick);
                score.measures.push(measure);
                cursor.nextMeasure();
            }

            for (var k = 0; k < curScore.nstaves; k++) {
                cursor.rewind(0);
                var currentSegment = cursor.segment;
                while (currentSegment) {
                    var measureIdx = measureBoundaries.filter(function(tick) {
                        return tick <= currentSegment.tick;
                    }).length - 1;
                    for (var v = 0; v < 4; v++) {
                        var track = k * 4 + v;
                        var el = currentSegment.elementAt(track);
                        if (el) {
                            score.measures[measureIdx].numElements++;
                            var processedElement = processElement(el);
                            if (processedElement) {
                                processedElement.startTick = currentSegment.tick;
                                processedElement.voice = v;
                                score.measures[measureIdx].elements["staff" + k].push(processedElement);
                            }
                        }
                    }
                    currentSegment = currentSegment.next;
                }
            }

            // Section markers / rehearsal marks / staff cues are segment
            // annotations, not note-track elements, so they need their own
            // pass. Collect them per measure so the model can see existing
            // section structure (and verify markers it just wrote).
            cursor.rewind(0);
            var annSeg = cursor.segment;
            while (annSeg) {
                var anns = annSeg.annotations;
                if (anns && anns.length) {
                    var mi = measureBoundaries.filter(function(tick) {
                        return tick <= annSeg.tick;
                    }).length - 1;
                    if (mi >= 0) {
                        for (var ai = 0; ai < anns.length; ai++) {
                            var ann = anns[ai];
                            if (!ann) continue;
                            if (ann.name === "SystemText" || ann.name === "StaffText" ||
                                ann.name === "RehearsalMark" || ann.name === "Harmony") {
                                if (!score.measures[mi].markers) score.measures[mi].markers = [];
                                score.measures[mi].markers.push({
                                    type: ann.name,
                                    text: ann.text,
                                    startTick: annSeg.tick
                                });
                            }
                        }
                    }
                }
                annSeg = annSeg.next;
            }

            // Optional measure-range slice (keeps numMeasures for context)
            if (params && (params.startMeasure || params.endMeasure)) {
                var lo = (params.startMeasure || 1) - 1;
                var hi = (params.endMeasure || score.measures.length);
                if (lo < 0) lo = 0;
                score.measures = score.measures.slice(lo, hi);
            }

            selectionState = tempState;
            return score;
        });
    }

    // ------------------------------------------------------------------------
    return { processCommand: processCommand };
})
