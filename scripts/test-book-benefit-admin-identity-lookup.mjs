import assert from 'node:assert/strict'

import {
  findBookBenefitAdminIdentityInTransaction,
  hashPhone
} from '../server/identity-store.mjs'

const TEST_PHONE_SECRET = 'fake-admin-lookup-phone-secret-for-tests-only'
const CURRENT_PHONE = '+86 100 0000 0000'
const OLD_PHONE = '+86 100 0000 0001'
const OTHER_USER_PHONE = '+86 100 0000 0002'
const TEST_CAMPAIGN_HASH = Buffer.alloc(32, 0x3c)

function column(Field, Type, overrides = {}) {
  return {
    Field,
    Type,
    Null: 'YES',
    Default: null,
    Extra: '',
    ...overrides
  }
}

function createColumns(overrides = {}) {
  return [
    column('id', 'bigint unsigned'),
    column('user_id', 'bigint unsigned'),
    column('phone_hash', 'char(64)'),
    column('phone_masked', 'varchar(32)'),
    column('campaign_phone_identity_hash', 'binary(32)'),
    column('campaign_phone_hash_version', 'varchar(16)'),
    column('status', 'varchar(32)'),
    column('last_verified_at', 'datetime')
  ].filter((item) => overrides[item.Field] !== null).map((item) => ({
    ...item,
    ...(overrides[item.Field] || {})
  }))
}

function existingPhoneHash(phone) {
  return hashPhone(phone, { secret: TEST_PHONE_SECRET }).phoneHash
}

function binding(input = {}) {
  return {
    id: String(input.id || '1'),
    user_id: String(input.userId || '10'),
    phone_hash: input.phoneHash || existingPhoneHash(input.phone || CURRENT_PHONE),
    phone_masked: input.phoneMasked || '100****0000',
    campaign_phone_identity_hash: input.campaignHash === undefined
      ? Buffer.from(TEST_CAMPAIGN_HASH)
      : input.campaignHash,
    campaign_phone_hash_version: input.campaignVersion === undefined
      ? 'v1'
      : input.campaignVersion,
    status: input.status || 'active',
    last_verified_at: input.lastVerifiedAt || new Date('2026-08-08T00:00:00.000Z')
  }
}

function compareLatest(left, right) {
  const timeDifference = new Date(right.last_verified_at).getTime() - new Date(left.last_verified_at).getTime()
  if (timeDifference !== 0) return timeDifference
  const leftId = BigInt(String(left.id))
  const rightId = BigInt(String(right.id))
  return leftId === rightId ? 0 : (leftId > rightId ? -1 : 1)
}

function cloneRow(row) {
  return {
    ...row,
    campaign_phone_identity_hash: Buffer.isBuffer(row.campaign_phone_identity_hash)
      ? Buffer.from(row.campaign_phone_identity_hash)
      : row.campaign_phone_identity_hash
  }
}

function createFakeConnection(rows, options = {}) {
  const calls = []
  const counters = {
    getConnection: 0,
    begin: 0,
    commit: 0,
    rollback: 0,
    release: 0
  }
  const forbiddenCall = (name) => {
    counters[name] += 1
    throw new Error(`helper must not call ${name}`)
  }

  return {
    calls,
    counters,
    getConnection() {
      forbiddenCall('getConnection')
    },
    beginTransaction() {
      forbiddenCall('begin')
    },
    commit() {
      forbiddenCall('commit')
    },
    rollback() {
      forbiddenCall('rollback')
    },
    release() {
      forbiddenCall('release')
    },
    async query(sql) {
      calls.push({ type: 'query', sql, values: [] })
      assert.match(sql, /SHOW COLUMNS FROM `user_phone_bindings`/)
      return [options.columns || createColumns()]
    },
    async execute(sql, values = []) {
      calls.push({ type: 'execute', sql, values: [...values] })
      const compactSql = sql.replace(/\s+/g, ' ').trim()
      if (/WHERE phone_hash = \?/i.test(compactSql)) {
        const matched = rows.find((row) => row.status === 'active' && row.phone_hash === values[0])
        return [matched ? [{
          id: matched.id,
          user_id: matched.user_id,
          phone_hash: matched.phone_hash
        }] : []]
      }
      if (/WHERE user_id = \?/i.test(compactSql)) {
        const latest = rows
          .filter((row) => row.status === 'active' && String(row.user_id) === String(values[0]))
          .sort(compareLatest)[0]
        return [latest ? [cloneRow(latest)] : []]
      }
      throw new Error('unexpected fake lookup SQL')
    }
  }
}

function assertConnectionUnmanaged(connection) {
  assert.deepEqual(connection.counters, {
    getConnection: 0,
    begin: 0,
    commit: 0,
    rollback: 0,
    release: 0
  })
}

function assertNoDatabaseCalls(connection) {
  assert.equal(connection.calls.filter((call) => call.type === 'query').length, 0)
  assert.equal(connection.calls.filter((call) => call.type === 'execute').length, 0)
  assertConnectionUnmanaged(connection)
}

function assertSafeResult(result, expected = {}) {
  assert.deepEqual(Object.keys(result).sort(), [
    'campaignPhoneHashVersion',
    'campaignPhoneIdentityHash',
    'phoneBindingId',
    'phoneMasked',
    'userId'
  ])
  assert.equal(result.userId, String(expected.userId || '10'))
  assert.equal(result.phoneBindingId, String(expected.phoneBindingId || '1'))
  assert.equal(result.phoneMasked, expected.phoneMasked || '100****0000')
  assert(Buffer.isBuffer(result.campaignPhoneIdentityHash))
  assert.deepEqual(result.campaignPhoneIdentityHash, TEST_CAMPAIGN_HASH)
  assert.equal(result.campaignPhoneHashVersion, 'v1')
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(CURRENT_PHONE), false)
  assert.equal(serialized.includes(existingPhoneHash(CURRENT_PHONE)), false)
  assert.equal(serialized.includes(TEST_PHONE_SECRET), false)
}

async function expectIdentityStoreFailure(action, messagePattern) {
  let capturedError = null
  try {
    await action()
  } catch (error) {
    capturedError = error
  }
  assert(capturedError)
  assert.equal(capturedError.code, 'IDENTITY_STORE_ERROR')
  assert.match(capturedError.message, messagePattern)
  return capturedError
}

async function testUserIdLookup() {
  const connection = createFakeConnection([binding()])
  const result = await findBookBenefitAdminIdentityInTransaction(connection, { userId: '10' })
  assertSafeResult(result)
  const select = connection.calls.find((call) => call.type === 'execute')
  assert.match(select.sql, /status = 'active'/)
  assert.match(select.sql, /ORDER BY last_verified_at DESC, id DESC/)
  assert.doesNotMatch(select.sql, /FOR UPDATE/)
  assert.deepEqual(select.values, ['10'])
  assertConnectionUnmanaged(connection)

  for (const value of [10, '00010']) {
    const compatibleConnection = createFakeConnection([binding()])
    const compatibleResult = await findBookBenefitAdminIdentityInTransaction(
      compatibleConnection,
      { userId: value }
    )
    assertSafeResult(compatibleResult)
    const compatibleSelect = compatibleConnection.calls.find((call) => call.type === 'execute')
    assert.deepEqual(compatibleSelect.values, ['10'])
  }

  for (const value of [Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)]) {
    const maxUserId = String(Number.MAX_SAFE_INTEGER)
    const maxConnection = createFakeConnection([binding({ userId: maxUserId })])
    const maxResult = await findBookBenefitAdminIdentityInTransaction(maxConnection, { userId: value })
    assertSafeResult(maxResult, { userId: maxUserId })
    const maxSelect = maxConnection.calls.find((call) => call.type === 'execute')
    assert.deepEqual(maxSelect.values, [maxUserId])
  }
}

async function testCurrentPhoneLookup() {
  const connection = createFakeConnection([binding()])
  const result = await findBookBenefitAdminIdentityInTransaction(
    connection,
    {
      phone: '8610000000000',
      phoneHash: 'client-hash-must-be-ignored',
      phoneMasked: 'client-mask-must-be-ignored',
      campaignPhoneIdentityHash: Buffer.alloc(32, 0xff)
    },
    { phoneHashSecret: TEST_PHONE_SECRET }
  )
  assertSafeResult(result)
  const executeCalls = connection.calls.filter((call) => call.type === 'execute')
  assert.equal(executeCalls.length, 2)
  assert.match(executeCalls[0].sql, /WHERE phone_hash = \?/)
  assert.deepEqual(executeCalls[0].values, [existingPhoneHash(CURRENT_PHONE)])
  assert.match(executeCalls[1].sql, /ORDER BY last_verified_at DESC, id DESC/)
  assertConnectionUnmanaged(connection)
}

async function testOldPhoneRejected() {
  const rows = [
    binding({
      id: '1',
      phone: OLD_PHONE,
      phoneMasked: '100****0001',
      lastVerifiedAt: new Date('2026-08-01T00:00:00.000Z')
    }),
    binding({
      id: '2',
      phone: CURRENT_PHONE,
      lastVerifiedAt: new Date('2026-08-08T00:00:00.000Z')
    })
  ]
  const connection = createFakeConnection(rows)
  await expectIdentityStoreFailure(
    () => findBookBenefitAdminIdentityInTransaction(
      connection,
      { phone: OLD_PHONE },
      { phoneHashSecret: TEST_PHONE_SECRET, expectedUserId: 10 }
    ),
    /no longer current/
  )
  assertConnectionUnmanaged(connection)
}

async function testPhoneOwnerConflict() {
  const connection = createFakeConnection([
    binding({ id: '7', userId: '20', phone: OTHER_USER_PHONE, phoneMasked: '100****0002' })
  ])
  await expectIdentityStoreFailure(
    () => findBookBenefitAdminIdentityInTransaction(
      connection,
      { phone: OTHER_USER_PHONE },
      { phoneHashSecret: TEST_PHONE_SECRET, expectedUserId: '10' }
    ),
    /conflicts with the expected user/
  )
  const result = await findBookBenefitAdminIdentityInTransaction(
    connection,
    { phone: OTHER_USER_PHONE },
    { phoneHashSecret: TEST_PHONE_SECRET }
  )
  assertSafeResult(result, { userId: '20', phoneBindingId: '7', phoneMasked: '100****0002' })

  for (const expectedUserId of [20, '00020']) {
    const compatibleConnection = createFakeConnection([
      binding({ id: '7', userId: '20', phone: OTHER_USER_PHONE, phoneMasked: '100****0002' })
    ])
    const compatibleResult = await findBookBenefitAdminIdentityInTransaction(
      compatibleConnection,
      { phone: OTHER_USER_PHONE },
      { phoneHashSecret: TEST_PHONE_SECRET, expectedUserId }
    )
    assertSafeResult(compatibleResult, {
      userId: '20',
      phoneBindingId: '7',
      phoneMasked: '100****0002'
    })
  }
}

async function testMissingBindings() {
  for (const rows of [[], [binding({ status: 'inactive' })]]) {
    const connection = createFakeConnection(rows)
    await expectIdentityStoreFailure(
      () => findBookBenefitAdminIdentityInTransaction(connection, { userId: '10' }),
      /was not found/
    )
    assertConnectionUnmanaged(connection)
  }
  const phoneConnection = createFakeConnection([])
  await expectIdentityStoreFailure(
    () => findBookBenefitAdminIdentityInTransaction(
      phoneConnection,
      { phone: CURRENT_PHONE },
      { phoneHashSecret: TEST_PHONE_SECRET }
    ),
    /was not found/
  )
}

async function testCampaignIdentityFailures() {
  for (const invalidBinding of [
    binding({ campaignHash: null, campaignVersion: null }),
    binding({ campaignHash: Buffer.alloc(31) }),
    binding({ campaignVersion: 'v2' })
  ]) {
    const connection = createFakeConnection([invalidBinding])
    await expectIdentityStoreFailure(
      () => findBookBenefitAdminIdentityInTransaction(connection, { userId: '10' }),
      /Campaign phone identity is invalid/
    )
  }

  for (const columnOverrides of [
    { campaign_phone_identity_hash: null },
    { campaign_phone_hash_version: null },
    { campaign_phone_identity_hash: { Type: 'binary(16)' } },
    { campaign_phone_hash_version: { Type: 'varchar(8)' } },
    { campaign_phone_identity_hash: { Extra: 'STORED GENERATED' } },
    { campaign_phone_hash_version: { Extra: 'VIRTUAL GENERATED' } }
  ]) {
    const connection = createFakeConnection([binding()], {
      columns: createColumns(columnOverrides)
    })
    await expectIdentityStoreFailure(
      () => findBookBenefitAdminIdentityInTransaction(connection, { userId: '10' }),
      /schema is unavailable/
    )
    assert.equal(connection.calls.filter((call) => call.type === 'execute').length, 0)
  }
}

async function testInvalidUserIdsBeforeDatabaseAccess() {
  const longUserId = '9'.repeat(1000)
  const invalidLocatorUserIds = [
    undefined,
    null,
    'abc',
    '',
    ' ',
    '0',
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '1e3',
    '+1',
    '0x10',
    longUserId,
    {},
    [],
    true
  ]
  for (const invalidUserId of invalidLocatorUserIds) {
    const connection = createFakeConnection([binding()])
    const error = await expectIdentityStoreFailure(
      () => findBookBenefitAdminIdentityInTransaction(
        connection,
        { userId: invalidUserId }
      ),
      /locator is required|user id is invalid/
    )
    assertNoDatabaseCalls(connection)
    assert.equal(error.message.includes(longUserId), false)
  }

  const invalidExpectedUserIds = [
    '',
    'abc',
    0,
    -1,
    1.5,
    longUserId
  ]
  for (const invalidExpectedUserId of invalidExpectedUserIds) {
    const connection = createFakeConnection([binding()])
    const error = await expectIdentityStoreFailure(
      () => findBookBenefitAdminIdentityInTransaction(
        connection,
        { phone: CURRENT_PHONE },
        { expectedUserId: invalidExpectedUserId }
      ),
      /Expected user id is invalid/
    )
    assertNoDatabaseCalls(connection)
    assert.equal(error.message.includes(longUserId), false)
  }
}

async function testInvalidPhoneBeforeDatabaseAccess() {
  for (const invalidPhone of ['', '100****0000', 'not-a-phone']) {
    const connection = createFakeConnection([binding()])
    await assert.rejects(() => findBookBenefitAdminIdentityInTransaction(
      connection,
      { phone: invalidPhone },
      { phoneHashSecret: TEST_PHONE_SECRET }
    ))
    assertNoDatabaseCalls(connection)
  }
}

async function testTieBreakAndForUpdate() {
  const timestamp = new Date('2026-08-08T00:00:00.000Z')
  const connection = createFakeConnection([
    binding({ id: '41', lastVerifiedAt: timestamp }),
    binding({ id: '42', lastVerifiedAt: timestamp, phoneMasked: '100****0042' })
  ])
  const result = await findBookBenefitAdminIdentityInTransaction(
    connection,
    { userId: '10' },
    { forUpdate: true }
  )
  assertSafeResult(result, { phoneBindingId: '42', phoneMasked: '100****0042' })
  for (const call of connection.calls.filter((item) => item.type === 'execute')) {
    assert.match(call.sql, /FOR UPDATE$/)
  }

  const phoneConnection = createFakeConnection([binding()])
  await findBookBenefitAdminIdentityInTransaction(
    phoneConnection,
    { phone: CURRENT_PHONE },
    { phoneHashSecret: TEST_PHONE_SECRET, forUpdate: true }
  )
  const phoneSelects = phoneConnection.calls.filter((item) => item.type === 'execute')
  assert.equal(phoneSelects.length, 2)
  for (const call of phoneSelects) assert.match(call.sql, /FOR UPDATE$/)
}

async function testInvalidLocatorAndNoSensitiveLogging() {
  const connection = createFakeConnection([binding()])
  const longUserId = '9'.repeat(1000)
  await expectIdentityStoreFailure(
    () => findBookBenefitAdminIdentityInTransaction(connection, {}),
    /Exactly one/
  )
  await expectIdentityStoreFailure(
    () => findBookBenefitAdminIdentityInTransaction(
      connection,
      { userId: '10', phone: CURRENT_PHONE },
      { phoneHashSecret: TEST_PHONE_SECRET }
    ),
    /Exactly one/
  )

  const captured = []
  const originalMethods = Object.fromEntries(
    ['log', 'info', 'warn', 'error'].map((name) => [name, console[name]])
  )
  for (const name of Object.keys(originalMethods)) {
    console[name] = (...values) => captured.push(values.join(' '))
  }
  try {
    await assert.rejects(() => findBookBenefitAdminIdentityInTransaction(
      createFakeConnection([]),
      { phone: CURRENT_PHONE },
      { phoneHashSecret: TEST_PHONE_SECRET }
    ))
    await assert.rejects(() => findBookBenefitAdminIdentityInTransaction(
      createFakeConnection([binding()]),
      { userId: longUserId }
    ))
  } finally {
    for (const [name, method] of Object.entries(originalMethods)) console[name] = method
  }
  const output = captured.join('\n')
  assert.equal(output.includes('10000000000'), false)
  assert.equal(output.includes(existingPhoneHash(CURRENT_PHONE)), false)
  assert.equal(output.includes(TEST_CAMPAIGN_HASH.toString('hex')), false)
  assert.equal(output.includes(TEST_PHONE_SECRET), false)
  assert.equal(output.includes(longUserId), false)
}

await testUserIdLookup()
await testCurrentPhoneLookup()
await testOldPhoneRejected()
await testPhoneOwnerConflict()
await testMissingBindings()
await testCampaignIdentityFailures()
await testInvalidUserIdsBeforeDatabaseAccess()
await testInvalidPhoneBeforeDatabaseAccess()
await testTieBreakAndForUpdate()
await testInvalidLocatorAndNoSensitiveLogging()

console.log('book-benefit admin identity lookup tests passed')
