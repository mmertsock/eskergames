import * as Gaming from '../g.js';
import { inj, Env, Identifier, Tile } from './game.js';

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn;
const Point = Gaming.Point, Rect = Gaming.Rect;

export function initialize() {
    inj().spritesheets = new SpritesheetStore();
    UnitDrawable.initialize();
}

export class Drawable {
    draw(c) { }
}

export class CanvasPrimitives {
    // Set any line styling other than lineWidth/strokeStyle before calling.
    static strokeLine(c, lineWidthDOM, strokeStyle, a, b) {
        c.ctx.lineWidth = c.deviceLengthForDOMLength(lineWidthDOM);
        c.ctx.strokeStyle = strokeStyle;
        c.ctx.beginPath();
        c.ctx.moveTo(a.x, a.y);
        c.ctx.lineTo(b.x, b.y);
        c.ctx.stroke();
    }
}

export class MapBackgroundDrawable extends Drawable {
    constructor() {
        super();
        this.canvasFillStyle = inj().content.worldView.canvasFillStyle;
    }
    
    draw(c) {
        c.ctx.fillStyle = this.canvasFillStyle;
        c.ctx.rectFill(c.viewportScreenRect);
        c.ctx.fillStyle = "hsla(0, 0%, 100%, 0.08)";
        c.ctx.rectFill(c.viewModel.worldScreenRect);
    }
}

export class MapGridDrawable extends Drawable {
    constructor(world) {
        super();
        this.world = world;
        this.metrics = inj().content.worldView;
        
        let planetBounds = world.planet.rect.extremes;
        this.longitudes = Array.mapSequence(
            { min: planetBounds.min.x, max: planetBounds.max.x }, x => [
                new Tile(x, planetBounds.min.y).coord,
                new Tile(x, planetBounds.max.y).coord
        ]);
        this.latitudes = Array.mapSequence(
            { min: planetBounds.min.y, max: planetBounds.max.y }, y => [
                new Tile(planetBounds.min.x, y).coord,
                new Tile(planetBounds.max.x, y).coord
        ]);
    }
    
    draw(c) {
        this.longitudes.forEach(l => this.drawGridLine(c, l));
        this.latitudes.forEach(l => this.drawGridLine(c, l));
    }
    
    drawGridLine(c, line) {
        CanvasPrimitives.strokeLine(c, this.metrics.tileGrid.lineWidth, this.metrics.tileGrid.strokeStyle, c.viewModel.projection.screenPointForCoord(line[0]), c.viewModel.projection.screenPointForCoord(line[1]));
    }
}

export class TerrainBaseLayerDrawable {
    constructor(square) {
        this.square = square;
    }
    
    draw(c) {
        let sheet = inj().spritesheets.sheet("terrainBase");
        if (!sheet) { return; }
        let rect = c.viewModel.projection.screenRectForTile(this.square.tile);
        sheet.draw(c, rect, this.square.terrain.type.index, this.square.terrain.randomSeed);
    }
}

export class TerrainEdgeDrawable {
    constructor(edge) {
        this.edge = edge;
    }
    
    draw(c) {
        let sheet = inj().spritesheets.sheet("terrainEdge");
        if (!sheet) { return; }
        let s1 = this.edge.square;
        let s2 = this.edge.toSquare;
        if (!s1 || !s2) {
            debugWarn("Square not found for edge ${this.edge.debugDescription}");
            return;
        }
        let square = (s2.terrain.randomSeed > s1.terrain.randomSeed) ? s2 : s1;
        let spriteIndex = this.spriteIndexForTerrainType(sheet, square.terrain.type.index);
        if (spriteIndex < 0) { return; }
        // Flip horizontally/vertically as needed
        let rect = c.viewModel.projection.screenRectForRect(this.edge.unitRect);
        sheet.draw(c, rect, spriteIndex, square.terrain.randomSeed);
    }
    
    spriteIndexForTerrainType(sheet, terrainType) {
        switch (terrainType) {
            case 2:
                return this.edge.isHorizontal ? sheet.metrics.h.grass : sheet.metrics.v.grass;
            case 3:
                return this.edge.isHorizontal ? sheet.metrics.h.plains : sheet.metrics.v.plains;
            default: return -1
        }
    }
}

export class UnitDrawable extends Drawable {
    static initialize() {
        UnitDrawable.metrics = inj().content.drawables.unit;
        UnitDrawable.metrics.badge.centerAnchor = new Point(UnitDrawable.metrics.badge.centerAnchor);
    }
    
    constructor(unit) {
        super();
        this.unit = unit;
    }
    
    draw(c) {
        this.character(c);
        this.badgeCircle(c);
        this.badgeIcon(c);
    }
    
    characterScreenRect(c) {
        return c.viewModel.projection.screenRectForRect(this.unit.tile.rect);
    }
    
    badgeScreenRect(c) {
        let metrics = UnitDrawable.metrics;
        let center = c.viewModel.projection.screenPointForCoord(
            this.unit.tile.coord.adding(metrics.badge.centerAnchor));
        return Rect.withCenter(center, c.deviceSizeForDOMSize(metrics.badge.screenSize));
    }
    
    character(c) {
        let rect = c.viewModel.projection.screenRectForRect(this.unit.tile.rect.inset(0.25, 0.25));
        c.ctx.fillStyle = "hsla(150, 72%, 50%, 0.6)";
        c.ctx.rectFill(rect);
        c.ctx.strokeStyle = "hsl(150, 72%, 50%)";
        c.ctx.lineWidth = 4;
        c.ctx.rectStroke(rect);
    }
    
    badgeCircle(c) {
        let metrics = UnitDrawable.metrics;
        let rect = this.badgeScreenRect(c);
        c.ctx.fillStyle = this.unit.civ.color(metrics.badge.opacity);
        c.ctx.strokeStyle = this.unit.civ.color(1);
        c.ctx.lineWidth = c.deviceLengthForDOMLength(metrics.badge.lineWidth);
        c.ctx.ellipsePath(rect);
        c.ctx.fill();
        c.ctx.stroke();
    }
    
    badgeIcon(c) {
    }
}

export class SpritesheetStore {
    constructor() {
        this.sheets = {};
        this.loaded = false;
    }
    
    sheet(id) { return this.sheets[id]; }
    add(sheet) { this.sheets[sheet.id] = sheet; }
    
    loadAll(completion) {
        if (this.loaded) { completion(); }
        this.loaded = true;
        let ids = Object.getOwnPropertyNames(inj().content.spritesheets);
        this._load(ids, completion);
    }
    
    _load(remainingIDs, completion) {
        if (remainingIDs.length == 0) {
            completion(this);
            return;
        }
        let config = inj().content.spritesheets[remainingIDs.shift()];
        Spritesheet.loadRemoteImage(`${Env.appURLPath}${config.fileName}`, image => {
            config.image = image;
            let type = Spritesheet.types[config.type];
            inj().spritesheets.add(new type(config));
            this._load(remainingIDs, completion);
        });
    }
}

export class Spritesheet {
    static loadRemoteImage(url, completion) {
        url = new URL(url, window.location.href);
        let image = new Image();
        if (!Env.isProduction) {
            url.bustCache();
        }
        image.src = url.href;
        debugLog(`Loading spritesheet: ${image.src}`);
        image.decode()
            .then(() => completion(image))
            .catch(error => {
                debugWarn(`Failed to preload spritesheet image ${url}: ${error.message}`);
                debugLog(error);
            });
    }
    
    constructor(a) {
        this.id = a.id;
        this.image = a.image;
        this.metrics = a.metrics;
    }
    
    drawSheetRect(c, destRect, sheetRect) {
        c.ctx.drawImage(this.image, sheetRect.x, sheetRect.y, sheetRect.width, sheetRect.height, destRect.x, destRect.y, destRect.width, destRect.height);
    }
}
Spritesheet.types = {};

// Transparent sprites with arbitrary fixed size. Every sprite in the sheet has the same sourceRectSize. Each row is one set of variants for a given sprite.
class RectSpritesheet extends Spritesheet {
    constructor(a) {
        super(a);
        this.sourceRectSize = a.sourceRectSize;
        this.columnCount = Math.floor(this.image.width / this.sourceRectSize.width);
        debugLog(`Created ${this.debugDescription}`);
    }
    
    get debugDescription() {
        return `<${this.constructor.name} img:${Rect.sizeDebugDescription(this.image)} src:${Rect.sizeDebugDescription(this.sourceRectSize)} c|${this.columnCount}>`;
    }
    
    draw(c, destRect, spriteIndex, randomSeed) {
        // Really simple.
        let column = (Number.isInteger(randomSeed) ? randomSeed : 0) % this.columnCount;
        let sheetOrigin = new Point(
            column * this.sourceRectSize.width,
            spriteIndex * this.sourceRectSize.height
        );
        let sheetRect = new Rect(sheetOrigin, this.sourceRectSize);
        this.drawSheetRect(c, destRect, sheetRect);
    }
}
Spritesheet.types["RectSpritesheet"] = RectSpritesheet;

// Non-transparent (JPEG) background and rendering. Can scale down to any size. Fixed size sprites. Each row in the sprite sheet is one sprite, and each row can produce many variants by offsetting the sprite's rendering rect horizontally by any number of pixels within the row.
class SolidContinuousSpritesheet extends Spritesheet {
    constructor(a) {
        super(a);
        this.sourceRectSize = a.sourceRectSize;
        debugLog(`Created ${this.debugDescription}`);
    }
    
    get debugDescription() {
        return `<${this.constructor.name} img:${Rect.sizeDebugDescription(this.image)} src:${Rect.sizeDebugDescription(this.sourceRectSize)}>`;
    }
    
    draw(c, destRect, spriteIndex, randomSeed) {
        let sheetOrigin = new Point(
            this.offsetForRandomSeed(randomSeed),
            spriteIndex * this.sourceRectSize.height
        );
        let sheetRect = new Rect(sheetOrigin, this.sourceRectSize);
        this.drawSheetRect(c, destRect, sheetRect);
    }
    
    offsetForRandomSeed(randomSeed) {
        let maxWidth = this.image.width - this.sourceRectSize.width;
        if (maxWidth < 0) { return 0; }
        return Math.floor(randomSeed * (maxWidth / Identifier.maxRandomSeed)) % maxWidth;
    }
}
Spritesheet.types["SolidContinuousSpritesheet"] = SolidContinuousSpritesheet;
