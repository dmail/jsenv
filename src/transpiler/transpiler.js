var store = require('../store.js');
var memoize = require('../memoize.js');
var fsAsync = require('../fs-async.js');

var rootFolder = require('path').resolve(__dirname, '../../').replace(/\\/g, '/');
var cacheFolder = rootFolder + '/cache';
var transpilerCacheFolder = cacheFolder + '/transpiler';
var transpilerCache = store.fileSystemCache(transpilerCacheFolder);

function assign(destination, source) {
    for (var key in source) { // eslint-disable-line guard-for-in
        if (key === 'sourceURL' && destination[key] === false) {
            continue;
        }
        destination[key] = source[key];
    }
    return destination;
}
function normalizePlugins(pluginsOption) {
    var normalizedPluginsOption = pluginsOption.map(function(pluginOption) {
        var plugin;
        if (typeof pluginOption === 'string' || typeof pluginOption === 'function') {
            plugin = [pluginOption, {}];
        } else {
            plugin = pluginOption;
        }
        var pluginFunction = plugin[0];
        var pluginOptions = plugin[1] || {};
        if (typeof pluginFunction === 'string') {
            return [pluginFunction, pluginOptions];
        }
        if (typeof pluginFunction === 'function') {
            return [pluginFunction.name, pluginOptions];
        }
        return [pluginFunction, pluginOptions];
    });
    // console.log('normalize', pluginsOption, '->', normalizedPluginsOption);
    return normalizedPluginsOption;
}
function createTranspiler(transpilerOptions) {
    transpilerOptions = transpilerOptions || {plugins: []};
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

            return transpilerCache.match({
                plugins: normalizePlugins(options.plugins)
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
                    mode: options.cacheMode || 'default',
                    sources: entrySources,
                    encode: function(result) {
                        return result.code;
                    }
                });
                return entry;
            });
        }
        return Promise.resolve(null);
    }
    function getOptions(transpilationOptions) {
        transpilationOptions = transpilationOptions || {};
        var options = {};
        assign(options, transpilerOptions);
        assign(options, transpilationOptions);

        var plugins;
        // transpilationOptions.plugins override transpilerOptions.plugins
        if (transpilationOptions.plugins) {
            plugins = transpilationOptions.plugins;
        } else {
            plugins = options.plugins ? options.plugins.slice() : [];
            if (options.as === 'module') {
                plugins.unshift('transform-es2015-modules-systemjs');
            }
        }
        options.plugins = plugins;
        return options;
    }
    function transpile(code, transpileCodeOptions) {
        var options = getOptions(transpileCodeOptions);
        function transpileSource(sourceURL) {
            // https://babeljs.io/docs/core-packages/#options
            // inputSourceMap: null,
            // minified: false

            // console.log('transpiling', code, 'for', sourceURL);
            var babelOptions = {};
            babelOptions.filename = options.filename;
            babelOptions.plugins = options.plugins;
            babelOptions.ast = true;
            babelOptions.sourceMaps = true;
            // babelOptions.sourceType = 'module';
            if (options.sourceRoot) {
                babelOptions.sourceRoot = options.sourceRoot;
            }

            var babel = require('babel-core');
            var result;
            try {
                result = babel.transform(code, babelOptions);
            } catch (e) {
                if (e.name === 'SyntaxError') {
                    console.error(e.message, 'in', sourceURL, 'at\n');
                    console.error(e.codeFrame);
                }
                throw e;
            }
            var transpiledCode = result.code;
            if (sourceURL && options.sourceURL !== false && options.as !== 'code') {
                transpiledCode += '\n//# sourceURL=' + sourceURL;
            }
            // if (options.transform) {
            //     transpiledCode = options.transform(transpiledCode);
            // }
            result.code = transpiledCode;
            return result;
        }

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
        if (sourceURL) {
            sourceURL += '!transpiled';
        }
        return transpileSource(sourceURL);
    }
    function transpileFile(filePath, transpileFileOptions) {
        function createTranspiledCode(transpileCodeOptions) {
            return fsAsync.getFileContent(transpileCodeOptions.filename).then(function(code) {
                return transpiler.transpile(code, transpileCodeOptions);
            });
        }

        // désactive le cache lorsque entry ne matche pas
        // puisqu'on a déjà testé s'il existait un cache valide
        var transpileCodeOptions = getOptions(transpileFileOptions);
        transpileCodeOptions.filename = filePath;

        return getFileEntry(transpileCodeOptions).then(function(entry) {
            if (entry) {
                transpileCodeOptions.cache = false;
                // we don't need sourceURL because the file exists on the filesystem
                // or maybe it could be set to entry.path when sourceURL was not already false
                transpileCodeOptions.sourceURL = false;

                return memoize.async(
                    createTranspiledCode,
                    entry
                )(transpileCodeOptions);
            }
            return createTranspiledCode(transpileCodeOptions);
        });
    }

    var transpiler = {
        options: transpilerOptions,
        transpile: transpile,
        transpileFile: transpileFile,
        clone: function() {
            return createTranspiler(transpilerOptions);
        }
    };

    return transpiler;
}

function transpileTemplateTaggedWith(transpile, TAG_NAME) {
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
                return transpile(result).code;
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
createTranspiler.transpileTemplateTaggedWith = transpileTemplateTaggedWith;

function generateExport() {
    // https://github.com/babel/babel/blob/master/packages/babel-plugin-transform-es2015-modules-systemjs/src/index.js
    function generateExportPlugin(babel) {
        // console.log('babel', Object.keys(babel));
        // var types = babel.types;

        function visitProgram(path, state) {
            var file = state.file;
            var fileOptions = file.opts;
            // var parserOptions = file.parserOpts;
            // var node = path.node;
            // console.log('visiting file', parserOptions);
            // console.log('opts', fileOptions);

            var filename = fileOptions.filename;
            var sourceRoot = fileOptions.sourceRoot;
            var shortFileName;

            if (sourceRoot) {
                shortFileName = require('path').relative(sourceRoot, filename).replace(/\\/g, '/');
            } else {
                shortFileName = filename;
            }

            var result = babel.transform(
                'var filename = "' + shortFileName + '";\nexport {filename};\n\n',
                {
                    code: false,
                    sourceMaps: false,
                    sourceType: 'module',
                    babelrc: false,
                    ast: true,
                    plugins: []
                }
            );
            var ast = result.ast;
            var body = ast.program.body;
            path.unshiftContainer('body', body);
        }

        return {
            visitor: {
                Program: visitProgram
            }
        };
    }

    return generateExportPlugin;
}
createTranspiler.generateExport = generateExport;

module.exports = createTranspiler;
