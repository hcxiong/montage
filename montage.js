/* <copyright>
 This file contains proprietary software owned by Motorola Mobility, Inc.<br/>
 No rights, expressed or implied, whatsoever to this software are provided by Motorola Mobility, Inc. hereunder.<br/>
 (c) Copyright 2011 Motorola Mobility, Inc.  All Rights Reserved.
 </copyright> */

document._montageTiming = {}
document._montageTiming.loadStartTime = Date.now();

// Give a threshold before we decide we need to show the bootstrapper progress
// Applications that use our loader will interact with this timeout
// and class name to coordinate a nice loading experience. Applications that do not will
// just go about business as usual and draw their content as soon as possible.
window.addEventListener("DOMContentLoaded", function() {
    var bootstrappingDelay = 1000;
    document._montageStartBootstrappingTimeout = setTimeout(function() {
        document._montageStartBootstrappingTimeout = null;

        var root = document.documentElement;
        if(!!root.classList) {
            root.classList.add("montage-app-bootstrapping");
        } else {
            root.className = root.className + " montage-app-bootstrapping";
        }

        document._montageTiming.bootstrappingStartTime = Date.now();
    }, bootstrappingDelay);
});

(function (definition) {
    if (typeof require !== "undefined") {
        // CommonJS / NodeJS
        definition(require, exports, module);
    } else {
        // <script>
        definition({}, {}, {});
    }
})(function (require, exports, module) {

    // The global context object, works for the browser and for node.
    // XXX Will not work in strict mode
    var global = (function() {
        return this;
    })();

    /**
     * Initializes Montage and creates the application singleton if necessary.
     * @param options
     * @param callback
     */
    exports.initMontage = function () {
        var platform = exports.getPlatform();
        var params = platform.getParams();
        var config = platform.getConfig();

        // Platform dependent
        platform.loadCJS(function (CJS, Q) {

            // setup the reel loader
            config.makeLoader = function (config) {
                return exports.ReelLoader(config,
                    CJS.DefaultLoaderConstructor(config));
            };

            // setup serialization compiler
            config.makeCompiler = function (config) {
                return exports.TemplateCompiler(config,
                    exports.SerializationCompiler(config,
                        CJS.DefaultCompilerConstructor(config)));
            };

            var location = CJS.canonicalURI(CJS.dirname(params["package"] || "."));

            CJS.PackageSandbox(params.montageBase, config)
            .then(function (montageRequire) {
                montageRequire.config.modules["core/promise"] = {exports: Q};
                montageRequire.config.modules["core/shim/timers"] = {exports: {}};
                return montageRequire.loadPackage(location)
                .then(function (applicationRequire) {
                    global.require = applicationRequire;
                    global.montageRequire = montageRequire;
                    platform.initMontage(montageRequire, applicationRequire, params);
                })
            })
            .end();

        });

    };

    /**
     Adds "_montage_metadata" property to all objects and function attached to
     the exports object.
     @see Compiler middleware in require/require.js
     @param config
     @param compiler
     */
    exports.SerializationCompiler = function(config, compiler) {
        return function(def) {
            def = compiler(def);
            var defaultFactory = def.factory;
            def.factory = function(require, exports, module) {
                defaultFactory.call(this, require, exports, module);
                for (var symbol in exports) {
                    // avoid attempting to reinitialize an aliased property
                    if (
                        Object.prototype.hasOwnProperty.call(
                            exports[symbol],
                            "_montage_metadata"
                        )
                    ) {
                        exports[symbol]._montage_metadata.aliases.push(symbol);
                        exports[symbol]._montage_metadata.objectName = symbol;
                    } else if (!Object.isSealed(exports[symbol])) {
                        Object.defineProperty(
                            exports[symbol],
                            "_montage_metadata",
                            {
                                value: {
                                    require: require,
                                    moduleId: module.id,
                                    objectName: symbol,
                                    aliases: [symbol],
                                    isInstance: false
                                }
                            }
                        );
                    }
                }
            };
            return def;
        };
    };

    /**
     * Allows reel directories to load the contained eponymous JavaScript
     * module.
     * @see Loader middleware in require/require.js
     * @param config
     * @param loader the next loader in the chain
     */
    var reelExpression = /([^\/]+)\.reel$/;
    exports.ReelLoader = function (config, loader) {
        return function (id, callback) {
            var match = reelExpression.exec(id);
            if (match) {
                return loader(id + "/" + match[1], callback);
            } else {
                return loader(id, callback);
            }
        };
    };

    /**
     Allows the reel's html file to be loaded via require.
     @see Compiler middleware in require/require.js
     @param config
     @param compiler
     */
    exports.TemplateCompiler = function(config, compiler) {
        return function(def) {
            var root = def.path.match(/(.*\.reel\/)(?=.*\.html$)/);
            if (root) {
                def.dependencies = def.dependencies || [];
                var originalFactory = def.factory;
                def.factory = function(require, exports, module) {
                    if (originalFactory) {
                        originalFactory(require, exports, module);
                    }
                    // Use module.exports in case originalFactory changed it.
                    module.exports.root = module.exports.root || root;
                    module.exports.content = module.exports.content || def.text;
                };
                return def;
            } else {
                return compiler(def);
            }
        };
    };

    // Bootstrapping for multiple-platforms

    exports.getPlatform = function () {
        if (typeof window !== "undefined" && window && window.document) {
            return browser;
        } else {
            throw new Error("Platform not supported.");
        }
    };

    var browser = {

        getConfig: function() {
            return {
                lib: ".",
                base: window.location,
                // Disable XHR loader for file://
                xhr: window.location.protocol.indexOf("file:") !== 0
            };
        },

        getParams: function() {
            var i, j,
                match,
                script,
                attr,
                name;
            if (!this._params) {
                this._params = {};
                // Find the <script> that loads us, so we can divine our
                // parameters from its attributes.
                var scripts = document.getElementsByTagName("script");
                for (i = 0; i < scripts.length; i++) {
                    script = scripts[i];
                    if (script.src && (match = script.src.match(/^(.*)montage.js(?:[\?\.]|$)/i))) {
                        this._params.montageBase = match[1];
                        if (script.dataset) {
                            for (name in script.dataset) {
                                this._params[name] = script.dataset[name];
                            }
                        } else if (script.attributes) {
                            for (j = 0; j < script.attributes.length; j++) {
                                attr = script.attributes[j];
                                match = attr.name.match(/^data-(.*)$/);
                                if (match) {
                                    this._params[match[1]] = attr.value;
                                }
                            }
                        }
                        // Permits multiple montage.js <scripts>; by
                        // removing as they are discovered, next one
                        // finds itself.
                        script.parentNode.removeChild(script);
                        break;
                    }
                }
            }
            return this._params;
        },

        loadCJS: function (callback) {
            var base, CJS, DOM, Q;

            var params = this.getParams();

            // observe dom loading and load scripts in parallel

            // observe dom loaded
            function domLoad() {
                document.removeEventListener("DOMContentLoaded", domLoad, true);
                DOM = true;
                callbackIfReady();
            }

            // this permits montage.js to be injected after domready
            if (document.readyState === "complete") {
                domLoad();
            } else {
                document.addEventListener("DOMContentLoaded", domLoad, true);
            }

            // determine which scripts to load
            var pending = [
                "require/require",
                "require/browser",
                "core/promise",
                "core/jshint"
            ];
            if (typeof setImmediate === "undefined")
                pending.push("core/shim/timers");

            // load in parallel
            pending.forEach(function(name) {
                var url = params.montageBase + name + ".js";
                var script = document.createElement("script");
                script.src = url;
                script.onload = function () {
                    // remove clutter
                    script.parentNode.removeChild(script);
                };
                document.getElementsByTagName("head")[0].appendChild(script);
            });

            // register module definitions for deferred,
            // serial execution
            var definitions = {};
            global.bootstrap = function (id, factory) {
                definitions[id] = factory;
                var at = pending.indexOf(id);
                pending.splice(at, 1);
                if (pending.length === 0) {
                    allModulesLoaded();
                }
            };

            // miniature module system
            var bootModules = {};
            function bootRequire(id) {
                if (!bootModules[id] && definitions[id]) {
                    var exports = bootModules[id] = {};
                    definitions[id](bootRequire, exports);
                }
                return bootModules[id];
            }

            // execute bootstrap scripts
            function allModulesLoaded() {
                Q = bootRequire("core/promise");
                CJS = bootRequire("require/require");
                bootRequire("require/browser");
                delete global.bootstrap;
                callbackIfReady();
            }

            function callbackIfReady() {
                if (DOM && CJS) {
                    callback(CJS, Q);
                }
            }

        },

        initMontage: function (montageRequire, applicationRequire, options) {
            // If a module was specified in the config then we initialize it now
            if (options.module) {
                applicationRequire.async(options.module)
                .end();
            } else {
            // otherwise we load the application
                montageRequire.async("ui/application", function(exports) {
                    montageRequire.async("core/event/event-manager", function(eventManagerExports) {

                        var defaultEventManager = eventManagerExports.defaultEventManager;

                        // montageWillLoad is mostly for testing purposes
                        if (typeof global.montageWillLoad === "function") {
                            global.montageWillLoad();
                        }
                        exports.Application.load(function(application) {
                            exports.application = application;
                            window.document.application = application;
                            defaultEventManager.application = application;
                            application.eventManager = defaultEventManager;
                        });
                    });
                });
            }
        }

    };

    if (global.__MONTAGE_LOADED__) {
        console.warn("Montage already loaded!");
    } else {
        global.__MONTAGE_LOADED__ = true;
        exports.initMontage();
    }

});