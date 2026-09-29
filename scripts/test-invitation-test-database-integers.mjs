import assert from 'node:assert/strict'

import {
  parseDatabaseInsertId,
  parseDatabaseSafeInteger,
  parseDatabaseUnsignedBigInt,
  requireDatabaseInteger
} from './invitation-test-database-integers.mjs'

for (const value of [null, undefined, true, false, '', ' ', '01', '+1', '-1', '1.0', '1e3', 'NaN',
  'Infinity', NaN, Infinity, -Infinity, 1.5, -1, {}, []]) {
  assert.throws(() => parseDatabaseUnsignedBigInt(value),
    error => error.code === 'INVITATION_TEST_DATABASE_INTEGER_INVALID')
}

assert.equal(parseDatabaseUnsignedBigInt('0'), 0n)
assert.equal(parseDatabaseUnsignedBigInt('18446744073709551615'), 18446744073709551615n)
assert.equal(parseDatabaseUnsignedBigInt(42n), 42n)
assert.equal(parseDatabaseSafeInteger(0), 0)
assert.equal(parseDatabaseSafeInteger('42'), 42)
assert.equal(parseDatabaseSafeInteger(42n), 42)
assert.equal(parseDatabaseInsertId(42), 42n)
assert.equal(parseDatabaseInsertId('18446744073709551615'), 18446744073709551615n)
assert.throws(() => parseDatabaseInsertId(0),
  error => error.code === 'INVITATION_TEST_DATABASE_INTEGER_INVALID')
assert.throws(() => parseDatabaseSafeInteger('9007199254740992'),
  error => error.code === 'INVITATION_TEST_DATABASE_INTEGER_INVALID')
assert.equal(requireDatabaseInteger('1', 1n), 1n)
assert.throws(() => requireDatabaseInteger('2', 1n),
  error => error.code === 'INVITATION_TEST_DATABASE_INTEGER_MISMATCH')

console.log('invitation strict database integer tests passed')
