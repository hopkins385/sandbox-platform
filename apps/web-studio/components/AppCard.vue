<script setup lang="ts">
import type { App } from '@sandbox/types'

const props = defineProps<{ app: App }>()
const emit = defineEmits<{ deleting: [id: string]; deleted: [id: string] }>()

const config = useRuntimeConfig()
const deleting = ref(false)
const restarting = ref(false)

const effectiveStatus = computed(() => restarting.value ? 'creating' : props.app.status)

const statusClass = computed(() => ({
  'bg-green-100 text-green-700': effectiveStatus.value === 'running',
  'bg-gray-100 text-gray-500': effectiveStatus.value === 'stopped',
  'bg-yellow-100 text-yellow-700': effectiveStatus.value === 'creating',
  'bg-red-100 text-red-700': effectiveStatus.value === 'error',
}))

const statusLabel = computed(() => restarting.value ? 'Neustart…' : ({
  running: 'Aktiv',
  stopped: 'Gestoppt',
  creating: 'Wird erstellt',
  error: 'Fehler',
}[props.app.status]))

async function restartApp() {
  if (restarting.value) return
  restarting.value = true
  try {
    await $fetch(`${config.public.apiBase}/api/apps/${props.app.id}/restart`, { method: 'POST' })
  } finally {
    restarting.value = false
  }
}

async function deleteApp() {
  if (!confirm(`App "${props.app.name}" wirklich löschen?`)) return
  deleting.value = true
  emit('deleting', props.app.id)
  try {
    await $fetch(`${config.public.apiBase}/api/apps/${props.app.id}`, {
      method: 'DELETE',
    })
    emit('deleted', props.app.id)
  } catch (err) {
    alert(`Fehler beim Löschen: ${err instanceof Error ? err.message : String(err)}`)
    deleting.value = false
  }
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all">
    <div class="flex items-start justify-between mb-3">
      <h3 class="font-medium text-gray-900">{{ app.name }}</h3>
      <div class="flex items-center gap-1.5">
        <span class="text-xs font-medium px-2 py-0.5 rounded-full" :class="statusClass">
          {{ statusLabel }}
        </span>
      </div>
    </div>
    <p class="text-xs text-gray-400 mb-4 font-mono">{{ app.slug }}</p>
    <div class="flex gap-2">
      <NuxtLink :to="`/app/${app.slug}`"
        class="flex-1 text-center px-3 py-1.5 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
        Öffnen
      </NuxtLink>
      <button
        class="px-3 py-1.5 text-sm font-medium text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="deleting || restarting" @click="deleteApp">
        {{ deleting ? '...' : 'Löschen' }}
      </button>
    </div>
  </div>
</template>
