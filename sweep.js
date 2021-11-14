"use-strict";

import { Strings } from './locale.js';
import * as Gaming from './g.js';
import { GameContent, GameScriptEngine } from './game-content.js';
import * as SweepSolver from './sweep-solver.js';
import { ChartDataSeries, ChartDataSeriesPresentation, ChartAxisPresentation, ChartView } from './charts.js';

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions;

const Dispatch = Gaming.Dispatch;
const DispatchTarget = Gaming.DispatchTarget;
const FlexCanvasGrid = Gaming.FlexCanvasGrid;
const GameDialog = Gaming.GameDialog;
const InputView = Gaming.FormValueView.InputView;
const Point = Gaming.Point;
const Rect = Gaming.Rect;
const SaveStateItem = Gaming.SaveStateItem;
const SaveStateCollection = Gaming.SaveStateCollection;
const TextInputView = Gaming.FormValueView.TextInputView;
const TilePlane = Gaming.TilePlane;
const ToolButton = Gaming.ToolButton;

function mark__Game_Model() {} // ~~~~~~ Game Model ~~~~~~

export class TileFlag {
    constructor(value, present) {
        this.value = value;
        this.isPresent = present;
    }
    
    isEqual(other) {
        return this.value == other.value;
    }

    get objectForSerialization() {
        return this.value;
    }

    get debugDescription() {
        if (self == TileFlag.assertMine) return "!";
        if (self == TileFlag.maybeMine) return "?";
        return "o";
    }
}
TileFlag.none = new TileFlag(0, false);
TileFlag.assertMine = new TileFlag(1, true);
TileFlag.maybeMine = new TileFlag(2, true);
TileFlag.none.next = TileFlag.assertMine;
TileFlag.assertMine.next = TileFlag.maybeMine;
TileFlag.maybeMine.next = TileFlag.none;
TileFlag.sz = [TileFlag.none, TileFlag.assertMine, TileFlag.maybeMine];

export class GameTile {
    constructor(coord, board) {
        this.coord = coord;
        this.board = board;
        this._mined = false;
        this._minedNeighborCount = 0;
        this._covered = true;
        this._flag = TileFlag.none;
        this.rainbow = { cleared: -1, flagged: -1 };
    }
    
    get coordForSerialization() {
        return { x: this.coord.x, y: this.coord.y };
    }

    get objectForSerialization() {
        // easy game: about 8.5 KB for entire board
        return {
            coord: this.coordForSerialization,
            isMined: this.isMined,
            minedNeighborCount: this.minedNeighborCount,
            isCovered: this.isCovered,
            flag: this.flag.objectForSerialization
        };
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

        // easy game: about 243 bytes for entire board
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
        if (this._flag.isEqual(value)) { return this; }
        this._flag = value;
        if (this._flag.isPresent) {
            this.rainbow.flagged = moveNumber;
            this.board.gameState.usedAnyFlags = true;
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

export class GameBoard {
    constructor(config) {
        this.size = { width: config.size.width, height: config.size.height };
        this.mineCount = config.mineCount;
        this.gameState = config.hasOwnProperty("gameState") ? config.gameState : {}; // arbitrary serializable metadata
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
        // debugLog(Game.debugSummary(this));
    }
} // end class GameBoard

export class Game {
    static initialize(content) {
        if (content.rules && content.rules.difficulties) {
            GameContent.addIndexToItemsInArray(content.rules.difficulties);
            content.rules.difficulties.forEach( difficulty => { difficulty.name = Strings.str(difficulty.name); });
        }
        if (content.solver) {
            GameContent.addIdToItemsInDictionary(content.solver.solvers);
            Object.getOwnPropertyNames(content.solver.solvers).forEach(id => {
                let item = content.solver.solvers[id];
                item.name = Strings.str(item.name);
            });
        }
        Game.content = content;
        Game.content.rules.allowDebugMode = Game.content.rules.allowDebugMode || (self.location ? (self.location.hostname == "localhost") : false);
        Game.content.rules.maxStarCount = Game.content.rules.highScoreThresholds.length + 1;
        GameScriptEngine.shared = new GameScriptEngine();
        Achievement.initialize(content);
        GameScriptEngine.shared.registerCommand("getGameMetadata", UI.getGameMetadata);
        
        UI.prepareStaticContent();
        GameBoardView.initialize(content.gameBoardView);
        GameTileView.initialize(content.gameTileView);
        GameTileViewState.initialize(content.gameTileViewState);
        HelpDialog.initialize();
        GameAnalysisDialog.initialize(content.analysisView);
        SweepStory.initialize(content.storiesView);
        Moo.initialize(content.moo);
        SweepSolver.initialize(content);
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
    
    static getDifficulty(index) {
        return Game.rules().difficulties[index];
    }
    
    static makeCustomDifficulty(size, mineCount) {
        let base = Game.rules().difficulties.find(item => item.isCustom);
        return Object.assign({}, base, {
            width: size.width,
            height: size.height,
            mineCount: mineCount
        });
    }

    constructor(config) {
        this.id = config.id ? config.id : Gaming.Rng.shared.nextHexString(16);
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
        let stats = {
            difficulty: this.difficulty,
            mineCount: this.mineCount,
            totalTileCount: this.board.size.width * this.board.size.height,
            assertMineFlagCount: 0,
            clearedTileCount: 0,
            progress: 0,
            progressPercent: 0,
            points: 0,
            starCount: undefined,
            stars: undefined,
        };
        this.board.visitTiles(null, tile => {
            if (tile.flag.isEqual(TileFlag.assertMine)) { stats.assertMineFlagCount += 1; }
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
Game.appVersion = "0.0.0";

let GameState = {
    playing: 0,
    lost: 1,
    won: 2
};

let MoveState = {
    ready: 0,
    pending: 1,
    active: 2
};


export class StatsHistory {
    constructor(a) {
        this.storage = a.storage; // GameStorage
    }
    
    /// GameSession should call this at the end of every game, immediately before posting gameCompletedEvent,
    /// so that event listeners can access the latest statistics.
    gameCompleted(session) {
        if (!InteractiveSessionView.isMain(session)) { return; }
        let summary = this.summary;
        if (summary.addCompletedGame(session)) {
            this.storage.statsHistorySummary = summary;
        }
    }
    
    get summary() {
        try {
            return StatsHistory.Summary.fromDeserializedWrapper(this.storage.statsHistorySummary);
        } catch (e) {
            debugWarn(`Failed to deserialize saved StatsHistory.Summary: ${e}`);
            return new StatsHistory.Summary(null);
        }
    }
}
StatsHistory.Summary = class StatsHistorySummary {
    constructor(data) {
        if (!data) {
            this.totalMoveCountAllGames = 0;
            this.totalPointsAllGames = 0;
            this.totalTilesClearedAllGames = 0;
            this.totalActiveTimeElapsed = 0;
            this.totalGamesWon = 0;
            this.totalMinesWon = 0;
            this.totalStarsWon = 0;
            this.totalPointsWon = 0;
            this.totalGamesLost = 0;
        } else {
            Gaming.deserializeAssertProperties(data, [
                "schemaVersion",
                "totalMoveCountAllGames",
                "totalPointsAllGames",
                "totalTilesClearedAllGames",
                "totalActiveTimeElapsed",
                "totalGamesWon",
                "totalMinesWon",
                "totalStarsWon",
                "totalPointsWon",
                "totalGamesLost"
            ]);
            if (data.schemaVersion != Game.schemaVersion) {
                throw new Error("schemaVersionUnsupported");
            }
            this.totalMoveCountAllGames = data.totalMoveCountAllGames;
            this.totalPointsAllGames = data.totalPointsAllGames;
            this.totalTilesClearedAllGames = data.totalTilesClearedAllGames;
            this.totalActiveTimeElapsed = data.totalActiveTimeElapsed;
            this.totalGamesWon = data.totalGamesWon;
            this.totalMinesWon = data.totalMinesWon;
            this.totalStarsWon = data.totalStarsWon;
            this.totalPointsWon = data.totalPointsWon;
            this.totalGamesLost = data.totalGamesLost;
        }
    }
    
    get objectForSerialization() {
        return {
            date: Date.now(),
            schemaVersion: Game.schemaVersion,
            totalMoveCountAllGames: this.totalMoveCountAllGames,
            totalPointsAllGames: this.totalPointsAllGames,
            totalTilesClearedAllGames: this.totalTilesClearedAllGames,
            totalActiveTimeElapsed: this.totalActiveTimeElapsed,
            totalGamesWon: this.totalGamesWon,
            totalMinesWon: this.totalMinesWon,
            totalStarsWon: this.totalStarsWon,
            totalPointsWon: this.totalPointsWon,
            totalGamesLost: this.totalGamesLost
        };
    }
    
    static fromDeserializedWrapper(data) {
        return new this(data);
    }
    
    get debugDescription() {
        return `<StatsHistorySummary ${JSON.stringify(this.objectForSerialization)}>`;
    }
    
    /// Returns true if the game session was valid and its stats were collected.
    addCompletedGame(session) {
        // TODO verify that game ID doesn't show up in the recents list
        if (!session.isClean) { return false; }
        if (!(session.state == GameState.won || session.state == GameState.lost)) {
            return false;
        }
        
        let stats = session.game.statistics;
        this.totalMoveCountAllGames += session.history.serializedMoves.length;
        this.totalPointsAllGames += stats.points;
        this.totalTilesClearedAllGames += stats.clearedTileCount;
        this.totalActiveTimeElapsed += stats.activeTimeElapsed;
        if (session.state == GameState.won) {
            this.totalGamesWon += 1;
            this.totalMinesWon += stats.mineCount;
            this.totalStarsWon += stats.starCount;
            this.totalPointsWon += stats.points;
        }
        if (session.state == GameState.lost) {
            this.totalGamesLost += 1;
        }
        return true;
    }
}

export class GameStorage {
    constructor() {
        this.preferencesCollection = new SaveStateCollection(window.localStorage, "SweepSettings");
        this.highScoresCollection = new SaveStateCollection(window.localStorage, "SweepHighScores");
        this.statsHistoryCollection = new SaveStateCollection(window.localStorage, "SweepStatsHistory");
        this.achievementsCollection = new SaveStateCollection(window.localStorage, "SweepAchievements");
    }

    addHighScore(session, playerName) {
        const stats = session.game.statistics;
        const highScore = {
            gameID: session.game.id,
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
    
    hasHighScoreForGame(id) {
        let highScores = this.highScoresByDifficulty.difficulties.flatMap(difficulty => difficulty.highScores);
        let found = highScores.find(item => (id == item.gameID));
        return !!found;
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
    
    get statsHistorySummary() {
        let item = this.statsHistoryCollection.getItem(this.statsHistoryCollection.namespace);
        return item?.data;
    }
    
    set statsHistorySummary(summary) {
        let item = new SaveStateItem(this.statsHistoryCollection.namespace, summary.constructor.name, summary.date, summary.objectForSerialization);
        this.statsHistoryCollection.saveItem(item);
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
    
    get autosaveGame() {
        let item = this.preferencesCollection.getItem(this.preferencesCollection.namespace);
        return item ? item.data.autosave : null;
    }
    set autosaveGame(value) {
        this.setPreference("autosave", value);
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
    
    get storiesVisible() {
        let item = this.preferencesCollection.getItem(this.preferencesCollection.namespace);
        if (!item) { return false; }
        return item.data.hasOwnProperty("storiesVisible") ? item.data.storiesVisible : false;
    }
    set storiesVisible(value) {
        this.setPreference("storiesVisible", value);
    }
    
    get orderedSolvers() {
        let item = this.preferencesCollection.getItem(this.preferencesCollection.namespace);
        return item?.data.orderedSolvers;
    }
    set orderedSolvers(value) {
        this.setPreference("orderedSolvers", value);
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
    
    objectForAutosave() {
        return {
            moveNumber: this.moveNumber,
            serializedMoves: this.serializedMoves,
            lastMoveNumber: this.lastMove ? this.lastMove.moveNumber : null
        };
    }
    
    static fromAutosave(data) {
        Gaming.deserializeAssert(Number.isInteger(data.moveNumber));
        Gaming.deserializeAssert(Array.isArray(data.serializedMoves));
        let history = new GameHistory();
        history.moveNumber = data.moveNumber;
        history.serializedMoves = data.serializedMoves;
        if (Number.isInteger(data.lastMoveNumber)) {
            history.visitHistory(move => {
                if (move.moveNumber == data.lastMoveNumber) {
                    history.lastMove = move;
                }
            });
        }
        return history;
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

export class GameSession {
    static quit(prompt) {
        if (!prompt || confirm(Strings.str("quitGameConfirmPrompt"))) {
            window.location = "index.html";
        }
    }

    constructor(config) {
        this.game = config.game;
        this.state = GameState.playing;
        this.moveState = MoveState.ready;
        this.startTime = Date.now();
        this.endTime = null;
        this.debugMode = false;
        this.rainbowMode = GameStorage.shared.rainbowMode;
        this.history = new GameHistory();
        this.statsHistory = new StatsHistory({ storage: GameStorage.shared });
        this.isClean = !this.debugMode; // false if cheated, etc.
        this.mostRecentAction = new ActionResult();
        this.hintTile = null;
        this.solver = null;
        this.debugTiles = [];
    }

    start(newGame) {
        let oldGame = this.game;
        if (newGame) {
            this.game = newGame;
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
        this.warningMessage = null;
        
        let debug = Game.rules().allowDebugMode && Game.rules().solverDebugMode;
        this.solver?.remove();
        this.solver = new SweepSolver.SolverAgent({ session: this, debugMode: debug, content: Game.content });

        this.recordGameState();
        this.forEachDelegate(d => {
            if (d.gameResumed) { d.gameResumed(this, this.game, oldGame); }
        });
        this.renderViews();
    }
    
    resume() {
        this.moveState = MoveState.ready;
        let debug = Game.rules().allowDebugMode && Game.rules().solverDebugMode;
        this.solver?.remove();
        this.solver = new SweepSolver.SolverAgent({ session: this, debugMode: debug, content: Game.content });
        this.warningMessage = Strings.str("welcomeBack");
        this.forEachDelegate(d => {
            if (d.gameResumed) { d.gameResumed(this, this.game, null); }
        });
        this.renderViews();
    }

    get hasMoved() {
        // +1 to account for moveNumber incrementing in start -> recordGameState.
        return this.history.moveNumber > GameHistory.firstMoveNumber + 1;
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
        this.forEachDelegate(d => {
            if (d.render) { d.render(this); }
        });
        SweepPerfTimer.endShared();
    }
    
    setDebugMode(value) {
        this.debugMode = !!value;
        if (this.debugMode) {
            this.isClean = false;
        }
        this.renderViews();
    }

    toggleDebugMode() {
        this.setDebugMode(!this.debugMode);
    }
    
    setRainbowMode(value) {
        this.rainbowMode = !!value;
        GameStorage.shared.rainbowMode = this.rainbowMode;
        this.renderViews();
    }

    toggleRainbowMode() {
        this.setRainbowMode(!this.rainbowMode);
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
        this.moveState = MoveState.ready;
        this.mostRecentAction.setStatistics(start, this.game.statistics);
        if (SweepPerfTimer.shared) {
            SweepPerfTimer.shared.counters.action = this.mostRecentAction.description;
        }
        SweepPerfTimer.endShared();
        this.recordGameState();
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
            this.hintTile = null;
            this.debugTiles = [];
            this.warningMessage = null;
            this.moveState = MoveState.active;
            this.forEachDelegate(d => {
                if (d.beginMove) { d.beginMove(this); }
            });
        }
    }

    recordGameState() {
        this.history.setCurrentMove(new MoveHistoryMoment({ session: this }));
        GameStorage.shared.autosaveGame = this.objectForAutosave();
    }
    
    attemptRevealTile(tile, revealBehavior) {
        if (this.state != GameState.playing) { return; }
        if (!tile) { return; }
        // debugLog(this.game.board._allTiles.indexOf(tile));

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
            if (tile.isMined && tile.flag.isEqual(TileFlag.assertMine)) return SweepAction.Result.noop;
            // debugLog(`Revealing (asserting) ${tile.coord.debugDescription}`);
            break;
        case GameSession.revealBehaviors.assertTrustingFlags:
            if (tile.isCovered || tile.flag.isPresent) return SweepAction.Result.noop;
            var assertFlagCount = 0;
            var anyMaybeFlagNeighbors = false;
            let candidates = 0;
            tile.visitNeighbors(neighbor => {
                if (neighbor.flag.isEqual(TileFlag.maybeMine)) { anyMaybeFlagNeighbors = true; }
                if (neighbor.flag.isEqual(TileFlag.assertMine)) { assertFlagCount += 1; }
                if (neighbor.isCovered && !neighbor.flag.isEqual(TileFlag.assertMine)) { candidates += 1; }
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
        if (revealed.includes(tile)) return;
        revealed.push(tile);
        tile.visitNeighbors(neighbor => {
            if (revealed.includes(neighbor) || !neighbor.isCovered || neighbor.flag.isPresent) return;
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
        this.game.difficulty = Game.makeCustomDifficulty(this.game.board.size, this.game.board.mineCount);
    }

    mineTriggered(tile) {
        tile.reveal(this.history.moveNumber);
        this.state = GameState.lost;
        this.endTime = Date.now();
        this.history.setCurrentMove(new MoveHistoryMoment({ session: this }));
        this.statsHistory.gameCompleted(this);
        Dispatch.shared.postEventSync(GameSession.gameCompletedEvent, this, this.debugMode);
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
            this.statsHistory.gameCompleted(this);
            Dispatch.shared.postEventSync(GameSession.gameCompletedEvent, this, this.debugMode);
        }
    }
}
Gaming.Mixins.Gaming.DelegateSet(GameSession);
GameSession.moveCompletedEvent = "GameSession.moveCompletedEvent";
GameSession.gameCompletedEvent = "GameSession.gameCompletedEvent";
GameSession.gameControlsView = null;
GameSession.revealBehaviors = {
    safe: 0,
    assertTrustingFlags: 1,
    assertFlag: 2
};
// end class GameSession

// views, etc., can implement this pattern
class GameSessionDelegate {
    gameResumed(session, newGame, oldGame) { }
    beginMove(session) { }
    render(session) { }
}

function mark__Serialization() {} // ~~~~~~ Serialization ~~~~~~

export class Sharing {
    static cleanSharingCode(text) {
        return text ? text.replace(/--.*--\W*/g, "") : "";
    }
    
    static gameBoardObject(session) {
        if (!session || !session.game) { return null; }
        let header = [Game.schemaVersion, Sharing.Modes.board];
        return header.concat(session.game.objectForSharing());
    }

    static gameFromBoardObject(object) {
        if (!Array.isArray(object) || object.length < 2) {
            throw new Error("failedToParseGame");
        }
        if (object[0] != Game.schemaVersion) {
            throw new Error("schemaVersionUnsupported");
        }
        if (object[1] != Sharing.Modes.board) {
            throw new Error("failedToParseGame");
        }
        return Game.fromObjectForSharing(object.slice(2));
    }
}
Sharing.Modes = {
    board: 0
};

Game.prototype.objectForSharing = function() {
    return [this.difficulty.index].concat(this.board.objectForSharing());
};

Game.fromObjectForSharing = function(data) {
    if (!Array.isArray(data) || data.length < 1) {
        throw new Error("failedToParseGame");
    }
    let difficulty = Game.rules().difficulties[data[0]];
    if (!difficulty) {
        throw new Error("failedToParseGame");
    }
    let board = GameBoard.fromObjectForSharing(data.slice(1));
    if (difficulty.isCustom) {
        // TODO this also appears in NewGameDialog
        difficulty = Object.assign({}, difficulty, {
            width: board.size.width,
            height: board.size.height,
            mineCount: board.mineCount
        });
    }
    if (board.size.width != difficulty.width
        || board.size.height != difficulty.height
        || board.mineCount != difficulty.mineCount) {
        throw new Error("failedToParseGame");
    }
    return new Game({ difficulty: difficulty, board: board });
};

GameBoard.prototype.objectForSharing = function() {
    let tiles = new Gaming.BoolArray(this._allTiles.length);
    this._allTiles.forEach((tile, index) => {
        if (SweepPerfTimer.shared) { SweepPerfTimer.shared.counters.visitTiles++; }
        tiles.setValue(index, tile.isMined);
    });
    let tileData = tiles.objectForSerialization;
    let checksum = Gaming.hashArrayOfInts(tileData);
    let header = [this.size.width, this.size.height, this.mineCount >> 8, this.mineCount % 256, checksum];
    return header.concat(tileData);
};

GameBoard.fromObjectForSharing = function(data) {
    if (!Array.isArray(data) || data.length < 5) {
        throw new Error("failedToParseGame");
    }
    let size = {};
    size.width = data.shift();
    size.height = data.shift();
    let mineCount = data.shift() * 256;
    mineCount += data.shift();
    let checksum = data.shift();
    
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
    let actualMineCount = 0;
    board._allTiles.forEach((tile, index) => {
        tile.isMined = !!(bits.getValue(index));
        if (tile.isMined) {
            actualMineCount += 1;
        }
    });
    if (actualMineCount != board.mineCount) {
        debugWarn("actualMineCount != expected mineCount"); debugLog(object);
        throw new Error("failedToParseGame");
    }
    board.reset();
    return board;
};

GameSession.prototype.objectForAutosave = function() {
    if (!(this.moveState == MoveState.ready || this.moveState == MoveState.pending)) {
        // Don't attempt to autosave inconsistent state
        return null;
    }
    return {
        schemaVersion: Game.schemaVersion,
        game: this.game.objectForAutosave(),
        state: this.state,
        history: this.history.objectForAutosave(),
        isClean: this.isClean,
        mostRecentAction: this.mostRecentAction ? this.mostRecentAction.objectForAutosave() : null,
        hintTileCoord: this.hintTile ? this.hintTile.coordForSerialization : null,
        startTime: this.startTime,
        endTime: this.endTime
    };
};

GameSession.fromAutosave = function(data) {
    if (!data) { return null; }
    Gaming.deserializeAssertProperties(data, [
        "schemaVersion",
        "game",
        "state",
        "history",
        "isClean",
        "mostRecentAction",
        "hintTileCoord",
        "startTime",
        "endTime"
    ]);
    if (data.schemaVersion != Game.schemaVersion) {
        throw new Error("schemaVersionUnsupported");
    }
    let game = Game.fromAutosave(data.game);
    let session = new GameSession({ game: game });
    session.state = data.state;
    session.history = GameHistory.fromAutosave(data.history);
    session.isClean = data.isClean;
    if (data.mostRecentAction) {
        session.mostRecentAction = ActionResult.fromAutosave(data.mostRecentAction, session);
    }
    if (data.hintTileCoord) {
        session.hintTile = session.game.board.tileAtCoord(data.hintTileCoord);
    }
    session.startTime = data.startTime;
    session.endTime = data.endTime;
    return session;
};

Game.prototype.objectForAutosave = function() {
    return {
        id: this.id,
        // custom width/height/etc. stored in GameBoard sz
        difficulty: this.difficulty.index,
        board: this.board.objectForAutosave()
    };
};

Game.fromAutosave = function(data) {
    if (!data) { throw new Error("noGameData"); }
    Gaming.deserializeAssertProperties(data, ["id", "difficulty", "board"]);
    let board = GameBoard.fromAutosave(data.board);
    let difficulty = Game.getDifficulty(data.difficulty);
    if (!difficulty) {
        throw new Error("badDifficulty");
    }
    if (difficulty.isCustom) {
        difficulty = Game.makeCustomDifficulty(board.size, board.mineCount);
    }
    return new Game({
        id: data.id,
        difficulty: difficulty,
        board: board
    });
};

GameBoard.prototype.objectForAutosave = function() {
    return {
        size: this.size,
        mineCount: this.mineCount,
        gameState: this.gameState,
        tiles: {
            data: this._allTiles.map(tile => tile.objectForAutosave()),
            rainbow: {
                cleared: this._allTiles.map(tile => tile.rainbow.cleared),
                flagged: this._allTiles.map(tile => tile.rainbow.flagged)
            }
        }
    }
    let data = this.compactSerialized;
    data.gameState = this.gameState;
    return data;
};

GameBoard.fromAutosave = function(data) {
    if (!data) { throw new Error("noBoardData"); }
    Gaming.deserializeAssertProperties(data, ["size", "mineCount", "gameState", "tiles"]);
    Gaming.deserializeAssert(Array.isArray(data.tiles.data));
    Gaming.deserializeAssertProperties(data.tiles, ["rainbow"]);
    Gaming.deserializeAssert(Array.isArray(data.tiles.rainbow.cleared));
    Gaming.deserializeAssert(Array.isArray(data.tiles.rainbow.flagged));
    let board = new GameBoard({
        size: data.size,
        mineCount: data.mineCount,
        gameState: data.gameState
    });
    board._allTiles.forEach((tile, index) => {
        tile.restoreAutosave(data.tiles.data[index], data.tiles.rainbow.cleared[index], data.tiles.rainbow.flagged[index]);
    });
    return board;
};

GameTile.prototype.objectForAutosave = function() {
    return this.compactSerialized;
};

GameTile.prototype.restoreAutosave = function(data, rainbowCleared, rainbowFlagged) {
    Gaming.deserializeAssert(Number.isInteger(data));
    let config = GameTile.fromCompactSerialization(data);
    this._mined = config.isMined;
    this._minedNeighborCount = config.minedNeighborCount;
    this._covered = config.isCovered;
    this._flag = config.flag;
    this.rainbow.cleared = rainbowCleared;
    this.rainbow.flagged = rainbowFlagged;
};

function mark__Actions() {} // ~~~~~~ Actions ~~~~~~

export class ActionResult {
    constructor(config) {
        if (config) {
            this.actionType = config.action ? config.action.constructor.name : config.actionType;
        } else {
            this.actionType = null;
        }
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
    
    objectForAutosave() {
        return {
            actionType: this.actionType,
            tileCoord: this.tile ? this.tile.coordForSerialization : null,
            description: this.description,
            change: this.change
        };
    }
    
    static fromAutosave(data, session) {
        Gaming.deserializeAssertProperties(data, ["tileCoord", "description", "change"]);
        let tile = data.tileCoord ? session.game.board.tileAtCoord(data.tileCoord) : null;
        return new ActionResult({
            actionType: data.actionType,
            tile: tile,
            description: data.description,
            change: data.change
        });
    }
}

export class SweepAction {
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
            && !UI.isShowingDialog();
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
                    item.score += (1 / tile.coord.manhattanDistanceFrom(nearby.coord).pathLength);
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
        switch (tile.flag.value) {
        case TileFlag.assertMine.value: return Strings.str("setFlagAssertMineActionDescription");
        case TileFlag.maybeMine.value: return Strings.str("setFlagMaybeMineActionDescription");
        case TileFlag.none.value: return Strings.str("setFlagNoneActionDescription");
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
        // debugLog("FLAG:" + session.game.board._allTiles.indexOf(tile));
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
            && !UI.isShowingDialog();
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
        return MooAction.isValid(session) && this.tile.isCovered && this.tile.isMined && !this.tile.flag.isEqual(TileFlag.assertMine);
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

export class TileCollection {
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
            if (!this.debugTiles.includes(tile)) { this.debugTiles.push(tile); }
        });
    }
} // end class TileCollection

export class TileTransform {
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
        this.allowedFlags = allowedFlags.map(flag => flag.value);
    }

    map(tile, collection) {
        return this.allowedFlags.includes(tile.flag.value);
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
    static exactly(count) {
        return new MinedNeighborCountRangeFilter({ min: count, max: count })
    }
    
    constructor(range) {
        super();
        this.range = range;
    }

    map(tile, collection) {
        return tile.minedNeighborCount >= this.range.min && tile.minedNeighborCount <= this.range.max;
    }
}
MinedNeighborCountRangeFilter.hasAny = new MinedNeighborCountRangeFilter({ min: 1, max: TileTransform.maxNeighbors });
MinedNeighborCountRangeFilter.zero = MinedNeighborCountRangeFilter.exactly(0);
TileTransform.MinedNeighborCountRangeFilter = MinedNeighborCountRangeFilter;

class ClearedMoveNumberFilter extends TileTransform {
    static exactly(moveNumber) {
        return new ClearedMoveNumberFilter({ min: moveNumber, max: moveNumber });
    }
    
    constructor(range) {
        super();
        this.range = range;
    }
    
    map(tile, collection) {
        return !tile.isCovered
            && tile.rainbow.cleared >= this.range.min
            && tile.rainbow.cleared <= this.range.max;
    }
}
TileTransform.ClearedMoveNumberFilter = ClearedMoveNumberFilter;

function mark__Achievement() {} // ~~~~~~ Achievement ~~~~~~

export class Achievement {
    static initialize(content) {
        Achievement.allTypes = {
            "Achievement.HighestScoreInAnyGame": Achievement.HighestScoreInAnyGame,
            "Achievement.Moo": Achievement.Moo,
            "Achievement.MostClearedInSingleMove": Achievement.MostClearedInSingleMove,
            "Achievement.MostPointsInSingleMove": Achievement.MostPointsInSingleMove,
            "Achievement.HighestScoreInFiveStarGame": Achievement.HighestScoreInFiveStarGame,
            "Achievement.HighestScoreWithoutFlags": Achievement.HighestScoreWithoutFlags,
            "Achievement.Uncovered7NeighborCountTile": Achievement.Uncovered7NeighborCountTile,
            "Achievement.Uncovered8NeighborCountTile": Achievement.Uncovered8NeighborCountTile,
            "Achievement.Won1StarGame": Achievement.Won1StarGame,
            "Achievement.Won2StarGame": Achievement.Won2StarGame,
            "Achievement.Won3StarGame": Achievement.Won3StarGame,
            "Achievement.Won4StarGame": Achievement.Won4StarGame,
            "Achievement.Won5StarGame": Achievement.Won5StarGame,
            "Achievement.Cleared1000TilesAllTime": Achievement.Cleared1000TilesAllTime,
            "Achievement.Cleared20000TilesAllTime": Achievement.Cleared20000TilesAllTime
        };
        AchievementStorage.shared = new AchievementStorage.Local();
        let data = AchievementStorage.shared.loadAll();
        
        this.all = content.orderedAchievements.map(id => {
            let constructor = Achievement.allTypes[id];
            try {
                if (!constructor) {
                    debugWarn(`unknown achievement id ${id}`);
                    return null;
                }
                if (data.hasOwnProperty(id)) {
                    return constructor.fromDeserializedWrapper(data[id]);
                }
            } catch(e) {
                debugWarn([`Failed to parse ${constructor.name}#${id}: ${e.message}`, data[id]], true);
            }
            return new constructor({ id: id });
        }).filter(achievement => !!achievement);
    }

    static hasAnyNew() {
        return this.all.find(achievement => !achievement.seen);
    }

    static reset() {
        this.all.forEach(achievement => achievement.reset());
    }

    constructor(config) {
        if (!config.id) {
            debugWarn(config, true);
            throw new Error("Achievement.dzFailure");
        }

        this.id = config.id;
        if (typeof(config.status) == 'undefined') {
            this.setDefaultConfig();
        } else {
            this.status = config.status; // Achievement.Status
            this.value = config.value; // any serializable value the subclass needs
            this.date = config.date; // timestamp, e.g. Date.now()
            this.seen = config.seen; // bool
        }

        // debugLog("init: " + this.debugDescription);
        this.target = new DispatchTarget();
        this.target.register(GameSession.moveCompletedEvent, (e, session) => {
            if (!InteractiveSessionView.isMain(session)) { return; }
            if (this.isValid(session)) { this.moveCompleted(session, Date.now()); }
        });
        this.target.register(GameSession.gameCompletedEvent, (e, session) => {
            if (!InteractiveSessionView.isMain(session)) { return; }
            if (this.isValid(session)) { this.gameCompleted(session, session.endTime); }
        });
    }

    // also used by constructor to set default state
    setDefaultConfig() {
        this.status = Achievement.Status.none;
        this.value = null;
        this.date = Date.now();
        this.seen = false;
    }

    reset(status) {
        this.status = status;
        this.setDefaultConfig();
        this.seen = true;
        this.save();
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
        this.seen = false;
        // debugLog(`achieved: ${this.debugDescription}`);
        this.save();
    }

    markAsSeen() {
        if (this.seen) { return; }
        this.seen = true;
        // debugLog(`markAsSeen: ${this.debugDescription}`)
        this.save();
    }

    save() {
        AchievementStorage.shared.saveAchievement(this);
        Dispatch.shared.postEventSync(Achievement.achievementUpdatedEvent, this);
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
        if (!data || (data.schemaVersion != Game.schemaVersion)) {
            // could have a static tryUpgradeSchema fallback to handle schemaVersion updates
            throw new Error("schemaVersionUnsupported");
        }
        return new this(data);
    }
}
Achievement.Status = {
    none: "none",
    achieved: "achieved",
    locked: "locked",
    hidden: "hidden"
};
Achievement.achievementUpdatedEvent = "Achievement.achievementUpdatedEvent";

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
        this.all[achievement.id] = achievement.objectForSerialization;
    }
};

Achievement.MostPointsInSingleMove = class MostPointsInSingleMove extends Achievement {
    static formatValue(achievement) {
        if (achievement.status != Achievement.Status.achieved) { return ""; }
        return Number.uiInteger(achievement.value);
    }

    setDefaultConfig() {
        super.setDefaultConfig();
        this.value = 0;
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
    static formatValue(achievement) {
        if (achievement.status != Achievement.Status.achieved) { return ""; }
        return Number.uiInteger(achievement.value);
    }

    setDefaultConfig() {
        super.setDefaultConfig();
        this.value = 0;
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

Achievement.HighestScoreInFiveStarGame = class HighestScoreInFiveStarGame extends Achievement {
    static formatValue(achievement) {
        return Number.uiInteger(achievement.value);
    }

    setDefaultConfig() {
        super.setDefaultConfig();
        this.status = Achievement.Status.locked;
        this.value = 0;
    }

    isValid(session) {
        return session.isClean
            && (session.state == GameState.won || session.state == GameState.lost);
    }

    gameCompleted(session, date) {
        let statistics = session.game.statistics;
        if (statistics.starCount == 5 && statistics.points > this.value) {
            this.achieved(statistics.points, date);
        }
    }
}

Achievement.HighestScoreWithoutFlags = class HighestScoreWithoutFlags extends Achievement {
    static formatValue(achievement) {
        return Number.uiInteger(achievement.value);
    }

    isValid(session) {
        return session.isClean
            && (session.state == GameState.won)
            && !session.game.board.gameState.usedAnyFlags;
    }

    setDefaultConfig() {
        super.setDefaultConfig();
        this.status = Achievement.Status.locked;
        this.value = 0;
    }

    gameCompleted(session, date) {
        let points = session.game.statistics.points;
        if (points > this.value) {
            this.achieved(points, date);
        }
    }
};

Achievement.MostClearedInSingleMove = class MostClearedInSingleMove extends Achievement {
    static formatValue(achievement) {
        if (achievement.status != Achievement.Status.achieved) { return ""; }
        return Number.uiPercent(achievement.value);
    }

    setDefaultConfig() {
        super.setDefaultConfig();
        this.value = 0;
    }

    isValid(session) {
        return session.isClean
            && (session.state == GameState.playing)
            && (!!session.mostRecentAction)
            && (!!session.mostRecentAction.change);
    }

    moveCompleted(session, date) {
        let progress = session.mostRecentAction.change.progress;
        if (progress > this.value) {
            this.achieved(progress, date);
        }
    }
};

Achievement.Moo = class Moo extends Achievement {
    // why is this static? why not just `get formattedValue()` ???
    static formatValue(achievement) {
        return Game.content.achievements["Achievement.Moo"].formattedValue;
    }

    setDefaultConfig() {
        super.setDefaultConfig();
        this.value = false;
        this.status = Achievement.Status.locked;
    }

    isValid(session) {
        return this.status != Achievement.Status.achieved
            && session.state == GameState.playing
            && !!session.mostRecentAction;
    }

    moveCompleted(session, date) {
        if (!this.value && session.mostRecentAction.actionType == MooAction.name) {
            this.achieved(true, date);
        }
    }
};

class UncoveredNeighborCountTile extends Achievement {
    static formatValue(achievement) {
        return { minedNeighborCount: Game.integerFormatObject(achievement.value) };
    }

    isValid(session) {
        return this.status != Achievement.Status.achieved
            && session.isClean
            && (session.state == GameState.playing)
            && (!!session.mostRecentAction)
            && (!!session.mostRecentAction.change)
            && (session.mostRecentAction.change.clearedTileCount > 0);
    }

    moveCompleted(session, date) {
        let collection = TileCollection.allTiles(session)
            .applying(ClearedMoveNumberFilter.exactly(session.history.moveNumber))
            .applying(MinedNeighborCountRangeFilter.exactly(this.value))
            .applying(new MineFilter(false));
        if (!collection.isEmpty) {
            this.achieved(this.value, date);
        }
    }
}

Achievement.Uncovered7NeighborCountTile = class Uncovered7NeighborCountTile extends UncoveredNeighborCountTile {
    setDefaultConfig() {
        this.value = 7;
        this.status = Achievement.Status.locked;
    }
};

Achievement.Uncovered8NeighborCountTile = class Uncovered8NeighborCountTile extends UncoveredNeighborCountTile {
    setDefaultConfig() {
        this.value = 8;
        this.status = Achievement.Status.hidden;
    }
};

class ClearedTilesAllTime extends Achievement {
    static formatValue(achievement) {
        return { value: Number.uiInteger(achievement.value) };
    }
    
    isValid(session) {
        return session.isClean
            && (this.status != Achievement.Status.achieved)
            && (session.state == GameState.won || session.state == GameState.lost);
    }
    
    gameCompleted(session, date) {
        let cleared = session.statsHistory.summary.totalTilesClearedAllGames;
        if (cleared >= this.value) {
            this.achieved(this.value, date);
        }
    }
}

Achievement.Cleared1000TilesAllTime = class Cleared1000TilesAllTime extends ClearedTilesAllTime {
    setDefaultConfig() {
        this.value = 1000;
        this.status = Achievement.Status.locked;
    }
};

Achievement.Cleared20000TilesAllTime = class Cleared1000TilesAllTime extends ClearedTilesAllTime {
    setDefaultConfig() {
        this.value = 20000;
        this.status = Achievement.Status.hidden;
    }
};

class WonStars extends Achievement {
    static formatValue(achievement) {
        return { value: achievement.value };
    }

    setDefaultConfig() {
        super.setDefaultConfig();
        this.value = this.constructor.starCount(); // static starCount() in subclasses
        if (this.value == 1) {
            this.status = Achievement.Status.none;
            this.save();
        } else {
            this.status = Achievement.Status.hidden;
        }
    }

    constructor(config) {
        super(config);
        this.target.register(Achievement.achievementUpdatedEvent, (e, achievement) => {
            this.unlockIfReady(achievement);
        });
    }

    // achieve N stars: un-hide N+1 stars
    unlockIfReady(trigger) {
        if ((this.status == Achievement.Status.hidden)
            && (trigger != this)
            && (trigger instanceof WonStars)
            && (trigger.status == Achievement.Status.achieved)
            && (trigger.value >= this.value - 1)) {
            debugLog(`unlockIfReady: trigger=${trigger.debugDescription} this=${this.debugDescription}`);
            this.status = Achievement.Status.none;
            this.save();
        }
    }

    isValid(session) {
        return session.isClean
            && (session.state == GameState.won)
            && this.status != Achievement.Status.achieved;
    }

    gameCompleted(session, date) {
        if (this.value == session.game.statistics.starCount) {
            this.achieved(this.value, date);
        }
    }
}

Achievement.Won1StarGame = class Won1StarGame extends WonStars {
    static starCount() { return 1; }
};
Achievement.Won2StarGame = class Won2StarGame extends WonStars {
    static starCount() { return 2; }
};
Achievement.Won3StarGame = class Won3StarGame extends WonStars {
    static starCount() { return 3; }
};
Achievement.Won4StarGame = class Won4StarGame extends WonStars {
    static starCount() { return 4; }
};
Achievement.Won5StarGame = class Won5StarGame extends WonStars {
    static starCount() { return 5; }
};

function mark__User_Input() {} // ~~~~~~ User Input ~~~~~~

class InputController {
    constructor() {
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
        this.pixelScale = window.devicePixelRatio;
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
        this.showNewGameDialogButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("showNewGameDialogButton"),
            click: () => this.showNewGameDialog()
        });
        this.showOptionsDialogButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("showOptionsDialogButton"),
            click: () => this.showOptionsDialog()
        });
        this.showHelpButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("showHelpButton"),
            click: () => this.showHelp()
        });
        this.showTrophiesButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("showTrophiesButton"),
            click: () => this.showTrophies()
        });
        // this.showAnalysisButton = new ToolButton({
        //     parent: this.elem,
        //     title: Strings.str("showAnalysisButton"),
        //     click: () => this.showAnalysis()
        // });
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
        this.shareButton = new ToolButton({
            parent: this.elem,
            title: Strings.str("shareButton"),
            click: () => this.shareGame()
        });

        this.target = new DispatchTarget();
        this.target.register(Achievement.achievementUpdatedEvent, (e, achievement) => {
            this.render();
        });

        let gse = GameScriptEngine.shared;
        gse.registerCommand("newGame", prompt => this.newGame(prompt));
        gse.registerCommand("showNewGameDialog", () => this.showNewGameDialog());
        gse.registerCommand("showOptionsDialog", () => this.showOptionsDialog());
        gse.registerCommand("showHelp", () => this.showHelp());
        gse.registerCommand("showTrophies", () => this.showTrophies());
        gse.registerCommand("showAnalysis", () => this.showAnalysis());
        gse.registerCommand("showHint", () => this.showHint());
        gse.registerCommand("solverStep", () => this.solverStep());
        gse.registerCommand("toggleRainbowMode", () => this.toggleRainbowMode());
        
        this.session.addDelegate(this);
    }

    render() {
        this.showTrophiesButton.elem.addRemClass("new", Achievement.hasAnyNew());
        // this.showAnalysisButton.isEnabled = GameAnalysisDialog.isValid(this.session);
        this.showHintButton.isEnabled = AttemptHintAction.isValid(this.session);
        this.solverStepButton.isEnabled = AttemptSolverStepAction.isValid(this.session);
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
            InteractiveSessionView.begin(new Game({ difficulty: this.session.game.difficulty }));
        }
    }

    showNewGameDialog() {
        if (UI.isShowingDialog()) { return; }
        new NewGameDialog().show();
    }
    
    showOptionsDialog() {
        if (UI.isShowingDialog()) { return; }
        new OptionsDialog(this.session).show();
    }

    showHelp() {
        if (UI.isShowingDialog()) { return; }
        new HelpDialog().show();
    }

    showTrophies() {
        if (UI.isShowingDialog()) { return; }
        let difficulty = null;
        if (this.session && this.session.game) {
            difficulty = this.session.game.difficulty;
        }
        TrophiesDialog.show(GameStorage.shared, difficulty);
    }

    showAnalysis() {
        if (UI.isShowingDialog()) { return; }
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
} // end class GameControlsView

class TabbedView {
    /// a.parent: DOM element TabbedView will append itself to.
    /// a.items: ordered array of tab content. Should have contentElem and .tabLabel properties.
    /// a.selectedIndex: optional, initial index to select.
    constructor(a) {
        this.contentElem = document.querySelector("body > tabbedView")
            .cloneNode(true).addRemClass("hidden", false);
        this.buttonsContainer = this.contentElem.querySelector("controls.tabs");
        this.tabButtonsElem = this.contentElem.querySelector("controls.tabs > row");
        this.contentContainer = this.contentElem.querySelector("div");
        a.parent.append(this.contentElem);
        
        this.items = a.items;
        this.tabButtons = [];
        
        this.configureView();
        this.selectTab(a.hasOwnProperty("selectedIndex") ? a.selectedIndex : 0);
    }
    
    configureView() {
        let showTabs = this.items.length > 1;
        this.tabButtons = [];
        this.tabButtonsElem.removeAllChildren();
        this.contentContainer.removeAllChildren();
        this.buttonsContainer.classList.toggle("hidden", !showTabs);
        
        this.items.forEach((tab, index) => {
            this.tabButtons.push(new ToolButton({
                id: "",
                parent: this.tabButtonsElem,
                title: tab.tabLabel,
                click: () => this.selectTab(index)
            }));
            this.contentContainer.append(tab.contentElem);
        });
    }
    
    selectTab(index) {
        index = Math.clamp(index, { min: 0, max: this.items.length - 1 });
        this.tabButtons.forEach((item, itemIndex) => item.isSelected = (index == itemIndex));
        this.items.forEach((item, itemIndex) => item.contentElem.classList.toggle("hidden", (index != itemIndex)));
        return this;
    }
}

function mark__User_Interface() {} // ~~~~~~ User Interface ~~~~~~

class UI {
    static prepareStaticContent() {
        Strings.localizeDOM(
            document,
            (token, elem) => GameScriptEngine.shared.execute(token, elem, null)
        );
    }
    
    static isTouchFirst() {
        return !window.matchMedia("(any-pointer: fine)").matches;
    }
    
    static isNarrowViewport() {
        return window.matchMedia("(max-width: 800px)").matches;
    }
    
    static isShowingDialog() {
        return !!Gaming.GameDialogManager.shared.currentDialog;
    }
    
    // for any canvas where width = devicePixelRatio * clientWidth
    static resolveCanvasFont(config, inputAccomodationScale) {
        let size = config[1] * window.devicePixelRatio * (inputAccomodationScale ? inputAccomodationScale : 1);
        let units = config[2];
        return String.fromTemplate(config[0], { size: `${size}${units}` });
    }
    
    static getGameMetadata() {
        return {
            appVersion: Game.appVersion,
            pointerActionVerb: Strings.str(UI.isTouchFirst() ? "tapAction" : "clickAction"),
            pointerNoun: Strings.str(UI.isTouchFirst() ? "touchPointerNoun" : "mousePointerNoun")
        };
    }
}

// fully interactive with all controls. long-lived singleton.
class InteractiveSessionView {
    static isMain(session) {
        return InteractiveSessionView.shared ? (InteractiveSessionView.shared.session == session) : false;
    }
    
    static initialize() {
        try {
            let data = GameStorage.shared.autosaveGame;
            let session = data ? GameSession.fromAutosave(data) : null;
            if (session) {
                debugLog(`Restored game from ${JSON.stringify(data).length}-byte autosave`);
                InteractiveSessionView.shared = new InteractiveSessionView(session);
                InteractiveSessionView.shared.session.resume();
            }
        } catch(e) {
            debugWarn("Failed to load autosave");
            debugLog(e);
        }
        if (!InteractiveSessionView.shared) {
            new NewGameDialog().show();
        }
    }
    
    static begin(game) {
        if (InteractiveSessionView.shared) {
            InteractiveSessionView.shared.session.start(game);
        } else {
            let session = new GameSession({ game: game });
            InteractiveSessionView.shared = new InteractiveSessionView(session);
            InteractiveSessionView.shared.session.start();
        }
    }
    
    constructor(session) {
        this.session = session;
        this.inputController = new InputController();
        this.controlsView = new GameControlsView({ session: this.session, elem: document.querySelector("header row") });
        this.mostRecentActionView = new ActionDescriptionView({ session: this.session, elem: document.querySelector("message") });
        let boardContainer = document.querySelector("board");
        this.boardView = new GameBoardView({ session: this.session, boardContainer: boardContainer, interactive: true });
        this.statusView = new GameStatusView({ session: this.session, elem: document.querySelector("footer") });
        this.storiesView = new SweepStoriesView({ session: this.session, elem: document.querySelector("stories") });
        this.moo = new Moo({ session: this.session, elem: document.querySelector("moo"), boardView: this.boardView, inputController: this.inputController });
        
        this.target = new DispatchTarget();
        this.target.register(GameSession.gameCompletedEvent, (e, session) => {
            this.gameCompleted(session);
        });
    }
    
    gameCompleted(session) {
        if (session != this.session) { return; }
        switch (this.session.state) {
            case GameState.won:
                new SaveHighScoreDialog(this.session).show();
                break;
            case GameState.lost:
                new AlertDialog({
                    title: Strings.str("lostAlertTitle"),
                    message: Strings.template("lostAlertDialogTextTemplate", Game.formatStatistics(this.session.game.statistics)),
                    buttons: [{ title: Strings.str("lostAlertButton") }]
                }).show();
                break;
            default:
                break;
        }
    }
}
InteractiveSessionView.shared = null;

class ActionDescriptionView {
    constructor(config) {
        this.session = config.session;
        this.elem = config.elem;
        this.session.addDelegate(this);
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
        this.session.addDelegate(this);
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
        GameBoardView.metrics.inputAccomodationScale = UI.isTouchFirst() ? GameBoardView.metrics.touchScaleFactor : 1;
    }

    constructor(config) {
        this.session = config.session;
        this.tileViews = [];
        this.boardContainer = config.boardContainer;
        this.canvas = config.boardContainer.querySelector("canvas");
        this.game = config.session.game;
        if (!!config.interactive) {
            this.controller = new GameBoardController(this);
        } else {
            this.controller = null;
        }
        
        this.session.addDelegate(this);
    }
    
    gameResumed(session, newGame, oldGame) {
        this.game = newGame;
        this.boardContainer.addRemClass("hidden", false);
    }

    get game() { return this._game; }
    set game(newGame) {
        if (newGame != this._game) {
            this._game = newGame;
            this.configure();
        }
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
        this.pixelScale = window.devicePixelRatio;
        
        const tileDeviceWidth = GameBoardView.metrics.tileWidth * this.pixelScale * GameBoardView.metrics.inputAccomodationScale;
        this.tilePlane = new TilePlane(this.game.difficulty, tileDeviceWidth);
        this.tilePlane.viewportSize = { width: this.tilePlane.size.width * tileDeviceWidth, height: this.tilePlane.size.height * tileDeviceWidth };

        this.canvas.style.width = `${this.tilePlane.size.width * GameBoardView.metrics.tileWidth * GameBoardView.metrics.inputAccomodationScale}px`;
        this.canvas.style.height = `${this.tilePlane.size.height * GameBoardView.metrics.tileWidth * GameBoardView.metrics.inputAccomodationScale}px`;
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
            let moveCount = this.session.history.serializedMoves.length;
            context.rainbow = {
                moves: { min: 0, max: moveCount },
                hue: Object.assign({}, GameBoardView.metrics.rainbow.hue),
                cleared: Object.assign({}, GameBoardView.metrics.rainbow.cleared),
                flagged: Object.assign({}, GameBoardView.metrics.rainbow.flagged),
                fadeIn: Object.assign({}, GameBoardView.metrics.rainbow.fadeIn)
            };
            // Limit the amount of color change per move early in the game
            let colors = Math.abs(context.rainbow.hue.max - context.rainbow.hue.min);
            let interval = colors / moveCount;
            if ((context.rainbow.hue.maxInterval > 0) && (interval > context.rainbow.hue.maxInterval)) {
                context.rainbow.hue.max = context.rainbow.hue.maxInterval * moveCount;
            }
            
            // "Fade in" the saturation/lightness early in the game
            if (!!context.rainbow.fadeIn && context.rainbow.fadeIn.moveCount > 0 && moveCount < context.rainbow.fadeIn.moveCount) {
                let fadeIn = context.rainbow.fadeIn;
                context.rainbow.cleared.saturation = this.rainbowFade(context, moveCount, fadeIn.initialSaturationFactor, context.rainbow.cleared.saturation);
                context.rainbow.cleared.lightness = this.rainbowFade(context, moveCount, fadeIn.initialLightnessFactor, context.rainbow.cleared.lightness);
                context.rainbow.flagged.saturation = this.rainbowFade(context, moveCount, fadeIn.initialSaturationFactor, context.rainbow.flagged.saturation);
                context.rainbow.flagged.lightness = this.rainbowFade(context, moveCount, fadeIn.initialLightnessFactor, context.rainbow.flagged.lightness);
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
    
    rainbowFade(context, moveCount, initialFactor, finalValue) {
        return Math.floor(Math.scaleValueLinear(
            moveCount,
            { min: 0, max: context.rainbow.fadeIn.moveCount },
            { min: initialFactor * finalValue, max: finalValue }
        ));
    }
}
// end class GameBoardView

class GameTileView {
    static initialize(config) {
        GameTileView.config = config;
        GameTileView.config.font = UI.resolveCanvasFont(GameTileView.config.font, GameBoardView.metrics.inputAccomodationScale);
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

        if (Game.rules().allowDebugMode && context.session.debugTiles && context.session.debugTiles.includes(this.model)) {
            this.renderContent(context, rect, GameTileViewState.debug);
        }
    }

    renderHintTile(context) {
        const rect = context.tilePlane.screenRectForModelTile(this.model.coord);
        this.renderContent(context, rect, GameTileViewState.hintTile);
    }

    renderCovered(context, rect) {
        switch (this.model.flag.value) {
        case TileFlag.none.value:
            if (context.showAllMines && this.model.isMined) {
                return this.renderContent(context, rect, GameTileViewState.mineRevealed);
            } else {
                return this.renderContent(context, rect, GameTileViewState.covered);
            }
        case TileFlag.assertMine.value:
            if (context.showAllMines && !this.model.isMined) {
                return this.renderContent(context, rect, GameTileViewState.incorrectFlag);
            } else {
                return this.renderContent(context, rect, GameTileViewState.assertMine);
            }
        case TileFlag.maybeMine.value:
            if (context.showAllMines && !this.model.isMined) {
                return this.renderContent(context, rect, GameTileViewState.incorrectFlag);
            } else {
                return this.renderContent(context, rect, GameTileViewState.maybeMine);
            }
        }
    }

    renderRevealed(context, rect) {
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
            let color = `hsl(${hue},${context.rainbow.cleared.saturation}%,${context.rainbow.cleared.lightness}%)`;
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
                let color = `hsl(${hue},${context.rainbow.flagged.saturation}%,${context.rainbow.flagged.lightness}%)`;
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
        
        this.session.addDelegate(this);
    }

    get debugDescription() {
        return `<moo@${this.state}>`;
    }
    
    gameResumed() {
        this.beginMove();
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
        return !!InteractiveSessionView.shared;
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
            return Game.makeCustomDifficulty({
                width: this.customWidthInput.value,
                height: this.customHeightInput.value
            }, this.customMineCountInput.value);
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
        let value = Sharing.cleanSharingCode(input.value);
        if (!this.showImportControls || value.length == 0) {
            this.game = null;
            this.setImportCodeResult(null, false);
        } else {
            try {
                let object = Array.fromHexString(value);
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
            InteractiveSessionView.begin(this.game);
        } else {
            InteractiveSessionView.begin(new Game({ difficulty: this.difficulty }));
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
        
        let data = Sharing.gameBoardObject(session).toHexString();
        if (!UI.isTouchFirst() && !UI.isNarrowViewport()) {
            data = data.hardWrap(64);
        }
        let stats = Object.assign({}, Game.formatStatistics(session.game.statistics), {
            data: data,
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
        this.isEnabled = this.session.isClean && !GameStorage.shared.hasHighScoreForGame(this.session.game.id);
        
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
        TrophiesDialog.show(GameStorage.shared, difficulty);
    }
}

class HelpDialog extends GameDialog {
    static initialize() {
        let isTouchFirst = UI.isTouchFirst();
        let elem = document.querySelector("body > help");
        if (!elem) { return; }
        
        Game.content.keyboard.keyPressShortcuts.forEach(item => {
            if (item.length < 4) { return; }
            let config = Strings.str(item[item.length - 1]);
            if (!config) { return; }
            config = config.split("|");
            if (config.length == 1) {
                config.push("???");
            }
            HelpDialog.appendShortcut(elem, config[0], config[1]);
        });
        elem.querySelector(".shortcuts li:last-child").title = Strings.str("helpKeyboardMooTooltip");
        
        elem.querySelector(".version").innerText = Strings.template("gameVersionLabelTemplate", { appVersion: Game.appVersion });
    }

    static appendShortcut(elem, code, description) {
        let content = document.createElement("li");
        let child = document.createElement("kbd");
        child.innerText = code;
        content.append(child);
        child = document.createElement("span");
        child.innerText = description;
        content.append(child);
        elem.querySelector(".shortcuts").append(content);
    }
    
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
        GameAnalysisDialog.metrics.historyChart.defaultFont = UI.resolveCanvasFont(config.historyChart.defaultFont);
        GameAnalysisDialog.metrics.historyChart.axes.x.titleFont = UI.resolveCanvasFont(config.historyChart.axes.x.titleFont);
        GameAnalysisDialog.metrics.historyChart.axes.y.primary.titleFont = UI.resolveCanvasFont(config.historyChart.axes.y.primary.titleFont);
        GameAnalysisDialog.metrics.historyChart.axes.y.secondary.titleFont = UI.resolveCanvasFont(config.historyChart.axes.y.secondary.titleFont);
        GameAnalysisDialog.metrics.historyChart.axes.x.valueLabels.titleFont = UI.resolveCanvasFont(config.historyChart.axes.x.valueLabels.titleFont);
        GameAnalysisDialog.metrics.historyChart.axes.y.primary.valueLabels.titleFont = UI.resolveCanvasFont(config.historyChart.axes.y.primary.valueLabels.titleFont);
        GameAnalysisDialog.metrics.historyChart.axes.y.secondary.valueLabels.titleFont = UI.resolveCanvasFont(config.historyChart.axes.y.secondary.valueLabels.titleFont);
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

class DisplayOptionsSection {
    constructor(session) {
        this.session = session;
        this.contentElem = GameDialog.createFormElem();
        // Broken: multiple observers with the same observer target, same Kvo property type, but different source objects.
        this.kvoTokens = { rainbowToggle: {}, storiesToggle: {}, debugModeToggle: {} };
        
        this.rainbowToggle = new Gaming.FormValueView.ToggleInputView({
            parent: this.contentElem,
            title: Strings.str("displayOptionsRainbowToggleLabel"),
            value: true,
            selected: this.session.rainbowMode
        });
        this.rainbowToggle.kvo.selected.addObserver(this.kvoTokens.rainbowToggle, () => {
            this.setRainbowMode();
        });
        
        this.storiesToggle = new Gaming.FormValueView.ToggleInputView({
            parent: this.contentElem,
            title: Strings.str("displayOptionsStoriesToggleLabel"),
            value: true,
            selected: GameStorage.shared.storiesVisible
        });
        this.storiesToggle.kvo.selected.addObserver(this.kvoTokens.storiesToggle, () => {
            this.setStoriesMode();
        });
        
        if (Game.rules().allowDebugMode) {
            this.debugModeToggle = new Gaming.FormValueView.ToggleInputView({
                parent: this.contentElem,
                title: Strings.str("displayOptionsDebugModeToggleLabel"),
                value: true,
                selected: this.session.debugMode
            });
            this.debugModeToggle.kvo.selected.addObserver(this.kvoTokens.debugModeToggle, () => {
                this.setDebugMode();
            });
        } else {
            this.debugModeToggle = null;
        }
    }
    
    remove() {
        Object.getOwnPropertyNames(this.kvoTokens).forEach(id => {
            Gaming.Kvo.stopAllObservations(this.kvoTokens[id]);
        });
    }
    
    get tabLabel() { return Strings.str("displayOptionsTabLabel"); }
    
    setRainbowMode() {
        this.session.setRainbowMode(this.rainbowToggle.selected);
    }

    setStoriesMode() {
        GameScriptEngine.shared.execute("setStoriesVisible", this.storiesToggle.selected, null);
    }
    
    setDebugMode() {
        this.session.setDebugMode(this.debugModeToggle.selected);
    }
} // end class DisplayOptionsSection

class SolverOptionsSection {
    constructor() {
        this.preferences = SweepSolver.SolverPreferences.shared;
        this.contentElem = GameDialog.createFormElem();
        
        this.toggleCollection = new Gaming.FormValueView.ToggleInputCollection({
            parent: this.contentElem,
            id: "orderedSolvers",
            title: Strings.str("solverOptionsToggleCollectionLabel"),
            choices: this.preferences.orderedSolvers.map(item => {
                return {
                    title: item.info.name,
                    value: item.id
                };
            })
        });
        
        this.resetButton = new ToolButton({
            parent: this.contentElem,
            title: Strings.str("solverOptionsResetButton"),
            click: () => this.reset()
        }).configure(b => b.elem.classList.toggle("solver-reset", true));
        
        // Initialize state of toggles
        this.enabledIDs = this.preferences.enabledIDs;
        
        this.preferences.kvo.enabledIDs.addObserver(this, () => {
            this.enabledIDs = this.preferences.enabledIDs;
        });
    }
    
    remove() {
        Gaming.Kvo.stopAllObservations(this);
        this.preferences.enabledIDs = this.enabledIDs;
    }
    
    get tabLabel() { return Strings.str("solverOptionsTabLabel"); }
    
    get enabledIDs() {
        return this.toggleCollection.value;
    }
    
    set enabledIDs(newValue) {
        this.toggleCollection.value = newValue;
    }
    
    reset() {
        this.enabledIDs = this.preferences.defaultOrder;
    }
}

class OptionsDialog extends GameDialog {
    constructor(session) {
        super({ rootElemClass: "options" });
        
        this.sections = [
            new DisplayOptionsSection(session),
            new SolverOptionsSection()
        ];
        
        this.contentElem = GameDialog.createContentElem();
        
        this.x = new ToolButton({
            title: Strings.str("optionsDialogDismiss"),
            click: () => this.dismiss()
        });
        
        this.tabs = new TabbedView({
            parent: this.contentElem,
            items: this.sections,
            selectedIndex: 0
        });
    }
        
    dismiss() {
        this.sections.forEach(section => {
            if (section.remove) { section.remove(); }
        });
        super.dismiss();
    }
    
    get title() { return Strings.str("optionsDialogTitle"); }
    get isModal() { return false; }
    get dialogButtons() { return [this.x.elem]; }
} // end class OptionsDialog

class TrophiesDialog extends GameDialog {
    static show(storage, difficulty) {
        const highScores = storage.highScoresByDifficulty;
        new TrophiesDialog(highScores, difficulty).show();
    }

    get title() { return Strings.str("trophiesDialogTitle"); }
    get isModal() { return false; }
    get dialogButtons() { return [this.x.elem]; }

    constructor(highScores, difficulty) {
        super({ rootElemClass: "trophies" });
        this.sections = [
            new HighScoresSection(highScores, difficulty),
            new AchievementsSection()
        ];

        this.contentElem = GameDialog.createContentElem();
        this.sections.forEach(item => {
            let section = document.createElement("section");
            section.append(document.createElement("h3").configure(h3 => h3.innerText = item.title));
            section.append(item.contentElem);
            this.contentElem.append(section);
        });

        this.x = new ToolButton({
            title: Strings.str("trophiesDialogDismiss"),
            click: () => this.dismiss()
        });
    }

    dismiss() {
        super.dismiss();
        this.sections.forEach(section => {
            if (typeof(section.dismissed) == 'function') {
                section.dismissed();
            }
        });
    }
}

class HighScoresSection {
    get title() { return Strings.str("highScoresDialogTitle"); }

    constructor(data, selected) {
        let elem = document.querySelector("body > highScores")
            .cloneNode(true).addRemClass("hidden", false);
        this.scores = elem.querySelector(".scores");

        this.buttons = [];
        let maxItems = Math.max(3, Math.min(10, data.difficulties.map(difficulty => difficulty.highScores.length).maxElement()));
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

                let highScore = this.highScoreElement(difficulty, elem.querySelector("scoreTemplate"), maxItems)
                    .addRemClass("highScores", true)
                    .addRemClass(this.classForDifficulty(index), true);
                this.scores.append(highScore);
            }
        });
        this.contentElem = elem;

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

    highScoreElement(difficulty, template, maxItems) {
        let highScores = document.createElement("ol");
        difficulty.highScores.slice(0, maxItems).forEach(highScore => {
            let item = template.querySelector("li").cloneNode(true);
            item.querySelector("name").innerText = highScore.playerName;
            item.querySelector("date").innerText = new Date(highScore.timestamp).toLocaleDateString("default", { dateStyle: "short" });
            item.querySelector("points").innerText = highScore.points;
            item.querySelector("stars").innerText = Game.formatStars(Game.starCount(highScore));
            highScores.append(item);
        });
        for (let index = difficulty.highScores.length; index < maxItems; index += 1) {
            let item = template.querySelector("li").cloneNode(true);
            highScores.append(item);
        }
        return highScores;
    }
} // end class HighScoresSection

class AchievementsSection {
    get title() { return Strings.str("achievementsDialogTitle"); }

    constructor() {
        this.contentElem = document.createElement("achievements");

        let achievements = Achievement.all;
        this.seen = achievements.filter(achievement => !achievement.seen);

        achievements = achievements.map(achievement => {
            let config = Game.content.achievements[achievement.id];
            let constructor = Achievement.allTypes[achievement.id];
            let viewModel = {
                id: achievement.id,
                status: achievement.status,
                seen: achievement.seen,
                date: new Date(achievement.date).toLocaleDateString("default", { dateStyle: "short" }),
                value: constructor ? constructor.formatValue(achievement) : achievement.value
            };
            if (!config) {
                debugWarn(`UI config not found for ${achievement.id}`);
                return viewModel;
            }
            viewModel.name = Strings.template(config.name, viewModel.value);
            viewModel.value = config.value ? Strings.template(config.value, viewModel.value) : viewModel.value;
            return viewModel;
        });

        let list = document.createElement("ul");
        let template = document.querySelector("achievementTemplate");
        achievements.forEach(achievement => {
            let li = this.achievementElement(achievement, template);
            if (li) list.append(li);
        });
        this.contentElem.append(list);
    }

    achievementElement(viewModel, template) {
        template = template.querySelector(`li.status-${viewModel.status}`);
        if (!template) { return null; }
        let elem = template.cloneNode(true).addRemClass("seen", viewModel.seen);
        this.innerText(elem.querySelector("name"), viewModel.name);
        this.innerText(elem.querySelector("date"), viewModel.date);
        this.innerText(elem.querySelector("value"), viewModel.value);
        return elem;
    }

    innerText(elem, text) {
        if (elem) { elem.innerText = text; }
    }

    dismissed() {
        this.seen.forEach(achievement => achievement.markAsSeen());
    }
} // end class AchievementsSection

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

function mark__Stories() {} // ~~~~~~ Stories ~~~~~~

class SweepStory {
    static Kvo() { return { "seen": "seen" }; }
    
    static initialize(config) {
        SweepStory.metrics = config;
    }
    
    constructor(config) {
        this.game = config.game;
        this.name = config.name.full;
        this.possessive = config.name.possessive;
        this.initials = config.name.initials;
        this.comment = config.comment;
        this.commentClass = config.commentClass;
        this.color = config.color;
        this.seen = false;
        this.kvo = new Gaming.Kvo(this);
    }
    
    render() {
        this.elem.style.borderColor = this.seen ? "" : this.color;
    }
}

class SweepStoriesView {
    constructor(config) {
        this.session = config.session;
        this.elem = config.elem;
        this.elem.addRemClass("hidden", true);
        this._isVisible = GameStorage.shared.storiesVisible;
        
        GameScriptEngine.shared.registerCommand("showStory", (subject, evt) => this.showStory(subject));
        GameScriptEngine.shared.registerCommand("setStoriesVisible", (subject, evt) => {
            this.isVisible = !!subject;
        });
        
        if (this.isEnabled) {
            let metrics = SweepStory.metrics;
            let games = Array.from(metrics.games).shuffle();
            let names = Array.from(Strings.value("randomNames", true)).shuffle();
            let comments = Array.from(Strings.value("randomComments", true)).shuffle();
            let commentClasses = Array.from(metrics.commentClasses).shuffle();
            
            this.stories = games.map((game, index) => {
                let hue = Gaming.Rng.shared.nextIntOpenRange(0, 360);
                let color = `hsl(${hue}, ${metrics.circle.s}, ${metrics.circle.l})`;
                let story = new SweepStory({
                    game: game,
                    name: names[index % names.length],
                    comment: comments[index % comments.length],
                    color: color,
                    commentClass: commentClasses[index % commentClasses.length]
                });
                story.kvo.seen.addObserver(this, () => this.render());
                return story;
            });
        } else {
            this.stories = [];
        }
        
        this.session.addDelegate(this);
    }
    
    get isEnabled() {
        return SweepStory.metrics.isAvailable;
    }
    
    get isVisible() {
        return this.isEnabled && !!this.session.game && this._isVisible;
    }
    
    set isVisible(value) {
        this._isVisible = value;
        GameStorage.shared.storiesVisible = value;
        this.render();
    }
    
    gameResumed() {
        this.render();
    }
    
    showStory(story) {
        if (UI.isShowingDialog()) { return; }
        story.kvo.seen.setValue(true);
        story.render();
        new StoryDialog(story).show();
    }
    
    configureView() {
        if (!!this.elem.querySelector("ul")) { return; }
        if (this.isEnabled) {
            let list = document.createElement("ul");
            this.stories.forEach(story => {
                let circle =  document.createElement("li");
                circle.innerText = story.initials;
                circle.addGameCommandEventListener("click", true, "showStory", story);
                list.append(circle);
                story.elem = circle;
            });
            this.x = new ToolButton({
                parent: list,
                title: Strings.str("storiesBarDismiss"),
                click: () => { this.isVisible = false; }
            });
            this.elem.append(list);
        }
    }
    
    render() {
        this.elem.addRemClass("hidden", !this.isVisible);
        if (!this.session.game) { return; }
        this.configureView();
        this.stories.forEach(story => {
            story.elem.style.borderColor = story.seen ? "" : story.color;
        });
    }
}

class StoryDialog extends GameDialog {
    constructor(story) {
        super();
        this.story = story;
        this.contentElem = GameDialog.createContentElem();
        
        let elem = document.querySelector("body > storyDialog")
            .cloneNode(true).addRemClass("hidden", false);
            
        this.player = new StoryGamePlayer({
            story: story,
            boardContainer: elem.querySelector("board")
        });
        
        elem.querySelector("comment").configure(comment => {
            comment.querySelector("span").innerText = this.story.comment;
            comment.addRemClass(story.commentClass, true);
        });

        this.contentElem.append(elem);
        this.x = new ToolButton({
            title: Strings.str("storyDialogDismiss"),
            click: () => this.dismiss()
        });
    }

    get isModal() { return false; }
    get title() { return Strings.template("storyDialogTitle", this.story); }

    get dialogButtons() {
        return [this.x.elem];
    }
    
    show() {
        super.show();
        if (this.player) { this.player.start(); }
    }
    
    dismiss() {
        super.dismiss();
        if (this.player) {
            this.player.end();
            this.player = null;
        }
    }
}

class StoryGamePlayer {
    constructor(config) {
        this.story = config.story;
        this.boardContainer = config.boardContainer;
        this.remainingMoves = Array.from(this.story.game.displayMoves);
        this.boardView = null;
        
        try {
            let object = Array.fromHexString(config.story.game.code);
            let game = Sharing.gameFromBoardObject(object);
            this.session = new GameSession({ game: game });
        } catch (e) {
            this.session = null;
            debugWarn(e);
        }
    }
    
    start() {
        if (!this.session) { return; }
        this.prep();
        this.boardView.render();
        setTimeout(() => this.nextMove(), this.randomMoveInterval());
    }
    
    prep() {
        this.story.game.flags.forEach(index => this.flag(index));
        this.story.game.prepMoves.forEach(index => this.reveal(index));
        this.boardView = new GameBoardView({ session: this.session, boardContainer: this.boardContainer, interactive: false });
    }
    
    randomMoveInterval() {
        return Gaming.Rng.shared.nextIntOpenRange(SweepStory.metrics.moveInterval.min, SweepStory.metrics.moveInterval.max);
    }
    
    nextMove() {
        if (!this.session || (this.remainingMoves.length == 0)) {
            this.end();
            return;
        }
        let index = this.remainingMoves.shift();
        this.reveal(index);
        setTimeout(() => this.nextMove(), this.randomMoveInterval());
    }
    
    getTile(index) {
        return this.session ? this.session.game.board._allTiles[index] : null;
    }
    
    flag(index) {
        let tile = this.getTile(index);
        if (!tile) { return; }
        let action = new SetFlagAction({ tile: tile, flag: TileFlag.assertMine });
        this.session.performAction(action);
    }
    
    reveal(index) {
        let tile = this.getTile(index);
        if (!tile) { return; }
        let action = new RevealTileAction({ tile: tile, revealBehavior: GameSession.revealBehaviors.safe });
        this.session.performAction(action);
    }
    
    end() {
        if (!this.session) { return; }
        this.session.removeAllDelegates();
        this.session = null;
        this.boardView = null;
    }
}

export let initialize = async function() {
    let version = import.meta.url.match(/sweep\/([0-9.]+)\//);
    if (version && version.length == 2) {
        Game.isProduction = true;
        Game.appVersion = version[1];
        Game.versionPath = `./${Game.appVersion}`;
    } else {
        Game.isProduction = false;
        Game.versionPath = ".";
    }
    
    let cachePolicy = Game.isProduction ? GameContent.cachePolicies.auto : GameContent.cachePolicies.forceOnFirstLoad;
    let content = await GameContent.loadYamlFromLocalFile(`${Game.versionPath}/sweep-content.yaml`, cachePolicy);
    if (!content) {
        alert(Strings.str("failedToLoadGameMessage"));
        return;
    }

    Strings.initialize(content.strings, content.pluralStrings, navigator.language);
    Game.initialize(content);
    if (!self.isWorkerScope && !!document.querySelector("moo")) {
        InteractiveSessionView.initialize();
    } else {
        debugLog("Sweep initialize: headless");
    }
    Gaming.debugExpose("Sweep", { Game: Game, InteractiveSessionView: InteractiveSessionView, GameStorage: GameStorage });
    Gaming.debugExpose("Gaming", Gaming);
    
    debugLog(`Touch-first: ${UI.isTouchFirst()}. Narrow-viewport: ${UI.isNarrowViewport()}`);
};
