import { type EditorView } from "@codemirror/view";
import { useEventListener } from "@vueuse/core";
import { onMounted, type Ref, ref, watch } from "vue";

import { usePageLifecycle } from "@/plugins/lifecycle";
import { useSDK } from "@/plugins/sdk";
import { toCrlf } from "@/shared/utils/request";

export type HttpEditorType = "request" | "response";

export type HttpEditorSource = {
  type: HttpEditorType;
  raw: () => string;
  host: () => string | undefined;
  port: () => number | undefined;
  isTls: () => boolean | undefined;
};

export function useHttpEditor(
  root: Ref<HTMLElement | undefined>,
  source: HttpEditorSource,
) {
  const sdk = useSDK();
  const lifecycle = usePageLifecycle();

  const contextMenu = ref();
  let editorView: EditorView | undefined = undefined;

  const setContent = (content: string) => {
    if (editorView === undefined) {
      return;
    }

    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: content },
    });
  };

  const initialize = () => {
    if (root.value === undefined) {
      return;
    }

    const editor =
      source.type === "request"
        ? sdk.ui.httpRequestEditor()
        : sdk.ui.httpResponseEditor();
    root.value.appendChild(editor.getElement());
    editorView = editor.getEditorView();
    setContent(source.raw());
  };

  const sendToReplay = () => {
    const host = source.host();
    const port = source.port();
    const isTls = source.isTls();
    if (
      source.type !== "request" ||
      host === undefined ||
      port === undefined ||
      isTls === undefined
    ) {
      return;
    }

    const current = editorView?.state.doc.toString() ?? source.raw();
    sdk.replay.createSession({
      type: "Raw",
      raw: toCrlf(current),
      connectionInfo: { host, port, isTLS: isTls },
    });
    sdk.window.showToast("Sent to Replay", { variant: "success" });
  };

  const menuItems = [
    { label: "Send to Replay", icon: "fas fa-play", command: sendToReplay },
  ];

  const onContextMenu = (event: MouseEvent) => {
    if (source.type !== "request") {
      return;
    }

    contextMenu.value?.show(event);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      source.type !== "request" ||
      event.key.toLowerCase() !== "r" ||
      (!event.metaKey && !event.ctrlKey) ||
      event.altKey ||
      event.shiftKey ||
      event.repeat ||
      root.value === undefined ||
      document.activeElement === null ||
      !root.value.contains(document.activeElement)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    sendToReplay();
  };

  useEventListener(document, "keydown", onKeyDown, { capture: true });

  onMounted(() => {
    initialize();
  });

  watch(source.raw, (next) => {
    setContent(next);
  });

  watch(lifecycle.getPageEnterCounter(), () => {
    editorView = undefined;
    setTimeout(() => {
      if (root.value === undefined) {
        return;
      }

      Array.from(root.value.children).forEach((child) => {
        child.remove();
      });
      initialize();
    }, 0);
  });

  return { contextMenu, menuItems, onContextMenu };
}
