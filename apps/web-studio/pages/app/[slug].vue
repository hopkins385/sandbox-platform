<template>
  <div class="flex flex-col h-[calc(100vh-49px)]">
    <!-- Breadcrumb -->
    <div class="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-2 text-sm">
      <NuxtLink to="/" class="text-gray-500 hover:text-gray-700">Meine Apps</NuxtLink>
      <span class="text-gray-300">/</span>
      <span class="text-gray-900 font-medium">{{ currentApp?.name ?? slug }}</span>
    </div>

    <!-- Loading / error state -->
    <div v-if="sessionLoading" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
      {{ currentApp?.status === 'creating' ? 'Container wird gestartet...' : 'Sitzung wird geöffnet...' }}
    </div>
    <div v-else-if="sessionError" class="flex-1 flex items-center justify-center text-red-500 text-sm">
      {{ sessionError }}
    </div>

    <!-- Main split layout -->
    <div v-else class="flex flex-1 overflow-hidden">
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

            <!-- Result message -->
            <div v-else-if="msg.type === 'result'" class="flex justify-center">
              <span class="text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200">
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

            <!-- Screenshot message -->
            <div v-else-if="msg.type === 'screenshot'" class="flex justify-start">
              <div class="max-w-[75%] bg-gray-100 rounded-2xl rounded-tl-sm p-2 overflow-hidden">
                <img :src="msg.content" alt="Screenshot" class="rounded-lg max-w-full h-auto" />
              </div>
            </div>

            <!-- Question message -->
            <div v-else-if="msg.type === 'question'" class="flex justify-start w-full">
              <div class="w-full max-w-[90%] bg-white border border-indigo-200 rounded-2xl rounded-tl-sm p-4 space-y-4">
                <template v-for="(qi, qi_i) in msg.questions" :key="qi_i">
                  <div>
                    <p v-if="qi.header" class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{{ qi.header }}</p>
                    <p class="text-sm font-medium text-gray-800 mb-2">{{ qi.question }}</p>
                    <div class="space-y-1.5">
                      <label
                        v-for="opt in qi.options"
                        :key="opt.label"
                        class="flex items-start gap-2.5 p-2.5 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer transition-colors"
                        :class="{ 'border-indigo-400 bg-indigo-50': isOptionSelected(msg.id, qi.question, opt.label) }"
                      >
                        <input
                          v-if="qi.multiSelect"
                          type="checkbox"
                          :checked="isOptionSelected(msg.id, qi.question, opt.label)"
                          class="mt-0.5 accent-indigo-600"
                          :disabled="msg.answered"
                          @change="toggleOption(msg.id, qi.question, opt.label, qi.multiSelect)"
                        />
                        <input
                          v-else
                          type="radio"
                          :name="`q-${msg.id}-${qi_i}`"
                          :checked="isOptionSelected(msg.id, qi.question, opt.label)"
                          class="mt-0.5 accent-indigo-600"
                          :disabled="msg.answered"
                          @change="toggleOption(msg.id, qi.question, opt.label, qi.multiSelect)"
                        />
                        <div>
                          <span class="text-sm font-medium text-gray-800">{{ opt.label }}</span>
                          <p v-if="opt.description" class="text-xs text-gray-500 mt-0.5">{{ opt.description }}</p>
                        </div>
                      </label>
                    </div>
                  </div>
                </template>

                <button
                  v-if="!msg.answered"
                  class="mt-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  :disabled="!hasAnswers(msg.id, msg.questions)"
                  @click="submitAnswers(msg)"
                >
                  Antworten
                </button>
                <p v-else class="text-xs text-gray-400 italic">Beantwortet</p>
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
            <textarea
              v-model="inputText"
              class="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
              rows="3"
              placeholder="Beschreibe was du bauen möchtest..."
              :disabled="isStreaming"
              @keydown.enter.meta="sendMessage"
              @keydown.enter.ctrl="sendMessage"
            />
            <div class="flex flex-col gap-2 self-end">
              <button
                v-if="isStreaming"
                class="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-xl hover:bg-red-600 transition-colors"
                @click="cancelMessage"
              >
                Abbrechen
              </button>
              <button
                class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                :disabled="!inputText.trim() || isStreaming"
                @click="sendMessage"
              >
                Senden
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Preview Panel (40%) -->
      <div class="w-[40%] flex flex-col bg-gray-50">
        <div class="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white">
          <span class="text-xs text-gray-500 font-mono flex-1 truncate">{{ previewUrl }}</span>
          <button
            class="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            @click="reloadPreview"
          >
            ↺ Reload
          </button>
        </div>
        <iframe ref="iframeEl" :src="previewUrl" class="flex-1 w-full border-0" title="App Preview" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { App, AppListResponse, QuestionItem, SendMessageResponse } from '@sandbox/types'

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const config = useRuntimeConfig()

// Session state
const sessionId = ref('')
const currentApp = ref<App | null>(null)
const previewUrl = ref('')
const sessionLoading = ref(true)
const sessionError = ref('')

// Chat state
interface QuestionMessage {
  id: string
  type: 'question'
  questions: QuestionItem[]
  answered: boolean
}
interface BaseMessage {
  role?: 'user' | 'agent'
  type: 'text' | 'status' | 'error' | 'done' | 'screenshot' | 'result'
  content: string
}
type ChatMessage = BaseMessage | QuestionMessage

const messages = ref<ChatMessage[]>([])
const inputText = ref('')
const isStreaming = ref(false)
const messagesEl = ref<HTMLElement>()
const iframeEl = ref<HTMLIFrameElement>()
// Index of the currently-accumulating streaming text bubble, or null
const streamingBubbleIdx = ref<number | null>(null)

// Per-question answers: msgId -> question -> Set<label>
const questionAnswers = ref<Record<string, Record<string, Set<string>>>>({})

// Open session on mount
onMounted(async () => {
  try {
    // Find app by slug, polling until it's running (container may still be starting)
    let app: App | undefined
    for (let attempt = 0; attempt < 60; attempt++) {
      const list = await $fetch<AppListResponse>(`${config.public.apiBase}/api/apps`)
      app = [...list.owned, ...list.collaborations].find(a => a.slug === slug.value)
      if (!app) {
        sessionError.value = `App "${slug.value}" nicht gefunden.`
        return
      }
      if (app.status === 'running') break
      if (app.status === 'error') {
        sessionError.value = `App "${app.name}" konnte nicht gestartet werden.`
        return
      }
      // Still creating — wait and retry
      currentApp.value = app
      await new Promise(r => setTimeout(r, 2000))
    }

    if (app!.status !== 'running') {
      sessionError.value = 'Container-Start hat zu lange gedauert.'
      return
    }

    // Open session
    const session = await $fetch<{ sessionId: string; app: App; previewUrl: string }>(
      `${config.public.apiBase}/api/sessions/open`,
      {
        method: 'POST',
        body: { appId: app!.id },
      }
    )
    sessionId.value = session.sessionId
    currentApp.value = session.app
    previewUrl.value = session.previewUrl
  } catch (err) {
    sessionError.value = `Sitzung konnte nicht geöffnet werden: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    sessionLoading.value = false
  }
})

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
      body: JSON.stringify({ sessionId: sessionId.value, message: text }),
    })

    if (!response.body) throw new Error('No response body')

    await consumeSSE(response)
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

async function consumeSSE(response: Response) {
  const reader = response.body!.getReader()
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
        handleSSEEvent(event)
        scrollToBottom()
      } catch {
        // ignore parse errors
      }
    }
  }
}

function handleSSEEvent(event: SendMessageResponse) {
  if (event.type === 'done') {
    streamingBubbleIdx.value = null
    isStreaming.value = false
    reloadPreview()
  } else if (event.type === 'text_delta') {
    // Append partial delta to the current streaming bubble, or start a new one
    if (streamingBubbleIdx.value !== null) {
      (messages.value[streamingBubbleIdx.value] as BaseMessage).content += event.content
    } else {
      messages.value.push({ role: 'agent', type: 'text', content: event.content })
      streamingBubbleIdx.value = messages.value.length - 1
    }
  } else if (event.type === 'text') {
    // Complete assistant message — replace the streaming bubble or push new
    if (streamingBubbleIdx.value !== null) {
      (messages.value[streamingBubbleIdx.value] as BaseMessage).content = event.content
      streamingBubbleIdx.value = null
    } else {
      messages.value.push({ role: 'agent', type: 'text', content: event.content })
    }
  } else if (event.type === 'status') {
    messages.value.push({ type: 'status', content: event.content })
  } else if (event.type === 'error') {
    streamingBubbleIdx.value = null
    messages.value.push({ role: 'agent', type: 'text', content: `Fehler: ${event.content}` })
    isStreaming.value = false
  } else if (event.type === 'screenshot') {
    messages.value.push({ role: 'agent', type: 'screenshot', content: event.content })
  } else if (event.type === 'result') {
    messages.value.push({ type: 'result', content: event.content })
  } else if (event.type === 'question') {
    try {
      const questions = JSON.parse(event.content) as QuestionItem[]
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2)}`
      questionAnswers.value[id] = {}
      messages.value.push({ id, type: 'question', questions, answered: false })
    } catch {
      // fallback: show as text
      messages.value.push({ role: 'agent', type: 'text', content: event.content })
    }
  }
}

async function cancelMessage() {
  try {
    await $fetch(`${config.public.apiBase}/api/sessions/cancel`, {
      method: 'POST',
      body: { sessionId: sessionId.value },
    })
  } finally {
    isStreaming.value = false
  }
}

// Question helpers
function isOptionSelected(msgId: string, question: string, label: string): boolean {
  return questionAnswers.value[msgId]?.[question]?.has(label) ?? false
}

function toggleOption(msgId: string, question: string, label: string, multiSelect: boolean) {
  if (!questionAnswers.value[msgId]) questionAnswers.value[msgId] = {}
  const q = questionAnswers.value[msgId]
  if (!q[question]) q[question] = new Set()

  if (multiSelect) {
    if (q[question].has(label)) {
      q[question].delete(label)
    } else {
      q[question].add(label)
    }
  } else {
    q[question] = new Set([label])
  }
  // Trigger reactivity
  questionAnswers.value = { ...questionAnswers.value }
}

function hasAnswers(msgId: string, questions: QuestionItem[]): boolean {
  const answers = questionAnswers.value[msgId]
  if (!answers) return false
  return questions.every(qi => (answers[qi.question]?.size ?? 0) > 0)
}

async function submitAnswers(msg: QuestionMessage) {
  const rawAnswers = questionAnswers.value[msg.id]
  if (!rawAnswers) return

  // Build answers: question -> comma-joined selected labels
  const answers: Record<string, string> = {}
  for (const [question, labels] of Object.entries(rawAnswers)) {
    answers[question] = [...labels].join(', ')
  }

  msg.answered = true
  try {
    await $fetch(`${config.public.apiBase}/api/sessions/answer`, {
      method: 'POST',
      body: { sessionId: sessionId.value, answers },
    })
  } catch (err) {
    messages.value.push({
      role: 'agent',
      type: 'text',
      content: `Fehler beim Senden der Antwort: ${err instanceof Error ? err.message : String(err)}`,
    })
    msg.answered = false
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
  if (iframeEl.value && previewUrl.value) {
    iframeEl.value.src = previewUrl.value
  }
}
</script>
