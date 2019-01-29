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
const Sprite = CitySim.Sprite;
const Spritesheet = CitySim.Spritesheet;
const SpritesheetStore = CitySim.SpritesheetStore;
const SpritesheetTheme = CitySim.SpritesheetTheme;
const Strings = CitySim.Strings;
const Terrain = CitySim.Terrain;
const TerrainRenderer = CitySim.TerrainRenderer;
const TerrainTile = CitySim.TerrainTile;
const TerrainType = CitySim.TerrainType;
const TextInputView = CitySim.TextInputView;
const ToolButton = CitySim.ToolButton;

// ----------------------------------- stuff that could go in city.js


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
        // let randomSprites = config.index == 0 ? SpritesheetStore.mainMapStore.allSprites.filter(item => item.id == "terrain-dirt") : [];
        // let randomSprites = [SpritesheetStore.mainMapStore.spriteWithUniqueID("terrain-ocean-open|0")]
        this.layer.visitTiles(null, tile => {
            tile.layerModel = this;
            // tile._sprite = randomSprites.randomItem()
        });

        if (config.index == 0) {
            let variantKeys = [
                [6, 2, 9, 26, 29, 12],
                [26, 24, 43, 16, 36, 30],
                [16, 10, 5, 8, 27, 43],
                [36, 22, 16, 35, 29, 6],
                [26, 13, 34, 13, 8, 33],
                [5, 0, 3, 2, 10, 32]
            ];
            variantKeys.forEach((row, y) => {
                row.forEach((variantKey, x) => {
                    this.layer.getTileAtPoint(new Point(x, y))._sprite = SpritesheetStore.mainMapStore.getSprite("terrain-ocean", variantKey);
                });
            })
        }

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
        sheet.renderSprite(ctx, this.screenRect(canvasGrid), this.sprite, this.tileWidth, frameCounter);
    }
    get debugDescription() {
        return `<@(${this.modelRect.x}, ${this.modelRect.y}) #${this.sprite.uniqueID} w${this.tileWidth} o${this.drawOrder}>`;
    }
    screenRect(canvasGrid) {
        return canvasGrid.rectForTileRect(this.screenTileRect);
    }
}

class SpriteMapLayerView {
    constructor(mapView, layer) {
        this.mapView = mapView;
        this.model = layer;
        this.tilePlane = layer.rootModel.tilePlane;
        this.canvas = document.createElement("canvas");
        this.mapView.elem.append(this.canvas);
        this.tiles = [];
        this.isAnimated = false;
        this.allowAnimation = this.mapView.zoomLevel.allowAnimation;
        this._dirty = false;
        this._dirtyAnimatedOnly = false;

        this.mapView.kvo.frameCounter.addObserver(this, () => this.setDirty(true));
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
        this.isAnimated = false;
        let tiles = [];
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
            ctx.fillStyle = GameContent.shared.mainMapView.emptyFillStyle;
            ctx.rectFill(rect);
        } else {
            ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
        }
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

        this.fillButton = new ToolButton({
            id: "fill-" + this.model.index,
            title: "Fill",
            click: () => this.selectSpriteToFill(),
            parent: config.elem
        });
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

    selectSpriteToFill() {
        new SpriteSelectorDialog(new FillModel(this.model)).show();
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

class FillModel {
    constructor(layerModel) {
        this.layerModel = layerModel;
    }
    get point() { return new Point(0, 0); }
    get sprite() { return null; }
    set sprite(value) {
        let size = value ? value.tileSize : { width: 1, height: 1 };
        for (let y = 0; y < this.layerModel.layer.size.height; y += size.height) {
            for (let x = 0; x < this.layerModel.layer.size.width; x += size.width) {
                this.layerModel.layer.getTileAtPoint(new Point(x, y)).sprite = value;
            }
        }
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

let initialize = function() {
    CitySimSprites.uiRunLoop = new Gaming.RunLoop({ targetFrameRate: 60, id: "uiRunLoop" });
    CitySimSprites.view = new RootView();
    CitySimSprites.uiRunLoop.resume();
    debugLog("Ready.");
}

return {
    initialize: initialize
};

})(); // end namespace

cityReady("sprites.js");
