/*
ensure implementation has a list of features we want to use
*/

/* eslint-disable dot-notation */

/*

transpile/ (dossier contenant les fichiers transpilé pour une config de plugins babel donné)
on peut retrouver le cache transpile en utilisant user-agent qui nous donne scan-output.json
(si ce cache n'existe pas le serveur renverra une erreur spécifique car c'est jaamis censé arriver)
ce qui permet de reproduire la config de plugins nécéssaire et de hit le cache ou pas

*/

var rootFolder = '../..';
var cacheFolder = rootFolder + '/cache';
var featuresPath = rootFolder + '/src/features/features.js';
var solutionsPath = rootFolder + '/src/features/solutions.js';

var memoize = require('../memoize.js');
var fsAsync = require('../fs-async.js');
var store = require('../store.js');

var jsenv = global.jsenv;
var Iterable = jsenv.Iterable;
var handlers = {};
var options = {
    cache: true
};
var transpiledFeaturesProperties = {
    path: cacheFolder + '/features.js',
    sources: [
        {path: featuresPath, strategy: 'mtime'}
    ]
};
var scanResultProperties = {
    name: 'scan-result.json',
    sources: [
        {path: featuresPath, strategy: 'eTag'}
    ]
};
var fixResultEntryProperties = {
    name: 'fix-result.json',
    sources: [
        {path: featuresPath, strategy: 'eTag'},
        {path: solutionsPath, strategy: 'eTag'}
        // servira à spécifier quelles features on utilise parmi celles dispos
        // {name: '.jsenv.js', strategy: 'eTag'}
    ]
};

function instruct(code, reason, detail) {
    return {
        code: code,
        reason: reason,
        detail: detail
    };
}
var solutions = require(solutionsPath);
function filterFeatureWithoutSolution(features) {
    return Iterable.filter(features, function(feature) {
        return featureHasSolution(feature) === false;
    });
}
function featureHasSolution(feature) {
    return findFeatureSolution(feature) !== null;
}
function findFeatureSolution(feature) {
    return Iterable.find(solutions, function(solution) {
        return Iterable.find(solution.features, function(featureName) {
            return feature.match(featureName);
        });
    });
}

handlers['INITIAL'] = function(state) {
    return readScanResult({
        userAgent: state.meta.userAgent
    }).then(function(data) {
        if (data.valid) {
            var scanResult = data.value;
            return getInstruction({
                step: 'SCAN',
                meta: {
                    userAgent: state.meta.userAgent
                },
                status: scanResult.status,
                reason: scanResult.reason,
                detail: scanResult.detail
            }, true);
        }
        return getTranspiledFeatures().then(function(features) {
            return instruct('SCAN', 'unknown-implementation', features);
        });
    });
};
function readScanResult(meta) {
    return getScanResultEntry(meta).then(function(entry) {
        return entry.read();
    });
}
function writeScanResult(meta, state) {
    return getScanResultEntry(meta).then(function(entry) {
        return entry.write({
            status: state.status,
            reason: state.reason,
            detail: state.detail
        });
    });
}
function getScanResultEntry(meta) {
    var path = cacheFolder + '/scan';

    return store.fileSystemCache(path).then(function(cache) {
        return cache.match(meta);
    }).then(function(cacheBranch) {
        return cacheBranch.entry(scanResultProperties);
    });
}
function getTranspiledFeatures() {
    var createFeatures = function() {
        return fsAsync.getFileContent(featuresPath).then(function(code) {
            var babel = require('babel-core');
            var result = babel.transform(code, {
                plugins: [
                    'transform-es2015-template-literals'
                ]
            });
            return result.code;
        });
    };

    if (options.cache) {
        createFeatures = memoize.async(
            createFeatures,
            store.fileSystemEntry(transpiledFeaturesProperties)
        );
    }

    return createFeatures();
}

handlers['SCAN'] = function(state, shortCircuited) {
    if (!shortCircuited) {
        writeScanResult({
            userAgent: state.meta.userAgent
        }, state);
    }

    var implementation = createImplementation(state.detail);
    var problematicFeatures = implementation.getProblematicFeatures();
    var problematicFeaturesWithoutSolution = filterFeatureWithoutSolution(problematicFeatures);
    if (problematicFeaturesWithoutSolution.length) {
        var problems = Iterable.map(problematicFeaturesWithoutSolution, function(feature) {
            return {
                type: 'feature-has-no-solution',
                meta: {
                    feature: {
                        name: feature.name
                    }
                }
            };
        });
        return instruct('FAIL', 'missing-solution', problems);
    }

    function getFixedFeatures() {
        var requiredTranspileSolutions = Iterable.filter(solutions, function(solution) {
            return solution.type === 'transpile' && solution.isRequired(implementation);
        });
        var requiredPlugins = requiredTranspileSolutions.map(function(solution) {
            return {
                name: solution.name,
                options: solution.getConfig(implementation)
            };
        });
        var pluginsAsOptions = Iterable.map(requiredPlugins, function(plugin) {
            return [plugin.name, plugin.options];
        });

        return getTranspiler(pluginsAsOptions).then(function(transpiler) {
            var plugin = createTransformTemplateLiteralsTaggedWithPlugin(function(code) {
                return transpiler.transpile(code, featuresPath, {
                    as: 'code',
                    cache: false // disable cache to prevent race condition with transpileFile() below
                });
            }, 'transpile');

            return transpiler.transpileFile(featuresPath, {
                as: 'code',
                plugins: [
                    plugin
                ],
                sources: [
                     {path: solutionsPath, strategy: 'mtime'}
                ]
            });
        });
    }

    return readFixResult({
        userAgent: state.meta.userAgent,
        problematicFeatures: problematicFeatures
    }).then(function(data) {
        var fixResult = data.value;
        if (data.valid) {
            if (fixResult.status === 'failed') {
                return instruct('FAIL', fixResult.reason, fixResult.detail);
            }
        }

        var requiredPolyfillSolutions = Iterable.filter(solutions, function(solution) {
            return solution.type === 'polyfill' && solution.isRequired(implementation);
        });
        return getPolyfiller(requiredPolyfillSolutions).then(function(polyfiller) {
            var fixInstruction = instruct('FIX', 'missing-features', {fix: polyfiller.code});

            // fix
            if (data.valid) {
                return getInstruction({
                    step: 'FIX',
                    meta: state.meta,
                    status: fixResult.status,
                    reason: fixResult.reason,
                    detail: fixResult.detail
                }, true).then(function(fixInstruction) {
                    if (fixInstruction.status === 'COMPLETE') {
                        return fixInstruction;
                    }
                    return fixInstruction;
                });
            }
            // fix + check and send back how it went
            return getFixedFeatures().then(function(code) {
                fixInstruction.detail.features = code;
                return fixInstruction;
            });
        });
    });
};
function readFixResult(meta) {
    return getFixResultEntry(meta).then(function(fixResultEntry) {
        return fixResultEntry.read();
    });
}
function writeFixResult(meta, state) {
    return getFixResultEntry(meta).then(function(entry) {
        return entry.write({
            status: state.status,
            reason: state.reason,
            detail: state.detail
        });
    });
}
function getFixResultEntry(meta) {
    var path = cacheFolder + '/fix';
    return store.fileSystemCache(path).then(function(cache) {
        return cache.match(meta);
    }).then(function(cacheBranch) {
        return cacheBranch.entry(fixResultEntryProperties);
    });
}
function createImplementation(report) {
    var features = Iterable.map(report.features, function(featureData) {
        var feature = jsenv.createFeature(featureData.name);
        jsenv.assign(feature, featureData);
        return feature;
    });
    var implementation = {
        features: features,
        get: function(name) {
            var foundfeature = Iterable.find(this.features, function(feature) {
                return feature.match(name);
            });
            if (!foundfeature) {
                throw new Error('feature not found ' + foundfeature);
            }
            return foundfeature;
        },

        getProblematicFeatures: function() {
            return Iterable.filter(features, function(feature) {
                return feature.isProblematic();
            });
        }
    };

    [
        'const-throw-statement',
        'const-throw-redefine',
        'function-prototype-name-new',
        'function-prototype-name-accessor',
        'function-prototype-name-method',
        'function-prototype-name-method-computed-symbol',
        'function-prototype-name-bind', // corejs & babel fail this
        'function-default-parameters-temporal-dead-zone',
        'function-default-parameters-scope-own',
        'function-default-parameters-new-function',
        'function-rest-parameters-arguments',
        'function-rest-parameters-new-function',
        'spread-function-call-throw-non-iterable',
        'destructuring-assignment-object-throw-left-parenthesis',
        'destructuring-parameters-array-new-function',
        'destructuring-parameters-object-new-function'
    ].forEach(function(featureName) {
        implementation.get(featureName).disable('babel do not provide this');
    });
    implementation.get('function-prototype-name-description').disable('cannot be polyfilled');

    return implementation;
}
function getPolyfiller(requiredSolutions) {
    var requiredModules = Iterable.filter(requiredSolutions, function(solution) {
        return solution.author === 'corejs';
    });
    var requiredFiles = Iterable.filter(requiredSolutions, function(solution) {
        return solution.author === 'me';
    });
    var requiredModuleNames = Iterable.map(requiredModules, function(module) {
        return module.name;
    });
    var requiredFilePaths = Iterable.map(requiredFiles, function(file) {
        return file.name;
    });

    var createPolyfill = function() {
        function createCoreJSPolyfill() {
            var requiredModulesAsOption = requiredModuleNames;
            console.log('concat corejs modules', requiredModuleNames);

            return new Promise(function(resolve) {
                var buildCoreJS = require('core-js-builder');
                var promise = buildCoreJS({
                    modules: requiredModulesAsOption,
                    librabry: false,
                    umd: true
                });
                resolve(promise);
            });
        }
        function createOwnFilePolyfill() {
            console.log('concat files', requiredFilePaths);

            var fs = require('fs');
            var sourcesPromises = Iterable.map(requiredFilePaths, function(filePath) {
                return new Promise(function(resolve, reject) {
                    fs.readFile(filePath, function(error, buffer) {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(buffer.toString());
                        }
                    });
                });
            });
            return Promise.all(sourcesPromises).then(function(sources) {
                return sources.join('\n\n');
            });
        }

        return Promise.all([
            createCoreJSPolyfill(),
            createOwnFilePolyfill()
        ]).then(function(sources) {
            return sources.join('\n\n');
        });
    };

    if (options.cache) {
        var getPolyfillCacheBranch = function(meta) {
            var path = cacheFolder + '/polyfill';
            return store.fileSystemCache(path).then(function(cache) {
                return cache.match(meta);
            });
        };

        return getPolyfillCacheBranch({
            coreJs: requiredModuleNames,
            files: requiredFilePaths
        }).then(function(storeBranch) {
            return memoize.async(
                createPolyfill,
                storeBranch.entry({
                    name: 'polyfill.js',
                    sources: requiredFilePaths.map(function(filePath) {
                        return {
                            path: filePath,
                            strategy: 'mtime'
                        };
                    })
                })
            )();
        }).then(function(code) {
            return {
                code: code
            };
        });
    }

    return createPolyfill().then(function(polyfill) {
        return {
            code: polyfill
        };
    });
}
function getTranspiler(pluginsAsOptions) {
    console.log('required babel plugins', pluginsAsOptions.map(function(plugin) {
        return plugin[0];
    }));

    function getNodeFilePath(path) {
        var nodeFilePath;
        if (path.indexOf('file:///') === 0) {
            nodeFilePath = path.slice('file:///'.length);
        } else {
            nodeFilePath = path;
        }
        return nodeFilePath;
    }
    function getTranspileCacheBranch() {
        var path = cacheFolder + '/transpile';
        return store.fileSystemCache(path).then(function(store) {
            return store.match({
                plugins: pluginsAsOptions
            });
        });
    }
    function getFileEntry(path, transpilationOptions) {
        var nodeFilePath = getNodeFilePath(path);

        if (nodeFilePath.indexOf(rootFolder) === 0) {
            var relativeFilePath = nodeFilePath.slice(rootFolder.length);

            return getTranspileCacheBranch().then(function(storeBranch) {
                var entryName;
                if (transpilationOptions.as === 'module') {
                    entryName = 'modules/' + relativeFilePath;
                } else {
                    entryName = relativeFilePath;
                }

                var entrySources;
                if (transpilationOptions.sources) {
                    entrySources = transpilationOptions.sources.slice();
                } else {
                    entrySources = [];
                }
                entrySources.push({path: nodeFilePath, strategy: 'mtime'});

                var entry = storeBranch.entry({
                    name: entryName,
                    sources: entrySources
                });
                return entry;
            });
        }
        return Promise.resolve(null);
    }

    var transpile = function(code, filename, transpilationOptions) {
        transpilationOptions = transpilationOptions || {};

        var transpileCode = function(sourceURL) {
            var plugins;
            if (transpilationOptions.plugins) {
                plugins = transpilationOptions.plugins;
            } else if (transpilationOptions.as === 'module') {
                plugins = pluginsAsOptions.slice();
                plugins.unshift('transform-es2015-modules-systemjs');
            } else {
                plugins = pluginsAsOptions;
            }

            // https://babeljs.io/docs/core-packages/#options
            // inputSourceMap: null,
            // minified: false

            var babelOptions = {};
            babelOptions.plugins = plugins;
            babelOptions.ast = false;
            if ('sourceMaps' in transpilationOptions) {
                babelOptions.sourceMaps = transpilationOptions.sourceMaps;
            } else {
                babelOptions.sourceMaps = 'inline';
            }

            var babel = require('babel-core');
            var result = babel.transform(code, babelOptions);
            var transpiledCode = result.code;
            transpiledCode += '\n//# sourceURL=' + sourceURL;
            return transpiledCode;
        };

        if (options.cache && transpilationOptions.cache !== false) {
            var entry = getFileEntry(filename);
            if (entry) {
                return memoize.async(
                    transpileCode,
                    entry
                )(entry.path);
            }
        }
        return transpileCode(filename + '!transpiled');
    };

    var transpiler = {
        plugins: pluginsAsOptions,
        transpile: transpile,
        transpileFile: function(filePath, transpilationOptions) {
            function createTranspiledCode(transpilationOptions) {
                return fsAsync.getFileContent().then(function(code) {
                    return transpiler.tranpile(code, transpilationOptions);
                });
            }

            var entry = getFileEntry(filePath, transpilationOptions);
            if (entry) {
                // désactive le cache lorsque entry ne matche pas
                // puisqu'on a déjà tester s'il existait un cache valide
                var unmemoizedOptions = {};
                jsenv.assign(unmemoizedOptions, transpilationOptions);
                unmemoizedOptions.cache = false;

                return memoize.async(
                    createTranspiledCode,
                    entry
                )(unmemoizedOptions);
            }

            return createTranspiledCode(transpilationOptions);
        }
    };

    return Promise.resolve(transpiler);
}
function createTransformTemplateLiteralsTaggedWithPlugin(transpile, TAG_NAME) {
    TAG_NAME = TAG_NAME || 'transpile';

    function transformTemplateLiteralsTaggedWithPlugin(babel) {
        // inspired from babel-transform-template-literals
        // https://github.com/babel/babel/blob/master/packages/babel-plugin-transform-es2015-template-literals/src/index.js#L36
        var t = babel.types;

        function transpileTemplate(strings) {
            var result;
            var raw = strings.raw;
            var i = 0;
            var j = raw.length;
            result = raw[i];
            i++;
            while (i < j) {
                result += arguments[i];
                result += raw[i];
                i++;
            }

            try {
                return transpile(result);
            } catch (e) {
                // if there is an error
                // let test a chance to eval untranspiled string
                // and catch error it may be a test which is trying
                // to ensure compilation error (syntax error for example)
                return result;
            }
        }

        function visitTaggedTemplateExpression(path, state) {
            var node = path.node;
            if (!t.isIdentifier(node.tag, {name: TAG_NAME})) {
                return;
            }
            var quasi = node.quasi;
            var quasis = quasi.quasis;
            var expressions = quasi.expressions;

            var values = expressions.map(function(expression) {
                return expression.evaluate().value;
            });
            var strings = quasis.map(function(quasi) {
                return quasi.value.cooked;
            });
            var raw = quasis.map(function(quasi) {
                return quasi.value.raw;
            });
            strings.raw = raw;

            var tanspileArgs = [];
            tanspileArgs.push(strings);
            tanspileArgs.push.apply(tanspileArgs, values);
            var transpiled = transpileTemplate.apply(null, tanspileArgs);

            var args = [];
            var templateObject = state.file.addTemplateObject(
                'taggedTemplateLiteral',
                t.arrayExpression([
                    t.stringLiteral(transpiled)
                ]),
                t.arrayExpression([
                    t.stringLiteral(transpiled)
                ])
            );
            args.push(templateObject);
            path.replaceWith(t.callExpression(node.tag, args));
        }

        return {
            visitor: {
                TaggedTemplateExpression: visitTaggedTemplateExpression
            }
        };
    }

    return transformTemplateLiteralsTaggedWithPlugin;
}

handlers['FIX'] = function(state, shortCircuited) {
    var promise = Promise.resolve();

    if (!shortCircuited) {
        readScanResult({
            userAgent: state.meta.userAgent
        }).then(function(data) {
            if (data.valid) {
                var scanResult = data.value;
                var scanImplementation = createImplementation(scanResult.detail);
                var scanProblematicFeatures = scanImplementation.getProblematicFeatures();

                writeFixResult({
                    userAgent: state.meta.userAgent,
                    problematicFeatures: scanProblematicFeatures
                }, state);
            } else {
                // on ne peut pas écrire dans le cache on ne connait pas les features problématiques
            }
        });
    }

    var implementation = createImplementation(state.data);
    var problematicFeatures = implementation.getProblematicFeatures();

    return promise.then(function() {
        if (problematicFeatures.length) {
            var problems = Iterable.map(problematicFeatures, function(feature) {
                var solution = findFeatureSolution(feature);

                return {
                    type: 'feature-solution-is-invalid',
                    meta: {
                        feature: {
                            name: feature.name
                        },
                        solution: {
                            name: solution.name,
                            type: solution.type,
                            author: solution.author
                        }
                    }
                };
            });
            return instruct('FAIL', 'invalid-solution', problems);
        }
        return instruct('COMPLETE', 'fixed');
    });
};

function getInstruction(state, shortCircuited) {
    return new Promise(function(resolve) {
        resolve(handlers[state.step](state, shortCircuited));
    }).catch(function(value) {
        return instruct(
            'FAIL',
            'unhandled-rejection',
            value
        );
    });
}

module.exports = function(state, resolve) {
    return getInstruction(state).then(resolve);
};