"use-strict";

self.Sweep = (function() {

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, deserializeAssert = Gaming.deserializeAssert, directions = Gaming.directions, once = Gaming.once;

const FlexCanvasGrid = Gaming.FlexCanvasGrid;
const GameDialog = CitySim.GameDialog;
const InputView = CitySim.ControlViews.InputView;
const Point = Gaming.Point;
const Rect = Gaming.Rect;
const SaveStateItem = Gaming.SaveStateItem;
const SaveStateCollection = Gaming.SaveStateCollection;
const TextInputView = CitySim.ControlViews.TextInputView;
const TilePlane = Gaming.TilePlane;
const ToolButton = CitySim.ControlViews.ToolButton;

Number.uiPercent = function(ratio) {
    return Math.round(ratio * 100).toLocaleString() + "%";
};

class Strings {
    static str(id) {
        return Strings.items[id] || `?${id}?`;
    }
    static template(id, data) {
        var template = Strings.str(id);
        return template ? String.fromTemplate(template, data) : null;
    }
}
Strings.items = {
    "defaultPlayerName": "✷✷✷",
    "dialogDismissButton": "✖️",
    "difficultyChoiceLabelTemplate": "<name>",
    "gameSettingsDifficultyLabel": "Difficulty",
    "helpDialogTitle": "Help",
    "helpDismiss": "Thanks!",
    "highScoresDialogTitle": "✷ High Scores ✷",
    "highScoresDismiss": "Done",
    "newGameButton": "New Game",
    "newGameDialogStartButton": "Start",
    "newGameDialogTitle": "New Game",
    "playerNameInputTitle": "Your Name",
    "quitGameConfirmPrompt": "Are you sure you want to quit?",
    "resetBoardButton": "Reset",
    "saveHighScoreButton": "Save",
    "saveHighScoreDialogTitle": "You Won!",
    "showHelpButton": "Help",
    "showHighScoresButton": "High Scores",
};
CitySim.Strings.str = Strings.str;
CitySim.Strings.template = Strings.template;
// end class Strings

class TileFlag {
    constructor(present) {
        this.isPresent = present;
    }
}
TileFlag.none = new TileFlag(false);
TileFlag.assertMine = new TileFlag(true);
TileFlag.maybeMine = new TileFlag(true);
TileFlag.none.next = TileFlag.assertMine;
TileFlag.assertMine.next = TileFlag.maybeMine;
TileFlag.maybeMine.next = TileFlag.none;

class GameTile {
    constructor(coord, board) {
        this.coord = coord;
        this.board = board;
        this._mined = false;
        this._minedNeighborCount = 0;
        this._covered = true;
        this._flag = TileFlag.none;
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
    clearFlag() {
        this._flag = TileFlag.none;
        return this;
    }
    cycleFlag() {
        this._flag = this._flag.next;
        return this;
    }

    _boardConstructed() {
        this._minedNeighborCount = 0;
        this._covered = true;
        this._flag = TileFlag.none;
        this.visitNeighbors(neighbor => {
            if (neighbor.isMined) {
                this._minedNeighborCount += 1;
            }
        });
    }

    visitNeighbors(block) {
        let rect = new Rect(this.coord.x - 1, this.coord.y - 1, 3, 3);
        this.board.visitTiles(rect, tile => {
            if (tile != this) {
                block(tile, this);
            }
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
        // this._allTiles[3].cycleFlag();
        // this._allTiles[5].cycleFlag().cycleFlag();
        // this._allTiles[7]._covered = false;
        // this._allTiles[9]._covered = false;
        // this._allTiles[11]._covered = false;
        // this._allTiles[13]._covered = false;
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
        this._allTiles.forEach(tile => {
            tile.isCovered = true;
            tile.clearFlag();
        });
    }

    shuffle() {
        this._allTiles.forEach(tile => { tile.isMined = false; });
        let candidates = this._allTiles.map(tile => tile);
        candidates.shuffle();
        let mineTiles = candidates.slice(0, this.mineCount);
        mineTiles.forEach(tile => { tile.isMined = true; })
        this.visitTiles(null, tile => { tile._boardConstructed(); });
    }
} // end class GameBoard

class Game {
    static rules() {
        return {
            difficulties: [
                { index: 0, isDefault: false, name: "Beginner", width: 10, height: 10, mineCount: 8 },
                { index: 1, isDefault: true, name: "Intermediate", width: 24, height: 16, mineCount: 36 },
                { index: 2, isDefault: false, name: "Advanced", width: 32, height: 32, mineCount: 100 },
                { index: 3, isDefault: false, name: "Expert", width: 48, height: 32, mineCount: 200 }
            ]
        };
    }

    constructor(config) {
        this.difficulty = config.difficulty;
        this.board = new GameBoard({ size: config.difficulty, mineCount: config.difficulty.mineCount });
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
                stats.points += Math.pow(2, tile.minedNeighborCount);
            }
        });
        stats.progress = (stats.clearedTileCount + stats.assertMineFlagCount) / stats.totalTileCount;
        stats.progressPercent = Number.uiPercent(stats.progress);
        return stats;
    }
} // end class Game

GameState = {
    playing: 0,
    lost: 1,
    won: 2
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
        // debugLog(highScore);

        let data = this.highScoresByDifficulty;
        const difficultyIndex = data.difficulties.findIndex(item => item.difficulty.index == stats.difficulty.index);
        if (difficultyIndex < 0) {
            debugWarn("Can't find difficulty in highScoresCollection");
            return;
        }
        data.difficulties[difficultyIndex].highScores.push(highScore);
        data.difficulties[difficultyIndex].highScores.sort((a, b) => b.points - a.points);
        data.difficulties[difficultyIndex].highScores = data.difficulties[difficultyIndex].highScores.slice(0, 100);
        // debugLog(data);
        let item = new SaveStateItem(this.highScoresCollection.namespace, this.highScoresCollection.namespace, Date.now(), { highScoresByDifficulty: data });
        this.highScoresCollection.saveItem(item, {});
        // this.hsc = data;

        this.lastPlayerName = highScore.playerName;
    }

    get highScoresByDifficulty() {
        // if (this.hsc) { return this.hsc; }
        let item = this.highScoresCollection.getItem(this.highScoresCollection.namespace);
        // if (item) {
        //     this.highScoresCollection.deleteItem(this.highScoresCollection.namespace);
        //     item = null;
        // }
        if (item) {
            return item.data.highScoresByDifficulty;
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

// handles UI interactions
class GameSession {
    static quit(prompt) {
        if (!prompt || confirm(Strings.str("quitGameConfirmPrompt"))) {
            window.location = "index.html";
        }
    }

    constructor(config) {
        this.game = config.game;
        this.state = GameState.playing;
        this.isFirstMove = true;
        this.elems = {
            boardContainer: document.querySelector("board")
        };
        this.controlsView = GameSession.controlsView;
        this.controlsView.session = this;
        this.boardView = new GameBoardView({ session: this, boardContainer: this.elems.boardContainer });
        this.statusView = new GameStatusView({ session: this, elem: document.querySelector("footer") });
        this.views = [this.controlsView, this.boardView, this.statusView];
    }

    start() {
        GameStorage.shared.lastDifficultyIndex = this.game.difficulty.index;
        this.state = GameState.playing;
        this.startTime = Date.now();
        this.endTime = null;
        this.isFirstMove = true;
        this.elems.boardContainer.addRemClass("hidden", false);
        this.renderViews();
    }

    resetBoard() {
        if (this.state != GameState.playing) { return; }
        this.game.board.reset();
        this.start();
    }

    renderViews() {
        this.views.forEach(view => view.render());
    }

    cycleFlag(point) {
        if (this.state != GameState.playing) { return; }
        let tile = this.game.board.tileAtCoord(point);
        if (!tile) { return; }
        this.isFirstMove = false;
        if (!tile.isCovered) { return; }
        tile.cycleFlag();
        this.checkForWin();
        this.renderViews();
    }

    attemptReveal(point, assertTrustingFlags) {
        let tile = this.game.board.tileAtCoord(point);
        if (tile) {
            let revealBehavior = assertTrustingFlags ? GameSession.revealBehaviors.assertTrustingFlags : GameSession.revealBehaviors.safe;
            this.attemptRevealTile(tile, revealBehavior);
            this.checkForWin();
            this.renderViews();
        }
    }

    attemptRevealTile(tile, revealBehavior) {
        if (this.state != GameState.playing) { return; }
        if (!tile) { return; }

        while (this.isFirstMove && tile.isMined) {
            debugLog("Clicked a mine on first move. Shuffling.");
            this.game.board.shuffle();
        }
        this.isFirstMove = false;

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
        // if (revealBehavior == GameSession.revealBehaviors.assertFlag && tile.flag.isPresent && !tile.isMined) {
        //     this.incorrectFlagAsserted(tile);
        //     return;
        // }
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
        this.state = GameState.lost;
        this.endTime = Date.now();
        tile.isCovered = false;
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
                this.session.cycleFlag(modelCoord);
            } else {
                let assertTrustingFlags = inputSequence.latestEvent.altKey || inputSequence.latestEvent.metaKey;
                // debugLog(inputSequence.latestEvent);
                this.session.attemptReveal(modelCoord, assertTrustingFlags);
            }
        }
    }
}

class GameControlsView {
    constructor(config) {
        this._session = null;
        this.elem = config.elem;
        this.buttons = null;
    }

    get session() { return this._session; }
    set session(value) {
        this._session = value;
    }

    render() {
        if (!this.buttons) {
            this.buttons = [
                new ToolButton({
                    parent: this.elem,
                    title: Strings.str("newGameButton"),
                    click: () => this.newGame()
                }),
                new ToolButton({
                    parent: this.elem,
                    title: Strings.str("resetBoardButton"),
                    click: () => this.resetBoard()
                }),
                new ToolButton({
                    parent: this.elem,
                    title: Strings.str("showHelpButton"),
                    click: () => this.showHelp()
                }),
                new ToolButton({
                    parent: this.elem,
                    title: Strings.str("showHighScoresButton"),
                    click: () => this.showHighScores()
                }),
            ];
        }
    }

    newGame() {
        new NewGameDialog().show();
    }

    resetBoard() {
        if (this.session) {
            // prompt are you sure
            this.session.resetBoard();
        }
    }

    showHelp() {
        new HelpDialog().show();
    }

    showHighScores() {
        const highScores = GameStorage.shared.highScoresByDifficulty;
        new HighScoresDialog(highScores).show();
        // debugLog(GameStorage.shared.highScoresByDifficulty);
    }
}

class GameStatusView {
    constructor(config) {
        this.session = config.session;
        this.elem = config.elem;
    }

    render() {
        this.elem.innerText = String.fromTemplate(this.statusTemplate, this.session.game.statistics);
    }

// TODO show elapsed time
    get statusTemplate() {
        switch (this.session.state) {
        case GameState.playing:
            return "<points> pts | <progressPercent> tiles complete | <assertMineFlagCount>/<mineCount> mines flagged";
        case GameState.lost:
            return "Lost! <points> pts, <progressPercent> tiles completed";
        case GameState.won:
            return "Won! <points> pts, <mineCount> mines cleared";
        }
    }
}

class GameBoardView {
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
GameBoardView.metrics = {
    tileWidth: 24
};
// end class GameBoardView

class GameTileView {
    constructor(model, boardView) {
        this.model = model; // GameTile
        this.boardView = boardView;
    }

    render(context) {
        const ctx = context.ctx;
        const rect = context.tilePlane.screenRectForModelTile(this.model.coord);
        const ext = rect.extremes;
        ctx.font = "bold 32px monospace";

        if (this.model.isCovered) {
            this.renderCovered(context, rect);
        } else {
            this.renderRevealed(context, rect);
        }

        // borders
        ctx.strokeStyle = "#111111"; //flag this.model.isCovered ? "#111111" : "#666666";
        ctx.lineWidth = 1;
        if (this.model.coord.x > 0) {
            ctx.beginPath();
            ctx.moveTo(ext.min.x, ext.min.y);
            ctx.lineTo(ext.min.x, ext.max.y);
            ctx.stroke()
        }
        if (this.model.coord.y > 0) {
            ctx.beginPath();
            ctx.moveTo(ext.min.x, ext.max.y);
            ctx.lineTo(ext.max.x, ext.max.y);
            ctx.stroke()
        }

        if (this.model.isCovered) {
            ctx.strokeStyle = "#eeeeee";
            ctx.beginPath();
            ctx.moveTo(ext.min.x, ext.min.y + 1);
            ctx.lineTo(ext.max.x - 1, ext.min.y + 1);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(ext.max.x - 1, ext.min.y + 1);
            ctx.lineTo(ext.max.x - 1, ext.max.y);
            ctx.stroke();
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
}

class GameTileViewState {
    constructor(config) {
        this.fillColor = config.fillColor;
        if (typeof(config.text) === 'function') {
            this.text = config.text;
        } else {
            this.text = tile => config.text;
        }
        this.textColor = config.textColor;
    }

    render(context, rect, tile) {
        context.ctx.fillStyle = this.fillColor;
        context.ctx.rectFill(rect);
        let textValue = this.text(tile);
        if (textValue) {
            context.ctx.fillStyle = this.textColor;
            context.ctx.fillTextCentered(textValue, rect);
        }
    }
}
GameTileViewState.coveredColor = "#cecece";
GameTileViewState.revealedColor = "#ececec";
GameTileViewState.incorrectColor = "#ffcccc";
GameTileViewState.covered = new GameTileViewState({ fillColor: GameTileViewState.coveredColor, text: null });
GameTileViewState.assertMine = new GameTileViewState({ fillColor: GameTileViewState.coveredColor, text: "▲", textColor: "#ff3300" });
GameTileViewState.maybeMine = new GameTileViewState({ fillColor: GameTileViewState.coveredColor, text: "?", textColor: "#0033ff" });
GameTileViewState.clear = new GameTileViewState({ fillColor: GameTileViewState.revealedColor, text: null });
GameTileViewState.safe = new GameTileViewState({ fillColor: GameTileViewState.revealedColor, text: tile => `${tile.minedNeighborCount}`, textColor: "#666666" });
GameTileViewState.mineTriggered = new GameTileViewState({ fillColor: GameTileViewState.incorrectColor, text: "✸", textColor: "#990000" });
GameTileViewState.mineRevealed = new GameTileViewState({ fillColor: "#999999", text: "✷", textColor: "#000000" });
GameTileViewState.incorrectFlag = new GameTileViewState({ fillColor: GameTileViewState.incorrectColor, text: "✖︎", textColor: "#990000" });

class NewGameDialog extends GameDialog {
    constructor() {
        super();
        this.startButton = new ToolButton({
            title: Strings.str("newGameDialogStartButton"),
            click: () => this.validateAndStart()
        });
        this.contentElem = GameDialog.createContentElem();
        var formElem = GameDialog.createFormElem();

        let defaultDifficultyIndex = GameStorage.shared.lastDifficultyIndex;
        if (!(defaultDifficultyIndex >= 0)) {
            defaultDifficultyIndex = Game.rules().difficulties.findIndex(difficulty => !!difficulty.isDefault);
        }
        this.difficulties = new CitySim.ControlViews.SingleChoiceInputCollection({
            id: "difficulty",
            parent: formElem,
            title: Strings.str("gameSettingsDifficultyLabel"),
            validationRules: [CitySim.ControlViews.SingleChoiceInputCollection.selectionRequiredRule],
            choices: Game.rules().difficulties.map(difficulty => { return {
                title: Strings.template("difficultyChoiceLabelTemplate", difficulty),
                value: difficulty.index,
                selected: difficulty.index == defaultDifficultyIndex
            }; })
        });

        this.contentElem.append(formElem);
        this.allInputs = [this.difficulties];
    }

    get isModal() { return true; }

    get title() { return Strings.str("newGameDialogTitle"); }

    get dialogButtons() {
        return [this.startButton.elem];
    }

    get isValid() {
        return this.allInputs.every(input => input.isValid);
    }

    get difficulty() {
        return Game.rules().difficulties[this.difficulties.value];
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
        GameSession.quit(false);
    }
} // end class NewGameDialog

class SaveHighScoreDialog extends GameDialog {
    constructor(session) {
        super();
        this.session = session;
        this.saveButton = new ToolButton({
            title: Strings.str("saveHighScoreButton"),
            click: () => this.save()
        });
        this.contentElem = GameDialog.createContentElem();
        var formElem = GameDialog.createFormElem();
        
        this.playerNameInput = new TextInputView({
            parent: formElem,
            title: Strings.str("playerNameInputTitle"),
            placeholder: "",
            transform: (value) => InputView.trimTransform(value).toLocaleUpperCase(),
            // Count emoji as single characters
            validationRules: [InputView.notEmptyOrWhitespaceRule, (input) => [...(input.value)].length <= 3]
        }).configure(input => input.value = GameStorage.shared.lastPlayerName);

        this.contentElem.append(formElem);
        this.allInputs = [this.playerNameInput];
    }

    get isModal() { return true; }
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
        if (!this.isValid) {
            debugLog("NOT VALID");
            return;
        }
        GameStorage.shared.addHighScore(this.session, this.playerName);
        this.dismiss();
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

class HighScoresDialog extends GameDialog {
    constructor(data) {
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
            this.buttons.push(new ToolButton({
                id: "",
                parent: elem.querySelector(".difficulties row"),
                title: difficulty.difficulty.name,
                click: () => this.selectDifficulty(index)
            }));

            let highScore = this.highScoreElement(difficulty, elem.querySelector("scoreTemplate"))
                .addRemClass("highScores", true)
                .addRemClass(this.classForDifficulty(index), true);
            this.scores.append(highScore);
        });

        const first = data.difficulties.findIndex(item => item.highScores.length > 0);
        this.selectDifficulty(first >= 0 ? first : 0);
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
            difficulty.highScores.forEach(highScore => {
                let item = template.querySelector("li").cloneNode(true);
                item.querySelector("name").innerText = highScore.playerName;
                item.querySelector("date").innerText = new Date(highScore.timestamp).toLocaleDateString("default", { dateStyle: "short" });
                item.querySelector("points").innerText = highScore.points;
                highScores.append(item);
            });
            return highScores;
        }
    }

    get isModal() { return false; }
    get title() { return Strings.str("highScoresDialogTitle"); }
    get dialogButtons() { return [this.x.elem]; }
} // end class HighScoresDialog

var initialize = function() {
    GameSession.controlsView = new GameControlsView({ elem: document.querySelector("header row") });
    // new SaveHighScoreDialog(null).show();
    new NewGameDialog().show();
};

return {
    initialize: initialize,
    session: null,
};

})(); // end Sweep namespace

Sweep.initialize();
