import { useConfirm as usePrimeConfirm } from "primevue/useconfirm";

type RequireOptions = {
  message: string;
  header: string;
  accept?: () => void | Promise<void>;
  acceptLabel?: string;
  reject?: () => void | Promise<void>;
  rejectLabel?: string;
};

export const useConfirm = () => {
  const confirm = usePrimeConfirm();

  const require = (options: RequireOptions) => {
    confirm.require({
      ...options,
      acceptProps: {
        severity: "danger",
        label: options.acceptLabel,
      },
      rejectProps: {
        severity: "secondary",
        outlined: true,
        label: options.rejectLabel ?? "Cancel",
      },
    });
  };

  return {
    ...confirm,
    require,
  };
};
