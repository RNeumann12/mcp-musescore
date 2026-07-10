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
            case "diagnose":             return diagnose(command.params);
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

            // Fretting / playability
            case "dumpFingering":        return dumpFingering(command.params);
            case "setNoteString":        return setNoteString(command.params);
            case "moveNoteString":       return moveNoteString(command.params);

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
            case "addSlide":             return addSlide(command.params);

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

    function executeReadOnly(operation) {
        if (!curScore) return { error: "No score open" };
        try {
            return operation();
        } catch (e) {
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
            var insertedTick = selectionState.startTick;
            var insertedStaff = selectionState.startStaff || 0;
            var cursor = inputCursorAt(insertedTick, insertedStaff);
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

            var element = processElement(cursor.element);
            if (!element) return { error: "Could not read inserted note" };
            element.startTick = insertedTick;
            var insertedSelection = {
                startStaff: insertedStaff, endStaff: insertedStaff + 1, startTick: insertedTick,
                elements: [element], totalDuration: element.durationTicks
            };

            var nextTick = insertedTick;
            var nextStaff = insertedStaff;
            if (params.advanceCursorAfterAction) {
                cursor.rewindToTick(insertedTick);
                if (cursor.next()) {
                    nextTick = cursor.tick;
                    nextStaff = cursor.staffIdx;
                } else {
                    nextTick = insertedTick + element.durationTicks;
                }
            }

            curScore.selection.clear();
            curScore.selection.selectRange(nextTick, nextTick + element.durationTicks, nextStaff, nextStaff + 1);

            selectionState = params.advanceCursorAfterAction ? {
                startStaff: nextStaff, endStaff: nextStaff + 1, startTick: nextTick,
                elements: [], totalDuration: element.durationTicks
            } : insertedSelection;
            return { success: true, message: "Note added with pitch " + params.pitch, currentSelection: insertedSelection };
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
            var insertedTick = selectionState.startTick;
            var insertedStaff = selectionState.startStaff || 0;
            var cursor = inputCursorAt(insertedTick, insertedStaff);
            cursor.setDuration(params.duration.numerator, params.duration.denominator);
            cursor.addRest();

            var element = processElement(cursor.element);
            if (!element) return { error: "Could not read inserted rest" };
            element.startTick = insertedTick;
            var insertedSelection = {
                startStaff: insertedStaff, endStaff: insertedStaff + 1, startTick: insertedTick,
                elements: [element], totalDuration: element.durationTicks
            };

            var nextTick = insertedTick;
            var nextStaff = insertedStaff;
            if (params.advanceCursorAfterAction) {
                cursor.rewindToTick(insertedTick);
                if (cursor.next()) {
                    nextTick = cursor.tick;
                    nextStaff = cursor.staffIdx;
                } else {
                    nextTick = insertedTick + element.durationTicks;
                }
            }

            curScore.selection.clear();
            curScore.selection.selectRange(nextTick, nextTick + element.durationTicks, nextStaff, nextStaff + 1);

            selectionState = params.advanceCursorAfterAction ? {
                startStaff: nextStaff, endStaff: nextStaff + 1, startTick: nextTick,
                elements: [], totalDuration: element.durationTicks
            } : insertedSelection;
            return { success: true, message: "Rest added", currentSelection: insertedSelection };
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

            var element = processElement(cursor.element);
            if (!element) return { error: "Could not read inserted tuplet" };
            var insertedTick = cursor.tick;
            var insertedStaff = cursor.staffIdx;
            element.startTick = insertedTick;
            var insertedSelection = {
                startStaff: insertedStaff, endStaff: insertedStaff + 1, startTick: insertedTick,
                elements: [element], totalDuration: element.durationTicks
            };

            var nextTick = insertedTick;
            var nextStaff = insertedStaff;
            if (params.advanceCursorAfterAction) {
                if (cursor.next()) {
                    nextTick = cursor.tick;
                    nextStaff = cursor.staffIdx;
                } else {
                    nextTick = insertedTick + element.durationTicks;
                }
            }

            curScore.selection.clear();
            curScore.selection.selectRange(nextTick, nextTick + element.durationTicks, nextStaff, nextStaff + 1);

            selectionState = params.advanceCursorAfterAction ? {
                startStaff: nextStaff, endStaff: nextStaff + 1, startTick: nextTick,
                elements: [], totalDuration: element.durationTicks
            } : insertedSelection;
            return {
                success: true,
                message: "Tuplet " + params.ratio.numerator + ":" + params.ratio.denominator + " added",
                currentSelection: insertedSelection
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

    // A slide/glissando is a SPANNER attached to a note (not a segment
    // annotation): it runs from the note it is added to, to the *next* note in
    // the same voice/staff. The straight type is what guitar tab renders as a
    // slanted slide line (and plays as a pitch slide); "wavy" is the classic
    // glissando squiggle.
    //
    // Position resolution mirrors the text markers: measure (1-based) -> tick ->
    // current selection. A chord at the start position is disambiguated by
    // `pitch` (otherwise the lone/top note is used). There MUST be a following
    // note in the same voice for the slide to land on.
    function addSlide(params) {
        if (!curScore) return { error: "No score open" };
        params = params || {};
        var staff = (params.staff !== undefined) ? params.staff : 0;
        var voice = params.voice || 0;

        // Resolve the start tick.
        var tick;
        if (params.tick !== undefined) {
            tick = params.tick;
        } else if (params.measure !== undefined) {
            var mc = createCursor({ measure: params.measure - 1, startStaff: staff });
            tick = mc.tick;
        } else {
            syncStateToSelection();
            tick = selectionState.startTick;
            if (params.staff === undefined) staff = selectionState.startStaff || 0;
        }

        return executeWithUndo(function() {
            var found = noteAt(staff, voice, tick, params.pitch);
            if (found.error) return found;
            var note = found.note;

            var gliss = newElement(Element.GLISSANDO);
            // GlissandoType: STRAIGHT = 0 (slide), WAVY = 1. Tolerate API
            // variance — the element defaults to straight if the setter is
            // unavailable.
            var wavy = (params.type && String(params.type).toLowerCase() === "wavy");
            try { gliss.glissandoType = wavy ? 1 : 0; } catch (eType) {}
            // Guitar slides carry no "gliss." label; only show text if asked.
            try {
                if (params.text) { gliss.showText = true; gliss.text = params.text; }
                else { gliss.showText = false; }
            } catch (eText) {}

            note.add(gliss);

            return {
                success: true,
                message: "Slide added at tick " + tick + " staff " + staff +
                         " (pitch " + note.pitch + ")",
                currentSelection: selectionState
            };
        });
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

        return executeReadOnly(function() {
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
                score.staves.push(describeStaff(staffAt(i), i));
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

    // ========================================================================
    // INSTRUMENT / STAFF INTROSPECTION
    //
    // The LilyPond dump is anonymous ("staff0".."staffN"), which forces the
    // caller to guess (or screenshot) which staff is which instrument. These
    // helpers attach the real part name and, for fretted/tab staves, the string
    // count and capo. Every property access is defensive: the plugin API surface
    // for Part / Instrument / StringData varies across MS4 point releases, and a
    // missing field must never break getScore.
    // ========================================================================

    function staffAt(idx) {
        return (curScore.staves && curScore.staves[idx]) ||
               (typeof curScore.staff === "function" ? curScore.staff(idx) : null);
    }

    function staffPart(staff) {
        if (!staff) return null;
        try { return staff.part || null; } catch (e) { return null; }
    }

    // The active Instrument for a part. MS4 exposes it via instrumentAtTick();
    // `part.instrument` is undefined in current builds, so try both.
    function resolveInstrument(part) {
        if (!part) return null;
        try { if (part.instrument) return part.instrument; } catch (e) {}
        try { if (part.instrumentAtTick) return part.instrumentAtTick(0); } catch (e2) {}
        return null;
    }

    // Whether an instrument is genuinely fretted (so its notes map to a real
    // fretboard and MuseScore can draw them red). Every MS4 instrument carries a
    // *default* StringData, so stringData presence alone is not a reliable signal
    // — drumsets and pitched non-fretted instruments have one too. Gate on the
    // instrument family instead, excluding drumsets explicitly.
    var FRETTED_FAMILIES = [
        "guitar", "bass", "ukulele", "banjo", "mandolin", "lute", "cavaquinho",
        "bouzouki", "balalaika", "charango", "sitar", "oud", "vihuela"
    ];
    function instrumentIsFretted(instr) {
        if (!instr) return false;
        try { if (instr.useDrumset) return false; } catch (e) {}
        var id = "";
        try { id = (instr.instrumentId || "").toLowerCase(); } catch (e2) {}
        for (var i = 0; i < FRETTED_FAMILIES.length; i++) {
            if (id.indexOf(FRETTED_FAMILIES[i]) !== -1) return true;
        }
        return false;
    }

    // {strings, frets} for a fretted instrument, else null. Bowed strings report
    // frets === 0, which callers treat as "not fretted".
    function stringInfo(instr) {
        if (!instr) return null;
        try {
            var sd = instr.stringData;
            if (sd && sd.strings && sd.strings.length) {
                var frets = 0;
                try { if (typeof sd.frets === "number") frets = sd.frets; } catch (e) {}
                return { strings: sd.strings.length, frets: frets };
            }
        } catch (e2) {}
        return null;
    }

    // Capo changes on a staff as [{tick, fret}] sorted by tick. The capo lives in
    // a "Capo" annotation (its fretPosition); filtered to this staff by track so a
    // capo on one guitar isn't attributed to another.
    function capoEvents(staffIdx) {
        var events = [];
        try {
            var c = curScore.newCursor();
            c.staffIdx = staffIdx; c.voice = 0; c.rewind(0);
            var seg = c.segment;
            while (seg) {
                var anns = seg.annotations;
                if (anns && anns.length) {
                    for (var i = 0; i < anns.length; i++) {
                        var an = anns[i];
                        if (!an || !an.name) continue;
                        if (an.name.toLowerCase().indexOf("capo") === -1) continue;
                        var tr = 0; try { tr = an.track || 0; } catch (eT) {}
                        if ((tr >> 2) !== staffIdx) continue;   // belongs to another staff
                        var fret = 0; try { fret = an.fretPosition || 0; } catch (eF) {}
                        events.push({ tick: seg.tick, fret: fret });
                    }
                }
                seg = seg.next;
            }
        } catch (e) {}
        events.sort(function (a, b) { return a.tick - b.tick; });
        return events;
    }

    function activeCapo(events, tick) {
        var fret = 0;
        for (var i = 0; i < events.length; i++) {
            if (events[i].tick <= tick) fret = events[i].fret; else break;
        }
        return fret;
    }

    // ========================================================================
    // FRETTING / PLAYABILITY
    //
    // The LilyPond view shows pitch only; a note's *fingering* (which string and
    // therefore which fret it is played at) is invisible there. On a fretted
    // instrument a pitch can sit on several strings, and a bad choice forces high
    // frets / position jumps that are awkward to play. These three actions expose
    // and edit that assignment without changing pitch:
    //   * dumpFingering  - read string/fret per note + the staff's open-string
    //                      tuning and any capo (so a caller can plan moves).
    //   * setNoteString  - move one note to an absolute string, recomputing the
    //                      fret from the tuning so the pitch is preserved.
    //   * moveNoteString - relative move via MuseScore's own string-above/below
    //                      commands (fallback if direct property writes are
    //                      read-only on a given build).
    // ========================================================================

    // Open-string MIDI pitches for a staff, indexed by MuseScore string index
    // (0 = top TAB line). Defensive about the StringData shape, which varies.
    function staffTuning(staffIdx) {
        var instr = resolveInstrument(staffPart(staffAt(staffIdx)));
        var tuning = [];
        try {
            var sd = instr && instr.stringData;
            if (sd && sd.strings) {
                for (var s = 0; s < sd.strings.length; s++) {
                    var entry = sd.strings[s];
                    var p = null;
                    try { p = (typeof entry === "number") ? entry : entry.pitch; } catch (e) {}
                    tuning.push(p);
                }
            }
        } catch (e2) {}
        return tuning;
    }

    // Map measure index from a tick using cached boundaries.
    function measureBoundaries() {
        var boundaries = [];
        var bcur = curScore.newCursor();
        bcur.rewind(0);
        for (var m = 0; m < curScore.nmeasures; m++) { boundaries.push(bcur.tick); bcur.nextMeasure(); }
        return boundaries;
    }

    function dumpFingering(params) {
        if (!curScore) return { error: "No score open" };
        params = params || {};
        var staffIdx = params.staff || 0;
        var lo = params.startMeasure ? params.startMeasure - 1 : 0;
        var hi = params.endMeasure ? params.endMeasure : curScore.nmeasures;

        var tuning = staffTuning(staffIdx);
        var caps = capoEvents(staffIdx);
        var boundaries = measureBoundaries();
        function measureOf(tick) {
            var mi = 0;
            for (var b = 0; b < boundaries.length; b++) { if (boundaries[b] <= tick) mi = b; else break; }
            return mi;
        }

        var notes = [];
        var cur = curScore.newCursor();
        cur.staffIdx = staffIdx;
        cur.rewind(0);
        var seg = cur.segment;
        while (seg) {
            var mi2 = measureOf(seg.tick);
            if (mi2 >= lo && mi2 < hi) {
                for (var v = 0; v < 4; v++) {
                    var el = seg.elementAt(staffIdx * 4 + v);
                    if (el && el.name === "Chord" && el.notes) {
                        var keys = Object.keys(el.notes);
                        for (var n = 0; n < keys.length; n++) {
                            var note = el.notes[keys[n]];
                            var st, fr;
                            try { st = note.string; } catch (eS) { st = null; }
                            try { fr = note.fret; } catch (eF) { fr = null; }
                            notes.push({
                                measure: mi2 + 1, tick: seg.tick, voice: v,
                                pitch: note.pitch, name: getTpcName(note.tpc),
                                string: st, fret: fr
                            });
                        }
                    }
                }
            }
            seg = seg.next;
        }
        return { success: true, staff: staffIdx, tuning: tuning, capos: caps, notes: notes };
    }

    // Locate a single note at (tick, staff, voice); disambiguate a chord by pitch.
    function noteAt(staffIdx, voice, tick, pitch) {
        var c = curScore.newCursor();
        c.staffIdx = staffIdx; c.voice = voice || 0; c.rewind(0);
        try { c.rewindToTick(tick); } catch (e) { while (c.tick < tick && c.next()) {} }
        var el = c.element;
        if (!el || el.name !== "Chord") {
            return { error: "No chord at tick " + tick + " staff " + staffIdx + " voice " + (voice || 0) };
        }
        var keys = Object.keys(el.notes);
        if (pitch !== undefined && pitch !== null) {
            for (var i = 0; i < keys.length; i++) {
                if (el.notes[keys[i]].pitch === pitch) return { note: el.notes[keys[i]], chord: el };
            }
            return { error: "No note of pitch " + pitch + " in chord at tick " + tick };
        }
        if (keys.length === 1) return { note: el.notes[keys[0]], chord: el };
        return { error: "Chord at tick " + tick + " has " + keys.length + " notes; pass pitch" };
    }

    function setNoteString(params) {
        var v = validateParams(params, ["tick", "staff", "string"]);
        if (!v.valid) return v;
        return executeWithUndo(function() {
            var found = noteAt(params.staff, params.voice || 0, params.tick, params.pitch);
            if (found.error) return found;
            var note = found.note;
            var oldString = note.string, oldFret = note.fret, oldPitch = note.pitch;

            var fret = params.fret;
            if (fret === undefined || fret === null) {
                // Self-calibrate from this note's *current* string/fret so we
                // depend on neither the StringData array's order/octave nor the
                // instrument transposition. The array is reverse-ordered relative
                // to note.string (index 0 = top TAB line); openSounding(s) =
                // raw[N-1-s] - offset, where offset is fixed by the known current
                // string: raw[N-1-oldString] - (oldPitch - oldFret).
                var tuning = staffTuning(params.staff);
                var N = tuning.length;
                if (!N || oldString === undefined || oldString === null) {
                    return { error: "No tuning to compute fret; pass fret explicitly" };
                }
                var curOpenObserved = oldPitch - oldFret;
                var rawCur = tuning[N - 1 - oldString];
                var rawTgt = tuning[N - 1 - params.string];
                if (rawCur === undefined || rawCur === null ||
                    rawTgt === undefined || rawTgt === null) {
                    return { error: "No tuning for string " + params.string + "; pass fret explicitly" };
                }
                var offset = rawCur - curOpenObserved;
                var open = rawTgt - offset;
                var capo = activeCapo(capoEvents(params.staff), params.tick);
                fret = oldPitch - open - capo;
            }
            if (fret < 0) {
                return { error: "String " + params.string + " yields negative fret " + fret +
                                " for pitch " + oldPitch + " (note too low for that string)" };
            }
            note.string = params.string;
            note.fret = fret;
            return {
                success: true, tick: params.tick, pitch: oldPitch,
                from: { string: oldString, fret: oldFret },
                to: { string: note.string, fret: note.fret },
                pitchPreserved: (note.pitch === oldPitch)
            };
        });
    }

    // Relative move using MuseScore's own commands. Positive `moves` = toward the
    // top TAB line (string-above); negative = string-below. Runs outside
    // startCmd/endCmd because cmd() manages its own undo transaction.
    function moveNoteString(params) {
        var v = validateParams(params, ["tick", "staff", "moves"]);
        if (!v.valid) return v;
        var found = noteAt(params.staff, params.voice || 0, params.tick, params.pitch);
        if (found.error) return found;
        var note = found.note;
        var before = { string: note.string, fret: note.fret, pitch: note.pitch };
        try {
            curScore.selection.clear();
            curScore.selection.select(note, false);
        } catch (eSel) {
            return { error: "Could not select note: " + eSel.toString() };
        }
        var action = params.moves > 0 ? "string-above" : "string-below";
        var n = Math.abs(params.moves);
        for (var i = 0; i < n; i++) { cmd(action); }
        var re = noteAt(params.staff, params.voice || 0, params.tick, params.pitch);
        var after = re.note ? { string: re.note.string, fret: re.note.fret, pitch: re.note.pitch } : null;
        return { success: true, action: action, count: n, from: before, to: after };
    }

    // Human-facing staff descriptor used by getScore (name/visible kept for
    // backwards compatibility; instrument/strings/capo are the new fields).
    function describeStaff(staff, idx) {
        var info = {
            name: "staff" + idx,
            shortName: "",
            visible: staff ? !staff.invisible : true
        };
        try { info.shortName = staff ? (staff.shortName || "") : ""; } catch (eSn) {}

        var part = staffPart(staff);
        if (part) {
            try { info.instrument = part.longName || part.partName || part.shortName || ""; } catch (eLn) {}
            try { if (part.instrumentId) info.instrumentId = part.instrumentId; } catch (eId) {}
        }
        var instr = resolveInstrument(part);
        if (instrumentIsFretted(instr)) {
            var si = stringInfo(instr);
            if (si && si.strings) info.strings = si.strings;
            var caps = capoEvents(idx);
            if (caps.length && caps[0].fret) info.capo = caps[0].fret;
        }
        return info;
    }

    // ========================================================================
    // DIAGNOSTICS
    //
    // Surfaces problems invisible in the LilyPond text because they are about
    // *rendering*, not note content:
    //   * out_of_range  - on a fretted staff, a note whose assigned fret can't be
    //                     played: below the capo, above the top fret, or with no
    //                     valid string. This is the condition MuseScore draws red.
    //   * overfull/underfull_measure - a voice whose written rhythm doesn't sum to
    //                     the bar length.
    // MS4 does not expose an instrument pitch range, so range detection works off
    // note.fret/note.string and therefore only runs on fretted instruments.
    // Optional startMeasure/endMeasure (1-based, inclusive) limit the scan.
    // ========================================================================

    function diagnose(params) {
        if (!curScore) return { error: "No score open" };
        return executeReadOnly(function() {
            var lo = (params && params.startMeasure) ? params.startMeasure - 1 : 0;
            var hi = (params && params.endMeasure) ? params.endMeasure : curScore.nmeasures;

            // Per-staff context: name + (for fretted staves) fret count and capo.
            var staffCtx = [];
            for (var i = 0; i < curScore.nstaves; i++) {
                var staff = staffAt(i);
                var part = staffPart(staff);
                var instr = resolveInstrument(part);
                var fretted = instrumentIsFretted(instr);
                var si = fretted ? stringInfo(instr) : null;
                staffCtx.push({
                    name: part ? (part.longName || part.partName || ("staff" + i)) : ("staff" + i),
                    fretted: fretted,
                    frets: si ? si.frets : 0,
                    capos: fretted ? capoEvents(i) : []
                });
            }

            // Measure boundaries -> per-measure length (next start - this start).
            var boundaries = [];
            var bcur = createCursor({ startTick: 0 });
            for (var m = 0; m < curScore.nmeasures; m++) {
                boundaries.push(bcur.tick);
                bcur.nextMeasure();
            }
            function measureLen(idx) {
                if (idx + 1 < boundaries.length) return boundaries[idx + 1] - boundaries[idx];
                if (idx > 0) return boundaries[idx] - boundaries[idx - 1];
                return 1920;
            }
            function measureOf(tick) {
                var mi = 0;
                for (var b = 0; b < boundaries.length; b++) {
                    if (boundaries[b] <= tick) mi = b; else break;
                }
                return mi;
            }

            var rangeCounts = {};   // "staff|measure" -> { belowCapo, aboveFrets, unfrettable, capo }
            var voiceSpan = {};     // "staff|measure|voice" -> ticks written

            var cur = createCursor({ startTick: 0 });
            for (var k = 0; k < curScore.nstaves; k++) {
                cur.rewind(0);
                var seg = cur.segment;
                var ctx = staffCtx[k];
                while (seg) {
                    var mi2 = measureOf(seg.tick);
                    if (mi2 < lo || mi2 >= hi) { seg = seg.next; continue; }
                    var capo = ctx.fretted ? activeCapo(ctx.capos, seg.tick) : 0;
                    for (var v = 0; v < 4; v++) {
                        var el = seg.elementAt(k * 4 + v);
                        if (!el) continue;
                        var dur = el.actualDuration ? el.actualDuration.ticks : 0;
                        var vk = k + "|" + mi2 + "|" + v;
                        voiceSpan[vk] = (voiceSpan[vk] || 0) + dur;
                        if (ctx.fretted && el.name === "Chord" && el.notes) {
                            var nkeys = Object.keys(el.notes);
                            for (var n = 0; n < nkeys.length; n++) {
                                var note = el.notes[nkeys[n]];
                                var fr, str;
                                try { fr = note.fret; } catch (eFr) { fr = undefined; }
                                try { str = note.string; } catch (eStr) { str = undefined; }
                                var reason = null;
                                if (fr === undefined || fr < 0 || (str !== undefined && str < 0)) {
                                    reason = "unfrettable";
                                } else if (capo && fr < capo) {
                                    reason = "belowCapo";
                                } else if (ctx.frets && fr > ctx.frets) {
                                    reason = "aboveFrets";
                                }
                                if (reason) {
                                    var rk = k + "|" + mi2;
                                    if (!rangeCounts[rk]) {
                                        rangeCounts[rk] = { belowCapo: 0, aboveFrets: 0, unfrettable: 0, capo: capo };
                                    }
                                    rangeCounts[rk][reason]++;
                                }
                            }
                        }
                    }
                    seg = seg.next;
                }
            }

            var issues = [];
            for (var rkey in rangeCounts) {
                if (!rangeCounts.hasOwnProperty(rkey)) continue;
                var rp = rkey.split("|");
                var rsi = parseInt(rp[0], 10), rmi = parseInt(rp[1], 10);
                var rc = rangeCounts[rkey];
                var bits = [];
                if (rc.belowCapo)   bits.push(rc.belowCapo + " below capo " + rc.capo);
                if (rc.aboveFrets)  bits.push(rc.aboveFrets + " above top fret");
                if (rc.unfrettable) bits.push(rc.unfrettable + " unfrettable");
                issues.push({
                    type: "out_of_range",
                    staff: rsi,
                    instrument: staffCtx[rsi].name,
                    measure: rmi + 1,
                    detail: bits.join(", ") + " (not playable as written)"
                });
            }
            for (var vkey in voiceSpan) {
                if (!voiceSpan.hasOwnProperty(vkey)) continue;
                var vp = vkey.split("|");
                var vsi = parseInt(vp[0], 10), vmi = parseInt(vp[1], 10), vvo = parseInt(vp[2], 10);
                var span = voiceSpan[vkey];
                var len = measureLen(vmi);
                if (span !== len) {
                    issues.push({
                        type: span > len ? "overfull_measure" : "underfull_measure",
                        staff: vsi,
                        instrument: staffCtx[vsi].name,
                        measure: vmi + 1,
                        voice: vvo,
                        detail: "voice fills " + span + "/" + len + " ticks"
                    });
                }
            }
            issues.sort(function (a, b) {
                return (a.measure - b.measure) || (a.staff - b.staff);
            });

            // Lean per-staff context for the caller (drop the bulky capo arrays).
            var ctxOut = [];
            for (var c2 = 0; c2 < staffCtx.length; c2++) {
                ctxOut.push({
                    staff: c2,
                    name: staffCtx[c2].name,
                    fretted: staffCtx[c2].fretted,
                    capo: staffCtx[c2].capos.length ? staffCtx[c2].capos[0].fret : 0
                });
            }

            return {
                success: true,
                issues: issues,
                staffContext: ctxOut,
                measuresChecked: hi - lo
            };
        });
    }

    // ------------------------------------------------------------------------
    return { processCommand: processCommand };
})
