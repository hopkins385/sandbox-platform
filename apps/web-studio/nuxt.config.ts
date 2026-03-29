export default defineNuxtConfig({
  modules: ["@nuxtjs/tailwindcss"],
  devtools: { enabled: true },
  telemetry: false,
  ssr: false,
  runtimeConfig: {
    public: {
      apiBase: "http://localhost:4000",
    },
  },
  compatibilityDate: "2024-11-01",
});
