import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
const base = new URL('../miniapp-uni/word-app1/', import.meta.url)
const storage = new Map(), calls = [], events = []
let responseMode = 'valid', requestCount = 0
const future = '2099-01-01T00:00:00Z'
globalThis.uni = {
  getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
  login(options) { options.success({ code: 'fresh-' + (++requestCount) }) },
  request(options) {
    calls.push(options)
    if (responseMode === 'network') options.fail({ errMsg: 'offline' })
    else if (responseMode === 'invalid') options.success({ statusCode: 400, data: { code: 'INVITATION_CREDENTIAL_INVALID' } })
    else options.success({ statusCode: 200, data: { candidateReceipt: 'receipt-' + options.data.token, expiresAt: future } })
    return { abort() {} }
  }, showToast() {}
}
const state = await import(new URL('common/invitation-state.js', base))
const auth = await import(new URL('common/auth-store.js', base))
const { invitationRegistrationFeedback: feedback } = await import(new URL('common/invitation-feedback.js', base))
const options = { nodeEnv: 'development', apiBaseUrl: 'http://127.0.0.1:9999' }
const source = await readFile(new URL('components/InvitationNotice.vue', base), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/from '([^']+)'/g, (_, relative) => `from '${new URL(relative, new URL('components/InvitationNotice.vue', base)).href}'`)
const definition = (await import('data:text/javascript,' + encodeURIComponent(script))).default
function notice() {
  const instance = { ...definition.data(), active: true, $emit: event => events.push(event) }
  for (const [key, method] of Object.entries(definition.methods)) instance[key] = method.bind(instance)
  definition.mounted.call(instance)
  return instance
}
test('guide closes without losing receipt; page handoff and duplicate entry never reopen it', async () => {
  auth.clearAuthSession()
  assert.equal(state.invitationState().guideVisible, false)
  await state.receiveInvitation({ invitationToken: 'valid-guide' }, options)
  const home = notice()
  assert.equal(home.state.guideVisible, true)
  const stored = structuredClone(storage.get('pictographic:pendingInvitation'))
  home.dismiss()
  assert.equal(home.state.guideVisible, false)
  assert.deepEqual(storage.get('pictographic:pendingInvitation'), stored)
  const mine = notice()
  assert.equal(mine.state.guideVisible, false)
  await state.receiveInvitation({ invitationToken: 'valid-guide' }, options)
  assert.equal(mine.state.guideVisible, false)
  assert.equal(await state.prepareInvitationRegistration(options), 'receipt-valid-guide')
  state.finishInvitationRegistration(false)
  await state.receiveInvitation({ invitationToken: 'new-valid' }, options)
  home.goRegister()
  assert.equal(events.at(-1), 'register')
  assert.equal(mine.state.guideVisible, false)
  assert.equal(await state.prepareInvitationRegistration(options), 'receipt-new-valid')
  definition.beforeDestroy.call(home); definition.beforeDestroy.call(mine)
  state.clearPendingInvitation()
})
test('network is retryable; invalid new invitation does not reopen a guide or discard valid receipt', async () => {
  await state.receiveInvitation({ invitationToken: 'retained' }, options)
  state.dismissInvitationNotice()
  responseMode = 'invalid'
  await state.receiveInvitation({ invitationToken: 'invalid' }, options)
  assert.equal(state.invitationState().guideVisible, false)
  assert.equal(state.invitationState().feedbackVisible, true)
  assert.equal(await state.prepareInvitationRegistration(options), 'receipt-retained')
  responseMode = 'network'
  await assert.rejects(state.receiveInvitation({ invitationToken: 'retry' }, options))
  assert.equal(state.invitationState().pending, true)
  state.dismissInvitationNotice()
  await assert.rejects(state.prepareInvitationRegistration(options), error => error.code === 'INVITATION_CAPTURE_RETRY')
  responseMode = 'valid'
  await state.saveIncomingInvitation(options)
  assert.equal(await state.prepareInvitationRegistration(options), 'receipt-retry')
  state.finishInvitationRegistration(true)
  assert.equal(state.invitationState().guideVisible, false)
})
test('feedback distinguishes grant, pending, review, ineligible, expiry and unknown without inventing a grant', () => {
  assert.match(feedback({ status: 'REWARD_GRANTED' }).title, /30次.*已到账/)
  assert.match(feedback({ status: 'REWARD_PENDING' }).description, /邀请奖励待到账/)
  assert.doesNotMatch(feedback({ status: 'MANUAL_REVIEW' }).title, /30|到账/)
  assert.match(feedback({ status: 'NO_REWARD', reason: 'NOT_FIRST_PHONE_REGISTRATION' }).description, /不重复赠送/)
  assert.match(feedback({ status: 'NO_REWARD', reason: 'INVITATION_EXPIRED' }).description, /已过期/)
  assert.match(feedback({ status: 'NO_REWARD', reason: 'INVITATION_UNAVAILABLE' }).description, /暂时无法确认/)
  assert.equal(feedback({ status: 'NO_REWARD', reason: 'CANDIDATE_MISSING' }), null)
  assert.match(source, /position: fixed/)
  assert.match(source, /@touchmove.stop.prevent/)
  assert.match(source, /@tap.stop="dismiss"/)
  assert.doesNotMatch(source, /open-type="getPhoneNumber"/)
})
test('restored invitation does not interrupt ordinary startup; expiry and registered accounts never show registration guide', async () => {
  auth.clearAuthSession()
  await state.receiveInvitation({ invitationToken: 'restore-check' }, options)
  state.dismissInvitationNotice()
  const restored = await import(new URL('common/invitation-state.js?notice-restore-check', base))
  assert.equal(restored.invitationState().candidate, true)
  assert.equal(restored.invitationState().guideVisible, false)
  const realNow = Date.now
  try {
    Date.now = () => Date.parse('2100-01-01T00:00:00Z')
    assert.equal(state.invitationState().candidate, false)
    assert.equal(state.invitationState().guideVisible, false)
  } finally { Date.now = realNow }
  auth.saveAuthSession({ token: 'registered-fixture', expiresAt: future, user: { id: 'fixture', hasPhoneBinding: true } })
  await state.receiveInvitation({ invitationToken: 'registered-check' }, options)
  assert.equal(state.invitationState().guideVisible, false)
  auth.clearAuthSession()
})
