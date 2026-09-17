import DefaultTheme from 'vitepress/theme'
import './style.css'

import DownloadBox from './components/DownloadBox.vue'
import StepGuide from './components/StepGuide.vue'
import ScenarioCards from './components/ScenarioCards.vue'
import FeatureShowcase from './components/FeatureShowcase.vue'
import HomeView from './components/HomeView.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DownloadBox', DownloadBox)
    app.component('StepGuide', StepGuide)
    app.component('ScenarioCards', ScenarioCards)
    app.component('FeatureShowcase', FeatureShowcase)
    app.component('HomeView', HomeView)
  }
}


