export default defineNuxtConfig({
  modules: ['@nuxtjs/tailwindcss'],
  devtools: { enabled: true },
  runtimeConfig: {
    public: {
      apiBase: 'http://localhost:4000',
    },
  },
  compatibilityDate: '2024-11-01',
})
