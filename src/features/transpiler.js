var store = require('../store.js');
var memoize = require('../memoize.js');
var fsAsync = require('../fs-async.js');

var rootFolder = require('path').resolve(__dirname, '../..').replace(/\\/g, '/');
var cacheFolder = rootFolder + '/cache';
var transpileFolder = cacheFolder + '/transpile';
var transpileCache = store.fileSystemCache(transpileFolder);

function assign(destination, source) {
    for (var key in source) { // eslint-disable-line guard-for-in
        destination[key] = source[key];
    }
    return destination;
}

function createTranspiler(transpilerOptions) {
    transpilerOptions = transpilerOptions || {};
    // console.log('required babel plugins', pluginsAsOptions.map(function(plugin) {
    //     return plugin[0];
    // }));

    function getNodeFilePath(path) {
        var nodeFilePath;
        if (path.indexOf('file:///') === 0) {
            nodeFilePath = path.slice('file:///'.length);
        } else {
            nodeFilePath = path;
        }
        return nodeFilePath;
    }
    function getFileEntry(options) {
        var path = options.filename;
        var nodeFilePath = getNodeFilePath(path);

        if (nodeFilePath.indexOf(rootFolder) === 0) {
            var relativeFilePath = nodeFilePath.slice(rootFolder.length);
            if (relativeFilePath[0] === '/') {
                relativeFilePath = relativeFilePath.slice(1);
            }

            return transpileCache.match({
                plugins: options.plugins
            }).then(function(cacheBranch) {
                var entryName;
                if (options.as === 'module') {
                    entryName = 'modules/' + relativeFilePath;
                } else {
                    entryName = relativeFilePath;
                }

                var entrySources;
                if (options.sources) {
                    entrySources = options.sources.slice();
                } else {
                    entrySources = [];
                }
                entrySources.push({path: nodeFilePath, strategy: 'mtime'});

                var entry = cacheBranch.entry({
                    name: entryName,
                    sources: entrySources
                });
                return entry;
            });
        }
        return Promise.resolve(null);
    }

    var transpile = function(code, transpileCodeOptions) {
        var options = {};
        assign(options, transpilerOptions);
        assign(options, transpileCodeOptions || {});

        var transpileSource = function(sourceURL) {
            var plugins;
            if (options.plugins) {
                plugins = options.plugins;
            } else if (options.as === 'module') {
                plugins = options.plugins.slice();
                plugins.unshift('transform-es2015-modules-systemjs');
            } else {
                plugins = options.plugins;
            }

            // https://babeljs.io/docs/core-packages/#options
            // inputSourceMap: null,
            // minified: false

            var babelOptions = {};
            babelOptions.plugins = plugins;
            babelOptions.ast = false;
            if ('sourceMaps' in options) {
                babelOptions.sourceMaps = options.sourceMaps;
            } else {
                babelOptions.sourceMaps = 'inline';
            }

            var babel = require('babel-core');
            var result = babel.transform(code, babelOptions);
            var transpiledCode = result.code;

            if (sourceURL) {
                transpiledCode += '\n//# sourceURL=' + sourceURL;
            }
            if (options.transform) {
                transpiledCode = options.transform(transpiledCode);
            }
            return transpiledCode;
        };

        var sourceURL;
        if ('filename' in options) {
            var filename = options.filename;
            if (filename !== false) {
                sourceURL = filename;
            }
        } else {
            sourceURL = 'anonymous';
        }

        if (
            options.cache &&
            sourceURL !== 'anonymous' &&
            sourceURL
        ) {
            return getFileEntry(options).then(function(entry) {
                if (entry) {
                    sourceURL = entry.path;
                    return memoize.async(
                        transpileSource,
                        entry
                    )(sourceURL);
                }
                if (sourceURL) {
                    sourceURL += '!transpiled';
                }
                return transpileSource(sourceURL);
            });
        }

        if ('sourceURL' in options) {
            sourceURL = options.sourceURL;
        } else if (sourceURL) {
            sourceURL += '!transpiled';
        }
        return transpileSource(sourceURL);
    };

    var transpiler = {
        // plugins: pluginsAsOptions,
        transpile: transpile,
        transpileFile: function(filePath, transpileFileOptions) {
            function createTranspiledCode(transpileCodeOptions) {
                return fsAsync.getFileContent(transpileCodeOptions.filename).then(function(code) {
                    return transpiler.transpile(code, transpileCodeOptions);
                });
            }

            // désactive le cache lorsque entry ne matche pas
            // puisqu'on a déjà testé s'il existait un cache valide
            var transpileCodeOptions = {};
            jsenv.assign(transpileCodeOptions, transpileFileOptions);
            transpileCodeOptions.filename = filePath;

            return getFileEntry(transpileCodeOptions).then(function(entry) {
                if (entry) {
                    transpileCodeOptions.cache = false;
                    transpileCodeOptions.sourceURL = entry.path;

                    return memoize.async(
                        createTranspiledCode,
                        entry
                    )(transpileCodeOptions);
                }
                return createTranspiledCode(transpileCodeOptions);
            });
        }
    };

    return transpiler;
}

module.exports = createTranspiler;
