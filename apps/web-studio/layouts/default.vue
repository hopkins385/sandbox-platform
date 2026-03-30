<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 bg-indigo-600 rounded-md flex items-center justify-center">
          <span class="text-white text-xs font-bold">S</span>
        </div>
        <span class="font-semibold text-gray-900">Sandbox Studio</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center">
          <span class="text-indigo-700 text-xs font-semibold">S</span>
        </div>
        <span class="text-sm text-gray-600">Sven</span>
      </div>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>
