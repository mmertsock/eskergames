"use-strict";

if (!Number.uiInteger) {

// Assumes value is already an integer, caller should use round/floor/etc. if needed
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
    
}

// Text localization
export class Strings {
    // Initialize with keys -> localized strings, e.g. from a config file,
    // and optionally the user's preferred region.
    // Special keys in the first dictionary:
    // _regionCode sub-dictionaries for l10n. For example _es: { key: value }
    // _debug: true to add debug markers to unknown strings
    // _defaultRegion to document the region the root/default language is implemented in
    // _debugRegion to override the preferred region for testing specific languages
    static initialize(dict, pluralDict, region) {
        Strings.all = {
            source: dict || {},
            plurals: pluralDict || {}
        };
        Strings.debug = !!Strings.all.source._debug;
        Strings.defaultRegion = Strings.all.source._defaultRegion || "??";
        Strings.debugRegion = Strings.all.source._debugRegion || null;
        Strings.setRegion(Strings.debugRegion || region);
    }

    // Specify a region code, e.g. "en-us"
    // null to use default language
    static setRegion(value) {
        Strings.region = value || Strings.defaultRegion;
        let lang = Strings.region.split("-")[0];
        let key = "_" + lang;
        if (Strings.all.source.hasOwnProperty(key) && Strings.all.plurals.hasOwnProperty(key)) {
            Strings.source = Strings.all.source[key];
            Strings.plurals = Strings.all.plurals[key];
            if (Strings.debug) { console.log(`Strings: set region ${value}: using ${key}`); }
            if (!self.isWorkerScope) {
                document.querySelector(":root").lang = lang;
            }
        } else {
            Strings.source = Strings.all.source;
            Strings.plurals = Strings.all.plurals;
            if (Strings.debug && value != Strings.defaultRegion) { console.log(`Strings: set region ${value}: ${key} not found, using default`); }
        }
    }

    // id: key in Strings config data
    static str(id, fallback) {
        if (Strings.source.hasOwnProperty(id)) {
            return Strings.source[id];
        }
        if (typeof(fallback) != 'undefined') {
            return fallback;
        }
        return missingString(Strings.all.source.hasOwnProperty(id) ? Strings.all.source[id] : id);
    }
    
    static value(id, fallback) {
        if (Strings.source.hasOwnProperty(id)) {
            return Strings.source[id];
        }
        if (!!fallback) {
            return Strings.all.source[id];
        } else {
            return undefined;
        }
    }

    // id: key in Strings config data
    // data: object
    static template(id, data, fallback) {
        let template = Strings.str(id, fallback);
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
    
    static localizeDOM(root, templateDataProvider) {
        root.querySelectorAll("[data-l10n-str]").forEach(elem => {
            elem.innerText = Strings.str(elem.dataset.l10nStr);
        });
        root.querySelectorAll("[data-l10n-template]").forEach(elem => {
            let tokens = elem.dataset.l10nTemplate.split(",");
            let context = {};
            if (tokens.length > 1){
                context = templateDataProvider(tokens[1], elem);
            }
            if (elem.dataset.hasOwnProperty("l10nHtml")) {
                elem.innerHTML = Strings.template(tokens[0], context);
            } else {
                elem.innerText = Strings.template(tokens[0], context);
            }
        });
    }
}
Strings.source = {}; // call Strings.initialize() to configure

let sources = {
    preferred: 0,
    fallback: 1,
    missing: 2
};

function missingString(value) {
    return Strings.debug ? `?${value}?` : value;
}

function pluralTemplates(id) {
    if (Strings.plurals.hasOwnProperty(id)) {
        return Strings.plurals[id];
    } else if (Strings.all.plurals.hasOwnProperty(id)) {
        return missingPluralID(Strings.all.plurals[id]);
    } else {
        return missingPluralID(id);
    }
}

function missingPluralID(value) {
    if (Array.isArray(value)) {
        return Strings.debug ? value.map(item => missingString(item)) : value;
    } else {
        return Strings.debug ? [`?${value}/0?`, `?${value}/1?`, `?${value}/#?`] : [`${value}/0`, `${value}/1`, `${value}/#`]
    }
}

if (!String.fromTemplate) {

const _stringTemplateTokenFindRegex = /<([^>]+)>/g;
const _stringTemplateTokenScrubRegex = /[<>]/g
String.fromTemplate = function(template, data) {
    if (!template) { return template; } // || !data
    let matches = template.match(_stringTemplateTokenFindRegex);
    if (!matches) { return template; }
    if (!data) { data = {}; }

    // yo, <mineCountTemplate#mineCount> cleared. { mineCount: { value: 3, formatted: "3" } }
    let rules = matches.map(token => {
        // "<x>" => ["x"], and "<x#y#z>" => ["x", "y", "z"]
        let plural = token.replaceAll(_stringTemplateTokenScrubRegex, "").split("#");
        if (plural.length > 1) {
            return { token: token, templateKey: plural[0], magnitudeKey: plural[1], formattedMagnitudeKey: plural[2] };
        } else if (plural[0].startsWith("%")) {
            // "<%xx>": decode URL-encoded value
            return { token: token, decode: plural[0] }
        } else {
            return { token: token, key: plural[0] };
        }
    });

    rules.forEach(rule => {
        if (rule.hasOwnProperty("decode")) {
            template = template.replaceAll(rule.token, decodeURIComponent(rule.decode));
        } else if (rule.hasOwnProperty("magnitudeKey")) {
            if (data.hasOwnProperty(rule.magnitudeKey)) {
                let magnitude = data[rule.magnitudeKey];
                if (typeof(magnitude) == 'object' && magnitude.hasOwnProperty("value")) {
                    let value = Strings.pluralize(rule.templateKey, magnitude.value, magnitude.formatted);
                    template = template.replaceAll(rule.token, value);
                } else {
                    let value = Strings.pluralize(rule.templateKey, data[rule.magnitudeKey], data[rule.formattedMagnitudeKey]);
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

Array.oxfordCommaList = function(items) {
    if (!items) return items;
    switch (items.length) {
        case 0: return "";
        case 1: return items[0];
        case 2: return Strings.template("oxfordCommaTwoItemsTemplate", { first: items[0], last: items[1] });
        default:
            let last = items.pop();
            return Strings.template("oxfordCommaManyItemsTemplate", {
                first: items.join(Strings.str("oxfordCommaManyItemsSeparator")),
                last: last
            });
    }
};

} // end if (!String.fromTemplate)
