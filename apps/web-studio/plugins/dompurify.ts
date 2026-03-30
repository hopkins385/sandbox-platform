import VueDompurifyHTML from 'vue-dompurify-html'

export default defineNuxtPlugin((app) => {
  app.vueApp.use(VueDompurifyHTML)
})
