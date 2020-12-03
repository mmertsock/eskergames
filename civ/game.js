import * as Gaming from '../g.js';
import { Strings } from '../locale.js';
import { GameContent } from '../game-content.js';

const debugLog = Gaming.debugLog, Point = Gaming.Point;

export class Env {
    static initialize() {
        Env.schemaVersion = 1;
        Gaming.debugExpose("Civ").inj = inj();
        Gaming.debugExpose("Civ").Env = Env;
        let version = import.meta.url.match(/civ\/([0-9.]+)\//);
        if (version && version.length == 2) {
            Env.isProduction = true;
            Env.appVersion = version[1];
            Env.appURLPath = `${Game.appVersion}/app/`;
            Env.libURLPath = `${Game.appVersion}/`;
        } else {
            Env.isProduction = false;
            Env.appURLPath = "./";
            Env.libURLPath = "../";
        }
    }
}
Env.appVersion = "v0.0.0";
// These are relative to root document URL, with trailing slash
Env.appURLPath = './';
Env.libURLPath = '../';

export class Identifier {
    // 16 hex digits = 64 bits of entropy
    static random() { return inj().rng.nextHexString(16); }
}

export class Injection {
}
Injection.shared = new Injection();
export function inj() { return Injection.shared; }

export class Game {
    static initialize(content) {
        GameContent.addIndexToItemsInArray(content.difficulties);
        content.difficulties = content.difficulties.map(item => new Difficulty(item));
        inj().rng = Gaming.Rng.shared;
        inj().content = content;
        
        inj().storage = new GameStorage(window.localStorage);
        
        inj().gse.registerCommand("getAppInfo", (subject, env) => {
            return {
                appVersion: Env.appVersion
            };
        });
        
        const Sz = Gaming.Serializer;
        Game.savegameSerializer = new Sz(
            Env.schemaVersion,
            new Gaming.Serializer.VerboseObjectStrategy(),
            Game.fromSavegame,
            [
                Sz.key("world", World.name),
                Sz.key("players", [Player.name])
            ]
        )
        .ruleset(World.name, World.fromSavegame, [
            Sz.key("planet", Planet.name),
            Sz.key("civs", [Civilization.name]),
            Sz.key("units", [CivUnit.name])
        ])
        .ruleset(Player.name, Player.fromSavegame, [
            Sz.key("name"),
            Sz.key("civ", Sz.reference("id", Civilization.name))
        ])
        .ruleset(Planet.name, Planet.fromSavegame, [
            Sz.key("size")
        ])
        .ruleset(Civilization.name, Civilization.fromSavegame, [
            Sz.key("id"),
            Sz.key("name")
        ])
        .ruleset(CivUnit.name, CivUnit.fromSavegame, [
            Sz.key("type"),
            // when a rule's rulesetID is null, look for 
            // Gaming's objectForSerialization/fromSerializedObject
            // and use that instead of raw value sz/dz?
            Sz.key("location", "Point")
        ])
        .ruleset("Point", p => new Point(p), [
            Sz.key("x"),
            Sz.key("y")
        ]);
    }
    
    static createNewGame(model) {
        let world = World.sample();
        return new Game({
            world: world,
            players: [new Player({
                name: "me",
                civ: world.civs[0]
            })]
        });
    }
    
    static fromSerializedSavegame(data) {
        return Game.savegameSerializer.deserialize(data);
    }
    static fromSavegame(a) { return new Game(a); }
    
    constructor(a) {
        this.world = a.world;
        this.players = a.players;
    }
    
    get serializedSavegameData() {
        return Game.savegameSerializer.serialize(this);
    }
}

export class World {
    static fromSavegame(a) { return new World(a); }
    
    static sample() {
        return new World({
            planet: new Planet({ size: { width: 24, height: 12 } }),
            civs: [new Civilization({ name: "Placelandia" })],
            units: [new CivUnit({
                type: "Settler",
                location: new Point(4, 2)
            })]
        });
    }
    
    constructor(a) {
        this.planet = a.planet;
        this.civs = a.civs;
        this.units = a.units;
    }
}

export class Planet {
    static fromSavegame(a) { return new Planet(a); }
    
    constructor(a) {
        this.size = { width: a.size.width, height: a.size.height };
    }
}

export class Civilization {
    static fromSavegame(a) { return new Civilization(a); }
    
    constructor(a) {
        this.id = a.id || Identifier.random();
        this.name = a.name;
        if (a.id) {
            debugLog(`Restored civ ID ${this.id}`);
        } else {
            debugLog(`Created civ ID ${this.id}`);
        }
    }
}

export class Player {
    static fromSavegame(a) { return new Player(a); }
    
    constructor(a) {
        this.name = a.name;
        this.civ = a.civ;
    }
}

export class CivUnit {
    static fromSavegame(a) { return new CivUnit(a); }
    
    constructor(a) {
        this.type = a.type;
        this.location = new Point(a.location);
    }
}

export class GameEngine {
    constructor() {
        this.game = null;
    }
    
    setGame(game) {
        this.game = game;
    }
}

class GameStorage {
    constructor(source) {
        this.preferencesCollection = new Gaming.SaveStateCollection(source, "CivSettings");
        this.autosaveCollection = new Gaming.SaveStateCollection(source, "CivAutosave");
    }
    
    get lastDifficultyIndex() {
        return this.getObject(this.preferencesCollection, "lastDifficultyIndex");
    }
    set lastDifficultyIndex(value) {
        this.setObject(this.preferencesCollection, "lastDifficultyIndex", value);
    }
    
    get autosaveData() {
        return this.getObject(this.autosaveCollection, "autosave");
    }
    set autosaveData(value) {
        this.setObject(this.autosaveCollection, "autosave", value);
    }
    
    // Private
    
    getObject(collection, key) {
        let item = collection.getItem(collection.namespace);
        return item ? item.data[key] : undefined;
    }
    
    setObject(collection, key, value) {
        let item = collection.getItem(collection.namespace);
        let data = item ? item.data : { };
        data[key] = value;
        collection.saveItem(new Gaming.SaveStateItem(collection.namespace, collection.namespace, Date.now(), data), {});
    }
}

export class Difficulty {
    static all() { return inj().content.difficulties; }
    static index(value) { return GameContent.itemOrDefaultFromArray(inj().content.difficulties, value); }
    static getDefault() { return GameContent.defaultItemFromArray(inj().content.difficulties); }
    
    constructor(a) {
        this.index = a.index;
        this.isDefault = !!a.isDefault;
        this.name = Strings.str(a.nameKey);
    }
    
    get debugDescription() { return `<Difficulty#${this.index} ${this.name}>`; }
    
    isEqual(other) {
        if (!other) { return false; }
        return this.index == other.index;
    }
}
