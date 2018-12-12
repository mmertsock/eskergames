"use-strict";

/*
minesweeper and logic circuits
http://web.mat.bham.ac.uk/R.W.Kaye/minesw/minesw.pdf
http://web.mat.bham.ac.uk/R.W.Kaye/minesw/minesw.htm
http://www.formauri.es/personal/pgimeno/compurec/Minesweeper.php

"infinite minesweeper"
mentioned in the links above
Maybe an Infinite Minesweeper game? The game would have no board size parameters,
only a density parameter. Start at the "origin" of an infinite grid. And you just 
play forever in any direction. Can pan and zoom the board. Recursive clearing of 
zero-tiles: maybe only recursively clear until you're within one tile of the edge 
of the current viewport. Or, only recursively clear tiles less than X manhattan-
distance from the clicked tile. Generate the mines in the board on-demand, only
generating tiles within X distance (based on the recursive-clearing rule) from
the viewport. Don't allow panning too far away from current play area, or zooming
out too far, to put a limit on the amount of board generated. Have buttons to 
reset the viewport: center-on-last-clicked-tile, center-at-origin, zoom-out-to-
show-everything. What's needed to implement?
- On-demand board generation algorithm. It is solvable, right?
- Updates to the Options UI
- Buttons to reset location/jump to last tile/etc.
- Drag event handler for panning. Scroll event handler for zooming
- Keyboard event handlers for arrow keys, etc., for navigation convenience
- Zoom functionality: could implement by just changing the pixels-per-tile 
  of the CanvasGrid while keeping the canvas element itself fixed size?
- Undo stack, so you don't have to start from scratch on a single bad click
- Changes to the Hint algorithm: favor tiles near the last-played-tile, then 
  favor tiles in the "interior" of the currently-played area
*/


// TODO
// Use local-storage to remember last gameSettings value, maybe remember entire game state
//   (maybe need to store and restore the current random-seed too?)
// Logarithmic slider, so the mine count selector is more useful
//   (could cheat by keeping the slider itself linear, and logarithmic-ize the max 
//   value configured in the slider and then exponentize the output value when 
//   converting it to a mine count)
// Mobile friendly: learn how mobile JS canvas/touch/etc works.
//   Layout and touch handling probably the two big things. 
// If a tile has too many adjacent flags, color all of its flagged tiles yellow
/* other ideas
Seedable RNG https://stackoverflow.com/questions/424292/seedable-javascript-random-number-generator
- would allow repeating or identifying a specific game board
Different game modes:
- Traverse corner to corner: new game starts with top left tile always revealed,
  and bottom right tile marked with a finish flag or something. Only allow clicking 
  tiles that are adjacent to an already-cleared tile. Do we recursively
  reveal when clicking a zero-adjacent-mine tile? When generating the game board,
  ensure there is a traversable path from corner to corner; if not, retry the board gen.
*/

window.Minesweeper = (function () {

var Renderer = function(config) { // config = canvas: (elem), controlPanel: (elem)
    this.canvas = config.canvas;
    this.pixelRatio = HTMLCanvasElement.getDevicePixelScale();
    this.hintButton = config.controlPanel.querySelector(".hint");
    this.newGameButton = config.controlPanel.querySelector(".startNewGame");
    this.resetButton = config.controlPanel.querySelector(".reset");
    this.gameStateLabel = config.controlPanel.querySelector("gameState");
    this.minesLabel = config.controlPanel.querySelector("mineState");
    this.canvasGrid = null;
    this.game = null;
    this.adjacentMineHues = [0, 238, 204, 170, 136, 102, 68, 34, 0];

    this.initialize = function(game) {
        this.game = game;
        this.canvasGrid = new Gaming.CanvasGrid({
            rows: this.game.settings.rows,
            columns: this.game.settings.columns,
            tileWidth: 25 * this.pixelRatio,
            tileSpacing: 4 * this.pixelRatio,
        });
        this.canvasGrid.initialize(this.canvas);
        this.gameStateLabel.innerText = "";
    };

    this.render = function() {
        var ctx = this.canvas.getContext("2d");
        ctx.font = (this.canvasGrid.tileWidth * 0.75) + "px 'SF Mono', Menlo, monospace";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.canvasGrid.visitEachLocation(function (location, rect) {
            this.renderTile(ctx, rect, this.game.getTile(location));
        }.bind(this));

        if (this.game.lastLocationRevealed) {
            ctx.strokeStyle = "#333333";
            ctx.lineJoin = "miter";
            ctx.lineWidth = 2;
            ctx.rectStroke(this.canvasGrid.rectForTile(this.game.lastLocationRevealed));
        }

        this.gameStateLabel.innerText = this.gameStateText();

        var isNotPlaying = this.game.state != Game.states.playing;
        this.minesLabel.addRemClass("hidden", isNotPlaying);
        this.hintButton.addRemClass("hidden", isNotPlaying);
        this.newGameButton.addRemClass("hidden", this.game.state == Game.states.notStarted);
        this.resetButton.addRemClass("hidden", this.game.state == Game.states.notStarted);

        if (this.game.state == Game.states.playing) {
            var flagCount = this.game.flagCount();
            this.minesLabel.addRemClass("warning", flagCount > this.game.settings.mines);
            this.minesLabel.addRemClass("perfect", flagCount == this.game.settings.mines);
            this.minesLabel.innerText = this.game.settings.mines + " mines, " + flagCount + " flagged";
        }
    };

    this.renderTile = function(ctx, rect, tile) {
        if (!tile) {
            ctx.fillStyle = "#bbbbbb";
            ctx.rectFill(rect);
            return;
        }

        switch (tile.state) {
            case Tile.states.covered:
                ctx.fillStyle = "#bbbbbb";
                break;
            case Tile.states.cleared:
                ctx.fillStyle = tile.isMine ? "#993333" : "#dddddd";
                break;
            case Tile.states.badFlag:
                ctx.fillStyle = "#ff0000";
                break;
            case Tile.states.exploded:
                ctx.fillStyle = "#ff0000";
                break;
        }
        ctx.rectFill(rect);

        if (tile.state == Tile.states.badFlag) {
            ctx.fillStyle = "#330000";
            this.fillText(ctx, "X", rect);
        }

        if (tile.state == Tile.states.exploded) {
            ctx.fillStyle = "#330000";
            this.fillText(ctx, "#", rect);
        }

        if (tile.state == Tile.states.cleared && !tile.isMine && tile.adjacentMineCount > 0 && tile.adjacentMineCount < 9) {
            ctx.fillStyle = "hsl(" + this.adjacentMineHues[tile.adjacentMineCount] + ", 60%, 30%)"
            this.fillText(ctx, tile.adjacentMineCount, rect);
        }

        if (tile.state == Tile.states.covered && tile.isFlagged) {
            ctx.fillStyle = "hsl(0, 75%, 50%)"
            this.fillText(ctx, "!", rect);
        }
    };

    this.fillText = function(ctx, text, rect) {
        ctx.fillText(text, rect.x + 0.5 * rect.width, rect.y + 0.5 * rect.height);
    };

    this.gameStateText = function() {
        switch (this.game.state) {
            case Game.states.notStarted:
                return "Click a tile to begin.";
            case Game.states.playing:
                return "Playing";
            case Game.states.won:
                return "Won!";
            case Game.states.lost:
                return "Lost!";
        }
    };

    this.selectedTile = function(x, y, togglingFlag) {
        if (!this.game) {
            return;
        }
        var location = this.canvasGrid.tileForPoint(x, y);
        if (location) {
            if (togglingFlag) {
                this.game.toggleFlag(location);
            } else {
                this.game.reveal(location);
            }
        }
    };

    this.canvas.addEventListener("click", function(event) {
        event.preventDefault();
        this.selectedTile(event.offsetX * this.pixelRatio, event.offsetY * this.pixelRatio, event.shiftKey);
    }.bind(this));

    this.hintButton.addEventListener("click", function(event) {
        event.preventDefault();
        this.game.showHint();
    }.bind(this));

    this.newGameButton.addEventListener("click", function (event) {
        event.preventDefault();
        if (this.game.state == Game.states.playing) {
            new Gaming.Prompt({
                title: "New Game",
                message: "Start a new game?",
                buttons: [
                    {
                        label: "Yes",
                        classNames: ["warning"],
                        action: function() { Minesweeper.gameOptions.startGame(); }
                    },
                    { label: "No" }
                ]
            }).show();
        } else {
            Minesweeper.gameOptions.startGame();
        }
    }.bind(this));

    this.resetButton.addEventListener("click", function(event) {
        event.preventDefault();
        if (this.game.state == Game.states.playing) {
            new Gaming.Prompt({
                title: "Start Over?",
                message: "Are you sure you want to start over?",
                buttons: [
                    {
                        label: "Start Over", action: function() {
                            this.game.resetBoard();
                        }.bind(this),
                        classNames: ["warning"]
                    },
                    { label: "Keep Playing" }
                ]
            }).show();
        } else {
            this.game.resetBoard();
        }
    }.bind(this));
};

// Only one instance per page load
var GameOptions = function(config) { // {template: (elem), optionsButton}
    this.template = config.template;
    this.optionsButton = config.optionsButton;
    this.currentPrompt = null;
    this.gameSettings = null;

    this.presets = [
        { name: "Beginner",     rows:  9, columns:  9, mines: 10 },
        { name: "Intermediate", rows: 16, columns: 16, mines: 40 },
        { name: "Advanced",     rows: 16, columns: 30, mines: 99 }
    ];

    this.minBoardDensity = 0.05;
    this.maxBoardDensity = 0.8;
    this.getMines = function(density, settings) {
        var slots = settings.rows * settings.columns;
        return slots > 0 ? Math.round(settings.rows * settings.columns * density) : 10;
    };
    this.getDensity = function(mines, settings) {
        var slots = settings.rows * settings.columns;
        return slots > 0 ? mines / (settings.rows * settings.columns) : 0.5;
    };

    this.pickSetting = function(newSettings) {
        this.gameSettings = Object.assign({}, newSettings);
        if (this.currentPrompt) {
            this.currentPrompt.didPickSetting(this.gameSettings);
        }
    };

    function OptionsPrompt(config) { // {template:(elem), gameOptions: GameOptions}
        this.gameOptions = config.gameOptions;
        this.panel = config.template.cloneNode(true).addRemClass("hidden", false);
        this.controls = {};

        this.outputs = {
            size: this.panel.querySelector("size value"),
            mines: this.panel.querySelector("density value")
        };

        this.displayed = function() {
            this.gameOptions.presets.forEach(function (preset) {
                var button = document.createElement("a");
                button.href = "#";
                button.innerText = preset.name;
                button.addEventListener("click", function(event) {
                    event.preventDefault();
                    this.gameOptions.pickSetting(preset);
                }.bind(this));
                this.panel.querySelector("buttons.presets").append(button);
            }.bind(this));

            this.controls.density = new Gaming.Slider({
                canvas: this.panel.querySelector("density canvas"),
                min: this.gameOptions.minBoardDensity,
                max: this.gameOptions.maxBoardDensity,
                value: 0.2,
                onchange: function(slider) {
                    var settings = Object.assign({}, this.gameOptions.gameSettings);
                    settings.mines = this.gameOptions.getMines(slider.value, settings);
                    this.gameOptions.pickSetting(settings);
                }.bind(this)
            });

            var pixelRatio = HTMLCanvasElement.getDevicePixelScale();
            this.controls.size = new Gaming.RectSlider({
                canvas: this.panel.querySelector("size canvas"),
                tileWidth: 5 * pixelRatio,
                tileSpacing: 1 * pixelRatio,
                min: { rows: 9, columns: 9 },
                max: { rows: 48 /*24*/, columns: 30 },
                value: { rows: 16, columns: 16 },
                onchange: function(slider) {
                    var settings = Object.assign({}, this.gameOptions.gameSettings, slider.value);
                    settings.mines = this.gameOptions.getMines(this.controls.density.value, settings);
                    this.gameOptions.pickSetting(settings);
                }.bind(this)
            });

            this.didPickSetting(this.gameOptions.gameSettings);
        };

        this.didPickSetting = function(newSettings) {
            this.outputs.size.innerText = newSettings.rows + " x " + newSettings.columns;
            this.outputs.mines.innerText = newSettings.mines;
            this.controls.density.setValue(this.gameOptions.getDensity(newSettings.mines, newSettings));
            this.controls.size.setValue({ rows: newSettings.rows, columns: newSettings.columns });
        };

        this.show = function() {
            new Gaming.Prompt({
                customContent: this.panel,
                dismissed: this.gameOptions.dismissed.bind(this.gameOptions),
                buttons: [
                    { label: "Start Game", action: this.gameOptions.startGame.bind(this.gameOptions), classNames: ["go"] },
                    { label: "Cancel" }
                ]
            }).show();
            this.displayed();
        };
    }

    this.show = function(event) {
        if (event) { event.preventDefault(); }
        if (!this.currentPrompt) {
            if (Minesweeper.game) {
                this.pickSetting(Minesweeper.game.settings);
            }
            this.currentPrompt = new OptionsPrompt({template: this.template, gameOptions: this});
            this.currentPrompt.show();
        }
    };

    this.dismissed = function() {
        this.currentPrompt = null;
    };

    this.startGame = function() {
        this.dismissed();
        Minesweeper.game = new Game({
            settings: this.gameSettings,
            renderer: Minesweeper.renderer
        });
        Minesweeper.game.start();
    };

    this.optionsButton.addEventListener("click", this.show.bind(this));
    this.pickSetting(this.presets[1]);
    this.startGame();
};

// ----------------------------------------------------------------------

var Tile = function(config) { // row, column, isMine
    this.row = config.row;
    this.column = config.column;
    this.isMine = config.isMine;
    this.isFlagged = false;
    this.adjacentMineCount = -1;
    this.state = null; // see Tile.states
    this.game = null;

    this.setState = function(newState) {
        this.state = newState;
        if (this.state != Tile.states.covered) {
            this.isFlagged = false;
        }
    };

    this.visitAdjacents = function(visitor) {
        for (var r = -1; r <= 1; r++) {
             for (var c = -1; c <= 1; c++) {
                if (r == 0 && c == 0) { continue; }
                //if (!includeDiagonals && r != 0 && c != 0) { continue; }
                var location = { row: this.row + r, column: this.column + c };
                var tile = this.game.getTile(location);
                if (tile) {
                    visitor(tile);
                }
            }
        }
    };

    this.initialize = function(game) {
        this.game = game;
        this.state = Tile.states.covered;
        this.adjacentMineCount = 0;
        this.visitAdjacents(function (tile) {
            this.adjacentMineCount += tile.isMine ? 1 : 0;
        }.bind(this));
    };

    this.debugDescription = function() {
        var str = "(" + this.row + ", " + this.column + "), " + this.state + ", @" + this.isMine + " #" + this.adjacentMineCount;
        if (this.state == Tile.states.covered && this.isFlagged) {
            str += " !flagged";
        }
        return str;
    };
};

Tile.states = {
    covered: "covered",
    cleared: "cleared",
    badFlag: "badFlag",
    exploded: "exploded"
};

var Game = function(config) { // config = settings: (rows,columns,mines), renderer: Renderer
    this.settings = config.settings;
    this.renderer = config.renderer;
    this.tiles = undefined; // 2D array; tiles[row][column].
    this.state = Game.states.notStarted;
    this.lastLocationRevealed = null;

    this.start = function() {
        this.renderer.initialize(this);
        this.renderer.render();
    };

    this.flagCount = function() {
        var flagCount = 0;
        this.visitTiles(function (tile) {
            if (tile.isFlagged) { flagCount += 1; }
        });
        return flagCount;
    };

    this.reveal = function(location) {
        if (!this.tiles) {
            this.buildTiles(location);
        }
        var tile = this.getTile(location);
        if (!tile || tile.isFlagged) {
            return false;
        }
        if (this.doReveal(tile, false)) {
            this.lastLocationRevealed = location;
            if (tile.state == Tile.states.exploded) {
                console.log("Lost! " + tile.debugDescription());
                this.lose();
            } else if (this.checkForWin()) {
                console.log("Won!" + tile.debugDescription());
            }
            this.renderer.render();
        } // else if (tile) {
//            console.log("(already revealed) + " + tile.debugDescription());
//        }
    };

    this.doReveal = function(tile, onlySafeTiles) {
        if (tile.state != Tile.states.covered || this.state != Game.states.playing) { return false; }
        tile.setState(tile.isMine ? Tile.states.exploded : Tile.states.cleared);

        if (tile.state == Tile.states.cleared && tile.adjacentMineCount == 0) {
            tile.visitAdjacents(function (adj) {
                this.doReveal(adj, true);
            }.bind(this));
        }

        this.checkForWin();
        return true;
    };

    this.toggleFlag = function(location) {
        var tile = this.getTile(location);
        if (!tile || this.state != Game.states.playing) { return; }
        if (tile.state == Tile.states.covered) {
            tile.isFlagged = !tile.isFlagged;
            this.renderer.render();
        } else if (tile.state == Tile.states.cleared && tile.adjacentMineCount > 0) {
            this.attemptToClearNonFlaggedAdjacents(tile);
        }
    };

    this.attemptToClearNonFlaggedAdjacents = function(tile) {
        var surroundingFlags = 0;
        tile.visitAdjacents(function (adj) {
            if (adj.isFlagged && adj.state == Tile.states.covered) {
                surroundingFlags += 1;
            }
        });

        if (surroundingFlags != tile.adjacentMineCount) {
            console.log("Won't clear adjacents: incorrect number of flags.");
            return;
        }

        // clear covered non-flagged adjacents.
        // lose if wrong. also check for win
        this.lastLocationRevealed = tile;
        tile.visitAdjacents(function (adj) {
            if (adj.state == Tile.states.covered && !adj.isFlagged) {
                this.doReveal(adj, true);
                if (adj.state == Tile.states.exploded) {
                    this.lose();
                }
            }
        }.bind(this));

        if (this.checkForWin()) {
            console.log("Won!" + tile.debugDescription());
        }

        this.renderer.render();
    }

    this.resetBoard = function() {
        if (this.state == Game.states.notStarted) {
            return;
        }
        this.state = Game.states.playing;
        this.lastLocationRevealed = null;
        this.visitTiles(function (tile) {
            tile.setState(Tile.states.covered);
            tile.isFlagged = false;
        }.bind(this));
        this.renderer.render();
    }

    this.showHint = function() {
        if (this.state != Game.states.playing) {
            return;
        }

        // Try to pick a non-mine adjacent to a clear tile first. If none available,
        // pick a random non-mine.
        var tilesAdjacentToClears = [];
        var interiorTiles = [];

        /*
        New algorithm. Calculate a score by which to prioritize hint tiles.
        Things to check:
        - It's possible to deduce the tile should be cleared based on what's visible on the board*
            (teaching the player how to do the proper game logic. Also, allows demoing the game AI)
        - Candidate for the clear-adjacents-when-toggling-flags thing
            (currentnly covered, but adjacent to a tile with correct # of flagged neighbors)
        - Adjacent to any cleared tile
        - Adjacent to a tile cleared by the player, not via hint
        - Diagonal vs straight neighborness (add a new param to the visitAdjacents callback)

        *deduction logic: "prove that tile T is not a mine"
        Initial checks:
        - If there's a cleared adjacent with adj count == 0, then NOT MINE.
        Do some simple checks to prove it must be a mine:
        - For each cleared adjacent A:
            - If the # of A's covered adjacents == A.adjacentMineCount, then MUST BE MINE.**
            - Count adjacents of A that are correctly flagged by user or marked MUST BE MINE above.
                If count == A.adjacentMineCount, then NOT MINE.***
        Can recurse the above. Each level of recursion counts as another level of look-ahead and thus
        lower priority for hinting.

        More logic:
        
        ----- (border)  Top tile has exactly two candidates for a single mine.
        ?10             Thus, center tile's single mine is one of those spots,
        ?10             and we know the bottom three must not be mines.
        ???

        Examples of above algorithm:
        T is in the center.
        0-9 = clear with adjacent count. * = hidden mine. ! = flag. M = previously marked by algorithm
        ** example:  *** example:
        111          111  (top center
        1T1          MT-  requires T to be clear.)
        111          ---
        */

        this.visitTiles(function (tile) {
            if (tile.state != Tile.states.covered) { return; }
            if (tile.isMine || tile.isFlagged || tile.adjacentMineCount == 0 ) {
                return;
            }
            var hasClearAdjacent = false;
            tile.visitAdjacents(function (adj) {
                if (adj.state == Tile.states.cleared) { hasClearAdjacent = true; }
            });
            (hasClearAdjacent ? tilesAdjacentToClears : interiorTiles).push(tile);
        }.bind(this));

        var candidateTiles = tilesAdjacentToClears.length > 0 ? tilesAdjacentToClears : interiorTiles;
        if (candidateTiles.length == 0) {
            console.log("No hints to show.");
            return;
        }

        // Now reveal the tile
        // Another way to do this: temporarily reveal the tile then hide it, so you can
        // choose whether to actually reveal it. Disable board interactivity while hint is visible.

        var tile = candidateTiles.shuffle()[0];
        this.lastLocationRevealed = tile;
        tile.setState(Tile.states.cleared);
        if (this.checkForWin()) {
            console.log("Won via hint." + tile.debugDescription());
        }
        this.renderer.render();
    }

    this.lose = function() {
        this.state = Game.states.lost;
        this.revealAllTiles(true);
    };

    this.checkForWin = function() {
        if (this.state != Game.states.playing) {
            return this.state == Game.states.won;
        }

        var anyCoveredNonMineTile = false;
        var anyExplodedTile = false;
        this.visitTiles(function (tile) {
            if (tile.state == Tile.states.covered && !tile.isMine) { anyCoveredNonMineTile = true; }
            if (tile.state == Tile.states.exploded) { anyExplodedTile = true; }
        });
        if (!anyCoveredNonMineTile && !anyExplodedTile) {
            this.state = Game.states.won;
            this.revealAllTiles(false);
            return true;
        } else {
            return false;
        }
    };

    this.revealAllTiles = function(minesOnly) {
        this.visitTiles(function (tile) {
            if (tile.state == Tile.states.covered) {
                if (tile.isFlagged && tile.isMine) {
                    // leave it covered.
                } else if (tile.isFlagged && !tile.isMine) {
                    tile.setState(Tile.states.badFlag);
                } else if (tile.isMine || !minesOnly) {
                    tile.setState(Tile.states.cleared);
                }
            }
        });
    };

    this.getTile = function(location) {
        if (!this.tiles) { return null; }
        if (location.row < 0 || location.column < 0 || location.row >= this.tiles.length || location.column >= this.tiles[0].length) {
            return null;
        }
        return this.tiles[location.row][location.column];
    };

    this.visitLocations = function(visitor) {
        for (var rowIndex = 0; rowIndex < this.settings.rows; rowIndex++) {
            for (var colIndex = 0; colIndex < this.settings.columns; colIndex++) {
                visitor({row: rowIndex, column: colIndex});
            }
        }
    };

    this.visitTiles = function(visitor) {
        for (var rowIndex = 0; rowIndex < this.settings.rows; rowIndex++) {
            for (var colIndex = 0; colIndex < this.settings.columns; colIndex++) {
                visitor(this.tiles[rowIndex][colIndex]);
            }
        }
    };

    this.buildTiles = function(safeLocation) {
        this.tiles = [];
        // pick a random list of N locations
        var mineLocations = [];
        this.visitLocations(function (location) {
            if (location.row != safeLocation.row || location.column != safeLocation.column) {
                mineLocations.push(location);
            }
        }.bind(this));
        mineLocations = mineLocations.shuffle().splice(0, this.settings.mines);

        var isMine = function(location) {
            return mineLocations.find(function (test) {
                return test.row == location.row && test.column == location.column;
            }) ? true : false;
        };

        this.visitLocations(function (location) {
            if (location.column == 0) {
                this.tiles.push([]);
            }
            this.tiles[location.row].push(new Tile({
                row: location.row,
                column: location.column,
                isMine: isMine(location)
            }));
        }.bind(this));

        this.visitTiles(function (tile) {
            tile.initialize(this);
        }.bind(this));

        this.state = Game.states.playing;
    };
};

Game.states = {
    notStarted: "notStarted",
    playing: "playing",
    won: "won",
    lost: "lost"
};

var initialize = function() {
    var container = document.querySelector("#root-Minesweeper");
    container.addRemClass("hidden", false);
    document.title = container.querySelector("h1").innerText;
    
    Minesweeper.renderer = new Minesweeper.Renderer({
        canvas: container.querySelector("canvas.board"),
        controlPanel: container.querySelector("controls")
    });
    Minesweeper.gameOptions = new Minesweeper.GameOptions({
        template: container.querySelector("options"),
        optionsButton: container.querySelector(".newGameOptions"),
    });

    container.querySelector(".help").addEventListener("click", function (event) {
        event.preventDefault();
        var helpSource = container.querySelector("help");
        new Gaming.Prompt({
            customContent: helpSource.cloneNode(true).addRemClass("hidden", false),
            buttons: [ {label: "Thanks!"} ]
        }).show();
    });
};

//Gaming.GameSelector.allGames.push({ label: document.querySelector("#root-Minesweeper h1").innerText, action: initialize });

return {
    renderer: null,
    gameOptions: null,
    game: null,
    initialize: initialize,
    GameOptions: GameOptions,
    Renderer: Renderer,
    Tile: Tile,
    Game: Game
};

})(); // end Minesweeper namespace decl

Minesweeper.initialize();
