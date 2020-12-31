import * as Gaming from '../g.js';
import { Strings } from '../locale.js';
import { inj, Civilization, DifficultyOption, Env, Game, MapSizeOption } from './game.js';

const debugLog = Gaming.debugLog, debugWarn = Gaming.debugWarn, ToolButton = Gaming.ToolButton;

export function uiReady() {
    UI.prepareStaticContent();
    ScreenManager.initialize();
    FirstRunView.initialize();
    NewGameDialog.initialize();
    inj().keyboardInputController = new KeyboardInputController();
    inj().views.root = new DOMRootView();
    inj().animationController = new AnimationController();
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
        document.title = Strings.str("gameTitle");
        Strings.localizeDOM(
            document,
            (token, elem) => inj().gse.execute(token, elem, null)
        );
    }
    
    static deviceLengthForDOMLength(px, devicePixelRatio) {
        return px * devicePixelRatio;
    }
}

export class DOMRootView {
    constructor() {
        this.resizeDebouncer = new Gaming.Debouncer({
            intervalMilliseconds: 300,
            callback: () => this.documentDidResize(),
            newGroupCallback: () => this.documentWillResize()
        });
        document.defaultView.addEventListener("resize", evt => this.resizeDebouncer.trigger());
    }
    
    documentWillResize() {
        debugLog("willResize " + (0.001 * (Date.now() % 1000000)));
        document.body.classList.add("resizing");
        Gaming.Dispatch.shared.postEventSync(DOMRootView.willResizeEvent, this);
    }
    
    documentDidResize() {
        debugLog("didResize " + (0.001 * (Date.now() % 1000000)));
        document.body.classList.remove("resizing");
        Gaming.Dispatch.shared.postEventSync(DOMRootView.didResizeEvent, this);
    }
}
DOMRootView.willResizeEvent = "DOMRootView.willResizeEvent";
DOMRootView.didResizeEvent = "DOMRootView.didResizeEvent";

// Pass all AnimationLoop add/remove delegate calls through this class.
export class AnimationController {
    constructor() {
        this.loop = new Gaming.AnimationLoop(window);
    }
    
    addDelegate(delegate) {
        this.loop.addDelegate(delegate);
        if (this.loop.delegateCount() > 0 && this.loop.state == Gaming.AnimationLoop.State.paused) {
            debugLog("AnimationController.addDelegate: resume AnimationLoop");
            this.loop.resume();
        }
    }
    
    removeDelegate(delegate) {
        this.loop.removeDelegate(delegate);
        if (this.loop.delegateCount() == 0 && this.loop.state != Gaming.AnimationLoop.State.paused) {
            debugLog("AnimationController.removeDelegate: pause AnimationLoop");
            this.loop.pause();
        }
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
    
    
    didShow() {
        // resume animation
        UI.traverseSubviews(this, view => {
            if (view.screenDidShow) { view.screenDidShow(this); }
        });
    }
    
    didHide() {
        // pause animation
        UI.traverseSubviews(this, view => {
            if (view.screenDidHide) { view.screenDidHide(this); }
        });
    }
}

class KeyboardInputController {
    constructor() {
        this.keyController = new Gaming.KeyInputController();
        this.keyController.addShortcutsFromSettings(inj().content.keyboard);
        // this.keyController.debug = true;
    }
}

export class CanvasInputController {
    constructor(a) {
        this.canvas = a.canvas;
        this.devicePixelRatio = a.devicePixelRatio;
        this.isTrackingPointer = false;
        this.canvas.addEventListener("click", evt => this._click(evt));
        this.canvas.addEventListener("mouseleave", evt => this._mouseleave(evt));
        this.canvas.addEventListener("mousemove", evt => this._mousemove(evt));
        this._lastEvents = {};
    }
    
    // Canvas device pixel under the input pointer, if applicable
    get pointerCavasPoint() {
        let evt = this._lastEvents["mousemove"];
        if (!evt || !this.isTrackingPointer) { return null; }
        return this._canvasPointForDOMPoint(evt);
    }
    
    _canvasPointForDOMPoint(evt) {
        return new Gaming.Point(
            UI.deviceLengthForDOMLength(evt.offsetX, this.devicePixelRatio),
            UI.deviceLengthForDOMLength(evt.offsetY, this.devicePixelRatio)
        ).integral();
    }
    
    _click(evt) {
        this._lastEvents[evt.type] = evt;
        let eventModel = {
            evt: evt,
            canvasPoint: this._canvasPointForDOMPoint(evt)
        };
        this.forEachDelegate(d => {
            if (d.canvasClicked) { d.canvasClicked(eventModel); }
        });
    }
    
    _mouseenter(evt) {
        this._lastEvents[evt.type] = evt;
        this.isTrackingPointer = true;
    }
    
    _mouseleave(evt) {
        this._lastEvents[evt.type] = evt;
        this.isTrackingPointer = false;
    }
    
    _mousemove(evt) {
        this._lastEvents[evt.type] = evt;
        this.isTrackingPointer = true;
    }
}
Gaming.Mixins.Gaming.DelegateSet(CanvasInputController);

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
        if (!Env.isProduction) {
            new Gaming.ToolButton({
                parent: container,
                title: Strings.str("quickStartButton"),
                clickScript: "quickStartNewGame"
            });
        }
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
    constructor(elem) {
        this.elem = elem;
    }
    
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

class NewGameModel {
    // static Kvo() { return {"playerCiv": "_playerCiv"}; }
    
    constructor() {
        this.kvo = new Gaming.Kvo(this);
    }
    
    get playerCiv() { return this._playerCiv; }
    set playerCiv(value) { this._playerCiv = value; this.kvo.notifyChanged(); }
    // set playerCiv(value) { this.kvo.playerCiv.setValue(value, true); }
}

class NewGameDialog extends SingleModalDialog {
    static initialize() {
        inj().gse.registerCommand("showNewGameDialog", (subject, evt) => {
            NewGameDialog.show();
        });
        inj().gse.registerCommand("quickStartNewGame", () => {
            inj().gse.execute("beginNewGame", NewGameDialog.defaultModelValue(), null);
        });
    }
    
    static stepViewTypes() {
        return [NewGameDialog.DifficultyStepView, NewGameDialog.WorldStepView, NewGameDialog.PlayerCivStepView, NewGameDialog.PlayerInfoStepView, NewGameDialog.OpponentsStepView, NewGameDialog.SummaryStepView];
    }
    
    static defaultModelValue() {
        let model = new NewGameModel();
        NewGameDialog.stepViewTypes().forEach(type => {
            Object.assign(model, type.defaultModelValue());
        });
        return model;
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
        this.model = new NewGameModel();
        let steps = NewGameDialog.stepViewTypes().map(ctor => new ctor(this.model));
        this.wizard = new WizardView({
            elem: this.contentElem,
            steps: steps,
            delegate: this
        });
        this.model.kvo.addObserver(this, () => this.updateControls(this.wizard));
    }
    
    get title() { return Strings.str("newGameDialogTitle"); }
    
    get dialogButtons() {
        return [this.previousButton.elem, this.nextButton.elem];
    }
    
    wizardDidComplete() {
        Gaming.Kvo.stopAllObservations(this);
        this.dismiss();
        inj().gse.execute("beginNewGame", this.model, null);
        this.wizard.delegate = null;
        this.wizard = null;
    }
    
    wizardDidShowStep(wizard) {
        this.previousButton.elem.addRemClass("hidden", wizard.isFirstStep);
        this.nextButton.title = wizard.currentStep.nextButtonTitle || Strings.str("nextButton");
        this.updateControls(wizard);
    }
    
    updateControls(wizard) {
        this.nextButton.isEnabled = !!wizard.currentStep?.canAdvance;
    }
}

NewGameDialog.DifficultyStepView = class DifficultyStepView extends WizardStepView {
    static defaultModelValue() {
        return { difficulty: DifficultyOption.getDefault() };
    }
    
    constructor(model) {
        super(Gaming.GameDialog.createFormElem());
        this.model = model;

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
    static defaultModelValue() {
        return { world: { planet: {mapSizeOption: MapSizeOption.getDefault()} } };
    }
    
    constructor(model) {
        super(Gaming.GameDialog.createFormElem());
        this.model = model;
        
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
            planet: {mapSizeOption: this.mapSizeOption}
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
    static defaultModelValue() {
        return { playerCiv: Civilization.allMetaByName().randomItem() };
    }
    
    constructor(model) {
        super(Gaming.GameDialog.createFormElem());
        this.model = model;
        this.model.playerCiv = null;
        
        this.civs = new Gaming.FormValueView.SingleChoiceInputCollection({
            id: "playerCiv",
            parent: this.elem,
            title: Strings.str("playerCivChoiceLabel"),
            validationRules: [Gaming.FormValueView.SingleChoiceInputCollection.selectionRequiredRule],
            choices: Civilization.allMetaByName().map(item => { return {
                title: item.name,
                value: item.id,
                selected: false
            }; })
        });
    }
    
    get canAdvance() { return this.civs.isValid; }
    get value() {
        return this.civs.value ? Civilization.metaByID(this.civs.value) : null;
    }
    
    didShow() {
        // TODO Bindings would simplify all this
        this.civs.value = this.model.playerCiv?.id;
        this.civs.kvo.value.addObserver(this, () => this.model.playerCiv = this.value);
    }
    
    didHide() {
        this.model.playerCiv = this.value;
        Gaming.Kvo.stopAllObservations(this);
    }
};

NewGameDialog.PlayerInfoStepView = class PlayerInfoStepView extends WizardStepView {
    static defaultModelValue() {
        return { playerInfo: { name: "Defacto" } };
    }
    
    constructor(model) {
        super(Gaming.GameDialog.createFormElem());
        this.model = model;
        this.elem.innerText = "enter player/leader info, with defaults based on the chosen civ";
        this.model.playerInfo = {
            name: "Abraham Lincoln"
        };
    }
    
    // validation
    get canAdvance() { return true; }
};

NewGameDialog.OpponentsStepView = class OpponentsStepView extends WizardStepView {
    static defaultModelValue() {
        return { opponents: 5 };
    }
    
    constructor(model) {
        super(Gaming.GameDialog.createFormElem());
        this.model = model;
        this.elem.innerText = "configure opponents";
        this.model.opponents = 5; // temp
    }
};

NewGameDialog.SummaryStepView = class SummaryStepView extends WizardStepView {
    static defaultModelValue() {
        return null;
    }
    
    constructor(model) {
        super(Gaming.GameDialog.createFormElem());
        this.model = model;
        // TODO once the model is a full class, can use KVO bindings 
        // here instead of raw () => blocks.
        let rows = [
            { label: Strings.str("difficultyLabel"), value: () => this.model.difficulty?.name },
            { label: Strings.str("worldConfigLabel"), value: () => this.model.world?.planet.mapSizeOption?.name },
            { label: Strings.str("playerCivLabel"), value: () => this.model.playerCiv?.name },
            // { label: Strings.str("playerCivDescriptionLabel"), value: () => "aggressive, perfectionist" },
            { label: Strings.str("playerNameLabel"), value: () => this.model.playerInfo?.name },
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

export const _unitTestSymbols = {
    NewGameDialog: NewGameDialog
};
