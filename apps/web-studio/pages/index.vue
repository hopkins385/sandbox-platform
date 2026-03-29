<template>
  <div class="max-w-5xl mx-auto px-6 py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold text-gray-900">Meine Apps</h1>
      <button
        class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        @click="showCreateModal = true"
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
            @deleted="removeApp"
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
            @deleted="removeApp"
          />
        </div>
      </section>

      <div
        v-if="!data?.owned.length && !data?.collaborations.length"
        class="text-center text-gray-400 text-sm mt-12"
      >
        Noch keine Apps vorhanden. Erstelle deine erste App!
      </div>
    </template>

    <!-- Create App Modal -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="closeCreateModal"
    >
      <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Neue App erstellen</h2>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1" for="app-name">
            App Name
          </label>
          <input
            id="app-name"
            v-model="newAppName"
            type="text"
            class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
            placeholder="Meine neue App"
            :disabled="creating"
            @keydown.enter="createApp"
          />
          <p v-if="createError" class="mt-1.5 text-xs text-red-500">{{ createError }}</p>
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            :disabled="creating"
            @click="closeCreateModal"
          >
            Abbrechen
          </button>
          <button
            class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            :disabled="!newAppName.trim() || creating"
            @click="createApp"
          >
            {{ creating ? 'Erstelle...' : 'Erstellen' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { App, AppListResponse } from '@sandbox/types'

const config = useRuntimeConfig()
const router = useRouter()

const { data, pending, error } = await useFetch<AppListResponse>(
  `${config.public.apiBase}/api/apps`
)

const showCreateModal = ref(false)
const newAppName = ref('')
const creating = ref(false)
const createError = ref('')

function closeCreateModal() {
  showCreateModal.value = false
  newAppName.value = ''
  createError.value = ''
}

async function createApp() {
  const name = newAppName.value.trim()
  if (!name || creating.value) return

  creating.value = true
  createError.value = ''

  try {
    const app = await $fetch<App>(`${config.public.apiBase}/api/apps`, {
      method: 'POST',
      body: { name },
    })
    closeCreateModal()
    router.push(`/app/${app.slug}`)
  } catch (err) {
    createError.value = `Fehler: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    creating.value = false
  }
}

function removeApp(id: string) {
  if (data.value) {
    data.value.owned = data.value.owned.filter(a => a.id !== id)
    data.value.collaborations = data.value.collaborations.filter(a => a.id !== id)
  }
}
</script>
