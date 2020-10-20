"use-strict";

self.CitySim = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;

const Binding = Gaming.Binding;
const CanvasStack = Gaming.CanvasStack;
const CircularArray = Gaming.CircularArray;
const ChangeTokenBinding = Gaming.ChangeTokenBinding;
const Easing = Gaming.Easing;
const FlexCanvasGrid = Gaming.FlexCanvasGrid;
const GameContent = Gaming.GameContent;
const KeyInputController = Gaming.KeyInputController;
const Kvo = Gaming.Kvo;
const Point = Gaming.Point;
const Rect = Gaming.Rect;
const Rng = Gaming.Rng;
const SaveStateCollection = Gaming.SaveStateCollection;
const SaveStateItem = Gaming.SaveStateItem;
const SelectableList = Gaming.SelectableList;
const Strings = Gaming.Strings;
const TilePlane = Gaming.TilePlane;
const Vector = Gaming.Vector;

function mark__Utility() {} // ~~~~~~ Utility ~~~~~~

class JSONRequest {
    constructor(url) {
        this.url = url;
        this.request = new XMLHttpRequest();
        this.blocks = {
            successFilter: (request) => { return request.request.status >= 200 && request.request.status < 300 },
            completion: (item, request) => {},
            parseError: (e, request) => {
                debugWarn(`Error parsing ${request.url}: ${e}`);
            }
        };
        this.request.addEventListener("load", () => {
            if (!this.blocks.successFilter(this)) {
                return;
            }
            let item = null;
            try {
                item = JSON.parse(this.request.response);
            } catch (e) {
                this.blocks.parseError(e, this);
                return;
            }
            this.blocks.completion(item, this);
        });
    }
    successFilter(block) {
        this.blocks.successFilter = block;
        return this;
    }
    completion(block) {
        this.blocks.completion = block;
        return this;
    }
    parseError(block) {
        this.blocks.parseError = block;
        return this;
    }
    send() {
        this.request.open("GET", this.url);
        this.request.send();
        return this;
    }
} // end JSONRequest

function mark__UI_Controls() {} // ~~~~~~ UI Controls ~~~~~~

class UI {
    static fadeOpacity(currentAge, targetAge, duration) {
        return Math.clamp((targetAge - currentAge) / duration, _zeroToOne);
    }
}

function mark__Sprite_Management() {} // ~~~~~~ Sprite Management ~~~~~~

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

    render(ctx, rect, canvasGrid, modelMetadata, session) {
        // TODO can we compile the lines so you don't parse them every frame?
        // Idea would be to create Path objects, Text objects, etc. (using native Canvas stuff like
        // Path2d or CanvasGradient when possible) with fixed "model" coordinates, then do the final runtime
        // scaling/translation via CanvasRenderingContext2D transformation matrix.
        if (Array.isEmpty(this.lines)) { return; }
        var ext = rect.extremes;
        var xDomain = { min: ext.min.x, max: ext.max.x };
        var yDomain = { min: ext.min.y, max: ext.max.y };
        var xRange = { min: 0, max: rect.width };
        var yRange = { min: 0, max: rect.height };
        var twRange = { min: 0, max: canvasGrid.tileWidth };
        var info = { session: session, canvasGrid: canvasGrid, rect: rect, xDomain: xDomain, yDomain: yDomain, xRange: xRange, yRange: yRange, twRange: twRange, modelMetadata: modelMetadata };
        ctx.save();
        for (var i = 0; i < this.lines.length; i++) {
            var line = this.lines[i];
            if (line.length == 0) { continue; }
            switch (line[0]) {
                case "fill": this._fill(line, ctx, info); break;
                case "innerStroke": this._innerStroke(line, ctx, info); break;
                case "poly": this._poly(line, ctx, info); break;
                case "text": this._text(line, ctx, info); break;
                case "rotate": this._rotate(line, ctx, info); break;
                case "script": this._script(line, ctx, info); break;
            }
        }
        ctx.restore();
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

    _toRadians(value, units) {
        switch (units) {
            case "r": return value;
            case "d": return value * radiansPerDegree;
        }
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

    // [text,red,0.25,r,left,top,0.5,0.5,r,R,white,0.2]
    //  0    1   2    3 4    5   6   7   8 9 10    11
    _text(line, ctx, info) {
        var sz = this._toPx(line[2], line[3], info.yRange, info.twRange);
        ctx.textAlign = line[4];
        ctx.textBaseline = line[5];
        var x = this._toPx(line[6], line[8], info.xDomain, info.twRange);
        var y = this._toPx(line[7], line[8], info.yDomain, info.twRange);
        ctx.font = `${sz}px sans-serif`;
        var text = String.fromTemplate(line[9], info.modelMetadata);
        if (line.length > 10) {
            // make a bubble
            ctx.fillStyle = line[10];
            let metrics = ctx.measureText(text);
            let padding = (line.length > 11 ? line[11] : 0.15) * sz;
            let rect = new Rect(x - padding, y - padding - 0.5 * sz, metrics.width + 2 * padding, sz + 2 * padding);
            ctx.roundRect(rect, padding, padding, true, false);
        }
        ctx.fillStyle = line[1];
        ctx.textFill(text, new Point(x, y));
    }

    // [rotate,amount,d]
    _rotate(line, ctx, info) {
        var rad = this._toRadians(line[1], line[2]);
        var dx = info.rect.x + 0.5 * info.rect.width;
        var dy = info.rect.y + 0.5 * info.rect.height;
        ctx.translate(dx, dy);
        ctx.rotate(rad);
        ctx.translate(-dx, -dy);
    }

    // [script,id,variantKey]
    _script(line, ctx, info) {
        var variantKey = parseInt(line[2]);
        if (isNaN(variantKey) || variantKey < 0) { variantKey = info.session.variantKey; }
        var painter = ScriptPainterStore.shared.getPainterSession(line[1], variantKey);
        painter.render(ctx, info.rect, info.canvasGrid, info.modelMetadata);
    }
} // end ScriptPainter

class ScriptPainterSession {
    constructor(id, variantKey, painter) {
        this.id = id;
        this.variantKey = variantKey;
        this.painter = painter;
    }
    render(ctx, rect, canvasGrid, modelMetadata) {
        if (!this.painter) { return; }
        this.painter.render(ctx, rect, canvasGrid, modelMetadata, this);
    }
}

class ScriptPainterStore {
    constructor() {
        this.deviceScale = FlexCanvasGrid.getDevicePixelScale();
        this.cache = {};
        this.collectionCache = {};
    }

    getVariantCount(id) {
        let found = this.collectionCache[id];
        if (found) { return found.variants.length; }
        let data = GameContent.shared.painters[id];
        return ScriptPainterCollection.getVariantCount(data);
    }

    getPainterCollection(id) {
        var found = this.collectionCache[id];
        if (found) { return found; }
        var data = GameContent.shared.painters[id];
        if (!data) { return null; }
        try {
            var item = ScriptPainterCollection.fromObject(id, data, this.deviceScale);
            if (!item) { return null; }
            this.collectionCache[id] = item;
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
        var expectedSize = data.expectedSize ? data.expectedSize : _1x1;
        var ds = this.deviceScale;
        this.cache[id] = variants.map(v => new ScriptPainter({ lines: v, expectedSize: expectedSize, deviceScale: ds }));
        return this.getPainter(id, variantKey)
    }

    getPainterSession(id, variantKey) {
        variantKey = parseInt(variantKey);
        variantKey = isNaN(variantKey) ? 0 : variantKey;
        var painter = this.getPainter(id, variantKey);
        return new ScriptPainterSession(id, variantKey, painter);
    }
}

class SpritesheetStore {
    // completion(SpritesheetStore?, Error?)
    // Begin process by passing no argument for "state"
    static load(theme, completion, state) {
        if (!state) {
            let remaining = Array.from(theme.sheetConfigs);
            SpritesheetStore.load(theme, completion, {remaining: remaining, completed: []});
            return;
        }
        if (state.remaining.length == 0) {
            debugLog(`Finished preloading ${state.completed.length} Spritesheet images`);
            completion(new SpritesheetStore(theme, state.completed), null);
            return;
        }
        let config = state.remaining.shift();
        // debugLog(`Loading Spritesheet image ${config.path}...`);
        config.image = new Image();
        config.image.src = `${config.path}?bustCache=${Date.now()}`;
        config.image.decode()
            .then(() => {
                state.completed.push(new Spritesheet(config));
                SpritesheetStore.load(theme, completion, state);
            })
            .catch(error => {
                debugWarn(`Failed to preload Spritesheet image ${config.path}: ${error.message}`);
                debugLog(error);
                completion(null, error);
            });
    }

    constructor(theme, sheets) {
        this.theme = theme;
        this.sheetTable = {};
        sheets.forEach(sheet => {
            if (!this.sheetTable[sheet.id]) this.sheetTable[sheet.id] = {};
            this.sheetTable[sheet.id][sheet.tileWidth] = sheet;
        });
        // to unload, call .close() for each Image object.
    }

    get allSprites() { return this.theme.sprites; }

    spriteWithUniqueID(uniqueID) {
        return this.theme.spriteTable[uniqueID];
    }

    getSprite(id, variantKey) {
        let sprite = this.theme.getSprite(id, variantKey);
        if (!sprite) { once("no sprite " + id, () => debugWarn(`getSprite("${id}", ${variantKey}): no sprite found`)); }
        return sprite;
    }

    getSpritesheet(sheetID, tileWidth) {
        let item = this.sheetTable[sheetID];
        let sheet = item ? item[tileWidth] : null;
        if (!sheet) { once("no sheet " + sheetID + tileWidth, () => debugWarn(`getSpritesheet("${sheetID}", ${tileWidth}): no sheet found`)); }
        return sheet;
    }

    defaultTileVariantKey(tile) {
        return hashArrayOfInts([tile.point.x, tile.point.y]);
    }
}

class SpritesheetTheme {
    static defaultTheme() {
        if (!SpritesheetTheme._default) {
            SpritesheetTheme._default = new SpritesheetTheme(GameContent.shared.themes[0]);
        }
        return SpritesheetTheme._default;
    }

    constructor(config) {
        this.id = config.id;
        this.isDefault = config.isDefault;
        this.sheetConfigs = config.sheets;
        this.sprites = [];
        this.spriteCounts = {};
        this.spriteTable = {};
        config.sprites.forEach(item => {
            item.variants.forEach((variant, index) => {
                let sprite = new Sprite(Object.assign({}, item, variant, {"variantKey": index}));
                this.spriteTable[sprite.uniqueID] = sprite;
                this.sprites.push(sprite);
                this.spriteCounts[sprite.id] = index + 1;
            });
        });
    }

    getSprite(id, variantKey) {
        let count = this.spriteCounts[id];
        if (typeof(count) === 'undefined') return null;
        return this.spriteTable[Sprite.makeUniqueID(id, variantKey % count)];
    }
}

class Spritesheet {
    constructor(config) {
        this.id = config.id;
        this.image = config.image;
        this.tileWidth = config.tileWidth; // in device pixels
        this.imageBounds = new Rect(new Point(0, 0), config.imageSize) // in device pixels
    }

    renderSprite(ctx, rect, sprite, frameCounter) {
        let src = this.sourceRect(sprite, frameCounter);
        if (!this.imageBounds.contains(src)) {
            once("oob" + sprite.uniqueID, () => debugWarn(`Sprite ${sprite.uniqueID} f${frameCounter} out of bounds in ${this.debugDescription}: ${src.debugDescription}`));
            return;
        }
        // debugLog(`draw ${sprite.uniqueID} src ${src.debugDescription} -> dest ${rect.debugDescription}`);
        ctx.drawImage(this.image, src.x, src.y, src.width, src.height, rect.x, rect.y, src.width, src.height);
    }

    sourceRect(sprite, frameCounter) {
        let width = sprite.tileSize.width * this.tileWidth;
        let height = sprite.tileSize.height * this.tileWidth;
        let col = sprite.isAnimated ? (frameCounter % sprite.frames) : sprite.column;
        return new Rect(col * width, sprite.row * height, width, height);
    }

    get debugDescription() {
        return `<Spritesheet #${this.id} w${this.tileWidth}>`;
    }
}

class Sprite {
    static edgeVariantKey(edgeScore) {
        if (edgeScore < 0 || edgeScore >= GameContent.shared.sprites.edgeVariants.length)
            return 0;
        return GameContent.shared.sprites.edgeVariants[edgeScore % GameContent.shared.sprites.edgeVariants.length];
    }

    static makeUniqueID(id, variantKey) {
        return `${id}|${variantKey}`;
    }

    constructor(config) {
        this.id = config.id;
        this.sheetID = config.sheetID;
        this.variantKey = config.variantKey;
        this.uniqueID = Sprite.makeUniqueID(this.id, this.variantKey);
        this.row = config.row;
        this.column = config.column;
        this.frames = config.frames;
        this.tileSize = config.tileSize;
    }
    get isAnimated() { return this.frames > 1; }
    get debugDescription() {
        let animation = this.isAnimated ? `fc=${this.frames}` : "!a";
        return `<Sprite #${this.id}/${this.variantKey} ${animation}>`;
    }

    isEqual(other) {
        return other && other.uniqueID == this.uniqueID;
    }
}

return {
    ScriptPainterStore: ScriptPainterStore,
    SpritesheetStore: SpritesheetStore,
    SpritesheetTheme: SpritesheetTheme,
    Strings: Strings,
    KeyInputController: KeyInputController,
    JSONRequest: JSONRequest,
    UI: UI
};

})(); // end namespace CitySim
