import { readonly, ref } from "vue";

const pageEnterCounter = ref(0);

export const triggerPageEnter = () => {
  pageEnterCounter.value += 1;
};

export const usePageEnterCounter = () => readonly(pageEnterCounter);
