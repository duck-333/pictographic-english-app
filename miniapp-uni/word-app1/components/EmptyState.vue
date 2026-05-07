<template>
  <view class="empty-state">
    <view class="empty-mark">{{ mark }}</view>
    <text class="empty-title">{{ title }}</text>
    <text v-if="description" class="empty-description">{{ description }}</text>
    <button
      v-if="actionText"
      class="empty-action"
      hover-class="empty-action-pressed"
      @tap="emitAction"
    >
      {{ actionText }}
    </button>
  </view>
</template>

<script>
export default {
  name: 'EmptyState',
  props: {
    mark: {
      type: String,
      default: '象'
    },
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      default: ''
    },
    actionText: {
      type: String,
      default: ''
    }
  },
  methods: {
    emitAction() {
      this.$emit('action')
    }
  }
}
</script>

<style>
.empty-state {
  padding: 44rpx 32rpx;
  border-radius: 28rpx;
  background: #ffffff;
  text-align: center;
  box-shadow: 0 6rpx 18rpx rgba(14, 58, 92, 0.06);
}

.empty-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  margin: 0 auto 20rpx;
  border-radius: 24rpx;
  background: #ebf8ff;
  color: #0e3a5c;
  font-size: 34rpx;
  font-weight: 700;
}

.empty-title,
.empty-description {
  display: block;
}

.empty-title {
  color: #0e3a5c;
  font-size: 30rpx;
  font-weight: 700;
}

.empty-description {
  margin-top: 12rpx;
  color: #6b8aa4;
  font-size: 24rpx;
  line-height: 1.6;
}

.empty-action {
  height: 72rpx;
  margin-top: 28rpx;
  padding: 0 32rpx;
  border-radius: 999rpx;
  background: #0e3a5c;
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 72rpx;
}

.empty-action-pressed {
  opacity: 0.78;
  transform: scale(0.98);
}
</style>
