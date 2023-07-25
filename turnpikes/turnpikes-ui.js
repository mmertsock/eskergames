"use-strict";

import * as Gaming from '../g.js';
import { GameContent } from '../game-content.js';
import * as Engine from './turnpikes-engine.js';

Math.Radian = {
    /// Radians for 90° rotation CCW.
    ccw90: 1.5707963267948966
};

const _Protocols = {};

/// Top-level Views, each one is given control of an HTMLCanvasElement and assigned as an AnimationLoop delegate.
/// Layers do not own the provided ViewportLayer, etc.
_Protocols.Layer = class {
    didAttach(viewportLayer) { }
    willDetach(viewportLayer) { }
    /// Optional. If implemented, the layer will be assigned as an AnimationLoop delegate. Otherwise, layers should set up/tear down their own rendering in didAttach/willDetach.
    processFrame(frame) { }
};

/// Interactions are the top-level UI modalities of the app. The Viewport has a single active Interaction at all times.
class Interaction {
    #viewport; // Initially null, and null whenever it's detached.
    
    constructor() {
        this.#viewport = null;
    }
    
    // [Layer]: Ordered list of top-level views. First element is lowest in the z-stack, last element is highest.
    get layers() { return []; }
    
    get isAttached() {
        return this.#viewport != null;
    }
    
    get viewport() {
        return this.#viewport;
    }
    
    set viewport(newValue) {
        this.#viewport = newValue;
    }
}

class LoadingInteraction extends Interaction {
    #layer;
    
    constructor() {
        super();
        this.#layer = new LoadingLayer();
    }
    
    get layers() { return [this.#layer]; }
}

class LoadingLayer {
    didAttach(viewportLayer) {
        // Just render one time immediately.
        let config = viewportLayer.viewport.app.config.loadingLayer;
        let context = new RenderContext({ canvas: viewportLayer.canvas });
        let shape = Engine.Shape.fromConfig(config.message);
        context.clear(config.background.fillStyle);
        context.renderShape(shape);
    }
    willDetach(viewportLayer) { }
}

class ScenarioInteraction extends Interaction {
    #layers;
    
    constructor() {
        super();
        
        let scenario = Engine.Scenario.fromConfig("s1");
        let parcel = scenario.makeParcel();
        
        let testSeg = new Engine.Segment({
            id: "test-seg",
            path: Engine.YML.parsePath([
                0, 400, 10, 400, 19, 405, 28, 410, 36, 417, 45, 425, 50, 440, 55, 458, 57, 477, 57, 497, 56, 516
            ])
        });
        parcel.addNode(testSeg);
        
        this.#layers = [
            new ParcelLayer(parcel),
            new NetworkLayer(parcel)
        ];
    }
    
    get layers() { return this.#layers; }
}

/// For scenarios. The permanent structures and landscape of the parcel.
class ParcelLayer {
    #parcel; // &Parcel
    
    constructor(parcel) {
        this.#parcel = parcel;
    }
    
    didAttach(viewportLayer) {
        // One-time rendering.
        this.render(viewportLayer);
    }
    
    willDetach(viewportLayer) { }
    
    render(viewportLayer) {
        let context = new RenderContext({
            canvas: viewportLayer.canvas,
            flipY: false,
            debug: viewportLayer.viewport.app.config.viewport.debug
        });
        let view = new ParcelView(this.#parcel);
        view.render(context);
        view.deconstruct();
    }
}

/// For scenarios. The network and agents.
class NetworkLayer {
    #view; // NetworkView
    #viewportLayer; // &ViewportLayer
    
    constructor(parcel) {
        this.#view = new NetworkView(parcel);
        this.#viewportLayer = null;
    }
    
    didAttach(viewportLayer) {
        this.#viewportLayer = viewportLayer;
        this.#view.setNeedsRender();
    }
    
    willDetach(viewportLayer) {
        this.#viewportLayer = null;
    }
    
    // Active on the animation loop: network can change, and agents animate.
    processFrame(frame) {
        if (!this.#viewportLayer || !this.#view.needsRender) { return; }
        
        let context = new RenderContext({
            canvas: this.#viewportLayer.canvas,
            flipY: false,
            debug: this.#viewportLayer.viewport.app.config.viewport.debug
        });
        this.#view.render(context);
    }
}

class ViewportLayer {
    viewport;
    layer;
    canvas;
    
    constructor(viewport, layer) {
        this.viewport = viewport;
        this.layer = layer;
        this.canvas = document.createElement("canvas");
        this.canvas.configureSize(viewport.container, HTMLCanvasElement.getDevicePixelScale());
        viewport.container.append(this.canvas);
        
        this.layer.didAttach(this);
        if (typeof this.layer.processFrame == "function") {
            this.viewport.app.loop.addDelegate(this.layer);
        }
    }
    
    deconstruct() {
        if (typeof this.layer.processFrame == "function") {
            this.viewport.app.loop.removeDelegate(this.layer);
        }
        this.layer.willDetach(this);
        this.canvas.remove();
        this.viewport = null;
        this.layer = null;
    }
}

/// Single instance attaches to a well-known HTML element and lives for the life of the app.
class Viewport {
    #config;
    app; // TurnpikesApp
    container; // HTML element.
    #layers; // [ViewportLayer]
    
    constructor(app, interaction) {
        this.#config = app.config.viewport;
        this.app = app;
        this.container = document.querySelector("main");
        this.#layers = [];
        this.attach(interaction);
    }
    
    attach(interaction) {
        this.#layers.forEach(layer => layer.deconstruct());
        this.#layers = interaction.layers.map(layer => new ViewportLayer(this, layer));
    }
}

/// Tools for drawing. Should live only for the time period of a single rendering pass.
class RenderContext {
    canvas; // &HTMLCanvasElement
    ctx; // &CanvasRenderingContext2D
    flipY; // bool
    #yMinuend;
    debug; // dictionary
    
    constructor(a) {
        this.canvas = a.canvas;
        this.debug = Object.assign({
            showNodeBounds: false
        }, a.debug)
        this.ctx = this.canvas.getContext("2d");
        this.flipY = a.flipY || false;
        if (this.flipY) {
            this.#yMinuend = this.canvas.height - 1;
        } else {
            this.#yMinuend = 0;
        }
    }
    
    get visibleRect() {
        return new Gaming.Rect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    /// CanvasRenderingContext2D origin is top left.
    /// Model origin is bottom left if flipY = true.
    canvasY(modelY) {
        return this.flipY ? (this.#yMinuend - modelY) : modelY;
    }
    
    /// See `canvasY`.
    canvasPoint(modelPoint) {
        return this.flipY ? new Gaming.Point(modelPoint.x, this.#yMinuend - modelPoint.y) : modelPoint;
    }
    
    /// See `canvasY`.
    canvasRect(modelRect) {
        if (this.flipY) {
            return new Gaming.Rect(modelRect.x, this.#yMinuend - modelRect.y - modelRect.height, modelRect.width, modelRect.height);
        } else {
            return modelRect;
        }
    }
    
    push() {
    }
    
    pop() {
    }
    
    clear(color) {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    renderShape(shape) {
        if (!shape) { return; }
        shape.instructions.forEach(i => {
            switch (i) {
            case Engine.ShapeInstruction.fill:
                if (shape.path) {
                    this.makePath(shape.path, shape.closed);
                    this.ctx.fillStyle = shape.style.fillStyle;
                    this.ctx.fill();
                }
                break;
            case Engine.ShapeInstruction.stroke:
                if (shape.path) {
                    this.makePath(shape.path, shape.closed);
                    this.ctx.strokeStyle = shape.style.strokeStyle;
                    this.ctx.lineWidth = shape.style.lineWidth;
                    this.ctx.stroke();
                }
                break;
            case Engine.ShapeInstruction.text:
                if (!String.isEmpty(shape.text)) {
                    this.ctx.fillStyle = shape.style.textStyle;
                    this.ctx.font = shape.style.font;
                    let rect = shape.bounds.offsetBy(shape.textOffset);
                    this.ctx.fillTextCentered(shape.text, this.canvasRect(rect));
                    this.debugNodeBounds(rect, "orange");
                }
                break;
            }
        });
    }
    
    makePath(path, closed) {
        this.ctx.beginPath();
        this.ctx.moveTo(path[0].x, this.canvasY(path[0].y));
        for (let i = 1; i < path.length; i += 1) {
            this.ctx.lineTo(path[i].x, this.canvasY(path[i].y));
        }
        if (!!closed) {
            this.ctx.closePath();
        }
    }
    
    debugNodeBounds(bounds, strokeStyle) {
        if (!this.debug.showNodeBounds) { return; }
        if (!bounds) { return; }
        this.ctx.strokeStyle = strokeStyle;
        this.ctx.lineWidth = 1;
        this.ctx.rectStroke(this.canvasRect(bounds));
    }
}

/// Interface for UI objects that can draw themselves on a canvas. Implementations can choose whether or not to be long-lived.
/// Naming:
/// - SomeDrawable: short-lived, lightweight/no internal state, doesn't need explicit deconstruction. But ok to be long-lived.
/// - SomeView: long-lived, not shared, internal state, needs explicit deconstruction.
export class Drawable {
    /// Factory method to produce appropriate drawables for a Node.
    static forNode(node) {
        switch (node.constructor) {
        case Engine.Structure:
            return new StructureDrawable(node);
        case Engine.Segment:
            return new SegmentDrawable(node);
        default:
            return null;
        }
    }
    
    id; // unique string
    
    constructor(id) {
       this.id = id || Engine.UniqueID.make(); 
    }
    
    get debugDescription() {
        return this.constructor.name;
    }
    
    /// Subclasses can override the getter or set a private _drawOrder value.
    get drawOrder() { return this._drawOrder || DrawOrder.end; }
    
    // drawOrder; TODO: Drawable implements the sort-by-draw-order concept.
    
    /// Cleanup for long-lived drawables.
    deconstruct() { }
    
    /// Subclasses should override.
    /// context: &RenderContext.
    render(context) { }
}

export class DrawOrder {
    values; // array of some comparable type
    
    static end = new DrawOrder([9999, 9999, 9999]);
    
    constructor(values) {
        this.values = values;
    }
    
    drawsBefore(other) {
        if (this == DrawOrder.end) { return false; }
        if (other == DrawOrder.end) { return true; }
        let length = this.values.length < other.values.length ? this.values.length : other.values.length;
        for (let i = 0; i < length; i += 1) {
            if (this.values[i] != other.values[i]) {
                return this.values[i] < other.values[i];
            }
        }
        return false;
    }
    
    get debugDescription() {
        return `<DO [${this.values.join(" ")}]>`
    }
}

/// Maintains a list of Drawables sorted by their drawOrder.
/// Primary reference for object lifetime of Drawables: deconstructing an OrderedDrawableSet deconstructs its children.
export class OrderedDrawableSet {
    #drawables; // [Drawable]
    
    constructor() {
        this.#drawables = [];
    }
    
    deconstruct() {
        this.#drawables.forEach(drawable => drawable.deconstruct());
        this.#drawables.splice(0);
    }
    
    get isEmpty() { return this.#drawables.length == 0; }
    
    find(id) {
        return Engine.UniqueID.findInArray(id, this.#drawables);
    }
    
    insert(drawable) {
        let found = this.find(drawable.id);
        if (found) { return; }
        
        let drawOrder = drawable.drawOrder;
        let drawIndex = this.#drawables.findIndex(c => drawOrder.drawsBefore(c.drawOrder));
        if (drawIndex < 0) {
            // Draws after every other child.
            Gaming.debugLog(`Adding @end: ${drawable.debugDescription}`);
            this.#drawables.push(drawable);
        } else {
            Gaming.debugLog(`Adding @${drawIndex}: ${drawable.debugDescription}`);
            this.#drawables.insertItemAtIndex(drawable, drawIndex);
        }
    }
    
    remove(drawable) {
        let found = this.find(drawable.id);
        if (!found) { return; }
        this.#drawables.removeItemAtIndex(found.index);
    }
    
    forEach(block) {
        this.#drawables.forEach(block);
    }
}

/// Renders a snapshot of the current "permanent" elements of a Parcel: the surface, Structures, LandscapeFeatures, etc.
class ParcelView {
    static config; // YML data. Set once at app startup.
    
    static setConfig(a) {
        ParcelView.config = a;
    }
    
    #parcel; // &Parcel
    
    constructor(parcel) {
        this.#parcel = parcel;
    }
    
    deconstruct() { }
    
    render(context) {
        let drawables = new OrderedDrawableSet();
        this.#parcel
            .filterNodes(node => this.shouldContain(node))
            .map(node => Drawable.forNode(node))
            .forEach(drawable => {
                if (drawable) { drawables.insert(drawable); }
            });
        
        context.clear(ParcelView.config.surface.fillStyle);
        drawables.forEach(drawable => {
            drawable.render(context);
        });
    }
    
    shouldContain(node) {
        return (node.constructor == Engine.Structure)
            || (node.constructor == Engine.LandscapeFeature);
    }
}

/// Lifetime == Parcel lifetime. Subscribes to Parcel state changes and creates/manages all Drawables for objects within the Parcel.
class NetworkView extends Drawable {
    parcel; // &Parcel
    #children; // OrderedDrawableSet
    #dirty; // true if needs to redraw
    
    get debugDescription() {
        return `<NetworkView children#${this.#children.length}>`;
    }
    
    get needsRender() { return this.#dirty; }
    setNeedsRender() { this.#dirty = true; }
    
    constructor(parcel) {
        super("NetworkView");
        this.parcel = parcel;
        this.#children = new OrderedDrawableSet();
        this.#dirty = false;
        this.parcel.forEachNode(node => this.#addChild(node));
        
        // TODO: observers also mark NetworkView as dirty.
        this.parcel.kvo.addNode.addObserver(this, p => this.#addChild(p.kvo.addNode.value));
        this.parcel.kvo.removeNode.addObserver(this, p => this.#removeChild(p.kvo.removeNode.value));
        
        this.#dirty = false;
    }
    
    deconstruct() {
        Gaming.debugLog(`deconstruct: ${this.debugDescription}`);
        Gaming.Kvo.stopAllObservations(this);
        this.#children.deconstruct();
    }
    
    shouldContain(node) {
        return (node.constructor == Engine.Segment);
    }
    
    render(context) {
        if (!this.#dirty) { return; }
        this.#dirty = false;
        
        // TODO: move to a DebugLayer that renders the AnimationLoop's last total render time on-screen.
        let timer = new Gaming.PerfTimer("NetworkView.render").start();
        this.#children.forEach(drawable => {
            drawable.render(context);
        });
        Gaming.debugLog(timer.end().summary);
    }
    
    #addChild(node) {
        if (!this.shouldContain(node)) { return; }
        let drawable = Drawable.forNode(node);
        if (!drawable) { return; }
        this.#children.insert(drawable);
        this.setNeedsRender();
    }
    
    #removeChild(node) {
        // TODO: yeah
        // this.#children.remove();
    }
}

class StructureDrawable extends Drawable {
    node; // &Structure
    _drawOrder; // DrawOrder
    
    constructor(node) {
        super(node.id);
        this.node = node;
        this._drawOrder = new DrawOrder([
            node.shape?.height || 0,
            node.bounds.y,
            node.bounds.x
        ]);
    }
    
    get debugDescription() {
        return `StructureDrawable#${this.node.id}`;
    }
    
    render(context) {
        context.renderShape(this.node.shape);
        context.debugNodeBounds(this.node?.shape.bounds, "red");
    }
}

class SegmentDrawable extends Drawable {
    static config; // YML data. Set once at app startup.
    
    static setConfig(a) {
        SegmentDrawable.config = a;
    }
    
    node; // &Segment
    _drawOrder; // DrawOrder
    surfaceShape; // Shape: the full bed of the segment.
    shoulderShape; // Shape: right edge of the segment when RHD. Ordered in direction of travel.
    medianShape; // Shape: left edge of the segment when RHD. Ordered in direction of travel.
    
    constructor(node) {
        super(node.id);
        this.node = node;
        this.#buildRenderData();
        
        this._drawOrder = new DrawOrder([
            0, // TODO: this.level.elevation
            this.surfaceShape.bounds.y,
            this.surfaceShape.bounds.x
        ]);
    }
    
    /// Pre-calculate the rendered shape, edges, decoration, etc., based on the segment's centerline path.
    #buildRenderData() {
        let lPath = [];
        let rPath = [];
        
        for (let i = 0; i < this.node.path.length; i += 1) {
            // Mean longitudinal angle: derive from concatenating the incoming and outgoing path vectors.
            let center = this.node.path[i];
            let prev = (i > 0) ? this.node.path[i - 1] : center;
            let next = (i < this.node.path.length - 1) ? this.node.path[i + 1] : center;
            let longitudinal = Gaming.Vector.betweenPoints(next, prev);
            // Shoulder/median points: project 90° left/right from center point.
            let vLeft = Gaming.Vector.polar(SegmentDrawable.config.surface.halfWidth, longitudinal.theta + Math.Radian.ccw90);
            lPath.push(center.adding(vLeft).integral());
            rPath.push(center.adding(vLeft.scaled(-1)).integral());
        }
        
        // Use RHD/LHD config to map r/l paths to shoulder/median, and determine order of concatenation for the surface polygon.
        this.surfaceShape = new Engine.Shape({
            label: `surface-${this.node.id}`,
            height: 0, // TODO: get from this.level.elevation
            path: rPath.concat(lPath.toReversed()),
            closed: true,
            instructions: [Engine.ShapeInstruction.fill],
            style: SegmentDrawable.config.surface.style
        });
        this.shoulderShape = new Engine.Shape({
            label: `shoulder-${this.node.id}`,
            height: 0, // TODO
            path: rPath,
            closed: false,
            instructions: [Engine.ShapeInstruction.stroke],
            style: SegmentDrawable.config.shoulder.style
        });
        this.medianShape = new Engine.Shape({
            label: `median-${this.node.id}`,
            height: 0, // TODO
            path: lPath,
            closed: false,
            instructions: [Engine.ShapeInstruction.stroke],
            style: SegmentDrawable.config.median.style
        });
    }
    
    get debugDescription() {
        return `SegmentDrawable#${this.node.id}`;
    }
    
    render(context) {
        context.renderShape(this.surfaceShape);
        context.renderShape(this.shoulderShape);
        context.renderShape(this.medianShape);
        
        let startDot = Gaming.Rect.withCenter(this.node.path[0].x, this.node.path[0].y, 5, 5);
        context.debugNodeBounds(startDot, "black");
        
        // TODO:
        // - markers for endpoints (arrow) and stubs (barrier)
        // - depicting NetworkLevels
        context.debugNodeBounds(this.node.bounds, "black");
    }
}

class TurnpikesApp {
    /// TurnpikesApp singleton: lifetime == web page lifetime.
    static shared = null;
    static isProduction = false;
    
    config; // entire YAML config.
    loop; // AnimationLoop.
    viewport; // Viewport: lifetime == app lifetime.
    
    constructor(config) {
        this.config = config;
        Engine.Parcel.setConfig(config.parcel);
        Engine.Segment.setConfig(config.segment);
        Engine.Shape.setConfig(config.shapes);
        Engine.AgentType.setConfig(config.agentTypes);
        Engine.Scenario.setConfig(config.scenarios);
        ParcelView.setConfig(config.parcelView);
        SegmentDrawable.setConfig(config.segmentDrawable);
        
        this.loop = new Gaming.AnimationLoop(window);
        this.loop.resume();
        
        this.viewport = new Viewport(this, new ScenarioInteraction());
        // this.viewport = new Viewport(this, new LoadingInteraction());
        // 
        // setTimeout(() => {
        //     this.viewport.attach(new ScenarioInteraction())
        // }, 3000);
    }
}

export async function initialize() {
    let cachePolicy = TurnpikesApp.isProduction ? GameContent.cachePolicies.auto : GameContent.cachePolicies.forceOnFirstLoad;
    let config = await GameContent.loadYamlFromLocalFile(`./turnpikes.yml`, cachePolicy);
    TurnpikesApp.shared = new TurnpikesApp(config);
}
