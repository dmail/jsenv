expose(
    'object/create',
    {
        code: parent.code,
        pass: function(generatorFn) {
            var data = [1, 2];
            var iterable = this.createIterableObject(data);
            var instance = Object.create(iterable);
            var generator = generatorFn(instance);

            return this.sameValues(generator, data);
        },
        solution: parent.solution
    }
);
