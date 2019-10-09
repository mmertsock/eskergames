"use-strict";

function debugLog(msg) { console.log(msg); }
function debugWarn(msg, trace) {
    console.warn(msg);
    if (trace) { console.trace(); }
}

var onceTokens = new Set();
function once(id, block) {
    if (onceTokens.has(id)) { return; }
    debugLog("(once) " + id);
    block();
    onceTokens.add(id);
}

function deserializeAssert(condition, message) {
    if (!!condition) { return; }
    var error = message ? `Deserialization error: ${message}` : "Deserialization error";
    debugWarn(error, true);
    throw new Error(error);
}

Object.isPrimitive = function(o) {
    var type = typeof(o);
    return type == 'boolean' || type == 'number' || type == 'string';
}

Object.forSerialization = function(o) {
    if (typeof(o) == 'undefined') { return null; }
    if (o === undefined || o === null || Object.isPrimitive(o)) { return o; }
    var sz = o.objectForSerialization;
    if (typeof(sz) != 'undefined') { return sz; }
    if (Array.isArray(o)) { return o.map(Object.forSerialization); }
    sz = {};
    Object.getOwnPropertyNames(o).forEach(key => {
        sz[key] = Object.forSerialization(o[key]);
    });
    return sz;
};

String.isEmpty = function(value) {
    return !value || value.length == 0;
};
String.isEmptyOrWhitespace = function(value) {
    return !value || value.trim().length == 0;
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
Array.prototype.clearWithVisitor = function(block) {
    for (let i = this.length - 1; i >= 0; i -= 1) {
        block(this[i], i);
    }
    this.splice(0, this.length);
    return this;
}
Array.prototype.forEachFlat = function(block) {
    for (var i = 0; i < this.length; i += 1) {
        for (var j = 0; j < this[i].length; j += 1) {
            block(this[i][j], i, j);
        }
    }
};
Array.prototype.map2D = function(block) {
    return this.map((row, y) => {
        return row.map((item, x) => block(item, y, x));
    });
};

// Return false if already has value. Adds value and returns true otherwise.
Set.prototype.addIfNotContains = function(value) {
    if (this.has(value)) return false;
    this.add(value);
    return true;
};

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

Element.prototype.configure = function(block) {
    block(this);
    return this;
};

var _testCanvas = document.createElement("canvas");

HTMLCanvasElement.getDevicePixelScale = function() {
    return (window.devicePixelRatio || 1) / (_testCanvas.getContext("2d").webkitBackingStorePixelRatio || 1);
};

HTMLCanvasElement.prototype.rectForFullCanvas = function() {
    return new Gaming.Rect(0, 0, this.width, this.height);
}

HTMLCanvasElement.prototype.updateBounds = function() {
    var cs = getComputedStyle(this);
    var scale = HTMLCanvasElement.getDevicePixelScale();
    this.width = parseInt(cs.width) * scale;
    this.height = parseInt(cs.height) * scale;
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
    var center = rect.center;
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

const _roundRectEllipseStops = {
    right: 0.0,
    down: Math.PI * 0.5,
    left: Math.PI,
    up: Math.PI * 1.5
};
CanvasRenderingContext2D.prototype.roundRect = function(rect, xRadius, yRadius, shouldFill, shouldStroke) {
    this.beginPath();
    let ext = rect.extremes;
    let ellipseExt = rect.inset(xRadius, yRadius).extremes;

    this.moveTo(ext.max.x, ellipseExt.min.y);
    this.lineTo(ext.max.x, ellipseExt.max.y);
    this.ellipse(ellipseExt.max.x, ellipseExt.max.y, xRadius, yRadius, 0, _roundRectEllipseStops.right, _roundRectEllipseStops.down);
    this.lineTo(ellipseExt.min.x, ext.max.y);
    this.ellipse(ellipseExt.min.x, ellipseExt.max.y, xRadius, yRadius, 0, _roundRectEllipseStops.down, _roundRectEllipseStops.left);
    this.lineTo(ext.min.x, ellipseExt.min.y);
    this.ellipse(ellipseExt.min.x, ellipseExt.min.y, xRadius, yRadius, 0, _roundRectEllipseStops.left, _roundRectEllipseStops.up);
    this.lineTo(ellipseExt.max.x, ext.min.y);
    this.ellipse(ellipseExt.max.x, ellipseExt.min.y, xRadius, yRadius, 0, _roundRectEllipseStops.up, _roundRectEllipseStops.right);
    this.closePath();

    if (shouldFill) this.fill();
    if (shouldStroke) this.stroke();
};

window.Mixins = {
    mix: function(prototype, name, func) {
        prototype[name] = prototype[name] || func;
    }
};

// ----------------------------------------------------------------------

window.Gaming = (function() {

const _zeroToOne = { min: 0, max: 1 };

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

class Rng {
    nextUnitFloat() {
        return Math.random();
    }
    nextIntOpenRange(minValue, maxValueExclusive) {
        var r = this.nextUnitFloat() * (maxValueExclusive - minValue);
        return Math.floor(r) + minValue;
    }
    nextFloatOpenRange(minValue, maxValueExclusive) {
        var r = this.nextUnitFloat() * (maxValueExclusive - minValue);
        return r + minValue;
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

class NonSmoothedSequence {
    constructor() { this.lastValue = NaN; }
    get isFull() { return true; }
    get size() { return 1; }
    push(value) { this.lastValue = value; return this.lastValue; }
}

class SmoothedSequence {
    static withWindowSize(size) {
        return (typeof(size) == 'undefined' || size < 2) ? new NonSmoothedSequence() : new SmoothedSequence(size);
    }

    constructor(size) {
        this.values = new CircularArray(size);
    }

    get windowSize() { return this.values.maxLength; }
    get isFull() { return this.values.size == this.values.maxLength; }

    get lastValue() {
        if (this.values.isEmpty) return NaN;
        return this.values.values.reduce((i, j) => i + j) / this.values.size;
    }

    push(value) {
        this.values.push(value);
        return this.lastValue;
    }
}

class PeriodicRandomComponent {
    constructor(config) {
        this.amplitude = Math.abs(config.amplitude);
        this.period = {
            min: Math.max(1, Math.abs(config.period.min)),
            max: Math.max(1, Math.abs(config.period.max))
        };
        this.dx = {
            min: (2 * Math.PI) / this.period.max,
            max: (2 * Math.PI) / this.period.min,
        };
        this.dx.smoothing = SmoothedSequence.withWindowSize(config.smoothing);
        this.dx.smoothing.push(0.5 * (this.dx.min + this.dx.max));
        this.x = typeof(config.x) == 'undefined' ? 0 : config.x;
        this.y = 0;
    }

    nextValue() {
        this.y = Math.sin(this.x) * this.amplitude;
        this.updateDx();
        this.x += this.dx.smoothing.lastValue;
        return this.y;
    }

    updateDx() {
        this.dx.smoothing.push(Rng.shared.nextFloatOpenRange(this.dx.min, this.dx.max));
    }

    get debugDescription() {
        return `<${this.constructor.name} a${this.amplitude} p${this.period.min}-${this.period.max} $${this.dx.smoothing.windowSize > 1 ? this.dx.smoothing.windowSize : "none"}>`;
    }
}

class RandomComponent {
    constructor(config) {
        this.amplitude = Math.abs(config.amplitude);
        this.smoothing = SmoothedSequence.withWindowSize(config.smoothing);
    }

    nextValue() {
        this.smoothing.push(Rng.shared.nextFloatOpenRange(-this.amplitude, this.amplitude));
        return this.smoothing.lastValue;
    }

    get debugDescription() {
        return `<${this.constructor.name} a${this.amplitude} $${this.smoothing.windowSize > 1 ? this.smoothing.windowSize : "none"}>`;
    }
}

class RandomLineGenerator {
    static componentsFromConfig(items) {
        return items.map(config => { let type = Gaming[config.type]; return new type(config); });
    }

    constructor(config) {
        this.min = config.min;
        this.max = config.max;
        this.components = Array.from(config.components);
        const amplitude = this.components.map(i => i.amplitude).reduce((i, j) => i + j);
        this.domain = { min: -amplitude, max: amplitude };
        this.range = { min: this.min, max: this.max };
        this.smoothing = SmoothedSequence.withWindowSize(config.smoothing);
    }

    prefillSmoothing() {
        let iterations = 0;
        while (!this.smoothing.isFull) {
            this.nextValue();
            iterations += 1;
        }
        return iterations;
    }

    get lastValue() { return this.smoothing.lastValue; }

    nextValue() {
        let value = this.components.map(i => i.nextValue()).reduce((i, j) => i + j);
        this.smoothing.push(Math.scaleValueLinear(value, this.domain, this.range));
        return this.smoothing.lastValue;
    }

    get debugDescription() {
        return `<${this.constructor.name} [${this.min},${this.max}] $${this.smoothing.windowSize > 1 ? this.smoothing.windowSize : "none"} comps=${this.components.length} last=${this.lastValue}>`;
    }
}


// constructor doesn't tie this to a specific blob size
// the underlying RandomLineGenerator produces values within an idealized 0...1 domain
// (max is always 1; min is based on the allowed fluxuation specified in the config).
// in makeBlob, you use the RandomLineGenerator, mapped to a polar coordinate space, to 
// produce an ideal -1...1 square blob, then stretch that blob to the specified size
// and quantize into an array of BoolArrays.
class RandomBlobGenerator {
    constructor(config) {
        this.perimeterGenerator = new RandomLineGenerator({
            min: 1 - Math.clamp(config.variance, _zeroToOne),
            max: 1,
            components: config.components,
            smoothing: 0
        });
        this.smoothing = SmoothedSequence.withWindowSize(config.smoothing);
        // debugLog(this);
    }

    // returns a list of Points representing true values.
    // rect origin and size can be non-integral, but the 
    // Points returned are always integral.
    // threshold == 0...1. Minimum coverage needed to mark a tile as true
    // (just calculate this linearly based on difference between polar R value and random r threshold value)
    makeRandomTiles(rect, threshold) {
        let origin = rect.origin;
        let candidateRect = rect.inset(-0.5, -0.5).integral();
        const maxDiameter = Math.max(candidateRect.size.width, candidateRect.size.height);
        const iterations = Math.ceil(maxDiameter * Math.PI);
        let rawValues = new Array(iterations);
        for (let i = 0; i < iterations; i += 1) {
            rawValues[i] = this.perimeterGenerator.nextValue();
        }
        let radiusValues = rawValues.map(i => this.smoothing.push(i));

// blob generation. the smoothing helps ensure the start and endpoints match:
// generate N values normally, then re-smooth the first windowSize-1 values with the last windowSize-1 values.
// so with raw values 2 8 4 3 6 5 9 7
// initial smoothed are 2 5 4.67 5 4.33 4.67 6.67 7.
// the 2 and 5 are not fully smoothed and don't line up with the 7.
// so next, smoothing.push(2) and set item 0 == the new smoothed value (6),
// and also smoothing.push(5) and set item 1 == that value (5.67):
// 6 5.67 4.67 5 4.33 4.67 6.67 7
        const endIterations = this.perimeterGenerator.smoothing.windowSize - 1;
        if (endIterations < rawValues.length - 2) {
            for (let i = 0; i < endIterations; i += 1) {
                radiusValues[i] = this.smoothing.push(rawValues[i]);
            }
        }

        const tileRange = {
            x: { min: candidateRect.x, max: candidateRect.x + candidateRect.width },
            y: { min: candidateRect.y, max: candidateRect.y + candidateRect.height }
        };
        const cartesianRange = { min: -1, max: 1 };
        const maxTheta = 2 * Math.PI;
        const indexRange = { min: 0, max: iterations };
        radiusValues.push(radiusValues[0]);

        // 0 threshold means (pr - 0.5) <= r
        // 0.5 threshold means pr <= r
        // 1 threshold means (pr + 0.5) <= r
        const testOffset = threshold - 0.5;

        // debugLog([radiusValues, candidateRect, candidateRect.allTileCoordinates.length, testOffset, threshold]);
        // var logged = 0;

        return candidateRect.allTileCoordinates.filter(point => {

            // TODO need to offset the point.x/y a little bit here, to allow for non-integer 
            // rect origin. i think we just have tileRange be 0...candidateRect.size rather than 
            // minX...maxX. And also, add a 0.5 offset so you're looking at the center of the 
            // tile rather than the top left corner.
            // The goal here would be for a cartesianPoint value of (0,0) for a tile that's exactly 
            // in the center of an odd-width, odd-height rect. And also tweak the tileRange to get 
            // the the cartesianPoint -1/1 values to be at the true non-integer x/y coordinates of 
            // the actual allowed blob size, to maximize the potential blob size. This may not 
            // be the exact center points of the outer candidate tiles if the origin is non-integer.


            const cartesianPoint = new Vector( // a point in the -1...1 x/y coordinate space
                Math.scaleValueLinear(point.x, tileRange.x, cartesianRange),
                Math.scaleValueLinear(point.y, tileRange.y, cartesianRange)
            );
            const polarPoint = {
                theta: cartesianPoint.theta,
                r: cartesianPoint.magnitude
            };
            const index = Math.clamp(polarPoint.theta * indexRange.max / maxTheta, indexRange);
            const r = 0.5 * (radiusValues[Math.floor(index)] + radiusValues[Math.ceil(index)]);
            const isInside = (polarPoint.r + testOffset) <= r;
            // logged = logged + 1; if (logged < 16) { debugLog({point: point, cartesianPoint: cartesianPoint, polarPoint: polarPoint, index: index, r: r, isInside: isInside, tileRange: tileRange, cartesianRange: cartesianRange}); }
            return isInside;
        });
    }

    makeBlob(size) {
        if (size.width < 1 || size.height < 1) return [];
        const maxDiameter = Math.max(size.width, size.height);
        const iterations = Math.ceil(maxDiameter * Math.PI);
        let rawValues = new Array(iterations);
        for (let i = 0; i < iterations; i += 1) {
            rawValues[i] = this.perimeterGenerator.nextValue();
        }
        let radiusValues = rawValues.map(i => this.smoothing.push(i));

// blob generation. the smoothing helps ensure the start and endpoints match:
// generate N values normally, then re-smooth the first windowSize-1 values with the last windowSize-1 values.
// so with raw values 2 8 4 3 6 5 9 7
// initial smoothed are 2 5 4.67 5 4.33 4.67 6.67 7.
// the 2 and 5 are not fully smoothed and don't line up with the 7.
// so next, smoothing.push(2) and set item 0 == the new smoothed value (6),
// and also smoothing.push(5) and set item 1 == that value (5.67):
// 6 5.67 4.67 5 4.33 4.67 6.67 7
        const endIterations = this.perimeterGenerator.smoothing.windowSize - 1;
        if (endIterations < rawValues.length - 2) {
            for (let i = 0; i < endIterations; i += 1) {
                radiusValues[i] = this.smoothing.push(rawValues[i]);
            }
        }

        // OK now you have a set of radius values. make an array of BoolArrays and quantize
        const tileRect = Rect.withCenter(0, 0, size.width, size.height).integral();
        const ext = tileRect.extremes;
        const cartesianRange = { min: -1, max: 1 };
        const tileRange = {
            x: { min: 0, max: size.width },
            y: { min: 0, max: size.height }
            // x: { min: ext.min.x, max: ext.max.x },
            // y: { min: ext.min.y, max: ext.max.y }
        };
        const maxTheta = 2 * Math.PI;
        const indexRange = { min: 0, max: iterations };

        // Add one extra value so we can round up an array index and get the "wrapped around" value if needed
        radiusValues.push(radiusValues[0]);
        let rows = new Array(size.height);
        for (let i = 0; i < size.height; i += 1) {
            let row = new BoolArray(size.width);
            for (let j = 0; j < size.width; j += 1) {
                const cartesianPoint = new Vector( // a point in the -1...1 x/y coordinate space
                    // possibly an off-by-one error here
                    Math.scaleValueLinear(j, tileRange.x, cartesianRange),
                    Math.scaleValueLinear(i, tileRange.y, cartesianRange)
                    // Math.scaleValueLinear(x, _zeroToOne, cartesianRange),
                    // Math.scaleValueLinear(y, _zeroToOne, cartesianRange)
                );
                const polarPoint = {
                    theta: cartesianPoint.theta,
                    r: cartesianPoint.magnitude
                };
                const index = Math.clamp(polarPoint.theta * indexRange.max / maxTheta, indexRange);
                const r = 0.5 * (radiusValues[Math.floor(index)] + radiusValues[Math.ceil(index)]);
                row.setValue(j, polarPoint.r <= r);
                // debugLog({ cartesianPoint: cartesianPoint, polarPoint: polarPoint, index: index, r: r, value: polarPoint.r <= r });
            }
            rows[i] = row;
        }

        debugLog({ me: this, size: size, maxDiameter: maxDiameter, iterations: iterations, rawValues: rawValues, radiusValues: radiusValues, cartesianRange: cartesianRange, tileRange: tileRange, maxTheta: maxTheta, indexRange: indexRange });
        this.radiusValues = radiusValues;

        return rows;
    }
}

// Uses a RandomLineGenerator projected over polar coordinates 
// to create an ellipse within a rect of the given size.
class RandomBlobGeneratorNONONON {
    constructor(config) {
        // Max width/height of the blob. Each nextBlobe value is a 2D array of this size
        this.size = { width: config.size.width, height: config.size.height };
        // RandomLineGenerator config
        this.smoothing = config.smoothing;
        // RandomLineGenerator config
        this.components = config.components;
        // 0...1. % of diameter. Determines min/max of RandomLineGenerator.
        // 0.1 radiusVariance means blob diameter will be between 90% and 100% of config.size.
        this.radiusVariance = config.radiusVariance;
    }

    get debugDescription() {
        return `<${this.constructor.name} ${this.size.width}x${this.size.height} rv${this.radiusVariance} #t${this.components.length} ${this.smoothing}>`;
    }

    // Array of BoolArray
    nextBlob() {
        let values = [];
        for (var y = 0; y < this.size.height; y += 1) {
            values.push(new BoolArray(this.size.width));
        }



        return values;
    }
}

class RandomLineGeneratorOLD {
    constructor(config) {
        this.style = config.style || "walk";
        this.min = config.min;
        this.max = config.max;
        this.lastValue = typeof(config.value) == 'undefined' ? Rng.shared.nextFloatOpenRange(this.min, this.max) : config.value;
        this.variance = config.variance;
    }

    get variance() { return this._variance; }
    set variance(value) {
        this._variance = Math.clamp(value, { min: 0, max: 1 });
        if (this.style == "walk") {
            this.width = (this.max - this.min) * this._variance;
        } else {
            this.varianceFactor = (1 - this.variance * this.variance)
        }
    }

    nextValue() {
        if (this.style == "walk") {
            var range = {
                min: this.lastValue - 0.5 * this.width,
                max: this.lastValue + 0.5 * this.width
            };
            if (range.min < this.min) { range.min = this.min; range.max = range.min + this.width; }
            else if (range.max > this.max) { range.max = this.max; range.min = range.max - this.width; }
        } else {
            var range = {
                min: this.min + this.varianceFactor * (this.lastValue - this.min),
                max: this.max - this.varianceFactor * (this.max - this.lastValue)
            };
        }
        this.lastValue = Rng.shared.nextFloatOpenRange(range.min, range.max);
        // debugLog([range, this.lastValue]);
        return this.lastValue;
    }
    get debugDescription() {
        return `<${this.constructor.name} [${this.min},${this.max}] ^${this.variance} w${this.width} last=${this.lastValue}>`;
    }
}

class BoolArray {
    constructor(length) {
        this.length = length;
        this.array = new Int8Array(Math.ceil(length / 8));
        this.view = new DataView(this.array.buffer, 0, this.array.length);
    }
    getValue(index) {
        var byte = this.view.getUint8(this._arrayIndex(index));
        return (byte & this._mask(index)) > 0;
    }
    setValue(index, value) {
        var byte = this.view.getUint8(this._arrayIndex(index));
        var oldByte = byte;
        if (value) { byte = byte | this._mask(index); } else { byte = byte & ~this._mask(index); }
        this.view.setUint8(this._arrayIndex(index), byte);
    }
    fill(value) { this.array.fill(0xff); return this; }

    get debugDescription() {
        var bytes = [];
        for (var i = 0; i < this.array.length; i += 1) {
            var value = this.view.getUint8(i).toString(2).padStart(8, "0").split("").reverse().join("");
            if (i == this.array.length - 1) {
                value = value.substring(0, 1 + ((this.length - 1) % 8));
            }
            bytes.push(value);
        }
        return bytes.join(" ");
    }

    _arrayIndex(index) { return Math.floor(index / 8); }
    _mask(index) { return 0x1 << (index % 8); }
}

class CircularArray {
    constructor(maxLength) {
        this.maxLength = maxLength;
        this.items = new Array(maxLength);
        this.reset();
    }

    get isEmpty() {
        return this._oldestIndex < 0;
    }

    get size() {
        if (this._oldestIndex < 0) { return 0; }
        if (this._oldestIndex < this._nextIndex) { return this._nextIndex - this._oldestIndex; }
        return this._nextIndex + (this.maxLength - this._oldestIndex);
    }

    get last() {
        return this.isEmpty ? null : this.items[((this._nextIndex - 1 + this.maxLength) % this.maxLength)];
    }

    get first() {
        return this.isEmpty ? null : this.items[this._oldestIndex];
    }

    get values() {
        let values = [];
        for (let i = 0; i < this.size; i += 1) {
            values.push(this.getValue(i));
        }
        return values;
    }

    getValue(index) {
        let size = this.size;
        if (index < 0 || index >= size) { return undefined; }
        return this.items[(this._oldestIndex + index) % this.maxLength];
    }

    forEach(block) {
        for (let i = 0; i < this.size; i += 1) {
            block(this.getValue(i), i);
        }
    }

    reset() {
        this._nextIndex = 0;
        this._oldestIndex = -1;
    }

    push(value) {
        this.items[this._nextIndex] = value;
        var newIndex = (this._nextIndex + 1) % this.maxLength;
        if (this._oldestIndex < 0) {
            this._oldestIndex = 0;
        } else if (this._oldestIndex == this._nextIndex) {
            this._oldestIndex = newIndex;
        }
        this._nextIndex = newIndex;
    }
}

class Easing {
    static linearCurve(elapsed) { return elapsed; }
    static smoothCurve(elapsed) {
        if (elapsed < 0.5)
            return 2 * elapsed * elapsed;
        else
            return 1 - (2 * (1-elapsed) * (1-elapsed));
    }

    constructor(durationSeconds, valueRange, curveFunc) {
        this.durationMilliseconds = durationSeconds * 1000;
        this.startTimestamp = 0;
        this.valueRange = valueRange;
        this.curveFunc = curveFunc;
    }

    start(timestamp) {
        this.startTimestamp = (typeof(date) == 'undefined') ? Date.now() : timestamp;
        return this;
    }

    get isComplete() { return Date.now() >= (this.startTimestamp + this.durationMilliseconds); }

    get value() {
        return Math.scaleValueLinear(this.curveFunc(this.normalizedTimeElapsed), Easing.zeroToOneRange, this.valueRange);
    }

    get normalizedTimeElapsed() {
        return this.normalizedTimeElapsedFrom(Date.now());
    }

    normalizedTimeElapsedFrom(timestamp) {
        if (this.startTimestamp < 1) return 0;
        if (this.durationMilliseconds < 1) return 1;
        return Math.clamp((timestamp - this.startTimestamp) / this.durationMilliseconds, Easing.zeroToOneRange);
    }
}
Easing.zeroToOneRange = { min: 0, max: 1 };

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

class UndoStack {
    constructor() {
        this.stack = [];
        this.index = 0;
    }

    get redoIndex() { return this.index + 1; }
    get canUndo() { return this.stack.isIndexValid(this.index); }
    get canRedo() { return this.stack.isIndexValid(this.redoIndex); }
    get nextUndoItem() {
        return this.canUndo ? this.stack[this.index] : null;
    }
    get nextRedoItem() {
        return this.canRedo ? this.stack[this.redoIndex] : null;
    }

    push(item) {
        if (this.canRedo) {
            // index points to middle of stack. Remove everything past the index
            this.stack.splice(this.redoIndex, this.stack.length, item);
            this.index += 1;
        } else {
            this.stack.push(item);
            this.index = this.stack.length - 1;
        }
    }

    undo() {
        var item = this.nextUndoItem;
        if (!item) { return false; }
        item.undo();
        this.index -= 1;
        return true;
    }

    redo() {
        var item = this.nextRedoItem;
        if (!item) { return false; }
        item.redo();
        this.index += 1;
        return true;
    }
}

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
directions.opposite = function(id) { return (id + 4) % 8; };
directions.all = [0, 1, 2, 3, 4, 5, 6, 7];
directions.isCardinal = function(id) { return id % 2 == 0 };

class XYValue {
    isEqual(p2, tol) {
        tol = (tol === undefined) ? 0 : 0.01;
        return Math.fequal(this.x, p2.x, tol) && Math.fequal(this.y, p2.y, tol);
    }
    isZero(tol) { return this.isEqual({x: 0, y: 0}, tol); }

    get debugDescription() {
        return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`;
    }

    adding(x, y) {
        if (typeof y === 'undefined') {
            return new this.constructor(this.x + x.x, this.y + x.y);
        } else {
            return new this.constructor(this.x + x, this.y + y);
        }
    }
    
    manhattanDistanceFrom(x, y) {
        if (typeof y === 'undefined') {
            var dx = this.x - x.x; var dy = this.y - x.y;
        } else {
            var dx = this.x - x; var dy = this.y - y;
        }
        return { dx: dx, dy: dy, magnitude: Math.max(Math.abs(dx), Math.abs(dy)) };
    }

    integral() {
        return new this.constructor(Math.round(this.x), Math.round(this.y));
    }
}

class Point extends XYValue {
    static min(p1, p2) {
        return new Point(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y));
    }
    static max(p1, p2) {
        return new Point(Math.max(p1.x, p2.x), Math.max(p1.y, p2.y));
    }

    constructor(x, y) {
        super();
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
    }

    scaled(factor, factorY) {
        return new Point(this.x * factor, this.y * (typeof factorY === 'undefined' ? factor : factorY));
    }
}
Point.zeroConst = new Point();

class Rect {
    constructor(x, y, width, height) {
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
    }

    static withCenter(x, y, width, height) {
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
    }
    static fromExtremes(e) {
        return new Rect(e.min.x, e.min.y, e.max.x - e.min.x, e.max.y - e.min.y);
    }
    static fromDeserializedWrapper(data, schemaVersion) {
        deserializeAssert(Array.isArray(data) && data.length == 4);
        return new Rect(data[0], data[1], data[2], data[3]);
    }

    get objectForSerialization() { return [this.x, this.y, this.width, this.height]; }
    get origin() { return new Point(this.x, this.y); }
    get center() { return new Point(this.x + 0.5 * this.width, this.y + 0.5 * this.height); }
    get size() { return {width: this.width, height: this.height}; }
    get hashValue() { return hashArrayOfInts([this.x, this.y, this.width, this.height]); }
    get extremes() {
        var min = this.origin;
        return {min: min, max: min.adding(this.width, this.height)};
    }
    get debugDescription() {
        return `<rect @(${this.x.toFixed(2)}, ${this.y.toFixed(2)}) sz(${this.width.toFixed(2)}, ${this.height.toFixed(2)})>`;
    }

    isEmpty(tol) { return Math.fequal(this.width, 0, tol) && Math.fequal(this.height, 0, tol); }
    isEqual(r2, tol) {
        tol = (tol === undefined) ? 0 : 0.01;
        return Math.fequal(this.x, r2.x, tol)
            && Math.fequal(this.y, r2.y, tol)
            && Math.fequal(this.width, r2.width, tol)
            && Math.fequal(this.height, r2.height, tol);
    }
    contains(other) {
        var e1 = this.extremes;
        var e2 = other.extremes;
        if (!other || this.isEmpty() || other.isEmpty()) { return false; }
        return e1.min.x <= e2.min.x && e1.max.x >= e2.max.x
            && e1.min.y <= e2.min.y && e1.max.y >= e2.max.y;
    }
    containsTile(x, y) {
        if (typeof y === 'undefined') {
            return x.x >= this.x && x.y >= this.y && x.x < (this.x + this.width) && x.y < (this.y + this.height);
        } else {
            return   x >= this.x &&   y >= this.y &&   x < (this.x + this.width) &&   y < (this.y + this.height);
        }
    }
    union(other) {
        if (!other) { return new Rect(this); }
        if (this.isEmpty()) return other;
        if (other.isEmpty()) return this;
        var e1 = this.extremes;
        var e2 = other.extremes;
        return Rect.fromExtremes({
            min: Point.min(e1.min, e2.min),
            max: Point.max(e1.max, e2.max)
        });
    }
    intersection(other) {
        if (!other || this.isEmpty() || other.isEmpty()) { return new Rect(0, 0, 0, 0); }
        let e1 = this.extremes, e2 = other.extremes;
        return Rect.fromExtremes({
            min: Point.max(e1.min, e2.min),
            max: Point.min(e1.max, e2.max)
        });
    }

    // new Rect(7, 10, 40, 30).intersects(new Rect(0, 40, 90, 10)) produces "true",
    // but expected is false. Why?
    // the top edge of r1 is adjacent to the bottom edge of r2
    // so it's about r1.maxY and r2.minY
    // setting r2.y = 40.0001 makes intersects return false.
    // 7104030: extremes returns min(7 10) max(47 40)
    // 0409010: extremes returns min(0 40) max(90 50)
    // !((e1.min.x > e2.max.x) || (e1.max.x < e2.min.x) || (e1.min.y > e2.max.y) || (e1.max.y < e2.min.y));
    intersects(other) {
        if (!other || this.isEmpty() || other.isEmpty()) { return false; }
        var e1 = this.extremes;
        var e2 = other.extremes;
        return !((e1.min.x >= e2.max.x) || (e1.max.x <= e2.min.x) || (e1.min.y >= e2.max.y) || (e1.max.y <= e2.min.y));
    }
    inset(xInset, yInset) {
        return new Rect(this.x + xInset, this.y + yInset, this.width - 2 * xInset, this.height - 2 * yInset);
    }
    rounded() {
        return new Rect(Math.round(this.x), Math.round(this.y), Math.round(this.width), Math.round(this.height));
    }
    integral() {
        return new Rect(this.origin.integral(), { width: Math.round(this.width), height: Math.round(this.height) });
    }
    clampedPoint(point) {
        let ext = this.extremes;
        return new Point(
            Math.clamp(point.x, {min: ext.min.x, max: ext.max.x - 1}),
            Math.clamp(point.y, {min: ext.min.y, max: ext.max.y - 1}));
    }

    // ordered by row then column
    get allTileCoordinates() {
        var extremes = this.extremes;
        var coords = [];
        for (var y = extremes.min.y; y < extremes.max.y; y += 1) {
            for (var x = extremes.min.x; x < extremes.max.x; x += 1) {
                coords.push(new Point(x, y));
            }
        }
        return coords;
    }
}

class Vector extends XYValue {
    static betweenPoints(a, b) {
        return new Vector(b.x - a.x, b.y - a.y);
    }

    constructor(x, y) {
        super();
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
    }
    scaled(factor, factorY) {
        return new Vector(this.x * factor, this.y * (typeof factorY === 'undefined' ? factor : factorY));
    }
    offsettingPosition(position, scale) {
        if (scale === undefined) { scale = 1; }
        return position.adding(scale * this.x, scale * this.y);
    }
    get magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    get theta() {
        let value = Math.atan2(this.y, this.x);
        return value < 0 ? (2*Math.PI + value) : value;
    }
    unit() {
        var m = this.magnitude;
        if (m < 0.01) { return null; }
        return this.scaled(1 / m);
    }
}

var diag = 0.7071;
Vector.unitsByDirection = [];
Vector.unitsByDirection[directions.N]  = new Vector(0, 1);
Vector.unitsByDirection[directions.NE] = new Vector(diag, diag);
Vector.unitsByDirection[directions.E]  = new Vector(1, 0);
Vector.unitsByDirection[directions.SE] = new Vector(diag, -diag);
Vector.unitsByDirection[directions.S]  = new Vector(0, -1);
Vector.unitsByDirection[directions.SW] = new Vector(-diag, -diag);
Vector.unitsByDirection[directions.W]  = new Vector(-1, 0);
Vector.unitsByDirection[directions.NW] = new Vector(-diag, diag);

Vector.manhattanUnits = [];
Vector.manhattanUnits[directions.N]  = new Vector(0, 1);
Vector.manhattanUnits[directions.NE] = new Vector(1, 1);
Vector.manhattanUnits[directions.E]  = new Vector(1, 0);
Vector.manhattanUnits[directions.SE] = new Vector(1, -1);
Vector.manhattanUnits[directions.S]  = new Vector(0, -1);
Vector.manhattanUnits[directions.SW] = new Vector(-1, -1);
Vector.manhattanUnits[directions.W]  = new Vector(-1, 0);
Vector.manhattanUnits[directions.NW] = new Vector(-1, 1);
Vector.cardinalUnits = [Vector.manhattanUnits[directions.N], Vector.manhattanUnits[directions.E], Vector.manhattanUnits[directions.S], Vector.manhattanUnits[directions.W]];

// possibly for performance:
// var Vector = {
//     make: function(x, y) { return { x: x, y: y }; },
//     scaled: function(v, factor) { return Vector.make(v.x * factor, v.y * factor); },
//     etc.
// };

// ----------------------------------------------------------------------

class PerfTimer {
    constructor(name) {
        this.isEnabled = !!performance;
        this.name = name;
    }
    start() {
        if (!this.isEnabled) { return; }
        performance.mark(`${this.name}.start`);
        return this;
    }
    end() {
        if (!this.isEnabled) { return; }
        performance.mark(`${this.name}.end`);
        return this;
    }
    get summaryInfo() {
        if (!this.isEnabled) { return null; }
        performance.measure(this.name, `${this.name}.start`, `${this.name}.end`);
        var measure = performance.getEntriesByName(this.name)[0];
        performance.clearMarks(this.name);
        performance.clearMeasures(this.name);
        measure = measure ? measure.duration : "?";
        return {
            name: this.name,
            ms: measure
        };
    }

    get summary() {
        var info = this.summaryInfo;
        if (!info) { return "(performance not available)"; }
        return `${info.name}: ${info.ms} ms`;
    }
}

var RunStates = {
    notStarted: 0,
    running: 1,
    paused: 2,
    autoPaused: 3
};

// TODO I guess childRunLoops are obsolete.
// config: {targetFrameRate, id, runWhenPageIsInBackground, childRunLoops: [RunLoop]}
// frameRate values are frames/sec.
// childRunLoops: parent state change propagates to children. Delegates must be registered separately.
// RunLoop delegates are objects with optional functions:
//   processFrame(RunLoop)
//   runLoopWillResume(RunLoop)
//   runLoopDidPause(RunLoop)
//   runLoopDidChange(RunLoop)
var RunLoop = function(config) {
    this.id = config.id;
    this.targetFrameRate = config.targetFrameRate;
    this.targetFrameInterval = 1000 / config.targetFrameRate;
    this.runState = RunStates.notStarted;
    this.started = false;
    this.nextTimeoutID = undefined;
    this.recentFrameStartDates = new CircularArray(100);
    this.recentFrameProcessingTimes = new CircularArray(100);
    this.childRunLoops = (config.childRunLoops === undefined) ? [] : config.childRunLoops;
    if (!config.runWhenPageIsInBackground) {
        document.addEventListener("visibilitychange", this.toggleAutopause.bind(this));
    }
};
Mixins.Gaming.DelegateSet(RunLoop);

RunLoop.prototype.setTargetFrameRate = function(value) {
    this.targetFrameRate = value;
    this.targetFrameInterval = 1000 / this.targetFrameRate;
    this.forEachDelegate(function (d) {
        if (d.runLoopDidChange) {
            d.runLoopDidChange(this);
        }
    }.bind(this));
};

RunLoop.prototype.latestFrameStartTimestamp = function() {
    var last = this.recentFrameStartDates.last;
    return last ? last.getTime() : Date.now();
}

RunLoop.prototype.getRecentFramesPerSecond = function() {
    var seconds = this._getRecentSecondsElapsed();
    return isNaN(seconds) ? NaN : (1000 * this.recentFrameStartDates.size / seconds);
};

RunLoop.prototype.getRecentMillisecondsPerFrame = function() {
    var seconds = this._getRecentSecondsElapsed();
    return isNaN(seconds) ? NaN : (seconds / this.recentFrameStartDates.size);
};

RunLoop.prototype.getProcessingLoad = function() {
    if (this.recentFrameProcessingTimes.size < 5) { return NaN; }
    let totalTime = this.recentFrameStartDates.last - this.recentFrameStartDates.first;
    var processTime = 0;
    // Don't use the most recent time b/c that's not included in the totalTime calculation above
    for (var i = 0; i < this.recentFrameProcessingTimes.size - 1; i += 1) {
        processTime += this.recentFrameProcessingTimes.getValue(i);
    }
    return processTime / totalTime;
};

RunLoop.prototype._getRecentSecondsElapsed = function() {
    if (this.recentFrameStartDates.size < 5) {
        return NaN;
    }
    var seconds = this.recentFrameStartDates.last - this.recentFrameStartDates.first;
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

    // this.childRunLoops.forEach(function (rl) {
    //     rl.resume();
    // });
};

RunLoop.prototype.pause = function(autoPause) {
    if (!this.isRunning()) { return; }
    this.runState = autoPause ? RunStates.autoPaused : RunStates.paused;
    clearTimeout(this.nextTimeoutID);
    this.nextTimeoutID = undefined;
    this.recentFrameStartDates.reset();
    this.recentFrameProcessingTimes.reset();
    this.forEachDelegate(function (d) {
        if (d.runLoopDidPause) {
            d.runLoopDidPause(this);
        }
    }.bind(this));

    // this.childRunLoops.forEach(function (rl) {
    //     rl.pause(autoPause);
    // });
};

RunLoop.prototype.toggleAutopause = function() {
    switch (this.runState) {
        case RunStates.notStarted:
            return;
        case RunStates.running:
            if (document.hidden) { this.pause(true); }
            return;
        case RunStates.paused:
            return;
        case RunStates.autoPaused:
            if (!document.hidden) { this.resume(); }
            return;
    }
};

RunLoop.prototype.scheduleNextFrame = function() {
    if (!this.isRunning()) { return; }
    if (this.nextTimeoutID != undefined) {
        console.warn(`RunLoop ${this.id}'s nextTimeoutID already defined.`);
        return;
    }

    var delay = this.targetFrameInterval;
    var lastDate = this.recentFrameStartDates.last;
    if (lastDate) {
        var delayFromLastFrame = this.targetFrameInterval - (new Date() - lastDate);
        if (delayFromLastFrame < 0.5 * this.targetFrameInterval) {
            // if falling behind, ease back into the target frame rate
            delay = Math.max(0, 0.5 * (delayFromLastFrame + this.targetFrameInterval));
        }
    }
    this.nextTimeoutID = setTimeout(this.processFrame.bind(this), delay);
};

RunLoop.prototype.processFrame = function() {
    this.nextTimeoutID = undefined;
    if (!this.isRunning()) {
        return;
    }
    var start = new Date();
    this.recentFrameStartDates.push(start);
    this.forEachDelegate(function (d) {
        if (d.processFrame) {
            d.processFrame(this);
        }
    }.bind(this));
    this.recentFrameProcessingTimes.push(new Date() - start);
    this.scheduleNextFrame();
};

class SaveStateCollection {
    // these will throw
    static serialize(object) { return object ? JSON.stringify(object) : object; }
    static deserialize(savedString) { return JSON.parse(savedString); }

    // storage: localStorage or sessionStorage
    // namespace: string prefix for storage keys
    constructor(storage, namespace) {
        this.storage = storage;
        this.namespace = namespace;
    }

    // Array of SaveStateSummaryItem objects
    get itemsSortedByLastSaveTime() {
        return this._tryCatch("itemsSortedByLastSaveTime", [], () => {
            var data = SaveStateCollection.deserialize(this.storage.getItem(this._fullNameForKey("summary")));
            if (!data) { return []; }
            data = data.map(wrapper => SaveStateSummaryItem.fromDeserializedWrapper(wrapper));
            data.sort((a, b) => { return b.timestamp - a.timestamp });
            return data;
        });
    }

    // Returns a SaveStateItem
    getItem(id) {
        return this._tryCatch("getItem", null, () => {
            var wrapper = SaveStateCollection.deserialize(this.storage.getItem(this._fullKeyNameForItemID(id)));
            return SaveStateItem.fromDeserializedWrapper(wrapper);
        });
    }

    // Takes a SaveStateItem. Returns SaveStateSummaryItem with updated metadata on success; null on failure
    // metadata is an object of additional info to include with the SaveStateSummary
    saveItem(item, metadata) {
        // save the item
        // if ok, update the summary state (retrieve it, then remove the item with matching ID and insert 
        // a new summary at the top)
        return this._tryCatch("saveItem", null, () => {
            item.timestamp = Date.now();
            var data = SaveStateCollection.serialize(item.serializationWrapper);
            this.storage.setItem(this._fullKeyNameForItemID(item.id), data);
            var summary = new SaveStateSummaryItem(item.id, item.title, item.timestamp, data.length, metadata);
            this._updateSummaryArray(item.id, summary);
            return summary;
        });
    }

    // Takes an item ID. Returns a new SaveStateSummaryItem on success; null on failure
    // duplicateItem(id) {
    //     return this._tryCatch("duplicateItem", null, () => {
    //         var oldItem = this.getItem(id);
    //         if (!oldItem) { return null; }
    //         return this.saveItem(new SaveStateItem(SaveStateItem.newID(), oldItem.title, oldItem.timestamp, oldItem.data));
    //     });
    // }

    // Takes an item ID. Returns true if deleted or already didn't exist; false on failure
    deleteItem(id) {
        return this._tryCatch("deleteItem", false, () => {
            this.storage.removeItem(this._fullKeyNameForItemID(id));
            this._updateSummaryArray(id, null);
            return true;
        });
    }

    _fullNameForKey(name) {
        return this.namespace + "." + name;
    }

    _fullKeyNameForItemID(id) {
        return this._fullNameForKey("item-" + id);
    }

    _updateSummaryArray(idToRemove, newSummaryItem) {
        var items = this.itemsSortedByLastSaveTime;
        if (idToRemove) {
            var index = items.findIndex(item => item.id == idToRemove);
            if (index >= 0) { items.removeItemAtIndex(index); }
            if (newSummaryItem) { items.push(newSummaryItem); }
            var wrapper = items.map(item => item.serializationWrapper);
            this.storage.setItem(this._fullNameForKey("summary"), SaveStateCollection.serialize(wrapper));
        }
    }

    _tryCatch(label, errorResult, block) {
        try {
            return block();
        } catch(e) {
            debugLog(`SaveStateCollection.${label} error: ${e.message}`);
            return errorResult;
        }
    }
}

// Don't create directly. Managed by SaveStateCollection
// Get it as a copy from the SaveStateItem.
// Can use it for game loading menus, etc.
class SaveStateSummaryItem {
    static fromDeserializedWrapper(wrapper) {
        return wrapper ? new SaveStateSummaryItem(wrapper.id, wrapper.title, wrapper.timestamp, wrapper.sizeBytes, wrapper.metadata) : null;
    }

    constructor(id, title, timestamp, sizeBytes, metadata) {
        this.id = id;
        this.title = title;
        this.timestamp = timestamp;
        this.sizeBytes = sizeBytes;
        this.metadata = metadata;
    }

    get serializationWrapper() {
        return { id: this.id, title: this.title, timestamp: this.timestamp, sizeBytes: this.sizeBytes, metadata: this.metadata };
    }
}

class SaveStateItem {
    static newID() { return Rng.shared.nextHexString(16); }

    static fromDeserializedWrapper(wrapper) {
        return wrapper ? new SaveStateItem(wrapper.id, wrapper.title, wrapper.timestamp, wrapper.data) : null;
    }

    // load from collection or prepare to save to collection
    // Timestamp required when loading. When saving, timestamp will be overwritten.
    // data is a JSON-stringify-able object.
    constructor(id, title, timestamp, data) {
        this.id = id;
        this.title = title;
        this.timestamp = timestamp;
        this.data = data;
    }

    get serializationWrapper() {
        return { id: this.id, title: this.title, timestamp: this.timestamp, data: this.data };
    }
}

class Dispatch {
    constructor() {
        this._blocks = {};
        this.totalDispatches = 0;
    }

    addTarget(id, eventName, block) {
        if (!this._blocks[eventName]) {
            this._blocks[eventName] = {};
        }
        this._blocks[eventName][id] = block;
    }

    postEventSync(eventName, info, log) {
        var numNotified = 0;
        var blocks = this._blocks[eventName];
        if (blocks) {
            for (var id of Object.getOwnPropertyNames(blocks)) {
                blocks[id](eventName, info);
                numNotified += 1;
            }
        }
        if (log) {
            debugLog(`Dispatch ${eventName}, targets notified: ${numNotified}`);
        }
        this.totalDispatches += numNotified;
    }

    remove(targetOrID, eventName) {
        if (!targetOrID) { return; }
        var id = targetOrID.id ? targetOrID.id : targetOrID;
        for (var event of Object.getOwnPropertyNames(this._blocks)) {
            if ((typeof(eventName) == 'undefined') || (event == eventName)) {
                delete this._blocks[event][id];
            }
        }
    }
}
Dispatch.shared = new Dispatch();

class Kvo {
    static stopAllObservations(target) {
        if (!target._kvoDT) { return; }
        Dispatch.shared.remove(target._kvoDT);
        target._kvoDT = null;
    }

    static configForClass(item) {
        if (typeof(item.constructor.Kvo) == 'function') {
            return item.constructor.Kvo();
        } else {
            return item.constructor.Kvo ? item.constructor.Kvo : {};
        }
    }

    constructor(item) {
        this._obj = item;
        this._token = 0;
        this.eventName = `${item.constructor.name}.kvo`;
        let config = Kvo.configForClass(item);
        for (var key of Object.getOwnPropertyNames(config)) {
            this[key] = new KvoProperty(this, config[key]);
        }
    }
    get token() { return this._token; }
    addObserver(target, block) {
        if (!target._kvoDT) { target._kvoDT = new DispatchTarget(); }
        target._kvoDT.register(this.eventName, (eventName, item) => {
            if (item === this._obj) { block(item, this); }
        });
        return this;
    }
    notifyChanged(log) {
        this._token += 1;
        Dispatch.shared.postEventSync(this.eventName, this._obj, log);
    }
    getValue() {
        return this._obj;
    }
}

class KvoProperty {
    constructor(kvo, key) {
        this.kvo = kvo;
        this.key = key;
        this.eventName = `${key}.${kvo.eventName}`;
        this._token = 0;
    }
    get token() { return this._token; }
    addObserver(target, block) {
        if (!target._kvoDT) { target._kvoDT = new DispatchTarget(); }
        target._kvoDT.register(this.eventName, (eventName, item) => {
            if (item === this.kvo._obj) { block(item, this); }
        });
        return this;
    }
    notifyChanged(notifyRoot, log) {
        this._token += 1;
        Dispatch.shared.postEventSync(this.eventName, this.kvo._obj, log);
        if (typeof(notifyRoot) === "undefined") { notifyRoot = true; }
        if (notifyRoot) { this.kvo.notifyChanged(log); }
    }
    getValue() {
        return this.kvo._obj[this.key];
    }
    setValue(value, notifyRoot, log) {
        this.kvo._obj[this.key] = value;
        this.notifyChanged(notifyRoot, log);
    }
}

class Binding {
    // config.source: a Kvo or KvoProperty
    // config.target: a KvoProperty or anything with a setValue func
    // config.sourceFormatter: (optional) a func to transform the source kvo value (see default below)
    constructor(config) {
        this.source = config.source;
        this.target = config.target;
        if (config.sourceFormatter) {
            this.sourceFormatter = config.sourceFormatter;
        } else {
            this.sourceFormatter = (value, kvo) => value;
        }
        this._updateTarget();
        this.source.addObserver(this, source => this._updateTarget());
    }

    _updateTarget() {
        this.target.setValue(this.sourceFormatter(this.source.getValue(), this.source));
    }
}

class ChangeTokenBinding {
    static consumeAll(bindings) {
        return bindings.map(item => item.consume()).filter(item => item).length > 0;
    }

    constructor(target, initialHasChange) {
        this.target = target;
        this.last = !!initialHasChange ? NaN : target.token;
    }
    get hasChange() { return this.last != this.target.token; }
    consume() {
        if (!this.hasChange) return false;
        this.last = this.target.token;
        return true;
    }
}

class DispatchTarget {
    constructor(id) {
        DispatchTarget.counter += 1;
        this.id = id || `DispatchTarget-${DispatchTarget.counter}`;
    }
    register(eventName, block) {
        Dispatch.shared.addTarget(this.id, eventName, block);
        return this;
    }
}
DispatchTarget.counter = 0;

// ----------------------------------------------------------------------

// config: {runLoop}
// KeyboardState delegates are objects with optional functions:
//   keyboardStateDidChange(KeyboardState, eventType)
//      eventType = keydown|keyup
//   keyboardStateContinuing(KeyboardState).
var KeyboardState = function(config) {
    this.keyCodesCurrentlyDown = new Set();
    config.runLoop.addDelegate(this);
    document.addEventListener("keydown", e => this.keydown(e));
    document.addEventListener("keyup", e => this.keyup(e));
    window.addEventListener("blur", e => window.setTimeout(() => this.reset(), 250));
    window.addEventListener("focus", e => window.setTimeout(() => this.reset(), 250));
    window.addEventListener("resize", e => window.setTimeout(() => this.reset(), 250));
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

KeyboardState.prototype.reset = function() {
    var oldSize = this.keyCodesCurrentlyDown.size;
    this.keyCodesCurrentlyDown.clear();
};

// ----------------------------------------------------------------------

// Finite plane of square tiles. A defined origin and size.
// Model coordinates have origin at bottom left, screen coordinates 
// have origin at top left.
//
// Left axis: model Y. right axis: screen Y
//  012345
// 4      -1
// 3      0
// 2      1
// 1      2
// 0      3
// -1     4
class TilePlane {
    constructor(size, tileWidth) {
        // width/height of the primary model coordinate space. 1 unit = 1 tile
        this.size = { width: size.width, height: size.height };
        // current number of device pixels per tile.
        this.tileWidth = tileWidth;
        // screen origin (top left) offset, in device pixels.
        this._offset = new Point(0, 0);
        // size, in device pixels, of the rectangle visible on the screen
        this.viewportSize = { width: 0, height: 0 };
    }

    get size() { return this._size; }
    set size(value) {
        this._size = value;
        this._modelBounds = new Rect(0, 0, value.width, value.height);
        this._yMinuend = this._size.height - 1;
        this._drawOrderFactor = Math.min(this._size.width, this._size.height);
    }

    get tileWidth() { return this._tileWidth; }
    set tileWidth(value) {
        this._tileWidth = value;
        this._singleTileSize = { width: this._tileWidth, height: this._tileWidth };
    }

    get viewportSize() { return this._viewport.size; }
    set viewportSize(value) {
        this._viewport = new Rect(0, 0, value.width, value.height);
    }

    get offset() { return this._offset; }
    set offset(value) { this._offset = value.integral(); }

    // ~~~~~~ Conversions of model <==> screen coordinates ~~~~~~
    // Handles any coordinates in or out of the model or screen bounds.
    // Accounts for pixelScale and offset but no concept of a viewport size.

    _flippedModelY(y) { return this._yMinuend - y; }

    // top-left on-screen pixel coordinate of a model coordinate
    screenOriginForModelTile(tile) {
        return tile ? new Point(this._offset.x + (tile.x * this._tileWidth), this._offset.y + (this._flippedModelY(tile.y) * this._tileWidth)) : null;
    }

    screenRectForModelTile(tile) {
        return tile ? new Rect(this.screenOriginForModelTile(tile), this._singleTileSize) : null;
    }

    screenRectForModelRect(rect) {
        if (!rect) return null;
        let origin = this.screenOriginForModelTile(new Point(rect.x, rect.y + rect.height - 1));
        return new Rect(origin, { width: rect.width * this._tileWidth, height: rect.height * this._tileWidth });
    }

    // any point within the visible bounds of a tile map to that model tile,
    // including the top left point (e.g. 0, 0) screen coords will map to the plane's top left model tile
    modelTileForScreenPoint(point) {
        return point ? new Point(Math.floor((point.x - this._offset.x) / this._tileWidth), this._flippedModelY(Math.floor((point.y - this._offset.y) / this._tileWidth))) : null;
    }

    // smallest model rect that fully encompasses every pixel
    // size of the rect returned may vary depending on the alignment of the screen rect's origin to tile boundaries
    modelRectForScreenRect(rect) {
        // simplest approach is probably:
        // convert rect.origin to modelTileForScreenPoint
        // convert the bottom-right of rect to modelTileForScreenPoint
        // make a model rect with those extremes
        if (!rect) return null;
        let modelTopLeft = this.modelTileForScreenPoint(rect.origin);
        let modelBottomRight = this.modelTileForScreenPoint(new Point(rect.origin.x + rect.width - 1, rect.origin.y + rect.height - 1));
        return new Rect(modelTopLeft.x, modelBottomRight.y, modelBottomRight.x - modelTopLeft.x + 1, modelTopLeft.y - modelBottomRight.y + 1);
    }

    // ~~~~~~ Tile painting logic ~~~~~~
    // Produces integers to use for sorting tile coordinates in the order they should be 
    // rendered on screen, to ensure tiles render top to bottom and left to right. Not 
    // guaranteed to produce correct values outside the model bounds (based on this.size)

    drawingOrderIndexForModelTile(tile) {
        tile = new Point(tile.x, this._flippedModelY(tile.y));
        return (tile.x + tile.y) * this._drawOrderFactor + tile.y;
    }

    // assumes rect is non-empty
    drawingOrderIndexForModelRect(rect) {
        rect = new Rect(rect.x, this._flippedModelY(rect.y + rect.height - 1), rect.width, rect.height);
        let y = rect.y + rect.height - 1;
        return (rect.origin.x + y) * this._drawOrderFactor + y;
    }

    // ~~~~~~ Viewport calculations ~~~~~~
    // Calculates visibility of model coordinates within the current
    // viewport size, accounting for tileWidth and offset. Model
    // tile is visible if at least one pixel of it is visible.

    isModelRectVisible(rect) {
        let tileRect = this.screenRectForModelRect(rect);
        return tileRect ? this._viewport.intersects(tileRect) : false;
    }

    get viewportScreenBounds() { return this._viewport; }

    get visibleModelRect() {
        if (this._viewport.width < 1 || this._viewport.height < 1) { return new Rect(0, 0, 0, 0); }
        return this.modelRectForScreenRect(this._viewport);
    }

    // ~~~~~~ Traversal ~~~~~~

    surroundingTiles(tile, diagonally) {
        return (diagonally ? Vector.manhattanUnits : Vector.cardinalUnits)
            .map((v, direction) => {
                let neighbor = tile.adding(v);
                return this._modelBounds.containsTile(neighbor) ? neighbor : null;
            }).filter(i => i != null);
    }

    // filter callback:
    // (tile to filter, valid neighbor, recursion depth (starting at 0), original tile) => bool
    floodFilter(tile, diagonally, filter) {
        return this.floodMap(tile, diagonally, (tile, source, depth, origin) => (filter(tile, source, depth, origin) ? tile : null));
    }

    // Same as floodFilter, but callback returns null for tiles to ignore, and 
    // non-null value to map the tile to otherwise
    floodMap(tile, diagonally, filter) {
        if (!this._modelBounds.containsTile(tile)) return [];
        let traversed = new Set();
        traversed.add(this.drawingOrderIndexForModelTile(tile));
        let tiles = [filter(tile, tile, 0, tile)];
        this._floodMap(traversed, tiles, 1, tile, tile, diagonally, filter);
        return tiles;
    }

    _floodMap(traversed, tiles, depth, source, origin, diagonally, filter) {
        // Breadth-first: filter and add tiles first, then recurse
        this.surroundingTiles(source, diagonally)
            .filter(tile => {
                if (!traversed.addIfNotContains(this.drawingOrderIndexForModelTile(tile))) return false;
                let mapped = filter(tile, source, depth, origin);
                if (!mapped) return false;
                tiles.push(mapped); return true;
            })
            .forEach(tile => this._floodMap(traversed, tiles, depth + 1, tile, origin, diagonally, filter));
    }
}

class CanvasStack {
    static Kvo() { return { "canvasDeviceSize": "_canvasDeviceSize" }; }

    constructor(containerElem, layerCount) {
        this.containerElem = containerElem;
        this.canvases = [];
        this.pixelScale = HTMLCanvasElement.getDevicePixelScale();
        this._updateMetricsDebounceTimeout = null;
        this.kvo = new Kvo(this);

        layerCount = (typeof(layerCount) == 'undefined') ? 0 : layerCount;
        while (this.length < layerCount) {
            this.addCanvas();
        }

        document.defaultView.addEventListener("resize", e => {
            this._updateMetricsDebounced();
        });
        this.updateCanvasDeviceSize();
    }

    get length() { return this.canvases.length; }

    // device pixel size of the canvases
    get canvasDeviceSize() { return this._canvasDeviceSize; }
    updateCanvasDeviceSize() {
        if (this.canvases.length < 1) {
            this.kvo.canvasDeviceSize.setValue({ width: 0, height: 0 });
        } else {
            this.kvo.canvasDeviceSize.setValue({ width: this.canvases[0].width, height: this.canvases[0].height });
        }
    }

    // index 0 == bottom in drawing order
    getCanvas(index) { return this.canvases[index]; }

    get topCanvasIndex() { return this.canvases.length - 1; }
    get topCanvas() { return this.canvases.length > 0 ? this.canvases[this.canvases.length - 1] : null; }

    addCanvas() {
        let canvas = document.createElement("canvas");
        this.containerElem.append(canvas);
        this._updateCanvasMetrics(canvas);
        this.canvases.push(canvas);
        return canvas;
    }

    clear() {
        this.canvases.clearWithVisitor(canvas => {
            canvas.remove();
        });
    }

    _updateMetricsDebounced() {
        if (this._updateMetricsDebounceTimeout) {
            window.clearTimeout(this._updateMetricsDebounceTimeout);
        }
        this._updateMetricsDebounceTimeout = window.setTimeout(() => this._updateMetrics(), 100);
    }

    _updateMetrics() {
        this._updateMetricsDebounceTimeout = null;
        this.canvases.forEach(canvas => this._updateCanvasMetrics(canvas));
    }

    _updateCanvasMetrics(canvas) {
        canvas.width = canvas.clientWidth * this.pixelScale;
        canvas.height = canvas.clientHeight * this.pixelScale;
    }
}

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
    static getDevicePixelScale() { return HTMLCanvasElement.getDevicePixelScale(); }

    constructor(config) {
        this.canvas = config.canvas;
        this.deviceScale = config.deviceScale;
        this.setSize(config);

        this._updateMetricsDebounceTimeout = null;
        document.defaultView.addEventListener("resize", e => {
            this._updateMetricsDebounced();
        });
    }

    setSize(config) {
        // config.tileWidth = width/height of tile squares in model pixels
        // this.tileWidth = raw device pixel size
        this.tileWidth = config.tileWidth * this.deviceScale;
        // px between tiles. Same relation as tileWidth
        this.tileSpacing = config.tileSpacing * this.deviceScale;
        this.updateMetrics();
    }

    _updateMetricsDebounced() {
        if (this._updateMetricsDebounceTimeout) {
            window.clearTimeout(this._updateMetricsDebounceTimeout);
        }
        this._updateMetricsDebounceTimeout = window.setTimeout(() => this.updateMetrics(), 100);
    }

    updateMetrics() {
        this._updateMetricsDebounceTimeout = null;
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

    get canvasDeviceSize() {
        return { width: this.canvas.clientWidth * this.deviceScale, height: this.canvas.clientHeight * this.deviceScale };
    }
    // Device independent size
    get canvasCSSSize() { return { width: this.canvas.clientWidth, height: this.canvas.clientHeight }; }

    // num visible tiles
    get isEmpty() { return this._tilesWide < 1 || this._tilesHigh < 1; }
    get tilesWide() { return this._tilesWide; }
    get tilesHigh() { return this._tilesHigh; }
    get tileSize() { return { width: this._tilesWide, height: this._tilesHigh }; }

    // Canvas model coords covering all visible tiles, minus any unused edge padding.
    get rectForVisibleTiles() { return this._allTilesRect; }
    get rectForAllTiles() { return this._allTilesRect; }
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
}

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
        debugLog("Prompt is already visible; won't show this prompt.");
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

return {
    debugLog: debugLog,
    debugWarn: debugWarn,
    once: once,
    deserializeAssert: deserializeAssert,
    directions: directions,
    Binding: Binding,
    BoolArray: BoolArray,
    CanvasStack: CanvasStack,
    ChangeTokenBinding: ChangeTokenBinding,
    CircularArray: CircularArray,
    Dispatch: Dispatch,
    DispatchTarget: DispatchTarget,
    Easing: Easing,
    FlexCanvasGrid: FlexCanvasGrid,
    KeyboardState: KeyboardState,
    Kvo: Kvo,
    PerfTimer: PerfTimer,
    PeriodicRandomComponent: PeriodicRandomComponent,
    Point: Point,
    Prompt: Prompt,
    RandomComponent: RandomComponent,
    RandomBlobGenerator: RandomBlobGenerator,
    RandomLineGenerator: RandomLineGenerator,
    Rect: Rect,
    Rng: Rng,
    RunLoop: RunLoop,
    SaveStateCollection: SaveStateCollection,
    SaveStateItem: SaveStateItem,
    SelectableList: SelectableList,
    SmoothedSequence: SmoothedSequence,
    TilePlane: TilePlane,
    UndoStack: UndoStack,
    Vector: Vector
};

})(); // end Gaming namespace decl
