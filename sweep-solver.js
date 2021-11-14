"use-strict";

import { Strings } from './locale.js';
import { debugLog, debugWarn, Kvo, PerfTimer, Point, Rect } from './g.js';
import { ActionResult, GameSession, GameStorage, GameTile, SweepAction, TileCollection, TileFlag, TileTransform } from './sweep.js';

function mark__Solver_Agent() {} // ~~~~~~ Solver Agent ~~~~~~

class SolverResult {
    constructor(config) {
        this.solver = config.solver;
        this.debugTiles = config.debugTiles || [];
        this.actions = config.actions || [];
        this.actionResult = config.actionResult;
    }

    get isSuccess() {
        return this.actions.length > 0;
    }

    get debugDescription() {
        return `<${this.constructor.name} ${this.solver.debugDescription} actions:${this.actions.length}:${this.actions.map(action => action.debugDescription).join("; ")}>`;
    }
}

export class SolverPreferences {
    static Kvo() { return {"enabledIDs": "enabledIDs", "orderedSolvers": "orderedSolvers"}; }
    
    static initialize(config) {
        SolverPreferences.shared = new SolverPreferences(config);
    }
    
    constructor(config) {
        this.defaultOrder = config.solver.defaultOrder;
        this.solvers = config.solver.solvers;
        this.kvo = new Kvo(this);
    }
    
    get enabledIDs() {
        let ids = GameStorage.shared.orderedSolvers;
        if (!Array.isArray(ids)) {
            return this.defaultOrder;
        } else {
            return ids;
        }
    }
    
    set enabledIDs(newValue) {
        GameStorage.shared.orderedSolvers = newValue;
        this.kvo.enabledIDs.notifyChanged();
    }
    
    get defaultOrderedSolvers() {
        return this.makePreferencesArray(this.defaultOrder);
    }
    
    get orderedSolvers() {
        return this.makePreferencesArray(this.enabledIDs);
    }
    
    set orderedSolvers(newValue) {
        if (!Array.isArray(newValue)) {
            this.enabledIDs = this.defaultOrder;
        } else {
            let ids = newValue.filter(item => item.enabled).map(item => item.id);
            this.enabledIDs = ids;
        }
        this.kvo.orderedSolvers.notifyChanged();
    }
    
    /// Assumes enabledIDs is a valid non-empty array.
    makePreferencesArray(enabledIDs) {
        return this.defaultOrder.map(id => {
            let info = this.solvers[id];
            if (!info) { return null; }
            return {
                id: id,
                enabled: enabledIDs.includes(id),
                info: info
            };
        }).filter(item => item != null);
    }
}

export class SolverAgent {
    constructor(config) {
        this.content = config.content; // Game.content
        this.session = config.session;
        this.debugMode = !!config.debugMode;
        this.hintTile = null;
        this.rebuildSolvers();
        SolverPreferences.shared.kvo.enabledIDs.addObserver(this, () => this.rebuildSolvers());
    }
    
    remove() {
        Kvo.stopAllObservations(this);
    }
    
    rebuildSolvers() {
        this.solvers = Solver.makeOrderedSolvers(SolverPreferences.shared.enabledIDs, this.content);
    }

    tryStep() {
        if (this.solvers.length == 0) { return null; }
        this.hintTile = this.session.hintTile;
        this.session.beginMove();
        this.session.isClean = false;
        let timer = new PerfTimer("SolverAgent.tryStep").start();
        for (let i = 0; i < this.solvers.length; i += 1) {
            let solver = this.solvers[i];
            let result = solver.tryStep(this.session, this);
            if (result && result.isSuccess) {
                return this.completeAttempt(result, timer);
            }
        }
        return this.completeAttempt(null, timer);
    }

    completeAttempt(result, timer) {
        this.hintTile = null;
        debugLog(timer.end().summary);
        if (result) {
            result.debugMode = this.debugMode;
        }
        return result;
    }
}

function mark__Basic_Solvers() {} // ~~~~~~ Basic Solvers ~~~~~~

// Abstract base class
export class Solver {
    static makeOrderedSolvers(enabledIDs, content) {
        return enabledIDs.map(id => Solver.makeSolver(id, content))
            .filter(s => s != null);
    }
    
    static makeSolver(id, content) {
        let config = content.solver.solvers[id];
        let constructor = Solver.allTypes[config?.type];
        try {
            if (constructor.fromConfig) {
                return constructor.fromConfig(config);
            } else {
                return new constructor(config);
            }
        } catch(e) {
            debugWarn(`Failed to parse ${constructor ? constructor.name : "unknown type"}#${id}: ${e.message}`, true);
            return null;
        }
    }

    // Abstract members

    get debugDescription() {
        return `<${this.constructor.name}>`;
    }

    // Return a SolverResult or null
    tryStep(session, agent) {
        return null;
    }
}
Solver.allTypes = {};

// Solver may get stuck. User may ask for a hint and then use the solver 
// again to avoid actually clicking any tiles.
class ClearHintedTileSolver extends Solver {
    tryStep(session, agent) {
        if (!agent.hintTile) {
            return null;
        }

        let action = new SweepAction.RevealTileAction({
            reason: Strings.str("solverClearHintedTileActionDescription"),
            tile: agent.hintTile,
            revealBehavior: GameSession.revealBehaviors.safe
        });

        return new SolverResult({
            solver: this,
            debugTiles: [],
            actions: [action],
            actionResult: new ActionResult({
                action: action,
                tile: action.tile,
                description: action.reason
            })
        });
    }
}
Solver.allTypes["ClearHintedTileSolver"] = ClearHintedTileSolver;

class GuessAtStartSolver extends Solver {
    tryStep(session) {
        let allTiles = TileCollection.allTiles(session);

        let candidates = allTiles
            .applying(new TileTransform.CoveredTilesFilter())
            .applying(new TileTransform.FlaggedTilesFilter([TileFlag.none]));
        if (candidates.tiles.length != allTiles.tiles.length) {
            return null;
        }

        candidates = candidates.applying(new TileTransform.MineFilter(false));
        if (candidates.isEmpty) {
            debugLog("Weird, there are no unmined tiles in the entire board?");
            return;
        }

        // Prefer tiles with zero neighbors
        let zeroNeighbors = candidates.applying(TileTransform.MinedNeighborCountRangeFilter.zero);

        let tile = zeroNeighbors.tiles.randomItem() || candidates.tiles.randomItem();
        let action = new SweepAction.RevealTileAction({
            reason: Strings.str("solverGuessAtStartActionDescription"),
            tile: tile,
            revealBehavior: GameSession.revealBehaviors.safe
        });
        return new SolverResult({
            solver: this,
            debugTiles: [],
            actions: [action],
            actionResult: new ActionResult({
                action: action,
                tile: tile,
                description: action.reason
            })
        });
    }
}
Solver.allTypes["GuessAtStartSolver"] = GuessAtStartSolver;

class ExactCoveredTileMatchSolver extends Solver {
    tryStep(session) {
        let candidates = TileCollection.allTiles(session)
            // Revealed tiles with nonzero number
            .applying(new TileTransform.RevealedTilesFilter())
            .applying(TileTransform.MinedNeighborCountRangeFilter.hasAny)
            // minedNeighborCount === number of covered neighbors
            .applying(new TileTransform.HasNeighborsFilter({ condition: { filteredNeighborCountEqualsMinedNeighborCount: true }, transform: collection =>
                collection.applying(new TileTransform.CoveredTilesFilter())
            }))
            .applying(new TileTransform.HasNeighborsFilter({ condition: { range: {min: 1, max: TileTransform.maxNeighbors} }, transform: collection =>
                collection.applying(new TileTransform.CoveredTilesFilter())
                    .applying(new TileTransform.FlaggedTilesFilter([TileFlag.none, TileFlag.maybeMine]))
            }))
            .emitDebugTiles()
            // collect covered unflagged neighbors
            .applying(new TileTransform.CollectNeighborsTransform({ transform: collection => 
                collection.applying(new TileTransform.CoveredTilesFilter())
                    .applying(new TileTransform.FlaggedTilesFilter([TileFlag.none, TileFlag.maybeMine]))
            }));

        let toFlag = candidates.tiles.map(tile => new SweepAction.SetFlagAction({ tile: tile, flag: TileFlag.assertMine }));
        let nearestTile = new TileCollection(toFlag.flatMap(action => action.tile)).randomTileClosestTo(session.mostRecentAction.tile);
        let result = new SolverResult({
            solver: this,
            debugTiles: candidates.debugTiles,
            actions: toFlag,
            actionResult: new ActionResult({
                action: toFlag.first,
                tile: nearestTile,
                description: Strings.template("solverFlaggedExactCoveredTileMatchActionDescriptionTemplate", { length: { value: toFlag.length, formatted: Number.uiInteger(toFlag.length) }})
            })
        });
        return result.isSuccess ? result : null;
    }
}
Solver.allTypes["ExactCoveredTileMatchSolver"] = ExactCoveredTileMatchSolver;

class ClearFullyFlaggedTileSolver extends Solver {
    tryStep(session) {
        let candidates = TileCollection.allTiles(session)
            .applying(new TileTransform.RevealedTilesFilter())
            .applying(TileTransform.MinedNeighborCountRangeFilter.hasAny)
            .applying(new TileTransform.HasNeighborsFilter({ condition: { filteredNeighborCountEqualsMinedNeighborCount: true }, transform: collection =>
                collection.applying(new TileTransform.CoveredTilesFilter())
                .applying(new TileTransform.FlaggedTilesFilter([TileFlag.assertMine]))
            }))
            .applying(new TileTransform.HasNeighborsFilter({ condition: { range: {min: 1, max: TileTransform.maxNeighbors} }, transform: collection =>
                collection.applying(new TileTransform.CoveredTilesFilter())
                .applying(new TileTransform.FlaggedTilesFilter([TileFlag.none]))
                .emitDebugTiles()
            }));

        // TODO among the closer tiles, prefer ones that will clear the most neighbors?
        let tile = candidates.randomTileClosestTo(session.mostRecentAction.tile);
        let toClear = tile ? [new SweepAction.RevealTileAction({ tile: tile, revealBehavior: GameSession.revealBehaviors.assertTrustingFlags })] : [];

        let result = new SolverResult({
            solver: this,
            // debugTiles: toClear.map(action => action.tile),
            debugTiles: candidates.debugTiles,
            actions: toClear,
            actionResult: new ActionResult({
                action: toClear[0],
                tile: tile,
                description: Strings.str("solverClearFullyFlaggedTileActionDescription")
            })
        });
        return result;
    }
}
Solver.allTypes["ClearFullyFlaggedTileSolver"] = ClearFullyFlaggedTileSolver;

function mark__Convolution_Patterns() {} // ~~~~~~ Convolution Patterns ~~~~~~

class ConvolutionPatternSolver extends Solver {
    static fromConfig(config) {
        return new ConvolutionPatternSolver(new ConvolutionPattern(config));
    }
    
    constructor(pattern) {
        super();
        this.pattern= pattern;
    }
    
    tryStep(session) {
        let matches = this.pattern.findNonoverlappingMatches(session.game);
        if (matches.length == 0) {
            debugLog(`no matches for ${this.pattern.debugDescription}`);
            return;
        }
        let actions = matches.flatMap(input => this.pattern.actions(input));
        if (actions.length == 0) {
            debugLog(`matches, but no actions for ${this.pattern.debugDescription}`);
            return null;
        }
        
        let result = new SolverResult({
            solver: this,
            debugTiles: matches.flatMap(input => input.allTiles),
            actions: actions,
            actionResult: new ActionResult({
                action: actions[0],
                tile: actions[0].tile,
                description: `Solver: applied pattern “${this.pattern.fullName}”`, // TODO localize
            })
        });
        debugLog(result);
        return result;
    }
}
Solver.allTypes["ConvolutionPatternSolver"] = ConvolutionPatternSolver;


export class ConvolutionPattern {
    // a.name: description text
    // a.variation: description text. Used for automatically constructed copies such as via .rotated()
    // a.match: string with newlines
    // a.action: string with newlines
    constructor(a) {
        this.name = a.name;
        this.variation = a.variation;
        this.matchDescription = ConvolutionPattern.normalizeMatrix(a.match, c => c);
        this.actionDescription = ConvolutionPattern.normalizeMatrix(a.action, ConvolutionPattern.ActionMatrixItem.normalizeCode);
        this.matchMatrix = ConvolutionPattern.parseMatrix(this.matchDescription, ConvolutionPattern.MatchMatrixItem.parse);
        this.actionMatrix = ConvolutionPattern.parseMatrix(this.actionDescription, ConvolutionPattern.ActionMatrixItem.parse);
        this.size = { width: this.matchMatrix[0] ? this.matchMatrix[0].length : 0, height: this.matchMatrix.length };
        if (this.size.width < 1 || this.size.height < 1) {
            throw new Error("Empty pattern");
        }
        if (!this.matchMatrix.every(row => row.length == this.size.width)) {
            throw new Error("Non-rectangular pattern");
        }
        if (this.actionMatrix.length != this.size.height || !this.actionMatrix.every(row => row.length == this.size.width)) {
            throw new Error("Action matrix not the same size as Match matrix");
        }
    }
    
    static normalizeMatrix(text, parser) {
        return text.trim().split("\n").map(row => row.trim().split("").map(parser).join("")).join(";");
    }
    
    static parseMatrix(text, parser) {
        // Flip matrixes vertically: typographically bottom row is origin and top row is max-y.
        return text.trim().split(";").reverse().map(row => row.trim().split("").map(parser));
    }
    
    get fullName() {
        if (this.variation) {
            return `${this.name} (${this.variation})`;
        }
        return this.name;
    }
    
    get debugDescription() {
        return `<ConvPattern ${this.name} m:${this.matchDescription} a:${this.actionDescription}>`;
    }
    
    isEqual(other) {
        return this.matchDescription == other.matchDescription
            && this.actionDescription == other.actionDescription;
    }
    
    /// Returns a ConvolutionPattern.Input at a given offset in the GameBoard.
    /// returns null if no Input available at the given offset (e.g. too close to edge)
    makeInput(game, offset) {
        return ConvolutionPattern.Input.make(game, new Rect(offset, this.size));
    }
    
    /// Returns true only if every tile in input matches every matrix item.
    matches(input) {
        let mismatch = false;
        input.visitTiles((inputCoord, tile) => {
            if (!this.matchMatrix[inputCoord.y][inputCoord.x](tile)) {
                mismatch = true;
                return false;
            }
            return true;
        });
        return !mismatch;
    }
    
    /// Returns an array of ConvolutionPattern.Input representing zero or more matches 
    /// in the given game, where none of the Inputs overlap. There may be additional matching
    /// Inputs that do overlap that aren't returned.
    findNonoverlappingMatches(game) {
        let inputs = [];
        for (let y = 0; y <= game.board.size.height - this.size.height; y++) {
            for (let x = 0; x <= game.board.size.width - this.size.width; x++) {
                let rect = new Rect(x, y, this.size.width, this.size.height);
                let overlaps = inputs.some(existing => existing.rect.intersects(rect));
                if (!overlaps) {
                    let input = new ConvolutionPattern.Input(game, new Rect(x, y, this.size.width, this.size.height));
                    if (this.matches(input)) {
                        inputs.push(input);
                    }
                }
            }
        }
        return inputs;
    }
    
    // An array of actions to apply to the input. May be an empty array.
    actions(input) {
        let items = [];
        input.visitTiles((inputCoord, tile) => {
            let action = this.actionMatrix[inputCoord.y][inputCoord.x](tile);
            if (action) { items.push(action); }
        });
        return items;
    }
    
    /// Returns a copy of this Pattern with 
    /// turns = 1, 2, 3 for 90/180/270°.
    rotated(turns) {
        let a = {
            name: this.fullName,
            variation: "Rotated" + (turns > 1 ? ` x${turns}` : ""),
            match: this.matchDescription.split(";").join("\n"),
            action: this.actionDescription.split(";").join("\n")
        };
        let match = this.matchDescription;
        for (let turn = 0; turn < turns; turn++) {
            a.match = ConvolutionPattern._rotateOnce(a.match);
            a.action = ConvolutionPattern._rotateOnce(a.action);
        }
        
        return new ConvolutionPattern(a);
    }
    
    /// Returns a copy of this Pattern flipped on the x-axis.
    flippedHorizontally() {
        let a = {
            name: this.fullName,
            variation: "Flipped-x",
            match: this.matchDescription.split(";")
                .map(line => line.split("").reverse().join("")).join("\n"),
            action: this.actionDescription.split(";")
                .map(line => line.split("").reverse().join("")).join("\n")
        };
        return new ConvolutionPattern(a);
    }
    
    /// Returns a copy of this Pattern flipped on the y-axis.
    flippedVertically() {
        let a = {
            name: this.fullName,
            variation: "Flipped-y",
            match: this.matchDescription.split(";").reverse().join("\n"),
            action: this.actionDescription.split(";").reverse().join("\n")
        };
        return new ConvolutionPattern(a);
    }
    
    allUniqueTransforms() {
        let transforms = [];
        [this, this.flippedHorizontally(), this.flippedVertically()].forEach(flip => {
            [flip, flip.rotated(1), flip.rotated(2), flip.rotated(3)].forEach(tx => {
                if (!transforms.some(existing => existing.isEqual(tx))) {
                    transforms.push(tx);
                }
            });
        });
        return transforms;
    }
    
    /// ABC\nDEF => FC\nEB\nDA
    static _rotateOnce(text) {
        let lines = text.split("\n").map(line => line.split(""));
        let newSize = { width: lines.length, height: lines[0].length };
        let rotated = Array.make2D(newSize, p => {
            let y = p.x;
            // let y = (newSize.width - 1) - p.x;
            let x = (newSize.height - 1) - p.y;
            // let x = p.y;
            return lines[y][x];
        });
        return rotated.map(line => line.join("")).join("\n");
    }
}

// A subset of tiles in a specific rect within a game board.
ConvolutionPattern.Input = class {
    /// Returns an Input only if rect is fully within the GameBoard's bounds. 
    static make(game, rect) {
        if (rect.width < 1 || rect.height < 1) {
            return null;
        }
        let input = new ConvolutionPattern.Input(game, rect);
        if (!!input.tile(new Point(0, 0))
            && !!input.tile(new Point(rect.width - 1, rect.height - 1))) {
            return input;
        } else {
            return null;
        }
    }
    
    /// Rect defines the offset and for the window of tiles within the game.
    /// Use static make(game, rect) to ensure rect is valid.
    constructor(game, rect) {
        this.game = game;
        this.rect = rect;
        // An array of input coords to use for tile(...)
    }
    
    get debugDescription() {
        return `<ConvInput ${this.rect.debugDescription}>`;
    }
    
    get allTiles() {
        let tiles = [];
        this.visitTiles((coord, tile) => tiles.push(tile));
        return tiles;
    }
    
    /// Gets a tile at an x/y offset relative to this Input's location.
    /// (0,0) == tile at the origin of this Input.
    /// Returns null for any coords outside the size of this Input,
    /// even if valid within the overall GameBoard.
    tile(inputCoord) {
        let coord = inputCoord.adding(this.rect.origin);
        if (!this.rect.containsTile(coord)) {
            return null;
        }
        return this.game.board.tileAtCoord(coord);
    }

    /// block is function(inputCoord, GameTile, Input)
    /// If block returns false, stops visiting.
    visitTiles(block) {
        for (let y = 0; y < this.rect.height; y++) {
            for (let x = 0; x < this.rect.width; x++) {
                let inputCoord = new Point(x, y);
                let tile = this.game.board.tileAtCoord(inputCoord.adding(this.rect.origin));
                let result = block(inputCoord, tile, this);
                if ((typeof(result) != "undefined") && !result) {
                    return;
                }
            }
        }
    }
};

ConvolutionPattern.MatchMatrixItem = class {
    static parse(character) {
        let count = Number.parseInt(character);
        if (count >= 0 && count <= 8) {
            return ConvolutionPattern.MatchMatrixItem.makeMinedNeighborCountMatch(count);
        }
        switch (character) {
            case "C": return ConvolutionPattern.MatchMatrixItem.isCleared;
            case "#": return ConvolutionPattern.MatchMatrixItem.isCovered;
            case "F": return ConvolutionPattern.MatchMatrixItem.isAssertMine;
            case ".": return ConvolutionPattern.MatchMatrixItem.any;
            default: throw new Error(`Unknown pattern code ${character}`);
        }
    }
    
    static any(tile) {
        return true;
    }
    
    static isCleared(tile) {
        return !tile.isCovered;
    }
    
    static isCovered(tile) {
        return tile.isCovered;
    }
    
    static isAssertMine(tile) {
        return tile.isCovered && (tile.flag == TileFlag.assertMine);
    }
    
    static makeMinedNeighborCountMatch(count) {
        return tile => !tile.isCovered && (tile.minedNeighborCount == count);
    }
};

ConvolutionPattern.ActionMatrixItem = class {
    static normalizeCode(character) {
        // Ignore integers, #, etc.
        let count = Number.parseInt(character);
        if (count >= 0 && count <= 8) {
            return ".";
        }
        switch (character) {
            case "#": return ".";
            default: return character;
        }
    }
    
    static parse(character) {
        switch (character) {
            case "C": return ConvolutionPattern.ActionMatrixItem.clear;
            case "F": return ConvolutionPattern.ActionMatrixItem.assertMine;
            case ".": return ConvolutionPattern.ActionMatrixItem.noop;
            default: throw new Error(`Unknown action code ${character}`);
        }
    }
    
    static noop(tile) {
        return null;
    }
    
    static clear(tile) {
        if (!tile.isCovered || tile.flag.isEqual(TileFlag.assertMine)) {
            return null;
        }
        return new SweepAction.RevealTileAction({ tile: tile, revealBehavior: GameSession.revealBehaviors.safe });
    }
    
    static assertMine(tile) {
        if (!tile.isCovered || tile.flag.isEqual(TileFlag.assertMine)) {
            return null;
        }
        return new SweepAction.SetFlagAction({ tile: tile, flag: TileFlag.assertMine });
    }
};

export function initialize(content) {
    SolverPreferences.initialize(content);
};
