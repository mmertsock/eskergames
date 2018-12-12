"use-strict";

window.FiresOfEmbora = (function() {

var directions = Gaming.directions;
var Vector = Gaming.Vector;
var Point = Gaming.Point;
var Rect = Gaming.Rect;

// ----------------------------------------------------------------------

class InputController {
    constructor() {
        this.game = null;
        this.keyboardState = new Gaming.KeyboardState({ runLoop: mainRunLoop });
        this.inputAge = 0;
        this.primaryMovementTarget = null;
        this.actionMaps = [
            // WASD
            [["KeyW"], function () { this.move(directions.N); }],
            [["KeyW", "KeyD"], function () { this.move(directions.NE); }],
            [["KeyD"], function () { this.move(directions.E); }],
            [["KeyD", "KeyS"], function () { this.move(directions.SE); }],
            [["KeyS"], function () { this.move(directions.S); }],
            [["KeyS", "KeyA"], function () { this.move(directions.SW); }],
            [["KeyA"], function () { this.move(directions.W); }],
            [["KeyW", "KeyA"], function () { this.move(directions.NW); }],
            // Arrow keys
            [["ArrowUp"], function () { this.move(directions.N); }],
            [["ArrowUp", "ArrowRight"], function () { this.move(directions.NE); }],
            [["ArrowRight"], function () { this.move(directions.E); }],
            [["ArrowRight", "ArrowDown"], function () { this.move(directions.SE); }],
            [["ArrowDown"], function () { this.move(directions.S); }],
            [["ArrowDown", "ArrowLeft"], function () { this.move(directions.SW); }],
            [["ArrowLeft"], function () { this.move(directions.W); }],
            [["ArrowUp", "ArrowLeft"], function () { this.move(directions.NW); }]
        ];
    }

    initialize(game) {
        this.game = game;
        this.keyboardState.addDelegate(this);
    }

    setPrimaryMovementTarget(target) {
        this.primaryMovementTarget = target;
    }

    get currentKeyAction() {
        for (var i = 0; i < this.actionMaps.length; i++) {
            var actionMap = this.actionMaps[i];
            if (this.keyboardState.areKeyCodesDown(actionMap[0], true)) {
                return actionMap[1];
            }
        }
        return null;
    };

    keyboardStateDidChange(kc, eventType) {
        var action = this.currentKeyAction;
        if (action) {
            action.call(this);
        } else {
            this.stopMoving();
        }

        // single-press events
        if (eventType == "keydown") {
            if (this.keyboardState.areKeyCodesDown(["KeyP"], false)) {
                if (this.game && this.game.isStarted()) {
                    if (this.game.isRunning()) {
                        this.game.pause();
                    } else {
                        this.game.resume();
                    }
                }
            } else if (this.keyboardState.areKeyCodesDown(["Enter"], false)) {
                this.game.renderer.dismissDialog();
            }
        }
    }

    stopMoving() {
        if (this.primaryMovementTarget) {
            this.primaryMovementTarget.stopMoving();
        }
    };

    move(direction) {
        if (this.primaryMovementTarget) {
            this.primaryMovementTarget.moveWithDirection(direction);
        }
    };
};

// ----------------------------------------------------------------------

var Renderer = function(config) {
    this.game = null;
    this.scene = null;
    this.frameCounter = 0;

    var gameView = containerElem.querySelector("gameView");
    this.elems = {
        gameView: gameView,
        sceneContainer: gameView.querySelector("scene"),
        heading: gameView.querySelector("h2"),
        status: gameView.querySelector("status"),
        startPauseResume: containerElem.querySelector(".startPauseResume"),
        frameRate: containerElem.querySelector("frameRate"),
        dialogTemplate: containerElem.querySelector("dialog")
    };

    this.elems.startPauseResume.addEventListener("click", this.startPauseResumeClicked.bind(this));
    this.updateGameRunningStateLabels();
};

Renderer.prototype.startPauseResumeClicked = function(event) {
    event.preventDefault();
    if (!this.game) {
        newGamePrompt.show();
    } else if (this.game.isRunning()) {
        this.game.pause();
    } else {
        this.game.resume();
    }
};

Renderer.prototype.initialize = function(game) {
    this.game = game;
    this.updateGameRunningStateLabels();
    mainRunLoop.addDelegate(this);
};

Renderer.prototype.currentMapDidChange = async function(playerPosition) {
    if (!this.game.currentMap) { return; }

    await this.removeOldScene(true);

    this.elems.heading.innerText = this.game.currentMap.name;
    this.scene = new Gaming.Scene({
        id: "scn-" + this.game.currentMap.id,
        runLoop: mainRunLoop,
        canvasFillStyle: "hsl(0, 0%, 0%)",
        sizeInfo: this.game.currentMap.sizeInfo,
        debug: false
    });

    var oldCanvas = this.elems.sceneContainer.querySelector("canvas");
    if (oldCanvas) {
        this.elems.sceneContainer.removeChild(oldCanvas);
    }
    var canvas = document.createElement("canvas");
    canvas.addRemClass("willFadeIn", true);
    this.elems.sceneContainer.append(canvas);
    this.scene.attachToCanvas(canvas, true);

    this.elems.sceneContainer.style.width = canvas.style.width;
    this.elems.sceneContainer.style.height = canvas.style.height;

    await this.game.currentMap.populateScene(this.scene);
    this.game.player.attachToScene(this.scene, this.game.currentMap, playerPosition);
    setTimeout(() => {
        this.elems.gameView.addRemClass("fadedIn", true);
        canvas.addRemClass("fadedIn", true);
    }, 10);
};

Renderer.prototype.removeOldScene = function(animated) {
    var oldCanvas = this.elems.sceneContainer.querySelector("canvas");
    if (!oldCanvas) { return; }
    if (!animated) {
        this.elems.sceneContainer.removeChild(oldCanvas);
        return;
    }

    this.elems.gameView.addRemClass("fadingOut", true);
    oldCanvas.addRemClass("fadingOut", true);
    return new Promise(resolve => {
        setTimeout(() => {
            this.elems.sceneContainer.removeChild(oldCanvas);
            this.elems.gameView.addRemClass("fadingOut", false);
            resolve();
        }, 250);
    });
};

Renderer.prototype.getDialog = function() {
    return this.elems.sceneContainer.querySelector("dialog");
};

Renderer.prototype.dismissDialog = function() {
    var dialog = this.getDialog();
    if (dialog) {
        dialog.addRemClass("dismissed", true);
        return true;
    } else {
        return false;
    }
};

Renderer.prototype.removeDialogs = function() {
    var dialog = this.getDialog();
    while (dialog) {
        this.elems.sceneContainer.removeChild(dialog);
        dialog = this.getDialog();
    }
};

Renderer.prototype.showDialog = function(text, type, completion) {
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
};

Renderer.prototype.updateGameRunningStateLabels = function() {
    if (!this.game) {
        this.elems.startPauseResume.innerText = "New Game";
        this.elems.frameRate.innerText = "";
    } else if (this.game.isRunning()) {
        this.elems.startPauseResume.innerText = "Pause";
        this.elems.frameRate.innerText = "";
    } else {
        this.elems.startPauseResume.innerText = "Resume";
        this.elems.frameRate.innerText = "Paused";
    }
};

Renderer.prototype.processFrame = function(rl) {
    if (rl != mainRunLoop) { return; }
    this.frameCounter = this.frameCounter + 1;
    if (this.frameCounter % 60 == 0) {
        var frameRate = Math.round(rl.getRecentFrameRate());
        this.elems.frameRate.innerText = `${frameRate} frames/sec`;
    }
};

Renderer.prototype.runLoopWillResume = function(rl) {
    console.log(`Resuming ${rl.id}.`);
    this.updateGameRunningStateLabels();
};

Renderer.prototype.runLoopDidPause = function(rl) {
    console.log(`Paused ${rl.id}.`);
    this.updateGameRunningStateLabels();
};

// ----------------------------------------------------------------------

class GameMap {
    constructor(config) {
        this.id = config.id;
        this.config = config;
    }
    get name() {
        return this.config.name;
    }
    get sizeInfo() {
        return this.config.size;
    }

    async populateScene(scene) {
        if (this.config.type == "blank") {
            var fillItem = new SceneItems.RectFillItem({
                rect: new Rect(new Point(0, 0), this.config.size),
                fillStyle: this.config.color
            });
            fillItem.childItems = [];
            scene.addItem(fillItem, 0);
        }

        if (!this.config.dataFile) { return; }

        var content = await GameContent.loadYamlFromLocalFile(this.config.dataFile, GameContent.cachePolicies.forceOnFirstLoad);
        if (!content) { return; }
        var itemFactory = new SceneItemFactory();
        this.populateSceneLayer(content.terrainLayer, scene, GameMap.layerIndexes.terrain, itemFactory, null);
    }

    populateSceneLayer(configArray, scene, layerIndex, itemFactory, parentItem) {
        if (!configArray) { return; }
        configArray.forEach(itemConfig => {
            const item = itemFactory.itemWithConfig(itemConfig, scene, this, parentItem);
            if (item) {
                this.populateSceneLayer(itemConfig.children, scene, layerIndex, itemFactory, item);
                if (parentItem == null) {
                    console.log(`Added scene with `);
                    scene.addItem(item, layerIndex);
                }
            }
        });
    }
}

GameMap.layerIndexes = {
    terrain: 0
};
GameMap.instanceWithID = function(mapID) {
    var config = GameContent.shared.maps.find(function (cfg) { return cfg.id == mapID; });
    if (!config) {
        console.warn(`Map ID ${mapID} doesn't exist.`);
        return null;
    }
    return new GameMap(config);
};

class SceneItemFactory {
    itemWithConfig(itemConfig, scene, map, parentItem) {
        var item = this.makeLeafItem(itemConfig, scene, map, parentItem);
        if (item) {
            item.childItems = [];
            item.addToParent(parentItem);
        }
        return item;
    }

    makeLeafItem(itemConfig, scene, map, parentItem) {
        this.preprocess(itemConfig, scene, map, parentItem);
        //console.log(itemConfig);
        switch (itemConfig.type) {
            case "ContainerItem": return new SceneItems.ContainerItem(itemConfig);
            case "RectFillItem": return new SceneItems.RectFillItem(itemConfig);
            default:
                console.warn(`Bad SceneItem config type ${itemConfig.type}`);
                return null;
        }
    }

    preprocess(itemConfig, scene, map, parentItem) {
        if (itemConfig.rect) {
            itemConfig.rect = this.preprocessRect(itemConfig.rect, map, parentItem);
        }
    }
    preprocessRect(value, map, parentItem) {
        if (value instanceof Array) {
            return new Rect(value[0], value[1], value[2], value[3]);
        } else if (value == "fillMap") {
            return new Rect(new Point(0, 0), map.sizeInfo);
        } else if (value == "fillParent" && parentItem.rect) {
            return parentItem.rect;
        } else {
            return null;
        }
    }
}

// ----------------------------------------------------------------------

// config: {location: {row,column}, terrain: Terrain}
// items: can be Terrain, ...
var Tile = function(config) {
    this.location = config.location;
    this.terrain = config.terrain;
};

var Terrain = function(config) {
    this.type = config.type; // see Terrain.types
};

Terrain.types = {
    dirt: "dirt",
    water: "water"
};

Terrain.dirt = function() {
    return new Terrain({
        type: Terrain.types.dirt
    });
};

Terrain.water = function() {
    return new Terrain({
        type: Terrain.types.water
    });
};

Terrain.fromData = function(str) {
    switch (str) {
        case "S": return Terrain.dirt();
        case " ": return Terrain.dirt();
        case "w": return Terrain.water();
        default:
            console.log("Unknown terrain string: " + str);
            return null;
    };
};

// ----------------------------------------------------------------------

var Player = function(config) {
    this.game = config.game;
    this.sprite = null;
    this.sceneItem = null;
    this.movementConfig = {
        walkSpeed: GameContent.shared.player.walkSpeed
    };
    
    inputController.setPrimaryMovementTarget(this);
};

Player.prototype.attachToScene = function(scene, map, initialPosition) {
    if (!initialPosition) {
        this.sprite = null;
        this.sceneItem = null;
        return;
    }

    this.sceneItem = new SceneItems.PlayerCharacterItem({
        initialPosition: initialPosition,
        size: {width: 0.8, height: 1.5} // meters
    });
    this.sceneItem.childItems = [];
    scene.addItem(this.sceneItem, 1);

    this.sprite = new Gaming.Sprite({
        item: this.sceneItem,
        runLoop: mainRunLoop
    });
};

Player.prototype.stopMoving = function() {
    if (!this.sprite || !this.sprite.isMoving()) { return; }
    this.sprite.goToVelocity(new Vector(0, 0), Gaming.Easing.quick());
};

Player.prototype.moveWithDirection = function(direction) {
    if (!this.sprite) { return; }
    this.sprite.goToVelocity(Vector.unitsByDirection[direction].scaled(this.movementConfig.walkSpeed))
};

// ----------------------------------------------------------------------

var SceneItems = {};

SceneItems.PlayerCharacterItem = function(config) {
    this.size = config.size;
    this.position = config.initialPosition;
};

Mixins.Gaming.MoveableSceneItem(SceneItems.PlayerCharacterItem, {
    getPosition: function() { return this.position; },
    setPosition: function(newPosition) {
        this.position = newPosition;
        this.setDirty();
    },
    getPaintSize: function() { return this.size; },
    paint: function(ctx) {
        ctx.strokeStyle = "blue";
        ctx.rectStroke(this.getPaintBounds());
    }
});

SceneItems.RectFillItem = function(config) {
    this.rect = config.rect;
    this.fillStyle = config.fillStyle;
    console.log(`Created RectFillItem ${this.rect.debugDescription()}, ${this.fillStyle}`);
};
Mixins.Gaming.SceneItem(SceneItems.RectFillItem, {
    getPaintBounds: function() { return this.rect; },
    paint: function(ctx) {
        ctx.fillStyle = this.fillStyle;
        ctx.rectFill(this.getPaintBounds());
    }
});

SceneItems.ContainerItem = function(config) {
    this.rect = config.rect;
    console.log(`Created ContainerItem ${this.rect.debugDescription()})`);
};
Mixins.Gaming.SceneItem(SceneItems.ContainerItem, {
    getPaintBounds: function() { return this.rect; },
    paint: function(ctx) { }
});

// ----------------------------------------------------------------------

var Game = function(config) {
    this.started = false;
    this.renderer = config.renderer;
    this.inputController = config.inputController;
    this.currentMap = null;
    this.scriptEngine = new GameScriptEngine(this);
    this.player = new Player({
        game: this
    });
};

Game.prototype.start = function() {
    this.renderer.initialize(this);
    this.inputController.initialize(this);
    this.started = true;
    mainRunLoop.addDelegate(this);
    mainRunLoop.resume();
    this.scriptEngine.checkAndFire("_beginGame");
};

Game.prototype.isStarted = function() {
    return this.started;
};

Game.prototype.isRunning = function() {
    return this.isStarted() && mainRunLoop.isRunning();
};

Game.prototype.pause = function() {
    if (!this.isStarted()) { return; }
    mainRunLoop.pause();
};

Game.prototype.resume = function() {
    if (!this.isStarted()) { return; }
    mainRunLoop.resume();
};

Game.prototype.goToMap = function(id, playerPosition) {
    this.currentMap = this.initializeMap(id);
    this.renderer.currentMapDidChange(playerPosition);
};

Game.prototype.initializeMap = function(mapID) {
    return GameMap.instanceWithID(mapID);
};

Game.prototype.agentMoved = function(agent, oldPosition, newPosition) {
    console.log("this.renderer.agentMoved(agent, oldPosition, newPosition);");
};

Game.prototype.processFrame = function(rl) {
};

Game.prototype.runLoopWillResume = function(rl) {
};

Game.prototype.runLoopDidPause = function(rl) {
};

// ----------------------------------------------------------------------

var NewGamePrompt = function() { };
NewGamePrompt.prototype.startGame = function() {
    FiresOfEmbora.game = new Game({
        renderer: renderer,
        inputController: inputController
    });
    FiresOfEmbora.game.start();
};

NewGamePrompt.prototype.show = function() {
    if (!FiresOfEmbora.game) {
        this.startGame();
        return;
    }
    new Gaming.Prompt({
        title: "New Game",
        message: "Start a new game?",
        buttons: [
            { label: "Start Game", action: this.startGame.bind(this), classNames: ["warning"] },
            { label: "Cancel" }
        ]
    }).show();
};

// - DATA -------------------------------------------------------- DATA -

// ----------------------------------------------------------------------

var containerElem = document.querySelector("#root-FiresOfEmbora");
// var controlsRunLoop = new Gaming.RunLoop({
//     targetFrameRate: 30,
//     id: "controlsRunLoop"
// });
var mainRunLoop = new Gaming.RunLoop({
    targetFrameRate: 60,
    id: "mainRunLoop",
    childRunLoops: []
});
var renderer = new Renderer(Renderer.defaultConfig);
var newGamePrompt = new NewGamePrompt();
var inputController = new InputController();

var initialize = async function() {
    var content = await GameContent.loadYamlFromLocalFile("fires-content.yaml", GameContent.cachePolicies.forceOnFirstLoad);
    dataIsReady(content);
};

var dataIsReady = function(content) {
    if (!content) {
        new Gaming.Prompt({
            title: "Failed to load game",
            message: "There was a problem loading the game data.",
            requireSelection: true
        }).show();
        return;
    }

    GameContent.shared = content;

    newGamePrompt.show();
    containerElem.addRemClass("hidden", false);
    document.title = containerElem.querySelector("h1").innerText;
    containerElem.querySelector(".help").addEventListener("click", function (event) {
        event.preventDefault();
        var helpSource = containerElem.querySelector("help");
        new Gaming.Prompt({
            customContent: helpSource.cloneNode(true).addRemClass("hidden", false),
            buttons: [ {label: "Thanks!"} ]
        }).show();
    });
};

//Gaming.GameSelector.allGames.push({ label: document.querySelector("#root-FiresOfEmbora h1").innerText, action: initialize });

return {
    game: null,
    mainRunLoop: mainRunLoop,
    renderer: renderer,
    initialize: initialize,
    GameMap: GameMap
};

})(); // end FiresOfEmbora namespace decl

FiresOfEmbora.initialize();

document.querySelector("#testcanvas2").addRemClass("hidden", true);
