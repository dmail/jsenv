const test = require('../ensure.js')

const {equals, isString, pipe} = test

const suite = test(
	'ensure age is 10',
	test(
		pipe((user) => user.age),
		'is 10',
		(age) => equals(age, 10)
	),
	'ensure name is damien & is as string',
	test(
		pipe((user) => user.name),
		'is damien',
		(name) => equals(name, 'damien'),
		'is a string',
		(name) => isString(name)
	)
)

module.exports = () => {
	suite({age: 10, name: 'damien'}).then(
		(value) => {
			console.log('test result', value)
		},
		(reason) => {
			console.log('unexpected test error', reason)
		}
	)
}