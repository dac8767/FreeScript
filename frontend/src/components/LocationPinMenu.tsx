/**
 * LocationPinMenu (v5.77) — the dropdown a map pin opens.
 *
 * Derek's brief, in order:
 *   "when placed, a drop down will appear, and the user can pick which of the
 *    existing locations to add to this pin, or they can create a new location"
 *   "Also in the location drop down is an option to change the name of the
 *    scene in the script"
 *   "in the location drop down, you can assign the location to an already
 *    existing map pin … the drop down should have the display name at the
 *    top, and then a list of all attached script locations below it"
 *
 * So the menu reads top-down as: what this place IS (display name), what the
 * script calls it (every attached location, each removable), then the things
 * you can do — attach another location, create one, rename in the script,
 * merge onto another pin, take the pin off.
 *
 * Portalled to <body> with fixed coordinates: a menu rendered inside the tool
 * panel is clipped by the panel's own overflow no matter its z-index — the
 * lesson AddMenu already paid for.
 */
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaRegTrashAlt, FaLock, FaLockOpen } from 'react-icons/fa';
import { promptDialog } from './ConfirmDialog';
import { placeLabel, type LocationPlace, type ConnectTargets } from '../utils/locationPlaces';

interface Props {
  place: LocationPlace;
  /** Every place, so the menu can offer the OTHER pins to merge onto. */
  places: LocationPlace[];
  /** v5.79: the SAME list the sidebar's "+ Connect to location" offers —
   *  every script location, not just the unplaced ones, so connecting one
   *  that already sits elsewhere ("actually, it's here") works from the pin
   *  too, and the item is never dead while the script has locations. */
  targets: ConnectTargets;
  pos: { top: number; left: number };
  onAttach: (name: string) => void;
  onDetach: (name: string) => void;
  /** Create a location that the script doesn't have — a display name only. */
  onCreate: (displayName: string) => void;
  /** Rewrite a location across every scene heading. */
  onRenameInScript: (from: string, to: string) => void;
  /** Move this pin's script locations onto another pin, and drop this one. */
  onMergeInto: (targetPlaceId: string) => void;
  onUnpin: () => void;
  /** v5.78, Derek: lock the pin's position — same flag the sidebar shows. */
  locked: boolean;
  onToggleLock: () => void;
  onClose: () => void;
}

export default function LocationPinMenu({
  place, places, targets, pos,
  onAttach, onDetach, onCreate, onRenameInScript, onMergeInto, onUnpin, locked, onToggleLock, onClose,
}: Props) {
  const [sub, setSub] = useState<'none' | 'attach' | 'merge' | 'rename'>('none');
  const otherPins = useMemo(
    () => places.filter((p) => p.id !== place.id && p.x !== null),
    [places, place.id],
  );
  const label = placeLabel(place, 'New pin');

  const create = useCallback(async () => {
    const name = await promptDialog('Name for the new location:', '', {
      title: 'New Location', confirmLabel: 'Create',
    });
    if (name && name.trim()) onCreate(name.trim());
    onClose();
  }, [onCreate, onClose]);

  const rename = useCallback(async (from: string) => {
    const to = await promptDialog(
      `Rename "${from}" in every scene heading:`, from,
      { title: 'Rename in Script', confirmLabel: 'Rename' },
    );
    if (to && to.trim() && to.trim().toUpperCase() !== from.toUpperCase()) onRenameInScript(from, to.trim());
    onClose();
  }, [onRenameInScript, onClose]);

  return createPortal(
    <>
      <div className="locmap-menu-veil" onPointerDown={onClose} />
      <div className="locmap-pin-menu" style={{ top: pos.top, left: pos.left }}>
        {/* 1. what this place is called in the Locations window */}
        <div className="locmap-pin-menu-title">{label}</div>

        {/* 2. what the SCRIPT calls it — every attached location */}
        {place.scriptNames.length > 0 ? (
          <div className="locmap-pin-menu-attached">
            {place.scriptNames.map((name) => (
              <div key={name} className="locmap-pin-menu-attached-row">
                <span className="locmap-pin-menu-attached-name" title={name}>{name}</span>
                <button
                  className="locmap-pin-menu-detach"
                  title={`Take ${name} off this pin`}
                  onClick={() => onDetach(name)}
                ><FaRegTrashAlt /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="locmap-pin-menu-empty">No location on this pin yet.</div>
        )}

        <div className="locmap-pin-menu-sep" />

        {/* 3. the actions */}
        {sub === 'none' && (
          <>
            <button
              className="locmap-pin-menu-item"
              disabled={targets.scriptLocations.length === 0}
              title={targets.scriptLocations.length ? undefined : ''}
              onClick={() => setSub('attach')}
            >Connect to location…</button>
            <button className="locmap-pin-menu-item" onClick={() => { void create(); }}>
              Create a new location…
            </button>
            {place.scriptNames.length > 0 && (
              <button className="locmap-pin-menu-item" onClick={() => setSub('rename')}>
                Change the name in the script…
              </button>
            )}
            {otherPins.length > 0 && place.scriptNames.length > 0 && (
              <button className="locmap-pin-menu-item" onClick={() => setSub('merge')}>
                Assign to an existing pin…
              </button>
            )}
            <button className="locmap-pin-menu-item" onClick={() => { onToggleLock(); onClose(); }}>
              {locked ? <><FaLock /> Unlock this pin&rsquo;s position</> : <><FaLockOpen /> Lock this pin&rsquo;s position</>}
            </button>
            <button className="locmap-pin-menu-item locmap-pin-menu-danger" onClick={() => { onUnpin(); onClose(); }}>
              Remove this pin
            </button>
          </>
        )}

        {sub === 'attach' && (
          <div className="locmap-pin-menu-list">
            <div className="locmap-pin-menu-subhead">Script locations</div>
            {targets.scriptLocations.map((loc) => (
              <button
                key={loc.name}
                className="locmap-pin-menu-item"
                title={loc.from ? `Currently on ${loc.from} — this moves it here` : undefined}
                onClick={() => { onAttach(loc.name); onClose(); }}
              >
                <span className="locmap-pin-menu-item-name">{loc.name}</span>
                {loc.from && <span className="locmap-pin-menu-item-from">on {loc.from}</span>}
                <span className="locmap-pin-menu-item-count">{loc.scenes}</span>
              </button>
            ))}
            {targets.groups.length > 0 && (
              <>
                <div className="locmap-pin-menu-sep" />
                <div className="locmap-pin-menu-subhead">Other Groups</div>
                {targets.groups.map((g) => (
                  <button
                    key={g.id}
                    className="locmap-pin-menu-item"
                    title={`Join ${g.label}`}
                    onClick={() => { onMergeInto(g.id); onClose(); }}
                  >
                    <span className="locmap-pin-menu-item-name">{g.label}</span>
                    {g.scriptNames.length > 0 && <span className="locmap-pin-menu-item-count">{g.scriptNames.length}</span>}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {sub === 'rename' && (
          <div className="locmap-pin-menu-list">
            <div className="locmap-pin-menu-subhead">Rename which location?</div>
            {place.scriptNames.map((name) => (
              <button key={name} className="locmap-pin-menu-item" onClick={() => { void rename(name); }}>{name}</button>
            ))}
          </div>
        )}

        {sub === 'merge' && (
          <div className="locmap-pin-menu-list">
            <div className="locmap-pin-menu-subhead">Same place as…</div>
            {otherPins.map((p) => (
              <button
                key={p.id}
                className="locmap-pin-menu-item"
                onClick={() => { onMergeInto(p.id); onClose(); }}
              >{placeLabel(p, 'Unnamed pin')}</button>
            ))}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
