import type { CommandContext, GlobalContext } from "@caido/sdk-frontend";
import type { Request } from "shared";

import { createRequestFromSelection } from "@/shared/utils/request";
import type { FrontendSDK } from "@/types";

type Selection<T> =
  | { kind: "Empty" }
  | { kind: "Selected"; main: T; secondary: T[] };

function selectedValues<T>(selection: Selection<T>): T[] {
  return selection.kind === "Selected"
    ? [selection.main, ...selection.secondary]
    : [];
}

export function getGlobalRequestIds(context: GlobalContext): string[] {
  const page = context.page;
  if (page === undefined) {
    return [];
  }

  switch (page.kind) {
    case "HTTPHistory":
      return selectedValues(page.selection);
    case "Sitemap":
      return selectedValues(page.requestSelection);
    case "Automate":
      return selectedValues(page.requestSelection);
    default:
      return [];
  }
}

async function loadRequestsById(
  sdk: FrontendSDK,
  ids: string[],
): Promise<Request[]> {
  const requests: Request[] = [];
  for (const id of ids) {
    const result = await sdk.backend.getRequest(id);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    requests.push(result.value);
  }
  return requests;
}

export async function resolveContextRequests(
  sdk: FrontendSDK,
  context: CommandContext,
): Promise<Request[]> {
  switch (context.type) {
    case "RequestRowContext":
      return loadRequestsById(
        sdk,
        context.requests.map((request) => request.id),
      );
    case "RequestContext":
      return [
        createRequestFromSelection({
          raw: context.request.raw,
          isTls: context.request.isTls,
          host: context.request.host,
          port: context.request.port,
          path: context.request.path,
          query: context.request.query,
        }),
      ];
    case "ResponseContext":
      return loadRequestsById(sdk, [context.request.id]);
    case "BaseContext":
      return loadRequestsById(
        sdk,
        getGlobalRequestIds(sdk.window.getContext()),
      );
  }
}
