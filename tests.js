"use-strict";

window.UnitTests = (function(outputElement) {

var Point = Gaming.Point;
var Rect = Gaming.Rect;
var FlexCanvasGrid = Gaming.FlexCanvasGrid;
var SimDate = CitySim.SimDate;
var Dispatch = Gaming.Dispatch;
var DispatchTarget = Gaming.DispatchTarget;
var Kvo = Gaming.Kvo;

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
            this.body(config, expect);
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
    _assertMessage(main, supplement) {
        var messages = [main];
        if (supplement) { messages.push(supplement); }
        return messages.join(" — ");
    }
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
    }).build()();
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
        this.assertTrue(!items[1].isSelected);
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
    }).build()();
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
    }).build()();
}

function kvoTest() {
    class Employee {
        constructor(employer, title, name) {
            this.employer = employer;
            this._title = title;
            this.name = name;
            this.kvo = new Kvo(Employee, this);
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
    }).build()();

    new UnitTest("Kvo-TopLevel", function() {
        var business1 = new Business({ bagger: 10, manager: 100 });
        var person1 = new Employee(business1, "bagger", "A");
        var house1 = new EmployeeWatcher(person1, true, false);
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
    }).build()();

    new UnitTest("Kvo-Property", function() {
        var business1 = new Business({ bagger: 10, manager: 100 });
        var person1 = new Employee(business1, "bagger", "A");
        var person2 = new Employee(business1, "manager", "B");
        var house1 = new EmployeeWatcher(person1, false, true);
        person1.setTitle("manager");
        person2.setTitle("bagger");
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
    }).build()();

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
    }).build()();
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
        var pfx = `tileForCanvasPoint ${i} ${expect.points[i].p.debugDescription()}: `;
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
            var h = new Rect(x, y, 1, 1).hashValue();
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

TestSession.current = new TestSession([
    // rectHashTest,
    selectableListTest,
    manhattanDistanceFromTest,
    randomTest,
    stringTemplateTest,
    simDateTest,
    dispatchTest,
    kvoTest,
    flexCanvasGridTest1,
    flexCanvasGridTest2,
    flexCanvasGridTest3
]);

return TestSession.current;

})(document.querySelector("#testOutput"));

UnitTests.run();
