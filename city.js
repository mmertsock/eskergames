"use-strict";

window.CitySim = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;

const Binding = Gaming.Binding;
const CanvasStack = Gaming.CanvasStack;
const CircularArray = Gaming.CircularArray;
const ChangeTokenBinding = Gaming.ChangeTokenBinding;
const Easing = Gaming.Easing;
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

const radiansPerDegree = Math.PI / 180;
const _stringTemplateRegexes = {};
const _zeroToOne = { min: 0, max: 1 };
const _1x1 = { width: 1, height: 1 };

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
        return data ? new Plot({ dz: {
            bounds: Rect.fromDeserializedWrapper(data.bounds, schemaVersion),
            item: Plot.deserializerForItemClass(data.itemClass)(data.item, schemaVersion),
            data: data.data
        } }) : null;
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
        return (point.x == this.bounds.x)
            && (point.y == this.bounds.y);
//            && (point.y == this.bounds.y + this.bounds.height - 1);
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
            return new PainterInfoList([new PainterInfo("terrain_dirt", PainterInfo.pseudoRandomVariantKey("terrain_dirt", this.point))], _1x1);
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
            .map(i => new PainterInfo(id, i));
        // return [{ id: id, variantKey: 0 }, { id: id, variantKey: 1 }];
        return new PainterInfoList(variants, _1x1);
    }
}

class PlotTile extends MapTile {
    static fromDeserializedWrapper(data, schemaVersion, point, layer) {
        let tile = new PlotTile(point, layer);
        tile.plot = Plot.fromDeserializedWrapper(data.plot, schemaVersion);
        return tile;
    }

    constructor(point, layer) {
        super(point, layer);
        this._plot = null;
        this.isPaintOrigin = false;
        this._painterInfoList = null;
    }

    get plot() { return this._plot; }
    set plot(value) {
        this._plot = value;
        this.isPaintOrigin = value ? value.isPaintOrigin(this.point) : false;
        this._painterInfoList = null;
    }

    get objectForSerialization() {
        return { plot: this._plot ? this._plot.objectForSerialization : null };
    }

    get painterInfoList() {
        if (this._painterInfoList) { return this._painterInfoList; }
        this._painterInfoList = this._makePainterInfoList(this._plot);
        return this._painterInfoList;
    }

    _makePainterInfoList(plot) {
        if (!plot || !this.isPaintOrigin) { return new PainterInfoList([]); }
        let id = null;
        switch (plot.item.constructor.name) {
            case Zone.name: id = `zone${plot.item.type}d0v0`; break;
            case TerrainProp.name: id = `prop${plot.item.type}`; break;
            default: return new PainterInfoList([]);
        }
        return new PainterInfoList([new PainterInfo(id, PainterInfo.safeVariantKey(id, plot.data.variantKey))], plot.bounds.size);
    }
}

// Closely managed by CityMap
class MapLayer {
    static fromDeserializedWrapper(data, schemaVersion, config) {
        if (!data) {
            return new MapLayer(config);
        }
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

    getTileAtPoint(point) {
        let row = this._tiles[point.y];
        return row ? row[point.x] : null;
    }

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

    visitNeighborsInRect(rect, tile, block) {
        this.visitTiles(rect, item => {
            if (item != tile) block(item);
        });
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
    static Kvo() { return { "plots": "plots" }; }

    static fromDeserializedWrapper(data, schemaVersion) {
        deserializeAssert(data != null);
        deserializeAssert(data.size != null && data.terrainLayer != null);
        return new CityMap({dz: {
            size: data.size,
            schemaVersion: schemaVersion,
            terrainLayer: data.terrainLayer,
            plotLayer: data.plotLayer
        }});
    }

    constructor(config) {
        let size = config.dz ? config.dz.size : config.size;
        this.size = size;
        this.bounds = new Rect(new Point(0, 0), this.size);
        this.tilePlane = new TilePlane(this.size);


        let terrainConfig = { map: this, id: MapLayer.id.terrain, tileClass: TerrainTile };
        let plotConfig = { map: this, id: MapLayer.id.plots, tileClass: PlotTile };
        if (config.dz) {
            this.terrainLayer = MapLayer.fromDeserializedWrapper(config.dz.terrainLayer, config.dz.schemaVersion, terrainConfig);
            this.plotLayer = MapLayer.fromDeserializedWrapper(config.dz.plotLayer, config.dz.schemaVersion, plotConfig);
        } else {
            this.terrainLayer = new MapLayer(terrainConfig);
            this.plotLayer = new MapLayer(plotConfig);
        }
        this.kvo = new Kvo(this);
    }

    get objectForSerialization() {
        return {
            size: this.size,
            terrainLayer: this.terrainLayer.objectForSerialization,
            plotLayer: this.plotLayer.objectForSerialization
        };
    }

    get debugDescription() {
        return `<CityMap ${this.size.width}x${this.size.height} with 0 plots>`;
    }

    get visibleLayers() {
        return [this.terrainLayer, this.plotLayer];
    }

    isValidCoordinate(x, y) { return this.bounds.containsTile(x, y); }
    isTileRectWithinBounds(rect) { return this.bounds.contains(rect); }

    modifyTerrain(tiles) {
        tiles.forEachFlat(tile => {
            this.terrainLayer.getTileAtPoint(tile.point).type = tile.type;
        });
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
        if (!fromFile) {
            debugLog(`Added plot ${plot.title} at ${plot.bounds.debugDescription}`);
            this.kvo.plots.notifyChanged();
        }
        return plot;
    }

    removePlot(plot) {
        this.plotLayer.visitTiles(plot.bounds, tile => { tile.plot = null; });
        this.kvo.plots.notifyChanged();
    }

    visitEachPlot(block) {
        this.plotLayer.visitTiles(null, tile => {
            if (tile.isPaintOrigin) block(tile.plot);
        });
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

class KeyInputShortcut {
    constructor(config) {
        this.code = config.code;
        this.shift = config.shift;
        this.callbacks = [];
        this.fired = false;
        this.score = this.shift ? 2 : 1;
    }

    get debugDescription() {
        return `<KeyInputShortcut${this.score} ${this.shift ? "Shift+" : ""}${this.code}${this.fired ? " (fired)" : ""}>`;
    }

    addCallback(callback) { this.callbacks.push(callback); }

    handlesConfig(config) {
        return this.code == config.code
            && this.shift == config.shift;
    }

    isReady(controller) {
        return !this.fired && this.isMatch(controller);
    }

    isMatch(controller) {
        if (!controller.isCodeActive(this.code)) return false;
        if (this.shift && !controller.isCodeActive(KeyInputController.Codes.anyShift)) return false;
        return true;
    }

    reset() { this.fired = false; }

    resetIfNotMatch(controller) {
        if (!this.isMatch(controller))
            this.reset();
    }

    fire(controller, evt) {
        this.fired = true;
        this.callbacks.forEach(item => item(controller, this, evt));
    }

    blockIfSupersededBy(shortcut) {
        if (this != shortcut && shortcut.code == this.code) {
            this.fired = true;
        }
    }
}

class KeyInputController {
    constructor() {
        document.addEventListener("keydown", e => this.keydown(e));
        document.addEventListener("keyup", e => this.keyup(e));
        window.addEventListener("blur", e => this.stop(e));
        window.addEventListener("focus", e => this.start(e));
        this.codeState = {}; // code => keydown timestamp
        // this.currentCodes = new Set();
        this.shortcuts = [];
        this.isActive = true;
    }

    get activeCodes() { return Object.getOwnPropertyNames(this.codeState); }

    isCodeActive(code) { return this.codeState.hasOwnProperty(code); }

    timeSinceFirstCode(codes, evt) {
        let min = codes
            .map(code => this.isCodeActive(code) ? this.codeState[code] : Number.MAX_SAFE_INTEGER)
            .reduce((i, j) => Math.min(i, j), evt.timeStamp);
        let value = evt.timeStamp - min;
        return value > 0 ? value : 0;
    }

    addShortcutsFromSettings(settings) {
        settings.keyPressShortcuts.forEach(item => {
            item = Array.from(item);
            let tokens = item.shift().split("+");
            let script = item[0], subject = item[1];
            if (tokens.length == 2) {
                if (tokens[0] == "Shift") {
                    this.addGameScriptShortcut(tokens[1], true, script, subject);
                } else {
                    debugWarn(`Unhandled shortcut config ${tokens[0]}+${tokens[1]}`);
                }
            } else {
                this.addGameScriptShortcut(tokens[0], false, script, subject);
            }
        });
    }

    addGameScriptShortcut(code, shift, script, subject) {
        // TODO build a help menu automatically
        this.addShortcutListener({ code: code, shift: shift }, (controller, shortcut, evt) => {
            GameScriptEngine.shared.execute(script, subject);
        });
    }

    addShortcutListener(options, callback) {
        let shortcut = this.shortcuts.find(item => item.handlesConfig(options));
        if (!shortcut) {
            shortcut = new KeyInputShortcut(options);
            this.shortcuts.push(shortcut);
            // Higher-scored shortcuts take priority
            this.shortcuts.sort((a, b) => b.score - a.score);
        }
        return shortcut.addCallback(callback);
    }

    codesFromEvent(evt) {
        let codes = [evt.code];
        switch (evt.code) {
            case "ShiftLeft":
            case "ShiftRight":
                codes.push(KeyInputController.Codes.anyShift); break;
        }
        return codes;
    }

    keydown(evt) {
        if (!this.isActive) return;
        let codes = this.codesFromEvent(evt);
        // codes.forEach(code => this.currentCodes.add(code));
        codes.forEach(code => {
            if (!this.isCodeActive(code)) this.codeState[code] = evt.timeStamp;
        });
        this.forEachDelegate(delegate => {
            delegate.keyStateDidChange(this, { evt: evt, down: codes, up: [] });
        });

        let shortcut = this.shortcuts.find(item => item.isReady(this));
        if (shortcut) {
            shortcut.fire(this, evt);
            this.shortcuts.forEach(item => item.blockIfSupersededBy(shortcut));
        }
    }

    keyup(evt) {
        if (!this.isActive) return;
        let codes = this.codesFromEvent(evt);
        // codes.forEach(code => this.currentCodes.delete(code));
        codes.forEach(code => { delete this.codeState[code]; });
        this.forEachDelegate(delegate => {
            delegate.keyStateDidChange(this, { evt: evt, down: [], up: codes });
        });

        this.shortcuts.forEach(item => item.resetIfNotMatch(this));
    }

    start(evt) {
        this.isActive = true;
    }

    stop(evt) {
        this.isActive = false;
        this.clear(evt);
    }

    clear(evt) {
        let codes = this.activeCodes;
        this.codeState = {};
        // this.currentCodes.clear();
        this.forEachDelegate(delegate => {
            delegate.keyStateDidChange(this, { evt: evt, down: [], up: codes });
        });
        this.shortcuts.forEach(item => item.reset());
    }
}
KeyInputController.Codes = {
    anyShift: "*Shift"
};
Mixins.Gaming.DelegateSet(KeyInputController);

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
        this._viewTile = null; // TODO refactor this/make it part of this.state
        this._modelTile = null;
        this.state = {}; // TODO a generic way to do model object state
    }

    receivedPointInput(inputSequence) {
        var action = null;
        // TODO can use this.state to determine if the tile changed between this and the last point-input
        let viewTile = this.canvasGrid.tileForCanvasPoint(inputSequence.latestPoint);
        let modelTile = this.tilePlane.modelTileForScreen(viewTile);
        if (modelTile) {
            if (inputSequence.isSingleClick) {
                action = this.tool.performSingleClickAction(this, modelTile);
            }
            this._viewTile = viewTile;
            this._modelTile = modelTile;
        }
        return { code: MapToolSession.InputResult.continueCurrentSession, action: action };
    }

    pause() { }

    resume() { }

    end() { }

    // UI stuff

    get tilePlane() { return this.game.city.map.tilePlane; }

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
        if (!this._viewTile) { return null; }
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
        return this.tilePlane.screenRectForModel(this.tool.focusRectForTileCoordinate(this, this._modelTile));
    }

    // (optional) What to render next to the cursor. Note it defines the position
    // to paint at; not the current cursor x/y position.
    get hoverStatusRenderInfo() {
        if (!this._viewTile) { return null; }
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
        this.game = config.viewModel.game;
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
        this.views.push(new MainMapView({ game: game, elem: this.root.querySelector(".mainMap"), runLoop: uiRunLoop }));
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

class AnimationState {
    static Kvo() { return { "frameCounter": "frameCounter" }; }

    constructor(runLoop) {
        this.millisecondsPerAnimationFrame = 500;
        this.frameCounter = 0;
        this.kvo = new Kvo(this);
        runLoop.addDelegate(this);
    }

    processFrame(rl) {
        let value = Math.floor(rl.latestFrameStartTimestamp() / this.millisecondsPerAnimationFrame);
        if (value == this.frameCounter) return;
        this.kvo.frameCounter.setValue(value);
    }
}

class MainMapViewModel {
    static defaultZoomLevel() {
        return GameContent.defaultItemFromArray(GameContent.shared.mainMapView.zoomLevels);
    }
    static settings() { return GameContent.shared.mainMapView; }

    static Kvo() { return { "zoomLevel": "_zoomLevel" }; }

    constructor(config) {
        this.game = config.game;
        this._zoomLevel = config.zoomLevel;
        this.animation = new AnimationState(config.runLoop);
        this.layers = [];
        this.layers.push(new MapLayerViewModel({
            index: 0,
            model: this,
            showGrid: false,
            showBorder: true,
            spriteSource: new TerrainSpriteSource({
                sourceLayer: this.map.terrainLayer,
                spriteStore: this.spriteStore
            })
        }));
        this.layers.push(new MapLayerViewModel({
            index: 1,
            model: this,
            showGrid: true,
            showBorder: false,
            spriteSource: new PlotSpriteSource({
                sourceLayer: this.map.plotLayer,
                spriteStore: this.spriteStore
            }),
            binding: this.map.kvo.plots
        }));
        this.kvo = new Kvo(this);
    }

    get map() { return this.game.city.map; }
    get zoomLevel() { return this._zoomLevel; }
    set zoomLevel(value) { this.kvo.zoomLevel.setValue(value); }
    get spriteStore() { return SpritesheetStore.mainMapStore; }

    configureCanvasGrid(existingGrid, canvas) {
        if (existingGrid) {
            existingGrid.setSize({ tileWidth: this.zoomLevel.tileWidth, tileSpacing: 0 });
            return existingGrid;
        } else {
            return new FlexCanvasGrid({
                canvas: canvas,
                deviceScale: FlexCanvasGrid.getDevicePixelScale(),
                tileWidth: this.zoomLevel.tileWidth,
                tileSpacing: 0
            });
        }
    };
}

class MainMapView {
    constructor(config) {
        this.elem = config.elem;
        this.runLoop = config.runLoop;

        let zoomers = MainMapViewModel.settings().zoomLevels.map((z) => new ZoomSelector(z, this));
        this.zoomSelection = new SelectableList(zoomers);
        this.model = new MainMapViewModel({
            game: config.game,
            runLoop: config.runLoop,
            zoomLevel: this.zoomSelection.selectedItem.value
        });
        this.layerViews = [];
        this.rebuildLayers();

        this._configureCommmands();
        this.runLoop.addDelegate(this);
    }

    rebuildLayers() {
        this.layerViews.forEach(view => view.remove());
        this.layerViews = this.model.layers.map(layer => new SpriteMapLayerView({
            containerElem: this.elem,
            layer: layer,
            wrap: false
        }));
        this.layerViews.push(new MapToolLayerView({
            containerElem: this.elem,
            viewModel: this.model
        }));
    }

    processFrame(rl) {
        this.layerViews.forEach(view => view.render());
    }

    zoomLevelActivated(value) { this.model.zoomLevel = value; }

    _configureCommmands() {
        const gse = GameScriptEngine.shared;
        gse.registerCommand("zoomIn", () => this.zoomSelection.selectNext());
        gse.registerCommand("zoomOut", () => this.zoomSelection.selectPrevious());
        gse.registerCommand("setZoomLevel", (index) => this.zoomSelection.setSelectedIndex(index));
    }
}

class MapToolLayerView {
    constructor(config) {
        this.viewModel = config.viewModel;
        this.canvas = document.createElement("canvas");
        config.containerElem.append(this.canvas);

        this.canvasGrid = this.viewModel.configureCanvasGrid(this.canvasGrid, this.canvas);
        this.canvasInputController = new PointInputController({
            eventTarget: this.canvas,
            trackAllMovement: true
        });
        MapToolController.shared.initialize({
            viewModel: this.viewModel,
            canvasInputController: this.canvasInputController,
            canvasGrid: this.canvasGrid
        });
        this.toolRenderer = new MapToolSessionRenderer({ canvasGrid: this.canvasGrid, viewModel: this.viewModel });

        this.viewModel.kvo.zoomLevel.addObserver(this, () => this.zoomLevelChanged());
        this.zoomLevelChanged();
    }

    remove() {
        this.canvasGrid = null;
        this.canvas.remove();
        Kvo.stopAllObservations(this);
    }

    zoomLevelChanged() {
        setTimeout(() => {
            this.canvasGrid = this.viewModel.configureCanvasGrid(this.canvasGrid, this.canvas);
        }, 100);
    }

    render() {
        let ctx = this.canvas.getContext("2d", { alpha: true });
        ctx.rectClear(this.canvasGrid.rectForFullCanvas);
        this.toolRenderer.render(ctx);
    }
}

class TileRenderContext {
    constructor(config) {
        this.canvas = config.canvas; // HTMLCanvasElement
        this.viewport = config.viewport; // CanvasTileViewport
        this.tilePlane = config.viewport.tilePlane;
        this.isAnimated = config.viewport.zoomLevel.allowAnimation;
        this.frameCounter = this.isAnimated ? config.viewport.animation.frameCounter : 0;
        this.visibleModelRect = this.viewport.tilePlane.visibleModelRect;
        this.isOpaque = !!config.isOpaque;
        this._ctx = null;
    }

    get ctx() {
        if (!this._ctx) this._ctx = this.canvas.getContext("2d", { alpha: !this.isOpaque });
        return this._ctx;
    }
}

class CanvasTileViewport {
    static Kvo() { return { "zoomLevel": "zoomLevel", "mapSize": "mapSize", "visibleModelRect": "visibleModelRect" }; }

    constructor(config) {
        let zoomLevels = GameContent.shared.mainMapView.zoomLevels;
        let zoomers = zoomLevels.map((z) => new ZoomSelector(z, this));
        this.zoomSelection = new SelectableList(zoomers);
        let initialZoomLevel = config.initialZoomLevel ? config.initialZoomLevel : GameContent.defaultItemFromArray(zoomLevels);
        this.zoomSelection.setSelectedIndex(initialZoomLevel.index);

        this.canvasStack = new CanvasStack(config.containerElem, config.layerCount);
        this.inputController = new CanvasInputController({ viewport: this });
        this.tilePlane = new TilePlane(config.mapSize, this.zoomLevel.tileWidth * this.canvasStack.pixelScale);
        this._centerTile = new Point(this.tilePlane.size.width * 0.5, this.tilePlane.size.height * 0.5).integral();
        this._offsetEasing = null;
        this.animation = config.animation;

        // number of tiles to allow showing on each side of 
        // the tilePlane's bounds when panning to edges.
        this.marginSize = { width: config.marginSize.width, height: config.marginSize.height };
        this.kvo = new Kvo(this);
        this.canvasStack.kvo.canvasDeviceSize.addObserver(this, () => this.updateTilePlane(null, false));
        this.updateTilePlane(null, false);
    }

    // tiles wide/high
    get mapSize() { return this.tilePlane.size; }
    set mapSize(value) {
        this.tilePlane.size = value;
        this.updateTilePlane(null, false);
        this.kvo.mapSize.notifyChanged();
    }

    get zoomLevel() { return this.zoomSelection.selectedItem.value; }
    zoomIn() { this.zoomSelection.selectNext(); }
    zoomOut() { this.zoomSelection.selectPrevious(); }
    setZoomLevelIndex(index) { this.zoomSelection.setSelectedIndex(index); }

    get centerTile() { return this._centerTile; }
    set centerTile(value) {
        this.updateTilePlane(value, true);
    }

    pan(direction, large) {
        let unit = Vector.manhattanUnits[direction];
        if (!unit) return;
        let factor = large ? 5 : 1;
        let newOffset = unit.offsettingPosition(this.tilePlane.offset, this.zoomLevel.panTiles * this.tilePlane.tileWidth * factor);
        this.updateOffset(newOffset, true, false);
    }

    getContext(index, isOpaque) {
        if (!!this._offsetEasing) {
            this.tilePlane.offset = new Point(this._offsetEasing.x.value, this._offsetEasing.y.value);
            this.kvo.visibleModelRect.notifyChanged();
            // debugLog(`Eased to ${this.tilePlane.offset}`);
            if (this._offsetEasing.x.isComplete) this._offsetEasing = null;
        }
        return new TileRenderContext({
            canvas: this.canvasStack.getCanvas(index),
            viewport: this,
            isOpaque: isOpaque
        });
    }

    infoForCanvasEvent(evt) {
        let point = new Point(evt.offsetX * this.canvasStack.pixelScale, evt.offsetY * this.canvasStack.pixelScale);
        let tile = this.tilePlane.modelTileForScreenPoint(point);
        return { evt: evt, viewport: this, point: point, tile: tile };
    }

    zoomLevelActivated(value) {
        if (!this.tilePlane) return;
        // TODO hmm should TilePlane do this automatically? eh thinking no.
        // have it not care at all what the content offset is. this can have the logic for 
        // keeping things within correct bounds.
        // To help with unit testing the logic, could have a method on class Rect or something 
        // to do a generic "constrain this rect within a larger rect" logic for any panning/zoom/resize
        // changes to make sure the viewport doesn't stray too far off the map edge.
        this.updateTilePlane(null, false);
        this.kvo.zoomLevel.notifyChanged();
    }

    updateTilePlane(newCenterTile, animated, log) {
        log = !!log;

        this.tilePlane.tileWidth = this.zoomLevel.tileWidth * this.canvasStack.pixelScale;
        this.tilePlane.viewportSize = this.canvasStack.canvasDeviceSize;
        let mapModelRect = new Rect(0, 0, this.tilePlane.size.width, this.tilePlane.size.height);
        if (newCenterTile) this._centerTile = mapModelRect.clampedPoint(newCenterTile).integral();
        // Change in mapSize can make centerTile invalid
        if (log) {
            debugLog(["newCenterTile", newCenterTile, "mapModelRect", mapModelRect, "centerCandidate", this._centerTile, "contains", mapModelRect.containsTile(this._centerTile), "tileWidth", this.tilePlane.tileWidth]);
        }
        if (!mapModelRect.containsTile(this._centerTile))
            this._centerTile = mapModelRect.center.integral();

        // Try to preserve _centerTile
        let viewportScreenBounds = this.tilePlane.viewportScreenBounds;
        let currentCenterPoint = this.tilePlane.screenRectForModelTile(this._centerTile).center;
        let targetCenterPoint = viewportScreenBounds.center;
        let newOffset = this.tilePlane.offset.adding(targetCenterPoint.x - currentCenterPoint.x, targetCenterPoint.y - currentCenterPoint.y);
        if (log) {
            debugLog(["newOffset", newOffset, "viewportScreenBounds", viewportScreenBounds, "currentCenterPoint", currentCenterPoint, "targetCenterPoint", targetCenterPoint]);
        }

        this.updateOffset(newOffset, animated, log);
    }

    updateOffset(newOffset, animated, log) {
        log = !!log;
        let viewportScreenBounds = this.tilePlane.viewportScreenBounds;
        let mapModelRect = new Rect(0, 0, this.tilePlane.size.width, this.tilePlane.size.height);

        // Force center horizontally/vertically if map is smaller than viewport
        let checkMargins = { width: true, height: true };
        let mapScreenSize = this.tilePlane.screenRectForModelRect(mapModelRect).size;
        if (mapScreenSize.width < viewportScreenBounds.width) {
            newOffset.x = 0.5 * (viewportScreenBounds.width - mapScreenSize.width);
            checkMargins.width = false;
            if (log) debugLog("Map smaller than viewport horizontally.");
        }
        if (mapScreenSize.height < viewportScreenBounds.height) {
            newOffset.y = 0.5 * (viewportScreenBounds.height - mapScreenSize.height);
            checkMargins.height = false;
            if (log) debugLog("Map smaller than viewport vertically.");
        }
        if (log) debugLog(`updateOffset(${newOffset.debugDescription}): offset ${this.tilePlane.offset.debugDescription} => ${newOffset.debugDescription}`);
        let startOffset = this.tilePlane.offset;
        this.tilePlane.offset = newOffset;

        // Don't stray horizontally/vertically beyond margins
        if (checkMargins.width || checkMargins.height) {
            newOffset = this.tilePlane.offset;
            let viewportExtremes = viewportScreenBounds.extremes;
            let marginExtremes = this.tilePlane.screenRectForModelRect(mapModelRect.inset(-1 * this.marginSize.width, -1 * this.marginSize.height)).extremes;
            if (checkMargins.width) {
                // Since we don't check a given direction if the map was smaller than the screen,
                // we know we would only need to adjust left or right but not both ways.
                if (marginExtremes.min.x > viewportExtremes.min.x) {
                    newOffset.x -= (marginExtremes.min.x - viewportExtremes.min.x);
                    if (log) debugLog("Fix left margin");
                } else if (marginExtremes.max.x < viewportExtremes.max.x) {
                    newOffset.x += (viewportExtremes.max.x - marginExtremes.max.x);
                    if (log) debugLog("Fix right margin");
                }
            }
            if (checkMargins.height) {
                if (marginExtremes.min.y > viewportExtremes.min.y) {
                    newOffset.y -= (marginExtremes.min.y - viewportExtremes.min.y);
                    if (log) debugLog("Fix top margin");
                } else if (marginExtremes.max.x < viewportExtremes.max.x) {
                    newOffset.y += (viewportExtremes.max.y - marginExtremes.max.y);
                    if (log) debugLog("Fix bottom margin");
                }
            }
            if (!newOffset.isEqual(this.tilePlane.offset))
                this.tilePlane.offset = newOffset;
        }

        if (animated && !this.tilePlane.offset.isEqual(startOffset)) {
            let targetOffset = this.tilePlane.offset;
            this.tilePlane.offset = startOffset;
            this._offsetEasing = {
                x: new Easing(0.2, { min: startOffset.x, max: targetOffset.x }, Easing.smoothCurve).start(),
                y: new Easing(0.2, { min: startOffset.y, max: targetOffset.y }, Easing.smoothCurve).start()
            };
        }

        this._centerTile = this.tilePlane.visibleModelRect.center.integral();
        this.kvo.visibleModelRect.notifyChanged();
    }
}

class CanvasInputController {
    constructor(config) {
        this.viewport = config.viewport;
        this.domEvents = new Set();
        this.selectListeners = [];
        this.movementListeners = [];
        this.lastEvent = null;
    }

    // options:
    // repetitions: <Int>, required number of clicks/touches. 1 for single, 2 for double, etc. If specified, ignores all other events
    addSelectionListener(options, callback) {
        let canvas = this.shouldAddDomEvent("click");
        if (canvas) canvas.addEventListener("click", evt => this.handleSelect(evt));
        this.selectListeners.push({ options: options, callback: callback });
    }

    addMovementListener(options, callback) {
        let canvas = this.shouldAddDomEvent("mousemove");
        if (canvas) canvas.addEventListener("mousemove", evt => this.handleMovement(evt));
        this.movementListeners.push({ options: options, callback: callback });
    }

    shouldAddDomEvent(type) {
        if (this.domEvents.has(type)) return null;
        let canvas = this.viewport.canvasStack.topCanvas;
        if (!canvas) {
            debugWarn("CanvasInputController: no canvas available.");
            return null;
        }
        this.domEvents.add(type);
        return canvas;
    }

    handleSelect(evt) {
        let info = this.viewport.infoForCanvasEvent(evt);
        this.lastEvent = info;
        this.selectListeners.forEach(item => {
            if ((typeof(item.options.repetitions) != 'undefined') && (item.options.repetitions != evt.detail))
                return;
            item.callback(info);
        });
    }

    handleMovement(evt) {
        let info = this.viewport.infoForCanvasEvent(evt);
        this.lastEvent = info;
        for (let i = 0; i < this.movementListeners.length; i += 1) {
            // TODO check options
            this.movementListeners[i].callback(info);
        }
    }
}
// eg addSelectListener({ shiftKey: CanvasInputOption.required }, info => doStuff(info)) to listen specifically to shift-click
// eg addMoveListener({ button1: CanvasInputOption.required }, info => doStuff()) for drag events
let CanvasInputOption = {
    optional: 0,
    required: 1,
    prohibited: 2
};

class SpriteTileModel extends MapTile {
    constructor(point, layer) {
        super(point, layer);
        this._sprite = null;
    }

    get sprite() { return this._sprite; }
    set sprite(value) {
        if (this._sprite == value) { return; }
        this._sprite = value;
        this.layerModel.didSetSprite(this, value);
    }

    get spriteRect() {
        if (!this._sprite) { return null; }
        return new Rect(this.point, this._sprite.tileSize);
    }
}

class SpriteMapView {
    constructor(config) {
        this.model = config.model; // MapViewModel
        this.elem = config.elem;
        this.layerViews = [];

        this.rebuildLayers();
        this.model.kvo.layers.addObserver(this, () => this.rebuildLayers());
        config.runLoop.addDelegate(this);
    }

    rebuildLayers() {
        this.layerViews.forEach(view => view.remove());
        this.layerViews = this.model.layers.map(layer => new SpriteMapLayerView({
            containerElem: this.elem,
            layer: layer,
            wrap: false
        }));
    }

    processFrame(rl) {
        this.layerViews.forEach(view => view.render());
    }
}

class MapLayerViewModel {
    static Kvo() { return { "layer": "layer" }; }

    constructor(config) {
        this.index = config.index;
        this.model = config.model; // MapViewModel
        this.isOpaque = config.isOpaque;
        this.showGrid = config.showGrid;
        this.showBorder = config.showBorder;
        this.spriteSource = config.spriteSource;
        this.kvo = new Kvo(this);

        this.layer = new MapLayer({
            id: `viewlayer-${this.index}`,
            map: this.model.map,
            tileClass: SpriteTileModel
        });
        this.layer.visitTiles(null, tile => {
            tile.layerModel = this;
        });
        this.rebuildSprites();

        if (!!config.binding) {
            config.binding.addObserver(this, () => this.rebuildSprites());
        }
    }

    rebuildSprites() {
        this.layer.visitTiles(null, tile => {
            tile._sprite = this.spriteSource.getSprite(tile.point);
        });
        this.kvo.layer.notifyChanged();
    }

    didSetSprite(tile, sprite) {
        this.kvo.layer.notifyChanged();
    }

    drawingOrderSortedTiles(rect, tilePlane) {
        let tiles = this.layer.filterTiles(rect, tile => !!tile.sprite);
        return tiles.sort((a, b) => tilePlane.drawingOrderIndexForModelRect(a.spriteRect) - tilePlane.drawingOrderIndexForModelRect(b.spriteRect));
    }

    get isBottomLayer() { return this.index == 0; }
}

class SpriteMapLayerView {
    constructor(config) {
        this.viewport = config.viewport;
        this.layerModel = config.layerModel; // rely on the setter to initialize other stuff
    }

    get viewModel() { return this.layerModel.model; }
    get layerModel() { return this._layerModel; }
    set layerModel(value) {
        this._layerModel = value;
        this.borderPainter = !!this._layerModel.showBorder ? new BorderPainter(this.viewModel) : null;
        this.gridPainter = !!this._layerModel.showGrid ? new GridPainter(GameContent.shared.mainMapView) : null;
        this.bindings = [
            new ChangeTokenBinding(this.viewport.animation.kvo.frameCounter, true),
            new ChangeTokenBinding(this.viewport.kvo, true),
            new ChangeTokenBinding(this.layerModel.kvo.layer, true)
        ];
    }

    render() {
        if (!ChangeTokenBinding.consumeAll(this.bindings)) return;
        let context = this.viewport.getContext(this.layerModel.index, this.layerModel.isOpaque);
        this.clear(context);

        if (this.borderPainter) this.borderPainter.render(context);
        
        let tiles = this.layerModel.drawingOrderSortedTiles(context.visibleModelRect, context.tilePlane);
        // debugLog(tiles);
        tiles.forEach(tile => {
            let sheet = this.viewModel.spriteStore.getSpritesheet(tile.sprite.sheetID, context.tilePlane.tileWidth);
            if (!sheet) return;
            sheet.renderSprite(context.ctx, context.tilePlane.screenRectForModelRect(tile.spriteRect), tile.sprite, context.frameCounter);
        });

        if (this.gridPainter) {
            this.gridPainter.render(context, context.tilePlane.visibleModelRect.intersection(this.viewModel.map.bounds));
        }
    }

    clear(context) {
        if (context.isOpaque) {
            context.ctx.fillStyle = GameContent.shared.mainMapView.outOfBoundsFillStyle;
            context.ctx.rectFill(context.tilePlane.viewportScreenBounds);
        } else {
            context.ctx.rectClear(context.tilePlane.viewportScreenBounds);
        }
    }
}

class GridPainter {
    constructor(config) {
        this.gridColor = config.gridColor;
    }

    render(context, rect) {
        rect = (rect ? rect : context.visibleModelRect).inset(0, -1);
        if (!context.viewport.zoomLevel.allowGrid || rect.width < 1 || rect.height < 1) return;
        let ext = rect.extremes;
        for (let y = ext.min.y; y <= ext.max.y; y += 1) {
            this._renderGridLine(context, new Point(ext.min.x, y), new Point(ext.max.x, y));
        }
        for (let x = ext.min.x; x <= ext.max.x; x += 1) {
            this._renderGridLine(context, new Point(x, ext.min.y), new Point(x, ext.max.y));
        }
    }

    _renderGridLine(context, start, end) {
        start = context.tilePlane.screenOriginForModelTile(start);
        end = context.tilePlane.screenOriginForModelTile(end);
        let ctx = context.ctx;
        ctx.strokeStyle = this.gridColor;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    }
}

class BorderPainter {
    constructor(model) {
        this.model = model; // MapViewModel
    }

    //  3|  
    //  2|  ###1
    //  1|  ###2
    //  0|  ###2
    // -1|  5443
    // -2|
    //  y -------
    //   x2101234
    // #: map area (3x3)
    // 1: NE corner  (width, height - 1)
    // 2: E edge:    (width, 0...height - 2)
    // 3: SE corner: (width, -1)
    // 4: S edge     (1...width - 1, -1)
    // 5: SW corner  (0, -1)
    // Parameter view: should have getters: map, canvasGrid, and tilePlane
    // Render order here is backward: depicting a plane perpendicular to the rest of the map
    render(context) {
        if (!context.viewport.zoomLevel.allowBorder) return;
        let map = this.model.map;
        if (map.size.width < 1 || map.size.height < 1) { return; }

        // SE corner
        this.renderTile(context, "corner", 1, new Point(map.size.width, -1), directions.NW);
        // S edge
        for (let x = map.size.width - 1; x > 0; x -= 1) {
            this.renderTile(context, "edge", 1, new Point(x, -1), directions.N);
        }
        // SW corner
        this.renderTile(context, "corner", 2, new Point(0, -1), directions.N);
        // E edge
        for (let y = 0; y < map.size.height - 1; y += 1) {
            this.renderTile(context, "edge", 0, new Point(map.size.width, y), directions.W);
        }
        // NE corner
        this.renderTile(context, "corner", 0, new Point(map.size.width, map.size.height - 1), directions.W);
    }

    renderTile(context, borderType, variantKey, point, neighborDirection) {
        let terrainLayer = this.model.map.terrainLayer;
        let neighbor = terrainLayer.getTileAtPoint(Vector.manhattanUnits[neighborDirection].offsettingPosition(point));
        if (!neighbor) {
            once("no neighbor", () => debugWarn(["no neighbor found", point.debugDescription, neighborDirection, Vector.unitsByDirection[neighborDirection].offsettingPosition(point).debugDescription])); return;
        }

        let terrainType = neighbor.type.isWater ? "water" : "dirt";
        if (neighborDirection == directions.N && borderType == "edge" && neighbor.type.isWater) {
            neighbor = terrainLayer.getTileAtPoint(Vector.manhattanUnits[directions.NE].offsettingPosition(point));
            if (!!neighbor && neighbor.type.isLand) {
                terrainType = "beach";
                variantKey = 1;
            }
            neighbor = terrainLayer.getTileAtPoint(Vector.manhattanUnits[directions.NW].offsettingPosition(point));
            if (!!neighbor && neighbor.type.isLand) {
                terrainType = "beach";
                variantKey = 0;
            }
        }

        let sprite = this.model.spriteStore.getSprite(`terrain-border-${terrainType}-${borderType}`, variantKey);
        let sheet = sprite ? this.model.spriteStore.getSpritesheet(sprite.sheetID, context.tilePlane.tileWidth) : null;
        if (!sheet) return;
        let rect = context.tilePlane.screenRectForModelTile(point);
        sheet.renderSprite(context.ctx, rect, sprite, context.frameCounter);
    }
}

class MapToolSessionRenderer {
    constructor(config) {
        this.game = config.viewModel.game;
        this.canvasGrid = config.canvasGrid;
        this._feedbackSettings = Object.assign({}, MapToolController.settings().feedback);
        this._style = MapToolController.settings().mapOverlayStyle;
        this._frameCounter = 0;
        this.focusRectPainter = ScriptPainterStore.shared.getPainterSession(this._style.focusRectPainter);
        Object.getOwnPropertyNames(this._feedbackSettings).forEach((key) => {
            this._feedbackSettings[key].painter = ScriptPainterStore.shared.getPainterSession(this._feedbackSettings[key].painter);
        });
    }

    get tilePlane() { return this.game.city.map.tilePlane; }

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
        let rect = this.canvasGrid.rectForTileRect(this.tilePlane.screenRectForModel(item.focusTileRect));
        // debugLog([item.focusTileRect, rect]);
        feedback.painter.render(ctx, rect, this.canvasGrid, item);
        ctx.restore();
    }
}

class SpritesheetStore {
    // completion(SpritesheetStore?, Error?)
    // Begin process by passing no argument for "state"
    static load(theme, completion, state) {
        if (!state) {
            let remaining = Array.from(theme.sheetConfigs);
            SpritesheetStore.load(theme, completion, {remaining: remaining, completed: []});
            return;
        }
        if (state.remaining.length == 0) {
            debugLog(`Finished preloading ${state.completed.length} Spritesheet images`);
            completion(new SpritesheetStore(theme, state.completed), null);
            return;
        }
        let config = state.remaining.shift();
        // debugLog(`Loading Spritesheet image ${config.path}...`);
        config.image = new Image();
        config.image.src = `${config.path}?bustCache=${Date.now()}`;
        config.image.decode()
            .then(() => {
                state.completed.push(new Spritesheet(config));
                SpritesheetStore.load(theme, completion, state);
            })
            .catch(error => {
                debugWarn(`Failed to preload Spritesheet image ${config.path}: ${error.message}`);
                debugLog(error);
                completion(null, error);
            });
    }

    constructor(theme, sheets) {
        this.theme = theme;
        this.sheetTable = {};
        sheets.forEach(sheet => {
            if (!this.sheetTable[sheet.id]) this.sheetTable[sheet.id] = {};
            this.sheetTable[sheet.id][sheet.tileWidth] = sheet;
        });
        // to unload, call .close() for each Image object.
    }

    get allSprites() { return this.theme.sprites; }

    spriteWithUniqueID(uniqueID) {
        return this.theme.spriteTable[uniqueID];
    }

    getSprite(id, variantKey) {
        let sprite = this.theme.getSprite(id, variantKey);
        if (!sprite) { once("no sprite " + id, () => debugWarn(`getSprite("${id}", ${variantKey}): no sprite found`)); }
        return sprite;
    }

    getSpritesheet(sheetID, tileWidth) {
        let item = this.sheetTable[sheetID];
        let sheet = item ? item[tileWidth] : null;
        if (!sheet) { once("no sheet " + sheetID + tileWidth, () => debugWarn(`getSpritesheet("${sheetID}", ${tileWidth}): no sheet found`)); }
        return sheet;
    }

    defaultTileVariantKey(tile) {
        return hashArrayOfInts([tile.point.x, tile.point.y]);
    }
}

class SpritesheetTheme {
    static defaultTheme() {
        if (!SpritesheetTheme._default) {
            SpritesheetTheme._default = new SpritesheetTheme(GameContent.shared.themes[0]);
        }
        return SpritesheetTheme._default;
    }

    constructor(config) {
        this.id = config.id;
        this.isDefault = config.isDefault;
        this.sheetConfigs = config.sheets;
        this.sprites = [];
        this.spriteCounts = {};
        this.spriteTable = {};
        config.sprites.forEach(item => {
            item.variants.forEach((variant, index) => {
                let sprite = new Sprite(Object.assign({}, item, variant, {"variantKey": index}));
                this.spriteTable[sprite.uniqueID] = sprite;
                this.sprites.push(sprite);
                this.spriteCounts[sprite.id] = index + 1;
            });
        });
    }

    getSprite(id, variantKey) {
        let count = this.spriteCounts[id];
        if (typeof(count) === 'undefined') return null;
        return this.spriteTable[Sprite.makeUniqueID(id, variantKey % count)];
    }
}

class Spritesheet {
    constructor(config) {
        this.id = config.id;
        this.image = config.image;
        this.tileWidth = config.tileWidth; // in device pixels
        this.imageBounds = new Rect(new Point(0, 0), config.imageSize) // in device pixels
    }

    renderSprite(ctx, rect, sprite, frameCounter) {
        let src = this.sourceRect(sprite, frameCounter);
        if (!this.imageBounds.contains(src)) {
            once("oob" + sprite.uniqueID, () => debugWarn(`Sprite ${sprite.uniqueID} f${frameCounter} out of bounds in ${this.debugDescription}: ${src.debugDescription}`));
            return;
        }
        // debugLog(`draw ${sprite.uniqueID} src ${src.debugDescription} -> dest ${rect.debugDescription}`);
        ctx.drawImage(this.image, src.x, src.y, src.width, src.height, rect.x, rect.y, src.width, src.height);
    }

    sourceRect(sprite, frameCounter) {
        let width = sprite.tileSize.width * this.tileWidth;
        let height = sprite.tileSize.height * this.tileWidth;
        let col = sprite.isAnimated ? (frameCounter % sprite.frames) : sprite.column;
        return new Rect(col * width, sprite.row * height, width, height);
    }

    get debugDescription() {
        return `<Spritesheet #${this.id} w${this.tileWidth}>`;
    }
}

class Sprite {
    static edgeVariantKey(edgeScore) {
        if (edgeScore < 0 || edgeScore >= GameContent.shared.sprites.edgeVariants.length)
            return 0;
        return GameContent.shared.sprites.edgeVariants[edgeScore % GameContent.shared.sprites.edgeVariants.length];
    }

    static makeUniqueID(id, variantKey) {
        return `${id}|${variantKey}`;
    }

    constructor(config) {
        this.id = config.id;
        this.sheetID = config.sheetID;
        this.variantKey = config.variantKey;
        this.uniqueID = Sprite.makeUniqueID(this.id, this.variantKey);
        this.row = config.row;
        this.column = config.column;
        this.frames = config.frames;
        this.tileSize = config.tileSize;
    }
    get isAnimated() { return this.frames > 1; }
    get debugDescription() {
        let animation = this.isAnimated ? `fc=${this.frames}` : "!a";
        return `<Sprite #${this.id}/${this.variantKey} ${animation}>`;
    }

    isEqual(other) {
        return other && other.uniqueID == this.uniqueID;
    }
}

class TerrainSpriteSource {
    constructor(config) {
        this.sourceLayer = config.sourceLayer;
        this.store = config.spriteStore;
    }
    getSprite(point) {
        let tile = this.sourceLayer.getTileAtPoint(point);
        let type = tile.type;
        if (type.isSaltwater) {
            return this.edgeSprite("terrain-ocean", tile, n => n.type.isLand);
        } else if (type.isFreshwater) {
            return this.edgeSprite("terrain-freshwater", tile, n => n.type.isLand);
        } else if (type.has(TerrainType.flags.trees)) {
            return this.edgeSprite("terrain-forest", tile, n => !n.type.has(TerrainType.flags.trees));
        } else {
            return this.store.getSprite("terrain-dirt", this.store.defaultTileVariantKey(tile));
        }
    }

    edgeSprite(id, tile, neighborFilter) {
        let score = 0;
        score += this.score(tile, directions.NW, neighborFilter) ? (0x1 << 0) : 0;
        score += this.score(tile, directions.N,  neighborFilter) ? (0x1 << 1) : 0;
        score += this.score(tile, directions.NE, neighborFilter) ? (0x1 << 2) : 0;
        score += this.score(tile, directions.W,  neighborFilter) ? (0x1 << 3) : 0;
        score += this.score(tile, directions.E,  neighborFilter) ? (0x1 << 4) : 0;
        score += this.score(tile, directions.SW, neighborFilter) ? (0x1 << 5) : 0;
        score += this.score(tile, directions.S,  neighborFilter) ? (0x1 << 6) : 0;
        score += this.score(tile, directions.SE, neighborFilter) ? (0x1 << 7) : 0;
        return this.store.spriteWithUniqueID(Sprite.makeUniqueID(id, Sprite.edgeVariantKey(score)));
    }

    score(tile, direction, filter) {
        let v = Vector.manhattanUnits[direction];
        let neighbor = this.sourceLayer.getTileAtPoint(v.offsettingPosition(tile.point));
        if (!neighbor) return 0;
        return filter(neighbor) ? 1 : 0;
    }
}

class PlotSpriteSource {
    constructor(config) {
        this.sourceLayer = config.sourceLayer;
        this.store = config.spriteStore;
    }

    getSprite(point) {
        let tile = this.sourceLayer.getTileAtPoint(point);
        if (!tile || !tile.plot || !tile.isPaintOrigin) { return null; }
        let plot = tile.plot;
        if (plot.item instanceof Zone) {
            return this.store.getSprite(`zone-empty-${plot.item.type.toLowerCase()}`, this.store.defaultTileVariantKey(tile));
        } else if (plot.item instanceof TerrainProp) {
            return this.store.getSprite(`prop-${plot.item.type}`, this.store.defaultTileVariantKey(tile));
        }
        return null;
    }
}

class ScriptPainterCollection {
    static defaultExpectedSize() {
        return _1x1;
    }

    static getVariantCount(config) {
        if (config instanceof Array) { return 1; }
        return Array.isArray(config.variants) ? config.variants.length : 0;
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

class PainterInfoList {
    constructor(items, size) {
        this.items = items;
        if (items.length == 0) {
            this.uniqueID = "(empty)";
        } else {
            this.uniqueID = `${items.map(item => item.uniqueID).join("|")}|${size.width}|${size.height}`;
        }
    }
    isEqual(other) {
        return other && this.uniqueID == other.uniqueID;
    }
}

class PainterInfo {
    static pseudoRandomVariantKey(painterID, point) {
        let count = ScriptPainterStore.shared.getVariantCount(painterID);
        return hashArrayOfInts([point.x, point.y]) % count;
    }

    static safeVariantKey(painterID, value) {
        return value % ScriptPainterStore.shared.getVariantCount(painterID);
    }

    constructor(painterID, variantKey) {
        this.painterID = painterID;
        this.variantKey = variantKey;
        this.uniqueID = `${painterID}.${variantKey}`;
    }
    isEqual(other) {
        return other && this.uniqueID == other.uniqueID;
    }
    getPainterSession(store) {
        return store.getPainterSession(this.painterID, this.variantKey);
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

    // [text,red,0.25,r,left,top,0.5,0.5,r,R,white,0.2]
    //  0    1   2    3 4    5   6   7   8 9 10    11
    _text(line, ctx, info) {
        var sz = this._toPx(line[2], line[3], info.yRange, info.twRange);
        ctx.textAlign = line[4];
        ctx.textBaseline = line[5];
        var x = this._toPx(line[6], line[8], info.xDomain, info.twRange);
        var y = this._toPx(line[7], line[8], info.yDomain, info.twRange);
        ctx.font = `${sz}px sans-serif`;
        var text = String.fromTemplate(line[9], info.modelMetadata);
        if (line.length > 10) {
            // make a bubble
            ctx.fillStyle = line[10];
            let metrics = ctx.measureText(text);
            let padding = (line.length > 11 ? line[11] : 0.15) * sz;
            let rect = new Rect(x - padding, y - padding - 0.5 * sz, metrics.width + 2 * padding, sz + 2 * padding);
            ctx.roundRect(rect, padding, padding, true, false);
        }
        ctx.fillStyle = line[1];
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

    getVariantCount(id) {
        let found = this.collectionCache[id];
        if (found) { return found.variants.length; }
        let data = GameContent.shared.painters[id];
        return ScriptPainterCollection.getVariantCount(data);
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
        var expectedSize = data.expectedSize ? data.expectedSize : _1x1;
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

// ########################### INIT #######################

let citySimInitOptions = window.citySimInitOptions ? window.citySimInitOptions : { initGame: true };
if (citySimInitOptions.initGame) {
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
    let settings = citySimInitOptions;
    let content = await GameContent.loadYamlFromLocalFile("city-content.yaml", GameContent.cachePolicies.forceOnFirstLoad);
    gameContentIsReady(content, settings);
};

function gameContentIsReady(content, settings) {
    if (!content) {
        if (!settings.initGame) { return; }
        rootView.failedToLoadGameMessage(Strings.str("failedToLoadGameMessage"));
        return;
    }
    GameContent.shared = GameContent.prepare(content);
    ScriptPainterStore.shared = new ScriptPainterStore();
    SpritesheetStore.load(SpritesheetTheme.defaultTheme(), (store, error) => {
        if (error) {
            alert("Failed to load sprites: " + error.message);
            return;
        }
        spritesheetsAreReady(store, settings);
    });
}

function spritesheetsAreReady(store, settings) {
    SpritesheetStore.mainMapStore = store;
    if (settings.initGame) {
        GameScriptEngine.shared = new GameScriptEngine();
        KeyInputController.shared = new KeyInputController();
        MapToolController.shared = new MapToolController();
        rootView.setUp();
    }
    if (settings.onReady) {
        settings.onReady();
    }
};

return {
    engineRunLoop: engineRunLoop,
    game: null,
    initialize: initialize,
    citySimInitOptions: citySimInitOptions,
    rootView: rootView,
    uiRunLoop: uiRunLoop,
    AnimationState: AnimationState,
    BorderPainter: BorderPainter,
    Budget: Budget,
    CanvasInputController: CanvasInputController,
    CanvasTileViewport: CanvasTileViewport,
    City: City,
    CityMap: CityMap,
    Game: Game,
    GameDialog: GameDialog,
    GameStorage: GameStorage,
    GridPainter: GridPainter,
    InputView: InputView,
    KeyInputController: KeyInputController,
    MapLayer: MapLayer,
    MapLayerViewModel: MapLayerViewModel,
    MapTile: MapTile,
    Plot: Plot,
    RCIValue: RCIValue,
    ScriptPainter: ScriptPainter,
    ScriptPainterCollection: ScriptPainterCollection,
    ScriptPainterSession: ScriptPainterSession,
    ScriptPainterStore: ScriptPainterStore,
    SimDate: SimDate,
    Simoleon: Simoleon,
    SingleChoiceInputCollection: SingleChoiceInputCollection,
    Sprite: Sprite,
    SpriteMapLayerView: SpriteMapLayerView,
    SpriteMapView: SpriteMapView,
    Spritesheet: Spritesheet,
    SpritesheetStore: SpritesheetStore,
    SpritesheetTheme: SpritesheetTheme,
    Strings: Strings,
    Terrain: Terrain,
    TerrainSpriteSource: TerrainSpriteSource,
    TerrainTile: TerrainTile,
    TerrainType: TerrainType,
    TileRenderContext: TileRenderContext,
    TextInputView: TextInputView,
    TextLineView: TextLineView,
    ToolButton: ToolButton,
    Z: Z,
    Zone: Zone,
    ZoomSelector: ZoomSelector
};

})(); // end CitySim namespace

CitySim.initialize();
