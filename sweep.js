"use-strict";

self.Sweep = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;

const Dispatch = Gaming.Dispatch;
const DispatchTarget = Gaming.DispatchTarget;
const FlexCanvasGrid = Gaming.FlexCanvasGrid;
const GameContent = Gaming.GameContent;
const GameDialog = Gaming.GameDialog;
const GameScriptEngine = Gaming.GameScriptEngine;
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

function mark__Game_Model() {} // ~~~ Game Model

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
        this.rainbow = { cleared: -1, flagged: -1 };
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

    static testCompactSerialization() {
        let specs = [
            [false, false, TileFlag.none, 0, "____"],
            [true,  false, TileFlag.none, 0, "m___"],
            [true,  true, TileFlag.none, 0, "_c__"],
            [true,  true, TileFlag.none, 0, "mc__"],
            [false,  false, TileFlag.assertMine, 0, "__!_"],
            [false,  false, TileFlag.maybeMine, 0, "__?_"],
            [false,  false, TileFlag.none, 1, "___1"],
            [false,  false, TileFlag.none, 2, "___2"],
            [false,  false, TileFlag.none, 3, "___3"],
            [false,  false, TileFlag.none, 4, "___4"],
            [false,  false, TileFlag.none, 5, "___5"],
            [false,  false, TileFlag.none, 6, "___6"],
            [false,  false, TileFlag.none, 7, "___7"],
            [false,  false, TileFlag.none, 8, "___8"],
            [true,   true,  TileFlag.none, 5, "mc_5"]
        ];
        specs.forEach(item => {
            let tile = new GameTile();
            tile._mined = item[0];
            tile._covered = item[1];
            tile._flag = item[2];
            tile._minedNeighborCount = item[3];
            // debugLog(tile);
            GameTile.testSzEqual(tile, GameTile.fromCompactSerialization(tile.compactSerialized), item[4]);
        });
    }

    static testSzEqual(tile, config, message) {
        let fails = 0;
        fails += GameTile.assertSzEqual(tile.isMined, config.isMined, "isMined", message);
        fails += GameTile.assertSzEqual(tile.isCovered, config.isCovered, "isCovered", message);
        fails += GameTile.assertSzEqual(tile.flag.debugDescription, config.flag.debugDescription, "flag", message);
        fails += GameTile.assertSzEqual(tile.minedNeighborCount, config.minedNeighborCount, "minedNeighborCount", message);
        if (fails > 0) {
            debugLog(`${fails} failures: ${message}`);
        } else {
            debugLog(`Passed: ${message}`);
        }
    }

    static assertSzEqual(a, b, item, message) {
        if (a != b) {
            debugWarn(`${item}: ${a} != ${b}: ${message}`);
            return 1;
        }
        return 0;
    }

    // returns metadata, not a full GameTile
    static fromCompactSerialization(data) {
        let flag = (data & 0xc) >> 2;
        return {
            isMined: !!(data & 0x1),
            isCovered: !!(data & 0x1 << 1),
            flag: TileFlag.sz[flag],
            minedNeighborCount: (data & 0xf0) >> 4
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
    reveal(moveNumber) {
        if (this._covered) {
            this._covered = false;
            this.rainbow.cleared = moveNumber;
        }
        return this.clearFlag();
    }

    get flag() { return this._flag; }
    clearFlag() {
        this._flag = TileFlag.none;
        this.rainbow.flagged = -1;
        return this;
    }
    setFlag(value, moveNumber) {
        if (this._flag == value) { return this; }
        this._flag = value;
        if (this._flag != TileFlag.none) {
            this.rainbow.flagged = moveNumber;
        } else {
            this.rainbow.flagged = -1;
        }
        return this;
    }
    cycleFlag(moveNumber) {
        return this.setFlag(this._flag.next, moveNumber);
    }

    get neighbors() {
        return this._neighbors;
    }

    _boardConstructed() {
        this._minedNeighborCount = 0;
        this._covered = true;
        this._flag = TileFlag.none;
        this._neighbors = [];
        this.rainbow = { cleared: -1, flagged: -1 };

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
        this._neighbors.forEach(neighbor => {
            if (SweepPerfTimer.shared) { SweepPerfTimer.shared.counters.visitNeighbors++; }
            block(neighbor, this)
        });
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
            schemaVersion: Game.schemaVersion,
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
            schemaVersion: Game.schemaVersion,
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
                if (SweepPerfTimer.shared) { SweepPerfTimer.shared.counters.visitTiles++; }
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
        if (SweepPerfTimer.shared) {
            SweepPerfTimer.shared.counters.visitTiles += (3 * this._allTiles.length) + mineTiles.length;
        }
        debugLog(Game.debugSummary(this));
    }
} // end class GameBoard

class Game {
    static initialize(content) {
        if (content.rules && content.rules.difficulties) {
            GameContent.addIndexToItemsInArray(content.rules.difficulties);
            content.rules.difficulties.forEach( difficulty => { difficulty.name = Strings.str(difficulty.name); });
        }
        Game.content = content;
        Game.content.rules.allowDebugMode = Game.content.rules.allowDebugMode || (self.location ? (self.location.hostname == "localhost") : false);
        Game.content.rules.maxStarCount = Game.content.rules.highScoreThresholds.length + 1;
        Achievement.initialize();
        GameBoardView.initialize(content.gameBoardView);
        GameTileView.initialize(content.gameTileView);
        GameTileViewState.initialize(content.gameTileViewState);
        GameAnalysisDialog.initialize(content.analysisView);
        Moo.initialize(content.moo);
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
        return Strings.template("gameBoardDebugSummaryTemplate", Game.formatStatistics(stats));
    }

    static pointsValue(tile) {
        return Math.pow(2, tile.minedNeighborCount);
    }

    static progress(clearedTileCount, assertMineFlagCount, totalTileCount) {
        return (clearedTileCount + assertMineFlagCount) / totalTileCount;
    }

    static starCount(stats) {
        const highScoreThresholds = Game.rules().highScoreThresholds;
        if (stats.totalTileCount <= 0) { return 1; }
        let ratio = stats.mineCount / Math.pow(stats.totalTileCount, 0.75)
        return 1 + highScoreThresholds.filter(value => value <= ratio).length;
    }

    constructor(config) {
        this.difficulty = config.difficulty;
        this.board = config.board || new GameBoard({ size: config.difficulty, mineCount: config.difficulty.mineCount });
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
        stats.progress = Game.progress(stats.clearedTileCount, stats.assertMineFlagCount, stats.totalTileCount);
        stats.progressPercent = Number.uiFormatWithPercent(Math.floor(100 * stats.progress));
        stats.starCount = Game.starCount(stats);
        stats.stars = Game.formatStars(stats.starCount);
        return stats;
    }

    static integerFormatObject(magnitude) {
        return { value: magnitude, formatted: Number.uiInteger(magnitude) };
    }

    static formatStatistics(statistics) {
        let data = Object.assign({}, statistics);
        if (data.difficulty) {
            data.width = Game.integerFormatObject(data.difficulty.width);
            data.height = Game.integerFormatObject(data.difficulty.height);
        }
        data.mineCount = Game.integerFormatObject(data.mineCount);
        data.totalTileCount = Game.integerFormatObject(data.totalTileCount);
        data.assertMineFlagCount = Game.integerFormatObject(data.assertMineFlagCount);
        data.clearedTileCount = Game.integerFormatObject(data.clearedTileCount);
        data.starCount = Game.integerFormatObject(data.starCount);
        return data;
    }

    static formatStars(starCount) {
        return Strings.str(`stars${starCount}`);
    }
} // end class Game
Game.schemaVersion = 1;
Game.appVersion = "1.3";

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
        this.achievementsCollection = new SaveStateCollection(window.localStorage, "SweepAchievements");
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

    get achievementsByID() {
        let data = {};
        this.achievementsCollection.itemsSortedByLastSaveTime.forEach(summary => {
            let item = this.achievementsCollection.getItem(summary.id);
            if (item) {
                data[item.id] = item.data;
            }
        });
        return data;
    }

    saveAchievement(achievement) {
        let item = new SaveStateItem(achievement.id, achievement.id, achievement.date, achievement.objectForSerialization);
        this.achievementsCollection.saveItem(item);
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

    get rainbowMode() {
        let item = this.preferencesCollection.getItem(this.preferencesCollection.namespace);
        return item ? !!item.data.rainbowMode : false;
    }
    set rainbowMode(value) {
        this.setPreference("rainbowMode", value);
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

    get difficulty() {
        if (this.isEmpty) { return null; }
        let moment =  MoveHistoryMoment.fromCompactSerialization(JSON.parse(this.serializedMoves[0]), null);
        return moment.game.difficulty;
    }

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
            let object = moment.bestSerialization(this.lastMove);
            let data = JSON.stringify(object);
            // debugLog(`move ${this.moveNumber}: storing ${data.length} bytes, ${object.format}`);
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
        stats.progress = Game.progress(stats.clearedTileCount, stats.assertMineFlagCount, previous.game.statistics.totalTileCount);

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
            schemaVersion: Game.schemaVersion,
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

class GameSession {
    static quit(prompt) {
        if (!prompt || confirm(Strings.str("quitGameConfirmPrompt"))) {
            window.location = "index.html";
        }
    }

    static begin(game) {
        if (Sweep.session) {
            Sweep.session.start(game);
        } else {
            Sweep.session = new GameSession({ game: game });
            Sweep.session.start();
        }
    }

    static isShowingDialog() {
        return !!Gaming.GameDialogManager.shared.currentDialog;
    }

    constructor(config) {
        this.game = config.game;
        this.state = GameState.playing;
        this.moveState = MoveState.ready;
        this.debugMode = false;
        this.rainbowMode = GameStorage.shared.rainbowMode;
        this.history = new GameHistory();
        this.isClean = !this.debugMode; // false if cheated, etc.
        this.mostRecentAction = new ActionResult();
        this.hintTile = null;
        this.solver = null;
        this.debugTiles = [];
        this.elems = {
            boardContainer: document.querySelector("board")
        };
        this.inputController = new InputController();
        this.controlsView = new GameControlsView({ session: this, elem: document.querySelector("header row") });
        this.mostRecentActionView = new ActionDescriptionView({ session: this, elem: document.querySelector("message") });
        this.boardView = new GameBoardView({ session: this, boardContainer: this.elems.boardContainer });
        this.statusView = new GameStatusView({ session: this, elem: document.querySelector("footer") });
        this.views = [this.controlsView, this.mostRecentActionView, this.boardView, this.statusView];
        this.moo = new Moo({ session: this, elem: document.querySelector("moo"), boardView: this.boardView, inputController: this.inputController });
    }

    start(newGame) {
        if (newGame) {
            this.game = newGame;
            this.boardView.game = this.game;
        }
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
        this.moo.beginMove();
        this.warningMessage = null;
        this.elems.boardContainer.addRemClass("hidden", false);

        if (SweepSolver) {
            let debug = Game.rules().allowDebugMode && Game.rules().solverDebugMode;
            this.solver = new SweepSolver.SolverAgent({ session: this, debugMode: debug, solvers: SweepSolver.Solver.allSolvers });
        } else {
            this.solver = null;
        }

        if (newGame) {
            this.boardView.game = this.game;
        }
        this.renderViews();
    }

    get hasMoved() {
        return this.history.moveNumber > GameHistory.firstMoveNumber;
    }

    // debug only
    resetBoard() {
        if (this.state != GameState.playing) { return; }
        this.hintTile = null;
        this.debugTiles = [];
        this.game.board.reset();
        this.start();
    }

    renderViews() {
        // SweepPerfTimer.startShared("renderViews");
        this.views.forEach(view => view.render());
        SweepPerfTimer.endShared();
    }

    toggleDebugMode() {
        this.debugMode = !this.debugMode;
        if (this.debugMode) {
            this.isClean = false;
        }
        this.renderViews();
    }

    toggleRainbowMode() {
        this.rainbowMode = !this.rainbowMode;
        GameStorage.shared.rainbowMode = this.rainbowMode;
        this.renderViews();
    }

    // Not reentrant.
    // if action.peform invokoes other actions, they should do so via action.perform
    // calls instead of session.performAction.
    // That way performAction can represent a single block of user interaction, can manage
    // state, etc.
    performAction(action) {
        // SweepPerfTimer.startShared("performAction");
        this.moveState = MoveState.pending;
        let start = this.game.statistics;
        action.perform(this);
        this.checkForWin();
        this.pendingMove = MoveState.ready;
        this.mostRecentAction.setStatistics(start, this.game.statistics);
        if (SweepPerfTimer.shared) {
            SweepPerfTimer.shared.counters.action = this.mostRecentAction.description;
        }
        SweepPerfTimer.endShared();
        Dispatch.shared.postEventSync(GameSession.moveCompletedEvent, this);
        this.renderViews();
    }

    performActions(actions, actionResult) {
        let result = SweepAction.Result.noop;
        actions.forEach(action => {
            if (this.state == GameState.playing) {
                // debugLog(`Perform: ${action.debugDescription}`);
                result = action.perform(this);
                this.checkForWin();
            }
        });
        if (actions.length > 0) {
            this.mostRecentAction = actionResult;
        }
        return result;
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
            this.warningMessage = null;
            this.moveState = MoveState.active;
            this.moo.beginMove();
        }
    }

    recordGameState() {
        this.history.setCurrentMove(new MoveHistoryMoment({ session: this }));
    }
    
    attemptRevealTile(tile, revealBehavior) {
        if (this.state != GameState.playing) { return; }
        if (!tile) { return; }

        let dots = ".";
        while (!this.hasMoved && tile.isMined) {
            debugLog("Clicked a mine on first move. Shuffling" + dots);
            dots += ".";
            this.game.board.shuffle();
        }
        this.beginMove();

        switch (revealBehavior) {
        case GameSession.revealBehaviors.safe:
            if (!tile.isCovered || tile.flag.isPresent) return SweepAction.Result.noop;
            // debugLog(`Revealing (safe) ${tile.coord.debugDescription}`);
            break;
        case GameSession.revealBehaviors.assertFlag:
            if (!tile.isCovered) return;
            if (tile.isMined && tile.flag == TileFlag.assertMine) return SweepAction.Result.noop;
            // debugLog(`Revealing (asserting) ${tile.coord.debugDescription}`);
            break;
        case GameSession.revealBehaviors.assertTrustingFlags:
            if (tile.isCovered || tile.flag.isPresent) return SweepAction.Result.noop;
            var assertFlagCount = 0;
            var anyMaybeFlagNeighbors = false;
            let candidates = 0;
            tile.visitNeighbors(neighbor => {
                if (neighbor.flag == TileFlag.maybeMine) { anyMaybeFlagNeighbors = true; }
                if (neighbor.flag == TileFlag.assertMine) { assertFlagCount += 1; }
                if (neighbor.isCovered && neighbor.flag != TileFlag.assertMine) { candidates += 1; }
            });
            if (anyMaybeFlagNeighbors) {
                this.warningMessage = Strings.str("warningAbortRevealNeighborsMaybeFlags");
                return SweepAction.Result.failure;
            }
            if (assertFlagCount != tile.minedNeighborCount) {
                this.warningMessage = Strings.str("warningAbortRevealNeighborsIncorrectFlagCount");
                return SweepAction.Result.failure;
            }
            if (candidates == 0) {
                this.warningMessage = Strings.str("warningAbortRevealNeighborsNoCandidates");
                return SweepAction.Result.noop;
            }
            // debugLog(`Revealing (trusting flags) ${tile.coord.debugDescription}`);
            break;
        }

        if (tile.isMined) {
            this.mineTriggered(tile);
            return SweepAction.Result.mineTriggered;
        }
        if (tile.minedNeighborCount == 0) {
            var toClear = [];
            this.revealClearArea(tile, toClear);
            toClear.forEach(tile => { tile.reveal(this.history.moveNumber); });
        } else {
            tile.reveal(this.history.moveNumber);
        }
        if (revealBehavior == GameSession.revealBehaviors.assertTrustingFlags) {
            tile.visitNeighbors(neighbor => {
                // debugLog(`Visiting neighbor ${neighbor.coord.debugDescription} with flag assertion`);
                this.attemptRevealTile(neighbor, GameSession.revealBehaviors.assertFlag);
            });
        }
        return this.state == GameState.lost ? SweepAction.Result.mineTriggered : SweepAction.Result.ok;
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

    eatMine(tile) {
        if (!tile.isMined || this.game.board.mineCount <= 1) { return; }
        tile.isMined = false;
        tile._boardConstructed();
        tile.visitNeighbors(neighbor => neighbor._boardConstructed());
        this.game.board.mineCount -= 1;
    }

    mineTriggered(tile) {
        tile.reveal(this.history.moveNumber);
        this.state = GameState.lost;
        this.endTime = Date.now();
        this.history.setCurrentMove(new MoveHistoryMoment({ session: this }));
        Dispatch.shared.postEventSync(GameSession.gameCompletedEvent, this, this.debugMode);
        new AlertDialog({
            title: Strings.str("lostAlertTitle"),
            message: Strings.template("lostAlertDialogTextTemplate", Game.formatStatistics(this.game.statistics)),
            buttons: [{ title: Strings.str("lostAlertButton") }]
        }).show();
    }

    undoLoss() {
        if (this.state != GameState.lost) { return; }
        let collection = TileCollection.allTiles(this)
            .applying(new RevealedTilesFilter())
            .applying(new MineFilter(true));
        collection.tiles.forEach(tile => {
            tile.setFlag(TileFlag.assertMine, this.history.moveNumber);
            tile._covered = true;
            tile.rainbow.cleared = -1;
        });
        this.state = GameState.playing;
        this.endTime = null;
        this.isClean = false;
        this.renderViews();
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
            this.history.setCurrentMove(new MoveHistoryMoment({ session: this }));
            Dispatch.shared.postEventSync(GameSession.gameCompletedEvent, this, this.debugMode);
            new SaveHighScoreDialog(this).show();
        }
    }
}
GameSession.moveCompletedEvent = "GameSession.moveCompletedEvent";
GameSession.gameCompletedEvent = "GameSession.gameCompletedEvent";
GameSession.gameControlsView = null;
GameSession.revealBehaviors = {
    safe: 0,
    assertTrustingFlags: 1,
    assertFlag: 2
};
// end class GameSession

function mark__Serialization() {} // ~~~ Serialization

class Sharing {
    static cleanBase64(text) {
        return text ? text.replace(/--.*--\W*/g, "") : "";
    }

    static gameBoardObject(session, preserveGameState) {
        if (!session || !session.game) { return null; }
        return {
            v: Game.schemaVersion,
            type: Sharing.type.board,
            data: session.game.objectForSharing(preserveGameState)
        };
    }

    static gameFromBoardObject(object) {
        if (!object) {
            throw new Error("failedToParseGame");
        }
        if (object.v != Game.schemaVersion) {
            throw new Error("schemaVersionUnsupported");
        }
        if (object.type != Sharing.type.board || !object.data) {
            throw new Error("failedToParseGame");
        }
        return Game.fromObjectForSharing(object.data);
    }
}
Sharing.type = {
    board: "board"
};

Game.prototype.objectForSharing = function(preserveGameState) {
    return {
        difficulty: this.difficulty.index,
        preserveGameState: preserveGameState,
        board: this.board.objectForSharing(preserveGameState)
    };
};

Game.fromObjectForSharing = function(data) {
    if (!data || !data.hasOwnProperty("difficulty") || !data.hasOwnProperty("board")) {
        throw new Error("failedToParseGame");
    }
    let difficulty = Game.rules().difficulties[data.difficulty];
    if (!difficulty) {
        throw new Error("failedToParseGame");
    }
    let board = GameBoard.fromObjectForSharing(data.board);
    if (difficulty.isCustom) {
        difficulty = Object.assign({}, difficulty, {
            width: board.size.width,
            height: board.size.height,
            mineCount: board.mineCount
        });
    }
    return new Game({ difficulty: difficulty, board: board });
};

// returns [[width, height, mineCount, preserveGameState, checksum], [tile, tile, ...]]
GameBoard.prototype.objectForSharing = function(preserveGameState) {
    let bits = new Gaming.BoolArray(this._allTiles.length);
    this._allTiles.forEach((tile, index) => {
        if (SweepPerfTimer.shared) { SweepPerfTimer.shared.counters.visitTiles++; }
        bits.setValue(index, tile.isMined);
    });
    let data = bits.objectForSerialization;
    let checksum = Gaming.hashArrayOfInts(data);
    let header = [this.size.width, this.size.height, this.mineCount, preserveGameState ? 1 : 0, checksum];
    return [header, data];
};

GameBoard.fromObjectForSharing = function(object) {
    if (!Array.isArray(object) || object.length != 2) {
        throw new Error("failedToParseGame");
    }
    let header = object[0];
    let data = object[1];
    if (!Array.isArray(header) || header.length != 5 || !Array.isArray(data)) {
        throw new Error("failedToParseGame");
    }

    let size = {};
    size.width = header.shift();
    size.height = header.shift();
    let mineCount = header.shift();
    let preserveGameState = !!(header.shift());
    let checksum = header.shift();
    let customDifficulty = Game.rules().customDifficulty;

    let isValid = size.width >= customDifficulty.width.min
            && size.width <= customDifficulty.width.max
            && size.height >= customDifficulty.height.min
            && size.height <= customDifficulty.height.max
            && Gaming.hashArrayOfInts(data) == checksum;
    if (!isValid) {
        debugWarn("invalid GameBoard objectForSharing");
        debugLog({ size: size, mineCount: mineCount, preserveGameState: preserveGameState, checksum: { expected: checksum, actual: Gaming.hashArrayOfInts(data) } });
        throw new Error("failedToParseGame");
    }

    let board = new GameBoard({ size: size, mineCount: mineCount });
    let bits = new Gaming.BoolArray(data);
    if (bits.length != board._allTiles.length) {
        debugWarn("GameBoard bit array length != expected tileCount"); debugLog(object);
        throw new Error("failedToParseGame");
    }
    board._allTiles.forEach((tile, index) => {
        tile.isMined = !!(bits.getValue(index));
    });
    board.reset();
    return board;
};

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

    static formatChange(change) {
        let data = Object.assign({}, change);
        data.assertMineFlagCount = Game.integerFormatObject(data.assertMineFlagCount);
        data.clearedTileCount = Game.integerFormatObject(data.clearedTileCount);
        data.points = Game.integerFormatObject(data.points);
        return data;
    }
}

class SweepAction {
    get debugDescription() { return `<${this.constructor.name}>`; }
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
    mineTriggered: 2,
    failure: 3
};

class TileBasedAction extends SweepAction {
    constructor(config) {
        super();
        this.tile = config.tile;
    }

    get debugDescription() {
        return `<${this.constructor.name} @${this.tile.debugDescription}>`;
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
        let result = session.attemptRevealTile(tile, this.revealBehavior);
        if (result != SweepAction.Result.noop) {
            session.mostRecentAction = new ActionResult({
                action: this,
                tile: tile,
                description: this.reason ? this.reason : this.actionDescription
            });
        }
        return result;
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
            && !session.hintTile
            && !GameSession.isShowingDialog();
    }

    get debugDescription() {
        return "attemptHint";
    }

    perform(session) {
        if (!this.assertIsValid(session, AttemptHintAction.isValid(session))) { return SweepAction.Result.noop; }

        // Try to find a safe covered tile adjacent to a cleared tile
        let revealed = TileCollection.allTiles(session).applying(new RevealedTilesFilter());
        let candidates = revealed
            .applying(new CollectNeighborsTransform({ transform: collection =>
                collection.applying(new CoveredTilesFilter())
                    .applying(new MineFilter(false))
            }));

        // Fall back: find any safe covered tile
        // TODO how about a filter that only applies if the collection is empty?
        // so you can chain all of this onto the above and make it declarative etc.
        if (candidates.isEmpty) {
            candidates = TileCollection.allTiles(session)
                .applying(new CoveredTilesFilter())
                .applying(new MineFilter(false));
        }

        let tile = null;
        let closest = candidates.tilesClosestTo(session.mostRecentAction.tile);
        let debugTiles = [];
        if (closest.length > 0 && !revealed.isEmpty) {
            // multiple tiles closest to mostRecentAction:
            // prefer ones nearby to the most cleared tiles.
            closest = closest.map(tile => {
                let item = { tile: tile, score: 0 };
                revealed.tiles.forEach(nearby => {
                    item.score += (1 / tile.coord.manhattanDistanceFrom(nearby.coord).magnitude);
                });
                return item;
            });
            let highScore = closest.map(item => item.score).maxElement();
            tile = closest
                .filter(item => item.score >= highScore)
                .map(item => item.tile)
                .randomItem();
        } else {
            tile = closest.randomItem();
        }

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
    }

    get requiresGameStatePlaying() { return false; }
    get debugDescription() { return "<alert>"; }

    perform(session) {
        new AlertDialog({
            title: this.config.title,
            message: this.config.message,
            buttons: [{ title: this.config.button }]
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
        this.tile.setFlag(this.flag, session.history.moveNumber);
        session.mostRecentAction = new ActionResult({
            action: this,
            tile: this.tile,
            description: SetFlagAction.actionDescription(this.tile)
        });
        return SweepAction.Result.ok;
    }
}
SweepAction.SetFlagAction = SetFlagAction;

class FlaggingAction extends PointInputBasedAction {
    get debugDescription() { return `<flagging ${this.point.debugDescription}>` };

    perform(session) {
        let tile = this.assertIsValidWithTile(session);
        if (!tile) { return SweepAction.Result.noop; }
        if (tile.isCovered) {
            return new CycleFlagAction({ point: this.point, tile: tile }).perform(session);
        } else {
            return new FlagAllNeighborsAction({ point: this.point, tile: tile, safe: true }).perform(session);
        }
    }
}

class CycleFlagAction extends PointInputBasedAction {
    get debugDescription() {
        return `<cycleFlag ${this.point.debugDescription}>`;
    }

    perform(session) {
        let tile = this.assertIsValidWithTile(session);
        if (!tile || !tile.isCovered) { return SweepAction.Result.noop; }
        session.beginMove();
        tile.cycleFlag(session.history.moveNumber);
        session.mostRecentAction = new ActionResult({
            action: this,
            tile: this.tile,
            description: SetFlagAction.actionDescription(tile)
        });
        return SweepAction.Result.ok;
    }
}
SweepAction.CycleFlagAction = CycleFlagAction;

class FlagAllNeighborsAction extends PointInputBasedAction {
    get debugDescription() {
        return `<flagAllNeighbors ${this.point.debugDescription}>`;
    }

    perform(session) {
        let tile = this.assertIsValidWithTile(session);
        if (!tile || tile.isCovered || tile.minedNeighborCount < 1) { return SweepAction.Result.noop; }

        let neighbors = new TileCollection([tile])
            .applying(new TileTransform.CollectNeighborsTransform({ transform: collection => 
                collection.applying(new TileTransform.CoveredTilesFilter())
            }));
        if (neighbors.tiles.length != tile.minedNeighborCount) {
            session.warningMessage = Strings.str("warningIncorrectUncoveredTileCount");
            return SweepAction.Result.failure;
        }
        neighbors = neighbors.applying(new TileTransform.FlaggedTilesFilter([TileFlag.none, TileFlag.maybeMine]));
        if (neighbors.isEmpty) {
            session.warningMessage = Strings.str("warningAllNeighborsAlreadyFlagged");
            return SweepAction.Result.failure;
        }

        let toFlag = neighbors.tiles.map(tile => new SetFlagAction({ tile: tile, flag: TileFlag.assertMine }));
        let actionResult = new ActionResult({
            action: toFlag.first,
            tile: tile,
            description: Strings.template("flagAllNeighborsActionTemplate", { length: Game.integerFormatObject(toFlag.length) })
        });
        return session.performActions(toFlag, actionResult);
    }
}

class AttemptSolverStepAction extends SweepAction {
    static isValid(session) {
        if (!session || !session.solver) return false;
        return (session.state == GameState.playing)
            && !GameSession.isShowingDialog();
    }

    get debugDescription() {
        return "<solverStep>"
    }

    perform(session) {
        if (!this.assertIsValid(session, AttemptSolverStepAction.isValid(session))) { return SweepAction.Result.noop; }
        let result = session.solver.tryStep();
        // debugLog(result);
        if (!result || !result.isSuccess) {
            new ShowAlertDialogAction({
                title: Strings.str("errorAlertTitle"),
                message: Strings.str("solverGotStuckMessage"),
                button: Strings.str("errorAlertDismissButton")
            }).perform(session);
            return SweepAction.Result.noop;
        }

        session.debugTiles = result.debugTiles;
        if (result.debugMode) {
            return SweepAction.Result.ok;
        } else {
            return session.performActions(result.actions, result.actionResult);
        }
    }
}
SweepAction.AttemptSolverStepAction = AttemptSolverStepAction;

class MooAction extends TileBasedAction {
    static isValid(session) {
        if (!session || (session.state != GameState.playing) || (session.game.mineCount <= 1)) {
            return false;
        } else {
            return true;
        }
    }

    static action(session) {
        if (!MooAction.isValid(session)) {
            return null;
        }
        let candidates = TileCollection.allTiles(session)
            .applying(new TileTransform.CoveredTilesFilter())
            .applying(new TileTransform.MineFilter(true))
            .applying(new TileTransform.FlaggedTilesFilter([TileFlag.none, TileFlag.maybeMine]));
        // try not to eat flags
        let unflagged = candidates
            .applying(new HasNeighborsFilter({ condition: { range: {min: 0, max: 0} }, transform: collection => {
                return collection.applying(new TileTransform.FlaggedTilesFilter([TileFlag.assertMine]));
            } }));
        let tile = unflagged.randomTileClosestTo(session.mostRecentAction.tile) || candidates.randomTileClosestTo(session.mostRecentAction.tile);
        return tile ? new MooAction({ tile: tile }) : null;
    }

    isValid(session) {
        return MooAction.isValid(session) && this.tile.isCovered && this.tile.isMined && this.tile.flag != TileFlag.assertMine;
    }

    perform(session) {
        if (!this.isValid(session)) { return SweepAction.Result.noop; }
        session.eatMine(this.tile);
        session.mostRecentAction = new ActionResult({
            action: this,
            tile: this.tile,
            description: Strings.str("mooActionDescription")
        });
        return SweepAction.Result.ok;
    }
}
SweepAction.MooAction = MooAction;

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

    get isEmpty() { return this.tiles.length == 0; }

    applying(transform) {
        let applied = this.tiles.flatMap(tile => {
            if (SweepPerfTimer.shared) { SweepPerfTimer.shared.counters.TileCollection++; }
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

    tilesClosestTo(origin) {
        if (!origin || this.tiles.length == 0) {
            return this.tiles;
        }

        let min = -1;
        let items = this.tiles.map(tile => {
            if (SweepPerfTimer.shared) { SweepPerfTimer.shared.counters.TileCollection++; }
            let distance = tile.coord.manhattanDistanceFrom(origin.coord).magnitude;
            min = min < 0 ? distance : Math.min(min, distance);
            return { tile: tile, distance: distance };
        });
        
        return items.filter(item => item.distance == min)
            .map(item => item.tile);
    }

    randomTileClosestTo(origin) {
        return this.tilesClosestTo(origin).randomItem();
    }

    emitDebugTiles() {
        this.appendDebugTiles(this.tiles);
        return this;
    }

    appendDebugTiles(items) {
        if (!this.debugTiles) { this.debugTiles = []; }
        items.forEach(tile => {
            if (SweepPerfTimer.shared) { SweepPerfTimer.shared.counters.TileCollection++; }
            if (!this.debugTiles.contains(tile)) { this.debugTiles.push(tile); }
        });
    }
} // end class TileCollection

class TileTransform {
    static unique(tiles) {
        let applied = [];
        tiles.forEach(tile => {
            if (SweepPerfTimer.shared) { SweepPerfTimer.shared.counters.TileCollection++; }
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
MinedNeighborCountRangeFilter.zero = new MinedNeighborCountRangeFilter({ min: 0, max: 0 });
TileTransform.MinedNeighborCountRangeFilter = MinedNeighborCountRangeFilter;

function mark__Achievement() {} // ~~~ Achievement

class Achievement {
    static initialize() {
        Achievement.allTypes = {
            "Achievement.MostPointsInSingleMove": Achievement.MostPointsInSingleMove,
            "Achievement.HighestScoreInAnyGame": Achievement.HighestScoreInAnyGame
        };
        AchievementStorage.shared = new AchievementStorage.Local();
        let data = AchievementStorage.shared.loadAll();
        this.all = Object.getOwnPropertyNames(Achievement.allTypes).map(id => {
            let constructor = Achievement.allTypes[id];
            let achievement = null;
            try {
                if (data.hasOwnProperty(id)) {
                    achievement = constructor.fromDeserializedWrapper(data[id]);
                }
            } catch(e) {
                debugWarn([`Failed to parse ${constructor.name}: ${e.message}`, data[id]], true);
            }
            return achievement ? achievement : new constructor({ id: id });
        });
    }

    constructor(config) {
        config = Object.assign({
            status: Achievement.Status.none,
            value: null,
            date: Date.now(),
            seen: false
        }, config);

        if (!config.id) {
            throw new Error("Achievement.dzFailure");
        }

        this.id = config.id; // unique id per Achievement instance
        this.status = config.status; // Achievement.Status
        this.value = config.value; // any serializable value the subclass needs
        this.date = config.date; // timestamp, e.g. Date.now()
        this.seen = config.seen; // bool

        debugLog("init: " + this.debugDescription);
        this.target = new DispatchTarget();
        this.target.register(GameSession.moveCompletedEvent, (e, session) => {
            if (this.isValid(session)) { this.moveCompleted(session, Date.now()); }
        });
        this.target.register(GameSession.gameCompletedEvent, (e, session) => {
            if (this.isValid(session)) { this.gameCompleted(session, session.endTime); }
        });
    }

    get debugDescription() {
        let date = this.date ? ` @${new Date(this.date).toISOString()}` : "";
        return `<${this.id} ${this.status} ${this.value}${date}>`;
    }

    // return false to prevent calls to moveCompleted, etc., to simplify those functions
    isValid(session) { return true; }

    moveCompleted(session, date) { }
    gameCompleted(session, date) { }

    achieved(value, date) {
        this.status = Achievement.Status.achieved;
        this.value = value;
        this.date = date;
        debugLog(`achieved: ${this.debugDescription}`);
        this.save();
    }

    save() {
        AchievementStorage.shared.saveAchievement(this);
    }

    get objectForSerialization() {
        return {
            schemaVersion: Game.schemaVersion,
            id: this.id,
            status: this.status,
            value: this.value,
            date: this.date,
            seen: this.seen
        };
    }

    static fromDeserializedWrapper(data) {
        if (!data || data.schemaVersion != Game.schemaVersion) {
            // could have a static tryUpgradeSchema fallback to handle schemaVersion updates
            throw new Error("schemaVersionUnsupported");
        }
        return new this(data);
    }
}
Achievement.Status = {
    none: "none",
    achieved: "achieved"
    // locked, etc.
};

class AchievementStorage {
    // return id -> data
    loadAll() { return {}; }
    saveAchievement(achievement) { }
}
AchievementStorage.shared = null;

AchievementStorage.Local = class extends AchievementStorage {
    loadAll() {
        return GameStorage.shared.achievementsByID;
    }

    saveAchievement(achievement) {
        GameStorage.shared.saveAchievement(achievement);
    }
};

AchievementStorage.InMemory = class extends AchievementStorage {
    constructor() { this.all = {}; }
    loadAll() { return this.all; }
    saveAchievement(achievement) {
        debugLog(achievement.objectForSerialization);
        let item = new SaveStateItem(achievement.id, achievement.id, Date.now(), achievement.objectForSerialization);
        debugLog(item);
        this.all[achievement.id] = achievement.objectForSerialization;
    }
};

Achievement.MostPointsInSingleMove = class MostPointsInSingleMove extends Achievement {
    constructor(config) {
        super(Object.assign({ value: 0 }, config));
    }

    isValid(session) {
        return session.isClean
            && (session.state == GameState.playing)
            && (!!session.mostRecentAction)
            && (!!session.mostRecentAction.change);
    }

    moveCompleted(session, date) {
        let points = session.mostRecentAction.change.points;
        if (points > this.value) {
            this.achieved(points, date);
        }
    }
};

Achievement.HighestScoreInAnyGame = class HighestScoreInAnyGame extends Achievement {
    constructor(config) {
        super(Object.assign({ value: 0 }, config));
    }

    isValid(session) {
        return session.isClean
            && (session.state == GameState.won || session.state == GameState.lost);
    }

    gameCompleted(session, date) {
        let points = session.game.statistics.points;
        if (points > this.value) {
            this.achieved(points, date);
        }
    }
};

function mark__User_Input() {} // ~~~~~~ User Input ~~~~~~

class InputController {
    constructor() {
        GameScriptEngine.shared = new GameScriptEngine();
        this.keyController = new Gaming.KeyInputController();
        this.keyController.addShortcutsFromSettings(Game.content.keyboard);
        // this.keyController.debug = true;

        let gse = GameScriptEngine.shared;
        gse.registerCommand("escapePressed", (subject, evt) => { this.dismissDialog(evt); });
    }

    dismissDialog(evt) {
        let currentDialog = Gaming.GameDialogManager.shared.currentDialog;
        if (currentDialog && !currentDialog.isModal) {
            evt.preventDefault();
            currentDialog.dismiss();
        }
    }
}

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
                this.session.performAction(new FlaggingAction({ point: modelCoord }));
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
            click: () => this.newGame(true)
        });
        this.showNewGameDialogButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("showNewGameDialogButton"),
            click: () => this.showNewGameDialog()
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
        this.toggleRainbowButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("toggleRainbowButton"),
            click: () => this.toggleRainbowMode()
        });
        this.shareButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("shareButton"),
            click: () => this.shareGame()
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

        let gse = GameScriptEngine.shared;
        gse.registerCommand("newGame", prompt => this.newGame(prompt));
        gse.registerCommand("showNewGameDialog", () => this.showNewGameDialog());
        gse.registerCommand("showHelp", () => this.showHelp());
        gse.registerCommand("showHighScores", () => this.showHighScores());
        gse.registerCommand("showAnalysis", () => this.showAnalysis());
        gse.registerCommand("showHint", () => this.showHint());
        gse.registerCommand("solverStep", () => this.solverStep());
        gse.registerCommand("toggleRainbowMode", () => this.toggleRainbowMode());
    }

    render() {
        this.showAnalysisButton.isEnabled = GameAnalysisDialog.isValid(this.session);
        this.showHintButton.isEnabled = AttemptHintAction.isValid(this.session);
        this.solverStepButton.isEnabled = AttemptSolverStepAction.isValid(this.session);
        this.toggleRainbowButton.isSelected = this.session ? this.session.rainbowMode : false;
        if (this.debugModeButton) {
            this.debugModeButton.isSelected = this.session ? this.session.debugMode : false
        }
    }

    newGame(prompt) {
        if (!this.session) { return debugWarn("no session"); }
        if (Gaming.GameDialogManager.shared.currentDialog) {
            let dialog = Gaming.GameDialogManager.shared.currentDialog;
            if (!dialog.isModal) {
                dialog.dismiss();
            } else if (prompt) {
                debugWarn("Can't show prompt");
                return;
            }
        }
        if (prompt && (this.session.state == GameState.playing && this.session.hasMoved)) {
            new AlertDialog({
                title: Strings.str("newGameDialogTitle"),
                message: Strings.str("newGameWhilePlayingPrompt"),
                buttons: [
                    { title: Strings.str("continuePlayingButton") },
                    {
                        title: Strings.str("newGameDialogStartButton"),
                        click: dialog => {
                            dialog.dismiss();
                            this.newGame(false);
                        }
                    }
                ]
            }).show();
        } else {
            GameSession.begin(new Game({ difficulty: this.session.game.difficulty }));
        }
    }

    showNewGameDialog() {
        if (GameSession.isShowingDialog()) { return; }
        new NewGameDialog().show();
    }

    showHelp() {
        if (GameSession.isShowingDialog()) { return; }
        new HelpDialog().show();
    }

    showHighScores() {
        if (GameSession.isShowingDialog()) { return; }
        let difficulty = null;
        if (this.session && this.session.game) {
            difficulty = this.session.game.difficulty;
        }
        HighScoresDialog.showHighScores(GameStorage.shared, difficulty);
    }

    showAnalysis() {
        if (GameSession.isShowingDialog()) { return; }
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

    toggleRainbowMode() {
        if (this.session) { this.session.toggleRainbowMode(); }
    }

    shareGame() {
        if (this.session) {
            new ShareDialog(this.session).show();
        }
    }

    toggleDebugMode() {
        if (this.session) { this.session.toggleDebugMode(); }
    }
}

function mark__User_Interface() {} // ~~~~~~ User Interface ~~~~~~

class ActionDescriptionView {
    constructor(config) {
        this.session = config.session;
        this.elem = config.elem;
    }

    get welcomeMessage() {
        let hour = new Date().getHours();
        if (hour >= 4 && hour < 12) {
            return Strings.str("goodMorning");
        } else if (hour >= 12 && hour < 18) {
            return Strings.str("goodAfternoon");
        } else {
            return Strings.str("goodEvening");
        }
    }

    render() {
        let description = this.session.warningMessage;
        if (!description) {
            description = this.session.mostRecentAction ? this.session.mostRecentAction.description : null;
        }
        if (!description) {
            this.elem.innerText = this.welcomeMessage;
            return;
        }
        let change = this.session.mostRecentAction.change;
        let formatted = ActionResult.formatChange(change);
        let tokens = [];
        if (change && change.clearedTileCount > 0) {
            tokens.push(Strings.template("recentActionClearedTileCountToken", formatted));
        }
        if (change && change.points > 0) {
            tokens.push(Strings.template("recentActionPointsWonToken", formatted));
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
        this.elem.innerText = Strings.template(this.statusTemplate, Game.formatStatistics(this.session.game.statistics));
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
        this.tileViews = [];
        this.canvas = config.boardContainer.querySelector("canvas");
        this.game = config.session.game;
        this.controller = new GameBoardController(this);
    }

    get game() { return this._game; }
    set game(newGame) {
        this._game = newGame;
        this.configure();
    }

    getScreenRect(tile) {
        let view = this.tileViews.find(item => item.model == tile);
        return view ? this.tilePlane.screenRectForModelTile(view.model.coord) : null;
    }

    getContext() {
        return this.canvas.getContext("2d");
    }

    configure() {
        // iteration 1. point input controller doubles things wrong though
        // tileplane size == raw device pixel size (240)
        // canvas.width/height == raw device pixel size (240)
        // canvas style width/height == point size (120)    -- so divide by pixelSc
        //
        // iteration 2
        // tilePlane size = raw device pixel size (240)
        // canvas style width/height = 240
        // canvas.width/height == 240
        this.pixelScale = HTMLCanvasElement.getDevicePixelScale();
        const tileDeviceWidth = GameBoardView.metrics.tileWidth * this.pixelScale;
        this.tilePlane = new TilePlane(this.game.difficulty, tileDeviceWidth);
        this.tilePlane.viewportSize = { width: this.tilePlane.size.width * tileDeviceWidth, height: this.tilePlane.size.height * tileDeviceWidth };

        this.canvas.style.width = `${this.tilePlane.size.width * GameBoardView.metrics.tileWidth}px`;
        this.canvas.style.height = `${this.tilePlane.size.height * GameBoardView.metrics.tileWidth}px`;
        const canvasDeviceSize = this.tilePlane.viewportSize;
        this.canvas.width = canvasDeviceSize.width;
        this.canvas.height = canvasDeviceSize.height;

        this.tileViews.forEach(view => view.remove());
        this.tileViews = [];
        this.game.board.visitTiles(null, (tile) => {
            this.tileViews.push(new GameTileView(tile, this));
        });
    }

    render() {
        let ctx = this.getContext();
        let context = {
            ctx: ctx,
            pixelScale: this.pixelScale,
            tilePlane: this.tilePlane,
            session: this.session,
            showAllMines: (this.session.state != GameState.playing),
            rainbow: null
        };

        if (this.session.rainbowMode && !this.session.history.isEmpty) {
            context.rainbow = {
                moves: { min: 0, max: this.session.history.serializedMoves.length },
                hue: Object.assign({}, GameBoardView.metrics.rainbow.hue),
                cleared: Object.assign({}, GameBoardView.metrics.rainbow.cleared),
                flagged: Object.assign({}, GameBoardView.metrics.rainbow.flagged)
            };
            // Limit the amount of color change per move early in the game
            let colors = Math.abs(context.rainbow.hue.max - context.rainbow.hue.min);
            let interval = colors / this.session.history.serializedMoves.length;
            if ((context.rainbow.hue.maxInterval > 0) && (interval > context.rainbow.hue.maxInterval)) {
                context.rainbow.hue.max = context.rainbow.hue.maxInterval * this.session.history.serializedMoves.length;
            }
        }
        ctx.rectClear(this.tilePlane.viewportScreenBounds);

        let hintTile = null;
        this.tileViews.forEach(tile => {
            if (this.session.hintTile == tile.model) {
                hintTile = tile;
            }
            tile.render(context);
        });

        // Render hintTile last for z-order purposes
        if (hintTile) {
            hintTile.renderHintTile(context);
        }
    }
}
// end class GameBoardView

class GameTileView {
    static initialize(config) {
        GameTileView.config = config;
    }

    constructor(model, boardView) {
        this.model = model; // GameTile
        this.boardView = boardView; // GameBoardView
    }

    remove() {
        this.model = null;
        this.boardView = null;
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

        if (Game.rules().allowDebugMode && context.session.debugTiles && context.session.debugTiles.contains(this.model)) {
            this.renderContent(context, rect, GameTileViewState.debug);
        }
    }

    renderHintTile(context) {
        const rect = context.tilePlane.screenRectForModelTile(this.model.coord);
        this.renderContent(context, rect, GameTileViewState.hintTile);
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
        GameTileViewState.safe = new GameTileViewState(Object.assign({}, config.safe, { glyph: tile => `${tile.minedNeighborCount}` }));
        GameTileViewState.mineTriggered = new GameTileViewState(config.mineTriggered);
        GameTileViewState.mineRevealed = new GameTileViewState(config.mineRevealed);
        GameTileViewState.incorrectFlag = new GameTileViewState(config.incorrectFlag);
        GameTileViewState.hintTile = new GameTileViewState(config.hintTile);
        GameTileViewState.debug = new GameTileViewState(config.debug);
    }

    constructor(config) {
        this.fillColor = config.fillColor;
        this.strokeStyle = config.strokeStyle;
        this.borderStrokeWidth = config.borderStrokeWidth;
        if (typeof(config.glyph) === 'function') {
            this.glyph = config.glyph;
        } else {
            this.glyph = tile => config.glyph;
        }
        this.textColor = config.textColor;
        this.numberTextColors = config.numberTextColors;
        this.showsRainbow = !!config.showsRainbow;
        this.showsRainbowGlyph = !!config.showsRainbowGlyph;
    }

    render(context, rect, tile) {
        let fillColor = null;
        if (!!context.rainbow && this.showsRainbow && tile.rainbow.cleared >= 0) {
            let hue = Math.scaleValueLinear(tile.rainbow.cleared, context.rainbow.moves, context.rainbow.hue) % 360;
            let color = `hsl(${hue},${context.rainbow.cleared.saturation},${context.rainbow.cleared.lightness})`;
            fillColor = color;
        } else {
            fillColor = this.fillColor;
        }
        if (fillColor) {
            context.ctx.fillStyle = fillColor;
            context.ctx.rectFill(rect);
        }

        if (this.borderStrokeWidth > 0) {
            context.ctx.lineJoin = "round";
            context.ctx.strokeStyle = this.strokeStyle;
            context.ctx.lineWidth = this.borderStrokeWidth * context.pixelScale;
            context.ctx.rectStroke(rect);
        }
        
        let textValue = this.glyph(tile);
        if (textValue) {
            if (this.numberTextColors && tile.minedNeighborCount > 0) {
                context.ctx.fillStyle = this.numberTextColors[tile.minedNeighborCount];
            } else if (!!context.rainbow && this.showsRainbowGlyph && tile.rainbow.flagged >= 0) {
                let hue = Math.scaleValueLinear(tile.rainbow.flagged, context.rainbow.moves, context.rainbow.hue) % 360;
                let color = `hsl(${hue},${context.rainbow.flagged.saturation},${context.rainbow.flagged.lightness})`;
                context.ctx.fillStyle = color;
            } else {
                context.ctx.fillStyle = this.textColor;
            }
            context.ctx.fillTextCentered(textValue, rect);
        }
    }
}
// end class GameTileViewState

class Moo {
    static initialize(config) {
        Moo.config = config;
        Moo.state = {
            ready: "ready",
            m: "m",
            c: "c",
            mo: "mo",
            co: "co",
            moo: "moo",
            preparing: "preparing",
            performing: "performing",
            finishing: "finising"
        };
        Moo.transitions = {
            ready: { "m": Moo.state.m, "c": Moo.state.c },
            m: { "o": Moo.state.mo, "m": Moo.state.m, "c": Moo.state.c },
            mo: { "o": Moo.state.moo, "m": Moo.state.m, "c": Moo.state.c },
            c: { "o": Moo.state.co, "m": Moo.state.m, "c": Moo.state.c },
            co: { "w": Moo.state.moo, "m": Moo.state.m, "c": Moo.state.c }
        };
    }

    constructor(config) {
        this.session = config.session
        this.elem = config.elem;
        this.boardView = config.boardView;
        this.state = Moo.state.ready;
        this.debug = false;
        config.inputController.keyController.addDelegate(this);
        GameScriptEngine.shared.registerCommand("moo", value => this.advance(value));
    }

    get debugDescription() {
        return `<moo@${this.state}>`;
    }

    beginMove() {
        this.advance("beginMove");
    }

    // private

    keyStateDidChange() { }

    keyStateShortcutsCompleted(controller, data) {
        if (!data.fired || (data.fired.id != "moo")) {
            this.advance("invalidated");
        }
    }

    advance(value) {
        if (this.debug) { debugLog(`${this.debugDescription} advance ${value}`); }
        let transitions = Moo.transitions[this.state];
        if (!transitions) {
            // ignore input while preparing/finishing
            return this;
        }
        let state = transitions[value] || Moo.state.ready;
        return (state == Moo.state.moo) ? this.prepare() : this.readyState(state);
    }

    readyState(value) {
        if (this.debug) { debugLog(`${this.debugDescription} readyState ${value}`); }
        this.action = null;
        this.elem.style.top = "";
        this.elem.style.left = "";
        this.elem.querySelector(".m").innerText = Moo.config.thoughts.randomItem();
        this.elem.querySelector(".mo").innerText = Moo.config.thoughts.randomItem();
        return this.setState(value);
    }

    prepare() {
        this.action = MooAction.action(this.session);
        let rect = this.action ? this.boardView.getScreenRect(this.action.tile) : null;
        if (!rect) { return this.readyState(Moo.state.ready); }

        let center = rect.center;
        center = new Point(center.x / this.boardView.pixelScale, center.y / this.boardView.pixelScale)
            .adding(new Point(this.boardView.canvas.getBoundingClientRect())).integral();

        if (this.debug) { debugLog(`${this.debugDescription} prepare ${this.action.tile.debugDescription} => ${center.debugDescription}`); }
        this.setState(Moo.state.preparing);
        this.elem.style.top = `${center.y}px`;
        this.elem.style.left = `${center.x - 0.5 * this.elem.clientWidth}px`;
        this.configureBombs(null, center, 0);
        this.animate(Moo.config.duration, () => this.perform(center));
        return this;
    }

    perform(center) {
        if (!this.action.isValid(this.session)) {
            debugWarn(`${this.debugDescription} action not valid ${this.action.debugDescription}`);
            return this.finish();
        }
        if (this.debug) { debugLog(`${this.debugDescription} perform ${this.action.tile.debugDescription}`); }
        this.configureBombs("preparing", center, 0);
        this.setState(Moo.state.performing);
        this.session.performAction(this.action);
        return this.animate(25, () => this.finish(center));
    }

    finish(center) {
        if (this.debug) { debugLog(`${this.debugDescription} finish`); }
        this.setState(Moo.state.finishing);
        this.elem.style.top = "";
        this.elem.style.left = "";
        this.animate(25, () => {
            this.configureBombs("performing", center, Moo.config.mines.spread);
            this.animate(Moo.config.mines.duration, () => this.configureBombs(null, null));
        });
        return this.animate(Moo.config.duration, () => this.readyState(Moo.state.ready));
    }

    classNameForState(state) {
        switch (state) {
            case Moo.state.c: return "m";
            case Moo.state.co: return "mo";
            default: return state;
        }
    }

    setState(value) {
        this.state = value;
        this.elem.className = this.classNameForState(value);
        return this;
    }

    setClassName(value) {
        this.elem.className = this.classNameForState(value);
        return this;
    }

    animate(interval, block) {
        setTimeout(block, interval);
        return this;
    }

    configureBombs(state, center, offset) {
        if (this.debug) { debugLog([state, center, offset]); }
        document.querySelectorAll(".moo-mine").forEach((item, index) => {
            item.addRemClass("preparing", state == "preparing");
            item.addRemClass("performing", state == "performing");
            if (center) {
                let end = Gaming.Vector.unitsByDirection[index].scaled(offset);
                item.style.top = `${center.y + end.y}px`;
                item.style.left = `${center.x + end.x}px`;
            } else {
                item.style.top = "";
                item.style.left = "";
            }
        });
        return this;
    }
} // end class Moo

function mark__Dialogs() {} // ~~~~~~ Dialogs ~~~~~~

class NewGameDialog extends GameDialog {
    constructor() {
        super({ rootElemClass: "newGame" });
        this.startButton = new ToolButton({
            title: Strings.str("newGameDialogStartButton"),
            click: () => this.validateAndStart()
        });
        this.contentElem = GameDialog.createContentElem();
        var formElem = GameDialog.createFormElem();

        this.difficultyRules = Game.rules().difficulties.map(item => {
            return Object.assign({}, item, {
                import: false
            });
        });
        let defaultDifficultyIndex = GameStorage.shared.lastDifficultyIndex;
        let customDifficultyIndex = this.difficultyRules.findIndex(item => !!item.isCustom);
        if (!(defaultDifficultyIndex >= 0)) {
            defaultDifficultyIndex = this.difficultyRules.findIndex(difficulty => !!difficulty.isDefault);
        }
        this.difficultyRules.push({
            import: true,
            index: this.difficultyRules.length,
            name: Strings.str("gameDifficultyImport"),
            width: 1, height: 1, mineCount: 1, isCustom: false
        });
        this.difficulties = new Gaming.FormValueView.SingleChoiceInputCollection({
            id: "difficulty",
            parent: formElem,
            title: "",
            validationRules: [Gaming.FormValueView.SingleChoiceInputCollection.selectionRequiredRule],
            choices: this.difficultyRules.map(difficulty => { return {
                title: Strings.template("difficultyChoiceLabelTemplate", difficulty),
                value: difficulty.index,
                selected: difficulty.index == defaultDifficultyIndex
            }; })
        });
        this.difficulties.kvo.value.addObserver(this, () => {
            this.difficultyChanged();
        });

        let lastCustomDifficultyConfig = GameStorage.shared.lastCustomDifficultyConfig || this.difficultyRules.find(difficulty => difficulty.isCustom);
        let customDifficulty = Game.rules().customDifficulty;

        let validationRules = {
            width: InputView.makeNumericRangeRule(customDifficulty.width),
            height: InputView.makeNumericRangeRule(customDifficulty.height)
        };
        this.customWidthInput = new TextInputView({
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
            title: Strings.template("newGameMineCountInputLabelTemplate", this.validMineCountRange),
            placeholder: Strings.str("newGameMineCountPlaceholder"),
            transform: InputView.integerTransform,
            validationRules: [(input) => this.validateMineCount(input)]
        }).configure(input => input.value = lastCustomDifficultyConfig.mineCount);
        this.customInputs = [this.customWidthInput, this.customHeightInput, this.customMineCountInput];

        let next = this.difficulties.choices[customDifficultyIndex + 1].elem;
        this.customInputs.forEach(input => {
            next.insertAdjacentElement("beforebegin", input.elem);
        });

        let config = {
            parent: formElem,
            title: Strings.str("importCodeTitle"),
            placeholder: Strings.str("importCodePlaceholder"),
            validationRules: [input => this.validateImportCode(input)]
        };
        this.importCodeInput = new TextInputView(config, TextInputView.createTextAreaElement(config));
        this.importCodeResultLabel = document.createElement("label")
            .addRemClass("result", true).addRemClass("hidden", true);
        formElem.append(this.importCodeResultLabel);

        this.difficultyLabel = document.createElement("label");

        this.contentElem.append(formElem);
        this.nonCustomInputs = [this.difficulties, this.importCodeInput];
        this.allInputs = [this.difficulties, this.customWidthInput, this.customHeightInput, this.customMineCountInput, this.importCodeInput];
        this.difficultyChanged();
    }

    show() {
        super.show();
        this.dismissButton.elem.addRemClass("hidden", !this.isDismissable);
    }

    get isDismissable() {
        return !!Sweep.session;
    }

    get isModal() { return !this.isDismissable; }

    get title() { return Strings.str("newGameDialogTitle"); }

    get dialogButtons() {
        return [this.difficultyLabel, this.startButton.elem];
    }

    get isValid() {
        if (this.showCustomControls) {
            return this.allInputs.every(input => input.isValid);
        } else {
            return this.nonCustomInputs.every(input => input.isValid);
        }
    }

    get difficulty() {
        let difficulty = this.difficultyRules[this.difficulties.value];
        if (difficulty.isCustom) {
            return Object.assign({}, difficulty, {
                width: this.customWidthInput.value,
                height: this.customHeightInput.value,
                mineCount: this.customMineCountInput.value
            });
        }
        if (difficulty.import && !!this.game) {
            return Object.assign({}, difficulty, {
                width: this.game.board.size.width,
                height: this.game.board.size.height,
                mineCount: this.game.board.mineCount
            });
        }
        return difficulty;
    }

    get showCustomControls() {
        return !!this.difficulty.isCustom;
    }

    get showImportControls() {
        return !!this.difficulty.import;
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
        this.updateStarCount();
        return validation(input);
    }

    validateImportCode(input) {
        let isValid = true;
        let value = Sharing.cleanBase64(input.value);
        if (!this.showImportControls || value.length == 0) {
            this.game = null;
            this.setImportCodeResult(null, false);
        } else {
            try {
                let object = JSON.parse(atob(value));
                this.game = Sharing.gameFromBoardObject(object);
                this.setImportCodeResult(Strings.str("importCodeValidMessage"), false);
            } catch(e) {
                debugWarn(`import error: ${e.message}`, true);
                isValid = false;
                this.game = null;
                this.setImportCodeResult(Strings.str(e.message, Strings.str("failedToParseGame")), true);
            }
        }
        this.updateStarCount();
        return isValid;
    }

    setImportCodeResult(value, invalid) {
        this.importCodeResultLabel.innerText = value || "";
        this.importCodeResultLabel.addRemClass("invalid", !!invalid);
    }

    difficultyChanged() {
        let showCustomControls = this.showCustomControls;
        let showImportControls = this.showImportControls;
        [this.customWidthInput, this.customHeightInput, this.customMineCountInput].forEach(input => {
            input.elem.addRemClass("hidden", !showCustomControls);
        });
        [this.importCodeInput.elem, this.importCodeResultLabel].forEach(elem => {
            elem.addRemClass("hidden", !showImportControls);
        });
        if (showImportControls) {
            this.importCodeInput.valueElem.select();
        } else if (showCustomControls) {
            this.customWidthInput.valueElem.select();
        }
        this.importCodeInput.value = "";
        this.setImportCodeResult(null, false);
        this.updateStarCount();
        return true;
    }

    updateStarCount() {
        if (this.showImportControls && !this.game) {
            this.difficultyLabel.innerText = "";
        } else {
            let difficulty = this.difficulty;
            let starCount = Game.starCount({ mineCount: difficulty.mineCount, totalTileCount: difficulty.width * difficulty.height });
            this.difficultyLabel.innerText = Game.formatStars(starCount);
        }
    }

    validateAndStart() {
        if (!this.isValid) {
            return;
        }
        this.dismiss();
        if (this.showImportControls) {
            GameSession.begin(this.game);
        } else {
            GameSession.begin(new Game({ difficulty: this.difficulty }));
        }
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
        super(Object.assign(config, { rootElemClass: `prompt buttons-${config.buttons.length}` }));
        this.title = config.title;
        this.contentElem = GameDialog.createContentElem();
        // buttons: [{ title: "", block: dialog => {} }]
        // if block non-null, should call dialog.dismiss() if needed
        this.buttons = config.buttons.map(item => {
            let button = new ToolButton({
                title: item.title,
                click: () => this.clicked(item.click)
            });
            return button.elem;
        });
        let message = document.createElement("p").addRemClass("message", true);
        message.innerText = config.message;
        this.contentElem.append(message);
    }

    get isModal() { return false; }
    get dialogButtons() { return this.buttons; }

    show() {
        let currentDialog = Gaming.GameDialogManager.shared.currentDialog;
        if (currentDialog && !currentDialog.isModal) {
            currentDialog.dismiss();
        }
        super.show();
    }

    clicked(block) {
        if (typeof(block) == 'function') {
            block(this);
        } else {
            this.dismiss();
        }
    }
}

class ShareDialog extends GameDialog {
    constructor(session) {
        super();
        this.contentElem = GameDialog.createContentElem();
        let elem = document.querySelector("body > shareGame")
            .cloneNode(true).addRemClass("hidden", false);
        elem.querySelector("p").innerText = Strings.str("shareDialogInstructions");
        
        let data = Sharing.gameBoardObject(session);
        let stats = Object.assign({}, Game.formatStatistics(session.game.statistics), {
            data: JSON.prettyStringify(data, 64, session.debugMode),
            maxStarCount: Game.rules().maxStarCount
        });
        elem.querySelector("pre").innerText = Strings.template("shareGameBoardCodeTemplate", stats);

        this.contentElem.append(elem);
        this.x = new ToolButton({
            title: Strings.str("shareDialogDismiss"),
            click: () => this.dismiss()
        });
    }

    get isModal() { return false; }
    get title() { return Strings.str("shareDialogTitle"); }

    get dialogButtons() {
        return [this.x.elem];
    }
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
        textElem.innerText = Strings.template(template, Game.formatStatistics(this.session.game.statistics));
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

    get isModal() { return this.isEnabled; }
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
        Game.content.keyboard.keyPressShortcuts.forEach(item => {
            if (item.length < 4) { return; }
            let config = Strings.str(item[item.length - 1]);
            if (!config) { return; }
            config = config.split("|");
            if (config.length == 1) {
                config.push("???");
            }
            this.appendShortcut(elem, config[0], config[1]);
        });
        elem.querySelector(".shortcuts li:last-child").title = "%> moo ⏎";
        this.contentElem.append(elem);

        this.gameVersionLabel = document.createElement("label");
        this.gameVersionLabel.innerText = Strings.template("gameVersionLabelTemplate", { appVersion: Game.appVersion });

        this.x = new ToolButton({
            title: Strings.str("helpDismiss"),
            click: () => this.dismiss()
        });
    }

    appendShortcut(elem, code, description) {
        let content = document.createElement("li");
        let child = document.createElement("kbd");
        child.innerText = code;
        content.append(child);
        child = document.createElement("span");
        child.innerText = description;
        content.append(child);
        elem.querySelector(".shortcuts").append(content);
    }

    show() {
        super.show();
        this.root.id = "help";
        return this;
    }

    // get cssID() { return "help"; }
    get isModal() { return false; }
    get title() { return Strings.str("helpDialogTitle"); }
    get dialogButtons() { return [this.gameVersionLabel, this.x.elem]; }
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
            title: Strings.str("analysisViewDismiss"),
            click: () => this.dismiss()
        });

        this.buildChartView(elem);
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

        this.chartView = new ChartView({
            canvas: elem.querySelector(".history-chart canvas"),
            title: Strings.str("analysisViewChartTitle"),
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
                item.querySelector("stars").innerText = Game.formatStars(Game.starCount(highScore));
                highScores.append(item);
            });
            return highScores;
        }
    }

    get isModal() { return false; }
    get title() { return Strings.str("highScoresDialogTitle"); }
    get dialogButtons() { return [this.x.elem]; }
} // end class HighScoresDialog

class SweepPerfTimer extends Gaming.PerfTimer {
    static startShared(name) {
        SweepPerfTimer.shared = new SweepPerfTimer(name).start();
    }
    static endShared() {
        if (!SweepPerfTimer.shared) { return; }
        SweepPerfTimer.shared.end();
        // SweepPerfTimer.shared.counters = Object.assign(SweepPerfTimer.shared.counters, SweepPerfTimer.shared.summaryInfo);
        Gaming.debugInfo(SweepPerfTimer.shared.summary);
        Gaming.debugInfo(SweepPerfTimer.shared.counters);
        SweepPerfTimer.shared = null;
    }

    constructor(name) {
        super(name);
        this.counters = {
            visitTiles: 0,
            visitNeighbors: 0,
            TileCollection: 0
        };
    }
}
SweepPerfTimer.shared = null;

var initialize = async function() {
    let content = await GameContent.loadYamlFromLocalFile("sweep-content.yaml", GameContent.cachePolicies.forceOnFirstLoad);
    if (!content) {
        alert(Strings.str("failedToLoadGameMessage"));
        return;
    }

    Strings.initialize(content.strings, content.pluralStrings, navigator.language);
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
