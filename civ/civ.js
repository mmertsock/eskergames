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
