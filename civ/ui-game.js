import * as Gaming from '../g.js';
import { Strings } from '../locale.js';
import { inj, Game, GameEngine, Tile, TileProjection, ZoomLevel } from './game.js';
import { CanvasInputController, DOMRootView, ScreenView, UI } from './ui-system.js';
import * as Drawables from './ui-drawables.js';

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, precondition = Gaming.precondition;
const Point = Gaming.Point, Rect = Gaming.Rect;

export function initialize() {
    inj().session = new GameSession();
    CutsceneView.initialize();
}

class GameSession {
    constructor() {
        this.engine = new GameEngine();
        inj().gse.registerCommand("beginNewGame", (model, evt) => {
            this.beginNewGame(model);
        });
        inj().gse.registerCommand("resumeSavedGame", (game) => {
            this.resumeGame(game);
        });
    }
    
    beginNewGame(model) {
        inj().gse.execute("playCutscene", "loading");
        // create a world
        // create civilizations and players
        let game = Game.createNewGame(model);
        // init the engine
        this.engine.setGame(game);
        // trigger the new-game story cutscene
        // cutscene ends and shows the GameSessionView
        GameSessionView.shared().show();
        // TODO set last difficulty index.
        // or really it's multiple properties from the new-game wizard, basically a subset of the new-game-model.
        this.autosave();
    }
    
    resumeGame(game) {
        inj().gse.execute("playCutscene", "loading");
        this.engine.setGame(game);
        GameSessionView.shared().show();
        this.autosave();
    }
    
    autosave() {
        if (!this.engine.game) { return; }
        try {
            let data = this.engine.game.serializedSavegameData;
            inj().storage.autosaveData = data;
        } catch (e) {
            debugWarn(`Failed to autosave: ${e.message}`);
            debugLog(e.stack);
        }
    }
}

class GameSessionView extends ScreenView {
    static shared() {
        if (!GameSessionView._shared) {
            GameSessionView._shared = new GameSessionView("game");
        }
        return GameSessionView._shared;
    }
    
    constructor(id) {
        super(id);
        this.session = inj().session;
        this.views = [
            // menubar view
            new GameContentView({ elem: document.querySelector("#game > content") }),
            new GameFooterView({ elem: document.querySelector("#game > statusbar") })
        ];
    }
}

// world view, side panels, overlays
class GameContentView {
    constructor(a) {
        this.session = inj().session;
        this.elem = a.elem;
        this.views = [
            new GameWorldView({ elem: document.querySelector("#world") })
        ];
    }
    
    screenDidShow() {
    }
}

const Interface_WorldViewModel = class {
    get worldRect() {}
    get zoomLevel() {}
    set zoomLevel(o) {}
    get projection() {}
};
const Interface_WorldViewModel_Projection = class {
    sizeForScreenSize(o) {}
    screenPointForCoord(o) {}
    coordForScreenPoint(o) {}
    screenRectForTile(o) {}
    lengthForScreenLength(o) {}
};

export class WorldView {
    constructor(a) {
        this.elem = a.elem;
        this.canvasCount = a.canvasCount;
        this.devicePixelRatio = a.devicePixelRatio;
        this.clickBehavior = null;
        this.panBehavior = null;
        this._viewModel = null; // WorldViewModel-type
        this.layers = [];
        this.canvasView = null; // WorldCanvasView
        this.inputController = null; // CanvasInputController
        
        this.target = new Gaming.DispatchTarget();
        // TODO pause animation on willResizeEvent, resume on didResize -- probably put that logic into the animation controller class not here.
        this.target.register(DOMRootView.didResizeEvent, () => {
            this.canvasView.resetCanvases();
            // Reset center if too close to the edges
            this.canvasView.viewportController.centerOnCoord(
                this.canvasView.viewport.centerCoord);
            this.render();
        });
    }
    
    get viewModel() { return this._viewModel; }
    set viewModel(value) {
        this._viewModel = value;
        this.configureView();
    }
    
    configureView() {
        this.canvasView = new WorldCanvasView({
            model: this._viewModel,
            elem: this.elem,
            canvasCount: this.canvasCount,
            devicePixelRatio: this.devicePixelRatio
        });
        this.inputController = new CanvasInputController({
            canvas: this.canvasView.referenceCanvas,
            viewportController: this.canvasView.viewportController,
            devicePixelRatio: this.devicePixelRatio
        });
        this.inputController.addDelegate(this);
        this.render();
    }
    
    addLayer(layer) {
        precondition(layer.canvasIndex >= 0 && layer.canvasIndex < this.canvasCount, "Invalid layer canvas index");
        this.layers.push(layer);
        this.layers.sort((a, b) => {
            if (a.canvasIndex == b.canvasIndex) {
                return a.zIndex - b.zIndex;
            } else {
                return a.canvasIndex - b.canvasIndex;
            }
        });
    }
    
    get isReady() { return !!this.viewModel; }
    
    zoomIn() {
        this.canvasView?.viewportController.zoomIn();
        this.render();
    }
    
    zoomOut() {
        this.canvasView?.viewportController.zoomOut();
        this.render();
    }
    
    centerMapUnderCursor() {
        if (!this.isReady) { return; }
        let canvasPoint = this.inputController.pointerCavasPoint;
        if (!canvasPoint) { return; }
        let coord = this.canvasView.viewport.coordForCanvasPoint(canvasPoint);
        this.centerOnCoord(coord);
    }
    
    pan(direction) {
        if (!this.isReady || !this.panBehavior) { return; }
        this._pan(this.panBehavior.smallPanScreenPoints(this, direction), direction);
    }
    
    panLarge(direction) {
        if (!this.isReady || !this.panBehavior) { return; }
        this._pan(this.panBehavior.largePanScreenPoints(this, direction), direction);
    }
    
    _pan(screenPoints, direction) {
        let tileDistance = this.viewModel.projection.lengthForScreenLength(screenPoints);
        let offset = WorldViewport.worldUnitVectorForScreenDirection(direction)
            .scaled(tileDistance);
        this.centerOnCoord(this.canvasView.viewport.centerCoord.adding(offset));
    }
    
    canvasClicked(eventModel) {
        if (!this.clickBehavior) { return; }
        let coord = this.canvasView.viewport.coordForCanvasPoint(eventModel.canvasPoint);
        this.clickBehavior.canvasClicked(this, coord, eventModel);
    }
    
    centerOnCoord(coord) {
        this.canvasView.viewportController.centerOnCoord(coord);
        this.render();
    }
    
    render() {
        if (!this.isReady) { return; }
        let clearedViewports = [];
        this.layers.forEach(layer => {
            this.canvasView.withRenderContext(layer.canvasIndex, c => {
                if (!clearedViewports[layer.canvasIndex]) {
                    clearedViewports[layer.canvasIndex] = true;
                    c.ctx.rectClear(c.viewportScreenRect);
                }
                layer.render(c);
            });
        });
    }
}

export class WorldViewLayer {
    constructor(canvasIndex, zIndex) {
        this.canvasIndex = canvasIndex;
        this.zIndex = zIndex;
        this.drawables = [];
        this.logTiming = false;
    }
    
    push(drawable) {
        this.drawables.push(drawable);
    }
    
    concat(drawables) {
        this.drawables = this.drawables.concat(drawables);
        return this;
    }
    
    get debugDescription() {
        return `<${this.constructor.name}#${this.canvasIndex},${this.zIndex}>`
    }
    
    render(c) {
        let timer = this.logTiming ? new Gaming.PerfTimer(this.debugDescription).start() : null;
        this.drawables.forEach(drawable => drawable.draw(c));
        if (timer) {
            debugLog(timer.end().summary);
        }
    }
}

class GameWorldView {
    constructor(a) {
        this.session = inj().session;
        this.worldView = new WorldView({
            elem: a.elem,
            canvasCount: 2,
            devicePixelRatio: window.devicePixelRatio
        });
        this.worldView.clickBehavior = new CenterMapClickBehavior();
        this.worldView.panBehavior = new PanBehavior(inj().content.worldView);
        
        inj().gse.registerCommand("gameWorldZoomIn", () => this.worldView.zoomIn());
        inj().gse.registerCommand("gameWorldZoomOut", () => this.worldView.zoomOut());
        inj().gse.registerCommand("gameWorldCenterMapUnderCursor", () => this.worldView.centerMapUnderCursor());
        inj().gse.registerCommand("gameWorldPan", (direction) => this.worldView.pan(direction));
        inj().gse.registerCommand("gameWorldPanLarge", (direction) => this.worldView.panLarge(direction));
    }
    
    get world() { return this.session.engine.game?.world; }
    
    screenDidShow() {
        this.worldView.addLayer(new WorldViewLayer(GameWorldView.planetCanvasIndex, 0)
            .concat([new Drawables.MapBackgroundDrawable()]));
        this.worldView.addLayer(new WorldViewLayer(GameWorldView.unitsCanvasIndex, 0)
            .concat(this.world.units.map(unit => new Drawables.UnitDrawable(unit))));
        this.worldView.viewModel = new GameWorldViewModel({ world: this.world });
        
        let focus = this.world.units[0];
        if (focus) {
            this.worldView.centerOnCoord(focus.tile.centerCoord);
        }
    }
}
GameWorldView.planetCanvasIndex = 0;
GameWorldView.unitsCanvasIndex = 1;

export class CenterMapClickBehavior {
    canvasClicked(worldView, coord, eventModel) {
        worldView.centerOnCoord(coord);
    }
}

export class PanBehavior {
    constructor(a) {
        this.smallPanPoints = a.smallPanPoints;
        this.largePanScreenFraction = a.largePanScreenFraction;
    }
    
    smallPanScreenPoints(worldView, direction) {
        return UI.deviceLengthForDOMLength(this.smallPanPoints, worldView.devicePixelRatio);
    }
    
    largePanScreenPoints(worldView, direction) {
        let smallPoints = this.smallPanScreenPoints(worldView, direction);
        let largePoints = this._viewportSizeInDirection(direction) * this.largePanScreenFraction;
        return Math.max(smallPoints, largePoints);
    }
    
    _viewportSizeInDirection(worldView, direction) {
        let size = worldView.canvasView.viewport.viewportScreenRect.size;
        switch (direction) {
            case Gaming.directions.N:
            case Gaming.directions.S:
                return size.height;
            case Gaming.directions.E:
            case Gaming.directions.W:
                return size.width;
            default:
                return Math.min(size.width, size.height);
        }
    }
}

class GameFooterView {
    constructor(a) {
        this.elem = a.elem;
        this.zoomInControlButton = new Gaming.ToolButton({
            parent: this.elem,
            title: Strings.str("zoomInControlButton"),
            clickScript: "gameWorldZoomIn"
        });
        this.zoomOutControlButton = new Gaming.ToolButton({
            parent: this.elem,
            title: Strings.str("zoomOutControlButton"),
            clickScript: "gameWorldZoomOut"
        });
    }
    
    screenDidShow() {
    }
}

export class WorldCanvasView {
    constructor(a) {
        this.elem = a.elem;
        this.devicePixelRatio = a.devicePixelRatio;
        this.canvases = [];
        for (let i = 0; i < a.canvasCount; i += 1) {
            let canvas = document.createElement("canvas");
            this.elem.append(canvas);
            this.canvases.push(canvas);
        }
        this.viewport = new WorldViewport({
            model: a.model,
            devicePixelRatio: a.devicePixelRatio,
            canvas: this.referenceCanvas
        });
        this.viewportController = new ViewportController({
            viewport: this.viewport
        });
        this.resetCanvases();
    }
    
    // WorldViewModel
    get model() { return this.viewport.model; }
    
    get referenceCanvas() {
        return this.canvases[this.canvases.length - 1];
    }
    
    withRenderContext(index, block) {
        let isOpaque = (index == 0);
        let ctx = this.canvases[index].getContext("2d", {alpha: !isOpaque});
        ctx.imageSmoothingEnabled = false;
        new CanvasRenderContext({
            ctx: ctx,
            isOpaque: isOpaque,
            devicePixelRatio: this.devicePixelRatio,
            viewModel: this.model,
            viewport: this.viewport
        }).withWorldOrigin(block);
    }
    
    resetCanvases() {
        this.canvases.forEach(canvas => {
            canvas.configureSize(this.elem, this.devicePixelRatio);
        });
    }
}

// Represents a virtual screen of device pixels for a game World. Maps zoom levels onto TileProjections, and determines pixel sizes and positions of rendered objects relative to the world model's origin. Does not deal with viewport details: WorldViewModel treats the virtual screen's (0,0) origin as mapping always to the tile world's (0,0) origin.
export class GameWorldViewModel {
    constructor(a) {
        this.world = a.world;
        this.projection = null; // set in zoomLevel setter
        this.zoomLevel = ZoomLevel.getDefault();
    }
    
    get zoomLevel() { return this._zoomLevel; }
    set zoomLevel(value) {
        this._zoomLevel = ZoomLevel.indexOrDefault(value);
        this.projection = new TileProjection(this._zoomLevel.tileWidth);
    }
    
    get worldRect() { return this.world.planet.rect; }
    
    get worldScreenRect() {
        return this.projection.screenRectForRect(this.world.planet.rect);
    }
}

export class EdgeOverscroll {
    static clampedCoord(coord, viewModel, canvasTileSize, overscroll) {
        return EdgeOverscroll._validCoordRect(viewModel, canvasTileSize, overscroll).clampedPoint(coord);
    }
    
    static _validCoordRect(viewModel, canvasTileSize, overscroll) {
        let validCoordSize = {
            width: Math.max(0, viewModel.worldRect.width + (2 * overscroll) - canvasTileSize.width),
            height: Math.max(0, viewModel.worldRect.height + (2 * overscroll) - canvasTileSize.height)
        };
        return Rect.withCenter(viewModel.worldRect.center, validCoordSize);
    }
}

// Displays a WorldViewModel at a particular panning offset within an HTML canvas. Assign the centerCoord property to pan the view. Adjust the zoom level using the WorldViewModel.
export class WorldViewport {
    // Up on screen = negative Y offset. "South is up"
    static worldUnitVectorForScreenDirection(direction) {
        return Gaming.Vector.unitsByDirection[Gaming.directions.flippedY[direction]];
    }
    
    constructor(a) {
        this.model = a.model; // WorldViewModel
        this.metrics = inj().content.worldView;
        this.canvas = a.canvas;
        this._centerCoord = null;
        this.centerCoord = this.model.worldRect.center;
    }
    
    get zoomLevel() { return this.model.zoomLevel; }
    set zoomLevel(value) {
        this.model.zoomLevel = value;
        // Adjust center for edge overscroll as needed
        this.centerCoord = this._centerCoord;
    }
    
    // The world coordinate to draw at the center of the HTML canvas
    get centerCoord() { return this._centerCoord; }
    set centerCoord(value) {
        let canvasTileSize = this.model.projection.sizeForScreenSize(this.canvas);
        this._centerCoord = EdgeOverscroll.clampedCoord(value, this.model, canvasTileSize, this.metrics.edgeOverscroll);
    }
    
    // Returns a CanvasRenderingContext2D, with a translation applied
    // so tile coordinate identified by centerCoord renders at the 
    // center of the canvas.
    getRenderContext() {
        // given canvas: 400x300
        // given factor: 32, centerCoord: (-1.5, 2.73)
        // canvasCenter = (200, 150)
        // originOffset = (48, -87)
        // translate (248, 63)
        // so world 0,0 displays at 248, 63
        // and world -1.5,2.73 displays at canvas center
        let canvasCenter = new Point(this.canvas.width * 0.5, this.canvas.height * 0.5).integral();
        let originOffset = this.model.projection.screenPointForCoord(this.centerCoord.inverted);
        let ctx = this.canvas.getContext("2d");
        ctx.setTransform(
            1, 0, 0, 1,
            canvasCenter.x + originOffset.x,
            canvasCenter.y + originOffset.y
        );
        return ctx;
    }
    
    // Tile coordinate
    coordForCanvasPoint(canvasPoint) {
        // To determine what tile you clicked on.
        // given canvas: 400x300, canvasCenter=200,150
        // given factor: 32, centerCoord (-1.5, 2.73)
        // ...
        // given canvasPoint 200,150
        // relativeToCanvasCenter = 0,0
        // returns -1.5, 2.73
        // given canvasPoint 256,63
        // relativeToCanvasCenter=56,-87
        // returns 0.25, -0.01125
        let relativeToCanvasCenter = new Point(
            canvasPoint.x - (0.5 * this.canvas.width),
            canvasPoint.y - (0.5 * this.canvas.height)
        );
        return this.model.projection.coordForScreenPoint(relativeToCanvasCenter)
            .adding(this.centerCoord);
    }
    
    // Pixel coordinates of canvas viewport bounds, relative to world origin
    get viewportScreenRect() {
        // centerScreenPoint = 50, 100
        // in world coords, canvas left edge is 50 - half the canvas width.
        // transform: move canvas drawing x0 to 50 - half the canvas width.
        let centerScreenPoint = this.model.projection.screenPointForCoord(this.centerCoord);
        return Rect.withCenter(centerScreenPoint, {width: this.canvas.width, height: this.canvas.height}).integral();
    }
}

// Updates a WorldViewport and tracks state for changes to it over time
export class ViewportController {
    constructor(a) {
        this.viewport = a.viewport;
    }
    
    // WorldViewModel
    get model() { return this.viewport.model; }
    get zoomLevel() { return this.model.zoomLevel; }
    
    // Immediately jumps. Retains center
    setZoomLevel(zoomLevel) {
        this.viewport.zoomLevel = zoomLevel;
    }
    
    zoomIn() {
        let next = this.viewport.zoomLevel.next;
        if (next) {
            this.viewport.zoomLevel = next;
        }
    }
    
    zoomOut() {
        let previous = this.viewport.zoomLevel.previous;
        if (previous) {
            this.viewport.zoomLevel = previous;
        }
    }
    
    // Immediately jumps. Zoom level optional
    centerOnCoord(coord, zoomLevel) {
        if (typeof(zoomLevel) != 'undefined') {
            this.viewport.zoomLevel = zoomLevel;
        }
        this.viewport.centerCoord = coord;
    }
    
    // setVisibleRect(tileRect, padding) to calculate zoomLevel
    // appropriate to display all coordinates relevant to some event.
}

export class CanvasRenderContext {
    constructor(a) {
        this.ctx = a.ctx;
        this.isOpaque = a.isOpaque;
        this.viewModel = a.viewModel;
        this.devicePixelRatio = a.devicePixelRatio;
        this.unitTileScreenRect = this.viewModel.projection.screenRectForTile(new Tile(0, 0));
        // This is only valid in withWorldOrigin mode
        this.viewportScreenRect = a.viewport.viewportScreenRect;
    }
    
    withWorldOrigin(block) {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, -this.viewportScreenRect.x, -this.viewportScreenRect.y);
        block(this);
        this.ctx.restore();
    }
    
    withOrigin(tile, block) {
        this.ctx.save();
        let origin = this.viewModel.projection.screenRectForTile(tile).origin;
        this.ctx.translate(origin.x, origin.y);
        block(this, tile);
        this.ctx.restore();
    }
    
    deviceLengthForDOMLength(px) {
        return px * this.devicePixelRatio;
    }
}

class CutsceneView extends ScreenView {
    static initialize() {
        inj().gse.registerCommand("playCutscene", (sceneID, evt) => {
            CutsceneView.shared().show().play(sceneID);
        });
    }
    
    static shared() {
        if (!CutsceneView._shared) {
            CutsceneView._shared = new CutsceneView();
        }
        return CutsceneView._shared;
    }
    
    constructor() {
        super("cutscene");
        this.session = inj().session;
        this.scene = null;
    }
    
    play(sceneID) {
        stop();
        this.scene = inj().content.cutscenes[sceneID];
        if (!this.scene) {
            debugWarn(`Unknown cutscene ${sceneID}`);
            this.stop();
            this.showError(sceneID);
            return;
        }
        this.sceneID = sceneID;
        this.stepIndex = -1;
        this.performNextStep();
    }
    
    stop() {
        // distinct from any pause() concept
        // stop and unload the current cutscene's media from memory
        this.scene = null;
        this.sceneID = null;
        this.stepIndex = -1;
    }
    
    performNextStep() {
        this.stepIndex += 1;
        if (this.stepIndex >= this.scene.length) { return; }
        this.perform(this.scene[this.stepIndex]);
    }
    
    perform(step) {
        this.clearContent();
        try {
            Gaming.deserializeAssert(Array.isArray(step));
            switch (step[0]) {
                case "showText": return this.showText(step);
                default:
                    debugWarn(`Unknown step type in ${this.sceneID}`);
                    return this;
            }
        } catch (e) {
            debugWarn(`Bad step data in ${this.sceneID}`);
            this.showError(this.sceneID);
        }
    }
    
    clearContent() {
        this.elem.removeAllChildren();
        this.elem.innerText = "";
    }
    
    showError(sceneID) {
        this.elem.innerText = `Error in cutscene ${sceneID}`;
    }
    
    showText(step) {
        Gaming.deserializeAssert(step.length == 2);
        this.elem.innerText = Strings.str(step[1]);
    }
    
    didHide() {
        stop();
    }
}
