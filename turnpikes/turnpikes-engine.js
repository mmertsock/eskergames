"use-strict";

import * as Gaming from '../g.js';

export function debugDescription(obj) {
    let described = obj.debugDescription;
    if (typeof described == "undefined") {
        return JSON.stringify(obj);
    } else {
        return described;
    }
}

export class UniqueID {
    static make() { return URL.createObjectURL(new Blob([])).slice(-36); }
    
    static findInArray(id, array) {
        let index = array.findIndex(item => item.id == id);
        if (index < 0) { return null; }
        return {
            id: id,
            index: index,
            item: array[index]
        };
    }
}

/// Helpers for interpreting YML config objects.
export class YML {
    static isString(obj) {
        return typeof obj == "string";
    }
    
    static parsePoint(a) {
        if (!Array.isArray(a) || a.length != 2) { return null; }
        return new Gaming.Point(a[0], a[1]);
    }
    
    static parsePath(a) {
        if (!Array.isArray(a) || a.length == 0) { return []; }
        if (Array.isArray(a[0])) {
            // [[x1, y1], [x2, y2], ...]
            return a.map(p => new Gaming.Point(p[0], p[1]));
        } else {
            // [x1, y1, x2, y2, ...]
            let path = [];
            for (let i = 0; i < a.length - 1; i += 2) {
                path.push(new Gaming.Point(a[i], a[i + 1]));
            }
            return path;
        }
    }
}

export class NetworkLevel {
    // Update YML config also.
    static ground = new NetworkLevel(0, 0, "ground");
    static overpass1 = new NetworkLevel(1, 4, "overpass");
    static overpass2 = new NetworkLevel(2, 8, "high overpass");
    
    static withIndex(index) {
        return NetworkLevel.all[index];
    }
    
    index; // int: zero-based
    elevation; // double: meters
    label; // string
    
    constructor(index, elevation, label) {
        this.index = index;
        this.elevation = elevation;
        this.label = label;
    }
    
    get debugDescription() {
        return this.label;
    }
}
NetworkLevel.all = [NetworkLevel.ground, NetworkLevel.overpass1, NetworkLevel.overpass2];

export class Parcel {
    static Kvo() { return {addNode: "_addNode", removeNode: "_removeNode"}; }
    
    static config; // YML data. Set once at app startup.
    
    static setConfig(a) {
        Parcel.config = a;
    }
    
    static standardSize() {
        return { width: Parcel.config.width, height: Parcel.config.height };
    }
    
    size; // {width:, height:}: meters.
    network; // Network
    #nodes; // [Node]
    
    constructor(size) {
        this.size = size;
        this.#nodes = [];
        this.network = new Network(this);
        this.kvo = new Gaming.Kvo(this);
    }
    
    deconstruct() {
        this.network.deconstruct();
        this.network = null;
    }

    /// Creating a Node object instance does not immediately add it to a Parcel. It's just an object floating in space. Note this is useful for e.g. proposed Segments. Call `addNode` when it's time to commit a node to the Parcel.
    /// parcel.kvo.addNode.value == the Node just added via the addNode call
    addNode(node) {
        if (node.parcel == this) { return; }
        if (node.parcel) {
            node.parcel.removeNode(node);
        }
        this.#nodes.push(node);
        node.parcel = this;
        this.kvo.addNode.setValue(node);
    }
    
    // TODO: also allow removing by ID?
    /// parcel.kvo.removeNode.value == the Node just removed via the removeNode call
    removeNode(node) {
        if (node.parcel != this) { return; }
        let result = this.findNode(node.id);
        if (!result) { return; }
        result.item.parcel = null;
        this.#nodes.removeItemAtIndex(result.index);
        this.kvo.removeNode.setValue(result.item);
    }
    
    /// Searches for a node by ID.
    findNode(id) {
        return UniqueID.findInArray(id, this.#nodes);
    }
    
    /// Returns an array copy of all nodes that match the filter callback.
    filterNodes(block) {
        return this.#nodes.filter(block);
    }
    
    /// Simple forEach-style iterator.
    forEachNode(block) {
        this.#nodes.forEach(block);
    }
    
    /// Finds all Nodes that declare that they intersect a given coord within a tolerance.
    /// Returns: [Node] that intersect.
    findNodesIntersectingPoint(coord, radius) {
        return this.#nodes.filter(node => node.intersectsPoint(coord, radius));
    }
}

export class Network {
    parcel; // unowned &Parcel
    
    constructor(parcel) {
        this.parcel = parcel;
    }
    
    deconstruct() {
        this.parcel = null;
    }
}

export class NetworkBuilder {
    static config;
    
    static setConfig(a) {
        NetworkBuilder.config = a;
    }
    
    #partialSegment; // nullable, unowned &Segment in the Parcel's node collection.
    #network; // unowned &Network;
    
    constructor(network) {
        this.#network = network;
        this.#partialSegment = null;
    }
    
    deconstruct() {
        this.#network = null;
        this.#partialSegment = null;
    }
    
    get partialSegment() { return this.#partialSegment; }
    
    /// Attempts starting or extending a Segment at the given coordinate. May create or modify one or more Segments/Junctions in the Parcel in addition to creating or modifying `partialSegment`. UI should always redraw the partialSegment after tryBuild(), in addition to KVO-observing the rest of the Parcel for changes.
    /// Returns: TBD
    tryBuild(coord) {
        if (!this.#partialSegment) {
            this.#startNewPartial(coord);
        } else {
            this.#partialSegment.path.push(coord);
        }
    }
    
    commit() {
        if (!this.#partialSegment) { return; }
        if (this.#partialSegment.path.length < 2) {
            return this.abort();
        }
        
        let end = Junction.segmentEnd(this.#partialSegment);
        this.#network.parcel.addNode(end);
        this.#partialSegment.isPartial = false;
        this.#partialSegment = null;
    }
    
    abort() {
        if (!this.#partialSegment) { return; }
        this.#network.parcel.removeNode(this.#partialSegment);
        this.#partialSegment = null;
    }
    
    #startNewPartial(coord) {
        this.#partialSegment = Segment.newPartial(coord);
        let start = Junction.segmentStart(this.#partialSegment);
        this.#network.parcel.addNode(this.#partialSegment);
        this.#network.parcel.addNode(start);
    }
}

/// Any permanent object with a fixed physical location in a Parcel.
export class Node {
    id; // unique string
    coord; // Gaming.Point
    shape; // Shape, default null. Override value in subclass init as needed.
    #parcel; // &Parcel: Initially null until added to a Parcel.
    
    constructor(a) {
        this.id = a.id || UniqueID.make();
        this.coord = a.coord;
        this.shape = a.shape;
        this.#parcel = null;
    }
    
    // Override all of the following in subclasses as appropriate.
    
    get debugDescription() {
        if (this.shape) {
            return `<${this.constructor.name}#${this.id} @${this.coord.debugDescription} $${debugDescription(this.shape)}>`;
        } else {
            return `<${this.constructor.name}#${this.id} @${this.coord.debugDescription}>`;
        }
    }
    
    get parcel() { return this.#parcel; }
    
    set parcel(newValue) {
        let oldValue = this.#parcel;
        this.#parcel = newValue;
        this.didSetParcel(this.#parcel, oldValue);
    }
    
    /// Rect
    get bounds() {
        return this.shape ? this.shape.bounds : new Gaming.Rect(this.coord.x, this.coord.y, 1, 1);
    }
    
    // Override in subclasses to react to parcel changes.
    didSetParcel(newValue, oldValue) { }
    
    intersectsPoint(coord, radius) {
        if (this.shape) {
            return this.shape.intersectsPoint(coord, radius);
        } else if (this.coord) {
            return Gaming.Vector.betweenPoints(this.coord, coord).magnitude <= radius;
        } else {
            return false;
        }
    }
    
    blocksNetworks(level) {
        return false;
    }
}

/// Buildings, trees, etc.
export class Structure extends Node {
    /// Construct from a raw config YML object.
    /// spec: dictionary.
    static fromConfig(spec) {
        return new Structure({
            id: spec.id,
            coord: YML.parsePoint(spec.coord),
            shapeSpec: Shape.fromConfig(spec.shape)
        });
    }
    
    constructor(a) {
        super(a);
        this.shape = a.shapeSpec?.withOrigin(this.coord);
    }
    
    blocksNetworks(level) {
        return this.shape.height >= level.elevation;
    }
}

/// Water bodies, etc.
export class LandscapeFeature extends Node {
    #blocksNetworks;
     
    constructor(a) {
        super(a);
        this.#blocksNetworks = a.blocksNetworks;
        this.shape = a.shapeSpec.withOrigin(this.coord);
    }
    
    // TODO: probably not useful to just check against a level in general. Instead, needs to check against specific location: blocksSegment(proposedSegment)
    blocksNetworks(level) {
        return this.#blocksNetworks && (this.shape.height >= level.elevation);
    }
}

/// Immutable when a member of a Parcel. Mutable otherwise for attaching Junctions, etc.
/// First and last coords of `path` == coords of start/end junctions. Segment's `Node.coord` == `start`.
/// Null `start` or `end`: segment is incomplete, unusable. Render with construction barriers on the ends.
/// Null `parcel`: segment is being drawn, not committed yet, render specially.
export class Segment extends Node {
    static config; // YML data. Set once at app startup.
    
    static setConfig(config) {
        Segment.config = config;
    }
    
    /// Factory method: makes a segment with a two-point `path` from a start point or to an end point at a given angle. Uses `angle` to calculate the other end of the `path`, rounded to the nearest integer. Segment's `start`/`end` junctions are not set, set these later as appropriate.
    /// startCoord/endCoord: Point: Exactly one should be non-null. Determines the Segment's `coord`.
    /// angle: degrees.
    static stub(id, startCoord, endCoord, angle) {
        let path = null;
        let radians = Gaming.Vector.degreesToRadians(angle);
        let vector = Gaming.Vector.polar(Segment.config.stub.length, radians);
        if (startCoord) {
            path = [startCoord, startCoord.adding(vector).integral()];
        } else {
            path = [endCoord.adding(vector.scaled(-1)).integral(), endCoord];
        }
        return new Segment({
            id: id,
            coord: startCoord || endCoord,
            path: path
        });
    }
    
    static newPartial(coord) {
        return new Segment({
            coord: new Gaming.Point(coord),
            path: [coord],
            start: null,
            end: null,
            isPartial: true
        });
    }
    
    /// [Point]: centerline of the network segment, in order of travel.
    path;
    start; // &Junction
    end; // &Junction
    isPartial; // bool
    #bounds; // Rect
    
    // TODO: the name "isPartial" may end up being ambiguous/overloaded, when we look at route building and the concept of traversable segments (part of a complete path between endpoints, vs dead ends).
    
    constructor(a) {
        super(a);
        this.path = a.path;
        this.start = a.start || null;
        this.end = a.end || null;
        this.isPartial = !!a.isPartial;
        // TODO: add an outset parameter to boundsOfPolygon, which is Segment.config.thickness or whatever.
        this.#bounds = Shape.boundsOfPolygon(this.path);
    }
    
    deconstruct() {
        this.start = null;
        this.end = null;
    }
    
    get bounds() { return this.#bounds; }
    
    get debugDescription() {
        let start = this.start?.debugDescription || "X";
        let end = this.end?.debugDescription || "X";
        let label = this.isPartial ? "PSeg" : "Seg";
        return `<${label}#${this.id} ${start}-${this.path.length}-${end}>`;
    }
    
    intersectsPoint(coord, radius) {
        // TODO: consider each point along the path plus each line segment between points, with a given thickness parameter.
        // TODO: maybe make this generic?
        return false;
    }
    
    /// Ramps can only be made on points in existing segments.
    /// Creates a new collection of segments/junctions, and `this` segment is no longer usable.
    /// Eh probably move this to Parcel? Or: a Network class that is the abstract network graph and all the related logic, lives at the same level as Parcel.
    ramp(point) { }
}

class HitTestable {
    // Note: no radius param. The radius concept is owned by the HitTestable itself.
    intersectsPoint(coord) { return false; }
    intersectsOther(hitTestable) { return false; }
}
class CompositeHitTest extends HitTestable {
    #elements; // [HitTestable]
    constructor(elements) {
        this.#elements = elements;
    }
    intersectsPoint(coord) {
        let found = this.#elements.find(elem => elem.intersectsPoint(coord));
        return !!found;
    }
    intersectsOther(hitTestable) {
        let found = this.#elements.find(elem => elem.intersectsOther(hitTestable));
        return !!found;
    }
}

/// Test along the line segments of the path with padding along each segment.
class PathHitTest extends HitTestable {
    #path; // [Point]
    #padding; // double. Distance from centerline for each line segment. Also determines circular radius of each point along the segment to test.
    constructor(path, padding) {
        this.#path = path;
        this.#padding = padding;
    }
    // Look up algorithm: distance from point to line.
    // Something to do with the y = mx + b equation.
    // But, would be distance from point to line *segment*.
    // https://stackoverflow.com/a/6853926/795339
    // https://stackoverflow.com/a/27737081/795339
    intersectsPoint(coord) {
        // First, check if this.#lazyCalculatedBoundsOutsetByPadding.containsPoint(coord) to see if it's a candidate before doing N more expensive calculations.
        // That could be quite coarse for a long or diagonal path (big bounding box). Could instead lazy-build one bounding box for every k consecutive points in the path, and then make a CompositeHitTest-of-RectHitTest for those bounding boxes, and test that first.
        // Then if that passes, do the line segment algorithm. For that, could be a CompositeHitTest of N-1 LineSegmentHitTests and N CircularHitTests.
        // (Or actually the LineSegment algorithm might automatically handle a circular region at each endpoint of the line segment, eliminating the need for the CircularHitTests).
        if (!this.boundingBoxHitTest.intersectsPoint(coord)) {
            return false;
        }
        // TODO: degenerate case: single-element path. In that case, whole thing devolves to a CircularHitTest on the single point. Could just set #lineSegmentsHitTest = CircularHitTest instead of = CompositeHitTest, then the code here doesn't change at all.
        // TODO: edge case: closed paths, instead of open paths. Add an extra line segment at the end.
        return this.#lineSegmentsHitTest.intersectsPoint(coord);
    }
    
    get boundingBoxHitTest() {
        if (!this.#boundingBoxHitTest) {
            
        }
        return this.#boundingBoxHitTest;
    }
}

class RectHitTest extends HitTestable {
    #rect; // Gaming.Rect
    constructor(rect) {
        this.#rect = rect;
    }
    intersectsPoint(coord) {
        return this.#rect.containsPoint(coord);
    }
}
class CircularHitTest extends HitTestable {
    #coord; // Gaming.Point
    #radius;
    constructor(coord, radius) {
        this.#coord = coord;
        this.#radius = radius;
    }
    intersectsPoint(coord) {
        return Gaming.Vector.betweenPoints(this.#coord, coord).magnitude <= this.#radius;
    }
}

/// Immutable.
export class Junction extends Node {
    /// Returns a Junction with one inbound or one outbound Segment. Caller must add both the Junction and the referenced Segment to a Parcel.
    /// The only junctions built from YML are endpoints.
    /// spec.id: string, required.
    /// spec.start/end: [x, y] point: specify one or the other. Determines the Junction's `coord`.
    /// spec.angle: degrees.
    /// spec.level: NetworkLevel index.
    /// spec.timeline: TODO
    static endpointFromConfig(spec) {
        let level = NetworkLevel.withIndex(spec.hasOwnProperty("level") ? spec.level : 0);
        let start = YML.parsePoint(spec.start);
        let end = start ? null : YML.parsePoint(spec.end);
        let segment = Segment.stub(`seg-end-${spec.id}`, start, end, spec.angle);
        let timeline = Array.isArray(spec.timeline) ? spec.timeline.map(t => Pulse.fromConfig(t)) : [];
        if (start) {
            return new Junction({
                id: spec.id,
                coord: start,
                level: level,
                entering: [],
                leaving: [segment],
                timeline: timeline
            });
        } else {
            return new Junction({
                id: spec.id,
                coord: end,
                level: level,
                entering: [segment],
                leaving: [],
                timeline: timeline
            });
        }
    }
    
    static segmentStart(segment) {
        return new Junction({
            coord: segment.coord,
            level: NetworkLevel.ground,
            entering: [],
            leaving: [segment],
            timeline: []
        });
    }
    
    static segmentEnd(segment) {
        let coord = segment.path[segment.path.length - 1];
        return new Junction({
            coord: coord,
            level: NetworkLevel.ground,
            entering: [segment],
            leaving: [],
            timeline: []
        });
    }
    
    static splittingSegment(segment, hitTestMatch) {
    }
    
    level; // &NetworkLevel
    entering; // [&Segment]
    leaving; // [&Segment]
    timeline; // [Pulse]: non-empty if a source of traffic.
    
    /// Sets the `start` or `end` property of Segments in `entering` and `leaving` arrays.
    constructor(a) {
        super(a);
        this.level = a.level;
        this.entering = a.entering;
        this.leaving = a.leaving;
        this.timeline = a.timeline;
        this.entering.forEach(node => { node.end = this; });
        this.leaving.forEach(node => { node.start = this; });
    }
    
    deconstruct() {
        this.entering = [];
        this.leaving = [];
    }
    
    get debugDescription() {
        return `<Jcn#${this.id} @${this.coord.debugDescription}^${this.level.debugDescription} ${this.entering.length}>>${this.leaving.length}*${this.timeline.length}>`;
    }
}

/// Enum.
export const ShapeInstruction = {
    fill: "fill",
    stroke: "stroke",
    text: "text"
};

/// An immutable spec for a drawable shape set at a location in a Parcel.
/// Specs should be defined with generic path relative to (0,0). Use methods on Shape to produce copies with offsets or other modifications for placement at specific locations.
export class Shape {
    static config; // YML data. Set once at app startup.
    
    static setConfig(a) {
        Shape.config = a;
    }
    
    // Undefined for empty polygons.
    static boundsOfPolygon(polygon) {
        if (polygon.length == 0) {
            return new Gaming.Rect();
        }
        let first = polygon[0];
        let ext = {
            min: { x: first.x, y: first.y },
            max: { x: first.x, y: first.y }
        };
        for (let i = 1; i < polygon.length; i += 1) {
            let p = polygon[i];
            if (p.x < ext.min.x) { ext.min.x = p.x; }
            if (p.y < ext.min.y) { ext.min.y = p.y; }
            if (p.x > ext.max.x) { ext.max.x = p.x; }
            if (p.y > ext.max.y) { ext.max.y = p.y; }
        }
        return Gaming.Rect.fromExtremes(ext);
    }
    
    /// Construct from a raw config YML object.
    /// spec as string: label to search for in Shape.config.
    /// spec as dictionary: inline spec values.
    static fromConfig(spec) {
        let label = spec?.label;
        if (YML.isString(spec)) {
            label = spec;
            spec = Shape.config.find(s => s.label == label);
        }
        if (!spec) { return null; }
        
        if (spec.hasOwnProperty("basis") && spec.basis != label) {
            let shape = Shape.fromConfig(spec.basis);
            if (!shape) { return null; }
            shape = shape.customized(s => {
                if (spec.hasOwnProperty("label")) {
                    s.label = spec.label;
                } else {
                    s.label = `${s.label}-${UniqueID.make()}`;
                }
                if (spec.hasOwnProperty("height")) { s.height = spec.height; }
                if (spec.hasOwnProperty("closed")) { s.closed = !!spec.closed; }
                if (spec.hasOwnProperty("instructions")) { s.instructions = spec.instructions; }
                if (spec.hasOwnProperty("textOffset")) { s.textOffset = YML.parsePoint(spec.textOffset); }
                if (spec.hasOwnProperty("text")) { s.text = spec.text; }
                s.style = Object.assign(s.style, spec.style);
            });
            if (spec.scaled) {
                shape = shape.scaled(spec.scaled);
            }
            return shape;
        }
        
        return new Shape(spec, true);
    }
    
    label; // string: for internal use.
    height; // double: tallness, in meters
    path; // [Point]: counterclockwise coordinate list, in absolute Parcel coordinates.
    closed; // bool: whether it's a closed polygon or open path. Default true.
    instructions; // [string]: ordered list of ShapeInstruction values
    textOffset; // Point: relative to the shape's origin. Default = 0,0. Text is drawn centered within the shape's bounds. Offset by a non-zero vector to shift this.
    text; // string: default null.
    style; // dictionary: canvas2d style parameters
    #bounds; // Rect: lazy value.
    
    constructor(a, isYML) {
        this.label = a.label || UniqueID.make();
        this.height = a.height;
        if (isYML) {
            this.path = YML.parsePath(a.path);
        } else {
            this.path = a.path;
        }
        this.closed = a.hasOwnProperty("closed") ? !!a.closed : true;
        this.instructions = Array.isArray(a.instructions) ? a.instructions : [ShapeInstruction.fill];
        this.textOffset = (isYML ? YML.parsePoint(a.textOffset) : a.textOffset) || new Gaming.Point(0, 0);
        this.text = a.text || null;
        this.style = Object.assign({}, a.style);
        this.#bounds = null;
    }
    
    /// The largest rectangle that visually contains the Shape within the Parcel.
    get bounds() {
        // One-time lazy calculation of bounds based on path.
        if (!this.#bounds) {
            this.#bounds = Shape.boundsOfPolygon(this.path);
        }
        return this.#bounds;
    }
    
    get debugDescription() {
        return `<Shape:${this.label} [${this.bounds.debugDescription}] path#${this.path.length}>`;
    }
    
    intersectsPoint(coord, radius) {
        return this.bounds.intersects(Gaming.Rect.withCenter(coord.x, coord.y, radius, radius));
    }
    
    intersectsSegment(proposedSegment) {
        // Advanced alternative: check the segment angle, concave polygons, etc.
        // Though for weird shapes like lakes with islands, could simplify that by overlaying 
        // multiple simple convex shapes.
        return this.bounds.intersects(proposedSegment.bounds);
    }
    
    // Producing modified copies of Shapes.
    // chained = true if no need to copy (multiple modifiers chained together).
    
    #prepareCopy(chained) {
        if (chained === true) {
           return this;
        } else {
            return new Shape({
                label: this.label,
                height: this.height,
                path: this.path.map(coord => new Gaming.Point(coord)),
                closed: this.closed,
                instructions: Array.from(this.instructions),
                textOffset: new Gaming.Point(this.textOffset),
                text: this.text,
                style: Object.assign({}, this.style)
            });
        }
    }
    
    /// Creates a copy of self with path offset by `origin`.
    withOrigin(origin, chained) {
        let other = this.#prepareCopy(chained);
        other.path = other.path.map(coord => coord.adding(origin));
        return other;
    }
    
    /// Creates a copy of self with path scaled by a multiplier.
    scaled(factor, chained) {
        let other = this.#prepareCopy(chained);
        other.path = other.path.map(coord => coord.scaled(factor));
        other.textOffset = other.textOffset.scaled(factor);
        return other;
    }
    
    /// Creates a copy of self with arbitrary modifications.
    /// block: (copied Shape) => void
    customized(block, chained) {
        let other = this.#prepareCopy(chained);
        block(other);
        return other;
    }
}

/// Defines a production of `count` instances of agents over `duration`. Immutable.
export class Pulse {
    /// Construct from a raw config YML object.
    /// spec: dictionary.
    static fromConfig(spec) {
        let pattern = Array.isArray(spec.pattern) ? spec.pattern.map(id => AgentType.withID(id)) : [];
        return new Pulse({
            count: spec.count,
            duration: spec.duration,
            destinationID: spec.destination || null,
            pattern: pattern
        });
    }
    
    count; // int: can be zero, in which case everything but `duration` is N/A.
    duration; // double: seconds. Or: int milliseconds?
    destinationID; // string: endpoint Junction ID
    pattern; // [&AgentType]: iterates circularly through this to generate Agents of one or more types.
    
    get isRest() { return this.count == 0; }
    
    constructor(a) {
        this.count = a.count;
        this.duration = a.duration;
        this.destinationID = a.destinationID;
        this.pattern = a.pattern;
    }
    
    /// Produces an array with `count` references of this Pulse, to generate a repeating pattern of activity.
    repeating(count) {
        return Array(count).fill(this);
    }
    
    get debugDescription() {
        if (this.count > 0) {
            let patternDescription = this.pattern.map(item => item.id).join(" ");
            return `<#${this.count}@${this.duration} > ${this.destinationID} [${patternDescription}]>`;
        } else {
            return `<#${this.count}@${this.duration}>`
        }
    }
}

/// Description and rules for types of Agents. Immutable.
export class AgentType {
    static all; // {id: AgentType}: All known types are set once at app startup.
    
    static setConfig(a) {
        AgentType.all = {};
        a.forEach(spec => {
            let type = new AgentType(spec, true);
            AgentType.all[type.id] = type;
        });
    }
    
    static withID(id) {
        return AgentType.all[id] || null;
    }
    
    id; // string: unique ID
    // rules for speed and stuff
    
    constructor(a) {
        this.id = a.id;
    }
}

/// An individual vehicle, etc., that moves itself around during simulation or otherwise affect simulation.
export class Agent {
    type; // &AgentType
    destination; // &Junction: Not an ID because by the time we instantiate an Agent, we should have access to look up the Junction. i.e. the Agent's lifespan is a subset of the Junction's lifespan.
    // TODO: location info: coordinate, velocity vector, and what Segment it's on.
}

/// The spec for a "level".
export class Scenario {
    static config; // YML data. Set once at app startup.
    
    static setConfig(a) {
        Scenario.config = a;
    }
    
    /// Construct from a raw config YML object.
    static fromConfig(id) {
        let spec = Scenario.config.find(s => s.id == id);
        if (!spec) { return null; }
        return new Scenario(spec, true);
    }
    
    id; // string: Unique ID.
    name; // string: User-visible title for this scenario.
    structures; // [Structure]
    
    constructor(a, isYML) {
        this.id = a.id || UniqueID.make();
        this.name = a.name;
        this.structures = (isYML ? a.structures.map(Structure.fromConfig) : a.structures) || [];
        this.endpoints = (isYML ? a.endpoints.map(Junction.endpointFromConfig) : a.endpoints) || [];
    }
    
    get debugDescription() {
        return `<Scenario#${this.id}:'${this.name}'>`;
    }
    
    makeParcel() {
        let parcel = new Parcel(Parcel.standardSize());
        this.structures.forEach(node => parcel.addNode(node));
        this.endpoints.forEach(junction => {
            parcel.addNode(junction);
            junction.entering.forEach(node => parcel.addNode(node));
            junction.leaving.forEach(node => parcel.addNode(node));
        });
        return parcel;
    }
}

/// A specific play session for a given Scenario.
export class Session {
    scenario;
    
    constructor(scenario) {
        this.scenario = scenario;
    }
    
    get debugDescription() {
        return `<Session ${this.scenario.debugDescription}>`;
    }
}
