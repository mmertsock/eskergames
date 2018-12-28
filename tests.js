"use-strict";

window.UnitTests = (function(outputElement) {

var Point = Gaming.Point;
var Rect = Gaming.Rect;
var CircularArray = Gaming.CircularArray;
var FlexCanvasGrid = Gaming.FlexCanvasGrid;
var Dispatch = Gaming.Dispatch;
var DispatchTarget = Gaming.DispatchTarget;
var Kvo = Gaming.Kvo;
var Binding = Gaming.Binding;
var SimDate = CitySim.SimDate;
var GameMap = CitySim.GameMap;

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
        this.assertTrue(!sut.isEmpty);
        this.assertEqual(sut.size, 1);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "A");

        sut.push("B");
        this.assertTrue(!sut.isEmpty);
        this.assertEqual(sut.size, 2);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "B");

        sut.push("C");
        sut.push("D");
        this.assertTrue(!sut.isEmpty);
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
        this.assertTrue(!sut.isEmpty);
        this.assertEqual(sut.size, 1);
        this.assertEqual(sut.first, "A");
        this.assertEqual(sut.last, "A");
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
    }).build()();

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
    }).build()();

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

// person1 is raw, person2 has sourceSormatter, and also have a global thing.
class TargetView {
    constructor(person1, person2) {
        this.person1general = "";
        this.person1name = "";
        this.person2name = "";
        this.kvo = new Kvo(TargetView, this);
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

function cityRectExtensionsTest() {
    new UnitTest("RectExtensions-City", function() {
        var rect1 = new Rect(17, 9, 4, 7);
        [new Point(17, 9), new Point(19, 11), new Point(20, 9), new Point(17, 15), new Point(20, 15)].forEach((p) => {
            this.assertTrue(rect1.containsTile(p), p.debugDescription());
            this.assertTrue(rect1.containsTile(p.x, p.y), p.debugDescription() + " decomposed");
        });
        [new Point(16, 9), new Point(17, 8), new Point(21, 9), new Point(17, 16)].forEach((p) => {
            this.assertTrue(!rect1.containsTile(p), p.debugDescription());
            this.assertTrue(!rect1.containsTile(p.x, p.y), p.debugDescription() + " decomposed");
        });
        var coords = rect1.allTileCoordinates();
        this.assertEqual(coords.length, 28);

        var rect2 = new Rect(24, 31, 3, 2);
        coords = rect2.allTileCoordinates();
        this.assertElementsEqual(coords.map((p) => p.y), [31, 31, 31, 32, 32, 32]);
        this.assertElementsEqual(coords.map((p) => p.x), [24, 25, 26, 24, 25, 26]);

        var rect1x1 = new Rect(5, 2, 1, 1);
        this.assertTrue(rect1x1.containsTile(5, 2));
        this.assertTrue(!rect1x1.containsTile(4, 2));
        this.assertTrue(!rect1x1.containsTile(5, 3));
        coords = rect1x1.allTileCoordinates();
        this.assertEqual(coords.length, 1);
        this.assertEqual(coords[0].x, 5);
        this.assertEqual(coords[0].y, 2);

        var rectEmpty = new Rect(3, 2, 0, 0);
        coords = rectEmpty.allTileCoordinates();
        this.assertTrue(!rectEmpty.containsTile(3, 2));
        this.assertEqual(coords.length, 0);
    }).build()();
}

function gameMapTest() {
    new UnitTest("GameMap",function() {
        var terrain = { bounds: new Rect(0, 0, 10, 6), size: { width: 10, height: 6} };
        var sut = new GameMap({ terrain: terrain });
        [new Point(0, 0), new Point(3, 3), new Point(0, 5), new Point(9, 0), new Point(9, 5)].forEach((p) => {
            this.assertTrue(sut.isValidCoordinate(p), p.debugDescription());
            this.assertTrue(sut.isValidCoordinate(p.x, p.y), p.debugDescription());
        });
        [new Point(-1, 0), new Point(0, -1), new Point(-1, -1), new Point(0, 6), new Point(10, 0), new Point(10, 6), new Point(15, 15)].forEach((p) => {
            this.assertTrue(!sut.isValidCoordinate(p), p.debugDescription());
            this.assertTrue(!sut.isValidCoordinate(p.x, p.y), p.debugDescription());
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
        sut = new GameMap({ terrain: terrain });

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

    }).build()();
}

TestSession.current = new TestSession([
    // rectHashTest,
    manhattanDistanceFromTest,
    circularArrayTest,
    randomTest,
    stringTemplateTest,
    selectableListTest,
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
