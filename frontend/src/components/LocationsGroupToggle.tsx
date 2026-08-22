/**
 * LocationsGroupToggle — the Ungrouped / Grouped pair (v6.04, Derek: "move
 * 'Group' out of the header. Make it a toggle button on the first row of the
 * location window body. Make it a toggle between 'Ungrouped' and 'Grouped'.
 * Add these same buttons to the top of the map view").
 *
 * One component, two homes — the List view's action row and the Map view's
 * action bar — driving the ONE store flag both views obey: the list folds
 * under group headings, the map's location list merges connected locations
 * into one row per place (ungrouped, every script location stands alone).
 *
 * Its own file because both SceneNavigator and LocationMapTab render it, and
 * SceneNavigator imports LocationMapTab — a shared child avoids the cycle.
 */
import { useEditorStore } from '../stores/editorStore';

export default function LocationsGroupToggle() {
  const grouped = useEditorStore((s) => s.locationsGrouped);
  const setGrouped = useEditorStore((s) => s.setLocationsGrouped);
  return (
    <span className="loc-group-toggle" role="group" aria-label="Group locations">
      <button
        className={`locmap-tool-btn${grouped ? '' : ' loc-group-on'}`}
        aria-pressed={!grouped}
        title="Every location on its own row"
        onClick={() => setGrouped(false)}
      >Ungrouped</button>
      <button
        className={`locmap-tool-btn${grouped ? ' loc-group-on' : ''}`}
        aria-pressed={grouped}
        onClick={() => setGrouped(true)}
      >Grouped</button>
    </span>
  );
}
