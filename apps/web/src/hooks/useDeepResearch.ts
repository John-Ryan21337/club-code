import { useCallback, useEffect, useState } from "react";

export function useDeepResearch(scopeKey: string) {
  const [state, setState] = useState({ scopeKey, enabled: false });
  useEffect(() => {
    setState({ scopeKey, enabled: false });
  }, [scopeKey]);
  const setEnabled = useCallback((enabled: boolean) => setState({ scopeKey, enabled }), [scopeKey]);
  return [state.scopeKey === scopeKey && state.enabled, setEnabled] as const;
}
