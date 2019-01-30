"use-strict";

/*
TODOs
- Smoothing property for RandomLineGenerator: number of previous generations to average
- Smoother riverbanks
- Whenever regenerating, encode the raw parameters + RNG seed into a hex value, store that 
  with the terrain, so you can use that key to recreate the random map.
    https://github.com/davidbau/seedrandom#saving-and-restoring-prng-state


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
const FlexCanvasGrid = Gaming.FlexCanvasGrid;
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

const CityMap = CitySim.CityMap;
const MapLayer = CitySim.MapLayer;
const GameContent = CitySimContent.GameContent;
const GameDialog = CitySim.GameDialog;
const GameScriptEngine = CitySimContent.GameScriptEngine;
const GameStorage = CitySim.GameStorage;
const GridPainter = CitySim.GridPainter;
const InputView = CitySim.InputView;
const MapRenderer = CitySim.MapRenderer;
const MapTile = CitySim.MapTile;
const ScriptPainterStore = CitySim.ScriptPainterStore;
const SingleChoiceInputCollection = CitySim.SingleChoiceInputCollection;
const Sprite = CitySim.Sprite;
const SpriteRenderModel = CitySim.SpriteRenderModel;
const Spritesheet = CitySim.Spritesheet;
const SpritesheetStore = CitySim.SpritesheetStore;
const SpritesheetTheme = CitySim.SpritesheetTheme;
const Strings = CitySim.Strings;
const Terrain = CitySim.Terrain;
const TerrainSpriteSource = CitySim.TerrainSpriteSource;
const TerrainTile = CitySim.TerrainTile;
const TerrainType = CitySim.TerrainType;
const TextInputView = CitySim.TextInputView;
const TextLineView = CitySim.TextLineView;
const ToolButton = CitySim.ToolButton;
const ZoomSelector = CitySim.ZoomSelector;

Point.tilesBetween = function(a, b, log) {
    var v = Vector.betweenPoints(a, b);
    var m = v.magnitude();
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
    // 2d arrays. any tiles untouched should have value undefined
    constructor(config) {
        this.title = config.title;
        this.session = config.session;
        this.tiles = config.tiles;
        this.oldTiles = config.oldTiles;
    }
    undo() {
        this.session.replaceTiles(this.oldTiles, false);
    }
    redo() {
        this.session.replaceTiles(this.tiles, false);
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
    static Kvo() { return { "changeToken": "changeToken" }; }

    static quit(prompt) {
        if (!prompt || confirm(Strings.str("quitGameConfirmPrompt"))) {
            window.location = "index.html";
        }
    }

    constructor(config) {
        this.terrain = config.terrain;
        this.changeToken = 0;
        this.kvo = new Kvo(this);
        this.undoStack = new UndoStack();
    }

    get map() { return this.terrain.map; }
    get debugDescription() { return this.map.debugDescription; }

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

    // 2d array. Only performs changes for non-undefined tiles
    replaceTiles(tiles, addToUndoStack) {
        // TODO
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

class TerrainView {
    constructor() {
        this.session = null;
        this.elem = document.querySelector("map.mainMap");
        this._mapView = null;

        let zoomers = this.settings.zoomLevels.map((z) => new ZoomSelector(z, this));
        this.zoomSelection = new SelectableList(zoomers);
        this.zoomSelection.setSelectedIndex(2);

        this._configureCommmands();
    }

    setUp(session) {
        this.session = session;
        this._mapView = new SpriteMapView({
            model: new MapViewModel({ session: this.session }),
            elem: this.elem,
            zoomLevel: this.zoomLevel,
            runLoop: CitySimTerrain.uiRunLoop
        });
    }

    get settings() { return GameContent.shared.mainMapView; }
    get zoomLevel() { return this.zoomSelection.selectedItem.value; }

    zoomLevelActivated(value) {
        if (this._mapView) this._mapView.zoomLevel = value;
    }

    _configureCommmands() {
        let gse = GameScriptEngine.shared;
        gse.registerCommand("zoomIn", () => this.zoomSelection.selectNext());
        gse.registerCommand("zoomOut", () => this.zoomSelection.selectPrevious());
    }
}

class ControlsView {
    static Kvo() { return { "fpsInfo": "fpsInfo" }; }

    constructor() {
        this.session = null;
        this.fpsInfo = { timestamp: 0, value: null, load: null };
        this._dirty = true;
        this.kvo = new Kvo(this);

        this.root = document.querySelector("controls");
        this.buttons = [];

        let globalBlock = this.root.querySelector("#global-controls");
        let viewBlock = this.root.querySelector("#view");

        this.buttons.push(new ToolButton({parent: globalBlock, title: Strings.str("regenTerrainButtonLabel"), clickScript: "regenerate"}));
        this.buttons.push(new ToolButton({parent: globalBlock, title: Strings.str("optionsButtonLabel"), clickScript: "showFileMenu"}));
        this.undoButton = new ToolButton({parent: globalBlock, title: Strings.str("undoButtonLabel"), clickScript: "terrainUndo"});
        this.redoButton = new ToolButton({parent: globalBlock, title: Strings.str("redoButtonLabel"), clickScript: "terrainRedo"});
        this.buttons.push(this.undoButton);
        this.buttons.push(this.redoButton);
        this.buttons.push(new ToolButton({parent: globalBlock, title: Strings.str("helpButtonLabel"), clickScript: "showGameHelp"}));

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
        this.session.kvo.changeToken.addObserver(this, () => { this._dirty = true; });
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
                value: isValid ? Number.uiInteger(value) : null,
                load: isValid ? Number.uiPercent(load) : null
            });
        }

        if (!this._dirty) { return; }
        this._dirty = false;
        this.undoButton.isEnabled = !!this.session && this.session.undoStack.canUndo;
        this.redoButton.isEnabled = !!this.session && this.session.undoStack.canRedo;
    }

    _configureCommmands() {
        GameScriptEngine.shared.registerCommand("showFileMenu", () => this.showFileMenu());
    }
}



class MapViewModel {
    static Kvo() { return { "layers": "layers" }; }

    constructor(config) {
        this.layers = [];
        this.session = config.session;
        this.kvo = new Kvo(this);
        this.session.kvo.changeToken.addObserver(this, () => this.reset());
        this.reset();
    }

    // So this looks like a CityMap to the view model MapLayers
    get size() { return this.session.map.size; }
    get tilePlane() { return this.session.map.tilePlane; }

    reset() {
        this.layers = [];
        this.layers.push(new MapLayerViewModel({
            index: 0,
            model: this,
            spriteSource: new TerrainSpriteSource({
                sourceLayer: this.session.map.terrainLayer,
                spriteStore: SpritesheetStore.mainMapStore
            })
        }));
        this.kvo.layers.notifyChanged();
    }
}

class MapLayerViewModel {
    static Kvo() { return { "layer": "layer" }; }

    constructor(config) {
        this.index = config.index;
        this.model = config.model;
        this.spriteSource = config.spriteSource;
        this.kvo = new Kvo(this);

        this.layer = new MapLayer({
            id: `viewlayer-${config.index}`,
            map: config.model,
            tileClass: SpriteTileModel
        });
        this.layer.visitTiles(null, tile => {
            tile.layerModel = this;
            tile._sprite = this.spriteSource.getSprite(tile.point);
        });
    }

    didSetSprite(tile, sprite) {
        this.kvo.layer.notifyChanged();
    }
}

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
    static Kvo() { return { "frameCounter": "frameCounter", "zoomLevel": "_zoomLevel" }; }

    constructor(config) {
        this.model = config.model; // MapViewModel
        this._zoomLevel = config.zoomLevel;
        this.elem = config.elem;
        this.layerViews = [];
        this.millisecondsPerAnimationFrame = 500;
        this.frameCounter = 0;
        this.kvo = new Kvo(this);

        this.rebuildLayers();
        this.model.kvo.layers.addObserver(this, () => this.rebuildLayers());
        config.runLoop.addDelegate(this);
    }

    get zoomLevel() { return this._zoomLevel; }
    set zoomLevel(value) {
        this.kvo.zoomLevel.setValue(value);
    }

    rebuildLayers() {
        this.layerViews.forEach(view => view.remove());
        this.layerViews = this.model.layers.map(layer => new SpriteMapLayerView({
            mapView: this,
            layer: layer,
            wrap: false,
            hasGrid: true
        }));
    }

    processFrame(rl) {
        this.updateFrameCounter(rl.latestFrameStartTimestamp());
        this.layerViews.forEach(view => view.render(this.frameCounter));
    }

    updateFrameCounter(timestamp) {
        let value = Math.floor(timestamp / this.millisecondsPerAnimationFrame);
        if (value == this.frameCounter) return;
        this.kvo.frameCounter.setValue(value);
    }
}

class SpriteMapLayerView {
    constructor(config) {
        this.mapView = config.mapView;
        this.model = config.layer;
        this.wrap = !!config.wrap;
        this.tilePlane = this.mapView.model.tilePlane;
        this.canvas = document.createElement("canvas");
        this.mapView.elem.append(this.canvas);
        this.tiles = [];
        this.isAnimated = false;
        this._dirty = false;
        this._dirtyAnimatedOnly = false;
        if (!!config.hasGrid) {
            this.gridPainter = new GridPainter(GameContent.shared.mainMapView);
        }

        this.mapView.kvo.frameCounter.addObserver(this, () => this.setDirty(true));
        this.mapView.kvo.zoomLevel.addObserver(this, () => this.zoomLevelChanged());
        this.model.kvo.layer.addObserver(this, () => this.updateTiles());

        this.zoomLevelChanged();
    }

    remove() {
        this.canvasGrid = null;
        this.canvas.remove();
        Kvo.stopObservations(this);
    }

    get allowAnimation() { return this.mapView.zoomLevel.allowAnimation; }

    zoomLevelChanged() {
        setTimeout(() => {
            if (this.canvasGrid) {
                this.canvasGrid.setSize({ tileWidth: this.mapView.zoomLevel.tileWidth, tileSpacing: 0 });
            } else {
                this.canvasGrid = new FlexCanvasGrid({
                    canvas: this.canvas,
                    deviceScale: FlexCanvasGrid.getDevicePixelScale(),
                    tileWidth: this.mapView.zoomLevel.tileWidth,
                    tileSpacing: 0
                });
            }
            // this.tilePlane = new TilePlane(this.canvasGrid.tileSize);
            this.updateTiles();
        }, 100);
    }

    updateTiles() {
        this.isAnimated = false;
        let tiles = [];

        if (this.wrap) {
            for (let y = 0; y < this.canvasGrid.tilesHigh; y += 1) {
                for (let x = 0; x < this.canvasGrid.tilesWide; x += 1) {
                    let tile = this.model.layer.getTileAtPoint(new Point(x % this.model.layer.size.width, y % this.model.layer.size.height));
                    if (!!tile && !!tile.sprite) {
                        let rect = new Rect(new Point(x, y), tile.sprite.tileSize);
                        tiles.push(new SpriteRenderModel(rect, tile.sprite, this.canvasGrid.tileWidth, this.tilePlane));
                        this.isAnimated = this.isAnimated || (tile.sprite.isAnimated && this.allowAnimation);
                    }
                }
            }
        } else {
            let canvasVisibleRect = new Rect(0, 0, this.canvasGrid.tileSize.width, this.canvasGrid.tileSize.height);
            let modelVisibleRect = this.tilePlane.modelRectForScreen(canvasVisibleRect);
            this.model.layer.visitTiles(modelVisibleRect, tile => {
                if (!!tile.sprite) {
                    let rect = new Rect(tile.point, tile.sprite.tileSize);
                    tiles.push(new SpriteRenderModel(rect, tile.sprite, this.canvasGrid.tileWidth, this.tilePlane));
                    this.isAnimated = this.isAnimated || (tile.sprite.isAnimated && this.allowAnimation);
                }
            });
        }

        tiles.sort((a, b) => a.drawOrder - b.drawOrder);
        this.tiles = tiles;
        this.setDirty();
    }

    setDirty(animatedOnly) {
        if (!!animatedOnly && !this.isAnimated) return;
        this._dirty = true;
        this._dirtyAnimatedOnly = !!animatedOnly;
    }

    render(frameCounter) {
        if (!this._dirty || !this.canvasGrid) { return; }

        frameCounter = this.isAnimated ? frameCounter : 0;
        let ctx = this.canvas.getContext("2d", { alpha: true });
        // if (!this._dirtyAnimatedOnly) {
            this.clear(ctx, this.canvasGrid.rectForFullCanvas);
        // }

        let store = SpritesheetStore.mainMapStore;
        let count = 0;
        this.tiles.forEach(tile => {
            if (this.shouldRender(tile)) {
                // if (this._dirtyAnimatedOnly) {
                //     this.clear(ctx, tile.screenRect(this.canvasGrid));
                // }
                count += 1;
                tile.render(ctx, this.canvasGrid, store, frameCounter);
            }
        });

        if (this.gridPainter) {
            this.gridPainter.render(ctx, this.mapView.model.session.terrain.map, this.canvasGrid, this.mapView.zoomLevel);
        }

        this._dirty = false;
        this._dirtyAnimatedOnly = false;
    }

    shouldRender(tile) {
        // if (this._dirtyAnimatedOnly && !!tile.sprite) {
        //     return tile.sprite.isAnimated;
        // }
        return true;
    }

    clear(ctx, rect) {
        if (this.model.index == 0) {
            ctx.fillStyle = GameContent.shared.mainMapView.outOfBoundsFillStyle;
            ctx.rectFill(rect);
        } else {
            ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
        }
    }
}


let initialize = function() {
    CitySimTerrain.uiRunLoop = new Gaming.RunLoop({ targetFrameRate: 60, id: "uiRunLoop" });
    GameScriptEngine.shared = new GameScriptEngine();
    CitySimTerrain.view = new RootView();
    CitySimTerrain.uiRunLoop.resume();
    debugLog("Ready.");
}

return {
    initialize: initialize
};

})(); // end namespace

cityReady("terrain.js");
