<template>
  <div class="max-w-5xl mx-auto px-6 py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold text-gray-900">Meine Apps</h1>
      <button
        class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        @click="newApp"
      >
        + Neue App
      </button>
    </div>

    <div v-if="pending" class="text-gray-500 text-sm">Lade Apps...</div>
    <div v-else-if="error" class="text-red-500 text-sm">Fehler beim Laden der Apps.</div>

    <template v-else>
      <section v-if="data?.owned.length">
        <h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Eigene Apps</h2>
        <div class="grid grid-cols-3 gap-4 mb-8">
          <AppCard
            v-for="app in data.owned"
            :key="app.id"
            :app="app"
          />
        </div>
      </section>

      <section v-if="data?.collaborations.length">
        <h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Geteilte Apps</h2>
        <div class="grid grid-cols-3 gap-4">
          <AppCard
            v-for="app in data.collaborations"
            :key="app.id"
            :app="app"
          />
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { AppListResponse } from '@sandbox/types'

const config = useRuntimeConfig()

const { data, pending, error } = await useFetch<AppListResponse>(
  `${config.public.apiBase}/api/apps`
)

function newApp() {
  // TODO: open create dialog
}
</script>
