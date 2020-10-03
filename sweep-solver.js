"use-strict";

self.SweepSolver = (function() {

const alias = Gaming.alias, debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;
const GameSession = alias(Sweep.GameSession, {
    game: { board: null },
    mostRecentAction: { action: null, tile: null }
});
const GameTile = alias(Sweep.GameTile, {
    neighbors: [],
    minedNeighborCount: 0,
    isCovered: true,
    flag: null,
    visitNeighbors: null
});
const PerfTimer = Gaming.PerfTimer;
const Strings = Gaming.Strings;
const SweepAction = Sweep.SweepAction;
const TileBasedAction = Sweep.SweepAction.TileBasedAction;
const TileCollection = Sweep.TileCollection;
const TileFlag = Sweep.TileFlag;
const TileTransform = Sweep.TileTransform;

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
        let allTiles = TileCollection.allTiles(session);
        let covered = allTiles
            .applying(new TileTransform.CoveredTilesFilter())
            .applying(new TileTransform.FlaggedTilesFilter([TileFlag.none]));

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

    // TODO use TileCollection and transforms instead
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
                // .emitDebugTiles()
            }));

        // TODO among the closer tiles, prefer ones that will clear the most neighbors?
        let toClear = candidates.randomTileClosestTo(session.mostRecentAction.tile);
        toClear = toClear ? [new SweepAction.RevealTileAction({ tile: toClear, revealBehavior: GameSession.revealBehaviors.assertTrustingFlags })] : [];

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
