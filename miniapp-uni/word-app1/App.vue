<script>
export default {
  onLaunch() {}
}
</script>

<style>
page {
  background: #f4f9ff;
  color: #16324f;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
}

view,
text,
button,
input {
  box-sizing: border-box;
}

button::after {
  border: 0;
}

.card {
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 8rpx 28rpx rgba(22, 50, 79, 0.08);
}

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

.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  justify-content: space-around;
  padding: 14rpx 80rpx calc(14rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid rgba(169, 226, 255, 0.25);
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 -8rpx 40rpx rgba(14, 58, 92, 0.07);
}

.nav-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 128rpx;
  padding: 8rpx 0 4rpx;
  color: #6baed6;
  transition: transform 0.16s ease, opacity 0.16s ease;
}

.nav-item-pressed {
  opacity: 0.72;
  transform: scale(0.96);
}

.nav-item.active {
  color: #0e3a5c;
}

.nav-label {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  font-weight: 600;
}

.nav-dot {
  width: 8rpx;
  height: 8rpx;
  margin-top: 8rpx;
  border-radius: 999rpx;
  background: #fe8500;
}

.nav-icon {
  position: relative;
  width: 44rpx;
  height: 44rpx;
}

.nav-icon.search .i-a {
  width: 25rpx;
  height: 25rpx;
  border: 4rpx solid currentColor;
  border-radius: 999rpx;
}

.nav-icon.search .i-b {
  position: absolute;
  right: 4rpx;
  bottom: 5rpx;
  width: 18rpx;
  height: 4rpx;
  border-radius: 999rpx;
  background: currentColor;
  transform: rotate(45deg);
}

.nav-icon.mine .i-a {
  position: absolute;
  left: 11rpx;
  top: 4rpx;
  width: 22rpx;
  height: 22rpx;
  border: 4rpx solid currentColor;
  border-radius: 999rpx;
}

.nav-icon.mine .i-b {
  position: absolute;
  left: 5rpx;
  bottom: 3rpx;
  width: 34rpx;
  height: 18rpx;
  border: 4rpx solid currentColor;
  border-top-left-radius: 22rpx;
  border-top-right-radius: 22rpx;
  border-bottom: 0;
}

.nav-icon .i-c {
  display: none;
}
</style>
