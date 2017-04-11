const parse = require("../../parse/parse.js")
const transform = require("../transform.js")
const ensureThenable = require("../../util/ensure-thenable.js")

const test = (name) => {
	const testFn = require(`${__dirname}/fixtures/${name}/test.js`) // eslint-disable-line import/no-dynamic-require
	return ensureThenable(testFn)(parse, transform)
}

[
	'exclude',
].reduce((previous, name) => {
	return previous.then(() => {
		return test(name)
	})
}, Promise.resolve()).then(() => {
	console.log('tests passed')
}).catch((e) => {
	setTimeout(() => {
		throw e
	})
})