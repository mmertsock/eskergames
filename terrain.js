"use-strict";

window.CitySimTerrain = (function() {

var debugLog = Gaming.debugLog;
var debugWarn = Gaming.debugWarn;
var once = Gaming.once;
var deserializeAssert = Gaming.deserializeAssert;
var Rect = Gaming.Rect;
var Point = Gaming.Point;
var SelectableList = Gaming.SelectableList;
var SaveStateCollection = Gaming.SaveStateCollection;
var SaveStateItem = Gaming.SaveStateItem;
var Kvo = Gaming.Kvo;
var Binding = Gaming.Binding;
var FlexCanvasGrid = Gaming.FlexCanvasGrid;
var MapRenderer = CitySim.MapRenderer;
var ScriptPainterStore = CitySim.ScriptPainterStore;
var Terrain = CitySim.Terrain;
var TerrainRenderer = CitySim.TerrainRenderer;
var ToolButton = CitySim.ToolButton;
var GameContent = CitySimContent.GameContent;
var GameScriptEngine = CitySimContent.GameScriptEngine;

class TerrainGenerator {
    constructor(config) {
        this.size = config.size;
    }

    generate() {
        return new Terrain({
            size: this.size
        });
    }
}

class TerrainEditSession {
    constructor(config) {
        this.terrain = config.terrain;
    }

    get debugDescription() {
        return this.terrain.debugDescription;
    }
}

class RootView {
    constructor() {
        this.session = null;
        this.views = [new TerrainView(), new ControlsView()];
        this._configureCommmands();
        this.showNewFileDialog();
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

    }

    redo() {

    }

    showGameHelp() {

    }

    showNewFileDialog() {
        var generator = new TerrainGenerator({
            size: Terrain.defaultSize()
        });
        var terrain = generator.generate();
        this.setUp(new TerrainEditSession({
            terrain: terrain
        }));
    }

    _configureCommmands() {
        GameScriptEngine.shared.registerCommand("saveCurrentTerrain", () => this.saveCurrentTerrain());
        GameScriptEngine.shared.registerCommand("terrainUndo", () => this.undo());
        GameScriptEngine.shared.registerCommand("terrainRedo", () => this.redo());
        GameScriptEngine.shared.registerCommand("showGameHelp", () => this.showGameHelp());
        GameScriptEngine.shared.registerCommand("showNewFileDialog", () => this.showNewFileDialog());
    }
}

class TerrainView {
    constructor() {
        this.session = null;
        this.canvas = document.querySelector("canvas.mainMap");
        this.zoomLevel = MapRenderer.defaultZoomLevel();
        this._terrainRenderer = null;
    }

    setUp(session) {
        this.session = session;
        this.canvasGrid = new FlexCanvasGrid({
            canvas: this.canvas,
            deviceScale: FlexCanvasGrid.getDevicePixelScale(),
            tileWidth: this.zoomLevel.tileWidth,
            tileSpacing: 0
        });

        var subRendererConfig = { canvasGrid: this.canvasGrid, game: null };
        this._terrainRenderer = new TerrainRenderer(subRendererConfig);
        CitySimTerrain.uiRunLoop.addDelegate(this);
    }

    get drawContext() { return this.canvas.getContext("2d", { alpha: false }); }
    get settings() { return GameContent.shared.mainMapView; }

    processFrame(rl) {
        var ctx = this.drawContext;
        this._terrainRenderer.render(ctx, this.settings);
    }
}

class ControlsView {
    constructor() {
        this.session = null;
        this.root = document.querySelector("controls");
        this.buttons = [];

        var globalBlock = this.root.querySelector("#global-controls");
        this.buttons.push(new ToolButton({parent: globalBlock, title: "Restart", clickScript: "showNewFileDialog"}));
        this.buttons.push(new ToolButton({parent: globalBlock, title: "Save", clickScript: "saveCurrentTerrain"}));
        this.buttons.push(new ToolButton({parent: globalBlock, title: "Undo", clickScript: "terrainUndo"}));
        this.buttons.push(new ToolButton({parent: globalBlock, title: "Redo", clickScript: "terrainRedo"}));
        this.buttons.push(new ToolButton({parent: globalBlock, title: "Help", clickScript: "showGameHelp"}));
    }

    setUp(session) {
        this.session = session;
    }
}

function dataIsReady(content) {
    if (!content) {
        alert("Failed to initialize CitySim base data.");
        return;
    }
    CitySimTerrain.uiRunLoop = new Gaming.RunLoop({ targetFrameRate: 60, id: "uiRunLoop" });
    GameContent.shared = content;
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
