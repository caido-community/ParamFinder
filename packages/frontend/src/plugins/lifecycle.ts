import { ref } from "vue";

const pageEnterCounter = ref(0);

export const usePageLifecycle = () => {
  const triggerPageEnter = () => {
    pageEnterCounter.value++;
  };

  const getPageEnterCounter = () => pageEnterCounter;

  return {
    triggerPageEnter,
    getPageEnterCounter,
  };
};
