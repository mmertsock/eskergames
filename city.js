"use-strict";

window.CitySim = (function() {

var debugLog = Gaming.debugLog;
var once = Gaming.once;
var Rect = Gaming.Rect;
var Point = Gaming.Point;
var SelectableList = Gaming.SelectableList;
var FlexCanvasGrid = Gaming.FlexCanvasGrid;
var GameContent = CitySimContent.GameContent;
var GameScriptEngine = CitySimContent.GameScriptEngine;

Rect.prototype.containsTile = function(point) {
    return point.x >= this.x
        && point.y <= this.y
        && point.x < (this.x + this.width)
        && point.y < (this.y + this.height);
};

// ########################### GLOBAL #######################

var _stringTemplateRegexes = {};
var _zeroToOne = { min: 0, max: 1 };

String.fromTemplate = function(template, data) {
    if (!template || !data || template.indexOf("<") < 0) { return template; }
    Object.getOwnPropertyNames(data).forEach((pn) => {
        if (!_stringTemplateRegexes[pn]) {
            _stringTemplateRegexes[pn] = new RegExp(`<${pn}>`, "g");
        }
        template = template.replace(_stringTemplateRegexes[pn], data[pn]);
    });
    return template;
};

EventTarget.prototype.addGameCommandEventListener = function(eventType, preventDefault, command, subject) {
    this.addEventListener(eventType, (evt) => {
        if (preventDefault) { evt.preventDefault(); }
        if (!GameScriptEngine.shared) { return; }
        GameScriptEngine.shared.execute(command, subject);
    });
};

// ########################### MODELS #######################

// Zone type IDs
var Z = {
    R: "R", C: "C", I: "I"
};

var Simoleon = {
    symbol: "§",
    format: function(value) {
        return `§${Number.uiInteger(value)}`;
    }
};

Number.uiInteger = function(value) {
    return Number(value).toLocaleString();
};

class SimDate {
    constructor(y, m, d) {
        if (typeof m === 'undefined') {
            // new SimDate(daysSinceEpoch)
            this.value = y;
        } else {
            // new SimDate(year, month, day)
            y = y - SimDate.epochYear;
            this.value = (y * SimDate.daysPerYear) + ((m-1) * SimDate.daysPerMonth) + (d-1);
        }
    }
    get daysSinceEpoch() {
        return this.value;
    }
    get year() {
        return SimDate.epochYear + Math.floor(this.value/SimDate.daysPerYear);
    }
    get month() {
        var daysSinceJan1 = this.value % SimDate.daysPerYear;
        return 1 + Math.floor(daysSinceJan1/SimDate.daysPerMonth);
    }
    get day() {
        return 1 + this.value % SimDate.daysPerMonth;
    }

    adding(interval) {
        return new SimDate(this.value + interval);
    }

    longString() {
        var uiMonth = GameContent.shared.simDate.longMonthStrings[this.month];
        return `${uiMonth} ${this.day}, ${this.year}`;
    }
}
SimDate.daysPerMonth = 30;
SimDate.daysPerYear = 360;
SimDate.monthsPerYear = 12;
SimDate.epochYear = 1900;
SimDate.epoch = new SimDate(0);

class ZoomSelector {
    constructor(value, delegate) {
        this.value = value;
        this.delegate = delegate;
        this._selected = value.isDefault == true;
    }
    get isSelected() { return this._selected; }
    setSelected(value) {
        var fire = value && !this._selected;
        this._selected = value;
        if (fire) { this.delegate.zoomLevelActivated(this.value); }
    }
}

class SpeedSelector {
    constructor(value, delegate) {
        this.value = value;
        this.delegate = delegate;
        this._selected = value.isDefault == true;
    }
    get isSelected() { return this._selected; }
    setSelected(value) {
        var fire = value && !this._selected;
        this._selected = value;
        if (fire) { this.delegate.gameSpeedActivated(this.value); }
    }
}

class RCIValue {
    constructor(r, c, i) {
        this.R = (typeof r === 'undefined') ? 0 : r;
        this.C = (typeof c === 'undefined') ? 0 : c;
        this.I = (typeof i === 'undefined') ? 0 : i;
    }

    adding(other) {
        return new RCIValue(this.R + other.R, this.C + other.C, this.I + other.I);
    }
}

class Zone {
    constructor(config) {
        this.type = config.type; // <Z>
        this.densityLevel = 0; // Int; see Zone.config.maxDensityLevel
        this.valueLevel = 0; // Int; see Zone.config.maxValueLevel
    }

    get population() {
        return new RCIValue(0, 0, 0);
    }

    get settings() {
        return Zone.typeSettings(this.type);
    }

    get name() {
        return this.settings.genericName;
    }
}

Zone.settings = function() {
    return GameContent.shared.zones;
}
// <Z> -> JSON
Zone.typeSettings = function(zoneType) {
    return GameContent.shared.zones[zoneType];
}

Zone.newPlot = function(config) {
    var zone = new Zone({ type: config.type });
    var plot = new Plot({
        bounds: new Rect(config.topLeft, Zone.typeSettings(config.type).plotSize),
        item: zone
    });
    return plot;
};

class TerrainProp {
    constructor(config) {
        this.type = config.type;
    }

    get settings() {
        return TerrainProp.typeSettings(this.type);
    }

    get name() {
        return this.settings.genericName;
    }
}
TerrainProp.settings = function() {
    return GameContent.shared.terrainProps;
}
TerrainProp.typeSettings = function(plotType) {
    return GameContent.shared.terrainProps[plotType];
}
TerrainProp.newPlot = function(config) {
    var prop = new TerrainProp({ type: config.type });
    var plot = new Plot({
        bounds: new Rect(config.topLeft, TerrainProp.typeSettings(config.type).plotSize),
        item: prop
    });
    return plot;
};

// a location on the map with a Zone or Building.
// contains the coordinates, pointers to game, finding neighbors,
// calculating land values and stuff, etc.
class Plot {
    constructor(config) {
        // bounds: <Rect>. rect.origin = top-left tile.
        this.bounds = config.bounds;
        this.item = config.item; // <Zone> or other
        this.data = {
            variantKey: config.bounds.hashValue()
        };
    }

    get textTemplateInfo() {
        return {
            name: this.item.name,
            type: this.item.type
        };
    }

    get title() {
        return this.item.name;
    }
}

// ########################### MAP/GAME #######################

class Terrain {
    // select a Terrain when starting a game
    // define via Yaml. Or auto generate. or?
    constructor(config) {
        this.sizeInTiles = config.sizeInTiles; // <width/height>
        this.boundsInTiles = new Rect({x: 0, y: 0}, config.sizeInTiles);
    }

    isTileRectWithinBounds(rect) {
        return this.boundsInTiles.contains(rect);
    }
}

class GameMap {
    constructor(config) {
        this.terrain = config.terrain; // <Terrain>
        this.plots = []; // <Plot>
        this.activeToolSession = null;
    }

    // isValidForConstruction: each building/zone type class 
    // decides this for itself. check isTileRectWithinBounds, 
    // whether it intersects any Plots, water, etc. GameMap 
    // has a intersectingPlots func that returns an array of 
    // all Plots that overlap a given rect. Each 
    // isValidForConstruction func can use intersectingPlots 
    // to make its decision (e.g. is it empty, is it only grass,
    // is it all water, etc.). Also a adjacentPlots could be 
    // useful for eg powerline or bridge construction. Pass it 
    // a Directions spec (e.g. horiz/vert/diagonal) in addition 
    // to the rect; so you can look only in specific directions 
    // for eg bridges.

    plotAtPoint(point) {
        return this.plots.find(p => p.bounds.containsTile(point));
    }
}

var debugPlots = [
    {cat: "Zone", cfg: {type: Z.R, topLeft: new Point(15, 8)}},
    {cat: "Zone", cfg: {type: Z.C, topLeft: new Point(18, 8)}},
    {cat: "Zone", cfg: {type: Z.I, topLeft: new Point(17, 12)}},
    {cat: "Prop", cfg: {type: "tree", topLeft: new Point(19, 11)}},
    {cat: "Prop", cfg: {type: "tree", topLeft: new Point(20, 11)}},
    {cat: "Prop", cfg: {type: "tree", topLeft: new Point(20, 12)}},
    {cat: "Prop", cfg: {type: "tree", topLeft: new Point(18, 11)}},
    {cat: "Prop", cfg: {type: "tree", topLeft: new Point(20, 13)}},
    {cat: "Prop", cfg: {type: "tree", topLeft: new Point(20, 14)}}
];

class City {
    constructor(config) {
        this.identity = {
            name: config.name // <String>
        };
        this.time = {
            speed: Game.rules().speeds[0],
            date: SimDate.epoch
        };
        this.budget = new Budget({ startingCash: config.difficulty.startingCash });
        this.map = new GameMap({ terrain: config.terrain });
        for (var i = 0; i < debugPlots.length; i += 1) {
            var p = debugPlots[i];
            switch (p.cat) {
                case "Zone": this.plopPlot(Zone.newPlot(p.cfg)); break;
                case "Prop": this.plopPlot(TerrainProp.newPlot(p.cfg)); break;
            }
        }
    }

    get population() {
        var pop = new RCIValue(0, 0, 0);
        this.map.plots.forEach(function (plot) {
            var plotPop = plot.item.population;
            if (plotPop) {
                pop = pop.adding(plotPop);
            }
        });
        return pop;
    }

    spend(simoleons) {
        return this.budget.spend(simoleons);
    }

    plopPlot(plot) {
        this.map.plots.push(plot);
    }
}

class Budget {
    constructor(config) {
        this.cash = config.startingCash;
    }

    spend(simoleons) {
        simoleons = Math.round(simoleons);
        if (this.cash >= simoleons) {
            this.cash -= simoleons;
            return true;
        } else {
            return false;
        }
    }
}

class Game {
    constructor(config) {
        this.city = config.city;
        this.renderer = config.renderer; // <ChromeRenderer>
        var speeds = Game.rules().speeds.map((s) => new SpeedSelector(s, this));
        this.speedSelection = new SelectableList(speeds);
        this._started = false;

        // TODO set up a separate run loop for the game logic.
        // main RunLoop is only for fast UI rendering, game RunLoop
        // ticks once per SimDate to do all the math. Renderers can 
        // hook into the game RunLoop to calculate and cach things 
        // like population only when necessary, so we aren't recalculating 
        // big aggregate sums 60x a second when it won't change nearly 
        // that often.
    }

    get isStarted() {
        return this._started;
    }
    get isRunning() {
        return this._started && uiRunLoop.isRunning();
    }

    get engineSpeed() {
        return this.speedSelection.selectedItem.value;
    }

    start() {
        this._configureCommmands();
        KeyInputController.shared.initialize(this);
        this.gameSpeedActivated(this.engineSpeed);
        this.renderer.initialize(this);
        this._started = true;
        debugLog(`Started game with city ${this.city.identity.name} @ ${this.city.time.date.longString()}, map ${this.city.map.terrain.sizeInTiles.width}x${this.city.map.terrain.sizeInTiles.height}`);

        uiRunLoop.addDelegate(this);
        engineRunLoop.addDelegate(this);
        uiRunLoop.resume();
        GameScriptEngine.shared.execute("_beginGame", this);
    }

    pause() {
        if (!this.isRunning) { return; }
        debugLog(`Paused game.`);
        uiRunLoop.pause();
    }

    resume() {
        if (!this.isStarted || this.isRunning) { return; }
        debugLog("Unpaused game.");
        uiRunLoop.resume();
    }

    togglePauseState() {
        if (!this.isStarted) { return; }
        if (this.isRunning) {
            this.pause();
        } else {
            this.resume();
        }
    }

    gameSpeedActivated(value) {
        debugLog(`Set engine speed to ${value.name}`);
        this.city.time.speed = value;
        engineRunLoop.setTargetFrameRate(value.daysPerSecond);
        this.resume();
    }

    delegateOrder(rl) {
        // Process before basically anything else
        return -100;
    }

    processFrame(rl) {
        if (rl == uiRunLoop) {

        } else if (rl == engineRunLoop) {
            this.city.time.date = this.city.time.date.adding(1);
        }
    }

    _configureCommmands() {
        var gse = GameScriptEngine.shared;
        gse.registerCommand("pauseResume", () => this.togglePauseState());
        gse.registerCommand("setEngineSpeed", (index) => this.speedSelection.setSelectedIndex(index));
    }
}
Game.rules = function() {
    return GameContent.shared.gameRules;
}

// #################### USER INPUT ######################

class PointInputSequence {
    constructor(firstEvent) {
        this.events = [firstEvent];
    }
    get firstEvent() { return this.events[0]; }
    get firstPoint() { return this._point(this.events[0]); }
    get latestEvent() { return this.events[this.events.length - 1]; }
    get latestPoint() { return this._point(this.events[this.events.length - 1]); }
    get totalOffset() { return this.latestPoint.manhattanDistanceFrom(this.firstPoint); }
    get isSingleClick() {
        return this.latestEvent.type == "mouseup"
            && this.latestPoint.manhattanDistanceFrom(this.firstPoint).magnitude <= GameContent.shared.pointInputController.singleClickMovementTolerance;
    }
    add(event) { this.events.push(event); }
    _point(event) { return new Point(event.offsetX, event.offsetY); }
}

class _PointInputNoopDelegate {
    shouldPassPointSessionToNextDelegate(sequence, controller) {
        return false;
    }
    pointSessionChanged(sequence, controller) {
        debugLog(`_PointInputNoopDelegate: ${sequence.latestEvent.type} @ ${sequence.latestPoint.debugDescription()}`);
    }
}

class PointInputController {
    constructor(config) {
        this.eventTarget = config.eventTarget; // DOM element
        this.delegates = [new _PointInputNoopDelegate()];
        this.sequence = null;
        this.eventTarget.addEventListener("mousedown", this._mousedDown.bind(this));
        this.eventTarget.addEventListener("mouseup", this._mousedUp.bind(this));
        if (config.trackAllMovement) {
            this.eventTarget.addEventListener("mousemove", this._moved.bind(this));
        }
    }

    pushDelegate(delegate) { this.delegates.push(delegate); }
    popDelegate() {
        if (this.delegates.length <= 1) { return null; }
        return this.delegates.pop();
    }
    removeDelegate(delegate) {
        if (this.delegates.length <= 1) { return null; }
        var index = this.delegates.indexOf(delegate);
        if (this.delegates.isIndexValid(index)) {
            this.delegates.splice(index, 1);
            return delegate;
        }
        return null;
    }

    _mousedDown(evt) {
        this._buildSequence(evt, true, false);
    }

    _moved(evt) {
        this._buildSequence(evt, false, false);
    }

    _mousedUp(evt) {
        this._buildSequence(evt, false, true);
    }

    _buildSequence(evt, restart, end) {
        if (restart || !this.sequence) {
            this.sequence = new PointInputSequence(evt)
        } else {
            this.sequence.add(evt);
        }
        this._fireForEachDelegate();
        if (end) {
            this.sequence = null;
        }
    }

    _fireForEachDelegate() {
        for (var i = this.delegates.length - 1; i >= 0; i -= 1) {
            var delegate = this.delegates[i];
            if (delegate.pointSessionChanged) {
                delegate.pointSessionChanged(this.sequence, this);
            }
            if (delegate.shouldPassPointSessionToNextDelegate && !delegate.shouldPassPointSessionToNextDelegate(this.session, this)) {
                break;
            }
        }
    }
}

class KeyInputController {
    constructor() {
        this.game = null;
        this.keyboardState = new Gaming.KeyboardState({ runLoop: uiRunLoop });
        var settings = GameContent.shared.keyInputController;
        this.keyPressEvents = settings.keyPressEvents;
        this.continuousKeyEvents = settings.continuousKeyEvents;
        this.keyboardState.addDelegate(this);
    }

    initialize(game) {
        this.game = game;
    }

    get keyboardCommandsActive() {
        return this.game != null;
    }

    getKeyAction(lookup) {
        var action = lookup.find(a => this.keyboardState.areKeyCodesDown(a[0], true));
        return action ? { command: action[1], subject: action[2] } : null;
    };

    keyboardStateDidChange(kc, eventType) {
        if (!this.keyboardCommandsActive) { return; }
        if (!this._executeCommandForCurrentKeys(this.keyPressEvents)) {
            if (!this._executeCommandForCurrentKeys(this.continuousKeyEvents)) {
                this._logUnhandledKeys();
            }
        }
    }

    keyboardStateContinuing(kc) {
        this._executeCommandForCurrentKeys(this.continuousKeyEvents);
    }

    _executeCommandForCurrentKeys(lookup) {
        var action = this.getKeyAction(lookup);
        if (!action) { return false; }
        GameScriptEngine.shared.execute(action.command, action.subject);
        return true;
    }

    _logUnhandledKeys() {
        var codes = Array.from(this.keyboardState.keyCodesCurrentlyDown).join(",");
        once("_logUnhandledKeys:" + codes, () => debugLog("KeyInputController: unhandled key codes: " + codes));
    }
}

// ##################### MAP TOOLS ######################

class MapToolPointer {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
    }
    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }
    focusRectForTileCoordinate(tile) { return null; }

    performSingleClickAction(session, tile) {
        debugLog("TODO center map on " + tile.debugDescription());
    }
}

class MapToolQuery {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
    }
    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }

    focusRectForTileCoordinate(tile) {
        return tile ? new Rect(tile, { width: 1, height: 1 }) : null;
    }

    performSingleClickAction(session, tile) {
        debugLog("TODO query " + tile.debugDescription());
    }
}

class MapToolBulldozer {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
    }
    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }

    focusRectForTileCoordinate(tile) {
        return tile ? new Rect(tile, { width: 1, height: 1 }) : null;
    }

    performSingleClickAction(session, tile) {
        debugLog("TODO bulldoze " + tile.debugDescription());
    }
}

class MapToolPlopZone {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
        this.zoneInfo = Zone.typeSettings(settings.zoneType);
    }
    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }

    focusRectForTileCoordinate(tile) {
        return tile ? new Rect(tile, this.zoneInfo.plotSize) : null;
    }

    performSingleClickAction(session, tile) {
        var rect = this.focusRectForTileCoordinate(tile);
        var result = { code: null, price: null, formattedPrice: null, focusTileRect: rect };
        if (!rect) { result.code = MapToolSession.ActionResult.notAllowed; return result; }
        var plot = Zone.newPlot({ type: this.settings.zoneType, topLeft: rect.getOrigin() });
        result.price = 0;
        result.formattedPrice = Simoleon.format(result.price);
        var purchased = session.game.city.spend(result.price);
        if (!purchased) { result.code = MapToolSession.ActionResult.notAffordable; return result; }
        session.game.city.plopPlot(plot);
        result.code = MapToolSession.ActionResult.purchased;
        return result;
    }
}

class MapToolSession {
    constructor(config) {
        this.game = config.game;
        this.tool = config.tool;
        this.preemptedSession = config.preemptedSession;
        this.singleClickMovementTolerance = MapToolController.settings().singleClickMovementTolerance;
        this._activationTimestamp = Date.now();
        this._focusRect = null;
    }

    receivedPointInput(inputSequence, tile) {
        var action = null;
        if (inputSequence.isSingleClick) {
            action = this.tool.performSingleClickAction(this, tile);
        }
        this._updateFocusRect(tile);
        return { code: MapToolSession.InputResult.continueCurrentSession, action: action };
    }

    pause() {

    }

    resume() {

    }

    _updateFocusRect(tile) {
        // TODO ask the MapTool to translate the single tile coord to a rect
        this._focusRect = new Rect(tile, { width: 3, height: 3 });
    }

    // UI stuff

    // modelMetadata dictionary to pass to ScriptPainters
    get textTemplateInfo() {
        return {
            paletteTitle: this.tool.paletteTitle
        };
    }

    // ----- Overlay Rendering -----
    // All of these getters specify both what and where to paint; the renderer 
    // does not need any additional position info from this class, input controllers, etc.

    // (optional) List of tiles that may be affected. e.g. to paint with translucent overlay
    get affectedTileRects() {
        if (!this._focusRect) { return null; }
        return {
            // a zone might be a single 3x3 rect, a road may be a bunch of 1x1s
            tileRects: [this._focusRect],
            // runs the script once per tile rect
            painterID: this.tool.settings.proposedTileRectOverlayPainter
        };
    }

    // (optional) Primary tile rect the tool is pointing to
    get focusTileRect() {
        return this.tool.focusRectForTileCoordinate(this._focusRect);
    }

    // (optional) What to render next to the cursor. Note it defines the position
    // to paint at; not the current cursor x/y position.
    get hoverStatusRenderInfo() {
        if (!this._focusRect) { return null; }
        // TODO some tools may not display a hover status. e.g. the Pointer
        // or only sometimes, e.g. show tile coords if holding Option key with the Pointer.
        return {
            tileRect: new Rect(1, 1, 1, 1), // determines position to paint below
            // This will likely be quite dynamic; use string templates + painterMetadata
            painterID: this.tool.hoverStatusPainter
        }
        return [];
    }

    // CSS value, e.g. "crosshair"
    // get mouseCursorType() {
    //     return this.tool.mouseCursorType;
    // }
}
MapToolSession.InputResult = {
    continueCurrentSession: 1,
    endSession: 2,
    pauseAndPushNewSession: 3
};
MapToolSession.ActionResult = {
    nothing: 0,
    ok: 1,
    purchased: 2,
    notAffordable: 3,
    notAllowed: 4
};

class MapToolController {
    constructor(config) {
        this.game = null;
        this.canvasGrid = null;
        this.defaultTool = null;
        this._feedbackSettings = MapToolController.settings().feedback;
        this._toolSession = null;
        this._feedbackItems = [];
        this._configureTools();
    }

    initialize(config) {
        this.game = config.game;
        this.canvasGrid = config.canvasGrid;
        this.canvasInputController = config.canvasInputController;
        this.canvasInputController.pushDelegate(this);
        // TODO also configure keyboard commands to switch tools
        this._beginNewSession(this.defaultTool, false);
    }

    get activeSession() { return this._toolSession; }
    get allTools() { return this._allTools; }
    get activeFeedbackItems() {
        this._removeExpiredFeedback();
        return this._feedbackItems;
    }

    isToolIDActive(id) {
        return this.activeSession ? (this.activeSession.tool.id == id) : false;
    }

    toolWithID(id) {
        return this._toolIDMap[id];
    }

    shouldPassPointSessionToNextDelegate(inputSequence, inputController) {
        return !this._toolSession;
    }

    pointSessionChanged(inputSequence, inputController) {
        var session = this.activeSession;
        if (!session) { return; }
        var tile = this.canvasGrid.tileForCanvasPoint(inputSequence.latestPoint);
        if (!tile) { return; }
        var result = session.receivedPointInput(inputSequence, tile);
        this._addFeedback(result.action);
        switch (result.code) {
            case MapToolSession.InputResult.continueCurrentSession: break;
            case MapToolSession.InputResult.endSession:
                this._endSession(); break;
            case MapToolSession.InputResult.pauseAndPushNewSession:
                this._beginNewSession(result.tool, true); break;
            default:
                once("MapToolSession.InputResult.code" + result.code, () => debugLog("Unknown MapToolSession.InputResult code " + result.code));
        }
    }

    selectTool(tool) {
        if (!tool || this.isToolIDActive(tool.id)) { return; }
        this._beginNewSession(tool, false);
    }

    selectToolID(id) {
        this.selectTool(this.toolWithID(id));
    }

    _addFeedback(result) {
        if (!result) { return; }
        var item = null;
        switch (result.code) {
            case MapToolSession.ActionResult.purchased:
                item = result; break;
            case MapToolSession.ActionResult.notAffordable:
                item = result; break;
            case MapToolSession.ActionResult.notAllowed:
                item = result; break;
            default: break;
        }
        if (item) {
            item.tool = this.activeSession.tool;
            item.timestamp = Date.now();
            this._feedbackItems.push(item);
        }
    }

    _removeExpiredFeedback() {
        var now = Date.now();
        this._feedbackItems = this._feedbackItems.filter((item) => {
            var feedback = MapToolController.getFeedbackSettings(this._feedbackSettings, item.code);
            if (!feedback) { return false; }
            return (now - item.timestamp) < feedback.displayMilliseconds;
        });
    }

    _endSession() {
        if (this._toolSession.preemptedSession) {
            this._toolSession = this._toolSession.preemptedSession;
            this._toolSession.resume();
        } else {
            this.beginNewSession(this.defaultTool, false);
        }
    }

    _beginNewSession(tool, preempt) {
        if (preempt) {
            this._toolSession.pause();
        }
        this._toolSession = new MapToolSession({
            game: this.game,
            tool: tool,
            preemptedSession: preempt ? this._toolSession : null
        });
        this._toolSession.resume();
    }

    _configureTools() {
        var definitions = MapToolController.settings().definitions;
        var ids = Object.getOwnPropertyNames(definitions);
        this._allTools = [];
        this._toolIDMap = {};
        ids.forEach((id) => {
            var tool = this._createTool(id, definitions[id]);
            if (tool) {
                this._allTools.push(tool);
                this._toolIDMap[id] = tool;
            }
        });
        this.defaultTool = this._allTools.find((t) => t.settings.isDefault);
    }

    _createTool(id, settings) {
        switch (settings.type) {
            case "pointer": return new MapToolPointer(id, settings);
            case "query": return new MapToolQuery(id, settings);
            case "bulldozer": return new MapToolBulldozer(id, settings);
            case "plopZone": return new MapToolPlopZone(id, settings);
            default:
                debugLog("Unknown tool type " + settings.type);
                return null;
        }
    }
}
MapToolController.settings = () => GameContent.shared.mapTools;
MapToolController.getFeedbackSettings = (source, code) => {
    switch (code) {
        case MapToolSession.ActionResult.purchased: return source.purchased;
        case MapToolSession.ActionResult.notAffordable: return source.notAffordable;
        case MapToolSession.ActionResult.notAllowed: return source.notAllowed;
        default:
            once(`getFeedbackSettings-${code}`, () => debugLog(`Unknown code ${code}`));
            return null;
    }
}

// ##################### RENDERERS ######################

// TODO Viewport: defines the subset of the map that's currently 
// visible (offset + zoom level). And functions to move the 
// viewport that the InputController would use. Also note you 
// could have minimaps for navigation or stats wiews that 
// would use separate Renderer/Viewport copies with different 
// configs and target canvases.

class Viewport {
    constructor(config) {
        this.zoom = config.zoom; // <Float>. 1 == normal size.
        this.offset = { x: 0, y: 0 };
    }
}

// Top level. Handles the DOM elements outside the canvas, etc.
class ChromeRenderer {
    constructor() {
        var containerElem = document.querySelector("#root-CitySim");
        this.game = null;
        this.newGamePrompt = new NewGamePrompt();
        this.dialogs = new DialogManager({ containerElem: containerElem });
        this.numMinimaps = 3;
        this.elems = {
            container: containerElem,
            gameView: document.querySelector("gameView"),
            sceneRoot: document.querySelector("scene"),
            fileMenu: containerElem.querySelector(".fileMenu"),
            speedControls: containerElem.querySelector("speedControls"),
            frameRate: containerElem.querySelector("frameRate")
        };
        this.subRenderers = [];
        this.state = {
            frameCounter: 0
        };
        uiRunLoop.addDelegate(this);
        engineRunLoop.addDelegate(this);
    }

    failedToLoadBaseData() {
        new Gaming.Prompt({
            title: "Failed to load game",
            message: "There was a problem loading the game data.",
            requireSelection: true
        }).show();
    }

    setUp() {
        var ce = this.elems.container;
        ce.addRemClass("hidden", false);
        ce.querySelector(".help").addGameCommandEventListener("click", true, "showGameHelp", null);

        var sr = this.elems.sceneRoot;
        this.elems.mainMap = document.createElement("canvas").addRemClass("mainMap", true);
        sr.append(this.elems.mainMap);
        this.elems.controls = document.createElement("canvas").addRemClass("controls", true);
        sr.append(this.elems.controls);
        this.elems.palette = document.createElement("canvas").addRemClass("palette", true);
        sr.append(this.elems.palette);
        this.elems.minimapContainer = document.createElement("minimaps");
        this.elems.minimaps = [];
        for (var i = 0; i < this.numMinimaps; i += 1) {
            var minimap = document.createElement("canvas").addRemClass("minimap", true);
            this.elems.minimaps.push(minimap);
            this.elems.minimapContainer.append(minimap);
        }
        sr.append(this.elems.minimapContainer);

        this.elems.speedControlElems = [];
        this.elems.pauseResume = document.createElement("a");
        this.elems.pauseResume.innerText = "Resume";
        this.elems.pauseResume.addEventListener("click", this._startPauseResumeClicked.bind(this));
        this.elems.speedControls.append(this.elems.pauseResume);
        Game.rules().speeds.forEach(function (speed, index) {
            var ctrl = document.createElement("a").addRemClass("glyph", true);
            ctrl.innerText = speed.glyph;
            ctrl.addGameCommandEventListener("click", true, "setEngineSpeed", index);
            this.elems.speedControls.append(ctrl);
            this.elems.speedControlElems.push(ctrl);
        }.bind(this));

        this.elems.fileMenu.addEventListener("click", this._startPauseResumeClicked.bind(this));

        this._configureCommmands();
        this.render();
        this.newGamePrompt.show();
    }

    initialize(game) {
        this.game = game;
        if (!this.game) {
            this.subRenderers = [];
        } else {
            this.elems.sceneRoot.addRemClass("hidden", false);
            // in drawing order
            this.subRenderers = [
                new MapRenderer({ containerElem: this.elems.mainMap }),
                new GameControlsRenderer({ containerElem: this.elems.controls }),
                new PaletteRenderer({ containerElem: this.elems.palette })
                // TODO minimap renderers
                // Clicking a minimap changes the main map to render in the same 
                // mode as the minimap (eg crime overlay) and also navigates the 
                // main map. Minimap #1 is always the nav map and clicking resets 
                // the overlay mode and navigates the map. The other 2 minimaps 
                // have a button to change what minimap it is.
                // Minimaps probably cache their base map (basemap == terrain + plots)
                // so they don't have to re-render at 60fps.
            ];
            this.subRenderers.forEach(function (r) {
                r.initialize(game);
            });
        }
        this.state.frameCounter = 0;
        document.title = this.game.city.identity.name;
        this.render();
    }
    
    processFrame(rl) {
        if (rl == uiRunLoop) {
            this.state.frameCounter = this.state.frameCounter + 1;
            if (this.state.frameCounter % 60 == 0) {
                this._updateFrameRateLabel();
            }
        } else if (rl == engineRunLoop) {
            this.render();
        }
    }

    showGameHelp() {
        var helpSource = this.elems.container.querySelector("help");
        new Gaming.Prompt({
            customContent: helpSource.cloneNode(true).addRemClass("hidden", false),
            buttons: [ {label: "Thanks!"} ]
        }).show();
    }

    render() {
        if (!this.game) {
            this.elems.sceneRoot.addRemClass("hidden", true);
            this.elems.container.querySelector("h1").innerText = "CitySim";
            document.title = "CitySim";
            return;
        }
        var date = this.game.city.time.date.longString();
        this.elems.container.querySelector("h1").innerText = `${this.game.city.identity.name} — ${date}`;
        this._updateGameRunningStateLabels();
    }

    runLoopWillResume(rl) {
        this._updateGameRunningStateLabels();
        this.elems.frameRate.innerText = "";
    }

    runLoopDidPause(rl) {
        this._updateGameRunningStateLabels();
        this.elems.frameRate.innerText = "Paused";
    }

    _configureCommmands() {
        GameScriptEngine.shared.registerCommand("showGameHelp", () => this.showGameHelp());
    }

    _updateFrameRateLabel() {
        var rates = [];
        var uiFrameRate = uiRunLoop.getRecentFramesPerSecond();
        if (!isNaN(uiFrameRate)) {
            rates.push(`${Math.round(uiFrameRate)} fps`);
        }
        var engineFrameRate = engineRunLoop.getRecentMillisecondsPerFrame();
        if (!isNaN(engineFrameRate)) {
            rates.push(`${Math.round(engineFrameRate)} ms/day`);
        }

        this.elems.frameRate.innerText = rates.join(". ");
    }

    _updateGameRunningStateLabels() {
        var speedIndex = -1;
        if (!this.game) {
            this.elems.fileMenu.innerText = "New Game";
            this.elems.fileMenu.addRemClass("hidden", false);
            this.elems.speedControls.addRemClass("hidden", true);
        } else if (this.game.isRunning) {
            this.elems.fileMenu.addRemClass("hidden", true);
            this.elems.pauseResume.innerText = "Pause";
            this.elems.speedControls.addRemClass("hidden", false);
            speedIndex = Game.rules().speeds.indexOf(this.game.city.time.speed);
        } else {
            this.elems.fileMenu.addRemClass("hidden", true);
            this.elems.pauseResume.innerText = "Resume";
            this.elems.speedControls.addRemClass("hidden", false);
            speedIndex = Game.rules().speeds.indexOf(this.game.city.time.speed);
        }
        for (var i = 0; i < this.elems.speedControlElems.length; i += 1) {
            this.elems.speedControlElems[i].addRemClass("selected", i == speedIndex);
        }
    }

    _startPauseResumeClicked(event) {
        event.preventDefault();
        if (!this.game) {
            this.newGamePrompt.show();
        } else {
            this.game.togglePauseState();
        }
    }
}
ChromeRenderer.fadeOpacity = function(currentAge, targetAge, duration) {
    return Math.clamp((targetAge - currentAge) / duration, _zeroToOne);
};

class PaletteRenderer {
    constructor(config) {
        this.canvas = config.containerElem;
        this.game = null;
        this._style = MapToolController.settings().paletteStyle;
        this._canvasDirty = true;
        this.canvasInputController = new PointInputController({
            eventTarget: this.canvas,
            trackAllMovement: false
        });
        this.canvasInputController.pushDelegate(this);
    }

    get drawContext() {
        return this.canvas.getContext("2d", { alpha: true });
    }

    initialize(game) {
        this._canvasDirty = true;
        this.game = game;
        this.canvasGrid = new FlexCanvasGrid({
            canvas: this.canvas,
            deviceScale: FlexCanvasGrid.getDevicePixelScale(),
            tileWidth: this._style.tileWidth,
            tileSpacing: 0
        });
        this.visibleToolIDs = MapToolController.settings().defaultPalette;
        uiRunLoop.addDelegate(this);
    }

    shouldPassPointSessionToNextDelegate(inputSequence, controller) {
        return false;
    }

    pointSessionChanged(inputSequence, controller) {
        if (!inputSequence.isSingleClick) { return; }
        var tile = this.canvasGrid.tileForCanvasPoint(inputSequence.latestPoint);
        var id = this._toolIDForTile(tile);
        MapToolController.shared.selectToolID(id);
        this._canvasDirty = true; // TODO subcribe to tool-selection-change events instead
    }

    processFrame(rl) {
        if (!this._canvasDirty || rl != uiRunLoop) { return; }

        var ctx = this.drawContext;
        ctx.rectClear(this.canvasGrid.rectForFullCanvas);
        ctx.fillStyle = this._style.fillStyle;
        ctx.rectFill(this.canvasGrid.rectForAllTiles);

        for (var i = 0; i < this.visibleToolIDs.length; i++) {
            var tool = MapToolController.shared.toolWithID(this.visibleToolIDs[i]);
            this._renderTool(ctx, tool, this._rectForToolIndex(i));
        }
        this._canvasDirty = false;
    }

    _toolIDForTile(tile) {
        if (!tile) { return null; }
        var index = this._style.columns * tile.y + tile.x;
        return this.visibleToolIDs.safeItemAtIndex(index);
    }

    _rectForToolIndex(index) {
        var x = index % this._style.columns;
        var y = Math.floor(index / this._style.columns);
        return this.canvasGrid.rectForTile(new Point(x, y));
    }

    _renderTool(ctx, tool, rect) {
        this._basePainter(tool).render(ctx, rect, this.canvasGrid, tool.textTemplateInfo);
        ScriptPainterStore.shared.getPainter(this._style.iconPainter).render(ctx, rect, this.canvasGrid, tool.textTemplateInfo);
    }

    _basePainter(tool) {
        if (MapToolController.shared.isToolIDActive(tool.id)) {
            return ScriptPainterStore.shared.getPainter(this._style.selectedBasePainter);
        } else {
            return ScriptPainterStore.shared.getPainter(this._style.unselectedBasePainter);
        }
    }
}

class GameControlsRenderer {
    constructor(config) {
        this.containerElem = config.containerElem;
        this.game = null;
    }
    initialize(game) {
        this.game = game;
        this.containerElem.style.backgroundColor = "gray";
    }
        // var date = this.game.city.time.date.longString();
        // var cash = Simoleon.format(this.game.city.budget.cash);
        // var sims = Number.uiInteger(this.game.city.population.R);
        // this._renderTitle(`${this.game.city.identity.name} — ${date}, ${sims}, ${cash}`);
}

class MapRenderer {
    constructor(config) {
        this.canvas = config.containerElem;
        var zoomers = this.settings.zoomLevels.map((z) => new ZoomSelector(z, this));
        this.zoomSelection = new SelectableList(zoomers);
    }

    // Cached once per run loop frame
    get settings() {
        if (this._settings) { return this._settings; }
        this._settings = GameContent.shared.mainMapView;
        return this._settings;
    }

    get zoomLevel() {
        return this.zoomSelection.selectedItem.value;
    }

    get drawContext() {
        return this.canvas.getContext("2d", { alpha: false });
    }

    zoomLevelActivated(value) {
        debugLog("Set MapRenderer zoom to " + value.tileWidth);
        this.canvasGrid.setSize({ tileWidth: value.tileWidth, tileSpacing: 0 });
    }

    initialize(game) {
        this.game = game;

        this.canvasGrid = new FlexCanvasGrid({
            canvas: this.canvas,
            deviceScale: FlexCanvasGrid.getDevicePixelScale(),
            tileWidth: this.zoomLevel.tileWidth,
            tileSpacing: 0
        });

        this._configureCommmands();
        this.canvasInputController = new PointInputController({
            eventTarget: this.canvas,
            trackAllMovement: true
        });
        MapToolController.shared.initialize({
            game: this.game,
            canvasInputController: this.canvasInputController,
            canvasGrid: this.canvasGrid
        });

        var subRendererConfig = { canvasGrid: this.canvasGrid, game: this.game };
        this._terrainRenderer = new TerrainRenderer(subRendererConfig);
        this._plotRenderer = new PlotRenderer(subRendererConfig);
        this._toolRenderer = new MapToolSessionRenderer(subRendererConfig);
        debugLog(`MapRenderer: init canvasGrid tw=${this.canvasGrid.tileWidth} sz=${this.canvasGrid.tilesWide}x${this.canvasGrid.tilesHigh}`);

        var ctx = this.drawContext;
        ctx.fillStyle = this.settings.edgePaddingFillStyle;
        ctx.rectFill(this.canvasGrid.rectForFullCanvas);

        uiRunLoop.addDelegate(this);
    }

    processFrame(rl) {
        // if (rl == uiRunLoop) {
            this._settings = null;
            this._render();
        // }
    }

    _configureCommmands() {
        var gse = GameScriptEngine.shared;
        // gse.registerCommand("panMap", (direction) => {
        //     debugLog("TODO panMap: " + direction);
        // });
        gse.registerCommand("zoomIn", () => this.zoomSelection.selectNext());
        gse.registerCommand("zoomOut", () => this.zoomSelection.selectPrevious());
        gse.registerCommand("setZoomLevel", (index) => this.zoomSelection.setSelectedIndex(index));
    }

    _render() {
        if (!this.game) { return; }
        var ctx = this.drawContext;
        this._terrainRenderer.render(ctx, this.settings);
        var r = this._plotRenderer;
        this.game.city.map.plots.forEach((plot) => r.render(plot, ctx));
        this._toolRenderer.render(ctx);
        /*
    FlexCanvasGrid improvements:
    allow drawing partial tiles at the edges, instead of having blank edge padding:
    - rename rectForAllTiles to rectForFullTiles or something
    - configurable alignment for FlexCanvasGrid. So rectForFullTiles is top left, or centered, etc.
    - or start to think about Viewport integration right into FCG. So the Viewport determines 
      the xy offset of tiles. Use FCG's isTileVisible to determine, based on the xy offset,
      whether a tile needs drawing (including partial tiles). Have two variants: 
      isTileVisible and isTileFullyVisible. Also isTileRectVisible and isTileRectFullyVisible.
        */
    }
}

class TerrainRenderer {
    constructor(config) {
        this.canvasGrid = config.canvasGrid;
        this.game = config.game;
    }
    render(ctx, settings) {
        ctx.fillStyle = settings.edgePaddingFillStyle;
        ctx.rectFill(this.canvasGrid.rectForFullCanvas);
        ctx.fillStyle = settings.emptyFillStyle;
        ctx.rectFill(this.canvasGrid.rectForAllTiles);
    }
}

// Could reuse this, with different settings, for 
// minimaps and stuff.
class PlotRenderer {
    constructor(config) {
        this.canvasGrid = config.canvasGrid;
        this.game = config.game;
    }
    render(plot, ctx) {
        var rect = this.canvasGrid.rectForTileRect(plot.bounds);
        var painter = this._getPainter(plot, ScriptPainterStore.shared);
        if (painter) {
            painter.render(ctx, rect, this.canvasGrid, plot.textTemplateInfo);
        }
    }

    _getPainter(plot, store) {
        switch (plot.item.constructor.name) {
            case Zone.name:
                var id = `zone${plot.item.type}d0v0`;
                return store.getPainter(id, plot.data.variantKey);
            case TerrainProp.name:
                var id = `prop${plot.item.type}`;
                return store.getPainter(id, plot.data.variantKey);
        }
    }
}

class MapToolSessionRenderer {
    constructor(config) {
        this.game = config.game;
        this.canvasGrid = config.canvasGrid;
        this._feedbackSettings = Object.assign({}, MapToolController.settings().feedback);
        this._style = MapToolController.settings().mapOverlayStyle;
        this._frameCounter = 0;
        this.focusRectPainter = ScriptPainterStore.shared.getPainter(this._style.focusRectPainter);
        Object.getOwnPropertyNames(this._feedbackSettings).forEach((key) => {
            this._feedbackSettings[key].painter = ScriptPainterStore.shared.getPainter(this._feedbackSettings[key].painter);
        });
    }

    render(ctx) {
        this._frameCounter = this._frameCounter + 1;
        var session = MapToolController.shared.activeSession;
        if (session) {
            this._paintFocusRect(ctx, session);
        }
        this._paintFeedback(ctx);
    }

    _paintFocusRect(ctx, session) {
        var tileRect = session.focusTileRect;
        if (!tileRect) { return; }
        var rect = this.canvasGrid.rectForTileRect(tileRect);
        // if (this._frameCounter % 60 == 0) { debugLog([rect, tileRect, this.focusRectPainter]); }
        if (rect && this.focusRectPainter) {
            this.focusRectPainter.render(ctx, rect, this.canvasGrid, session.textTemplateInfo);
        }
    }

    _paintFeedback(ctx) {
        var items = MapToolController.shared.activeFeedbackItems;
        items.forEach((item) => this._paintFeedbackItem(ctx, item));
    }

    _paintFeedbackItem(ctx, item) {
        var feedback = MapToolController.getFeedbackSettings(this._feedbackSettings, item.code);
        if (!feedback || !feedback.painter || !item.focusTileRect) { return; }
        ctx.save();
        var age = Date.now() - item.timestamp;
        ctx.globalAlpha = ChromeRenderer.fadeOpacity(age, feedback.displayMilliseconds, this._style.feedbackFadeMilliseconds);
        if (feedback.driftPerMillisecond) {
            ctx.translate(feedback.driftPerMillisecond.x * age, feedback.driftPerMillisecond.y * age);
        }
        var rect = this.canvasGrid.rectForTileRect(item.focusTileRect);
        feedback.painter.render(ctx, rect, this.canvasGrid, item);
        ctx.restore();
    }
}

class ScriptPainter {
    constructor(config) {
        this.lines = config.lines;
        this.deviceScale = config.deviceScale;
        this.rDomain = _zeroToOne;
    }
    render(ctx, rect, canvasGrid, modelMetadata) {
        // TODO can we compile the lines so you don't parse them every frame?
        // Idea would be to create Path objects, Text objects, etc. (using native Canvas stuff like
        // Path2d or CanvasGradient when possible) with fixed "model" coordinates, then do the final runtime
        // scaling/translation via CanvasRenderingContext2D transformation matrix.
        if (Array.isEmpty(this.lines)) { return; }
        var ext = rect.getExtremes();
        var xDomain = { min: ext.min.x, max: ext.max.x };
        var yDomain = { min: ext.min.y, max: ext.max.y };
        var xRange = { min: 0, max: rect.width };
        var yRange = { min: 0, max: rect.height };
        var twRange = { min: 0, max: canvasGrid.tileWidth };
        var info = { rect: rect, xDomain: xDomain, yDomain: yDomain, xRange: xRange, yRange: yRange, twRange: twRange, modelMetadata: modelMetadata };
        for (var i = 0; i < this.lines.length; i++) {
            var line = this.lines[i];
            if (line.length == 0) { continue; }
            switch (line[0]) {
                case "fill": this._fill(line, ctx, info); break;
                case "innerStroke": this._innerStroke(line, ctx, info); break;
                case "poly": this._poly(line, ctx, info); break;
                case "text": this._text(line, ctx, info); break;
            }
        }
    }

    _toPx(value, units, domain, twRange) {
        switch (units) {
            case "p":
                if (domain) {
                    return domain.min + (value * this.deviceScale);
                } else {
                    return value * this.deviceScale;
                }
            case "r":
                return Math.scaleValueLinearUnbounded(value, this.rDomain, domain);
            case "tw":
                return Math.scaleValueLinearUnbounded(value, this.rDomain, twRange);
        }
    }

    _toRect(line, xIndex, info) {
        var units = line[xIndex + 4];
        return new Rect(
            this._toPx(line[xIndex + 0], units, info.xDomain, info.twRange),
            this._toPx(line[xIndex + 1], units, info.yDomain, info.twRange),
            this._toPx(line[xIndex + 2], units, info.xRange, info.twRange),
            this._toPx(line[xIndex + 3], units, info.yRange, info.twRange))
    }

    // [fill,red,rect,0,0,1,1,r]
    //  0    1   2    3 4 5 6 7
    _fill(line, ctx, info) {
        ctx.fillStyle = line[1];
        switch (line[2]) {
            case "rect": ctx.rectFill(this._toRect(line, 3, info)); return;
            case "ellipse": ctx.ellipseFill(this._toRect(line, 3, info)); return;
        }
    }

    // [innerStroke,red,rect,1,p,0,0,1,1,r]
    // line idx 0   1   2    3 4 5 6 7 8 9
    _innerStroke(line, ctx, info) {
        ctx.strokeStyle = line[1];
        ctx.lineWidth = this._toPx(line[3], line[4], null, info.twRange);
        switch (line[2]) {
            case "rect":
                var i = ctx.lineWidth * 0.5;
                var r = this._toRect(line, 5, info).inset(i, i);
                ctx.rectStroke(r);
                return;
        }
    }

    // line, stroke style, fill style, width, width units, coord units, x1, y1, x2, y2, ...
    // 0     1             2           3      4            5            6...n
    _poly(line, ctx, info) {
        ctx.lineWidth = this._toPx(line[3], line[4], null, info.twRange);
        var units = line[5];
        ctx.beginPath();
        for (var xIndex = 6; xIndex < line.length; xIndex += 2) {
            if (xIndex > line.length - 2) { break; }
            var x = this._toPx(line[xIndex], units, info.xDomain, info.twRange);
            var y = this._toPx(line[xIndex+1], units, info.yDomain, info.twRange);
            if (xIndex == 6) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
        if (line[line.length - 1] == "close") {
            ctx.closePath();
        }
        if (!String.isEmpty(line[2])) {
            ctx.fillStyle = line[2];
            ctx.fill();
        }
        if (!String.isEmpty(line[1])) {
            ctx.strokeStyle = line[1];
            ctx.stroke();
        }
    }

    // [text,red,0.25,r,left,top,0.5,0.5,r,R]
    //  0    1   2    3 4    5   6   7   8 9
    _text(line, ctx, info) {
        var sz = this._toPx(line[2], line[3], info.yRange, info.twRange);
        ctx.textAlign = line[4];
        ctx.textBaseline = line[5];
        var x = this._toPx(line[6], line[8], info.xDomain, info.twRange);
        var y = this._toPx(line[7], line[8], info.yDomain, info.twRange);
        ctx.font = `${sz}px sans-serif`;
        ctx.fillStyle = line[1];
        var text = String.fromTemplate(line[9], info.modelMetadata);
        ctx.textFill(text, new Point(x, y));
    }
}

class ScriptPainterStore {
    constructor() {
        this.deviceScale = FlexCanvasGrid.getDevicePixelScale();
        this.cache = {};
    }
    getPainter(id, variantKey) {
        var found = this.cache[id];
        variantKey = parseInt(variantKey);
        variantKey = isNaN(variantKey) ? 0 : variantKey;
        if (found) {
            return found[variantKey % found.length];
        }
        var data = GameContent.shared.painters[id];
        if (!data) { return null; }
        var variants = data.variants ? data.variants : [data];
        var ds = this.deviceScale;
        this.cache[id] = variants.map(v => new ScriptPainter({ lines: v, deviceScale: ds }));
        return this.getPainter(id, variantKey)
    }
}

// #################### MISC UI #####################

class DialogManager {
    constructor(config) {
        this.elems = {
            sceneContainer: config.containerElem.querySelector("gameView scene"),
            dialogTemplate: config.containerElem.querySelector("dialog")
        };
    }

    getDialog() {
        return this.elems.sceneContainer.querySelector("dialog");
    }

    dismissDialog() {
        var dialog = this.getDialog();
        if (dialog) {
            dialog.addRemClass("dismissed", true);
            return true;
        } else {
            return false;
        }
    }

    removeDialogs() {
        var dialog = this.getDialog();
        while (dialog) {
            this.elems.sceneContainer.removeChild(dialog);
            dialog = this.getDialog();
        }
    }

    showDialog(text, type, completion) {
        this.removeDialogs();
        var dialog = this.elems.dialogTemplate.cloneNode(true).addRemClass("hidden", false);
        dialog.querySelector("p").innerText = text;
        dialog.addEventListener("click", event => this.dismissDialog());
        dialog.addEventListener("transitionend", event => {
            if (event.target.classList.contains("dismissed")) {
                if (completion) { completion(); }
                this.removeDialogs();
            }
        });
        this.elems.sceneContainer.append(dialog);
        setTimeout(() => dialog.addRemClass("presented", true), 10);
    }
}

class NewGamePrompt {
    startNewGame() {
        var terrain = new Terrain(GameContent.shared.terrains[0]);
        var city = new City({
            name: "New City",
            terrain: terrain,
            difficulty: Game.rules().difficulties.easy
        });
        CitySim.game = new Game({
            city: city,
            renderer: chromeRenderer
        });
        CitySim.game.start();
    };
    show() {
        if (!CitySim.game) {
            this.startNewGame();
            return;
        }
        new Gaming.Prompt({
            title: "New Game",
            message: "Start a new game?",
            buttons: [
                { label: "Start Game", action: this.startNewGame.bind(this), classNames: ["warning"] },
                { label: "Cancel" }
            ]
        }).show();
    }
};

// ########################### INIT #######################

if (!window.doNotInitializeGame) {
    var engineRunLoop = new Gaming.RunLoop({
        targetFrameRate: 1,
        id: "engineRunLoop",
        childRunLoops: []
    });
    var uiRunLoop = new Gaming.RunLoop({
        targetFrameRate: 60,
        id: "uiRunLoop",
        childRunLoops: [engineRunLoop]
    });
    var chromeRenderer = new ChromeRenderer();
}

var initialize = async function() {
    var content = await GameContent.loadYamlFromLocalFile("city-content.yaml", GameContent.cachePolicies.forceOnFirstLoad);
    dataIsReady(content);
};

var dataIsReady = function(content) {
    if (!content) {
        chromeRenderer.failedToLoadBaseData();
        return;
    }
    GameContent.shared = content;
    GameScriptEngine.shared = new GameScriptEngine();
    ScriptPainterStore.shared = new ScriptPainterStore();
    KeyInputController.shared = new KeyInputController();
    MapToolController.shared = new MapToolController();
    chromeRenderer.setUp();
};

return {
    game: null,
    engineRunLoop: engineRunLoop,
    uiRunLoop: uiRunLoop,
    chromeRenderer: chromeRenderer,
    initialize: initialize,
    Z: Z,
    Simoleon: Simoleon,
    RCIValue: RCIValue,
    SimDate: SimDate,
    Zone: Zone,
    Plot: Plot,
    Terrain: Terrain,
    GameMap: GameMap,
    City: City,
    Budget: Budget,
    Game: Game,
    KeyInputController: KeyInputController,
    ChromeRenderer: ChromeRenderer,
    PaletteRenderer: PaletteRenderer,
    GameControlsRenderer: GameControlsRenderer,
    MapRenderer: MapRenderer,
    NewGamePrompt: NewGamePrompt
};

})(); // end CitySim namespace

if (!window.doNotInitializeGame) {
    CitySim.initialize();
}
