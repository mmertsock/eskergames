"use-strict";

import * as Gaming from '../g.js';
import { GameContent } from '../game-content.js';
import * as Engine from './turnpikes-engine.js';

Math.Radian = {
    /// Radians for 90° rotation CCW.
    ccw90: 1.5707963267948966
};

class Viewport {
    canvas; // HTMLCanvasElement
    #config;
    
    constructor(app) {
        this.#config = app.config.viewport;
        this.canvas = document.createElement("canvas");
        let container = document.querySelector("main");
        this.canvas.configureSize(container, HTMLCanvasElement.getDevicePixelScale());
        container.append(this.canvas);
        
        this.testRender();
    }
    
    testRender() {
        // TODO: hmm we need a fixed world size for Parcels
        // so they always render the same regardless of dpi,
        // and so there are consistent coords.
        // And some parcels might look more "zoomed-in" than others maybe, if they're simpler?
        // So maybe the Parcel is some large number of world units, a fixed size for all devices, and it's rendered at some other scale independent of the canvas CSS size. Yeah.
        // But we want to render at high dpi when possible.
        let scenario = Engine.Scenario.fromConfig("s1");
        let parcel = scenario.makeParcel();
        
        let testSeg = new Engine.Segment({
            id: "test-seg",
            path: Engine.YML.parsePath([
                0, 400, 10, 400, 19, 405, 28, 410, 36, 417, 45, 425, 50, 440, 55, 458, 57, 477, 57, 497, 56, 516
            ])
        });
        parcel.addNode(testSeg);
        
        let context = new RenderContext({
            canvas: this.canvas,
            flipY: false,
            debug: this.#config.debug
        });
        let view = new ParcelView(parcel);
        view.render(context);
        view.deconstruct();
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
                    let rect = shape.bounds.offsetBy(shape.textOffset);
                    // TODO: textSize
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
class Drawable {
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

/// Lifetime == Parcel lifetime. Subscribes to Parcel state changes and creates/manages all Drawables for objects within the Parcel.
class ParcelView extends Drawable {
    static config; // YML data. Set once at app startup.
    
    static setConfig(a) {
        ParcelView.config = a;
    }
    
    parcel; // &Parcel
    #children; // [Drawable]: sorted by drawing order.
    
    get debugDescription() {
        return `<ParcelView children#${this.#children.length}>`;
    }
    
    constructor(parcel) {
        super();
        this.parcel = parcel;
        this.#children = [];
        this.parcel.forEachNode(node => this.#addChild(node));
        
        // TODO: observers also mark ParcelView as dirty.
        this.parcel.kvo.addNode.addObserver(this, p => this.#addChild(p.kvo.addNode.value));
        this.parcel.kvo.removeNode.addObserver(this, p => this.#removeChild(p.kvo.removeNode.value));
    }
    
    deconstruct() {
        Gaming.debugLog(`deconstruct: ${this.debugDescription}`);
        Gaming.Kvo.stopAllObservations(this);
        this.#children.forEach(drawable => drawable.deconstruct());
    }
    
    render(context) {
        let timer = new Gaming.PerfTimer("ParcelView.render").start();
        context.clear(ParcelView.config.surface.fillStyle);
        this.#children.forEach(drawable => {
            drawable.render(context);
        });
        Gaming.debugLog(timer.end().summary);
    }
    
    findChild(id) {
        return UniqueID.findInArray(id, this.#children);
    }
    
    #addChild(node) {
        let drawable = Drawable.forNode(node);
        if (!drawable) {
            Gaming.debugLog(`addChild: no drawable for ${node.debugDescription}`);
            return;
        }
        let drawOrder = drawable.drawOrder;
        let drawIndex = this.#children.findIndex(c => drawOrder.drawsBefore(c.drawOrder));
        if (drawIndex < 0) {
            // Draws after every other child.
            Gaming.debugLog(`Adding child @end: ${drawable.debugDescription}`);
            this.#children.push(drawable);
        } else {
            Gaming.debugLog(`Adding child @${drawIndex}: ${drawable.debugDescription}`);
            this.#children.insertItemAtIndex(drawable, drawIndex);
        }
    }
    
    #removeChild(node) {
        let result = this.findChild(node.id);
        if (!result) { return; }
        Gaming.debugLog(`Removing child: ${result.item.debugDescription}`);
        this.#children.removeItemAtIndex(result.index);
    }
}

class StructureDrawable extends Drawable {
    node; // &Structure
    _drawOrder; // DrawOrder
    
    constructor(node) {
        super();
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
        super();
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
        
        this.viewport = new Viewport(this);
    }
}

export async function initialize() {
    let cachePolicy = TurnpikesApp.isProduction ? GameContent.cachePolicies.auto : GameContent.cachePolicies.forceOnFirstLoad;
    let config = await GameContent.loadYamlFromLocalFile(`./turnpikes.yml`, cachePolicy);
    TurnpikesApp.shared = new TurnpikesApp(config);
}
