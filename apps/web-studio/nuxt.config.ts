import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  css: ["~/assets/css/main.css"],
  vite: {
    plugins: [tailwindcss()],
  },
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
