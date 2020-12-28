import * as Gaming from '../g.js';
import { inj, Tile } from './game.js';

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn;
const Point = Gaming.Point, Rect = Gaming.Rect;

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
        debugLog(`MBD: fill ${c.viewModel.worldScreenRect.debugDescription}`);
        c.ctx.fillStyle = this.canvasFillStyle;
        c.ctx.rectFill(c.viewportScreenRect);
        c.ctx.fillStyle = "hsla(0, 0%, 100%, 0.08)";
        c.ctx.rectFill(c.viewModel.worldScreenRect);
    }
    constructor(world) {
        super();
        this.world = world;
        this.metrics = inj().content.worldView;
        
        let planetBounds = world.planet.rect.extremes;
        this.longitudes = Array.mapSequence(
            { min: planetBounds.min.x, max: planetBounds.max.x }, x => [
                new Tile(x, planetBounds.min.y).gridPoint,
                new Tile(x, planetBounds.max.y).gridPoint
        ]);
        this.latitudes = Array.mapSequence(
            { min: planetBounds.min.y, max: planetBounds.max.y }, y => [
                new Tile(planetBounds.min.x, y).gridPoint,
                new Tile(planetBounds.max.x, y).gridPoint
        ]);
    }
    
    draw(c) {
        c.ctx.fillStyle = this.metrics.canvasFillStyle;
        c.ctx.rectFill(c.viewportScreenRect);
        
        c.ctx.fillStyle = "hsla(0, 0%, 100%, 0.08)";
        c.ctx.rectFill(c.viewModel.worldScreenRect);
        
        this.longitudes.forEach(l => this.drawGridLine(c, l));
        this.latitudes.forEach(l => this.drawGridLine(c, l));
    }
    
    drawGridLine(c, line) {
        CanvasPrimitives.strokeLine(c, this.metrics.tileGrid.lineWidth, this.metrics.tileGrid.strokeStyle, c.viewModel.projection.screenPointForCoord(line[0]), c.viewModel.projection.screenPointForCoord(line[1]));
    }
}

export class UnitDrawable extends Drawable {
    constructor(unit) {
        super();
        this.unit = unit;
    }
    
    draw(c) {
        let rect = c.viewModel.projection.screenRectForTile(this.unit.tile);
        c.ctx.fillStyle = "green";
        c.ctx.rectFill(rect);
    }
}
