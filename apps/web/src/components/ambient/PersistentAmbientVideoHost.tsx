import { AmbientVideoWorkspace } from "./AmbientVideoWorkspace";

/**
 * Stable authenticated-shell owner for the ambient player.
 *
 * Route content, selected projects, selected threads, and Settings render as
 * siblings below this owner. They can change freely without moving or
 * remounting the iframe.
 */
export function PersistentAmbientVideoHost() {
  return (
    <div data-testid="persistent-ambient-video-host">
      <AmbientVideoWorkspace />
    </div>
  );
}
