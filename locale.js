"use-strict";

Number.uiInteger = function(value) {
    return Number(value).toLocaleString();
};

Number.uiFloat = function(value) {
    return Number(value).toLocaleString();
};

// 0.237 -> 24%
Number.uiPercent = function(ratio) {
    return Math.round(ratio * 100).toLocaleString() + "%";
};

// 23.7 -> 23.7%
Number.uiFormatWithPercent = function(percent) {
    return percent.toLocaleString() + "%";
};

Gaming.Strings = (() => {
    class Strings {
        // Initialize with keys -> localized strings, e.g. from a config file
        static initialize(dict) {
            Strings.source = dict || {};
            // Gaming.debugLog(`Loaded ${Object.keys(Strings.source).length} Strings`);
        }
        static str(id) {
            return Strings.source[id] || `?${id}?`;
        }
        static template(id, data) {
            var template = Strings.str(id);
            return template ? String.fromTemplate(template, data) : null;
        }
    }

    const _stringTemplateRegexes = {};
    String.fromTemplate = function(template, data) {
        if (!template || !data || template.indexOf("<") < 0) { return template; }
        Object.getOwnPropertyNames(data).forEach((pn) => {
            if (!_stringTemplateRegexes[pn]) {
                _stringTemplateRegexes[pn] = new RegExp(`<${pn}>`, "g");
            }
            template = template.replace(_stringTemplateRegexes[pn], data[pn]);
        });
        return template;
    };

    return Strings;
})(); // end Gaming.Strings
Gaming.Strings.source = {}; // call Strings.initialize(dict) to configure

Array.oxfordCommaList = function(items) {
    if (!items) return items;
    switch (items.length) {
        case 0: return "";
        case 1: return items[0];
        case 2: return Gaming.Strings.template("oxfordCommaTwoItemsTemplate", { first: items[0], last: items[1] });
        default:
            let last = items.pop();
            return Gaming.Strings.template("oxfordCommaManyItemsTemplate", {
                first: items.join(Gaming.Strings.str("oxfordCommaManyItemsSeparator")),
                last: last
            });
    }
};
