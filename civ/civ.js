import * as Gaming from '../g.js';
import { Strings } from '../locale.js';
import { GameContent, GameScriptEngine } from '../game-content.js';
import { inj, Env, Game } from './game.js';
import { uiReady } from './ui-system.js';
import { initialize as uiGameInitialize } from './ui-game.js';

// Hierarchy guide for module dependencies:
// civ.js app bootstrap
// ui-game.js, ui-pedia.js and other UI
//     ui-system.js shared/root UI
//         game.js and other game engine modules

class AnimationDelegate {
    static resume() {
        if (!AnimationDelegate.shared) {
            AnimationDelegate.shared = new AnimationDelegate();
        }
        if (!Gaming.AnimationFrame.isRunning) {
            Gaming.AnimationFrame.resume(AnimationDelegate.shared);
        }
    }

    static pause() {
        Gaming.AnimationFrame.stop();
    }

    static toggle() {
        if (!Gaming.AnimationFrame.isRunning) {
            AnimationDelegate.resume()
        } else {
            AnimationDelegate.pause();
        }
    }

    constructor() {
        this.last = { hue: NaN };
        this.frameRateCounter = new Gaming.FrameRateCounter({
            elem: document.querySelector("frameRate"),
            updatePeriod: 1500,
            stringKey: "fps"
        });
    }

    processFrame(frame) {
        let updatePeriod = 1000 / 60;
        let hue = Math.round((frame.timestamp / updatePeriod) % 360);
        if (hue != this.last.hue) {
            let color = `hsl(${hue}, 65%, 75%)`;
            document.querySelector("body").style.backgroundColor = color;
        }
        this.last.hue = hue;
        this.frameRateCounter.append(frame);
    }

    stopped(frame) {
        this.frameRateCounter.reset();
    }
}

class CivApp {
    static ready() {
        let game = null;
        try {
            let data = inj().storage.autosaveData;
            if (data) {
                game = Game.fromSerializedSavegame(data);
            }
        } catch (e) {
            Gaming.debugWarn(`Failed to load autosave: ${e.message}`);
            Gaming.debugLog(e.stack);
        }
        
        if (game) {
            inj().gse.executeAsync("resumeSavedGame", game, null, 0);
        } else {
            inj().gse.executeAsync("showFirstRunView", null, null, 0);
        }
    }
}

async function loadContent() {
    GameScriptEngine.shared = new GameScriptEngine();
    inj().gse = GameScriptEngine.shared;
    let cachePolicy = Env.isProduction ? GameContent.cachePolicies.auto : GameContent.cachePolicies.forceOnFirstLoad;
    let content = await GameContent.loadYamlFromLocalFile(`${Env.appURLPath}content.yaml`, cachePolicy);
    Strings.initialize(content.strings, content.pluralStrings, navigator.language);
    return content;
}

export async function initialize() {
    Gaming.debugExpose("Civ", {});
    Env.initialize();
    let content = await loadContent();
    if (!content) {
        document.body.innerText = "Failed to load";
        return;
    }
    Game.initialize(content);
    uiGameInitialize();
    uiReady();
    CivApp.ready();
}
