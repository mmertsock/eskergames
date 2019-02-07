"use-strict";

/*
TODOs
- Smoothing property for RandomLineGenerator: number of previous generations to average
- Smoother riverbanks. Play with different random-walk algorithms. Get diagonal rivers working better.
  Calculate the river banks in an ideal full-rational-number coordinate space, then iterate 
  over the tile plane and set any tile to water if its coord is between the two banks in the ideal space.
  - Could do a similar thing with random blob generator: generate one large ellipse for the overall blob shape,
    then a collection of smaller random ellpises with centers along the perimeter of the main ellipse.

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

window.CitySimTerrain = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;

const Binding = Gaming.Binding;
const BoolArray = Gaming.BoolArray;
const Kvo = Gaming.Kvo;
const PerfTimer = Gaming.PerfTimer;
const Point = Gaming.Point;
const RandomLineGenerator = Gaming.RandomLineGenerator;
const Rect = Gaming.Rect;
const Rng = Gaming.Rng;
const SaveStateCollection = Gaming.SaveStateCollection;
const SaveStateItem = Gaming.SaveStateItem;
const SelectableList = Gaming.SelectableList;
const UndoStack = Gaming.UndoStack;
const Vector = Gaming.Vector;

const AnimationState = CitySim.AnimationState;
const CanvasInputController = CitySim.CanvasInputController;
const CanvasTileViewport = CitySim.CanvasTileViewport;
const CityMap = CitySim.CityMap;
const GameContent = CitySimContent.GameContent;
const GameDialog = CitySim.GameDialog;
const GameScriptEngine = CitySimContent.GameScriptEngine;
const GameStorage = CitySim.GameStorage;
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
    var zeroToOne = { min: 0, max: 1 };
    var v = Vector.betweenPoints(start, end);
    if (Math.abs(v.y) > Math.abs(v.x)) { // scan vertically, slices are horizontal
        var sliceDirection = new Vector(1, 0);
        var range = { min: start.x, max: end.x };
        var length = Math.abs(end.y - start.y);
        var incr = v.y > 0 ? 1 : -1;
        var y = start.y;
        for (var i = 0; i <= length; i += 1) {
            var fraction = i / length;
            var x = Math.round(Math.scaleValueLinear(fraction, zeroToOne, range));
            block(new Point(x, y), fraction, sliceDirection);
            y += incr;
        }
    } else { // sacn horizontally, slices are vertical
        var sliceDirection = new Vector(0, 1);
        var range = { min: start.y, max: end.y };
        var length = Math.abs(end.x - start.x) + 1;
        var incr = v.x > 0 ? 1 : -1;
        var x = start.x;
        for (var i = 0; i <= length; i += 1) {
            var fraction = i / length;
            var y = Math.round(Math.scaleValueLinear(fraction, zeroToOne, range));
            block(new Point(x, y), fraction, sliceDirection);
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

class RandomBlobGenerator {
    constructor(config) {
        this.size = config.size;
        this.edgeVariance = config.edgeVariance;
        this.radiusVariance = config.radiusVariance; // % of diameter
    }
    nextBlob() {
        var values = [];
        // make a solid block of True, then && a random column and && a random row
        for (var y = 0; y < this.size.height; y += 1) {
            values.push(new BoolArray(this.size.width).fill(true));
        }
        var generators = [
            new RandomLineGenerator({ min: 0, max: this.radiusVariance * this.size.width, variance: this.edgeVariance }),
            new RandomLineGenerator({ min: (1 - this.radiusVariance) * this.size.width, max: this.size.width, variance: this.edgeVariance })
        ];
        for (var y = 0; y < this.size.height; y += 1) {
            var min = Math.round(generators[0].nextValue());
            var max = Math.round(generators[1].nextValue());
            for (var x = 0; x < this.size.width; x += 1) {
                var keep = x >= min && x <= max;
                values[y].setValue(x, keep && values[y].getValue(x));
            }
        }
        var generators = [
            new RandomLineGenerator({ min: 0, max: this.radiusVariance * this.size.height, variance: this.edgeVariance }),
            new RandomLineGenerator({ min: (1 - this.radiusVariance) * this.size.height, max: this.size.height, variance: this.edgeVariance })
        ];
        for (var x = 0; x < this.size.width; x += 1) {
            var min = Math.round(generators[0].nextValue());
            var max = Math.round(generators[1].nextValue());
            for (var y = 0; y < this.size.height; y += 1) {
                var keep = y >= min && y <= max;
                values[y].setValue(x, keep && values[y].getValue(x));
            }
        }
        return values;
    }
}

class TileGenerator {
    generateInto(tiles, generator) { }
    get debugDescription() { return `<${this.constructor.name}>`; }

    fill(tiles, value, locations, generator) {
        locations.forEach(tile => {
            if (generator.bounds.containsTile(tile)) {
                tiles[tile.y][tile.x].type = value;
            }
        });
    }
}

class OceanTileGenerator extends TileGenerator {

    static defaultForEdge(edge, size) {
        var settings = Terrain.settings().oceanGenerator;
        if (edge.edge == directions.N || edge.edge == directions.S) {
            var shoreDistance = size.height * settings.shoreDistanceFraction[size.index];
        } else {
            var shoreDistance = size.width * settings.shoreDistanceFraction[size.index];
        }
        var shoreDistanceVariance = settings.shoreDistanceVariance[size.index];
        var edgeVariance = settings.edgeVariance[size.index];
        return new OceanTileGenerator({
            edge: edge,
            averageShoreDistanceFromEdge: shoreDistance,
            shoreDistanceVariance: shoreDistance * shoreDistanceVariance,
            edgeVariance: edgeVariance
        });
    }

    constructor(config) {
        super();
        this.edge = config.edge; // MapEdge
        // number of tiles from the configured edge to the shore. Can be non-integer
        this.averageShoreDistanceFromEdge = config.averageShoreDistanceFromEdge;
        this.lineGenerator = new RandomLineGenerator({
            min: this.averageShoreDistanceFromEdge - config.shoreDistanceVariance,
            max: this.averageShoreDistanceFromEdge + config.shoreDistanceVariance,
            variance: config.edgeVariance
        });
    }

    get debugDescription() {
        return `<${this.constructor.name} ${this.edge.edge}->${this.averageShoreDistanceFromEdge}>`;
    }

    generateInto(tiles, generator) {
        if (this.averageShoreDistanceFromEdge < 1) {
            debugWarn(`Invalid config, skipping ${this.debugDescription}`);
            return;
        }
        debugLog(`Generate into with ${this.debugDescription}`);
        var edgeTiles = this.edge.edgeTiles(generator.bounds);
        edgeTiles.forEach(edgeTile => {
            var shoreDistance = this.lineGenerator.nextValue();
            var line = this.edge.lineOfTiles(edgeTile, shoreDistance);
            this.fill(tiles, TerrainType.ocean, line, generator);
        });
    }
}

class RiverTileGenerator extends TileGenerator {
    static defaultForCrossMap(start, end, size) {
        var settings = Terrain.settings().riverGenerator;
        return new RiverTileGenerator({
            snakiness: settings.snakiness,
            start: { center: start, width: settings.mouthWidth[size.index], bendSize: settings.largeBendSize },
            end:   { center: end,   width: settings.mouthWidth[size.index], bendSize: settings.largeBendSize }
        });
    }

    static defaultStream(source, mouth, size) {
        var settings = Terrain.settings().riverGenerator;
        return new RiverTileGenerator({
            snakiness: settings.snakiness,
            start: { center: source, width: 0, bendSize: 0 },
            end:   { center: mouth,  width: settings.mouthWidth[size.index] * 0.5, bendSize: settings.largeBendSize }
        });
    }

    constructor(config) {
        super();
        this.sourceTile = config.sourceTile;
        // zero width start for a stream sourced mid-map. otherwise, assumed a full river crossing the map
        // snakiness = RandomLineGenerator variance for how quickly to curve
        // bendSize = decimal multiple of width; can be greater than 1
        this.snakiness = config.snakiness;
        this.start = { center: config.start.center, width: config.start.width, bendSize: config.start.bendSize };
        this.end = { center: config.end.center, width: config.end.width, bendSize: config.end.bendSize };
    }

    get debugDescription() {
        return `<${this.constructor.name} ${this.sourceTile.debugDescription}->${this.mouthCenterTile.debugDescription}>`;
    }

    generateInto(tiles, generator) {
        var water = [];
        var zeroToOne = { min: 0, max: 1 };
        var widthRange = { min: this.start.width, max: this.end.width };
        var bendRange = { min: this.start.bendSize, max: this.end.bendSize };
        var offsetGenerator = new RandomLineGenerator({ min: -1, max: 1, variance: this.snakiness });

        scanTiles(this.start.center, this.end.center, (origin, fraction, axis) => {
            var sliceWidth = Math.scaleValueLinear(fraction, zeroToOne, widthRange);
            var s = Math.scaleValueLinear(fraction, zeroToOne, bendRange);
            var bendSize = sliceWidth * s * s;
            var offset = (bendSize * offsetGenerator.nextValue()) - (0.5 * sliceWidth);
            var point = origin.adding(axis.scaled(offset)).integral();
            sliceWidth = Math.round(sliceWidth);
            for (var i = 0; i < sliceWidth; i += 1) {
                if (generator.bounds.containsTile(point)
                    && tiles[point.y][point.x].type.isLand) {
                    water.push(point);
                }
                point = point.adding(axis);
            }
        });
        this.fill(tiles, TerrainType.water, water, generator);
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

    generateInto(tiles, generator) {
        var generations = 0;
        while (this.currentCoverageRatio(tiles) < this.coverageRatio && generations < this.maxCount) {
            var config = {
                size: {
                    width: Rng.shared.nextIntOpenRange(this.minDiameter, this.maxDiameter),
                    height: Rng.shared.nextIntOpenRange(this.minDiameter, this.maxDiameter)
                },
                edgeVariance: Rng.shared.nextFloatOpenRange(this.edgeVariance.min, this.edgeVariance.max),
                radiusVariance: this.radiusVariance, //Rng.shared.nextFloatOpenRange(this.variance.min, this.variance.max)
            };
            this.makeBlobGenerator(config).generateInto(tiles, generator);
            generations += 1;
        }
        debugLog(`${this.constructor.name}: produced ${generations} generations filling ${(this.currentCoverageRatio(tiles) * 100).toFixed(2)}%.`);
    }

    // subclass must implment
    currentCoverageRatio(tiles) { return 1; }

    // subclass must implement
    makeBlobGenerator(config) { return undefined; }
}

class ForestTileGenerator extends BlobFillTileGenerator {
    static defaultGenerator(size) {
        return new ForestTileGenerator(BlobFillTileGenerator.defaultConfig(Terrain.settings().forestFiller, size));
    }

    currentCoverageRatio(tiles) {
        var treeCount = 0, landCount = 0;
        tiles.forEach(row => {
            row.forEach(tile => {
                if (tile.type.has(TerrainType.flags.trees)) { treeCount += 1; }
                if (tile.type.isLand) { landCount += 1; }
            });
        });
        return (landCount > 0) ? (treeCount / landCount) : 1;
    }

    makeBlobGenerator(config) { return new WoodsTileGenerator(config); }
}

class FreshWaterTileGenerator extends BlobFillTileGenerator {
    static defaultGenerator(size) {
        return new FreshWaterTileGenerator(BlobFillTileGenerator.defaultConfig(Terrain.settings().freshWaterFiller, size));
    }

    currentCoverageRatio(tiles) {
        var freshCount = 0, landCount = 0;
        tiles.forEach(row => {
            row.forEach(tile => {
                if (tile.type.isFreshwater) { freshCount += 1; }
                if (tile.type.isLand) { landCount += 1; }
            });
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
        this.edgeVariance = config.edgeVariance;
        this.radiusVariance = config.radiusVariance;
    }

    get debugDescription() {
        return `<${this.constructor.name} ${this.size.width}x${this.size.height} =${this.value}>`;
    }

    shouldFill(point, tiles, generator) {
        return true;
    }

    generateInto(tiles, generator) {
        var center = new Point(Rng.shared.nextIntOpenRange(0, generator.bounds.width), Rng.shared.nextIntOpenRange(0, generator.bounds.height));
        var origin = center.adding(this.size.width * 0.5, this.size.height * 0.5).integral();
        var blob = new RandomBlobGenerator({ size: this.size, edgeVariance: this.edgeVariance, radiusVariance: this.radiusVariance }).nextBlob();
        var values = [];
        // debugLog(blob.map(item => item.debugDescription).join("\n"));
        for (var y = 0; y < blob.length; y += 1) {
            var row = blob[y];
            for (var x = 0; x < row.length; x += 1) {
                var point = origin.adding(x, y);
                if (generator.bounds.containsTile(point)
                    && row.getValue(x)
                    && this.shouldFill(point, tiles, generator)) {
                    values.push(point);
                }
            }
        }
        this.fill(tiles, this.value, values, generator);
    }
}

class LakeTileGenerator extends BlobTileGenerator {
    constructor(config) {
        super(Object.assign({value: TerrainType.water}, config));
    }

    shouldFill(point, tiles, generator) {
        return tiles[point.y][point.x].type.isLand;
    }
}

class WoodsTileGenerator extends BlobTileGenerator {
    constructor(config) {
        super(Object.assign({value: TerrainType.forest}, config));
    }

    shouldFill(point, tiles, generator) {
        return tiles[point.y][point.x].type.isLand;
    }
}

class TerrainGenerator {
    constructor(config) {
        this.map = new CityMap({
            size: config.size
        });

        this.builders = [];
        if (config.template == "island") {
            this.builders.push(OceanTileGenerator.defaultForEdge(MapEdge.N, config.size));
            this.builders.push(OceanTileGenerator.defaultForEdge(MapEdge.E, config.size));
            this.builders.push(OceanTileGenerator.defaultForEdge(MapEdge.S, config.size));
            this.builders.push(OceanTileGenerator.defaultForEdge(MapEdge.W, config.size));
            // this.builders.push(RiverTileGenerator.defaultStream(
            //     new Point(this.size.width * 0.5, this.size.height * 0.5),
            //     new Point(this.size.width * Rng.shared.nextFloatOpenRange(0.3, 0.7), 0),
            //     config.size));
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
        let tiles = [];
        for (let rowIndex = 0; rowIndex < this.size.height; rowIndex += 1) {
            let row = [];
            for (let colIndex = 0; colIndex < this.size.width; colIndex += 1) {
                row.push(new TerrainTile(new Point(colIndex, rowIndex), this.map.terrainLayer));
            }
            tiles.push(row);
        }

        this.builders.forEach(builder => builder.generateInto(tiles, this));
        debugLog(timer.end().summary);
        timer = new PerfTimer("TerrainGenerator.modifyTerrain").start();
        this.map.modifyTerrain(tiles);
        debugLog(timer.end().summary);

        return this.map;
    }

    ascii(tiles) {
        return tiles.map(row => "|" + row.join("") + "|").join("\n");
    }
}

class EditTilesAction {
    constructor(config) {
        this.title = config.title;
        this.session = config.session;
        this.oldLayer = new MapLayer({ map: config.session.map, id: "EditTilesAction-Old", tileClass: TerrainTile });
        this.newLayer = new MapLayer({ map: config.session.map, id: "EditTilesAction-New", tileClass: TerrainTile });
        this.oldLayer.visitTiles(null, tile => tile.type = null);
        this.newLayer.visitTiles(null, tile => tile.type = null);
    }
    addTiles(tiles) {
        tiles.forEach(tile => {
            let oldTile = this.oldLayer.getTileAtPoint(tile.point);
            if (oldTile.type == null) oldTile.type = this.session.map.terrainLayer.getTileAtPoint(tile.point).type;
            let newTile = this.newLayer.getTileAtPoint(tile.point);
            newTile.type = tile.type;
        });
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
        if (!prompt || confirm(Strings.str("quitGameConfirmPrompt"))) {
            window.location = "index.html";
        }
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
        if (!tile) return false;
        return true;
    }

    addPaintToChangeset(tile, tool) {
        let tiles = tool.brush.tilesCenteredAt(tile, this.session.map.terrainLayer)
            .filter(item => this.canPaint(item, tool))
            .map(item => { return {point: item.point, type: tool.flag}; });
        this._addTilesToChangeset(tiles);
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

class RootView {
    constructor() {
        this.session = null;
        this.views = [new TerrainView(), new ControlsView()];
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

    saveCurrentTerrain() {
        if (!this.session) { return; }
        debugLog("TODO save stuff");
    }

    undo() {
        if (!this.session) { return; }
        this.session.undoStack.undo();
    }

    redo() {
        if (!this.session) { return; }
        this.session.undoStack.redo();
    }

    showGameHelp() {

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
        GameScriptEngine.shared.registerCommand("saveCurrentTerrain", () => this.saveCurrentTerrain());
        GameScriptEngine.shared.registerCommand("terrainUndo", () => this.undo());
        GameScriptEngine.shared.registerCommand("terrainRedo", () => this.redo());
        GameScriptEngine.shared.registerCommand("showGameHelp", () => this.showGameHelp());
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
    constructor() {
        this.runLoop = CitySimTerrain.uiRunLoop;
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
    static Kvo() { return { "fpsInfo": "fpsInfo", "tileInfoText": "tileInfoText" }; }

    constructor() {
        this.session = null;
        this.fpsInfo = { timestamp: 0, value: null, load: null };
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
                source: this.kvo.fpsInfo,
                sourceFormatter: info => info.value ? Strings.template("uiFpsLabel", info) : null
            }
        }).configure(view => view.elem.addRemClass("minor", true));;

        this._configureCommmands();
        CitySimTerrain.uiRunLoop.addDelegate(this);
    }

    setUp(session) {
        this.session = session;
        this.session.kvo.changeToken.addObserver(this, () => this._dirty = true);
        this.session.kvo.tileInspectionTarget.addObserver(this, () => this.updateTileInspection());
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

    processFrame(rl) {
        if (rl.latestFrameStartTimestamp() - this.fpsInfo.timestamp >= 2000) {
            let value = rl.getRecentFramesPerSecond(), load = rl.getProcessingLoad();
            let isValid = !isNaN(value) && !isNaN(load);
            this.kvo.fpsInfo.setValue({ 
                timestamp: rl.latestFrameStartTimestamp(),
                value: isValid ? Number.uiInteger(Math.round(value)) : null,
                load: isValid ? Number.uiPercent(load) : null
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
            } else if (tile.type.has(TerrainType.flags.trees)) {
                typeAnnotation = " (forest)"
            }
            this.kvo.tileInfoText.setValue(`${tile.point.x}, ${tile.point.y}${typeAnnotation}`);
        }
    }

    _configureCommmands() {
        const gse = GameScriptEngine.shared;
        gse.registerCommand("showFileMenu", () => this.showFileMenu());
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
            item.isSelected = (item.id == toolController.brush.index);
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

    didMove(info) {
        this.model.session.tileInspectionTarget = this.model.terrainTileFromInput(info);
    }

    render(context, rl) { } // noop
}

class TerrainToolController {
    static Kvo() { return {"tool": "tool", "brush": "brush"}; }

    constructor(config) {
        this.factory = config.factory;
        this.model = config.model; // TerrainMapViewModel
        this.interactionView = config.interactionView;
        this.interactionView.inputController.addSelectionListener({ repetitions: 1 }, info => this.didSelectTile(info));
        this.interactionView.inputController.addMovementListener({ repetitions: 0 }, info => this.didMove(info));
        this.interactionView.inputController.addMovementListener({ buttons: 1 }, info => this.didDrag(info));
        this.interactionView.inputController.addMovementEndListener({ }, info => this.didCompleteDrag(info));
        this._configureCommmands();
        this.kvo = new Kvo(this);
        this.selectToolWithID(this.factory.defaultToolID);
        this.isDragging = false;
        this.lastDrag = null;
    }

    get renderOrder() { return 0; }
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
        this.handleInputResult(this.tool.didSelectTile(info));
    }

    didMove(info) {
        if (this.isDragging) return;
        this.handleInputResult(this.tool.didMove(info));
    }

    didDrag(info) {
        let isStart = !this.isDragging;
        this.isDragging = true;
        this.lastDrag = info;
        // if (isStart) debugLog(`${info.timestamp} didDrag isStart: ${info.point.debugDescription}`);
        this.handleInputResult(this.tool.didDrag(info, isStart));
    }

    didCompleteDrag(info) {
        if (!this.isDragging) return;
        this.lastDrag = info;
        // debugLog(`${info.timestamp} didCompleteDrag: ${info.point.debugDescription}`);
        this.handleInputResult(this.tool.didCompleteDrag(info));
        this.isDragging = false;
    }

    handleInputResult(newTool) {
        this.selectTool(newTool);
    }

    selectTool(tool) {
        if (tool != null && tool != this.tool) {
            this.kvo.tool.setValue(tool);
        }
    }

    render(context, rl) {
        this.tool.render(context);
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
        return new ToolBrush(GameContent.itemOrDefaultFromArray(this.settings.brushes, index));
    }
}

class ToolBrush {
    constructor(config) {
        this.index = config.index;
        this.radius = config.radius;
        let offset = -1 * Math.floor(this.radius), size = Math.ceil(2 * this.radius);
        this.searchRectOriginOffset = new Vector(offset, offset);
        this.searchRectSize = { width: size, height: size };
    }

    tilesCenteredAt(tile, layer) {
        let rect = new Rect(this.searchRectOriginOffset.offsettingPosition(tile.point), this.searchRectSize);
        let tiles = layer.filterTiles(rect, item => {
            return Vector.betweenPoints(tile.point, item.point).magnitude < this.radius;
        });
        return tiles;
    }
}

class NavigateMapTool {
    constructor(toolController, config, brush) {
        this.id = config.id;
        this.brush = brush;
        this.model = new InteractionModel({ viewModel: toolController.model });
    }

    didSelectTile(info) {
        if (info.tile) info.viewport.centerTile = info.tile;
        return null;
    }

    // noops
    didMove() { return null; }
    didDrag() { return null; }
    didCompleteDrag() { return null; }
    render(context) { }
}

class PaintTerrainTypeTool {
    constructor(toolController, config, brush) {
        this.id = config.id;
        this.brush = brush;
        this.model = new InteractionModel({ viewModel: toolController.model });
        this.flag = TerrainType[config.key];
    }

    didSelectTile(info) {
        if (this.tryPaint(info)) {
            this.model.editor.commitChangeset();
        }
        return null;
    }

    didMove(info) {
        // store cursor location for rendering selection reticle
        return null;
    }

    didDrag(info, isStart) {
        if (isStart) this.model.editor.commitChangeset();
        this.tryPaint(info);
        return null;
    }

    didCompleteDrag(info) {
        this.model.editor.commitChangeset();
        return null;
    }

    render(context) {
        // render selection stuff
    }

    tryPaint(info) {
        let tile = this.model.terrainTileFromInput(info);
        if (!tile) return false;
        if (!this.model.editor.canPaint(tile, this)) return false;
        this.model.editor.addPaintToChangeset(tile, this);
        return true;
    }
}

let initialize = function() {
    CitySimTerrain.uiRunLoop = new Gaming.RunLoop({ targetFrameRate: 60, id: "uiRunLoop" });
    GameScriptEngine.shared = new GameScriptEngine();
    KeyInputController.shared = new KeyInputController();
    ToolFactory.shared = new ToolFactory(GameContent.shared.terrainEditorTools, {
        NavigateMapTool: NavigateMapTool,
        PaintTerrainTypeTool: PaintTerrainTypeTool
    });
    CitySimTerrain.view = new RootView();
    CitySimTerrain.uiRunLoop.resume();
    debugLog("Ready.");
};

return {
    initialize: initialize
};

})(); // end namespace

cityReady("terrain.js");
