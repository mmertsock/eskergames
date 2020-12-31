import * as Gaming from '../g.js';
import { Strings } from '../locale.js';
import { GameContent } from '../game-content.js';

const debugLog = Gaming.debugLog, directions = Gaming.directions, precondition = Gaming.precondition;
const Point = Gaming.Point, Vector = Gaming.Vector, Rect = Gaming.Rect;

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
    static randomSeed() { return inj().rng.nextIntOpenRange(0, 256); }
}
Identifier.maxRandomSeed = 256;

export class Injection {
}
Injection.shared = new Injection();
export function inj() { return Injection.shared; }

export class Game {
    static initialize(content) {
        preprocessContent({
            addIndexes: [content.difficulties, content.world.mapSizes, Terrain.baseTypes],
            addIDs: [content.spritesheets, content.civs],
            addIsDefault: [content.difficulties, content.world.mapSizes, Terrain.baseTypes],
            localizeNames: [content.difficulties, content.world.mapSizes]
        });
        inj().views = { };
        inj().content = content;
        DifficultyOption.initialize();
        MapSizeOption.initialize();
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
                Sz.key("players", [Player.name]),
                Sz.key("ui")
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
            Sz.key("map", RectMap.name)
        ])
        .ruleset(RectMap.name, RectMap.fromSavegame, [
            Sz.key("size"),
            Sz.key("flattenedSquares", [MapSquare.name])
        ])
        .ruleset(MapSquare.name, MapSquare.fromSavegame, [
            Sz.key("terrain", Terrain.name)
        ])
        .ruleset(Terrain.name, Terrain.fromSavegame, [
            Sz.key("baseTypeIndex"),
            Sz.key("randomSeed")
        ])
        .ruleset(Civilization.name, Civilization.fromSavegame, [
            Sz.key("id")
        ])
        .ruleset(CivUnit.name, CivUnit.fromSavegame, [
            Sz.key("type"),
            Sz.key("civ", Sz.reference("id", Civilization.name)),
            Sz.key("tile", Tile.name)
        ]);
    }
    
    static createNewGame(model) {
        let world = World.createNew(model);
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
        precondition(a?.world instanceof World);
        precondition(Array.isArray(a?.players));
        this.world = a.world;
        this.players = a.players;
        // Raw opaque object for direct serialization
        this.ui = a.ui || {};
    }
    
    get serializedSavegameData() {
        return Game.savegameSerializer.serialize(this);
    }
}

// Describes the integer coordinate bounds of a discrete unit-rectangle tile. Immutable
export class Tile {
    constructor(coordOrX, y) {
        this.coord = new Point(coordOrX, y).floor();
        this.centerCoord = new Point(this.coord.x + 0.5, this.coord.y + 0.5);
        this.rect = new Rect(this.coord, Tile.unitSize);
    }
    isEqual(other) {
        return this.coord.x == other.coord?.x
            && this.coord.y == other.coord?.y;
    }
    
    get debugDescription() {
        return `T(${this.coord.x},${this.coord.y})`;
    }
    
    adjacent(direction) {
        return new Tile(this.coord.adding(Gaming.Vector.manhattanUnits[direction]));
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
    return this.ruleset(Tile.name, a => new Tile(a.coord), [
        Gaming.Serializer.key("coord", Point.name)
    ]);
};

export class TileEdge {
    // type == TileEdge.H or .V
    constructor(map, tile, type) {
        this.map = map;
        this.tile = tile;
        this.type = type;
        let metrics = TileEdge.types[this.type];
        this.toTile = tile.adjacent(metrics.tileDirection);
        this.unitRect = this.tile.rect.offsetBy(metrics.unitRectOffset);
        this.isHorizontal = metrics.isHorizontal;
    }
    
    get debugDescription() {
        return `<TileEdge:${TileEdge.types[this.type].description} ${this.tile.debugDescription}-${this.toTile.debugDescription}>`;
    }
    get square() { return this.map.squareAtTile(this.tile); }
    get toSquare() { return this.map.squareAtTile(this.toTile); }
}
TileEdge.H = 0; // Horizontal line between Tiles x,y and x,y-1
TileEdge.V = 1; // Vertical line between Tiles x,y and x-1,y
TileEdge.types = [
    {
        description: "H",
        isHorizontal: true,
        lineOffset: new Vector(1, 0),
        tileDirection: directions.S,
        unitRectOffset: new Vector(0, -0.5)
    },
    {
        description: "V",
        isHorizontal: false,
        lineOffset: new Vector(0, 1),
        tileDirection: directions.W,
        unitRectOffset: new Vector(-0.5, 0)
    }
];

// Projects a plane of Tile coordinates onto screen points. Origin and y-direction of both coordinate systems are identical, and both are unbounded. All screen points returned are rounded to integers, but non-integer screenPoint inputs are ok. Tile coordinate output can be non-integer.
export class TileProjection {
    constructor(factor) {
        // Number of screen points per tile coordinate
        this.factor = factor;
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

// The geometry of a game world, and all objects located within the world.
export class World {
    static fromSavegame(a) { return new World(a); }
    
    static createNew(model) {
        let sizeOption = model.world.planet.mapSizeOption;
        let civ = new Civilization(model.playerCiv?.id);
        return new World({
            planet: new Planet({ size: sizeOption.size }),
            civs: [civ],
            units: [new CivUnit({
                type: "settler",
                civ: civ,
                tile: new Tile(new Point(sizeOption.size.width * 0.48, sizeOption.size.height * 0.7))
            })]
        });
    }
    
    constructor(a) {
        this.planet = a.planet;
        this.civs = Array.isArray(a.civs) ? a.civs : [];
        this.units = Array.isArray(a.units) ? a.units : [];
        this.planet.world = this;
        this.civs.forEach(item => item.world = this);
        this.units.forEach(item => item.world = this);
    }
}

// Data stored at a Tile within a specific RectMap
// Abstract class.
export class MapSquare {
    constructor(map, tile) {
        this.map = map;
        this.tile = tile;
        this.edges = new Array(4);
    }
    
    neighbor(compassDirection) {
        return this.map.adjacentSquare(this, compassDirection);
    }
    edge(edgeDirection) { return this.edges[edgeDirection]; }
    
    rehydrate(data) {
        Object.assign(this, data);
    }
}
MapSquare.edges = { N: 0, E: 1, S: 2, W: 3 };

export class RectMap {
    static fromSavegame(a) {
        let map = new RectMap(a.size);
        let i = 0;
        map.forEachSquare(square => {
            square.rehydrate(a.flattenedSquares[i]);
            i += 1;
        });
        return map;
    }
    
    constructor(size) {
        precondition(size?.width > 0, "RectMap width > 0");
        precondition(size?.height > 0, "RectMap height > 0");
        this.size = size;
        this.tileRect = new Rect(0, 0, size.width, size.height);
        this._squares = Array.make2D(this.size, coord => {
            return new MapSquare(this, new Tile(coord));
        });
        this._edges = [];
        for (let y = 0; y <= this.size.height; y += 1) {
            for (let x = 0; x <= this.size.width; x += 1) {
                // Edges pointing N and W of square (x, y)
                if (x < this.size.width) {
                    let edge = new TileEdge(this, new Tile(x, y), TileEdge.H);
                    this._edges.push(edge);
                    if (y > 0) {
                        this._squares[y-1][x].edges[MapSquare.edges.N] = edge;
                    }
                    if (y < this.size.height) {
                        this._squares[y][x].edges[MapSquare.edges.S] = edge;
                    }
                }
                if (y < this.size.height) {
                    let edge = new TileEdge(this, new Tile(x, y), TileEdge.V);
                    this._edges.push(edge);
                    if (x > 0) {
                        this._squares[y][x-1].edges[MapSquare.edges.E] = edge;
                    }
                    if (x < this.size.width) {
                        this._squares[y][x].edges[MapSquare.edges.W] = edge;
                    }
                }
            }
        }
    }
    
    // For serialization
    get flattenedSquares() { return this.flatMapSquares(s => s); }
    
    isValidTile(tile) { return this.tileRect.containsTile(tile.coord); }
    
    // The MapSquare at a given coordinate. Null if invalid coordinate
    squareAtTile(tile) {
        if (!this.isValidTile(tile)) { return null; }
        return this._squares[tile.coord.y][tile.coord.x];
    }
    
    forEachSquare(block) {
        this._squares.forEachFlat(block);
    }
    
    // Loops over unique edges, sorted by y then x then H edge then V edge
    forEachEdge(block) {
        this._edges.forEach(block);
    }
    
    // Returns a one-dimensional array sorted by y then x
    flatMapSquares(block) {
        let mapped = [];
        this._squares.forEachFlat(s => mapped.push(block(s)));
        return mapped;
    }
    
    // One of eight adjacent squares, if in the map's bounds
    adjacentSquare(square, compassDirection) {
        return this.squareAtTile(square.tile.adjacent(compassDirection));
    }
}

// Just the terrain description, and any global/wholistic terrain behavior.
// "Planet as a character"
export class Planet {
    static fromSavegame(a) {
        let planet = new Planet(a);
        planet.map.forEachSquare(square => square.terrain.planet = planet);
        return planet;
    }
    
    constructor(a) {
        this.world = null;
        if (a.map) {
            this.map = a.map;
        } else {
            this.map = new RectMap(a.size);
            this.map.forEachSquare(square => {
                square.terrain = new Terrain({ planet: this });
            });
            // Now make the edges between each piece of terrain
        }
    }
    
    get rect() { return this.map.tileRect; }
}

// Describes a specific type of terrain.
// A MapSquare is described by one Terrain; a Terrain doesn't know about a location.
export class Terrain {
    static baseTypeOrDefault(index) { return GameContent.itemOrDefaultFromArray(Terrain.baseTypes, index); }
    
    static fromSavegame(a) {
        return new Terrain(a);
    }
    
    constructor(a) {
        this.planet = a.planet;
        let index = Number.isInteger(a.baseTypeIndex) ? a.baseTypeIndex : inj().rng.nextIntOpenRange(0, Terrain.baseTypes.length);
        this.type = Terrain.baseTypeOrDefault(index);
        this.randomSeed = Number.isInteger(a.randomSeed) ? a.randomSeed : Identifier.randomSeed();
    }
    
    get baseTypeIndex() { return this.type.index; }
    
    get debugDescription() {
        return `<Terrain ${this.type}>`;
    }
}
Terrain.baseTypes = [
    {
        id: "ocean"
    },
    {
        id: "coast"
    },
    {
        id: "grass",
        isDefault: true
    },
    {
        id: "plains"
    },
    {
        id: "desert"
    }
];

export class Civilization {
    static allMetaByName() {
        return Object.values(inj().content.civs)
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    static metaByID(id) {
        return inj().content.civs[id];
    }
    
    static fromSavegame(a) { return new Civilization(a?.id); }
    
    constructor(id) {
        this.id = id;
        this.meta = inj().content.civs[this.id];
        precondition(!!this.meta, "Unknown Civilization ID");
    }
    
    color(opacity) {
        if (opacity < 1) {
            return `hsla(${this.meta.hue}, 50%, 50%, ${opacity})`;
        } else {
            return `hsl(${this.meta.hue}, 50%, 50%)`;
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
        this.civ = a.civ;
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
        this.setObject(this.preferencesCollection, "lastDifficultyIndex", value, false);
    }
    
    get autosaveData() {
        return this.getObject(this.autosaveCollection, "autosave");
    }
    set autosaveData(value) {
        this.setObject(this.autosaveCollection, "autosave", value, true);
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
    a.addIDs.forEach(GameContent.addIdToItemsInDictionary);
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
