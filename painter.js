"use-strict";

window.Painter = (function() {

var debugLog = Gaming.debugLog;
var once = Gaming.once;
var Point = Gaming.Point;
var Rect = Gaming.Rect;
var FlexCanvasGrid = Gaming.FlexCanvasGrid;
var GameContent = CitySimContent.GameContent;
var ScriptPainterCollection = CitySim.ScriptPainterCollection;
var ScriptPainter = CitySim.ScriptPainter;
var ScriptPainterStore = CitySim.ScriptPainterStore;

function showMessage(msg, elem) {
    debugLog(msg);
    document.querySelector("footer textarea").value += msg + "\n";
    if (!elem) { return; }
    clearPopovers();
    var popover = document.querySelector(".popover").cloneNode(true).addRemClass("cloned", true);
    popover.addEventListener("click", () => popover.remove());
    popover.querySelector("p").innerText = msg;
    debugLog(popover);
    elem.append(popover);
}
function resetMessageArea() {
    document.querySelector("footer textarea").value = "";
}
function clearPopovers() {
    Array.from(document.querySelectorAll(".popover.cloned")).forEach(item => item.remove());
}

_nextListenerID = 0;
_elementsWithListeners = [];
EventTarget.prototype.captureEventListener = function(type, block) {
    var id = "id" + _nextListenerID;
    var func = function(event) { block(event); };
    this.addEventListener(type, func);
    if (!this._eventListeners) { this._eventListeners = {}; }
    this._eventListeners[id] = { type: type, func: func };
    _nextListenerID = _nextListenerID + 1;
    _elementsWithListeners.push(this);
    return id;
};
EventTarget.prototype.removeCapturedEventListener = function(id) {
    if (!this._eventListeners || !this._eventListeners[id]) { return; }
    var info = this._eventListeners[id];
    this.removeEventListener(info.type, info.func);
    delete this._eventListeners[id];
};
EventTarget.prototype.removeAllCapturedEventListeners = function() {
    if (!this._eventListeners) { return; }
    var ids = Object.getOwnPropertyNames(this._eventListeners);
    ids.forEach(id => this.removeCapturedEventListener(id));
};
EventTarget.removeCapturedEventListenersGlobally = function() {
    _elementsWithListeners.forEach(e => e.removeAllCapturedEventListeners());
    _elementsWithListeners = [];
};

class RootController {

    static defaultSettings() {
        return {
            tileSizes: {
                large: 24,
                medium: 12,
                small: 6
            }
        };
    }

    constructor() {
        if (RootController.shared) {
            RootController.shared.shutDown();
        }

        this.views = [];
        this.views.push(new HeaderView(document.querySelector("header")));
        this.views.concat(Array.from(document.querySelectorAll("section")).map((section, i) => new SectionView(section, i)));
        this.views.push(new FooterView(document.querySelector("footer")));
    }

    shutDown() {
        EventTarget.removeCapturedEventListenersGlobally();
        this.views.forEach(v => { if (v.shutDown) { v.shutDown(); }});
    }
}
RootController.shared = null;
RootController.settings = RootController.defaultSettings();

class HeaderView {
    constructor(root) {
        this.elems = {
            root: root
        };
        root.querySelector("button").captureEventListener("click", () => this.reset());
    }

    reset() {
        RootController.settings = RootController.defaultSettings();
        initialize();
    }
}

class SectionView {
    constructor(root, sectionIndex) {
        this.root = root;
        this.scriptSelection = new ScriptSelectorView(root.querySelector(".scriptSelection select"));
        this.scriptEntry = new ScriptEntryView(root.querySelector(".scriptEntry textarea"));
        this.metadataEntry = new MetadataEntryView(root.querySelector(".metadata textarea"));
        this.canvasViews = Array.from(root.querySelectorAll("canvas")).map(canvas => new CanvasView(canvas, sectionIndex));
        this.views = [this.scriptSelection, this.scriptEntry, this.metadataEntry];
        this.views.concat(this.canvasViews);
        root.querySelector("button.selectScript").captureEventListener("click", () => this.loadScriptFromStore());
        root.querySelector("button.render").captureEventListener("click", () => this.renderInput());
        root.querySelector("button.renderAll").captureEventListener("click", () => this.renderAllScripts());
        root.querySelector("button.reset").captureEventListener("click", () => this.reset());
    }

    loadScriptFromStore() {
        var id = this.scriptSelection.selectedID;
        if (!id) { return; }
        var collection = ScriptPainterStore.shared.getPainterCollection(id);
        if (!collection) {
            showMessage("Failed to find script " + id);
            return;
        }
        this.scriptEntry.scriptSource = collection.rawSource;
    }

    renderInput() {
        try {
            var collection = ScriptPainterCollection.fromYaml(this.scriptEntry.scriptSource, CanvasView.deviceScale());
            var metadata = this.metadataEntry.value;
            this.canvasViews.forEach(view => view.render(collection, metadata));
        } catch (e) {
            showMessage(`Invalid script: ${e.message}`, this.root.querySelector(".scriptEntry"));
            this.scriptEntry.markInvalid();
        }
    }

    renderAllScripts() {
        var metadata = this.metadataEntry.value;
        var allCollections = ScriptSelectorView.allPainterIDs()
            .map(id => ScriptPainterStore.shared.getPainterCollection(id))
            .filter(collection => collection != null);
        this.canvasViews.forEach(view => view.renderAll(allCollections, metadata));
    }

    reset() {
        this.views.forEach((view) => { if (view.reset) { view.reset(); } });
    }
}

class FooterView {
    constructor(root) {
        root.querySelector("button").captureEventListener("click", () => resetMessageArea());
    }
}

class CanvasView {

    static deviceScale() {
        return FlexCanvasGrid.getDevicePixelScale();
    }

    constructor(canvas, sectionIndex) {
        this.canvas = canvas;
        this.sectionIndex = sectionIndex;
        this.style = {
            tileWidth: RootController.settings.tileSizes[canvas.className]
        };
        this.canvasGrid = new FlexCanvasGrid({
            canvas: this.canvas,
            deviceScale: CanvasView.deviceScale(),
            tileWidth: this.style.tileWidth,
            tileSpacing: 0
        });
        this.render(null);
    }

    get debugLoggingEnabled() {
        return this.sectionIndex == 0 && this.canvas.className == "large";
    }

    reset() {
        this.render(null);
    }

    render(collection, metadata) {
        var ctx = this.canvas.getContext("2d");
        this._renderBackground(ctx);
        if (!collection) { return; }

        var columns = 3;
        var offset = new Point(1, 1);
        var spacing = this._spacingForCollection(collection);
        collection.variants.forEach((variant, i) => this._renderVariant(ctx, variant, metadata, i, columns, offset, spacing));
    }

    renderAll(allCollections, metadata) {
        var ctx = this.canvas.getContext("2d");
        var sorted = allCollections.sort((a, b) => this._spacingForCollection(a) - this._spacingForCollection(b));
        var nextY = 0;
        sorted.forEach((collection) => {
            var columns = collection.variants.length;
            var offset = new Point(0, nextY);
            var spacing = this._spacingForCollection(collection) - 1;
            nextY = nextY + spacing + 1;
            collection.variants.forEach((variant, i) => this._renderVariant(ctx, variant, metadata, i, columns, offset, spacing));
        });
    }

    _spacingForCollection(collection) {
        return Math.max(collection.config.expectedSize.width, collection.config.expectedSize.height);
    }

    _renderBackground(ctx) {
        ctx.fillStyle = GameContent.shared.mainMapView.emptyFillStyle;
        ctx.rectFill(this.canvasGrid.rectForFullCanvas);

        // add 1 tile padding in each direction to fill the edges
        for (var y = -1; y <= this.canvasGrid.tilesHigh; y += 1) {
            for (var x = -1; x <= this.canvasGrid.tilesWide; x += 1) {
                var isDark = (x + y) % 2;
                if (isDark) {
                    ctx.fillStyle = "hsla(0, 0%, 0%, 0.03)";
                    ctx.rectFill(this.canvasGrid.rectForTile(new Point(x, y)));
                }
            }
        }
    }

    _renderVariant(ctx, variant, metadata, i, columns, offset, spacing) {
        var origin = new Point((1 + spacing) * (i % columns), (1 + spacing) * Math.floor(i / columns)).adding(offset);
        var rect = this.canvasGrid.rectForTileRect(new Rect(origin, variant.expectedSize));
        variant.render(ctx, rect, this.canvasGrid, metadata);
    }
}

class ScriptSelectorView {

    static allPainterIDs() {
        return Object.getOwnPropertyNames(GameContent.shared.painters);
    }

    constructor(elem) {
        this.elem = elem;
        while (this.elem.options.length > 0) {
            this.elem.remove(0);
        }
        if (!GameContent.shared) { return; }
        this.elem.add(new Option("Predefined Scripts", "", true));
        ScriptSelectorView.allPainterIDs().forEach(id => {
            this.elem.add(new Option(id, id));
        });
    }

    get selectedID() {
        return this.elem.selectedOptions.length > 0 ? this.elem.selectedOptions[0].value : null;
    }
}

class ScriptEntryView {
    constructor(elem) {
        this.elem = elem;
        this.reset();
        this.elem.captureEventListener("input", () => this.clearInvalid());
    }

    reset() {
        this.elem.value = "";
        this.clearInvalid();
    }

    get scriptSource() {
        return this.elem.value.trim();
    }

    set scriptSource(value) {
        if (value) {
            this.elem.value = value;
        } else {
            this.reset();
        }
        this.clearInvalid();
    }

    markInvalid() {
        this.elem.addRemClass("invalid", true);
    }

    clearInvalid() {
        clearPopovers();
        this.elem.addRemClass("invalid", false);
    }
}

class MetadataEntryView {
    constructor(elem) {
        this.elem = elem;
        this.reset();
    }

    reset() {
        this.elem.value = "";
    }

    get value() {
        if (this.elem.value.trim() == "") { return {}; }
        try {
            return JSON.parse(this.elem.value);
        } catch (e) {
            showMessage("Invalid metadata: " + e.message, this.elem);
            return {};
        }
    }
}

function dataIsReady(content) {
    if (!content) {
        showMessage("Failed to initialize CitySim base data.");
        return;
    }
    GameContent.shared = content;
    ScriptPainterStore.shared = new ScriptPainterStore();
    RootController.shared = new RootController();
    showMessage("Ready.");
}

var initialize = async function() {
    showMessage("Initializing...");
    var content = await GameContent.loadYamlFromLocalFile("city-content.yaml", GameContent.cachePolicies.forceOnFirstLoad);
    dataIsReady(content);
};

return {
    initialize: initialize
};

})();

Painter.initialize();