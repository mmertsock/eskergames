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

import * as Sweep from './sweep.js';
import * as SweepSolver from './sweep-solver.js';
import * as CivGame from './civ/game.js';
import * as CivGameUI from './civ/ui-game.js';
import * as CivSystemUI from './civ/ui-system.js';
import * as CivDrawables from './civ/ui-drawables.js';

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
        this.expectations += 1;
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

class Sparkblob {
    constructor(config) {
        this.elem = document.createElement("table").addRemClass("sparkblob", true);
        this.value = config.value; // Array of BoolArrays
        for (let y = 0; y < this.value.length; y += 1) {
            let tr = document.createElement("tr");
            for (let x = 0; x < this.value[y].length; x += 1) {
                let td = document.createElement("td");
                let z = this.value[y].getValue(x);
                td.addRemClass("highlighted", z);
                let span = document.createElement("span");
                span.innerText = z ? "1" : "0";
                td.append(span);
                tr.append(td);
            }
            this.elem.append(tr);
        }
    }

    static withTilesInRect(config) {
        let rows = [];
        for (let y = 0; y < config.rect.height; y += 1) {
            let row = new BoolArray(config.rect.width);
            for (let x = 0; x < config.rect.width; x += 1) {
                let point = new Point(x + config.rect.origin.x, y + config.rect.origin.y);
                if (config.tiles.findIndex(tile => tile.isEqual(point)) >= 0) {
                    row.setValue(x, true);
                }
            }
            rows.push(row);
        }
        return new Sparkblob({ value: rows });
    }
}

class Sparkline {
    constructor(config) {
        this.elem = document.createElement("ol").addRemClass("sparkline", true);
        this.style = config.style; // bar, point
        this.min = config.min;
        this.max = config.max;
        this.count = 0;
        this.values = [];
        if (config.width) {
            this.elem.style.width = `${config.width}px`;
            this.autoWidth = false;
        } else {
            this.autoWidth = true;
        }
        if (config.height) {
            this.elem.style.height = `${config.height}px`;
        }
    }
    append(values) {
        values.forEach(value => this.push(value));
    }
    push(value) {
        this.values.push(value);
        var magnitude = Math.scaleValueLinear(value, { min: this.min, max: this.max }, { min: 0, max: 100 });
        var item = document.createElement("li");
        item.style.height = `${100 - magnitude}%`;
        var span = document.createElement("span");
        span.innerText = value;
        item.append(span);
        this.count += 1;
        this.elem.append(item);
        if (this.autoWidth) {
            this.elem.style.width = `${this.count}px`;
        }
    }

    get debugDescription() {
        let values = this.values.join(", ");
        return `<Sparkline [${this.min}...${this.max}]: ${values}>`;
    }
}

function visualizationHeader(text, sut, visualizationElem) {
    let title = document.createElement("h4");
    title.innerText = (text ? (text + " ") : "") + sut.debugDescription;
    visualizationElem.append(title);
}

function componentSparkline(config, visualizationElem) {
    let sut = config.sut;
    let values = [];
    for (let i = 0; i < config.count; i += 1) {
        values.push(sut.nextValue() + sut.amplitude);
    }

    visualizationHeader(config.title, sut, visualizationElem);

    let max = typeof(config.max) == 'undefined' ? (2 * sut.amplitude) : config.max;
    let spark = new Sparkline({ min: 0, max: max, width: 200, height: 50 });
    spark.append(values);
    visualizationElem.append(spark.elem);
}

function rlgSparkline(config, visualizationElem) {
    let mapper = typeof(config.mapper) == 'undefined'
        ? (i => i) : config.mapper;
    let sut = new RandomLineGenerator(config);
    console.log(sut);

    let iterations = sut.prefillSmoothing();
    console.log(`Prefilled with ${iterations} iterations, lastValue = ${sut.lastValue}`);

    let values = [];
    for (var i = 0; i < config.count; i += 1) {
        values.push(mapper(sut.nextValue()));
    }

    visualizationHeader(config.title, sut, visualizationElem);

    let spark = new Sparkline({ min: config.min, max: config.max, width: 200, height: 50 });
    spark.append(values);
    visualizationElem.append(spark.elem);
}

let randomLineTest = function() {
    new UnitTest("RandomLineGenerator", function() {
        let components = [
            new PeriodicRandomComponent({ amplitude: 5, period: { min: 20, max: 50 } }),
            new PeriodicRandomComponent({ amplitude: 2, period: { min: 5, max: 25 }, x: 0.5 * Math.PI }),
            new PeriodicRandomComponent({ amplitude: 1, period: { min: 1, max: 10 }, x: Math.PI }),
            new RandomComponent({ amplitude: 1 })
        ];

        rlgSparkline({ min: 0, max: 20, count: 100, smoothing: 3, components: components }, this.visualizationElem);
        components.forEach(i => componentSparkline({ sut: i, count: 100, max: 8.5 }, this.visualizationElem));
        componentSparkline({ sut: new RandomComponent({ amplitude: 1, smoothing: 3 }), count: 100, max: 8.5 }, this.visualizationElem);
    }).buildAndRun();
}

let randomBlobTest = function() {
    new UnitTest("RandomBlobGenerator", function() {
        let sut = new RandomBlobGenerator({
            variance: 1,
            components: [new RandomComponent({ amplitude: 1 })],
            smoothing: 3
        });

        visualizationHeader(null, sut, this.visualizationElem);
        let blob = sut.makeBlob({ width: 16, height: 10 });
        // console.log(blob);
        if (this.assertEqual(blob.length, 10)) {
            this.assertEqual(blob[0].length, 16);
        }

        this.visualizationElem.append(new Sparkblob({ value: blob }).elem);
        let spark = new Sparkline({ min: 0, max: 1, width: 200, height: 50 });
        spark.append(sut.radiusValues);
        this.visualizationElem.append(spark.elem);

        visualizationHeader(null, sut, this.visualizationElem);
        this.visualizationElem.append(new Sparkblob({ value: sut.makeBlob({ width: 16, height: 10 }) }).elem);

        visualizationHeader("makeRandomTiles t=0.5", sut, this.visualizationElem);
        let rect = new Rect(0, 0, 16, 10);
        this.visualizationElem.append(Sparkblob.withTilesInRect({ rect: rect, tiles: sut.makeRandomTiles(rect, 0.5) }).elem);

        visualizationHeader("makeRandomTiles t=0.5", sut, this.visualizationElem);
        this.visualizationElem.append(Sparkblob.withTilesInRect({ rect: rect, tiles: sut.makeRandomTiles(rect, 0.5) }).elem);

        visualizationHeader("smooth ellipse t=0", sut, this.visualizationElem);
        this.visualizationElem.append(Sparkblob.withTilesInRect({ rect: rect, tiles: sut.smoothEllipse(rect, 0) }).elem);

        visualizationHeader("smooth ellipse t=0.5", sut, this.visualizationElem);
        this.visualizationElem.append(Sparkblob.withTilesInRect({ rect: rect, tiles: sut.smoothEllipse(rect, 0.5) }).elem);

        visualizationHeader("smooth ellipse t=1", sut, this.visualizationElem);
        this.visualizationElem.append(Sparkblob.withTilesInRect({ rect: rect, tiles: sut.smoothEllipse(rect, 1) }).elem);

        // visualizationHeader("smooth ellipse t=0 r=3x3", sut, this.visualizationElem);
        // rect = new Rect(0, 0, 3, 3);
        // this.visualizationElem.append(Sparkblob.withTilesInRect({ rect: rect, tiles: sut.smoothEllipse(rect, 0.5) }).elem);
        // visualizationHeader("smooth ellipse t=0 r=2x2", sut, this.visualizationElem);
        // rect = new Rect(0, 0, 2, 2);
        // this.visualizationElem.append(Sparkblob.withTilesInRect({ rect: rect, tiles: sut.smoothEllipse(rect, 0.5) }).elem);
        // visualizationHeader("smooth ellipse t=0 r=1x1", sut, this.visualizationElem);
        // rect = new Rect(0, 0, 1, 1);
        // this.visualizationElem.append(Sparkblob.withTilesInRect({ rect: rect, tiles: sut.smoothEllipse(rect, 0.5) }).elem);

        sut = new RandomBlobGenerator({
            variance: 0.5,
            components: [new PeriodicRandomComponent({ amplitude: 3, period: { min: 4, max: 4 } }),
                new RandomComponent({ amplitude: 1 })],
            smoothing: 3
        });
        visualizationHeader(null, sut, this.visualizationElem);
        this.visualizationElem.append(new Sparkblob({ value: sut.makeBlob({ width: 16, height: 10 }) }).elem);
    }).buildAndRun();
}

class UndoItem {
    constructor(target, value, oldValue) {
        this.target = target;
        this.value = value;
        this.oldValue = oldValue;
    }
    undo() { this.target.value = this.oldValue; }
    redo() { this.target.value = this.value; }
}

var undoStackTest = function() {
    new UnitTest("UndoStack", function() {
        var obj = { value: 0 };
        var sut = new UndoStack();
        var perform = function(value) {
            var oldValue = obj.value;
            obj.value = value;
            sut.push(new UndoItem(obj, value, oldValue));
        };

        this.assertFalse(sut.canUndo);
        this.assertEqual(sut.nextUndoItem, null);
        this.assertFalse(sut.canRedo);
        this.assertEqual(sut.nextRedoItem, null);
        this.assertFalse(sut.undo());
        this.assertFalse(sut.redo());

        perform(1); // [#0>1]
        this.assertEqual(obj.value, 1);
        if (this.assertTrue(sut.canUndo)) {
            this.assertEqual(sut.nextUndoItem.value, 1);
        }
        this.assertFalse(sut.canRedo);
        this.assertEqual(sut.nextRedoItem, null);

        perform(2); // [0>1 #1>2]
        this.assertEqual(obj.value, 2);
        if (this.assertTrue(sut.canUndo)) {
            this.assertEqual(sut.nextUndoItem.value, 2);
        }
        this.assertFalse(sut.canRedo);
        this.assertEqual(sut.nextRedoItem, null);

        this.assertTrue(sut.undo()); // [#0>1 1>2]
        this.assertEqual(obj.value, 1);
        if (this.assertTrue(sut.canUndo)) {
            this.assertEqual(sut.nextUndoItem.value, 1);
        }
        if (this.assertTrue(sut.canRedo)) {
            this.assertEqual(sut.nextRedoItem.value, 2);
        }

        this.assertTrue(sut.redo()); // [0>1 #1>2]
        this.assertEqual(obj.value, 2);
        if (this.assertTrue(sut.canUndo)) {
            this.assertEqual(sut.nextUndoItem.value, 2);
        }
        this.assertFalse(sut.canRedo);
        this.assertEqual(sut.nextRedoItem, null);

        this.assertTrue(sut.undo()); // [#0>1 1>2]
        this.assertEqual(obj.value, 1);
        this.assertTrue(sut.canUndo);
        this.assertTrue(sut.canRedo);

        perform(20); // [0>1 #1>20]
        this.assertEqual(obj.value, 20);
        if (this.assertTrue(sut.canUndo)) {
            this.assertEqual(sut.nextUndoItem.value, 20);
        }
        this.assertFalse(sut.canRedo);
        this.assertEqual(sut.nextRedoItem, null);

        this.assertTrue(sut.undo()); // [#0>1 1>20]
        this.assertEqual(obj.value, 1);
        this.assertTrue(sut.canUndo);
        this.assertTrue(sut.canRedo);

        this.assertTrue(sut.undo()); // [# 0>1 1>20]
        this.assertEqual(obj.value, 0);
        this.assertFalse(sut.canUndo);
        this.assertTrue(sut.canRedo);

        this.assertFalse(sut.undo());
        this.assertTrue(sut.redo());
        this.assertEqual(obj.value, 1);
    }).buildAndRun();
}

var manhattanDistanceFromTest = function() {
    new UnitTest("Point.manhattanDistanceFrom", function() {
        var x0y0 = new Point(0, 0);
        var x1y1 = new Point(1, 1);
        var xn1y7 = new Point(-1, 7);
        var x7y5 = new Point(7, 5);
        var result = x0y0.manhattanDistanceFrom(x0y0);
        this.assertEqual(result.dx, 0);
        this.assertEqual(result.dy, 0);
        this.assertEqual(result.magnitude, 0);
        this.assertEqual(result.pathLength, 0);
        result = x1y1.manhattanDistanceFrom(x0y0);
        this.assertEqual(result.dx, 1);
        this.assertEqual(result.dy, 1);
        this.assertEqual(result.magnitude, 1);
        this.assertEqual(result.pathLength, 2);
        result = x0y0.manhattanDistanceFrom(x1y1);
        this.assertEqual(result.dx, -1);
        this.assertEqual(result.dy, -1);
        this.assertEqual(result.magnitude, 1);
        this.assertEqual(result.pathLength, 2);
        result = x0y0.manhattanDistanceFrom(1, 0);
        this.assertEqual(result.dx, -1);
        this.assertEqual(result.dy, 0);
        this.assertEqual(result.magnitude, 1);
        this.assertEqual(result.pathLength, 1);
        result = xn1y7.manhattanDistanceFrom(x7y5);
        this.assertEqual(result.dx, -8);
        this.assertEqual(result.dy, 2);
        this.assertEqual(result.magnitude, 8);
        this.assertEqual(result.pathLength, 10);
        result = xn1y7.manhattanDistanceFrom(7, 5);
        this.assertEqual(result.dx, -8);
        this.assertEqual(result.dy, 2);
        this.assertEqual(result.magnitude, 8);
        this.assertEqual(result.pathLength, 10);
    }).buildAndRun();
}

let rectTest = function() {
    new UnitTest("Rect", function() {
        let rectInt = new Rect(2, 3, 20, 30);
        let rectFloat = new Rect(2.1, 2.8, 19.9, 30.1);
        let rectFloatInt = rectFloat.integral();
        this.assertTrue(rectFloatInt.isEqual(rectInt));
        let r = rectFloat.inset(5, 2.5);
        this.assertEqualTol(r.origin, new Point(7.1, 5.3), 0.01);
        this.assertEqualTol(r.width, 9.9, 0.01);
        this.assertEqualTol(r.height, 25.1, 0.01);
        r = rectFloat.inset(10, 50);
        this.assertEqualTol(r.origin, rectFloat.center, 0.01);
        this.assertEqual(r.width, 0);
        this.assertEqual(r.height, 0);
    }).buildAndRun();
}

function hexStringTest() {
    new UnitTest("Array hexString", function() {
        this.assertEqual([].toHexString(), "", "empty array");
        this.assertEqual([0].toHexString(), "00");
        this.assertEqual([5, 8].toHexString(), "0508");        this.assertEqual([127, 128, 255].toHexString(), "7f80ff");
        this.assertElementsEqual(Array.fromHexString(null), [], "from null");
        this.assertElementsEqual(Array.fromHexString(""), [], "from empty");
        this.assertElementsEqual(Array.fromHexString("0"), []);
        this.assertElementsEqual(Array.fromHexString("00"), [0]);
        this.assertElementsEqual(Array.fromHexString("0508"), [5, 8]);
        this.assertElementsEqual(Array.fromHexString("7f80FF"), [127, 128, 255]);
        this.assertElementsEqual(Array.fromHexString("00\n01 02\n 03    99"), [0, 1, 2, 3, 153]);
        let obj = [0, 2, 99, 84, 127, 250, 200, 0, 73, 64, 28];
        this.assertElementsEqual(Array.fromHexString(obj.toHexString()), obj, "round trip");
    }).buildAndRun();
}

function boolArrayTest() {
    new UnitTest("BoolArray", function() {
        var sut = new BoolArray(0);
        this.assertEqual(sut.length, 0, "length");

        sut = new BoolArray(1);
        this.assertEqual(sut.length, 1, "length");
        this.assertFalse(sut.getValue(0), "0 unset");
        sut.setValue(0, true);
        this.assertTrue(sut.getValue(0), "0 set");
        sut.setValue(0, false);
        this.assertFalse(sut.getValue(0), "0 clear");

        sut = new BoolArray(11);
        this.assertEqual(sut.length, 11, "length");
        this.assertFalse(sut.getValue(3), "3 unset");
        sut.setValue(3, true);
        this.assertTrue(sut.getValue(3), "3 set");
        this.assertFalse(sut.getValue(7), "7 unset");
        sut.setValue(7, true);
        this.assertTrue(sut.getValue(7), "7 set");
        sut.setValue(7, false);
        this.assertFalse(sut.getValue(7), "7 clear");
        sut.setValue(8, true);
        this.assertTrue(sut.getValue(8));
        for (var i = 0; i < 11; i += 1) {
            sut.setValue(i, true);
            this.assertTrue(sut.getValue(i), `${i} set (loop)`);
        }
        for (var i = 0; i < 11; i += 1) {
            sut.setValue(i, false);
            this.assertFalse(sut.getValue(i), `${i} clear (loop)`);
        }
        for (var i = 0; i < 11; i += 1) {
            sut.setValue(i, Rng.shared.nextUnitFloat() > 0.5);
        }
        sut.setValue(2, true); sut.setValue(5, false); sut.setValue(6, true);
        logTestMsg(sut.debugDescription);
        this.assertTrue(sut.getValue(2), "2 after randomize");
        this.assertFalse(sut.getValue(5), "5 after randomize");
        this.assertTrue(sut.getValue(6), "6 after randomize");
    }).buildAndRun();

    new UnitTest("BoolArray.objectForSerialization", function() {
        let sut = new BoolArray(27);
        sut.setValue(0, true);
        sut.setValue(1, true);
        sut.setValue(11, true);
        sut.setValue(26, true);
        let bytes = sut.objectForSerialization;
        this.assertTrue(Array.isArray(bytes));
        this.assertEqual(bytes.length, 5);
        this.assertEqual(bytes[0], 5); // 5 dead bits in the last byte
        this.assertEqual(bytes[1], 3);
        this.assertEqual(bytes[2], 8);
        this.assertEqual(bytes[3], 0);
        this.assertEqual(bytes[4], 4);
        let other = new BoolArray(bytes);
        this.assertEqual(sut.length, 27);
        for (let i = 0; i < 27; i += 1) {
            this.assertEqual(other.getValue(i), sut.getValue(i), i);
        }
        
        sut = new BoolArray(293);
        for (let i = 0; i < 180; i += 1) {
            sut.setValue(Rng.shared.nextIntOpenRange(0, sut.length), true);
        }
        bytes = sut.objectForSerialization;
        let sz = sut.base64Serialization;
        let dz = BoolArray.fromBase64Serialization(sz);
        // logTestMsg(`len=${sut.length}, bytes=${bytes.length} sz=${sz.length}, ${sz}`);
        if (this.assertEqual(dz.length, sut.length)) {
            this.assertTrue(sut.array.every((elem, i) => (elem == dz.array[i])));
        }
    }).buildAndRun();
}

function base64Test() {
    new UnitTest("Uint8Array.Base64", function() {
        let sut = new Uint8Array(85);
        for (let i = 0; i < sut.length; i += 1) {
            sut[i] = Rng.shared.nextIntOpenRange(0, 256);
        }
        let b64 = sut.toBase64String();
        let dz = Uint8Array.fromBase64String(b64);
        this.assertEqual(sut?.constructor.name, dz?.constructor.name);
        if (this.assertEqual(sut?.length, dz?.length)) {
            this.assertTrue(sut.every((elem, i) => (elem == dz[i])));
        }
    }).buildAndRun();
}

let serializerTests = function() {
    class DataA {
        static fromDz(a) { return new DataA(a); }
        constructor(a) {
            this.p1 = a.p1;
            this.p2 = a.p2;
            this.pNotSz = a.pNotSz;
            this.pb = a.pb;
            this.pAry1 = a.pAry1;
            this.pAryB = a.pAryB;
        }
    }
    class DataB {
        static fromDz(a) { return new DataB(a); }
        constructor(a) {
            this.p1 = a.p1;
        }
    }
    
    new UnitTest("Serializer", function() {
        let sut = new Serializer(1, new Serializer.VerboseObjectStrategy(), DataA.fromDz, [
            Serializer.key("p1"),
            Serializer.key("p2"),
            Serializer.key("pb", DataB.name),
            Serializer.key("pAry1", []),
            Serializer.key("pAryB", [DataB.name])
        ]);
        sut = sut.ruleset(DataB.name, DataB.fromDz, [
            Serializer.key("p1")
        ]);
        
        // Basic test
        let obja = new DataA({
            p1: "p 1",
            p2: 2,
            pNotSz: "not sz",
            pb: new DataB({ p1: "p1" }),
            pAry1: [1, 2, 3],
            pAryB: [new DataB({ p1: 0}), null, new DataB({ p1: 1 })]
        });
        let o = sut.serialize(obja);
        this.assertEqual(o.schemaVersion, 1);
        if (this.assertDefined(o.data)) {
            this.assertEqual(Object.getOwnPropertyNames(o.data).length, 5);
            this.assertEqual(o.data.p1, "p 1");
            this.assertEqual(o.data.p2, 2);
            if (this.assertDefined(o.data.pb)) {
                this.assertEqual(o.data.pb.p1, "p1");
            }
            this.assertElementsEqual(o.data.pAry1, [1, 2, 3]);
            if (this.assertTrue(Array.isArray(o.data.pAryB))) {
                this.assertEqual(o.data.pAryB[0].p1, 0);
                this.assertEqual(o.data.pAryB[1], null);
                this.assertEqual(o.data.pAryB[2].p1, 1);
            }
        }
        
        // Test null values
        let objaNull = new DataA({ p1: undefined, p2: null, pNotSz: null, pb: null });
        o = sut.serialize(objaNull);
        if (this.assertDefined(o.data)) {
            this.assertEqual(o.data.p1, null);
            this.assertEqual(o.data.p2, null);
            this.assertEqual(o.data.pb, null);
        }
        
        // Deserialization
        let dzObja = sut.deserialize(sut.serialize(obja));
        if (this.assertTrue(dzObja instanceof DataA)) {
            this.assertEqual(dzObja.p1, "p 1");
            this.assertEqual(dzObja.p2, 2);
            if (this.assertTrue(dzObja.pb instanceof DataB)) {
                this.assertEqual(dzObja.pb.p1, "p1");
            }
            if (this.assertTrue(Array.isArray(dzObja.pAry1))) {
                this.assertElementsEqual(dzObja.pAry1, [1, 2, 3]);
            }
            if (this.assertTrue(Array.isArray(dzObja.pAryB))) {
                this.assertTrue(dzObja.pAryB[0] instanceof DataB);
                this.assertEqual(dzObja.pAryB[0].p1, 0);
                this.assertEqual(dzObja.pAryB[1], null);
                this.assertTrue(dzObja.pAryB[2] instanceof DataB);
                this.assertEqual(dzObja.pAryB[2].p1, 1);
            }
        }
        
        // ObjectArrayStrategy
        sut.strategy = new Serializer.ObjectArrayStrategy();
        dzObja = sut.deserialize(sut.serialize(obja));
        if (this.assertTrue(dzObja instanceof DataA)) {
            this.assertEqual(dzObja.p1, "p 1");
            this.assertEqual(dzObja.p2, 2);
            if (this.assertTrue(dzObja.pb instanceof DataB)) {
                this.assertEqual(dzObja.pb.p1, "p1");
            }
            if (this.assertTrue(Array.isArray(dzObja.pAry1))) {
                this.assertElementsEqual(dzObja.pAry1, [1, 2, 3]);
            }
            if (this.assertTrue(Array.isArray(dzObja.pAryB))) {
                this.assertTrue(dzObja.pAryB[0] instanceof DataB);
                this.assertEqual(dzObja.pAryB[0].p1, 0);
                this.assertEqual(dzObja.pAryB[1], null);
                this.assertTrue(dzObja.pAryB[2] instanceof DataB);
                this.assertEqual(dzObja.pAryB[2].p1, 1);
            }
        }
    }).buildAndRun();
        
    new UnitTest("Serializer.CtxAndRefs", function() {
        class CtxExample {
            static fromDz(a, serializer) {
                return new CtxExample(Object.assign({ now: serializer.context.now }, a));
            }
            
            constructor(a) {
                this.raFull = a.ra;
                this.rbFull = a.rb;
                this.ra = a.ra;
                this.r2 = a.r2;
                this.rb = a.rb;
                this.now = a.now;
            }
        }
        class RefExample {
            static fromDz(a) { return new RefExample(a); }
            constructor(a) {
                this.id = a.id;
                this.name = a.name;
            }
        }
        class RefExample2 {
            static fromDz(a) { return new RefExample2(a); }
            constructor(a) {
                this.id2 = a.id2;
                this.name = a.name;
            }
        }
        
        // References and Serializer context
        let sut = new Serializer(2, new Serializer.VerboseObjectStrategy(), CtxExample.fromDz, [
            Serializer.key("raFull", RefExample.name),
            Serializer.key("rbFull", RefExample2.name),
            Serializer.key("ra", Serializer.reference("id", RefExample.name)),
            Serializer.key("r2", Serializer.reference("id", RefExample.name)),
            Serializer.key("rb", Serializer.reference("id2", RefExample2.name))
        ]).ruleset(RefExample.name, RefExample.fromDz, [
            Serializer.key("id"),
            Serializer.key("name")
        ]).ruleset(RefExample2.name, RefExample2.fromDz, [
            Serializer.key("id2"),
            Serializer.key("name")
        ]);
        
        let r1 = new RefExample({ id: "id1", name: 1 });
        let r2 = new RefExample({ id: "id2", name: 2 });
        let r3 = new RefExample2({ id2: "idb", name: "b" });
        let ctxex = new CtxExample({ raFull: r1, rbFull: r3, ra: r1, r2: r2, rb: r3, now: 1 });
        let o = sut.serialize(ctxex);
        this.assertEqual(o.data.raFull.name, r1.name);
        this.assertEqual(o.data.rbFull.name, r3.name);
        this.assertEqual(o.data.ra, r1.id);
        this.assertEqual(o.data.r2, r2.id);
        this.assertEqual(o.data.rb, r3.id2);
        this.assertEqual(typeof(o.data.now), 'undefined');
        
        let ctxdz = sut.deserialize(o, { now: 2 });
        this.assertTrue(ctxdz instanceof CtxExample);
        this.assertTrue(ctxdz.ra instanceof RefExample);
        // no full RefExample object serialized for r2 so the id lookup will fail
        this.assertEqual(ctxdz.r2, null);
        this.assertEqual(ctxdz.ra.name, r1.name);
        this.assertTrue(ctxdz.rb instanceof RefExample2);
        this.assertEqual(ctxdz.rb.name, r3.name);
        this.assertEqual(ctxdz.now, 2);
    }).buildAndRun();
};

var circularArrayTest = function() {
    new UnitTest("CircularArray", function() {
        var sut = new CircularArray(5);
        this.assertEqual(sut.maxLength, 5);
        this.assertTrue(sut.isEmpty)
        this.assertEqual(sut.size, 0);
        this.assertEqual(sut.first, null);
        this.assertEqual(sut.last, null);
        this.assertElementsEqual(sut.values, []);

        sut.push("A");
        this.assertEqual(sut.maxLength, 5);
        this.assertFalse(sut.isEmpty);
        this.assertEqual(sut.size, 1);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "A");
        this.assertElementsEqual(sut.values, ["A"]);

        sut.push("B");
        this.assertFalse(sut.isEmpty);
        this.assertEqual(sut.size, 2);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "B");
        this.assertElementsEqual(sut.values, ["A", "B"]);

        sut.push("C");
        sut.push("D");
        this.assertFalse(sut.isEmpty);
        this.assertEqual(sut.size, 4);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "D");
        this.assertElementsEqual(sut.values, ["A", "B", "C", "D"]);

        sut.push("E");
        this.assertEqual(sut.size, 5);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "E");
        this.assertElementsEqual(sut.values, ["A", "B", "C", "D", "E"]);

        sut.push("F");
        this.assertEqual(sut.size, 5);
        this.assertEqual(sut.first, "B");
        this.assertEqual(sut.last, "F");
        this.assertElementsEqual(sut.values, ["B", "C", "D", "E", "F"]);

        sut.push("G"); sut.push("H"); sut.push("I"); sut.push("J"); sut.push("K"); sut.push("L");
        this.assertEqual(sut.size, 5);
        this.assertEqual(sut.first, "H");
        this.assertEqual(sut.last, "L");

        sut.reset();
        this.assertEqual(sut.maxLength, 5);
        this.assertTrue(sut.isEmpty);
        this.assertEqual(sut.size, 0);
        this.assertEqual(sut.first, null);
        this.assertEqual(sut.last, null);

        sut.push("A");
        this.assertFalse(sut.isEmpty);
        this.assertEqual(sut.size, 1);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "A");
        this.assertElementsEqual(sut.values, ["A"]);
    }).buildAndRun();
}

var randomTest = function() {
    new UnitTest("Rng", function(config) {
        var sut = new Rng();
        var range = { min: 10000000, max: -10000000 };
        for (var i = 0; i < config.iterations; i += 1) {
            var next = sut.nextIntOpenRange(5, 17);
            range.min = Math.min(range.min, next);
            range.max = Math.max(range.max, next);
        }
        this.assertEqual(range.min, 5);
        this.assertEqual(range.max, 16);

        range = { min: 10000000, max: -10000000 };
        for (var i = 0; i < config.iterations; i += 1) {
            var next = sut.nextUnitFloat();
            range.min = Math.min(range.min, next);
            range.max = Math.max(range.max, next);
        }
        this.assertTrue(range.min >= 0);
        this.assertTrue(range.max < 1);

        var str = sut.nextHexString(0);
        this.assertEqual(str, "");
        str = sut.nextHexString(3);
        this.assertEqual(str.length, 3);
        str = sut.nextHexString(4);
        this.assertEqual(str.length, 4);
        str = sut.nextHexString(5);
        this.assertEqual(str.length, 5);
        str = sut.nextHexString(17);
        this.assertEqual(str.length, 17);
        // logTestMsg(str);
        var strs = [sut.nextHexString(4), sut.nextHexString(4), sut.nextHexString(4)];
        this.assertTrue((strs[0] != strs[1]) && (strs[1] != strs[2]));
    }).build()({ iterations: 1000 }, null);
}

var stringsTest = function() {
    let l10n = {
        _debug: true,
        _defaultRegion: "en-us",
        hello: "henlo",
        helloTemplate: "henlo, <first> x. <last> of <last>land",
        pluralsTemplate: "henlo <first>: <mineCountCleared#mineCount> and <customPlaceholder#hashtags>",
        pluralsTemplateFormattedMagnitude: "henlo <first>: <mineCountCleared#mineCount#formattedMineCount> and <customPlaceholder#hashtags#formatMyHashtags>",
        obj1: 123,
        obj2: false,
        obj3: { x: "x1" }
    };
    let l10ns = {
        mineCountCleared: ["# mines cleared", "1 mine cleared", "# mines cleared"],
        customPlaceholder: ["created no #hashtags", "created one #hashtag", "created N #hashtags", "N"]
    };
    Strings.initialize(l10n, l10ns);

    new UnitTest("Strings.str", function() {
        this.assertEqual(Strings.str("hello"), "henlo");
        this.assertEqual(Strings.str("bogus"), "?bogus?");
        this.assertEqual(Strings.str("bogus", "fallback"), "fallback");
    }).build()(null, null);
    
    new UnitTest("Strings.value", function() {
        this.assertEqual(Strings.value("obj1"), 123, "obj1: number");
        this.assertEqual(Strings.value("obj2"), false, "obj2: bool");
        this.assertEqual(Strings.value("obj3").x, "x1", "obj3: obj");
        this.assertEqual(typeof(Strings.value("bogus")), "undefined", "bogus: undefined");
    }).buildAndRun();

    new UnitTest("Strings.template", function() {
        this.assertEqual(Strings.template("hello"), "henlo");
        this.assertEqual(Strings.template("hello", { hello: "no" }), "henlo");
        this.assertEqual(Strings.template("helloTemplate"), "henlo, <first> x. <last> of <last>land");
        this.assertEqual(Strings.template("helloTemplate", { bogus: "no" }), "henlo, <first> x. <last> of <last>land");
        this.assertEqual(Strings.template("helloTemplate", { first: "bugs" }), "henlo, bugs x. <last> of <last>land");
        this.assertEqual(Strings.template("helloTemplate", { last: "bunny" }), "henlo, <first> x. bunny of bunnyland");
        this.assertEqual(Strings.template("helloTemplate", { first: "bugs", bogus: "no", last: "bunny" }), "henlo, bugs x. bunny of bunnyland");
    }).build()(null, null);

    new UnitTest("Strings.pluralize", function() {
        this.assertEqual(Strings.pluralize("hello", 1), "?hello/1?");
        this.assertEqual(Strings.pluralize("mineCountCleared", 0), "0 mines cleared");
        this.assertEqual(Strings.pluralize("mineCountCleared", 1), "1 mine cleared");
        this.assertEqual(Strings.pluralize("mineCountCleared", 2), "2 mines cleared");
        this.assertEqual(Strings.pluralize("mineCountCleared", 3775), "3775 mines cleared");
        this.assertEqual(Strings.pluralize("mineCountCleared", 0, "zero"), "zero mines cleared");
        this.assertEqual(Strings.pluralize("mineCountCleared", 1, "nope"), "1 mine cleared");
        this.assertEqual(Strings.pluralize("mineCountCleared", 1732, "1,732"), "1,732 mines cleared");
        this.assertEqual(Strings.pluralize("customPlaceholder", 0), "created no #hashtags");
        this.assertEqual(Strings.pluralize("customPlaceholder", 1), "created one #hashtag");
        this.assertEqual(Strings.pluralize("customPlaceholder", 2), "created 2 #hashtags");
    }).build()(null, null);

    new UnitTest("Strings.template plurals", function() {
        this.assertEqual(Strings.template("pluralsTemplate", {}), "henlo <first>: <mineCountCleared#mineCount> and <customPlaceholder#hashtags>");
        let data = { first: "bugs", mineCount: 0, hashtags: 1732, formattedMineCount: "zero", formatMyHashtags: "1,732", mineCountCleared: "X", customPlaceholder: "X", formattedHashtags: "X" };
        this.assertEqual(Strings.template("pluralsTemplate", data), "henlo bugs: 0 mines cleared and created 1732 #hashtags");
        this.assertEqual(Strings.template("pluralsTemplateFormattedMagnitude", data), "henlo bugs: zero mines cleared and created 1,732 #hashtags");
        data = { first: "bugs", mineCount: { value: 3, formatted: "three" }, hashtags: { value: 1733, formatted: "1,733"}, formattedMineCount: "X", formatMyHashtags: "X"};
        this.assertEqual(Strings.template("pluralsTemplateFormattedMagnitude", data), "henlo bugs: three mines cleared and created 1,733 #hashtags");
        this.assertEqual(Strings.template("pluralsTemplate", data), "henlo bugs: three mines cleared and created 1,733 #hashtags");
    }).build()(null, null);

    new UnitTest("String.fromTemplate", function() {
        var metadata = { foo: "iamfoo", bar: 123, "%3C": "bogus" };
        this.assertEqual(String.fromTemplate(null, null), null);
        this.assertEqual(String.fromTemplate(null, metadata), null);
        this.assertEqual(String.fromTemplate("", null), "");
        this.assertEqual(String.fromTemplate("", metadata), "");
        this.assertEqual(String.fromTemplate("hello", null), "hello");
        this.assertEqual(String.fromTemplate("hello", metadata), "hello");
        this.assertEqual(String.fromTemplate("foo", metadata), "foo");
        this.assertEqual(String.fromTemplate("test <foo> <iamfoo> <bar>", null), "test <foo> <iamfoo> <bar>");
        this.assertEqual(String.fromTemplate("test <foo> <iamfoo> <bar>", metadata), "test iamfoo <iamfoo> 123");
        this.assertEqual(String.fromTemplate("<bar><bar><bar>", metadata), "123123123");
        this.assertEqual(String.fromTemplate("<%3C>test<%3E>", metadata), "<test>");
        this.assertEqual(String.fromTemplate("<%3C>test<%3E>"), "<test>");
    }).build()(null, null);

    new UnitTest("String.pluralize", function() {
        this.assertEqual(String.pluralize(null, null, null), null);
        this.assertEqual(String.pluralize("# mine cleared", "#", 1), "1 mine cleared");
        this.assertEqual(String.pluralize("There are # around #", "#", "buns"), "There are buns around buns");
        this.assertEqual(String.pluralize("created N #hashtags", "N", 73), "created 73 #hashtags");
    }).build()(null, null);

    new UnitTest("String.fromTemplate plurals", function() {
        let template = "henlo <first>: <mineCountCleared#mineCount> and <customPlaceholder#hashtags>";
        let data = { first: "bugs", mineCount: 0, hashtags: 1732, formattedMineCount: "zero", formatMyHashtags: "1,732", mineCountCleared: "X", customPlaceholder: "X", formattedHashtags: "X" };
        this.assertEqual(String.fromTemplate(template, data), "henlo bugs: 0 mines cleared and created 1732 #hashtags");
        template = "henlo <first>: <mineCountCleared#mineCount#formattedMineCount> and <customPlaceholder#hashtags#formatMyHashtags>";
        this.assertEqual(String.fromTemplate(template, data), "henlo bugs: zero mines cleared and created 1,732 #hashtags");
        data = { first: "bugs", mineCount: { value: 3, formatted: "three" }, hashtags: { value: 1733, formatted: "1,733"}, formattedMineCount: "X", formatMyHashtags: "X"};
        this.assertEqual(String.fromTemplate(template, data), "henlo bugs: three mines cleared and created 1,733 #hashtags");
        this.assertEqual(String.fromTemplate("henlo <something>", { something: { value: 3, formatted: "three" } }), "henlo three");
    }).build()(null, null);

    new UnitTest("l10n", function() {
        let l10n = {
            _debug: true,
            _defaultRegion: "en-us",
            a: "en-a",
            c: "en-c",
            ta: "en-a-<value>",
            tc: "en-c-<value>",
            pa: "en-a/<mineCountClearedA#mineCount#formattedMineCount>",
            pc: "en-c/<mineCountClearedC#mineCount#formattedMineCount>",
            obj1: { x: "en-1" },
            obj3: { x: "en-3" },
            html: "<%3C>b<%3E>henlo<%3C>/b<%3E>",
            _es: {
                a: "es-a",
                b: "es-b",
                ta: "es-a-<value>",
                tb: "es-b-<value>",
                pa: "es-a/<mineCountClearedA#mineCount#formattedMineCount>",
                pb: "es-b/<mineCountClearedB#mineCount#formattedMineCount>",
                obj1: { x: "es-1" },
                obj2: { x: "es-2" }
            }
        };
        let l10ns = {
            mineCountClearedA: ["en-a-# mines cleared", "en-a-1 mine cleared", "en-a-# mines cleared"],
            mineCountClearedC: ["en-c-# mines cleared", "en-c-1 mine cleared", "en-c-# mines cleared"],
            _es: {
                mineCountClearedA: ["es-a-# mines cleared", "es-a-1 mine cleared", "es-a-# mines cleared"],
                mineCountClearedB: ["es-b-# mines cleared", "es-b-1 mine cleared", "es-b-# mines cleared"]
            }
        };
        let obj = {
            value: "test",
            zero: { mineCount: 0, formattedMineCount: "no" },
            one: { mineCount: 1, formattedMineCount: "one" },
            two: { mineCount: 2, formattedMineCount: "2.0" },
            "%3C": "bogus"
        };
        Strings.initialize(l10n, l10ns);

        this.assertEqual(Strings.str("a"), "en-a", "a: uses default language");
        this.assertEqual(Strings.value("obj1").x, "en-1", "obj1: default language");
        Strings.setRegion("es-us");
        this.assertEqual(Strings.str("a"), "es-a", "uses specified language");
        this.assertEqual(Strings.value("obj1").x, "es-1", "obj1: es");
        this.assertEqual(typeof(Strings.value("obj3")), "undefined", "obj3: undefined in es");
        this.assertEqual(Strings.value("obj3", true).x, "en-3", "obj3: fallback to en");
        Strings.setRegion("en-us");
        this.assertEqual(Strings.str("a"), "en-a", "uses specified language en");
        this.assertEqual(Strings.value("obj1").x, "en-1", "obj1: en");
        this.assertEqual(typeof(Strings.value("obj2")), "undefined", "obj2: undefined in en");
        this.assertEqual(typeof(Strings.value("obj2", true)), "undefined", "obj2: undefined in en, fallback fails");
        Strings.setRegion("es-us");
        this.assertEqual(Strings.str("b"), "es-b");
        this.assertEqual(Strings.value("obj2").x, "es-2", "obj2: es");
        this.assertEqual(Strings.str("c"), "?en-c?", "fallback to default language with debug marker");
        this.assertEqual(Strings.str("bogus"), "?bogus?", "unknown key");
        this.assertEqual(Strings.template("ta", obj), "es-a-test");
        this.assertEqual(Strings.template("tb", obj), "es-b-test");
        this.assertEqual(Strings.template("tc", obj), "?en-c-test?", "template: fallback to default language with debug marker");
        this.assertEqual(Strings.template("pa", obj.zero), "es-a/es-a-no mines cleared");
        this.assertEqual(Strings.template("pb", obj.one), "es-b/es-b-1 mine cleared");
        console.log("HEHEHUOHUEN UHORU OEHSNUOHU EN");
        this.assertEqual(Strings.template("pc", obj.two), "?en-c/?en-c-2.0 mines cleared??", "plural: fallback to default language with debug marker");
        console.log("HEHEHUOHUEN UHORU OEHSNUOHU EN");
        Strings.setRegion("cn-us");
        this.assertEqual(Strings.str("a"), "en-a", "unknown language, uses default language");
        this.assertEqual(Strings.template("ta", obj), "en-a-test", "unknown language, uses default language");
        this.assertEqual(Strings.template("pa", obj.one), "en-a/en-a-1 mine cleared");
        this.assertEqual(Strings.template("html", obj), "<b>henlo</b>");
    }).build()(null, null);
};

let missingStringsTests = async function() {
    let sourceFile = "sweep-content.yaml";
    let content = await GameContent.loadYamlFromLocalFile(sourceFile, GameContent.cachePolicies.forceOnFirstLoad);
    let test = new UnitTest("MissingStrings", function(a) {
        let otherLanguages = ["_es"];
        if (!this.assertDefined(content, "`content` object defined")) { return; }
        if (!this.assertDefined(content[a.rootKey], `content.${a.rootKey} defined`)) { return; }
        let strings = content[a.rootKey];
        let keys = Object.getOwnPropertyNames(strings).filter(key => !key.startsWith("_"));
        otherLanguages.forEach(lang => {
            if (!this.assertDefined(strings[lang], `Language dict ${lang} in ${a.rootKey}`)) {
                return;
            }
            let langStrings = strings[lang];
            let keysNotFound = [];
            keys.forEach(key => {
                if (!langStrings.hasOwnProperty(key) || langStrings[key] == "TODO") {
                    keysNotFound.push(key);
                }
            });
            if (!this.assertEqual(keysNotFound.length, 0, `Keys not found in ${a.rootKey}/${lang}: ${keysNotFound.length} out of ${keys.length}`)) {
                logTestMsg(keysNotFound.join("\n"));
            }
            
            keysNotFound = [];
            Object.getOwnPropertyNames(langStrings).forEach(otherKey => {
                if (!strings.hasOwnProperty(otherKey)) {
                    keysNotFound.push(otherKey);
                }
            });
            if (!this.assertEqual(keysNotFound.length, 0, `Keys in ${a.rootKey}/${lang} but not in default language: ${keysNotFound.length}`)) {
                logTestMsg(keysNotFound.join("\n"));
            }
        });
    }).build();
    test({ rootKey: "strings" });
    test({ rootKey: "pluralStrings" });
};

class SelectableStub {
    constructor(name, defaultValue) {
        this.name = name;
        this._isSelected = defaultValue;
    }
    get isSelected() { return this._isSelected; }
    setSelected(value) {
        this._isSelected = value;
    }
}

function selectableListTest() {
    new UnitTest("SelectableList", function() {
        var items = [new SelectableStub("a", false), new SelectableStub("b", true), new SelectableStub("c", false)];
        var sut = new SelectableList(items);
        this.assertEqual(sut.selectedIndex, 1);
        this.assertEqual(sut.selectedItem, items[1]);
        sut.setSelectedIndex(2);
        this.assertEqual(sut.selectedIndex, 2);
        this.assertFalse(items[1].isSelected);
        this.assertTrue(items[2].isSelected);
        this.assertEqual(sut.selectedItem, items[2]);
        sut.setSelectedItem(items[0]);
        this.assertEqual(sut.selectedIndex, 0);
        sut.selectNext();
        this.assertEqual(sut.selectedIndex, 1);
        sut.selectNext();
        this.assertEqual(sut.selectedIndex, 2);
        sut.selectNext();
        this.assertEqual(sut.selectedIndex, 2);
        sut.setSelectedIndex(2);
        sut.selectPrevious();
        this.assertEqual(sut.selectedIndex, 1);
        sut.selectPrevious();
        this.assertEqual(sut.selectedIndex, 0);
        sut.selectPrevious();
        this.assertEqual(sut.selectedIndex, 0);
        sut.setSelectedIndex(1);
        sut.setSelectedItem(null);
        this.assertEqual(sut.selectedIndex, 1);
        sut.setSelectedIndex(1);
        sut.setSelectedIndex(5);
        this.assertEqual(sut.selectedIndex, 2);
        sut.setSelectedIndex(-1);
        this.assertEqual(sut.selectedIndex, 0);
    }).buildAndRun();
}

var simDateTest = function() {
    new UnitTest("SimDateTest", function(config) {
        var failedDays = [];
        for (var i = 0; i < config.days; i += 1) {
            var d = new City.SimDate(i);
            // logTestMsg(d.longString());
            var ymd = new City.SimDate(d.year, d.month, d.day);
            if (ymd.daysSinceEpoch != d.daysSinceEpoch) {
                failedDays.push([ymd.daysSinceEpoch, d.daysSinceEpoch]);
            }
        }
        if (!this.assertEqual(failedDays.length, 0)) {
            debugDump(failedDays);
        }
    }).build()({ days: 1000 }, null);
};

function saveStateTest() {
    new UnitTest("SaveState", function() {
        this.assertTrue(SaveStateItem.newID() != SaveStateItem.newID());
        var data1 = { "a": 1, "b": 2 };
        var item1 = new SaveStateItem(SaveStateItem.newID(), "item1", Date.now(), data1);
        this.assertTrue(item1.id.length > 0);
        this.assertEqual(item1.title, "item1");
        this.assertEqual(item1.data, data1);

        window.sessionStorage.clear();
        var sut = new SaveStateCollection(window.sessionStorage, "_unitTests_" + this.name);
        this.assertEqual(sut.itemsSortedByLastSaveTime.length, 0);
        this.assertEqual(sut.getItem(item1.id), null);
        this.assertTrue(sut.deleteItem(item1.id));

        var meta1 = { metaA: "a", metaB: "b" };
        var savedItem1 = sut.saveItem(item1, meta1);
        if (this.assertTrue(!!savedItem1)) {
            this.assertEqual(savedItem1.id, item1.id);
            this.assertEqual(savedItem1.title, item1.title);
            this.assertTrue(savedItem1.sizeBytes >= 13);
            this.assertTrue(!!savedItem1.timestamp);
            if (this.assertTrue(!!savedItem1.metadata)) {
                this.assertEqual(savedItem1.metadata.metaA, meta1.metaA);
                this.assertEqual(savedItem1.metadata.metaB, meta1.metaB);
            }
        }

        var items = sut.itemsSortedByLastSaveTime;
        if (this.assertEqual(items.length, 1)) {
            this.assertEqual(items[0].id, savedItem1.id);
            this.assertEqual(items[0].title, savedItem1.title);
            this.assertEqual(items[0].sizeBytes, savedItem1.sizeBytes);
            this.assertEqual(items[0].timestamp, savedItem1.timestamp);
        }

        var gotItem = sut.getItem(item1.id);
        if (this.assertTrue(!!gotItem)) {
            this.assertEqual(gotItem.id, item1.id);
            this.assertEqual(gotItem.title, item1.title);
            this.assertEqual(gotItem.timestamp, savedItem1.timestamp);
            if (this.assertTrue(!!gotItem.data)) {
                this.assertEqual(gotItem.data.a, item1.data.a);
                this.assertEqual(gotItem.data.b, item1.data.b);
            }
        }

        var data2 = { "c": 3, "d": 4 };
        var meta2 = { metaA: "aaa", metaB: "bbbb" };
        var item2 = new SaveStateItem(SaveStateItem.newID(), "item2", Date.now(), data2);
        var savedItem2 = sut.saveItem(item2, meta2);
        if (this.assertTrue(!!savedItem2)) {
            this.assertEqual(savedItem2.id, item2.id);
            this.assertEqual(savedItem2.title, item2.title);
            this.assertTrue(savedItem2.sizeBytes >= 13);
            this.assertTrue(!!savedItem2.timestamp);
            if (this.assertTrue(!!savedItem2.metadata)) {
                this.assertEqual(savedItem2.metadata.metaB, meta2.metaB);
            }
        }

        items = sut.itemsSortedByLastSaveTime;
        this.assertEqual(items.length, 2);
        this.assertElementsEqual(items.map(item => item.id).sort(), [item1.id, item2.id].sort());

        var updatedData1 = { "a": 100, "b": 100 };
        var savedUpdatedItem1 = sut.saveItem(new SaveStateItem(item1.id, item1.title, Date.now(), updatedData1), meta2);
        this.assertEqual(savedUpdatedItem1.id, savedItem1.id);
        this.assertTrue(savedUpdatedItem1.sizeBytes > savedItem1.sizeBytes);
        if (this.assertTrue(!!savedUpdatedItem1.metadata)) {
            this.assertEqual(savedUpdatedItem1.metadata.metaA, meta2.metaA);
        }
        this.assertEqual(sut.itemsSortedByLastSaveTime.length, 2);
        gotItem = sut.getItem(item1.id);
        if (gotItem) {
            this.assertEqual(gotItem.data.a, updatedData1.a);
        }

        this.assertTrue(sut.deleteItem(item1.id));
        this.assertEqual(sut.getItem(item1.id), null);
        this.assertEqual(sut.itemsSortedByLastSaveTime.length, 1);
        this.assertTrue(sut.getItem(item2.id) != null);
    }).buildAndRun();
    
    new UnitTest("SaveState.compressed", function() {
        window.sessionStorage.clear();
        let sut = new SaveStateCollection(window.sessionStorage, "_unitTests_" + this.name);
        
        let data1 = { "a": 1, "b": 2, "c": { "d": [1, 2, 3], "b": true } };
        let now = Date.now();
        let item1 = new SaveStateItem(SaveStateItem.newID(), "item1", now, data1, false);
        this.assertFalse(item1.compress);
        let item1z = new SaveStateItem(SaveStateItem.newID(), "item1", now, data1, true);
        this.assertTrue(item1z.compress);
        this.assertEqual(JSON.stringify(item1.data), JSON.stringify(item1z.data), "data stored uncompressed in-memory");
        let sz1 = item1.serializationWrapper;
        let sz1z = item1z.serializationWrapper;
        this.assertFalse(sz1.compressed);
        this.assertTrue(sz1z.compressed);
        this.assertFalse(JSON.stringify(sz1.data) == JSON.stringify(sz1z.data), "serializationWrapper compresses");
        let dz1 = SaveStateItem.fromDeserializedWrapper(sz1);
        let dz1z = SaveStateItem.fromDeserializedWrapper(sz1z);
        this.assertFalse(dz1.compress);
        this.assertTrue(dz1z.compress);
        this.assertEqual(JSON.stringify(dz1.data), JSON.stringify(item1.data));
        this.assertEqual(JSON.stringify(dz1z.data), JSON.stringify(item1.data));
    }).buildAndRun();
}

class AnimationLoopDelegate {
    constructor(id) { this.id = id; this.log = []; this.lastState = undefined; this.counter = 0; }
    clear() { this.log = []; }

    processFrame(frame) {
        this.lastState = frame.loop.state;
        let lf = frame.loop.lastFrame?.timestamp || "none";
        frame.stats.counter = this.counter++;
        frame.state.test = "bogus";
        this.log.push(`processFrame:${frame.timestamp},lf:${lf}#${this.id}`);
        if (!!this.shouldPause) { frame.loop.pause(); }
    }
}

function animationLoopTest() {
    new UnitTest("AnimationLoop", function() {
        let frameCounter = 0;
        let log = [];
        let windowStub = {
            requestAnimationFrame: function(block) {
                frameCounter += 1;
                log.push(`requestAnimationFrame:${frameCounter}`);
                return frameCounter;
            },
            cancelAnimationFrame: function(id) {
                log.push(`cancelAnimationFrame:${id}`);
            }
        };
        let sut = new AnimationLoop(windowStub);
        this.assertEqual(sut.state, AnimationLoop.State.paused);
        sut.pause();
        this.assertEqual(sut.state, AnimationLoop.State.paused);
        this.assertEqual(log.length, 0, "No animationFrame API calls yet");
        this.assertTrue(!sut.lastFrame);
        
        sut.resume();
        this.assertEqual(sut.state, AnimationLoop.State.requestedFrame);
        this.assertElementsEqual(log, ["requestAnimationFrame:1"], "first resume");
        sut.resume();
        this.assertElementsEqual(log, ["requestAnimationFrame:1"], "ignore resume with pending frame");
        log.splice(0, log.length); // Remove all elements in-place
        
        sut._frame(1234000);
        this.assertEqual(sut.state, AnimationLoop.State.requestedFrame);
        this.assertElementsEqual(log, ["requestAnimationFrame:2"], "scheduled next frame");
        this.assertEqual(sut.lastFrame?.timestamp, 1234000);
        this.assertDefined(sut.lastFrame?.stats, "should preserve stats after processFrame");
        this.assertTrue(!(sut.lastFrame?.state), "should delete state after processFrame");
        
        log.splice(0, log.length); // Remove all elements in-place
        sut.pause();
        this.assertElementsEqual(log, ["cancelAnimationFrame:2"], "canceled a frame");
        sut._frame(1234000);
        this.assertEqual(sut.state, AnimationLoop.State.paused, "_frame is noop if paused");
        
        log.splice(0, log.length); // Remove all elements in-place
        let d1 = new AnimationLoopDelegate("d1");
        sut.addDelegate(d1);
        sut.resume();
        sut._frame(1234500);
        this.assertElementsEqual(log, ["requestAnimationFrame:3", "requestAnimationFrame:4"], "process a frame with one delegate");
        this.assertElementsEqual(d1.log, ["processFrame:1234500,lf:1234000#d1"]);
        this.assertEqual(d1.lastState, AnimationLoop.State.receivedFrame);
        this.assertEqual(sut.state, AnimationLoop.State.requestedFrame);
        this.assertEqual(sut.lastFrame?.timestamp, 1234500);
        
        log.splice(0, log.length); // Remove all elements in-place
        d1.clear();
        d1.shouldPause = true;
        sut._frame(1234600);
        this.assertEqual(sut.state, AnimationLoop.State.paused);
        this.assertEqual(log.length, 0, "Pause during frame processing, no window API calls");
        this.assertElementsEqual(d1.log, ["processFrame:1234600,lf:1234500#d1"]);
        
        log.splice(0, log.length); // Remove all elements in-place
        d1.clear();
        sut._frame(1234700);
        this.assertEqual(sut.state, AnimationLoop.State.paused);
        this.assertEqual(log.length, 0, "_frame no-op when paused");
        this.assertEqual(d1.log.length, 0, "No delegates called when paused");
    }).buildAndRun();
}

function dispatchTest() {
    new UnitTest("Dispatch", function() {
        var sut = Dispatch.shared;
        // Make sure nothing breaks when there are zero targets
        sut.postEventSync("test", null);
        sut.remove(null);
        sut.remove("fake");
        var target1 = new DispatchTarget();
        this.assertTrue(target1.id.length > 0);
        sut.remove(target1);
        var got = [];
        target1.register("e1", (e, info) => { got.push({ e: e, info: info, via: "t1e1" }); })
            .register("e2", (e, info) => { got.push({ e: e, info: info, via: "t1e2" }); });
        sut.postEventSync("e1", 1);
        sut.postEventSync("eBogus1", 100);
        if (this.assertEqual(got.length, 1)) {
            this.assertEqual(got[0].e, "e1"); this.assertEqual(got[0].info, 1); this.assertEqual(got[0].via, "t1e1");
        }
        sut.postEventSync("e2", 2);
        sut.postEventSync("e1", 3);
        if (this.assertEqual(got.length, 3)) {
            this.assertEqual(got[1].e, "e2"); this.assertEqual(got[1].info, 2); this.assertEqual(got[1].via, "t1e2");
            this.assertEqual(got[2].e, "e1"); this.assertEqual(got[2].info, 3); this.assertEqual(got[2].via, "t1e1");
        }

        var target2 = new DispatchTarget("hello")
            .register("e2", (e, info) => { got.push({ e: e, info: info, via: "t2e2" }); });
        this.assertEqual(target2.id, "hello");
        sut.postEventSync("e1", 4);
        if (this.assertEqual(got.length, 4)) {
            this.assertEqual(got[3].e, "e1"); this.assertEqual(got[3].info, 4); this.assertEqual(got[3].via, "t1e1");
        }
        sut.postEventSync("e2", 5);
        if (this.assertEqual(got.length, 6)) {
            var e2got = [got[4], got[5]];
            if (e2got[0].via == "t2e2") { e2got.reverse(); }
            this.assertEqual(e2got[0].e, "e2"); this.assertEqual(e2got[0].info, 5); this.assertEqual(e2got[0].via, "t1e2");
            this.assertEqual(e2got[1].e, "e2"); this.assertEqual(e2got[1].info, 5); this.assertEqual(e2got[1].via, "t2e2");
        }

        sut.remove(null);
        sut.postEventSync("e1", 6);
        this.assertEqual(got.length, 7);
        sut.remove(target1);
        sut.postEventSync("e1", 7);
        this.assertEqual(got.length, 7);
        sut.postEventSync("e2", 8);
        if (this.assertEqual(got.length, 8)) {
            this.assertEqual(got[7].e, "e2"); this.assertEqual(got[7].info, 8); this.assertEqual(got[7].via, "t2e2");
        }
        sut.remove(target2.id);
        sut.postEventSync("e2", 8);
        this.assertEqual(got.length, 8);
    }).buildAndRun();
}

class Employee {
    constructor(employer, title, name) {
        this.employer = employer;
        this._title = title;
        this.name = name;
        this.kvo = new Kvo(this);
    }
    get title() { return this._title; }
    get salary() { return this.employer.getSalary(this.title); }
    setTitle(value) {
        this._title = value;
        this.kvo.title.setValue(value, false, true);
        this.kvo.salary.notifyChanged(true, true);
    }
    setName(value) {
        this.kvo.name.setValue(value, true, true);
    }
    doStuff() {
        this.kvo.notifyChanged(true);
    }
}
Employee.Kvo = { title: "_title", salary: "_salary", name: "name" };

class Business {
    constructor(salaryTable) {
        this.salaryTable = salaryTable;
    }
    getSalary(title) {
        return this.salaryTable[title];
    }
}

class EmployeeWatcher {
    constructor(employee, top, child) {
        this.employee = employee;
        this.salaryHistory = [employee.salary];
        this.kvoHistory = [];
        if (top) {
            this.employee.kvo.addObserver(this, (source) => {
                this.kvoHistory.push({ source: source, via: "top", token: this.employee.kvo.token });
            });
        }
        if (child) {
            this.employee.kvo.salary.addObserver(this, (source) => {
                this.salaryHistory.push(source.salary);
                this.kvoHistory.push({ source: source, via: "salary", token: this.employee.kvo.salary.token });
            });
            this.employee.kvo.name.addObserver(this, (source) => {
                this.kvoHistory.push({ source: source, via: "name", token: this.employee.kvo.name.token });
            });
        }
    }
}

function changeTokenBindingTest() {
    new UnitTest("ChangeTokenBinding", function() {
        let business1 = new Business({ bagger: 10, manager: 100 });
        let person1 = new Employee(business1, "bagger", "A");
        let sut = new ChangeTokenBinding(person1.kvo.title, false);
        this.assertFalse(sut.hasChange, "has: initial set to false");
        this.assertFalse(sut.consume(), "consume: initial");
        this.assertFalse(sut.consume(), "consume: initial x2");
        person1.setTitle("manager");
        this.assertTrue(sut.hasChange, "has: 1");
        this.assertTrue(sut.consume(), "consume: 1");
        this.assertFalse(sut.hasChange, "has: 1 consumed");
        this.assertFalse(sut.consume(), "consume: after 1");
        person1.setTitle("bagger");
        this.assertTrue(sut.hasChange, "has: 2");
        this.assertTrue(sut.hasChange, "has: 2 again");
        this.assertTrue(sut.consume(), "consume: 2");
        this.assertFalse(sut.consume(), "consume: 2 again");
        this.assertFalse(sut.hasChange, "has: after 2");

        sut = new ChangeTokenBinding(person1.kvo.title, true);
        this.assertTrue(sut.hasChange, "has: initial set to true");
        sut = new ChangeTokenBinding(person1.kvo.title, false);
        this.assertFalse(sut.hasChange, "has: initial set to false with non-zero target token");

        let items = [new ChangeTokenBinding(person1.kvo.name, false), new ChangeTokenBinding(person1.kvo.title, true)];
        this.assertTrue(ChangeTokenBinding.consumeAll(items), "consumeAll: one initial true value");
        this.assertFalse(items[0].hasChange);
        this.assertFalse(items[1].hasChange);
        person1.setName("B");
        this.assertTrue(ChangeTokenBinding.consumeAll(items), "consumeAll: after a change");
        this.assertFalse(ChangeTokenBinding.consumeAll(items), "consumeAll: repeat is false");
        this.assertFalse(items[0].hasChange);
        this.assertFalse(items[1].hasChange);
    }).buildAndRun();
}

function kvoTest() {


    new UnitTest("Kvo-Setup", function() {
        var business1 = new Business({ bagger: 10, manager: 100 });
        this.assertEqual(business1.getSalary("bagger"), 10);
        this.assertEqual(business1.getSalary("manager"), 100);
        var person1 = new Employee(business1, "bagger", "A");
        this.assertEqual(person1.title, "bagger");
        this.assertEqual(person1.name, "A");
        this.assertEqual(person1.salary, 10);
        var house1 = new EmployeeWatcher(person1, false, false);
        this.assertElementsEqual(house1.salaryHistory, [10]);
        this.assertEqual(house1.kvoHistory.length, 0);
        person1.setTitle("manager");
        this.assertEqual(person1.salary, 100);
    }).buildAndRun();

    new UnitTest("Kvo-TopLevel", function() {
        var business1 = new Business({ bagger: 10, manager: 100 });
        var person1 = new Employee(business1, "bagger", "A");
        var house1 = new EmployeeWatcher(person1, true, false);
        this.assertEqual(person1.kvo.getValue(), person1);
        person1.setTitle("manager");
        if (this.assertEqual(house1.kvoHistory.length, 1)) {
            this.assertEqual(house1.kvoHistory[0].source, person1);
            this.assertEqual(house1.kvoHistory[0].via, "top");
            this.assertEqual(house1.kvoHistory[0].token, 1);
        };
        person1.setName("B");
        if (this.assertEqual(house1.kvoHistory.length, 2)) {
            this.assertEqual(house1.kvoHistory[1].source, person1);
            this.assertEqual(house1.kvoHistory[1].via, "top");
            this.assertEqual(house1.kvoHistory[1].token, 2);
        };
        person1.doStuff();
        if (this.assertEqual(house1.kvoHistory.length, 3)) {
            this.assertEqual(house1.kvoHistory[2].source, person1);
            this.assertEqual(house1.kvoHistory[2].via, "top");
            this.assertEqual(house1.kvoHistory[2].token, 3);
        };
        Kvo.stopAllObservations(house1);
        person1.setName("C");
        this.assertEqual(house1.kvoHistory.length, 3);
    }).buildAndRun();

    new UnitTest("Kvo-Property", function() {
        var business1 = new Business({ bagger: 10, manager: 100 });
        var person1 = new Employee(business1, "bagger", "A");
        var person2 = new Employee(business1, "manager", "B");
        var house1 = new EmployeeWatcher(person1, false, true);
        person1.setTitle("manager");
        person2.setTitle("bagger");
        this.assertEqual(person1.kvo.title.getValue(), "manager");
        this.assertElementsEqual(house1.salaryHistory, [10, 100]);
        if (this.assertEqual(house1.kvoHistory.length, 1)) {
            this.assertEqual(house1.kvoHistory[0].source, person1);
            this.assertEqual(house1.kvoHistory[0].via, "salary");
            this.assertEqual(house1.kvoHistory[0].token, 1);
        }
        person1.setName("C");
        this.assertEqual(house1.salaryHistory.length, 2);
        if (this.assertEqual(house1.kvoHistory.length, 2)) {
            this.assertEqual(house1.kvoHistory[1].source, person1);
            this.assertEqual(house1.kvoHistory[1].via, "name");
            this.assertEqual(house1.kvoHistory[1].token, 1);
        }
        Kvo.stopAllObservations(house1);
        person1.setTitle("bagger");
        this.assertEqual(house1.salaryHistory.length, 2);
        this.assertEqual(house1.kvoHistory.length, 2);
    }).buildAndRun();

    new UnitTest("Kvo-Combined", function() {
        var business1 = new Business({ bagger: 10, manager: 100 });
        var person1 = new Employee(business1, "bagger", "A");
        var person2 = new Employee(business1, "manager", "B");
        var house1 = new EmployeeWatcher(person1, true, true);
        person1.setTitle("manager");
        this.assertElementsEqual(house1.salaryHistory, [10, 100]);
        if (this.assertEqual(house1.kvoHistory.length, 2)) {
            this.assertEqual(house1.kvoHistory[0].source, person1);
            this.assertEqual(house1.kvoHistory[0].via, "salary");
            this.assertEqual(house1.kvoHistory[0].token, 1);
            this.assertEqual(house1.kvoHistory[1].source, person1);
            this.assertEqual(house1.kvoHistory[1].via, "top");
            this.assertEqual(house1.kvoHistory[1].token, 1);
        }
        person1.doStuff();
        this.assertEqual(house1.salaryHistory.length, 2);
        if (this.assertEqual(house1.kvoHistory.length, 3)) {
            this.assertEqual(house1.kvoHistory[2].source, person1);
            this.assertEqual(house1.kvoHistory[2].via, "top");
            this.assertEqual(house1.kvoHistory[2].token, 2);
        }
    }).buildAndRun();
}

// person1 is raw, person2 has sourceSormatter, and also have a global thing.
class TargetView {
    constructor(person1, person2) {
        this.person1general = "";
        this.person1name = "";
        this.person2name = "";
        this.kvo = new Kvo(this);
        this.bindings = [
            new Binding({ source: person1.kvo, target: this.kvo.person1title, sourceFormatter: (value, kvo) => value.title }),
            new Binding({ source: person1.kvo.name, target: this.kvo.person1name }),
            new Binding({ source: person2.kvo.name, target: this.kvo.person2name, sourceFormatter: (value, kvo) => "P2" + value })
        ];
    }
}
TargetView.Kvo = { person1title: "person1title", person1name: "person1name", person2name: "person2name" };


function bindingTest() {
    new UnitTest("Binding", function() {
        var business1 = new Business({ bagger: 10, manager: 100 });
        var person1 = new Employee(business1, "bagger", "A");
        var person2 = new Employee(business1, "manager", "B");
        var view = new TargetView(person1, person2);

        this.assertEqual(view.person1title, person1.title);
        this.assertEqual(view.person1name, person1.name);
        this.assertEqual(view.person2name, "P2" + person2.name);

        person1.setName("New P1");
        this.assertEqual(view.person1title, person1.title);
        this.assertEqual(view.person1name, person1.name);
        this.assertEqual(view.person2name, "P2" + person2.name);

        person1.setTitle("manager");
        this.assertEqual(view.person1title, person1.title);
        this.assertEqual(view.person1name, person1.name);
        this.assertEqual(view.person2name, "P2" + person2.name);

        person2.setName("New P2");
        this.assertEqual(view.person1title, person1.title);
        this.assertEqual(view.person1name, person1.name);
        this.assertEqual(view.person2name, "P2" + person2.name);
    }).buildAndRun();
}

function tilePlaneTest() {
    new UnitTest("TilePlane", function() {
        let sut = new TilePlane({ width: 7, height: 5 }, 1);
        this.assertEqual(sut.size.width, 7);
        this.assertEqual(sut.size.height, 5);
        this.assertEqual(sut.tileWidth, 1);
        this.assertEqual(sut.offset.x, 0);
        this.assertEqual(sut.offset.y, 0);
        this.assertEqual(sut.screenOriginForModelTile(null), null);
        this.assertEqual(sut.screenRectForModelTile(null), null);
        this.assertEqual(sut.screenRectForModelRect(null), null);
        this.assertEqual(sut.modelTileForScreenPoint(null), null);
        this.assertEqual(sut.modelRectForScreenRect(null), null);
        this.assertFalse(sut.isModelRectVisible(null));
        // TilePlane starts with visibleSize = 0x0.
        this.assertFalse(sut.isModelRectVisible(new Rect(0, 0, 7, 5)));
        this.assertTrue(sut.visibleModelRect.isEmpty());

        let prepForExpectations = config => {
            config.sut.tileWidth = config.tileWidth;
            config.sut.offset = config.offset;
            if (!!config.viewportSize) {
                config.sut.viewportSize = config.viewportSize;
            }
            return `tw${config.tileWidth} o${config.offset.x},${config.offset.y} vp${config.sut.viewportSize.width}x${config.sut.viewportSize.height}`;
        };

        let testScreenRectForModelTile = config => {
            let label = prepForExpectations(config);
            config.expectations.forEach(e => {
                this.assertEqual(config.sut.screenOriginForModelTile(new Point(e[0], e[1])), new Point(e[2], e[3]), "screenOriginForModelTile " + label);
                this.assertEqual(config.sut.screenRectForModelTile(new Point(e[0], e[1])), new Rect(e[2], e[3], e[4], e[5]), "screenRectForModelTile " + label);
            });
        };

        let testScreenRectForModelRect = config => {
            let label = prepForExpectations(config);
            config.expectations.forEach(e => {
                this.assertEqual(config.sut.screenRectForModelRect(new Rect(e[0], e[1], e[2], e[3])), new Rect(e[4], e[5], e[6], e[7]), "screenRectForModelRect " + label);
            });
        };

        let testModelTileForScreenPoint = config => {
            let label = prepForExpectations(config);
            config.expectations.forEach(e => {
                this.assertEqual(config.sut.modelTileForScreenPoint(new Point(e[0], e[1])), new Point(e[2], e[3]), "modelTileForScreenPoint " + label);
            });
        };

        let testModelRectForScreenRect = config => {
            let label = prepForExpectations(config);
            config.expectations.forEach(e => {
                this.assertEqual(config.sut.modelRectForScreenRect(new Rect(e[0], e[1], e[2], e[3])), new Rect(e[4], e[5], e[6], e[7]), "testModelRectForScreenRect " + label);
            });
        };

        let testIsModelRectVisible = config => {
            let label = prepForExpectations(config);
            config.expectations.forEach(e => {
                let rect = new Rect(e[1], e[2], e[3], e[4]);
                let thisLabel = `isModelRectVisible ${label} for ${rect.debugDescription}`;
                this.assertEqual(config.sut.isModelRectVisible(rect), e[0], thisLabel);
            });
        }

        let testVisibleModelRect = config => {
            let label = prepForExpectations(config);
            config.expectations.forEach(e => {
                config.sut.viewportSize = { width: e[0], height: e[1] };
                let thisLabel = `visibleModelRect ${label} for ${e[0]}x${e[1]}`;
                this.assertEqual(config.sut.visibleModelRect, new Rect(e[2], e[3], e[4], e[5]), thisLabel);
            });
        }

        testScreenRectForModelTile({
            sut: sut,
            offset: new Point(0, 0),
            tileWidth: 1,
            expectations: [
                // tile   // expected rect
                [ 0,  4,  0, 0, 1, 1],
                [ 6,  4,  6, 0, 1, 1],
                [ 0,  0,  0, 4, 1, 1],
                [ 1,  3,  1, 1, 1, 1],
                [-1,  0, -1,  4, 1, 1],
                [ 7,  0,  7,  4, 1, 1],
                [ 0, -1,  0,  5, 1, 1],
                [ 0,  5,  0, -1, 1, 1]
            ]
        });

// -------------
// |pixel origin
// |screen tile
// |model tile
// -----------------
// |p0,0   |p16,0  |y0 height 48. model rect has y2 height 3.
// |s0,0   |s1,0   |  : y11 height 48. model rect has y1 height 4.
// |m0,4   |m1,4   |  :  :
// -----------------  :  :
// |p0,16  |p16,16 |  :  :
// |s0,1   |s1,1   |  :  :
// |m0,3   |m1,3   |  :  :
// -----------------  :  :
// |p0,32  |p16,32 |  :  :
// |s0,2   |s1,2   |  :  :
// |m0,2   |m1,2   |  v  :
// ----------------- --- :
// |p0,48  |p16,48 |     v
// |s0,3   |s1,3   |    ---
// |m0,1   |m1,1   |
// -----------------
// |p0,64  |p16,64 |
// |s0,4   |s1,4   |
// |m0,0   |m1,0   |
// -----------------
        testScreenRectForModelTile({
            sut: sut,
            offset: new Point(0, 0),
            tileWidth: 16,
            expectations: [
                // tile  // expected rect
                [ 0,  4,   0,   0, 16, 16],
                [ 6,  4,  96,   0, 16, 16],
                [ 0,  0,   0,  64, 16, 16],
                [ 1,  3,  16,  16, 16, 16],
                [-1,  0, -16,  64, 16, 16],
                [ 7,  0, 112,  64, 16, 16],
                [ 0, -1,   0,  80, 16, 16],
                [ 0,  5,   0, -16, 16, 16]
            ]
        });

        testScreenRectForModelTile({
            sut: sut,
            offset: new Point(-19, 31),
            tileWidth: 16,
            expectations: [
                // tile  // expected rect
                [ 0,  4, -19,  31, 16, 16],
                [ 6,  4,  77,  31, 16, 16],
                [ 0,  0, -19,  95, 16, 16],
                [ 1,  3,  -3,  47, 16, 16],
                [ 0, -1, -19, 111, 16, 16]
            ]
        });

        testScreenRectForModelRect({
            sut: sut,
            offset: new Point(0, 0),
            tileWidth: 16,
            expectations: [
                // model rect    // screen rect
                [ 0,  4,  1,  1,   0,   0,  16, 16],
                [ 2,  1,  3,  2,  32,  32,  48, 32],
                [-1, -1,  9,  7, -16, -16, 144,112] // full tile plane + 1-tile padding
            ]
        });

        testScreenRectForModelRect({
            sut: sut,
            offset: new Point(27, -58),
            tileWidth: 16,
            expectations: [
                // model rect    // screen rect
                [ 0,  4,  1,  1,  27, -58,  16, 16],
                [ 2,  1,  3,  2,  59, -26,  48, 32],
                [-1, -1,  9,  7,  11, -74, 144,112] // full tile plane + 1-tile padding
            ]
        });

        testModelTileForScreenPoint({
            sut: sut,
            offset: new Point(0, 0),
            tileWidth: 1,
            expectations: [
                [0, 0, 0, 4],
                [6, 4, 6, 0],
                [3, 2, 3, 2]
            ]
        });

        testModelTileForScreenPoint({
            sut: sut,
            offset: new Point(0, 0),
            tileWidth: 16,
            expectations: [
                // point // model tile
                [ 0,  0,    0,  4], // top left corner of a tile
                [ 5,  5,    0,  4], // in the middle of a tile
                [ -3, 271, -1, -12] // out of bounds
            ]
        });

        testModelTileForScreenPoint({
            sut: sut,
            offset: new Point(37, -7),
            tileWidth: 16,
            expectations: [
                // point // model tile
                [ 0,  0,   -3, 4],
                [37, 58,    0, 0]
            ]
        });

        testModelRectForScreenRect({
            sut: sut,
            offset: new Point(0, 0),
            tileWidth: 16,
            expectations: [
                // screen rect   // model rect
                [ 0,  0, 32, 16,   0, 4, 2, 1], // aligned with tile boundaries
                [ 0,  0,112, 80,   0, 0, 7, 5], // aligned with tile boundaries
                [16, 32, 64, 48,   1, 0, 4, 3], // aligned with tile boundaries (with variations below)
                [16, 37, 64, 48,   1,-1, 4, 4], // horizontally but not vertically aligned with tile boundaries
                [21, 32, 64, 48,   1, 0, 5, 3], // vertically but not horizontally aligned with tile boundaries
                [16, 32, 67, 43,   1, 0, 5, 3], // origin aligned but size is not
                [5,   5,  5,  5,   0, 4, 1, 1]  // screen rect smaller than one tile, expands to one tile
            ]
        });

        testModelRectForScreenRect({
            sut: sut,
            offset: new Point(7, -25),
            tileWidth: 16,
            expectations: [
                [0, 0, 32, 16, -1, 2, 3, 2]
            ]
        });

        testIsModelRectVisible({
            sut: sut,
            offset: new Point(0, 0),
            tileWidth: 16,
            viewportSize: {width: 100, height: 100},
            expectations: [
                //viz?  // model rect
                [true,   0, 4, 1, 1],
                [false, -1, 4, 1, 1],
                [false,  0, 5, 1, 1]
            ]
        });

        testIsModelRectVisible({
            sut: sut,
            offset: new Point(120, 120),
            tileWidth: 16,
            viewportSize: {width: 100, height: 100},
            expectations: [
                //viz?  // rect 
                [false,  0, 4, 1, 1],
                [true,  -2, 6, 1, 1]
            ]
        });

        testVisibleModelRect({
            sut: sut,
            offset: new Point(0, 0),
            tileWidth: 16,
            expectations: [
                // viewport  // model rect
                [16, 16,     0, 4, 1, 1],
                [16, 80,     0, 0, 1, 5],
                [64, 16,     0, 4, 4, 1],
                [37,  5,     0, 4, 3, 1],
                [2,  98,     0,-2, 1, 7]
            ]
        });

        testVisibleModelRect({
            sut: sut,
            offset: new Point(27, -61),
            tileWidth: 16,
            expectations: [
                // viewport  // model rect
                [16, 16,     -2, 0, 2, 2]
            ]
        });

        let tiles = [[], [], [], [], []];
        for (let y = 0; y < sut.size.height; y += 1) {
            for (let x = 0; x < sut.size.width; x += 1) {
                tiles[y][x] = sut.drawingOrderIndexForModelTile(new Point(x, y));
            }
        }
        tiles.reverse(); // show how it will look on screen with flipped y
        let isSorted = true;
        for (let y = 0; y < sut.size.height; y += 1) {
            for (let x = 0; x < sut.size.width; x += 1) {
                if (x < sut.size.width - 1) {
                    isSorted = isSorted && (tiles[y][x] < tiles[y][x + 1]);
                }
                if (y < sut.size.height - 1) {
                    isSorted = isSorted && (tiles[y][x] < tiles[y + 1][x]);
                }
            }
        }
        this.assertTrue(isSorted);
        logTestMsg(tiles.map(row => row.map(item => item.toString().padStart(4, "_")).join("")).join("\n"));

        this.assertTrue(sut.drawingOrderIndexForModelRect(new Rect(0, 2, 1, 1)) < sut.drawingOrderIndexForModelRect(new Rect(1, 2, 1, 1)));
        this.assertTrue(sut.drawingOrderIndexForModelRect(new Rect(0, 2, 1, 1)) < sut.drawingOrderIndexForModelRect(new Rect(0, 1, 1, 1)));
        // XXXCCC
        // RRRCCC R draws after X, and before C, and before Y
        // RRRCCC
        // RRRYYY
        let r = new Rect(0, 0, 3, 3), c = new Rect(3, 1, 3, 3);
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) > sut.drawingOrderIndexForModelTile(new Point(0, 3)));
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) > sut.drawingOrderIndexForModelTile(new Point(1, 3)));
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) > sut.drawingOrderIndexForModelTile(new Point(2, 3)));
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) < sut.drawingOrderIndexForModelRect(c));
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) < sut.drawingOrderIndexForModelTile(new Point(3, 0)));
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) < sut.drawingOrderIndexForModelTile(new Point(4, 0)));

        sut.size = { width: 4, height: 10 };
        sut.offset = new Point(0, 0);
        sut.tileWidth = 7;
        this.assertEqual(sut.screenRectForModelTile(new Point(2, 9)), new Rect(14, 0, 7, 7), "Size change");
    }).buildAndRun();

    new UnitTest("TilePlane.traversal", function() {
        let sut = new TilePlane({ width: 7, height: 5 }, 1);

        let tiles = sut.surroundingTiles(new Point(2, 2), false);
        if (this.assertEqual(tiles.length, 4)) {
            this.assertTrue(tiles.find(i => i.isEqual(new Point(1, 2))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(3, 2))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(2, 1))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(2, 3))) != null);
        }

        tiles = sut.surroundingTiles(new Point(2, 2), true);
        if (this.assertEqual(tiles.length, 8)) {
            this.assertTrue(tiles.find(i => i.isEqual(new Point(1, 1))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(2, 1))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(3, 1))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(1, 2))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(3, 2))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(1, 3))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(2, 3))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(3, 3))) != null);
        }

        tiles = sut.surroundingTiles(new Point(0, 0), true);
        if (this.assertEqual(tiles.length, 3)) {
            this.assertTrue(tiles.find(i => i.isEqual(new Point(1, 0))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(0, 1))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(1, 1))) != null);
        }
        this.assertEqual(sut.surroundingTiles(new Point(0, 0), false).length, 2);

        tiles = sut.surroundingTiles(new Point(6, 4), true);
        if (this.assertEqual(tiles.length, 3)) {
            this.assertTrue(tiles.find(i => i.isEqual(new Point(5, 4))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(5, 3))) != null);
            this.assertTrue(tiles.find(i => i.isEqual(new Point(6, 3))) != null);
        }
        this.assertEqual(sut.surroundingTiles(new Point(6, 4), false).length, 2);

        this.assertEqual(sut.floodFilter(new Point(-1, -1), true, () => true).length, 0);
        this.assertEqual(sut.floodFilter(new Point(7, 5), true, () => true).length, 0);

        let logFloodFilter = function(tile, diagonally, filter) {
            let log = [];
            let grid = []; for (let y = 0; y < sut.size.height; y += 1) {
                grid.push([]); for (let x = 0; x < sut.size.width; x += 1) grid[y].push("xx");
            }
            grid[tile.y][tile.x] = "OO";
            let got = sut.floodFilter(tile, diagonally, (next, source, depth, origin) => {
                let result = filter(next, source, depth, origin);
                log.push([next.debugDescription, source.debugDescription, depth, origin.debugDescription].join("; "));
                grid[next.y][next.x] = `${result ? "T" : "F"}${depth}`;
                return result;
            });
            debugDump(grid.map(row => row.join(" ")).concat(log).join("\n"));
            return got;
        }

        tiles = logFloodFilter(new Point(2, 2), true, (next, source, depth, origin) => (depth == 0));
        if (this.assertEqual(tiles.length, 1)) {
            this.assertEqual(tiles[0], new Point(2, 2));
        }

        tiles = logFloodFilter(new Point(0, 0), true, () => true);
        this.assertEqual(tiles.length, sut.size.width * sut.size.height);

    }).buildAndRun();
}

function tilePlaneTestOld() {
    new UnitTest("TilePlane (old)", function() {
        let sut = new TilePlane({ width: 7, height: 5 }, 1);
        this.assertEqual(sut.size.width, 7);
        this.assertEqual(sut.size.height, 5);
        this.assertTrue(sut.screenOriginForModelTile(new Point(0, 0)).isEqual(new Point(0, 4)), "screenTileForModel BL");
        this.assertTrue(sut.screenOriginForModelTile(new Point(6, 0)).isEqual(new Point(6, 4)), "screenTileForModel BR");
        this.assertTrue(sut.screenOriginForModelTile(new Point(6, 4)).isEqual(new Point(6, 0)), "screenTileForModel TR");
        this.assertTrue(sut.screenOriginForModelTile(new Point(0, 4)).isEqual(new Point(0, 0)), "screenTileForModel TL");
        this.assertTrue(sut.screenOriginForModelTile(new Point(1, 3)).isEqual(new Point(1, 1)), "screenTileForModel MID");

        this.assertTrue(sut.screenOriginForModelTile(new Point(-1, 0)).isEqual(new Point(-1, 4)), "screenTileForModel OOB");
        this.assertTrue(sut.screenOriginForModelTile(new Point(7, 0)).isEqual(new Point(7, 4)), "screenTileForModel OOB");
        this.assertTrue(sut.screenOriginForModelTile(new Point(0, -1)).isEqual(new Point(0, 5)), "screenTileForModel OOB");
        this.assertTrue(sut.screenOriginForModelTile(new Point(0, 5)).isEqual(new Point(0, -1)), "screenTileForModel OOB");

        this.assertTrue(sut.modelTileForScreenPoint(new Point(0, 0)).isEqual(new Point(0, 4)), "modelTileForScreen TL");
        this.assertTrue(sut.modelTileForScreenPoint(new Point(6, 0)).isEqual(new Point(6, 4)), "modelTileForScreen TR");
        this.assertTrue(sut.modelTileForScreenPoint(new Point(6, 4)).isEqual(new Point(6, 0)), "modelTileForScreen BR");
        this.assertTrue(sut.modelTileForScreenPoint(new Point(0, 4)).isEqual(new Point(0, 0)), "modelTileForScreen BL");
        this.assertTrue(sut.modelTileForScreenPoint(new Point(1, 3)).isEqual(new Point(1, 1)), "modelTileForScreen MID");

        this.assertTrue(sut.modelTileForScreenPoint(new Point(-1, 0)).isEqual(new Point(-1, 4)), "modelTileForScreen OOB");
        this.assertTrue(sut.modelTileForScreenPoint(new Point(7, 0)).isEqual(new Point(7, 4)), "modelTileForScreen OOB");
        this.assertTrue(sut.modelTileForScreenPoint(new Point(0, -1)).isEqual(new Point(0, 5)), "modelTileForScreen OOB");
        this.assertTrue(sut.modelTileForScreenPoint(new Point(0, 5)).isEqual(new Point(0, -1)), "modelTileForScreen OOB");

        this.assertTrue(sut.screenRectForModelRect(new Rect(1, 3, 1, 1)).isEqual(new Rect(1, 1, 1, 1)), "screenRectForModel 1311");
        this.assertTrue(sut.screenRectForModelRect(new Rect(0, 1, 3, 2)).isEqual(new Rect(0, 2, 3, 2)), "screenRectForModel 0123");
        this.assertTrue(sut.modelRectForScreenRect(new Rect(1, 1, 1, 1)).isEqual(new Rect(1, 3, 1, 1)), "screenRectForModel 1111");
        this.assertTrue(sut.modelRectForScreenRect(new Rect(-2, 4, 7, 3)).isEqual(new Rect(-2, -2, 7, 3)), "modelRectForScreen -2473");

        let tiles = [[], [], [], [], []];
        for (let y = 0; y < sut.size.height; y += 1) {
            for (let x = 0; x < sut.size.width; x += 1) {
                tiles[y][x] = sut.drawingOrderIndexForModelTile(new Point(x, y));
            }
        }
        tiles.reverse(); // show how it will look on screen with flipped y
        let isSorted = true;
        for (let y = 0; y < sut.size.height; y += 1) {
            for (let x = 0; x < sut.size.width; x += 1) {
                if (x < sut.size.width - 1) {
                    isSorted = isSorted && (tiles[y][x] < tiles[y][x + 1]);
                }
                if (y < sut.size.height - 1) {
                    isSorted = isSorted && (tiles[y][x] < tiles[y + 1][x]);
                }
            }
        }
        this.assertTrue(isSorted);
        logTestMsg(tiles.map(row => row.map(item => item.toString().padStart(4, "_")).join("")).join("\n"));

        this.assertTrue(sut.drawingOrderIndexForModelRect(new Rect(0, 2, 1, 1)) < sut.drawingOrderIndexForModelRect(new Rect(1, 2, 1, 1)));
        this.assertTrue(sut.drawingOrderIndexForModelRect(new Rect(0, 2, 1, 1)) < sut.drawingOrderIndexForModelRect(new Rect(0, 1, 1, 1)));
        // XXXCCC
        // RRRCCC R draws after X, and before C, and before Y
        // RRRCCC
        // RRRYYY
        let r = new Rect(0, 0, 3, 3), c = new Rect(3, 1, 3, 3);
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) > sut.drawingOrderIndexForModelTile(new Point(0, 3)));
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) > sut.drawingOrderIndexForModelTile(new Point(1, 3)));
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) > sut.drawingOrderIndexForModelTile(new Point(2, 3)));
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) < sut.drawingOrderIndexForModelRect(c));
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) < sut.drawingOrderIndexForModelTile(new Point(3, 0)));
        this.assertTrue(sut.drawingOrderIndexForModelRect(r) < sut.drawingOrderIndexForModelTile(new Point(4, 0)));
    }).buildAndRun();
};

function canvasStackTest() {
    new UnitTest("CanvasStack", function() {
        let containerElem = document.createElement("div");
        containerElem.style.width = "180px";
        containerElem.style.height = "65px";
        this.hiddenTestElem.append(containerElem);
        let sut = new CanvasStack(containerElem);
        this.assertEqual(sut.length, 0);

        let canvas = sut.addCanvas();
        this.assertEqual(sut.length, 1);
        this.assertEqual(containerElem.childElementCount, 1);
        if (this.assertTrue(!!canvas)) {
            this.assertEqual(sut.getCanvas(0), canvas);
            this.assertEqual(canvas.width, sut.pixelScale * 180);
            this.assertEqual(canvas.height, sut.pixelScale * 65);
        }

        canvas = sut.addCanvas();
        this.assertEqual(sut.length, 2);
        this.assertEqual(containerElem.childElementCount, 2);
        if (this.assertTrue(!!canvas)) {
            this.assertEqual(sut.getCanvas(1), canvas);
            this.assertTrue(sut.getCanvas(0) != sut.getCanvas(1));
            this.assertEqual(canvas.width, sut.pixelScale * 180);
            this.assertEqual(canvas.height, sut.pixelScale * 65);
        }

        sut.clear();
        this.assertEqual(sut.length, 0);
        this.assertEqual(containerElem.childElementCount, 0);

        sut.clear();
        sut = new CanvasStack(containerElem, 3);
        this.assertEqual(sut.length, 3);
        this.assertEqual(containerElem.childElementCount, 3);
    }).buildAndRun();
}

function flexCanvasGridTest(config, expect) {
    if (!config || !expect) {
        this.usage("call(config, expect)");
        this.usage("config: FlexCanvasGrid ctor config; canvasStub = stub with clientWidth/height");
        this.usage("expect: empty, tilesWide, tilesHigh")
        return;
    }
    var sut = new FlexCanvasGrid(config);
    this.assertEqual(sut.tileWidth, config.tileWidth * config.deviceScale, "init tileWidth");
    this.assertEqual(sut.tileSpacing, config.tileSpacing * config.deviceScale, "init tileSpacing");
    this.assertEqual(sut.deviceScale, config.deviceScale, "init deviceScale");
    this.assertEqual(sut.isEmpty, expect.empty, "isEmpty");
    this.assertDefined(sut.canvasCSSSize, "canvasCSSSize");
    this.assertEqual(sut.canvasCSSSize.width, config.canvas.clientWidth, "canvasCSSSize.width");
    this.assertEqual(sut.canvasCSSSize.height, config.canvas.clientHeight, "canvasCSSSize.height");
    this.assertDefined(sut.canvasDeviceSize, "canvasDeviceSize");
    this.assertEqual(sut.canvasDeviceSize.width, config.canvas.clientWidth * config.deviceScale, "canvasDeviceSize.width");
    this.assertEqual(sut.canvasDeviceSize.height, config.canvas.clientHeight * config.deviceScale, "canvasDeviceSize.height");
    this.assertEqual(sut.canvas.width, config.canvas.clientWidth * config.deviceScale, "canvas.width");
    this.assertEqual(sut.canvas.height, config.canvas.clientHeight * config.deviceScale, "canvas.height");
    if (sut.isEmpty) { return; }
    this.assertEqual(sut.tilesWide, expect.tilesWide, "init tilesWide");
    this.assertEqual(sut.tilesHigh, expect.tilesHigh, "init tilesHigh");
    this.assertEqual(sut.tileSize.width, expect.tilesWide, "init tileSize width");
    this.assertEqual(sut.tileSize.height, expect.tilesHigh, "init tileSize height");
    var rfa = sut.rectForAllTiles;
    this.assertEqual(rfa.x, expect.rectForAllTiles.x, "rfa x");
    this.assertEqual(rfa.y, expect.rectForAllTiles.y, "rfa y");
    this.assertEqual(rfa.width, expect.rectForAllTiles.width, "rfa width");
    this.assertEqual(rfa.height, expect.rectForAllTiles.height, "rfa height");

    for (var i = 0; i < expect.tiles.length; i += 1) {
        var spec = expect.tiles[i];
        this.assertEqual(sut.isTileVisible(spec), spec.isTileVisible, `isTileVisible ${i}`);
        var r = sut.rectForTile(spec);
        if (spec.isTileVisible) {
            this.assertEqual(r.x, spec.rectForTile.x, `rectForTile x ${i}`);
            this.assertEqual(r.y, spec.rectForTile.y, `rectForTile y ${i}`);
            this.assertEqual(r.width, spec.rectForTile.width, `rectForTile width ${i}`);
            this.assertEqual(r.height, spec.rectForTile.height, `rectForTile height ${i}`);
        }
    }
    for (var i = 0; i < expect.tileRects.length; i += 1) {
        var spec = expect.tileRects[i];
        var r = sut.rectForTileRect(spec);
        this.assertEqual(r.x, spec.rectForTileRect.x, `rectForTileRect x ${i}`);
        this.assertEqual(r.y, spec.rectForTileRect.y, `rectForTileRect y ${i}`);
        this.assertEqual(r.width, spec.rectForTileRect.width, `rectForTileRect width ${i}`);
        this.assertEqual(r.height, spec.rectForTileRect.height, `rectForTileRect height ${i}`);
    }
    for (var i = 0; i < expect.points.length; i += 1) {
        var got = sut.tileForCanvasPoint(expect.points[i].p);
        var exp = expect.points[i].t;
        var pfx = `tileForCanvasPoint ${i} ${expect.points[i].p.debugDescription}: `;
        if (!exp) {
            this.assertTrue(got == null, exp, pfx + "should be null");
        } else {
            this.assertTrue(got != null, pfx + "should not be null");
        }
        if (got && exp) {
            this.assertEqual(got.x, exp.x, pfx + "x");
            this.assertEqual(got.y, exp.y, pfx + "y");
        }
    }

    if (!this.isOK) { debugDump(sut); }
}

var flexCanvasGridTest1 = function() {
    var config = {
        tileWidth: 16,
        tileSpacing: 2,
        deviceScale: 2,
        canvas: { clientWidth: 200, clientHeight: 100 }
    };
    var expect = {
        empty: false,
        tilesWide: 11,
        tilesHigh: 5,
        rectForAllTiles: new Rect(4, 12, 392, 176),
        tiles: [{
            x: 0, y: 0,
            isTileVisible: true,
            rectForTile: new Rect(4, 12, 32, 32)
        }],
        tileRects: [{
            x: 0, y: 0, width: 3, height: 3,
            rectForTileRect: new Rect(4, 12, 104, 104)
        }, {
            x: 3, y: 2, width: 1, height: 2,
            rectForTileRect: new Rect(112, 84, 32, 68)
        }],
        points: [
            { p: new Point(-1, -1), t: null }, // negative
            { p: new Point(6, 14),  t: new Point(0, 0) }, // middle of tile
            { p: new Point(24, 8),  t: new Point(1, 0) }, // middle of tile
            { p: new Point(8, 24),  t: new Point(0, 1) }, // middle of tile
            { p: new Point(0, 0),   t: null }, // edge padding doesn't count
            { p: new Point(20, 28), t: new Point(1, 1) }, // inter-tile spacing
            { p: new Point(1600, 1600), t: null } // out of bounds
        ]
    };
    var test = new UnitTest("FlexCanvasGrid-200x100x16x2@2", flexCanvasGridTest).build();
    test(config, expect);
};

var flexCanvasGridTest2 = function() {
    var config = {
        tileWidth: 40,
        tileSpacing: 0,
        deviceScale: 2,
        canvas: { clientWidth: 30, clientHeight: 100 }
    };
    var expect = {
        empty: true,
        tilesWide: 0,
        tilesHigh: 0,
        rectForAllTiles: new Rect(0, 0, 0, 0),
        tiles: [],
        tileRects: [],
        points: []
    };
    var test = new UnitTest("FlexCanvasGrid-30x100x40x0@2", flexCanvasGridTest).build();
    test(config, expect);
};

var flexCanvasGridTest3 = function() {
    var config = {
        tileWidth: 24,
        tileSpacing: 0,
        deviceScale: 1,
        canvas: { clientWidth: 866, clientHeight: 544 }
    };
    var expect = {
        empty: false,
        tilesWide: 36,
        tilesHigh: 22,
        rectForAllTiles: new Rect(1, 8, 36*24, 22*24),
        tiles: [],
        tileRects: [],
        points: []
    };
    var test = new UnitTest("FlexCanvasGrid-866x100x12x3@1", flexCanvasGridTest).build();
    test(config, expect);
};

var rectHashTest = function() {
    var rows = 20;
    var columns = 80;
    var chars = ["•", "#"];
    var grid = [];
    var verbose = (rows * columns) < 25;
    for (var y = 0; y < rows; y++) {
        var line = "";
        for (var x = 0; x < columns; x++) {
            var h = new Rect(x, y, 1, 1).hashValue;
            var item = chars[h % chars.length];
            if (verbose) {
                logTestMsg([x, y, h, item]);
            }
            line += item;
        }
        grid.push(line);
    }
    logTestMsg(grid.join("\n"));
};

function cityRectExtensionsTest() {
    new UnitTest("RectExtensions-City", function() {
        var rect1 = new Rect(17, 9, 4, 7);
        [new Point(17, 9), new Point(19, 11), new Point(20, 9), new Point(17, 15), new Point(20, 15)].forEach((p) => {
            this.assertTrue(rect1.containsTile(p), p.debugDescription);
            this.assertTrue(rect1.containsTile(p.x, p.y), p.debugDescription + " decomposed");
        });
        [new Point(16, 9), new Point(17, 8), new Point(21, 9), new Point(17, 16)].forEach((p) => {
            this.assertFalse(rect1.containsTile(p), p.debugDescription);
            this.assertFalse(rect1.containsTile(p.x, p.y), p.debugDescription + " decomposed");
        });
        var coords = rect1.allTileCoordinates;
        this.assertEqual(coords.length, 28);

        var rect2 = new Rect(24, 31, 3, 2);
        coords = rect2.allTileCoordinates;
        this.assertElementsEqual(coords.map((p) => p.y), [31, 31, 31, 32, 32, 32]);
        this.assertElementsEqual(coords.map((p) => p.x), [24, 25, 26, 24, 25, 26]);

        var rect1x1 = new Rect(5, 2, 1, 1);
        this.assertTrue(rect1x1.containsTile(5, 2));
        this.assertFalse(rect1x1.containsTile(4, 2));
        this.assertFalse(rect1x1.containsTile(5, 3));
        coords = rect1x1.allTileCoordinates;
        this.assertEqual(coords.length, 1);
        this.assertEqual(coords[0].x, 5);
        this.assertEqual(coords[0].y, 2);

        var rectEmpty = new Rect(3, 2, 0, 0);
        coords = rectEmpty.allTileCoordinates;
        this.assertFalse(rectEmpty.containsTile(3, 2));
        this.assertEqual(coords.length, 0);
    }).buildAndRun();
}

// obsolete
function gameMapTest() {
    new UnitTest("GameMap",function() {
        var config = { size: {width: 10, height: 6} };
        var sut = new GameMap(config);
        [new Point(0, 0), new Point(3, 3), new Point(0, 5), new Point(9, 0), new Point(9, 5)].forEach((p) => {
            this.assertTrue(sut.isValidCoordinate(p), p.debugDescription);
            this.assertTrue(sut.isValidCoordinate(p.x, p.y), p.debugDescription);
        });
        [new Point(-1, 0), new Point(0, -1), new Point(-1, -1), new Point(0, 6), new Point(10, 0), new Point(10, 6), new Point(15, 15)].forEach((p) => {
            this.assertFalse(sut.isValidCoordinate(p), p.debugDescription);
            this.assertFalse(sut.isValidCoordinate(p.x, p.y), p.debugDescription);
        });

        var visits = [];
        var visitor = function (plot) { visits.push(plot); };
        var makePlot = function(name, x, y, w, h) { return { name: name, bounds: new Rect(x, y, w, h) }; };

        sut.visitEachPlot(visitor);
        this.assertEqual(visits.length, 0);
        this.assertEqual(sut.removePlot(makePlot("bogus", 0, 0, 1, 1)), null); // make sure it doesn't break

        visits = [];
        var plot1211 = makePlot("A", 1, 2, 1, 1);
        this.assertEqual(sut.addPlot(plot1211), plot1211);
        sut.visitEachPlot(visitor);
        this.assertEqual(visits.length, 1);
        this.assertEqual(sut.plotAtTile(1, 2), plot1211);
        this.assertEqual(sut.plotAtTile(2, 2), null);
        var found = sut.plotsInRect(plot1211.bounds);
        this.assertEqual(found.length, 1)
        this.assertEqual(found[0], plot1211);
        found = sut.plotsInRect(plot1211.bounds.inset(-1, -1));
        this.assertEqual(found.length, 1)
        this.assertEqual(found[0], plot1211);
        this.assertEqual(sut.plotsInRect(new Rect(1, 1, 5, 1)).length, 0);
        this.assertEqual(sut.plotsInRect(new Rect(-3, 1, 5, 2)).length, 1);

        visits = [];
        var plot3432 = makePlot("B", 3, 4, 3, 2);
        sut.addPlot(plot3432);
        sut.visitEachPlot(visitor);
        this.assertElementsEqual(visits.map((p) => p.name), ["A", "B"]);
        this.assertEqual(sut.plotAtTile(new Point(3, 4)), plot3432);
        this.assertEqual(sut.plotAtTile(new Point(5, 5)), plot3432);
        this.assertEqual(sut.plotAtTile(2, 4), null);
        this.assertEqual(sut.plotAtTile(6, 4), null);
        this.assertEqual(sut.plotAtTile(3, 3), null);
        found = sut.plotsInRect(plot3432.bounds);
        this.assertElementsEqual(found.map((p) => p.name), ["B"]);
        found = sut.plotsInRect(sut.bounds);
        this.assertElementsEqual(found.map((p) => p.name).sort(), ["A", "B"]);
        found = sut.plotsInRect(new Rect(4, 4, 4, 1));
        this.assertElementsEqual(found.map((p) => p.name), ["B"]);

        visits = [];
        var plot0513 = makePlot("C", 5, 0, 1, 3);
        var plot2411 = makePlot("D", 2, 4, 1, 1);
        sut.addPlot(plot0513);
        sut.addPlot(plot2411);
        sut.addPlot(plot2411); // test adding twice is idempotent
/*   0123456789
    0     C
    1     C
    2 A   C
    3
    4  DBBB
    5   BBB
     0123456789 */
        sut.visitEachPlot(visitor);
        this.assertElementsEqual(visits.map((p) => p.name), ["C", "A", "D", "B"]); // order by row then column
        found = sut.plotsInRect(new Rect(4, 1, 3, 1));
        this.assertElementsEqual(found.map((p) => p.name), ["C"]);
        found = sut.plotsInRect(plot0513.bounds.union(plot2411.bounds));
        this.assertElementsEqual(found.map((p) => p.name).sort(), ["B", "C", "D"])

        visits = [];
        this.assertEqual(sut.removePlot(plot3432), plot3432);
        sut.visitEachPlot(visitor);
        this.assertElementsEqual(visits.map((p) => p.name), ["C", "A", "D"]);
        this.assertEqual(sut.plotAtTile(3, 4), null);
        this.assertEqual(sut.plotAtTile(4, 5), null);
        this.assertEqual(sut.plotsInRect(plot3432.bounds).length, 0);

        visits = [];
        sut.removePlot(plot1211);
        sut.removePlot(plot3432); // test removing twice is idempotent
        sut.removePlot(plot0513);
        sut.removePlot(plot2411);
        sut.visitEachPlot(visitor);
        this.assertEqual(visits.length, 0);
        this.assertEqual(sut.plotsInRect(sut.bounds).length, 0);

        // Plots outside the map bounds, overlapping plots, etc.
        sut = new GameMap(config);

        visits = [];
        this.assertEqual(sut.addPlot(makePlot("X", 14, 27, 1, 1)), null);
        sut.visitEachPlot(visitor);
        this.assertEqual(visits.length, 0);

        visits = [];
        this.assertEqual(sut.addPlot(makePlot("X", -1, -1, 1, 1)), null);
        this.assertEqual(sut.addPlot(makePlot("X", 1, -1, 3, 3)), null);
        this.assertEqual(sut.addPlot(makePlot("X", -1, 1, 3, 3)), null);
        this.assertEqual(sut.addPlot(makePlot("X", 8, 1, 5, 1)), null);
        sut.visitEachPlot(visitor);
        this.assertEqual(visits.length, 0);

        visits = [];
        sut.addPlot(plot3432);
        var plotOverlaps3432 = makePlot(5, 5, 3, 1);
        this.assertEqual(sut.addPlot(plotOverlaps3432), null);
        sut.visitEachPlot(visitor);
        this.assertElementsEqual(visits.map(p => p.name), [plot3432.name]);

    }).buildAndRun();
}

// #################################################
// ################## TASK SUITE ###################
// #################################################

class FakeTask extends GameTask {
    constructor(id, performCallback) {
        super();
        this.id = id;
        this.performCount = 0;
        this.performedWith = null;
        this.performCallback = performCallback;
    }
    perform(target, queue) {
        if (typeof(this.performCallback) == 'function') {
            this.performCallback(this);
        }
        this.performCount += 1;
        this.performedWith = target;
        FakeTask.performOrder.push(this.id);
    }
}
FakeTask.performOrder = [];

class DuplicatingTask extends GameTask {
    constructor(dupeCount) {
        super();
        this.dupeCount = dupeCount;
    }
    perform(target, queue) {
        DuplicatingTask.performOrder.push(this.dupeCount);
        if (this.dupeCount > 0) {
            let next = new DuplicatingTask(this.dupeCount - 1);
            queue.append(next);
        }
    }
}
DuplicatingTask.performOrder = [];

let taskQueueTest = function() {
    new UnitTest("TaskQueue", function() {
        let target = "target";
        let sut = new TaskQueue();
        this.assertTrue(sut.isEmpty);

        let task = new FakeTask("a");
        sut.append(task);
        this.assertFalse(sut.isEmpty, "Appended task");
        this.assertEqual(task.performCount, 0, "Does not immediately perform");
        this.assertEqual(task.performedWith, null);

        sut.run(target);
        this.assertEqual(task.performCount, 1, "Performs task when running");
        this.assertEqual(task.performedWith, target);
        this.assertTrue(sut.isEmpty, "Ran queue");

        sut.run(target);
        this.assertEqual(task.performCount, 1, "Performs task once");

        sut = new TaskQueue();
        task = new FakeTask("a", (t) => {
            this.assertTrue(sut.isEmpty, "Task removed from queue before performing task");
        });
        sut.append(task);
        sut.run();

        FakeTask.performOrder = [];
        sut = new TaskQueue();

        task = new FakeTask("a");
        let task2 = new FakeTask("b");
        let task3 = new FakeTask("c");
        sut.prepend(task);
        this.assertFalse(sut.isEmpty);
        sut.append(task2);
        sut.prepend(task3);

        sut.run(target);
        this.assertTrue(sut.isEmpty);
        this.assertElementsEqual(FakeTask.performOrder, [task3.id, task.id, task2.id]);
        this.assertEqual(task.performCount, 1);
        this.assertEqual(task2.performCount, 1);
        this.assertEqual(task3.performCount, 1);

        sut = new TaskQueue();
        task = new DuplicatingTask(2);
        sut.append(task);
        sut.run(target);
        this.assertTrue(sut.isEmpty);
        this.assertElementsEqual(DuplicatingTask.performOrder, [2, 1, 0]);
    }).buildAndRun();
};

class swept {}

swept.gameTileTests = function() {
    new UnitTest("Sweep.GameTile", function() {
        const GameTile = Sweep.GameTile;
        const TileFlag = Sweep.TileFlag;
        let specs = [
            [false, false, TileFlag.none, 0, "____"],
            [true,  false, TileFlag.none, 0, "m___"],
            [true,  true, TileFlag.none, 0, "_c__"],
            [true,  true, TileFlag.none, 0, "mc__"],
            [false,  false, TileFlag.assertMine, 0, "__!_"],
            [false,  false, TileFlag.maybeMine, 0, "__?_"],
            [false,  false, TileFlag.none, 1, "___1"],
            [false,  false, TileFlag.none, 2, "___2"],
            [false,  false, TileFlag.none, 3, "___3"],
            [false,  false, TileFlag.none, 4, "___4"],
            [false,  false, TileFlag.none, 5, "___5"],
            [false,  false, TileFlag.none, 6, "___6"],
            [false,  false, TileFlag.none, 7, "___7"],
            [false,  false, TileFlag.none, 8, "___8"],
            [true,   true,  TileFlag.none, 5, "mc_5"]
        ];
        specs.forEach(item => {
            let tile = new GameTile();
            tile._mined = item[0];
            tile._covered = item[1];
            tile._flag = item[2];
            tile._minedNeighborCount = item[3];
            
            let config = GameTile.fromCompactSerialization(tile.compactSerialized);
            let message = item[4];
            
            this.assertEqual(config.isMined, item[0], "isMined," + message);
            this.assertEqual(config.isCovered, item[1], "isCovered," + message);
            this.assertEqual(config.flag.debugDescription, item[2].debugDescription, "flag," + message);
            this.assertEqual(config.minedNeighborCount, item[3], "minedNeighborCount," + message);
        });
    }).buildAndRun();
};

swept.sharingTests = async function() {
    await initSweep();
    new UnitTest("Sweep.Sharing", function() {
        const Sharing = Sweep.Sharing;
        let codes = {
            easy1: "-- Try this Sweep game: 10x10, 8 mines, 1/5 difficulty --\n0100000a0a0008050420001000060200400004000100",
            int1: "-- Try this Sweep game: 24x16, 36 mines, 2/5 difficulty --\n0100011810002407008000004000214020000000000000420010000800008010\n 890088013200080200400000d6200002002040020000080020   ",
            custom1: "0100040808000c01001022030801320202",
            // two-byte  mine count (0110)
            custom2: "010004221001101100b754b152def04e9fe5e6b7f677d631696420e153f46479\n8dd6610d1211aa142d3f37c4185509c7694a42ca98ab32a098a296369c0dd7bf\n60067275fce93aed915ecd5cd2"
        };
        let bogusCodes = {
            empty:              "",
            noGameData:         "0100",
            // based on:         0100000a0a0008050420001000060200400004000100
            badSchema:          "0200000a0a0008050420001000060200400004000100",
            badMode:            "0101000a0a0008050420001000060200400004000100",
            badDifficulty:      "0100a00a0a0008050420001000060200400004000100",
            badWidth:           "0100000b0a0008050420001000060200400004000100",
            badHeight:          "0100000a030008050420001000060200400004000100",
            badMineCount:       "0100000a0a0009050420001000060200400004000100",
            badChecksum:        "0100000a0a0008060420001000060200400004000100",
            badTileArrayHeader: "0100000a0a0008050720001000060200400004000100",
            missingTileByte:    "0100000a0a00080504200010000602004000000100",
            missingMine:        "0100000a0a0008050420001000060200400002000100",
            extraMine:          "0100000a0a0008050420001000060200400104000100",
            // custom difficulty bounds checking
            // based on:         0100040808000c01001022030801320202
            tooNarrow:          "0100040708000c01001022030801320202",
            tooWide:            "0100044108000c01001022030801320202",
            tooShort:           "0100040807000c01001022030801320202",
            tooTall:            "0100040841000c01001022030801320202",
            notEnoughMines:     "0100040808000301001022030801320202",
            tooManyMines:       "0100040808040101001022030801320202"
        };
        
        this.assertEqual(Sharing.cleanSharingCode(""), "");
        this.assertEqual(Sharing.cleanSharingCode(codes.easy1), "0100000a0a0008050420001000060200400004000100");

        let game = null;        
        game = this.assertNoThrow(() => {
            let object = Array.fromHexString(Sharing.cleanSharingCode(codes.easy1));
            return Sharing.gameFromBoardObject(object);
        }, "dz easy1");
        if (game) {
            this.assertEqual(game.difficulty.index, 0, "easy1 difficulty");
            this.assertEqual(game.board.size.width, 10, "easy1 width");
            this.assertEqual(game.board.size.height, 10, "easy1 height");
            this.assertEqual(game.board.mineCount, 8, "easy1 mineCount");
            this.assertEqual(game.board._allTiles.length, 100, "easy1 tile count");
            let mines = Sweep.TileCollection.allTiles({ game: game })
                .applying(new Sweep.TileTransform.MineFilter(true));
            this.assertEqual(mines.tiles.length, game.board.mineCount, "easy1 mines on board");
            let code = Sharing.gameBoardObject({ game: game }).toHexString();
            this.assertEqual(code, codes.easy1.split("\n")[1], "codes match");
        }
        
        game = this.assertNoThrow(() => {
            let object = Array.fromHexString(Sharing.cleanSharingCode(codes.int1));
            return Sharing.gameFromBoardObject(object);
        }, "dz int1");
        if (game) {
            this.assertEqual(game.difficulty.index, 1, "int1 difficulty");
            this.assertEqual(game.board.size.width, 24, "int1 width");
            this.assertEqual(game.board.size.height, 16, "int1 height");
            this.assertEqual(game.board.mineCount, 36, "int1 mineCount");
            this.assertEqual(game.board._allTiles.length, 384, "int1 tile count");
            let mines = Sweep.TileCollection.allTiles({ game: game })
                .applying(new Sweep.TileTransform.MineFilter(true));
            this.assertEqual(mines.tiles.length, game.board.mineCount, "int1 mines on board");
        }
        
        game = this.assertNoThrow(() => {
            let object = Array.fromHexString(Sharing.cleanSharingCode(codes.custom1));
            return Sharing.gameFromBoardObject(object);
        }, "dz custom1");
        if (game) {
            this.assertTrue(game.difficulty.isCustom, "custom1 difficulty");
            this.assertEqual(game.board.size.width, 8, "custom1 width");
            this.assertEqual(game.board.size.height, 8, "custom1 height");
            this.assertEqual(game.board.mineCount, 12, "custom1 mineCount");
            this.assertEqual(game.board._allTiles.length, 64, "custom1 tile count");
            let mines = Sweep.TileCollection.allTiles({ game: game })
                .applying(new Sweep.TileTransform.MineFilter(true));
            this.assertEqual(mines.tiles.length, game.board.mineCount, "custom1 mines on board");
            let code = Sharing.gameBoardObject({ game: game }).toHexString();
            this.assertEqual(code, codes.custom1, "codes match");
        }
        
        game = this.assertNoThrow(() => {
            let object = Array.fromHexString(Sharing.cleanSharingCode(codes.custom2));
            return Sharing.gameFromBoardObject(object);
        }, "dz custom1");
        if (game) {
            this.assertEqual(game.board.mineCount, 272, "custom2 mineCount");
        }
        
        Object.getOwnPropertyNames(bogusCodes).forEach(name => {
            let code = bogusCodes[name];
            this.assertThrows(() => {
                let object = Array.fromHexString(Sharing.cleanSharingCode(code));
                Sharing.gameFromBoardObject(object);
            }, name);
        });
    }).buildAndRun();
};

swept.autosaveTests = async function() {
    await initSweep();
    new UnitTest("Sweep.autosave", function() {
        // set up a game in the middle of gameplay
        let game = new Sweep.Game({ difficulty: Sweep.Game.getDifficulty(0) });
        let session = new Sweep.GameSession({ game: game });
        session.start();
        let tile = game.board._allTiles[0];
        session.performAction(new Sweep.SweepAction.RevealTileAction({ tile: tile, revealBehavior: Sweep.GameSession.revealBehaviors.safe }));
        session.hintTile = game.board._allTiles[2];
        // Simulate some play time
        session.sessionTimer.activeStartTime = Date.now() - 1000;
        session.sessionTimer.wallStartTime = Date.now() - 2000;
        
        let data = session.objectForAutosave();
        // console.log(data);
        // console.log({ length: JSON.stringify(data).length });
        this.assertTrue(!!data, "objectForAutosave is defined");
        if (!!data) {
            let restored = this.assertNoThrow(() => {
                return Sweep.GameSession.fromAutosave(data);
            }, "restore autosave");
            this.assertTrue(!!restored, "restored");
            if (!!restored) {
                this.assertTrue(!!restored.game, "game");
                if (restored.game) {
                    this.assertEqual(restored.game.id, session.game.id);
                    this.assertEqual(restored.game.difficulty.index, session.game.difficulty.index);
                    this.assertEqual(restored.game.board.size.width, session.game.board.size.width);
                    this.assertEqual(restored.game.board.size.height, session.game.board.size.height);
                    this.assertEqual(restored.game.board.mineCount, session.game.board.mineCount);
                }
                this.assertEqual(restored.state, session.state);
                this.assertTrue(!!restored.history, "history");
                if (restored.history) {
                    this.assertEqual(restored.history.moveNumber, session.history.moveNumber);
                    this.assertEqual(restored.history.serializedMoves.length, session.history.serializedMoves.length);
                }
                this.assertEqual(restored.isClean, session.isClean);
                this.assertTrue(!!restored.mostRecentAction, "mostRecentAction");
                if (restored.mostRecentAction) {
                    this.assertEqual(restored.mostRecentAction.actionType, session.mostRecentAction.actionType);
                    this.assertEqual(restored.mostRecentAction.tile != null, session.mostRecentAction.tile != null);
                }
                this.assertTrue(!!restored.hintTile, "hintTile");
                if (restored.hintTile) {
                    this.assertEqual(restored.hintTile.coord.x, session.hintTile.coord.x);
                    this.assertEqual(restored.hintTile.coord.y, session.hintTile.coord.y);
                }
                this.assertEqualTol(restored.sessionTimer.activeTimeElapsed, 1000, 10, "restored activeTimeElapsed");
                this.assertEqualTol(restored.sessionTimer.wallTimeElapsed, 2000, 10, "restored wallTimeElapsed");
                this.assertEqual(restored.startTime, session.startTime);
                this.assertEqual(restored.endTime, session.endTime);
            }
        }
        
        game = new Sweep.Game({ difficulty: Sweep.Game.makeCustomDifficulty({ width: 12, height: 24, mineCount: 30 }) });
        session = new Sweep.GameSession({ game: game });
        session.start();
        data = session.objectForAutosave();
        this.assertTrue(!!data, "objectForAutosave is defined");
        if (!!data) {
            let restored = this.assertNoThrow(() => {
                return Sweep.GameSession.fromAutosave(data);
            }, "restore autosave");
            this.assertTrue(!!restored, "restored");
            if (!!restored && restored.game) {
                this.assertEqual(restored.game.id, session.game.id);
                this.assertEqual(restored.game.difficulty.index, session.game.difficulty.index);
                this.assertEqual(restored.game.board.size.width, session.game.board.size.width);
                this.assertEqual(restored.game.board.size.height, session.game.board.size.height);
                this.assertEqual(restored.game.board.mineCount, session.game.board.mineCount);
            }
        }
    }).buildAndRun();
};

swept.gameSessionTimerTests = async function() {
    await initSweep();
    new UnitTest("Sweep.GameSessionTimer", function() {
        let sut = new Sweep.GameSessionTimer();
        this.assertEqual(sut.state, Sweep.GameSessionTimer.State.stopped, "defaults to stopped");
        this.assertEqualTol(sut.activeTimeElapsed, 0, 5, "activeTimeElapsed 0 from init()");
        this.assertEqualTol(sut.wallTimeElapsed, 0, 5, "wallTimeElapsed 0 from init()");
        sut.start();
        this.assertEqual(sut.state, Sweep.GameSessionTimer.State.active, "started");
        this.assertEqualTol(sut.activeTimeElapsed, 0, 5, "activeTimeElapsed 0 from fresh start");
        this.assertEqualTol(sut.wallTimeElapsed, 0, 5, "wallTimeElapsed 0 from fresh start");
        sut._activeStartTime = Date.now() - 1000;
        sut._wallStartTime = Date.now() - 2000;
        this.assertEqualTol(sut.activeTimeElapsed, 1000, 5, "activeTimeElapsed, fresh start, sim 1000 ms");
        this.assertEqualTol(sut.wallTimeElapsed, 2000, 5, "wallTimeElapsed, fresh start, sim 2000 ms");
        this.assertEqualTol(sut.activeTimeElapsed, 1000, 5, "activeTimeElapsed, multiple calls shouldn't over-accumulate");
        this.assertEqualTol(sut.wallTimeElapsed, 2000, 5, "wallTimeElapsed, multiple calls shouldn't over-accumulate");
        
        sut.pause();
        sut.pause(); // Multiple pauses should be idempotent
        this.assertEqual(sut.state, Sweep.GameSessionTimer.State.paused, "paused");
        this.assertEqualTol(sut.activeTimeElapsed, 1000, 5, "activeTimeElapsed, paused, accumulated 1000 ms");
        this.assertEqualTol(sut.wallTimeElapsed, 2000, 5, "wallTimeElapsed, paused, sim 2000 ms");
        sut._wallStartTime = Date.now() - 3000;
        this.assertEqualTol(sut.wallTimeElapsed, 3000, 5, "wallTimeElapsed, paused, sim 3000 ms");
        sut.resume();
        sut.resume(); // Multiple resumes should be idempotent
        this.assertEqual(sut.state, Sweep.GameSessionTimer.State.active, "resumed");
        this.assertEqualTol(sut.activeTimeElapsed, 1000, 5, "activeTimeElapsed, resumed, still 1000 ms");
        this.assertEqualTol(sut.wallTimeElapsed, 3000, 5, "wallTimeElapsed, resumed, sim 3000 ms");
        
        sut.stop();
        this.assertEqual(sut.state, Sweep.GameSessionTimer.State.stopped, "stopped");
        this.assertEqualTol(sut.activeTimeElapsed, 1000, 5, "activeTimeElapsed, stopped, 1000 ms");
        this.assertEqualTol(sut.wallTimeElapsed, 3000, 5, "wallTimeElapsed, stopped, 3000 ms");
        
        sut.resume();
        this.assertEqual(sut.state, Sweep.GameSessionTimer.State.stopped, "resume ignored");
        this.assertEqualTol(sut.activeTimeElapsed, 1000, 5, "activeTimeElapsed, resume ignored during stop, 1000 ms");
        this.assertEqualTol(sut.wallTimeElapsed, 3000, 5, "wallTimeElapsed, resume ignored during stop, 3000 ms");
        
        sut.start();
        this.assertEqual(sut.state, Sweep.GameSessionTimer.State.active, "restarted");
        this.assertEqualTol(sut.activeTimeElapsed, 1000, 5, "activeTimeElapsed, restarted, 1000 ms");
        this.assertEqualTol(sut.wallTimeElapsed, 3000, 5, "wallTimeElapsed, restarted, 3000 ms");
        sut._activeStartTime = Date.now() - 500;
        sut._wallStartTime = Date.now() - 500;
        this.assertEqualTol(sut.activeTimeElapsed, 1500, 5, "activeTimeElapsed, restarted, sim 500 ms more");
        this.assertEqualTol(sut.wallTimeElapsed, 3500, 5, "wallTimeElapsed, restarted, sim 500 ms more");
        
        sut = new Sweep.GameSessionTimer({ activeTimeElapsed: 10000, wallTimeElapsed: 20000 });
        this.assertEqual(sut.state, Sweep.GameSessionTimer.State.stopped, "restored and stopped");
        this.assertEqualTol(sut.activeTimeElapsed, 10000, 5, "activeTimeElapsed restored");
        this.assertEqualTol(sut.wallTimeElapsed, 20000, 5, "wallTimeElapsed restored");
    }).buildAndRun();
};

swept.convolutionTests = async function() {
    const ConvolutionPattern = SweepSolver.ConvolutionPattern;
    let stubTile = function(x, y) {
        return new Sweep.GameTile(new Point(x, y));
    };
    let stubInput = function() {
        let tiles = [];
        for (let y = 0; y < 3; y++) {
            for (let x = 0; x < 3; x++) {
                tiles.push(stubTile(x, y));
            }
        }
        return new ConvolutionInput({ tile: stubTile() });
    };
    let makeGame = function(a) {
        let board = new Sweep.GameBoard({ size: a.size, mineCount: 0 });
        a.mined?.forEach(coord => {
            board.tileAtCoord(coord).isMined = true;
        });
        board.reset();
        a.cleared?.forEach(coord => {
            board.tileAtCoord(coord)._covered = false;
        });
        a.flagged?.forEach(coord => {
            board.tileAtCoord(coord)._flag = Sweep.TileFlag.assertMine;
        });
        return { board: board };
    };
    
    await initSweep();
    
    new UnitTest("ConvolutionPattern.Input", function() {
        let game = { board: new Sweep.GameBoard({ size: {width: 6, height: 5}, mineCount: 5 }) };
        let sut = new ConvolutionPattern.Input(game, new Rect(1, 3, 4, 2));
        this.assertEqual(sut.tile(new Point(0, 0))?.coord, new Point(1, 3), "(0, 0)");
        this.assertEqual(sut.tile(new Point(1, 0))?.coord, new Point(2, 3), "(1, 0)");
        this.assertEqual(sut.tile(new Point(3, 0))?.coord, new Point(4, 3), "(3, 0)");
        this.assertEqual(sut.tile(new Point(0, 1))?.coord, new Point(1, 4), "(0, 1)");
        this.assertTrue(null == sut.tile(new Point(4, 0)), "past x bounds");
        this.assertTrue(null == sut.tile(new Point(0, 2)), "past y bounds");
        this.assertTrue(null == sut.tile(new Point(-1, 0)), "offset x -1");
        this.assertTrue(null == sut.tile(new Point(0, -1)), "offset y -1");
        this.assertTrue(null == sut.tile(new Point(-3, 4)), "way off");
        
        this.assertDefined(ConvolutionPattern.Input.make(game, new Rect(1, 3, 4, 2)), "1 3 4 2");
        this.assertDefined(ConvolutionPattern.Input.make(game, new Rect(0, 0, game.board.size.width, game.board.size.height)), "full size");
        this.assertTrue(null == ConvolutionPattern.Input.make(game, new Rect(-1, 3, 4, 2)), "x: -1");
        this.assertTrue(null == ConvolutionPattern.Input.make(game, new Rect(1, -1, 4, 2)), "y: -1");
        this.assertTrue(null == ConvolutionPattern.Input.make(game, new Rect(0, 3, 7, 2)), "too wide");
        this.assertTrue(null == ConvolutionPattern.Input.make(game, new Rect(0, 3, 7, 4)), "too high");
        
        let inputs = [];
        let tiles = [];
        sut.visitTiles((inputCoord, tile, input) => {
            if (input != sut) { return; }
            inputs.push(`${inputCoord?.x},${inputCoord?.y}`);
            tiles.push(`${tile?.coord?.x},${tile?.coord?.y}`);
        });
        this.assertEqual(inputs.join(" "), "0,0 1,0 2,0 3,0 0,1 1,1 2,1 3,1");
        this.assertEqual(tiles.join(" "), "1,3 2,3 3,3 4,3 1,4 2,4 3,4 4,4");
    }).buildAndRun();
    
    new UnitTest("ConvolutionPattern", function() {
        let game = makeGame({
            size: {width: 6, height: 5},
            mined: [],
            cleared: [],
            flagged: []
        });
        let any = new ConvolutionPattern({
            name: "match anything, do nothing",
            match: "..\n..",
            action: "..\n.."
        });
        let someCovered = new ConvolutionPattern({
            name: "covered 0,0 & 1,1",
            match: ".#\n#.", // 0,0 and 1,1
            action: "..\n.."
        });
        let someCleared = new ConvolutionPattern({
            name: "cleared 0,0 & 1,1",
            match: ".C\nC.",
            action: "..\n.."
        });
        
        let someCoveredWhitespace = this.assertNoThrow(() => new ConvolutionPattern({
            name: "covered 0,0 & 1,1",
            match: " .#\n  #.  \n\n", // 0,0 and 1,1
            action: "    ..\n.. "
        }));
        this.assertEqual(any, any, "identity");
        this.assertEqual(someCovered, someCoveredWhitespace, "Whitespace ignored in match/action matrixes");
        this.assertFalse(any.isEqual(someCovered), "any != someCovered");
        this.assertFalse(any.isEqual(someCleared), "any != someCleared");
        
        let input = any.makeInput(game, new Point(0, 0)); // ##;##
        this.assertEqual(input.rect, new Rect(0, 0, 2, 2));
        this.assertTrue(any.matches(input), `${any.debugDescription} matches ${input.debugDescription}`);
        this.assertTrue(someCovered.matches(input), `${someCovered.debugDescription} matches ${input.debugDescription}`);
        this.assertFalse(someCleared.matches(input), `${someCleared.debugDescription} !matches ${input.debugDescription}`);
        
        this.assertEqual(any.actions(input).length, 0, "all noops produces no actions");
        
        game = makeGame({ size: game.board.size, cleared: [new Point(0, 0), new Point(1, 1), new Point(0, 1)] });
        input = any.makeInput(game, new Point(0, 0)); // CC;C#
        this.assertTrue(any.matches(input), `${any.debugDescription} matches ${input.debugDescription}`);
        this.assertFalse(someCovered.matches(input), `${someCovered.debugDescription} matches ${input.debugDescription}`);
        this.assertTrue(someCleared.matches(input), `${someCleared.debugDescription} !matches ${input.debugDescription}`);
        
        // board origin:
        // 11** <-cheatsheet   1##F##
        // 0122        state-> 012###
        game = makeGame({
            size: game.board.size,
            mined: [new Point(2, 1), new Point(3, 1)],
            cleared: [new Point(0, 0), new Point(1, 0), new Point(2, 0), new Point(0, 1)],
            flagged: [new Point(3, 1)]
        });
        // this.assertEqual(game.board.tileAtCoord(new Point(1, 0)).isCovered, false);
        // this.assertEqual(game.board.tileAtCoord(new Point(0, 0)).minedNeighborCount, 0);
        
        let numbers = new ConvolutionPattern({ name: "numbers", match: "C.\n01", action: "..\n.." });
        console.log(numbers);
        this.assertTrue(numbers.matches(numbers.makeInput(game, new Point(0, 0))), "matches origin" + numbers.debugDescription);
        this.assertFalse(numbers.matches(numbers.makeInput(game, new Point(1, 0))), "!matches offset" + numbers.debugDescription);
        let flagged = new ConvolutionPattern({ name: "flagged", match: ".F\n..", action: "..\n.." });
        this.assertTrue(flagged.matches(flagged.makeInput(game, new Point(2, 0))), "matches offset 2 " + flagged.debugDescription);
        this.assertFalse(flagged.matches(flagged.makeInput(game, new Point(1, 0))), "!matches offset 1" + flagged.debugDescription);
        
        // .. => F.
        // ..    .C
        let actionMaker = new ConvolutionPattern({ name: "actionMaker", match: "..\n..", action: "F.\n.C" });
        let actionMaker2 = this.assertNoThrow(() => new ConvolutionPattern({ name: "actionMaker", match: "..\n..", action: "F0\n8C" }), "Numbers/# are no-ops in action matrix");
        let actionMaker3 = this.assertNoThrow(() => new ConvolutionPattern({ name: "actionMaker", match: "..\n..", action: "F#\n3C" }), "Numbers/# are no-ops in action matrix");
        this.assertEqual(actionMaker, actionMaker2, "Numbers/# are no-ops in action matrix");
        this.assertEqual(actionMaker, actionMaker3, "Numbers/# are no-ops in action matrix");
        
        let actions = actionMaker.actions(actionMaker.makeInput(game, new Point(2, 0)));
        if (this.assertEqual(actions.length, 2, "two actions produced")) {
            let setFlagAction = null;
            let clearAction = null;
            if (actions[0].constructor.name == "SetFlagAction") {
                setFlagAction = actions[0]; clearAction = actions[1];
            } else {
                setFlagAction = actions[1]; clearAction = actions[0];
            }
            this.assertEqual(setFlagAction.constructor.name, "SetFlagAction");
            this.assertEqual(setFlagAction.tile.coord, new Point(2, 1));
            this.assertEqual(clearAction.constructor.name, "RevealTileAction");
            this.assertEqual(clearAction.tile.coord, new Point(3, 0));
        }
        
        actions = actionMaker.actions(actionMaker.makeInput(game, new Point(0, 0)));
        this.assertEqual(actions.length, 0, "No clear/flag action produced if already cleared");
        
        actions = actionMaker.actions(actionMaker.makeInput(game, new Point(3, 0)));
        if (this.assertEqual(actions.length, 1, "No flag action produced if already flagged")) {
            this.assertEqual(actions[0].constructor.name, "RevealTileAction");
            this.assertEqual(actions[0].tile.coord, new Point(4, 0));
        }
        
        actions = actionMaker.actions(actionMaker.makeInput(game, new Point(2, 1)));
        if (this.assertEqual(actions.length, 1, "No clear action produced if already flagged")) {
            this.assertEqual(actions[0].constructor.name, "SetFlagAction");
            this.assertEqual(actions[0].tile.coord, new Point(2, 2));
        }
        
        // ######    DD####
        // ######    DD#CC#
        // ###### => #BBCC#
        // 1##F##    1BBAA#
        // 012###    012AA#
        let matches = any.findNonoverlappingMatches(game);
        let matchCoords = matches.map(input => `${input.rect.origin.x},${input.rect.origin.y}`).join(" ");
        this.assertEqual(matchCoords, "0,0 2,0 4,0 0,2 2,2 4,2");
        matches = someCovered.findNonoverlappingMatches(game);
        matchCoords = matches.map(input => `${input.rect.origin.x},${input.rect.origin.y}`).join(" ");
        this.assertEqual(matchCoords, "3,0 1,1 3,2 0,3");
    }).buildAndRun();
        
    new UnitTest("ConvolutionPattern.Transforms", function() {
        // C..  ..F
        // 01.  ..C
        let rotator = new ConvolutionPattern({ name: "rotator", match: "C..\n01.", action: "..F\n..C" });
        let rotated0 = rotator.rotated(0);
        this.assertEqual(rotated0.matchDescription, "C..;01.", rotated0.fullName + " matches");
        this.assertEqual(rotated0.actionDescription, "..F;..C", rotated0.fullName + " actions");
        let rotated1 = rotator.rotated(1);
        this.assertEqual(rotated1.matchDescription, "..;.1;C0", rotated1.fullName + " matches");
        this.assertEqual(rotated1.actionDescription, "FC;..;..", rotated1.fullName + " actions");
        let rotated2 = rotator.rotated(2);
        this.assertEqual(rotated2.matchDescription, ".10;..C", rotated2.fullName + " matches");
        this.assertEqual(rotated2.actionDescription, "C..;F..", rotated2.fullName + " actions");
        let rotated3 = rotator.rotated(3);
        this.assertEqual(rotated3.matchDescription, "0C;1.;..", rotated3.fullName + " matches");
        this.assertEqual(rotated3.actionDescription, "..;..;CF", rotated3.fullName + " actions");
        let rotated21 = rotated2.rotated(1);
        this.assertEqual(rotated21.matchDescription, rotated3.matchDescription);
        this.assertEqual(rotated21.actionDescription, rotated3.actionDescription);
        
        let flipped1 = rotator.flippedHorizontally();
        this.assertEqual(flipped1.matchDescription, "..C;.10", "flip-x match matrix");
        this.assertEqual(flipped1.actionDescription, "F..;C..", "flip-x action matrix");
        let flipped2 = rotator.flippedHorizontally().flippedHorizontally();
        this.assertTrue(rotator.isEqual(flipped2), "flip-x twice is identity");
        
        flipped1 = rotator.flippedVertically();
        flipped2 = rotator.flippedVertically().flippedVertically();
        this.assertEqual(flipped1.matchDescription, "01.;C..", "flip-y match matrix");
        this.assertEqual(flipped1.actionDescription, "..C;..F", "flip-y action matrix");
        this.assertTrue(rotator.isEqual(flipped2), "flip-y twice is identity");
        
        let tPlain = new ConvolutionPattern({ name: "tPlain", match: "##\n##", action: "FF\nFF" });
        this.assertEqual(tPlain.allUniqueTransforms().length, 1, "##;## has no other unique transforms");
        
        let t1212 = new ConvolutionPattern({ name: "t1212", match: "1#\n1#", action: ".F\n.F" });
        this.assertEqual(t1212.allUniqueTransforms().length, 4, "1212 has 4 transforms");

        // 4 rotations with no flip, 4 rotations of one of the flips, but the other flip's rotations are all duplicates. I think this is the max
        // number of unique rotations any pattern can have.
        let t1234 = new ConvolutionPattern({ name: "t1234", match: "34\n#2", action: "..\nF." });
        this.assertEqual(t1234.allUniqueTransforms().length, 8, "1234 has 8 transforms");
    }).buildAndRun();
    
    new UnitTest("ConvolutionPattern.Invalid", function() {
        this.assertThrows(() => new ConvolutionPattern({ name: "", match: "", action: "" }), "empty");
        this.assertThrows(() => new ConvolutionPattern({ name: "", match: "...\n..", action: "...\n.." }), "non-rectangular");
        this.assertThrows(() => new ConvolutionPattern({ name: "", match: "...\n...", action: "...\n.." }), "m/a size mismatch");
        this.assertThrows(() => new ConvolutionPattern({ name: "", match: ".X\n..", action: "..\n.." }), "bad match chars");
        this.assertThrows(() => new ConvolutionPattern({ name: "", match: "..\n..", action: ".X\n.." }), "bad action chars");
    }).buildAndRun();
};

UnitTest.prototype.civRun = function(injBlock) {
    let oldContent = CivGame.inj().content;
    if (injBlock) { injBlock(); }
    this.buildAndRun();
    CivGame.inj().content = oldContent;
    return this;
};

class civved {
    static baseGeometryTests() {
        const Tile = CivGame.Tile;
        new UnitTest("Civ.Tile", function() {
            let tile15a = new Tile(1, 5.83);
            let tile15b = new Tile(new Point(1.07, 5));
            let tile02 = new Tile(0, 2);
            this.assertEqual(tile15b, tile15a);
            this.assertEqual(tile15a.coord, new Point(1, 5));
            this.assertEqual(tile15a.coord?.x, 1); // exact integer equality should always pass
            this.assertEqual(tile15a.coord?.y, 5); // exact integer equality should always pass
            this.assertEqual(tile15a.centerCoord, new Point(1.5, 5.5));
            this.assertEqual(tile15a.rect, new Rect(1, 5, 1, 1));
            this.assertTrue(!tile02.isEqual(tile15a));
            this.assertEqual(tile02.adjacent(directions.N), new Tile(0, 3));
            this.assertEqual(tile02.adjacent(directions.NE), new Tile(1, 3));
            this.assertEqual(tile02.adjacent(directions.E), new Tile(1, 2));
            this.assertEqual(tile02.adjacent(directions.SE), new Tile(1, 1));
            this.assertEqual(tile02.adjacent(directions.NW), new Tile(-1, 3));
        }).buildAndRun();
        
        new UnitTest("Civ.Tile.integralBehavior", function(coords, gridPoints) {
            for (let i = 0; i < coords.length; i += 1) {
                let coord = new Point(coords[i][0], coords[i][1]);
                let expected = new Point(gridPoints[i][0], gridPoints[i][1]);
                let tile = new Tile(coord);
                this.assertEqual(tile.coord, expected, coord.debugDescription);
            }
        }).build()([
            [0, 0],    [0.5, 0.5],     [0.999, 0.9999],
            [1, 1],    [1.01, 0.99],   [57.234, 98.6],
            [-0, -0],  [-0.01, -0.99], [-17.68, -4.03], [-7.00, 6.00]
        ], [
            [0, 0],    [0, 0],         [0, 0],
            [1, 1],    [1, 0],         [57, 98],
            [0, 0],    [-1, -1],       [-18, -5],       [-7, 6]
        ]);
    }
    
    static mapTests() {
        const Tile = CivGame.Tile;
        const MapSquare = CivGame.MapSquare;
        new UnitTest("Civ.MapSquare", function() {
            let sut = new MapSquare(null, new Tile(3, 4));
            this.assertEqual(sut.tile, new Tile(3, 4));
            this.assertEqual(sut.edges.length, 4);
        }).buildAndRun();
        
        const RectMap = CivGame.RectMap;
        new UnitTest("Civ.RectMap", function() {
            let sut = new RectMap({ width: 4, height: 3 });
            this.assertEqual(sut.size?.width, 4);
            this.assertEqual(sut.size?.height, 3);
            this.assertTrue(sut.isValidTile(new Tile(0, 0)));
            this.assertTrue(sut.isValidTile(new Tile(0, 0)));
            this.assertFalse(sut.isValidTile(new Tile(4, 0)));
            this.assertFalse(sut.isValidTile(new Tile(0, 3)));
            this.assertFalse(sut.isValidTile(new Tile(-1, 0)));
            this.assertFalse(sut.isValidTile(new Tile(0, -1)));
            let square = sut.squareAtTile(new Tile(0, 0));
            this.assertEqual(square?.tile, new Tile(0, 0));
            square = sut.squareAtTile(new Tile(3, 2));
            this.assertEqual(square?.tile, new Tile(3, 2));
            this.assertTrue(!sut.squareAtTile(new Tile(4, 0)));
            this.assertTrue(!sut.squareAtTile(new Tile(0, 3)));
            this.assertTrue(!sut.squareAtTile(new Tile(-1, 0)));
            this.assertTrue(!sut.squareAtTile(new Tile(0, -1)));
            
            this.assertEqual(sut.adjacentSquare(sut.squareAtTile(new Tile(0, 0)), directions.N)?.tile, new Tile(0, 1));
            this.assertEqual(sut.adjacentSquare(sut.squareAtTile(new Tile(0, 0)), directions.W), null);
            this.assertEqual(sut.adjacentSquare(sut.squareAtTile(new Tile(0, 0)), directions.S), null);
            this.assertEqual(sut.adjacentSquare(sut.squareAtTile(new Tile(0, 0)), directions.NE)?.tile, new Tile(1, 1));
            this.assertEqual(sut.adjacentSquare(sut.squareAtTile(new Tile(3, 2)), directions.SW)?.tile, new Tile(2, 1));
            this.assertEqual(sut.adjacentSquare(sut.squareAtTile(new Tile(3, 2)), directions.NE), null);
            
            let got = { x: "", y: "" };
            sut.forEachSquare(s => {
                got.x += `${s.tile.coord.x}`;
                got.y += `${s.tile.coord.y}`;
            });
            this.assertEqual(got.y, "000011112222");
            this.assertEqual(got.x, "012301230123");
        }).buildAndRun();
        
        const TileEdge = CivGame.TileEdge;
        new UnitTest("Civ.MapSquare.edges", function() {
            let map = new RectMap({ width: 3, height: 5 });
            let sut = map.squareAtTile(new Tile(0, 0));
            if (!this.assertDefined(sut)) { return; }
            let edge = sut.edge(MapSquare.edges.S);
            if (this.assertDefined(edge)) {
                this.assertEqual(edge.type, TileEdge.H);
                this.assertTrue(edge.isHorizontal);
                this.assertEqual(edge.tile, sut.tile);
                this.assertEqual(edge.toTile, new Tile(0, -1));
                this.assertEqual(edge.square?.tile, sut.tile);
                this.assertEqual(edge.toSquare, null);
                this.assertEqual(edge.unitRect, new Rect(0, -0.5, 1, 1));
            }
            edge = sut.edge(MapSquare.edges.E);
            if (this.assertDefined(edge)) {
                this.assertEqual(edge.type, TileEdge.V);
                this.assertTrue(!edge.isHorizontal);
                this.assertEqual(edge.tile, new Tile(1, 0));
                this.assertEqual(edge.toTile, sut.tile);
                this.assertEqual(edge.square?.tile, new Tile(1, 0));
                this.assertEqual(edge.toSquare?.tile, sut.tile);
                this.assertEqual(edge.unitRect, new Rect(0.5, 0, 1, 1));
            }
            this.assertDefined(sut.edge(MapSquare.edges.N));
            this.assertDefined(sut.edge(MapSquare.edges.W));
            
            sut = map.squareAtTile(new Tile(2, 4));
            if (!this.assertDefined(sut)) { return; }
            edge = sut.edge(MapSquare.edges.N);
            if (this.assertDefined(edge)) {
                this.assertEqual(edge.type, TileEdge.H);
                this.assertEqual(edge.tile, new Tile(2, 5));
                this.assertEqual(edge.toTile, sut.tile);
                this.assertEqual(edge.square, null);
                this.assertEqual(edge.toSquare?.tile, sut.tile);
            }
            edge = sut.edge(MapSquare.edges.W);
            if (this.assertDefined(edge)) {
                this.assertEqual(edge.type, TileEdge.V);
                this.assertEqual(edge.tile, sut.tile);
                this.assertEqual(edge.toTile, new Tile(1, 4));
                this.assertEqual(edge.square?.tile, sut.tile);
                this.assertEqual(edge.toSquare?.tile, new Tile(1, 4));
            }
            
            let result = "";
            map.forEachEdge(edge => {
                result += edge.type == TileEdge.H ? "H" : "V";
                result += `${edge.tile.coord.x}${edge.tile.coord.y}`;
            });
            this.assertTrue(result.startsWith(
                "H00V00H10V10H20V20V30H01V01H11V11H21V21V31"));
            this.assertTrue(result.endsWith("V34H05H15H25"));
        }).buildAndRun();
    }
    
    static worldModelTests() {
        const Tile = CivGame.Tile;
        const Planet = CivGame.Planet;
        const Terrain = CivGame.Terrain;
        new UnitTest("Civ.Planet", function() {
            let sut = new Planet({ size: {width: 6, height: 5} });
            this.assertEqual(sut.map?.size?.width, 6);
            this.assertEqual(sut.map?.size?.height, 5);
            this.assertEqual(sut.rect, new Rect(0, 0, 6, 5));
            let terrain = sut.map.squareAtTile(new Tile(2, 1))?.terrain;
            if (this.assertTrue(terrain instanceof Terrain)) {
                this.assertDefined(terrain.type?.id);
                this.assertTrue(terrain.randomSeed >= 0);
            }
        }).civRun();
        
        const World = CivGame.World;
        new UnitTest("Civ.World", function() {
            let u1 = { unit: "a" };
            let u2 = { unit: "b" };
            let planet = new Planet({ size: { width: 4, height: 3 }});
            let sut = new World({
                planet: planet,
                civs: [new CivGame.Civilization("australia"), new CivGame.Civilization("poland")],
                units: [u1, u2]
            });
            this.assertEqual(sut.civs?.length, 2);
            this.assertEqual(sut.planet, planet);
            this.assertEqual(planet.world, sut);
            if (sut.civs) {
                this.assertEqual(sut.civs[0]?.world, sut);
                this.assertEqual(sut.civs[1]?.world, sut);
                this.assertEqual(sut.civs[0]?.id, "australia");
                this.assertEqual(sut.civs[1]?.id, "poland");
            }
            this.assertEqual(sut.units?.length, 2);
            if (sut.units) {
                this.assertEqual(sut.units[0]?.world, sut);
                this.assertEqual(sut.units[1]?.world, sut);
                this.assertEqual(sut.units[0]?.unit, "a");
                this.assertEqual(sut.units[1]?.unit, "b");
            }
        }).civRun();
    }

static tileProjectionTests() {
    new UnitTest("Civ.TileProjection", function() {
        let sut = new CivGame.TileProjection(1);
        this.assertEqual(sut.factor, 1);
        this.assertEqual(sut.lengthForScreenLength(5), 5);
        this.assertEqual(sut.lengthForScreenLength(0), 0);
        this.assertEqual(sut.lengthForScreenLength(-3.1), -3.1);
        this.assertEqual(sut.coordForScreenPoint(new Point(5, 7)), new Point(5, 7));
        this.assertEqual(sut.coordForScreenPoint(new Point(-3.5, 2.7)), new Point(-3.5, 2.7));
        this.assertEqual(sut.screenPointForCoord(new Point(5, 7)), new Point(5, 7));
        this.assertEqual(sut.screenPointForCoord(new Point(-3.5, 2.7)), new Point(-3, 3));
        this.assertEqual(sut.screenSizeForSize({width: 0, height: 17}).width, 0);
        this.assertEqual(sut.screenSizeForSize({width: 0, height: 17}).height, 17);
        this.assertEqual(sut.screenSizeForSize({width: 1.23, height: 4.99}).width, 1);
        this.assertEqual(sut.screenSizeForSize({width: 1.23, height: 4.99}).height, 5);
        this.assertEqual(sut.screenRectForTile(new CivGame.Tile(-2, 8)), new Rect(-2, 8, 1, 1));
        this.assertEqual(sut.screenRectForRect(
            new Rect(-1, 2.25, 37, 4.23)),
            new Rect(-1, 2,    37, 4));
        
        sut.factor = 32;
        this.assertEqual(sut.lengthForScreenLength(160), 5);
        this.assertEqual(sut.lengthForScreenLength(0), 0);
        this.assertEqual(sut.lengthForScreenLength(-99.2), -3.1);
        this.assertEqual(sut.coordForScreenPoint(new Point(160, 224)), new Point(5, 7));
        this.assertEqual(sut.coordForScreenPoint(new Point(-112, 88)), new Point(-3.5, 2.75));
        this.assertEqual(sut.screenPointForCoord(new Point(5, -7)), new Point(160, -224));
        this.assertEqual(sut.screenPointForCoord(new Point(1.23, 4.99)), new Point(39, 160));
        this.assertEqual(sut.screenSizeForSize({width: 1.23, height: 4.99}).width, 39);
        this.assertEqual(sut.screenSizeForSize({width: 1.23, height: 4.99}).height, 160);
        this.assertEqual(sut.screenRectForTile(new CivGame.Tile(-2, 8)), new Rect(-64, 256, 32, 32));
        this.assertEqual(sut.screenRectForRect(
            new Rect( -1,  2.25,   37,   4.23)),
            new Rect(-32, 72,    1184, 135));
    }).buildAndRun();
}

static worldViewTests() {
    let world = { planet: new CivGame.Planet({size: {width: 15, height: 10}}) };
    let zoomBehaviorConfig = {
        range: { min: 10, defaultValue: 40, max: 50 },
        stepMultiplier: 1.4142135624
    };
    let setInj = function(edgeOverscroll) {
        CivGame.inj().content = {
            worldView: {
                edgeOverscroll: edgeOverscroll,
                zoomBehavior: zoomBehaviorConfig
            }
        };
    };
    
    new UnitTest("Civ.GameWorldViewModel", function() {
        let sut = new CivGameUI.GameWorldViewModel(world, 40);
        let kvoHistory = [];
        sut.kvo.addObserver(this, source => kvoHistory.push({source: source, zoomFactor: source.zoomFactor, viewportCenterCoord: source.viewportCenterCoord}));
        
        this.assertEqual(sut.worldRect, new Rect(0, 0, 15, 10));
        this.assertEqual(sut.zoomFactor, 40);
        this.assertEqual(sut.dirtyRect, new Rect(0, 0, 15, 10));
        this.assertEqual(sut.projection.factor, 40);
        this.assertEqual(sut.worldScreenRect, new Rect(0, 0, 600, 400));
        
        sut.zoomFactor = 28;
        this.assertEqual(sut.worldRect, new Rect(0, 0, 15, 10));
        this.assertEqual(sut.zoomFactor, 28);
        this.assertEqual(sut.worldScreenRect, new Rect(0, 0, 420, 280));
        
        sut.viewportCenterCoord = new Point(3, 7);
        sut.zoomFactor = 8;
        sut.viewportCenterCoord = new Point(3, 7);
        
        sut.dirtyRect = null;
        this.assertEqual(sut.dirtyRect, null);
        sut.addDirtyRect(new Rect(1, 2, 3, 4));
        this.assertEqual(sut.dirtyRect, new Rect(1, 2, 3, 4));
        sut.addDirtyRect(new Rect(2, 1, 4, 2));
        this.assertEqual(sut.dirtyRect, new Rect(1, 1, 5, 5));
        sut.addDirtyRect(new Rect(3, 3, 1, 1));
        this.assertEqual(sut.dirtyRect, new Rect(1, 1, 5, 5));
        sut.addDirtyRect(null);
        this.assertEqual(sut.dirtyRect, new Rect(1, 1, 5, 5));
        sut.dirtyRect = null;
        this.assertEqual(sut.dirtyRect, null);
        sut.addDirtyRect(new Rect(0, 1, 1, 1));
        sut.addDirtyRect(new Rect(-1.5, 0.75, 1, 1));
        this.assertEqual(sut.dirtyRect, new Rect(-1.5, 0.75, 2.5, 1.25));
        
        this.assertEqual(kvoHistory.length, 4, "dirtyRect doesn't trigger root level KVO events");
        this.assertElementsEqual(kvoHistory.map(i => i.zoomFactor), [28, 28, 8, 8]);
        this.assertElementsEqual(kvoHistory.map(i => i.viewportCenterCoord?.x), [7.5, 3, 3, 3]);
        this.assertElementsEqual(kvoHistory.map(i => i.viewportCenterCoord?.y), [5, 7, 7, 7]);
        
        Kvo.stopAllObservations(this);
    }).civRun(() => setInj(10000)); // Disable clamp-to-edge for testing basics
    
    new UnitTest("Civ.ZoomBehavior", function() {
        let sut = new CivGameUI.ZoomBehavior({
            range: { min: 10, defaultValue: 40, max: 50 },
            stepMultiplier: 1.4142135624,
            edgeOverscroll: 1
        });
        let viewModel = {worldRect: new Rect(0, 0, 15, 10)};
        // Extra small for basic testing. Height-fit tests below, with a larger rect
        let viewportScreenRect = new Rect(0, 0, 20, 20);
        let worldView1 = {devicePixelRatio: 1, viewModel: viewModel, viewportScreenRect: viewportScreenRect};
        let worldView2 = {devicePixelRatio: 2, viewModel: viewModel, viewportScreenRect, viewportScreenRect};
        this.assertEqual(sut.defaultZoomFactor(worldView1), 40);
        this.assertEqual(sut.defaultZoomFactor(worldView2), 80);
        
        this.assertEqual(sut.deserializedZoomFactor(worldView1, undefined), 40, "default zoomFactor if camera data missing");
        this.assertEqual(sut.deserializedZoomFactor(worldView2, 27), 54, "gets scaled zoomFactor from camera data");
        this.assertEqual(sut.deserializedZoomFactor(worldView1, 27), 27, "gets scaled zoomFactor from camera data");
        this.assertEqual(sut.serializedZoomFactor(worldView1, 54), 54);
        this.assertEqual(sut.serializedZoomFactor(worldView2, 54), 27);
        
        this.assertEqual(sut.steppingIn(worldView1, 30), 42);
        this.assertEqual(sut.steppingIn(worldView1, 40), 50);
        this.assertEqual(sut.steppingIn(worldView1, 55), 50);
        this.assertEqual(sut.steppingOut(worldView1, 30), 21);
        this.assertEqual(sut.steppingOut(worldView1, 12), 10);
        this.assertEqual(sut.steppingOut(worldView1, 5), 10);
        
        this.assertEqual(sut.steppingIn(worldView2, 30), 42);
        this.assertEqual(sut.steppingIn(worldView2, 40), 57);
        this.assertEqual(sut.steppingIn(worldView2, 80), 100);
        this.assertEqual(sut.steppingIn(worldView2, 120), 100);
        this.assertEqual(sut.steppingOut(worldView2, 30), 21);
        this.assertEqual(sut.steppingOut(worldView2, 24), 20);
        this.assertEqual(sut.steppingOut(worldView2, 5), 20);
        
        logTestMsg("Test height fitting...");
        this.assertEqual(sut.heightFittingZoomFactor(worldView1), 2, "tiny viewport@1x");
        this.assertEqual(sut.heightFittingZoomFactor(worldView2), 2, "tiny viewport@2x");
        this.assertEqual(sut.validatedZoomFactor(worldView1, 1), 10);
        this.assertEqual(sut.validatedZoomFactor(worldView2, 1), 20);
        this.assertEqual(sut.validatedZoomFactor(worldView1, 15), 15);
        this.assertEqual(sut.validatedZoomFactor(worldView1, 37.2), 37);
        this.assertEqual(sut.validatedZoomFactor(worldView1, 55), 50);
        
        viewportScreenRect.height = 180;
        this.assertEqual(sut.heightFittingZoomFactor(worldView1), 15, "180=15*(1+10+1)");
        this.assertEqual(sut.heightFittingZoomFactor(worldView2), 15, "180=15*(1+10+1)");
        this.assertEqual(sut.defaultZoomFactor(worldView1), 40, "default ok for h180@1x");
        this.assertEqual(sut.defaultZoomFactor(worldView2), 80, "default ok for h180@2x");
        this.assertEqual(sut.steppingOut(worldView1, 18), 15, "limit stepping out for h180@1x");
        this.assertEqual(sut.steppingOut(worldView2, 18), 20, "default min for h180@2x");
        this.assertEqual(sut.validatedZoomFactor(worldView1, 1), 15);
        this.assertEqual(sut.validatedZoomFactor(worldView2, 1), 20);
        this.assertEqual(sut.validatedZoomFactor(worldView1, 25), 25);
        this.assertEqual(sut.validatedZoomFactor(worldView1, 37.2), 37);
        this.assertEqual(sut.validatedZoomFactor(worldView1, 55), 50);
        
        viewportScreenRect.height = 542;
        this.assertEqual(sut.heightFittingZoomFactor(worldView1), 45, "540=45*(1+10+1)");
        this.assertEqual(sut.heightFittingZoomFactor(worldView2), 45, "540=45*(1+10+1)");
        this.assertEqual(sut.defaultZoomFactor(worldView1), 45, "default too small for h540@1x");
        this.assertEqual(sut.defaultZoomFactor(worldView2), 80, "default ok for h540@2x");
        this.assertEqual(sut.steppingOut(worldView1, 50), 45, "limit stepping out for h540@1x");
        this.assertEqual(sut.steppingOut(worldView2, 50), 45, "stepping out ok for h180@2x");
        
        viewportScreenRect.height = 1078;
        this.assertEqual(sut.defaultZoomFactor(worldView2), 90, "default too small for h1080@2x");
        this.assertEqual(sut.steppingOut(worldView2, 100), 90, "limit stepping for h180@2x");
    }).civRun(() => setInj(10000)); // Disable clamp-to-edge for testing basics
    
    new UnitTest("Civ.PanBehavior", function() {
        let sut = new CivGameUI.PanBehavior({
            smallPanPoints: 50,
            largePanScreenFraction: 0.4
        });
        let worldView = {
            devicePixelRatio: 2,
            viewportScreenRect: new Rect(-10, 20, 800, 400)
        };
        this.assertEqual(sut.smallPanScreenPoints(worldView, directions.N), 100);
        this.assertEqual(sut.smallPanScreenPoints(worldView, directions.E), 100);
        this.assertEqual(sut.largePanScreenPoints(worldView, directions.S), 160);
        this.assertEqual(sut.largePanScreenPoints(worldView, directions.W), 320);
        this.assertEqual(sut.largePanScreenPoints(worldView, directions.NE), 160);
    }).civRun(() => setInj(10000)); // Disable clamp-to-edge for testing basics
    
    new UnitTest("Civ.WorldViewport", function() {
        let viewModel = new CivGameUI.GameWorldViewModel(world, 40, new Point(6, 4));
        let canvas = document.createElement("canvas");
        
        canvas.width = 640;
        canvas.height = 298;
        let sut = new CivGameUI.WorldViewport({
            model: viewModel, canvas: canvas, devicePixelRatio: 1
        });
        this.assertEqual(sut.centerCoord, new Point(6, 4), "respects initial viewModel centerCoord");
        this.assertEqual(sut.model.viewportCenterCoord, new Point(6, 4));
        
        sut.centerCoord = new Point(7.5, 5);
        this.assertEqual(sut.centerCoord, new Point(7.5, 5));
        this.assertEqual(sut.model.viewportCenterCoord, new Point(7.5, 5));
        
        // 600x400 world
        this.assertEqual(sut.model.zoomFactor, 40, "respects initial viewModel zoom");
        this.assertEqual(sut.zoomFactor, 40);
        // canvas is wider/shorter than the world
        this.assertEqual(sut.viewportScreenRect, new Rect(-20, 51, canvas.width, canvas.height));
        this.assertEqual(sut.coordForCanvasPoint(new Point(320, 149)), new Point(7.5, 5.0));
        this.assertEqual(sut.coordForCanvasPoint(new Point(0, 0)), new Point(-0.5, 1.275));
        
        canvas.width = 400;
        canvas.height = 400;
        this.assertEqual(sut.centerCoord, new Point(7.5, 5), "retains center after canvas change");
        this.assertEqual(sut.model.viewportCenterCoord, new Point(7.5, 5));
        this.assertEqual(sut.viewportScreenRect, new Rect(100, 0, canvas.width, canvas.height));
        
        sut.zoomFactor = 10;
        this.assertEqual(sut.model.zoomFactor, 10); //150x100 world
        this.assertEqual(sut.zoomFactor, 10);
        this.assertEqual(sut.centerCoord, new Point(7.5, 5), "retains center after jumping");
        this.assertEqual(sut.model.viewportCenterCoord, new Point(7.5, 5));
        this.assertEqual(sut.viewportScreenRect, new Rect(-125, -150, canvas.width, canvas.height));
        
        sut.centerCoord = new Point(-1.5, 2);
        this.assertEqual(sut.zoomFactor, 10, "retains zoom after jumping");
        this.assertEqual(sut.centerCoord, new Point(-1.5, 2));
        this.assertEqual(sut.model.viewportCenterCoord, new Point(-1.5, 2));
        this.assertEqual(sut.viewportScreenRect, new Rect(-215, -180, canvas.width, canvas.height));
        
        logTestMsg("With overscroll=1...")
        sut.zoomFactor = 40;
        // Viewport 10x7.5 tiles. With over=1, valid rect is:
        // x:4...11, y:2.75....7.25
        canvas.width = 400; canvas.height = 300;
        CivGame.inj().content.worldView.edgeOverscroll = 1;
        
        sut = new CivGameUI.WorldViewport({
            model: viewModel, canvas: canvas, devicePixelRatio: 1
        });
        sut.centerCoord = new Point(6, 4);
        this.assertEqualTol(sut.centerCoord, new Point(6, 4), 0.01, "med canvas, overscroll, middle coord ok");
        sut.centerCoord = new Point(0, 0);
        this.assertEqualTol(sut.centerCoord, new Point(4, 2.75), 0.01, "med canvas, overscroll, 0,0 -> inward");
        sut.centerCoord = new Point(15, 10);
        this.assertEqualTol(sut.centerCoord, new Point(11, 7.25), 0.01, "med canvas, overscroll, max -> inward");
        this.assertEqualTol(sut.model.viewportCenterCoord, new Point(11, 7.25), 0.01);
        
        canvas.width = 2000; canvas.height = 1000;
        sut.centerCoord = sut.centerCoord;
        this.assertEqualTol(sut.centerCoord, new Point(7.5, 5), 0.01, "huge canvas, force to center");
        
        canvas.width = 10; canvas.height = 10;
        sut.centerCoord = new Point(1, 1);
        this.assertEqual(sut.zoomFactor, 40);
        this.assertEqualTol(sut.centerCoord, new Point(1, 1), 0.01, "reset to tiny canvas");
        canvas.width = 450; canvas.height = 180;
        sut.zoomFactor = 30; // 450x300
        this.assertEqual(sut.model.zoomFactor, 30);
        this.assertEqualTol(sut.centerCoord, new Point(6.5, 2), 0.01, "center reset after zooming out");
    }).civRun(() => setInj(10000)); // Disable clamp-to-edge for testing basics
    
    new UnitTest("Civ.EdgeOverscroll", function() {
        const p = new CivGame.Planet({size: {width: 15, height: 10}});
        const VM = class {
            constructor(p) { this.p = p; }
            get worldRect() { return this.p.rect; }
        };
        const vm = new VM(p);
        let sut = CivGameUI.EdgeOverscroll;
        let c = { width: 0.2, height: 0.1 }; // canvasTileSize
        let o = 0; // overscroll
        this.assertEqualTol(sut.clampedCoord(new Point(6, 4), vm, c, o), new Point(6, 4), 0.01, "tiny canvas, middle ok");
        this.assertEqualTol(sut.clampedCoord(new Point(0, 0), vm, c, o), new Point(0.1, 0.05), 0.01, "tiny canvas, 0,0 -> shift by half canvas size");
        this.assertEqualTol(sut.clampedCoord(new Point(15, 10), vm, c, o), new Point(14.9, 9.95), 0.01, "tiny canvas, corner -> shift back");
        
        // clamp y to center. x has 7 tiles of play
        c = { width: 8, height: 20 };
        this.assertEqualTol(sut.clampedCoord(new Point(9, 4), vm, c, o), new Point(9, 5), 0.01, "tall canvas, middle-x ok, y clamped");
        this.assertEqualTol(sut.clampedCoord(new Point(-2, 14), vm, c, o), new Point(4, 5), 0.01, "tall canvas, off-world, clamp");
        
        // clamp x to center. y has 8 tiles of play.
        c = { width: 17, height: 2};
        this.assertEqualTol(sut.clampedCoord(new Point(9, 3), vm, c, o), new Point(7.5, 3), 0.01, "wide canvas, middle-y ok, x clamped");
        this.assertEqualTol(sut.clampedCoord(new Point(-2, 14), vm, c, o), new Point(7.5, 9), 0.01, "wide canvas, off-world, clamp");
        
        c = { width: 73.06, height: 492.18};
        this.assertEqualTol(sut.clampedCoord(new Point(9, 3), vm, c, o), new Point(7.5, 5), 0.01, "huge canvas, clamp all to middle");
        this.assertEqualTol(sut.clampedCoord(new Point(9, 3), vm, c, o), new Point(7.5, 5), 0.01, "huge canvas, clamp all to middle");
        this.assertEqualTol(sut.clampedCoord(new Point(0, 0), vm, c, o), new Point(7.5, 5), 0.01, "huge canvas, clamp all to middle");
        this.assertEqualTol(sut.clampedCoord(new Point(-5, 15), vm, c, o), new Point(7.5, 5), 0.01, "huge canvas, off-map ok");
        
        o = 2.5;
        c = { width: 0.2, height: 0.1 };
        this.assertEqualTol(sut.clampedCoord(new Point(6, 4), vm, c, o), new Point(6, 4), 0.01, "tiny canvas, middle ok");
        this.assertEqualTol(sut.clampedCoord(new Point(-1.5, 11), vm, c, o), new Point(-1.5, 11), 0.01, "tiny canvas, inside overscroll ok");
        this.assertEqualTol(sut.clampedCoord(new Point(-3.5, 14.5), vm, c, o), new Point(-2.4, 12.45), 0.01, "tiny canvas, shift to overscrolled edge");
        
        c = { width: 18, height: 10 };
        // logTestMsg(sut._validCoordRect(vm, c, o).debugDescription);
        this.assertEqualTol(sut.clampedCoord(new Point(8, 4), vm, c, o), new Point(8, 4), 0.01, "similar canvas, middle ok");
        this.assertEqualTol(sut.clampedCoord(new Point(0, 0), vm, c, o), new Point(6.5, 2.5), 0.01, "tiny canvas, 0,0 shifted by half canvas size minus overscroll");
    }).buildAndRun();
}

static drawableTests() {
    const Drawable = CivDrawables.Drawable;
    new UnitTest("Civ.Drawable", function() {
        let layer = {};
        // CanvasRenderContext stub
        let sr1 = new Rect(0, 0, 100, 100);
        let srIntersects1 = new Rect(50, 50, 100, 100);
        let srNoIntersect1 = new Rect(200, 200, 50, 50);
        let c = { dirtyScreenRect: sr1 };
        let sut = new Drawable();
        this.assertTrue(!sut.rect, "rect not set by default");
        this.assertFalse(sut.shouldDraw(c), "won't draw by default if there's no rect to compare to dirty rect");
        sut.rect = srIntersects1;
        this.assertTrue(sut.shouldDraw(c), "shouldDraw uses rect by default");
        sut.rect = srNoIntersect1;
        this.assertFalse(sut.shouldDraw(c), "shouldDraw false if rect doesn't intersect");
        
        this.assertTrue(false, "set sut.rect updates dirtyRect in Layer");
    }).buildAndRun();
}

static savegameTests() {
    new UnitTest("Civ.Game.savegame", function() {
        let newGameModel = CivSystemUI._unitTestSymbols.NewGameDialog.defaultModelValue();
        let newGame = CivGame.Game.createNewGame(newGameModel);
        newGame.ui.camera = {zoomFactor: 37, centerCoord: {x: 3, y: 7}};
        this.assertDefined(newGame.world);
        this.assertDefined(newGame.world?.planet?.map);
        let terrain = newGame.world?.planet?.map?.squareAtTile(new CivGame.Tile(1, 3))?.terrain;
        this.assertDefined(terrain);
        this.assertTrue(terrain?.type?.index >= 0);
        this.assertTrue(terrain?.randomSeed >= 0);
        this.assertTrue(newGame.world?.civs?.length >= 0);
        this.assertDefined(newGame.players[0]?.name);
        this.assertDefined(newGame.players[0]?.civ);
        let sz = newGame.serializedSavegameData;
        let fromSz = CivGame.Game.fromSerializedSavegame(sz);
        this.assertEqual(fromSz?.ui?.camera?.zoomFactor, 37);
        this.assertEqual(fromSz?.ui?.camera?.centerCoord?.x, 3);
        this.assertEqual(fromSz?.ui?.camera?.centerCoord?.y, 7);
        let sz2 = fromSz?.serializedSavegameData;
        let szs = JSON.stringify(sz);
        let szs2 = JSON.stringify(sz2);
        this.assertEqual(szs, szs2);
    }).civRun();
}

static systemUItests() {
    new UnitTest("Civ.UI.traverseSubviews", function() {
        const UI = CivSystemUI.UI;
        let StubView = class {
            constructor(name) { this.name = name; this.visitCount = 0; }
            visit() { this.visitCount += 1; }
        };
        
        let root = new StubView("root");
        let mid = new StubView("mid");
        let leafEmptyViews = new StubView("leafEmptyViews");
        let leafNullViews = new StubView("leafNullViews");
        let leafBogusViews = new StubView("leafBogusViews");
        root.views = [
            mid,
            null,
            "test",
            leafEmptyViews
        ];
        mid.views = [
            leafNullViews,
            leafBogusViews
        ];
        leafNullViews.views = null;
        leafEmptyViews.views = [];
        leafBogusViews.views = 3;
        
        let nodeTraversalCount = 0;
        let visitedNull = false;
        let visitedString = false;
        UI.traverseSubviews(root, view => {
            nodeTraversalCount += 1;
            if (view === null) { visitedNull = true; }
            if (view == "test") { visitedString = true; }
            if (!!view && view.visit) { view.visit(); }
        });
        
        this.assertEqual(nodeTraversalCount, 6, "nodeTraversalCount");
        this.assertEqual(root.visitCount, 0, "root");
        this.assertTrue(visitedNull, "visited null");
        this.assertTrue(visitedString, "visited string");
        this.assertEqual(mid.visitCount, 1, "mid");
        this.assertEqual(leafEmptyViews.visitCount, 1, "leafEmptyViews");
        this.assertEqual(leafNullViews.visitCount, 1, "leafNullViews");
        this.assertEqual(leafBogusViews.visitCount, 1, "leafBogusViews");
    }).buildAndRun();
}

} // end class civved

swept.initialized = false;
async function initSweep() {
    if (swept.initialized) { console.log({ already: Sweep.Game.rules() }); return; }
    swept.initialized = true;
    await Sweep.initialize();
    // TODO change the backing store for GameStorage from window.localStorage to some stub
}

let standardSuite = new TestSession([
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
]);

let taskSuite = new TestSession([
    swept.autosaveTests,
    // swept.convolutionTests,
    swept.gameSessionTimerTests
]);

let taskSuite2 = new TestSession([
    // civved.baseGeometryTests,
    // civved.mapTests,
    civved.worldModelTests,
    // civved.tileProjectionTests,
    civved.worldViewTests,
    civved.drawableTests,
    // civved.savegameTests,
    // civved.systemUItests
]);

let taskSuiteL10N = new TestSession([
    missingStringsTests
]);

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

TestSession.current = taskSuiteL10N;
// TestSession.current = taskSuite;
// TestSession.current = standardSuite;

export async function uiReady() {
    console.log("uiReady");
    // await initCivved();
    TestSession.current.run(document.querySelector("#testOutput"));
}
