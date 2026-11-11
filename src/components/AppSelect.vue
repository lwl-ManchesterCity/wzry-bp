<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

type SelectValue = string | number

interface SelectOption {
  value: SelectValue
  label: string
  hint?: string
}

const props = defineProps<{
  label: string
  value: SelectValue
  options: SelectOption[]
  width?: 'compact' | 'wide'
}>()

const emit = defineEmits<{
  change: [value: SelectValue]
}>()

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const selected = computed(() => props.options.find((option) => option.value === props.value) ?? props.options[0])

function choose(value: SelectValue) {
  emit('change', value)
  open.value = false
}

function closeOnOutside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside)
  document.addEventListener('keydown', closeOnEscape)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', closeOnOutside)
  document.removeEventListener('keydown', closeOnEscape)
})
</script>

<template>
  <div ref="root" class="app-select" :class="[width, { open }]">
    <span class="app-select-label">{{ label }}</span>
    <button
      class="app-select-trigger"
      type="button"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open = !open"
    >
      <b>{{ selected?.label }}</b>
      <ChevronDown :size="14" />
    </button>
    <Transition name="select-pop">
      <div v-if="open" class="app-select-menu" role="listbox">
        <button
          v-for="option in options"
          :key="String(option.value)"
          type="button"
          role="option"
          :aria-selected="option.value === value"
          :class="{ selected: option.value === value }"
          @click="choose(option.value)"
        >
          <span><b>{{ option.label }}</b><small v-if="option.hint">{{ option.hint }}</small></span>
          <Check v-if="option.value === value" :size="14" />
        </button>
      </div>
    </Transition>
  </div>
</template>
