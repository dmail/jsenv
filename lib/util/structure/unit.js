/*

https://github.com/stampit-org/stampit/issues/151#issuecomment-120647069
https://gist.github.com/FredyC/3a1bac834c971f604b8bfac4a6f813c4

stampit API : https://github.com/stampit-org/stampit/blob/master/docs/API.md
stampit spec : https://github.com/stampit-org/stamp-specification
stampit compose.js : https://github.com/stampit-org/stampit/blob/master/src/compose.js

For now Im gonna use stampit but I prepare this because

- stampit is missing a true conflict detection/resolution mecanism (It claims to do it using infected compose)
- stampit auto merge deepProperties together on [compose](https://github.com/stampit-org/stampit/blob/eb9658189ca175f0dc1ac9463909fe291280af1c/src/compose.js#L72)
& merge them too on [creation](https://github.com/stampit-org/stampit/blob/eb9658189ca175f0dc1ac9463909fe291280af1c/src/compose.js#L17)
this is exactly because stampit is missing conflict resolution, a conflict resolution may be to merge
- stampit has methods() & props() whild I could just use one of them and internally create the two groups : function & properties
- for now I don't need static, conf, propertyDescriptors

Keep in mind I cannot just create a composedFunction when composing unit init() method
and ideally the same applies for any other method. I "must" keep both methods under a composedFunction object to be able to call them as I want
and get their result
(that's mainly because the return value of init() is important and may impact how next init() are being called)

suggested API here:

import Unit from 'jenv/unit';

// you can compose unit/pojo together (returns a composedUnit which has internal mecanism to ensure composition)
Unit.compose(pojo, unit);
// you can resolve the unit/pojo conflict (returns a resolvedUnit which has internal mecanism to ensure conflict resolution)
Unit.resolve(pojoOrUnit, {propertyName: resolverConfig});
// you can create an "instance" or this unit (returns a classic JavaScript object with all expected properties initalizer being called ...)
Unit.create(pojoOrUnit, ...args);
// you can install the unit on an existing object instead of creating an object
Unit.install(pojoOrUnit, object)

// unit instance got method as well (compose/resolve return a new unit object)
unit.compose(pojoOrUnit);
unit.resolve(resolverMap);
unit.create(...args);

// that's not planned but that would be great if conceptually we could do
Object.prototype.compose = Unit.compose;
Object.prototype.resolve = Unit.resolve;
// Object.prototype.create = Unit.create; -> not mandatory I suppose
// in order to use pojo as composable unit
*/

/* eslint-disable no-use-before-define */

import util from './util.js';

export const test = {
    modules: ['@node/assert'],

    main(assert) {
        // this.skip();
        var callId = 0;
        function spy(fn) {
            let lastCall = {
                called: false
            };
            function spyFn() {
                lastCall.this = this;
                lastCall.args = arguments;
                lastCall.id = callId;
                lastCall.called = true;
                callId++;

                if (fn) {
                    lastCall.return = fn.apply(this, arguments);
                    return lastCall.return;
                }
            }
            spyFn.lastCall = lastCall;
            return spyFn;
        }

        this.add('get unit as an object using expose', function() {
            const unit = compose({
                method() {}
            });
            const exposed = unit.expose();
            assert(exposed.method === unit.get('method'));
        });

        this.add('augment existing object using install/uninstall', function() {
            const unit = compose({
                method() {}
            });
            const installTarget = {};
            const installer = unit.install(installTarget);
            assert(installTarget.method === unit.get('method'));
            // ensure you can install from existing object
            installer.uninstall();
            assert(Object.keys(installTarget).length === 0);
        });

        this.add('custom composition implementation using infect()/cure()/purify()', function() {
            // https://medium.com/@koresar/fun-with-stamps-episode-8-tracking-and-overriding-composition-573aa85ba622#.fyv8m2wlj
            // infect() must do infectedCompose.returnValue.compose = infectedCompose (see below)
            // const infectedCompose = function(unitToCompose) {
            //     const composed = compose(this, unitToCompose);
            //     // infect the returned composed unit to also use the infected compose
            //     composed.compose = infectedCompose;
            //     return composed;
            // };
            const unit = compose({foo: true}).infect(spy(function() {
                // attention de ne pas écrire this.compose ici -> call stack sinon puisque this.compose === arguments.callee.caller
                // faut écrire this.compose.cured(this, {bar: true});
                return this.compose.uninfected.call(this, {bar: true});
            }));
            const infectedComposeCall = unit.compose.infected.lastCall;
            const composedUnit = unit.compose('dam');

            assert(infectedComposeCall.called);
            assert(infectedComposeCall.this === unit);
            assert(infectedComposeCall.args[0] === 'dam');
            assert(infectedComposeCall.return === composedUnit);
            assert(composedUnit.get('bar') === true);

            const purifiedUnit = composedUnit.cure().compose({
                name: 'dam'
            });
            assert(purifiedUnit.get('name') === 'dam');

            // it means you can do the following
            // dbQueue = compose().infect(function(db, queue) {
            //     return compose(this, {
            //         db: db,
            //         queue: queue
            //     });
            // });
            // myDBQueue = dbQueue.compose(
            //     {
            //         port: 3000
            //     },
            //     {
            //         port: 5000
            //     }
            // ).expose();
            // https://github.com/stampit-org/stamp-specification#stamp-arguments
        });

        this.add('unit constructor are called in serie', function() {
            // https://www.barbarianmeetscoding.com/blog/2016/01/18/javascript-ultra-flexible-object-oriented-programming-with-stamps/
            const firstUnit = compose({
                constructor: spy(function() {
                    return {};
                })
            });
            const secondUnit = compose({
                constructor: spy()
            });
            const unit = compose(firstUnit, secondUnit);

            const firstConstructorCall = firstUnit.get('constructor').lastCall;
            const secondConstructorCall = secondUnit.get('constructor').lastCall;
            const instance = unit.produce('foo', 'bar');

            assert(firstConstructorCall.called);
            // assert(firstConstructorCall.this === ); we cant' really know this because it's created internally by unit and ignored
            assert(firstConstructorCall.args[0] === 'foo');
            assert(secondConstructorCall.called);
            assert(secondConstructorCall.this === firstConstructorCall.return);
            assert(secondConstructorCall.args[0] === 'foo');
            assert(instance === secondConstructorCall.this);
        });

        this.add('Example with i18n api', function() {
            // Dictionnary -> Entries -> Entry -> Definition -> Trait,Context,Expression
        });

        this.add('Example with fetch api', function() {
            // request has uri, method, headers, body, how could unit implement this ?
            const Request = compose({
                constructor() {
                    // here we read method, url and we construct the right object
                }
            });
            const PostRequest = Request.compose({
                method: 'POST'
            });
            const githubRequest = Request.compoe({
                url: 'http://github.com'
            });
            const googlePostRequest = PostRequest.compose({
                url: 'http://google.com'
            });
            const githubPostRequest = PostRequest.compose(githubRequest);

            console.log(googlePostRequest, githubPostRequest);
        });

        /*
        // should we call constructor once we know the object being created and the properties belonging to him
        // I also need something to be able to clone an object with the current state of it
        // It gives me the feeling even instance should be stamp
        // in other words we wouldn't use raw object anymore, even instance would use the implement keyword to add more property
        // we would have conflict and remember that stamp are immutable so every time an object would be mutated
        // all the structure must be updated as well to use the new immutable value

        et en utilisanet immutable.js ?
        finalement c'est "exactement" ce que fais immutable.js
        stampit() -> Map()
        compose() -> map.merge(), voir map.mergeWith() si on souhaite gérer le conflit autrement qu'en écrasant
        method() -> map.set()

        du coup on instancie pas un immutable, on continue de le modifier, à "aucun" moment on ne passe par un objet classique
        par contre toutes les méthodes dans immutable ne doivent pas être overrides mais on veut pouvoir en ajouter de nouvelles
        faut essayer de faire lab-immutable.js pour voir ce que ça donnerait
        */
    }
};

const MethodInfection = {
    methodName: '',

    infect(object, infectedMethod) {
        const methodName = this.methodName;
        let infectedMethodCallState = '';
        function propagatedInfectedMethod(...args) {
            if (infectedMethodCallState === 'before') {
                throw new Error('infected method must not be called recursively');
            }
            infectedMethodCallState = 'before';
            const returnedObject = infectedMethod.apply(this, args);
            infectedMethodCallState = 'after';

            if (Object.getPrototypeOf(returnedObject) !== Object.getPrototypeOf(object)) {
                throw new TypeError('infected method must return object sharing prototype');
            }
            // propagate the infected compose method
            returnedObject[methodName] = propagatedInfectedMethod;

            return returnedObject;
        }

        if (methodName in object) {
            const uninfected = object[methodName];
            if (infectedMethod === uninfected) {
                throw new Error('infected method must be different than the current method');
            }

            if ('pure' in uninfected) {
                propagatedInfectedMethod.pure = uninfected.pure;
            } else {
                propagatedInfectedMethod.pure = uninfected;
            }
            propagatedInfectedMethod.uninfected = uninfected;
        }
        propagatedInfectedMethod.infected = infectedMethod;

        const infectedObject = object.clone();
        infectedObject[methodName] = propagatedInfectedMethod;

        return infectedObject;
    },

    cure(object) {
        const methodName = this.methodName;
        let curedObject;

        if (methodName in object) {
            const methodSupposedAsInfected = object[methodName];

            if ('infected' in methodSupposedAsInfected) {
                const uninfected = methodSupposedAsInfected.uninfected;
                if (uninfected) {
                    curedObject = object.clone();
                    curedObject[methodName] = uninfected;
                    // MethodInfection.infect(object, methodName, uninfected);
                } else {
                    // restore the object previous state : he had not method at all
                    curedObject = object.clone();
                    delete curedObject[methodName];
                }
            } else {
                // the method is not infected ?
                curedObject = object;
            }
        } else {
            // should we do throw because methodName is not in object and it's unexpected ?
            curedObject = object;
        }

        return curedObject;
    },

    purify(object) {
        const methodName = this.methodName;
        let pureObject;

        if (methodName in object) {
            const methodSupposedAsInfected = object[methodName];

            if ('infected' in methodSupposedAsInfected) {
                pureObject = object.clone();
                const pure = methodSupposedAsInfected.pure;
                if (pure) {
                    pureObject[methodName] = pure;
                } else {
                    delete pureObject[methodName];
                }
            } else {
                pureObject = object;
            }
        } else {
            pureObject = object;
        }

        return pureObject;
    }
};
const ComposeMethodInfection = Object.create(MethodInfection);
ComposeMethodInfection.methodName = 'compose';

const Unit = util.extend({
    constructor() {
        this.properties = Properties.create();
    },

    get(propertyName) {
        return this.properties.get(propertyName).descriptor.value;
    },

    clone() {
        const clone = this.createConstructor();
        clone.properties = this.properties.clone();
        return clone;
    },

    infect(infectedCompose) {
        return ComposeMethodInfection.infect(this, infectedCompose);
    },

    cure() {
        return ComposeMethodInfection.cure(this);
    },

    purify() {
        return ComposeMethodInfection.purify(this);
    },

    expose() {
        const target = {};
        this.properties.define(target);
        return target;
    },

    install(target) {
        const installer = {
            installProperties: this.properties,

            install() {
                this.uninstallProperties = this.installProperties.diff(target);
                this.installProperties.define(target);
            },

            uninstall() {
                this.uninstallProperties.define(target);
            }
        };
        installer.install();
        return installer;
    }
});

export default Unit;

const Properties = util.extend({
    constructor() {
        this.map = {};
    },

    populate(object, deep) {
        Object.keys(object).forEach(function(name) {
            this.add(Property.create(name).populate(object));
        }, this);

        if (deep) {
            let objectAncestor = Object.getPrototypeOf(object);
            while (objectAncestor) {
                Object.keys(objectAncestor).forEach(function(name) { // eslint-disable-line
                    if (this.has(name) === false) {
                        let property = Property.create(name).populate(objectAncestor);
                        this.add(property);
                    }
                }, this);
                objectAncestor = Object.getPrototypeOf(objectAncestor);
            }
        }

        return this;
    },

    count() {
        return Object.keys(this.map).length;
    },

    add(property) {
        this.map[property.name] = property;
    },

    [Symbol.iterator]() {
        return Object.keys(this.map).map(function(name) {
            return this.map[name];
        }, this)[Symbol.iterator]();
    },

    has(name) {
        return this.map.hasOwnProperty(name);
    },

    get(name) {
        return this.map.hasOwnProperty(name) ? this.map[name] : null;
    },

    define(subject) {
        for (let property of this) {
            property.define(subject);
        }
    }
});

const Property = util.extend({
    constructor(name) {
        this.name = name;
    },

    clone() {
        const clone = this.createConstructor(this.name);
        clone.owner = this.owner;
        clone.descriptor = this.descriptor;
        clone.resolver = this.resolver;
        return clone;
    },

    get source() {
        return this.descriptor.value.toString();
    },

    populate(owner) {
        if (Object.prototype.isPrototypeOf(owner) === false) { // object & function allowed
            throw new TypeError('property.from() first argument must inherit from Object.prototype');
        }

        const property = this.clone();
        property.owner = owner;
        property.descriptor = Object.getOwnPropertyDescriptor(owner, this.name);

        return property;
    },

    describe(descriptor) {
        if (typeof descriptor !== 'object' && descriptor !== null) {
            throw new TypeError('property.describe() first arguments must be an object or null');
        }

        const property = this.clone();
        property.descriptor = descriptor;
        return property;
    },

    delete() {
        return this.describe(null);
    },

    rename(name) {
        const renamedProperty = this.clone();
        renamedProperty.name = name;
        return renamedProperty;
    },

    set(value) {
        return this.describe(Object.assign({}, this.descriptor || {}, {value: value}));
    },

    install() {
        const descriptor = this.descriptor;

        if (descriptor) {
            // console.log('define property', this.name, 'on', this.owner);
            Object.defineProperty(this.owner, this.name, descriptor);
        } else {
            delete this.owner[this.name];
        }

        return this;
    },

    assign(owner) {
        let assignedProperty = this.clone();
        assignedProperty.owner = owner;
        return assignedProperty;
    },

    define(owner) {
        return this.assign(owner).install();
    }
});

function composePure(...args) {
    let composable = this.createConstructor();

    mergeTwoComposable(composable, this);
    for (let arg of args) {
        let secondComposable;

        if (Object.getPrototypeOf(this) === Object.getPrototypeOf(arg)) {
            secondComposable = arg;
        } else {
            secondComposable = this.createConstructor();
            secondComposable.properties.populate(arg);
        }

        mergeTwoComposable(composable, secondComposable);
    }

    return composable;
}

function mergeTwoComposable(firstComposable, secondComposable) {
    firstComposable.properties.merge(secondComposable.properties);
    return firstComposable;
}

// special case for constructor which must result in a compositeProperty aware of all the values
Property.refine({
    resolveConflict(conflictualProperty) {
        const selfResolver = this.resolver;
        const otherResolver = conflictualProperty.resolver;
        const selfResolverName = selfResolver.name;
        const otherResolverName = otherResolver.name;
        let propertyResponsibleToResolve;

        if (selfResolverName === 'inherit') {
            propertyResponsibleToResolve = conflictualProperty;
        } else if (otherResolverName === 'inherit') {
            propertyResponsibleToResolve = this;
        } else if (conflictualProperty.hasOwnProperty('resolver')) {
            propertyResponsibleToResolve = conflictualProperty;
        } else if (this.hasOwnProperty('resolver')) {
            propertyResponsibleToResolve = this;
        } else {
            propertyResponsibleToResolve = conflictualProperty;
        }

        let propertyToResolve;
        if (propertyResponsibleToResolve === this) {
            propertyToResolve = conflictualProperty;
        } else {
            propertyToResolve = this;
        }

        const resolvedProperty = propertyResponsibleToResolve.resolver.resolveLater(
            propertyResponsibleToResolve,
            propertyToResolve
        );

        return resolvedProperty;
    }
});

Properties.refine({
    diff(arg) {
        const properties = Object.getPrototypeOf(this).from(arg);
        const diffProperties = this.createConstructor();

        for (let property of this) {
            let otherProperty = properties.get(property.name);
            if (otherProperty) {
                diffProperties.add(otherProperty);
            } else {
                diffProperties.add(property.delete());
            }
        }

        return diffProperties;
    },

    from(arg) {
        let properties;
        if (this.isPrototypeOf(arg)) {
            properties = arg;
        } else {
            properties = this.create();
            properties.populate(arg);
        }
        return properties;
    },

    concat(properties) {
        const concatenedProperties = this.clone();
        concatenedProperties.merge(properties);
        return concatenedProperties;
    },

    clone() {
        const clone = this.createConstructor();
        // don't have to clone property
        // because every action on property does not mutate the property it creates a new one
        // that's one of the strength of being immutable
        Object.assign(clone.map, this.map);
        return clone;
    },

    merge(properties) {
        for (let property of properties) {
            const propertyName = property.name;
            const currentProperty = this.get(propertyName);

            if (currentProperty) {
                const resolvedProperty = property.resolveConflict(currentProperty);
                if (resolvedProperty !== currentProperty) {
                    this.add(resolvedProperty);
                }
            } else {
                this.add(property);
            }
        }
        return this;
    }
});

// baseUnit is infected by composePure so that composePure is propaged amongst composed unit
const baseUnit = Unit.create().infect(composePure);
// prepare a bound version of baseUnit.compose for convenience
// it allows to write compose() instead of baseUnit.compose() all the time
const compose = baseUnit.compose.bind(baseUnit);

export {composePure};
export {compose};

// const CompositeMethod = util.extend({
//     install() {
//     },
//     resolve() {
//     }
// });

// can we just add an infected compose() which is aware of conflict and tries to handle them ?
// anyway we need to handle conflict between constructor() method which must by default register every method
// and later set a specific constructor method that will execute sequentially every constructor and return first non null returned value
// or the object on which unit is produced (can be a custom object if you do unit.produceOn() instead of produce())

const Resolver = (function() {
    const Resolver = {
        resolvers: [],

        from(value) {
            let resolver;
            for (let Resolver of this.resolvers) {
                resolver = Resolver.from(value);
                if (resolver) {
                    break;
                }
            }
            return resolver;
        },

        register(name, methods) {
            const resolver = PropertyResolver.extend({
                name: name
            }, methods);
            this.resolvers.push(resolver);
            return resolver;
        }
    };

    const PropertyResolver = util.extend({
        from(value) {
            const name = this.name;
            if (typeof value === 'string') {
                if (value === name) {
                    return this.create();
                }
            } else if (typeof value === 'object') {
                if (name in value) {
                    return this.create(value[name]);
                }
            }
        },
        name: '',

        resolveNow(property) {
            let resolvedProperty = property.clone();
            resolvedProperty.resolver = this;
            return resolvedProperty;
        },

        resolveLater(property, conflictualProperty) {
            throw property.createConflictError(
                conflictualProperty,
                'conflict must be handled for property named "' + property.name + '"',
                'resolve(\'remove\')'
            );
        }
    });

    Property.refine({
        createConflictError(conflictualProperty, message, howToFix) {
            const error = new Error(message);
            error.name = 'PropertyError';
            error.meta = {
                property: this,
                conflictualProperty: conflictualProperty,
                howToFix: howToFix
            };
            return error;
        }
    });

    Properties.refine({
        resolve(mergeConflictResolverDescription) {
            const resolvedProperties = this.createConstructor();

            Object.assign(resolvedProperties.map, this.map);
            resolvedProperties.populate = this.populate; // share populate() method, that's very important

            for (let property of this) {
                let resolvedProperty = this.resolveProperty(property, mergeConflictResolverDescription);
                resolvedProperties.replace(property, resolvedProperty);
            }

            return resolvedProperties;
        },

        replace(property, otherProperty) {
            const map = this.map;
            const propertyName = property.name;
            const otherPropertyName = otherProperty.name;
            if (propertyName === otherPropertyName) {
                if (otherProperty.descriptor === null) {
                    delete map[propertyName];
                } else {
                    map[propertyName] = otherProperty;
                }
            } else {
                delete map[propertyName];
                if (otherProperty.descriptor) {
                    map[otherPropertyName] = otherProperty;
                }
            }
        },

        // if (resolutionStrategy.immediate) {

        //         selfStrategyName === 'rename' &&
        //         otherStrategyName === 'rename' &&
        //         selfStrategy.renameWith === otherStrategy.renameWith
        //     ) {
        //         throw new Error('conflict between rename resolution strategy for property named "' + this.name + '"');
        //     } else
        //         }

        resolveProperty(property, mergeConflictResolverDescription) {
            let resolvedProperty;
            const propertyName = property.name;
            if (mergeConflictResolverDescription.hasOwnProperty(propertyName)) {
                // console.log('resolve property with', conflictResolution[propertyName], 'from object', conflictResolution);
                const resolver = Resolver.from(mergeConflictResolverDescription[propertyName]);
                if (!resolver) {
                    throw new Error(
                        'no resolver registered matched ' +
                        mergeConflictResolverDescription[propertyName] + ' for property named "' + propertyName + '"'
                    );
                }

                resolvedProperty = resolver.resolveNow(property, this, mergeConflictResolverDescription);
            } else {
                resolvedProperty = property;
            }
            return resolvedProperty;
        }
    });

    Unit.refine({
        resolve(mergeConflictResolverDescription) {
            if (typeof mergeConflictResolverDescription !== 'object') {
                throw new TypeError('Unit.resolve() first argument must be an object');
            }
            const resolvedUnit = compose(this);
            resolvedUnit.properties = this.properties.resolve(mergeConflictResolverDescription);
            return resolvedUnit;
        }
    });

    return Resolver;
})();

const ResolverPropertyMatcher = util.extend();

ResolverPropertyMatcher.register('any', {
    match() {
        return true;
    }
});

ResolverPropertyMatcher.register('function', {
    match(property) {
        const descriptor = property.descriptor;
        if ('value' in descriptor) {
            const value = descriptor.value;
            if (typeof value === 'function') {
                return true;
            }
            return 'property value must be a function';
        }
        return true;
    }
});

const InitialResolver = Resolver.register('initial', {
    propertyMatcher: 'any',
    resolveNow(property) {
        let resolvedProperty = property.clone();
        delete resolvedProperty.resolver;
        return resolvedProperty;
    }
});
Property.refine({
    resolver: InitialResolver
});

function composeFunction(composedFn, fn, when) {
    if (when === 'before') {
        return function() {
            let args = arguments;
            fn.apply(this, args);
            return composedFn.apply(this, args);
        };
    }
    if (when === 'after') {
        return function() {
            let args = arguments;
            composedFn.apply(this, args);
            return fn.apply(this, args);
        };
    }
    if (typeof when === 'function') {
        return function() {
            return when.call(this, composedFn, fn, arguments, this);
        };
    }
}

Resolver.register('around', {
    propertyMatcher: 'function',
    constructor(around) {
        this.around = around;
    },
    resolveLater(property, conflictualProperty) {
        const around = this.around;
        return property.set(composeFunction(
            conflictualProperty.descriptor.value,
            property.descriptor.value,
            around
        ));
    }
});

Resolver.register('after', {
    propertyMatcher: 'function',
    resolveLater(property, conflictualProperty) {
        return property.set(composeFunction(
            conflictualProperty.descriptor.value,
            property.descriptor.value,
            'after'
        ));
    }
});

Resolver.register('before', {
    propertyMatcher: 'function',
    resolveLater(property, conflictualProperty) {
        return property.set(composeFunction(
            conflictualProperty.descriptor.value,
            property.descriptor.value,
            'before'
        ));
    }
});

Resolver.register('remove', {
    propertyMatcher: 'any',
    resolveNow(property) {
        return property.delete();
    }
});

Resolver.register('ignore', {
    propertyMatcher: 'any',
    resolveLater(property, conflictualProperty) {
        return conflictualProperty;
    }
});

Resolver.register('replace', {
    propertyMatcher: 'any',
    resolveLater(property, conflictualProperty) {
        if (conflictualProperty.resolver.name === 'replace') {
            throw new Error('cannot replace both, only one must remain');
        }
        // console.log(
        //     'resolving by replace to',
        //     property.descriptor.value.toString(),
        //     'conflictual is',
        //     conflictualProperty.descriptor.value.toString()
        // );
        return property;
    }
});

Resolver.register('rename', {
    propertyMatcher: 'any',
    constructor(renameWith) {
        this.renameWith = renameWith;
    },
    resolveNow(property, properties, conflictResolverMap) {
        let resolvedProperty;
        const renameWith = this.renameWith;

        // property.name = renameWith;
        // check if rename creates an internal conflict
        const conflictualProperty = properties.get(renameWith);

        if (conflictualProperty) {
            var message = 'conflict must not be handled by renaming "' + property.name + '" -> "' + renameWith;
            message += '" because it already exists';
            let error = property.createConflictError(
                conflictualProperty,
                message,
                'resolve({rename: \'' + renameWith + '-free\'})'
            );
            throw error;
        } else {
            const renamedProperty = property.rename(renameWith);
            resolvedProperty = properties.resolveProperty(renamedProperty, conflictResolverMap);
        }

        return resolvedProperty;
    }
});

// to be done, how do we merge value, especially when they are deep ?
// do we have to clone the value when we do mergedDescriptor.value = conflictualDescriptor.value ? is stampit cloning ?
// https://github.com/stampit-org/stampit/blob/master/src/merge.js
// is merge deep by default, do we want a non deep merge (what does a non deep merge means? why would we wnat it)
// until we know merge will be deep by default as stampit provides
// in a previous implement I did merge was cloning sub objects : https://github.com/dmail-old/object-merge/blob/master/index.js
// But I know that cloning object involves way more than this it's the purpose of lab.js, can we accept that merge does not clone but assign subobjects ?
// we don't support circular references that's a prob too no?
// I think we should both support circular reference and object cloning else merge would be problematic because instance could
// mutate model later
// for now let's stick to stampit impl because it's too much work and merge is not the primary goal
// but it will become more important and we'll have to support better merge implementation
// I'm not sure however that we'll be able to correctly clone without lab.js
// else we could still reuse the existing object-clone & object-merge I did on dmail-old repository

/*
something to keep in mind

a = {
    user: {
        name: 'dam'
    }
}
b = {
    user: {
        name: 'seb',
        age: 10
    }
}

saying I want to merge a & b does not necessarily mean every subproperty strategy is set to "ignore" (b property replaces a property)
this is just the default behaviour but we may want to specify deeply how user.name: 'seb' merge conflict is handled such as the final object would be

{
    user: {
        name: 'dam',
        age: 10
    }
}

to do this the resolve method must allow to set nested property strategy such as :
b.resolve({
    'user': 'merge',
    'user.name': 'ignore'
});

and property.value must be parsed to discover nested property
and we must also detect circular structure to prevent infinite loop (in other wors reimplement lab.js without unit.js to help :/)
*/
function mergeValue(firstValue, secondValue, deep) {
    return deep;
}

Resolver.register('merge', {
    propertyMatcher: 'any',
    constructor(deep) {
        this.deep = deep;
    },
    deep: true,
    resolveLater(property, conflictualProperty) {
        const deep = this.deep;
        const descriptor = property.descriptor;
        const conflictualDescriptor = conflictualProperty.descriptor;
        const mergedDescriptor = {};
        const mergedProperty = property.createConstructor(property.name);

        let situation = descriptor.hasOwnProperty('value') ? 'value' : 'accessor';
        situation += '-';
        situation += conflictualDescriptor.descriptor.hasOwnProperty('value') ? 'value' : 'accessor';

        if (situation === 'value-value') {
            mergedDescriptor.writable = conflictualDescriptor.writable;
            mergedDescriptor.enumerable = conflictualDescriptor.enumerable;
            mergedDescriptor.configurable = conflictualDescriptor.configurable;
            // both value are merged
            mergedDescriptor.value = mergeValue(descriptor.value, conflictualDescriptor.value, deep);
        } else if (situation === 'accessor-value') {
            mergedDescriptor.writable = conflictualDescriptor.writable;
            mergedDescriptor.enumerable = conflictualDescriptor.enumerable;
            mergedDescriptor.configurable = conflictualDescriptor.configurable;
            // accessor is lost, value is kept
            mergedDescriptor.value = conflictualDescriptor.value;
        } else if (situation === 'value-accessor') {
            mergedDescriptor.enumerable = conflictualDescriptor.enumerable;
            mergedDescriptor.configurable = conflictualDescriptor.configurable;
            // value is lost, accessor are kept
            if (conflictualDescriptor.hasOwnProperty('get')) {
                mergedDescriptor.get = conflictualDescriptor.get;
            }
            if (conflictualDescriptor.hasOwnProperty('set')) {
                mergedDescriptor.set = conflictualDescriptor.set;
            }
        } else if (situation === 'accessor-accessor') {
            mergedDescriptor.enumerable = conflictualDescriptor.enumerable;
            mergedDescriptor.configurable = conflictualDescriptor.configurable;
            // both accessor are merged
            if (conflictualDescriptor.hasOwnProperty('get')) {
                if (descriptor.hasOwnProperty('get')) {
                    mergedDescriptor.get = mergeValue(descriptor.get, conflictualDescriptor.get, deep);
                } else {
                    mergedDescriptor.get = conflictualDescriptor.get;
                }
            }
            if (conflictualDescriptor.hasOwnProperty('set')) {
                if (descriptor.hasOwnProperty('set')) {
                    mergedDescriptor.set = mergeValue(descriptor.set, conflictualDescriptor.set, deep);
                } else {
                    mergedDescriptor.set = conflictualDescriptor.set;
                }
            }
        }

        mergedProperty.descriptor = mergedDescriptor;

        return mergedProperty;
    }
});