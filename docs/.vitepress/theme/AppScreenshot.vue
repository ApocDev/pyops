<script setup lang="ts">
import { computed, ref } from "vue";
import { withBase } from "vitepress";

const props = defineProps<{
  src: string;
  alt: string;
  caption?: string;
  compact?: boolean;
}>();

const resolvedSrc = computed(() => withBase(props.src));
const dialog = ref<HTMLDialogElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

const open = () => dialog.value?.showModal();
const close = () => dialog.value?.close();
const closeFromBackdrop = (event: MouseEvent) => {
  if (event.target === event.currentTarget) close();
};
const restoreFocus = () => trigger.value?.focus();
</script>

<template>
  <figure :class="['app-screenshot', { 'app-screenshot--compact': compact }]">
    <button
      ref="trigger"
      type="button"
      class="app-screenshot__trigger"
      aria-haspopup="dialog"
      :aria-label="`Expand image: ${alt}`"
      @click="open"
    >
      <img :src="resolvedSrc" :alt="alt" loading="lazy" />
      <span class="app-screenshot__expand" aria-hidden="true">↗</span>
    </button>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>

  <Teleport to="body">
    <dialog
      ref="dialog"
      class="app-screenshot-lightbox"
      :aria-label="`Expanded image: ${alt}`"
      @click="closeFromBackdrop"
      @close="restoreFocus"
    >
      <div class="app-screenshot-lightbox__panel">
        <button
          type="button"
          class="app-screenshot-lightbox__close"
          aria-label="Close expanded image"
          @click="close"
        >
          ×
        </button>
        <img :src="resolvedSrc" :alt="alt" />
        <p v-if="caption">{{ caption }}</p>
      </div>
    </dialog>
  </Teleport>
</template>
