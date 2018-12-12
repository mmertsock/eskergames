"use-strict";

class GameScript {
    constructor(config) {
        this.id = config.id;
        this.predicate = config.predicate;
        this.actions = config.actions;
        this.fireOnce = config.fireOnce;
        this.dialogs = config.dialogs;
        this.fireCount = 0;
    }

// TODO implement per-subject shouldFire and other stuff.
    shouldFire(engine, subject) {
        if (this.fireOnce && this.fireCount > 0) { return false; }
        return this.predicate(engine, this);
    }

    willFire(engine, subject) {
        this.fireCount += 1;
    }
}

class GameScriptYamlParser {
    constructor() {
        this.always = () => true;
        this.never = () => false;
    }

    parseScript(config) {
        config.predicate = this.predicateFor(config.predicate);
        if (config.actions) {
            config.actions = this.actionArrayFor(config.actions);
        } else if (config.action) {
            config.actions = [this.tokenizedActionFor(config.action)];
        } else {
            config.actions = [];
        }
        config.dialogs = config.dialogs || [];
        return config
    }

    validateScript(config) {
        // TODO ensure that action strings, etc. are valid so we know 
        // at game start rather than waiting until they are executed
        return true;
    }

    predicateFor(value) {
        if (!value || (value == "always")) {
            return this.always;
        }
        console.warn(`Bad GameScript predicate config: ${value}`);
        return this.never;
    }
    actionArrayFor(value) {
        if (typeof value === "undefined") { return []; }
        var actions = value instanceof Array ? value : [value]
        return actions.map(a => this.tokenizedActionFor(a))
    }
    tokenizedActionFor(value) {
        return value instanceof Array ? value : [value]
    }

    async interpret(action, engine, script, subject) {
        var tokens = action.map(t => t.trim ? t.trim() : t);
        //console.log(`--Interpreting script action: ${tokens.join(", ")}`);
        const actionType = tokens.shift();
        switch (actionType) {
        case "showDialog":
            const [index, displayType] = tokens;
            return await engine.showDialog(script.dialogs[parseInt(index || 0)], displayType);
        case "goToMap":
            const [mapID, x, y] = tokens;
            const playerPosition = (typeof y === "undefined") ? null : new Gaming.Point(parseFloat(x), parseFloat(y))
            return engine.goToMap(mapID, playerPosition)
        case "wait":
            const [durationSeconds] = tokens;
            return await engine.wait(parseFloat(durationSeconds))
        case "hello":
            console.log("hello!");
            return;
        default:
            console.warn(`Bad GameScript action config: ${action}`);
            return engine.noop();
        }
    }
}

class GameScriptEngine {
    constructor(game) {
        this.game = game;
        this.parser = new GameScriptYamlParser()
        this.items = GameContent.shared.scripts
            .map(cfg => this.parser.parseScript(cfg))
            .filter(cfg => this.parser.validateScript(cfg))
            .map(cfg => new GameScript(cfg));
    }

    withID(id) {
        const script = this.items.find(item => item.id == id)
        if (!script) {
            console.warn(`GameScript with id ${id} is not in this registry.`);
        }
        return script;
    }

    async checkAndFire(scriptOrID, subject) {
        const script = scriptOrID instanceof GameScript ? scriptOrID : this.withID(scriptOrID)
        if (!script || !script.shouldFire(this, subject)) {
            return false;
        }

        console.log(`Firing GameScript ${script.id}`);
        script.willFire(this, subject);

        var actionQueue = script.actions.slice();
        try {
            while (actionQueue.length > 0) {
                await this.parser.interpret(actionQueue.shift(), this, script, subject);
            }
        } catch(e) {
            console.warn(`Error during GameScript ${script.id}'s actions: ${e}`);
        }
    }

    showDialog(text, displayType) {
        return new Promise(resolve => {
            this.game.renderer.showDialog(text, displayType, resolve);
        });
    }

    goToMap(mapID, playerPosition) {
        this.game.goToMap(mapID, playerPosition);
    }

    wait(durationSeconds) {
        return new Promise(resolve => {
            setTimeout(() => resolve(), durationSeconds * 1000);
        });
    }

    noop() { }
}

class GameContent {
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
}
GameContent.cachePolicies = {
    auto: 0,
    forceOnFirstLoad: 1,
    alwaysForce: 2
};
GameContent.oneTimeLoadKeys = new Set();
