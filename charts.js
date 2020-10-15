"use-strict";

self.Charts = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;

const Point = Gaming.Point;
const Rect = Gaming.Rect;

const _zeroToOne = { min: 0, max: 1 };

class ChartDataSeries {
    constructor(config) {
        this.name = config.name;
        this.values = [];
    }

    get isEmpty() { return this.values.length == 0; }

    get domain() {
        if (this.isEmpty) { return null; }
        let ext = { min: this.values[0].x, max: this.values[0].x };
        this.values.forEach(value => {
            ext.min = Math.min(ext.min, value.x);
            ext.max = Math.max(ext.max, value.x);
        });
        return ext;
    }

    get range() {
        if (this.isEmpty) { return null; }
        let ext = { min: this.values[0].y, max: this.values[0].y };
        this.values.forEach(value => {
            ext.min = Math.min(ext.min, value.y);
            ext.max = Math.max(ext.max, value.y);
        });
        return ext;
    }

    push(x, y) {
        this.values.push({ x: x, y: y });
    }
}

class ChartDataSeriesPresentation {
    constructor(config) {
        this.series = config.series;
        this.style = Object.assign({
            type: ChartDataSeriesPresentation.Type.line,
            strokeStyle: "#000000",
            lineWidth: 1
        }, config.style);
    }
}
ChartDataSeriesPresentation.Type = {
    line: "line"
};

class ChartAxisPresentation {
    static defaultValueLabelFormatter(value) {
        return `${value}`;
    }

    constructor(config) {
        this.title = config.title || null;
        this.titleFont = config.titleFont || null;
        this.textColor = config.textColor || null;
        this.titlePadding = config.titlePadding || 0;
        this.lineWidth = config.lineWidth || 0;
        this.strokeStyle = config.strokeStyle || null;
        // For category(x) axis. Array of strings
        this.labels = config.labels || null;
        // For value(y) axis. ChartDataSeries object
        this.series = config.series || null;
        if (!!config.valueLabels) {
            this.valueLabels = {
                // N = 1 start, 1 end, and N-2 middle ticks
                maxTickCount: config.valueLabels.maxTickCount || 3,
                showLabels: !!config.valueLabels.showLabels,
                tickSize: config.valueLabels.tickSize || 0,
                tickLineWidth: config.valueLabels.tickLineWidth || this.lineWidth,
                titleFont: config.valueLabels.titleFont || null,
                textColor: config.valueLabels.textColor || null,
                titlePadding: config.valueLabels.titlePadding || 0,
                formatter: config.valueLabels.formatter || ChartAxisPresentation.defaultValueLabelFormatter
            };
        } else {
            this.valueLabels = null;
        }
    }

    get hasTitle() { return !!this.title; }
    get hasBorder() { return this.lineWidth > 0; }
    get hasValueLabels() {
        return !!this.valueLabels
            && ((!!this.series && !this.series.isEmpty) || (!!this.labels && this.labels.length > 0));
    }
}

class ChartView {
    constructor(config) {
        this.canvas = config.elem;
        this.title = config.title || null;
        this.series = config.series; // [ChartDataSeriesPresentation]
        // ChartAxisPresentation objects
        this.axes = { x: config.axes.x, y: { primary: config.axes.y.primary, secondary: config.axes.y.secondary } };
        this.style = Object.assign({
            backgroundColor: "#ffffff",
            chartColor: null,
            defaultFont: "bold 32px monospace",
            defaultTextColor: "#000000",
            titleFont: null,
            titleTextColor: null,
            titlePadding: 0
        }, config.style);
    }

    get hasTitle() { return !!this.title; }

    render() {
        debugLog("~~~~~~~~~ render ChartView ~~~~~~~~~");

        this.pixelScale = HTMLCanvasElement.getDevicePixelScale();
        this.canvas.width = this.pixelScale * this.canvas.clientWidth;
        this.canvas.height = this.pixelScale * this.canvas.clientHeight;

        if (this.series.length < 1) {
            debugWarn("No series to render");
            return;
        }
        if (this.canvas.width < 30 || this.canvas.height < 30) {
            debugWarn("Canvas too small");
            return;
        }

        let ctx = this.canvas.getContext("2d");

        /*
        X####X   # title/axis rects
        #cccc#   X unsafe areas
        #cccc#   c content rect
        X####X
        */
        let rects = { root: new Rect(0, 0, this.canvas.width, this.canvas.height) };
        rects.title = this.marginRectWithTitle(ctx, rects.root, directions.N, this.title, this.style);
        rects.axes = {
            x: this.marginRectForAxis(ctx, rects.root, directions.S, this.axes.x),
            y: {
                primary: this.marginRectForAxis(ctx, rects.root, directions.W, this.axes.y.primary),
                secondary: this.marginRectForAxis(ctx, rects.root, directions.E, this.axes.y.secondary)
            }
        };
        rects.content = rects.root;

        rects.content = ChartView.rectSubtractingMargin(rects.content, directions.N, rects.title.height);
        rects.content = ChartView.rectSubtractingMargin(rects.content, directions.S, rects.axes.x.height);
        rects.content = ChartView.rectSubtractingMargin(rects.content, directions.W, rects.axes.y.primary.width);
        rects.content = ChartView.rectSubtractingMargin(rects.content, directions.E, rects.axes.y.secondary.width);
        rects.axes.y.primary = ChartView.rectSubtractingMargin(rects.axes.y.primary, directions.N, rects.title.height);
        rects.axes.y.primary = ChartView.rectSubtractingMargin(rects.axes.y.primary, directions.S, rects.axes.x.height);
        rects.axes.y.secondary = ChartView.rectSubtractingMargin(rects.axes.y.secondary, directions.N, rects.title.height);
        rects.axes.y.secondary = ChartView.rectSubtractingMargin(rects.axes.y.secondary, directions.S, rects.axes.x.height);
        rects.axes.x = ChartView.rectSubtractingMargin(rects.axes.x, directions.W, rects.axes.y.primary.width);
        rects.axes.x = ChartView.rectSubtractingMargin(rects.axes.x, directions.E, rects.axes.y.secondary.width);

        ctx.fillStyle = this.style.backgroundColor;
        ctx.rectFill(rects.root);

        this.renderAxis(ctx, this.axes.x, rects.axes.x, directions.S);
        this.renderAxis(ctx, this.axes.y.primary, rects.axes.y.primary, directions.W);
        this.renderAxis(ctx, this.axes.y.secondary, rects.axes.y.secondary, directions.E);
        this.renderText(ctx, this.title, rects.title, this.style, false);

        if (!!this.style.chartColor) {
            ctx.fillStyle = this.style.chartColor;
            ctx.rectFill(rects.content);
        }
        this.series.forEach(presentation => {
            switch (presentation.style.type) {
                case ChartDataSeriesPresentation.Type.line:
                    this.renderLineSeries(ctx, presentation, rects.content); break;
                default:
                    debugWarn(`bad series type ${presentation.style.type}`); break;
            }
        });
    }

    marginRectForAxis(ctx, rect, edge, presentation) {
        if (!presentation) {
            return ChartView.rectOnMargin(rect, edge, 0);
        }
        let thickness = this.marginThicknessForTitle(ctx, presentation.title, presentation);
        if (presentation.hasValueLabels && presentation.valueLabels.showLabels) {
            thickness += this.marginThicknessForTitle(ctx, "0", presentation.valueLabels);
        }
        if (presentation.hasValueLabels) {
            thickness += presentation.valueLabels.tickSize;
        }
        return ChartView.rectOnMargin(rect, edge, thickness);
    }

    marginRectWithTitle(ctx, rect, edge, title, style) {
        return ChartView.rectOnMargin(rect, edge, this.marginThicknessForTitle(ctx, title, style));
    }

    marginThicknessForTitle(ctx, title, style) {
        if (!title) {
            return style.titlePadding;
        }
        ctx.fillStyle = style.textColor;
        ctx.font = style.titleFont || this.style.defaultFont;
        let metrics = ctx.measureText(title);
        let textHeight = this.pixelScale * (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent);
        return textHeight + (2 * style.titlePadding);
    }

    static isVertical(edge) {
        return (edge == directions.W) || (edge == directions.E);
    }

    static rectOnMargin(rect, edge, thickness) {
        let extremes = rect.extremes;
        switch (edge) {
            case directions.S:
            case directions.N:
                return ChartView.rectSubtractingMargin(rect, directions.opposite(edge), rect.height - thickness);
            case directions.W:
            case directions.E:
                return ChartView.rectSubtractingMargin(rect, directions.opposite(edge), rect.width - thickness);
        }
    }

    static rectSubtractingMargin(rect, edge, thickness) {
        if (!rect || rect.isEmpty() || !thickness || thickness <= 0) {
            return new Rect(rect);
        }
        let ext = rect.extremes;
        switch (edge) {
            // canvas origin is top left
            case directions.N: ext.min.y += Math.min(thickness, rect.height); break;
            case directions.S: ext.max.y -= Math.min(thickness, rect.height); break;
            case directions.W: ext.min.x += Math.min(thickness, rect.width); break;
            case directions.E: ext.max.x -= Math.min(thickness, rect.width); break;
            default: debugWarn("bad edge");
        }
        return Rect.fromExtremes(ext);
    }

    // position: 0...1
    // length: length of axis in the current drawing context
    static axisOffset(position, length) {
        return Math.scaleValueLinear(position, _zeroToOne, { min: 0, max: length });
    }

    renderAxis(ctx, presentation, rect, edge) {
        if (!presentation) { return; }
        if (presentation.hasBorder) {
            let ext = rect.extremes;
            let start = null; let end = null;
            switch (edge) {
                case directions.N:
                    start = new Point(ext.min.x, ext.max.y);
                    end = new Point(ext.max.x, ext.max.y);
                    break;
                case directions.S:
                    start = new Point(ext.min.x, ext.min.y);
                    end = new Point(ext.max.x, ext.min.y);
                    break;
                case directions.W:
                    start = new Point(ext.max.x, ext.min.y);
                    end = new Point(ext.max.x, ext.max.y);
                    break;
                case directions.E:
                    start = new Point(ext.min.x, ext.min.y);
                    end = new Point(ext.min.x, ext.max.y);
                    break;
            }
            ctx.lineCap = "butt";
            ctx.lineWidth = presentation.lineWidth * this.pixelScale;
            ctx.strokeStyle = presentation.strokeStyle;
            ctx.strokeLineSegment(start, end);
        }

        let tickSize = presentation.hasValueLabels ? presentation.valueLabels.tickSize : 0;
        let subrects = {
            ticks: ChartView.rectOnMargin(rect, directions.opposite(edge), tickSize),
            valueLabels: null,
            title: this.marginRectWithTitle(ctx, rect, edge, presentation.title, presentation)
        };

        if (presentation.hasValueLabels) {
            subrects.valueLabels = ChartView.rectSubtractingMargin(rect, directions.opposite(edge), tickSize);
            subrects.valueLabels = ChartView.rectSubtractingMargin(subrects.valueLabels, edge, ChartView.isVertical(edge) ? subrects.title.width : subrects.title.height);
            let labels = [];
            if (presentation.labels) {
                let indexRange = { min: 0, max: presentation.labels.length - 1 };
                // Find the narrowest allowed spacing/max possible labels.
                // If maxTickCount <= presentation.labels.length, it shows all labels.
                let spacing = 1 / (presentation.valueLabels.maxTickCount - 1);
                let stride = Math.max(1, Math.ceil((presentation.labels.length - 1) * spacing));
                for (let index = 0; index < presentation.labels.length; index += stride) {
                    labels.push({
                        position: Math.scaleValueLinear(index, indexRange, _zeroToOne),
                        value: presentation.labels[index],
                        title: presentation.labels[index]
                    });
                }
            } else {
                let domain = { min: 1, max: presentation.valueLabels.maxTickCount };
                let range = presentation.series.range;
                for (let i = domain.min; i <= domain.max; i += 1) {
                    let value = Math.scaleValueLinear(i, domain, range);
                    labels.push({
                        position: Math.scaleValueLinear(i, domain, _zeroToOne),
                        value: value,
                        title: presentation.valueLabels.formatter(value)
                    });
                }
            }

            if (tickSize > 0) {
                labels.forEach(label => {
                    this.renderTick(ctx, label, presentation, subrects.ticks, edge);
                });
            }

            if (presentation.valueLabels.showLabels) {
                labels.forEach(label => {
                    this.renderAxisLabel(ctx, label, presentation, subrects.valueLabels, edge);
                });
            }
        }

        if (!!presentation.title) {
            this.renderText(ctx, presentation.title, subrects.title, presentation, ChartView.isVertical(edge));
        }
    }

    renderTick(ctx, tick, presentation, rect, edge) {
        ctx.lineCap = "butt";
        ctx.lineWidth = presentation.valueLabels.tickLineWidth;
        ctx.strokeStyle = presentation.strokeStyle;

        let extremes = rect.extremes;
        if (ChartView.isVertical(edge)) {
            let start = rect.origin.adding(0, ChartView.axisOffset(1 - tick.position, rect.height));
            let end = start.adding(presentation.valueLabels.tickSize, 0);
            ctx.strokeLineSegment(start, end);
        } else {
            let start = rect.origin.adding(ChartView.axisOffset(tick.position, rect.width), 0);
            let end = start.adding(0, presentation.valueLabels.tickSize);
            ctx.strokeLineSegment(start, end);
        }
    }

    renderAxisLabel(ctx, label, presentation, rect, edge) {
        let extremes = rect.extremes;
        if (ChartView.isVertical(edge)) {
            let center = rect.origin.adding(0.5 * rect.width, ChartView.axisOffset(1 - label.position, rect.height));
            rect = Rect.withCenter(center, { width: rect.width, height: rect.width });
        } else {
            let center = rect.origin.adding(ChartView.axisOffset(label.position, rect.width), 0.5 * rect.height);
            rect = Rect.withCenter(center, { width: rect.height, height: rect.height });
        }
        this.renderText(ctx, label.title, rect, presentation.valueLabels, ChartView.isVertical(edge));
    }

    renderLineSeries(ctx, presentation, rect) {
        let length = presentation.series.values.length;
        if (length == 0) { return; }
        ctx.save();
        // set origin to bottom left
        ctx.translate(rect.origin.x, rect.extremes.max.y);
        ctx.scale(1, -1);

        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = presentation.style.lineWidth * this.pixelScale;
        ctx.strokeStyle = presentation.style.strokeStyle;

        let domain = { min: 0, max: presentation.series.values.length - 1 };
        let range = presentation.series.range;
        presentation.series.values.forEach((value, index) => {
            let x = ChartView.axisOffset(Math.scaleValueLinear(index, domain, _zeroToOne), rect.width);
            let y = ChartView.axisOffset(Math.scaleValueLinear(value.y, range, _zeroToOne), rect.height);
            if (index == 0) {
                ctx.beginPath();
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            index += 1;
        });
        ctx.stroke();

        ctx.restore();
    }

    renderText(ctx, text, rect, style, isVertical) {
        if (!text) { return; }
        ctx.save();
        ctx.font = style.titleFont || this.style.defaultFont;
        ctx.fillStyle = style.textColor || this.style.defaultTextColor;
        if (isVertical) {
            // Rotate 90° left
            ctx.translate(rect.origin.x, rect.extremes.max.y);
            ctx.rotate(-0.5 * Math.PI);
            ctx.fillTextCentered(text, new Rect(0, 0, rect.height, rect.width));
        } else {
            ctx.fillTextCentered(text, rect);
        }
        ctx.restore();
    }
} // end class ChartView

return {
    ChartDataSeries: ChartDataSeries,
    ChartDataSeriesPresentation: ChartDataSeriesPresentation,
    ChartAxisPresentation: ChartAxisPresentation,
    ChartView: ChartView
};

})(); // end Charts namespace
