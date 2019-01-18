"use-strict";

window.UnitTests = (function(outputElement) {

var Binding = Gaming.Binding;
var BoolArray = Gaming.BoolArray;
var CircularArray = Gaming.CircularArray;
var Dispatch = Gaming.Dispatch;
var DispatchTarget = Gaming.DispatchTarget;
var FlexCanvasGrid = Gaming.FlexCanvasGrid;
var Kvo = Gaming.Kvo;
var Point = Gaming.Point;
var RandomLineGenerator = Gaming.RandomLineGenerator;
var Rect = Gaming.Rect;
var Rng = Gaming.Rng;
var SaveStateItem = Gaming.SaveStateItem;
var UndoStack = Gaming.UndoStack;
var GameMap = CitySim.GameMap;
var SimDate = CitySim.SimDate;

function appendOutputItem(msg, className) {
    if (!outputElement) { return; }
    var elem = document.createElement("li");
    elem.innerText = msg;
    elem.addRemClass(className, true);
    outputElement.append(elem);
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

class TestSession {
    constructor(testFuncs) {
        this.testFuncs = testFuncs;
        this.testsPassed = 0;
        this.testsFailed = 0;
    }
    run() {
        this.testFuncs.forEach(function (t) {
            t();
        });
        this.summarize();
    }
    summarize() {
        logTestHeader("Test Summary");
        logTestMsg(`Tests run: ${this.testsPassed + this.testsFailed}`);
        if (this.testsFailed > 0) {
            logTestFail(`Tests failed: ${this.testsFailed}`);
        } else {
            logTestMsg("All tests passed.");
        }
    }
}

class UnitTest {
    constructor(name, body) {
        this.name = name;
        this.body = body;
        this.expectations = 0;
        this.failures = 0;
    }

    get isOK() { return this.failures == 0; }
    get hadExpectations() { return this.expectations > 0; }

    build() {
        return function(config, expect) {
            logTestHeader(this.name);
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
            logTestHeader(`END ${this.name}`);
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
    assertEqual(a, b, msg) {
        this.expectations += 1;
        if (a != b) {
            this.logFailure(this._assertMessage(`assertEqual failure: ${a} != ${b}`, msg));
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
    _assertMessage(main, supplement) {
        var messages = [main];
        if (supplement) { messages.push(supplement); }
        return messages.join(" — ");
    }
}

class Sparkline {
    constructor(config) {
        this.elem = document.createElement("ol").addRemClass("sparkline", true);
        this.style = config.style; // bar, point
        this.min = config.min;
        this.max = config.max;
        this.count = 0;
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
}

var randomLineTest = function() {
    new UnitTest("RandomLineGenerator", function() {
        var styles = ["walk", "reach"];
        styles.forEach(style => {
            var variances = [0.05, 0.5, 1];
            variances.forEach(variance => {
                var config = { min: 5, max: 9, variance: variance, style: style };
                var sut = new RandomLineGenerator(config);
                console.log(sut.debugDescription);
                var values = [];
                for (var i = 0; i < 100; i += 1) {
                    var value = sut.nextValue();
                    if (i == 75 && style == "walk" && variance < 0.5) {
                        sut.variance = 0.5;
                    }
                    if (value < config.min || value > config.max) { this.assertTrue(false); }
                    values.push(value);
                }
                // logTestMsg(values.join(", "));
                var sparkline = new Sparkline({ min: 0, max: 10, width: 200, height: 50 });
                sparkline.append(values);
                document.body.append(sparkline.elem);
            });
        });

        sut = new RandomLineGenerator({ min: 10, max: 20, variance: 0, style: "walk" });
        var values = [];
        for (var i = 0; i < 100; i += 1) {
            sut.variance = i / 200.0;
            values.push(sut.nextValue());
        }
        var sparkline = new Sparkline({ min: 0, max: 20, width: 200, height: 50 });
        sparkline.append(values);
        document.body.append(sparkline.elem);
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
        result = x1y1.manhattanDistanceFrom(x0y0);
        this.assertEqual(result.dx, 1);
        this.assertEqual(result.dy, 1);
        this.assertEqual(result.magnitude, 1);
        result = x0y0.manhattanDistanceFrom(x1y1);
        this.assertEqual(result.dx, -1);
        this.assertEqual(result.dy, -1);
        this.assertEqual(result.magnitude, 1);
        result = xn1y7.manhattanDistanceFrom(x7y5);
        this.assertEqual(result.dx, -8);
        this.assertEqual(result.dy, 2);
        this.assertEqual(result.magnitude, 8);
        result = xn1y7.manhattanDistanceFrom(7, 5);
        this.assertEqual(result.dx, -8);
        this.assertEqual(result.dy, 2);
        this.assertEqual(result.magnitude, 8);
    }).buildAndRun();
}

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
}

var circularArrayTest = function() {
    new UnitTest("CircularArray", function() {
        var sut = new CircularArray(5);
        this.assertEqual(sut.maxLength, 5);
        this.assertTrue(sut.isEmpty)
        this.assertEqual(sut.size, 0);
        this.assertEqual(sut.first, null);
        this.assertEqual(sut.last, null);

        sut.push("A");
        this.assertEqual(sut.maxLength, 5);
        this.assertFalse(sut.isEmpty);
        this.assertEqual(sut.size, 1);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "A");

        sut.push("B");
        this.assertFalse(sut.isEmpty);
        this.assertEqual(sut.size, 2);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "B");

        sut.push("C");
        sut.push("D");
        this.assertFalse(sut.isEmpty);
        this.assertEqual(sut.size, 4);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "D");

        sut.push("E");
        this.assertEqual(sut.size, 5);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "E");

        sut.push("F");
        this.assertEqual(sut.size, 5);
        this.assertEqual(sut.first, "B");
        this.assertEqual(sut.last, "F");

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

var stringTemplateTest = function() {
    new UnitTest("StringFromTemplate", function() {
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
        var sut = new Gaming.SelectableList(items);
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
            var d = new SimDate(i);
            // logTestMsg(d.longString());
            var ymd = new SimDate(d.year, d.month, d.day);
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
        var sut = new Gaming.SaveStateCollection(window.sessionStorage, "_unitTests_");
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
                this.kvoHistory.push({ source: source, via: "top" });
            });
        }
        if (child) {
            this.employee.kvo.salary.addObserver(this, (source) => {
                this.salaryHistory.push(source.salary);
                this.kvoHistory.push({ source: source, via: "salary" });
            });
            this.employee.kvo.name.addObserver(this, (source) => {
                this.kvoHistory.push({ source: source, via: "name" });
            });
        }
    }
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
        };
        person1.setName("B");
        if (this.assertEqual(house1.kvoHistory.length, 2)) {
            this.assertEqual(house1.kvoHistory[1].source, person1);
            this.assertEqual(house1.kvoHistory[1].via, "top");
        };
        person1.doStuff();
        if (this.assertEqual(house1.kvoHistory.length, 3)) {
            this.assertEqual(house1.kvoHistory[2].source, person1);
            this.assertEqual(house1.kvoHistory[2].via, "top");
        };
        Kvo.stopObservations(house1);
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
        }
        person1.setName("C");
        this.assertEqual(house1.salaryHistory.length, 2);
        if (this.assertEqual(house1.kvoHistory.length, 2)) {
            this.assertEqual(house1.kvoHistory[1].source, person1);
            this.assertEqual(house1.kvoHistory[1].via, "name");
        }
        Kvo.stopObservations(house1);
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
            this.assertEqual(house1.kvoHistory[1].source, person1);
            this.assertEqual(house1.kvoHistory[1].via, "top");
        }
        person1.doStuff();
        this.assertEqual(house1.salaryHistory.length, 2);
        if (this.assertEqual(house1.kvoHistory.length, 3)) {
            this.assertEqual(house1.kvoHistory[2].source, person1);
            this.assertEqual(house1.kvoHistory[2].via, "top");
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
        var coords = rect1.allTileCoordinates();
        this.assertEqual(coords.length, 28);

        var rect2 = new Rect(24, 31, 3, 2);
        coords = rect2.allTileCoordinates();
        this.assertElementsEqual(coords.map((p) => p.y), [31, 31, 31, 32, 32, 32]);
        this.assertElementsEqual(coords.map((p) => p.x), [24, 25, 26, 24, 25, 26]);

        var rect1x1 = new Rect(5, 2, 1, 1);
        this.assertTrue(rect1x1.containsTile(5, 2));
        this.assertFalse(rect1x1.containsTile(4, 2));
        this.assertFalse(rect1x1.containsTile(5, 3));
        coords = rect1x1.allTileCoordinates();
        this.assertEqual(coords.length, 1);
        this.assertEqual(coords[0].x, 5);
        this.assertEqual(coords[0].y, 2);

        var rectEmpty = new Rect(3, 2, 0, 0);
        coords = rectEmpty.allTileCoordinates();
        this.assertFalse(rectEmpty.containsTile(3, 2));
        this.assertEqual(coords.length, 0);
    }).buildAndRun();
}

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

TestSession.current = new TestSession([
    // rectHashTest,
    manhattanDistanceFromTest,
    boolArrayTest,
    circularArrayTest,
    randomLineTest,
    randomTest,
    stringTemplateTest,
    selectableListTest,
    saveStateTest,
    dispatchTest,
    kvoTest,
    bindingTest,
    flexCanvasGridTest1,
    flexCanvasGridTest2,
    flexCanvasGridTest3,
    cityRectExtensionsTest,
    simDateTest,
    gameMapTest
]);

return TestSession.current;

})(document.querySelector("#testOutput"));

UnitTests.run();
