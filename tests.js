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
    PerfTimer, PeriodicRandomComponent, Point,
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
    return poly.map(p => p.debugDescription);
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
            
            parcel.removeNode(node1);
            this.assertEqual(node1.parcel, null);
            this.assertEqual(parcel.findNode(node1.id), null);
            parcel.forEachNode(node => watcher.events.push(`forEachNode:${node.id}`));
            
            this.assertElementsEqual(watcher.events, [
                "addNode:struct1", "addNode:struct2", "forEachNode:struct1", "forEachNode:struct2", "removeNode:struct1", "forEachNode:struct2"
            ]);
            Kvo.stopAllObservations(watcher);
        }).buildAndRun();
    }
    
    static structureTests() {
        new UnitTest("turnpikes.Structure", function() {
        }).buildAndRun();
        
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
            
            seg = Segment.stub("e2", null, new Point(100, 200), 120);
            this.assertEqual(seg.id, "e2");
            this.assertEqual(seg.coord, new Point(100, 200));
            this.assertElementsEqual(pointArrayDesc(seg.path), pointArrayDesc([new Point(108, 187), new Point(100, 200)]));
            this.assertEqual(seg.start, null);
            this.assertEqual(seg.end, null);
            
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
} // end class turnpikes

turnpikes.classStub = class {
    constructor(type, config) {
        this.oldConfig = type.config;
        type.setConfig(config);
    }
    
    tearDown() {
        this.config = this.oldConfig;
    }
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
    turnpikes.parcelTests,
    turnpikes.structureTests,
    // turnpikes.landscapeFeatureTests,
    turnpikes.segmentTests,
    turnpikes.junctionTests,
    turnpikes.shapeTests,
    turnpikes.pulseTests,
    turnpikes.agentTests,
    turnpikes.scenarioTests
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
