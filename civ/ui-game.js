import * as Gaming from '../g.js';
import { Strings } from '../locale.js';
import { inj, Game, GameEngine, Tile, TileProjection } from './game.js';
import { CanvasInputController, DOMRootView, PerfLabel, ScreenView, UI } from './ui-system.js';
import * as Drawables from './ui-drawables.js';

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, precondition = Gaming.precondition;
const Point = Gaming.Point, Rect = Gaming.Rect;

export function initialize() {
    Drawables.initialize();
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
            new GameMenubarView({ elem: document.querySelector("#game > menubar")}),
            new GameContentView({ elem: document.querySelector("#game > content") })
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

class GameMenubarView {
    constructor(a) {
        this.elem = a.elem;
        this.views = [
            new Gaming.ToolButton({
                parent: this.elem,
                title: Strings.str("zoomOutControlButton"),
                clickScript: "gameWorldZoomOut"
            }),
            new Gaming.ToolButton({
                parent: this.elem,
                title: Strings.str("zoomInControlButton"),
                clickScript: "gameWorldZoomIn"
            }),
            new PerfLabel(this.elem)
        ];
    }
}

// Interfaces for objects passed to the WorldView and owned by the WorldView's owner.

// Abstracts the world map itself, and owns a projection of a world's units to a 2D plane of device pixels. Updates projection via the zoomFactor property. Exposes basic size info for the world map, for use by viewports to determine zoom/panning constraints. Works with an unbounded world plane with origin at world's origin; knows nothing about viewports or offsets within a viewport. No knowledge of animation or time.
const Interface_WorldViewModel = class {
    get kvo() { return {"zoomFactor": "", "viewportCenterCoord": "", "dirtyRect": ""}; }
    get projection() {}
    // Object or primitive describing device pixels relative to world units
    get zoomFactor() {}
    set zoomFactor(o) {}
    // Just storing and observing, though the view model itself shouldn't care about it (the WorldViewport does)
    get viewportCenterCoord() {}
    set viewportCenterCoord(o) {}
    
    // Tile coordinates
    get dirtyRect() {}
    set dirtyRect(o) {}
    addDirtyRect(rect) {}
    
    // 2D rect of the world's bounds in tile coordinates
    get worldRect() {}
    // Device pixel units based on the projection. Origin == worldRect origin
    get worldScreenRect() {}
};

// Maps a world's units to a 2D plane of device pixels at some instant in time. Screen plane is unbounded with no viewport or offset; just scales x/y values from the origin based on zoom factor (managed by the WorldViewModel or other owner)
const Interface_WorldViewModel_Projection = class {
    sizeForScreenSize(o) {}
    screenPointForCoord(o) {}
    coordForScreenPoint(o) {}
    screenRectForTile(o) {}
    lengthForScreenLength(o) {}
};

// Implements each use case for panning/zooming user inputs. Sends exact device-pixel target centerCoord/zoom values to ViewportController to animate (subject to clamping in viewport, etc.).
export class WorldView {
    // Set viewModel after init, when ready to activate all functionality.
    constructor(a) {
        this.elem = a.elem;
        this.canvasCount = a.canvasCount;
        this.devicePixelRatio = a.devicePixelRatio;
        this.clickBehavior = null;
        this.panBehavior = null;
        this.zoomBehavior = null;
        this._viewModel = null; // WorldViewModel-type
        this.layers = [];
        this.canvasView = null; // WorldCanvasView
        this.inputController = null; // CanvasInputController
        
        this.target = new Gaming.DispatchTarget();
        // TODO pause animation on willResizeEvent, resume on didResize -- probably put that logic into the animation controller class not here.
        this.target.register(DOMRootView.didResizeEvent, () => this._canvasDidResize());
    }
    
    get viewModel() { return this._viewModel; }
    set viewModel(value) {
        this._viewModel = value;
        this._configureView();
    }
    
    get viewport() { return this.canvasView?.viewport; }
    get viewportScreenRect() {
        return this.canvasView.viewport.viewportScreenRect;
    }
    
    _configureView() {
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
        let zoomFactor = this.viewModel.zoomFactor;
        if (this.zoomBehavior) {
            zoomFactor = this.zoomBehavior.validatedZoomFactor(this, zoomFactor);
        }
        this.canvasView.viewportController.centerOnCoord(
            this.viewModel.viewportCenterCoord, zoomFactor, false);
        this.setWorldDirty();
    }
    
    _canvasDidResize() {
        if (!this.isReady) { return; }
        this.canvasView.resetCanvases();
        // Reset viewport to respect edge/zoom constraints
        let zoomFactor = this.viewModel.zoomFactor;
        if (this.zoomBehavior) {
            zoomFactor = this.zoomBehavior.validatedZoomFactor(this, zoomFactor);
        }
        this.canvasView.viewportController.setZoomFactor(zoomFactor, true);
        this.setWorldDirty();
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
        if (!this.isReady || !this.zoomBehavior) { return; }
        let zoomFactor = this.zoomBehavior.steppingIn(this, this.viewModel.zoomFactor);
        this.canvasView.viewportController.setZoomFactor(zoomFactor, true);
        this.setWorldDirty();
    }
    
    zoomOut() {
        if (!this.isReady || !this.zoomBehavior) { return; }
        let zoomFactor = this.zoomBehavior.steppingOut(this, this.viewModel.zoomFactor);
        this.canvasView.viewportController.setZoomFactor(zoomFactor, true);
        this.setWorldDirty();
    }
    
    centerMapUnderCursor() {
        if (!this.isReady) { return; }
        let canvasPoint = this.inputController.pointerCavasPoint;
        if (!canvasPoint) { return; }
        let coord = this.canvasView.viewport.coordForCanvasPoint(canvasPoint);
        this.centerOnCoord(coord, undefined, true);
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
        this.centerOnCoord(this.viewModel.viewportCenterCoord.adding(offset), undefined, true);
    }
    
    canvasClicked(eventModel) {
        if (!this.clickBehavior) { return; }
        let coord = this.canvasView.viewport.coordForCanvasPoint(eventModel.canvasPoint);
        this.clickBehavior.canvasClicked(this, coord, eventModel);
    }
    
    centerOnCoord(coord, zoomFactor, animated) {
        this.canvasView.viewportController.centerOnCoord(coord, zoomFactor, animated);
        this.setWorldDirty();
    }
    
    setWorldDirty() {
        if (this.viewModel) {
            this.viewModel.dirtyRect = this.canvasView.viewport.viewportWorldRect;
        }
    }
    
    processFrame(frame) {
        frame.stats.drawablesRendered = 0;
        frame.stats.drawablesSkipped = 0;
        frame.state.rectsDrawn = [];
        let start = performance.now();
        this.drawFrame(frame);
        frame.stats.totalRenderTime = performance.now() - start;
    }
    
    drawFrame(frame) {
        if (!this.isReady) { return; }
        if (!this.viewModel.dirtyRect || this.viewModel.dirtyRect.isEmpty()) { return; }
        let clearedViewports = [];
        this.layers.forEach(layer => {
            this.canvasView.withRenderContext(layer.canvasIndex, frame, c => {
                if (!clearedViewports[layer.canvasIndex]) {
                    clearedViewports[layer.canvasIndex] = true;
                    c.ctx.rectClear(c.dirtyScreenRect);
                }
                layer.render(c);
            });
        });
        this.viewModel.dirtyRect = null;
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
        this.drawables.forEach(drawable => drawable.drawFrame(c, this));
        if (timer) {
            debugLog(timer.end().summary);
        }
    }
}

class WorldViewTerrainLayer extends WorldViewLayer {
    constructor(view, canvasIndex, zIndex) {
        super(canvasIndex, zIndex);
        this.logTiming = false;
        this.push(new Drawables.MapBackgroundDrawable());
        view.world.planet.map.forEachSquare(s => {
            this.push(new Drawables.TerrainBaseLayerDrawable(s));
        });
        view.world.planet.map.forEachEdge(edge => {
            if (edge.square && edge.toSquare) {
                this.push(new Drawables.TerrainEdgeDrawable(edge));
            }
        });
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
        this.worldView.zoomBehavior = new ZoomBehavior(inj().content.worldView.zoomBehavior);
        this.worldView.panBehavior = new PanBehavior(inj().content.worldView.panBehavior);
        
        inj().gse.registerCommand("gameWorldZoomIn", () => this.worldView.zoomIn());
        inj().gse.registerCommand("gameWorldZoomOut", () => this.worldView.zoomOut());
        inj().gse.registerCommand("gameWorldCenterMapUnderCursor", () => this.worldView.centerMapUnderCursor());
        inj().gse.registerCommand("gameWorldPan", (direction) => this.worldView.pan(direction));
        inj().gse.registerCommand("gameWorldPanLarge", (direction) => this.worldView.panLarge(direction));
    }
    
    get game() { return this.session.engine.game; }
    get world() { return this.session.engine.game?.world; }
    get viewModel() { return this.worldView.viewModel; }
    
    screenDidShow() {
        Gaming.Kvo.stopAllObservations(this);
        
        this.worldView.addLayer(new WorldViewTerrainLayer(this, GameWorldView.planetCanvasIndex, 0));
        this.worldView.addLayer(new WorldViewLayer(GameWorldView.unitsCanvasIndex, 0)
            .concat(this.world.units.map(unit => new Drawables.UnitDrawable(unit))
            .concat([new Drawables.GraphicsDebugDrawable(false)])
        ));
            
        let zoomFactor = this.worldView.zoomBehavior.deserializedZoomFactor(this.worldView, this.game.ui.camera?.zoomFactor);
        let centerCoord = this.game.ui.camera?.centerCoord ? new Point(this.game.ui.camera.centerCoord) : this.world.units[0]?.tile.centerCoord;
        if (!centerCoord) {
            centerCoord = this.world.planet.rect.center;
        }
        
        this.worldView.viewModel = new GameWorldViewModel(this.world, zoomFactor, centerCoord);
        this.viewModel.kvo.addObserver(this, () => this.saveCamera());
        
        // Fails to load first image (?) if you don't setTimeout
        // TODO do this as part of the initial startup sequence
        setTimeout(() => inj().spritesheets.loadAll(() => this.worldView.setWorldDirty()), 0);
        
        inj().animationController.addDelegate(this);
    }
    
    screenDidHide() {
        inj().animationController.removeDelegate(this);
    }
    
    processFrame(frame) {
        this.worldView.processFrame(frame);
    }
    
    saveCamera() {
        if (this.game && this.viewModel) {
            let camera = {
                zoomFactor: this.worldView.zoomBehavior.serializedZoomFactor(this.worldView, this.viewModel.zoomFactor),
                centerCoord: this.viewModel.viewportCenterCoord.objectForSerialization
            };
            this.game.ui.camera = camera;
            inj().session.autosave(); // TODO temporary
        }
    }
}
GameWorldView.planetCanvasIndex = 0;
GameWorldView.unitsCanvasIndex = 1;

export class CenterMapClickBehavior {
    canvasClicked(worldView, coord, eventModel) {
        worldView.centerOnCoord(coord, undefined, true);
    }
}

// Calculations and constraints for specific zooming use cases. All inputs and outputs are in device pixel units for use in TileProjection; outputs are always rounded to integer pixels. Entirely stateless, just represents a set of rules/algorithms.
export class ZoomBehavior {
    // Parameters all in DOM units
    constructor(a) {
        this.range = { min: a.range.min, defaultValue: a.range.defaultValue, max: a.range.max };
        this.stepMultiplier = a.stepMultiplier;
        this.edgeOverscroll = a.edgeOverscroll; // tile units
    }
    
    // Smallest zoom factor that fits world into viewport height
    heightFittingZoomFactor(worldView) {
        if (!worldView.viewModel) { return 1; }
        let tileHeight = worldView.viewModel.worldRect.height + (2 * this.edgeOverscroll);
        let viewportHeight = worldView.viewportScreenRect.height;
        return Math.round(viewportHeight / tileHeight);
    }
    
    defaultZoomFactor(worldView) {
        return this._clamp(worldView, this.range.defaultValue * worldView.devicePixelRatio);
    }
    
    deserializedZoomFactor(worldView, serialized) {
        if (isNaN(serialized)) {
            return this.defaultZoomFactor(worldView);
        } else {
            return this._clamp(worldView, UI.deviceLengthForDOMLength(serialized, worldView.devicePixelRatio));
        }
    }
    
    serializedZoomFactor(worldView, zoomFactor) {
        return zoomFactor / worldView.devicePixelRatio;
    }
    
    // Adjusts given zoomFactor to fit constraints of current viewport/config
    validatedZoomFactor(worldView, zoomFactor) {
        return this._clamp(worldView, zoomFactor);
    }
    
    // Target zoom factor single-step use cases, e.g a plus-button/key
    steppingIn(worldView, fromZoomFactor) {
        return this._clamp(worldView, fromZoomFactor * this.stepMultiplier);
    }
    
    // Target zoom factor single-step use cases, e.g a minus-button/key
    steppingOut(worldView, fromZoomFactor) {
        return this._clamp(worldView, fromZoomFactor / this.stepMultiplier);
    }
    
    _clamp(worldView, zoomFactor) {
        let min = Math.max(
            this.range.min * worldView.devicePixelRatio,
            this.heightFittingZoomFactor(worldView)
        );
        let max = Math.max(min, this.range.max * worldView.devicePixelRatio);
        return Math.clamp(Math.round(zoomFactor), { min: min, max: max });
    }
}

// Calculations and constraints for specific panning use cases. Produces device pixel unit results. Entirely stateless, just represents a set of rules/algorithms.
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
        let largePoints = this._viewportSizeInDirection(worldView, direction) * this.largePanScreenFraction;
        return Math.max(smallPoints, largePoints);
    }
    
    _viewportSizeInDirection(worldView, direction) {
        let size = worldView.viewportScreenRect.size;
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
    
    withRenderContext(index, frame, block) {
        let isOpaque = (index == 0);
        let ctx = this.canvases[index].getContext("2d", {alpha: !isOpaque});
        ctx.imageSmoothingEnabled = false;
        new CanvasRenderContext({
            ctx: ctx,
            isOpaque: isOpaque,
            devicePixelRatio: this.devicePixelRatio,
            viewModel: this.model,
            frame: frame,
            viewport: this.viewport
        }).withWorldOrigin(block);
    }
    
    resetCanvases() {
        this.canvases.forEach(canvas => {
            canvas.configureSize(this.elem, this.devicePixelRatio);
        });
    }
}

// Represents a virtual screen of device pixels for a game World. Maps zoom levels onto TileProjections, and determines pixel sizes and positions of rendered objects relative to the world model's origin. Stores viewportCenterCoord but doesn't use it: WorldViewModel treats the virtual screen's (0,0) origin as mapping always to the tile world's (0,0) origin.
export class GameWorldViewModel {
    static Kvo() { return {"zoomFactor": "zoomFactor", "viewportCenterCoord": "_viewportCenterCoord", "dirtyRect": "_dirtyRect" }; }
    
    constructor(world, zoomFactor, viewportCenterCoord) {
        this.world = world;
        this.projection = null; // set in .zoomFactor setter
        this._dirtyRect= world.planet.rect;
        this.kvo = new Gaming.Kvo(this);
        this.zoomFactor = zoomFactor;
        this._viewportCenterCoord = viewportCenterCoord || this.world.planet.rect.center;
    }
    
    // Zoom factor in device pixel units
    get zoomFactor() { return this.projection.factor; }
    set zoomFactor(value) {
        this.projection = new TileProjection(value);
        this.kvo.zoomFactor.notifyChanged();
    }
    
    // In world tile coordinates
    get viewportCenterCoord() { return this._viewportCenterCoord; }
    set viewportCenterCoord(value) {
        this._viewportCenterCoord = value;
        this.kvo.viewportCenterCoord.notifyChanged();
    }
    
    get dirtyRect() { return this._dirtyRect; }
    set dirtyRect(rect) {
        this._dirtyRect = rect;
        this.kvo.dirtyRect.notifyChanged(false);
    }
    addDirtyRect(rect) {
        if (rect) {
            this.dirtyRect = rect.union(this._dirtyRect);
        }
    }
    
    // viewportCenterCoord does not affect origin
    get worldRect() { return this.world.planet.rect; }
    
    // viewportCenterCoord does not affect origin
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

// Displays a WorldViewModel at a particular zoom factor and panning offset (device pixel units) within an HTML canvas at some instant in time. Callers manage any animation, etc.
export class WorldViewport {
    // Up on screen = negative Y offset. "South is up"
    static worldUnitVectorForScreenDirection(direction) {
        return Gaming.Vector.unitsByDirection[Gaming.directions.flippedY[direction]];
    }
    
    constructor(a) {
        this.metrics = inj().content.worldView;
        this.model = a.model; // WorldViewModel
        this.canvas = a.canvas;
    }
    
    // Assumes supplied zoomFactor is valid
    get zoomFactor() { return this.model.zoomFactor; }
    set zoomFactor(value) {
        this.model.zoomFactor = value;
        // Adjust center for edge overscroll as needed
        this.centerCoord = this.centerCoord;
    }
    
    // The world coordinate to draw at the center of the HTML canvas
    get centerCoord() { return this.model.viewportCenterCoord; }
    set centerCoord(value) {
        let canvasTileSize = this.model.projection.sizeForScreenSize(this.canvas);
        this.model.viewportCenterCoord = EdgeOverscroll.clampedCoord(value, this.model, canvasTileSize, this.metrics.edgeOverscroll);
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
    
    get viewportWorldRect() {
        let size = this.model.projection.sizeForScreenSize({width: this.canvas.width, height: this.canvas.height});
        return Rect.withCenter(this.centerCoord, size);
    }
}

// Manages animated updates to a WorldViewport's zoom level/center coord over time
export class ViewportController {
    constructor(a) {
        this.viewport = a.viewport;
    }
    
    // WorldViewModel
    get model() { return this.viewport.model; }
    
    // Retains center
    setZoomFactor(zoomFactor, animated) {
        this.viewport.zoomFactor = zoomFactor;
    }
    
    // Immediately jumps. Zoom factor optional
    centerOnCoord(coord, zoomFactor, animated) {
        if (typeof(zoomFactor) != 'undefined') {
            this.viewport.zoomFactor = zoomFactor;
        }
        this.viewport.centerCoord = coord;
    }
    
    // setVisibleRect(tileRect, padding) to calculate zoomFactor
    // appropriate to display all coordinates relevant to some event.
}

export class CanvasRenderContext {
    constructor(a) {
        this.ctx = a.ctx;
        this.isOpaque = a.isOpaque;
        this.viewModel = a.viewModel;
        this.frame = a.frame;
        this.devicePixelRatio = a.devicePixelRatio;
        this.viewportScreenRect = a.viewport.viewportScreenRect;
        
        if (this.viewModel.dirtyRect) {
            let dirtyScreen = this.viewModel.projection.screenRectForRect(this.viewModel.dirtyRect);
            this.dirtyScreenRect = this.viewportScreenRect.intersection(dirtyScreen);
        } else {
            this.dirtyScreenRect = null;
        }
    }
    
    withWorldOrigin(block) {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, -this.viewportScreenRect.x, -this.viewportScreenRect.y);
        block(this);
        this.ctx.restore();
    }
    
    deviceLengthForDOMLength(px) {
        return px * this.devicePixelRatio;
    }
    
    deviceSizeForDOMSize(size) {
        return { width: size.width * this.devicePixelRatio, height: size.height * this.devicePixelRatio };
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
