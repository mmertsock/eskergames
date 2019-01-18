
var GameSelector = function(config) {
    this.show = function() {
        new Gaming.Prompt({
            title: "Choose a Game",
            unprioritizeButtons: true,
            requireSelection: true,
            buttons: GameSelector.allGames
        }).show();
    };
};

// push({label:"", action:function(button)})
GameSelector.allGames = [];


// config: {
//   paint: function(ctx),
//   either this:
//     getPaintBounds: function()?, (default to position + size)
//   or these two:
//     getPosition: function()? (default to center of paint bounds)
//     getPaintSize: function()? (default to size of paint bounds)
Mixins.Gaming.SceneItem = function(cls, config) {
    Mixins.mix(cls.prototype, "addToParent", function (parentItem) {
        this.removeFromParent();
        if (!parentItem) { return this; }
        if (!parentItem.childItems) { parentItem.childItems = []; }
        parentItem.childItems.push(this);
        this.parentItem = parentItem;
        return this;
    });
    Mixins.mix(cls.prototype, "removeFromParent", function () {
        if (!this.parentItem) { return this; }
        if (!this.parentItem.childItems) { this.parentItem.childItems = []; }
        var index = this.parentItem.childItems.indexOf(this);
        if (index >= 0) {
            this.parentItem.childItems.removeItemAtIndex(index);
        }
        this.parentItem = null;
        return this;
    });
    Mixins.mix(cls.prototype, "didJoinScene", function(scene, layerIndex) {
        this.sceneInfo = {
            scene: scene,
            layerIndex: layerIndex
        };
        this.setDirty(true);
        this.childItems.forEach(function (child) {
            child.didJoinScene(scene, layerIndex)
        });
    });
    Mixins.mix(cls.prototype, "didLeaveScene", function(scene) {
        this.sceneInfo = null;
        this.childItems.forEach(function (child) {
            child.didLeaveScene(scene);
        });
    });
    Mixins.mix(cls.prototype, "leaveScene", function() {
        if (!this.sceneInfo) { return; }
        this.sceneInfo.scene.removeItem(this, this.sceneInfo.layerIndex);
        this.childItems.forEach(function (child) {
            child.leaveScene();
        });
    });
    Mixins.mix(cls.prototype, "getSceneInfo", function() {
        return this.sceneInfo;
    });
    Mixins.mix(cls.prototype, "setDirty", function(secondHand) {
        if (this.sceneInfo) { this.sceneInfo.scene.itemBecameDirty(this, secondHand); }
    });
    Mixins.mix(cls.prototype, "getPaintBounds", config.getPaintBounds || function() {
        return new Rect(this.getPosition(), this.getPaintSize());
    });
    Mixins.mix(cls.prototype, "getPosition", config.getPosition || function() {
        return this.getPaintBounds().getCenter();
    });
    Mixins.mix(cls.prototype, "getPaintSize", config.getPaintSize || function() {
        return this.getPaintBounds().getSize();
    });
    Mixins.mix(cls.prototype, "paint", config.paint);
};

// all of SceneItem, plus config should also have setPosition
Mixins.Gaming.MoveableSceneItem = function(cls, config) {
    Mixins.Gaming.SceneItem(cls, config);
    Mixins.mix(cls.prototype, "setPosition", config.setPosition);
};

/*
class ScenePainter {
    constructor(canvas, runLoop, config) {
        this.canvas = canvas;
        this.canvasFillStyle = config.canvasFillStyle || "#ffffff";
        this.dirtyRect = null;
        this.layers = new Array(Scene.maxLayers);

        var pointSize = {
            width: config.sizeInfo.width * config.sizeInfo.pointsPerUnit,
            height: config.sizeInfo.height * config.sizeInfo.pointsPerUnit
        };
        var scale = HTMLCanvasElement.getDevicePixelScale();
        this.canvas.width = pointSize.width * scale;
        this.canvas.height = pointSize.height * scale;
        this.canvas.style.width = `${pointSize.width}px`;
        this.canvas.style.height = `${pointSize.height}px`;

        this.ctx = canvas.getContext("2d");
        this.ctx.resetTransform();
        this.ctx.transform(config.sizeInfo.pointsPerUnit * scale, 0, 0, -config.sizeInfo.pointsPerUnit * scale, 0, this.canvas.height);
        this.ctx.save();
        this.repaintFullScene();
        runLoop.addDelegate(this);
    }
}*/

var Scene = function(config) {
    this.id = config.id;
    this.runLoop = config.runLoop;
    this.canvasFillStyle = config.canvasFillStyle || "#ffffff";
    this.canvasSizeInfo = config.sizeInfo;
    this.dirtyRect = null;
    this.layers = new Array(Scene.maxLayers);
    this.debug = !!config.debug;
};
Scene.maxLayers = 10;

Scene.prototype.attachToCanvas = function(canvas, resizeCanvas) {
    this.canvas = canvas;

    var pointSize = {
        width: this.canvasSizeInfo.width * this.canvasSizeInfo.pointsPerUnit,
        height: this.canvasSizeInfo.height * this.canvasSizeInfo.pointsPerUnit
    };
    var scale = HTMLCanvasElement.getDevicePixelScale();
    this.canvas.width = pointSize.width * scale;
    this.canvas.height = pointSize.height * scale;
    this.canvas.style.width = `${pointSize.width}px`;
    this.canvas.style.height = `${pointSize.height}px`;

    this.ctx = canvas.getContext("2d");
    this.ctx.resetTransform();
    this.ctx.transform(this.canvasSizeInfo.pointsPerUnit * scale, 0, 0, -this.canvasSizeInfo.pointsPerUnit * scale, 0, this.canvas.height);
    this.ctx.save();
    this.repaintFullScene();
    this.runLoop.addDelegate(this);
};

Scene.prototype.processFrame = function(rl) {
    if (this.canvas) { this.paint(); }
};

Scene.prototype.getLayer = function(index) {
    if (typeof index === 'undefined' || index < 0 || index >= this.layers.length) {
        console.warn(`Invalid Scene layer index ${index}`);
        return null;
    }
    return this.layers[index] || (this.layers[index] = new Set());
};

Scene.prototype.addItem = function(item, layerIndex) {
    var layer = this.getLayer(layerIndex);
    if (layer) {
        item.leaveScene();
        layer.add(item);
        item.didJoinScene(this, layerIndex);
    } else {
        console.warn("Can't add item: bad layer.");
    }
};

Scene.prototype.removeItem = function(item, layerIndex) {
    var layer = this.getLayer(layerIndex);
    if (layer) {
        if (layer.delete(item)) {
            this.markRectDirty(item.getPaintBounds());
            item.didLeaveScene(this);
        }
    }
};

Scene.prototype.itemBecameDirty = function(item, secondHand) {
    if (item.sceneInfo.dirty) {
        return;
    }
    item.sceneInfo.dirty = true;
    this.markRectDirty(item.getPaintBounds());
    if (item.sceneInfo.lastPaintedRect) {
        // the 1px border seems necessary to prevent ghosting of edges
        // TODO make it 1px truly instead of 1 scene-unit
        var rect = (!!secondHand) ? item.sceneInfo.lastPaintedRect : item.sceneInfo.lastPaintedRect.inset(-1, -1);
        this.markRectDirty(rect);
    }
};

Scene.prototype.markRectDirty = function(rect) {
    if (this.dirtyRect && this.dirtyRect.contains(rect)) {
        return;
    }
    //console.log(`markRectDirty: ${rect.debugDescription()};`)
    this.dirtyRect = rect.union(this.dirtyRect);
    for (i = 0; i < this.layers.length; i++) {
        var layer = this.getLayer(i);
        if (layer) {
            layer.forEach(function (item) {
                if (item.sceneInfo.dirty) { return; }
                var bbox = item.getPaintBounds();
                if (!this.dirtyRect.intersects(bbox)) { return; }
                item.setDirty(true);
            }.bind(this));
        }
    }
};

Scene.prototype.clearDirtyState = function() {
    this.dirtyRect = null;
};

Scene.prototype.rectIntersectsDirtyRegion = function(rect) {
    return this.dirtyRect ? this.dirtyRect.intersects(rect) : false;
};

Scene.prototype.repaintFullScene = function() {
    if (!this.canvas) {
        console.warn("Skipping repaint, no canvas.");
        return;
    }
    this.markRectDirty(new Rect(0, 0, this.canvas.width, this.canvas.height));
};

Scene.prototype.paint = function() {
    if (!this.canvas) {
        console.warn("Skipping paint, no canvas.");
        return;
    }
    if (!this.dirtyRect) { return; }
    this.ctx.save();
    //console.log("PAINT");

    //this.ctx.fillStyle = "hsla(0, 0%, 0%, 0.1)";
    this.ctx.fillStyle = this.canvasFillStyle;
    this.ctx.rectFill(this.dirtyRect);
    if (this.debug) {
        var onePixel = 1 / this.canvasSizeInfo.pointsPerUnit;
        this.ctx.strokeStyle = "hsl(300, 100%, 50%)";
        //console.log(`${this.dirtyRect.debugDescription()} x ${onePixel} => "${this.dirtyRect.inset(-onePixel, -onePixel).debugDescription()}`);
        this.ctx.rectStroke(this.dirtyRect.inset(-onePixel, -onePixel));
    }
    //this.ctx.clearRect(this.dirtyRect.x, this.dirtyRect.y, this.dirtyRect.width, this.dirtyRect.height);
    for (i = 0; i < this.layers.length; i++) {
        var layer = this.getLayer(i);
        if (layer) {
            layer.forEach(function (item) {
                this.paintItem(layer, item);
            }.bind(this));
        }
    }

    this.ctx.restore();
    this.clearDirtyState();
};



/*
eh so confused by the painting/container/position hierarchy stuff.
probably easier at this point to just start over?? Rather than trying 
to modiy the existing stuff here.
When starting over, keep it really simple, leave out as many complications
(like dirty rects) as possible, get the fundamentals like coordinates right 
first so content can start to get created. Add optimizations later.

possible fun way too define a scene in yaml: with ascii art
basemap: - |
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
a   bbbbcccb  f  f           a
a   bbbbccdb           g     a
a   beebbbbb  f  f      g    a
a                            a
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
basemapItems:
    a: ContainerItem
    b: House
    c: Table
    d: Lamp
    e: Table
    f: Pond
    g: Shed
Only use this for simple items. Layers defined by alphabetical order.
No parent-child hierarchy; coordinates are all absolute values.
Bounding rect == min/max coords of the letters (so you can have holes 
in the text e.g. a and b, or just type the corners e.g. f, g).
Additional items with more finicky setup can be done with normal 
key-value definitions in the yaml.
Could have multiple of these ascii maps, each one another layer 
of items, if more complexity is needed (e.g. two items at same coords).
Bottommost basemap is the terrain. Could define special characters 
for common items, especially at the terrain level. e.g. # == water.
eh terrain would need to work differently, since it's not a bunch of 
rectangles? eh we talked about explicitly *not* taking the simple 
grid-of-tiles approach for terrain and instead defining it as a bunch 
of polygons with arbitrary shapes. Could still define polygons by 
putting the letters only at the vertices:
                a     a     But how do you specify the order of 
           a            a   the vertexes? Capitalize the first 
           a          a     vertex. Or do a1 a2 a3 a4 etc. which 
               a     a      is fine unless things overlap, or you
                            get more than 10 vertexes.
                a8b6b1a1    Could do 1a 1b 1c instead to get more
           a7         b2a2  vertexes but fewer objects. Or write 
           a6         a3b3  an algorithm to figure out the ordering
               a5 b5 a4b4   of the vertexes automatically (if possible).
eh this is getting silly. What about just have PNG images of the terrain.
Each layer of the PNG is a different terrain object. Only use the alpha 
channel to determine the presence/absence of the object (and maybe 
transparency level determines something functional in the game?). Could 
also have a movement-mask layer that shows where exactly the player can 
move. And in the yaml you map each layer to different types of game objects.
Don't hand-render the actual scene in the PNG, it's just a template, and 
the scene is rendered in real time in the game engine using textures 
(so you can animate, etc., and also so you don't have to hand-render every 
scene every time something changes, etc.).

*/

Scene.prototype.paintItem = function(layer, item) {
    var bbox = item.getPaintBounds();
    if (this.rectIntersectsDirtyRegion(bbox)) {
        //this.ctx.save();
        //this.ctx.transform(bbox.width, 0, 0, bbox.height, bbox.x, bbox.y);
        item.paint(this.ctx);
        //this.ctx.restore();
        item.sceneInfo.dirty = false;
        item.sceneInfo.lastPaintedRect = bbox;
    }

    if (item.childItems.length == 0) { return; }
    this.ctx.save();
    item.childItems.forEach(function (child) {
        this.paintItem(layer, child);
    }.bind(this));
    this.ctx.transform(bbox.width, 0, 0, bbox.height, bbox.x, bbox.y);
    this.ctx.restore();
};

// ----------------------------------------------------------------------

// config: {scale=number, reverseY=bool}

// duration: in seconds
var Easing = function(duration, curveFunc) {
    this.durationMilliseconds = duration * 1000;
    this.curveFunc = curveFunc;
    this.startDate = null;
};
Easing.prototype.start = function() {
    this.startDate = new Date();
};
// in the range [0...1] based on time since start
Easing.prototype.normalizedTimeCompleted = function() {
    if (!this.startDate) { return 0; }
    if (this.durationMilliseconds < 1) { return 1; }
    return Math.min(1, (new Date() - this.startDate) / this.durationMilliseconds);
};
// in the range [0...1] based on time since start
Easing.prototype.progress = function() {
    return this.curveFunc(this.normalizedTimeCompleted());
};
Easing.quick = function() {
    return new Easing(0.15, function(normalizedTimeCompleted) {
        return normalizedTimeCompleted;
    });
};
Easing.debug = function(duration) {
    return new Easing(duration, function(normalizedTimeCompleted) {
        return normalizedTimeCompleted;
    });
};

var Sprite = function(config) {
    this.item = config.item; // conforms to MoveableSceneItem
    this.runLoop = config.runLoop;
    this.velocity = new Vector(config.initialVelocity) || new Vector(0, 0);
    this.startVelocity = null;
    this.targetVelocity = null;
    this.lastFrameDate = null;
    this.easing = null;
};

Sprite.prototype.isMoving = function() {
    return !this.velocity.isZero();
};

Sprite.prototype.goToVelocity = function(targetVelocity, easing) {
    if (targetVelocity.isEqual(this.velocity)) {
        return;
    }

    this.startVelocity = this.velocity;
    this.targetVelocity = targetVelocity;
    this.easing = easing;
    if (this.easing) {
        this.easing.start();
    }

    if (!this.lastFrameDate) {
        this.lastFrameDate = new Date();
    }
    this.runLoop.addDelegate(this);
};

Sprite.prototype.processFrame = function(rl) {
    if (this.targetVelocity) {
        if (this.easing) {
            var factor = this.easing.progress();
            this.velocity = new Vector(
                this.startVelocity.x + factor * (this.targetVelocity.x - this.startVelocity.x),
                this.startVelocity.y + factor * (this.targetVelocity.y - this.startVelocity.y));
        } else {
            this.velocity = this.targetVelocity;
        }
        if (this.velocity.isEqual(this.targetVelocity)) {
            this.easing = null;
            this.targetVelocity = null;
        }
    }

    var now = new Date();
    var seconds = 0.001 * (now - this.lastFrameDate);

    this.item.setPosition(this.velocity.offsettingPosition(this.item.getPosition(), seconds));

    if (this.velocity.isZero()) {
        this.runLoop.removeDelegate(this);
        this.velocity = new Vector(0, 0);
        this.lastFrameDate = null;
    } else {
        this.lastFrameDate = now;
    }
};

// stateful moving.
// velocity units are "DistanceUnits/sec"
// config: {runLoop, initialPosition, initialVelocity?}
var Movement = function(config) {
    this.runLoop = config.runLoop;
    this.position = new Point(config.initialPosition);
    this.velocity = new Vector(config.initialVelocity) || new Vector(0, 0);
    this.startVelocity = null;
    this.targetVelocity = null;
    this.lastFrameDate = null;
    this.easing = null;
};
Movement.prototype.isMoving = function() {
    return !this.velocity.isZero();
};

Movement.prototype.setPosition = function(newPosition) {
    this.position = new Point(newPosition);
};

Movement.prototype.goToVelocity = function(targetVelocity, easing) {
    if (targetVelocity.isEqual(this.velocity)) {
        return;
    }

    this.startVelocity = this.velocity;
    this.targetVelocity = targetVelocity;
    this.easing = easing;
    if (this.easing) {
        this.easing.start();
    }

    if (!this.lastFrameDate) {
        this.lastFrameDate = new Date();
    }
    this.runLoop.addDelegate(this);
};

Movement.prototype.processFrame = function(rl) {
    if (this.targetVelocity) {
        if (this.easing) {
            var factor = this.easing.progress();
            this.velocity = new Vector(
                this.startVelocity.x + factor * (this.targetVelocity.x - this.startVelocity.x),
                this.startVelocity.y + factor * (this.targetVelocity.y - this.startVelocity.y));
        } else {
            this.velocity = this.targetVelocity;
        }
        if (this.velocity.isEqual(this.targetVelocity)) {
            this.easing = null;
            this.targetVelocity = null;
        }
    }

    var now = new Date();
    var seconds = 0.001 * (now - this.lastFrameDate);
    this.position = this.velocity.offsettingPosition(this.position, seconds);

    if (this.velocity.isZero()) {
        this.runLoop.removeDelegate(this);
        this.velocity = new Vector(0, 0);
        this.lastFrameDate = null;
    } else {
        this.lastFrameDate = now;
    }
};


var CanvasGrid = function(config) {
    this.rows = config.rows;
    this.columns = config.columns;
    this.tileWidth = config.tileWidth;
    this.tileSpacing = config.tileSpacing;
    this.canvasSize = {
        width: (this.columns * this.tileWidth) + ((this.columns + 1) * this.tileSpacing),
        height: (this.rows * this.tileWidth) + ((this.rows + 1) * this.tileSpacing)
    };
};

CanvasGrid.prototype.initialize = function(canvas) {
    var scale = HTMLCanvasElement.getDevicePixelScale();
    canvas.style.width = (this.canvasSize.width / scale) + "px";
    canvas.style.height = (this.canvasSize.height / scale) + "px"
    canvas.width = this.canvasSize.width;
    canvas.height = this.canvasSize.height;
};

CanvasGrid.prototype.rectForTile = function(location) {
    return new Rect(
        location.column * (this.tileWidth + this.tileSpacing) + this.tileSpacing,
        location.row * (this.tileWidth + this.tileSpacing) + this.tileSpacing,
        this.tileWidth,
        this.tileWidth)
};

CanvasGrid.prototype.rectCenteredOnPosition = function(position) {
    var r = this.rectForTile({ column: position.x, row: position.y });
    return r;
};

CanvasGrid.prototype.tileForPoint = function(x, y) {
    var column = Math.floor((x - this.tileSpacing) / (this.tileWidth + this.tileSpacing));
    var row = Math.floor((y - this.tileSpacing) / (this.tileWidth + this.tileSpacing));
    if (row >= 0 && row < this.rows && column >= 0 && column < this.columns) {
        return { row: row, column: column };
    }
    return null;
};

// visitor(location, rect)
CanvasGrid.prototype.visitEachLocation = function(visitor) {
    for (var rowIndex = 0; rowIndex < this.rows; rowIndex++) {
        for (var colIndex = 0; colIndex < this.columns; colIndex++) {
            let location = {row: rowIndex, column: colIndex};
            visitor(location, this.rectForTile(location));
        }
    }
};

// ----------------------------------------------------------------------

// config: {canvas = (html elem), min, max, value, onchange = function(Slider)}
var Slider = function(config) {
    this.canvas = config.canvas;
    this.min = config.min;
    this.max = config.max;
    this.value = config.value;
    this.onchange = config.onchange;

    this.canvas.updateBounds();
    this.pixelRatio = HTMLCanvasElement.getDevicePixelScale();
    this.style = {};
    this.style.barThickness = Math.evenFloor(this.canvas.height * 0.25);
    this.style.knobRadius = Math.evenFloor(this.canvas.height * 0.5);
    this.style.barY = Math.evenFloor(this.canvas.height * 0.5);
    this.style.barInset = this.style.knobRadius;
    this.style.barLength = this.canvas.width - (2 * this.style.barInset);

    this.valueScale = { min: this.min, max: this.max };
    this.barScale = { min: this.style.barInset, max: this.canvas.width - this.style.barInset};

    this.canvas.addEventListener("click", function(event) {
        event.preventDefault();
        this.selected(event.offsetX * this.pixelRatio);
    }.bind(this));

    this.canvas.addEventListener("mousemove", function(event) {
        var buttons = event.buttons || event.which;
        if (buttons > 0) {
            event.preventDefault();
            this.selected(event.offsetX * this.pixelRatio);
        }
    }.bind(this));
};

Slider.prototype.setValue = function(newValue) {
    this.value = newValue;
    this.render();
};

Slider.prototype.render = function() {
    var s = this.style;
    var ctx = this.canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    var knobX = Math.scaleValueLinear(this.value, this.valueScale, this.barScale);
    ctx.lineWidth = s.barThickness;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000099";
    ctx.beginPath();
    ctx.moveTo(s.barInset, s.barY);
    ctx.lineTo(knobX, s.barY);
    ctx.stroke();

    ctx.strokeStyle = "#cccccc";
    ctx.beginPath();
    ctx.moveTo(knobX, s.barY);
    ctx.lineTo(this.canvas.width - s.barInset, s.barY);
    ctx.stroke();

    ctx.fillStyle = "#66cc66";
    ctx.beginPath();
    ctx.ellipse(knobX, s.barY, s.knobRadius, s.knobRadius, 0, 2 * Math.PI, false);
    ctx.fill();
};

Slider.prototype.selected = function(x) {
    this.setValue(Math.scaleValueLinear(x, this.barScale, this.valueScale));
    this.onchange(this);
};

// config: {canvas = (elem), tileWidth, tileSpacing, min, max, value, onchange = function(RectSlider)}
// min, max, value are all object: rows, columns
var RectSlider = function(config) {
    this.canvas = config.canvas;
    this.canvasGrid = new CanvasGrid(Object.assign({}, config, config.max));
    this.min = config.min;
    this.max = config.max;
    this.value = config.value;
    this.setValue = function(newValue) {
        this.value = newValue;
        this.render();
    };
    this.onchange = config.onchange;
    this.canvasGrid.initialize(this.canvas);
    this.pixelRatio = HTMLCanvasElement.getDevicePixelScale();

    this.canvas.addEventListener("click", function(event) {
        event.preventDefault();
        this.selected(event.offsetX * this.pixelRatio, event.offsetY * this.pixelRatio);
    }.bind(this));
    this.canvas.addEventListener("mousemove", function(event) {
        var buttons = event.buttons || event.which;
        if (buttons > 0) {
            event.preventDefault();
            this.selected(event.offsetX * this.pixelRatio, event.offsetY * this.pixelRatio);
        }
    }.bind(this));
};

RectSlider.prototype.render = function() { 
    var ctx = this.canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.canvasGrid.visitEachLocation(function (tile, rect) {
        if (this.tileIsInValue(tile)) {
            ctx.fillStyle = "#000099";
        } else if (tile.row < this.min.rows - 1 || tile.column < this.min.columns - 1) {
            ctx.fillStyle = "#dddddd";
        } else {
            ctx.fillStyle = "#cccccc";
        }
        ctx.rectFill(rect);
    }.bind(this));
};

RectSlider.prototype.tileIsInValue = function(tile) {
    return tile.row < this.value.rows && tile.column < this.value.columns;
};

RectSlider.prototype.selected = function(x, y) {
    var tile = this.canvasGrid.tileForPoint(x, y);
    if (tile && tile.row >= this.min.rows - 1 && tile.column >= this.min.columns - 1) {
        this.setValue({ rows: tile.row + 1, columns: tile.column + 1 });
        this.onchange(this);
    }
};
