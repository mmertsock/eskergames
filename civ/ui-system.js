import * as Gaming from '../g.js';
import { Strings } from '../locale.js';
import { inj, DifficultyOption, Game, MapSizeOption } from './game.js';

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, ToolButton = Gaming.ToolButton;

export function uiReady() {
    UI.prepareStaticContent();
    ScreenManager.initialize();
    FirstRunView.initialize();
    NewGameDialog.initialize();
    let game = null;
    try {
        let data = inj().storage.autosaveData;
        if (data) {
            game = Game.fromSerializedSavegame(data);
        }
    } catch (e) {
        debugWarn(`Failed to load autosave: ${e.message}`);
        debugLog(e.stack);
    }
    if (game) {
        inj().gse.execute("resumeSavedGame", game, null);
    } else {
        inj().gse.execute("showFirstRunView", null, null);
    }
}

export class UI {
    static cloneTemplate(selector) {
        return document.querySelector(`templates > ${selector}`).cloneNode(true);
    }
    
    static traverseSubviews(parent, block) {
        if (!!parent && Array.isArray(parent.views)) {
            parent.views.forEach(view => {
                block(view);
                UI.traverseSubviews(view, block);
            });
        }
    }
    
    static prepareStaticContent() {
        Strings.localizeDOM(
            document,
            (token, elem) => inj().gse.execute(token, elem, null)
        );
    }
}

// manages visibility of a set of ScreenViews
export class ScreenManager {
    static initialize() {
        ScreenManager.shared = new ScreenManager();
    }
    
    constructor() {
        this.views = {};
        this.elems = document.querySelectorAll(".fullscreen");
        this.elems.forEach(elem => elem.addRemClass("hidden"));
    }
    
    register(view) {
        let oldView = this.views[view.id];
        if (oldView) {
            oldView.screenManager = null;
        }
        this.views[view.id] = view;
        view.screenManager = this;
    }
    
    show(view) {
        this.elems.forEach(elem => {
            let hidden = (elem.id != view.id);
            elem.addRemClass("hidden", hidden);
            let elemView = this.views[elem.id];
            if (elemView) {
                if (hidden) {
                    elemView.didHide();
                } else {
                    elemView.didShow();
                }
            }
        });
        return view;
    }
}

export class ScreenView {
    constructor(id) {
        this.id = id;
        this.elem = document.querySelector(`#${this.id}`);
        ScreenManager.shared.register(this);
    }
    
    show() {
        return this.screenManager.show(this);
    }
    
    didShow() { }
    didHide() { }
}

class FirstRunView extends ScreenView {
    static initialize() {
        inj().gse.registerCommand("showFirstRunView", () => FirstRunView.shared().show());
    }
    
    static shared() {
        if (!FirstRunView._shared) {
            FirstRunView._shared = new FirstRunView();
        }
        return FirstRunView._shared;
    }
    
    constructor() {
        super("firstrun");
        let container = this.elem.querySelector("content div");
        
        new Gaming.ToolButton({
            parent: container,
            title: Strings.str("newGameButton"),
            clickScript: "showNewGameDialog"
        });
        new Gaming.ToolButton({
            parent: container,
            title: Strings.str("loadGameButton"),
            clickScript: "showLoadGameDialog"
        });
        new Gaming.ToolButton({
            parent: container,
            title: Strings.str("showHelpButton"),
            clickScript: "showHelp"
        });
    }
}

// interface, all methods optional
class WizardDelegate {
    wizardDidComplete(wizard) { }
    wizardDidShowStep(wizard, step, previousStep) { }
}

class WizardStepView {
    // required: this.elem
    get canAdvance() { return true; }
    didShow(wizard) {}
    didHide(wizard) {}
}

class WizardView {
    constructor(a) {
        this.stepIndex = -1;
        this.steps = a.steps; // Array of WizardStepView
        this.delegate = a.delegate;
        this.steps.forEach((step, i) => {
            step.stepIndex = i;
            a.elem.append(step.elem);
        });
        this.showStep(0);
    }
    
    get currentStep() { return this.steps[this.stepIndex]; }
    get isFirstStep() { return this.stepIndex == 0; }
    get isLastStep() { return this.stepIndex == this.steps.length - 1; }
    
    showStep(index) {
        if (index == this.stepIndex || index < 0 || index >= this.steps.length) { return; }
        let previous = this.currentStep;
        this.stepIndex = index;
        this.steps.forEach(step => {
            let hidden = step.stepIndex != this.stepIndex;
            step.elem.addRemClass("hidden", hidden);
            if (hidden) {
                step.didHide(this);
            } else {
                step.didShow(this);
            }
        });
        if (typeof(this.delegate.wizardDidShowStep) == 'function') {
            this.delegate.wizardDidShowStep(this, this.currentStep, previous);
        }
    }
    
    showPreviousStep() {
        this.showStep(this.stepIndex - 1);
    }
    
    showNextStep() {
        if (this.isLastStep) {
            if (typeof(this.delegate.wizardDidComplete) == 'function') {
                this.delegate.wizardDidComplete(this);
            }
        } else {
            this.showStep(this.stepIndex + 1);
        }
    }
}

// Base class for all civ dialogs
class CivDialog extends Gaming.GameDialog {
}

class SingleModalDialog extends CivDialog {
    static canShow() {
        return !Gaming.GameDialogManager.shared.hasModal;
    }
    
    static show() {
        if (!this.canShow()) { return false; }
        new this().show();
        return true;
    }
    
    get isModal() { return true; }
}

class NewGameDialog extends SingleModalDialog {
    static initialize() {
        inj().gse.registerCommand("showNewGameDialog", (subject, evt) => {
            NewGameDialog.show();
        });
    }
    
    constructor() {
        super({ rootElemClass: "justify-nav" });
        this.contentElem = Gaming.GameDialog.createContentElem();
        this.previousButton = new Gaming.ToolButton({
            title: Strings.str("previousButton"),
            click: () => this.wizard.showPreviousStep()
        });
        this.nextButton = new Gaming.ToolButton({
            title: Strings.str("nextButton"),
            click: () => this.wizard.showNextStep()
        });
        this.model = {};
        
        let steps = [
            new NewGameDialog.DifficultyStepView({ model: this.model }),
            new NewGameDialog.WorldStepView({ model: this.model }),
            new NewGameDialog.PlayerCivStepView({ model: this.model }),
            new NewGameDialog.PlayerInfoStepView({ model: this.model }),
            new NewGameDialog.OpponentsStepView({ model: this.model }),
            new NewGameDialog.SummaryStepView({ model: this.model })
        ];
        this.wizard = new WizardView({
            elem: this.contentElem,
            steps: steps,
            delegate: this
        });
    }
    
    get title() { return Strings.str("newGameDialogTitle"); }
    
    get dialogButtons() {
        return [this.previousButton.elem, this.nextButton.elem];
    }
    
    wizardDidComplete() {
        this.dismiss();
        inj().gse.execute("beginNewGame", this.model, null);
    }
    
    wizardDidShowStep(wizard) {
        this.previousButton.elem.addRemClass("hidden", wizard.isFirstStep);
        this.nextButton.isEnabled = wizard.currentStep.canAdvance;
        this.nextButton.title = wizard.currentStep.nextButtonTitle || Strings.str("nextButton");
    }
}

NewGameDialog.DifficultyStepView = class DifficultyStepView extends WizardStepView {
    constructor(a) {
        super();
        this.model = a.model;
        this.elem = Gaming.GameDialog.createFormElem();

        let initialDifficulty = DifficultyOption.indexOrDefault(inj().storage.lastDifficultyIndex);
        this.difficulties = new Gaming.FormValueView.SingleChoiceInputCollection({
            id: "difficulty",
            parent: this.elem,
            title: Strings.str("difficultyChoiceLabel"),
            validationRules: [Gaming.FormValueView.SingleChoiceInputCollection.selectionRequiredRule],
            choices: DifficultyOption.all().map(difficulty => { return {
                title: difficulty.name,
                value: difficulty.index,
                selected: difficulty.isEqual(initialDifficulty)
            }; })
        });
        this.model.difficulty = this.value;
    }
    
    get value() {
        return DifficultyOption.indexOrDefault(this.difficulties.value);
    }
    
    didShow() {
        this.difficulties.value = this.model.difficulty.index;
    }
    
    didHide() {
        this.model.difficulty = this.value;
    }
};

NewGameDialog.WorldStepView = class WorldStepView extends WizardStepView {
    constructor(a) {
        super();
        this.model = a.model;
        this.elem = Gaming.GameDialog.createFormElem();
        
        let initialSize = MapSizeOption.getDefault();
        this.mapSizes = new Gaming.FormValueView.SingleChoiceInputCollection({
            id: "mapSize",
            parent: this.elem,
            title: Strings.str("mapSizeChoiceLabel"),
            validationRules: [Gaming.FormValueView.SingleChoiceInputCollection.selectionRequiredRule],
            choices: MapSizeOption.all().map(item => { return {
                title: item.name,
                value: item.id,
                selected: item.isEqual(initialSize)
            }; })
        });
        this.model.world = this.value;
    }
    
    get value() {
        return {
            planet: {
                mapSizeOption: this.mapSizeOption
            }
        };
    }
    
    get mapSizeOption() {
        return MapSizeOption.withIDorDefault(this.mapSizes.value);
    }
    
    didShow() {
        this.mapSizes.value = this.model.world.planet.mapSizeOption.id;
    }
    
    didHide() {
        this.model.world = this.value;
    }
};

NewGameDialog.PlayerCivStepView = class PlayerCivStepView extends WizardStepView {
    constructor(a) {
        super();
        this.model = a.model;
        this.elem = Gaming.GameDialog.createFormElem();
        this.elem.innerText = "pick a civ from a list";
        this.model.playerCiv = 7; // temp
    }
};

NewGameDialog.PlayerInfoStepView = class PlayerInfoStepView extends WizardStepView {
    constructor(a) {
        super();
        this.model = a.model;
        this.elem = Gaming.GameDialog.createFormElem();
        this.elem.innerText = "enter player/leader info, with defaults based on the chosen civ";
        this.model.playerInfo = {
            name: "Abraham Lincoln"
        };
    }
    
    // validation
    get canAdvance() { return true; }
};

NewGameDialog.OpponentsStepView = class OpponentsStepView extends WizardStepView {
    constructor(a) {
        super();
        this.model = a.model;
        this.elem = Gaming.GameDialog.createFormElem();
        this.elem.innerText = "configure opponents";
        this.model.opponents = 5; // temp
    }
};

NewGameDialog.SummaryStepView = class SummaryStepView extends WizardStepView {
    constructor(a) {
        super();
        this.model = a.model;
        this.elem = Gaming.GameDialog.createFormElem();
        let rows = [
            { label: Strings.str("difficultyLabel"), value: () => this.model.difficulty.name },
            { label: Strings.str("worldConfigLabel"), value: () => this.model.world.planet.mapSizeOption.name },
            { label: Strings.str("playerCivLabel"), value: () => "Egypt: aggressive, perfectionist" },
            { label: Strings.str("playerNameLabel"), value: () => this.model.playerInfo.name },
            { label: Strings.str("opponentsConfigLabel"), value: () => this.model.opponents }
        ];
        
        this.dataView = new DataTableView({
            parent: this.elem,
            title: Strings.str("readyToBegin"),
            rows: rows
        });
    }
    
    get nextButtonTitle() { return Strings.str("startGameButton") }
    
    didShow() {
        this.dataView.render();
    }
};

class DataTableView {
    constructor(a) {
        this.elem = UI.cloneTemplate(".data-table-view");
        this.elem.querySelector("caption").innerText = a.title;
        this.rows = a.rows;
        this.rows.forEach(row => {
            let tr = document.createElement("tr");
            tr.append(document.createElement("td").configure(td => td.innerText = row.label));
            tr.append(document.createElement("td"));
            this.elem.tBodies[0].append(tr);
        });
        if (a.parent) { a.parent.append(this.elem); }
        this.render();
    }
    
    render() {
        this.rows.forEach((row, index) => {
            let value = row.value;
            if (typeof(row.value) == 'function') { value = row.value(); }
            this.elem.tBodies[0].rows[index].cells[1].innerText = value;
        });
    }
}
