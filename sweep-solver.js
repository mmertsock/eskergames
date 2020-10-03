"use-strict";

self.SweepSolver = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;
const GameSession = Sweep.GameSession;
const GameTile = Sweep.GameTile;
const PerfTimer = Gaming.PerfTimer;
const Strings = Gaming.Strings;
const SweepAction = Sweep.SweepAction;
const TileBasedAction = Sweep.SweepAction.TileBasedAction;
const TileFlag = Sweep.TileFlag;

function mark__Solver_Agent() {} // ~~~~~~ Solver Agent ~~~~~~

class SolverResult {
    constructor(config) {
        this.solver = config.solver;
        this.debugTiles = config.debugTiles || [];
        this.actions = config.actions || [];
    }

    get isSuccess() {
        return this.actions.length > 0;
    }

    get debugDescription() {
        return `<${this.constructor.name} ${this.solver.debugDescription} actions:${this.actions.length}:${this.actions.map(action => action.debugDescription).join("; ")}>`;
    }
}

class SolverAgent {
    constructor(config) {
        this.session = config.session;
        this.solvers = config.solvers;
        this.debugMode = !!config.debugMode;
    }

    tryStep() {
        if (this.solvers.length == 0) { return null; }
        let timer = new PerfTimer("SolverAgent.tryStep").start();
        for (let i = 0; i < this.solvers.length; i += 1) {
            let solver = this.solvers[i];
            let result = solver.tryStep(this.session);
            if (result && result.isSuccess) {
                return this.completeAttempt(result, timer);
            }
        }
        return this.completeAttempt(null, timer);
    }

    completeAttempt(result, timer) {
        debugLog(timer.end().summary);
        if (result) {
            result.debugMode = this.debugMode;
        }
        return result;
    }
}

function mark__Tile_Sets_and_Transforms() {} // ~~~~~~ Tile Sets and Transforms ~~~~~~

class SolverTileSet {
    static allTiles(session) {
        let tiles = [];
        session.game.board.visitTiles(null, tile => tiles.push(tile));
        return new SolverTileSet(tiles);
    }

    constructor(tiles, debugTiles) {
        this.tiles = tiles;
        this.debugTiles = debugTiles ? debugTiles : [];
    }

    get debugDescription() {
        return `<${this.tiles.length} tiles>`;
    }

    applying(transform) {
        let applied = new SolverTileSet(this.tiles.flatMap(tile => {
            let mapped = transform.map(tile, this);
            if (mapped instanceof GameTile) {
                return mapped;
            } else if (typeof(mapped) == 'object') {
                return mapped;
            } else {
                return mapped ? tile : [];
            }
        }));
        if (this.debugTiles) {
            applied.appendDebugTiles(this.debugTiles);
        }
        // debugLog(`Apply ${transform.debugDescription || transform.constructor.name} to ${this.debugDescription} => ${applied.debugDescription}`);
        return applied;
    }

    emitDebugTiles() {
        this.appendDebugTiles(this.tiles);
        return this;
    }

    appendDebugTiles(items) {
        if (!this.debugTiles) { this.debugTiles = []; }
        items.forEach(tile => {
            if (!this.debugTiles.contains(tile)) { this.debugTiles.push(tile); }
        });
    }
}

class TileTransform {
    // Return a boolean, empty array, one tile object, or array of multiple tiles.
    // Do not return null.
    map(tile, tileSet) {
        return tile;
    }
}
TileTransform.maxNeighbors = 8;

class HasNeighborsFilter extends TileTransform {
    constructor(config) {
        super();
        // SolverTileSet => SolverTileSet
        this.transform = config.transform;
        // condition = { HasNeighborsFilter.Condition.x: value }
        this.condition = config.condition;
    }

    map(tile, tileSet) {
        let filtered = this.transform(new SolverTileSet(tile.neighbors));
        let neighbors = filtered.tiles;
        if (filtered.debugTiles) { tileSet.appendDebugTiles(filtered.debugTiles); }
        if (typeof(this.condition.filteredNeighborCountEqualsMinedNeighborCount) != 'undefined') {
            let filteredNeighborCountEqualsMinedNeighborCount = (neighbors.length == tile.minedNeighborCount);
            debugLog(`HasNeighborsFilter.fncemnc: fnc=${neighbors.length}, mnc=${tile.minedNeighborCount}, (${filteredNeighborCountEqualsMinedNeighborCount} == ${this.condition.filteredNeighborCountEqualsMinedNeighborCount})`);
            return filteredNeighborCountEqualsMinedNeighborCount == this.condition.filteredNeighborCountEqualsMinedNeighborCount;
        } else if (typeof(this.condition.range) != 'undefined') {
            return neighbors.length >= this.condition.range.min && neighbors.length <= this.condition.range.max;
        }
        return false;
    }
}
HasNeighborsFilter.Condition = {
    filteredNeighborCountEqualsMinedNeighborCount: "filteredNeighborCountEqualsMinedNeighborCount",
    range: "range"
};

class CollectNeighborsTransform extends TileTransform {
    constructor(config) {
        super();
        // SolverTileSet => SolverTileSet
        this.transform = config.transform;
    }

    map(tile, tileSet) {
        let filtered = this.transform(new SolverTileSet(tile.neighbors));
        if (filtered.debugTiles) { tileSet.appendDebugTiles(filtered.debugTiles); }
        return filtered.tiles;
    }
}

class RevealedTilesFilter extends TileTransform {
    map(tile, tileSet) {
        return !tile.isCovered;
    }
}

class CoveredTilesFilter extends TileTransform {
    map(tile, tileSet) {
        return tile.isCovered;
    }
}

class FlaggedTilesFilter extends TileTransform {
    constructor(allowedFlags) {
        super();
        this.allowedFlags = allowedFlags;
    }

    map(tile, tileSet) {
        return this.allowedFlags.contains(tile.flag);
    }
}

class MinedNeighborCountRangeFilter extends TileTransform {
    constructor(range) {
        super();
        this.range = range;
    }

    map(tile, tileSet) {
        return tile.minedNeighborCount >= this.range.min && tile.minedNeighborCount <= this.range.max;
    }
}
MinedNeighborCountRangeFilter.hasAny = new MinedNeighborCountRangeFilter({ min: 1, max: TileTransform.maxNeighbors });

function mark__Solvers() {} // ~~~~~~ Solvers ~~~~~~

// Abstract base class
class Solver {
    static initialize() {
        Solver.allSolvers = [
            new ExactCoveredTileMatchSolver(),
            new ClearFullyFlaggedTileSolver(),
            new GuessAtStartSolver()
        ];
    }

    // Abstract members

    // Strings.str() key for localized name
    get name() {
        return "";
    }

    get debugDescription() {
        return `<${this.constructor.name}>`;
    }

    // Return a SolverResult or null
    tryStep(session) {
        return null;
    }

    // Helpers: tile visitors

    // visit(session, block):
    // session: GameSession
    // block: function (tile, session) => { ... }

    // Returns an array of tiles. e.g. this.collectTiles(session, this.visitRevealedEdgeTiles)
    collectTiles(session, visitFunc) {
        let tiles = [];
        visitFunc(session, tile => tiles.push(tile));
        return tiles;
    }

    collectNeighbors(tile) {
        let neighbors = [];
        tile.visitNeighbors(neighbor => neighbors.push(neighbor));
        return neighbors;
    }

    collectNeighborsOfTiles(tiles) {
        let neighbors = [];
        tiles.forEach(tile => tile.visitNeighbors(neighbor => {
            if (!neighbors.contains(neighbor)) {
                neighbors.push(neighbor);
            }
        }));
        return neighbors;
    }

    visitAllTiles(session, block) {
        session.game.board.visitTiles(null, tile => {
            block(tile, session);
            return true;
        });
    }

    // Returns modification of visitFunc with a filter applied.
    filterVisitor(visitFunc, block) {
        return (s, b) => {
            visitFunc(s, (tile, session) => {
                if (block(tile, session)) {
                    b(tile, session);
                }
            });
        };
    }

    visitRevealedTilesAdjacentToCovered(session, block) {
        let filtered = this.filterVisitor(this.visitAllTiles, tile => {
            if (tile.isCovered) { return false; }
            let anyCoveredNeighbor = this.collectNeighbors(tile).find(neighbor => neighbor.isCovered);
            return !!anyCoveredNeighbor;
        });
        filtered(session, block);
    }
}

class GuessAtStartSolver extends Solver {
    get name() { return "solverNameGuessAtStart"; }

    tryStep(session) {
        let allTiles = SolverTileSet.allTiles(session);
        let covered = allTiles
            .applying(new CoveredTilesFilter())
            .applying(new FlaggedTilesFilter([TileFlag.none]));

        if (covered.tiles.length == allTiles.tiles.length) {
            return new SolverResult({
                solver: this,
                debugTiles: [],
                actions: [new SweepAction.RevealTileAction({
                    reason: Strings.str("guessAtStartActionDescription"),
                    tile: allTiles.tiles.randomItem(),
                    revealBehavior: GameSession.revealBehaviors.safe
                })]
            });
        } else {
            return null;
        }
    }
}

class ExactCoveredTileMatchSolver extends Solver {
    get name() { return "solverNameExactCoveredTileMatch"; }

    tryStep(session) {
        let sources = this.collectRevealedTilesWithExactCoveredMatch(session);
        let candidates = this.collectNeighborsOfTiles(sources)
            .filter(neighbor => neighbor.isCovered && !neighbor.flag.isPresent);
        let toFlag = candidates.map(tile => new SweepAction.SetFlagAction({ tile: tile, flag: TileFlag.assertMine }));
        let result = new SolverResult({ solver: this, debugTiles: sources, actions: toFlag });
        return result.isSuccess ? result : null;
    }

    // Number of covered neigbbors == number on the tile
    collectRevealedTilesWithExactCoveredMatch(session) {
        let filter = this.filterVisitor(this.visitRevealedTilesAdjacentToCovered.bind(this), tile => {
            if (tile.minedNeighborCount < 1) { return false; }
            let neighbors = this.collectNeighbors(tile).filter(neighbor => neighbor.isCovered);
            let flagged = neighbors.filter(neighbor => neighbor.flag == TileFlag.assertMine);
            return tile.minedNeighborCount == neighbors.length
                && flagged.length < tile.minedNeighborCount;
        });
        return this.collectTiles(session, filter);
    }
}

class ClearFullyFlaggedTileSolver extends Solver {
    get name() { return "solverNameClearFullyFlaggedTile"; }

    tryStep(session) {
        let candidates = SolverTileSet.allTiles(session)
            .applying(new RevealedTilesFilter())
            .applying(MinedNeighborCountRangeFilter.hasAny)
            .applying(new HasNeighborsFilter({ condition: { filteredNeighborCountEqualsMinedNeighborCount: true }, transform: tileSet =>
                tileSet.applying(new CoveredTilesFilter())
                .applying(new FlaggedTilesFilter([TileFlag.assertMine]))
            }))
            .applying(new HasNeighborsFilter({ condition: { range: {min: 1, max: TileTransform.maxNeighbors} }, transform: tileSet =>
                tileSet.applying(new CoveredTilesFilter())
                .applying(new FlaggedTilesFilter([TileFlag.none]))
                // .emitDebugTiles()
            }));

        let toClear = candidates.tiles.randomItem();
        toClear = toClear ? [new SweepAction.RevealTileAction({ tile: toClear, revealBehavior: GameSession.revealBehaviors.assertTrustingFlags })] : [];

        // TODO among the candidates, prefer the tile that is closest to the 
        // last tile that was played, to get that depth-first play style.

        let result = new SolverResult({
            solver: this,
            // debugTiles: toClear.map(action => action.tile),
            debugTiles: candidates.debugTiles,
            actions: toClear
        });
        return result;
    }
}

var initialize = async function() {
    Solver.initialize();
};

return {
    Solver: Solver,
    SolverAgent: SolverAgent,
    initialize: initialize
};

})(); // end SweepSolver namespace

SweepSolver.initialize();
