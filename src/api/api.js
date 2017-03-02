/*

this is all about mapping
https://github.com/babel/babel-preset-env/blob/master/data/plugin-features.js
with
https://github.com/kangax/compat-table/blob/gh-pages/data-es5.js
https://github.com/kangax/compat-table/blob/gh-pages/data-es6.js

- test() / fix() / scan() / polyfill() doit marche avec object/assign

- changer feature.name pour feature.id

- mettre en place limit: {value: number, strategy: string} dans store.js
parce que ça a des impacts sur l amanière dont on utilise l'api ensuite
en effet, le fait qu'une branche puisse disparaitre signifique que lorsqu'on fait entry.write
il faut absolument s'assurer que la branche est toujours présente dans branches.json
et n'a pas été effacé entre temps

- minification

- sourcemap

*/

require('../jsenv.js');
var path = require('path');
var Agent = require('../agent/agent.js');

var fsAsync = require('../fs-async.js');
var store = require('../store.js');
var memoize = require('../memoize.js');
var createTranspiler = require('../transpiler/transpiler.js');
var rootFolder = path.resolve(__dirname, '../../').replace(/\\/g, '/');
var cacheFolder = rootFolder + '/cache';
var corejsCacheFolder = cacheFolder + '/corejs';
var readDependencies = require('./read-module-dependencies.js');

var Iterable = jsenv.Iterable;
var Thenable = jsenv.Thenable;

var getFolder = require('./get-folder.js');
function folderFromFeatureName(featureName) {
    return getFolder() + '/' + featureName;
}
function featureNameFromFile(file) {
    var relative = file.slice(getFolder().length + 1);
    return jsenv.parentPath(relative);
}
function featureNameFromNode(node) {
    return featureNameFromFile(node.id);
}
var listFeatureNames = require('./list-feature-names.js');
var build = require('./build.js');
var transpiler = require('./transpiler.js');
var api = {};

function mapAsync(iterable, fn) {
    return Thenable.all(iterable.map(fn));
}
function stringifyErrorReplacer(key, value) {
    if (value instanceof Error) {
        var error = {};
        var properties = [];
        var property;
        for (property in value) { // eslint-disable-line guard-for-in
            properties.push(property);
        }
        var nonEnumerableProperties = ["name", "message", "stack"];
        properties.push.apply(properties, nonEnumerableProperties);
        var i = 0;
        var j = properties.length;
        while (i < j) {
            property = properties[i];
            error[property] = value[property];
            i++;
        }

        return error;
    }
    return value;
}
function stringify(value) {
    try {
        return JSON.stringify(value, stringifyErrorReplacer, '\t');
    } catch (e) {
        return '[Circular]';
    }
}
function createTestOutputProperties(featureName, agent) {
    var agentString = agent.toString();
    var featureFolderPath = getFolder() + '/' + featureName;
    var featureCachePath = featureFolderPath + '/.cache';
    var featureAgentCachePath = featureCachePath + '/' + agentString;

    var properties = {
        name: 'test-output.json',
        encode: stringify,
        sources: [
            {
                path: folderFromFeatureName(featureName) + '/test.js',
                strategy: 'eTag'
            }
        ],
        // mode: 'write-only'
        mode: 'default'
    };
    properties.path = featureAgentCachePath + '/' + properties.name;
    return properties;
}
function createFixOutputProperties(featureName, agent) {
    var agentString = agent.toString();
    var featureFolderPath = folderFromFeatureName(featureName);
    var featureCachePath = featureFolderPath + '/.cache';
    var featureAgentCachePath = featureCachePath + '/' + agentString;

    var featureFilePath = featureFolderPath + '/fix.js';
    var sources = [
        {
            path: featureFilePath,
            strategy: 'eTag'
        }
    ];
    var properties = {
        name: 'fix-output.json',
        encode: stringify,
        mode: 'write-only',
        // mode: 'default',
        sources: sources
    };
    properties.path = featureAgentCachePath + '/' + properties.name;
    return properties;
}
function readOutputFromFileSystem(featureName, agent, createProperties) {
    var cache = getFeatureAgentCache(featureName, agent, createProperties);
    return cache.read();
}
function getFeatureAgentCache(featureName, agent, createProperties) {
    var properties = createProperties(featureName, agent);
    return store.fileSystemEntry(properties);
}
function readRecordFromFileSystem(featureName, agent, type) {
    var createProperties;
    if (type === 'test') {
        createProperties = createTestOutputProperties;
    } else {
        createProperties = createFixOutputProperties;
    }

    return readOutputFromFileSystem(
        featureName,
        agent,
        createProperties
    ).then(function(data) {
        if (data.valid) {
            console.log('got valid data for', featureName);
        } else {
            console.log('no valid for', featureName, 'because', data.reason);
        }

        return {
            name: featureName,
            data: data
        };
    });
}
function recordIsMissing(record) {
    return record.data.valid === false && record.data.reason === 'file-not-found';
}
function recordIsInvalid(record) {
    return record.data.valid === false;
}
function recordIsFailed(record) {
    return record.data.value.status === 'failed';
}
function getStatus(featureName, featureAgent, includeFix) {
    return readRecordFromFileSystem(
        featureName,
        featureAgent,
        'test'
    ).then(function(testRecord) {
        if (recordIsMissing(testRecord)) {
            return 'test-missing';
        }
        if (recordIsInvalid(testRecord)) {
            return 'test-invalid';
        }
        if (recordIsFailed(testRecord)) {
            if (includeFix) {
                return readRecordFromFileSystem(
                    featureName,
                    featureAgent,
                    'fix'
                ).then(function(fixRecord) {
                    if (recordIsMissing(fixRecord)) {
                        return 'test-failed-and-fix-missing';
                    }
                    if (recordIsInvalid(fixRecord)) {
                        return 'test-failed-and-fix-invalid';
                    }
                    if (recordIsFailed(fixRecord)) {
                        return 'test-failed-and-fix-failed';
                    }
                    return 'test-failed-and-fix-passed';
                });
            }
            return 'test-failed';
        }
        return 'test-passed';
    });
}
function getAllDependencies(featureNames, mode) {
    var filename = mode === 'test' ? 'test' : 'fix';
    var featureTests = featureNames.map(function(featureName) {
        return './' + featureName + '/' + filename + '.js';
    });
    var folderPath = getFolder();
    return readDependencies(
        featureTests,
        {
            root: folderPath,
            exclude: function(id) {
                if (id.indexOf(folderPath) !== 0) {
                    return true;
                }
                return path.basename(id) !== filename + '.js';
            },
            autoParentDependency: function(id) {
                // si id est dans folderPath mais n'est pas un enfant direct de folderPath
                // folderPath/a/file.js non
                // mais folderpath/a/b/file.js oui et on renvoit folderpath/a/file.js

                // file must be inside folder
                if (id.indexOf(folderPath) !== 0) {
                    return;
                }
                var relative = id.slice(folderPath.length + 1);
                var relativeParts = relative.split('/');
                // folderPath/a/file.js -> nope
                if (relativeParts.length < 3) {
                    return;
                }
                // folderpath/a/b/file.js -> yep
                return folderPath + '/' + relativeParts.slice(0, -2) + '/' + filename + '.js';
            }
        }
    );
}
function getNodes(featureNames, mode) {
    return getAllDependencies(featureNames, mode).then(function(featureGraph) {
        return featureGraph.concat(jsenv.collectDependencies(featureGraph));
    });
}
function getTestInstructions(featureNames, agent) {
    return getNodes(featureNames, 'test').then(function(featureNodes) {
        return mapAsync(featureNodes, function(featureNode) {
            return getStatus(featureNameFromNode(featureNode), agent);
        }).then(function(statuses) {
            var nodesToTest = Iterable.filterBy(
                featureNodes,
                statuses,
                function(status) {
                    return (
                        status === 'test-missing' ||
                        status === 'test-invalid'
                    );
                }
            );
            nodesToTest = nodesToTest.concat(jsenv.collectDependencies(nodesToTest));
            return build(
                nodesToTest.map(function(featureNode) {
                    return {
                        name: {
                            type: 'inline',
                            name: '',
                            from: featureNameFromNode(featureNode)
                        },
                        testDependencies: {
                            type: 'inline',
                            name: '',
                            from: featureNode.dependencies.map(function(dependency) {
                                return nodesToTest.indexOf(dependency);
                            })
                        },
                        test: {
                            type: 'import',
                            name: 'default',
                            from: './' + featureNameFromFile(featureNode.id) + '/test.js'
                        }
                    };
                }),
                {
                    transpiler: transpiler,
                    root: getFolder()
                }
            ).then(function(bundle) {
                return bundle.source;
            });
        });
    });
}
// getTestInstructions(
//     ['object/assign'],
//     jsenv.agent
// ).then(function(data) {
//     console.log('required test data', data);
// }).catch(function(e) {
//     setTimeout(function() {
//         throw e;
//     });
// });

function writeAllRecordToFileSystem(records, agent, type) {
    var outputsPromises = records.map(function(record) {
        var createProperties;
        if (type === 'test') {
            createProperties = createTestOutputProperties;
        } else {
            createProperties = createFixOutputProperties;
        }

        return writeOutputToFileSystem(
            record.name,
            agent,
            createProperties,
            record.data
        ).then(function() {
            return undefined;
        });
    });
    return Thenable.all(outputsPromises);
}
function writeOutputToFileSystem(featureName, agent, createProperties, output) {
    var cache = getFeatureAgentCache(featureName, agent, createProperties);
    return cache.write(output);
}
function setAllTestRecord(records, agent) {
    return writeAllRecordToFileSystem(
        records,
        agent,
        'test'
    );
}
var noSolution = {
    match: featureHasNoFix
};
var inlineSolution = {
    match: featureUseInlineFix,

    solve: function() {

    }
};
var fileSolution = {
    match: featureUseFileFix,

    solve: function(solutions) {
        // console.log('the solutions', solutions);
        var filePaths = [];
        solutions.forEach(function(solution) {
            var solutionValue = solution.value;
            var filePath;
            if (solutionValue.indexOf('${rootFolder}') === 0) {
                filePath = solutionValue.replace('${rootFolder}', rootFolder);
            } else {
                if (solutionValue[0] === '.') {
                    throw new Error('solution path must be absolute');
                }
                filePath = path.resolve(
                    rootFolder,
                    solutionValue
                );
            }

            var index = filePaths.indexOf(filePath);
            if (index > -1) {
                throw new Error(
                    'file solution duplicated' + filePath
                );
            }
            filePaths.push(filePath);
        });
        // console.log('filepaths', filePaths);
        var promises = Iterable.map(filePaths, function(filePath) {
            console.log('fetch file solution', filePath);
            return fsAsync.getFileContent(filePath).then(function(content) {
                return new Function(content); // eslint-disable-line no-new-func
            });
        });
        return Thenable.all(promises);
    }
};
var coreJSSolution = {
    match: featureUseCoreJSFix,

    solve: function(solutions) {
        var moduleNames = [];
        solutions.forEach(function(solution) {
            var moduleName = solution.value;
            var index = moduleNames.indexOf(moduleName);
            if (index > -1) {
                throw new Error(
                    'corejs solution duplicated' + moduleName
                );
            }
            moduleNames.push(moduleName);
        });

        function createCoreJSBuild() {
            var source = '';
            Iterable.forEach(solutions, function(solution) {
                if (solution.beforeFix) {
                    source += '\n' + solution.beforeFix;
                }
            });
            var sourcePromise = Thenable.resolve(source);

            return sourcePromise.then(function(source) {
                if (moduleNames.length) {
                    console.log('concat corejs modules', moduleNames);
                    var buildCoreJS = require('core-js-builder');
                    var promise = buildCoreJS({
                        modules: moduleNames,
                        librabry: false,
                        umd: true
                    });
                    return promise.then(function(polyfill) {
                        source += '\n' + polyfill;

                        return source;
                    });
                }
                return source;
            });
        }

        var polyfillCache = store.fileSystemCache(corejsCacheFolder);
        return polyfillCache.match({
            modules: moduleNames
        }).then(function(cacheBranch) {
            return memoize.async(
                createCoreJSBuild,
                cacheBranch.entry({
                    name: 'build.js'
                })
            )();
        }).then(function(source) {
            return new Function(source); // eslint-disable-line no-new-func
        });
    }
};
var babelSolution = {
    match: featureUseBabelFix,

    solve: function(solutions) {
        var plugins = [];
        solutions.forEach(function(solution) {
            var createOptions = function() {
                var options = {};
                if ('config' in solution) {
                    var config = solution.config;
                    if (typeof config === 'object') {
                        jsenv.assign(options, config);
                    } else if (typeof config === 'function') {
                        jsenv.assign(options, config(solutions));
                    }
                }
                return options;
            };
            var name = solution.value;
            var options = createOptions();

            var existingPluginIndex = Iterable.findIndex(plugins, function(plugin) {
                return plugin.name === name;
            });
            if (existingPluginIndex > -1) {
                throw new Error(
                    'babel solution duplicated ' + name
                );
            } else {
                plugins.push({
                    name: name,
                    options: options
                });
            }
        });

        var pluginsAsOptions = Iterable.map(plugins, function(plugin) {
            return [plugin.name, plugin.options];
        });
        var transpiler = createTranspiler({
            cache: true,
            cacheMode: 'default',
            plugins: pluginsAsOptions
        });
        return transpiler;
    }
};
function featureHasNoFix(feature) {
    return feature.fix.type === 'none';
}
function featureUseInlineFix(feature) {
    return feature.fix.type === 'inline';
}
function featureUseFileFix(feature) {
    return feature.fix.type === 'file';
}
function featureUseCoreJSFix(feature) {
    return feature.fix.type === 'corejs';
}
function featureUseBabelFix(feature) {
    return feature.fix.type === 'babel';
}
function getFixInstructions(featureNames, agent, mode) {
    mode = mode || 'fix';
    var getAgent;
    if (mode === 'fix') {
        getAgent = function() {
            return agent;
        };
    } else {
        getAgent = function(feature) {
            // en fait c'est pas vraiment le getAgent qui doit catch mais le getStatus
            // qui lorsqu'il est appelé doit retourner test-missing
            // lorsque aucun test-output.json n'est trouvé pour cette feature
            return getClosestAgentForFeature(feature, agent).catch(function(e) {
                if (e) {
                    if (e.code === 'NO_AGENT') {
                        return {
                            valid: false,
                            reason: 'no-agent',
                            detail: e
                        };
                    }
                    if (e.code === 'NO_AGENT_VERSION') {
                        return {
                            valid: false,
                            reason: 'no-agent-version',
                            detail: e
                        };
                    }
                }
                return Promise.reject(e);
            });
        };
    }

    return getNodes(featureNames, 'fix').then(function(nodes) {
        return mapAsync(nodes, function(node) {
            return getAgent(featureNameFromNode(node), agent);
        }).then(function(agents) {
            return mapAsync(nodes, function(node, index) {
                return getStatus(featureNameFromNode(node), agents[index], true);
            });
        }).then(function(statuses) {
            var filterNodesToFix = function() {
                var testProblems = Iterable.filterBy(
                    nodes,
                    statuses,
                    function(status) {
                        return (
                            status === 'test-missing' ||
                            status === 'test-invalid'
                        );
                    }
                );
                if (testProblems.length) {
                    var problems = {};
                    testProblems.forEach(function(node, index) {
                        problems[featureNameFromNode(node)] = statuses[index];
                    });
                    throw new Error(
                        'some test status prevent fix: ' + require('util').inspect(problems)
                    );
                }

                // on pourrait pas les inclure en les considérant comme résolu?
                // genre en mettant fix.solution.value = emptyFunction ?
                // il faudrait je pense garder les dépendances étant ok
                // et les considérer comme des tests qui doivent être run
                // quoiqu'il arrive il faut run les test des fixs dont on dépend
                // par contre il faudra ne pas considérer qu'on a besoin de ces fix
                // donc les supprimer de fixDependencies
                // et aussi les supprimer des features qu'on a besoin de fix
                return Iterable.filterBy(
                    nodes,
                    statuses,
                    function(status) {
                        return (
                            status === 'test-failed-and-fix-missing' ||
                            status === 'test-failed-and-fix-invalid'
                        );
                    }
                );
            };
            var filterNodesToPolyfill = function() {
                var featureWithFailedTestAndFailedFix = Iterable.filterBy(
                    nodes,
                    statuses,
                    function(status) {
                        return status === 'test-failed-and-fix-failed';
                    }
                );
                // je ne suis pas sur qu'on va throw
                // on va ptet juste ne rien faire parce qu'on sait que ca créé une erreur plutot
                if (featureWithFailedTestAndFailedFix.length) {
                    throw new Error('unfixable features ' + featureWithFailedTestAndFailedFix);
                }

                return Iterable.filterBy(
                    nodes,
                    statuses,
                    function(status) {
                        return (
                            status === 'test-missing' ||
                            status === 'test-invalid' ||
                            status === 'test-failed-and-fix-missing' ||
                            status === 'test-failed-and-fix-invalid' ||
                            status === 'test-failed-and-fix-passed'
                        );
                    }
                );
            };

            if (mode === 'fix') {
                return filterNodesToFix();
            }
            if (mode === 'polyfill') {
                return filterNodesToPolyfill();
            }
        }).then(function(nodesToFix) {
            var abstractFeatures = nodesToFix.map(function(node) {
                return {
                    name: {
                        type: 'inline',
                        name: '',
                        from: featureNameFromNode(node)
                    },
                    fix: {
                        type: 'import',
                        name: 'default',
                        from: './' + featureNameFromNode(node) + '/fix.js'
                    },
                    fixDependencies: {
                        type: 'inline',
                        name: '',
                        from: node.dependencies.filter(function(dependency) {
                            return Iterable.includes(nodesToFix, dependency);
                        }).map(function(dependency) {
                            return nodesToFix.indexOf(dependency);
                        })
                    }
                };
            });

            return build(
                abstractFeatures,
                {
                    root: getFolder(),
                    transpiler: transpiler
                }
            ).then(function(bundle) {
                return bundle.compile();
            }).then(function(data) {
                return data.features;
            }).then(function(featuresToFix) {
                // console.log('the features', featuresToFix);
                var options = {
                    transpiler: transpiler,
                    root: getFolder(),
                    meta: {}
                };
                var pending = [];

                function filterBySolution(features, solution) {
                    var i = 0;
                    var j = features.length;
                    var matches = [];
                    while (i < j) {
                        var feature = features[i];
                        var existingFix = Iterable.find(matches, function(match) { // eslint-disable-line
                            return match.fix === feature.fix;
                        });
                        if (existingFix) {
                            // remove ducplicate fix from abstractFeatures (no need to fix them)
                            abstractFeatures.split(i, 1);
                            features.splice(i, 1);
                            j--;
                        } else if (solution.match(feature)) {
                            matches.push(feature);
                            features.splice(i, 1);
                            j--;
                        } else {
                            i++;
                        }
                    }
                    return matches;
                }
                function groupBySolution(features) {
                    var groups = {
                        inline: filterBySolution(features, inlineSolution),
                        file: filterBySolution(features, fileSolution),
                        corejs: filterBySolution(features, coreJSSolution),
                        babel: filterBySolution(features, babelSolution),
                        none: filterBySolution(features, noSolution),
                        remaining: features
                    };
                    return groups;
                }
                var groups = groupBySolution(featuresToFix.slice());

                var inlineFeatures = groups.inline;
                console.log('inline fix', inlineFeatures.length);
                var inlineSolver = inlineSolution.solve(inlineFeatures);
                pending.push(inlineSolver);

                var fileFeatures = groups.file;
                console.log('file fix', fileFeatures.length);
                var loadFileIntoAbstract = fileSolution.solve(fileFeatures).then(function(fileFunctions) {
                    fileFunctions.forEach(function(fileFunction, index) {
                        var feature = fileFeatures[index];
                        var abstractFeature = Iterable.find(abstractFeatures, function(abstractFeature) {
                            return abstractFeature.name.from === feature.name;
                        });
                        abstractFeature.fixFunction = fileFunction;
                    });
                });
                pending.push(loadFileIntoAbstract);

                var coreJSFeatures = groups.corejs;
                console.log('corejs fix', coreJSFeatures.length);
                var loadCoreJSIntoOptions = coreJSSolution.solve(coreJSFeatures).then(function(coreJSFunction) {
                    options.meta.coreJSFunction = coreJSFunction;
                });
                pending.push(loadCoreJSIntoOptions);

                if (mode === 'fix') {
                    var nodesToFixDependencies = jsenv.collectDependencies(nodesToFix);
                    var featureNamesToTest = nodesToFix.concat(nodesToFixDependencies).map(featureNameFromNode);
                    var loadTestIntoAbstract = getNodes(
                        featureNamesToTest,
                        'test'
                    ).then(function(testNodes) {
                        var abstractFeaturesHavingTest = testNodes.map(function(testNode) {
                            var featureName = featureNameFromNode(testNode);
                            var abstractFeature = Iterable.find(abstractFeatures, function(abstractFeature) {
                                return abstractFeature.name.from === featureName;
                            });
                            var abstractTestProperty = {
                                type: 'import',
                                name: 'default',
                                from: './' + featureName + '/test.js'
                            };
                            var abstractTestDependenciesProperty = {
                                type: 'inline',
                                name: ''
                            };

                            if (abstractFeature) {
                                abstractFeature.test = abstractTestProperty;
                                abstractFeature.testDependencies = abstractTestDependenciesProperty;
                            } else {
                                abstractFeature = {
                                    name: {
                                        type: 'inline',
                                        name: '',
                                        from: featureName
                                    },
                                    test: abstractTestProperty,
                                    testDependencies: abstractTestDependenciesProperty
                                };
                                abstractFeatures.push(abstractFeature);
                            }
                            return abstractFeature;
                        });

                        abstractFeaturesHavingTest.forEach(function(abstractFeature, index) {
                            var testNode = testNodes[index];
                            abstractFeature.testDependencies.from = testNode.dependencies.map(function(dependency) {
                                return abstractFeatures.indexOf(dependency);
                            });
                        });
                    });
                    pending.push(loadTestIntoAbstract);

                    var babelFeatures = groups.babel;
                    var loadFixedTranspilerIntoOptions = Thenable.resolve().then(function() {
                        return babelSolution.solve(babelFeatures);
                    }).then(function(babelTranspiler) {
                        /*
                        it may be the most complex thing involved here so let me explain
                        we create a transpiler adapted to required features
                        then we create a babel plugin which transpile template literals using that transpiler
                        finally we create a transpiler which uses that plugin
                        */
                        var plugin = createTranspiler.transpileTemplateTaggedWith(function(code) {
                            return babelTranspiler.transpile(code, {
                                as: 'code',
                                filename: false,
                                sourceMaps: false,
                                soureURL: false,
                                // disable cache to prevent race condition with the transpiler
                                // that will use this plugin (it's the parent transpiler which is reponsible to cache)
                                cache: false
                            });
                        }, 'transpile');
                        var fixedTranspiler = transpiler.clone();
                        fixedTranspiler.options.plugins.push(plugin);
                        options.transpiler = fixedTranspiler;
                    });
                    pending.push(loadFixedTranspilerIntoOptions);
                }
                if (mode === 'polyfill') {
                    options.footer = 'jsenv.polyfill(__exports__);';
                }

                return Thenable.all(pending).then(function() {
                    return build(
                        abstractFeatures,
                        options
                    ).then(function(bundle) {
                        return bundle.source;
                    });
                });
            });
        });
    });
}
// getFixInstructions(
//     ['object'],
//     jsenv.agent
// ).then(function(data) {
//     console.log('required fix data', data);
// }).catch(function(e) {
//     setTimeout(function() {
//         throw e;
//     });
// });

function setAllFixRecord(records, agent) {
    return writeAllRecordToFileSystem(
        records,
        agent,
        'fix'
    );
}

api.createOwnMediator = function(featureNames, agent) {
    agent = Agent.parse(agent);

    return {
        send: function(action, value) {
            if (action === 'getTestInstructions') {
                return getTestInstructions(featureNames, agent).then(fromServer);
            }
            if (action === 'setAllTestRecord') {
                return setAllTestRecord(value, agent);
            }
            if (action === 'getFixInstructions') {
                return getFixInstructions(featureNames, agent).then(fromServer);
            }
            if (action === 'setAllFixRecord') {
                return setAllFixRecord(value, agent);
            }
            throw new Error('unknown mediator action ' + action);
        }
    };

    function fromServer(source) {
        var data;
        try {
            // console.log('evaluating', source);
            data = eval(source); // eslint-disable-line no-eval
        } catch (e) {
            // some feature source lead to error
            throw e;
        }
        return data;
    }
};
var ownMediator = api.createOwnMediator(
    [
        // 'promise/unhandled-rejection',
        // 'promise/rejection-handled'
        // 'const/scoped'
        'object/assign'
    ],
    String(jsenv.agent)
);
api.client = jsenv.createImplementationClient(ownMediator);
api.client.fix().then(function() {
    console.log(Object.assign);
}).catch(function(e) {
    setTimeout(function() {
        throw e;
    });
});

function getClosestAgentForFeature(agent, featureName) {
    var featureFolderPath = folderFromFeatureName(featureName);
    var featureCachePath = featureFolderPath + '/.cache';

    function adaptAgentName(agent, path) {
        return visibleFallback(
            path + '/' + agent.name,
            function() {
                agent.name = 'other';
                return path + '/' + agent.name;
            }
        );
    }
    function visibleFallback(path, fallback) {
        return fsAsync.visible(path).catch(function() {
            return Promise.resolve(fallback()).then(function(fallbackPath) {
                if (fallbackPath) {
                    return fsAsync.visible(fallbackPath);
                }
            });
        });
    }
    function adaptVersion(version, path) {
        var cachePath = path + '/' + version + '/test-output.json';
        return visibleFallback(
            cachePath,
            function() {
                return fsAsync('readdir', path).then(function(names) {
                    var availableVersions = names.map(function(name) {
                        return jsenv.createVersion(name);
                    }).filter(function(version) {
                        // exclude folder name like ?, * or alphabetic
                        return version.isSpecified();
                    }).sort(function(a, b) {
                        if (a.above(b)) {
                            return 1;
                        }
                        if (a.below(b)) {
                            return -1;
                        }
                        return 0;
                    });

                    var i = 0;
                    var j = availableVersions.length;
                    var previousVersions = [];
                    while (i < j) {
                        var availableVersion = availableVersions[i];
                        if (version.above(availableVersion)) {
                            previousVersions.unshift(availableVersion);
                        } else {
                            break;
                        }
                        i++;
                    }
                    return Promise.all(previousVersions.map(function(previousVersion) {
                        return fsAsync.visible(path + '/' + previousVersion + '/test-output.json').then(
                            function() {
                                // console.log('valid previous version ' + previousVersion);
                                return true;
                            },
                            function() {
                                // console.log('invalid previous version ' + previousVersion);
                                return false;
                            }
                        );
                    })).then(function(validities) {
                        return Iterable.find(previousVersions, function(previousVersion, index) {
                            return validities[index];
                        });
                    }).then(function(closestPreviousValidVersion) {
                        if (closestPreviousValidVersion) {
                            version.update(closestPreviousValidVersion);
                        } else {
                            version.update('?');
                            return path + '/' + version;
                        }
                    });
                });
            }
        );
    }
    function missingAgent() {
        var missing = {
            code: 'NO_AGENT',
            featureName: featureName,
            agentName: agent.name
        };
        return missing;
    }
    function missingVersion() {
        var missing = {
            code: 'NO_AGENT_VERSION',
            featureName: featureName,
            agentName: agent.name,
            agentVersion: agent.version.toString()
        };
        return missing;
    }

    var closestAgent = jsenv.createAgent(agent.name, agent.version);
    return adaptAgentName(
        closestAgent,
        featureCachePath
    ).catch(function(e) {
        if (e && e.code === 'ENOENT') {
            return Promise.reject(missingAgent());
        }
        return Promise.reject(e);
    }).then(function() {
        return adaptVersion(
            closestAgent.version,
            featureCachePath + '/' + closestAgent.name
        ).catch(function(e) {
            if (e && e.code === 'ENOENT') {
                return Promise.reject(missingVersion());
            }
            return Promise.reject(e);
        });
    }).then(function() {
        return closestAgent;
    });
}
// getClosestAgentForFeature(
//     {
//         name: 'const'
//     },
//     jsenv.createAgent('node/4.7.4')
// ).then(function(agent) {
//     console.log('agent', agent.toString());
// }).catch(function(e) {
//     console.log('rejected with', e);
// });

function polyfill(featureNames) {
    return Promise.resolve([]).then(function(instructions) {
        // console.log('instructions', instructions);
        var failingFeatureNames = Iterable.filterBy(featureNames, instructions, function(instruction) {
            return instruction.name === 'fail';
        });
        if (failingFeatureNames.length) {
            throw new Error('unfixable features ' + failingFeatureNames);
        }
        var featureNamesToFix = Iterable.filterBy(featureNames, instructions, function(instruction) {
            return instruction.name === 'fix';
        });
        console.log('features to polyfill', featureNamesToFix);
        return build(featureNamesToFix, {
            transpiler: transpiler,
            mode: 'polyfill',
            footer: 'jsenv.polyfill(__exports__);'
        }).then(function(bundle) {
            return bundle.source;
        });
    });
}
// polyfill(
//     ['object/assign'],
//     jsenv.agent
// ).then(function(polyfill) {
//     console.log('polyfill', polyfill);
//     eval(polyfill);
//     console.log(Object.assign);
// }).catch(function(e) {
//     setTimeout(function() {
//         throw e;
//     });
// });

function transpile(/* path, featureNames, agent */) {

}

function createBrowserMediator(featureNames) {
    return {
        send: function(action, value) {
            if (action === 'getTestInstructions') {
                return get(
                    'test?features=' + featureNames.join(encodeURIComponent(','))
                ).then(readBody);
            }
            if (action === 'setAllTestRecord') {
                return postAsJSON(
                    'test',
                    value
                );
            }
            if (action === 'getFixInstructions') {
                return get(
                    'fix?features=' + featureNames.join(encodeURIComponent(','))
                ).then(readBody);
            }
            if (action === 'setAllFixRecord') {
                return postAsJSON(
                    'fix',
                    value
                );
            }
        }
    };

    function get(url) {
        return sendRequest(
            'GET',
            url,
            {},
            null
        ).then(checkStatus);
    }
    function postAsJSON(url, object) {
        return sendRequest(
            'POST',
            url,
            {
                'content-type': 'application/json'
            },
            JSON.stringify(object)
        ).then(checkStatus);
    }
    function checkStatus(response) {
        if (response.status < 200 || response.status > 299) {
            throw new Error(response.status);
        }
        return response;
    }
    function sendRequest(method, url, headers, body) {
        var xhr = new XMLHttpRequest();

        return new jsenv.Thenable(function(resolve, reject) {
            var responseBody = {
                data: '',
                write: function(chunk) {
                    this.data += chunk;
                },
                close: function() {}
            };

            xhr.onerror = function(e) {
                reject(e);
            };
            var offset = 0;
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 2) {
                    resolve({
                        status: xhr.status,
                        headers: xhr.getAllResponseHeaders(),
                        body: responseBody
                    });
                } else if (xhr.readyState === 3) {
                    var data = xhr.responseText;
                    if (offset) {
                        data = data.slice(offset);
                    }
                    offset += data.length;
                    responseBody.write(data);
                } else if (xhr.readyState === 4) {
                    responseBody.close();
                }
            };

            xhr.open(method, url);
            for (var headerName in headers) {
                if (headers.hasOwnPorperty(headerName)) {
                    xhr.setRequestHeader(headerName, headers[headerName]);
                }
            }
            xhr.send(body || null);
        });
    }
    function readBody(response) {
        var body = response.body;
        var object = JSON.parse(body);
        object.entries = getClientEntries(object.entries);
        jsenv.assign(object, body.meta);
        delete object.meta;
        return object;
    }
    function getClientEntries(entries) {
        // try {
        //     jsenv.reviveFeatureEntries(entries);
        // } catch (e) {
        //     return fail('some-feature-source', e);
        // }
        return entries;
    }
}
api.createBrowserMediator = createBrowserMediator;

api.getFolder = getFolder;
api.getFeaturePath = folderFromFeatureName;
api.listFeatureNames = listFeatureNames;
api.build = build;
api.transpiler = transpiler;
api.getTestInstructions = getTestInstructions;
api.getClosestAgent = getClosestAgentForFeature;
api.getFixInstructions = getFixInstructions;
api.polyfill = polyfill;
api.transpile = transpile;

module.exports = api;

// function excludedAlreadyResolvedDependency(id) {
    // en gros ici, si la dépendance a un test déjà satisfait
    // alors résoud à {type: 'excluded'}
    // (ce qu'on fait dans polyfill, en plus il faudrait vérifier si on a pas djà
    // kk chose dans statuses

    // console.log('load', id);
    // on pourrais aussi déplacer ça dans resolveId
    // et rediriger #weak vers un fichier spécial qui contient grosso modo
    // export default {weak: true};
    // var fixMark = '/fix.js';
    // var fixLength = fixMark.length;
    // var isFix = id.slice(-fixLength) === fixMark;
    // console.log('isfix', isFix);
    // if (isFix) {
    //     var featureName = path.dirname(path.relative(getFeaturesFolder(), id));
    //     var featureNameIndex = featureNames.indexOf(featureName);
    //     var instructionPromise;
    //     if (featureNameIndex === -1) {
    //         instructionPromise = getInstruction(featureName, agent);
    //     } else {
    //         instructionPromise = Promise.resolve(instructions[featureNameIndex]);
    //     }
    //     return instructionPromise.then(function(instruction) {
    //         if (instruction.name === 'fail') {
    //             throw new Error('unfixable dependency ' + featureName);
    //         }
    //         if (instruction.name === 'fix') {
    //             return undefined;
    //         }
    //         return 'export default {type: \'excluded\'};';
    //     });
    // }
    // console.log('ici', id);
// }
