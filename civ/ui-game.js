import * as Gaming from '../g.js';
import { Strings } from '../locale.js';
import { inj, Game, GameEngine } from './game.js';
import { UI, ScreenView } from './ui-system.js';

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn;

export function initialize() {
    inj().session = new GameSession();
    CutsceneView.initialize();
}

class GameSession {
    constructor() {
        this.engine = new GameEngine();
        inj().gse.registerCommand("beginNewGame", (model, evt) => {
            this.beginNewGame(model);
        });
        inj().gse.registerCommand("resumeSavedGame", (game) => {
            this.resumeGame(game);
        });
    }
    
    beginNewGame(model) {
        inj().gse.execute("playCutscene", "loading");
        // create a world
        // create civilizations and players
        let game = Game.createNewGame(model);
        // init the engine
        this.engine.setGame(game);
        // trigger the new-game story cutscene
        // cutscene ends and shows the GameSessionView
        GameSessionView.shared().show();
        // TODO set last difficulty index.
        // or really it's multiple properties from the new-game wizard, basically a subset of the new-game-model.
        this.autosave();
    }
    
    resumeGame(game) {
        inj().gse.execute("playCutscene", "loading");
        this.engine.setGame(game);
        GameSessionView.shared().show();
    }
    
    autosave() {
        if (!this.engine.game) { return; }
        try {
            let data = this.engine.game.serializedSavegameData;
            inj().storage.autosaveData = data;
        } catch (e) {
            debugWarn(`Failed to autosave: ${e.message}`);
            debugLog(e.stack);
        }
    }
}

class GameSessionView extends ScreenView {
    static shared() {
        if (!GameSessionView._shared) {
            GameSessionView._shared = new GameSessionView("game");
        }
        return GameSessionView._shared;
    }
    
    constructor(id) {
        super(id);
        this.session = inj().session;
        this.views = [
            // menubar view
            new GameContentView({ elem: document.querySelector("#game > content") })
            // statusbar view
        ];
    }
    
    didShow() {
        // resume animation
        UI.traverseSubviews(this, view => {
            if (view.screenDidShow) { view.screenDidShow(this); }
        });
    }
    
    didHide() {
        // pause animation
        UI.traverseSubviews(this, view => {
            if (view.screenDidHide) { view.screenDidHide(this); }
        });
    }
}

// world canvas, side panels, overlays
class GameContentView {
    constructor(a) {
        this.session = inj().session;
        this.elem = a.elem;
        this.views = [
            new WorldCanvasView({ parent: this.elem })
        ];
    }
    
    screenDidShow() {
        
    }
}

class WorldCanvasView {
    constructor(a) {
        this.session = inj().session;
        this.metrics = inj().content.worldView;
        this.pixelScale = window.devicePixelRatio;
        this.canvas = a.parent.querySelector("canvas.world");
        this.tilePlane = null;
    }
    
    get game() { return this.session.engine.game; }
    
    screenDidShow() {
        // only if needed for the current game
        this.configureCanvas();
        this.render();
    }
    
    configureCanvas() {
        this.isEnabled = !!this.game;
        this.canvas.addRemClass("hidden", !this.isEnabled);
        if (!this.isEnabled) { return; }
        let worldSize = this.game.world.planet.size;
        let tileWidth = this.metrics.zoomLevels[3].tileWidth;
        const tileDeviceWidth = tileWidth * this.pixelScale;
        
        this.tilePlane = new Gaming.TilePlane(worldSize, tileDeviceWidth);
        this.tilePlane.viewportSize = { width: this.tilePlane.size.width * tileDeviceWidth, height: this.tilePlane.size.height * tileDeviceWidth };
        
        this.canvas.style.width = `${this.tilePlane.size.width * tileWidth}px`;
        this.canvas.style.height = `${this.tilePlane.size.height * tileWidth}px`;
        const canvasDeviceSize = this.tilePlane.viewportSize;
        this.canvas.width = canvasDeviceSize.width;
        this.canvas.height = canvasDeviceSize.height;
    }
    
    getRenderContext() {
        return {
            ctx: this.canvas.getContext("2d"),
            metrics: this.metrics,
            pixelScale: this.pixelScale,
            tilePlane: this.tilePlane,
            session: this.session
        };
    }
    
    render() {
        if (!this.game) { return; }
        let c = this.getRenderContext();
        c.ctx.rectClear(c.tilePlane.viewportScreenBounds);
        
        c.ctx.fillStyle = c.metrics.canvasFillStyle;
        c.ctx.rectFill(c.tilePlane.viewportScreenBounds);
        
        this.game.world.units.forEach(unit => {
            c.ctx.fillStyle = "green";
            let rect = c.tilePlane.screenRectForModelTile(unit.location);
            c.ctx.rectFill(rect);
        });
        
        c.ctx.strokeStyle = c.metrics.tileGrid.strokeStyle;
        c.ctx.lineWidth = c.metrics.tileGrid.lineWidth;
        c.ctx.rectStroke(c.tilePlane.viewportScreenBounds.inset(4, 4));
        c.ctx.rectStroke(c.tilePlane.viewportScreenBounds.inset(12, 12));
    }
}

class CutsceneView extends ScreenView {
    static initialize() {
        inj().gse.registerCommand("playCutscene", (sceneID, evt) => {
            CutsceneView.shared().show().play(sceneID);
        });
    }
    
    static shared() {
        if (!CutsceneView._shared) {
            CutsceneView._shared = new CutsceneView();
        }
        return CutsceneView._shared;
    }
    
    constructor() {
        super("cutscene");
        this.session = inj().session;
        this.scene = null;
    }
    
    play(sceneID) {
        stop();
        this.scene = inj().content.cutscenes[sceneID];
        if (!this.scene) {
            debugWarn(`Unknown cutscene ${sceneID}`);
            this.stop();
            this.showError(sceneID);
            return;
        }
        this.sceneID = sceneID;
        this.stepIndex = -1;
        this.performNextStep();
    }
    
    stop() {
        // distinct from any pause() concept
        // stop and unload the current cutscene's media from memory
        this.scene = null;
        this.sceneID = null;
        this.stepIndex = -1;
    }
    
    performNextStep() {
        this.stepIndex += 1;
        if (this.stepIndex >= this.scene.length) { return; }
        this.perform(this.scene[this.stepIndex]);
    }
    
    perform(step) {
        this.clearContent();
        try {
            Gaming.deserializeAssert(Array.isArray(step));
            switch (step[0]) {
                case "showText": return this.showText(step);
                default:
                    debugWarn(`Unknown step type in ${this.sceneID}`);
                    return this;
            }
        } catch (e) {
            debugWarn(`Bad step data in ${this.sceneID}`);
            this.showError(this.sceneID);
        }
    }
    
    clearContent() {
        this.elem.removeAllChildren();
        this.elem.innerText = "";
    }
    
    showError(sceneID) {
        this.elem.innerText = `Error in cutscene ${sceneID}`;
    }
    
    showText(step) {
        Gaming.deserializeAssert(step.length == 2);
        this.elem.innerText = Strings.str(step[1]);
    }
    
    didHide() {
        stop();
    }
}
