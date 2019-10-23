"use-strict";

/*

Preserving salt water after edits:
When generating an ocean we pick a
max distance from edge for the water. Save that value at the top level
in the terrain. So, four such values in each terrain that default to
zero. All tiles in those areas, including land, get a “salt” flag. So
the ocean/river generators just set tiles to water and use the
existing salt flag. Manual edits that toggle land/water preserve the
salt flag. The Terrain Options dialogue (setting name and stuff) has
four switches to toggle the salt flag for each edge (when off, could
set the depth value to negative to preserve it for future use but
indicate it’s disabled).

*/

self.CitySimTerrain = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;

const Binding = Gaming.Binding;
const BoolArray = Gaming.BoolArray;
const CircularArray = Gaming.CircularArray;
const Kvo = Gaming.Kvo;
const PerfTimer = Gaming.PerfTimer;
const PeriodicRandomComponent = Gaming.PeriodicRandomComponent;
const Point = Gaming.Point;
const RandomBlobGenerator = Gaming.RandomBlobGenerator;
const RandomComponent = Gaming.RandomComponent;
const RandomLineGenerator = Gaming.RandomLineGenerator;
const Rect = Gaming.Rect;
const Rng = Gaming.Rng;
const SaveStateCollection = Gaming.SaveStateCollection;
const SaveStateItem = Gaming.SaveStateItem;
const SelectableList = Gaming.SelectableList;
const TilePlane = Gaming.TilePlane;
const UndoStack = Gaming.UndoStack;
const Vector = Gaming.Vector;

const AnimationState = CitySim.AnimationState;
const CanvasInputController = CitySim.CanvasInputController;
const CanvasTileViewport = CitySim.CanvasTileViewport;
const CityMap = CitySim.CityMap;
const ConfirmDialog = CitySim.ConfirmDialog;
const GameContent = CitySimContent.GameContent;
const GameDialog = CitySim.GameDialog;
const GameScriptEngine = CitySimContent.GameScriptEngine;
const GameStorage = CitySim.GameStorage;
const HelpDialog = CitySim.HelpDialog;
const InputView = CitySim.InputView;
const KeyInputController = CitySim.KeyInputController;
const MapLayer = CitySim.MapLayer;
const MapLayerViewModel = CitySim.MapLayerViewModel;
const RealtimeInteractionView = CitySim.RealtimeInteractionView;
const SingleChoiceInputCollection = CitySim.SingleChoiceInputCollection;
const Sprite = CitySim.Sprite;
const SpriteMapLayerView = CitySim.SpriteMapLayerView;
const SpritesheetStore = CitySim.SpritesheetStore;
const Strings = CitySim.Strings;
const Terrain = CitySim.Terrain;
const TerrainSpriteSource = CitySim.TerrainSpriteSource;
const TerrainTile = CitySim.TerrainTile;
const TerrainType = CitySim.TerrainType;
const TextInputView = CitySim.TextInputView;
const TextLineView = CitySim.TextLineView;
const ToolButton = CitySim.ToolButton;

const _zeroToOne = { min: 0, max: 1 };

Point.tilesBetween = function(a, b, log) {
    var v = Vector.betweenPoints(a, b);
    var m = v.magnitude;
    if (m < 1) { return [a]; }
    v = v.unit();
    var tiles = [a];
    var lastTile = a;
    for (var s = 0; s < m; s += 1) {
        var p = v.offsettingPosition(a, s).integral();
        if (!lastTile || !lastTile.isEqual(p)) {
            tiles.push(p);
            lastTile = p;
        }
    }
    if (!lastTile.isEqual(b)) {
        tiles.push(b);
    }
    if (log) { debugLog(["tilesBetween", a, b, v, m, tiles.length, tiles]); }
    return tiles;
};

function scanTiles(a, b, block) {
    var start = a.integral();
    var end = b.integral();
    var v = Vector.betweenPoints(start, end);
    if (Math.abs(v.y) > Math.abs(v.x)) { // scan vertically, slices are horizontal
        var sliceDirection = new Vector(1, 0);
        var range = { min: start.x, max: end.x };
        var length = Math.abs(end.y - start.y);
        var incr = v.y > 0 ? 1 : -1;
        var y = start.y;
        for (var i = 0; i <= length; i += 1) {
            var fraction = i / length;
            var x = Math.round(Math.scaleValueLinear(fraction, _zeroToOne, range));
            block(new Point(x, y), fraction, sliceDirection, v);
            y += incr;
        }
    } else { // scan horizontally, slices are vertical
        var sliceDirection = new Vector(0, 1);
        var range = { min: start.y, max: end.y };
        var length = Math.abs(end.x - start.x) + 1;
        var incr = v.x > 0 ? 1 : -1;
        var x = start.x;
        for (var i = 0; i <= length; i += 1) {
            var fraction = i / length;
            var y = Math.round(Math.scaleValueLinear(fraction, _zeroToOne, range));
            block(new Point(x, y), fraction, sliceDirection, v);
            x += incr;
        }
    }
};

class MapEdge {
    constructor(edge) {
        this.edge = edge; // Gaming.directions value
        if (this.edge == directions.N || this.edge == directions.S) {
            this.directionToCenter = edge; // directions.opposite(edge);
        } else {
            this.directionToCenter = directions.opposite(edge);
        }
    }
    edgeTiles(bounds) {
        var extremes = bounds.extremes;
        var e = bounds.extremes;
        switch (this.edge) {
            case directions.N:
                return Point.tilesBetween(new Point(e.min.x, e.min.y), new Point(e.max.x - 1, e.min.y));
            case directions.E:
                return Point.tilesBetween(new Point(e.max.x - 1, e.min.y), new Point(e.max.x - 1, e.max.y - 1));
            case directions.S:
                return Point.tilesBetween(new Point(e.min.x, e.max.y - 1), new Point(e.max.x - 1, e.max.y - 1));
            case directions.W:
                return Point.tilesBetween(new Point(e.min.x, e.min.y), new Point(e.min.x, e.max.y - 1));
            default: return [];
        }
    }

    lineOfTiles(tile, distance) {
        var v = Vector.unitsByDirection[this.directionToCenter];
        return Point.tilesBetween(tile, v.offsettingPosition(tile, distance).integral());
    }
}
MapEdge.N = new MapEdge(directions.N);
MapEdge.E = new MapEdge(directions.E);
MapEdge.S = new MapEdge(directions.S);
MapEdge.W = new MapEdge(directions.W);

class TileGenerator {
    generateInto(targetLayer, sourceLayer) { }
    get debugDescription() { return `<${this.constructor.name}>`; }

    fill(targetLayer, value, locations) {
        locations.forEach(point => {
            let tile = targetLayer.getTileAtPoint(point);
            if (tile) tile.type = value;
        });
    }
}

class OceanTileGenerator extends TileGenerator {
    static defaultConfigForMapSize(size) {
        const settings = Terrain.settings().oceanGenerator;
        return {
            edges: directions.allCardinal,
            shoreDistanceFraction: settings.shoreDistanceFraction[size.index],
            shoreDistanceVariance: settings.shoreDistanceVariance[size.index],
            smoothing: settings.smoothing
        };
    }

    constructor(config) {
        super();
        // array of direction values
        this.edges = config.edges;
        // 0: shore next to map edge; small ocean.
        // 1: shore near map center; nearly all ocean
        this.shoreDistanceFraction = Math.clamp(config.shoreDistanceFraction, _zeroToOne);
        // Actual number of tiles. Determines depth of bends in the shoreline
        this.shoreDistanceVariance = config.shoreDistanceVariance;
        this.smoothing = config.smoothing;
    }

    get debugDescription() {
        const edgeStrings = this.edges.map(Gaming.directions.debugDescriptionOf).join(", ");
        return `<${this.constructor.name} edges=${edgeStrings} f=${this.shoreDistanceFraction} v=${this.shoreDistanceVariance}>`;
    }

    generateInto(targetLayer, sourceLayer) {
        // Set all tiles in targetLayer as ocean
        targetLayer.visitTiles(null, (tile) => {
            tile.type = TerrainType.saltwater;
        });

        // Determine the bounds of the land. Extends beyond edges of map so 
        // the blob can have flat sides as needed.
        const landRect = this.landRectForLayer(sourceLayer);

        // Make a blob describing the extent of land
        const settings = Terrain.settings().oceanGenerator;
        const minRadius = Math.min(landRect.size.width, landRect.size.height) * 0.5;
        if (minRadius < 1) return;
        const variance = this.shoreDistanceVariance / minRadius;
        const blobGenerator = new RandomBlobGenerator({
            variance: variance,
            components: RandomLineGenerator.componentsFromConfig(settings.perimeterComponents),
            smoothing: this.smoothing
        });
        const landTiles = blobGenerator.makeRandomTiles(landRect, settings.threshold);

        // Copy all non-ocean tiles *inside the blob* from sourceLayer;
        // copy ocean tiles from sourceLayer as blank land.
        landTiles.forEach(point => {
            const targetTile = targetLayer.getTileAtPoint(point);
            const sourceTile = sourceLayer.getTileAtPoint(point);
            if (!targetTile || !sourceTile) return;
            if (sourceTile.type.isSaltwater) {
                targetTile.type = TerrainType.dirt;
            } else {
                targetTile.type = sourceTile.type;
            }
        });
    }

    landRectForLayer(layer) {
        // minX based on existence of west ocean
        let extremes = { min: new Point(), max: new Point() };
        if (this.edges.contains(directions.W)) {
            extremes.min.x = Math.scaleValueLinear(this.shoreDistanceFraction, _zeroToOne, {min: 0, max: 0.5 * layer.size.width});
        } else {
            extremes.min.x = -layer.size.width;
        }
        if (this.edges.contains(directions.E)) {
            extremes.max.x = Math.scaleValueLinear(1 - this.shoreDistanceFraction, _zeroToOne, {min: 0.5 * layer.size.width, max: layer.size.width});
        } else {
            extremes.max.x = 2 * layer.size.width;
        }
        if (this.edges.contains(directions.N)) {
            extremes.min.y = Math.scaleValueLinear(this.shoreDistanceFraction, _zeroToOne, {min: 0, max: 0.5 * layer.size.height});
        } else {
            extremes.min.y = -layer.size.height;
        }
        if (this.edges.contains(directions.S)) {
            extremes.max.y = Math.scaleValueLinear(1 - this.shoreDistanceFraction, _zeroToOne, {min: 0.5 * layer.size.height, max: layer.size.height});
        } else {
            extremes.max.y = 2 * layer.size.height;
        }
        const rect = Rect.fromExtremes(extremes);
        debugLog(`${rect.debugDescription} for ${this.debugDescription}`);
        return rect;
    }
}

function test(value) {
    if (value == 0) {
        var dude = "zero";
    } else {
        var dude = "nonzero";
    }
    return "it's " + dude;
}

class RiverTileGenerator extends TileGenerator {
    static defaultConfigForCrossMap(start, end, size) {
        const settings = Terrain.settings().riverGenerator;
        return {
            bend: settings.bend,
            start: { center: start, width: settings.mouthWidth[size.index], bendSize: settings.largeBendSize[size.index] },
            end:   { center: end,   width: settings.mouthWidth[size.index], bendSize: settings.largeBendSize[size.index] }
        };
    }

    static defaultForCrossMap(start, end, size) {
        return new RiverTileGenerator(RiverTileGenerator.defaultConfigForCrossMap(start, end, size));
    }

    // static defaultConfigForStream(source, mouth, size) {
    //     var settings = Terrain.settings().riverGenerator;
    //     return {
    //         lineComponents: settings.lineComponents,
    //         smoothing: settings.smoothing,
    //         start: { center: source, width: 0, bendSize: 0 },
    //         end:   { center: mouth,  width: settings.mouthWidth[size.index] * 0.5, bendSize: settings.largeBendSize }
    //     };
    // }

    // static defaultStream(source, mouth, size) {
    //     return new RiverTileGenerator(RiverTileGenerator.defaultConfigForStream(source, mouth, size));
    // }

    constructor(config) {
        super();
        this.bendGenerator = new RandomLineGenerator({
            min: -1,
            max: 1,
            components: RandomLineGenerator.componentsFromConfig(config.bend.lineComponents),
            smoothing: config.bend.smoothing
        });
        this.bedGenerator = new RandomBlobGenerator({
            variance: 0.5, // TODO
            components: RandomLineGenerator.componentsFromConfig(config.bend.lineComponents), // TODO
            smoothing: 0.5 // TODO
        });
        this.start = { center: config.start.center, width: config.start.width, bendSize: config.start.bendSize };
        this.end = { center: config.end.center, width: config.end.width, bendSize: config.end.bendSize };
    }

    generateInto(targetLayer, sourceLayer) {
        let water = [];

        const widthRange = { min: this.start.width, max: this.end.width };
        const bendRange = { min: this.start.bendSize, max: this.end.bendSize };

        debugLog({ widthRange: widthRange, bendRange: bendRange });

        scanTiles(this.start.center, this.end.center, (origin, fraction, axis, scanVector) => {
            let width = Math.ceil(Math.scaleValueLinear(fraction, _zeroToOne, widthRange) * 0.75);
            let amplitude = Math.scaleValueLinear(fraction, _zeroToOne, bendRange);
            let offset = amplitude * this.bendGenerator.nextValue();
            // determine origin by applying offset to origin perpendicular to axis
            let v = new Vector(scanVector.y, scanVector.x).unit().scaled(offset);
            let bedOrigin = origin.adding(v);
            let rect = Rect.withCenter(bedOrigin.x, bedOrigin.y, width, width).integral();
            const threshold = 0.5; // TODO
            let bed = (width <= 3) ? this.bedGenerator.smoothEllipse(rect, 1) : this.bedGenerator.makeRandomTiles(rect, threshold);

            // debugLog({ origin: origin, bedOrigin: bedOrigin, offset: offset, fraction: fraction, sv: scanVector, v: v, width: width, amplitude: amplitude, widthRange: widthRange, bendRange: bendRange, rect: rect, bedLength: bed.length });
            // debugLog(`o=${bedOrigin.debugDescription} w=${width}`);
            // debugLog(`a=${amplitude} offset=${offset} v=${v.debugDescription} o=${origin.debugDescription} bo=${bedOrigin.debugDescription}`);
            for (let i = 0; i < bed.length; i += 1) {
                water.push(bed[i]);
            }

            // TODO
            // would be nice to delay integral()ing the points until as late as possible.
            // eg allow non-integral blob sizes for randomblobgenerator, and it looks 
            // at a non-integral origin point, and its (already) non-integral random radius
            // values, and then produces the actual integral tile coordinates. With this, 
            // should be possible to use a randomblobgenerator with zero variance to produce 
            // the extra-smooth small-radius circles that guarantee at least one filled tile.
            // and so it interpolates meaningfully for things like two-tile width, instead of 
            // just always doing a 2x2 square of tiles.
        });

        water = water.filter(point => {
            let tile = sourceLayer.getTileAtPoint(point);
            return tile ? tile.type.isLand : true;
        });

        debugLog(water);

        this.fill(targetLayer, TerrainType.freshwater, water);
    }
}

class BlobFillTileGenerator extends TileGenerator {
    static defaultConfig(settings, size) {
        return {
            coverageRatio: settings.coverageRatio[size.index],
            maxCount: settings.maxCount[size.index],
            minDiameter: settings.minDiameter[size.index],
            maxDiameter: settings.maxDiameter[size.index],
            edgeVariance: { min: settings.edgeVariance[0], max: settings.edgeVariance[1] },
            radiusVariance: settings.radiusVariance[size.index]
        };
    }

    constructor(config) {
        super();
        this.coverageRatio = config.coverageRatio;
        this.maxCount = config.maxCount;
        this.minDiameter = config.minDiameter;
        this.maxDiameter = config.maxDiameter;
        this.edgeVariance = config.edgeVariance;
        this.radiusVariance = config.radiusVariance;
    }

    get debugDescription() {
        return `<${this.constructor.name} %${this.coverageRatio}>`;
    }

    generateInto(targetLayer, sourceLayer) {
        var generations = 0;
        while (this.currentCoverageRatio(targetLayer) < this.coverageRatio && generations < this.maxCount) {
            var config = {
                size: {
                    width: Rng.shared.nextIntOpenRange(this.minDiameter, this.maxDiameter),
                    height: Rng.shared.nextIntOpenRange(this.minDiameter, this.maxDiameter)
                },
                edgeVariance: Rng.shared.nextFloatOpenRange(this.edgeVariance.min, this.edgeVariance.max),
                radiusVariance: this.radiusVariance, //Rng.shared.nextFloatOpenRange(this.variance.min, this.variance.max)
            };
            this.makeBlobGenerator(config).generateInto(targetLayer, sourceLayer);
            generations += 1;
        }
        debugLog(`${this.constructor.name}: produced ${generations} generations filling ${(this.currentCoverageRatio(targetLayer) * 100).toFixed(2)}%.`);
    }

    // subclass must implment
    currentCoverageRatio(layer) { return 1; }

    // subclass must implement
    makeBlobGenerator(config) { return undefined; }
}

class ForestTileGenerator extends BlobFillTileGenerator {
    static defaultGenerator(size) {
        return new ForestTileGenerator(BlobFillTileGenerator.defaultConfig(Terrain.settings().forestFiller, size));
    }

    currentCoverageRatio(layer) {
        var treeCount = 0, landCount = 0;
        layer.visitTiles(null, tile => {
            if (tile.type.isForest) { treeCount += 1; }
            if (tile.type.isLand) { landCount += 1; }
        });
        return (landCount > 0) ? (treeCount / landCount) : 1;
    }

    makeBlobGenerator(config) { return new WoodsTileGenerator(config); }
}

class FreshWaterTileGenerator extends BlobFillTileGenerator {
    static defaultGenerator(size) {
        return new FreshWaterTileGenerator(BlobFillTileGenerator.defaultConfig(Terrain.settings().freshWaterFiller, size));
    }

    currentCoverageRatio(layer) {
        var freshCount = 0, landCount = 0;
        layer.visitTiles(null, tile => {
            if (tile.type.isFreshwater) { freshCount += 1; }
            if (tile.type.isLand) { landCount += 1; }
        });
        return (landCount > 0) ? (freshCount / landCount) : 1;
    }

    makeBlobGenerator(config) { return new LakeTileGenerator(config); }
}

class BlobTileGenerator extends TileGenerator {
    constructor(config) {
        super();
        this.value = config.value; // tile value
        this.size = config.size; // in tiles
        this.center = config.center; // optional
        this.edgeVariance = config.edgeVariance;
        this.radiusVariance = config.radiusVariance;
    }

    get debugDescription() {
        return `<${this.constructor.name} ${this.size.width}x${this.size.height} =${this.value}>`;
    }

    shouldFill(tile) {
        return true;
    }

    generateInto(targetLayer, sourceLayer) {
        var center = this.center ? this.center : new Point(Rng.shared.nextIntOpenRange(0, targetLayer.size.width), Rng.shared.nextIntOpenRange(0, targetLayer.size.height));
        var origin = center.adding(this.size.width * 0.5, this.size.height * 0.5).integral();

        let settings = Terrain.settings().blobGenerator;
        let blob = new RandomBlobGenerator({
            variance: this.radiusVariance,
            components: RandomLineGenerator.componentsFromConfig(settings.perimeterComponents),
            smoothing: settings.smoothing,
            filter: (point) => {
                let tile = sourceLayer.getTileAtPoint(point);
                return tile ? this.shouldFill(tile) : true;
            }
        });
        let rect = Rect.withCenter(center, this.size);
        let tiles = blob.makeRandomTiles(rect, settings.threshold);
        // debugLog([tiles, rect, blob, settings]);
        this.fill(targetLayer, this.value, tiles);
    }
}

class LakeTileGenerator extends BlobTileGenerator {
    constructor(config) {
        super(Object.assign({value: TerrainType.freshwater}, config));
    }

    shouldFill(tile) {
        return tile.type.isLand;
    }
}

class WoodsTileGenerator extends BlobTileGenerator {
    constructor(config) {
        super(Object.assign({value: TerrainType.forest}, config));
    }

    shouldFill(tile) {
        return tile.type.isLand;
    }
}

class LandTileGenerator extends BlobTileGenerator {
    constructor(config) {
        super(Object.assign({value: TerrainType.dirt}, config));
    }

    shouldFill(tile) {
        return true;
    }
}

class TerrainGenerator {
    constructor(config) {
        this.map = new CityMap({
            size: config.size
        });

        this.builders = [];
        if (config.template == "island") {
            this.builders.push(new OceanTileGenerator(OceanTileGenerator.defaultConfigForMapSize(config.size)));
        }
        if (config.template != "blank") {
            this.builders.push(ForestTileGenerator.defaultGenerator(config.size));
            this.builders.push(FreshWaterTileGenerator.defaultGenerator(config.size));
        }
        if (config.template == "river") {
            this.builders.push(RiverTileGenerator.defaultForCrossMap(
                new Point(this.size.width * Rng.shared.nextFloatOpenRange(0.25, 0.75), 0),
                new Point(this.size.width * Rng.shared.nextFloatOpenRange(0.25, 0.75), this.size.height - 1),
                config.size));
        }
    }

    get size() { return this.map.size; }
    get bounds() { return this.map.bounds; }

    generateMap() {
        let timer = new PerfTimer("TerrainGenerator.generateMap").start();
        this.builders.forEach(builder => builder.generateInto(this.map.terrainLayer, this.map.terrainLayer));
        debugLog(timer.end().summary);
        return this.map;
    }
}

class TerrainEditTile extends TerrainTile {
    constructor(point, layer) {
        super(point, layer);
        this._type = null;
    }
    get type() { return this._type; }
    set type(value) {
        let oldTile = this.layer.action.oldLayer.getTileAtPoint(this.point);
        if (oldTile.type == null) {
            oldTile.type = this.layer.action.session.map.terrainLayer.getTileAtPoint(this.point).type;
        }
        super.type = value;
    }
}

class EditTilesAction {
    constructor(config) {
        this.title = config.title;
        this.session = config.session;
        this.oldLayer = new MapLayer({ map: config.session.map, id: "EditTilesAction-Old", tileClass: TerrainTile });
        this.newLayer = new MapLayer({ map: config.session.map, id: "EditTilesAction-New", tileClass: TerrainEditTile });
        this.newLayer.action = this;
        this.oldLayer.visitTiles(null, tile => tile._type = null);
    }

    addTiles(tiles) {
        tiles.forEach(tile => {
            let newTile = this.newLayer.getTileAtPoint(tile.point);
            newTile.type = tile.type;
        });
        this.session.replaceTiles(this.newLayer, this);
    }

    applyGenerator(generator) {
        generator.generateInto(this.newLayer, this.session.map.terrainLayer);
        this.session.replaceTiles(this.newLayer, this);
    }

    undo() {
        this.session.replaceTiles(this.oldLayer, null);
    }
    redo() {
        this.session.replaceTiles(this.newLayer, null);
    }
}

class ReplaceMapAction {
    constructor(config) {
        this.session = config.session;
        this.newMap = new CityMap({ size: config.newMap.size });
        this.newMap.modifyTerrain(config.newMap.terrainLayer._tiles);
        this.oldMap = config.oldMap;
    }
    get title() { return "Reset Map"; }
    undo() { this.session.replaceMap(this.oldMap, true); }
    redo() { this.session.replaceMap(this.newMap, true); }
}

class EditSession {
    static Kvo() { return { "changeToken": "changeToken", "tileInspectionTarget": "_tileInspectionTarget" }; }

    static quit(prompt) {
        if (!prompt) {
            window.location = "index.html"; return;
        }
        new ConfirmDialog({
            title: null,
            text: Strings.str("quitGameConfirmPrompt"),
            ok: Strings.str("quitButton"),
            cancel: Strings.str("genericCancelButton"),
            completion: result => { if (result) EditSession.quit(false); }
        }).show();
    }

    constructor(config) {
        this.terrain = config.terrain;
        this.changeToken = 0;
        this._tileInspectionTarget = null;
        this.kvo = new Kvo(this);
        this.undoStack = new UndoStack();
        this.editor = new TerrainEditor(this);
    }

    get map() { return this.terrain.map; }
    get debugDescription() { return this.map.debugDescription; }

    get tileInspectionTarget() { return this._tileInspectionTarget; }
    set tileInspectionTarget(value) {
        if (value != this._tileInspectionTarget)
            this.kvo.tileInspectionTarget.setValue(value);
    }

    replaceMap(newMap, skipUndo) {
        if (!skipUndo) {
            this.undoStack.push(new ReplaceMapAction({
                session: this,
                newMap: newMap,
                oldMap: this.terrain.map
            }));
        }
        this.terrain.map = newMap;
        this.kvo.changeToken.setValue(this.changeToken + 1);
    }

    replaceTiles(newLayer, undoActionToAdd) {
        this.terrain.map.modifyTerrain(newLayer._tiles);
        this.kvo.changeToken.setValue(this.changeToken + 1);
        if (undoActionToAdd && (this.undoStack.nextUndoItem != undoActionToAdd)) {
            this.undoStack.push(undoActionToAdd);
        }
    }
}

class TerrainEditor {
    constructor(session) {
        this.session = session;
        this.changeset = null;
    }

    // More generic:
    // proposeXyzOperation(tile, arg1, arg2): return Operation object if valid, otherwise null
    // addToChangeset(operation)

    canPaint(tile, tool) {
        return tool.brush.canPaint(tile, tool.flag);
    }

    allBrushTiles(tile, tool) {
        return tool.brush.allTilesCenteredAt(tile, tool.flag, this.session.map.terrainLayer);
    }

    validPaintTiles(tile, tool) {
        return tool.brush.paintableTilesCenteredAt(tile, tool.flag, this.session.map.terrainLayer);
    }

    addPaintToChangeset(tile, tool) {
        let tiles = this.validPaintTiles(tile, tool)
            .map(item => { return {point: item.point, type: tool.flag}; });
        this._addTilesToChangeset(tiles);
    }

    applyGeneratorToChangeset(builder) {
        this._beginChangesetIfNeeded();
        this.changeset.applyGenerator(builder);
    }

    _addTilesToChangeset(tiles) {
        if (tiles.length == 0) return;
        this._beginChangesetIfNeeded();
        this.changeset.addTiles(tiles);
    }

    _beginChangesetIfNeeded() {
        if (!this.changeset) {
            this.changeset = new EditTilesAction({
                title: "Edit Map",
                session: this.session
            });
        }
    }

    commitChangeset() {
        this.changeset = null;
    }
}

class PerfMonitor {
    constructor(runLoop) {
        this.history = new CircularArray(100);
        runLoop.addDelegate(this);
    }

    get statistics() {
        if (this.history.size < 5) return null;
        let totalDispatches = [];
        this.history.forEach(item => {
            totalDispatches.push(item.totalDispatches);
        });
        totalDispatches.sort();

        let info = {
            dispatchesPerFrame: {
                max: totalDispatches.reduce((i, j) => Math.max(i, j), Number.MIN_SAFE_INTEGER),
                median: (totalDispatches.length % 2 == 0)
                    ? (0.5 * (totalDispatches[totalDispatches.length / 2] + totalDispatches[totalDispatches.length / 2 - 1]))
                    : totalDispatches[totalDispatches.length >> 1]
            }
        };

        return info;
    }

    delegateOrder(rl) { return 1000; }

    processFrame(rl) {
        let item = {
            totalDispatches: Gaming.Dispatch.shared.totalDispatches
        };
        Gaming.Dispatch.shared.totalDispatches = 0;
        this.history.push(item);
    }
}

class RootView {
    constructor(config) {
        this.session = null;
        this.views = [new TerrainView({ runLoop: config.runLoop }), new ControlsView({ runLoop: config.runLoop })];
        this._configureCommmands();
        
        let storage = GameStorage.shared;
        let url = new URL(window.location.href);
        let id = url.searchParams.get("id");
        if (id) { this.tryToLoadTerrain(id); return; }

        let createNewTerrain = !!url.searchParams.get("new");
        id = storage.latestSavedTerrainID;
        if (!createNewTerrain && !!id) { this.tryToLoadTerrain(id); return; }

        new NewTerrainDialog(null).show();
    }

    setUp(session) {
        this.session = session;
        debugLog(`Setting up session with ${this.session.debugDescription}`);
        this.views.forEach(view => view.setUp(session));
        KeyInputController.shared.addShortcutsFromSettings(GameContent.shared.keyboard.terrainEditor);
    }

    regenerate() {
        new NewTerrainDialog(this.session).show();
    }

    tryToLoadTerrain(id) {
        try {
            let terrain = Terrain.loadFromStorage(GameStorage.shared, id);
            this.setUp(new EditSession({ terrain: terrain }));
        } catch (e) {
            this.failedToLoad(e.message);
            debugLog(e);
        }
    }

    failedToLoad(message) {
        new Gaming.Prompt({
            title: Strings.str("failedToLoadTerrainTitle"),
            message: message,
            buttons: [{ label: Strings.str("quitButton"), action: () => EditSession.quit(false) }],
            requireSelection: true
        }).show();
    }

    _configureCommmands() {
        GameScriptEngine.shared.registerCommand("regenerate", () => this.regenerate());
    }
}

class NewTerrainDialog extends GameDialog {
    constructor(session) {
        super();
        this.session = session;
        var initialName = session ? session.terrain.name : Strings.randomTerrainName();

        this.createButton = new ToolButton({
            title: Strings.str("newTerrainDialogCreateButton"),
            click: () => this.validateAndCreate()
        });
        this.contentElem = GameDialog.createContentElem();
        var formElem = GameDialog.createFormElem();
        this.nameInput = new TextInputView({
            parent: formElem,
            title: Strings.str("terrainSettingsNameLabel"),
            placeholder: "",
            transform: InputView.trimTransform,
            validationRules: [InputView.notEmptyOrWhitespaceRule]
        }).configure(input => input.value = initialName);
        let defaultIndex = Terrain.indexForTerrainSize(session ? session.terrain : null);
        this.sizes = new SingleChoiceInputCollection({
            id: "size",
            parent: formElem,
            title: Strings.str("terrainSettingsSizeLabel"),
            validationRules: [SingleChoiceInputCollection.selectionRequiredRule],
            choices: Terrain.settings().sizes.map(size => { return {
                title: `${size.width} x ${size.height} tiles, ${Number.uiInteger(Terrain.kmForTileCount(size.width))} x ${Number.uiInteger(Terrain.kmForTileCount(size.height))} km`,
                value: size.index,
                selected: size.index == defaultIndex
            }; })
        });

        this.templates = new SingleChoiceInputCollection({
            id: "template",
            parent: formElem,
            title: Strings.str("terrainSettingsTemplateLabel"),
            validationRules: [SingleChoiceInputCollection.selectionRequiredRule],
            choices: [
                { title: Strings.str("terrainSettingsBlankTemplateLabel"), value: "blank", selected: false },
                { title: Strings.str("terrainSettingsLandlockedTemplateLabel"), value: "landlocked", selected: false },
                { title: Strings.str("terrainSettingsRiverTemplateLabel"), value: "river", selected: true },
                { title: Strings.str("terrainSettingsIslandTemplateLabel"), value: "island", selected: false }
            ]
        });

        this.contentElem.append(formElem);
        this.allInputs = [this.nameInput, this.sizes, this.templates];
    }

    get isModal() { return true; }
    get title() {
        return this.session ? Strings.str("replaceTerrainDialogTitle") : Strings.str("newTerrainDialogTitle");
    }
    get dialogButtons() { return [this.createButton.elem]; }

    get isValid() {
        return this.allInputs.every(input => input.isValid);
    }

    get selectedSize() { return Terrain.sizeOrDefaultForIndex(this.sizes.value); }

    validateAndCreate() {
        if (!this.isValid) { debugLog("NOT VALID"); return; }

        var generator = new TerrainGenerator({
            size: this.selectedSize,
            template: this.templates.value
        });
        var map = generator.generateMap();
        if (this.session) {
            this.session.replaceMap(map);
        } else {
            var terrain =  new Terrain({
                name: this.nameInput.value,
                map: map
            });
            CitySimTerrain.view.setUp(new EditSession({
                terrain: terrain
            }));
        }

        this.dismiss();
    }

    dismissButtonClicked() {
        if (this.session) {
            super.dismissButtonClicked();
        } else {
            EditSession.quit(false);
        }
    }
}

class TerrainMapViewModel {
    static Kvo() { return { "layers": "layers" }; }

    constructor(config) {
        this.session = config.session;
        this.layers = [];
        this.kvo = new Kvo(this);
        this.session.kvo.changeToken.addObserver(this, () => this.reset());
        this.reset();
    }

    get map() { return this.session.map; }
    get spriteStore() { return SpritesheetStore.mainMapStore; }

    reset() {
        this.layers = [];
        this.layers.push(new MapLayerViewModel({
            index: 0,
            model: this,
            isOpaque: true,
            showGrid: true,
            showBorder: true,
            spriteSource: new TerrainSpriteSource({
                sourceLayer: this.map.terrainLayer,
                spriteStore: this.spriteStore
            })
        }));
        this.kvo.layers.notifyChanged();
    }
}

class TerrainView {
    constructor(config) {
        this.runLoop = config.runLoop;
        this.elem = document.querySelector("map.mainMap");
        this.session = null;
        this.viewport = null;
        this.layerViews = [];
    }

    setUp(session) {
        this.model = new TerrainMapViewModel({ session: session });
        this.viewport = new CanvasTileViewport({
            mapSize: this.model.map.size,
            layerCount: this.model.layers.length + 1,
            initialZoomLevel: GameContent.shared.mainMapView.zoomLevels[2],
            containerElem: this.elem,
            animation: new AnimationState(this.runLoop),
            marginSize: {width: 2, height: 2} // 1 tile border + 1 tile blank space
        });

        this.resetLayers();
        this.model.kvo.layers.addObserver(this, () => this.resetLayers());

        this.interactionView = new RealtimeInteractionView({
            viewport: this.viewport,
            runLoop: this.runLoop
        });
        this.toolController = new TerrainToolController({
            factory: ToolFactory.shared,
            model: this.model,
            interactionView: this.interactionView
        });
        this.model.session.toolController = this.toolController;
        this.interactionView.addInteraction(this.toolController);
        this.interactionView.addInteraction(new HoverInfoInteraction({
            interactionView: this.interactionView,
            model: this.model
        }));

        this.runLoop.addDelegate(this);
        this._configureCommmands();
    }

    resetLayers() {
        if (this.layerViews.length == 0) {
            this.layerViews = this.model.layers.map(layer => new SpriteMapLayerView({
                viewport: this.viewport,
                layerModel: layer
            }));
        } else {
            this.model.layers.forEach((layer, index) => {
                this.layerViews[index].layerModel = layer;
            });
        }
        this.viewport.mapSize = this.model.map.size;
    }

    processFrame(rl) {
        this.layerViews.forEach(view => view.render());
    }

    centerUnderPointer() {
        if (this.viewport.inputController.lastEvent) {
            // Recalculate rather than trust the latest tileInspectionTarget 
            // because it's stale with after center commands without moving the porter.
            let tile = this.viewport.tilePlane.modelTileForScreenPoint(this.viewport.inputController.lastEvent.point);
            if (tile) this.viewport.centerTile = tile;
        }
    }

    _configureCommmands() {
        let gse = GameScriptEngine.shared;
        gse.registerCommand("zoomIn", () => this.viewport.zoomIn());
        gse.registerCommand("zoomOut", () => this.viewport.zoomOut());
        gse.registerCommand("setZoomLevel", index => this.viewport.setZoomLevelIndex(index));
        gse.registerCommand("panMap", direction => this.viewport.pan(direction, false));
        gse.registerCommand("panMapLarge", direction => this.viewport.pan(direction, true));
        gse.registerCommand("centerUnderPointer", () => this.centerUnderPointer());
    }
}

class ControlsView {
    static Kvo() { return { "perfInfo": "perfInfo", "tileInfoText": "tileInfoText" }; }

    constructor(config) {
        this.session = null;
        this.perf = new PerfMonitor(config.runLoop)
        this.perfInfo = { timestamp: 0, value: null, load: null };
        this.tileInfoText = "";
        this._dirty = true;
        this.kvo = new Kvo(this);

        this.root = document.querySelector("controls");
        this.buttons = [];

        let globalBlock = this.root.querySelector("#global-controls");
        this.buttons.push(new ToolButton({parent: globalBlock, title: Strings.str("regenTerrainButtonLabel"), clickScript: "regenerate"}));
        this.buttons.push(new ToolButton({parent: globalBlock, title: Strings.str("optionsButtonLabel"), clickScript: "showFileMenu"}));
        this.undoButton = new ToolButton({parent: globalBlock, title: Strings.str("undoButtonLabel"), clickScript: "terrainUndo"});
        this.redoButton = new ToolButton({parent: globalBlock, title: Strings.str("redoButtonLabel"), clickScript: "terrainRedo"});
        this.buttons.push(this.undoButton);
        this.buttons.push(this.redoButton);
        this.buttons.push(new ToolButton({parent: globalBlock, title: Strings.str("helpButtonLabel"), clickScript: "showGameHelp"}));

        let viewBlock = this.root.querySelector("#view");
        let zoomElem = this.root.querySelector("zoom");
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

        this.tileInfoView = new TextLineView({
            parent: viewBlock,
            binding: {
                source: this.kvo.tileInfoText
            }
        });

        this.fpsView = new TextLineView({
            parent: viewBlock,
            binding: {
                source: this.kvo.perfInfo,
                sourceFormatter: info => info.value ? Strings.template("uiFpsLabel", info) : null
            }
        }).configure(view => view.elem.addRemClass("minor", true));

        this._configureCommmands();
        config.runLoop.addDelegate(this);
    }

    setUp(session) {
        this.session = session;
        this.session.kvo.changeToken.addObserver(this, () => this._dirty = true);
        this.session.kvo.tileInspectionTarget.addObserver(this, () => this.updateTileInspection());
        this.macroPalette = new ToolPaletteView({
            toolController: this.session.toolController,
            elem: this.root.querySelector("#macro-controls"),
            palette: this.session.toolController.factory.settings.macroPalette
        });
        this.microPalette = new ToolPaletteView({
            toolController: this.session.toolController,
            elem: this.root.querySelector("#micro-controls"),
            palette: this.session.toolController.factory.settings.microPalette
        });
        this.brushes = new ToolBrushView({
            toolController: this.session.toolController,
            elem: this.root.querySelector("#brush-controls"),
            brushes: this.session.toolController.factory.settings.brushes
        });
        this._dirty = true;
    }

    showFileMenu() {
        new Gaming.Prompt({
            title: Strings.str("systemMenuTitle"),
            message: null,
            buttons: [
                { label: Strings.str("saveButton"), action: () => this.session.terrain.saveToStorage() },
                { label: Strings.str("saveAndQuitButton"), action: () => { if (this.session.terrain.saveToStorage()) { EditSession.quit(false); } } },
                { label: Strings.str("quitButton"), action: () => EditSession.quit(true), classNames: ["warning"] },
                { label: Strings.str("genericCancelButton") }
            ]
        }).show();
    }

    undo() { if (this.session) this.session.undoStack.undo(); }
    redo() { if (this.session) this.session.undoStack.redo(); }

    processFrame(rl) {
        if (rl.latestFrameStartTimestamp() - this.perfInfo.timestamp >= 2000) {
            let value = rl.getRecentFramesPerSecond(), load = rl.getProcessingLoad();
            let statistics = this.perf.statistics;
            let isValid = !isNaN(value) && !isNaN(load) && !!statistics;
            this.kvo.perfInfo.setValue({ 
                timestamp: rl.latestFrameStartTimestamp(),
                value: isValid ? Number.uiInteger(Math.round(value)) : null,
                load: isValid ? Number.uiPercent(load) : null,
                maxDispatches: isValid ? Number.uiInteger(statistics.dispatchesPerFrame.max) : null,
                medianDispatches: isValid ? Number.uiFloat(statistics.dispatchesPerFrame.median) : null
            });
        }

        if (!this._dirty) { return; }
        this._dirty = false;
        this.undoButton.isEnabled = !!this.session && this.session.undoStack.canUndo;
        this.redoButton.isEnabled = !!this.session && this.session.undoStack.canRedo;
    }

    updateTileInspection() {
        let tile = this.session.tileInspectionTarget;
        if (!tile) {
            this.kvo.tileInfoText.setValue("");
        } else {
            let typeAnnotation = "";
            if (tile.type.isFreshwater) {
                typeAnnotation = " (freshwater)" ;
            } else if (tile.type.isSaltwater) {
                typeAnnotation = " (saltwater)";
            } else if (tile.type.isForest) {
                typeAnnotation = " (forest)"
            }
            this.kvo.tileInfoText.setValue(`${tile.point.x}, ${tile.point.y}${typeAnnotation}`);
        }
    }

    _configureCommmands() {
        const gse = GameScriptEngine.shared;
        gse.registerCommand("showFileMenu", () => this.showFileMenu());
        gse.registerCommand("showGameHelp", () => new HelpDialog().show());
        gse.registerCommand("terrainUndo", () => this.undo());
        gse.registerCommand("terrainRedo", () => this.redo());
    }
}

class ToolPaletteView {
    constructor(config) {
        this.buttons = config.palette.map(id => {
            let settings = config.toolController.factory.getDefinition(id);
            return new ToolButton({
                id: id,
                parent: config.elem,
                title: settings.paletteTitle,
                clickScript: "selectTool",
                clickScriptSubject: id
            });
        });

        config.toolController.kvo.addObserver(this, toolController => this.update(toolController));
        this.update(config.toolController);
    }

    update(toolController) {
        this.buttons.forEach(item => {
            item.isSelected = (item.id == toolController.tool.id);
        });
    }
}

class ToolBrushView {
    constructor(config) {
        this.buttons = config.brushes.map(brush => {
            return new ToolButton({
                id: brush.index,
                parent: config.elem,
                title: brush.paletteTitle,
                clickScript: "setBrushSize",
                clickScriptSubject: brush.index
            });
        });

        config.toolController.kvo.addObserver(this, toolController => this.update(toolController));
        this.update(config.toolController);
    }

    update(toolController) {
        this.buttons.forEach(item => {
            item.isSelected = (toolController.tool.usesBrush && item.id == toolController.brush.index);
        });
    }
}

class InteractionModel {
    constructor(config) {
        this.viewModel = config.viewModel;
    }

    get session() { return this.viewModel.session; }
    get editor() { return this.viewModel.session.editor; }

    terrainTileFromInput(info) {
        return info.tile ? this.viewModel.map.terrainLayer.getTileAtPoint(info.tile) : null;
    }
}

class HoverInfoInteraction {
    constructor(config) {
        this.interactionView = config.interactionView;
        this.model = new InteractionModel({ viewModel: config.model });
        this.interactionView.inputController.addMovementListener({}, info => this.didMove(info));
    }

    get renderOrder() { return 0; }
    get needsRender() { return false; }

    didMove(info) {
        this.model.session.tileInspectionTarget = this.model.terrainTileFromInput(info);
    }

    render(context, rl) { }
}

class TerrainToolController {
    static Kvo() { return {"tool": "tool", "brush": "brush"}; }

    constructor(config) {
        this.factory = config.factory;
        this.model = config.model; // TerrainMapViewModel
        this.interactionView = config.interactionView;
        this.interactionView.inputController.addSelectionListener({ repetitions: 1 }, info => this.didSelectTile(info));
        this.interactionView.inputController.addMovementListener({ }, info => this.didMove(info));
        this.interactionView.inputController.addMovementListener({ buttons: 1 }, info => this.didDrag(info));
        this.interactionView.inputController.addMovementEndListener({ }, info => this.didCompleteDrag(info));
        this._configureCommmands();
        this.kvo = new Kvo(this);
        this.selectToolWithID(this.factory.defaultToolID);
        this.isDragging = false;
        this.lastDrag = null;
        this.lastHover = null;
        this._dirty = true;
    }

    get renderOrder() { return 0; }
    get needsRender() { return this._dirty || this.tool.needsRender; }
    
    get brush() { return this.tool ? this.tool.brush : this.factory.getBrush(-1); }

    setBrushSize(index) {
        if (index == this.tool.brush.index) return;
        this.tool.brush = this.factory.getBrush(index);
        this.kvo.brush.notifyChanged();
    }

    selectToolWithID(id) {
        this.selectTool(this.factory.toolWithID(id, this, this.brush));
    }

    didSelectTile(info) {
        if (this.isDragging) return;
        if (this.lastDrag && (info.timestamp - this.lastDrag.timestamp) < 10) return;
        // debugLog(`${info.timestamp} didSelectTile: ${info.point.debugDescription}. isDragging? ${this.isDragging}`);
        if (typeof(this.tool.didSelectTile) == 'function')
            this.handleInputResult(this.tool.didSelectTile(info));
    }

    didMove(info) {
        this.lastHover = info;
        if (this.isDragging) return;

        if (typeof(this.tool.didMove) == 'function')
            this.handleInputResult(this.tool.didMove(info));
    }

    didDrag(info) {
        let isStart = !this.isDragging;
        this.isDragging = true;
        this.lastDrag = info;
        // if (isStart) debugLog(`${info.timestamp} didDrag isStart: ${info.point.debugDescription}`);
        if (typeof(this.tool.didDrag) == 'function')
            this.handleInputResult(this.tool.didDrag(info, isStart));
    }

    didCompleteDrag(info) {
        if (!this.isDragging) return;
        this.lastDrag = info;
        // debugLog(`${info.timestamp} didCompleteDrag: ${info.point.debugDescription}`);
        if (typeof(this.tool.didCompleteDrag) == 'function')
            this.handleInputResult(this.tool.didCompleteDrag(info));
        this.isDragging = false;
    }

    handleInputResult(newTool) {
        this.selectTool(newTool);
    }

    selectTool(tool) {
        if (tool != null && tool != this.tool) {
            this.kvo.tool.setValue(tool);
            this._dirty = true;
        }
    }

    render(context, rl) {
        this._dirty = false;
        let lastHover = this.lastHover;
        if (lastHover && Math.abs(Date.now() - lastHover.timestamp) > 500) lastHover = null;
        if (typeof(this.tool.render) == 'function')
            this.tool.render(context, this.lastHover);
    }

    _configureCommmands() {
        let gse = GameScriptEngine.shared;
        gse.registerCommand("escapePressed", () => this.selectToolWithID(this.factory.defaultToolID));
        gse.registerCommand("selectTool", id => this.selectToolWithID(id));
        gse.registerCommand("setBrushSize", index => this.setBrushSize(index));
    }
}

class ToolFactory {
    constructor(settings, namespace) {
        this.settings = settings;
        this.namespace = namespace;
    }

    get defaultToolID() { return GameContent.defaultItemFromDictionary(this.settings.definitions).id; }

    toolWithID(id, toolController, brush) {
        let config = this.getDefinition(id);
        if (!config) {
            debugWarn(`Can't find tool config for ${id}`);
            return null;
        }
        let type = this.namespace[config.constructor];
        return new type(toolController, config, brush);
    }

    getDefinition(id) { return this.settings.definitions[id]; }

    getBrush(index) {
        let config = GameContent.itemOrDefaultFromArray(this.settings.brushes, index);
        let type = this.namespace[config.constructor];
        return new type(config);
    }
}

class CircularBrush {
    constructor(config) {
        this.index = config.index;
        this.radius = config.radius;
        let offset = -1 * Math.floor(this.radius), size = Math.ceil(2 * this.radius);
        this.searchRectOriginOffset = new Vector(offset, offset);
        this.searchRectSize = { width: size, height: size };
    }

    get allowsDragPainting() { return true; }

    canPaint(tile, type) {
        if (!tile) return false;
        if (type.isForest && !tile.type.isLand) return false;
        return true;
    }

    allTilesCenteredAt(tile, type, layer) {
        let rect = new Rect(this.searchRectOriginOffset.offsettingPosition(tile.point), this.searchRectSize);
        let tiles = layer.filterTiles(rect, item => {
            return Vector.betweenPoints(tile.point, item.point).magnitude < this.radius;
        });
        return tiles;
    }

    paintableTilesCenteredAt(tile, type, layer) {
        return this.allTilesCenteredAt(tile, type, layer)
            .filter(item => this.canPaint(item, type));  
    }
}

class FillBrush {
    constructor(config) {
        this.index = config.index;
    }

    get allowsDragPainting() { return false; }

    canPaint(tile, type) {
        if (!tile) return false;
        return tile.type.value != type.value;
    }

    allTilesCenteredAt(tile, type, layer) {
        let plane = new TilePlane(layer.size, 1);
        return plane.floodMap(tile.point, false, (neighbor) => {
            let item = layer.getTileAtPoint(neighbor);
            if (!item) return null;
            return (item.type.value == tile.type.value) ? item : null;
            // return item ? (item.type.value == tile.type.value) : false;
        });
    }

    paintableTilesCenteredAt(tile, type, layer) {
        return this.allTilesCenteredAt(tile, type, layer);
    }
}

class NavigateMapTool {
    constructor(toolController, config, brush) {
        this.id = config.id;
        this.brush = brush;
        this.model = new InteractionModel({ viewModel: toolController.model });
        this.dragStartViewportOffset = null;
        this.dragStartInfo = null;
    }

    get usesBrush() { return false; }
    get needsRender() { return false; }

    didSelectTile(info) {
        if (info.tile) info.viewport.centerTile = info.tile;
        this.dragStartInfo = null;
        this.dragStartViewportOffset = null;
        return null;
    }

    didDrag(info, isStart) {
        if (isStart) {
            this.dragStartInfo = info;
            this.dragStartViewportOffset = info.viewport.offset;
            return;
        }
        if (this.dragStartInfo) {
            let offset = Vector.betweenPoints(this.dragStartInfo.point, info.point);
            info.viewport.setOffset(offset.offsettingPosition(this.dragStartViewportOffset), false);
        }
        return null;
    }
    didCompleteDrag(info) {
        this.dragStartInfo = null;
        this.dragStartViewportOffset = null;
        return null;
    }

    didMove() { return null; }
    render(context, lastHover) { }
}

class PaintTerrainTypeTool {
    constructor(toolController, config, brush) {
        this.id = config.id;
        this.brush = brush;
        this.model = new InteractionModel({ viewModel: toolController.model });
        this.flag = TerrainType[config.key];
        this.validHoverFillStyle = toolController.factory.settings.validHoverFillStyle;
        this.notAllowedHoverFillStyle = toolController.factory.settings.notAllowedHoverFillStyle;
    }

    get usesBrush() { return true; }
    get needsRender() { return true; }

    didSelectTile(info) {
        if (this.tryPaint(info)) {
            this.model.editor.commitChangeset();
        }
        return null;
    }

    didMove(info) { return null; }

    didDrag(info, isStart) {
        if (!this.brush.allowsDragPainting) return null;
        if (isStart) this.model.editor.commitChangeset();
        this.tryPaint(info);
        return null;
    }

    didCompleteDrag(info) {
        this.model.editor.commitChangeset();
        return null;
    }

    render(context, lastHover) {
        if (!lastHover) return;
        let tile = this.model.terrainTileFromInput(lastHover);
        if (!tile) return;
        let tiles = tile ? this.model.editor.allBrushTiles(tile, this) : [];
        if (tiles.length == 0) return;
        let isValid = this.model.editor.canPaint(tile, this);
        tiles.forEach(neighbor => {
            context.ctx.fillStyle = (isValid && this.model.editor.canPaint(neighbor, this)) ? this.validHoverFillStyle : this.notAllowedHoverFillStyle;
            context.ctx.rectFill(context.tilePlane.screenRectForModelTile(neighbor.point));
        });
    }

    tryPaint(info) {
        let tile = this.model.terrainTileFromInput(info);
        if (!tile) return false;
        if (!this.model.editor.canPaint(tile, this)) return false;
        this.model.editor.addPaintToChangeset(tile, this);
        return true;
    }
}

class BuildBlobTool {
    constructor(toolController, config, brush) {
        this.id = config.id;
        this.brush = brush;
        this.model = new InteractionModel({ viewModel: toolController.model });
        this.key = config.generator;
        this.dialogTitle = config.dialogTitle;
        this.ranges = {
            size: { min: config.size.min, max: config.size.max, defaultValue: config.size.defaultValue },
            edgeVariance: { min: 0, max: 1, defaultValue: config.edgeVariance.defaultValue },
            radiusVariance: { min: 0, max: 1, defaultValue: config.radiusVariance.defaultValue }
        };
        this.generator = toolController.factory.namespace[config.generator];
    }

    get usesBrush() { return false; }
    get needsRender() { return false; }

    get lastSettings() {
        let value = BuildBlobTool.lastSettings[this.key];
        return value ? value : {
            size: { width: this.ranges.size.defaultValue, height: this.ranges.size.defaultValue },
            edgeVariance: this.ranges.edgeVariance.defaultValue,
            radiusVariance: this.ranges.radiusVariance.defaultValue
        };
    }
    set lastSettings(value) { BuildBlobTool.lastSettings[this.key] = value; }

    didSelectTile(info) {
        new BuildBlobDialog({
            tool: this,
            center: info.tile,
            title: this.dialogTitle,
            defaultValue: this.lastSettings
        }).show();
        return null;
    }

    build(config) {
        this.lastSettings = config;
        this.model.editor.applyGeneratorToChangeset(new this.generator(config));
        this.model.editor.commitChangeset();
    }
}
BuildBlobTool.lastSettings = {};

class BuildBlobDialog extends GameDialog {
    constructor(config) {
        super();
        this.tool = config.tool;
        this.center = config.center;
        this.title = config.title;

        this.createButton = new ToolButton({
            title: Strings.str("buildBlobCommitButton"),
            click: () => this.validateAndBuild()
        });

        this.contentElem = GameDialog.createContentElem();
        const formElem = GameDialog.createFormElem();

        this.widthInput = new TextInputView({
            parent: formElem,
            title: Strings.str("blobWidthLabel"),
            placeholder: Strings.template("basicTileCountRangePlaceholder", this.tool.ranges.size),
            transform: InputView.integerTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.size)]
        });
        this.heightInput = new TextInputView({
            parent: formElem,
            title: Strings.str("blobHeightLabel"),
            placeholder: Strings.template("basicTileCountRangePlaceholder", this.tool.ranges.size),
            transform: InputView.integerTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.size)]
        });
        this.edgeVarianceInput = new TextInputView({
            parent: formElem,
            title: Strings.str("blobEdgeVarianceLabel"),
            placeholder: Strings.template("basicNumericInputRangePlaceholder", this.tool.ranges.edgeVariance),
            transform: InputView.floatTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.edgeVariance)]
        });
        this.radiusVarianceInput = new TextInputView({
            parent: formElem,
            title: Strings.str("blobRadiusVarianceLabel"),
            placeholder: Strings.template("basicNumericInputRangePlaceholder", this.tool.ranges.radiusVariance),
            transform: InputView.floatTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.radiusVariance)]
        });

        this.widthInput.value = config.defaultValue.size.width;
        this.heightInput.value = config.defaultValue.size.height;
        this.edgeVarianceInput.value = Number.uiFloat(config.defaultValue.edgeVariance);
        this.radiusVarianceInput.value = Number.uiFloat(config.defaultValue.radiusVariance);

        this.contentElem.append(formElem);
        this.allInputs = [this.widthInput, this.heightInput, this.edgeVarianceInput, this.radiusVarianceInput];
    }

    get isModal() { return true; }
    get dialogButtons() { return [this.createButton.elem]; }

    get isValid() { return this.allInputs.every(input => input.isValid); }
    get selectedSize() { return { width: this.widthInput.value, height: this.heightInput.value }; }

    validateAndBuild() {
        if (!this.isValid) { debugLog("NOT VALID"); return; }
        this.tool.build({
            size: this.selectedSize,
            center: this.center,
            edgeVariance: this.edgeVarianceInput.value,
            radiusVariance: this.radiusVarianceInput.value
        });
        this.dismiss();
    }

    dismiss() {
        super.dismiss();
        this.tool = null;
    }
}

// Click one end then another.
// Shows a dialog after clicking, to adjust options
class BuildRiverTool {
    constructor(toolController, config, brush) {
        this.id = config.id;
        this.brush = brush;
        this.model = new InteractionModel({ viewModel: toolController.model });
        this.dialogTitle = config.dialogTitle;
        this.ranges = {
            smoothing: { min: 1, max: 10, defaultValue: Terrain.settings().riverGenerator.smoothing },
            lineComponents: { defaultValue: Terrain.settings().riverGenerator.lineComponents },
            source: {
                width: { min: config.source.width.min, max: config.source.width.max, defaultValue: config.source.width.defaultValue },
                bendSize: { min: config.source.bendSize.min, max: config.source.bendSize.max, defaultValue: config.source.bendSize.defaultValue }
            },
            mouth: {
                width: { min: config.mouth.width.min, max: config.mouth.width.max, defaultValue: config.mouth.width.defaultValue },
                bendSize: { min: config.mouth.bendSize.min, max: config.mouth.bendSize.max, defaultValue: config.mouth.bendSize.defaultValue }
            }
        };
        this.sourceStyle = config.sourceStyle;
        this.lineStyle = config.lineStyle;
        this.mouthStyle = config.mouthStyle;
        this.source = null;
        this.mouth = null;
    }

    get usesBrush() { return false; }
    get needsRender() { return true; }

    get lastSettings() {
        let value = BuildRiverTool.lastSettings;
        return value ? value : {
            smoothing: this.ranges.smoothing.defaultValue,
            lineComponents: this.ranges.lineComponents.defaultValue,
            start: {
                width: this.ranges.source.width.defaultValue,
                bendSize: this.ranges.source.bendSize.defaultValue
            },
            end: {
                width: this.ranges.mouth.width.defaultValue,
                bendSize: this.ranges.mouth.bendSize.defaultValue
            }
        };
    }
    set lastSettings(value) { BuildRiverTool.lastSettings = value; }

    didDrag(info, isStart) {
        if (isStart) {
            let tile = this.model.terrainTileFromInput(info);
            if (tile) {
                this.source = tile;
                this.mouth = null;
            }
            return null;
        }
        this.updateMouth(info);
        return null;
    }

    didCompleteDrag(info) {
        this.updateMouth(info);
        if (!this.source || !this.mouth) {
            this.reset();
            return null;
        }
        const size = Terrain.sizeOrDefaultForIndex(Terrain.indexForTerrainSize(this.model.session.terrain));
        new BuildRiverDialog({
            tool: this,
            title: this.dialogTitle,
            defaultValue: this.lastSettings,
            streamValue: RiverTileGenerator.defaultConfigForStream(this.source.point, this.mouth.point, size),
            largeRiverValue: RiverTileGenerator.defaultConfigForCrossMap(this.source.point, this.mouth.point, size)
        }).show();
        return null;
    }

    render(context, lastHover) {
        if (this.source && this.mouth) {
            this.fillDot(context, this.source, this.sourceStyle);
            const source = context.tilePlane.screenRectForModelTile(this.source.point).center.integral();
            const mouth = context.tilePlane.screenRectForModelTile(this.mouth.point).center.integral();
            context.ctx.save();
            context.ctx.beginPath();
            context.ctx.moveTo(source.x, source.y);
            context.ctx.lineTo(mouth.x, mouth.y);
            context.ctx.lineCap = "round";
            context.ctx.lineWidth = Math.max(2, context.tilePlane.tileWidth * 0.5);
            context.ctx.strokeStyle = this.lineStyle;
            context.ctx.stroke();
            context.ctx.restore();
            this.fillDot(context, this.mouth, this.mouthStyle);
        } else if (this.source) {
            this.fillDot(context, this.source, this.mouthStyle);
        }
    }

    fillDot(context, tile, fillStyle) {
        let rect = context.tilePlane.screenRectForModelTile(tile.point).inset(0.25 * context.tilePlane.tileWidth, 0.25 * context.tilePlane.tileWidth);
        if (rect.width < 2) rect = Rect.withCenter(rect.center, { width: 2, height: 2 });
        context.ctx.fillStyle = fillStyle;
        context.ctx.ellipseFill(rect);
    }

    updateMouth(info) {
        let tile = this.model.terrainTileFromInput(info);
        if (tile && this.source && !this.source.point.isEqual(tile.point)) {
            this.mouth = tile;
        } else {
            this.mouth = null;
        }
    }

    build(config) {
        this.lastSettings = config;
        config.start.center = this.source.point;
        config.end.center = this.mouth.point;
        this.model.editor.applyGeneratorToChangeset(new RiverTileGenerator(config));
        this.model.editor.commitChangeset();
        this.reset();
    }

    reset() {
        this.source = null;
        this.mouth = null;
    }
}
BuildRiverTool.lastSettings = null;

class BuildRiverDialog extends GameDialog {
    constructor(config) {
        super();
        this.tool = config.tool;
        this.title = config.title;
        this.defaultValue = config.defaultValue;
        this.streamValue = config.streamValue;
        this.largeRiverValue = config.largeRiverValue;

        this.createButton = new ToolButton({
            title: Strings.str("buildRiverCommitButton"),
            click: () => this.validateAndBuild()
        });

        this.contentElem = GameDialog.createContentElem();
        const formElem = GameDialog.createFormElem();

        let nav = document.createElement("nav");
        this.streamButton = new ToolButton({
            parent: nav,
            title: Strings.str("applyStreamPresetsButton"),
            click: () => this.value = this.streamValue
        });
        this.largeRiverButton = new ToolButton({
            parent: nav,
            title: Strings.str("applyLargeRiverPresetsButton"),
            click: () => this.value = this.largeRiverValue
        });
        formElem.append(nav);

        this.smoothingInput = new TextInputView({
            parent: formElem,
            title: Strings.str("riverSmoothingLabel"),
            placeholder: Strings.template("basicNumericInputRangePlaceholder", this.tool.ranges.smoothing),
            transform: InputView.floatTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.smoothing)]
        });

        let heading = document.createElement("h3");
        heading.innerText = Strings.str("riverDialogSourceHeadingLabel");
        formElem.append(heading);

        this.startWidthInput = new TextInputView({
            parent: formElem,
            title: Strings.str("riverSourceWidthLabel"),
            placeholder: Strings.template("basicTileCountRangePlaceholder", this.tool.ranges.source.width),
            transform: InputView.integerTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.source.width)]
        });
        this.startBendInput = new TextInputView({
            parent: formElem,
            title: Strings.str("riverSourceBendSizeLabel"),
            placeholder: Strings.template("basicNumericInputRangePlaceholder", this.tool.ranges.source.bendSize),
            transform: InputView.floatTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.source.bendSize)]
        });

        heading = document.createElement("h3");
        heading.innerText = Strings.str("riverDialogMouthHeadingLabel");
        formElem.append(heading);

        this.endWidthInput = new TextInputView({
            parent: formElem,
            title: Strings.str("riverMouthWidthLabel"),
            placeholder: Strings.template("basicTileCountRangePlaceholder", this.tool.ranges.mouth.width),
            transform: InputView.integerTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.mouth.width)]
        });
        this.endBendInput = new TextInputView({
            parent: formElem,
            title: Strings.str("riverMouthBendSizeLabel"),
            placeholder: Strings.template("basicNumericInputRangePlaceholder", this.tool.ranges.mouth.bendSize),
            transform: InputView.floatTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.mouth.bendSize)]
        });

        this.value = this.defaultValue;

        this.contentElem.append(formElem);
        this.allInputs = [this.smoothingInput, this.startWidthInput, this.startBendInput, this.endWidthInput, this.endBendInput];
    }

    get isModal() { return true; }
    get dialogButtons() { return [this.createButton.elem]; }
    get isValid() { return this.allInputs.every(input => input.isValid); }

    get value() {
        return {
            smoothing: this.smoothingInput.value,
            lineComponents: this.lineComponents,
            start: { width: this.startWidthInput.value, bendSize: this.startBendInput.value },
            end: { width: this.endWidthInput.value, bendSize: this.endBendInput.value }
        };
    }

    set value(config) {
        this.smoothingInput.value  = config.smoothing;
        this.startWidthInput.value = config.start.width;
        this.startBendInput.value  = config.start.bendSize;
        this.endWidthInput.value   = config.end.width;
        this.endBendInput.value    = config.end.bendSize;
        this.lineComponents        = config.lineComponents;
    }

    validateAndBuild() {
        if (!this.isValid) { debugLog("NOT VALID"); return; }
        this.dismiss();
        this.tool.build(this.value);
        this.tool = null;
    }

    dismissButtonClicked() {
        this.dismiss();
        this.tool.reset();
        this.tool = null;
    }
}

class BuildOceanTool {
    constructor(toolController, config, brush) {
        debugLog(toolController, config);
        this.id = config.id;
        this.brush = brush;
        this.model = new InteractionModel({ viewModel: toolController.model });
        this.dialogTitle = config.dialogTitle;
        const size = toolController.model.map.size;
        this.defaultSettings = OceanTileGenerator.defaultConfigForMapSize(size);
        this.ranges = {
            shoreDistanceFraction: { min: 0, max: 1, defaultValue: this.defaultSettings.shoreDistanceFraction },
            shoreDistanceVariance: { min: 0, max: 32, defaultValue: this.defaultSettings.shoreDistanceVariance },
            smoothing: { min: 1, max: 10, defaultValue: this.defaultSettings.smoothing }
        };
        this.generator = toolController.factory.namespace[config.generator];
    }

    get usesBrush() { return false; }
    get needsRender() { return false; }

    get lastSettings() {
        let value = BuildOceanTool.lastSettings;
        return value ? value : {
            edges: directions.allCardinal,
            shoreDistanceFraction: this.defaultSettings.shoreDistanceFraction,
            shoreDistanceVariance: this.defaultSettings.shoreDistanceVariance,
            smoothing: this.defaultSettings.smoothing
        };
    }
    set lastSettings(value) { BuildOceanTool.lastSettings = value; }

    didSelectTile(info) {
        new BuildOceanDialog({
            tool: this,
            title: this.dialogTitle,
            defaultValue: this.lastSettings
        }).show();
        return null;
    }

    build(value) {
        this.lastSettings = value;
        this.model.editor.applyGeneratorToChangeset(new this.generator(value));
        this.model.editor.commitChangeset();
    }
}
BuildOceanTool.lastSettings = null;

class EdgeSelectionInputView extends CitySim.FormValueView {
    static createElement(config) {
        const elem = document.createElement("div").addRemClass("edge-selector", true);
        elem.append(EdgeSelectionInputView.createRow(config, ["left", directions.N, "right"]));
        elem.append(EdgeSelectionInputView.createRow(config, [directions.W, "filler", directions.E]));
        elem.append(EdgeSelectionInputView.createRow(config, ["left", directions.S, "right"]));
        return elem;
    }

    static createRow(config, edges) {
        const row = document.createElement("row");
        edges.forEach(direction => {
            if (direction == "filler") {
                const label = document.createElement("label")
                    .addRemClass("direction-0", true)
                    .addRemClass("filler", true);
                row.append(label);
                return;
            }
            if (direction == "left") {
                row.append(document.createElement("corner").addRemClass("left", true)); return;
            }
            if (direction == "right") {
                row.append(document.createElement("corner").addRemClass("right", true)); return;
            }
            const label = document.createElement("label").addRemClass(EdgeSelectionInputView.directionClass(direction), true);
            label.id = EdgeSelectionInputView.directionID(config.id, direction, "label");
            const input = document.createElement("input").addRemClass(EdgeSelectionInputView.directionClass(direction), true);
            input.type = "checkbox";
            input.id = EdgeSelectionInputView.directionID(config.id, direction, "input");
            input.name = config.id;
            input.value = direction.toString();
            label.append(input);
            const span = document.createElement("span");
            span.innerText = directions.debugDescriptionOf(direction);
            label.append(span);
            row.append(label);
        });
        return row;
    }

    static directionClass(direction) {
        return `direction-${directions.debugDescriptionOf(direction)}`;
    }

    static directionID(id, direction, suffix) {
        return `direction-${id}-${direction}-${suffix}`;
    }

    constructor(config, elem) {
        config.id = config.id || Rng.shared.nextHexString(8);
        super(config, elem || EdgeSelectionInputView.createElement(config));
        this.id = config.id;
        this.validationRules = config.validationRules || [];
        this.elem.querySelectorAll("label").forEach(label => {
            if (label.classList.contains("filler")) { return; }
            label.addEventListener("click", evt => { evt.preventDefault(); this.clicked(label); });
        });
    }

    get value() {
        let edges = directions.allCardinal.filter(direction => {
            const input = this.elem.querySelector(`#${EdgeSelectionInputView.directionID(this.id, direction, "input")}`);
            return input.checked;
        });
        return edges;
    }

    set value(newValue) {
        directions.allCardinal.forEach(direction => {
            const selected = newValue.contains(direction);
            const input = this.elem.querySelector(`#${EdgeSelectionInputView.directionID(this.id, direction, "input")}`);
            input.checked = selected;
            const label = this.elem.querySelector(`#${EdgeSelectionInputView.directionID(this.id, direction, "label")}`);
            label.addRemClass("selected", selected);
        });
    }

    get isValid() {
        return this.validationRules.every(rule => rule(this));
    }

    // for bindings
    setValue(newValue) { this.value = newValue; }

    clicked(label) {
        directions.allCardinal.forEach(direction => {
            if (label.classList.contains(EdgeSelectionInputView.directionClass(direction))) {
                this.toggle(direction);
            }
        });
    }

    toggle(direction) {
        let newValue = this.value;
        if (newValue.contains(direction)) {
            this.value = newValue.filter(d => d != direction);
        } else {
            newValue.push(direction);
            newValue.sort();
            this.value = newValue;
        }
    }
}

class BuildOceanDialog extends GameDialog {
    constructor(config) {
        super();
        this.tool = config.tool;
        this.title = config.title;

        this.createButton = new ToolButton({
            title: Strings.str("buildBlobCommitButton"),
            click: () => this.validateAndBuild()
        });

        this.contentElem = GameDialog.createContentElem();
        const formElem = GameDialog.createFormElem();

        this.edgesInput = new EdgeSelectionInputView({
            parent: formElem
        });

        this.shoreDistanceInput = new TextInputView({
            parent: formElem,
            title: Strings.str("oceanShoreDistanceLabel"),
            placeholder: Strings.template("basicNumericInputRangePlaceholder", this.tool.ranges.shoreDistanceFraction),
            transform: InputView.floatTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.shoreDistanceFraction)]
        });

        this.shoreVarianceInput = new TextInputView({
            parent: formElem,
            title: Strings.str("oceanShoreVarianceLabel"),
            placeholder: Strings.template("basicTileCountRangePlaceholder", this.tool.ranges.shoreDistanceVariance),
            transform: InputView.integerTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.shoreDistanceVariance)]
        });

        this.smoothingInput = new TextInputView({
            parent: formElem,
            title: Strings.str("oceanSmoothingLabel"),
            placeholder: Strings.template("basicNumericInputRangePlaceholder", this.tool.ranges.smoothing),
            transform: InputView.floatTransform,
            validationRules: [InputView.makeNumericRangeRule(this.tool.ranges.smoothing)]
        });

        this.edgesInput.value = this.swapNorthSouth(config.defaultValue.edges);
        this.shoreDistanceInput.value = config.defaultValue.shoreDistanceFraction;
        this.shoreVarianceInput.value = config.defaultValue.shoreDistanceVariance;
        this.smoothingInput.value = config.defaultValue.smoothing;

        this.contentElem.append(formElem);
        this.allInputs = [this.edgesInput, this.shoreDistanceInput, this.shoreVarianceInput, this.smoothingInput];
    }

    get isModal() { return true; }
    get dialogButtons() { return [this.createButton.elem]; }

    get isValid() { return this.allInputs.every(input => input.isValid); }

    // N/S in the dialog are opposite of the map model's N/S
    swapNorthSouth(value) {
        return value.map(direction => {
            switch (direction) {
                case directions.N: return directions.S;
                case directions.S: return directions.N;
                default: return direction;
            }
        });
    }

    validateAndBuild() {
        if (!this.isValid) { debugLog("NOT VALID"); return; }
        this.tool.build({
            edges: this.swapNorthSouth(this.edgesInput.value),
            shoreDistanceFraction: this.shoreDistanceInput.value,
            shoreDistanceVariance: this.shoreVarianceInput.value,
            smoothing: this.smoothingInput.value
        });
        this.dismiss();
    }

    dismiss() {
        super.dismiss();
        this.tool = null;
    }
}

let initialize = function() {
    CitySimTerrain.uiRunLoop = new Gaming.RunLoop({ targetFrameRate: 60, id: "uiRunLoop" });
    GameScriptEngine.shared = new GameScriptEngine();
    KeyInputController.shared = new KeyInputController();
    ToolFactory.shared = new ToolFactory(GameContent.shared.terrainEditorTools, {
        NavigateMapTool: NavigateMapTool,
        PaintTerrainTypeTool: PaintTerrainTypeTool,
        BuildBlobTool: BuildBlobTool,
        BuildRiverTool: BuildRiverTool,
        BuildOceanTool: BuildOceanTool,
        CircularBrush: CircularBrush,
        FillBrush: FillBrush,
        LakeTileGenerator: LakeTileGenerator,
        WoodsTileGenerator: WoodsTileGenerator,
        LandTileGenerator: LandTileGenerator,
        OceanTileGenerator: OceanTileGenerator
    });
    CitySimTerrain.view = new RootView({ runLoop: CitySimTerrain.uiRunLoop });
    CitySimTerrain.uiRunLoop.resume();
    debugLog("Ready.");
};

return {
    initialize: initialize
};

})(); // end namespace CitySimTerrain

cityReady("terrain.js");
