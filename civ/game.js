import * as Gaming from '../g.js';
import { Strings } from '../locale.js';
import { GameContent } from '../game-content.js';

const debugLog = Gaming.debugLog, Point = Gaming.Point, Rect = Gaming.Rect;

export class Env {
    static initialize() {
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
Env.schemaVersion = 1;
// Set via deployment script
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
        preprocessContent({
            addIndexes: [content.difficulties, content.world.mapSizes, content.zoomLevels],
            addIsDefault: [content.difficulties, content.world.mapSizes, content.zoomLevels],
            localizeNames: [content.difficulties, content.world.mapSizes]
        });
        inj().views = { };
        inj().content = content;
        DifficultyOption.initialize();
        MapSizeOption.initialize();
        ZoomLevel.initialize();
        inj().rng = Gaming.Rng.shared;
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
        .pointRuleset()
        .tileRuleset()
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
            Sz.key("tile", Tile.name)
        ]);
    }
    
    static createNewGame(model) {
        let world = World.createNew(model.world);
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

// A discrete unit-rectangle tile located in a world. Immutable
export class Tile {
    static gridPointForCoord(coord) {
        return new Point(Math.floor(coord.x), Math.floor(coord.y));
    }
    static integralTileHaving(coord) {
        return new Tile(Tile.gridPointForCoord(coord));
    }
    
    constructor(xOrPoint, y) {
        // Grid location and identity
        this.gridPoint = new Point(xOrPoint, y);
        // Precise center point, e.g. (1.5, -0.5)
        this.centerCoord = new Point(this.gridPoint.x + 0.5, this.gridPoint.y + 0.5);
        // Rect of unit size centered on centerCoord, e.g. (2,2,1,1)
        // Rect's origin is == gridPoint
        this.rect = new Rect(this.gridPoint, Tile.unitSize);
    }
    
    isEqual(other) {
        if (!(other instanceof Tile)) { return false; }
        return this.gridPoint.isEqual(other.gridPoint, 0.01);
    }
    
    get debugDescription() {
        return "T" + this.gridPoint.debugDescription;
    }
}
Tile.unitSize = { width: 1, height: 1};

Gaming.Serializer.prototype.pointRuleset = function() {
    return this.ruleset(Point.name, a => new Point(a), [
        Gaming.Serializer.key("x"),
        Gaming.Serializer.key("y")
    ]);
};
Gaming.Serializer.prototype.tileRuleset = function() {
    return this.ruleset(Tile.name, a => new Tile(a.gridPoint), [
        Gaming.Serializer.key("gridPoint", Point.name)
    ]);
};

// Projects a plane of Tile coordinates onto screen points. Origin and y-direction of both coordinate systems are identical, and both are unbounded. All screen points returned are rounded to integers, but non-integer screenPoint inputs are ok. Tile coordinate output can be non-integer.
export class TileProjection {
    constructor(factor) {
        // Number of screen points per tile coordinate
        this.factor = factor;
    }
    
    supportingOffset_screenPointForTileCoord(coord) {
        this.centerCoord = new Point(7.5, 3.24);
    }
    
    lengthForScreenLength(screenLength) {
        return screenLength / this.factor;
    }
    
    sizeForScreenSize(size) {
        return {width: size.width / this.factor, height: size.height / this.factor};
    }
    
    coordForScreenPoint(screenPoint) {
        return new Point(screenPoint.x / this.factor, screenPoint.y / this.factor);
    }
    
    screenPointForCoord(tileCoord) {
        return new Point(tileCoord.x * this.factor, tileCoord.y * this.factor)
            .integral();
    }
    
    screenSizeForSize(tileSize) {
        return {
            width: Math.round(tileSize.width * this.factor),
            height: Math.round(tileSize.height * this.factor)
        };
    }
    
    screenRectForRect(coordRect) {
        return new Rect(
            this.screenPointForCoord(coordRect.origin),
            this.screenSizeForSize(coordRect.size));
    }
    
    screenRectForTile(tile) {
        return this.screenRectForRect(tile.rect);
    }
}

export class World {
    static fromSavegame(a) { return new World(a); }
    
    static createNew(model) {
        let planet = Planet.createNew(model.planet);
        return new World({
            planet: planet,
            civs: [new Civilization({ name: "Placelandia" })],
            units: [new CivUnit({
                type: "Settler",
                tile: new Tile(planet.centerTile.gridPoint.adding(2, 3))
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
    
    static createNew(model) {
        return new Planet({ size: model.mapSizeOption.size });
    }
    
    constructor(a) {
        this.rect = new Rect(new Point(0, 0), a.size);
        this._centerTile = Tile.integralTileHaving(this.rect.center);
    }
    
    get size() { return this.rect.size; }
    get centerTile() { return this._centerTile; }
    get centerCoord() { return this.rect.center; }
}

export class Civilization {
    static fromSavegame(a) { return new Civilization(a); }
    
    constructor(a) {
        this.id = a.id || Identifier.random();
        this.name = a.name;
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
        this.tile = a.tile;
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
    
    setObject(collection, key, value, compress) {
        let item = collection.getItem(collection.namespace);
        let data = item ? item.data : { };
        data[key] = value;
        collection.saveItem(new Gaming.SaveStateItem(collection.namespace, collection.namespace, Date.now(), data, compress), {});
    }
}

export class DifficultyOption {
    static initialize() {
        inj().content.difficulties = inj().content.difficulties.map(item => new DifficultyOption(item));
    }
    
    static all() { return inj().content.difficulties; }
    static indexOrDefault(value) { return GameContent.itemOrDefaultFromArray(inj().content.difficulties, value); }
    static getDefault() { return GameContent.defaultItemFromArray(inj().content.difficulties); }
    
    constructor(a) {
        Object.assign(this, a);
    }
    
    get debugDescription() { return `<DifficultyOption#${this.index} ${this.name}>`; }
    
    isEqual(other) {
        if (!other) { return false; }
        return this.index == other.index;
    }
}

export class MapSizeOption {
    static initialize() {
        inj().content.world.mapSizes = inj().content.world.mapSizes.map(item => new MapSizeOption(item));
    }
    
    static all() { return inj().content.world.mapSizes; }
    static withIDorDefault(id) {
        return MapSizeOption.all().find(item => item.id == id) || MapSizeOption.getDefault();
    }
    static getDefault() { return GameContent.defaultItemFromArray(MapSizeOption.all()); }
    
    constructor(a) {
        Object.assign(this, a);
    }
    
    get debugDescription() { return `<MapSizeOption#${this.id} ${this.size.width}x${this.size.height}>`; }
    
    isEqual(other) {
        if (!other) { return false; }
        return this.id == other.id;
    }
}

export class ZoomLevel {
    static initialize() {
        inj().content.zoomLevels = inj().content.zoomLevels.map(item => new ZoomLevel(item));
    }
    
    static all() { return inj().content.zoomLevels; }
    static indexOrDefault(value) {
        if (value instanceof ZoomLevel) { return value; }
        return GameContent.itemOrDefaultFromArray(inj().content.zoomLevels, value);
    }
    static getDefault() { return GameContent.defaultItemFromArray(inj().content.zoomLevels); }
    
    constructor(a) {
        Object.assign(this, a);
    }
    
    get next() {
        return ZoomLevel.all()[this.index + 1];
    }
    
    get previous() {
        return ZoomLevel.all()[this.index - 1];
    }
    
    get debugDescription() { return `<ZoomLevel#${this.index} ${this.tileWidth}w>`; }
}

function preprocessContent(a) {
    function iterate(o, block) {
        if (Array.isArray(o)) {
            o.forEach((item, index) => block(item, index));
        } else if (!!o) {
            Object.getOwnPropertyNames(o).forEach(key => {
                block(o[key], key);
            });
        }
    }
    
    a.addIndexes.forEach(GameContent.addIndexToItemsInArray);
    a.addIsDefault.forEach(obj => {
        iterate(obj, item => { item.isDefault = !!item.isDefault; });
    });
    a.localizeNames.forEach(obj => {
        if (obj.hasOwnProperty("nameKey")) {
            obj.name = Strings.str(obj.nameKey);
        } else {
            iterate(obj, item => {
                if (item && item.hasOwnProperty("nameKey")) {
                    item.name = Strings.str(item.nameKey);
                }
            });
        }
    });
}
