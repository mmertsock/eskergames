"use-strict";

window.CitySim = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;

const Binding = Gaming.Binding;
const FlexCanvasGrid = Gaming.FlexCanvasGrid;
const Kvo = Gaming.Kvo;
const Point = Gaming.Point;
const Rect = Gaming.Rect;
const Rng = Gaming.Rng;
const SaveStateCollection = Gaming.SaveStateCollection;
const SaveStateItem = Gaming.SaveStateItem;
const SelectableList = Gaming.SelectableList;
const TilePlane = Gaming.TilePlane;
const Vector = Gaming.Vector;

const GameContent = CitySimContent.GameContent;
const GameScriptEngine = CitySimContent.GameScriptEngine;

// ########################### GLOBAL #######################

var radiansPerDegree = Math.PI / 180;
var _stringTemplateRegexes = {};
var _zeroToOne = { min: 0, max: 1 };

var _runLoopPriorities = {
    gameEngine: -100
};

Rect.prototype.containsTile = function(x, y) {
    if (typeof y === 'undefined') {
        return x.x >= this.x && x.y >= this.y && x.x < (this.x + this.width) && x.y < (this.y + this.height);
    } else {
        return   x >= this.x &&   y >= this.y &&   x < (this.x + this.width) &&   y < (this.y + this.height);
    }
};

// ordered by row then column
Rect.prototype.allTileCoordinates = function() {
    var extremes = this.extremes;
    var coords = [];
    for (var y = extremes.min.y; y < extremes.max.y; y += 1) {
        for (var x = extremes.min.x; x < extremes.max.x; x += 1) {
            coords.push(new Point(x, y));
        }
    }
    return coords;
};

Rect.tileRectWithCenter = function(center, size) {
    var x = (size.width < 2) ? center.x : (center.x - Math.floor(0.5 * size.width));
    var y = (size.height < 2) ? center.y : (center.y - Math.floor(0.5 * size.height));
    return new Rect(x, y, size.width, size.height);
};

// Tries to move (not resize) this rect to be within the given bounds.
// If it doesn't fit, sets origin == bounds.origin.
Rect.prototype.clampedWithinTileBounds = function(bounds) {
    if (bounds.contains(this)) { return this; }
    var myExtremes = this.extremes;
    var theirExtremes = bounds.extremes;
    var dx = 0, dy = 0;
    if (myExtremes.max.x > theirExtremes.max.x) { dx = theirExtremes.max.x - myExtremes.max.x; }
    if (myExtremes.min.x < theirExtremes.min.x) { dx = theirExtremes.min.x - myExtremes.min.x; }
    if (myExtremes.max.y > theirExtremes.max.y) { dy = theirExtremes.max.y - myExtremes.max.y; }
    if (myExtremes.min.y < theirExtremes.min.y) { dy = theirExtremes.min.y - myExtremes.min.y; }
    return new Rect(this.x + dx, this.y + dy, this.width, this.height);
};

String.fromTemplate = function(template, data) {
    if (!template || !data || template.indexOf("<") < 0) { return template; }
    Object.getOwnPropertyNames(data).forEach((pn) => {
        if (!_stringTemplateRegexes[pn]) {
            _stringTemplateRegexes[pn] = new RegExp(`<${pn}>`, "g");
        }
        template = template.replace(_stringTemplateRegexes[pn], data[pn]);
    });
    return template;
};

EventTarget.prototype.addGameCommandEventListener = function(eventType, preventDefault, command, subject) {
    this.addEventListener(eventType, (evt) => {
        if (preventDefault) { evt.preventDefault(); }
        if (!GameScriptEngine.shared) { return; }
        GameScriptEngine.shared.execute(command, subject);
    });
};

// ########################### MODELS #######################

// Zone type IDs
var Z = {
    R: "R", C: "C", I: "I"
};

var Simoleon = {
    symbol: "§",
    format: function(value) {
        return `§${Number.uiInteger(value)}`;
    }
};

Number.uiInteger = function(value) {
    return Number(value).toLocaleString();
};

Number.uiPercent = function(ratio) {
    return Math.round(ratio * 100).toLocaleString() + "%";
};

class SimDate {
    constructor(y, m, d) {
        if (typeof m === 'undefined') {
            // new SimDate(daysSinceEpoch)
            this.value = y;
        } else {
            // new SimDate(year, month, day)
            y = y - SimDate.epochYear;
            this.value = (y * SimDate.daysPerYear) + ((m-1) * SimDate.daysPerMonth) + (d-1);
        }
    }
    get daysSinceEpoch() {
        return this.value;
    }
    get year() {
        return SimDate.epochYear + Math.floor(this.value/SimDate.daysPerYear);
    }
    get month() {
        var daysSinceJan1 = this.value % SimDate.daysPerYear;
        return 1 + Math.floor(daysSinceJan1/SimDate.daysPerMonth);
    }
    get day() {
        return 1 + this.value % SimDate.daysPerMonth;
    }

    adding(interval) {
        return new SimDate(this.value + interval);
    }

    longString() {
        var uiMonth = GameContent.shared.simDate.longMonthStrings[this.month];
        return `${uiMonth} ${this.day}, ${this.year}`;
    }

    mediumString() {
        var uiMonth = GameContent.shared.simDate.longMonthStrings[this.month];
        return `${uiMonth} ${this.year}`;
    }
}
SimDate.daysPerMonth = 30;
SimDate.daysPerYear = 360;
SimDate.monthsPerYear = 12;
SimDate.epochYear = 1900;
SimDate.epoch = new SimDate(0);

class ZoomSelector {
    constructor(value, delegate) {
        this.value = value;
        this.delegate = delegate;
        this._selected = value.isDefault == true;
    }
    get isSelected() { return this._selected; }
    setSelected(value) {
        var fire = value && !this._selected;
        this._selected = value;
        if (fire) { this.delegate.zoomLevelActivated(this.value); }
    }
}

class SpeedSelector {
    constructor(value, delegate, selected) {
        this.value = value;
        this.delegate = delegate;
        this._selected = selected;
    }
    get isSelected() { return this._selected; }
    setSelected(value) {
        var fire = value && !this._selected;
        this._selected = value;
        if (fire) { this.delegate.gameSpeedActivated(this.value); }
    }
}

class RCIValue {
    constructor(r, c, i) {
        this.R = (typeof r === 'undefined') ? 0 : r;
        this.C = (typeof c === 'undefined') ? 0 : c;
        this.I = (typeof i === 'undefined') ? 0 : i;
    }

    adding(other) {
        return new RCIValue(this.R + other.R, this.C + other.C, this.I + other.I);
    }
}

class Zone {
    static settings() { return GameContent.shared.zones; }
    static typeSettings(zoneType) { return GameContent.shared.zones[zoneType]; }

    static newPlot(config) {
        var zone = new Zone({ type: config.type });
        var plot = new Plot({
            bounds: new Rect(config.topLeft, Zone.typeSettings(config.type).plotSize),
            item: zone
        });
        return plot;
    }

    static fromDeserializedWrapper(data, schemaVersion) {
        deserializeAssert(data != null);
        return new Zone({ dz: {
            type: data.type,
            densityLevel: data.densityLevel,
            valueLevel: data.valueLevel
        } });
    }

    constructor(config) {
        if (config.dz) {
            this.type = config.dz.type; // <Z>
            this.densityLevel = config.dz.densityLevel;
            this.valueLevel = config.dz.valueLevel;
        } else {
            this.type = config.type; // <Z>
            this.densityLevel = 0; // Int; see Zone.config.maxDensityLevel
            this.valueLevel = 0; // Int; see Zone.config.maxValueLevel
        }
    }

    get objectForSerialization() {
        return {
            type: this.type,
            densityLevel: this.densityLevel,
            valueLevel: this.valueLevel
        };
    }

    get population() {
        return new RCIValue(0, 0, 0);
    }

    get settings() {
        return Zone.typeSettings(this.type);
    }

    get name() {
        return this.settings.genericName;
    }

    get bulldozeCost() {
        return this.settings.baseBulldozeCost;
    }
}

class TerrainProp {
    static settings() { return GameContent.shared.terrainProps; }
    static typeSettings(plotType) { return GameContent.shared.terrainProps[plotType]; }

    static newPlot(config) {
        var prop = new TerrainProp({ type: config.type });
        var plot = new Plot({
            bounds: new Rect(config.topLeft, TerrainProp.typeSettings(config.type).plotSize),
            item: prop
        });
        return plot;
    }

    static fromDeserializedWrapper(data, schemaVersion) {
        deserializeAssert(data != null);
        return new TerrainProp({ dz: { type: data.type } });
    }

    constructor(config) {
        this.type = config.dz ? config.dz.type : config.type;
    }

    get objectForSerialization() {
        return {
            type: this.type
        };
    }

    get settings() {
        return TerrainProp.typeSettings(this.type);
    }

    get name() {
        return this.settings.genericName;
    }

    get bulldozeCost() {
        return this.settings.bulldozeCost;
    }
}

// a location on the map with a Zone or Building.
// contains the coordinates, pointers to game, finding neighbors,
// calculating land values and stuff, etc.
class Plot {
    static fromDeserializedWrapper(data, schemaVersion) {
        deserializeAssert(data != null);
        return new Plot({ dz: {
            bounds: Rect.fromDeserializedWrapper(data.bounds, schemaVersion),
            item: Plot.deserializerForItemClass(data.itemClass)(data.item, schemaVersion),
            data: data.data
        } });
    }

    static deserializerForItemClass(itemClass) {
        switch (itemClass) {
            case Zone.name: return Zone.fromDeserializedWrapper;
            case TerrainProp.name: return TerrainProp.fromDeserializedWrapper;
            default:
                deserializeAssert(false, `Unknown Prop.itemClass ${itemClass}`);
                return () => undefined;
        }
    }

    constructor(config) {
        if (config.dz) {
            this.bounds = config.dz.bounds;
            this.item = config.dz.item;
            this.data = config.dz.data;
        } else {
            this.bounds = config.bounds; // <Rect>. rect.origin = top-left tile.
            this.item = config.item; // <Zone> or other
            this.data = {
                variantKey: config.bounds.hashValue
            };
        }
    }

    get objectForSerialization() {
        return {
            bounds: this.bounds.objectForSerialization,
            itemClass: this.item.constructor.name,
            item: this.item.objectForSerialization,
            data: {
                variantKey: this.data.variantKey
            }
        };
    }

    get textTemplateInfo() {
        return {
            name: this.item.name,
            type: this.item.type
        };
    }

    get title() {
        return this.item.name;
    }

    get bulldozeCost() {
        return this.item.bulldozeCost || 0;
    }

    isPaintOrigin(point) {
        return (point.x = this.bounds.x)
            && (point.y == this.bounds.y + this.bounds.height - 1);
    }

    canAddToMap(map) {
        if (map.plotsIntersectingRect(this.bounds).length > 0) return false;
        let anyBadTerrain = map.terrainLayer.filterTiles(this.bounds, tile => {
            return tile.type.isWater;
        }).length > 0;
        return !anyBadTerrain;
    }
}

// ########################### MAP/GAME #######################

    /*
performance for 128x128 map:
full edgeVariants array: 350 ms
disabling _edgeVariants and just returning a single hard-coded terrain_x painter with random variantKey: 213 ms
...with zero variantKey (disabling the more complex edge painters): 227 ms.
So, doing 128x128 painters in general seems to be the slow thing. Even using the "blank" landform is 212 ms.
Blank landform, change dirt painter to a single fillrect: 93 ms.
So, I think we need to compile the painters.


TODO try this:
replace ScriptPainter with a hard-coded class that has hard-coded lines of JS for the four rects that the dirt painter paints.
if that performs faster, then the perf bottleneck could be the line parsing that compiled scripts would improve.
if it doesn't, then the perf bottleneck might be the sheer number of canvasrenderingcontext2d commands,
or it could be related to scriptpainterstore stuff, or?
painter.html, the real terrain_dirt: 100 iterations: 61 ms total, 0.61 ms average

hm stubbed ScriptPainter and commented out *all* stuff in render(), and still got 64 ms total for 100 iterations.
So the perf test in painter.html seems to show a *lot* of overhead that is completely outside of ScriptPainter.render.
ok the checker background was most of the time.

properly optimized perf test (no checkered background stuff):
1-3 ms total, 0.01-0.03 ms avg for a fully stubbed out empty ScriptPainter.
6-8 ms total, 0.06-0.08 ms avg for a fully hard-coded terrain_dirt painter
10-13 ms total, 0.10-0.13 ms avg for the current dynamic line-parsing terrain_dirt painter.
...which could easily add up to a couple of seconds for a 128x128 map.
Goal is < 16 ms to render an entire 128x128 map, which means 
1600 ms for 16384 iterations or 0.1 ms for 100 iteration perf test.
or 1 ms for 1000 iteration perf test for more precision.
softer goal: maybe render 64x64 at 60 fps, which means 4 ms for 1000 iterations.

oh also the iterations was inaccurate bc it was rendering to 3 canvases. fixing that.

Getting 30 ms for 1000 iterations of full dynamic terrain_dirt ScriptPainter. OOOOF
Need to get it to 13% that time, aka 87% reduction, aka 8x faster, for minimum goal.
20 ms for hard-coded terrain_dirt: so compiling may give 67% time, 33% reduction, 1.5x faster.

back to terrain and edgeVariants and stuff. hard-coded stub ScriptPainter:
- 230 ms with full _edgeVariants calculation and painting
- 215 ms with _edgeVariants calculation but then hard-code 2 variants
- 120 ms with 2 hard-coded variants
- 150 ms with single hard-coded variant0 (_edgeVariants call avoided entirely).
So, the number of painters isn't a big difference at this point.

The edgeVariants calculation itself is definitely a big thing. So pre-calculating should make a big difference.
Could calculate and cache once per tile on the fly. No need to store it in the save state.
Caching edgeVariants value in TerrainTile: 257 ms -> 206 ms.

Main bottleneck still seems to be the painting itself.
Which means, need to focus on:
- more efficient painting primitives
- painting only the tiles needed, when needed

Note that if it weren't for animation, could render the entire terrain to a static image.
With animation, if total unique number of frames is small, could cache each possible frame on the fly 
to a static image.
Caching an entire 128x128 canvas offscreen: 2ms render time for the whole thing.
So yeah that's a nice way to avoid the performance problem for now.

Next steps:
map/terrain thing is getting hacky and messy.
Start over with a new map class and just throw out the old one.


TRY: following the optimization strategies here https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

TODO read https://developer.mozilla.org/en-US/docs/Games/Techniques/Tilemaps

    */

class TerrainType {
    static fromDeserializedWrapper(data, schemaVersion) {
        let existing = TerrainType.all[data];
        return existing || new TerrainType(data);
    }

    constructor(value) {
        this.value = value; // byte
    }
    get debugDescription() { return this.value.toString(16); }
    get objectForSerialization() { return this.value; }
    get isLand() { return (this.value & TerrainType.flags.water) == 0; }
    get isWater() { return (this.value & TerrainType.flags.water) != 0; }
    get isSaltwater() { return this.isWater && (this.value & TerrainType.flags.large); }
    get isFreshwater() { return this.isWater && !(this.value & TerrainType.flags.large); }
    has(flag) { return (this.value & flag) != 0; }
}
TerrainType.flags = {
    dirt:      0x0,
    water:     0x1 << 0,
    trees:     0x1 << 1,
    reserved1: 0x1 << 2,
    large:     0x1 << 3,
    deep:      0x1 << 4,
    edge:      0x1 << 5,
    reserved2: 0x1 << 6,
    reserved3: 0x1 << 7
};

TerrainType.dirt  = new TerrainType(TerrainType.flags.dirt);
TerrainType.water = new TerrainType(TerrainType.flags.water);
TerrainType.trees = new TerrainType(TerrainType.flags.trees);
// freshwater variants
TerrainType.riverbank = new TerrainType(TerrainType.flags.water | TerrainType.flags.edge);
// saltwater variants
TerrainType.shore = new TerrainType(TerrainType.flags.water | TerrainType.flags.large | TerrainType.flags.edge);
TerrainType.sea   = new TerrainType(TerrainType.flags.water | TerrainType.flags.large);
TerrainType.ocean = new TerrainType(TerrainType.flags.water | TerrainType.flags.large | TerrainType.flags.deep);
// trees variants
TerrainType.forest     = new TerrainType(TerrainType.flags.trees | TerrainType.flags.large);
TerrainType.forestEdge = new TerrainType(TerrainType.flags.trees | TerrainType.flags.larg | TerrainType.flags.edge);
TerrainType.wilderness = new TerrainType(TerrainType.flags.trees | TerrainType.flags.large | TerrainType.flags.deep);
TerrainType.all = new Array(256);
[
    TerrainType.dirt, TerrainType.water, TerrainType.trees,
    TerrainType.riverbank,
    TerrainType.shore, TerrainType.sea, TerrainType.ocean,
    TerrainType.forest, TerrainType.forestEdge, TerrainType.wilderness
].forEach(item => { TerrainType.all[item.value] = item; });

// An editable terrain file and a source for initializing a CityMap. 
// Same ownership level and responsibilities as the City object.
class Terrain {

    static settings() { return GameContent.shared.terrain; }
    static sizeOrDefaultForIndex(index) { return GameContent.itemOrDefaultFromArray(Terrain.settings().sizes, index); }
    static defaultSize() { return GameContent.defaultItemFromArray(Terrain.settings().sizes); }

    static indexForTerrainSize(terrain) {
        let defaultIndex = 0;
        let size = terrain ? terrain.size : null;
        let sizes = Terrain.settings().sizes;
        for (let i = 0; i < sizes.length; i += 1) {
            let item = sizes[i];
            if (size != null && item.width == size.width && item.height == size.height) { return item.index; }
            if (item.isDefault) { defaultIndex = item.index; }
        };
        return defaultIndex;
    }

    static kmForTileCount(tiles) {
        return (Terrain.settings().metersPerTile * tiles) / 1000;
    }

    static loadFromStorage(storage, id) {
        let data = storage.terrainCollection.getItem(id);
        if (!data) {
            throw new Error(Strings.str("failedToFindFileMessage"));
        } else if (!storage.isSaveStateItemSupported(data)) {
            throw new Error(Strings.str("failedToLoadTerrainMessage"));
        } else {
            return Terrain.fromDeserializedWrapper(data);
        }
    }

    static fromDeserializedWrapper(item) {
        deserializeAssert(item.data);
        return new Terrain({ dz: {
            saveStateInfo: { id: item.id, lastTimestamp: Date.now() },
            name: item.data.name,
            map: CityMap.fromDeserializedWrapper(item.data.map, item.data.schemaVersion)
        } });
    }

    constructor(config) {
        if (config.dz) {
            this.saveStateInfo = config.dz.saveStateInfo;
            this.name = config.dz.name;
            this.map = config.dz.map;
        } else {
            this.name = config.name;
            this.saveStateInfo = { id: null, lastTimestamp: 0 };
            this.map = config.map; // CityMap
        }
    }

    saveToStorage() {
        this.saveStateInfo.lastTimestamp = Date.now();
        var title = `${this.name}.ter`; // TODO cooler, possibly unique filename
        var item = new SaveStateItem(this.saveStateInfo.id || SaveStateItem.newID(), title, this.saveStateInfo.lastTimestamp, this.objectForSerialization);
        var saved = GameStorage.shared.terrainCollection.saveItem(item, this.metadataForSerialization);
        if (saved) {
            this.saveStateInfo.id = saved.id;
            this.saveStateInfo.lastTimestamp = saved.timestamp;
            debugLog(`Saved terrain to storage with id ${saved.id}.`);
            return true;
        } else {
            debugWarn(`Failed to save terrain to storage.`);
            return false;
        }
    }

    get size() { return this.map.size; }

    get metadataForSerialization() {
        let metrics = this.metrics;
        let landform = Strings.template("terrainMetricsTemplate", { water: Number.uiPercent(metrics.water), trees: Number.uiPercent(metrics.trees) });
        return {
            schemaVersion: GameStorage.currentSchemaVersion,
            name: this.name,
            size: `${this.map.size.width}x${this.map.size.height}`,
            landform: landform
        };
    }

    get objectForSerialization() {
        return {
            schemaVersion: GameStorage.currentSchemaVersion,
            name: this.name,
            map: this.map.objectForSerialization
        };
    }

    get debugDescription() {
        return `<Terrain ${this.map.debugDescription}>`;
    }

    get metrics() {
        let total = this.size.width * this.size.height, water = 0, trees = 0;
        this.map.terrainLayer.visitTiles(null, tile => {
            if (tile.type.isWater) { water += 1; }
            if (tile.type.has(TerrainType.flags.trees)) { trees += 1; }
        });
        return { water: water / total, trees: trees / total };
    }
}

class MapTile {
    constructor(point, layer) {
        this.point = point;
        this.layer = layer;
    }

    get debugDescription() { return `<${this.constructor.name} @(${x},${y})>`; }
    get textTemplateInfo() { return {}; }
}

class TerrainTile extends MapTile {
    static fromDeserializedWrapper(data, schemaVersion, point, layer) {
        let tile = new TerrainTile(point, layer)
        tile._type = TerrainType.fromDeserializedWrapper(data, schemaVersion);
        return tile;
    }

    constructor(point, layer) {
        super(point, layer);
        this._type = TerrainType.dirt;
        this._painterInfoList = null;
    }

    get objectForSerialization() {
        return this.type.objectForSerialization;
    }

    get debugDescription() { return `<${this.constructor.name}#${this.type.debugDescription} @(${x},${y})>`; }

    get type() { return this._type; }
    set type(value) {
        this._type = value;
        this.reset();
    }

    get painterInfoList() {
        if (this._painterInfoList) { return this._painterInfoList; }
        this._painterInfoList = this._makePainterInfoList();
        return this._painterInfoList;
    }

    reset() { this._painterInfoList = null; }

    _makePainterInfoList() {
        if (this._type.isSaltwater) {
            // return [{ id: "terrain_saltwater", variantKey: 0 }];
            return this._edgeVariants("saltwater", i => i.tile.type.isLand);
        } else if (this._type.isFreshwater) {
            // return [{ id: "terrain_freshwater", variantKey: 0 }];
            return this._edgeVariants("freshwater", i => i.tile.type.isLand);
        } else if (this._type.has(TerrainType.flags.trees)) {
            // return [{ id: "terrain_trees", variantKey: 0 }];
            return this._edgeVariants("trees", i => !i.tile.type.has(TerrainType.flags.trees));
        } else {
            return [{ id: "terrain_dirt", variantKey: hashArrayOfInts([this.point.x, this.point.y]) }];
        }
    }

    _edgeVariants(id, filter) {
        // i think the rule is that diagonals should only be used if:
        // BOTH of the adjacent cardinal edges are found (eg inside corner)
        // or NEITHER of the adjacent cardinal edges are found (eg outside corner)
        // if we do that, this should clean up some things
        id = "terrain_" + id;
        let surrounding = this.layer.getSurroundingTiles(this.point).filter(filter);
        let firstBatch = [], secondBatch = [];
        for (let i = 0; i < surrounding.length; i += 1) {
            if (surrounding[i].direction % 2 == 1) { // diagonal
                firstBatch.push(surrounding[i].direction + 1);
            } else {
                secondBatch.push(surrounding[i].direction + 1);
            }
        }
        var variants = [0].concat(firstBatch).concat(secondBatch)
            .map(i => { return { id: id, variantKey: i } });
        // return [{ id: id, variantKey: 0 }, { id: id, variantKey: 1 }];
        return variants;
    }
}

class PlotTile extends MapTile {
    static fromDeserializedWrapper(data, schemaVersion, point, layer) {
        return new PlotTile(point, layer);
    }

    constructor(point, layer) {
        super(point, layer);
        this._plot = null;
        this.isPaintOrigin = false;
    }

    get plot() { return this._plot; }
    set plot(value) {
        this._plot = value;
        this.isPaintOrigin = value ? value.isPaintOrigin(this.point) : false;
    }

    get objectForSerialization() { return 0; }
}

// Closely managed by CityMap
class MapLayer {
    static fromDeserializedWrapper(data, schemaVersion, config) {
        deserializeAssert(Array.isArray(data.tiles));
        return new MapLayer(config, {
            schemaVersion: schemaVersion,
            tiles: data.tiles
        });
        let tile = new TerrainTile(point, layer)
        tile._type = TerrainType.fromValue(data);
        return tile;
    }

    constructor(config, dz) {
        this.map = config.map;
        this.id = config.id;
        this.size = config.map.size;
        this._tiles = new Array(this.size.height);
        for (let y = 0; y < this.size.height; y += 1) {
            let row = new Array(this.size.width);
            for (let x = 0; x < this.size.width; x += 1) {
                if (dz) {
                    row[x] = config.tileClass.fromDeserializedWrapper(dz.tiles[y][x], dz.schemaVersion, new Point(x, y), this);
                } else {
                    row[x] = new config.tileClass(new Point(x, y), this);
                }
            }
            this._tiles[y] = row;
        }
    }

    get objectForSerialization() {
        return { tiles: this._tiles.map2D(tile => tile.objectForSerialization) };
    }

    getTileAtPoint(point) { return this._tiles[point.y][point.x]; }

    // visits in draw order
    // rect is optional. only visits tiles in the given rect
    visitTiles(rect, block) {
        let bounds = new Rect(0, 0, this.size.width, this.size.height);
        rect = rect ? rect.intersection(bounds) : bounds;
        for (let y = rect.y + rect.height - 1; y >= rect.y; y -= 1) {
            for (let x = rect.x; x < rect.x + rect.width; x += 1) {
                block(this._tiles[y][x]);
            }
        }
    }

    filterTiles(rect, filter) {
        let tiles = [];
        this.visitTiles(rect, tile => { if (filter(tile)) { tiles.push(tile); } });
        return tiles;
    }

    getSurroundingTiles(point) {
        return Vector.manhattanUnits.map((v, direction) => {
            var p = point.adding(v);
            if (!this.map.isValidCoordinate(p)) {
                return null;
            } else {
                return { direction: direction, point: p, tile: this._tiles[p.y][p.x] };
            }
        }).filter(i => i != null);
    }
}
MapLayer.id = { terrain: "terrain", plots: "plots" };

class CityMap {
    static fromDeserializedWrapper(data, schemaVersion) {
        deserializeAssert(data != null);
        deserializeAssert(data.size != null || data.terrainLayer != null);
        return new CityMap({dz: {
            size: data.size,
            schemaVersion: schemaVersion,
            terrainLayer: data.terrainLayer
        }});
    }

    constructor(config) {
        let size = config.dz ? config.dz.size : config.size;
        this.size = size;
        this.bounds = new Rect(new Point(0, 0), this.size);
        this.tilePlane = new TilePlane(this.size);
        this.plotLayer = new MapLayer({ map: this, id: MapLayer.id.plots, tileClass: PlotTile });

        let terrainConfig = { map: this, id: MapLayer.id.terrain, tileClass: TerrainTile };
        if (config.dz) {
            this.terrainLayer = MapLayer.fromDeserializedWrapper(config.dz.terrainLayer, config.dz.schemaVersion, terrainConfig);
        } else {
            this.terrainLayer = new MapLayer(terrainConfig);
        }
        this.plotLayer = new MapLayer({ map: this, id: MapLayer.id.plots, tileClass: PlotTile });
        this._updateTerrainInfo();
    }

    get objectForSerialization() {
        return {
            size: this.size,
            terrainLayer: this.terrainLayer.objectForSerialization
        };
    }

    get debugDescription() {
        return `<CityMap ${this.size.width}x${this.size.height} with 0 plots>`;
    }

    isValidCoordinate(x, y) { return this.bounds.containsTile(x, y); }
    isTileRectWithinBounds(rect) { return this.bounds.contains(rect); }

    modifyTerrain(tiles) {
        tiles.forEachFlat(tile => {
            this.terrainLayer.getTileAtPoint(tile.point).type = tile.type;
        });
        this._updateTerrainInfo();
    }

    plotAtTile(point) {
        let tile = this.plotLayer.getTileAtPoint(point);
        return tile ? tile.plot : null;
    }

    plotsIntersectingRect(rect) {
        let plots = [];
        this.plotLayer.visitTiles(rect, tile => {
            if (tile.plot && !plots.contains(tile)) { plots.push(tile.plot); }
        });
        return plots;
    }

    addPlot(plot, fromFile) {
        if (!this.isTileRectWithinBounds(plot.bounds)) {
            debugLog(`Plot is outside of map bounds: ${plot.bounds.debugDescription}`);
            return null;
        }
        if (!plot.canAddToMap(this)) {
            debugLog(`Cannot add plot at ${plot.bounds.debugDescription}`);
            return null;
        }
        // let index = this._plots.push(plot) - 1;
        this.plotLayer.visitTiles(plot.bounds, tile => { tile.plot = plot; });
        if (!fromFile) { debugLog(`Added plot ${plot.title} at ${plot.bounds.debugDescription}`); }
        return plot;
    }

    removePlot(plot) {
        this.plotLayer.visitTiles(plot.bounds, tile => { tile.plot = null; });
    }

    visitEachPlotTile(block) {
        this.plotLayer.visitTiles(null, tile => {
            if (tile.isPaintOrigin) block(tile.plot);
        });
    }

    _updateTerrainInfo() {
        debugLog("TODO recalculate stuff in the terrain layer")
    }
}

class CityTime {
    static fromDeserializedWrapper(data, schemaVersion) {
        deserializeAssert(data != null);
        deserializeAssert(data.dateDaysSinceEpoch >= 0);
        var time = new CityTime();
        time.speed = Game.speedOrDefaultForIndex(data.speedIndex);
        debugLog([data, time.speed, Game.rules().speeds]);
        time.date = new SimDate(data.dateDaysSinceEpoch);
        return time;
    }

    constructor() {
        this.speed = Game.defaultSpeed();
        this.date = SimDate.epoch;
        this.kvo = new Kvo(this);
    }

    get objectForSerialization() {
        return {
            speedIndex: this.speed.index,
            dateDaysSinceEpoch: this.date.daysSinceEpoch
        };
    }

    setSpeed(newSpeed) {
        this.kvo.speed.setValue(newSpeed);
    }
    incrementDay() {
        this.kvo.date.setValue(this.date.adding(1));
    }
}
CityTime.Kvo = { "speed": "speed", "date": "date" };

class City {
    static fromDeserializedWrapper(data, schemaVersion) {
        deserializeAssert(data != null, "City object required");
        return new City({ dz: {
            difficultyIndex: data.difficultyIndex,
            name: data.name,
            mayorName: data.mayorName,
            time: CityTime.fromDeserializedWrapper(data.time, schemaVersion),
            budget: Budget.fromDeserializedWrapper(data.budget, schemaVersion),
            map: CityMap.fromDeserializedWrapper(data.map, schemaVersion)
        } });
    }

    constructor(config) {
        if (config.dz) {
            this.difficulty = Game.difficultyOrDefaultForIndex(config.dz.difficultyIndex);
            this.name = config.dz.name;
            this.mayorName = config.dz.mayorName;
            this.time = config.dz.time;
            this.budget = config.dz.budget;
            this.map = config.dz.map;
        } else {
            this.difficulty = config.difficulty;
            this.name = config.name;
            this.mayorName = config.mayorName;
            this.time = new CityTime();
            this.budget = new Budget({ startingCash: config.difficulty.startingCash });
            this.map = config.terrain.map;
        }

        this.kvo = new Kvo(this);
        this._updateStateAfterOneDay();
    }

    get objectForSerialization() {
        return {
            difficultyIndex: this.difficulty.index,
            name: this.name,
            mayorName: this.mayorName,
            time: this.time.objectForSerialization,
            budget: this.budget.objectForSerialization,
            map: this.map.objectForSerialization
        };
    }

    get population() { return this._population; }
    get rciDemand() { return this._rciDemand; }

    spend(simoleons) {
        return this.budget.spend(simoleons);
    }

    plopPlot(plot) {
        return this.map.addPlot(plot);
    }

    destroyPlot(plot) {
        return this.map.removePlot(plot);
    }

    simulateOneDay() {
        this.time.incrementDay();
        this._updateStateAfterOneDay();
    }

    _updateStateAfterOneDay() {
        this._updatePopulation();
        this._updateRCI();
    }

    _updatePopulation() {
        let pop = new RCIValue(0, 0, 0);
        this.map.visitEachPlot(plot => {
            let plotPop = plot.item.population;
            if (plotPop) {
                pop = pop.adding(plotPop);
            }
        });
        this.kvo.population.setValue(pop);
    }

    _updateRCI() {
        this.kvo.rciDemand.setValue(new RCIValue(0.7, -0.1, 0.3));
    }
}
City.Kvo = { name: "name", population: "_population", rciDemand: "_rciDemand" };

class Budget {
    static fromDeserializedWrapper(data, schemaVersion) {
        deserializeAssert(data != null);
        var cash = Number.parseInt(data.cash);
        deserializeAssert(!isNaN(cash));
        return new Budget({ dz: { cash: cash } });
    }

    constructor(config) {
        this.cash = config.dz ? config.dz.cash : config.startingCash;
        this.kvo = new Kvo(this);
    }

    get objectForSerialization() {
        return {
            cash: this.cash
        };
    }

    spend(simoleons) {
        simoleons = Math.round(simoleons);
        if (this.cash >= simoleons) {
            this.kvo.cash.setValue(this.cash - simoleons);
            return true;
        } else {
            return false;
        }
    }
}
Budget.Kvo = { cash: "cash" };

class GameStorage {
    constructor() {
        this.gameCollection = new SaveStateCollection(window.localStorage, "CitySim");
        this.terrainCollection = new SaveStateCollection(window.localStorage, "CitySimTerrain");
    }

    get latestSavedGameID() {
        var valid = this.allSavedGames.filter(game => this.isSaveStateSummarySupported(game));
        return valid.length > 0 ? valid[0].id : null;
    }

    get allSavedGames() { return this.gameCollection.itemsSortedByLastSaveTime; }
    get allSavedTerrains() { return this.terrainCollection.itemsSortedByLastSaveTime; }

    isSaveStateSummarySupported(item) {
        return item && item.metadata && item.metadata.schemaVersion && item.metadata.schemaVersion >= GameStorage.minSchemaVersion;
    }

    isSaveStateItemSupported(item) {
        return item && item.data && item.data.schemaVersion && item.data.schemaVersion >= GameStorage.minSchemaVersion;
    }

    urlForGameID(id) {
        var base = window.location.href.replace("index.html", "");
        var path = `city.html?id=${id}`;
        return new URL(path, base).href;
    }

    urlForNewGameWithTerrainID(id) {
        let base = window.location.href.replace("index.html", "");
        let path = `city.html?new=1&terrain=${id}`;
        return new URL(path, base).href;
    }

    urlForTerrainID(id) {
        var base = window.location.href.replace("index.html", "");
        var path = `terrain.html?id=${id}`;
        return new URL(path, base).href;
    }
}
GameStorage.shared = new GameStorage();
GameStorage.currentSchemaVersion = 1;
GameStorage.minSchemaVersion = 1;

class Game {
    static quit(prompt) {
        if (!prompt || confirm(Strings.str("quitGameConfirmPrompt"))) {
            window.location = "index.html";
        }
    }

    static autoSaveEnabled() { return false; }
    static rules() { return GameContent.shared.gameRules; }
    static speedOrDefaultForIndex(index) { return GameContent.itemOrDefaultFromArray(Game.rules().speeds, index); }
    static defaultSpeed() { return GameContent.defaultItemFromArray(Game.rules().speeds); }

    static difficultyOrDefaultForIndex(index) { return GameContent.itemOrDefaultFromArray(Game.rules().difficulties, index); }
    static defaultDifficulty() { return GameContent.defaultItemFromArray(Game.rules().difficulties); }

    static fromDeserializedWrapper(item, rootView) {
        deserializeAssert(item.data);
        var city = City.fromDeserializedWrapper(item.data.city, item.data.schemaVersion);
        return new Game({ dz: {
            saveStateInfo: { id: item.id, lastTimestamp: Date.now() },
            rootView: rootView,
            city: city
        } });
    }

    constructor(config) {
        if (config.dz) {
            this.saveStateInfo = config.dz.saveStateInfo;
            this.rootView = config.dz.rootView;
            this.city = config.dz.city;
        } else {
            this.saveStateInfo = {
                id: null,
                lastTimestamp: 0
            };
            this.rootView = config.rootView;
            this.city = config.city;
        }
        var speeds = Game.rules().speeds.map((s) => new SpeedSelector(s, this, s.index == this.city.time.speed.index));
        this.speedSelection = new SelectableList(speeds);
        this._started = false;
    }

    saveToStorage() {
        this.saveStateInfo.lastTimestamp = Date.now();
        var title = `${this.city.name}.cty`; // TODO cooler, possibly unique filename
        var item = new SaveStateItem(this.saveStateInfo.id || SaveStateItem.newID(), title, this.saveStateInfo.lastTimestamp, this.objectForSerialization);
        var saved = GameStorage.shared.gameCollection.saveItem(item, this.metadataForSerialization);
        if (saved) {
            this.saveStateInfo.id = saved.id;
            this.saveStateInfo.lastTimestamp = saved.timestamp;
            debugLog(`Saved game to storage with id ${saved.id}.`);
            return true;
        } else {
            debugWarn(`Failed to save game to storage.`);
            return false;
        }
    }

    get metadataForSerialization() {
        return {
            schemaVersion: GameStorage.currentSchemaVersion,
            cityName: this.city.name,
            population: Number.uiInteger(this.city.population.R),
            cash: Simoleon.format(this.city.budget.cash),
            gameDate: this.city.time.date.mediumString()
        };
    }

    get objectForSerialization() {
        return {
            schemaVersion: GameStorage.currentSchemaVersion,
            city: this.city.objectForSerialization
        };
    }

    get isStarted() {
        return this._started;
    }
    get isRunning() {
        return this._started && engineRunLoop.isRunning();
    }

    get engineSpeed() {
        return this.speedSelection.selectedItem.value;
    }

    start() {
        this._configureCommmands();
        KeyInputController.shared.initialize(this);
        this.gameSpeedActivated(this.engineSpeed);
        this.rootView.initialize(this);
        this._started = true;
        debugLog(`Started game with city ${this.city.name} @ ${this.city.time.date.longString()}, map ${this.city.map.size.width}x${this.city.map.size.height}`);

        engineRunLoop.addDelegate(this);
        uiRunLoop.addDelegate(this);
        uiRunLoop.resume();
        GameScriptEngine.shared.execute("_beginGame", this);
    }

    pause() {
        if (!this.isRunning) { return; }
        debugLog(`Paused game.`);
        engineRunLoop.pause();
    }

    resume() {
        if (!this.isStarted || this.isRunning) { return; }
        debugLog("Unpaused game.");
        engineRunLoop.resume();
    }

    togglePauseState() {
        if (!this.isStarted) { return; }
        if (this.isRunning) {
            this.pause();
        } else {
            this.resume();
        }
    }

    gameSpeedActivated(value) {
        debugLog(`Set engine speed to ${value.name}`);
        this.city.time.setSpeed(value);
        engineRunLoop.setTargetFrameRate(value.daysPerSecond);
        this.resume();
    }

    delegateOrder(rl) {
        return _runLoopPriorities.gameEngine;
    }

    processFrame(rl) {
        if (rl == engineRunLoop) {
            this.city.simulateOneDay();
        }
        if (rl == uiRunLoop) {
            var now = rl.latestFrameStartTimestamp();
            if (Game.autoSaveEnabled() && (now - this.saveStateInfo.lastTimestamp) > (1000 * Game.rules().autoSaveIntervalSeconds)) {
                this.saveToStorage();
            }
        }
    }

    escapePressed() {
        MapToolController.shared.selectTool(MapToolController.shared.defaultTool);
    }

    _configureCommmands() {
        var gse = GameScriptEngine.shared;
        gse.registerCommand("pauseResume", () => this.togglePauseState());
        gse.registerCommand("setEngineSpeed", (index) => this.speedSelection.setSelectedIndex(index));
        gse.registerCommand("escapePressed", () => this.escapePressed());
    }
}

// #################### USER INPUT ######################

class PointInputSequence {
    constructor(firstEvent) {
        this.events = [firstEvent];
    }
    get firstEvent() { return this.events[0]; }
    get firstPoint() { return this._point(this.events[0]); }
    get latestEvent() { return this.events[this.events.length - 1]; }
    get latestPoint() { return this._point(this.events[this.events.length - 1]); }
    get totalOffset() { return this.latestPoint.manhattanDistanceFrom(this.firstPoint); }
    get isSingleClick() {
        return this.latestEvent.type == "mouseup"
            && this.latestPoint.manhattanDistanceFrom(this.firstPoint).magnitude <= GameContent.shared.pointInputController.singleClickMovementTolerance;
    }
    add(event) { this.events.push(event); }
    _point(event) { return new Point(event.offsetX, event.offsetY); }
}

class _PointInputNoopDelegate {
    shouldPassPointSessionToNextDelegate(sequence, controller) {
        return false;
    }
    pointSessionChanged(sequence, controller) {
        debugLog(`_PointInputNoopDelegate: ${sequence.latestEvent.type} @ ${sequence.latestPoint.debugDescription}`);
    }
}

class PointInputController {
    constructor(config) {
        this.eventTarget = config.eventTarget; // DOM element
        this.delegates = [new _PointInputNoopDelegate()];
        this.sequence = null;
        this.eventTarget.addEventListener("mousedown", this._mousedDown.bind(this));
        this.eventTarget.addEventListener("mouseup", this._mousedUp.bind(this));
        if (config.trackAllMovement) {
            this.eventTarget.addEventListener("mousemove", this._moved.bind(this));
        }
    }

    pushDelegate(delegate) { this.delegates.push(delegate); }
    popDelegate() {
        if (this.delegates.length <= 1) { return null; }
        return this.delegates.pop();
    }
    removeDelegate(delegate) {
        if (this.delegates.length <= 1) { return null; }
        var index = this.delegates.indexOf(delegate);
        if (this.delegates.isIndexValid(index)) {
            this.delegates.removeItemAtIndex(index);
            return delegate;
        }
        return null;
    }

    _mousedDown(evt) {
        this._buildSequence(evt, true, false);
    }

    _moved(evt) {
        this._buildSequence(evt, false, false);
    }

    _mousedUp(evt) {
        this._buildSequence(evt, false, true);
    }

    _buildSequence(evt, restart, end) {
        if (restart || !this.sequence) {
            this.sequence = new PointInputSequence(evt)
        } else {
            this.sequence.add(evt);
        }
        this._fireForEachDelegate();
        if (end) {
            this.sequence = null;
        }
    }

    _fireForEachDelegate() {
        for (var i = this.delegates.length - 1; i >= 0; i -= 1) {
            var delegate = this.delegates[i];
            if (delegate.pointSessionChanged) {
                delegate.pointSessionChanged(this.sequence, this);
            }
            if (delegate.shouldPassPointSessionToNextDelegate && !delegate.shouldPassPointSessionToNextDelegate(this.session, this)) {
                break;
            }
        }
    }
}

class KeyInputController {
    constructor() {
        this.game = null;
        this.keyboardState = new Gaming.KeyboardState({ runLoop: uiRunLoop });
        var settings = GameContent.shared.keyInputController;
        this.keyPressEvents = settings.keyPressEvents;
        this.continuousKeyEvents = settings.continuousKeyEvents;
        this.keyboardState.addDelegate(this);
    }

    initialize(game) {
        this.game = game;
    }

    get keyboardCommandsActive() {
        return this.game != null;
    }

    getKeyAction(lookup) {
        var action = lookup.find(a => this.keyboardState.areKeyCodesDown(a[0], true));
        return action ? { command: action[1], subject: action[2] } : null;
    }

    keyboardStateDidChange(kc, eventType) {
        if (!this.keyboardCommandsActive) { return; }
        if (!this._executeCommandForCurrentKeys(this.keyPressEvents)) {
            if (!this._executeCommandForCurrentKeys(this.continuousKeyEvents)) {
                this._logUnhandledKeys();
            }
        }
    }

    keyboardStateContinuing(kc) {
        this._executeCommandForCurrentKeys(this.continuousKeyEvents);
    }

    _executeCommandForCurrentKeys(lookup) {
        var action = this.getKeyAction(lookup);
        if (!action) { return false; }
        GameScriptEngine.shared.execute(action.command, action.subject);
        return true;
    }

    _logUnhandledKeys() {
        var codes = Array.from(this.keyboardState.keyCodesCurrentlyDown).join(",");
        once("_logUnhandledKeys:" + codes, () => debugLog("KeyInputController: unhandled key codes: " + codes));
    }
}

// ##################### MAP TOOLS ######################

class MapToolPointer {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
    }
    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }
    focusRectForTileCoordinate(session, tile) { return null; }

    performSingleClickAction(session, tile) {
        debugLog("TODO center map on " + tile.debugDescription);
    }
}

class MapToolQuery {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
    }
    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }

    focusRectForTileCoordinate(session, tile) {
        if (!tile) { return null; }
        var plot = session.game.city.map.plotAtTile(tile);
        return this._getFocusRect(plot, tile);
    }

    performSingleClickAction(session, tile) {
        debugLog("TODO query " + tile.debugDescription);
    }

    _getFocusRect(plot, tile) {
        return plot ? plot.bounds : new Rect(tile, {width: 1, height: 1});
    }
}

class MapToolBulldozer {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
    }
    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }

    focusRectForTileCoordinate(session, tile) {
        if (!tile) { return null; }
        var plot = session.game.city.map.plotAtTile(tile);
        return this._getFocusRect(plot, tile);
    }

    performSingleClickAction(session, tile) {
        var plot = session.game.city.map.plotAtTile(tile);
        var result = { code: null, price: null, formattedPrice: null, focusTileRect: this._getFocusRect(plot, tile) };
        if (!plot) { result.code = MapToolSession.ActionResult.notAllowed; return result; }
        result.price = plot.bulldozeCost;
        result.formattedPrice = Simoleon.format(result.price);
        var purchased = session.game.city.spend(result.price);
        if (purchased) {
            var destroyed = session.game.city.destroyPlot(plot);
            result.code = destroyed ? MapToolSession.ActionResult.purchased : MapToolSession.ActionResult.notAllowed;
        } else {
            result.code = MapToolSession.ActionResult.notAffordable;
        }
        return result;
    }

    _getFocusRect(plot, tile) {
        return plot ? plot.bounds : new Rect(tile, {width: 1, height: 1});
    }
}

class MapToolPlopZone {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
        this.zoneInfo = Zone.typeSettings(settings.zoneType);
    }
    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }

    focusRectForTileCoordinate(session, tile) {
        if (!tile) { return null; }
        return Rect.tileRectWithCenter(tile, this.zoneInfo.plotSize)
            .clampedWithinTileBounds(session.game.city.map.bounds);
    }

    performSingleClickAction(session, tile) {
        var rect = this.focusRectForTileCoordinate(session, tile);
        var result = { code: null, price: null, formattedPrice: null, focusTileRect: rect };
        if (!rect) { result.code = MapToolSession.ActionResult.notAllowed; return result; }
        var plot = Zone.newPlot({ type: this.settings.zoneType, topLeft: rect.origin });
        result.price = this.zoneInfo.newPlotCost;
        result.formattedPrice = Simoleon.format(result.price);
        var purchased = session.game.city.spend(result.price);
        if (!purchased) { result.code = MapToolSession.ActionResult.notAffordable; return result; }
        var plopped = session.game.city.plopPlot(plot);
        result.code = plopped ? MapToolSession.ActionResult.purchased : MapToolSession.ActionResult.notAllowed;
        return result;
    }
}

class MapToolPlopProp {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
        this.propInfo = TerrainProp.typeSettings(settings.propType);
    }

    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }

    focusRectForTileCoordinate(session, tile) {
        if (!tile) { return null; }
        return Rect.tileRectWithCenter(tile, this.propInfo.plotSize)
            .clampedWithinTileBounds(session.game.city.map.bounds);
    }

    performSingleClickAction(session, tile) {
        var rect = this.focusRectForTileCoordinate(session, tile);
        var result = { code: null, price: null, formattedPrice: null, focusTileRect: rect };
        if (!rect) { result.code = MapToolSession.ActionResult.notAllowed; return result; }
        var plot = TerrainProp.newPlot({ type: this.settings.propType, topLeft: rect.origin });
        result.price = this.propInfo.newPlotCost;
        result.formattedPrice = Simoleon.format(result.price);
        var purchased = session.game.city.spend(result.price);
        if (!purchased) { result.code = MapToolSession.ActionResult.notAffordable; return result; }
        var plopped = session.game.city.plopPlot(plot);
        result.code = plopped ? MapToolSession.ActionResult.purchased : MapToolSession.ActionResult.notAllowed;
        return result;
    }
}

class MapToolSession {
    constructor(config) {
        this.game = config.game;
        this.canvasGrid = config.canvasGrid;
        this.tool = config.tool;
        this.preemptedSession = config.preemptedSession;
        this.singleClickMovementTolerance = MapToolController.settings().singleClickMovementTolerance;
        this._activationTimestamp = Date.now();
        this._tile = null; // TODO refactor this/make it part of this.state
        this.state = {}; // TODO a generic way to do model object state
    }

    receivedPointInput(inputSequence) {
        var action = null;
        // TODO can use this.state to determine if the tile changed between this and the last point-input
        var tile = this.canvasGrid.tileForCanvasPoint(inputSequence.latestPoint);
        if (tile) {
            if (inputSequence.isSingleClick) {
                action = this.tool.performSingleClickAction(this, tile);
            }
            this._tile = tile;
        }
        return { code: MapToolSession.InputResult.continueCurrentSession, action: action };
    }

    pause() { }

    resume() { }

    end() { }

    // UI stuff

    // modelMetadata dictionary to pass to ScriptPainters
    get textTemplateInfo() {
        return {
            paletteTitle: this.tool.paletteTitle
        };
    }

    // ----- Overlay Rendering -----
    // All of these getters specify both what and where to paint; the renderer 
    // does not need any additional position info from this class, input controllers, etc.

    // (optional) List of tiles that may be affected. e.g. to paint with translucent overlay
    get affectedTileRects() {
        if (!this._tile) { return null; }
        return {
            // a zone might be a single 3x3 rect, a road may be a bunch of 1x1s
            tileRects: [],
            // runs the script once per tile rect
            painterID: this.tool.settings.proposedTileRectOverlayPainter
        };
    }

    // (optional) Primary tile rect the tool is pointing to
    get focusTileRect() {
        // TODO rely on the stored state instead of recalculating at render time
        return this.tool.focusRectForTileCoordinate(this, this._tile);
    }

    // (optional) What to render next to the cursor. Note it defines the position
    // to paint at; not the current cursor x/y position.
    get hoverStatusRenderInfo() {
        if (!this._tile) { return null; }
        // Some tools may not display a hover status. e.g. the Pointer
        // or only sometimes, e.g. show tile coords if holding Option key with the Pointer.
        return {
            tileRect: new Rect(1, 1, 1, 1), // determines position to paint below
            // This will likely be quite dynamic; use string templates + painterMetadata
            painterID: this.tool.hoverStatusPainter
        }
        return [];
    }

    // CSS value, e.g. "crosshair"
    // get mouseCursorType() {
    //     return this.tool.mouseCursorType;
    // }
}
MapToolSession.InputResult = {
    continueCurrentSession: 1,
    endSession: 2,
    pauseAndPushNewSession: 3
};
MapToolSession.ActionResult = {
    nothing: 0,
    ok: 1,
    purchased: 2,
    notAffordable: 3,
    notAllowed: 4
};

class MapToolController {

    static settings() { return GameContent.shared.mapTools; }

    static getFeedbackSettings(source, code) {
        switch (code) {
            case MapToolSession.ActionResult.purchased: return source.purchased;
            case MapToolSession.ActionResult.notAffordable: return source.notAffordable;
            case MapToolSession.ActionResult.notAllowed: return source.notAllowed;
            default:
                once(`getFeedbackSettings-${code}`, () => debugLog(`Unknown code ${code}`));
                return null;
        }
    }

    constructor(config) {
        this.game = null;
        this.canvasGrid = null;
        this.defaultTool = null;
        this._feedbackSettings = MapToolController.settings().feedback;
        this._toolSession = null;
        this._feedbackItems = [];
        this.kvo = new Kvo(this);
        this._configureTools();
    }

    initialize(config) {
        this.game = config.game;
        this.canvasGrid = config.canvasGrid;
        this.canvasInputController = config.canvasInputController;
        this.canvasInputController.pushDelegate(this);
        this._beginNewSession(this.defaultTool, false);
        engineRunLoop.addDelegate(this);
    }

    get activeSession() { return this._toolSession; }
    get allTools() { return this._allTools; }
    get activeFeedbackItems() {
        this._removeExpiredFeedback();
        return this._feedbackItems;
    }

    isToolIDActive(id) {
        return this.activeSession ? (this.activeSession.tool.id == id) : false;
    }

    toolWithID(id) {
        return this._toolIDMap[id];
    }

    processFrame(rl) {
        // TODO notify the tool session so it can update its state
    }

    shouldPassPointSessionToNextDelegate(inputSequence, inputController) {
        return !this._toolSession;
    }

    pointSessionChanged(inputSequence, inputController) {
        var session = this.activeSession;
        if (!session) { return; }
        var result = session.receivedPointInput(inputSequence);
        this._addFeedback(result.action);
        switch (result.code) {
            case MapToolSession.InputResult.continueCurrentSession: break;
            case MapToolSession.InputResult.endSession:
                this._endSession(); break;
            case MapToolSession.InputResult.pauseAndPushNewSession:
                this._beginNewSession(result.tool, true); break;
            default:
                once("MapToolSession.InputResult.code" + result.code, () => debugLog("Unknown MapToolSession.InputResult code " + result.code));
        }
    }

    selectTool(tool) {
        if (!tool || this.isToolIDActive(tool.id)) { return; }
        this._beginNewSession(tool, false);
    }

    selectToolID(id) {
        this.selectTool(this.toolWithID(id));
    }

    _addFeedback(result) {
        if (!result) { return; }
        var item = null;
        switch (result.code) {
            case MapToolSession.ActionResult.purchased:
                item = result; break;
            case MapToolSession.ActionResult.notAffordable:
                item = result; break;
            case MapToolSession.ActionResult.notAllowed:
                item = result; break;
            default: break;
        }
        if (item) {
            item.tool = this.activeSession.tool;
            item.timestamp = Date.now();
            this._feedbackItems.unshift(item);
        }
    }

    _removeExpiredFeedback() {
        var now = Date.now();
        this._feedbackItems = this._feedbackItems.filter((item) => {
            var feedback = MapToolController.getFeedbackSettings(this._feedbackSettings, item.code);
            if (!feedback) { return false; }
            return (now - item.timestamp) < feedback.displayMilliseconds;
        });
    }

    _endSession() {
        if (this._toolSession.preemptedSession) {
            this.kvo.activeSession.setValue(this._toolSession.preemptedSession, false, true);
            this._toolSession.resume();
        } else {
            this._beginNewSession(this.defaultTool, false);
        }
    }

    _beginNewSession(tool, preempt) {
        if (preempt && this._toolSession) { this._toolSession.pause(); }
        else if (!preempt && this._toolSession) { this._toolSession.end(); }
        this.kvo.activeSession.setValue(new MapToolSession({
            game: this.game,
            canvasGrid: this.canvasGrid,
            tool: tool,
            preemptedSession: preempt ? this._toolSession : null
        }), false, false);
        this._toolSession.resume();
    }

    _configureTools() {
        var definitions = MapToolController.settings().definitions;
        var ids = Object.getOwnPropertyNames(definitions);
        this._allTools = [];
        this._toolIDMap = {};
        ids.forEach((id) => {
            var tool = this._createTool(id, definitions[id]);
            if (tool) {
                this._allTools.push(tool);
                this._toolIDMap[id] = tool;
            }
        });
        this.defaultTool = this._allTools.find((t) => t.settings.isDefault);
        GameScriptEngine.shared.registerCommand("selectTool", (id) => this.selectToolID(id));
    }

    _createTool(id, settings) {
        switch (settings.type) {
            case "pointer": return new MapToolPointer(id, settings);
            case "query": return new MapToolQuery(id, settings);
            case "bulldozer": return new MapToolBulldozer(id, settings);
            case "plopZone": return new MapToolPlopZone(id, settings);
            case "plopProp": return new MapToolPlopProp(id, settings);
            default:
                debugLog("Unknown tool type " + settings.type);
                return null;
        }
    }
}
MapToolController.shared = null;
MapToolController.Kvo = { activeSession: "_toolSession" };

// ################ RENDERERS AND VIEWS #################

class UI {
    static fadeOpacity(currentAge, targetAge, duration) {
        return Math.clamp((targetAge - currentAge) / duration, _zeroToOne);
    }
}

// Subclasses implement: get/set value().
class FormValueView {
    constructor(config, elem) {
        this.elem = elem;
        if (config.parent) { config.parent.append(this.elem); }
    }

    configure(block) {
        block(this);
        return this;
    }
}

class InputView extends FormValueView {
    static trimTransform(value) {
        return (typeof(value) === 'string') ? value.trim() : value;
    }

    static notEmptyOrWhitespaceRule(input) {
        return !String.isEmptyOrWhitespace(input.value);
    }

    constructor(config, elem) {
        super(config, elem);
        this.valueElem = this.elem.querySelector("input");
        this.transform = config.transform;
        if (config.binding) {
            this.binding = new Binding({ source: config.binding.source, target: this, sourceFormatter: config.binding.sourceFormatter });
        }
    }

    get value() {
        return this.transform ? this.transform(this.valueElem.value) : this.valueElem.value;
    }
    set value(newValue) { this.valueElem.value = newValue; }

    // for Bindings
    setValue(newValue) {
        this.value = newValue;
    }
}

class TextLineView extends InputView {
    static createElement(config) {
        var elem = document.createElement("label").addRemClass("textLine", true);
        if (config.title) {
            var title = document.createElement("span");
            title.innerText = config.title;
            elem.append(title);
        }
        var input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        elem.append(input);
        return elem;
    }

    constructor(config, elem) {
        super(config, elem || TextLineView.createElement(config));
    }
}

class TextInputView extends InputView {
    static createElement(config) {
        var elem = document.createElement("label").addRemClass("textInput", true);
        if (config.title) {
            var title = document.createElement("span");
            title.innerText = config.title;
            elem.append(title);
        }
        var input = document.createElement("input");
        input.type = "text";
        input.placeholder = config.placeholder || "";
        elem.append(input);
        return elem;
    }

    constructor(config, elem) {
        super(config, elem || TextInputView.createElement(config));
        this.validationRules = config.validationRules || [];
        this.valueElem.addEventListener("input", evt => this.revalidate());
    }

    revalidate() {
        this.elem.addRemClass("invalid", !this.isValid);
    }

    get isValid() {
        return this.validationRules.every(rule => rule(this));
    }
}

class SingleChoiceInputView extends InputView {
    static createElement(config) {
        var elem = document.createElement("label").addRemClass("singleChoiceInput", true);
        elem.append(document.createElement("input").configure(input => {
            input.type = "radio";
            input.name = config.collection.id;
            input.value = config.value;
            input.checked = !!config.selected;
        }));
        elem.append(document.createElement("span").configure(item => item.innerText = config.title));
        return elem;
    }

    constructor(config, elem) {
        super(config, elem || SingleChoiceInputView.createElement(config));
        this.value = config.value;
    }

    get selected() { return this.valueElem.checked; }
    set selected(value) { this.valueElem.checked = value; }
}

class SingleChoiceInputCollection extends FormValueView {
    static selectionRequiredRule(collection) {
        return collection.value !== null;
    }

    static createElement(config) {
        var elem = document.createElement("div").addRemClass("singleChoiceInput", true);
        if (config.title) {
            elem.append(document.createElement("span").configure(item => item.innerText = config.title));
        }
        return elem;
    }

    constructor(config) {
        super(config, SingleChoiceInputCollection.createElement(config));
        this.id = config.id;
        this.validationRules = config.validationRules || [];
        this.choices = config.choices.map(item => new SingleChoiceInputView({
            parent: this.elem,
            collection: this,
            title: item.title,
            value: item.value,
            selected: item.selected
        }));
    }

    get isValid() {
        return this.validationRules.every(rule => rule(this));
    }

    get value() {
        var choice = this.choices.find(item => item.selected);
        return choice ? choice.value : null;
    }
    set value(newValue) {
        var choice = this.choices.find(item => item.value == newValue);
        choice.selected = true;
    }
}

class ToolButton {
    static createElement(config) {
        var elem = document.createElement("a")
            .addRemClass("tool", true)
            .addRemClass("glyph", !!config.isGlyph);
        elem.href = "#";
        var title = document.createElement("span");
        title.innerText = config.title;
        elem.append(title);
        if (config.size) {
            elem.style.width = `${config.size.width}px`;
            elem.style.height = `${config.size.height}px`;
        }
        return elem;
    }

    constructor(config) {
        this.id = config.id;
        this.elem = ToolButton.createElement(config);
        if (config.click) {
            this.elem.addEventListener("click", evt => { evt.preventDefault(); config.click(this); });
        } else if (config.clickScript) {
            var subject = typeof(config.clickScriptSubject) === 'undefined' ? this : config.clickScriptSubject;
            this.elem.addGameCommandEventListener("click", true, config.clickScript, subject);
        }
        if (config.parent) {
            config.parent.append(this.elem);
        }
        this._selected = false;
    }

    configure(block) {
        block(this);
        return this;
    }

    get isSelected() { return this._selected; }
    set isSelected(value) {
        this._selected = value;
        this.elem.addRemClass("selected", value);
    }

    get isEnabled() { return this._enabled; }
    set isEnabled(value) {
        this._enabled = value;
        this.elem.addRemClass("disabled", !value);
    }
}

class RootView {
    constructor() {
        this.game = null;
        this.root = document.querySelector("main");
        this.views = [];
    }

    setUp() {
        this._configureCommmands();
        var storage = GameStorage.shared;
        var url = new URL(window.location.href);

        var id = url.searchParams.get("id");
        if (id) { this.tryToLoadGame(id); return; }

        var startNewGame = !!url.searchParams.get("new");
        var id = storage.latestSavedGameID;
        if (!startNewGame && !!id) { this.tryToLoadGame(id); return; }

        try {
            let terrainID = url.searchParams.get("terrain");
            let terrain = null;
            if (terrainID) {
                terrain = Terrain.loadFromStorage(storage, url.searchParams.get("terrain"));
            } else {
                terrain = new Terrain({ name: "", map: new CityMap({ size: Terrain.defaultSize() }) });
            }
            new NewGameDialog(terrain).show();
        } catch (e) {
            this.failedToStartGame(e.message);
            debugLog(e);
        }
    }

    tryToLoadGame(id) {
        var storage = GameStorage.shared;
        var data = storage.gameCollection.getItem(id);
        if (!data) {
            this.failedToStartGame(Strings.str("failedToFindFileMessage"));
        } else if (!storage.isSaveStateItemSupported(data)) {
            this.failedToStartGame(Strings.str("failedToLoadGameMessage"));
        } else {
            try {
                CitySim.game = Game.fromDeserializedWrapper(data, rootView);
                CitySim.game.start();
            } catch(e) {
                this.failedToStartGame(`${Strings.str("failedToLoadGameMessage")}\n\n${e.message}`);
                debugLog(e);
            }
        }
    }

    initialize(game) {
        this.game = game;
        if (!game) { return; }
        this.views.push(new PaletteView({ game: game, root: this.root.querySelector("palette") }));
        this.views.push(new MapRenderer({ game: game, canvas: this.root.querySelector("canvas.mainMap") }));
        this.views.push(new ControlsView({ game: game, root: this.root.querySelector("controls") }));
    }

    failedToStartGame(message) {
        new Gaming.Prompt({
            title: Strings.str("failedToLoadGameTitle"),
            message: message,
            buttons: [{ label: Strings.str("quitButton"), action: () => Game.quit(false) }],
            requireSelection: true
        }).show();
    }

    showGameHelp() {
        var helpSource = this.root.querySelector("help");
        new Gaming.Prompt({
            customContent: helpSource.cloneNode(true).addRemClass("hidden", false),
            buttons: [ {label: Strings.str("helpDismiss")} ]
        }).show();
    }

    _configureCommmands() {
        GameScriptEngine.shared.registerCommand("showGameHelp", () => this.showGameHelp());
    }
}

class PaletteView {
    constructor(config) {
        this.root = config.root;
        this.settings = MapToolController.settings();
        this.root.style.width = `${this.settings.paletteStyle.tileWidth}px`;
        this.root.removeAllChildren();
        this.buttons = this.settings.defaultPalette.map(id => this._makeToolButton(id));
        this.update();
        MapToolController.shared.kvo.activeSession.addObserver(this, () => this.update());
    }

    update() {
        this.buttons.forEach(button => {
            button.isSelected = MapToolController.shared.isToolIDActive(button.id);
        });
    }

    _makeToolButton(id) {
        var tool = MapToolController.shared.toolWithID(id);
        var button = new ToolButton({
            id: id,
            parent: this.root,
            title: tool.settings.iconGlyph,
            size: { width: this.settings.paletteStyle.tileWidth, height: this.settings.paletteStyle.tileWidth },
            clickScript: "selectTool",
            clickScriptSubject: id
        });
        return button;
    }
}

class ControlsView {
    constructor(config) {
        this.game = config.game;
        this.root = config.root;
        this.views = [];
        this.root.style["padding-left"] = `${GameContent.shared.mapTools.paletteStyle.tileWidth}px`;
        this.views.push(new NewsView({ game: this.game, root: document.querySelector("#news") }));
        this.views.push(new CityStatusView({ game: this.game, root: document.querySelector("#cityStatus") }));
        this.views.push(new RCIView({ game: this.game, root: document.querySelector("#rci") }));
        this.views.push(new MapControlsView({ game: this.game, root: document.querySelector("#view nav") }))
        this.views.push(new GameEngineControlsView({ game: this.game, root: document.querySelector("#engine") }));
        this.buttons = [];
        this.buttons.push(new ToolButton({
            parent: this.root.querySelector("#system"),
            title: Strings.str("helpButtonLabel"),
            clickScript: "showGameHelp"
        }));
        this.buttons.push(new ToolButton({
            parent: this.root.querySelector("#system"),
            title: Strings.str("optionsButtonLabel"),
            clickScript: "showFileMenu"
        }));
        this._configureCommmands();
    }

    showFileMenu() {
        new Gaming.Prompt({
            title: Strings.str("systemMenuTitle"),
            message: null,
            buttons: [
                { label: Strings.str("saveButton"), action: () => this.game.saveToStorage() },
                { label: Strings.str("saveAndQuitButton"), action: () => { if (this.game.saveToStorage()) { Game.quit(false); } } },
                { label: Strings.str("quitButton"), action: () => Game.quit(true), classNames: ["warning"] },
                { label: Strings.str("genericCancelButton") }
            ]
        }).show();
    }

    _configureCommmands() {
        GameScriptEngine.shared.registerCommand("showFileMenu", () => this.showFileMenu());
    }
}

class CityStatusView {
    constructor(config) {
        this.game = config.game;
        this.views = { root: config.root };
        this.views.name = new TextLineView({ parent: config.root, title: Strings.str("cityStatusNameLabel"), binding: {
            source: this.game.city.kvo.name
        } });
        this.views.date = new TextLineView({ parent: config.root, title: Strings.str("cityStatusDateLabel"), binding: {
            source: this.game.city.time.kvo.date, sourceFormatter: value => value.longString()
        } });
        this.views.cash = new TextLineView({ parent: config.root, title: Strings.str("cityStatusCashLabel"), binding: {
            source: this.game.city.budget.kvo.cash, sourceFormatter: Simoleon.format
        } });
        this.views.population = new TextLineView({ parent: config.root, title: Strings.str("cityStatusPopulationLabel"), binding: {
            source: this.game.city.kvo.population, sourceFormatter: value => Number.uiInteger(value.R)
        } });
        this.game.city.time.kvo.date.addObserver(this, kvo => this._updateDocumentTitle());
        this.game.city.kvo.name.addObserver(this, kvo => this._updateDocumentTitle());
        this._updateDocumentTitle();
    }

    _updateDocumentTitle() {
        var newTitle = Strings.template("windowTitleTemplate", {
            name: this.game.city.name,
            date: this.game.city.time.date.mediumString(),
            gameProductTitle: Strings.str("gameProductTitle")
        });
        if (document.title != newTitle) {
            document.title = newTitle;
        }
    }
}

class RCIView {
    constructor(config) {
        this.game = config.game;
        this.root = config.root;
        this.canvas = config.root.querySelector("canvas");
        this.style = GameContent.shared.rciView;
        this.deviceScale = HTMLCanvasElement.getDevicePixelScale();
        this.render();
        this.game.city.kvo.rciDemand.addObserver(this, value => this.render());
    }

    render() {
        var ctx = this.canvas.getContext("2d");
        this.canvas.width = this.canvas.clientWidth * this.deviceScale;
        this.canvas.height = this.canvas.clientHeight * this.deviceScale;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${this.style.fontSize}px sans-serif`;
        var rci = this.game.city.rciDemand;
        this._renderItem(ctx, 0, rci.R);
        this._renderItem(ctx, 1, rci.C);
        this._renderItem(ctx, 2, rci.I);
    }

    _renderItem(ctx, index, value) {
        var barWidth = this.canvas.width * this.style.barWidth;
        var barSpacing = (this.canvas.width - (this.style.bars.length * barWidth)) / (this.style.bars.length - 1);
        var barOriginX = index * (barWidth + barSpacing);
        var centerY = this.canvas.height / 2;
        
        var textCenter = new Gaming.Point(barOriginX + 0.5 * barWidth, centerY);
        ctx.fillStyle = this.style.bars[index].color;
        ctx.textFill(this.style.bars[index].title, textCenter);

        if (Math.abs(value) > 0.01) {
            var textHeightPlusPadding = this.style.fontSize + 2 * this.deviceScale * this.style.textSpacing;
            var availableHeight = 0.5 * (this.canvas.height - textHeightPlusPadding);
            var barHeight = value * availableHeight;
            var barOriginY = 0;
            if (value > 0) {
                barOriginY = centerY - 0.5 * textHeightPlusPadding - barHeight;
            } else {
                barOriginY = centerY + 0.5 * textHeightPlusPadding;
            }
            var rect = new Gaming.Rect(barOriginX, barOriginY, barWidth, barHeight).rounded();
            ctx.rectFill(rect);
        }
    }
}

class GameEngineControlsView {
    constructor(config) {
        this.game = config.game;
        this.root = config.root;

        var playPause = config.root.querySelector("playPause");
        this.pauseButton = new ToolButton({
            parent: playPause,
            title: "||",
            clickScript: "pauseResume"
        }).configure(button => button.elem.addRemClass("stop-indication", true));
        this.playButton = new ToolButton({
            parent: config.root.querySelector("playPause"),
            title: ">",
            clickScript: "pauseResume"
        });

        var speedRoot = config.root.querySelector("speedSelector");
        this.speedButtons = GameContent.shared.gameRules.speeds.map((s, index) => new ToolButton({
            parent: speedRoot,
            title: s.glyph,
            clickScript: "setEngineSpeed",
            clickScriptSubject: index
        }));
        this.speedButtons[1].isSelected = true;

        this.frameRateView = new TextLineView({ parent: config.root.querySelector("frameRate") })
            .configure(view => view.elem.addRemClass("minor", true));
        this._lastFrameRateUpdateTime = 0;

        uiRunLoop.addDelegate(this);
        engineRunLoop.addDelegate(this);
        this._updateFrameRateLabel();
        this._updateGameEngineControls();
    }

    processFrame(rl) {
        if (rl == uiRunLoop) {
            this._frameCounter += 1;
            this._updateFrameRateLabel();
        }
        if (rl == engineRunLoop) {
            this._updateGameEngineControls();
        }
    }

    runLoopDidPause(rl) {
        if (rl == engineRunLoop) { this._updateGameEngineControls(); }
    }

    runLoopWillResume(rl) {
        if (rl == engineRunLoop) { this._updateGameEngineControls(); }
    }

    runLoopDidChange(rl) {
        if (rl == engineRunLoop) { this._updateGameEngineControls(); }
    }

    _updateFrameRateLabel() {
        // TODO can probably calculate if a run loop is "pegged", meaning that the execution time for a 
        // single frame is >= the time allowed for a single full-speed frame.
        var now = Date.now();
        if (Math.abs(now - this._lastFrameRateUpdateTime) < 1000) { return; }
        this._lastFrameRateUpdateTime = now;

        var rates = [];
        var uiFrameRate = uiRunLoop.getRecentFramesPerSecond();
        var uiLoad = uiRunLoop.getProcessingLoad();
        if (!isNaN(uiFrameRate) && !isNaN(uiLoad)) {
            rates.push(Strings.template("uiFpsLabel", { value: Math.round(uiFrameRate), load: Number.uiPercent(uiLoad) }));
        }
        var engineFrameRate = engineRunLoop.getRecentMillisecondsPerFrame();
        if (!isNaN(engineFrameRate)) {
            rates.push(Strings.template("engineMsPerDayLabel", { value: Math.round(engineFrameRate) }));
        }

        this.frameRateView.value = rates.join(Strings.str("frameRateTokenSeparator"));
    }

    _updateGameEngineControls() {
        this.pauseButton.isSelected = !this.game.isRunning;
        this.playButton.isSelected = this.game.isRunning;

        var speedIndex = this.game.city.time.speed.index;
        GameContent.shared.gameRules.speeds.forEach((speed, index) => {
            if (index < this.speedButtons.length) {
                this.speedButtons[index].isSelected = (index == speedIndex);
            }
        });
    }
}

class MapControlsView {
    constructor(config) {
        this.root = config.root;
        this.buttons = [];

        var directionElem = config.root.querySelector("direction");
        this.buttons.push(new ToolButton({
            parent: config.root.querySelector("#map-nav-l"),
            title: "L"
        }));
        this.buttons.push(new ToolButton({
            parent: config.root.querySelector("#map-nav-ud"),
            title: "U"
        }));
        this.buttons.push(new ToolButton({
            parent: config.root.querySelector("#map-nav-ud"),
            title: "D"
        }));
        this.buttons.push(new ToolButton({
            parent: config.root.querySelector("#map-nav-r"),
            title: "R"
        }));

        // TODO consider zoomselector class
        var zoomElem = config.root.querySelector("zoom");
        this.buttons.push(new ToolButton({
            parent: zoomElem,
            title: Strings.str("zoomOutButtonGlyph"),
            clickScript: "zoomOut"
        }));
        this.buttons.push(new ToolButton({
            parent: zoomElem,
            title: Strings.str("zoomInButtonGlyph"),
            clickScript: "zoomIn"
        }));
    }
}

class NewsView {
    constructor(config) {
        this.root = config.root;
        this.root.innerText = ""; //"37 llamas to enter hall of fame in ceremony tonight…";
        this.root.addEventListener("click", evt => {
            evt.preventDefault();
            debugLog("TODO Show news viewer dialog");
        });
    }
}

class MapRenderer {
    static defaultZoomLevel() {
        return GameContent.defaultItemFromArray(GameContent.shared.mainMapView.zoomLevels);
    }

    constructor(config) {
        this.canvas = config.canvas;
        var zoomers = this.settings.zoomLevels.map((z) => new ZoomSelector(z, this));
        this.zoomSelection = new SelectableList(zoomers);
        this.initialize(config.game);
    }

    // Cached once per run loop frame
    get settings() {
        if (this._settings) { return this._settings; }
        this._settings = GameContent.shared.mainMapView;
        return this._settings;
    }

    get zoomLevel() {
        return this.zoomSelection.selectedItem.value;
    }

    get drawContext() {
        return this.canvas.getContext("2d", { alpha: false });
    }

    zoomLevelActivated(value) {
        debugLog("Set MapRenderer zoom to " + value.tileWidth);
        this.canvasGrid.setSize({ tileWidth: value.tileWidth, tileSpacing: 0 });
    }

    initialize(game) {
        this.game = game;

        this.canvasGrid = new FlexCanvasGrid({
            canvas: this.canvas,
            deviceScale: FlexCanvasGrid.getDevicePixelScale(),
            tileWidth: this.zoomLevel.tileWidth,
            tileSpacing: 0
        });

        this._configureCommmands();
        this.canvasInputController = new PointInputController({
            eventTarget: this.canvas,
            trackAllMovement: true
        });
        MapToolController.shared.initialize({
            game: this.game,
            canvasInputController: this.canvasInputController,
            canvasGrid: this.canvasGrid
        });

        this._terrainRenderer = new TerrainRenderer({ canvasGrid: this.canvasGrid, mapSource: this.game.city });
        this._plotRenderer = new PlotRenderer({ canvasGrid: this.canvasGrid, game: this.game });
        this._toolRenderer = new MapToolSessionRenderer({ canvasGrid: this.canvasGrid, game: this.game });
        debugLog(`MapRenderer: init canvasGrid tw=${this.canvasGrid.tileWidth} sz=${this.canvasGrid.tilesWide}x${this.canvasGrid.tilesHigh}`);

        var ctx = this.drawContext;
        ctx.fillStyle = this.settings.edgePaddingFillStyle;
        ctx.rectFill(this.canvasGrid.rectForFullCanvas);

        uiRunLoop.addDelegate(this);
    }

    processFrame(rl) {
        // if (rl == uiRunLoop) {
            this._settings = null;
            this._render();
        // }
    }

    _configureCommmands() {
        var gse = GameScriptEngine.shared;
        // gse.registerCommand("panMap", (direction) => {
        //     debugLog("TODO panMap: " + direction);
        // });
        gse.registerCommand("zoomIn", () => this.zoomSelection.selectNext());
        gse.registerCommand("zoomOut", () => this.zoomSelection.selectPrevious());
        gse.registerCommand("setZoomLevel", (index) => this.zoomSelection.setSelectedIndex(index));
    }

    _render() {
        if (!this.game) { return; }
        var ctx = this.drawContext;
        this._terrainRenderer.render(ctx, this.settings);
        var r = this._plotRenderer;
        this.game.city.map.visitEachPlot(plot => r.render(plot, ctx));
        this._toolRenderer.render(ctx);
    }
}

class GridPainter {
    constructor(config) {
        this.gridColor = config.gridColor;
    }

    render(ctx, map, canvasGrid, zoomLevel) {
        if (!zoomLevel.allowGrid) { return; }
        let ext = map.bounds.intersection(new Rect(0, 0, canvasGrid.tileSize.width + 1, canvasGrid.tileSize.height + 1)).extremes;
        for (let y = ext.min.y; y <= ext.max.y; y += 1) {
            this._renderGridLine(ctx, canvasGrid, new Point(ext.min.x, y), new Point(ext.max.x, y));
        }
        for (let x = ext.min.x; x <= ext.max.x; x += 1) {
            this._renderGridLine(ctx, canvasGrid, new Point(x, ext.min.y), new Point(x, ext.max.y));
        }
    }

    _renderGridLine(ctx, canvasGrid, start, end) {
        start = canvasGrid.rectForTile(start);
        end = canvasGrid.rectForTile(end);
        ctx.strokeStyle = this.gridColor;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    }
}

class TerrainRenderer {
    constructor(config) {
        this.canvasGrid = config.canvasGrid;
        this.mapSource = config.mapSource;
    }

    render(ctx, settings) {
        ctx.fillStyle = settings.edgePaddingFillStyle;
        ctx.rectFill(this.canvasGrid.rectForFullCanvas);
        if (!this.mapSource) { return; }
        let map = this.mapSource.map;
        ctx.fillStyle = settings.emptyFillStyle;
        let size = map.tilePlane.size;
        ctx.rectFill(this.canvasGrid.rectForTileRect(map.tilePlane.screenRectForModel(new Rect(0, 0, size.width, size.height))));

        let visibleRect = map.tilePlane.modelRectForScreen(new Rect(0, 0, this.canvasGrid.tileSize.width, this.canvasGrid.tileSize.height));
        map.terrainLayer.visitTiles(visibleRect, tile => {
            let rect = this.canvasGrid.rectForTile(map.tilePlane.screenTileForModel(tile.point));
            if (!rect) { return; }
            this._getPainterSessions(tile).forEach(painter => {
                painter.render(ctx, rect, this.canvasGrid, tile.textTemplateInfo);
            })
        });
    }

    _getPainterSessions(tile) {
        return tile.painterInfoList.map(item => ScriptPainterStore.shared.getPainterSession(item.id, item.variantKey));
    }
}

// Could reuse this, with different settings, for 
// minimaps and stuff.
class PlotRenderer {
    constructor(config) {
        this.canvasGrid = config.canvasGrid;
        this.game = config.game;
    }
    render(plot, ctx) {
        var rect = this.canvasGrid.rectForTileRect(plot.bounds);
        var painter = this._getPainterSession(plot, ScriptPainterStore.shared);
        painter.render(ctx, rect, this.canvasGrid, plot.textTemplateInfo);
    }

    _getPainterSession(plot, store) {
        switch (plot.item.constructor.name) {
            case Zone.name:
                var id = `zone${plot.item.type}d0v0`;
                return store.getPainterSession(id, plot.data.variantKey);
            case TerrainProp.name:
                var id = `prop${plot.item.type}`;
                return store.getPainterSession(id, plot.data.variantKey);
        }
    }
}

class MapToolSessionRenderer {
    constructor(config) {
        this.game = config.game;
        this.canvasGrid = config.canvasGrid;
        this._feedbackSettings = Object.assign({}, MapToolController.settings().feedback);
        this._style = MapToolController.settings().mapOverlayStyle;
        this._frameCounter = 0;
        this.focusRectPainter = ScriptPainterStore.shared.getPainterSession(this._style.focusRectPainter);
        Object.getOwnPropertyNames(this._feedbackSettings).forEach((key) => {
            this._feedbackSettings[key].painter = ScriptPainterStore.shared.getPainterSession(this._feedbackSettings[key].painter);
        });
    }

    render(ctx) {
        this._frameCounter = this._frameCounter + 1;
        var session = MapToolController.shared.activeSession;
        if (session) {
            this._paintFocusRect(ctx, session);
        }
        this._paintFeedback(ctx);
    }

    _paintFocusRect(ctx, session) {
        var tileRect = session.focusTileRect;
        if (!tileRect) { return; }
        var rect = this.canvasGrid.rectForTileRect(tileRect);
        // if (this._frameCounter % 60 == 0) { debugLog([rect, tileRect, this.focusRectPainter]); }
        if (rect && this.focusRectPainter) {
            this.focusRectPainter.render(ctx, rect, this.canvasGrid, session.textTemplateInfo);
        }
    }

    _paintFeedback(ctx) {
        var items = MapToolController.shared.activeFeedbackItems;
        items.forEach((item) => this._paintFeedbackItem(ctx, item));
    }

    _paintFeedbackItem(ctx, item) {
        var feedback = MapToolController.getFeedbackSettings(this._feedbackSettings, item.code);
        if (!feedback || !feedback.painter || !item.focusTileRect) { return; }
        ctx.save();
        var age = Date.now() - item.timestamp;
        ctx.globalAlpha = UI.fadeOpacity(age, feedback.displayMilliseconds, this._style.feedbackFadeMilliseconds);
        if (feedback.driftPerMillisecond) {
            ctx.translate(feedback.driftPerMillisecond.x * age, feedback.driftPerMillisecond.y * age);
        }
        var rect = this.canvasGrid.rectForTileRect(item.focusTileRect);
        feedback.painter.render(ctx, rect, this.canvasGrid, item);
        ctx.restore();
    }
}

class ScriptPainterCollection {
    static defaultExpectedSize() {
        return { width: 1, height: 1 };
    }

    static fromYaml(id, source, deviceScale) {
        var config = jsyaml.safeLoad(source);
        if (!config) { return null; }
        return ScriptPainterCollection.fromObject(id, config, deviceScale);
    }

    static fromObject(id, config, deviceScale) {
        if (config instanceof Array) {
            config = { variants: [config], expectedSize: ScriptPainterCollection.defaultExpectedSize(), deviceScale: deviceScale };
        } else {
            if (!(config.variants instanceof Array) || (config.variants.length < 1)) {
                throw new TypeError("Invalid ScriptPainter YAML: empty variants array.");
            }
            config = { variants: config.variants, expectedSize: config.expectedSize || ScriptPainterCollection.defaultExpectedSize(), deviceScale: deviceScale };
        }
        if (!config.variants.every(item => item instanceof Array)) {
            throw new TypeError("Invalid ScriptPainter YAML: invalid lines.");
        }
        if (!config.expectedSize || config.expectedSize.width < 1 || config.expectedSize.height < 1) {
            throw new TypeError("Invalid ScriptPainter YAML: invalid expectedSize.");
        }
        return new ScriptPainterCollection(id, config);
    }

    constructor(id, config) {
        this.id = id;
        this.config = config;
        this.variants = config.variants.map(item => new ScriptPainter({ lines: item, expectedSize: config.expectedSize, deviceScale: config.deviceScale }));
    }

    get rawSource() {
        var data = {};
        if (this.config.expectedSize.width == 1 && this.config.expectedSize.height == 1) {
            if (this.variants.length == 1) {
                return jsyaml.dump(this.variants[0].lines, {condenseFlow: true, flowLevel: 1});
            } else {
                data = { variants: this.variants.map(v => v.lines) };
            }
        } else {
            data = { variants: this.variants.map(v => v.lines), expectedSize: this.config.expectedSize };
        }
        return jsyaml.dump(data, {condenseFlow: true, flowLevel: 3});
    }

    getVariant(variantKey) {
        return this.variants[variantKey % this.variants.length];
    }
}

class ScriptPainterSession {
    constructor(id, variantKey, painter) {
        this.id = id;
        this.variantKey = variantKey;
        this.painter = painter;
    }
    render(ctx, rect, canvasGrid, modelMetadata) {
        if (!this.painter) { return; }
        this.painter.render(ctx, rect, canvasGrid, modelMetadata, this);
    }
}

class ScriptPainter {

    // throws
    static fromYaml(source, expectedSize, deviceScale) {
        var lines = jsyaml.safeLoad(source);
        if (lines instanceof Array) {
            return new ScriptPainter({ lines: lines, expectedSize: expectedSize, deviceScale: deviceScale });
        } else {
            throw new TypeError("ScriptPainter YAML source is not an array.");
        }
    }

    constructor(config) {
        this.lines = config.lines;
        this.expectedSize = config.expectedSize;
        this.deviceScale = config.deviceScale;
        this.rDomain = _zeroToOne;
    }

    get rawSource() {
        return jsyaml.dump(this.lines, {condenseFlow: true, flowLevel: 1});
    }

    render(ctx, rect, canvasGrid, modelMetadata, session) {
        // TODO can we compile the lines so you don't parse them every frame?
        // Idea would be to create Path objects, Text objects, etc. (using native Canvas stuff like
        // Path2d or CanvasGradient when possible) with fixed "model" coordinates, then do the final runtime
        // scaling/translation via CanvasRenderingContext2D transformation matrix.
        if (Array.isEmpty(this.lines)) { return; }
        var ext = rect.extremes;
        var xDomain = { min: ext.min.x, max: ext.max.x };
        var yDomain = { min: ext.min.y, max: ext.max.y };
        var xRange = { min: 0, max: rect.width };
        var yRange = { min: 0, max: rect.height };
        var twRange = { min: 0, max: canvasGrid.tileWidth };
        var info = { session: session, canvasGrid: canvasGrid, rect: rect, xDomain: xDomain, yDomain: yDomain, xRange: xRange, yRange: yRange, twRange: twRange, modelMetadata: modelMetadata };
        ctx.save();
        for (var i = 0; i < this.lines.length; i++) {
            var line = this.lines[i];
            if (line.length == 0) { continue; }
            switch (line[0]) {
                case "fill": this._fill(line, ctx, info); break;
                case "innerStroke": this._innerStroke(line, ctx, info); break;
                case "poly": this._poly(line, ctx, info); break;
                case "text": this._text(line, ctx, info); break;
                case "rotate": this._rotate(line, ctx, info); break;
                case "script": this._script(line, ctx, info); break;
            }
        }
        ctx.restore();
    }

    _toPx(value, units, domain, twRange) {
        switch (units) {
            case "p":
                if (domain) {
                    return domain.min + (value * this.deviceScale);
                } else {
                    return value * this.deviceScale;
                }
            case "r":
                return Math.scaleValueLinearUnbounded(value, this.rDomain, domain);
            case "tw":
                return Math.scaleValueLinearUnbounded(value, this.rDomain, twRange);
        }
    }

    _toRect(line, xIndex, info) {
        var units = line[xIndex + 4];
        return new Rect(
            this._toPx(line[xIndex + 0], units, info.xDomain, info.twRange),
            this._toPx(line[xIndex + 1], units, info.yDomain, info.twRange),
            this._toPx(line[xIndex + 2], units, info.xRange, info.twRange),
            this._toPx(line[xIndex + 3], units, info.yRange, info.twRange))
    }

    _toRadians(value, units) {
        switch (units) {
            case "r": return value;
            case "d": return value * radiansPerDegree;
        }
    }

    // [fill,red,rect,0,0,1,1,r]
    //  0    1   2    3 4 5 6 7
    _fill(line, ctx, info) {
        ctx.fillStyle = line[1];
        switch (line[2]) {
            case "rect": ctx.rectFill(this._toRect(line, 3, info)); return;
            case "ellipse": ctx.ellipseFill(this._toRect(line, 3, info)); return;
        }
    }

    // [innerStroke,red,rect,1,p,0,0,1,1,r]
    // line idx 0   1   2    3 4 5 6 7 8 9
    _innerStroke(line, ctx, info) {
        ctx.strokeStyle = line[1];
        ctx.lineWidth = this._toPx(line[3], line[4], null, info.twRange);
        switch (line[2]) {
            case "rect":
                var i = ctx.lineWidth * 0.5;
                var r = this._toRect(line, 5, info).inset(i, i);
                ctx.rectStroke(r);
                return;
        }
    }

    // line, stroke style, fill style, width, width units, coord units, x1, y1, x2, y2, ...
    // 0     1             2           3      4            5            6...n
    _poly(line, ctx, info) {
        ctx.lineWidth = this._toPx(line[3], line[4], null, info.twRange);
        var units = line[5];
        ctx.beginPath();
        for (var xIndex = 6; xIndex < line.length; xIndex += 2) {
            if (xIndex > line.length - 2) { break; }
            var x = this._toPx(line[xIndex], units, info.xDomain, info.twRange);
            var y = this._toPx(line[xIndex+1], units, info.yDomain, info.twRange);
            if (xIndex == 6) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
        if (line[line.length - 1] == "close") {
            ctx.closePath();
        }
        if (!String.isEmpty(line[2])) {
            ctx.fillStyle = line[2];
            ctx.fill();
        }
        if (!String.isEmpty(line[1])) {
            ctx.strokeStyle = line[1];
            ctx.stroke();
        }
    }

    // [text,red,0.25,r,left,top,0.5,0.5,r,R]
    //  0    1   2    3 4    5   6   7   8 9
    _text(line, ctx, info) {
        var sz = this._toPx(line[2], line[3], info.yRange, info.twRange);
        ctx.textAlign = line[4];
        ctx.textBaseline = line[5];
        var x = this._toPx(line[6], line[8], info.xDomain, info.twRange);
        var y = this._toPx(line[7], line[8], info.yDomain, info.twRange);
        ctx.font = `${sz}px sans-serif`;
        ctx.fillStyle = line[1];
        var text = String.fromTemplate(line[9], info.modelMetadata);
        ctx.textFill(text, new Point(x, y));
    }

    // [rotate,amount,d]
    _rotate(line, ctx, info) {
        var rad = this._toRadians(line[1], line[2]);
        var dx = info.rect.x + 0.5 * info.rect.width;
        var dy = info.rect.y + 0.5 * info.rect.height;
        ctx.translate(dx, dy);
        ctx.rotate(rad);
        ctx.translate(-dx, -dy);
    }

    // [script,id,variantKey]
    _script(line, ctx, info) {
        var variantKey = parseInt(line[2]);
        if (isNaN(variantKey) || variantKey < 0) { variantKey = info.session.variantKey; }
        var painter = ScriptPainterStore.shared.getPainterSession(line[1], variantKey);
        painter.render(ctx, info.rect, info.canvasGrid, info.modelMetadata);
    }
}

class ScriptPainterStore {
    constructor() {
        this.deviceScale = FlexCanvasGrid.getDevicePixelScale();
        this.cache = {};
        this.collectionCache = {};
    }

    getPainterCollection(id) {
        var found = this.collectionCache[id];
        if (found) { return found; }
        var data = GameContent.shared.painters[id];
        if (!data) { return null; }
        try {
            var item = ScriptPainterCollection.fromObject(id, data, this.deviceScale);
            if (!item) { return null; }
            this.collectionCache[id] = item;
            return item;
        } catch(e) {
            debugLog(e.message);
            return null;
        }
    }

    getPainter(id, variantKey) {
        var found = this.cache[id];
        variantKey = parseInt(variantKey);
        variantKey = isNaN(variantKey) ? 0 : variantKey;
        if (found) {
            return found[variantKey % found.length];
        }
        var data = GameContent.shared.painters[id];
        if (!data) { return null; }
        var variants = data.variants ? data.variants : [data];
        var expectedSize = data.expectedSize ? data.expectedSize : { width: 1, height: 1 };
        var ds = this.deviceScale;
        this.cache[id] = variants.map(v => new ScriptPainter({ lines: v, expectedSize: expectedSize, deviceScale: ds }));
        return this.getPainter(id, variantKey)
    }

    getPainterSession(id, variantKey) {
        variantKey = parseInt(variantKey);
        variantKey = isNaN(variantKey) ? 0 : variantKey;
        var painter = this.getPainter(id, variantKey);
        return new ScriptPainterSession(id, variantKey, painter);
    }
}

// #################### MISC UI #####################

class Strings {
    static str(id) {
        return GameContent.shared.strings[id] || `?${id}?`;
    }
    static template(id, data) {
        var template = Strings.str(id);
        return template ? String.fromTemplate(template, data) : null;
    }

    static randomCityName() {
        return "Metroville Acres"
    }
    static randomPersonName() {
        return "Eustice von Honla"
    }
    static randomTerrainName() {
        return "Blue Skipes"
    }
}

class GameDialogManager {
    constructor() {
        this.containerElem = document.querySelector("#dialogs");
        this.items = [];
        this._updateArrangement();
    }

    show(dialog) {
        if (!this.containerElem) { return; }
        this.items.push(this);
        this.containerElem.append(dialog.root);
        this._updateArrangement();
    }

    dismiss(dialog) {
        if (!this.containerElem) { return; }
        var index = this.items.findIndex(item => item == dialog);
        if (index >= 0) { this.items.removeItemAtIndex(index); }
        this.containerElem.removeChild(dialog.root);
        this._updateArrangement();
    }

    _updateArrangement() {
        if (!this.containerElem) { return; }
        this.containerElem.addRemClass("hidden", this.containerElem.childElementCount < 1);
        this.containerElem.addRemClass("hasModal", this.containerElem.querySelector(".modal") != null);
    }
}
GameDialogManager.shared = new GameDialogManager();

// Subclass me. Subclasses should implement:
// Required: get title() -> text
// Required: get contentElem() -> DOM "content" element; cloned if needed
// Required: get dialogButtons() -> array of DOM elements
// Optional: get isModal() -> bool
class GameDialog {
    static createContentElem() { return document.createElement("content"); }
    static createFormElem() { return document.createElement("gameForm"); }

    constructor() {
        this.manager = GameDialogManager.shared;
    }

    show() {
        this.root = document.createElement("dialog").addRemClass("modal", this.isModal);
        var header = document.createElement("header");
        this.dismissButton = new ToolButton({
            title: Strings.str("dialogDismissButton"),
            click: () => this.dismissButtonClicked()
        });
        header.append(this.dismissButton.elem);
        header.append(document.createElement("h2").configure(elem => {
            elem.innerText = this.title;
        }));
        // So that the h2 remains centered:
        header.append(this.dismissButton.elem.cloneNode(true).addRemClass("hidden", true));
        this.root.append(header);
        this.root.append(this.contentElem);
        var nav = document.createElement("nav");
        this.dialogButtons.forEach(elem => nav.append(elem));
        this.root.append(nav);
        this.manager.show(this);
    }

    // override if needed
    dismissButtonClicked() {
        this.dismiss();
    }

    dismiss() {
        this.manager.dismiss(this);
    }
}

class NewGameDialog extends GameDialog {
    constructor(terrain) {
        super();
        this.terrain = terrain;
        this.startButton = new ToolButton({
            title: Strings.str("newGameDialogStartButton"),
            click: () => this.validateAndStart()
        });
        this.contentElem = GameDialog.createContentElem();
        var formElem = GameDialog.createFormElem();
        this.cityNameInput = new TextInputView({
            parent: formElem,
            title: Strings.str("citySettingsCityNameLabel"),
            placeholder: "",
            transform: InputView.trimTransform,
            validationRules: [InputView.notEmptyOrWhitespaceRule]
        }).configure(input => input.value = Strings.randomCityName());
        this.mayorNameInput = new TextInputView({
            parent: formElem,
            title: Strings.str("citySettingsMayorNameLabel"),
            placeholder: "",
            transform: InputView.trimTransform,
            validationRules: [InputView.notEmptyOrWhitespaceRule]
        }).configure(input => input.value = Strings.randomPersonName());

        this.difficulties = new SingleChoiceInputCollection({
            id: "difficulty",
            parent: formElem,
            title: Strings.str("citySettingsDifficultyLabel"),
            validationRules: [SingleChoiceInputCollection.selectionRequiredRule],
            choices: Game.rules().difficulties.map(difficulty => { return {
                title: Strings.template("difficultyChoiceLabelTemplate", Object.assign({formattedCash: Simoleon.format(difficulty.startingCash)}, difficulty)),
                value: difficulty.index,
                selected: !!difficulty.isDefault
            }; })
        });

        // TODO come up with a standard HTML/CSS format and a shared JS class for input forms within 
        // dialogs. A form is an element within a dialog, not a type of dialog, so that you can have 
        // multiple forms inside a dialog; the owner of the form is responsible for any "submit" buttons
        // (rather than being embedded within the form) - that way for a single form you can have the 
        // standard bottom-of-dialog buttons.

        this.contentElem.append(formElem);
        this.allInputs = [this.cityNameInput, this.mayorNameInput, this.difficulties];
    }

    get isModal() { return true; }

    get title() { return Strings.str("newGameDialogTitle"); }

    get dialogButtons() {
        return [this.startButton.elem];
    }

    get isValid() {
        return this.allInputs.every(input => input.isValid);
    }

    get difficulty() {
        return Game.difficultyOrDefaultForIndex(this.difficulties.value);
    }

    validateAndStart() {
        if (!this.isValid) {
            debugLog("NOT VALID");
            return;
        }
        var city = new City({
            name: this.cityNameInput.value,
            mayorName: this.mayorNameInput.value,
            difficulty: this.difficulty,
            terrain: this.terrain
        });
        CitySim.game = new Game({
            city: city,
            rootView: rootView
        });
        CitySim.game.start();
        engineRunLoop.resume();
        this.dismiss();
    }

    dismissButtonClicked() {
        Game.quit(false);
    }
}

class LoadGameMenu {
    constructor() {
        this.mainMenuSection = document.querySelector("#mainMenu");
        this.loadFilesSection = document.querySelector("#loadFileMenu");
        this.noFilesToLoadSection = document.querySelector("#noFilesToLoad");
        this.gameInfoSection = document.querySelector("#gameInfo");
        this.terrainInfoSection = document.querySelector("#terrainInfo");
        this.allSections = [this.mainMenuSection, this.loadFilesSection, this.noFilesToLoadSection, this.gameInfoSection, this.terrainInfoSection];
        this.selectedGame = null;
        this.selectedTerrain = null;

        document.querySelectorAll("#root .showGameList").forEach(elem => {
            elem.addEventListener("click", evt => {
                evt.preventDefault(); this.showGameList();
            });
        });
        document.querySelectorAll("#root .showTerrainList").forEach(elem => {
            elem.addEventListener("click", evt => {
                evt.preventDefault(); this.showTerrainList();
            });
        });
        document.querySelectorAll("#root .showMainMenu").forEach(elem => {
            elem.addEventListener("click", evt => {
                evt.preventDefault(); this._showSection(this.mainMenuSection);
            });
        });
        document.querySelector("#gameInfo .open").addEventListener("click", evt => {
            evt.preventDefault(); this._openSelectedGame();
        });
        document.querySelector("#terrainInfo .open").addEventListener("click", evt => {
            evt.preventDefault(); this._openSelectedTerrain();
        });
        document.querySelector("#gameInfo .delete").addEventListener("click", evt => {
            evt.preventDefault(); this._promptDeleteSelectedGame();
        });
        document.querySelector("#terrainInfo .delete").addEventListener("click", evt => {
            evt.preventDefault(); this._promptDeleteSelectedTerrain();
        });
        document.querySelector("#terrainInfo .newGame").addEventListener("click", evt => {
            evt.preventDefault(); this._newGameFromSelectedTerrain();
        })

        // change to "post div" to do the multiple-gradients-within-the-post effect
        var stopper = i => `hsl(${i.h},${i.s}%,${i.l}%) ${i.x}px`
        document.querySelectorAll("post").forEach(elem => {
            var x = 0;
            var stops = [];
            var last = null;
            while (stops.length < 12) {
                x += Rng.shared.nextIntOpenRange(1, 4);
                var next = {
                    h: Rng.shared.nextIntOpenRange(19, 25),
                    s: Rng.shared.nextIntOpenRange(25, 50),
                    l: Rng.shared.nextIntOpenRange(20, 60),
                    x: x
                };
                if (last) { last.x = x; stops.push(stopper(last)); }
                stops.push(stopper(next));
                // stops.push(`hsl(${h},${s}%,${l}%) ${x}px`);
                last = next;
            }
            elem.style.background = `repeating-linear-gradient(90deg, ${stops.join(", ")})`;
        });

        this._setUpFocusBlur();
    }

    get storage() {
        return GameStorage.shared;
    }

    showGameList() {
        this._setFileTypeClass("game");
        this.showFileList(this.storage.allSavedGames, file => this._showGameDetails(file));
    }

    showTerrainList() {
        this._setFileTypeClass("terrain");
        this.showFileList(this.storage.allSavedTerrains, file => this._showTerrainDetails(file));
    }

    showFileList(files, selectFileClick) {
        if (files.length == 0) {
            this._showSection(this.noFilesToLoadSection);
        } else {
            let containerElem = this.loadFilesSection.querySelector("tbody");
            containerElem.removeAllChildren();
            files.forEach(file => {
                let row = document.createElement("tr");
                row.addRemClass("invalid", !this.storage.isSaveStateSummarySupported(file));
                row.append(this._td(file.title, "name"));
                row.append(this._td(this._formatTimestamp(file.timestamp), "date"));
                row.append(this._td(this._formatFileSize(file.sizeBytes), "size"));
                containerElem.append(row);
                row.addEventListener("click", evt => {
                    evt.preventDefault(); selectFileClick(file);
                });
                // TODO an <input> to type the file name directly to simulate an old computer. with a Load button.
                // TODO import button to paste in JSON. Export button is within city.html in the File menu.
            });
            this._showSection(this.loadFilesSection);
        }
    }

    _setFileTypeClass(name) {
        this.loadFilesSection.addRemClass("game", name == "game");
        this.loadFilesSection.addRemClass("terrain", name == "game");
        this.noFilesToLoadSection.addRemClass("game", name == "game");
        this.noFilesToLoadSection.addRemClass("terrain", name == "game");
    }

    _showGameDetails(game) {
        this.selectedGame = game;
        var isValid = this.storage.isSaveStateSummarySupported(game);
        this.gameInfoSection.addRemClass("valid", isValid);
        this.gameInfoSection.querySelector("h2").innerText = `${game.title}, ${this._formatTimestamp(game.timestamp)}`;
        this.gameInfoSection.querySelector(".name").innerText = game.metadata ? game.metadata.cityName : "";
        this.gameInfoSection.querySelector(".population").innerText = game.metadata ? game.metadata.population : "";
        this.gameInfoSection.querySelector(".cash").innerText = game.metadata ? game.metadata.cash : "";
        this.gameInfoSection.querySelector(".date").innerText = game.metadata ? game.metadata.gameDate : "";
        this.gameInfoSection.querySelector(".open").addRemClass("disabled", !isValid);
        // TODO show a minimap
        this._showSection(this.gameInfoSection);
    }

    _showTerrainDetails(file) {
        this.selectedTerrain = file;
        var isValid = this.storage.isSaveStateSummarySupported(file);
        this.terrainInfoSection.addRemClass("valid", isValid);
        this.terrainInfoSection.querySelector("h2").innerText = `${file.title}, ${this._formatTimestamp(file.timestamp)}`;
        this.terrainInfoSection.querySelector(".name").innerText = file.metadata ? file.metadata.name : "";
        this.terrainInfoSection.querySelector(".size").innerText = file.metadata ? file.metadata.size : "";
        this.terrainInfoSection.querySelector(".landform").innerText = file.metadata ? file.metadata.landform : "";
        this.terrainInfoSection.querySelector(".open").addRemClass("disabled", !isValid);
        this.terrainInfoSection.querySelector(".newGame").addRemClass("disabled", !isValid);
        // TODO show a minimap
        this._showSection(this.terrainInfoSection);
    }

    _openSelectedGame() {
        if (!this.storage.isSaveStateSummarySupported(this.selectedGame)) { return; }
        var url = this.storage.urlForGameID(this.selectedGame.id);
        window.location.assign(url);
        debugLog("go to " + url);
    }

    _openSelectedTerrain() {
        if (!this.storage.isSaveStateSummarySupported(this.selectedTerrain)) { return; }
        var url = this.storage.urlForTerrainID(this.selectedTerrain.id);
        window.location.assign(url);
        debugLog("go to " + url);
    }

    _newGameFromSelectedTerrain() {
        if (!this.storage.isSaveStateSummarySupported(this.selectedTerrain)) { return; }
        let url = this.storage.urlForNewGameWithTerrainID(this.selectedTerrain.id);
        window.location.assign(url);
        debugLog("go to " + url);
    }

    _promptDeleteSelectedGame() {
        if (!this.selectedGame) { return; }
        if (!confirm(Strings.str("deleteFileConfirmPrompt"))) { return; }
        debugLog(this.storage);
        this.storage.gameCollection.deleteItem(this.selectedGame.id);
        this.showGameList();
    }

    _promptDeleteSelectedTerrain() {
        if (!this.selectedTerrain) { return; }
        if (!confirm(Strings.str("deleteFileConfirmPrompt"))) { return; }
        debugLog(this.storage);
        this.storage.terrainCollection.deleteItem(this.selectedTerrain.id);
        this.showTerrainList();
    }

    _showSection(elem) {
        this.allSections.forEach(item => {
            item.addRemClass("hidden", item != elem);
        });
    }

    _td(text, type) {
        var elem = document.createElement("td");
        elem.innerText = text;
        elem.addRemClass(type, true);
        return elem;
    }

    _formatTimestamp(timestamp) {
        return new Date(timestamp).toLocaleString([], { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }

    _formatFileSize(size) {
        if (size > (1024 * 1024) - 1) {
            return `${(size / (1024*1024)).toFixed(2)} MB`;
        }
        if (size > 1023) {
            return `${(size / 1024).toFixed(2)} KB`;
        }
        return Number.uiInteger(size);
    }

    _setUpFocusBlur() {
        var containerElem = document.querySelector("body > div");
        this.focusElems = {
            backgrounds: [document.querySelector("#background")],
            foregrounds: [document.querySelector("post"), document.querySelector("#root > div")],
            all: Array.from(document.querySelectorAll(".focusable")),
        };
        this.parallax = {
            width: containerElem.clientWidth,
            height: containerElem.clientHeight,
            magnitude: [3, 9, 15, 25],
            elems: [
                Array.from(document.querySelectorAll(".parallax")),
                Array.from(document.querySelectorAll("#background .min")),
                Array.from(document.querySelectorAll("#background .middle")),
                Array.from(document.querySelectorAll("#background .max"))
            ]
        };
        this.focusElems.backgrounds.forEach(elem => { elem.dataset["focusgroup"] = "bg"; });
        this.focusElems.foregrounds.forEach(elem => { elem.dataset["focusgroup"] = "fg"; });
        this.focusElems.foregrounds.forEach(elem => {
            var blur = "blur(1px)";
            var nothing = "blur(0px)";
            elem.addEventListener("mouseleave", evt => {
                this.focusElems.all.forEach(item => {
                    item.style.filter = (item.dataset["focusgroup"] == "fg") ? blur : nothing;
                });
            });
            elem.addEventListener("mouseenter", evt => {
                this.focusElems.all.forEach(item => {
                    item.style.filter = (item.dataset["focusgroup"] == "fg") ? nothing : blur;
                });
            });
        });
        if (this.parallax.width > 1 && this.parallax.height > 1) {
            document.addEventListener("mousemove", evt => {
                var x = 1 - (evt.clientX / (0.5 * this.parallax.width));
                var y = (this.parallax.height - evt.clientY) / this.parallax.height;
                this._setParallax(x * Math.abs(x), y * Math.abs(y));
            });
        }
    }

    _setParallax(x, y) {
        this.parallax.elems.forEach((items, index) => {
            var transform = `translate(${x * this.parallax.magnitude[index]}px, ${y * this.parallax.magnitude[index]}px)`;
            items.forEach(item => { item.style.transform = transform; });
        });
    }
}

// ########################### INIT #######################

if (!window.doNotInitializeGame) {
    var engineRunLoop = new Gaming.RunLoop({
        targetFrameRate: 1,
        id: "engineRunLoop",
        childRunLoops: []
    });
    var uiRunLoop = new Gaming.RunLoop({
        targetFrameRate: 60,
        id: "uiRunLoop",
        childRunLoops: [engineRunLoop]
    });
    var rootView = new RootView();
}

var initialize = async function() {
    var content = await GameContent.loadYamlFromLocalFile("city-content.yaml", GameContent.cachePolicies.forceOnFirstLoad);
    dataIsReady(content);
};

var dataIsReady = function(content) {
    if (!content) {
        if (window.doNotInitializeGame) { return; }
        rootView.failedToLoadGameMessage(Strings.str("failedToLoadGameMessage"));
        return;
    }

    GameContent.shared = GameContent.prepare(content);
    if (!window.doNotInitializeGame) {
        GameScriptEngine.shared = new GameScriptEngine();
        ScriptPainterStore.shared = new ScriptPainterStore();
        KeyInputController.shared = new KeyInputController();
        MapToolController.shared = new MapToolController();
        rootView.setUp();
    }
    if (window.prepareLoadGamePrompt) {
        CitySim.loadMenu = new CitySim.LoadGameMenu();
    }
};

return {
    engineRunLoop: engineRunLoop,
    game: null,
    initialize: initialize,
    rootView: rootView,
    uiRunLoop: uiRunLoop,
    Budget: Budget,
    City: City,
    CityMap: CityMap,
    Game: Game,
    GameDialog: GameDialog,
    GameStorage: GameStorage,
    GridPainter: GridPainter,
    InputView: InputView,
    KeyInputController: KeyInputController,
    LoadGameMenu: LoadGameMenu,
    MapLayer: MapLayer,
    MapRenderer: MapRenderer,
    Plot: Plot,
    RCIValue: RCIValue,
    ScriptPainter: ScriptPainter,
    ScriptPainterCollection: ScriptPainterCollection,
    ScriptPainterSession: ScriptPainterSession,
    ScriptPainterStore: ScriptPainterStore,
    SimDate: SimDate,
    Simoleon: Simoleon,
    SingleChoiceInputCollection: SingleChoiceInputCollection,
    Strings: Strings,
    Terrain: Terrain,
    TerrainRenderer: TerrainRenderer,
    TerrainTile: TerrainTile,
    TerrainType: TerrainType,
    TextInputView: TextInputView,
    ToolButton: ToolButton,
    Z: Z,
    Zone: Zone,
    ZoomSelector: ZoomSelector
};

})(); // end CitySim namespace

CitySim.initialize();
