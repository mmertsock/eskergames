"use-strict";

window.CitySimTerrain = (function() {

var debugLog = Gaming.debugLog;
var debugWarn = Gaming.debugWarn;
var once = Gaming.once;
var deserializeAssert = Gaming.deserializeAssert;
var directions = Gaming.directions;
var Binding = Gaming.Binding;
var FlexCanvasGrid = Gaming.FlexCanvasGrid;
var Kvo = Gaming.Kvo;
var PerfTimer = Gaming.PerfTimer;
var Point = Gaming.Point;
var RandomLineGenerator = Gaming.RandomLineGenerator;
var Rect = Gaming.Rect;
var SaveStateCollection = Gaming.SaveStateCollection;
var SaveStateItem = Gaming.SaveStateItem;
var SelectableList = Gaming.SelectableList;
var UndoStack = Gaming.UndoStack;
var Vector = Gaming.Vector;
var GameDialog = CitySim.GameDialog;
var GameMap = CitySim.GameMap;
var GameStorage = CitySim.GameStorage;
var InputView = CitySim.InputView;
var MapRenderer = CitySim.MapRenderer;
var ScriptPainterStore = CitySim.ScriptPainterStore;
var SingleChoiceInputCollection = CitySim.SingleChoiceInputCollection;
var Strings = CitySim.Strings;
var Terrain = CitySim.Terrain;
var TerrainRenderer = CitySim.TerrainRenderer;
var TextInputView = CitySim.TextInputView;
var ToolButton = CitySim.ToolButton;
var GameContent = CitySimContent.GameContent;
var GameScriptEngine = CitySimContent.GameScriptEngine;

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
        var extremes = bounds.getExtremes();
        var e = bounds.getExtremes();
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
    constructor(config) {
        super();
        this.edge = config.edge; // MapEdge
        // number of tiles from the configured edge to the shore. Can be non-integer
        this.averageShoreDistanceFromEdge = config.averageShoreDistanceFromEdge;
        this.lineGenerator = new RandomLineGenerator({
            min: this.averageShoreDistanceFromEdge - config.variance,
            max: this.averageShoreDistanceFromEdge + config.variance,
            roughness: config.roughness
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
        // debugLog(edgeTiles);
        edgeTiles.forEach(edgeTile => {
            var shoreDistance = this.lineGenerator.nextValue();
            var line = this.edge.lineOfTiles(edgeTile, shoreDistance);
            this.fill(tiles, "O", line, generator);
        });
    }
}

class RiverTileGenerator extends TileGenerator {
    constructor(config) {
        super();
        this.sourceTile = config.sourceTile;
        this.mouthCenterTile = config.mouthCenterTile;
        this.mouthWidth = config.mouthWidth; // in tiles, can be decimal
        // array. first elem is snakiness at source, last elem is snakiness at mouth
        this.snakiness = config.snakiness;
    }

    get debugDescription() {
        return `<${this.constructor.name} ${this.sourceTile.debugDescription()}->${this.mouthCenterTile.debugDescription()}>`;
    }

    generateInto(tiles, generator) {
        var line = Point.tilesBetween(this.sourceTile, this.mouthCenterTile);
        this.fill(tiles, "R", line, generator);
    }
}

class TerrainGenerator {
    constructor(config) {
        this.map = new GameMap({
            size: config.size
        });
        var settings = Terrain.settings().oceanGenerator;
        var shoreDistanceW = this.size.width * settings.shoreDistanceFraction[config.size.index];
        var shoreDistanceH = this.size.height * settings.shoreDistanceFraction[config.size.index];
        var variance = settings.shoreDistanceVariance[config.size.index];
        var roughness = settings.roughness[config.size.index];
        this.builders = [
            new RiverTileGenerator({
                sourceTile: new Point(32, 32),
                mouthCenterTile: new Point(16, 0),
                mouthWidth: 1,
                snakiness: 0
            }),
            new OceanTileGenerator({ edge: MapEdge.N, averageShoreDistanceFromEdge: shoreDistanceH, variance: shoreDistanceH * variance, roughness: roughness }),
            new OceanTileGenerator({ edge: MapEdge.E, averageShoreDistanceFromEdge: shoreDistanceW, variance: shoreDistanceW * variance, roughness: roughness }),
            new OceanTileGenerator({ edge: MapEdge.S, averageShoreDistanceFromEdge: shoreDistanceH, variance: shoreDistanceH * variance, roughness: roughness }),
            new OceanTileGenerator({ edge: MapEdge.W, averageShoreDistanceFromEdge: shoreDistanceW, variance: shoreDistanceW * variance, roughness: roughness })
        ];
    }

    get size() { return this.map.size; }
    get bounds() { return this.map.bounds; }

    generateMap() {
        var timer = new PerfTimer("TerrainGenerator.generateMap").start();
        var tiles = [];
        for (var rowIndex = 0; rowIndex < this.size.height; rowIndex += 1) {
            var row = [];
            for (var colIndex = 0; colIndex < this.size.width; colIndex += 1) {
                row.push(" ");
            }
            tiles.push(row);
        }

        this.builders.forEach(builder => builder.generateInto(tiles, this));
        // debugLog("TILES\n" + this.ascii(tiles) + "\nEND");
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
            choices: Terrain.settings().sizes.map(size => { return {
                title: `${size.width} x ${size.height} tiles, ${Number.uiInteger(Terrain.kmForTileCount(size.width))} x ${Number.uiInteger(Terrain.kmForTileCount(size.height))} km`,
                value: size.index,
                selected: !!size.isDefault
            }; })
        });
        this.contentElem.append(formElem);
        this.allInputs = [this.nameInput];
    }

    get isModal() { return true; }
    get title() { return Strings.str("newTerrainDialogTitle"); }
    get dialogButtons() { return [this.createButton.elem]; }

    get isValid() {
        return this.allInputs.every(input => input.isValid)
            && this.sizes.value !== null;
    }

    get selectedSize() { return Terrain.sizeOrDefaultForIndex(this.sizes.value); }

    validateAndCreate() {
        if (!this.isValid) { debugLog("NOT VALID"); return; }

        var generator = new TerrainGenerator({
            size: this.selectedSize
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
        Terrain.quit(false);
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
        this._lastTokenDrawn = this.session.changeToken;
        debugLog("DRAWING TERRAIN");
        var ctx = this.drawContext;
        if (this.session && this.session.map) {
            this._terrainRenderer.render(ctx, this.settings, this.session.map.terrain);
        } else {
            this._terrainRenderer.render(ctx, this.settings);
        }
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
        this.buttons.push(new ToolButton({parent: globalBlock, title: Strings.str("undoButtonLabel"), clickScript: "terrainUndo"}));
        this.buttons.push(new ToolButton({parent: globalBlock, title: Strings.str("redoButtonLabel"), clickScript: "terrainRedo"}));
        this.buttons.push(new ToolButton({parent: globalBlock, title: "Help", clickScript: "showGameHelp"}));
        this._configureCommmands();
    }

    setUp(session) {
        this.session = session;
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
