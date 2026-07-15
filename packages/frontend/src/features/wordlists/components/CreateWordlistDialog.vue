<script setup lang="ts">
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import { computed, ref, watch } from "vue";

import { useWordlistsStore } from "../stores/store";

import { useActionResult } from "@/shared/composables/useActionResult";

const { visible } = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "created"): void;
}>();

const wordlistsStore = useWordlistsStore();
const { mutating } = storeToRefs(wordlistsStore);
const { showResult } = useActionResult();

const filename = ref("custom-params.txt");
const content = ref("");
const submitting = ref(false);

const canSubmit = computed(
  () => filename.value.trim().length > 0 && content.value.trim().length > 0,
);

watch(
  () => visible,
  (next) => {
    if (next) {
      filename.value = "custom-params.txt";
      content.value = "";
    }
  },
);

const close = () => {
  emit("update:visible", false);
};

const submit = async () => {
  if (!canSubmit.value) {
    return;
  }

  submitting.value = true;
  try {
    const result = await wordlistsStore.importText(
      filename.value.trim(),
      content.value,
    );
    if (
      showResult(result, {
        errorPrefix: "Failed to create wordlist",
      })
    ) {
      emit("created");
    }
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Create Wordlist"
    :style="{ width: '600px', maxWidth: '90vw' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="space-y-3">
      <div>
        <label class="text-sm font-medium block mb-1">Filename</label>
        <InputText
          v-model="filename"
          class="w-full text-sm"
          placeholder="custom-params.txt"
        />
      </div>
      <div>
        <label class="text-sm font-medium block mb-1">Parameters</label>
        <p class="text-xs text-surface-400 mb-2">One parameter per line.</p>
        <Textarea
          v-model="content"
          rows="12"
          class="w-full text-xs"
          placeholder="id&#10;user&#10;token"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button label="Cancel" severity="secondary" outlined @click="close" />
        <Button
          label="Create"
          :disabled="!canSubmit || mutating"
          :loading="submitting"
          @click="submit"
        />
      </div>
    </template>
  </Dialog>
</template>
