"use-strict";

window.CitySimSprites = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;

const FlexCanvasGrid = Gaming.FlexCanvasGrid;
const Kvo = Gaming.Kvo;
const PerfTimer = Gaming.PerfTimer;
const Point = Gaming.Point;
const Rect = Gaming.Rect;
const Rng = Gaming.Rng;
const TilePlane = Gaming.TilePlane;
const Vector = Gaming.Vector;

const GameContent = CitySimContent.GameContent;
const GameScriptEngine = CitySimContent.GameScriptEngine;

const GameDialog = CitySim.GameDialog;
const GridPainter = CitySim.GridPainter;
const InputView = CitySim.InputView;
const MapLayer = CitySim.MapLayer;
const MapTile = CitySim.MapTile;
const MapRenderer = CitySim.MapRenderer;
const ScriptPainter = CitySim.ScriptPainter;
const ScriptPainterCollection = CitySim.ScriptPainterCollection;
const ScriptPainterSession = CitySim.ScriptPainterSession;
const ScriptPainterStore = CitySim.ScriptPainterStore;
const SingleChoiceInputCollection = CitySim.SingleChoiceInputCollection;
const Strings = CitySim.Strings;
const Terrain = CitySim.Terrain;
const TerrainRenderer = CitySim.TerrainRenderer;
const TerrainTile = CitySim.TerrainTile;
const TerrainType = CitySim.TerrainType;
const TextInputView = CitySim.TextInputView;
const ToolButton = CitySim.ToolButton;

// ----------------------------------- stuff that could go in city.js

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
        config.image.src = config.path;
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

    getSpritesheet(sheetID, tileWidth) {
        let item = this.sheetTable[sheetID];
        return item ? item[tileWidth] : null;
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
        this.spriteTable = {};
        config.sprites.forEach(item => {
            item.variants.forEach((variant, index) => {
                let sprite = new Sprite(Object.assign({}, item, variant, {"variantKey": index}));
                this.spriteTable[sprite.uniqueID] = sprite;
                this.sprites.push(sprite);
            });
        });
    }
}

class Spritesheet {
    constructor(config) {
        this.id = config.id;
        this.image = config.image;
        this.tileWidth = config.tileWidth; // in device pixels
        this.imageBounds = new Rect(new Point(0, 0), config.imageSize) // in device pixels
    }

    renderSprite(ctx, rect, sprite, tileWidth, frameCounter) {
        let src = this.sourceRect(sprite, frameCounter);
        if (!this.imageBounds.contains(src)) {
            once("oob" + sprite.uniqueID, () => debugWarn(`Sprite ${sprite.uniqueID} f${frameCounter} out of bounds in ${this.debugDescription}`));
            return;
        }
        // debugLog(`draw ${sprite.uniqueID} src ${src.debugDescription} -> dest ${rect.debugDescription}`);
        ctx.drawImage(this.image, src.x, src.y, src.width, src.height, rect.x, rect.y, src.width, src.height);
    }

    sourceRect(sprite, frameCounter) {
        let width = sprite.tileSize.width * this.tileWidth;
        let height = sprite.tileSize.height * this.tileWidth;
        let col = sprite.isAnimated ? frameCounter % sprite.frames : 0;
        return new Rect(col * width, sprite.row * height, width, height);
    }

    get debugDescription() {
        return `<Spritesheet #${this.id} w${this.tileWidth}>`;
    }
}

class Sprite {
    constructor(config) {
        this.id = config.id;
        this.sheetID = config.sheetID;
        this.variantKey = config.variantKey;
        this.uniqueID = `${this.id}|${this.variantKey}`;
        this.row = config.row;
        this.frames = config.frames;
        this.tileSize = config.tileSize;
    }
    get isAnimated() { return this.frames >= 1; }

    isEqual(other) {
        return other && other.uniqueID == this.uniqueID;
    }
}

// -----------------------------------

function showMessage(msg) {
    debugLog(msg);
    document.querySelector("footer textarea").value += msg + "\n";
}
function resetMessageArea() {
    document.querySelector("footer textarea").value = "";
}

class ViewModel {
    constructor() {
        this.layers = [];
        this.size = { width: 6, height: 6 };
        this.tilePlane = new TilePlane(this.size);
        this.kvo = new Kvo(this);
    }

    appendLayer() {
        this.layers.push(new LayerModel({
            index: this.layers.length,
            rootModel: this
        }));
        this.kvo.layers.notifyChanged();
        return this.layers[this.layers.length - 1];
    }

    removeLayer(index) {
        this.layers[index].rootModel = null;
        this.layers.removeItemAtIndex(index);
        this.layers.forEach((layer, index) => layer.index = index);
        this.kvo.layers.notifyChanged();
    }
}
ViewModel.Kvo = { "layers": "layers" };

class LayerModel {
    constructor(config) {
        this._index = config.index;
        this.rootModel = config.rootModel;
        this.layer = new MapLayer({
            id: `layer-${config.index}`,
            map: config.rootModel,
            tileClass: SpriteTileModel
        });
        // let randomSprites = SpritesheetStore.mainMapStore.allSprites.filter(item => item.tileSize.width == 1);
        let randomSprites = [SpritesheetStore.mainMapStore.spriteWithUniqueID("terrain-ocean-open|0")]
        this.layer.visitTiles(null, tile => {
            tile.layerModel = this;
            tile._sprite = randomSprites.randomItem()
        });
        this.kvo = new Kvo(this);
    }

    get index() { return this._index; }
    set index(value) { this.kvo.index.setValue(value); }

    willSetSprite(tile, sprite) {
        if (!!tile.overlappingTile) {
            tile.overlappingTile.sprite = null;
        }
        let oldRect = tile.spriteRect;
        if (!!oldRect) {
            this.layer.visitNeighborsInRect(oldRect, tile, neighbor => {
                neighbor.overlappingTile = null;
            });
        }
    }

    didSetSprite(tile, sprite) {
        if (!!sprite) {
            this.layer.visitNeighborsInRect(tile.spriteRect, tile, neighbor => {
                neighbor.sprite = null;
                neighbor.overlappingTile = tile;
            });
        }

        this.kvo.layer.notifyChanged();
    }
}
LayerModel.Kvo = { "index": "_index", "layer": "layer" };

class SpriteTileModel extends MapTile {
    constructor(point, layer) {
        super(point, layer);
        this._sprite = null;
        this.overlappingTile = null;
    }

    get sprite() { return this._sprite; }
    set sprite(value) {
        if (this._sprite == value) { return; }
        this.layerModel.willSetSprite(this, value);
        this._sprite = value;
        this.layerModel.didSetSprite(this, value);
    }

    get spriteRect() {
        if (!this._sprite) { return null; }
        return new Rect(this.point, this._sprite.tileSize);
    }
}

class RootView {
    constructor() {
        this.model = new ViewModel();
        this.layerConfigViews = [];
        this.maps = [];
        this.elems = {
            mapContainer: document.querySelector(".maps ol"),
            configContainer: document.querySelector("#layerConfig ol")
        };

        this.appendLayerButton = new ToolButton({
            id: "appendLayer",
            title: "Add Layer",
            click: () => this.appendLayer(),
            parent: document.querySelector("#layerConfig")
        });
        // button to add a layer view
        this.appendLayer();

        Array.from(GameContent.shared.mainMapView.zoomLevels).reverse().forEach(zoomLevel => this.addMap(zoomLevel));
    }

    addMap(zoomLevel) {
        let elem = document.createElement("li");
        this.maps.push(new SpriteMapView({ model: this.model, zoomLevel: zoomLevel, elem: elem }));
        this.elems.mapContainer.append(elem);
    }

    appendLayer() {
        let layerModel = this.model.appendLayer();
        let elem = document.querySelector(".layerConfig.template").cloneNode(true)
            .addRemClass("template", false).addRemClass("cloned", true).addRemClass("hidden", false);
        let configView = new LayerConfigView({
            rootView: this,
            elem: elem,
            model: layerModel
        });
        this.elems.configContainer.append(elem);
        this.layerConfigViews.push(configView);
    }

    removeLayer(configView) {
        this.model.removeLayer(configView.model.index);
        this.layerConfigViews.removeItemAtIndex(configView.index);
        configView.elem.remove();
    }
}

class SpriteMapView {
    constructor(config) {
        this.model = config.model; // ViewModel
        this.zoomLevel = config.zoomLevel;
        this.elem = config.elem;
        this.layerViews = [];
        this.millisecondsPerAnimationFrame = 500;
        this.frameCounter = 0;
        this.kvo = new Kvo(this);

        this.rebuildLayers();
        this.model.kvo.layers.addObserver(this, () => this.rebuildLayers());
        CitySimSprites.uiRunLoop.addDelegate(this);
    }

    rebuildLayers() {
        this.layerViews.forEach(view => view.remove());
        this.layerViews = this.model.layers.map(layer => new SpriteMapLayerView(this, layer));
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
SpriteMapView.Kvo = { "frameCounter": "frameCounter" }

class SpriteRenderModel {
    constructor(modelRect, sprite, tileWidth, tilePlane) {
        this.modelRect = modelRect;
        this.screenTileRect = tilePlane.screenRectForModel(modelRect);
        this.sprite = sprite;
        this.tileWidth = tileWidth;
        this.drawOrder = tilePlane.drawingOrderIndexForModelRect(modelRect);
    }
    render(ctx, canvasGrid, store, frameCounter) {
        let sheet = store.getSpritesheet(this.sprite.sheetID, this.tileWidth);
        if (!sheet) {
            once("nosheet" + this.sprite.sheetID, () => debugWarn(`No Spritesheet found for ${this.debugDescription}`));
            return;
        }
        let rect = canvasGrid.rectForTileRect(this.screenTileRect);
        sheet.renderSprite(ctx, rect, this.sprite, this.tileWidth, frameCounter);
    }
    get debugDescription() {
        return `<@(${this.modelRect.x}, ${this.modelRect.y}) #${this.sprite.uniqueID} w${this.tileWidth} o${this.drawOrder}>`;
    }
}

class SpriteMapLayerView {
    constructor(mapView, layer) {
        this.mapView = mapView;
        this.model = layer;
        this.tilePlane = layer.rootModel.tilePlane;
        this.canvas = document.createElement("canvas");
        this.canvas.style.width = "144px";
        this.canvas.style.height = "144px";
        this.mapView.elem.append(this.canvas);
        this.tiles = [];

        this.mapView.kvo.frameCounter.addObserver(this, () => this.setDirty());
        this.model.kvo.index.addObserver(this, () => this.updateTiles());
        this.model.kvo.layer.addObserver(this, () => this.updateTiles());

        setTimeout(() => {
            this.canvasGrid = new FlexCanvasGrid({
                canvas: this.canvas,
                deviceScale: FlexCanvasGrid.getDevicePixelScale(),
                tileWidth: this.mapView.zoomLevel.tileWidth,
                tileSpacing: 0
            });
            this.tilePlane = new TilePlane(this.canvasGrid.tileSize);
            this.updateTiles();
        }, 100);
    }

    remove() {
        this.canvasGrid = null;
        this.canvas.remove();
        Kvo.stopObservations(this);
    }

    updateTiles() {
        let tiles = [];
        for (let y = 0; y < this.canvasGrid.tilesHigh; y += 1) {
            for (let x = 0; x < this.canvasGrid.tilesWide; x += 1) {
                let tile = this.model.layer.getTileAtPoint(new Point(x % this.model.layer.size.width, y % this.model.layer.size.height));
                if (!!tile && !!tile.sprite) {
                    let rect = new Rect(new Point(x, y), tile.sprite.tileSize);
                    tiles.push(new SpriteRenderModel(rect, tile.sprite, this.canvasGrid.tileWidth, this.tilePlane));
                }
            }
        }
        tiles.sort((a, b) => a.drawOrder - b.drawOrder);
        this.tiles = tiles;
        this.setDirty();
    }

    setDirty() {
        this._dirty = true;
    }

    render(frameCounter) {
        if (!this._dirty) { return; }
        this._dirty = false;
        let ctx = this.canvas.getContext("2d", { alpha: true });
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        let store = SpritesheetStore.mainMapStore;
        this.tiles.forEach(tile => tile.render(ctx, this.canvasGrid, store, frameCounter));
    }
}

class LayerConfigView {
    constructor(config) {
        this.rootView = config.rootView;
        this.model = config.model; // LayerModel
        this.elem = config.elem;

        this.tileConfig = [];
        for (let y = 0; y < this.rootView.model.size.height; y += 1) {
            let rowConfig = [];
            let tr = document.createElement("tr");
            for (let x = 0; x < this.rootView.model.size.width; x += 1) {
                let td = document.createElement("td");
                tr.append(td);
                rowConfig.push(new TileConfigView({
                    layerView: this,
                    rootView: config.rootView,
                    elem: td,
                    model: this.model.layer.getTileAtPoint(this.rootView.model.tilePlane.screenTileForModel(new Point(x, y)))
                }));
            }
            this.elem.querySelector(".tiles tbody").append(tr);
            this.tileConfig.push(rowConfig);
        }

        if (this.model.index > 0) {
            this.removeLayerButton = new ToolButton({
                id: "remove-" + this.model.index,
                title: "Remove Layer",
                click: () => this.remove(),
                parent: config.elem
            });
        }

        this.model.kvo.index.addObserver(this, o => this.updateLabels());
        this.model.kvo.layer.addObserver(this, o => this.updateLabels());
        this.updateLabels();
    }

    updateLabels() {
        this.elem.querySelector("h3").innerText = `Layer ${this.model.index + 1}`;
        this.tileConfig.forEachFlat(tile => tile.updateLabels());
    }

    remove() {
        Kvo.stopObservations(this);
        this.rootView.removeLayer(this);
        this.rootView = null;
        this.tileConfig = null;
    }
}

class TileConfigView {
    constructor(config) {
        this.elem = config.elem;
        this.layerView = config.layerView;
        this.rootView = config.rootView;
        this.model = config.model; // SpriteTileModel
        this.elem.addEventListener("click", evt => {
            evt.preventDefault();
            this.showOptions();
        });
        this.updateLabels();
    }

    updateLabels() {
        if (this.model.sprite) {
            this.elem.innerText = `${this.model.sprite.id}/${this.model.sprite.variantKey}`;
        } else if (this.model.overlappingTile && this.model.overlappingTile.sprite) {
            let tile = this.model.overlappingTile;
            this.elem.innerText = `${tile.sprite.id}/${tile.sprite.variantKey}`;
        } else {
            this.elem.innerText = "(Choose)";
        }
    }

    showOptions() {
        new SpriteSelectorDialog(this.model).show();
    }
}

class SpriteSelectorDialog extends GameDialog {
    constructor(tileModel) {
        super();
        this.model = tileModel; // SpriteTileModel
        this.store = SpritesheetStore.mainMapStore;
        this.clearButton = new ToolButton({ title: "Clear", click: () => this.clear() });
        this.saveButton = new ToolButton({ title: "Save", click: () => this.save() });

        this.contentElem = GameDialog.createContentElem();
        let formElem = GameDialog.createFormElem();
        this.spriteList = new SingleChoiceInputCollection({
            id: "sprite",
            parent: formElem,
            title: "Sprite",
            choices: this.store.allSprites.map(sprite => {
                return {
                    title: `${sprite.id} #${sprite.variantKey} (${sprite.tileSize.width}x${sprite.tileSize.height})`,
                    value: sprite.uniqueID,
                    selected: sprite.isEqual(this.model.sprite)
                };
            })
        });
        this.contentElem.append(formElem);
    }

    get isModal() { return true; }
    get title() { return `(${this.model.point.x}, ${this.model.point.y}): Select Sprite`; }
    get dialogButtons() { return [this.clearButton.elem, this.saveButton.elem]; }
    get isValid() { return true; }

    clear() {
        this.model.sprite = null;
        this.dismiss();
    }

    save() {
        if (this.spriteList.value) {
            this.model.sprite = this.store.spriteWithUniqueID(this.spriteList.value);
        } else {
            this.model.sprite = null;
        }
        this.dismiss();
    }
}

function gameContentIsReady(content) {
    if (!content) {
        alert("Failed to initialize CitySim base data.");
        return;
    }
    GameContent.shared = GameContent.prepare(content);
    SpritesheetStore.load(SpritesheetTheme.defaultTheme(), (store, error) => {
        if (error) {
            alert("Failed to load sprites: " + error.message);
            return;
        }
        spritesheetsAreReady(store);
    });
}

function spritesheetsAreReady(store) {
    SpritesheetStore.mainMapStore = store;
    CitySimSprites.uiRunLoop = new Gaming.RunLoop({ targetFrameRate: 60, id: "uiRunLoop" });
    GameScriptEngine.shared = new GameScriptEngine();
    ScriptPainterStore.shared = new ScriptPainterStore();
    CitySimSprites.view = new RootView();
    CitySimSprites.uiRunLoop.resume();
    debugLog("Ready.");
}

let initialize = async function() {
    debugLog("Initializing...");
    let content = await GameContent.loadYamlFromLocalFile("city-content.yaml", GameContent.cachePolicies.forceOnFirstLoad);
    gameContentIsReady(content);
};

return {
    initialize: initialize
};

})(); // end namespace

CitySimSprites.initialize();
