"use-strict";

import { Strings } from './locale.js';
import {
    directions,
    AnimationLoop, Binding, BoolArray,
    CanvasStack, ChangeTokenBinding, CircularArray,
    Dispatch, DispatchTarget,
    FlexCanvasGrid,
    GameTask,
    Kvo,
    MovementGesture,
    PerfTimer, PeriodicRandomComponent, Point, PointerGesture, PointerInputController,
    RandomComponent, RandomBlobGenerator, RandomLineGenerator, Rect, Rng,
    SaveStateItem, SelectableList, SaveStateCollection, Serializer,
    TaskQueue, TilePlane,
    UndoStack,
    Vector
} from './g.js';
import { GameContent, GameScriptEngine } from './game-content.js';

// import * as Sweep from './sweep.js';
// import * as SweepSolver from './sweep-solver.js';
// import * as CivGame from './civ/game.js';
// import * as CivGameUI from './civ/ui-game.js';
// import * as CivSystemUI from './civ/ui-system.js';
// import * as CivDrawables from './civ/ui-drawables.js';
// import * as Assembly from './assembly.js';
import * as TurnpikesEngine from './turnpikes/turnpikes-engine.js';
import * as TurnpikesUI from './turnpikes/turnpikes-ui.js';

window.Gaming = { Point: Point, Rect: Rect, Vector: Vector };

function appendOutputItem(msg, className) {
    if (!TestSession.outputElement) { return; }
    var elem = document.createElement("li");
    elem.innerText = msg;
    elem.addRemClass(className, true);
    TestSession.outputElement.append(elem);
}

function logTestMsg(msg, className) {
    console.log(msg);
    appendOutputItem(msg, className ? className : "log");
}

function debugDump(obj) {
    appendOutputItem("(debugDump)", "warn");
    console.log(obj);
}

function logTestHeader(msg) {
    console.log(`~~~~ ${msg} ~~~~`);
    appendOutputItem(msg, "header");
}

function logTestFail(msg) {
    console.warn(msg);
    appendOutputItem(msg, "warn");
}

function pointArrayDesc(poly) {
    return poly.map(p => p?.debugDescription);
};

export class TestSession {
    constructor(testFuncs) {
        this.testFuncs = testFuncs;
        this.testsPassed = 0;
        this.testsFailed = 0;
    }
    async run(outputElement) {
        TestSession.outputElement = outputElement;
        let timer = new PerfTimer("TestSession.run").start();
        for (let i = 0; i < this.testFuncs.length; i += 1) {
            await this.testFuncs[i]();
        }
        this.summarize(timer);
    }
    summarize(timer) {
        logTestHeader("Test Summary " + new Date().toLocaleString());
        logTestMsg(`Tests run: ${this.testsPassed + this.testsFailed}`);
        if (this.testsFailed > 0) {
            logTestFail(`Tests failed: ${this.testsFailed}`);
        } else {
            logTestMsg("All tests passed.", "success");
        }
        logTestMsg(timer.end().summary, "trace");
    }
}
TestSession.current = null;

class UnitTest {
    constructor(name, body) {
        this.name = name;
        this.body = body;
        this.expectations = 0;
        this.failures = 0;
        this.visualizationElem = document.querySelector("#visualizations");
        this.hiddenTestElem = document.querySelector("#domContainer");
    }

    get isOK() { return this.failures == 0; }
    get hadExpectations() { return this.expectations > 0; }

    build() {
        return function(config, expect) {
            logTestHeader(this.name);
            this.hiddenTestElem.removeAllChildren();
            try {
                this.body(config, expect);
            } catch(e) {
                this.logFailure(`Exception thrown: ${e}\n${e.stack}`);
            }
            if (!this.hadExpectations) { return; }
            if (this.isOK) {
                TestSession.current.testsPassed += 1;
                logTestMsg(`Passed! Expectations: ` + this.expectations);
                return;
            }
            TestSession.current.testsFailed += 1;
            if (config) {
                logTestMsg(`config: ${JSON.stringify(config)}`);
            }
            if (expect) {
                logTestMsg(`expect: ${JSON.stringify(expect)}`);
            }
            logTestHeader(`END ${this.name} (${this.failures} failure${this.failures == 1 ? "" : "s"})`);
        }.bind(this);
    }

    buildAndRun() {
        return this.build()();
    }

    usage(msg) {
        if (!this.usaged) {
            logTestMsg("Usage:");
        }
        logTestMsg(msg);
        this.usaged = true;
    }
    logFailure(msg) {
        this.failures += 1;
        logTestFail(`${this.name}: ${msg}`);
        console.trace();
    }
    assertDefined(value, msg) {
        this.expectations += 1;
        if (typeof(value) === "undefined") {
            this.logFailure(this._assertMessage("unexpected undefined value", msg));
            return false;
        }
        return true;
    }
    describe(value) {
        let p = value ? Object.getPrototypeOf(value) : null;
        while (p) {
            if (!!Object.getOwnPropertyDescriptors(p).debugDescription)
                return value.debugDescription;
            p = Object.getPrototypeOf(p);
        }
        // if (!!value && !!value.constructor && !!Object.getOwnPropertyDescriptors(value.constructor.prototype).debugDescription) {
        //     return value.debugDescription;
        // }
        return `${value}`;
    }
    assertEqual(a, b, msg) {
        this.expectations += 1;
        if (!!a && !!b && a.constructor == b.constructor && typeof(a.isEqual) == "function") {
            if (!b.isEqual(a)) {
                this.logFailure(this._assertMessage(`assertEqual failure: ${this.describe(a)} neq ${this.describe(b)}`, msg));
                return false;
            }
            return true;
        }
        if (a != b) {
            this.logFailure(this._assertMessage(`assertEqual failure: ${this.describe(a)} != ${this.describe(b)}`, msg));
            return false;
        }
        return true;
    }
    assertEqualTol(a, b, tol, msg) {
        if (typeof(a?.isEqual) == 'function') {
            if (!a.isEqual(b, tol)) {
                this.logFailure(this._assertMessage(`assertEqualTol failure: ${this.describe(a)} neq ${this.describe(b)}`, msg));
                return false;
            }
        } else {
            if (!Math.fequal(a, b, tol)) {
                this.logFailure(this._assertMessage(`assertEqualTol failure: ${this.describe(a)} neq ${this.describe(b)}`, msg));
                return false;
            }
        }
        return true;
    }
    assertElementsEqual(a, b, msg) {
        this.expectations += 1;
        if (!a && !b) { return true; }
        if ((!a || !b)
            || (a.length != b.length)
            || (!a.every((item, i) => item == b[i]))) {
            this.logFailure(this._assertMessage(`assertElementsEqual: ${a} != ${b}`, msg));
            return false;
        }
        return true;
    }
    assertTrue(value, msg) {
        this.expectations += 1;
        if (value != true) {
            this.logFailure(this._assertMessage("assertTrue failure", msg));
            return false;
        }
        return true;
    }
    assertFalse(value, msg) {
        this.expectations += 1;
        if (value != false) {
            this.logFailure(this._assertMessage("assertFalse failure", msg));
            return false;
        }
        return true;
    }
    assertNoThrow(block, msg) {
        this.expectations += 1;
        try {
            return block();
        } catch(e) {
            this.logFailure(this._assertMessage(`assertNoThrow failure ${e}`, msg));
            return undefined;
        }
    }
    assertThrows(block, msg) {
        this.expectations += 1;
        try {
            block();
            this.logFailure(this._assertMessage(`assertThrows failure`, msg));
            return undefined;
        } catch(e) {
            return e;
        }
    }
    _assertMessage(main, supplement) {
        var messages = [main];
        if (supplement) { messages.push(supplement); }
        return messages.join(" — ");
    }
}

class assembly {
    static datatypeTests() {
        new UnitTest("assembly.DataType.parse", function() {
            let value = this.assertNoThrow(() => {
                return Assembly.DataType.word.parse("0");
            }, "word: parse 0");
            this.assertEqual(value, 0, "word: parsed 0");
            
            value = this.assertNoThrow(() => {
                return Assembly.DataType.word.parse("123");
            }, "word: parse 123");
            this.assertEqual(value, 123, "word: parsed 123");
            
            this.assertThrows(() => {
                return Assembly.DataType.word.parse("abc");
            }, "word: parse abc fails");
            
            this.assertEqual(Assembly.DataType.register(5).max, 4, "register(5): Max register count = N - 1");
            
            value = this.assertNoThrow(() => {
                return Assembly.DataType.register(5).parse("0");
            }, "register(5): parse 0");
            this.assertEqual(value, 0, "register(5): parsed 0");
            
            value = this.assertNoThrow(() => {
                return Assembly.DataType.register(5).parse("4");
            }, "register(5): parse 4");
            this.assertEqual(value, 4, "register(5): parsed 4");
            
            this.assertThrows(() => {
                return Assembly.DataType.register(5).parse("abc");
            }, "register(5): parse abc fails");
            
            this.assertThrows(() => {
                return Assembly.DataType.register(5).parse("abc");
            }, "register(5): parse 5 fails");
        }).buildAndRun();
    }
    
    static instructionTests() {
        new UnitTest("assembly.Instruction.setRegister", function() {
            let machine = {
                registers: [0, 0, 0]
            };
            let sut = Assembly.Instruction.setRegister(3);
            let label = "";
            
            label = "SET (no tokens)";
            this.assertThrows(() => {
                sut.execute([], machine);
            }, label + "invalid");
            this.assertElementsEqual(machine.registers, [0, 0, 0], label + "no state change");
            
            label = "SET 0";
            this.assertThrows(() => {
                sut.execute(["0"], machine);
            }, label + "invalid");
            this.assertElementsEqual(machine.registers, [0, 0, 0], label + "no state change");
            
            label = "SET 0 1 2";
            this.assertThrows(() => {
                sut.execute(["0", "1", "2"], machine);
            }, label + "invalid");
            this.assertElementsEqual(machine.registers, [0, 0, 0], label + "no state change");
            
            label = "SET a 1";
            this.assertThrows(() => {
                sut.execute(["a", "1"], machine);
            }, label + "invalid");
            this.assertElementsEqual(machine.registers, [0, 0, 0], label + "no state change");
            
            label = "SET 0 a";
            this.assertThrows(() => {
                sut.execute(["0", "a"], machine);
            }, label + "invalid");
            this.assertElementsEqual(machine.registers, [0, 0, 0], label + "no state change");
            
            label = "SET 3 1";
            this.assertThrows(() => {
                sut.execute(["3", "1"], machine);
            }, label + "invalid");
            this.assertElementsEqual(machine.registers, [0, 0, 0], label + "no state change");
            
            label = "SET 0 1";
            this.assertNoThrow(() => {
                sut.execute(["0", "1"], machine);
            }, label + "execute");
            this.assertElementsEqual(machine.registers, [1, 0, 0], label + "sets register 0");
        }).buildAndRun();
        
        new UnitTest("assembly.Instruction.setRegister", function() {
            let machine = {
                registers: [3, 4, 5]
            };
            let sut = Assembly.Instruction.addRegisters;
            let label = "";
            
            label = "ADD 0";
            this.assertThrows(() => {
                sut.execute(["0"], machine);
            }, label + "invalid");
            this.assertElementsEqual(machine.registers, [3, 4, 5], label + "no state change");
            
            label = "ADD";
            logTestHeader(label);
            this.assertNoThrow(() => {
                sut.execute([], machine);
            }, label + "execute");
            this.assertElementsEqual(machine.registers, [7, 4, 5], label + "sets register 0");
        }).buildAndRun();
    }
} // end class assembly

// TODO: refinements:
// - mousedown > move > leave > enter > move > mouseup. The leave cancels the gesture, then the first move after enter starts a new gesture with buttons=1. Should we always ignore buttons=1 in that case and call it a move rather than drag? Maybe the listener is responsible for this check (via gesture.firstEvent.evt.type), unless we make things more abstract and have addDragGestureListener and addHoverGestureListener, or we add a type = drag|hover property to MovementGesture.
// - selectionListener: add a class SelectionGesture for that? Yeah, mousedown can be candidate, mouseup can be complete/cancel depending on movement tolerance. Note that this means multiple gesture types can become candidates upon mousedown, but only one should be active at any time (e.g. if movement gesture accepts+consumes a mousemove, it should cancel the selection)?
// Yeah. PIC tracks an array #allGestures, and a single #activeGesture.
// Events like mousedown and mousemove generate candidate gestures + update the active gesture. And events like mouseup can complete gestures. With each event, determine whether to discard candidate gestures, or promote a candidate to active which cancels the current active gesture, or to complete a gesture.

class g {
    static pointerInputControllerTests() {
        const setUp = function() {
            const canvas = document.createElement("canvas");
            canvas.width = 200;
            canvas.height = 100;
            let pic = new PointerInputController({elem: canvas, pixelScale: 2, selectionMovementTolerance: 3});
            let events = [];
            pic.addSelectionListener({ repetitions: 1, buttons: 1 }, info => events.push({ listener: "selection-single-btn1", info: info }));
            pic.addSelectionListener({ repetitions: 2, buttons: 1 }, info => events.push({ listener: "selection-double-btn1", info: info }));
            pic.addSelectionListener({ repetitions: 1, buttons: 2 }, info => events.push({ listener: "selection-single-btn2", info: info }));
            pic.addSelectionListener({ repetitions: 2, buttons: 2 }, info => events.push({ listener: "selection-double-btn2", info: info }));
            pic.addMovementGestureListener({ buttons: 0 }, (gesture, info) => events.push({
                listener: "gesture-0",
                gesture: gesture,
                state: gesture.state,
                modelPoint: gesture.latestEvent.modelPoint,
                info: info
            }));
            pic.addMovementGestureListener({ buttons: 1 }, (gesture, info) => events.push({
                listener: "gesture-1",
                gesture: gesture,
                state: gesture.state,
                modelPoint: gesture.latestEvent.modelPoint,
                info: info
            }));
            return {
                canvas: canvas,
                events: events,
                pic: pic
            };
        };
        const stubMouseEvent = class stubMouseEvent extends MouseEvent {
            constructor(type, a) { super(type, a); this.a = a; }
            get detail() { return this.a.detail; }
            get offsetX() { return this.a.offsetX; }
            get offsetY() { return this.a.offsetY; }
        };
        
        new UnitTest("g.PointerInputController.selection", function() {
            const a = setUp();
            // TODO: set up movement gesture listener, should not fire
            let singleClick = new stubMouseEvent("click", { buttons: 1, detail: 1, offsetX: 10, offsetY: 30});
            let doubleClick2 = new stubMouseEvent("click", { buttons: 2, detail: 2, offsetX: 13, offsetY: 3});
            a.canvas.dispatchEvent(singleClick);
            a.canvas.dispatchEvent(doubleClick2);
            
            this.assertEqual(a.events.length, 2);
            if (a.events.length == 2) {
                this.assertEqual(a.events[0].listener, "selection-single-btn1");
                this.assertEqual(a.events[0].info.evt, singleClick);
                this.assertEqual(a.events[0].info.modelPoint, new Point(20, 60));
                this.assertEqual(a.events[1].listener, "selection-double-btn2");
                this.assertEqual(a.events[1].info.evt, doubleClick2);
                this.assertEqual(a.events[1].info.modelPoint, new Point(26, 6));
            }
        }).buildAndRun();
        
        // Simple one-button drag.
        new UnitTest("g.PointerInputController.movement: 1btn drag", function() {
            const a = setUp();
            a.canvas.dispatchEvent(new stubMouseEvent("mousedown", { buttons: 1, detail: 1, offsetX: 10, offsetY: 30}));
            a.canvas.dispatchEvent(new stubMouseEvent("mousemove", { buttons: 1, detail: 1, offsetX: 15, offsetY: 30}));
            a.canvas.dispatchEvent(new stubMouseEvent("mouseup", { buttons: 1, detail: 1, offsetX: 25, offsetY: 32}));
            
            let coords = [new Point(20, 60), new Point(30, 60), new Point(50, 64)];
            this.assertElementsEqual(a.events.map(evt => evt.listener), ["gesture-1", "gesture-1", "gesture-1"]);
            this.assertElementsEqual(pointArrayDesc(a.events.map(evt => evt.info.modelPoint)), pointArrayDesc(coords), "info.modelPoint");
            this.assertElementsEqual(pointArrayDesc(a.events.map(evt => evt.modelPoint)), pointArrayDesc(coords), "gesture.latestEvent.modelPoint");
            this.assertElementsEqual(a.events.map(evt => evt.state), [PointerGesture.State.candidate, PointerGesture.State.active, PointerGesture.State.complete], "gesture.state");
        }).buildAndRun();
        
        // Simple no-buttons move.
        new UnitTest("g.PointerInputController.movement: 0btn move", function() {
            const a = setUp();
            a.canvas.dispatchEvent(new stubMouseEvent("mousemove", { buttons: 0, detail: 1, offsetX: 10, offsetY: 30}));
            a.canvas.dispatchEvent(new stubMouseEvent("mousemove", { buttons: 0, detail: 1, offsetX: 15, offsetY: 30}));
            a.canvas.dispatchEvent(new stubMouseEvent("mousemove", { buttons: 0, detail: 1, offsetX: 20, offsetY: 31}));
            a.canvas.dispatchEvent(new stubMouseEvent("mousemove", { buttons: 0, detail: 1, offsetX: 25, offsetY: 32}));
            
            let coords = [new Point(20, 60), new Point(30, 60), new Point(40, 62), new Point(50, 64)];
            this.assertElementsEqual(a.events.map(evt => evt.listener), ["gesture-0", "gesture-0", "gesture-0", "gesture-0"]);
            this.assertElementsEqual(pointArrayDesc(a.events.map(evt => evt.info.modelPoint)), pointArrayDesc(coords), "info.modelPoint");
            this.assertElementsEqual(pointArrayDesc(a.events.map(evt => evt.modelPoint)), pointArrayDesc(coords), "gesture.latestEvent.modelPoint");
            this.assertElementsEqual(a.events.map(evt => evt.state), [PointerGesture.State.candidate, PointerGesture.State.active, PointerGesture.State.active, PointerGesture.State.active], "gesture.state");
        }).buildAndRun();
        
        // Changing gestures:
        // move (begin move gesture), mousedown (cancel move gesture, begin drag gesture), drag, move, mouseup (complete drag gesture), move (begin move gesture)
        new UnitTest("g.PointerInputController.movement: move-drag-move", function() {
            const a = setUp();
            a.canvas.dispatchEvent(new stubMouseEvent("mousemove", { buttons: 0, detail: 1, offsetX: 10, offsetY: 30}));
            a.canvas.dispatchEvent(new stubMouseEvent("mousemove", { buttons: 0, detail: 1, offsetX: 15, offsetY: 30}));
            a.canvas.dispatchEvent(new stubMouseEvent("mousedown", { buttons: 1, detail: 1, offsetX: 20, offsetY: 31}));
            a.canvas.dispatchEvent(new stubMouseEvent("mousemove", { buttons: 1, detail: 1, offsetX: 25, offsetY: 32}));
            a.canvas.dispatchEvent(new stubMouseEvent("mouseup", { buttons: 1, detail: 1, offsetX: 25, offsetY: 35}));
            a.canvas.dispatchEvent(new stubMouseEvent("mousemove", { buttons: 0, detail: 1, offsetX: 25, offsetY: 36}));
            
            let coords = [new Point(20, 60), new Point(30, 60), new Point(40, 62), new Point(40, 62), new Point(50, 64), new Point(50, 70), new Point(50, 72)];
            this.assertElementsEqual(a.events.map(evt => evt.listener), ["gesture-0", "gesture-0", "gesture-0", "gesture-1", "gesture-1", "gesture-1", "gesture-0"]);
            this.assertElementsEqual(pointArrayDesc(a.events.map(evt => evt.info.modelPoint)), pointArrayDesc(coords), "info.modelPoint");
            this.assertElementsEqual(pointArrayDesc(a.events.map(evt => evt.modelPoint)), pointArrayDesc(coords), "gesture.latestEvent.modelPoint");
            this.assertElementsEqual(a.events.map(evt => evt.state), [PointerGesture.State.candidate, PointerGesture.State.active, PointerGesture.State.canceled, PointerGesture.State.candidate, PointerGesture.State.active, PointerGesture.State.complete, PointerGesture.State.candidate], "gesture.state");
        }).buildAndRun();
        
        // (4) Leaving canvas:
        // mousedown (begin g1), drag, leave (cancel g1), enter, drag, mouseup (complete g2)
        
        // (5) Single click within movement tolerance
        // mousedown, move tiny amount, mouseup
    }
}

class turnpikes {
    static parcelTests() {
        new UnitTest("turnpikes.Parcel", function() {
            let parcelWatcher = class {
                constructor(parcel) {
                    this.events = [];
                    parcel.kvo.addNode.addObserver(this, p => {
                        this.events.push(`addNode:${p.kvo.addNode.value.id}`);
                    });
                    parcel.kvo.removeNode.addObserver(this, p => {
                        this.events.push(`removeNode:${p.kvo.removeNode.value.id}`);
                    });
                }
            };
            
            const Parcel = TurnpikesEngine.Parcel;
            let node1 = new TurnpikesEngine.Structure({
                id: "struct1",
                coord: new Point(10, 20)
            });
            let node2 = new TurnpikesEngine.Structure({
                id: "struct2",
                coord: new Point(20, 10)
            });
            let parcel = new Parcel({ width: 200, height: 200 });
            let watcher = new parcelWatcher(parcel);
            parcel.addNode(node1);
            
            this.assertEqual(parcel.findNode("bogus"), null);
            let found = parcel.findNode(node1.id);
            this.assertEqual(found?.id, node1.id);
            this.assertTrue(found?.index >= 0);
            this.assertEqual(found?.item, node1);
            this.assertEqual(node1.parcel, parcel);
            
            parcel.addNode(node1); // should be a no-op with no side effects.
            
            parcel.addNode(node2);
            
            parcel.forEachNode(node => watcher.events.push(`forEachNode:${node.id}`));
            this.assertElementsEqual(parcel.filterNodes(n => n.id == "struct2").map(n => n.id), ["struct2"], "filterNodes");
            
            parcel.removeNode(node1);
            this.assertEqual(node1.parcel, null);
            this.assertEqual(parcel.findNode(node1.id), null);
            parcel.forEachNode(node => watcher.events.push(`forEachNode:${node.id}`));
            
            this.assertElementsEqual(watcher.events, [
                "addNode:struct1", "addNode:struct2", "forEachNode:struct1", "forEachNode:struct2", "removeNode:struct1", "forEachNode:struct2"
            ]);
            Kvo.stopAllObservations(watcher);
        }).buildAndRun();
        
        new UnitTest("turnpikes.Parcel.findNodesIntersectingPoint", function() {
            let parcel = new TurnpikesEngine.Parcel({ width: 200, height: 200 });
            let p50_50 = new Point(50, 50);
            this.assertEqual(parcel.findNodesIntersectingPoint(p50_50, 1).length, 0, "Empty parcel");
            
            let strTopLeft = new TurnpikesEngine.Structure({
                id: "strTopLeft",
                coord: new Point(10, 10),
                shapeSpec: new TurnpikesEngine.Shape({ height: TurnpikesEngine.NetworkLevel.overpass1.elevation - 1, path: TurnpikesEngine.YML.parsePath([10, 10, 20, 10, 20, 20, 10, 20]) })
            });
            let strMiddle = new TurnpikesEngine.Structure({
                id: "strMiddle",
                coord: new Point(40, 40),
                shapeSpec: new TurnpikesEngine.Shape({ height: TurnpikesEngine.NetworkLevel.overpass1.elevation, path: TurnpikesEngine.YML.parsePath([0, 0, 20, 0, 20, 20, 0, 20]) })
            });
            let strNearMiddle = new TurnpikesEngine.Structure({
                id: "strNearMiddle",
                coord: new Point(55, 55),
                shapeSpec: new TurnpikesEngine.Shape({ height: TurnpikesEngine.NetworkLevel.overpass1.elevation, path: TurnpikesEngine.YML.parsePath([0, 0, 20, 0, 20, 20, 0, 20]) })
            });
            
            let segTopRight = new TurnpikesEngine.Segment({ id: "segTopRight", coord: new Point(10, 190), path: TurnpikesEngine.YML.parsePath([]), start: null, end: null });
            let segCrossMiddle = new TurnpikesEngine.Segment({ id: "segCrossMiddle", coord: new Point(20, 20), path: TurnpikesEngine.YML.parsePath([20, 20, 25, 25, 30, 30, 35, 35, 40, 40, 45, 45, 50, 50, 55, 55, 60, 60, 65, 65]), start: null, end: null });
            let segCrossMiddleStart = TurnpikesEngine.Junction.segmentStart(segCrossMiddle);
            let segStartAtMiddle = new TurnpikesEngine.Segment({ id: "segStartAtMiddle", coord: new Point(50, 50), path: TurnpikesEngine.YML.parsePath([50, 50, 55, 55, 60, 60]), start: null, end: null });
            let segStartAtMiddleStart = TurnpikesEngine.Junction.segmentStart(segStartAtMiddle);
            [strTopLeft, strMiddle, strNearMiddle, segTopRight, segCrossMiddle, segCrossMiddleStart, segStartAtMiddle, segStartAtMiddleStart].forEach(node => parcel.addNode(node));
            
            let matches = parcel.findNodesIntersectingPoint(p50_50, 1);
            this.assertElementsEqual(matches.map(node => node.id), ["strMiddle", "segCrossMiddle", "segStartAtMiddle", segStartAtMiddleStart.id]);
            
            console.log("YOOO");
            console.log(matches);
            
            // TODO: segment near 1-point radius test, within the hit test width of the segment path
            
            // TODO: increase radius
            // TODO: elevation testing
        }).buildAndRun();
    }
    
    static structureTests() {
        // new UnitTest("turnpikes.Structure", function() {
        // }).buildAndRun();
        
        new UnitTest("turnpikes.Structure.fromConfig", function() {
            const Structure = TurnpikesEngine.Structure;
            const shapeStub = new turnpikes.classStub(TurnpikesEngine.Shape, [
                {
                    label: "test1",
                    height: TurnpikesEngine.NetworkLevel.overpass1.elevation,
                    path: [0, 0,  30, 0,  30, 30,  15, 45,  0, 30],
                    style: { fillStyle: "green" }
                }
            ]);
            
            let sut = Structure.fromConfig({
                id: "test1",
                coord: [150, 50],
                shape: "test1"
            });
            this.assertEqual(sut?.id, "test1", "built test1");
            this.assertEqual(sut?.coord, new Point(150, 50));
            this.assertEqual(sut?.shape?.label, "test1");
            this.assertEqual(sut?.shape?.path.length, 5);
            this.assertEqual(sut?.shape?.path[1], new Point(180, 50), "path shifted relative to Structure.coord");
            this.assertEqual(sut?.shape?.style?.fillStyle, "green");
            
            shapeStub.tearDown();
        }).buildAndRun();
    }
    
    static landscapeFeatureTests() {
        new UnitTest("turnpikes.LandscapeFeature", function() {
        }).buildAndRun();
    }
    
    static segmentTests() {
        new UnitTest("turnpikes.Segment", function() {
            const Segment = TurnpikesEngine.Segment;
            const segmentStub = new turnpikes.classStub(Segment, {
                stub: { length: 15 }
            });
            
            let seg = Segment.stub("e1", new Point(5, 25), null, 0);
            this.assertEqual(seg.id, "e1");
            this.assertEqual(seg.coord, new Point(5, 25));
            this.assertElementsEqual(pointArrayDesc(seg.path), pointArrayDesc([new Point(5, 25), new Point(20, 25)]));
            this.assertEqual(seg.start, null);
            this.assertEqual(seg.end, null);
            this.assertFalse(seg.isPartial);
            
            seg = Segment.stub("e2", null, new Point(100, 200), 120);
            this.assertEqual(seg.id, "e2");
            this.assertEqual(seg.coord, new Point(100, 200));
            this.assertElementsEqual(pointArrayDesc(seg.path), pointArrayDesc([new Point(108, 187), new Point(100, 200)]));
            this.assertEqual(seg.start, null);
            this.assertEqual(seg.end, null);
            this.assertFalse(seg.isPartial);
            
            segmentStub.tearDown();
        }).buildAndRun();
    }
    
    static junctionTests() {
        new UnitTest("turnpikes.Junction.endpointFromConfig", function() {
            const Junction = TurnpikesEngine.Junction;
            const segmentStub = new turnpikes.classStub(TurnpikesEngine.Segment, {
                stub: { length: 10 }
            });
            const agentTypeStub = new turnpikes.agentTypeStub();
            
            let jcn = Junction.endpointFromConfig({
                id: "e1",
                start: [120, 86],
                angle: 90,
                timeline: [
                    { count: 5, duration: 5, destination: "e2", pattern: ["bicycle"] },
                    { count: 2, duration: 10, destination: "e3", pattern: ["moped", "bicycle"] }
                ]
            });
            this.assertEqual(jcn.id, "e1");
            this.assertEqual(jcn.coord, new Point(120, 86));
            this.assertEqual(jcn.shape, null);
            this.assertEqual(jcn.level, TurnpikesEngine.NetworkLevel.ground, "uses default level");
            
            this.assertEqual(jcn.entering.length, 0, "start: no segs entering");
            this.assertEqual(jcn.leaving.length, 1, "start: one seg leaving");
            let seg = jcn.leaving[0];;
            if (seg) {
                this.assertEqual(seg.id, "seg-end-e1");
                this.assertElementsEqual(pointArrayDesc(seg.path), pointArrayDesc([jcn.coord, new Point(120, 96)]), "start: seg path");
                this.assertEqual(seg.start, jcn, "start: seg points to Junction");
                this.assertEqual(seg.end, null, "start: seg has no end");
            }
            
            this.assertEqual(jcn.timeline.length, 2);
            this.assertEqual(jcn.timeline[0]?.count, 5);
            this.assertElementsEqual(jcn.timeline[0]?.pattern.map(a => a.id), ["bicycle"]);
            this.assertEqual(jcn.timeline[1]?.duration, 10);
            this.assertElementsEqual(jcn.timeline[1]?.pattern.map(a => a.id), ["moped", "bicycle"]);
            logTestMsg(jcn);
            
            jcn = Junction.endpointFromConfig({
                id: "e2",
                end: [20, 250],
                level: 1,
                angle: 180
            });
            this.assertEqual(jcn.id, "e2");
            this.assertEqual(jcn.coord, new Point(20, 250));
            this.assertEqual(jcn.shape, null);
            this.assertEqual(jcn.level, TurnpikesEngine.NetworkLevel.overpass1);
            this.assertEqual(jcn.timeline.length, 0);
            
            this.assertEqual(jcn.entering.length, 1, "end: one seg entering");
            this.assertEqual(jcn.leaving.length, 0, "end: no segs leaving");
            seg = jcn.entering[0];
            if (seg) {
                this.assertEqual(seg.id, "seg-end-e2");
                this.assertElementsEqual(pointArrayDesc(seg.path), pointArrayDesc([new Point(30, 250), jcn.coord]), "end: seg path");
                this.assertEqual(seg.start, null, "end: seg has no start");
                this.assertEqual(seg.end, jcn, "end: seg points to Junction");
            }
            
            segmentStub.tearDown();
            agentTypeStub.tearDown();
        }).buildAndRun();
    }
    
    static networkBuilderTests() {
        let p = (x, y) => { return new Point(x, y); };
        
        new UnitTest("turnpikes.NetworkBuilder: simple/empty parcel", function() {
            let networkBuilderStub = turnpikes.classStub.networkBuilder();
            let parcel = new TurnpikesEngine.Parcel({ width: 200, height: 200 });
            let builder = new TurnpikesEngine.NetworkBuilder(parcel.network);
            this.assertTrue(builder.partialSegment == null, "begins with null partialSegment");
            
            builder.tryBuild(p(50, 50));
            let p1 = builder.partialSegment;
            this.assertTrue(!!p1, "build1 (empty Parcel): started a segment");
            if (p1) {
                this.assertEqual(p1.parcel, parcel, "build1: partial added to Parcel");
                this.assertTrue(p1.isPartial, "build1: partial marked isPartial");
                this.assertEqual(p1.end, null, "build1: partial has no endpoint yet")
                this.assertElementsEqual(pointArrayDesc(p1.path), pointArrayDesc([p(50, 50)]), "build1: path with one point");
            }
            let jStart1 = p1?.start;
            this.assertTrue(!!jStart1, "build1: created junction for partial's start");
            if (jStart1) {
                this.assertEqual(jStart1.parcel, parcel, "build1: junction added to parcel");
                this.assertEqual(jStart1.coord, p(50, 50), "build1: start junction coord");
                this.assertElementsEqual(jStart1.leaving, [p1], "build1: start junction has partial leaving");
                this.assertEqual(jStart1.entering.length, 0, "build1: junction has no entering segs");
            }
            
            builder.tryBuild(p(80, 50));
            let p2 = builder.partialSegment;
            this.assertEqual(p2, p1, "build2: partialSegment retained");
            if (p2) {
                this.assertElementsEqual(pointArrayDesc(p2.path), pointArrayDesc([p(50, 50), p(80, 50)]), "build2: one point added to path");
                this.assertTrue(p2.isPartial, "build2: still isPartial");
                this.assertEqual(p2.start, jStart1, "build2: start junction unchanged");
                this.assertEqual(p2.end, null, "build2: end junction still null");
            }
            
            builder.commit();
            this.assertEqual(builder.partialSegment, null, "commit: null partialSegment");
            let jEnd1 = p1?.end;
            if (p1) {
                this.assertFalse(p1.isPartial, "commit: segment !isPartial");
                this.assertEqual(p1.parcel, parcel, "commit: segment still in parcel");
                this.assertEqual(p1.start, jStart1, "commit: start junction unchanged");
            }
            this.assertTrue(!!jEnd1, "commit: end junction created");
            if (jEnd1) {
                this.assertTrue(jEnd1 != jStart1, "commit: end junction is unique");
                this.assertEqual(jEnd1.parcel, parcel, "commit: end junction in parcel");
                this.assertEqual(jEnd1.coord, p(80, 50), "commit: end junction coord");
                this.assertElementsEqual(jEnd1.entering, [p1], "build1: start junction has partial entering");
                this.assertEqual(jEnd1.leaving.length, 0, "build1: junction has no leaving segs");
            }
            networkBuilderStub.tearDown();
        }).buildAndRun();
        
        new UnitTest("turnpikes.NetworkBuilder: commit failures", function() {
            let networkBuilderStub = turnpikes.classStub.networkBuilder();
            let parcel = new TurnpikesEngine.Parcel({ width: 200, height: 200 });
            let builder = new TurnpikesEngine.NetworkBuilder(parcel.network);
            
            builder.commit();
            this.assertEqual(parcel.filterNodes(n => true).length, 0, "commit() empty: nothing added to parcel");
            
            builder.tryBuild(p(25, 57));
            this.assertTrue(!!builder.partialSegment, "setup 1-point partial: exists");
            this.assertEqual(parcel.filterNodes(n => true).length, 2, "setup 1-point partial: junction and partial segment in Parcel");
            
            builder.commit();
            this.assertEqual(builder.partialSegment, null, "commit 1-point partial: partialSegment null");
            let nodes = parcel.filterNodes(n => true);
            this.assertEqual(nodes.length, 1, "commit 1-point partial: aborted segment removed from Parcel; start junction remains");
            if (nodes.length == 1) {
                this.assertEqual(nodes[0].constructor, TurnpikesEngine.Junction, "left one Junction in Parcel");
                this.assertEqual(nodes[0].coord, p(25, 57), "Junction coord");
            }
            networkBuilderStub.tearDown();
        }).buildAndRun();
        
        new UnitTest("turnpikes.NetworkBuilder: collision failures", function() {
            let networkBuilderStub = turnpikes.classStub.networkBuilder();
            // TODO: attempt start on a structure or landscapeFeature
            // TODO: attempt append on a structure/landscapeFeature
            networkBuilderStub.tearDown();
        }).buildAndRun();
        
        new UnitTest("turnpikes.NetworkBuilder: start from existing", function() {
            let networkBuilderStub = turnpikes.classStub.networkBuilder();
            let setup = (label) => {
                let parcel = new TurnpikesEngine.Parcel({ width: 200, height: 200 });
                let segment = new TurnpikesEngine.Segment({
                    coord: p(50, 50),
                    path: [p(50, 50), p(70, 50), p(90, 50), p(90, 70), p(90, 90)]
                });
                parcel.addNode(segment);
                parcel.addNode(TurnpikesEngine.Junction.segmentStart(segment));
                parcel.addNode(TurnpikesEngine.Junction.segmentEnd(segment));
                logTestMsg(`${label}:`);
                return {
                    prefix: label + ": ",
                    segment: segment,
                    start: segment.start,
                    end: segment.end,
                    parcel: parcel,
                    builder: new TurnpikesEngine.NetworkBuilder(parcel.network)
                };
            };
            
            let ctx = setup("start on seg.end");
            ctx.builder.tryBuild(p(90, 90));
            let p1 = ctx.builder.partialSegment;
            this.assertTrue(!!p1, ctx.prefix + "started partial");
            if (p1) {
                this.assertEqual(p1.parcel, ctx.parcel, ctx.prefix + "added partial to Parcel");
                this.assertEqual(p1.coord, p(90, 90), ctx.prefix + "partial's coord");
                this.assertEqual(p1.start, ctx.segment.end, ctx.prefix + "partial's start Junction == existing");
                this.assertEqual(p1.end, null, ctx.prefix + "partial's end == null");
            }
            this.assertEqual(ctx.parcel.filterNodes(n => true).length, 4, ctx.prefix + "Parcel contains: partial + existing seg/junctions");
            this.assertEqual(ctx.segment.path.length, 5, ctx.prefix + "Exsiting segment path not modified");
            this.assertEqual(ctx.segment.start, ctx.start, ctx.prefix + "Exsiting segment start not modified");
            this.assertEqual(ctx.segment.end, ctx.end, ctx.prefix + "Exsiting segment end not modified");
            
            ctx = setup("start on seg.start");
            ctx.builder.tryBuild(p(50, 50));
            p1 = ctx.builder.partialSegment;
            this.assertTrue(!!p1, ctx.prefix + "started partial");
            if (p1) {
                this.assertEqual(p1.parcel, ctx.parcel, ctx.prefix + "added partial to Parcel");
                this.assertEqual(p1.coord, p(50, 50), ctx.prefix + "partial's coord");
                this.assertEqual(p1.start, ctx.segment.start, ctx.prefix + "partial's start Junction == existing");
                this.assertEqual(p1.end, null, ctx.prefix + "partial's end == null");
            }
            this.assertEqual(ctx.parcel.filterNodes(n => true).length, 4, ctx.prefix + "Parcel contains: partial + existing seg/junctions");
            this.assertEqual(ctx.segment.path.length, 5, ctx.prefix + "Exsiting segment path not modified");
            this.assertEqual(ctx.segment.start, ctx.start, ctx.prefix + "Exsiting segment start not modified");
            this.assertEqual(ctx.segment.end, ctx.end, ctx.prefix + "Exsiting segment end not modified");
            
            // ctx = setup("start on seg.path[1]");
            // ctx.builder.tryBuild(p(70, 50));
            // p1 = ctx.builder.partialSegment;
            // - splits the segment, makes a junction
            
            // TODO: start _near_ a junction, start _near_ a segment path -- don't go too deep with this here, have a separate unit test for general hit-testing behavior (finding nodes within a radius)
            
            // TODO: start between two points on a segment path
            networkBuilderStub.tearDown();
        }); //.buildAndRun();
        
        new UnitTest("turnpikes.NetworkBuilder: append into existing", function() {
            let networkBuilderStub = turnpikes.classStub.networkBuilder();
        // TODO: append colliding with structure
        // TODO: append colliding with segment/junction
            networkBuilderStub.tearDown();
        });
    }
    
    static shapeTests() {
        let p = (x, y) => { return new Point(x, y); };
        
        new UnitTest("turnpikes.Shape", function() {
            const Shape = TurnpikesEngine.Shape;
            let basePathMaker = () => {
                return [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
            };
            let square = new Shape({
                label: "square",
                height: 3,
                path: basePathMaker(),
                textOffset: p(3, 7),
                text: "test text",
                style: {}
            });
            this.assertEqual(square.label, "square");
            this.assertEqual(square.height, 3);
            this.assertEqual(square.path.length, 4);
            this.assertElementsEqual(square.instructions, ["fill"]);
            this.assertEqual(square.bounds, new Rect(0, 0, 1, 1));
            this.assertEqual(square.textOffset, p(3, 7));
            this.assertEqual(square.text, "test text");
            
            let offset = square.withOrigin(p(2, 3.5));
            this.assertEqual(offset.label, "square");
            this.assertEqual(offset.height, 3);
            this.assertEqual(offset.path.length, 4);
            let offsetPath = [p(2, 3.5), p(3, 3.5), p(3, 4.5), p(2, 4.5)];
            this.assertElementsEqual(pointArrayDesc(offset.path), pointArrayDesc(offsetPath));
            this.assertEqual(offset.bounds, new Rect(2, 3.5, 1, 1));
            this.assertEqual(offset.textOffset, p(3, 7), "textOffset not changed: relative to Shape itself");
            this.assertEqual(offset.text, "test text");
            this.assertElementsEqual(pointArrayDesc(square.path), pointArrayDesc(basePathMaker()), "original is unmodified");
            this.assertEqual(square.text, "test text", "original is unmodified");
            
            let scaled = square.scaled(1.5);
            this.assertEqual(scaled.label, "square");
            this.assertEqual(scaled.height, 3);
            this.assertEqual(scaled.path.length, 4);
            let scaledPath = [p(0, 0), p(1.5, 0), p(1.5, 1.5), p(0, 1.5)];
            this.assertElementsEqual(pointArrayDesc(scaled.path), pointArrayDesc(scaledPath));
            this.assertEqual(scaled.bounds, new Rect(0, 0, 1.5, 1.5));
            this.assertEqual(scaled.textOffset, p(4.5, 10.5), "textOffset does scale though");
            this.assertEqual(scaled.text, "test text");
            this.assertElementsEqual(pointArrayDesc(square.path), pointArrayDesc(basePathMaker()), "original is unmodified");
            this.assertEqual(square.textOffset, p(3, 7), "original is unmodified");
            
            let custom = square.customized(s => {
                s.label = "customized1";
                s.height = 4;
                s.text = "custom text";
                s.instructions = [TurnpikesEngine.ShapeInstruction.stroke, TurnpikesEngine.ShapeInstruction.fill];
            });
            this.assertEqual(custom.label, "customized1");
            this.assertEqual(custom.height, 4);
            this.assertEqual(custom.path.length, 4);
            this.assertEqual(custom.bounds, new Rect(0, 0, 1, 1));
            this.assertEqual(custom.text, "custom text");
            this.assertElementsEqual(custom.instructions, [TurnpikesEngine.ShapeInstruction.stroke, TurnpikesEngine.ShapeInstruction.fill]);
            this.assertEqual(square.label, "square", "original is unmodified");
            this.assertEqual(square.height, 3, "original is unmodified");
            
            let chained = square.withOrigin(p(-0.5, 2)).scaled(0.75).customized(s => {
                s.label = "customized2";
                s.path.push(p(-1, 2));
            });
            this.assertEqual(chained.label, "customized2");
            this.assertEqual(chained.height, 3);
            this.assertEqual(chained.path.length, 5);
            let chainedPath = [
                p(-0.375, 1.5),
                p(0.375, 1.5),
                p(0.375, 2.25),
                p(-0.375, 2.25),
                p(-1, 2)
            ];
            this.assertElementsEqual(pointArrayDesc(chained.path), pointArrayDesc(chainedPath));
            this.assertEqual(chained.bounds, new Rect(-1, 1.5, 1.375, 0.75));
            this.assertElementsEqual(pointArrayDesc(square.path), pointArrayDesc(basePathMaker()), "original is unmodified");
            this.assertEqual(square.label, "square", "original is unmodified");
            
            logTestMsg("TODO: test intersectsSegment");
        }).buildAndRun();
        
        new UnitTest("turnpikes.Shape.fromConfig", function() {
            const Shape = TurnpikesEngine.Shape;
            const shapeStub = new turnpikes.classStub(Shape, [
                {
                    label: "test1",
                    height: TurnpikesEngine.NetworkLevel.overpass1.elevation,
                    path: [0, 0,  30, 0,  30, 30,  15, 45,  0, 30],
                    style: { fillStyle: "green" }
                },
                {
                    label: "test2",
                    basis: "test1",
                    scaled: 0.5,
                    style: { fillStyle: "blue" }
                },
                {
                    label: "test3",
                    basis: "test2",
                    height: TurnpikesEngine.NetworkLevel.overpass2.elevation
                },
                {
                    label: "bogusBasis",
                    basis: "bogus"
                }
            ]);
            
            let sut = Shape.fromConfig("bogus");
            this.assertEqual(sut, null, "ID not found");
            sut = Shape.fromConfig("bogusBasis");
            this.assertEqual(sut, null, "basis not found");
            
            sut = Shape.fromConfig("test1");
            this.assertEqual(sut?.label, "test1", "built test1");
            this.assertEqual(sut?.height, TurnpikesEngine.NetworkLevel.overpass1.elevation);
            this.assertElementsEqual(pointArrayDesc(sut?.path), pointArrayDesc([p(0, 0), p(30, 0), p(30, 30), p(15, 45), p(0, 30)]));
            this.assertEqual(sut?.style?.fillStyle, "green");
            
            sut = Shape.fromConfig("test2");
            this.assertEqual(sut?.label, "test2", "built test2");
            this.assertEqual(sut?.height, TurnpikesEngine.NetworkLevel.overpass1.elevation);
            this.assertElementsEqual(pointArrayDesc(sut?.path), pointArrayDesc([p(0, 0), p(15, 0), p(15, 15), p(7.5, 22.5), p(0, 15)]));
            this.assertEqual(sut?.style?.fillStyle, "blue");
            
            sut = Shape.fromConfig("test3");
            this.assertEqual(sut?.label, "test3", "built test3");
            this.assertEqual(sut?.height, TurnpikesEngine.NetworkLevel.overpass2.elevation);
            this.assertElementsEqual(pointArrayDesc(sut?.path), pointArrayDesc([p(0, 0), p(15, 0), p(15, 15), p(7.5, 22.5), p(0, 15)]));
            this.assertEqual(sut?.style?.fillStyle, "blue");
            
            sut = Shape.fromConfig({
                label: "inline",
                height: TurnpikesEngine.NetworkLevel.overpass2.elevation,
                path: [10, 20,   30, 20,  15, 40],
                style: { fillStyle: "yellow" }
            });
            this.assertEqual(sut?.label, "inline", "built inline");
            this.assertEqual(sut?.height, TurnpikesEngine.NetworkLevel.overpass2.elevation);
            this.assertElementsEqual(pointArrayDesc(sut?.path), pointArrayDesc([p(10, 20), p(30, 20), p(15, 40)]));
            this.assertEqual(sut?.style?.fillStyle, "yellow");
            
            sut = Shape.fromConfig({
                basis: "test1",
                scaled: 2,
                style: { fillStyle: "orange" }
            });
            this.assertTrue(sut?.label.length > 0, "built inline with basis");
            this.assertFalse(sut?.label == "test1", "unique label");
            this.assertEqual(sut?.height, TurnpikesEngine.NetworkLevel.overpass1.elevation);
            this.assertElementsEqual(pointArrayDesc(sut?.path), pointArrayDesc([p(0, 0), p(60, 0), p(60, 60), p(30, 90), p(0, 60)]));
            this.assertEqual(sut?.style?.fillStyle, "orange");
            
            sut = Shape.fromConfig({ basis: "bogus" });
            this.assertEqual(sut, null, "inline: bogus basis");
            
            shapeStub.tearDown();
        }).buildAndRun();
    }
    
    static pulseTests() {
        new UnitTest("turnpikes.Pulse", function() {
            const Pulse = TurnpikesEngine.Pulse;
            const agentTypeStub = new turnpikes.agentTypeStub();
            
            let sut = Pulse.fromConfig({
                count: 5,
                duration: 5,
                destination: "i95-a",
                pattern: ["moped", "bicycle"]
            });
            this.assertFalse(sut.isRest);
            this.assertEqual(sut.count, 5);
            this.assertEqual(sut.duration, 5);
            this.assertEqual(sut.destinationID, "i95-a");
            this.assertElementsEqual(sut.pattern.map(t => t.id), ["moped", "bicycle"]);
            
            // Rest pulse
            sut = Pulse.fromConfig({
                count: 0,
                duration: 2
            });
            this.assertTrue(sut.isRest);
            this.assertEqual(sut.count, 0);
            this.assertEqual(sut.duration, 2);
            this.assertEqual(sut.destinationID, null);
            this.assertEqual(sut.pattern.length, 0);
            
            agentTypeStub.tearDown();
        }).buildAndRun();
    }
    
    static agentTests() {
        new UnitTest("turnpikes.AgentType", function() {
            const AgentType = TurnpikesEngine.AgentType;
            const agentTypeStub = new turnpikes.agentTypeStub([
                { id: "type1" },
                { id: "type2" }
            ]);
            
            this.assertEqual(AgentType.withID("bogus"), null);
            
            let sut = AgentType.withID("type1");
            this.assertEqual(sut?.id, "type1");
            
            sut = AgentType.withID("type2");
            this.assertEqual(sut?.id, "type2");
            
            agentTypeStub.tearDown();
        }).buildAndRun();
    }
    
    static scenarioTests() {
        new UnitTest("turnpikes.Scenario", function() {
            const Scenario = TurnpikesEngine.Scenario;
            let parcelStub = new turnpikes.classStub(TurnpikesEngine.Parcel, { width: 600, height: 400 });
            const segmentStub = new turnpikes.classStub(TurnpikesEngine.Segment, {
                stub: { length: 10 }
            });
            
            let struct1 = TurnpikesEngine.Structure.fromConfig({
                id: "s1", coord: [0, 0]
            });
            let endpoint1 = TurnpikesEngine.Junction.endpointFromConfig({
                id: "e1",
                end: [10, 20],
                angle: 0
            });
            let sut = new Scenario({
                name: "test",
                structures: [struct1],
                endpoints: [endpoint1]
            });
            
            let parcel = sut.makeParcel();
            this.assertEqual(parcel?.size.width, 600);
            this.assertEqual(parcel?.size.height, 400);
            this.assertEqual(parcel?.findNode("s1")?.id, struct1.id);
            this.assertEqual(parcel?.findNode("e1")?.id, endpoint1.id);
            this.assertEqual(struct1.parcel, parcel);
            this.assertEqual(endpoint1.parcel, parcel);
            this.assertEqual(endpoint1.entering[0].parcel, parcel);
            
            parcelStub.tearDown();
            segmentStub.tearDown();
        }).buildAndRun();
        
        new UnitTest("turnpikes.Scenario.fromConfig", function() {
            const Scenario = TurnpikesEngine.Scenario;
            const agentTypeStub = new turnpikes.agentTypeStub();
            const segmentStub = new turnpikes.classStub(TurnpikesEngine.Segment, {
                stub: { length: 10 }
            });
            
            // Not testing all permutations of Shape/Structure fromConfig here. Trusting it works as expected.
            const scenarioStub = new turnpikes.classStub(Scenario, [
                {
                    id: "test1",
                    name: "Test One",
                    structures: [
                        {
                            id: "struct1",
                            coord: [150, 50],
                            shape: {path: [0, 0, 10, 10, 5, 10]}
                        },
                        {
                            id: "struct2",
                            coord: [73, 28],
                            shape: {path: [10, 10, 100, 10, 50, 10]}
                        }
                    ],
                    endpoints: [
                        {
                            id: "i95-a",
                            start: [10, 350],
                            angle: 0,
                            timeline: [
                                { count: 5, duration: 5, destination: "i95-b", pattern: ["moped"] }
                            ]
                        },
                        {
                            id: "i95-b",
                            end: [97, 38],
                            angle: 270
                        }
                    ]
                }
            ]);
            
            let sut = Scenario.fromConfig("bogus");
            this.assertEqual(sut, null, "ID not found");
            
            sut = Scenario.fromConfig("test1");
            this.assertEqual(sut?.id, "test1", "built test1");
            this.assertEqual(sut?.name, "Test One");
            
            this.assertElementsEqual(sut?.structures.map(s => s.id), ["struct1", "struct2"]);
            this.assertEqual(sut?.structures[0]?.coord, new Point(150, 50));
            this.assertEqual(sut?.structures[1]?.shape?.path[0], new Point(83, 38));
            
            this.assertElementsEqual(sut?.endpoints.map(e => e.id), ["i95-a", "i95-b"]);
            
            scenarioStub.tearDown();
            agentTypeStub.tearDown();
            segmentStub.tearDown();
        }).buildAndRun();
    }
    
    static drawOrderTests() {
        new UnitTest("turnpikes.DrawOrder", function() {
            const DrawOrder = TurnpikesUI.DrawOrder;
            
            let d120 = new DrawOrder([1, 2, 0]);
            let d123 = new DrawOrder([1, 2, 3]);
            let d13 = new DrawOrder([1, 3]);
            
            this.assertTrue(d120.drawsBefore(d123), "d120 < d123");
            this.assertTrue(!d123.drawsBefore(d120), "d123 > d120");
            this.assertTrue(d120.drawsBefore(d13), "d123 < d13");
            this.assertTrue(!d120.drawsBefore(d120), "identity");
            this.assertTrue(d120.drawsBefore(DrawOrder.end), "any < end");
            this.assertTrue(!DrawOrder.end.drawsBefore(d120), "end > any");
            
            let draw120 = new turnpikes.drawableStub("d120", d120);
            let draw123 = new turnpikes.drawableStub("d123", d123);
            let draw13 = new turnpikes.drawableStub("d13", d13);
            
            let events = [];
            function logEvent(drawable) {
                events.push(drawable.name);
            }
            let list = new TurnpikesUI.OrderedDrawableSet();
            this.assertTrue(list.isEmpty, "initially empty");
            list.forEach(logEvent);
            this.assertEqual(events.length, 0, "empty set, forEach is noop");
            
            events.splice(0);
            list.insert(draw123);
            this.assertTrue(!list.isEmpty, "not empty after inserting");
            this.assertEqual(list.find(draw123.id)?.item, draw123, "finds draw123");
            list.forEach(logEvent);
            this.assertElementsEqual(events, ["d123"], "one item");
            
            events.splice(0);
            list.remove(draw123);
            this.assertTrue(list.isEmpty, "empty after removing");
            this.assertEqual(list.find(draw123.id), null, "does not find draw123");
            list.forEach(logEvent);
            this.assertEqual(events.length, 0, "empty set after removal, forEach is noop");
            
            events.splice(0);
            list.insert(draw13);
            list.insert(draw120);
            this.assertEqual(list.find(draw123.id), null, "does not find draw123 yet");
            list.insert(draw123);
            this.assertTrue(!list.isEmpty, "not empty after inserting");
            this.assertEqual(list.find(draw120.id)?.item, draw120, "finds draw120");
            this.assertEqual(list.find(draw123.id)?.item, draw123, "finds draw123");
            this.assertEqual(list.find(draw13.id)?.item, draw13, "finds draw13");
            list.forEach(logEvent);
            this.assertElementsEqual(events, ["d120", "d123", "d13"], "three events");
            
            events.splice(0);
            // duplicate insert
            list.insert(draw123);
            // removing item that doesn't exist
            list.remove(new turnpikes.drawableStub("bogus", d13));
            list.remove(draw120);
            this.assertEqual(list.find(draw123.id)?.item, draw123, "after dupe insert/failed remove: finds draw123");
            list.forEach(logEvent);
            this.assertElementsEqual(events, ["d123", "d13"], "after changes: two events");
        }).buildAndRun();
    }
} // end class turnpikes

turnpikes.drawableStub = class DrawableStub extends TurnpikesUI.Drawable {
    constructor(name, _drawOrder) {
        super(name);
        this.name = name;
        this._drawOrder = _drawOrder;
    }
};

turnpikes.classStub = class {
    constructor(type, config) {
        this.type = type;
        this.oldConfig = type.config;
        type.setConfig(config);
    }
    
    tearDown() {
        this.type.config = this.oldConfig;
    }
};
turnpikes.classStub.networkBuilder = () => {
    return new turnpikes.classStub(TurnpikesEngine.NetworkBuilder, {
        attachmentRadius: 5
    });
};

turnpikes.agentTypeStub = class {
    constructor(a) {
        this.oldConfig = TurnpikesEngine.AgentType.all;
        if (Array.isArray(a)) {
            TurnpikesEngine.AgentType.setConfig(a);
        } else {
            TurnpikesEngine.AgentType.setConfig([
                { id: "moped" },
                { id: "bicycle" }
            ]);
        }
    }
    
    tearDown() {
        TurnpikesEngine.AgentType.all = this.oldConfig;
    }
};

function assemblySuite() { return new TestSession([
    assembly.datatypeTests,
    assembly.instructionTests
]); }

function turnpikesSuite() { return new TestSession([
    g.pointerInputControllerTests,
    turnpikes.parcelTests,
    turnpikes.structureTests,
    // turnpikes.landscapeFeatureTests,
    turnpikes.segmentTests,
    turnpikes.junctionTests,
    turnpikes.networkBuilderTests,
    turnpikes.shapeTests,
    turnpikes.pulseTests,
    turnpikes.agentTests,
    turnpikes.scenarioTests,
    turnpikes.drawOrderTests
]); }

// swept.initialized = false;
// async function initSweep() {
//     if (swept.initialized) { console.log({ already: Sweep.Game.rules() }); return; }
//     swept.initialized = true;
//     await Sweep.initialize();
//     // TODO change the backing store for GameStorage from window.localStorage to some stub
// }

function standardSuite() { return new TestSession([
    // rectHashTest,
    manhattanDistanceFromTest,
    hexStringTest,
    boolArrayTest,
    base64Test,
    changeTokenBindingTest,
    circularArrayTest,
    randomTest,
    randomBlobTest,
    randomLineTest,
    rectTest,
    stringsTest,
    selectableListTest,
    serializerTests,
    saveStateTest,
    animationLoopTest,
    dispatchTest,
    kvoTest,
    bindingTest,
    tilePlaneTest,
    flexCanvasGridTest1,
    flexCanvasGridTest2,
    flexCanvasGridTest3,
    cityRectExtensionsTest,
    swept.gameTileTests,
    swept.sharingTests,
    swept.autosaveTests,
    civved.baseGeometryTests,
    civved.mapTests,
    civved.worldModelTests,
    civved.tileProjectionTests,
    civved.worldViewTests,
    civved.drawableTests,
    civved.savegameTests,
    civved.systemUItests
    // simDateTest
]); }

function taskSuite() { return new TestSession([
    // swept.autosaveTests
    swept.convolutionTests
]); }

function taskSuite2() { return new TestSession([
    // civved.baseGeometryTests,
    // civved.mapTests,
    civved.worldModelTests,
    // civved.tileProjectionTests,
    civved.worldViewTests,
    civved.drawableTests,
    // civved.savegameTests,
    // civved.systemUItests
]); }

async function loadCivvedContent() {
    console.log("loadCivvedContent");
    CivGame.inj().gse = new GameScriptEngine();
    let content = await GameContent.loadYamlFromLocalFile(`civ/content.yaml`, GameContent.cachePolicies.forceOnFirstLoad);
    Strings.initialize(content.strings, content.pluralStrings, navigator.language);
    return content;
}

async function initCivved() {
    console.log("initCivved");
    CivGame.Env.initialize();
    let content = await loadCivvedContent();
    CivGame.Game.initialize(content);
    CivGame.inj().rng = Rng.shared;
}

// TestSession.current = taskSuite();
// TestSession.current = standardSuite();
// TestSession.current = assemblySuite();
TestSession.current = turnpikesSuite();

export async function uiReady() {
    console.log("uiReady");
    // await initCivved();
    TestSession.current.run(document.querySelector("#testOutput"));
}
