"use-strict";

import { Strings } from './locale.js';
import {
    Binding, BoolArray,
    CanvasStack, ChangeTokenBinding, CircularArray,
    Dispatch, DispatchTarget,
    FlexCanvasGrid,
    GameTask,
    Kvo,
    PeriodicRandomComponent, Point,
    RandomComponent, RandomBlobGenerator, RandomLineGenerator, Rect, Rng,
    SaveStateItem, SelectableList, SaveStateCollection,
    TaskQueue, TilePlane,
    UndoStack,
    Vector
} from './g.js';

import * as Sweep from './sweep.js';

// import * as City from './city.js';

function appendOutputItem(msg, className) {
    if (!TestSession.outputElement) { return; }
    var elem = document.createElement("li");
    elem.innerText = msg;
    elem.addRemClass(className, true);
    TestSession.outputElement.append(elem);
}

function logTestMsg(msg) {
    console.log(msg);
    appendOutputItem(msg, "log");
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
    run(outputElement) {
        TestSession.outputElement = outputElement;
        this.testFuncs.forEach(function (t) {
            t();
        });
        this.summarize();
    }
    summarize() {
        logTestHeader("Test Summary " + new Date().toLocaleString());
        logTestMsg(`Tests run: ${this.testsPassed + this.testsFailed}`);
        if (this.testsFailed > 0) {
            logTestFail(`Tests failed: ${this.testsFailed}`);
        } else {
            logTestMsg("All tests passed.");
        }
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
        try {
            return block();
        } catch(e) {
            this.logFailure(this._assertMessage(`assertNoThrow failure ${e}`, msg));
            return undefined;
        }
    }
    assertThrows(block, msg) {
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
};

var boolArrayTest = function() {
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
    }).buildAndRun();
}

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
        var metadata = { foo: "iamfoo", bar: 123 };
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
            two: { mineCount: 2, formattedMineCount: "2.0" }
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
    }).build()(null, null);
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
        var sut = new SaveStateCollection(window.sessionStorage, "_unitTests_");
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

        // this.assertEqual(sut.duplicateItem("bogus"), null);
        // gotItem = sut.duplicateItem(item2.id);
        // if (this.assertTrue(!!gotItem)) {
        //     this.assertTrue(gotItem.id != item2.id);
        //     this.assertEqual(gotItem.title, item2.title);
        // }
        // this.assertEqual(sut.itemsSortedByLastSaveTime.length, 3);
        // console.table(sut.itemsSortedByLastSaveTime);

        this.assertTrue(sut.deleteItem(item1.id));
        this.assertEqual(sut.getItem(item1.id), null);
        this.assertEqual(sut.itemsSortedByLastSaveTime.length, 1);
        this.assertTrue(sut.getItem(item2.id) != null);
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

let swept = {};

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

let standardSuite = new TestSession([
    // rectHashTest,
    manhattanDistanceFromTest,
    hexStringTest,
    boolArrayTest,
    changeTokenBindingTest,
    circularArrayTest,
    randomTest,
    randomBlobTest,
    randomLineTest,
    rectTest,
    stringsTest,
    selectableListTest,
    saveStateTest,
    dispatchTest,
    kvoTest,
    bindingTest,
    tilePlaneTest,
    flexCanvasGridTest1,
    flexCanvasGridTest2,
    flexCanvasGridTest3,
    cityRectExtensionsTest,
    swept.gameTileTests,
    swept.sharingTests
    // simDateTest
]);

let taskSuite = new TestSession([
    swept.gameTileTests,
    swept.sharingTests
    ]);

swept.initialized = false;
async function initSweep() {
    if (swept.initialized) { return; }
    swept.initialized = true;
    await Sweep.initialize();
}

TestSession.current = standardSuite;
