<script setup lang="ts">
import { computed } from "vue";
import { withBase } from "vitepress";

const props = defineProps<{
  src: string;
  alt: string;
  caption?: string;
  compact?: boolean;
}>();

const resolvedSrc = computed(() => withBase(props.src));
</script>

<template>
  <figure :class="['app-screenshot', { 'app-screenshot--compact': compact }]">
    <img :src="resolvedSrc" :alt="alt" loading="lazy" />
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
