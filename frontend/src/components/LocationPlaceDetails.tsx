/**
 * LocationPlaceDetails — everything a place KNOWS, in one block (v5.96).
 *
 * Derek: "the information that is currently in the side bar of the
 * location > map view should be moved to the location side panel." This is
 * that information — display name, the script locations connected to the
 * place, description, custom fields — extracted from the Map view's sidebar
 * so the Locations panel (the list, docked or fullscreen) is its one home.
 * The map keeps pins and options; the panel keeps knowledge.
 *
 * The display name "overrides what the location name looks like in the
 * location window. it does not change anything in the script" — so the
 * script's own names are always listed beneath it, and the two never blur.
 *
 * A row needs a place before it can hold any of this; one is made on demand
 * (unpinned — x/y null), so an untouched location costs nothing in the file.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaTimes, FaRegTrashAlt, FaLink } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { usePopup } from '../hooks/usePopup';
import { promptWithCheckbox } from './ConfirmDialog';
import { connectTargets, type LocationPlace } from '../utils/locationPlaces';

interface Props {
  /** The visible (filtered/sorted) locations — what the connect menu offers. */
  locations: Array<{ name: string; sceneIndices: number[] }>;
  /** EVERY script location — "apply to all locations" means all of them,
   *  not just the ones the current filter lets through. */
  allLocations?: Array<{ name: string; sceneIndices: number[] }>;
  /** The script locations this row stands for (one, unless it is a group). */
  scriptNames: string[];
  /** The row's place, if it already has one. */
  place?: LocationPlace;
  /** v6.01, Derek: extra buttons for the leading actions row — the Map rail
   *  passes its Map and Pin buttons so all three share ONE row, built here.
   *  The row always ends with Group (the old "+ Connect to location"). */
  actions?: React.ReactNode;
  /** v6.38: the Map rail replaces the whole row with its header ⋮ menu. */
  hideActionsRow?: boolean;
}

export const LocationPlaceDetails: React.FC<Props> = ({ locations, scriptNames, place, allLocations = locations, actions, hideActionsRow }) => {
  /* The details are the PLACE's, not the row's: a place holding two script
     locations shows both, whichever of its rows was expanded — otherwise a
     shared place under-reports its own membership. */
  const names = place && place.scriptNames.length ? place.scriptNames : scriptNames;
  const places = useEditorStore((s) => s.locationPlaces);
  const addPin = useEditorStore((s) => s.addLocationPin);
  const updatePlace = useEditorStore((s) => s.updateLocationPlace);
  const attachLocation = useEditorStore((s) => s.attachLocationToPlace);
  const detachLocation = useEditorStore((s) => s.detachLocationFromPlace);
  const mergePlaces = useEditorStore((s) => s.mergeLocationPlaces);
  const addField = useEditorStore((s) => s.addLocationPlaceField);
  const setField = useEditorStore((s) => s.setLocationPlaceField);
  const removeField = useEditorStore((s) => s.removeLocationPlaceField);

  /** The place's id, created on demand — see the header comment. */
  const placeFor = useCallback((): string | null => {
    if (place) return place.id;
    if (scriptNames.length === 0) return null;
    const id = addPin(0, 0);
    updatePlace(id, { x: null, y: null });
    scriptNames.forEach((n) => attachLocation(id, n));
    return id;
  }, [place, scriptNames, addPin, updatePlace, attachLocation]);

  const connect = usePopup({ width: 230 });
  const targets = useMemo(
    () => connectTargets(locations, places, place?.id ?? null),
    [locations, places, place],
  );

  /* v5.97, Derek: same as the character custom field — the name and the
     scope are ONE question. Applied to all, every location gets the field:
     places are created on demand for locations that never had one, and a
     place holding several locations gets it ONCE. */
  const addCustomField = useCallback(async () => {
    const res = await promptWithCheckbox('New field name:', '', {
      title: 'New Custom Field',
      confirmLabel: 'Add',
      checkboxLabel: 'Apply to all locations?',
    });
    if (!res || !res.value.trim()) return;
    const label = res.value.trim();
    if (!res.checked) {
      const id = placeFor();
      if (id) addField(id, label);
      return;
    }
    const st = useEditorStore.getState();
    const seen = new Set<string>();
    for (const l of allLocations) {
      let p = st.locationPlaces.find((q) => q.scriptNames.some((n) => n.trim().toUpperCase() === l.name.trim().toUpperCase()));
      if (!p) {
        const id = st.addLocationPin(0, 0);
        st.updateLocationPlace(id, { x: null, y: null });
        st.attachLocationToPlace(id, l.name);
        p = st.locationPlaces.find((q) => q.id === id);
      }
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        if (!p.fields.some((f) => f.label.trim().toUpperCase() === label.toUpperCase())) st.addLocationPlaceField(p.id, label);
      }
    }
  }, [placeFor, addField, allLocations]);

  /* v5.97, Derek: "you either create a group or attach a location to a
     group" — the free-text field only appears once a group EXISTS (typing a
     name into thin air was the old display-name model). */
  const [creatingGroup, setCreatingGroup] = useState(false);
  const groupMenu = usePopup({ width: 230 });
  const namedGroups = useMemo(
    () => places.filter((p) => p.id !== place?.id && p.displayName.trim()),
    [places, place],
  );
  const inGroup = !!place?.displayName.trim();

  return (
    <div className="locplace-details">
      {/* v6.01, Derek: "move the Connect to location button to the same row
          as map options and pin options. change the name to Group." One row,
          composed here so both homes (List dropdown, Map rail) get it.
          v6.38, Derek: the Map rail hides this row entirely — its options
          live in the row header's ⋮ menu now (hideActionsRow). */}
      {!hideActionsRow && (
        <div className="locmap-detail-actions">
          {actions}
          <button
            ref={(el) => { connect.triggerRef.current = el; }}
            className="locmap-tool-btn"
            title="Connect this location to others. Connected locations form a group"
            onClick={() => connect.toggle()}
          ><FaLink /> Group</button>
        </div>
      )}
      <label className="locmap-field-label">Location Group</label>
      {inGroup && place ? (
        <div className="locplace-group-row">
          <input
            className="locmap-field-input"
            title="Rename this group"
            value={place.displayName}
            onChange={(e) => updatePlace(place.id, { displayName: e.target.value })}
          />
          <button
            className="locmap-add-field"
            title="Delete group name. The locations stay connected"
            onClick={() => updatePlace(place.id, { displayName: '' })}
          >Ungroup</button>
        </div>
      ) : creatingGroup ? (
        <input
          autoFocus
          className="locmap-field-input"
          placeholder="Group name"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setCreatingGroup(false);
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value.trim();
              const id = placeFor();
              if (v && id) updatePlace(id, { displayName: v });
              setCreatingGroup(false);
            }
          }}
          onBlur={(e) => {
            const v = e.target.value.trim();
            const id = v ? placeFor() : null;
            if (v && id) updatePlace(id, { displayName: v });
            setCreatingGroup(false);
          }}
        />
      ) : (
        <div className="locplace-group-row">
          <button className="locmap-add-field" onClick={() => setCreatingGroup(true)}>+ Create a group</button>
          <button
            ref={(el) => { groupMenu.triggerRef.current = el; }}
            className="locmap-add-field"
            disabled={namedGroups.length === 0}
            title={namedGroups.length ? 'Join an existing group' : 'No groups yet'}
            onClick={() => groupMenu.toggle()}
          >+ Add to group</button>
        </div>
      )}
      {groupMenu.pos && createPortal(
        <div
          ref={(el) => { groupMenu.popupRef.current = el; }}
          className="locmap-pin-menu"
          style={{ top: groupMenu.pos.top, left: groupMenu.pos.left }}
        >
          <div className="locmap-pin-menu-subhead">Add to which group?</div>
          {namedGroups.map((g) => (
            <button
              key={g.id}
              className="locmap-pin-menu-item"
              onClick={() => {
                const id = placeFor();
                if (id) mergePlaces(id, g.id);
                groupMenu.close();
              }}
            >
              <span className="locmap-pin-menu-item-name">{g.displayName}</span>
              {g.scriptNames.length > 0 && <span className="locmap-pin-menu-item-count">{g.scriptNames.length}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}

      <label className="locmap-field-label">Script Locations</label>
      <div className="locmap-attached-list">
        {names.length === 0 && (
          <div className="locmap-field-note">Not in the script — this place is yours alone.</div>
        )}
        {names.map((name) => (
          <div key={name} className="locmap-attached-row">
            <span className="locmap-attached-name" title={name}>{name}</span>
            {names.length > 1 && (
              <button
                className="locmap-attached-remove"
                title={`Disconnect ${name} from this place`}
                onClick={() => detachLocation(name)}
              ><FaTimes /></button>
            )}
          </div>
        ))}
      </div>
      {connect.pos && createPortal(
        <div
          ref={(el) => { connect.popupRef.current = el; }}
          className="locmap-pin-menu"
          style={{ top: connect.pos.top, left: connect.pos.left }}
        >
          <div className="locmap-pin-menu-subhead">Script locations</div>
          {targets.scriptLocations.length === 0 && (
            <div className="locmap-pin-menu-empty">Every location is already here.</div>
          )}
          {targets.scriptLocations.map((loc) => (
            <button
              key={loc.name}
              className="locmap-pin-menu-item"
              title={loc.from ? `Currently on ${loc.from} — this moves it here` : undefined}
              onClick={() => {
                const id = placeFor();
                if (id) attachLocation(id, loc.name);
                connect.close();
              }}
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
                  onClick={() => {
                    const id = placeFor();
                    if (id) mergePlaces(id, g.id);
                    connect.close();
                  }}
                >
                  <span className="locmap-pin-menu-item-name">{g.label}</span>
                  {g.scriptNames.length > 0 && (
                    <span className="locmap-pin-menu-item-count">{g.scriptNames.length}</span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>,
        document.body,
      )}

      <label className="locmap-field-label">Description</label>
      <textarea
        className="locmap-field-input locmap-field-textarea"
        rows={3}
        value={place?.description ?? ''}
        onChange={(e) => {
          const id = placeFor();
          if (id) updatePlace(id, { description: e.target.value });
        }}
      />

      {place?.fields.map((f) => (
        <div key={f.id} className="locmap-custom-field">
          <div className="locmap-custom-label-row">
            <input
              className="locmap-field-label locmap-custom-label"
              value={f.label}
              title="Rename this field"
              onChange={(e) => setField(place.id, f.id, { label: e.target.value })}
            />
            <button
              className="locmap-custom-remove" title="Remove this field"
              onClick={() => removeField(place.id, f.id)}
            ><FaRegTrashAlt /></button>
          </div>
          <textarea
            className="locmap-field-input locmap-field-textarea"
            rows={2}
            value={f.value}
            onChange={(e) => setField(place.id, f.id, { value: e.target.value })}
          />
        </div>
      ))}
      <button className="locmap-add-field" onClick={() => void addCustomField()}>+ Add custom field</button>
    </div>
  );
};

export default LocationPlaceDetails;
