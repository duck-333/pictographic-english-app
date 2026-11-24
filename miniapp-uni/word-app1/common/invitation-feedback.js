// Only confirmed invitation outcomes imply a completed first registration.
// Do not infer a registration grant from a balance, local flag or user.isNew.
export function invitationRegistrationFeedback(result) {
  if (!result) return null
  if (result.status === 'REWARD_GRANTED' || result.status === 'REWARD_PENDING') {
    return {
      title: '注册成功，30次查词权益已到账',
      description: result.status === 'REWARD_GRANTED'
        ? '这是你的首次注册赠送，快去查一个单词吧。好友的邀请奖励也已到账。'
        : '这是你的首次注册赠送，可直接开始查词。好友的邀请奖励待到账，不影响你使用。'
    }
  }
  if (result.status === 'MANUAL_REVIEW') return { title: '注册已完成', description: '好友的邀请奖励仍待确认。你的可用查词权益请查看本页余额。' }
  const descriptions = {
    NOT_FIRST_PHONE_REGISTRATION: '该账号已完成过注册，本次不重复赠送30次，也不产生邀请奖励。',
    INVITER_REWARD_LIMIT_REACHED: '好友的邀请奖励名额已满，不影响你的正常注册权益。可用次数请查看本页余额。',
    INVITATION_EXPIRED: '好友邀请已过期，不影响正常使用。你的查词权益请查看本页余额。',
    INVITATION_REVOKED: '好友邀请已失效，不影响正常使用。你的查词权益请查看本页余额。',
    CANDIDATE_INVALID: '好友邀请未生效，不影响正常使用。你的查词权益请查看本页余额。',
    SELF_INVITE: '不能接受自己的邀请。你的查词权益请查看本页余额。',
    INVITATION_UNAVAILABLE: '暂时无法确认好友邀请奖励，请稍后查看。你的查词权益请查看本页余额。'
  }
  if (result.reason === 'CANDIDATE_MISSING') return null
  return { title: '登录成功', description: descriptions[result.reason] || '好友邀请奖励尚未确认。你的查词权益请查看本页余额。' }
}
