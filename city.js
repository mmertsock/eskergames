"use-strict";

window.CitySim = (function() {

var debugLog = Gaming.debugLog;
var once = Gaming.once;
var Rect = Gaming.Rect;
var Point = Gaming.Point;
var SelectableList = Gaming.SelectableList;
var Kvo = Gaming.Kvo;
var Binding = Gaming.Binding;
var FlexCanvasGrid = Gaming.FlexCanvasGrid;
var GameContent = CitySimContent.GameContent;
var GameScriptEngine = CitySimContent.GameScriptEngine;

// ########################### GLOBAL #######################

var _stringTemplateRegexes = {};
var _zeroToOne = { min: 0, max: 1 };

var _runLoopPriorities = {
    gameEngine: -100
};

Rect.prototype.containsTile = function(x, y) {
    if (typeof y === 'undefined') {
        return x.x >= this.x && x.y >= this.y && x.x < (this.x + this.width) && x.y < (this.y + this.height);
    } else {
        return   x >= this.x &&   y >= this.y &&   x < (this.x + this.width) &&   y < (this.y + this.height);
    }
};

// ordered by row then column
Rect.prototype.allTileCoordinates = function() {
    var extremes = this.getExtremes();
    var coords = [];
    for (var y = extremes.min.y; y < extremes.max.y; y += 1) {
        for (var x = extremes.min.x; x < extremes.max.x; x += 1) {
            coords.push(new Point(x, y));
        }
    }
    return coords;
};

Rect.tileRectWithCenter = function(center, size) {
    var x = (size.width < 2) ? center.x : (center.x - Math.floor(0.5 * size.width));
    var y = (size.height < 2) ? center.y : (center.y - Math.floor(0.5 * size.height));
    return new Rect(x, y, size.width, size.height);
};

// Tries to move (not resize) this rect to be within the given bounds.
// If it doesn't fit, sets origin == bounds.origin.
Rect.prototype.clampedWithinTileBounds = function(bounds) {
    if (bounds.contains(this)) { return this; }
    var myExtremes = this.getExtremes();
    var theirExtremes = bounds.getExtremes();
    var dx = 0, dy = 0;
    if (myExtremes.max.x > theirExtremes.max.x) { dx = theirExtremes.max.x - myExtremes.max.x; }
    if (myExtremes.min.x < theirExtremes.min.x) { dx = theirExtremes.min.x - myExtremes.min.x; }
    if (myExtremes.max.y > theirExtremes.max.y) { dy = theirExtremes.max.y - myExtremes.max.y; }
    if (myExtremes.min.y < theirExtremes.min.y) { dy = theirExtremes.min.y - myExtremes.min.y; }
    return new Rect(this.x + dx, this.y + dy, this.width, this.height);
};

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

    mediumString() {
        var uiMonth = GameContent.shared.simDate.longMonthStrings[this.month];
        return `${uiMonth} ${this.year}`;
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

    get bulldozeCost() {
        return this.settings.baseBulldozeCost;
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

    get bulldozeCost() {
        return this.settings.bulldozeCost;
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

    get bulldozeCost() {
        return this.item.bulldozeCost || 0;
    }
}

// ########################### MAP/GAME #######################

class Terrain {
    constructor(config) {
        this.size = config.size; // <width/height>
        this.bounds = new Rect(new Point(0, 0), config.size);
    }
}

// NB this doesn't properly handle overlapping plots.
// Either implement full support for that, or refuse to addPlot when
// the plot would overlap another (thus, need to remove the old plot
// first). Should also refuse to addPlot if its bounds goes outside
// the bounds of the map. Return null from addPlot/removePlot upon
// failure, and return the plot object upon success.
class GameMap {
    constructor(config) {
        this.terrain = config.terrain;
        // flat sparse arrays in drawing order. See _tileIndex for addressing
        this._plots = [];
        this._tiles = [];
    }

    get bounds() { return this.terrain.bounds; }

    isValidCoordinate(x, y) {
        return this.terrain.bounds.containsTile(x, y);
    }

    isTileRectWithinBounds(rect) {
        return this.terrain.bounds.contains(rect);
    }

    addPlot(plot) {
        if (!this.isTileRectWithinBounds(plot.bounds)) {
            debugLog(`Plot is outside of map bounds: ${plot.bounds.debugDescription()}`);
            return null;
        }
        var index = this._tileIndex(plot.bounds.getOrigin());
        if (isNaN(index)) { return null; }
        if (this.plotsInRect(plot.bounds).length > 0) {
            debugLog(`Cannot add plot at ${plot.bounds.debugDescription()}: overlaps other plots.`);
            return null;
        }
        this._plots[index] = plot;
        plot.bounds.allTileCoordinates()
            .map((t) => this._tileIndex(t))
            .forEach((i) => { if (!isNaN(i)) { this._tiles[i] = plot; } });
        debugLog(`Added plot ${plot.title} at ${plot.bounds.debugDescription()}`);
        return plot;
    }

    removePlot(plot) {
        var index = this._tileIndex(plot.bounds.getOrigin());
        if (!isNaN(index) && this._plots[index] === plot) {
            this._plots[index] = null;
            plot.bounds.allTileCoordinates()
                .map((t) => this._tileIndex(t))
                .forEach((i) => { if (!isNaN(i) && this._tiles[i] === plot) { this._tiles[i] = null; } });
            debugLog(`Removed plot ${plot.title} at ${plot.bounds.debugDescription()}`);
            return plot;
        }
        return null;
    }

    visitEachPlot(block) {
        for (var i = 0; i < this._plots.length; i += 1) {
            if (this._plots[i]) { block(this._plots[i]); }
        }
    }

    plotAtTile(x, y) {
        var index = this._tileIndex(x, y);
        return isNaN(index) ? null : this._tiles[index];
    }

    plotsInRect(rect) {
        return Array.from(new Set(rect.allTileCoordinates()
                .map((t) => this.plotAtTile(t))
                .filter((p) => !!p)));
    }

    _tileIndex(x, y) {
        var px = x; var py = y;
        if (typeof y === 'undefined') {
            px = x.x; py = x.y;
        }
        if (!this.isValidCoordinate(px, py)) { return NaN; }
        return py * this.terrain.size.height + px;
    }
}

class CityTime {
    constructor() {
        this.speed = Game.rules().speeds[0];
        this.date = SimDate.epoch;
        this.kvo = new Kvo(CityTime, this);
    }
    setSpeed(newSpeed) {
        this.kvo.speed.setValue(newSpeed);
    }
    incrementDay() {
        this.kvo.date.setValue(this.date.adding(1));
    }
}
CityTime.Kvo = { "speed": "speed", "date": "date" };

class City {
    constructor(config) {
        this.name = config.name;
        this.time = new CityTime();
        this.budget = new Budget({ startingCash: config.difficulty.startingCash });
        this.map = new GameMap({ terrain: config.terrain });
        this.kvo = new Kvo(City, this);
        this._updateStateAfterOneDay();
    }

    get population() { return this._population; }
    get rciDemand() { return this._rciDemand; }

    spend(simoleons) {
        return this.budget.spend(simoleons);
    }

    plopPlot(plot) {
        return this.map.addPlot(plot);
    }

    destroyPlot(plot) {
        return this.map.removePlot(plot);
    }

    simulateOneDay() {
        this.time.incrementDay();
        this._updateStateAfterOneDay();
    }

    _updateStateAfterOneDay() {
        this._updatePopulation();
        this._updateRCI();
    }

    _updatePopulation() {
        var pop = new RCIValue(0, 0, 0);
        this.map.visitEachPlot((plot) => {
            var plotPop = plot.item.population;
            if (plotPop) {
                pop = pop.adding(plotPop);
            }
        });
        this.kvo.population.setValue(pop);
    }

    _updateRCI() {
        this.kvo.rciDemand.setValue(new RCIValue(0.7, -0.1, 0.3));
    }
}
City.Kvo = { name: "name", population: "_population", rciDemand: "_rciDemand" };

class Budget {
    constructor(config) {
        this.cash = config.startingCash;
        this.kvo = new Kvo(Budget, this);
    }

    spend(simoleons) {
        simoleons = Math.round(simoleons);
        if (this.cash >= simoleons) {
            this.kvo.cash.setValue(this.cash - simoleons);
            return true;
        } else {
            return false;
        }
    }
}
Budget.Kvo = { cash: "cash" };

class Game {
    constructor(config) {
        this.city = config.city;
        this.rootView = config.rootView;
        var speeds = Game.rules().speeds.map((s) => new SpeedSelector(s, this));
        this.speedSelection = new SelectableList(speeds);
        this._started = false;
    }

    get isStarted() {
        return this._started;
    }
    get isRunning() {
        return this._started && engineRunLoop.isRunning();
    }

    get engineSpeed() {
        return this.speedSelection.selectedItem.value;
    }

    start() {
        this._configureCommmands();
        KeyInputController.shared.initialize(this);
        this.gameSpeedActivated(this.engineSpeed);
        this.rootView.initialize(this);
        this._started = true;
        debugLog(`Started game with city ${this.city.name} @ ${this.city.time.date.longString()}, map ${this.city.map.terrain.size.width}x${this.city.map.terrain.size.height}`);

        engineRunLoop.addDelegate(this);
        uiRunLoop.resume();
        GameScriptEngine.shared.execute("_beginGame", this);
    }

    pause() {
        if (!this.isRunning) { return; }
        debugLog(`Paused game.`);
        engineRunLoop.pause();
    }

    resume() {
        if (!this.isStarted || this.isRunning) { return; }
        debugLog("Unpaused game.");
        engineRunLoop.resume();
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
        this.city.time.setSpeed(value);
        engineRunLoop.setTargetFrameRate(value.daysPerSecond);
        this.resume();
    }

    delegateOrder(rl) {
        return _runLoopPriorities.gameEngine;
    }

    processFrame(rl) {
        if (rl == engineRunLoop) {
            this.city.simulateOneDay();
        }
    }

    escapePressed() {
        MapToolController.shared.selectTool(MapToolController.shared.defaultTool);
    }

    _configureCommmands() {
        var gse = GameScriptEngine.shared;
        gse.registerCommand("pauseResume", () => this.togglePauseState());
        gse.registerCommand("setEngineSpeed", (index) => this.speedSelection.setSelectedIndex(index));
        gse.registerCommand("escapePressed", () => this.escapePressed());
    }
}
Game.rules = function() { return GameContent.shared.gameRules; };

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
            this.delegates.removeItemAtIndex(index);
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
    }

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
    focusRectForTileCoordinate(session, tile) { return null; }

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

    focusRectForTileCoordinate(session, tile) {
        if (!tile) { return null; }
        var plot = session.game.city.map.plotAtTile(tile);
        return this._getFocusRect(plot, tile);
    }

    performSingleClickAction(session, tile) {
        debugLog("TODO query " + tile.debugDescription());
    }

    _getFocusRect(plot, tile) {
        return plot ? plot.bounds : new Rect(tile, {width: 1, height: 1});
    }
}

class MapToolBulldozer {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
    }
    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }

    focusRectForTileCoordinate(session, tile) {
        if (!tile) { return null; }
        var plot = session.game.city.map.plotAtTile(tile);
        return this._getFocusRect(plot, tile);
    }

    performSingleClickAction(session, tile) {
        var plot = session.game.city.map.plotAtTile(tile);
        var result = { code: null, price: null, formattedPrice: null, focusTileRect: this._getFocusRect(plot, tile) };
        if (!plot) { result.code = MapToolSession.ActionResult.notAllowed; return result; }
        result.price = plot.bulldozeCost;
        result.formattedPrice = Simoleon.format(result.price);
        var purchased = session.game.city.spend(result.price);
        if (purchased) {
            var destroyed = session.game.city.destroyPlot(plot);
            result.code = destroyed ? MapToolSession.ActionResult.purchased : MapToolSession.ActionResult.notAllowed;
        } else {
            result.code = MapToolSession.ActionResult.notAffordable;
        }
        return result;
    }

    _getFocusRect(plot, tile) {
        return plot ? plot.bounds : new Rect(tile, {width: 1, height: 1});
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

    focusRectForTileCoordinate(session, tile) {
        if (!tile) { return null; }
        return Rect.tileRectWithCenter(tile, this.zoneInfo.plotSize)
            .clampedWithinTileBounds(session.game.city.map.bounds);
    }

    performSingleClickAction(session, tile) {
        var rect = this.focusRectForTileCoordinate(session, tile);
        var result = { code: null, price: null, formattedPrice: null, focusTileRect: rect };
        if (!rect) { result.code = MapToolSession.ActionResult.notAllowed; return result; }
        var plot = Zone.newPlot({ type: this.settings.zoneType, topLeft: rect.getOrigin() });
        result.price = this.zoneInfo.newPlotCost;
        result.formattedPrice = Simoleon.format(result.price);
        var purchased = session.game.city.spend(result.price);
        if (!purchased) { result.code = MapToolSession.ActionResult.notAffordable; return result; }
        var plopped = session.game.city.plopPlot(plot);
        result.code = plopped ? MapToolSession.ActionResult.purchased : MapToolSession.ActionResult.notAllowed;
        return result;
    }
}

class MapToolPlopProp {
    constructor(id, settings) {
        this.id = id;
        this.settings = settings;
        this.propInfo = TerrainProp.typeSettings(settings.propType);
    }

    get textTemplateInfo() { return this.settings; }
    get paletteRenderInfo() { return this.settings; }

    focusRectForTileCoordinate(session, tile) {
        if (!tile) { return null; }
        return Rect.tileRectWithCenter(tile, this.propInfo.plotSize)
            .clampedWithinTileBounds(session.game.city.map.bounds);
    }

    performSingleClickAction(session, tile) {
        var rect = this.focusRectForTileCoordinate(session, tile);
        var result = { code: null, price: null, formattedPrice: null, focusTileRect: rect };
        if (!rect) { result.code = MapToolSession.ActionResult.notAllowed; return result; }
        var plot = TerrainProp.newPlot({ type: this.settings.propType, topLeft: rect.getOrigin() });
        result.price = this.propInfo.newPlotCost;
        result.formattedPrice = Simoleon.format(result.price);
        var purchased = session.game.city.spend(result.price);
        if (!purchased) { result.code = MapToolSession.ActionResult.notAffordable; return result; }
        var plopped = session.game.city.plopPlot(plot);
        result.code = plopped ? MapToolSession.ActionResult.purchased : MapToolSession.ActionResult.notAllowed;
        return result;
    }
}

class MapToolSession {
    constructor(config) {
        this.game = config.game;
        this.canvasGrid = config.canvasGrid;
        this.tool = config.tool;
        this.preemptedSession = config.preemptedSession;
        this.singleClickMovementTolerance = MapToolController.settings().singleClickMovementTolerance;
        this._activationTimestamp = Date.now();
        this._tile = null; // TODO refactor this/make it part of this.state
        this.state = {}; // TODO a generic way to do model object state
    }

    receivedPointInput(inputSequence) {
        var action = null;
        // TODO can use this.state to determine if the tile changed between this and the last point-input
        var tile = this.canvasGrid.tileForCanvasPoint(inputSequence.latestPoint);
        if (tile) {
            if (inputSequence.isSingleClick) {
                action = this.tool.performSingleClickAction(this, tile);
            }
            this._tile = tile;
        }
        return { code: MapToolSession.InputResult.continueCurrentSession, action: action };
    }

    pause() { }

    resume() { }

    end() { }

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
        if (!this._tile) { return null; }
        return {
            // a zone might be a single 3x3 rect, a road may be a bunch of 1x1s
            tileRects: [],
            // runs the script once per tile rect
            painterID: this.tool.settings.proposedTileRectOverlayPainter
        };
    }

    // (optional) Primary tile rect the tool is pointing to
    get focusTileRect() {
        // TODO rely on the stored state instead of recalculating at render time
        return this.tool.focusRectForTileCoordinate(this, this._tile);
    }

    // (optional) What to render next to the cursor. Note it defines the position
    // to paint at; not the current cursor x/y position.
    get hoverStatusRenderInfo() {
        if (!this._tile) { return null; }
        // Some tools may not display a hover status. e.g. the Pointer
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

    static settings() { return GameContent.shared.mapTools; }

    constructor(config) {
        this.game = null;
        this.canvasGrid = null;
        this.defaultTool = null;
        this._feedbackSettings = MapToolController.settings().feedback;
        this._toolSession = null;
        this._feedbackItems = [];
        this.kvo = new Kvo(MapToolController, this);
        this._configureTools();
    }

    initialize(config) {
        this.game = config.game;
        this.canvasGrid = config.canvasGrid;
        this.canvasInputController = config.canvasInputController;
        this.canvasInputController.pushDelegate(this);
        this._beginNewSession(this.defaultTool, false);
        engineRunLoop.addDelegate(this);
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

    processFrame(rl) {
        // TODO notify the tool session so it can update its state
    }

    shouldPassPointSessionToNextDelegate(inputSequence, inputController) {
        return !this._toolSession;
    }

    pointSessionChanged(inputSequence, inputController) {
        var session = this.activeSession;
        if (!session) { return; }
        var result = session.receivedPointInput(inputSequence);
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
            this._feedbackItems.unshift(item);
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
            this.kvo.activeSession.setValue(this._toolSession.preemptedSession, false, true);
            this._toolSession.resume();
        } else {
            this._beginNewSession(this.defaultTool, false);
        }
    }

    _beginNewSession(tool, preempt) {
        if (preempt && this._toolSession) { this._toolSession.pause(); }
        else if (!preempt && this._toolSession) { this._toolSession.end(); }
        this.kvo.activeSession.setValue(new MapToolSession({
            game: this.game,
            canvasGrid: this.canvasGrid,
            tool: tool,
            preemptedSession: preempt ? this._toolSession : null
        }), false, true);
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
        GameScriptEngine.shared.registerCommand("selectTool", (id) => this.selectToolID(id));
    }

    _createTool(id, settings) {
        switch (settings.type) {
            case "pointer": return new MapToolPointer(id, settings);
            case "query": return new MapToolQuery(id, settings);
            case "bulldozer": return new MapToolBulldozer(id, settings);
            case "plopZone": return new MapToolPlopZone(id, settings);
            case "plopProp": return new MapToolPlopProp(id, settings);
            default:
                debugLog("Unknown tool type " + settings.type);
                return null;
        }
    }
}
MapToolController.shared = null;
MapToolController.Kvo = { activeSession: "_toolSession" };
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

// ################ RENDERERS AND VIEWS #################

class UI {
    static fadeOpacity(currentAge, targetAge, duration) {
        return Math.clamp((targetAge - currentAge) / duration, _zeroToOne);
    }
}

class TextLineView {
    static createElement(config) {
        var elem = document.createElement("label").addRemClass("textLine", true);
        if (config.title) {
            var title = document.createElement("span");
            title.innerText = config.title;
            elem.append(title);
        }
        var input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        elem.append(input);
        return elem;
    }

    constructor(config) {
        this.elem = TextLineView.createElement(config);
        config.parent.append(this.elem);
        this.valueElem = this.elem.querySelector("input");
        if (config.binding) {
            this.binding = new Binding({ source: config.binding.source, target: this, sourceFormatter: config.binding.sourceFormatter });
        }
    }

    configure(block) {
        block(this);
        return this;
    }

    get value() { return this.valueElem.value; }
    set value(newValue) { this.valueElem.value = newValue; }

    // for Bindings
    setValue(newValue) {
        this.value = newValue;
    }
}

class ToolButton {
    static createElement(config) {
        var elem = document.createElement("a")
            .addRemClass("tool", true)
            .addRemClass("glyph", !!config.isGlyph);
        elem.href = "#";
        var title = document.createElement("span");
        title.innerText = config.title;
        elem.append(title);
        if (config.size) {
            elem.style.width = `${config.size.width}px`;
            elem.style.height = `${config.size.height}px`;
        }
        return elem;
    }

    constructor(config) {
        this.id = config.id;
        this.elem = ToolButton.createElement(config);
        if (config.click) {
            this.elem.addEventListener("click", evt => { evt.preventDefault(); config.click(this); });
        } else if (config.clickScript) {
            var subject = typeof(config.clickScriptSubject) === 'undefined' ? this : config.clickScriptSubject;
            this.elem.addGameCommandEventListener("click", true, config.clickScript, subject);
        }
        config.parent.append(this.elem);
        this._selected = false;
    }

    configure(block) {
        block(this);
        return this;
    }

    get isSelected() {
        return this._selected;
    }
    set isSelected(value) {
        this._selected = value;
        this.elem.addRemClass("selected", value);
    }
}

class RootView {
    constructor() {
        this.game = null;
        this.root = document.querySelector("main");
        this.newGamePrompt = new NewGamePrompt();
        this.views = [];
    }

    setUp() {
        this._configureCommmands();
        this.newGamePrompt.show();
    }

    initialize(game) {
        this.game = game;
        if (!game) { return; }
        this.views.push(new PaletteView({ game: game, root: this.root.querySelector("palette") }));
        this.views.push(new MapRenderer({ game: game, canvas: this.root.querySelector("canvas.mainMap") }));
        this.views.push(new ControlsView({ game: game, root: this.root.querySelector("controls") }));
    }

    failedToLoadBaseData() {
        new Gaming.Prompt({
            title: Strings.str("failedToLoadGameTitle"),
            message: Strings.str("failedToLoadGameMessage"),
            requireSelection: true
        }).show();
    }

    showGameHelp() {
        var helpSource = this.root.querySelector("help");
        new Gaming.Prompt({
            customContent: helpSource.cloneNode(true).addRemClass("hidden", false),
            buttons: [ {label: Strings.str("helpDismiss")} ]
        }).show();
    }

    _configureCommmands() {
        GameScriptEngine.shared.registerCommand("showGameHelp", () => this.showGameHelp());
    }
}

class PaletteView {
    constructor(config) {
        this.root = config.root;
        this.settings = MapToolController.settings();
        this.root.style.width = `${this.settings.paletteStyle.tileWidth}px`;
        this.root.removeAllChildren();
        this.buttons = this.settings.defaultPalette.map(id => this._makeToolButton(id));
        this.update();
        MapToolController.shared.kvo.activeSession.addObserver(this, () => this.update());
    }

    update() {
        this.buttons.forEach(button => {
            button.isSelected = MapToolController.shared.isToolIDActive(button.id);
        });
    }

    _makeToolButton(id) {
        var tool = MapToolController.shared.toolWithID(id);
        var button = new ToolButton({
            id: id,
            parent: this.root,
            title: tool.settings.iconGlyph,
            size: { width: this.settings.paletteStyle.tileWidth, height: this.settings.paletteStyle.tileWidth },
            clickScript: "selectTool",
            clickScriptSubject: id
        });
        return button;
    }
}

class ControlsView {
    constructor(config) {
        this.game = config.game;
        this.root = config.root;
        this.views = [];
        this.root.style["padding-left"] = `${GameContent.shared.mapTools.paletteStyle.tileWidth}px`;
        this.views.push(new NewsView({ game: this.game, root: document.querySelector("#news") }));
        this.views.push(new CityStatusView({ game: this.game, root: document.querySelector("#cityStatus") }));
        this.views.push(new RCIView({ game: this.game, root: document.querySelector("#rci") }));
        this.views.push(new MapControlsView({ game: this.game, root: document.querySelector("#view nav") }))
        this.views.push(new GameEngineControlsView({ game: this.game, root: document.querySelector("#engine") }));
        this.buttons = [];
        this.buttons.push(new ToolButton({
            parent: this.root.querySelector("#system"),
            title: Strings.str("helpButtonLabel"),
            clickScript: "showGameHelp"
        }));
        this.buttons.push(new ToolButton({
            parent: this.root.querySelector("#system"),
            title: Strings.str("optionsButtonLabel"),
            clickScript: "showFileMenu"
        }));
    }
}

class CityStatusView {
    constructor(config) {
        this.game = config.game;
        this.views = { root: config.root };
        this.views.name = new TextLineView({ parent: config.root, title: Strings.str("cityStatusNameLabel"), binding: {
            source: this.game.city.kvo.name
        } });
        this.views.date = new TextLineView({ parent: config.root, title: Strings.str("cityStatusDateLabel"), binding: {
            source: this.game.city.time.kvo.date, sourceFormatter: value => value.longString()
        } });
        this.views.cash = new TextLineView({ parent: config.root, title: Strings.str("cityStatusCashLabel"), binding: {
            source: this.game.city.budget.kvo.cash, sourceFormatter: Simoleon.format
        } });
        this.views.population = new TextLineView({ parent: config.root, title: Strings.str("cityStatusPopulationLabel"), binding: {
            source: this.game.city.kvo.population, sourceFormatter: value => Number.uiInteger(value.R)
        } });
        this.game.city.time.kvo.date.addObserver(this, kvo => this._updateDocumentTitle());
        this.game.city.kvo.name.addObserver(this, kvo => this._updateDocumentTitle());
        this._updateDocumentTitle();
    }

    _updateDocumentTitle() {
        var newTitle = Strings.template("windowTitleTemplate", {
            name: this.game.city.name,
            date: this.game.city.time.date.mediumString(),
            gameProductTitle: Strings.str("gameProductTitle")
        });
        if (document.title != newTitle) {
            document.title = newTitle;
        }
    }
}

class RCIView {
    constructor(config) {
        this.game = config.game;
        this.root = config.root;
        this.canvas = config.root.querySelector("canvas");
        this.style = GameContent.shared.rciView;
        this.deviceScale = HTMLCanvasElement.getDevicePixelScale();
        this.render();
        this.game.city.kvo.rciDemand.addObserver(this, value => this.render());
    }

    render() {
        var ctx = this.canvas.getContext("2d");
        this.canvas.width = this.canvas.clientWidth * this.deviceScale;
        this.canvas.height = this.canvas.clientHeight * this.deviceScale;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${this.style.fontSize}px sans-serif`;
        var rci = this.game.city.rciDemand;
        this._renderItem(ctx, 0, rci.R);
        this._renderItem(ctx, 1, rci.C);
        this._renderItem(ctx, 2, rci.I);
    }

    _renderItem(ctx, index, value) {
        var barWidth = this.canvas.width * this.style.barWidth;
        var barSpacing = (this.canvas.width - (this.style.bars.length * barWidth)) / (this.style.bars.length - 1);
        var barOriginX = index * (barWidth + barSpacing);
        var centerY = this.canvas.height / 2;
        
        var textCenter = new Gaming.Point(barOriginX + 0.5 * barWidth, centerY);
        ctx.fillStyle = this.style.bars[index].color;
        ctx.textFill(this.style.bars[index].title, textCenter);

        if (Math.abs(value) > 0.01) {
            var textHeightPlusPadding = this.style.fontSize + 2 * this.deviceScale * this.style.textSpacing;
            var availableHeight = 0.5 * (this.canvas.height - textHeightPlusPadding);
            var barHeight = value * availableHeight;
            var barOriginY = 0;
            if (value > 0) {
                barOriginY = centerY - 0.5 * textHeightPlusPadding - barHeight;
            } else {
                barOriginY = centerY + 0.5 * textHeightPlusPadding;
            }
            var rect = new Gaming.Rect(barOriginX, barOriginY, barWidth, barHeight).rounded();
            ctx.rectFill(rect);
        }
    }
}

class GameEngineControlsView {
    constructor(config) {
        this.game = config.game;
        this.root = config.root;

        var playPause = config.root.querySelector("playPause");
        this.pauseButton = new ToolButton({
            parent: playPause,
            title: "||",
            clickScript: "pauseResume"
        }).configure(button => button.elem.addRemClass("stop-indication", true));
        this.playButton = new ToolButton({
            parent: config.root.querySelector("playPause"),
            title: ">",
            clickScript: "pauseResume"
        });

        var speedRoot = config.root.querySelector("speedSelector");
        this.speedButtons = GameContent.shared.gameRules.speeds.map((s, index) => new ToolButton({
            parent: speedRoot,
            title: s.glyph,
            clickScript: "setEngineSpeed",
            clickScriptSubject: index
        }));
        this.speedButtons[1].isSelected = true;

        this.frameRateView = new TextLineView({ parent: config.root.querySelector("frameRate") })
            .configure(view => view.elem.addRemClass("minor", true));
        this._lastFrameRateUpdateTime = 0;

        uiRunLoop.addDelegate(this);
        engineRunLoop.addDelegate(this);
        this._updateFrameRateLabel();
        this._updateGameEngineControls();
    }

    processFrame(rl) {
        if (rl == uiRunLoop) {
            this._frameCounter += 1;
            this._updateFrameRateLabel();
        }
        if (rl == engineRunLoop) {
            this._updateGameEngineControls();
        }
    }

    runLoopDidPause(rl) {
        if (rl == engineRunLoop) { this._updateGameEngineControls(); }
    }

    runLoopWillResume(rl) {
        if (rl == engineRunLoop) { this._updateGameEngineControls(); }
    }

    runLoopDidChange(rl) {
        if (rl == engineRunLoop) { this._updateGameEngineControls(); }
    }

    _updateFrameRateLabel() {
        // TODO can probably calculate if a run loop is "pegged", meaning that the execution time for a 
        // single frame is >= the time allowed for a single full-speed frame.
        var now = Date.now();
        if (Math.abs(now - this._lastFrameRateUpdateTime) < 1000) { return; }
        this._lastFrameRateUpdateTime = now;

        var rates = [];
        var uiFrameRate = uiRunLoop.getRecentFramesPerSecond();
        if (!isNaN(uiFrameRate)) {
            rates.push(Strings.template("uiFpsLabel", { value: Math.round(uiFrameRate) }));
        }
        var engineFrameRate = engineRunLoop.getRecentMillisecondsPerFrame();
        if (!isNaN(engineFrameRate)) {
            rates.push(Strings.template("engineMsPerDayLabel", { value: Math.round(engineFrameRate) }));
        }

        this.frameRateView.value = rates.join(Strings.str("frameRateTokenSeparator"));
    }

    _updateGameEngineControls() {
        this.pauseButton.isSelected = !this.game.isRunning;
        this.playButton.isSelected = this.game.isRunning;

        var speedIndex = Game.rules().speeds.indexOf(this.game.city.time.speed);
        GameContent.shared.gameRules.speeds.forEach((speed, index) => {
            if (index < this.speedButtons.length) {
                this.speedButtons[index].isSelected = (index == speedIndex);
            }
        });
    }
}

class MapControlsView {
    constructor(config) {
        this.root = config.root;
        this.buttons = [];

        var directionElem = config.root.querySelector("direction");
        this.buttons.push(new ToolButton({
            parent: config.root.querySelector("#map-nav-l"),
            title: "L"
        }));
        this.buttons.push(new ToolButton({
            parent: config.root.querySelector("#map-nav-ud"),
            title: "U"
        }));
        this.buttons.push(new ToolButton({
            parent: config.root.querySelector("#map-nav-ud"),
            title: "D"
        }));
        this.buttons.push(new ToolButton({
            parent: config.root.querySelector("#map-nav-r"),
            title: "R"
        }));

        // TODO consider zoomselector class
        var zoomElem = config.root.querySelector("zoom");
        this.buttons.push(new ToolButton({
            parent: zoomElem,
            title: Strings.str("zoomOutButtonGlyph"),
            clickScript: "zoomOut"
        }));
        this.buttons.push(new ToolButton({
            parent: zoomElem,
            title: Strings.str("zoomInButtonGlyph"),
            clickScript: "zoomIn"
        }));
    }
}

class NewsView {
    constructor(config) {
        this.root = config.root;
        this.root.innerText = ""; //"37 llamas to enter hall of fame in ceremony tonight…";
        this.root.addEventListener("click", evt => {
            evt.preventDefault();
            debugLog("TODO Show news viewer dialog");
        });
    }
}

class MapRenderer {
    constructor(config) {
        this.canvas = config.canvas;
        var zoomers = this.settings.zoomLevels.map((z) => new ZoomSelector(z, this));
        this.zoomSelection = new SelectableList(zoomers);
        this.initialize(config.game);
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
        this.game.city.map.visitEachPlot((plot) => r.render(plot, ctx));
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
        ctx.globalAlpha = UI.fadeOpacity(age, feedback.displayMilliseconds, this._style.feedbackFadeMilliseconds);
        if (feedback.driftPerMillisecond) {
            ctx.translate(feedback.driftPerMillisecond.x * age, feedback.driftPerMillisecond.y * age);
        }
        var rect = this.canvasGrid.rectForTileRect(item.focusTileRect);
        feedback.painter.render(ctx, rect, this.canvasGrid, item);
        ctx.restore();
    }
}

class ScriptPainterCollection {
    static defaultExpectedSize() {
        return { width: 1, height: 1 };
    }

    static fromYaml(source, deviceScale) {
        var config = jsyaml.safeLoad(source);
        if (!config) { return null; }
        return ScriptPainterCollection.fromObject(config, deviceScale);
    }

    static fromObject(config, deviceScale) {
        if (config instanceof Array) {
            config = { variants: [config], expectedSize: ScriptPainterCollection.defaultExpectedSize(), deviceScale: deviceScale };
        } else {
            if (!(config.variants instanceof Array) || (config.variants.length < 1)) {
                throw new TypeError("Invalid ScriptPainter YAML: empty variants array.");
            }
            config = { variants: config.variants, expectedSize: config.expectedSize || ScriptPainterCollection.defaultExpectedSize(), deviceScale: deviceScale };
        }
        if (!config.variants.every(item => item instanceof Array)) {
            throw new TypeError("Invalid ScriptPainter YAML: invalid lines.");
        }
        if (!config.expectedSize || config.expectedSize.width < 1 || config.expectedSize.height < 1) {
            throw new TypeError("Invalid ScriptPainter YAML: invalid expectedSize.");
        }
        return new ScriptPainterCollection(config);
    }

    constructor(config) {
        this.config = config;
        this.variants = config.variants.map(item => new ScriptPainter({ lines: item, expectedSize: config.expectedSize, deviceScale: config.deviceScale }));
    }

    get rawSource() {
        var data = {};
        if (this.config.expectedSize.width == 1 && this.config.expectedSize.height == 1) {
            if (this.variants.length == 1) {
                return jsyaml.dump(this.variants[0].lines, {condenseFlow: true, flowLevel: 1});
            } else {
                data = { variants: this.variants.map(v => v.lines) };
            }
        } else {
            data = { variants: this.variants.map(v => v.lines), expectedSize: this.config.expectedSize };
        }
        return jsyaml.dump(data, {condenseFlow: true, flowLevel: 3});
    }

    getVariant(variantKey) {
        return this.variants[variantKey % this.variants.length];
    }
}

class ScriptPainter {

    // throws
    static fromYaml(source, expectedSize, deviceScale) {
        var lines = jsyaml.safeLoad(source);
        if (lines instanceof Array) {
            return new ScriptPainter({ lines: lines, expectedSize: expectedSize, deviceScale: deviceScale });
        } else {
            throw new TypeError("ScriptPainter YAML source is not an array.");
        }
    }

    constructor(config) {
        this.lines = config.lines;
        this.expectedSize = config.expectedSize;
        this.deviceScale = config.deviceScale;
        this.rDomain = _zeroToOne;
    }

    get rawSource() {
        return jsyaml.dump(this.lines, {condenseFlow: true, flowLevel: 1});
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
        this.collectionCache = {};
    }

    getPainterCollection(id) {
        var found = this.collectionCache[id];
        if (found) { return found; }
        var data = GameContent.shared.painters[id];
        if (!data) { return null; }
        try {
            var item = ScriptPainterCollection.fromObject(data, this.deviceScale);
            if (!item) { return null; }
            this.cache[id] = item;
            return item;
        } catch(e) {
            debugLog(e.message);
            return null;
        }
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
        var expectedSize = data.expectedSize ? data.expectedSize : { width: 1, height: 1 };
        var ds = this.deviceScale;
        this.cache[id] = variants.map(v => new ScriptPainter({ lines: v, expectedSize: expectedSize, deviceScale: ds }));
        return this.getPainter(id, variantKey)
    }
}

// #################### MISC UI #####################

class Strings {
    static str(id) {
        return GameContent.shared.strings[id] || `?${id}?`;
    }
    static template(id, data) {
        var template = Strings.str(id);
        return template ? String.fromTemplate(template, data) : null;
    }
}

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
            name: Strings.str("defaultCityName"),
            terrain: terrain,
            difficulty: Game.rules().difficulties.easy
        });
        CitySim.game = new Game({
            city: city,
            rootView: rootView
        });
        CitySim.game.start();
    };
    show() {
        if (!CitySim.game) {
            this.startNewGame();
            return;
        }
        new Gaming.Prompt({
            title: Strings.str("newGamePromptTitle"),
            message: Strings.str("newGamePromptMessage"),
            buttons: [
                { label: Strings.str("newGamePromptStartButton"), action: this.startNewGame.bind(this), classNames: ["warning"] },
                { label: Strings.str("genericCancelButton") }
            ]
        }).show();
    }
}

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
    var rootView = new RootView();
}

var initialize = async function() {
    var content = await GameContent.loadYamlFromLocalFile("city-content.yaml", GameContent.cachePolicies.forceOnFirstLoad);
    dataIsReady(content);
};

var dataIsReady = function(content) {
    if (!content) {
        rootView.failedToLoadBaseData();
        return;
    }
    GameContent.shared = content;
    GameScriptEngine.shared = new GameScriptEngine();
    ScriptPainterStore.shared = new ScriptPainterStore();
    KeyInputController.shared = new KeyInputController();
    MapToolController.shared = new MapToolController();
    rootView.setUp();
};

return {
    game: null,
    engineRunLoop: engineRunLoop,
    uiRunLoop: uiRunLoop,
    rootView: rootView,
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
    MapRenderer: MapRenderer,
    NewGamePrompt: NewGamePrompt,
    ScriptPainter: ScriptPainter,
    ScriptPainterCollection: ScriptPainterCollection,
    ScriptPainterStore: ScriptPainterStore
};

})(); // end CitySim namespace

if (!window.doNotInitializeGame) {
    CitySim.initialize();
}
