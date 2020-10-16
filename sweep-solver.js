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
const ActionResult = Sweep.ActionResult;
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
        this.actionResult = config.actionResult;
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
            new ClearFullyFlaggedTileSolver(),
            new ExactCoveredTileMatchSolver(),
            new GuessAtStartSolver()
        ];
    }

    // Abstract members

    get debugDescription() {
        return `<${this.constructor.name}>`;
    }

    // Return a SolverResult or null
    tryStep(session) {
        return null;
    }
}

class GuessAtStartSolver extends Solver {
    tryStep(session) {
        let allTiles = TileCollection.allTiles(session);
        let covered = allTiles
            .applying(new TileTransform.CoveredTilesFilter())
            .applying(new TileTransform.FlaggedTilesFilter([TileFlag.none]));

        if (covered.tiles.length == allTiles.tiles.length) {
            let tile = allTiles.tiles.randomItem();
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
        } else {
            return null;
        }
    }
}

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
