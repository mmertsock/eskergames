"use-strict";

window.Painter = (function() {

const debugLog = Gaming.debugLog;
const FlexCanvasGrid = Gaming.FlexCanvasGrid;
const once = Gaming.once;
const PerfTimer = Gaming.PerfTimer;
const Point = Gaming.Point;
const Rect = Gaming.Rect;
const Rng = Gaming.Rng;

const GameContent = CitySimContent.GameContent;
const ScriptPainter = CitySim.ScriptPainter;
const ScriptPainterCollection = CitySim.ScriptPainterCollection;
const ScriptPainterSession = CitySim.ScriptPainterSession;
const ScriptPainterStore = CitySim.ScriptPainterStore;

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
        this.tileVariantSelection = new VariantSelectorView(root.querySelector("select.tile"));
        this.scriptEntry = new ScriptEntryView(root.querySelector(".scriptEntry textarea"));
        this.metadataEntry = new MetadataEntryView(root.querySelector(".metadata textarea"));
        this.canvasViews = Array.from(root.querySelectorAll("canvas")).map(canvas => new CanvasView(canvas, sectionIndex));
        this.views = [this.scriptSelection, this.tileVariantSelection, this.scriptEntry, this.metadataEntry];
        this.views.concat(this.canvasViews);
        root.querySelector("button.selectScript").captureEventListener("click", () => this.loadScriptFromStore());
        root.querySelector("button.render").captureEventListener("click", () => this.renderInput());
        root.querySelector("button.renderAll").captureEventListener("click", () => this.renderAllScripts());
        root.querySelector("button.reset").captureEventListener("click", () => this.reset());
    }

    get isPerfTest() {
        return this.root.querySelector(".perfTest input").checked;
    }

    loadScriptFromStore() {
        let id = this.scriptSelection.selectedID;
        if (!id) { return; }
        let collection = ScriptPainterStore.shared.getPainterCollection(id);
        if (!collection) {
            showMessage("Failed to find script " + id);
            return;
        }
        this.scriptEntry.collectionID = collection.id;
        this.scriptEntry.scriptSource = collection.rawSource;
        this.tileVariantSelection.setCollection(collection);
    }

    renderInput() {
        try {
            var collection = ScriptPainterCollection.fromYaml(this.scriptEntry.collectionID, this.scriptEntry.scriptSource, CanvasView.deviceScale());
            var metadata = this.metadataEntry.value;
            this._perfTestIfNeeded((views, isPerfTest) => {
                views.forEach(view => view.render(collection, metadata, isPerfTest, this.tileVariantSelection.selectedVariant));
            });
        } catch (e) {
            showMessage(`Invalid script: ${e.message}`, this.root.querySelector(".scriptEntry"));
            debugLog(e);
            this.scriptEntry.markInvalid();
        }
    }

    renderAllScripts() {
        var metadata = this.metadataEntry.value;
        var allCollections = ScriptSelectorView.allPainterIDs()
            .map(id => ScriptPainterStore.shared.getPainterCollection(id))
            .filter(collection => collection != null);
        this._perfTestIfNeeded((views, isPerfTest) => {
            views.forEach(view => view.renderAll(allCollections, metadata, isPerfTest));
        });
    }

    reset() {
        this.views.forEach((view) => { if (view.reset) { view.reset(); } });
    }

    _perfTestIfNeeded(block) {
        if (!this.isPerfTest) {
            block(this.canvasViews, false);
            return;
        }
        let iterations = 1000;
        let overall = new PerfTimer("TotalRenderTime").start();
        let views = [this.canvasViews[0]];
        for (let i = 0; i < iterations; i +=1 ) { block(views, true); }
        let info = overall.end().summaryInfo;
        if (info) {
            showMessage(`Render time (${iterations} iterations): ${info.ms} ms total, ${info.ms / iterations} ms average`);
        }
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

    get drawContext() {
        return this.canvas.getContext("2d", { alpha: true });
    }

    get debugLoggingEnabled() {
        return this.sectionIndex == 0 && this.canvas.className == "large";
    }

    reset() {
        this.render(null);
    }

    render(collection, metadata, isPerfTest, variantToTile) {
        var ctx = this.drawContext;
        if (isPerfTest) {
            collection.variants.forEach((variant, i) => this._perfRenderVariant(ctx, collection.id, variant, metadata, i));
            return;
        }
        this._renderBackground(ctx);
        if (!collection) { return; }

        if (!isNaN(variantToTile)) {
            let rect = new Rect(0, 0, this.canvasGrid.tilesWide, this.canvasGrid.tilesHigh);
            let columns = this.canvasGrid.tilesWide;
            let spacing = 0;
            for (let y = 0; y < rect.height; y += 1) {
                for (let x = 0; x < rect.width; x += 1) {
                    this._tileVariantIndexes(collection, variantToTile, x, y).forEach(i => {
                        let variant = collection.variants[i];
                        this._renderVariant(ctx, collection.id, variant, metadata, x + y * rect.width, rect.width, rect.origin, spacing);
                    });
                }
            }
        } else {
            let columns = 3;
            let offset = new Point(1, 1);
            let spacing = this._spacingForCollection(collection);
            collection.variants.forEach((variant, i) => this._renderVariant(ctx, collection.id, variant, metadata, i, columns, offset, spacing));
        }
    }

    renderAll(allCollections, metadata, isPerfTest) {
        var ctx = this.drawContext;
        if (isPerfTest) {
            allCollections.forEach(collection => {
                collection.variants.forEach((variant, i) => this._perfRenderVariant(ctx, collection.id, variant, metadata, i));
            });
            return;
        }
        this._renderBackground(ctx);
        var sorted = allCollections.sort((a, b) => this._spacingForCollection(a) - this._spacingForCollection(b));
        var nextY = 0;
        sorted.forEach((collection) => {
            var columns = collection.variants.length;
            var offset = new Point(0, nextY);
            var spacing = this._spacingForCollection(collection) - 1;
            nextY = nextY + spacing + 1;
            collection.variants.forEach((variant, i) => this._renderVariant(ctx, collection.id, variant, metadata, i, columns, offset, spacing));
        });
    }

    _spacingForCollection(collection) {
        return Math.max(collection.config.expectedSize.width, collection.config.expectedSize.height);
    }

    _renderBackground(ctx) {
        ctx.fillStyle = "white"; //GameContent.shared.mainMapView.emptyFillStyle;
        ctx.rectFill(this.canvasGrid.rectForFullCanvas);

        // add 1 tile padding in each direction to fill the edges
        for (var y = -1; y <= this.canvasGrid.tilesHigh; y += 1) {
            for (var x = -1; x <= this.canvasGrid.tilesWide; x += 1) {
                var isDark = (x + y) % 2;
                if (isDark) {
                    ctx.fillStyle = "hsla(0, 0%, 0%, 0.05)";
                    ctx.rectFill(this.canvasGrid.rectForTile(new Point(x, y)));
                }
            }
        }
    }

    _renderVariant(ctx, painterID, variant, metadata, i, columns, offset, spacing) {
        var origin = new Point((1 + spacing) * (i % columns), (1 + spacing) * Math.floor(i / columns)).adding(offset);
        var rect = this.canvasGrid.rectForTileRect(new Rect(origin, variant.expectedSize));
        var session = new ScriptPainterSession(painterID, i, variant);
        variant.render(ctx, rect, this.canvasGrid, metadata);
    }

    _perfRenderVariant(ctx, painterID, variant, metadata, i) {
        var rect = this.canvasGrid.rectForTileRect(new Rect(new Point(0, 0), variant.expectedSize));
        var session = new ScriptPainterSession(painterID, i, variant);
        variant.render(ctx, rect, this.canvasGrid, metadata);
    }

    _tileVariantIndexes(collection, selectedIndex, x, y) {
        if (selectedIndex >= 0) return [selectedIndex];
        if (selectedIndex == -1) {
            return [Rng.shared.nextIntOpenRange(0, collection.variants.length)];
        }
        let grid = GameContent.shared.painterTool.edgeSimulationGrid;
        let row = grid[y % grid.length].split(",");
        let value = row[x % row.length];
        if (value == "X") { return []; }
        return value.split("").map(i => parseInt(i));
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

class VariantSelectorView {
    constructor(elem) {
        this.elem = elem;
        this.setCollection(null);
    }

    setCollection(collection) {
        while (this.elem.options.length > 1) { // keep first choice
            this.elem.remove(1);
        }
        if (!collection) { return; }
        if (collection.variants.length > 1) this.elem.add(new Option("Randomize", -1));
        if (collection.variants.length == 9) this.elem.add(new Option("Edge Patterns", -2));
        collection.variants.forEach((variant, i) => {
            this.elem.add(new Option(i, i));
        });
    }

    reset() { this.setCollection(null); }

    get selectedVariant() {
        return this.elem.selectedOptions.length > 0 ? parseInt(this.elem.selectedOptions[0].value) : NaN;
    }
}

class ScriptEntryView {
    constructor(elem) {
        this.elem = elem;
        this.collectionID = "(unknown)";
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
            debugLog(e);
            return {};
        }
    }
}

let initialize = function() {
    RootController.shared = new RootController();
    showMessage("Ready.");
}

return {
    initialize: initialize
};

})();

cityReady("painter.js");
