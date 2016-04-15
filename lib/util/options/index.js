import proto from 'proto';

let Options = {
    create(properties, ...args) {
        let options;
        let length = arguments.length;

        if (length > 0 && Options.is(properties)) {
            options = Object.create(properties);
            proto.define.apply(options, args);
        } else {
            options = Object.create(null);
            proto.define.apply(options, arguments);
        }

        // for the whole structure, every time, every options object is recreated but without more property
        for (let key in options) { // eslint-disable-line guard-for-in
            let value = properties[key];
            if (Options.is(value)) {
                options[key] = Options.create(value);
            }
        }

        return options;
    },

    is(item) {
        return item !== null && typeof item === 'object' && item instanceof Object === false;
    },

    ensure(options, name) {
        if ((name in options) === false) {
            throw new Error('no such option : ' + name);
        }
        return options[name];
    }
};

/*
isPrototypeProperty(name) {
    let owner = this.items;
    let ownedByPrototype = false;

    while (owner) {
        if (owner.hasOwnProperty(name)) {
            if (owner === Object.prototype) {
                ownedByPrototype = true;
            }
            break;
        }
        owner = Object.getPrototypeof(owner);
    }

    return ownedByPrototype;
}
*/

export default Options;

export const test = {
    modules: ['node/assert'],

    suite(assert) {
        this.add("has no prototype", function() {
            let options = Options.create();

            assert.equal(Object.getPrototypeOf(options), null);
        });

        this.add("create(properties)", function() {
            let options = Options.create({
                key: 'value'
            });

            assert.equal(options.key, 'value');
            assert.equal(Object.prototype.hasOwnProperty.call(options, 'key'), true);
        });

        this.add("create(...properties)", function() {
            let options = Options.create({key: 'value'}, {foo: 'bar'});

            assert.equal(options.foo, 'bar');
        });

        this.add("create(propertiesWithOptions)", function() {
            let sub = Options.create();
            let options = Options.create({
                sub: sub
            });

            assert.equal(Object.getPrototypeOf(options.sub), sub);
        });

        this.add("create(options)", function() {
            let init = Options.create();
            let options = Options.create(init);
            let customOptions = Options.create(options);

            assert.equal(Object.getPrototypeOf(options), init);
            assert.equal(Object.getPrototypeOf(customOptions), options);
        });

        this.add("create(propertiesWithSymbol)", function() {
            let options = Options.create({
                [Symbol.iterator]: true
            });

            assert.equal(options[Symbol.iterator], true);
        });
    }
};