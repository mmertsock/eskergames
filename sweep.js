"use-strict";

self.Sweep = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;

const FlexCanvasGrid = Gaming.FlexCanvasGrid;
const GameContent = Gaming.GameContent;
const GameDialog = Gaming.GameDialog;
const InputView = Gaming.FormValueView.InputView;
const Point = Gaming.Point;
const Rect = Gaming.Rect;
const SaveStateItem = Gaming.SaveStateItem;
const SaveStateCollection = Gaming.SaveStateCollection;
const Strings = Gaming.Strings;
const TextInputView = Gaming.FormValueView.TextInputView;
const TilePlane = Gaming.TilePlane;
const ToolButton = Gaming.ToolButton;

const ChartDataSeries = Charts.ChartDataSeries;
const ChartDataSeriesPresentation = Charts.ChartDataSeriesPresentation;
const ChartAxisPresentation = Charts.ChartAxisPresentation;
const ChartView = Charts.ChartView;

class TileFlag {
    constructor(present) {
        this.isPresent = present;
    }

    get objectForSerialization() {
        return TileFlag.sz.indexOf(this);
    }

    get debugDescription() {
        if (self == TileFlag.assertMine) return "!";
        if (self == TileFlag.maybeMine) return "?";
        return "o";
    }
}
TileFlag.none = new TileFlag(false);
TileFlag.assertMine = new TileFlag(true);
TileFlag.maybeMine = new TileFlag(true);
TileFlag.none.next = TileFlag.assertMine;
TileFlag.assertMine.next = TileFlag.maybeMine;
TileFlag.maybeMine.next = TileFlag.none;
TileFlag.sz = [TileFlag.none, TileFlag.assertMine, TileFlag.maybeMine];

class GameTile {
    constructor(coord, board) {
        this.coord = coord;
        this.board = board;
        this._mined = false;
        this._minedNeighborCount = 0;
        this._covered = true;
        this._flag = TileFlag.none;
    }

    get objectForSerialization() {
        // easy game: about 8.5 KB for entire board
        return {
            coord: { x: this.coord.x, y: this.coord.y },
            isMined: this.isMined,
            minedNeighborCount: this.minedNeighborCount,
            isCovered: this.isCovered,
            flag: this.flag.objectForSerialization
        };
    }

    get compactSerialized() {
        // isMined, isCovered are 2 bits
        // flag can be up to 2 bits
        // minedNeighborCount is up to 3 bits
        let bits = new Gaming.BoolArray(8);
        bits.setValue(0, this.isMined);
        bits.setValue(1, this.isCovered);
        // Support flag values 0...3: two bits
        let value = this.flag.objectForSerialization;
        bits.setValue(2, this.bitValue(value, 0));
        bits.setValue(3, this.bitValue(value, 1));
        // Support mine values 0...8: 4 bits
        value = this.minedNeighborCount;
        bits.setValue(4, this.bitValue(value, 0));
        bits.setValue(5, this.bitValue(value, 1));
        bits.setValue(6, this.bitValue(value, 2));
        bits.setValue(7, this.bitValue(value, 3));

        // easy game: about 243 bytes for enitre board
        return bits.getByte(0);

        // easy game: about 1 KB for entire board.
        // return [
        //     this.isMined ? 1 : 0,
        //     this.minedNeighborCount,
        //     this.isCovered ? 1 : 0,
        //     this.flag.objectForSerialization
        // ];
    }

    bitValue(value, position) {
        return (value & (0x1 << position)) ? true : false;
    }

    get debugDescription() {
        let attrs = this._covered ? "^" : "_";
        if (this._mined) {
            attrs += "M";
        } else if (this._minedNeighborCount > 0) {
            attrs += `${this._minedNeighborCount}`
        }
        return `(${this.coord.debugDescription})${attrs}`;
    }

    get minedNeighborCount() { return this._minedNeighborCount; }
    get isMined() { return this._mined; }
    set isMined(value) {
        this._mined = value;
        this._minedNeighborCount = 0;
    }

    get isCovered() { return this._covered; }
    set isCovered(value) {
        this._covered = value;
        this._flag = TileFlag.none;
    }

    get flag() { return this._flag; }
    set flag(value) { this._flag = value; }
    clearFlag() {
        this._flag = TileFlag.none;
        return this;
    }
    cycleFlag() {
        this._flag = this._flag.next;
        return this;
    }

    get neighbors() {
        return this._neighbors;
    }

    _boardConstructed() {
        this._minedNeighborCount = 0;
        this._covered = true;
        this._flag = TileFlag.none;
        this._neighbors = [];

        let rect = new Rect(this.coord.x - 1, this.coord.y - 1, 3, 3);
        this.board.visitTiles(rect, neighbor => {
            if (neighbor != this) {
                this._neighbors.push(neighbor);
                if (neighbor.isMined) {
                    this._minedNeighborCount += 1;
                }
            }
        });
    }

    visitNeighbors(block) {
        this._neighbors.forEach(neighbor => block(neighbor, this));
    }
} // end class GameTile

class GameBoard {
    constructor(config) {
        this.size = { width: config.size.width, height: config.size.height };
        this.mineCount = config.mineCount;
        this._tiles = new Rect(new Point(0, 0), { width: 1, height: this.size.height }).allTileCoordinates.map(rowCoord => {
            return new Rect(new Point(0, rowCoord.y), { width: this.size.width, height: 1 }).allTileCoordinates.map(colCoord => {
                return new GameTile(new Point(colCoord.x, rowCoord.y), this);
            });
        });
        this._allTiles = new Rect(0, 0, this.size.width, this.size.height).allTileCoordinates.map(coord => {
            return this.tileAtCoord(coord);
        });
        this.shuffle();
    }

    get compactSerialized() {
        let tiles = [];
        this.visitTiles(null, tile => {
            tiles.push(tile.compactSerialized);
        });
        return {
            schemaVersion: GameBoard.schemaVersion,
            size: { width: this.size.width, height: this.size.height },
            mineCount: this.mineCount,
            tiles: tiles
        };
    }

    get objectForSerialization() {
        let tiles = [];
        this.visitTiles(null, tile => {
            tiles.push(tile.objectForSerialization);
        });
        return {
            schemaVersion: GameBoard.schemaVersion,
            size: { width: this.size.width, height: this.size.height },
            mineCount: this.mineCount,
            tiles: tiles
        };
    }

    tileAtCoord(coord) {
        let row = this._tiles[coord.y];
        return row ? row[coord.x] : null;
    }

    visitTiles(rect, block) {
        let bounds = new Rect(0, 0, this.size.width, this.size.height);
        rect = rect ? rect.intersection(bounds) : bounds;
        for (let y = rect.y + rect.height - 1; y >= rect.y; y -= 1) {
            for (let x = rect.x; x < rect.x + rect.width; x += 1) {
                let keepGoing = block(this._tiles[y][x]);
                if (typeof(boolean) === 'boolean' && !keepGoing) {
                    return;
                }
            }
        }
    }

    reset() {
        this.visitTiles(null, tile => { tile._boardConstructed(); });
    }

    shuffle() {
        this._allTiles.forEach(tile => { tile.isMined = false; });
        let candidates = this._allTiles.map(tile => tile);
        candidates.shuffle();
        let mineTiles = candidates.slice(0, this.mineCount);
        mineTiles.forEach(tile => { tile.isMined = true; })
        this.visitTiles(null, tile => { tile._boardConstructed(); });
        debugLog(Game.debugSummary(this));
    }
} // end class GameBoard
GameBoard.schemaVersion = 1;

class Game {
    static initialize(content) {
        if (content.rules && content.rules.difficulties) {
            GameContent.addIndexToItemsInArray(content.rules.difficulties);
            content.rules.difficulties.forEach( difficulty => { difficulty.name = Strings.str(difficulty.name); });
        }
        Game.content = content;
        GameBoardView.initialize(content.gameBoardView);
        GameTileView.initialize(content.gameTileView);
        GameTileViewState.initialize(content.gameTileViewState);
        GameAnalysisDialog.initialize(content.analysisView);
    }

    static rules() {
        return Game.content.rules;
    }

    static debugSummary(board) {
        let stats = {
            width: board.size.width,
            height: board.size.height,
            totalTileCount: board.size.width * board.size.height,
            totalMineCount: 0,
            tileMineRatio: 0,
            totalPoints: 0,
            histogram: new Array(9).fill(0)
        };
        board.visitTiles(null, tile => {
            if (tile.isMined) {
                stats.totalMineCount += 1;
            }
            stats.totalPoints += Game.pointsValue(tile);
            stats.histogram[tile.minedNeighborCount] += 1;
        });
        stats.tileMineRatio = stats.totalTileCount / stats.totalMineCount;
        stats.histogram = stats.histogram.map((count, index) => `${index}:${count}`).join(", ");
        return Strings.template("gameBoardDebugSummaryTemplate", stats);
    }

    static pointsValue(tile) {
        return Math.pow(2, tile.minedNeighborCount);
    }

    static starCount(stats) {
        const highScoreThresholds = Game.rules().highScoreThresholds;
        if (stats.totalTileCount <= 0) { return 1; }
        let ratio = stats.mineCount / Math.pow(stats.totalTileCount, 0.75)
        return 1 + highScoreThresholds.filter(value => value <= ratio).length;
    }

    constructor(config) {
        this.difficulty = config.difficulty;
        this.board = new GameBoard({ size: config.difficulty, mineCount: config.difficulty.mineCount });
    }

    get objectForSerialization() {
        return {
            difficulty: this.difficulty,
            board: this.board.compactSerialized,
            statistics: this.statistics
        };
    }

    get mineCount() { return this.board.mineCount; }

    get statistics() {
        var stats = {
            difficulty: this.difficulty,
            mineCount: this.mineCount,
            totalTileCount: this.board.size.width * this.board.size.height,
            assertMineFlagCount: 0,
            clearedTileCount: 0,
            progress: 0,
            progressPercent: 0,
            points: 0
        };
        this.board.visitTiles(null, tile => {
            if (tile.flag == TileFlag.assertMine) { stats.assertMineFlagCount += 1; }
            if (!tile.isCovered && !tile.isMined) {
                stats.clearedTileCount += 1;
                stats.points += Game.pointsValue(tile);
            }
        });
        stats.progress = (stats.clearedTileCount + stats.assertMineFlagCount) / stats.totalTileCount;
        stats.progressPercent = Number.uiFormatWithPercent(Math.floor(100 * stats.progress));
        stats.starCount = Game.starCount(stats);
        stats.stars = Strings.str(`stars${stats.starCount}`);
        return stats;
    }
} // end class Game

GameState = {
    playing: 0,
    lost: 1,
    won: 2
};

MoveState = {
    ready: 0,
    pending: 1,
    active: 2
};

class GameStorage {
    constructor() {
        this.preferencesCollection = new SaveStateCollection(window.localStorage, "SweepSettings");
        this.highScoresCollection = new SaveStateCollection(window.localStorage, "SweepHighScores");
    }

    addHighScore(session, playerName) {
        const stats = session.game.statistics;
        const highScore = {
            playerName: playerName,
            points: stats.points,
            timestamp: session.endTime,
            playTimeMilliseconds: session.endTime - session.startTime,
            mineCount: stats.mineCount,
            totalTileCount: stats.totalTileCount,
            assertMineFlagCount: stats.assertMineFlagCount,
            clearedTileCount: stats.clearedTileCount
        };

        let data = this.highScoresByDifficulty;
        const difficultyIndex = data.difficulties.findIndex(item => item.difficulty.index == stats.difficulty.index);
        if (difficultyIndex < 0) {
            debugWarn("Can't find difficulty in highScoresCollection");
            return;
        }
        data.difficulties[difficultyIndex].highScores.push(highScore);
        data.difficulties[difficultyIndex].highScores.sort((a, b) => b.points - a.points);
        data.difficulties[difficultyIndex].highScores = data.difficulties[difficultyIndex].highScores.slice(0, 100);
        let item = new SaveStateItem(this.highScoresCollection.namespace, this.highScoresCollection.namespace, Date.now(), { highScoresByDifficulty: data });
        this.highScoresCollection.saveItem(item, {});

        this.lastPlayerName = highScore.playerName;
    }

    get highScoresByDifficulty() {
        let item = this.highScoresCollection.getItem(this.highScoresCollection.namespace);
        if (item) {
            return { difficulties: Game.rules().difficulties.map(difficulty => {
                let scores = item.data.highScoresByDifficulty.difficulties.find(x => x.difficulty.index == difficulty.index);
                return { difficulty: difficulty, highScores: scores ? scores.highScores : [] }
            }) };
        }
        return {
            difficulties: Game.rules().difficulties.map(difficulty => {
                return { difficulty: difficulty, highScores: [] };
            })
        };
    }

    get lastDifficultyIndex() {
        let item = this.preferencesCollection.getItem(this.preferencesCollection.namespace);
        return item ? item.data.lastDifficultyIndex : undefined;
    }
    set lastDifficultyIndex(value) {
        this.setPreference("lastDifficultyIndex", value);
    }

    get lastCustomDifficultyConfig() {
        let item = this.preferencesCollection.getItem(this.preferencesCollection.namespace);
        return item ? item.data.lastCustomDifficultyConfig : null;
    }
    set lastCustomDifficultyConfig(value) {
        this.setPreference("lastCustomDifficultyConfig", value);
    }

    get lastPlayerName() {
        let item = this.preferencesCollection.getItem(this.preferencesCollection.namespace);
        if (item && item.data.lastPlayerName) {
            return item.data.lastPlayerName;
        }
        return Strings.str("defaultPlayerName");
    }
    set lastPlayerName(value) {
        this.setPreference("lastPlayerName", value);
    }

    setPreference(key, value) {
        let item = this.preferencesCollection.getItem(this.preferencesCollection.namespace);
        let data = item ? item.data : { };
        data[key] = value;
        this.preferencesCollection.saveItem(new SaveStateItem(this.preferencesCollection.namespace, this.preferencesCollection.namespace, Date.now(), data), {});
    }
}
if (!self.isWorkerScope) {
    GameStorage.shared = new GameStorage();
}

class GameHistory {
    static userFacingMoveNumber(moveNumber) { return moveNumber + 1; }

    constructor() {
        this.moveNumber = GameHistory.firstMoveNumber;
        this.serializedMoves = [];
        this.lastMove = null;
    }

    get isEmpty() { return this.serializedMoves.length < 1; }

    // Deletes entire existing history data
    reset() {
        this.moveNumber = GameHistory.firstMoveNumber;
        this.serializedMoves = [];
        this.lastMove = null;
    }

    serializedMoveAtIndex(index) {
        return this.serializedMoves.safeItemAtIndex(index);
    }

    setCurrentMove(moment) { // MoveHistoryMoment
        if (!moment) { return; }

        if (!this.lastMove || (moment.objectForSerialization != this.lastMove.objectForSerialization)) {
            // TODO only increment if game state has changed since last time
            let object = moment.bestSerialization(this.lastMove);
            let data = JSON.stringify(object);
            debugLog(`move ${this.moveNumber}: storing ${data.length} bytes, ${object.format}`);
            this.serializedMoves[this.moveNumber] = data;
            this.moveNumber = this.moveNumber + 1;
            this.lastMove = moment;
        }
    }

    visitHistory(block) {
        let previous = null;
        for (let i = 0; i < this.serializedMoves.length; i += 1) {
            let moment = MoveHistoryMoment.fromCompactSerialization(JSON.parse(this.serializedMoves[i]), previous);
            if (moment) {
                block(moment, i);
                previous = moment;
            }
        }
    }
}
GameHistory.firstMoveNumber = 0;

class MoveHistoryMoment {
    static fromDeserializedWrapper(data, schemaVersion) {
        return new MoveHistoryMoment({ dz: JSON.parse(data), schemaVersion: schemaVersion });
    }

    static fromCompactSerialization(object, previous) {
        if (object.format == "full") {
            return new MoveHistoryMoment({ dz: object.data })
        } else {
            let game = MoveHistoryMoment.rehydrateGame(object.data, previous);
            return new MoveHistoryMoment({ dz: {
                game: game,
                gameState: previous.gameState,
                moveNumber: object.data.moveNumber
            }});
        }
    }

    static rehydrateGame(data, previous) {
        let tiles = Array.from(previous.game.board.tiles);
        for (var i = 0; i < data.diffs.length; i += 2) {
            let index = data.diffs[i];
            let value = data.diffs[i + 1];
            tiles[index] = value;
        }
        let stats = {
            assertMineFlagCount: data.stats[0],
            clearedTileCount: data.stats[1],
            points: data.stats[2]
        };
        // TODO static method to calculate this so we don't duplicate code
        stats.progress = (stats.clearedTileCount + stats.assertMineFlagCount) / previous.game.statistics.totalTileCount;

        return Object.assign({}, previous.game, {
            board: { tiles: tiles },
            difficulty: previous.game.difficulty,
            statistics: Object.assign({}, previous.game.statistics, stats)
        });
    }

    constructor(config) {
        if (config.dz) {
            this.game = config.dz.game;
            this.gameState = config.dz.gameState;
            this.moveNumber = config.dz.moveNumber;
        } else {
            this.game = config.session.game.objectForSerialization;
            this.gameState = config.session.state;
            this.moveNumber = config.session.history.moveNumber;
        }
    }

    get objectForSerialization() {
        return {
            schemaVersion: MoveHistoryMoment.schemaVersion,
            game: this.game,
            gameState: this.gameState,
            moveNumber: this.moveNumber
        };
    }

    bestSerialization(previous) {
        if (!previous || (this.gameState != previous.gameState)) {
            return this.fullSerialization();
        }

        // ~5.2 bytes per diff; 2 array entries per diff.
        // ~2.4 bytes per tile in full format
        let diffs = this.diff(previous);
        if (!diffs || ((2.6 * diffs.length) > (2.4 * this.game.board.size.width * this.game.board.size.height))) {
            return this.fullSerialization();
        } else {
            return {
                format: "diff",
                data: {
                    diffs: diffs,
                    moveNumber: this.moveNumber,
                    stats: [this.game.statistics.assertMineFlagCount, this.game.statistics.clearedTileCount, this.game.statistics.points]
                }
            };
        }
    }

    diff(previous) {
        if (!previous) { return null; }
        let diffs = [];
        for (let i = 0; i < this.game.board.tiles.length; i += 1) {
            let tile = this.game.board.tiles[i];
            if (tile != previous.game.board.tiles[i]) {
                diffs.push(i); diffs.push(tile);
            }
        }
        return diffs;
    }

    fullSerialization() {
        return {
            format: "full",
            data: {
                game: {
                    board: this.game.board,
                    statistics: this.game.statistics,
                    difficulty: this.game.difficulty
                },
                gameState: this.gameState,
                moveNumber: this.moveNumber
            }
        };
    }
}
MoveHistoryMoment.schemaVersion = 1;

class GameSession {
    static quit(prompt) {
        if (!prompt || confirm(Strings.str("quitGameConfirmPrompt"))) {
            window.location = "index.html";
        }
    }

    constructor(config) {
        this.game = config.game;
        this.state = GameState.playing;
        this.moveState = MoveState.ready;
        this.debugMode = false;
        this.history = new GameHistory();
        this.isClean = !this.debugMode; // false if cheated, etc.
        this.mostRecentAction = new ActionResult();
        this.hintTile = null;
        this.solver = null;
        this.debugTiles = [];
        this.elems = {
            boardContainer: document.querySelector("board")
        };
        this.controlsView = new GameControlsView({ session: this, elem: document.querySelector("header row") });
        this.mostRecentActionView = new ActionDescriptionView({ session: this, elem: document.querySelector("message") });
        this.boardView = new GameBoardView({ session: this, boardContainer: this.elems.boardContainer });
        this.statusView = new GameStatusView({ session: this, elem: document.querySelector("footer") });
        this.views = [this.controlsView, this.mostRecentActionView, this.boardView, this.statusView];
    }

    start() {
        GameStorage.shared.lastDifficultyIndex = this.game.difficulty.index;
        if (this.game.difficulty.isCustom) {
            GameStorage.shared.lastCustomDifficultyConfig = this.game.difficulty;
        };

        this.state = GameState.playing;
        this.moveState = MoveState.ready;
        this.startTime = Date.now();
        this.endTime = null;
        this.history.reset();
        this.isClean = !this.debugMode;
        this.mostRecentAction = new ActionResult();
        this.hintTile = null;
        this.elems.boardContainer.addRemClass("hidden", false);

        if (SweepSolver) {
            let debug = Game.rules().allowDebugMode && Game.rules().solverDebugMode;
            this.solver = new SweepSolver.SolverAgent({ session: this, debugMode: debug, solvers: SweepSolver.Solver.allSolvers });
        } else {
            this.solver = null;
        }
        this.renderViews();
    }

    get hasMoved() {
        return this.history.moveNumber > GameHistory.firstMoveNumber;
    }

    resetBoard() {
        if (this.state != GameState.playing) { return; }
        this.hintTile = null;
        this.debugTiles = [];
        this.game.board.reset();
        this.start();
    }

    renderViews() {
        this.views.forEach(view => view.render());
    }

    toggleDebugMode() {
        this.debugMode = !this.debugMode;
        if (this.debugMode) {
            this.isClean = false;
        }
        this.renderViews();
    }

    // Not reentrant.
    // if action.peform invokoes other actions, they should do so via action.perform
    // calls instead of session.performAction.
    // That way performAction can represent a single block of user interaction, can manage
    // state, etc.
    performAction(action) {
        this.moveState = MoveState.pending;
        let start = this.game.statistics;
        action.perform(this);
        this.checkForWin();
        this.pendingMove = MoveState.ready;
        this.mostRecentAction.setStatistics(start, this.game.statistics);
        this.renderViews();
    }

    // Can be called safely at any time by an action within a performAction scope,
    // and the contents of beginMove runs at most once within a single performAction scope.
    // So Actions can use it to notify the session that the action is going to do something 
    // rather than be a noop. The run-once behavior makes it safe to call within recursive 
    // contexts like tile clearing.
    beginMove() {
        if (this.moveState == MoveState.pending) {
            this.recordGameState();
            this.hintTile = null;
            this.debugTiles = [];
            this.moveState = MoveState.active;
        }
    }

    recordGameState() {
        // TODO also call this after winning/losing
        this.history.setCurrentMove(new MoveHistoryMoment({ session: this }));
        // TODO auto-save
    }
    
    attemptRevealTile(tile, revealBehavior) {
        if (this.state != GameState.playing) { return; }
        if (!tile) { return; }

        while (!this.hasMoved && tile.isMined) {
            debugLog("Clicked a mine on first move. Shuffling.");
            this.game.board.shuffle();
        }
        this.beginMove();

        switch (revealBehavior) {
        case GameSession.revealBehaviors.safe:
            if (!tile.isCovered || tile.flag.isPresent) return;
            // debugLog(`Revealing (safe) ${tile.coord.debugDescription}`);
            break;
        case GameSession.revealBehaviors.assertFlag:
            if (!tile.isCovered) return;
            if (tile.isMined && tile.flag == TileFlag.assertMine) return;
            // debugLog(`Revealing (asserting) ${tile.coord.debugDescription}`);
            break;
        case GameSession.revealBehaviors.assertTrustingFlags:
            if (tile.isCovered || tile.flag.isPresent) return;
            var assertFlagCount = 0;
            var anyMaybeFlagNeighbors = false;
            tile.visitNeighbors(neighbor => {
                if (neighbor.flag == TileFlag.maybeMine) { anyMaybeFlagNeighbors = true; }
                if (neighbor.flag == TileFlag.assertMine) { assertFlagCount += 1; }
            });
            if (anyMaybeFlagNeighbors) {
                debugLog("Don't attempt force-reveal with maybe-flag neighbors");
                return;
            }
            if (assertFlagCount != tile.minedNeighborCount) {
                debugLog("Don't attempt force-reveal with wrong flag count");
                return;
            }
            // debugLog(`Revealing (trusting flags) ${tile.coord.debugDescription}`);
            break;
        }

        if (tile.isMined) {
            this.mineTriggered(tile);
            return;
        }
        if (tile.minedNeighborCount == 0) {
            var toClear = [];
            this.revealClearArea(tile, toClear);
            toClear.forEach(tile => { tile.isCovered = false; });
        } else {
            tile.isCovered = false;
        }
        if (revealBehavior == GameSession.revealBehaviors.assertTrustingFlags) {
            tile.visitNeighbors(neighbor => {
                // debugLog(`Visiting neighbor ${neighbor.coord.debugDescription} with flag assertion`);
                this.attemptRevealTile(neighbor, GameSession.revealBehaviors.assertFlag);
            });
        }
    }

    // assumes tile isCovered and has minedNeighborCount == 0
    revealClearArea(tile, revealed) {
        if (revealed.contains(tile)) return;
        revealed.push(tile);
        tile.visitNeighbors(neighbor => {
            if (revealed.contains(neighbor) || !neighbor.isCovered || neighbor.flag.isPresent) return;
            if (neighbor.minedNeighborCount > 0) {
                revealed.push(neighbor);
            } else {
                this.revealClearArea(neighbor, revealed);
            }
        });
    }

    mineTriggered(tile) {
        tile.isCovered = false;
        this.state = GameState.lost;
        this.endTime = Date.now();
        new AlertDialog({
            title: Strings.str("lostAlertTitle"),
            message: Strings.template("lostAlertDialogTextTemplate", this.game.statistics),
            button: Strings.str("lostAlertButton")
        }).show();
    }

    checkForWin() {
        if (this.state != GameState.playing) { return; }
        var anyUnfinished = false;
        this.game.board.visitTiles(null, tile => {
            // Unfinished game if any covered, non-mine tiles.
            // No need to check flags: incorrect flag is === covered, non-mine tile.
            // Allow finishing game without flagging all uncovered mines.
            if (tile.isCovered && !tile.isMined) {
                anyUnfinished = true;
                return false;
            }
            return true;
        });
        if (!anyUnfinished) {
            this.state = GameState.won;
            this.endTime = Date.now();
            new SaveHighScoreDialog(this).show();
        }
    }
}
GameSession.gameControlsView = null;
GameSession.revealBehaviors = {
    safe: 0,
    assertTrustingFlags: 1,
    assertFlag: 2
};
// end class GameSession

function mark__Actions() {} // ~~~~~~ Actions ~~~~~~

class ActionResult {
    constructor(config) {
        this.action = config ? config.action : null;
        this.tile = config ? config.tile : null;
        this.description = config ? config.description : null;
        this.change = null; // a diff of statistics
    }

    setStatistics(start, end) {
        this.change = {
            assertMineFlagCount: end.assertMineFlagCount - start.assertMineFlagCount,
            clearedTileCount: end.clearedTileCount - start.clearedTileCount,
            progress: end.progress - start.progress,
            points: end.points - start.points
        };
    }
}

class SweepAction {
    get debugDescription() { return ""; }
    get actionDescription() { return null; }
    get requiresGameStatePlaying() { return true; }

    perform(session) {
        return SweepAction.Result.noop;
    }

    assertIsValid(session, assertion) {
        if (this.requiresGameStatePlaying) {
            if (!session || !(session.state == GameState.playing)) {
                debugWarn(`Action not valid: ${this.debugDescription}`);
                return false;
            }
        }
        if (typeof(assertion) == 'undefined') { return true; }
        if (!!assertion) { return true; }
        debugWarn(`Action not valid: ${this.debugDescription}`);
        return false;
    }
}
SweepAction.Result = {
    noop: 0,
    ok: 1,
    mineTriggered: 2
};

class TileBasedAction extends SweepAction {
    constructor(config) {
        super();
        this.tile = config.tile;
    }
}
SweepAction.TileBasedAction = TileBasedAction;

class PointInputBasedAction extends SweepAction {
    constructor(config) {
        super();
        this.point = config.point;
        // Optionally can directly specify tile if known
        this.tile = config.tile ? config.tile : null;
    }

    getTile(session) {
        return this.tile ? this.tile : session.game.board.tileAtCoord(this.point);
    }

    assertIsValidWithTile(session, assertion) {
        if (!this.assertIsValid(session, assertion)) { return null; }
        let tile = this.getTile(session);
        if (!tile) {
            debugWarn(`Tile not found for point input action: ${this.debugDescription}`);
            return null;
        }
        return tile;
    }
}
SweepAction.PointInputBasedAction = PointInputBasedAction;

class RevealTileAction extends PointInputBasedAction {
    constructor(config) {
        super(config);
        this.revealBehavior = config.revealBehavior;
        this.reason = config.reason ? config.reason : null;
    }

    get debugDescription() {
        return `<reveal ${this.revealBehavior} ${(this.tile ? this.tile.coord : this.point).debugDescription}>`;
    }

    perform(session) {
        let tile = this.assertIsValidWithTile(session);
        if (!tile) { return SweepAction.Result.noop; }
        session.attemptRevealTile(tile, this.revealBehavior);
        session.mostRecentAction = new ActionResult({
            action: this,
            tile: tile,
            description: this.reason ? this.reason : this.actionDescription
        });
    }

    get actionDescription() {
        if (this.revealBehavior == GameSession.revealBehaviors.safe) {
            return Strings.str("revealSingleTileActionDescription");
        }
        return Strings.str("revealTrustingFlagsActionDescription");
    }
}
SweepAction.RevealTileAction = RevealTileAction;

class AttemptHintAction extends SweepAction {
    static isValid(session) {
        if (!session) return false;
        return (session.state == GameState.playing)
            && !(session.mostRecentAction.action instanceof ShowHintAction);
    }

    get debugDescription() {
        return "attemptHint";
    }

    perform(session) {
        if (!this.assertIsValid(session, AttemptHintAction.isValid(session))) { return SweepAction.Result.noop; }

        // Try to find a safe covered tile adjacent to a cleared tile
        let candidates = TileCollection.allTiles(session)
            .applying(new RevealedTilesFilter())
            .applying(new CollectNeighborsTransform({ transform: collection =>
                collection.applying(new CoveredTilesFilter())
                    .applying(new MineFilter(false))
            }));

        // Fall back: find any safe covered tile
        // TODO how about a filter that only applies if the collection is empty?
        // so you can chain all of this onto the above and make it declarative etc.
        if (candidates.tiles.length == 0) {
            candidates = TileCollection.allTiles(session)
                .applying(new CoveredTilesFilter())
                .applying(new MineFilter(false));
        }
        
        let tile = candidates.randomTileClosestTo(session.mostRecentAction.tile)
        if (tile) {
            new ShowHintAction({ tile: tile }).perform(session);
        } else {
            session.hintTile = null;
            new ShowAlertDialogAction({
                title: Strings.str("errorAlertTitle"),
                message: Strings.str("showHintErrorText"),
                button: Strings.str("errorAlertDismissButton")
            }).perform(session);
        }
    }
}
SweepAction.AttemptHintAction = AttemptHintAction;

class ShowHintAction extends TileBasedAction {
    get debugDescription() {
        return `<hint ${this.tile.coord.debugDescription}>`;
    }

    perform(session) {
        if (!this.assertIsValid(session)) { return SweepAction.Result.noop; }
        session.beginMove();
        session.hintTile = this.tile;
        session.isClean = false;
        session.mostRecentAction = this.result;
        return SweepAction.Result.ok;
    }

    get result() {
        return new ActionResult({
            action: this,
            tile: this.tile,
            description: Strings.str("showHintActionDescription")
        });
    }
}
SweepAction.ShowHintAction = ShowHintAction;

class ShowAlertDialogAction extends SweepAction {
    constructor(config) {
        super();
        this.config = config;
        this.title = config.title;
        this.message = config.message;
        this.button = config.button;
    }

    get requiresGameStatePlaying() { return false; }
    get debugDescription() { return "<alert>"; }

    perform(session) {
        new AlertDialog({
            title: this.config.title,
            message: this.config.message,
            button: this.config.button
        }).show();
    }
}
SweepAction.ShowAlertDialogAction = ShowAlertDialogAction;

class SetFlagAction extends TileBasedAction {
    static actionDescription(tile) {
        switch (tile.flag) {
        case TileFlag.assertMine: return Strings.str("setFlagAssertMineActionDescription");
        case TileFlag.maybeMine: return Strings.str("setFlagMaybeMineActionDescription");
        case TileFlag.none: return Strings.str("setFlagNoneActionDescription");
        }
    }

    constructor(config) {
        super(config);
        this.flag = config.flag; // TileFlag
    }

    get debugDescription() {
        return `<flag ${this.flag.debugDescription}:${this.tile.coord.debugDescription}>`;
    }

    perform(session) {
        if (!this.assertIsValid(session, this.tile.isCovered)) {
            return SweepAction.Result.noop;
        }
        session.beginMove();
        this.tile.flag = this.flag;
        session.mostRecentAction = new ActionResult({
            action: this,
            tile: this.tile,
            description: SetFlagAction.actionDescription(this.tile)
        });
        return SweepAction.Result.ok;
    }
}
SweepAction.SetFlagAction = SetFlagAction;

class CycleFlagAction extends PointInputBasedAction {
    get debugDescription() {
        return `<cycleFlag ${this.point.debugDescription}>`;
    }

    perform(session) {
        let tile = this.assertIsValidWithTile(session);
        if (!tile || !tile.isCovered) { return SweepAction.Result.noop; }
        session.beginMove();
        tile.cycleFlag();
        session.mostRecentAction = new ActionResult({
            action: this,
            tile: this.tile,
            description: SetFlagAction.actionDescription(tile)
        });
        return SweepAction.Result.ok;
    }
}
SweepAction.CycleFlagAction = CycleFlagAction;

class AttemptSolverStepAction extends SweepAction {
    static isValid(session) {
        if (!session || !session.solver) return false;
        return (session.state == GameState.playing);
    }

    debugDescription() {
        return "<solverStep>"
    }

    perform(session) {
        if (!this.assertIsValid(session, AttemptSolverStepAction.isValid(session))) { return SweepAction.Result.noop; }
        session.beginMove();
        session.isClean = false;
        let result = session.solver.tryStep();
        debugLog(result);
        if (!result || !result.isSuccess) {
            new ShowAlertDialogAction({
                title: Strings.str("errorAlertTitle"),
                message: Strings.str("solverGotStuckMessage"),
                button: Strings.str("errorAlertDismissButton")
            }).perform(session);
            return SweepAction.Result.noop;
        }

        session.debugTiles = result.debugTiles;
        if (!result.debugMode) {
            result.actions.forEach(action => {
                if (session.state == GameState.playing) {
                    // TODO append action.tile to a list of solverActionTiles. Render them with a
                    // highlight similar to hint tiles
                    debugLog(`Perform: ${action.debugDescription}`);
                    let actionResult = action.perform(session);
                    session.checkForWin();
                }
            });
            session.mostRecentAction = result.actionResult;
        }
        return SweepAction.Result.ok;
    }
}
SweepAction.AttemptSolverStepAction = AttemptSolverStepAction;

function mark__Tile_Collections_and_Transforms() {} // ~~~~~~ Tile Collections and Transforms ~~~~~~

class TileCollection {
    static allTiles(session) {
        let tiles = [];
        session.game.board.visitTiles(null, tile => tiles.push(tile));
        return new TileCollection(tiles);
    }

    constructor(tiles, debugTiles) {
        this.tiles = tiles;
        this.debugTiles = debugTiles ? debugTiles : [];
    }

    get debugDescription() {
        return `<${this.tiles.length} tiles>`;
    }

    applying(transform) {
        let applied = this.tiles.flatMap(tile => {
            let mapped = transform.map(tile, this);
            if (mapped instanceof GameTile) {
                return mapped;
            } else if (typeof(mapped) == 'object') {
                return mapped;
            } else {
                return mapped ? tile : [];
            }
        });
        
        let collection = new TileCollection(TileTransform.unique(applied));
        if (this.debugTiles) {
            collection.appendDebugTiles(this.debugTiles);
        }
        return collection;
    }

    randomTileClosestTo(origin) {
        if (!origin || this.tiles.length == 0) {
            return this.tiles.randomItem();
        }

        let min = -1;
        let items = this.tiles.map(tile => {
            let distance = tile.coord.manhattanDistanceFrom(origin.coord).magnitude;
            min = min < 0 ? distance : Math.min(min, distance);
            return { tile: tile, distance: distance };
        });
        
        return items.filter(item => item.distance == min).randomItem().tile;
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
} // end class TileCollection

class TileTransform {
    static unique(tiles) {
        let applied = [];
        tiles.forEach(tile => {
            if (!applied.includes(tile)) { applied.push(tile); }
        });
        return applied;
    }

    // Return a boolean, empty array, one tile object, or array of multiple tiles.
    // Do not return null.
    map(tile, collection) {
        return tile;
    }
}
TileTransform.maxNeighbors = 8;

class HasNeighborsFilter extends TileTransform {
    constructor(config) {
        super();
        // TileCollection => TileCollection
        this.transform = config.transform;
        // condition = { HasNeighborsFilter.Condition.x: value }
        this.condition = config.condition;
    }

    map(tile, collection) {
        let filtered = this.transform(new TileCollection(tile.neighbors));
        let neighbors = filtered.tiles;
        if (filtered.debugTiles) { collection.appendDebugTiles(filtered.debugTiles); }
        if (typeof(this.condition.filteredNeighborCountEqualsMinedNeighborCount) != 'undefined') {
            let filteredNeighborCountEqualsMinedNeighborCount = (neighbors.length == tile.minedNeighborCount);
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
TileTransform.HasNeighborsFilter = HasNeighborsFilter;

class CollectNeighborsTransform extends TileTransform {
    constructor(config) {
        super();
        // TileCollection => TileCollection
        this.transform = config.transform;
    }

    map(tile, collection) {
        let filtered = this.transform(new TileCollection(tile.neighbors));
        if (filtered.debugTiles) { collection.appendDebugTiles(filtered.debugTiles); }
        return filtered.tiles;
    }
}
TileTransform.CollectNeighborsTransform = CollectNeighborsTransform;

class RevealedTilesFilter extends TileTransform {
    map(tile, collection) {
        return !tile.isCovered;
    }
}
TileTransform.RevealedTilesFilter = RevealedTilesFilter;

class CoveredTilesFilter extends TileTransform {
    map(tile, collection) {
        return tile.isCovered;
    }
}
TileTransform.CoveredTilesFilter = CoveredTilesFilter;

class FlaggedTilesFilter extends TileTransform {
    constructor(allowedFlags) {
        super();
        this.allowedFlags = allowedFlags;
    }

    map(tile, collection) {
        return this.allowedFlags.contains(tile.flag);
    }
}
TileTransform.FlaggedTilesFilter = FlaggedTilesFilter;

class MineFilter extends TileTransform {
    constructor(isMined) {
        super();
        this.isMined = isMined;
    }

    map(tile, collection) {
        return tile.isMined == this.isMined;
    }
}
TileTransform.MineFilter = MineFilter;

class MinedNeighborCountRangeFilter extends TileTransform {
    constructor(range) {
        super();
        this.range = range;
    }

    map(tile, collection) {
        return tile.minedNeighborCount >= this.range.min && tile.minedNeighborCount <= this.range.max;
    }
}
MinedNeighborCountRangeFilter.hasAny = new MinedNeighborCountRangeFilter({ min: 1, max: TileTransform.maxNeighbors });
TileTransform.MinedNeighborCountRangeFilter = MinedNeighborCountRangeFilter;

function mark__User_Input() {} // ~~~~~~ User Input ~~~~~~

class PointInputSequence {
    constructor(firstEvent) {
        this.events = [firstEvent];
    }
    get firstEvent() { return this.events[0]; }
    get firstPoint() { return this._point(this.events[0]); }
    get latestEvent() { return this.events[this.events.length - 1]; }
    get latestPoint() { return this._point(this.events[this.events.length - 1]); }
    get totalOffset() { return this.latestPoint.manhattanDistanceFrom(this.firstPoint); }
    get isSingleClick() {
        return this.latestEvent.type == "mouseup"
            && this.latestPoint.manhattanDistanceFrom(this.firstPoint).magnitude <= PointInputSequence.singleClickMovementTolerance;
    }
    add(event) { this.events.push(event); }
    _point(event) { return new Point(event.offsetX, event.offsetY); }
}
PointInputSequence.singleClickMovementTolerance = 3;

class _PointInputNoopDelegate {
    shouldPassPointSessionToNextDelegate(sequence, controller) {
        return false;
    }
    pointSessionChanged(sequence, controller) {
        // debugLog(`_PointInputNoopDelegate: ${sequence.latestEvent.type} @ ${sequence.latestPoint.debugDescription}`);
    }
}

class PointInputController {
    constructor(config) {
        this.eventTarget = config.eventTarget; // DOM element
        this.delegates = []; //new _PointInputNoopDelegate()];
        this.sequence = null;
        this.eventTarget.addEventListener("mousedown", this._mousedDown.bind(this));
        this.eventTarget.addEventListener("mouseup", this._mousedUp.bind(this));
        if (config.trackAllMovement) {
            this.eventTarget.addEventListener("mousemove", this._moved.bind(this));
        }
    }

    pushDelegate(delegate) { this.delegates.push(delegate); }
    popDelegate() {
        if (this.delegates.length <= 1) { return null; }
        return this.delegates.pop();
    }
    removeDelegate(delegate) {
        if (this.delegates.length <= 1) { return null; }
        var index = this.delegates.indexOf(delegate);
        if (this.delegates.isIndexValid(index)) {
            this.delegates.removeItemAtIndex(index);
            return delegate;
        }
        return null;
    }

    _mousedDown(evt) {
        this._buildSequence(evt, true, false);
    }

    _moved(evt) {
        this._buildSequence(evt, false, false);
    }

    _mousedUp(evt) {
        this._buildSequence(evt, false, true);
    }

    _buildSequence(evt, restart, end) {
        if (restart || !this.sequence) {
            this.sequence = new PointInputSequence(evt)
        } else {
            this.sequence.add(evt);
        }
        this._fireForEachDelegate();
        if (end) {
            this.sequence = null;
        }
    }

    _fireForEachDelegate() {
        for (var i = this.delegates.length - 1; i >= 0; i -= 1) {
            var delegate = this.delegates[i];
            if (delegate.pointSessionChanged) {
                delegate.pointSessionChanged(this.sequence, this);
            }
            if (delegate.shouldPassPointSessionToNextDelegate && !delegate.shouldPassPointSessionToNextDelegate(this.session, this)) {
                break;
            }
        }
    }
} // end PointInputController

class GameBoardController {
    constructor(view) {
        this.view = view;
        this.session = view.session;
        this.controller = new PointInputController({
            eventTarget: view.canvas,
            trackAllMovement: false
        });
        this.controller.pushDelegate(this);
        this.pixelScale = HTMLCanvasElement.getDevicePixelScale();
    }

    pointSessionChanged(inputSequence, inputController) {
        if (!inputSequence.isSingleClick) return;
        let point = new Point(inputSequence.latestPoint.x * this.pixelScale, inputSequence.latestPoint.y * this.pixelScale);
        let modelCoord = this.view.tilePlane.modelTileForScreenPoint(point);
        if (modelCoord) {
            if (inputSequence.latestEvent.shiftKey) {
                this.session.performAction(new CycleFlagAction({ point: modelCoord }));
            } else {
                let assertTrustingFlags = inputSequence.latestEvent.altKey || inputSequence.latestEvent.metaKey;
                let revealBehavior = assertTrustingFlags ? GameSession.revealBehaviors.assertTrustingFlags : GameSession.revealBehaviors.safe;
                this.session.performAction(new RevealTileAction({ point: modelCoord, revealBehavior: revealBehavior }));
            }
        }
    }
}

class GameControlsView {
    constructor(config) {
        this.session = config.session;
        this.elem = config.elem;
        this.elem.removeAllChildren();
        this.newGameButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("newGameButton"),
            click: () => this.newGame()
        });
        this.resetBoardButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("resetBoardButton"),
            click: () => this.resetBoard()
        });
        this.showHelpButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("showHelpButton"),
            click: () => this.showHelp()
        });
        this.showHighScoresButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("showHighScoresButton"),
            click: () => this.showHighScores()
        });
        this.showAnalysisButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("showAnalysisButton"),
            click: () => this.showAnalysis()
        });
        this.showHintButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("showHintButton"),
            click: () => this.showHint()
        });
        this.solverStepButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("solverStepButton"),
            click: () => this.solverStep()
        });

        if (Game.rules().allowDebugMode) {
            this.debugModeButton = new ToolButton({
                parent: this.elem,
                title: Strings.str("toggleDebugModeButton"),
                click: () => this.toggleDebugMode()
            });
        } else {
            this.debugModeButton = null;
        }
    }

    render() {
        this.resetBoardButton.isEnabled = this.session ? (this.session.state == GameState.playing) : false;
        this.showAnalysisButton.isEnabled = GameAnalysisDialog.isValid(this.session);
        this.showHintButton.isEnabled = AttemptHintAction.isValid(this.session);
        this.solverStepButton.isEnabled = AttemptSolverStepAction.isValid(this.session);
        if (this.debugModeButton) {
            this.debugModeButton.isSelected = this.session ? this.session.debugMode : false
        }
    }

    newGame() {
        new NewGameDialog().show();
    }

    resetBoard() {
        if (this.session) {
            // TODO prompt are you sure
            this.session.resetBoard();
        }
    }

    showHelp() {
        new HelpDialog().show();
    }

    showHighScores() {
        let difficulty = null;
        if (this.session && this.session.game) {
            difficulty = this.session.game.difficulty;
        }
        HighScoresDialog.showHighScores(GameStorage.shared, difficulty);
    }

    showAnalysis() {
        if (GameAnalysisDialog.isValid(this.session)) {
            new GameAnalysisDialog({ history: this.session.history }).show();
        }
    }

    showHint() {
        if (this.session) {
            this.session.performAction(new AttemptHintAction());
        }
    }

    solverStep() {
        if (this.session) {
            this.session.performAction(new AttemptSolverStepAction());
        }
    }

    toggleDebugMode() {
        if (this.session) {
            this.session.toggleDebugMode();
        }
    }
}

class ActionDescriptionView {
    constructor(config) {
        this.session = config.session;
        this.elem = config.elem;
    }

    render() {
        let description = this.session.mostRecentAction ? this.session.mostRecentAction.description : null;
        if (!description) {
            this.elem.innerHTML = "&nbsp;";
            return;
        }
        let change = this.session.mostRecentAction.change;
        let tokens = [];
        // TODO p11n
        if (change && change.clearedTileCount > 0) {
            tokens.push(Strings.template("recentActionClearedTileCountToken", change));
        }
        if (change && change.points > 0) {
            tokens.push(Strings.template("recentActionPointsWonToken", change));
        }
        if (tokens.length > 0) {
            let data = Object.assign({}, this.session.mostRecentAction, { list: Array.oxfordCommaList(tokens) });
            this.elem.innerText = Strings.template("recentActionWithChangesTemplate", data);
        } else {
            this.elem.innerText = description;
        }
    }
}

class GameStatusView {
    constructor(config) {
        this.session = config.session;
        this.elem = config.elem;
    }

    render() {
        this.elem.innerText = Strings.template(this.statusTemplate, this.session.game.statistics);
    }

    get statusTemplate() {
        switch (this.session.state) {
        case GameState.playing:
            return "gameStatusPlayingTemplate"
        case GameState.lost:
            return "gameStatusLostTemplate";
        case GameState.won:
            return "gameStatusWonTemplate";
        }
    }
}

class GameBoardView {
    static initialize(config) {
        GameBoardView.metrics = config;
    }

    constructor(config) {
        this.session = config.session;
        this.game = config.session.game;
        // iteration 1. point input controller doubles things wrong though
        // tileplane size == raw device pixel size (240)
        // canvas.width/height == raw device pixel size (240)
        // canvas style width/height == point size (120)    -- so divide by pixelSc
        //
        // iteration 2
        // tilePlane size = raw device pixel size (240)
        // canvas style width/height = 240
        // canvas.width/height == 240
        this.canvas = config.boardContainer.querySelector("canvas");
        const pixelScale = HTMLCanvasElement.getDevicePixelScale();
        const tileDeviceWidth = GameBoardView.metrics.tileWidth * pixelScale;
        this.tilePlane = new TilePlane(this.game.difficulty, tileDeviceWidth);
        this.tilePlane.viewportSize = { width: this.tilePlane.size.width * tileDeviceWidth, height: this.tilePlane.size.height * tileDeviceWidth };

        this.canvas.style.width = `${this.tilePlane.size.width * GameBoardView.metrics.tileWidth}px`;
        this.canvas.style.height = `${this.tilePlane.size.height * GameBoardView.metrics.tileWidth}px`;
        const canvasDeviceSize = this.tilePlane.viewportSize;
        this.canvas.width = canvasDeviceSize.width;
        this.canvas.height = canvasDeviceSize.height;

        this.tileViews = [];
        this.game.board.visitTiles(null, (tile) => {
            this.tileViews.push(new GameTileView(tile, this));
        });
        this.render();

        this.controller = new GameBoardController(this);
    }

    getContext() {
        return this.canvas.getContext("2d");
    }

    render() {
        let ctx = this.getContext();
        let context = {
            ctx: ctx,
            tilePlane: this.tilePlane,
            session: this.session,
            showAllMines: (this.session.state != GameState.playing)
        };
        ctx.rectClear(this.tilePlane.viewportScreenBounds);
        this.tileViews.forEach(tile => tile.render(context));
    }
}
// end class GameBoardView

class GameTileView {
    static initialize(config) {
        GameTileView.config = config;
    }

    constructor(model, boardView) {
        this.model = model; // GameTile
        this.boardView = boardView;
    }

    render(context) {
        const ctx = context.ctx;
        const rect = context.tilePlane.screenRectForModelTile(this.model.coord);
        const ext = rect.extremes;
        ctx.font = GameTileView.config.font;

        if (this.model.isCovered && !context.session.debugMode) {
            this.renderCovered(context, rect);
        } else {
            this.renderRevealed(context, rect);
        }

        // borders
        ctx.strokeStyle = GameTileView.config.borderStrokeStyle;
        ctx.lineWidth = GameTileView.config.borderStrokeWidth;
        if (this.model.coord.x > 0) {
            ctx.beginPath();
            ctx.moveTo(ext.min.x, ext.min.y);
            ctx.lineTo(ext.min.x, ext.max.y);
            ctx.stroke();
        }
        if (this.model.coord.y > 0) {
            ctx.beginPath();
            ctx.moveTo(ext.min.x, ext.max.y);
            ctx.lineTo(ext.max.x, ext.max.y);
            ctx.stroke();
        }

        if (this.model.isCovered) {
            ctx.strokeStyle = GameTileView.config.coveredBevelStyle;
            ctx.beginPath();
            let offset = GameTileView.config.coveredBevelWidth;
            ctx.moveTo(ext.min.x, ext.min.y + offset);
            ctx.lineTo(ext.max.x - offset, ext.min.y + offset);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(ext.max.x - offset, ext.min.y + offset);
            ctx.lineTo(ext.max.x - offset, ext.max.y);
            ctx.stroke();
        }

        if (context.session.hintTile == this.model) {
            this.renderContent(context, rect, GameTileViewState.hintTile);
        }

        if (Game.rules().allowDebugMode && context.session.debugTiles && context.session.debugTiles.contains(this.model)) {
            this.renderContent(context, rect, GameTileViewState.debug);
        }
    }

    renderCovered(context, rect) {
        const ctx = context.ctx;
        switch (this.model.flag) {
        case TileFlag.none:
            if (context.showAllMines && this.model.isMined) {
                return this.renderContent(context, rect, GameTileViewState.mineRevealed);
            } else {
                return this.renderContent(context, rect, GameTileViewState.covered);
            }
        case TileFlag.assertMine:
            if (context.showAllMines && !this.model.isMined) {
                return this.renderContent(context, rect, GameTileViewState.incorrectFlag);
            } else {
                return this.renderContent(context, rect, GameTileViewState.assertMine);
            }
        case TileFlag.maybeMine:
            if (context.showAllMines && !this.model.isMined) {
                return this.renderContent(context, rect, GameTileViewState.incorrectFlag);
            } else {
                return this.renderContent(context, rect, GameTileViewState.maybeMine);
            }
        }
    }

    renderRevealed(context, rect) {
        const ctx = context.ctx;
        if (this.model.isMined) {
            return this.renderContent(context, rect, GameTileViewState.mineTriggered);
        } else if (this.model.minedNeighborCount > 0) {
            return this.renderContent(context, rect, GameTileViewState.safe);
        } else {
            return this.renderContent(context, rect, GameTileViewState.clear);
        }
    }

    renderContent(context, rect, viewState) {
        viewState.render(context, rect, this.model);
        return this;
    }
} // end class GameTileView

class GameTileViewState {
    // config: dictionary with values: {glyph:, textColor:, fillColor:}
    static initialize(config) {
        GameTileViewState.covered = new GameTileViewState(config.covered);
        GameTileViewState.assertMine = new GameTileViewState(config.assertMine);
        GameTileViewState.maybeMine = new GameTileViewState(config.maybeMine);
        GameTileViewState.clear = new GameTileViewState(config.clear);
        GameTileViewState.safe = new GameTileViewState(Object.assign(config.safe, { glyph: tile => `${tile.minedNeighborCount}` }));
        GameTileViewState.mineTriggered = new GameTileViewState(config.mineTriggered);
        GameTileViewState.mineRevealed = new GameTileViewState(config.mineRevealed);
        GameTileViewState.incorrectFlag = new GameTileViewState(config.incorrectFlag);
        GameTileViewState.hintTile = new GameTileViewState(config.hintTile);
        GameTileViewState.debug = new GameTileViewState(config.debug);
    }

    constructor(config) {
        this.fillColor = config.fillColor;
        if (typeof(config.glyph) === 'function') {
            this.glyph = config.glyph;
        } else {
            this.glyph = tile => config.glyph;
        }
        this.textColor = config.textColor;
        this.numberTextColors = config.numberTextColors;
    }

    render(context, rect, tile) {
        context.ctx.fillStyle = this.fillColor;
        context.ctx.rectFill(rect);
        let textValue = this.glyph(tile);
        if (textValue) {
            if (this.numberTextColors && tile.minedNeighborCount > 0) {
                context.ctx.fillStyle = this.numberTextColors[tile.minedNeighborCount];
            } else {
                context.ctx.fillStyle = this.textColor;
            }
            context.ctx.fillTextCentered(textValue, rect);
        }
    }
}

class NewGameDialog extends GameDialog {
    constructor() {
        super();
        this.startButton = new ToolButton({
            title: Strings.str("newGameDialogStartButton"),
            click: () => this.validateAndStart()
        });
        this.contentElem = GameDialog.createContentElem();
        var formElem = GameDialog.createFormElem();

        const difficultyRules = Game.rules().difficulties;
        let defaultDifficultyIndex = GameStorage.shared.lastDifficultyIndex;
        if (!(defaultDifficultyIndex >= 0)) {
            defaultDifficultyIndex = difficultyRules.findIndex(difficulty => !!difficulty.isDefault);
        }
        this.difficulties = new Gaming.FormValueView.SingleChoiceInputCollection({
            id: "difficulty",
            parent: formElem,
            title: Strings.str("gameSettingsDifficultyLabel"),
            validationRules: [Gaming.FormValueView.SingleChoiceInputCollection.selectionRequiredRule],
            choices: difficultyRules.map(difficulty => { return {
                title: Strings.template("difficultyChoiceLabelTemplate", difficulty),
                value: difficulty.index,
                selected: difficulty.index == defaultDifficultyIndex
            }; })
        });
        this.difficulties.kvo.value.addObserver(this, () => {
            this.difficultyChanged();
        });

        let lastCustomDifficultyConfig = GameStorage.shared.lastCustomDifficultyConfig || difficultyRules.find(difficulty => difficulty.isCustom);
        let customDifficulty = Game.rules().customDifficulty;

        let validationRules = {
            width: InputView.makeNumericRangeRule(customDifficulty.width),
            height: InputView.makeNumericRangeRule(customDifficulty.height)
        };
        this.customWidthInput = new TextInputView({
            parent: formElem,
            title: Strings.template("newGameWidthInputLabelTemplate", customDifficulty.width),
            placeholder: Strings.str("newGameTileCountPlaceholder"),
            transform: InputView.integerTransform,
            validationRules: [input => {
                let isValid = validationRules.width(input);
                if (isValid) { this.customMineCountInput.revalidate(); }
                return isValid;
            }]
        }).configure(input => input.value = lastCustomDifficultyConfig.width);
        this.customHeightInput = new TextInputView({
            parent: formElem,
            title: Strings.template("newGameHeightInputLabelTemplate", customDifficulty.height),
            placeholder: Strings.str("newGameTileCountPlaceholder"),
            transform: InputView.integerTransform,
            validationRules: [input => {
                let isValid = validationRules.height(input);
                if (isValid) { this.customMineCountInput.revalidate(); }
                return isValid;
            }]
        }).configure(input => input.value = lastCustomDifficultyConfig.height);
        this.customMineCountInput = new TextInputView({
            parent: formElem,
            title: Strings.template("newGameMineCountInputLabelTemplate", this.validMineCountRange),
            placeholder: Strings.str("newGameMineCountPlaceholder"),
            transform: InputView.integerTransform,
            validationRules: [(input) => this.validateMineCount(input)]
        }).configure(input => input.value = lastCustomDifficultyConfig.mineCount);

        this.contentElem.append(formElem);
        this.allInputs = [this.difficulties, this.customWidthInput, this.customHeightInput, this.customMineCountInput];
        this.difficultyChanged();
    }

    show() {
        super.show();
        this.dismissButton.elem.addRemClass("hidden", !this.isDismissable);
    }

    get isDismissable() {
        return !!Sweep.session;
    }

    get isModal() { return true; }

    get title() { return Strings.str("newGameDialogTitle"); }

    get dialogButtons() {
        return [this.startButton.elem];
    }

    get isValid() {
        if (this.showCustomControls) {
            return this.allInputs.every(input => input.isValid);
        } else {
            return this.difficulties.isValid;
        }
    }

    get difficulty() {
        let difficulty = Game.rules().difficulties[this.difficulties.value];
        if (difficulty && difficulty.isCustom) {
            return Object.assign(difficulty, {
                width: this.customWidthInput.value,
                height: this.customHeightInput.value,
                mineCount: this.customMineCountInput.value
            });
        }
        return difficulty;
    }

    get showCustomControls() {
        let difficulty = Game.rules().difficulties[this.difficulties.value];
        return difficulty ? !!(difficulty.isCustom) : false;
    }

    get validMineCountRange() {
        let customDifficulty = Game.rules().customDifficulty;
        let tileCount = this.customWidthInput.value * this.customHeightInput.value;
        let maxMinesByRatio = Math.floor((tileCount) / customDifficulty.tileMineRatio.min);
        return { min: customDifficulty.mineCount.min, max: Math.min(tileCount, Math.min(maxMinesByRatio, customDifficulty.mineCount.max)) };
    }

    validateMineCount(input) {
        if (!this.showCustomControls) return true;
        let range = this.validMineCountRange;
        this.customMineCountInput.title = Strings.template("newGameMineCountInputLabelTemplate", range);
        let validation = InputView.makeNumericRangeRule(range);
        return validation(input);
    }

    difficultyChanged() {
        [this.customWidthInput, this.customHeightInput, this.customMineCountInput].forEach(input => {
            input.elem.addRemClass("hidden", !this.showCustomControls);
        });
        return true;
    }

    validateAndStart() {
        if (!this.isValid) {
            debugLog("NOT VALID");
            return;
        }
        this.dismiss();
        let game = new Game({ difficulty: this.difficulty });
        Sweep.session = new GameSession({ game: game });
        Sweep.session.start();
    }

    dismissButtonClicked() {
        if (this.isDismissable) {
            this.dismiss();
        }
    }

    dismiss() {
        Gaming.Kvo.stopAllObservations(this);
        super.dismiss();
    }
} // end class NewGameDialog

class AlertDialog extends GameDialog {
    constructor(config) {
        super();
        this.title = config.title;
        this.contentElem = GameDialog.createContentElem();
        this.x = new ToolButton({ title: config.button, click: () => this.dismiss() });
        let message = document.createElement("p").addRemClass("message", true);
        message.innerText = config.message;
        this.contentElem.append(message);
    }

    get isModal() { return true; }
    get dialogButtons() { return [this.x.elem]; }
}

class SaveHighScoreDialog extends GameDialog {
    constructor(session) {
        super();
        this.session = session;
        this.saveButton = new ToolButton({
            title: Strings.str(this.isEnabled ? "saveHighScoreButton" : "saveHighScoreDisabledButton"),
            click: () => this.save()
        });
        this.contentElem = GameDialog.createContentElem();

        let formElem = GameDialog.createFormElem();

        let textElem = document.createElement("p").addRemClass("message", true);
        let template = this.isEnabled ? "saveHighScoreDialogTextTemplate" : "saveHighScoreDisabledDialogTextTemplate";
        textElem.innerText = Strings.template(template, this.session.game.statistics);
        formElem.append(textElem);

        if (this.isEnabled) {
            this.playerNameInput = new TextInputView({
                parent: formElem,
                title: Strings.str("playerNameInputTitle"),
                placeholder: "",
                transform: (value) => InputView.trimTransform(value).toLocaleUpperCase(),
                // Count emoji as single characters
                validationRules: [InputView.notEmptyOrWhitespaceRule, (input) => [...(input.value)].length <= 3]
            }).configure(input => input.value = GameStorage.shared.lastPlayerName);
            this.allInputs = [this.playerNameInput];
        } else {
            this.allInputs = [];
        }
        
        this.contentElem.append(formElem);
    }

    get isModal() { return true; }
    get title() { return Strings.str("saveHighScoreDialogTitle"); }

    get dialogButtons() {
        return [this.saveButton.elem];
    }

    get isEnabled() {
        return this.session.isClean;
    }
    get isValid() {
        return this.allInputs.every(input => input.isValid);
    }

    get playerName() {
        return this.playerNameInput.value.toLocaleUpperCase();
    }

    save() {
        if (!this.isEnabled) {
            this.dismiss();
            return;
        }

        if (!this.isValid) {
            debugLog("NOT VALID");
            return;
        }
        let difficulty = this.session.game.difficulty;
        GameStorage.shared.addHighScore(this.session, this.playerName);
        this.dismiss();
        HighScoresDialog.showHighScores(GameStorage.shared, difficulty);
    }
}

class HelpDialog extends GameDialog {
    constructor() {
        super();
        this.contentElem = GameDialog.createContentElem();
        let elem = document.querySelector("body > help")
            .cloneNode(true).addRemClass("hidden", false);
        this.contentElem.append(elem);
        this.x = new ToolButton({
            title: Strings.str("helpDismiss"),
            click: () => this.dismiss()
        });
    }

    show() {
        super.show();
        this.root.id = "help";
        return this;
    }

    // get cssID() { return "help"; }
    get isModal() { return false; }
    get title() { return Strings.str("helpDialogTitle"); }
    get dialogButtons() { return [this.x.elem]; }
}

class GameAnalysisDialog extends GameDialog {
    static initialize(config) {
        GameAnalysisDialog.metrics = config;
    }

    static isValid(session) {
        return !!session && !session.history.isEmpty;
    }

    constructor(config) {
        super({ rootElemClass: "analysis" });

        this.history = config.history; // GameHistory

        this.contentElem = GameDialog.createContentElem();
        let elem = document.querySelector("body > analysis")
            .cloneNode(true).addRemClass("hidden", false);
        this.contentElem.append(elem);

        this.x = new ToolButton({
            title: Strings.str("analysisViewDismiss"), // TODO
            click: () => this.dismiss()
        });

        this.buildChartView(elem);
        // this.buildRainbowBoard(elem);
    }

    get isModal() { return false; }
    get title() { return Strings.str("analysisViewTitle"); }
    get dialogButtons() { return [this.x.elem]; }

    buildChartView(elem) {
        let data = {
            score: new ChartDataSeries({ name: Strings.str("analysisChartSeriesNameScore") }),
            assertMineFlagCount: new ChartDataSeries({ name: Strings.str("analysisChartSeriesNameAssertMineFlagCount") })
        };
        // TODO have first element of each series be a 0,0 value?
        // Then element index 1 == moveNumber 0 == userFacingMoveNumber 1
        this.history.visitHistory((moment, moveNumber) => {
            data.score.push(moveNumber, moment.game.statistics.points);
            data.assertMineFlagCount.push(moveNumber, moment.game.statistics.assertMineFlagCount);
        });

        let metrics = GameAnalysisDialog.metrics.historyChart;
        let presentation = [
            new ChartDataSeriesPresentation({
                series: data.score,
                style: Object.assign({ type: ChartDataSeriesPresentation.Type.line }, metrics.series.score)
            })
        ];
        let showMineSeries = data.assertMineFlagCount.range.max > 0;
        if (showMineSeries) {
            presentation.unshift(new ChartDataSeriesPresentation({
                series: data.assertMineFlagCount,
                style: Object.assign({ type: ChartDataSeriesPresentation.Type.line }, metrics.series.assertMineFlagCount)
            }));
        }

        let axes = {
            x: new ChartAxisPresentation(Object.assign({}, metrics.axes.x, {
                labels: data.score.values.map(value => {
                    return Number.uiInteger(GameHistory.userFacingMoveNumber(value.x))
                }),
                title: Strings.str("analysisChartMoveNumberLabel"),
            })),
            y: {
                primary: new ChartAxisPresentation(Object.assign({}, metrics.axes.y.primary, {
                    series: data.score,
                    title: data.score.name
                })),
                secondary: null
            }
        };

        let formatter = value => Number.uiInteger(Math.round(value));
        if (axes.y.primary.hasValueLabels) {
            axes.y.primary.valueLabels.formatter = formatter;
        }
        if (showMineSeries) {
            let range = { min: 0, max: data.assertMineFlagCount.values.map(value => value.y).maxElement() };
            axes.y.secondary = new ChartAxisPresentation(Object.assign({}, metrics.axes.y.secondary, {
                labels: Array.mapSequence(range, value => Number.uiInteger(value)),
                title: data.assertMineFlagCount.name
            }));
        }
        debugLog(axes);

        this.chartView = new ChartView({
            elem: elem.querySelector(".history-chart canvas"),
            title: "HENLO", // TODO
            series: presentation,
            axes: axes,
            style: metrics
        });
    }

    show() {
        super.show();
        this.render();
    }

    render() {
        this.chartView.render();
    }
} // end class GameAnalysisDialog

class HighScoresDialog extends GameDialog {
    static showHighScores(storage, difficulty) {
        const highScores = storage.highScoresByDifficulty;
        new HighScoresDialog(highScores, difficulty).show();
    }

    constructor(data, selected) {
        super();
        this.contentElem = GameDialog.createContentElem();
        let elem = document.querySelector("body > highScores")
            .cloneNode(true).addRemClass("hidden", false);
        this.contentElem.append(elem);
        this.scores = elem.querySelector(".scores");
        this.x = new ToolButton({
            title: Strings.str("highScoresDismiss"),
            click: () => this.dismiss()
        });

        this.buttons = [];
        data.difficulties.forEach(difficulty => {
            let index = difficulty.difficulty.index;
            let rules = Game.rules().difficulties[index];
            if (rules) {
                this.buttons.push(new ToolButton({
                    id: "",
                    parent: elem.querySelector(".difficulties row"),
                    title: rules.name,
                    click: () => this.selectDifficulty(index)
                }));

                let highScore = this.highScoreElement(difficulty, elem.querySelector("scoreTemplate"))
                    .addRemClass("highScores", true)
                    .addRemClass(this.classForDifficulty(index), true);
                this.scores.append(highScore);
            }
        });

        if (selected) {
            this.selectDifficulty(selected.index);
        } else {
            const first = data.difficulties.findIndex(item => item.highScores.length > 0);
            this.selectDifficulty(first >= 0 ? first : 0);
        }
    }

    classForDifficulty(index) {
        return `difficulty-${index}`;
    }

    selectDifficulty(index) {
        this.buttons.forEach((item, difficultyIndex) => item.isSelected = (index == difficultyIndex));
        this.scores.querySelectorAll(".highScores").forEach(item => item.addRemClass("hidden", true));
        this.scores.querySelector(`.${this.classForDifficulty(index)}`).addRemClass("hidden", false);
    }

    highScoreElement(difficulty, template) {
        if (difficulty.highScores.length == 0) {
            return template.querySelector("p").cloneNode(true);
        } else {
            let highScores = document.createElement("ol");
            difficulty.highScores.slice(0, 10).forEach(highScore => {
                let item = template.querySelector("li").cloneNode(true);
                item.querySelector("name").innerText = highScore.playerName;
                item.querySelector("date").innerText = new Date(highScore.timestamp).toLocaleDateString("default", { dateStyle: "short" });
                item.querySelector("points").innerText = highScore.points;
                item.querySelector("stars").innerText = Strings.str(`stars${Game.starCount(highScore)}`);
                highScores.append(item);
            });
            return highScores;
        }
    }

    get isModal() { return false; }
    get title() { return Strings.str("highScoresDialogTitle"); }
    get dialogButtons() { return [this.x.elem]; }
} // end class HighScoresDialog

var initialize = async function() {
    let content = await GameContent.loadYamlFromLocalFile("sweep-content.yaml", GameContent.cachePolicies.forceOnFirstLoad);
    if (!content) {
        alert(Strings.str("failedToLoadGameMessage"));
        return;
    }

    Gaming.Strings.initialize(content.strings);
    Game.initialize(content);
    new NewGameDialog().show();
};

return {
    initialize: initialize,
    session: null,
    ActionResult: ActionResult,
    Game: Game,
    GameSession: GameSession,
    GameTile: GameTile,
    SweepAction: SweepAction,
    TileCollection: TileCollection,
    TileFlag: TileFlag,
    TileTransform: TileTransform
};

})(); // end Sweep namespace

Sweep.initialize();
