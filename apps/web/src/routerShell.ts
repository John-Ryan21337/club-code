import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PersistentAmbientVideoHost } from "./components/ambient/PersistentAmbientVideoHost";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";

/**
 * Owns renderer services whose lifetime must outlast every route surface.
 *
 * In particular, keeping the ambient player above the router's root route
 * preserves its iframe across auth-gate refreshes, pairing navigation, and
 * route error/reset cycles.
 */
export function createRouterShell(queryClient: QueryClient) {
  return function RouterShell({ children }: React.PropsWithChildren) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        AppAtomRegistryProvider,
        undefined,
        createElement(PersistentAmbientVideoHost),
        children,
      ),
    );
  };
}
