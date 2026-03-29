<template>
  <div class="flex flex-col h-[calc(100vh-49px)]">
    <!-- Breadcrumb -->
    <div class="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-2 text-sm">
      <NuxtLink to="/" class="text-gray-500 hover:text-gray-700">Meine Apps</NuxtLink>
      <span class="text-gray-300">/</span>
      <span class="text-gray-900 font-medium">{{ slug }}</span>
    </div>

    <!-- Main split layout -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Chat Panel (60%) -->
      <div class="w-[60%] flex flex-col border-r border-gray-200 bg-white">
        <!-- Messages -->
        <div ref="messagesEl" class="flex-1 overflow-y-auto p-4 space-y-3">
          <div v-if="messages.length === 0" class="text-center text-gray-400 text-sm mt-8">
            Schreibe eine Nachricht um zu beginnen.
          </div>

          <template v-for="(msg, i) in messages" :key="i">
            <!-- Status message -->
            <div v-if="msg.type === 'status'" class="flex justify-center">
              <span class="text-xs text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
                {{ msg.content }}
              </span>
            </div>

            <!-- User message -->
            <div v-else-if="msg.role === 'user'" class="flex justify-end">
              <div class="max-w-[75%] bg-indigo-600 text-white text-sm rounded-2xl rounded-tr-sm px-4 py-2.5">
                {{ msg.content }}
              </div>
            </div>

            <!-- Agent text message -->
            <div v-else-if="msg.type === 'text'" class="flex justify-start">
              <div class="max-w-[75%] bg-gray-100 text-gray-800 text-sm rounded-2xl rounded-tl-sm px-4 py-2.5">
                {{ msg.content }}
              </div>
            </div>
          </template>

          <!-- Typing indicator -->
          <div v-if="isStreaming" class="flex justify-start">
            <div class="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5">
              <span class="flex gap-1">
                <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
              </span>
            </div>
          </div>
        </div>

        <!-- Input area -->
        <div class="border-t border-gray-200 p-4">
          <div class="flex gap-2">
            <textarea v-model="inputText"
              class="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
              rows="3" placeholder="Beschreibe was du bauen möchtest..." :disabled="isStreaming"
              @keydown.enter.meta="sendMessage" @keydown.enter.ctrl="sendMessage" />
            <button
              class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
              :disabled="!inputText.trim() || isStreaming" @click="sendMessage">
              Senden
            </button>
          </div>
        </div>
      </div>

      <!-- Preview Panel (40%) -->
      <div class="w-[40%] flex flex-col bg-gray-50">
        <div class="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white">
          <span class="text-xs text-gray-500 font-mono flex-1 truncate">{{ previewUrl }}</span>
          <button
            class="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            @click="reloadPreview">
            ↺ Reload
          </button>
        </div>
        <iframe ref="iframeEl" :src="previewUrl" class="flex-1 w-full border-0" title="App Preview" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SendMessageResponse } from '@sandbox/types'

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const config = useRuntimeConfig()

// const previewUrl = computed(() => `https://${slug.value}.sandbox.firma.local`)
const previewUrl = 'http://localhost:3000' // Hardcoded for local development

interface ChatMessage {
  role?: 'user' | 'agent'
  type?: 'text' | 'status' | 'error' | 'done'
  content: string
}

const messages = ref<ChatMessage[]>([])
const inputText = ref('')
const isStreaming = ref(false)
const messagesEl = ref<HTMLElement>()
const iframeEl = ref<HTMLIFrameElement>()

// Hardcoded session id for stub
const sessionId = `session-${slug.value}`

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || isStreaming.value) return

  inputText.value = ''
  messages.value.push({ role: 'user', type: 'text', content: text })
  isStreaming.value = true
  scrollToBottom()

  try {
    const response = await fetch(`${config.public.apiBase}/api/sessions/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text }),
    })

    if (!response.body) throw new Error('No response body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const jsonStr = trimmed.slice(5).trim()
        if (!jsonStr) continue

        try {
          const event = JSON.parse(jsonStr) as SendMessageResponse
          if (event.type === 'done') {
            isStreaming.value = false
          } else if (event.type === 'status') {
            messages.value.push({ type: 'status', content: event.content })
          } else if (event.type === 'text') {
            messages.value.push({ role: 'agent', type: 'text', content: event.content })
          } else if (event.type === 'error') {
            messages.value.push({ role: 'agent', type: 'text', content: `Fehler: ${event.content}` })
            isStreaming.value = false
          }
          scrollToBottom()
        } catch {
          // ignore parse errors
        }
      }
    }
  } catch (err) {
    messages.value.push({
      role: 'agent',
      type: 'text',
      content: `Verbindungsfehler: ${err instanceof Error ? err.message : String(err)}`,
    })
  } finally {
    isStreaming.value = false
    scrollToBottom()
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
}

function reloadPreview() {
  if (iframeEl.value) {
    iframeEl.value.src = previewUrl.value
  }
}
</script>
