import App from './App'

// Local prototype mode: keep the admin UI runnable without uniCloud binding.
// We will re-enable uni-admin store/plugin when login and cloud permissions start.
import Vue from 'vue'

Vue.config.productionTip = false

App.mpType = 'app'

const app = new Vue({
	...App
})

app.$mount()
