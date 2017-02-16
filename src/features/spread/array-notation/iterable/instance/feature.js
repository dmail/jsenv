expose({
    dependencies: ['object/create'],
    code: parent.code,
    pass: function(fn) {
        var data = [1, 2, 3];
        var iterable = this.createIterableObject(data);
        var instance = Object.create(iterable);
        var result = fn(instance);
        return this.sameValues(result, data);
    },
    solution: parent.solution
});
