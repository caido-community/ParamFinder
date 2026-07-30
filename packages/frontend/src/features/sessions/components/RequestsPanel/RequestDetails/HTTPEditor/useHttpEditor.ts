import type { EditorView } from "@codemirror/view";
import { useEventListener } from "@vueuse/core";
import { onMounted, type Ref, ref, watch } from "vue";

import { usePageEnterCounter } from "@/plugins/lifecycle";
import { useSDK } from "@/plugins/sdk";
import { toCrlf } from "@/shared/utils/request";

export type HttpConnectionInfo = {
  host: string;
  port: number;
  isTls: boolean;
};

export type HttpEditorSource =
  | {
      type: "request";
      raw: string;
      connectionInfo: HttpConnectionInfo;
    }
  | { type: "response"; raw: string };

export function useHttpEditor(
  root: Ref<HTMLElement | undefined>,
  source: Readonly<Ref<HttpEditorSource>>,
) {
  const sdk = useSDK();
  const pageEnterCounter = usePageEnterCounter();

  const contextMenu = ref();
  let editorView: EditorView | undefined;

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

    const currentSource = source.value;
    const editor =
      currentSource.type === "request"
        ? sdk.ui.httpRequestEditor()
        : sdk.ui.httpResponseEditor();
    root.value.appendChild(editor.getElement());
    editorView = editor.getEditorView();
    setContent(currentSource.raw);
  };

  const sendToReplay = () => {
    const currentSource = source.value;
    if (currentSource.type !== "request") {
      return;
    }

    const { host, port, isTls } = currentSource.connectionInfo;
    const current = editorView?.state.doc.toString() ?? currentSource.raw;
    sdk.replay.createSession({
      type: "Raw",
      raw: toCrlf(current),
      connectionInfo: { host, port, isTLS: isTls },
    });
  };

  const menuItems = [
    { label: "Send to Replay", icon: "fas fa-play", command: sendToReplay },
  ];

  const onContextMenu = (event: MouseEvent) => {
    if (source.value.type !== "request") {
      return;
    }

    contextMenu.value?.show(event);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      source.value.type !== "request" ||
      event.key.toLowerCase() !== "r" ||
      (!event.metaKey && !event.ctrlKey) ||
      event.altKey ||
      !event.shiftKey ||
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

  onMounted(initialize);

  watch(() => source.value.raw, setContent);

  watch(pageEnterCounter, () => {
    editorView = undefined;
    setTimeout(() => {
      if (root.value === undefined) {
        return;
      }

      root.value.replaceChildren();
      initialize();
    }, 0);
  });

  return { contextMenu, menuItems, onContextMenu };
}
