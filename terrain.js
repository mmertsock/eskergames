"use-strict";

/*
TODOs
- Think about tile coordinates. Bottom left = (0,0) may be more sane for stuff like directions, edges, etc., and also it makes more sense to the end user
- Smoothing property for RandomLineGenerator: number of previous generations to average
- Smoother riverbanks
- Figure out actual model representation for terrain features in GameMaps
- Replace hacked TerrainRenderer with Painters for terrain features
- Whenever regenerating, encode the raw parameters + RNG seed into a hex value, store that 
  with the terrain, so you can use that key to recreate the random map.
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

const GameContent = CitySimContent.GameContent;
const GameDialog = CitySim.GameDialog;
const GameMap = CitySim.GameMap;
const GameScriptEngine = CitySimContent.GameScriptEngine;
const GameStorage = CitySim.GameStorage;
const InputView = CitySim.InputView;
const MapRenderer = CitySim.MapRenderer;
const ScriptPainterStore = CitySim.ScriptPainterStore;
const SingleChoiceInputCollection = CitySim.SingleChoiceInputCollection;
const Strings = CitySim.Strings;
const Terrain = CitySim.Terrain;
const TerrainRenderer = CitySim.TerrainRenderer;
const TerrainTile = CitySim.TerrainTile;
const TextInputView = CitySim.TextInputView;
const ToolButton = CitySim.ToolButton;

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
                tiles[tile.y][tile.x] = value;
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
            this.fill(tiles, TerrainTile.ocean, line, generator);
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
                    && tiles[point.y][point.x].isLand) {
                    water.push(point);
                }
                point = point.adding(axis);
            }
        });
        this.fill(tiles, TerrainTile.water, water, generator);
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
                if (tile.has(TerrainTile.flags.trees)) { treeCount += 1; }
                if (tile.isLand) { landCount += 1; }
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
                if (tile.isFreshwater) { freshCount += 1; }
                if (tile.isLand) { landCount += 1; }
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
        super(Object.assign({value: TerrainTile.water}, config));
    }

    shouldFill(point, tiles, generator) {
        return tiles[point.y][point.x].isLand;
    }
}

class WoodsTileGenerator extends BlobTileGenerator {
    constructor(config) {
        super(Object.assign({value: TerrainTile.forest}, config));
    }

    shouldFill(point, tiles, generator) {
        return tiles[point.y][point.x].isLand;
    }
}

class TerrainGenerator {
    constructor(config) {
        this.map = new GameMap({
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
        var timer = new PerfTimer("TerrainGenerator.generateMap").start();
        var tiles = [];
        for (var rowIndex = 0; rowIndex < this.size.height; rowIndex += 1) {
            var row = [];
            for (var colIndex = 0; colIndex < this.size.width; colIndex += 1) {
                row.push(TerrainTile.dirt);
            }
            tiles.push(row);
        }

        this.builders.forEach(builder => builder.generateInto(tiles, this));
        this.map.terrain = tiles;
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
        this.size = config.size;
        this.tiles = config.tiles;
        this.oldMap = config.oldMap;
    }
    get title() { return "Reset Map"; }
    undo() {
        this.session.replaceMap(this.oldMap, true);
    }
    redo() {
        var map = new GameMap({ size: this.size });
        map.terrain = this.tiles;
        this.session.replaceMap(map, true);
    }
}

class EditSession {
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
                size: newMap.size,
                tiles: newMap.terrain,
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
EditSession.Kvo = { "changeToken": "changeToken" };

class RootView {
    constructor() {
        this.session = null;
        this.views = [new TerrainView(), new ControlsView()];
        this._configureCommmands();
        
        var storage = GameStorage.shared;
        var url = new URL(window.location.href);
        var id = url.searchParams.get("id");
        if (id) { this.tryToLoadTerrain(id); return; }

        var createNewTerrain = !!url.searchParams.get("new");
        var id = storage.latestSavedTerrainID;
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
        this.sizes = new SingleChoiceInputCollection({
            id: "size",
            parent: formElem,
            title: Strings.str("terrainSettingsSizeLabel"),
            validationRules: [SingleChoiceInputCollection.selectionRequiredRule],
            choices: Terrain.settings().sizes.map(size => { return {
                title: `${size.width} x ${size.height} tiles, ${Number.uiInteger(Terrain.kmForTileCount(size.width))} x ${Number.uiInteger(Terrain.kmForTileCount(size.height))} km`,
                value: size.index,
                selected: !!size.isDefault
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
            CitySimTerrain.view.setUp(new EditSession({
                terrain: new Terrain({
                    name: this.nameInput.value,
                    map: map
                })
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
        this.canvas = document.querySelector("canvas.mainMap");
        this.zoomLevel = GameContent.shared.mainMapView.zoomLevels[1]; // MapRenderer.defaultZoomLevel();
        this._terrainRenderer = null;
        this._lastTokenDrawn = null;
        CitySimTerrain.uiRunLoop.addDelegate(this);
    }

    setUp(session) {
        this._lastTokenDrawn = null;
        this.session = session;
        this.canvasGrid = new FlexCanvasGrid({
            canvas: this.canvas,
            deviceScale: FlexCanvasGrid.getDevicePixelScale(),
            tileWidth: this.zoomLevel.tileWidth,
            tileSpacing: 0
        });

        var subRendererConfig = { canvasGrid: this.canvasGrid, game: null };
        this._terrainRenderer = new TerrainRenderer(subRendererConfig);
    }

    get drawContext() { return this.canvas.getContext("2d", { alpha: false }); }
    get settings() { return GameContent.shared.mainMapView; }

    processFrame(rl) {
        if (!this.session || this.session.changeToken == this._lastTokenDrawn) { return; }
        var timer = new PerfTimer("TerrainView.processFrame").start();
        this._lastTokenDrawn = this.session.changeToken;
        var settings = Object.assign({}, this.settings);
        settings.edgePaddingFillStyle = "white";
        var ctx = this.drawContext;
        if (this.session && this.session) {
            this._terrainRenderer.render(ctx, settings, this.session.terrain);
        } else {
            this._terrainRenderer.render(ctx, settings);
        }
        debugLog(timer.end().summary);
    }
}

class ControlsView {
    constructor() {
        this.session = null;
        this.root = document.querySelector("controls");
        this.buttons = [];

        var globalBlock = this.root.querySelector("#global-controls");
        this.buttons.push(new ToolButton({parent: globalBlock, title: "Restart", clickScript: "regenerate"}));
        this.buttons.push(new ToolButton({parent: globalBlock, title: Strings.str("optionsButtonLabel"), clickScript: "showFileMenu"}));
        this.undoButton = new ToolButton({parent: globalBlock, title: Strings.str("undoButtonLabel"), clickScript: "terrainUndo"});
        this.redoButton = new ToolButton({parent: globalBlock, title: Strings.str("redoButtonLabel"), clickScript: "terrainRedo"});
        this.buttons.push(this.undoButton);
        this.buttons.push(this.redoButton);
        this.buttons.push(new ToolButton({parent: globalBlock, title: "Help", clickScript: "showGameHelp"}));
        this._configureCommmands();

        this._dirty = true;
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
        if (!this._dirty) { return; }
        this._dirty = false;
        this.undoButton.isEnabled = !!this.session && this.session.undoStack.canUndo;
        this.redoButton.isEnabled = !!this.session && this.session.undoStack.canRedo;
    }

    _configureCommmands() {
        GameScriptEngine.shared.registerCommand("showFileMenu", () => this.showFileMenu());
    }
}

function dataIsReady(content) {
    if (!content) {
        alert("Failed to initialize CitySim base data.");
        return;
    }
    CitySimTerrain.uiRunLoop = new Gaming.RunLoop({ targetFrameRate: 60, id: "uiRunLoop" });
    GameContent.shared = GameContent.prepare(content);
    GameScriptEngine.shared = new GameScriptEngine();
    ScriptPainterStore.shared = new ScriptPainterStore();
    CitySimTerrain.view = new RootView();
    CitySimTerrain.uiRunLoop.resume();
    debugLog("Ready.");
}

var initialize = async function() {
    debugLog("Initializing...");
    var content = await GameContent.loadYamlFromLocalFile("city-content.yaml", GameContent.cachePolicies.forceOnFirstLoad);
    dataIsReady(content);
};

return {
    initialize: initialize
};

})(); // end namespace

CitySimTerrain.initialize();
