"use-strict";

import { debugLog, once, KeyInputController } from './g.js';

export class GameScriptEngine {
    constructor() {
        this._commandRegistry = {};
        this.debug = false;
    }

    get allCommandIDs() {
        return Object.getOwnPropertyNames(this._commandRegistry).sort();
    }

    registerCommand(id, block) {
        this._commandRegistry[id] = block;
    }

    execute(id, subject, evt) {
        var command = this._commandRegistry[id];
        if (command) {
            if (this.debug) { debugLog("Execute command " + id); }
            return command(subject, evt);
        }

        // TODO look for a script in YAML
        // To make it really scriptable: objects register themselves as Scriptables with the GameScriptEngine.
        // this._scriptables = { id -> object }
        // Scriptable protocol:
        //   getValueForKey(key). setValueForKey(key, value).
        //   handlesCommand(id). performCommand(id, value).
        // so a script and YAML can do something like this:
        // # line 1: result = $1 = GSE.getScriptable("game").getValueForKey("abc")
        // game get abc
        // # line 2: result = $2 = GSE.getScriptable("chrome").performCommand("showDialog", "hello")
        // chrome do showDialog hello
        // # line 3: result = $3 = GSE.getScriptable("game").performCommand("def", <result of line 1>)
        // game do def $1
        // # line 4: result = $4 = GSE.getScriptable("game").setValueForKey("ghi", <result of line 3>)
        // game set ghi $3
        //
        // if _scriptables[id] doesn't exist, getScriptable returns a NoopScriptable object that 
        // returns null for all getters and silently swallows all performCommands, to prevent null exceptions.

        once("GameScriptEngine.unknownCommand." + id, () => debugLog("Unknown command ID " + id));
        return undefined;
    }
}

if (!EventTarget.prototype.addGameCommandEventListener) {
    EventTarget.prototype.addGameCommandEventListener = function(eventType, preventDefault, command, subject) {
        this.addEventListener(eventType, (evt) => {
            if (preventDefault) { evt.preventDefault(); }
            GameScriptEngine.shared.execute(command, subject);
        });
    };
}

export class GameContent {
    static loadYamlFromLocalFile(path, cachePolicy) {
        if (typeof cachePolicy === "undefined") {
            cachePolicy = GameContent.cachePolicies.auto;
        }

        var url = new URL(path, window.location.href);
        var oneTimeLoadKey = url.toString();
        var bustCache = false;
        switch (cachePolicy) {
            case GameContent.cachePolicies.forceOnFirstLoad:
                bustCache = !GameContent.oneTimeLoadKeys.has(oneTimeLoadKey);
                break;
            case GameContent.cachePolicies.alwaysForce:
                bustCache = true;
                break;
        }
        if (bustCache) {
            url.searchParams.append("bustCache", new Date().getTime());
        }

        return new Promise(resolve => {
            const request = new XMLHttpRequest();
            request.addEventListener("load", function() {
                var content = jsyaml.safeLoad(this.responseText);
                GameContent.oneTimeLoadKeys.add(oneTimeLoadKey);
                resolve(content);
            });
            request.open("GET", url.toString());
            request.send();
        });
    }

    static addIndexToItemsInArray(items) {
        if (!items) { return; }
        items.forEach((item, index) => {
            if (typeof(item.index) === 'undefined') {
                item.index = index;
            }
        });
    }

    static addIdToItemsInDictionary(items) {
        if (!items) { return; }
        Object.getOwnPropertyNames(items).forEach(id => {
            var item = items[id];
            if (typeof(item.id) === 'undefined') {
                item.id = id;
            }
        });
    }

    static itemOrDefaultFromArray(items, index) {
        return items.isIndexValid(index) ? items[index] : GameContent.defaultItemFromArray(items);
    }

    static defaultItemFromArray(items) {
        return items.find(item => item.isDefault);
    }

    static itemOrDefaultFromDictionary(items, id) {
        var found = items[id];
        return typeof(found) === 'undefined' ? GameContent.defaultItemFromDictionary(items) : found;
    }

    static defaultItemFromDictionary(items) {
        let item = null;
        Object.getOwnPropertyNames(items).forEach(id => {
            if (!!items[id].isDefault) item = items[id];
        });
        return item;
    }
}
GameContent.cachePolicies = {
    auto: 0,
    forceOnFirstLoad: 1,
    alwaysForce: 2
};
GameContent.oneTimeLoadKeys = new Set();

KeyInputController.prototype.addGameScriptShortcut = function(code, shift, script, subject) {
    this.addShortcutListener({ id: script, code: code, shift: shift }, (controller, shortcut, evt) => {
        GameScriptEngine.shared.execute(script, subject, evt);
    });
};
