"use-strict";

function debugLog(msg) {
    console.log(msg);
}

var onceTokens = new Set();
function once(id, block) {
    if (onceTokens.has(id)) { return; }
    debugLog("ONCE: " + id);
    block();
    onceTokens.add(id);
}

String.isEmpty = function(value) {
    return !value || value.length == 0;
};

Math.clamp = function(value, range) {
    return Math.min(Math.max(value, range.min), range.max);
};

// inRange and outRange are {min, max}. Transforms value from input to output range, e.g.
// scaleValueLinear(30, 0...100, 2...12) -> 5
Math.scaleValueLinear = function(value, inRange, outRange) {
    var factor = (Math.clamp(value, inRange) - inRange.min) / (inRange.max - inRange.min); // 0...1
    return (factor * (outRange.max - outRange.min)) + outRange.min;
};

// same as scaleValueLinear but result may be outside of outRange
Math.scaleValueLinearUnbounded = function(value, inRange, outRange) {
    var factor = (value - inRange.min) / (inRange.max - inRange.min); // 0...1
    return (factor * (outRange.max - outRange.min)) + outRange.min;
};

Math.evenFloor = function(value) {
    var x = Math.floor(value);
    return (x % 2 == 1) ? x - 1 : x;
};

Math.fequal = function(v1, v2, tolerance) {
    if (typeof tolerance === 'undefined') { tolerance = 0; }
    return Math.abs(v1 - v2) <= tolerance;
};

Array.isEmpty = function(value) {
    return !value || value.length == 0;
}
if (Array.prototype.contains) {
    console.log("Array.prototype.contains exists");
} else {
    Array.prototype.contains = function(value) {
        return this.indexOf(value) >= 0;
    };
}
Array.prototype.isIndexValid = function(i) {
    return i >= 0 && i < this.length;
};
Array.prototype.safeItemAtIndex = function(i) {
    return (i >= 0 && i < this.length) ? this[i] : undefined;
};
if (Array.prototype.removeItemAtIndex) {
    console.log("Array.prototype.removeItemAtIndex exists");
} else {
    Array.prototype.removeItemAtIndex = function(i) {
        if (this.isIndexValid(i)) {
            this.splice(i, 1);
        }
        return this;
    }
}

class Rng {
    nextUnitFloat() {
        return Math.random();
    }
    nextIntOpenRange(minValue, maxValueExclusive) {
        var r = this.nextUnitFloat() * (maxValueExclusive - minValue);
        return Math.floor(r) + minValue;
    }
    nextHexString(length) {
        var str = "";
        while (str.length < length) {
            str += (1 + this.nextIntOpenRange(0, 0x10000)).toString(16);
        }
        return str.substring(0, length);
    }
}
Rng.shared = new Rng();

var _primes = [3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71];
function hashArrayOfInts(values) {
    var result = 0;
    if (values.length < 1) { return result; }
    values = values.map(v => Math.abs(parseInt(v)));
    var m = _primes[values[0] % _primes.length] % _primes.length;
    for (var i = 0; i < values.length; i++) {
        var m2 = (m + 3) % _primes.length;
        result = (result + (Math.abs(parseInt(values[i])) * _primes[m])) % _primes[m2];
        m = _primes[m] % _primes.length;
    }
    return result;
}

// https://stackoverflow.com/a/2450976/795339
Array.prototype.shuffle = function() {
    var currentIndex = this.length, temporaryValue, randomIndex;
    while (0 !== currentIndex) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;
        temporaryValue = this[currentIndex];
        this[currentIndex] = this[randomIndex];
        this[randomIndex] = temporaryValue;
    }
    return this;
};
Array.prototype.randomItem = function() {
    if (this.length == 0) { return null; }
    return this[Math.floor(Math.random() * this.length)];
};

Element.prototype.addRemClass = function(className, shouldAdd) {
    if (shouldAdd)
        this.classList.add(className);
    else
        this.classList.remove(className);
    return this;
};

Element.prototype.toggleClass = function(className) {
    return this.addRemClass(className, !this.classList.contains(className));
};

Element.prototype.removeAllChildren = function() {
    while (this.firstChild) {
        this.removeChild(this.firstChild);
    }
};

var _testCanvas = document.createElement("canvas");
HTMLCanvasElement.getDevicePixelScale = function() {
    return (window.devicePixelRatio || 1) / (_testCanvas.getContext("2d").webkitBackingStorePixelRatio || 1);
};

HTMLCanvasElement.prototype.updateBounds = function() {
    var cs = getComputedStyle(this);
    var scale = HTMLCanvasElement.getDevicePixelScale();
    this.width = parseFloat(cs.width) * scale;
    this.height = parseFloat(cs.height) * scale;
};

CanvasRenderingContext2D.prototype.rectClear = function(rect) {
    this.clearRect(rect.x, rect.y, rect.width, rect.height);
}

CanvasRenderingContext2D.prototype.rectFill = function(rect) {
    this.fillRect(rect.x, rect.y, rect.width, rect.height);
};

CanvasRenderingContext2D.prototype.rectStroke = function(rect) {
    this.strokeRect(rect.x, rect.y, rect.width, rect.height);
};

CanvasRenderingContext2D.prototype.ellipseFill = function(rect) {
    var center = rect.getCenter();
    this.beginPath();
    this.ellipse(center.x, center.y, rect.width * 0.5, rect.height * 0.5, 0, 0, 2 * Math.PI);
    this.fill();
};

CanvasRenderingContext2D.prototype.fillTextCentered = function(text, rect) {
    var metrics = this.measureText(text);
    var x = rect.x + 0.5 * (rect.width - metrics.width);
    var y = rect.y + 0.5 * (rect.height - 0);
    this.fillText(text, x, y);
};

CanvasRenderingContext2D.prototype.textFill = function(text, point, maxWidth) {
    if (maxWidth > 0) {
        this.fillText(text, point.x, point.y);
    } else {
        this.fillText(text, point.x, point.y, maxWidth);
    }
};

window.Mixins = {
    mix: function(prototype, name, func) {
        prototype[name] = prototype[name] || func;
    }
};

// ----------------------------------------------------------------------

window.Gaming = (function() {

Mixins.Gaming = {};

Mixins.Gaming.DelegateSet = function(cls) {
    Mixins.mix(cls.prototype, "forEachDelegate", function(callback) {
        if (!this._sortedDelegates) { this._sortedDelegates = []; }
        this._sortedDelegates.forEach(callback);
    });
    Mixins.mix(cls.prototype, "addDelegate", function(d) {
        if (!this._delegates) { this._delegates = new Set(); }
        this._delegates.add(d);
        this._sortDelegates();
    });
    Mixins.mix(cls.prototype, "removeDelegate", function(d) {
        if (!this._delegates) { this._delegates = new Set(); }
        this._delegates.delete(d);
        this._sortDelegates();
    });
    Mixins.mix(cls.prototype, "_sortDelegates", function() {
        var sorting = [];
        this._delegates.forEach(function (d) {
            sorting.push({ d: d, pri: d.delegateOrder ? d.delegateOrder(this) : 0 });
        }.bind(this));
        sorting.sort(function (a, b) { return a.pri - b.pri });
        this._sortedDelegates = sorting.map(function (s) { return s.d });
    });
};

class SelectableList {
    constructor(items) {
        this.items = items;
    }

    get selectedIndex() {
        return this.items.findIndex((i) => i.isSelected);
    }
    get selectedItem() {
        var index = this.selectedIndex;
        return this.items.safeItemAtIndex(index);
    }

    setSelectedIndex(index) {
        var validIndex = Math.clamp(index, { min: 0, max: this.items.length - 1 });
        return this.setSelectedItem(this.items[validIndex]);
    }
    setSelectedItem(item) {
        if (!item) { return; }
        var oldItem = this.selectedItem;
        if (item != oldItem) {
            oldItem.setSelected(false);
            item.setSelected(true);
        }
        return item;
    }
    selectNext() {
        var index = this.selectedIndex;
        return this.setSelectedIndex(this.items.isIndexValid(index + 1) ? index + 1 : index);
    }
    selectPrevious() {
        var index = this.selectedIndex;
        return this.setSelectedIndex(this.items.isIndexValid(index - 1) ? index - 1 : index);
    }
}

var GameSelector = function(config) {
    this.show = function() {
        new Gaming.Prompt({
            title: "Choose a Game",
            unprioritizeButtons: true,
            requireSelection: true,
            buttons: GameSelector.allGames
        }).show();
    };
};

// push({label:"", action:function(button)})
GameSelector.allGames = [];

// ----------------------------------------------------------------------

var directions = {
    N: 0,
    NE: 1,
    E: 2,
    SE: 3,
    S: 4,
    SW: 5,
    W: 6,
    NW: 7
};

Mixins.Gaming.XYValue = function(cls) {
    Mixins.mix(cls.prototype, "isEqual", function(p2, tol) {
        tol = (tol === undefined) ? 0 : 0.01;
        return Math.fequal(this.x, p2.x, tol) && Math.fequal(this.y, p2.y, tol);
    });
    Mixins.mix(cls.prototype, "isZero", function(tol) {
        return this.isEqual({x: 0, y: 0}, tol);
    });
    Mixins.mix(cls.prototype, "debugDescription", function() {
        return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`;
    });
    Mixins.mix(cls.prototype, "adding", function(x, y) {
        if (typeof y === 'undefined') {
            return new Point(this.x + x.x, this.y + x.y);
        } else {
            return new Point(this.x + x, this.y + y);
        }
    });
    Mixins.mix(cls.prototype, "manhattanDistanceFrom", function(x, y) {
        if (typeof y === 'undefined') {
            var dx = this.x - x.x; var dy = this.y - x.y;
        } else {
            var dx = this.x - x; var dy = this.y - y;
        }
        return { dx: dx, dy: dy, magnitude: Math.max(Math.abs(dx), Math.abs(dy)) };
    });
};

var Point = function(x, y) {
    if (typeof x === 'undefined') { // zero args
        this.x = 0;
        this.y = 0;
    } else if (typeof y === 'undefined') { // copy ctor
        this.x = x.x;
        this.y = x.y;
    } else {
        this.x = x;
        this.y = y;
    }
};
Mixins.Gaming.XYValue(Point);
Point.zeroConst = new Point();
Point.prototype.scaled = function(factor, factorY) {
    return new Point(this.x * factor, this.y * (typeof factorY === 'undefined' ? factor : factorY));
};
Point.min = function(p1, p2) {
    return new Point(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y));
};
Point.max = function(p1, p2) {
    return new Point(Math.max(p1.x, p2.x), Math.max(p1.y, p2.y));
};

var Rect = function(x, y, width, height) {
    if (typeof x === 'undefined') { // zero args: the unit rect
        this.x = 0;
        this.y = 0;
        this.width = 1;
        this.height = 1;
    } else if (typeof y === 'undefined') { // copy ctor
        this.x = x.x;
        this.y = x.y;
        this.width = Math.abs(x.width);
        this.height = Math.abs(x.height);
    } else if (typeof width === 'undefined') { // position, size
        this.x = x.x;
        this.y = x.y;
        this.width = Math.abs(y.width);
        this.height = Math.abs(y.height);
    } else {
        this.x = x;
        this.y = y;
        this.width = Math.abs(width);
        this.height = Math.abs(height);
    }
};
Rect.withCenter = function(x, y, width, height) {
    if (typeof x === 'undefined') { // zero args: the unit rect
        return new Rect(-0.5, -0.5, 1, 1);
    } if (typeof width === 'undefined') { // position, size
        var w = Math.abs(y.width);
        var h = Math.abs(y.height);
        return new Rect(x.x - 0.5 * w, x.y - 0.5 * h, w, h);
    } else {
        var w = Math.abs(width);
        var h = Math.abs(height);
        return new Rect(x - 0.5 * w, y - 0.5 * h, w, h);
    }
};
Rect.fromExtremes = function(e) {
    return new Rect(e.min.x, e.min.y, e.max.x - e.min.x, e.max.y - e.min.y);
};
Rect.prototype.getOrigin = function() {
    return new Point(this.x, this.y);
};
Rect.prototype.getCenter = function() {
    return new Point(this.x + 0.5 * this.width, this.y + 0.5 * this.height);
};
Rect.prototype.getSize = function() {
    return {width: this.width, height: this.height};
};
Rect.prototype.isEmpty = function(tol) {
    return Math.fequal(this.width, 0, tol) && Math.fequal(this.height, 0, tol);
};

Rect.prototype.hashValue = function() {
    return hashArrayOfInts([this.x, this.y, this.width, this.height]);
};
Rect.prototype.contains = function(other) {
    var e1 = this.getExtremes();
    var e2 = other.getExtremes();
    if (!other || this.isEmpty() || other.isEmpty()) { return false; }
    return e1.min.x <= e2.min.x && e1.max.x >= e2.max.x
        && e1.min.y <= e2.min.y && e1.max.y >= e2.max.y;
};
Rect.prototype.getExtremes = function() {
    var min = this.getOrigin();
    return {min: min, max: min.adding(this.width, this.height)};
};
Rect.prototype.debugDescription = function() {
    return `<rect @(${this.x.toFixed(2)}, ${this.y.toFixed(2)}) sz(${this.width.toFixed(2)}, ${this.height.toFixed(2)})>`;
};
Rect.prototype.union = function(other) {
    if (!other) { return new Rect(this); }
    if (this.isEmpty()) return other;
    if (other.isEmpty()) return this;
    var e1 = this.getExtremes();
    var e2 = other.getExtremes();
    return Rect.fromExtremes({
        min: Point.min(e1.min, e2.min),
        max: Point.max(e1.max, e2.max)
    });
};
// new Rect(7, 10, 40, 30).intersects(new Rect(0, 40, 90, 10)) produces "true",
// but expected is false. Why?
// the top edge of r1 is adjacent to the bottom edge of r2
// so it's about r1.maxY and r2.minY
// setting r2.y = 40.0001 makes intersects return false.
// 7104030: getExtremes returns min(7 10) max(47 40)
// 0409010: getExtremes returns min(0 40) max(90 50)
// !((e1.min.x > e2.max.x) || (e1.max.x < e2.min.x) || (e1.min.y > e2.max.y) || (e1.max.y < e2.min.y));
Rect.prototype.intersects = function(other) {
    if (!other || this.isEmpty() || other.isEmpty()) { return false; }
    var e1 = this.getExtremes();
    var e2 = other.getExtremes();
    return !((e1.min.x >= e2.max.x) || (e1.max.x <= e2.min.x) || (e1.min.y >= e2.max.y) || (e1.max.y <= e2.min.y));
};
Rect.prototype.inset = function(xInset, yInset) {
    return new Rect(this.x + xInset, this.y + yInset, this.width - 2 * xInset, this.height - 2 * yInset);
};

var Vector = function(x, y) {
    if (typeof x === 'undefined') { // zero args
        this.x = 0;
        this.y = 0;
    } else if (typeof y === 'undefined') { // copy ctor
        this.x = x.x;
        this.y = x.y;
    } else {
        this.x = x;
        this.y = y;
    }
};
Mixins.Gaming.XYValue(Vector);
Vector.prototype.scaled = function(factor, factorY) {
    return new Vector(this.x * factor, this.y * (typeof factorY === 'undefined' ? factor : factorY));
};
Vector.prototype.offsettingPosition = function(position, scale) {
    if (scale === undefined) { scale = 1; }
    return position.adding(scale * this.x, scale * this.y);
};

var diag = 0.7071;
Vector.unitsByDirection = {};
Vector.unitsByDirection[directions.N]  = new Vector(0, 1);
Vector.unitsByDirection[directions.NE] = new Vector(diag, diag);
Vector.unitsByDirection[directions.E]  = new Vector(1, 0);
Vector.unitsByDirection[directions.SE] = new Vector(diag, -diag);
Vector.unitsByDirection[directions.S]  = new Vector(0, -1);
Vector.unitsByDirection[directions.SW] = new Vector(-diag, -diag);
Vector.unitsByDirection[directions.W]  = new Vector(-1, 0);
Vector.unitsByDirection[directions.NW] = new Vector(-diag, diag);

// possibly for performance:
// var Vector = {
//     make: function(x, y) { return { x: x, y: y }; },
//     scaled: function(v, factor) { return Vector.make(v.x * factor, v.y * factor); },
//     etc.
// };

// ----------------------------------------------------------------------

// config: {
//   paint: function(ctx),
//   either this:
//     getPaintBounds: function()?, (default to position + size)
//   or these two:
//     getPosition: function()? (default to center of paint bounds)
//     getPaintSize: function()? (default to size of paint bounds)
Mixins.Gaming.SceneItem = function(cls, config) {
    Mixins.mix(cls.prototype, "addToParent", function (parentItem) {
        this.removeFromParent();
        if (!parentItem) { return this; }
        if (!parentItem.childItems) { parentItem.childItems = []; }
        parentItem.childItems.push(this);
        this.parentItem = parentItem;
        return this;
    });
    Mixins.mix(cls.prototype, "removeFromParent", function () {
        if (!this.parentItem) { return this; }
        if (!this.parentItem.childItems) { this.parentItem.childItems = []; }
        var index = this.parentItem.childItems.indexOf(this);
        if (index >= 0) {
            this.parentItem.childItems.removeItemAtIndex(index);
        }
        this.parentItem = null;
        return this;
    });
    Mixins.mix(cls.prototype, "didJoinScene", function(scene, layerIndex) {
        this.sceneInfo = {
            scene: scene,
            layerIndex: layerIndex
        };
        this.setDirty(true);
        this.childItems.forEach(function (child) {
            child.didJoinScene(scene, layerIndex)
        });
    });
    Mixins.mix(cls.prototype, "didLeaveScene", function(scene) {
        this.sceneInfo = null;
        this.childItems.forEach(function (child) {
            child.didLeaveScene(scene);
        });
    });
    Mixins.mix(cls.prototype, "leaveScene", function() {
        if (!this.sceneInfo) { return; }
        this.sceneInfo.scene.removeItem(this, this.sceneInfo.layerIndex);
        this.childItems.forEach(function (child) {
            child.leaveScene();
        });
    });
    Mixins.mix(cls.prototype, "getSceneInfo", function() {
        return this.sceneInfo;
    });
    Mixins.mix(cls.prototype, "setDirty", function(secondHand) {
        if (this.sceneInfo) { this.sceneInfo.scene.itemBecameDirty(this, secondHand); }
    });
    Mixins.mix(cls.prototype, "getPaintBounds", config.getPaintBounds || function() {
        return new Rect(this.getPosition(), this.getPaintSize());
    });
    Mixins.mix(cls.prototype, "getPosition", config.getPosition || function() {
        return this.getPaintBounds().getCenter();
    });
    Mixins.mix(cls.prototype, "getPaintSize", config.getPaintSize || function() {
        return this.getPaintBounds().getSize();
    });
    Mixins.mix(cls.prototype, "paint", config.paint);
};

// all of SceneItem, plus config should also have setPosition
Mixins.Gaming.MoveableSceneItem = function(cls, config) {
    Mixins.Gaming.SceneItem(cls, config);
    Mixins.mix(cls.prototype, "setPosition", config.setPosition);
};

/*
class ScenePainter {
    constructor(canvas, runLoop, config) {
        this.canvas = canvas;
        this.canvasFillStyle = config.canvasFillStyle || "#ffffff";
        this.dirtyRect = null;
        this.layers = new Array(Scene.maxLayers);

        var pointSize = {
            width: config.sizeInfo.width * config.sizeInfo.pointsPerUnit,
            height: config.sizeInfo.height * config.sizeInfo.pointsPerUnit
        };
        var scale = HTMLCanvasElement.getDevicePixelScale();
        this.canvas.width = pointSize.width * scale;
        this.canvas.height = pointSize.height * scale;
        this.canvas.style.width = `${pointSize.width}px`;
        this.canvas.style.height = `${pointSize.height}px`;

        this.ctx = canvas.getContext("2d");
        this.ctx.resetTransform();
        this.ctx.transform(config.sizeInfo.pointsPerUnit * scale, 0, 0, -config.sizeInfo.pointsPerUnit * scale, 0, this.canvas.height);
        this.ctx.save();
        this.repaintFullScene();
        runLoop.addDelegate(this);
    }
}*/

var Scene = function(config) {
    this.id = config.id;
    this.runLoop = config.runLoop;
    this.canvasFillStyle = config.canvasFillStyle || "#ffffff";
    this.canvasSizeInfo = config.sizeInfo;
    this.dirtyRect = null;
    this.layers = new Array(Scene.maxLayers);
    this.debug = !!config.debug;
};
Scene.maxLayers = 10;

Scene.prototype.attachToCanvas = function(canvas, resizeCanvas) {
    this.canvas = canvas;

    var pointSize = {
        width: this.canvasSizeInfo.width * this.canvasSizeInfo.pointsPerUnit,
        height: this.canvasSizeInfo.height * this.canvasSizeInfo.pointsPerUnit
    };
    var scale = HTMLCanvasElement.getDevicePixelScale();
    this.canvas.width = pointSize.width * scale;
    this.canvas.height = pointSize.height * scale;
    this.canvas.style.width = `${pointSize.width}px`;
    this.canvas.style.height = `${pointSize.height}px`;

    this.ctx = canvas.getContext("2d");
    this.ctx.resetTransform();
    this.ctx.transform(this.canvasSizeInfo.pointsPerUnit * scale, 0, 0, -this.canvasSizeInfo.pointsPerUnit * scale, 0, this.canvas.height);
    this.ctx.save();
    this.repaintFullScene();
    this.runLoop.addDelegate(this);
};

Scene.prototype.processFrame = function(rl) {
    if (this.canvas) { this.paint(); }
};

Scene.prototype.getLayer = function(index) {
    if (typeof index === 'undefined' || index < 0 || index >= this.layers.length) {
        console.warn(`Invalid Scene layer index ${index}`);
        return null;
    }
    return this.layers[index] || (this.layers[index] = new Set());
};

Scene.prototype.addItem = function(item, layerIndex) {
    var layer = this.getLayer(layerIndex);
    if (layer) {
        item.leaveScene();
        layer.add(item);
        item.didJoinScene(this, layerIndex);
    } else {
        console.warn("Can't add item: bad layer.");
    }
};

Scene.prototype.removeItem = function(item, layerIndex) {
    var layer = this.getLayer(layerIndex);
    if (layer) {
        if (layer.delete(item)) {
            this.markRectDirty(item.getPaintBounds());
            item.didLeaveScene(this);
        }
    }
};

Scene.prototype.itemBecameDirty = function(item, secondHand) {
    if (item.sceneInfo.dirty) {
        return;
    }
    item.sceneInfo.dirty = true;
    this.markRectDirty(item.getPaintBounds());
    if (item.sceneInfo.lastPaintedRect) {
        // the 1px border seems necessary to prevent ghosting of edges
        // TODO make it 1px truly instead of 1 scene-unit
        var rect = (!!secondHand) ? item.sceneInfo.lastPaintedRect : item.sceneInfo.lastPaintedRect.inset(-1, -1);
        this.markRectDirty(rect);
    }
};

Scene.prototype.markRectDirty = function(rect) {
    if (this.dirtyRect && this.dirtyRect.contains(rect)) {
        return;
    }
    //console.log(`markRectDirty: ${rect.debugDescription()};`)
    this.dirtyRect = rect.union(this.dirtyRect);
    for (i = 0; i < this.layers.length; i++) {
        var layer = this.getLayer(i);
        if (layer) {
            layer.forEach(function (item) {
                if (item.sceneInfo.dirty) { return; }
                var bbox = item.getPaintBounds();
                if (!this.dirtyRect.intersects(bbox)) { return; }
                item.setDirty(true);
            }.bind(this));
        }
    }
};

Scene.prototype.clearDirtyState = function() {
    this.dirtyRect = null;
};

Scene.prototype.rectIntersectsDirtyRegion = function(rect) {
    return this.dirtyRect ? this.dirtyRect.intersects(rect) : false;
};

Scene.prototype.repaintFullScene = function() {
    if (!this.canvas) {
        console.warn("Skipping repaint, no canvas.");
        return;
    }
    this.markRectDirty(new Rect(0, 0, this.canvas.width, this.canvas.height));
};

Scene.prototype.paint = function() {
    if (!this.canvas) {
        console.warn("Skipping paint, no canvas.");
        return;
    }
    if (!this.dirtyRect) { return; }
    this.ctx.save();
    //console.log("PAINT");

    //this.ctx.fillStyle = "hsla(0, 0%, 0%, 0.1)";
    this.ctx.fillStyle = this.canvasFillStyle;
    this.ctx.rectFill(this.dirtyRect);
    if (this.debug) {
        var onePixel = 1 / this.canvasSizeInfo.pointsPerUnit;
        this.ctx.strokeStyle = "hsl(300, 100%, 50%)";
        //console.log(`${this.dirtyRect.debugDescription()} x ${onePixel} => "${this.dirtyRect.inset(-onePixel, -onePixel).debugDescription()}`);
        this.ctx.rectStroke(this.dirtyRect.inset(-onePixel, -onePixel));
    }
    //this.ctx.clearRect(this.dirtyRect.x, this.dirtyRect.y, this.dirtyRect.width, this.dirtyRect.height);
    for (i = 0; i < this.layers.length; i++) {
        var layer = this.getLayer(i);
        if (layer) {
            layer.forEach(function (item) {
                this.paintItem(layer, item);
            }.bind(this));
        }
    }

    this.ctx.restore();
    this.clearDirtyState();
};



/*
eh so confused by the painting/container/position hierarchy stuff.
probably easier at this point to just start over?? Rather than trying 
to modiy the existing stuff here.
When starting over, keep it really simple, leave out as many complications
(like dirty rects) as possible, get the fundamentals like coordinates right 
first so content can start to get created. Add optimizations later.

possible fun way too define a scene in yaml: with ascii art
basemap: - |
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
a   bbbbcccb  f  f           a
a   bbbbccdb           g     a
a   beebbbbb  f  f      g    a
a                            a
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
basemapItems:
    a: ContainerItem
    b: House
    c: Table
    d: Lamp
    e: Table
    f: Pond
    g: Shed
Only use this for simple items. Layers defined by alphabetical order.
No parent-child hierarchy; coordinates are all absolute values.
Bounding rect == min/max coords of the letters (so you can have holes 
in the text e.g. a and b, or just type the corners e.g. f, g).
Additional items with more finicky setup can be done with normal 
key-value definitions in the yaml.
Could have multiple of these ascii maps, each one another layer 
of items, if more complexity is needed (e.g. two items at same coords).
Bottommost basemap is the terrain. Could define special characters 
for common items, especially at the terrain level. e.g. # == water.
eh terrain would need to work differently, since it's not a bunch of 
rectangles? eh we talked about explicitly *not* taking the simple 
grid-of-tiles approach for terrain and instead defining it as a bunch 
of polygons with arbitrary shapes. Could still define polygons by 
putting the letters only at the vertices:
                a     a     But how do you specify the order of 
           a            a   the vertexes? Capitalize the first 
           a          a     vertex. Or do a1 a2 a3 a4 etc. which 
               a     a      is fine unless things overlap, or you
                            get more than 10 vertexes.
                a8b6b1a1    Could do 1a 1b 1c instead to get more
           a7         b2a2  vertexes but fewer objects. Or write 
           a6         a3b3  an algorithm to figure out the ordering
               a5 b5 a4b4   of the vertexes automatically (if possible).
eh this is getting silly. What about just have PNG images of the terrain.
Each layer of the PNG is a different terrain object. Only use the alpha 
channel to determine the presence/absence of the object (and maybe 
transparency level determines something functional in the game?). Could 
also have a movement-mask layer that shows where exactly the player can 
move. And in the yaml you map each layer to different types of game objects.
Don't hand-render the actual scene in the PNG, it's just a template, and 
the scene is rendered in real time in the game engine using textures 
(so you can animate, etc., and also so you don't have to hand-render every 
scene every time something changes, etc.).

*/

Scene.prototype.paintItem = function(layer, item) {
    var bbox = item.getPaintBounds();
    if (this.rectIntersectsDirtyRegion(bbox)) {
        //this.ctx.save();
        //this.ctx.transform(bbox.width, 0, 0, bbox.height, bbox.x, bbox.y);
        item.paint(this.ctx);
        //this.ctx.restore();
        item.sceneInfo.dirty = false;
        item.sceneInfo.lastPaintedRect = bbox;
    }

    if (item.childItems.length == 0) { return; }
    this.ctx.save();
    item.childItems.forEach(function (child) {
        this.paintItem(layer, child);
    }.bind(this));
    this.ctx.transform(bbox.width, 0, 0, bbox.height, bbox.x, bbox.y);
    this.ctx.restore();
};

// ----------------------------------------------------------------------

// config: {scale=number, reverseY=bool}

// duration: in seconds
var Easing = function(duration, curveFunc) {
    this.durationMilliseconds = duration * 1000;
    this.curveFunc = curveFunc;
    this.startDate = null;
};
Easing.prototype.start = function() {
    this.startDate = new Date();
};
// in the range [0...1] based on time since start
Easing.prototype.normalizedTimeCompleted = function() {
    if (!this.startDate) { return 0; }
    if (this.durationMilliseconds < 1) { return 1; }
    return Math.min(1, (new Date() - this.startDate) / this.durationMilliseconds);
};
// in the range [0...1] based on time since start
Easing.prototype.progress = function() {
    return this.curveFunc(this.normalizedTimeCompleted());
};
Easing.quick = function() {
    return new Easing(0.15, function(normalizedTimeCompleted) {
        return normalizedTimeCompleted;
    });
};
Easing.debug = function(duration) {
    return new Easing(duration, function(normalizedTimeCompleted) {
        return normalizedTimeCompleted;
    });
};

var Sprite = function(config) {
    this.item = config.item; // conforms to MoveableSceneItem
    this.runLoop = config.runLoop;
    this.velocity = new Vector(config.initialVelocity) || new Vector(0, 0);
    this.startVelocity = null;
    this.targetVelocity = null;
    this.lastFrameDate = null;
    this.easing = null;
};

Sprite.prototype.isMoving = function() {
    return !this.velocity.isZero();
};

Sprite.prototype.goToVelocity = function(targetVelocity, easing) {
    if (targetVelocity.isEqual(this.velocity)) {
        return;
    }

    this.startVelocity = this.velocity;
    this.targetVelocity = targetVelocity;
    this.easing = easing;
    if (this.easing) {
        this.easing.start();
    }

    if (!this.lastFrameDate) {
        this.lastFrameDate = new Date();
    }
    this.runLoop.addDelegate(this);
};

Sprite.prototype.processFrame = function(rl) {
    if (this.targetVelocity) {
        if (this.easing) {
            var factor = this.easing.progress();
            this.velocity = new Vector(
                this.startVelocity.x + factor * (this.targetVelocity.x - this.startVelocity.x),
                this.startVelocity.y + factor * (this.targetVelocity.y - this.startVelocity.y));
        } else {
            this.velocity = this.targetVelocity;
        }
        if (this.velocity.isEqual(this.targetVelocity)) {
            this.easing = null;
            this.targetVelocity = null;
        }
    }

    var now = new Date();
    var seconds = 0.001 * (now - this.lastFrameDate);

    this.item.setPosition(this.velocity.offsettingPosition(this.item.getPosition(), seconds));

    if (this.velocity.isZero()) {
        this.runLoop.removeDelegate(this);
        this.velocity = new Vector(0, 0);
        this.lastFrameDate = null;
    } else {
        this.lastFrameDate = now;
    }
};

// stateful moving.
// velocity units are "DistanceUnits/sec"
// config: {runLoop, initialPosition, initialVelocity?}
var Movement = function(config) {
    this.runLoop = config.runLoop;
    this.position = new Point(config.initialPosition);
    this.velocity = new Vector(config.initialVelocity) || new Vector(0, 0);
    this.startVelocity = null;
    this.targetVelocity = null;
    this.lastFrameDate = null;
    this.easing = null;
};
Movement.prototype.isMoving = function() {
    return !this.velocity.isZero();
};

Movement.prototype.setPosition = function(newPosition) {
    this.position = new Point(newPosition);
};

Movement.prototype.goToVelocity = function(targetVelocity, easing) {
    if (targetVelocity.isEqual(this.velocity)) {
        return;
    }

    this.startVelocity = this.velocity;
    this.targetVelocity = targetVelocity;
    this.easing = easing;
    if (this.easing) {
        this.easing.start();
    }

    if (!this.lastFrameDate) {
        this.lastFrameDate = new Date();
    }
    this.runLoop.addDelegate(this);
};

Movement.prototype.processFrame = function(rl) {
    if (this.targetVelocity) {
        if (this.easing) {
            var factor = this.easing.progress();
            this.velocity = new Vector(
                this.startVelocity.x + factor * (this.targetVelocity.x - this.startVelocity.x),
                this.startVelocity.y + factor * (this.targetVelocity.y - this.startVelocity.y));
        } else {
            this.velocity = this.targetVelocity;
        }
        if (this.velocity.isEqual(this.targetVelocity)) {
            this.easing = null;
            this.targetVelocity = null;
        }
    }

    var now = new Date();
    var seconds = 0.001 * (now - this.lastFrameDate);
    this.position = this.velocity.offsettingPosition(this.position, seconds);

    if (this.velocity.isZero()) {
        this.runLoop.removeDelegate(this);
        this.velocity = new Vector(0, 0);
        this.lastFrameDate = null;
    } else {
        this.lastFrameDate = now;
    }
};

// ----------------------------------------------------------------------

var RunStates = {
    notStarted: 0,
    running: 1,
    paused: 2,
    autoPaused: 3
};

// config: {targetFrameRate, id, runWhenPageIsInBackground, childRunLoops: [RunLoop]}
// frameRate values are frames/sec.
// childRunLoops: parent state change propagates to children. Delegates must be registered separately.
// RunLoop delegates are objects with optional functions:
//   processFrame(RunLoop)
//   runLoopWillResume(RunLoop)
//   runLoopDidPause(RunLoop)
var RunLoop = function(config) {
    this.id = config.id;
    this.targetFrameRate = config.targetFrameRate;
    this.targetFrameInterval = 1000 / config.targetFrameRate;
    this.runState = RunStates.notStarted;
    this.started = false;
    this.nextTimeoutID = undefined;
    this.recentFrameStartDates = [];
    this.childRunLoops = (config.childRunLoops === undefined) ? [] : config.childRunLoops;
    if (!config.runWhenPageIsInBackground) {
        document.addEventListener("visibilitychange", this.toggleAutopause.bind(this));
    }
};
Mixins.Gaming.DelegateSet(RunLoop);

RunLoop.prototype.setTargetFrameRate = function(value) {
    this.targetFrameRate = value;
    this.targetFrameInterval = 1000 / this.targetFrameRate;
};

RunLoop.prototype.getRecentFramesPerSecond = function() {
    var seconds = this._getRecentSecondsElapsed();
    return isNaN(seconds) ? NaN : (1000 * this.recentFrameStartDates.length / seconds);
};

RunLoop.prototype.getRecentMillisecondsPerFrame = function() {
    var seconds = this._getRecentSecondsElapsed();
    return isNaN(seconds) ? NaN : (seconds / this.recentFrameStartDates.length);
};

RunLoop.prototype._getRecentSecondsElapsed = function() {
    if (!this.isRunning() || this.recentFrameStartDates.length < 5) {
        return NaN;
    }
    var seconds = (this.recentFrameStartDates[this.recentFrameStartDates.length - 1] - this.recentFrameStartDates[0]);
    if (seconds <= 0) {
        console.warn(`Unexpected recentFrameStartDates interval ${seconds}`);
        return NaN;
    }
    return seconds;
}

RunLoop.prototype.isRunning = function() {
    return this.runState == RunStates.running;
};

RunLoop.prototype.resume = function() {
    if (this.isRunning()) { return; }
    this.runState = RunStates.running;
    this.forEachDelegate(function (d) {
        if (d.runLoopWillResume) {
            d.runLoopWillResume(this);
        }
    }.bind(this));
    this.scheduleNextFrame();

    this.childRunLoops.forEach(function (rl) {
        rl.resume();
    });
};

RunLoop.prototype.pause = function(autoPause) {
    if (!this.isRunning()) { return; }
    this.runState = autoPause ? RunStates.autoPaused : RunStates.paused;
    clearTimeout(this.nextTimeoutID);
    this.nextTimeoutID = undefined;
    this.recentFrameStartDates = [];
    this.forEachDelegate(function (d) {
        if (d.runLoopDidPause) {
            d.runLoopDidPause(this);
        }
    }.bind(this));

    this.childRunLoops.forEach(function (rl) {
        rl.pause(autoPause);
    });
};

RunLoop.prototype.toggleAutopause = function() {
    switch (this.runState) {
        case RunStates.notStarted: return;
        case RunStates.running: if (document.hidden) { this.pause(true); }
        case RunStates.paused: return;
        case RunStates.autoPaused: if (!document.hidden) { this.resume(); }
    }
};

RunLoop.prototype.scheduleNextFrame = function() {
    if (!this.isRunning()) { return; }
    if (this.nextTimeoutID != undefined) {
        console.warn(`RunLoop ${this.id}'s nextTimeoutID already defined.`);
        return;
    }

    var delay = this.targetFrameInterval;
    var lastDate = this.latestFrameStartDate();
    if (lastDate) {
        var delayFromLastFrame = this.targetFrameInterval - (new Date() - lastDate);
        if (delayFromLastFrame < 0.5 * this.targetFrameInterval) {
            // if falling behind, ease back into the target frame rate
            delay = Math.max(0, 0.5 * (delayFromLastFrame + this.targetFrameInterval));
        }
    }
    this.nextTimeoutID = setTimeout(this.processFrame.bind(this), delay);
};

RunLoop.prototype.latestFrameStartDate = function() {
    if (this.recentFrameStartDates.length == 0) { return null; }
    return this.recentFrameStartDates[this.recentFrameStartDates.length - 1];
};

RunLoop.prototype.processFrame = function() {
    this.nextTimeoutID = undefined;
    if (!this.isRunning()) {
        return;
    }

    this.recentFrameStartDates.push(new Date());
    if (this.recentFrameStartDates.length > 100) {
        this.recentFrameStartDates = this.recentFrameStartDates.slice(100 - this.recentFrameStartDates.length);
    }

    // if (this.id == "engineRunLoop") {
    //     console.log("processFrame")
    // }
    this.forEachDelegate(function (d) {
        if (d.processFrame) {
            d.processFrame(this);
        }
    }.bind(this));
    this.scheduleNextFrame();
};

class Dispatch {
    constructor() {
        this._blocks = {};
    }

    addTarget(id, eventName, block) {
        if (!this._blocks[eventName]) {
            this._blocks[eventName] = {};
        }
        this._blocks[eventName][id] = block;
    }

    postEventSync(eventName, info) {
        var blocks = this._blocks[eventName];
        if (!blocks) { return; }
        for (var id of Object.getOwnPropertyNames(blocks)) {
            blocks[id](eventName, info);
        }
    }

    remove(targetOrID) {
        if (!targetOrID) { return; }
        var id = targetOrID.id ? targetOrID.id : targetOrID;
        for (var eventName of Object.getOwnPropertyNames(this._blocks)) {
            delete this._blocks[eventName][id];
        }
    }
}
Dispatch.shared = new Dispatch();

class DispatchTarget {
    constructor(id) {
        this.id = id || Rng.shared.nextHexString(16);
    }
    register(eventName, block) {
        Dispatch.shared.addTarget(this.id, eventName, block);
        return this;
    }
}

/*
class PaletteRenderer {
    initialize() {
        Dispatch.removeListener(this._listener);
        this._listener = new EventListener()
            .register(MapToolController.Events.startedSession, (e, info) => { this._canvasDirty = true; })
            .register(...)
    }
}
*/

// ----------------------------------------------------------------------

// config: {runLoop}
// KeyboardState delegates are objects with optional functions:
//   keyboardStateDidChange(KeyboardState, eventType)
//      eventType = keydown|keyup
//   keyboardStateContinuing(KeyboardState).
var KeyboardState = function(config) {
    this.keyCodesCurrentlyDown = new Set();
    config.runLoop.addDelegate(this);
    document.addEventListener("keydown", this.keydown.bind(this));
    document.addEventListener("keyup", this.keyup.bind(this));
};
Mixins.Gaming.DelegateSet(KeyboardState);

KeyboardState.prototype.processFrame = function() {
    if (this.keyCodesCurrentlyDown.size == 0) { return; }
    this.forEachDelegate(function (d) {
        if (d.keyboardStateContinuing) {
            d.keyboardStateContinuing(this);
        }
    }.bind(this));
};

KeyboardState.prototype.areKeyCodesDown = function(keyCodes, exact) {
    if (exact && keyCodes.length != this.keyCodesCurrentlyDown.size) {
        return false;
    }
    for (var i = 0; i < keyCodes.length; i++) {
        if (keyCodes[i] == "AnyShift") {
            if (!this.keyCodesCurrentlyDown.has("ShiftLeft") && !this.keyCodesCurrentlyDown.has("ShiftRight")) {
                return false;
            }
        } else if (!this.keyCodesCurrentlyDown.has(keyCodes[i])) {
            return false;
        }
    }
    return true;
};

KeyboardState.prototype.keydown = function(event) {
    var oldSize = this.keyCodesCurrentlyDown.size;
    this.keyCodesCurrentlyDown.add(event.code);
    if (this.keyCodesCurrentlyDown.size > oldSize) {
        this.forEachDelegate(function (d) {
            if (d.keyboardStateDidChange) {
                d.keyboardStateDidChange(this, event.type);
            }
        }.bind(this));
    }
};

KeyboardState.prototype.keyup = function(event) {
    if (this.keyCodesCurrentlyDown.delete(event.code)) {
        this.forEachDelegate(function (d) {
            if (d.keyboardStateDidChange) {
                d.keyboardStateDidChange(this, event.type);
            }
        }.bind(this));
    }
};

// ----------------------------------------------------------------------

/*
Grid of tiles rendered on a Canvas. Does not change canvas display size; 
reacts to canvas size changes to modify the number of tiles rendered 
based on configured tile size.

All inputs, like tileWidth or x/y coordinates, are device independent pixels.
All outputs, like tile rects for Canvas drawing, are device specific pixels.
So rects may be 2x size of tileWidth depending on screen scale.

    this.ctx = canvas.getContext("2d");
    this.ctx.resetTransform();
    this.ctx.transform(this.canvasSizeInfo.pointsPerUnit * scale, 0, 0, -this.canvasSizeInfo.pointsPerUnit * scale, 0, this.canvas.height);
    this.ctx.save();

*/
class FlexCanvasGrid {
    constructor(config) {
        this.canvas = config.canvas;
        this.deviceScale = config.deviceScale;
        this.setSize(config);
        // TODO listen for DOM size changes
    }

    setSize(config) {
        // config.tileWidth = width/height of tile squares in model pixels
        // this.tileWidth = raw device pixel size
        this.tileWidth = config.tileWidth * this.deviceScale;
        // px between tiles. Same relation as tileWidth
        this.tileSpacing = config.tileSpacing * this.deviceScale;
        this.updateMetrics();
    }

    updateMetrics() {
        var canvasSize = this.canvasDeviceSize;
        this.canvas.width = canvasSize.width;
        this.canvas.height = canvasSize.height;
        if (canvasSize.width < 1 || canvasSize.height < 1) {
            this._tilesWide = 0;
            this._tilesHigh = 0;
        } else {
            this._tilesWide = Math.floor((canvasSize.width + this.tileSpacing) / (this.tileWidth + this.tileSpacing));
            this._tilesHigh = Math.floor((canvasSize.height + this.tileSpacing) / (this.tileWidth + this.tileSpacing));
        }
        if (this.isEmpty) {
            this._allTilesRect = new Rect(0, 0, 0, 0);
        } else {
            var sz = {
                width: (this._tilesWide * this.tileWidth) + ((this._tilesWide - 1) * this.tileSpacing),
                height: (this._tilesHigh * this.tileWidth) + ((this._tilesHigh - 1) * this.tileSpacing)
            };
            this._allTilesRect = new Rect({
                x: Math.floor(0.5 * (canvasSize.width - sz.width)),
                y: Math.floor(0.5 * (canvasSize.height - sz.height)),
            }, sz);
        }
    }

    // Device independent size
    get canvasDeviceSize() {
        return { width: this.canvas.clientWidth * this.deviceScale, height: this.canvas.clientHeight * this.deviceScale };
    }
    get canvasCSSSize() {
        return { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    }

    // num visible tiles
    get isEmpty() {
        return this._tilesWide < 1 || this._tilesHigh < 1;
    }
    get tilesWide() {
        return this._tilesWide;
    }
    get tilesHigh() {
        return this._tilesHigh;
    }
    get tileSize() {
        return { width: this._tilesWide, height: this._tilesHigh };
    }
    // Canvas model coords covering all visible tiles, minus any unused edge 
    // padding.
    get rectForAllTiles() {
        return this._allTilesRect;
    }
    get rectForFullCanvas() {
        return new Rect(0, 0, this.canvas.width, this.canvas.height);
    }

    isTileVisible(location) {
        return location.x >= 0
            && location.x < this._tilesWide
            && location.y >= 0
            && location.y < this._tilesHigh;
    }

    rectForTile(location) {
        return new Rect(
            this._allTilesRect.x + (location.x * (this.tileWidth + this.tileSpacing)),
            this._allTilesRect.y + (location.y * (this.tileWidth + this.tileSpacing)),
            this.tileWidth,
            this.tileWidth)
    }

    rectForTileRect(tileRect) {
        var topLeft = this.rectForTile(tileRect);
        var bottomRight = this.rectForTile({ x: tileRect.x + tileRect.width - 1, y: tileRect.y + tileRect.height - 1 });
        return topLeft.union(bottomRight);
    }

    tileForCanvasPoint(point) {
        return this._tileForDevicePoint(point.x * this.deviceScale, point.y * this.deviceScale);
    }

    _tileForDevicePoint(x, y) {
        if (this.isEmpty) { return null; }
        var location = new Point(
            Math.floor((x - this._allTilesRect.x) / (this.tileWidth + this.tileSpacing)),
            Math.floor((y - this._allTilesRect.y) / (this.tileWidth + this.tileSpacing))
        );
        return this.isTileVisible(location) ? location : null;
    }

    visitEachLocation(visitor) {
        for (var rowIndex = 0; rowIndex < this.rows; rowIndex++) {
            for (var colIndex = 0; colIndex < this.columns; colIndex++) {
                let location = {x: colIndex, y: rowIndex};
                visitor(location, this.rectForTile(location));
            }
        }
    }
}
FlexCanvasGrid.getDevicePixelScale = function() {
    return HTMLCanvasElement.getDevicePixelScale();
};

var CanvasGrid = function(config) {
    this.rows = config.rows;
    this.columns = config.columns;
    this.tileWidth = config.tileWidth;
    this.tileSpacing = config.tileSpacing;
    this.canvasSize = {
        width: (this.columns * this.tileWidth) + ((this.columns + 1) * this.tileSpacing),
        height: (this.rows * this.tileWidth) + ((this.rows + 1) * this.tileSpacing)
    };
};

CanvasGrid.prototype.initialize = function(canvas) {
    var scale = HTMLCanvasElement.getDevicePixelScale();
    canvas.style.width = (this.canvasSize.width / scale) + "px";
    canvas.style.height = (this.canvasSize.height / scale) + "px"
    canvas.width = this.canvasSize.width;
    canvas.height = this.canvasSize.height;
};

CanvasGrid.prototype.rectForTile = function(location) {
    return new Rect(
        location.column * (this.tileWidth + this.tileSpacing) + this.tileSpacing,
        location.row * (this.tileWidth + this.tileSpacing) + this.tileSpacing,
        this.tileWidth,
        this.tileWidth)
};

CanvasGrid.prototype.rectCenteredOnPosition = function(position) {
    var r = this.rectForTile({ column: position.x, row: position.y });
    return r;
};

CanvasGrid.prototype.tileForPoint = function(x, y) {
    var column = Math.floor((x - this.tileSpacing) / (this.tileWidth + this.tileSpacing));
    var row = Math.floor((y - this.tileSpacing) / (this.tileWidth + this.tileSpacing));
    if (row >= 0 && row < this.rows && column >= 0 && column < this.columns) {
        return { row: row, column: column };
    }
    return null;
};

// visitor(location, rect)
CanvasGrid.prototype.visitEachLocation = function(visitor) {
    for (var rowIndex = 0; rowIndex < this.rows; rowIndex++) {
        for (var colIndex = 0; colIndex < this.columns; colIndex++) {
            let location = {row: rowIndex, column: colIndex};
            visitor(location, this.rectForTile(location));
        }
    }
};

// ----------------------------------------------------------------------

// config: {
//   title: "html"?, message: "html"?, customContent:(html block elem)?,
//   dismissed: function(button)?,
//   buttons: [{label: "html", classNames: ["",...]?, action: function()?}, ...],
//   unprioritizeButtons: bool=false, requireSelection: bool=false}
// dismissed called if prompt escaped (button arg is null then), or button without a callback is clicked.
var Prompt = function(config) {
    this.config = config;
    this.elem = document.querySelector("prompt"); // only a single <prompt> element allowed

    if (!Prompt.canceler) {
        Prompt.canceler = function(event) {
            event.preventDefault();
            if (Prompt.current && event.target == Prompt.current.elem && !Prompt.current.config.requireSelection) {
                Prompt.current.dismiss(null, null);
            }
        };
        this.elem.addEventListener("click", Prompt.canceler);
    }
};

Prompt.prototype.show = function() {
    if (Prompt.current) {
        console.log("Prompt is already visible; won't show this prompt.");
        return;
    }

    this.elem.addRemClass("unprioritized", this.config.unprioritizeButtons);

    var title = this.elem.querySelector("h1");
    title.addRemClass("hidden", !this.config.title);
    if (this.config.title) { title.innerHTML = this.config.title; }

    var message = this.elem.querySelector("p");
    message.addRemClass("hidden", !this.config.message);
    if (this.config.message) { message.innerHTML = this.config.message; }

    var custom = this.elem.querySelector("div");
    custom.addRemClass("hidden", !this.config.customContent);
    if (this.config.customContent) {
        custom.removeAllChildren();
        custom.append(this.config.customContent);
    }

    var buttons = this.elem.querySelector("panel > buttons");
    buttons.removeAllChildren();
    this.config.buttons.forEach(function (buttonConfig) {
        var button = document.createElement("a");
        button.innerHTML = buttonConfig.label;
        button.href = "#";
        if (buttonConfig.classNames) {
            buttonConfig.classNames.forEach(function (className) {
                button.classList.add(className);
            });
        }
        button.addEventListener("click", function(event) {
            event.preventDefault();
            this.dismiss(buttonConfig.action, button);
        }.bind(this));
        buttons.append(button);
    }.bind(this));

    Prompt.current = this;
    this.elem.addRemClass("hidden", false);
    document.body.addEventListener("keypress", this.escape.bind(this));
};

Prompt.prototype.escape = function(event) {
    if (this.config.requireSelection || event.key != "Escape") { return; }
    event.preventDefault();
    Prompt.current.dismiss();
};

Prompt.prototype.dismiss = function(action, button) {
    if (Prompt.current != this) { return; }

    document.body.removeEventListener("keypress", this.escape);
    this.elem.addRemClass("hidden", true);
    Prompt.current = null;

    if (action) {
        action(button);
    } else if (this.config.dismissed) {
        this.config.dismissed(button);
    }
};

// ----------------------------------------------------------------------

// config: {canvas = (html elem), min, max, value, onchange = function(Slider)}
var Slider = function(config) {
    this.canvas = config.canvas;
    this.min = config.min;
    this.max = config.max;
    this.value = config.value;
    this.onchange = config.onchange;

    this.canvas.updateBounds();
    this.pixelRatio = HTMLCanvasElement.getDevicePixelScale();
    this.style = {};
    this.style.barThickness = Math.evenFloor(this.canvas.height * 0.25);
    this.style.knobRadius = Math.evenFloor(this.canvas.height * 0.5);
    this.style.barY = Math.evenFloor(this.canvas.height * 0.5);
    this.style.barInset = this.style.knobRadius;
    this.style.barLength = this.canvas.width - (2 * this.style.barInset);

    this.valueScale = { min: this.min, max: this.max };
    this.barScale = { min: this.style.barInset, max: this.canvas.width - this.style.barInset};

    this.canvas.addEventListener("click", function(event) {
        event.preventDefault();
        this.selected(event.offsetX * this.pixelRatio);
    }.bind(this));

    this.canvas.addEventListener("mousemove", function(event) {
        var buttons = event.buttons || event.which;
        if (buttons > 0) {
            event.preventDefault();
            this.selected(event.offsetX * this.pixelRatio);
        }
    }.bind(this));
};

Slider.prototype.setValue = function(newValue) {
    this.value = newValue;
    this.render();
};

Slider.prototype.render = function() {
    var s = this.style;
    var ctx = this.canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    var knobX = Math.scaleValueLinear(this.value, this.valueScale, this.barScale);
    ctx.lineWidth = s.barThickness;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000099";
    ctx.beginPath();
    ctx.moveTo(s.barInset, s.barY);
    ctx.lineTo(knobX, s.barY);
    ctx.stroke();

    ctx.strokeStyle = "#cccccc";
    ctx.beginPath();
    ctx.moveTo(knobX, s.barY);
    ctx.lineTo(this.canvas.width - s.barInset, s.barY);
    ctx.stroke();

    ctx.fillStyle = "#66cc66";
    ctx.beginPath();
    ctx.ellipse(knobX, s.barY, s.knobRadius, s.knobRadius, 0, 2 * Math.PI, false);
    ctx.fill();
};

Slider.prototype.selected = function(x) {
    this.setValue(Math.scaleValueLinear(x, this.barScale, this.valueScale));
    this.onchange(this);
};

// config: {canvas = (elem), tileWidth, tileSpacing, min, max, value, onchange = function(RectSlider)}
// min, max, value are all object: rows, columns
var RectSlider = function(config) {
    this.canvas = config.canvas;
    this.canvasGrid = new CanvasGrid(Object.assign({}, config, config.max));
    this.min = config.min;
    this.max = config.max;
    this.value = config.value;
    this.setValue = function(newValue) {
        this.value = newValue;
        this.render();
    };
    this.onchange = config.onchange;
    this.canvasGrid.initialize(this.canvas);
    this.pixelRatio = HTMLCanvasElement.getDevicePixelScale();

    this.canvas.addEventListener("click", function(event) {
        event.preventDefault();
        this.selected(event.offsetX * this.pixelRatio, event.offsetY * this.pixelRatio);
    }.bind(this));
    this.canvas.addEventListener("mousemove", function(event) {
        var buttons = event.buttons || event.which;
        if (buttons > 0) {
            event.preventDefault();
            this.selected(event.offsetX * this.pixelRatio, event.offsetY * this.pixelRatio);
        }
    }.bind(this));
};

RectSlider.prototype.render = function() { 
    var ctx = this.canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.canvasGrid.visitEachLocation(function (tile, rect) {
        if (this.tileIsInValue(tile)) {
            ctx.fillStyle = "#000099";
        } else if (tile.row < this.min.rows - 1 || tile.column < this.min.columns - 1) {
            ctx.fillStyle = "#dddddd";
        } else {
            ctx.fillStyle = "#cccccc";
        }
        ctx.rectFill(rect);
    }.bind(this));
};

RectSlider.prototype.tileIsInValue = function(tile) {
    return tile.row < this.value.rows && tile.column < this.value.columns;
};

RectSlider.prototype.selected = function(x, y) {
    var tile = this.canvasGrid.tileForPoint(x, y);
    if (tile && tile.row >= this.min.rows - 1 && tile.column >= this.min.columns - 1) {
        this.setValue({ rows: tile.row + 1, columns: tile.column + 1 });
        this.onchange(this);
    }
};

// ----------------------------------------------------------------------

return {
    debugLog: debugLog,
    once: once,
    GameSelector: GameSelector,
    directions: directions,
    Point: Point,
    Rect: Rect,
    Vector: Vector,
    Scene: Scene,
    Easing: Easing,
    Sprite: Sprite,
    Movement: Movement,
    KeyboardState: KeyboardState,
    RunLoop: RunLoop,
    Dispatch: Dispatch,
    DispatchTarget: DispatchTarget,
    FlexCanvasGrid: FlexCanvasGrid,
    CanvasGrid: CanvasGrid,
    Prompt: Prompt,
    Slider: Slider,
    SelectableList: SelectableList,
    RectSlider: RectSlider
};

})(); // end Gaming namespace decl
