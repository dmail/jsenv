this.dependencies = ['symbol-iterator'];
this.code = 'inherit';
this.pass = jsenv.Predicate.fails(function(fn) {
    fn(Math.max, true);
    // because boolean are not iterable
    // but in case on day Boolean.prototype[Symbol.iterator] exists
    // the true "perfect" test would delete[Symbol.iterator] from object if it exists
});
this.solution = 'inherit';
