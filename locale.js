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

    // Text localization
    class Strings {
        // Initialize with keys -> localized strings, e.g. from a config file
        static initialize(dict, pluralDict) {
            Strings.source = dict || {};
            Strings.plurals = pluralDict || {};
            // Gaming.debugLog(`Loaded ${Object.keys(Strings.source).length} Strings`);
        }

        // id: key in Strings config data
        static str(id) {
            return Strings.source[id] || missingStringID(id);
        }

        // id: key in Strings config data
        // data: object
        static template(id, data) {
            let template = Strings.str(id);
            // TODO pluralize any <key#value> tokens
            return template ? String.fromTemplate(template, data) : null;
        }

        // id: key in Strings config data
        // magnitude: numeric value to determine pluralization
        // formattedMagnitude: string representation of plural value. Optional
        static pluralize(id, magnitude, formattedMagnitude) {
            let templates = pluralTemplates(id);
            let placeholder = templates.length > 3 ? templates[3] : "#";
            if (typeof(formattedMagnitude) == 'undefined') {
                formattedMagnitude = magnitude;
            }
            if (magnitude == 0) {
                return String.pluralize(templates[0], placeholder, formattedMagnitude);
            } else if (magnitude == 1) {
                return String.pluralize(templates[1], placeholder, formattedMagnitude);
            } else {
                return String.pluralize(templates[2], placeholder, formattedMagnitude);
            }
        }
    }

    function missingStringID(id) {
        return `?${id}?`;
    }
    function missingPluralID(id) {
        return [`?${id}/0?`, `?${id}/1?`, `?${id}/#?`];
    }
    function pluralTemplates(id) {
        return Gaming.Strings.plurals[id] || missingPluralID(id);
    }

    const _stringTemplateTokenFindRegex = /<([^>]+)>/g;
    const _stringTemplateTokenScrubRegex = /[<>]/g
    String.fromTemplate = function(template, data) {
        if (!template || !data) { return template; }
        let matches = template.match(_stringTemplateTokenFindRegex);
        if (!matches) { return template; }

        // yo, <mineCountTemplate#mineCount> cleared. { mineCount: { value: 3, formatted: "3" } }
        let rules = matches.map(token => {
            // "<x>" => ["x"], and "<x#y#z>" => ["x", "y", "z"]
            let plural = token.replaceAll(_stringTemplateTokenScrubRegex, "").split("#");
            if (plural.length > 1) {
                return { token: token, templateKey: plural[0], magnitudeKey: plural[1], formattedMagnitudeKey: plural[2] };
            } else {
                return { token: token, key: plural[0] };
            }
        });

        rules.forEach(rule => {
            if (rule.hasOwnProperty("magnitudeKey")) {
                if (data.hasOwnProperty(rule.magnitudeKey)) {
                    let magnitude = data[rule.magnitudeKey];
                    if (typeof(magnitude) == 'object' && magnitude.hasOwnProperty("value")) {
                        let value = Gaming.Strings.pluralize(rule.templateKey, magnitude.value, magnitude.formatted);
                        template = template.replaceAll(rule.token, value);
                    } else {
                        let value = Gaming.Strings.pluralize(rule.templateKey, data[rule.magnitudeKey], data[rule.formattedMagnitudeKey]);
                        template = template.replaceAll(rule.token, value);
                    }
                }
            } else {
                if (data.hasOwnProperty(rule.key)) {
                    let value = data[rule.key];
                    if (typeof(value) == 'object' && value.hasOwnProperty("formatted")) {
                        value = value.formatted;
                    }
                    template = template.replaceAll(rule.token, value);
                }
            }
        });
        return template;
    };

    String.pluralize = function(template, placeholder, formattedMagnitude) {
        if (!template) { return template; }
        return template.replaceAll(placeholder, formattedMagnitude);
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
