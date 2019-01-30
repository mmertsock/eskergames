"use-strict";

window.CitySimIndex = (function() {

const debugLog = Gaming.debugLog;
const debugWarn = Gaming.debugWarn;
const Rng = Gaming.Rng;
const GameStorage = CitySim.GameStorage;

class LoadGameMenu {
    constructor() {
        this.mainMenuSection = document.querySelector("#mainMenu");
        this.loadFilesSection = document.querySelector("#loadFileMenu");
        this.noFilesToLoadSection = document.querySelector("#noFilesToLoad");
        this.gameInfoSection = document.querySelector("#gameInfo");
        this.terrainInfoSection = document.querySelector("#terrainInfo");
        this.allSections = [this.mainMenuSection, this.loadFilesSection, this.noFilesToLoadSection, this.gameInfoSection, this.terrainInfoSection];
        this.selectedGame = null;
        this.selectedTerrain = null;

        this.setClickAction("#root .showGameList", () => this.showGameList());
        this.setClickAction("#root .showTerrainList", () => this.showTerrainList());
        this.setClickAction("#root .showMainMenu", () => this._showSection(this.mainMenuSection));
        this.setClickAction("#gameInfo .open", () => this._openSelectedGame());
        this.setClickAction("#terrainInfo .open", () => this._openSelectedTerrain());
        this.setClickAction("#gameInfo .delete", () => this._promptDeleteSelectedGame());
        this.setClickAction("#terrainInfo .delete", () => this._promptDeleteSelectedTerrain());
        this.setClickAction("#terrainInfo .newGame", () => this._newGameFromSelectedTerrain());

        // change to "post div" to do the multiple-gradients-within-the-post effect
        var stopper = i => `hsl(${i.h},${i.s}%,${i.l}%) ${i.x}px`
        document.querySelectorAll("post").forEach(elem => {
            var x = 0;
            var stops = [];
            var last = null;
            while (stops.length < 12) {
                x += Rng.shared.nextIntOpenRange(1, 4);
                var next = {
                    h: Rng.shared.nextIntOpenRange(19, 25),
                    s: Rng.shared.nextIntOpenRange(25, 50),
                    l: Rng.shared.nextIntOpenRange(20, 60),
                    x: x
                };
                if (last) { last.x = x; stops.push(stopper(last)); }
                stops.push(stopper(next));
                // stops.push(`hsl(${h},${s}%,${l}%) ${x}px`);
                last = next;
            }
            elem.style.background = `repeating-linear-gradient(90deg, ${stops.join(", ")})`;
        });

        this._setUpFocusBlur();
    }

    get storage() {
        return GameStorage.shared;
    }

    showGameList() {
        this._setFileTypeClass("game");
        this.showFileList(this.storage.allSavedGames, file => this._showGameDetails(file));
    }

    showTerrainList() {
        this._setFileTypeClass("terrain");
        this.showFileList(this.storage.allSavedTerrains, file => this._showTerrainDetails(file));
    }

    showFileList(files, selectFileClick) {
        if (files.length == 0) {
            this._showSection(this.noFilesToLoadSection);
        } else {
            let containerElem = this.loadFilesSection.querySelector("tbody");
            containerElem.removeAllChildren();
            files.forEach(file => {
                let row = document.createElement("tr");
                row.addRemClass("invalid", !this.storage.isSaveStateSummarySupported(file));
                row.append(this._td(file.title, "name"));
                row.append(this._td(this._formatTimestamp(file.timestamp), "date"));
                row.append(this._td(this._formatFileSize(file.sizeBytes), "size"));
                containerElem.append(row);
                row.addEventListener("click", evt => {
                    evt.preventDefault(); selectFileClick(file);
                });
                // TODO an <input> to type the file name directly to simulate an old computer. with a Load button.
                // TODO import button to paste in JSON. Export button is within city.html in the File menu.
            });
            this._showSection(this.loadFilesSection);
        }
    }

    setClickAction(selector, block) {
        document.querySelectorAll(selector).forEach(elem => {
            elem.addEventListener("click", evt => {
                evt.preventDefault(); block();
            });
        });
    }

    _setFileTypeClass(name) {
        this.loadFilesSection.addRemClass("game", name == "game");
        this.loadFilesSection.addRemClass("terrain", name == "game");
        this.noFilesToLoadSection.addRemClass("game", name == "game");
        this.noFilesToLoadSection.addRemClass("terrain", name == "game");
    }

    _showGameDetails(game) {
        this.selectedGame = game;
        var isValid = this.storage.isSaveStateSummarySupported(game);
        this.gameInfoSection.addRemClass("valid", isValid);
        this.gameInfoSection.querySelector("h2").innerText = `${game.title}, ${this._formatTimestamp(game.timestamp)}`;
        this.gameInfoSection.querySelector(".name").innerText = game.metadata ? game.metadata.cityName : "";
        this.gameInfoSection.querySelector(".population").innerText = game.metadata ? game.metadata.population : "";
        this.gameInfoSection.querySelector(".cash").innerText = game.metadata ? game.metadata.cash : "";
        this.gameInfoSection.querySelector(".date").innerText = game.metadata ? game.metadata.gameDate : "";
        this.gameInfoSection.querySelector(".open").addRemClass("disabled", !isValid);
        // TODO show a minimap
        this._showSection(this.gameInfoSection);
    }

    _showTerrainDetails(file) {
        this.selectedTerrain = file;
        var isValid = this.storage.isSaveStateSummarySupported(file);
        this.terrainInfoSection.addRemClass("valid", isValid);
        this.terrainInfoSection.querySelector("h2").innerText = `${file.title}, ${this._formatTimestamp(file.timestamp)}`;
        this.terrainInfoSection.querySelector(".name").innerText = file.metadata ? file.metadata.name : "";
        this.terrainInfoSection.querySelector(".size").innerText = file.metadata ? file.metadata.size : "";
        this.terrainInfoSection.querySelector(".landform").innerText = file.metadata ? file.metadata.landform : "";
        this.terrainInfoSection.querySelector(".open").addRemClass("disabled", !isValid);
        this.terrainInfoSection.querySelector(".newGame").addRemClass("disabled", !isValid);
        // TODO show a minimap
        this._showSection(this.terrainInfoSection);
    }

    _openSelectedGame() {
        if (!this.storage.isSaveStateSummarySupported(this.selectedGame)) { return; }
        var url = this.storage.urlForGameID(this.selectedGame.id);
        window.location.assign(url);
        debugLog("go to " + url);
    }

    _openSelectedTerrain() {
        if (!this.storage.isSaveStateSummarySupported(this.selectedTerrain)) { return; }
        var url = this.storage.urlForTerrainID(this.selectedTerrain.id);
        window.location.assign(url);
        debugLog("go to " + url);
    }

    _newGameFromSelectedTerrain() {
        if (!this.storage.isSaveStateSummarySupported(this.selectedTerrain)) { return; }
        let url = this.storage.urlForNewGameWithTerrainID(this.selectedTerrain.id);
        window.location.assign(url);
        debugLog("go to " + url);
    }

    _promptDeleteSelectedGame() {
        if (!this.selectedGame) { return; }
        if (!confirm(Strings.str("deleteFileConfirmPrompt"))) { return; }
        debugLog(this.storage);
        this.storage.gameCollection.deleteItem(this.selectedGame.id);
        this.showGameList();
    }

    _promptDeleteSelectedTerrain() {
        if (!this.selectedTerrain) { return; }
        if (!confirm(Strings.str("deleteFileConfirmPrompt"))) { return; }
        debugLog(this.storage);
        this.storage.terrainCollection.deleteItem(this.selectedTerrain.id);
        this.showTerrainList();
    }

    _showSection(elem) {
        this.allSections.forEach(item => {
            item.addRemClass("hidden", item != elem);
        });
    }

    _td(text, type) {
        var elem = document.createElement("td");
        elem.innerText = text;
        elem.addRemClass(type, true);
        return elem;
    }

    _formatTimestamp(timestamp) {
        return new Date(timestamp).toLocaleString([], { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }

    _formatFileSize(size) {
        if (size > (1024 * 1024) - 1) {
            return `${(size / (1024*1024)).toFixed(2)} MB`;
        }
        if (size > 1023) {
            return `${(size / 1024).toFixed(2)} KB`;
        }
        return Number.uiInteger(size);
    }

    _setUpFocusBlur() {
        var containerElem = document.querySelector("body > div");
        this.focusElems = {
            backgrounds: [document.querySelector("#background")],
            foregrounds: [document.querySelector("post"), document.querySelector("#root > div")],
            all: Array.from(document.querySelectorAll(".focusable")),
        };
        this.parallax = {
            width: containerElem.clientWidth,
            height: containerElem.clientHeight,
            magnitude: [3, 9, 15, 25],
            elems: [
                Array.from(document.querySelectorAll(".parallax")),
                Array.from(document.querySelectorAll("#background .min")),
                Array.from(document.querySelectorAll("#background .middle")),
                Array.from(document.querySelectorAll("#background .max"))
            ]
        };
        this.focusElems.backgrounds.forEach(elem => { elem.dataset["focusgroup"] = "bg"; });
        this.focusElems.foregrounds.forEach(elem => { elem.dataset["focusgroup"] = "fg"; });
        this.focusElems.foregrounds.forEach(elem => {
            var blur = "blur(1px)";
            var nothing = "blur(0px)";
            elem.addEventListener("mouseleave", evt => {
                this.focusElems.all.forEach(item => {
                    item.style.filter = (item.dataset["focusgroup"] == "fg") ? blur : nothing;
                });
            });
            elem.addEventListener("mouseenter", evt => {
                this.focusElems.all.forEach(item => {
                    item.style.filter = (item.dataset["focusgroup"] == "fg") ? nothing : blur;
                });
            });
        });
        if (this.parallax.width > 1 && this.parallax.height > 1) {
            document.addEventListener("mousemove", evt => {
                var x = 1 - (evt.clientX / (0.5 * this.parallax.width));
                var y = (this.parallax.height - evt.clientY) / this.parallax.height;
                this._setParallax(x * Math.abs(x), y * Math.abs(y));
            });
        }
    }

    _setParallax(x, y) {
        this.parallax.elems.forEach((items, index) => {
            var transform = `translate(${x * this.parallax.magnitude[index]}px, ${y * this.parallax.magnitude[index]}px)`;
            items.forEach(item => { item.style.transform = transform; });
        });
    }
}

function initialize() {
    CitySim.loadMenu = new CitySimIndex.LoadGameMenu();
}

return {
    initialize: initialize,
    LoadGameMenu: LoadGameMenu
};

})(); // end CitySim namespace

cityReady("index.js");
