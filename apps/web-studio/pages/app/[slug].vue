<script setup lang="ts">
import { useElementSize, useThrottleFn } from '@vueuse/core'
import { io, type Socket } from 'socket.io-client'
import { marked } from 'marked'
import type { App, AppListResponse, QuestionItem, SendMessageResponse } from '@sandbox/types'

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string
}

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
const socketConnected = ref(false)
const workerConnected = ref(false)
const messagesEl = ref<HTMLElement>()
const iframeEl = ref<HTMLIFrameElement>()
const streamingBubbleIdx = ref<number | null>(null)

// Per-question answers: msgId -> question -> Set<label>
const questionAnswers = ref<Record<string, Record<string, Set<string>>>>({})

// Token smoothening (optional) — set to true to fake word-by-word streaming
const smootheningEnabled = ref(false)
const smoother = useTokenSmoothening({ wordsPerSecond: 30 })

let socket: Socket | null = null

function connectSocket(sid: string) {
  socket = io(config.public.apiBase, {
    transports: ['websocket'],
    auth: { role: 'browser', sessionId: sid },
  })

  socket.on('connect', () => { socketConnected.value = true })
  socket.on('disconnect', () => {
    socketConnected.value = false
    workerConnected.value = false
    isStreaming.value = false
  })
  socket.on('connect_error', () => { socketConnected.value = false })

  socket.onAny((type: string, content: string) => {
    const evt = { type, content: content ?? '' } as SendMessageResponse
    handleWsEvent(evt)
    if (type === 'text_delta') throttledScrollToBottom()
    else scrollToBottom()
  })
}

onUnmounted(() => { socket?.disconnect() })

// Open session on mount
onMounted(async () => {
  try {
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
      currentApp.value = app
      await new Promise(r => setTimeout(r, 2000))
    }

    if (app!.status !== 'running') {
      sessionError.value = 'Container-Start hat zu lange gedauert.'
      return
    }

    const session = await $fetch<{ sessionId: string; app: App; previewUrl: string }>(
      `${config.public.apiBase}/api/sessions/open`,
      { method: 'POST', body: { appId: app!.id } }
    )
    sessionId.value = session.sessionId
    currentApp.value = session.app
    previewUrl.value = session.previewUrl

    connectSocket(session.sessionId)
  } catch (err) {
    sessionError.value = `Sitzung konnte nicht geöffnet werden: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    sessionLoading.value = false
  }
})

function sendMessage() {
  const text = inputText.value.trim()
  if (!text || isStreaming.value || !socketConnected.value) return

  inputText.value = ''
  messages.value.push({ role: 'user', type: 'text', content: text })
  isStreaming.value = true
  scrollToBottom()

  socket?.emit('send', text)
}

function handleWsEvent(event: SendMessageResponse) {
  const { type } = event
  switch (type) {
    case 'done':
      if (smootheningEnabled.value && streamingBubbleIdx.value !== null) {
        smoother.flush()
          ; (messages.value[streamingBubbleIdx.value] as BaseMessage).content = smoother.displayedText.value
      }
      streamingBubbleIdx.value = null
      isStreaming.value = false
      reloadPreview()
      break
    case 'text_delta':
      if (streamingBubbleIdx.value !== null) {
        if (smootheningEnabled.value) {
          smoother.feed(event.content)
        } else {
          (messages.value[streamingBubbleIdx.value] as BaseMessage).content += event.content
        }
      } else {
        smoother.reset()
        messages.value.push({ role: 'agent', type: 'text', content: smootheningEnabled.value ? '' : event.content })
        streamingBubbleIdx.value = messages.value.length - 1
        if (smootheningEnabled.value) smoother.feed(event.content)
      }
      break
    case 'text':
      if (smootheningEnabled.value && streamingBubbleIdx.value !== null) {
        smoother.flush()
      }
      if (streamingBubbleIdx.value !== null) {
        (messages.value[streamingBubbleIdx.value] as BaseMessage).content = event.content
        streamingBubbleIdx.value = null
      } else {
        messages.value.push({ role: 'agent', type: 'text', content: event.content })
      }
      break
    case 'status':
      messages.value.push({ type: 'status', content: event.content })
      break
    case 'error':
      streamingBubbleIdx.value = null
      messages.value.push({ role: 'agent', type: 'text', content: `Fehler: ${event.content}` })
      isStreaming.value = false
      break
    case 'screenshot':
      messages.value.push({ role: 'agent', type: 'screenshot', content: event.content })
      break
    case 'result':
      messages.value.push({ type: 'result', content: event.content })
      break
    case 'worker_connected':
      workerConnected.value = true
      break
    case 'pong':
      workerConnected.value = true
      break
    case 'worker_disconnected':
      workerConnected.value = false
      isStreaming.value = false
      break
    case 'question':
      try {
        const questions = JSON.parse(event.content) as QuestionItem[]
        const id = `q-${Date.now()}-${Math.random().toString(36).slice(2)}`
        questionAnswers.value[id] = {}
        messages.value.push({ id, type: 'question', questions, answered: false })
      } catch {
        messages.value.push({ role: 'agent', type: 'text', content: event.content })
      }
      break
  }
}

function cancelMessage() {
  socket?.emit('cancel')
  isStreaming.value = false
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

  const answers: Record<string, string> = {}
  for (const [question, labels] of Object.entries(rawAnswers)) {
    answers[question] = [...labels].join(', ')
  }

  msg.answered = true
  socket?.emit('answer', answers)
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
}

const throttledScrollToBottom = useThrottleFn(scrollToBottom, 80)

function reloadPreview() {
  if (iframeEl.value && previewUrl.value) {
    iframeEl.value.src = previewUrl.value
  }
}

// Resizable split
const splitContainerEl = ref<HTMLElement>()
const chatWidthPct = ref(40)
const isDragging = ref(false)

function onDividerPointerDown(e: PointerEvent) {
  isDragging.value = true
    ; (e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onDividerPointerMove(e: PointerEvent) {
  if (!isDragging.value || !splitContainerEl.value) return
  const rect = splitContainerEl.value.getBoundingClientRect()
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  chatWidthPct.value = Math.min(Math.max(pct, 20), 80)
}

function onDividerPointerUp() {
  isDragging.value = false
}

// Preview viewport & zoom
type ViewportMode = 'desktop' | 'mobile'
const viewportMode = ref<ViewportMode>('desktop')
const VIEWPORT_WIDTHS: Record<ViewportMode, number> = { desktop: 1440, mobile: 375 }

const previewContainerEl = ref<HTMLElement>()
const { width: containerWidth, height: containerHeight } = useElementSize(previewContainerEl)

const zoomLevel = ref(1)
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.1
const ZOOM_MAX = 2

const viewportWidth = computed(() => VIEWPORT_WIDTHS[viewportMode.value])

// Fit zoom: scale the viewport width to fill the container
function fitZoom() {
  if (containerWidth.value > 0)
    zoomLevel.value = Math.round((containerWidth.value / viewportWidth.value) * 100) / 100
}

watch(containerWidth, (w) => {
  if (w > 0 && zoomLevel.value === 1) fitZoom()
}, { once: true })

function setViewport(mode: ViewportMode) {
  viewportMode.value = mode
  nextTick(fitZoom)
}

function zoomIn() {
  zoomLevel.value = Math.min(+(zoomLevel.value + ZOOM_STEP).toFixed(2), ZOOM_MAX)
}
function zoomOut() {
  zoomLevel.value = Math.max(+(zoomLevel.value - ZOOM_STEP).toFixed(2), ZOOM_MIN)
}
function resetZoom() {
  fitZoom()
}

// Iframe content area dimensions (before scale)
const iframeWidth = computed(() => viewportWidth.value)
const iframeHeight = computed(() => Math.round(containerHeight.value / zoomLevel.value))

</script>

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
    <div v-else ref="splitContainerEl" class="flex flex-1 overflow-hidden" :class="{ 'select-none': isDragging }"
      @pointermove="onDividerPointerMove" @pointerup="onDividerPointerUp">
      <!-- Chat Panel -->
      <div class="flex flex-col border-r border-gray-200 bg-white overflow-hidden"
        :style="{ width: chatWidthPct + '%' }">
        <!-- Status bar -->
        <div class="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
          <div>Online:</div>
          <!-- Browser ↔ orchestrator -->
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full flex-shrink-0" :class="{
              'bg-emerald-500': socketConnected,
              'bg-amber-400 animate-pulse': !socketConnected && sessionId,
              'bg-red-400': !socketConnected && !sessionId,
            }" />
            <span v-if="socketConnected">Me</span>
            <span v-else-if="sessionId">Me Connecting…</span>
            <span v-else>Me Disconnected</span>
          </span>
          <span class="text-gray-200">|</span>
          <!-- Worker -->
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full flex-shrink-0" :class="{
              'bg-emerald-500': workerConnected,
              'bg-amber-400 animate-pulse': socketConnected && !workerConnected,
              'bg-red-400': !socketConnected && !workerConnected,
            }" />
            <span v-if="workerConnected">AI Agent</span>
            <span v-else-if="socketConnected">AI Agent connecting…</span>
            <span v-else>AI Agent offline</span>
          </span>
          <!-- Smoothing toggle -->
          <button class="ml-auto flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors"
            :class="smootheningEnabled ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400 hover:text-gray-600'"
            :title="smootheningEnabled ? 'Smoothing on' : 'Smoothing off'"
            @click="smootheningEnabled = !smootheningEnabled">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Smooth
          </button>
        </div>

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
            <div v-else-if="msg.type !== 'question' && (msg as BaseMessage).role === 'user'" class="flex justify-end">
              <div class="max-w-[75%] bg-indigo-600 text-white text-sm rounded-2xl rounded-tr-sm px-4 py-2.5">
                {{ (msg as BaseMessage).content }}
              </div>
            </div>

            <!-- Agent text message -->
            <div v-else-if="msg.type === 'text'" class="flex justify-start">
              <div v-if="i === streamingBubbleIdx"
                class="max-w-[75%] bg-gray-100 text-gray-800 text-sm rounded-2xl rounded-tl-sm px-4 py-2.5 whitespace-pre-wrap">
                {{ smootheningEnabled ? smoother.displayedText : (msg as BaseMessage).content }}</div>
              <div v-else
                class="bg-gray-100 text-gray-800 text-sm rounded-2xl rounded-tl-sm px-4 py-2.5 prose prose-sm prose-gray !max-w-[75%]"
                v-dompurify-html="renderMarkdown((msg as BaseMessage).content)" />
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
                    <p v-if="qi.header" class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{{
                      qi.header }}</p>
                    <p class="text-sm font-medium text-gray-800 mb-2">{{ qi.question }}</p>
                    <div class="space-y-1.5">
                      <label v-for="opt in qi.options" :key="opt.label"
                        class="flex items-start gap-2.5 p-2.5 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer transition-colors"
                        :class="{ 'border-indigo-400 bg-indigo-50': isOptionSelected(msg.id, qi.question, opt.label) }">
                        <input v-if="qi.multiSelect" type="checkbox"
                          :checked="isOptionSelected(msg.id, qi.question, opt.label)" class="mt-0.5 accent-indigo-600"
                          :disabled="msg.answered"
                          @change="toggleOption(msg.id, qi.question, opt.label, qi.multiSelect)" />
                        <input v-else type="radio" :name="`q-${msg.id}-${qi_i}`"
                          :checked="isOptionSelected(msg.id, qi.question, opt.label)" class="mt-0.5 accent-indigo-600"
                          :disabled="msg.answered"
                          @change="toggleOption(msg.id, qi.question, opt.label, qi.multiSelect)" />
                        <div>
                          <span class="text-sm font-medium text-gray-800">{{ opt.label }}</span>
                          <p v-if="opt.description" class="text-xs text-gray-500 mt-0.5">{{ opt.description }}</p>
                        </div>
                      </label>
                    </div>
                  </div>
                </template>

                <button v-if="!msg.answered"
                  class="mt-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  :disabled="!hasAnswers(msg.id, msg.questions)" @click="submitAnswers(msg)">
                  Antworten
                </button>
                <p v-else class="text-xs text-gray-400 italic">Beantwortet</p>
              </div>
            </div>
          </template>

          <!-- Typing indicator -->
          <div v-if="isStreaming && streamingBubbleIdx === null" class="flex justify-start">
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
            <div class="flex flex-col gap-2 self-end">
              <button v-if="isStreaming"
                class="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-xl hover:bg-red-600 transition-colors"
                @click="cancelMessage">
                Abbrechen
              </button>
              <button
                class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                :disabled="!inputText.trim() || isStreaming" @click="sendMessage">
                Senden
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Drag Handle -->
      <div
        class="w-1 flex-shrink-0 bg-gray-200 hover:bg-indigo-400 cursor-col-resize transition-colors active:bg-indigo-500"
        @pointerdown="onDividerPointerDown" />

      <!-- Preview Panel -->
      <div class="flex flex-col bg-gray-50 overflow-hidden" :style="{ flex: 1 }">
        <div class="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white">
          <!-- Viewport toggle -->
          <div class="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5 mr-1">
            <button class="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors"
              :class="viewportMode === 'desktop' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
              @click="setViewport('desktop')" title="Desktop (1440px)">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="2" y="4" width="20" height="14" rx="2" stroke-width="2" />
                <path d="M8 20h8M12 18v2" stroke-width="2" stroke-linecap="round" />
              </svg>
              1440
            </button>
            <button class="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors"
              :class="viewportMode === 'mobile' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
              @click="setViewport('mobile')" title="Mobile (375px)">
              <svg class="w-3 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="5" y="2" width="14" height="20" rx="3" stroke-width="2" />
                <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
              </svg>
              375
            </button>
          </div>

          <span class="text-xs text-gray-500 font-mono flex-1 truncate">{{ previewUrl }}</span>

          <!-- Zoom controls -->
          <div class="flex items-center gap-1">
            <button
              class="text-xs text-gray-500 hover:text-gray-700 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 transition-colors disabled:opacity-30"
              :disabled="zoomLevel <= ZOOM_MIN" @click="zoomOut">−</button>
            <button
              class="text-xs text-gray-500 hover:text-gray-700 w-14 text-center font-mono rounded hover:bg-gray-100 transition-colors py-0.5"
              title="Reset to fit" @click="resetZoom">{{ Math.round(zoomLevel * 100) }}%</button>
            <button
              class="text-xs text-gray-500 hover:text-gray-700 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 transition-colors disabled:opacity-30"
              :disabled="zoomLevel >= ZOOM_MAX" @click="zoomIn">+</button>
          </div>

          <button
            class="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            @click="reloadPreview">
            ↺ Reload
          </button>
        </div>
        <div ref="previewContainerEl" class="flex-1 overflow-hidden relative bg-gray-100">
          <iframe ref="iframeEl" :src="previewUrl" :style="{
            width: iframeWidth + 'px',
            height: iframeHeight + 'px',
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
            border: 'none',
          }" title="App Preview" />
        </div>
      </div>
    </div>
  </div>
</template>
