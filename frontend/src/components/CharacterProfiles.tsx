import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FaRegUser, FaRegTrashAlt, FaChevronRight, FaChevronDown } from 'react-icons/fa';
import { FullscreenIcon, ExpandIcon } from './uiIcons';
import { LuLayoutGrid, LuList, LuWaypoints } from 'react-icons/lu';
import { ControlDropdown, ControlSearch, ChromeTabs, type ToolChromeTab } from './ToolControls';
import type { Editor } from '@tiptap/react';
import { stripHtml } from '../utils/stripHtml';
import { CharacterScanTab } from './CharacterScanTab';
import { CharacterRelationshipsTab } from './CharacterRelationshipsTab';
import { CharacterImagePickerDialog } from './CharacterImageOverlays';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { useEditorStore, type CharacterProfile } from '../stores/editorStore';
import { characterFieldsFor } from '../stores/slices/characterSlice';
import { useProjectStore } from '../stores/projectStore';
import { useAssetStore } from '../stores/assetStore';
import { api } from '../services/api';
import { showToast } from './Toast';
import MiniRichText from './MiniRichText';
import { selectCharacterList } from '../utils/characterList';
import { toTitleCaseName, lastNameOf, joinName, escapeRegExp } from '../utils/characterNames';
import { buildScanList, filterScanList, type ScannedCharacter } from '../utils/characterScan';
import { useWindowTabMemory } from '../utils/windowTabMemory';
import { InlineRelForm, REL_DYNAMICS } from './InlineRelForm';
import { AssetImage, ImageSourceMenu } from './CharacterAssetMedia';
import { promptWithCheckbox } from './ConfirmDialog';

// Default colors for auto-assignment (VIBGYOR palette)
const DEFAULT_HIGHLIGHT_COLORS = [
  '#8b5cf6', '#4f46e5', '#2563eb', '#059669', '#eab308',
  '#f97316', '#ef4444', '#000000',
];

// stripHtml moved to utils/stripHtml — one shared copy for the collapsed
// preview here AND the FDX cast-list export (the two used to drift).

interface CharacterProfilesProps {
  /** Render inside a tool window: always visible, no close button/swipe */
  embedded?: boolean;
  /** v4.16: rendered as the full editor-area takeover (Scrapbook-style). */
  editor: Editor | null;
  projectId: string;
  style?: React.CSSProperties;
}

// v4.35 batch-v9 #4: the per-tool fullscreen plumbing (enterCharFullscreen /
// CharWindowActions) is gone — the frame's generic button and the store's
// enterToolFullscreen own it now.

/** v4.27, Derek's window template — Characters' chrome slots, registered in
 *  ToolDock's TOOL_CHROME. The count rides beside the centered title (row 1),
 *  fullscreen is a row-1 window action, and tabs + the Sort/View/Search
 *  cluster are row 2. The fullscreen takeover header renders the SAME
 *  CharTabs/CharControls, so window, dock and fullscreen stay one source.
 *  The count is published by the panel (search-filtered, profiles ∪ live
 *  cues) — displayed here, never recomputed, so the two can't drift. */
export function CharTitleExtra() {
  const count = useEditorStore((s) => s.charListCount);
  return <span className="tool-title-count">· {count}</span>;
}


/** Tab DATA for the chrome (TOOL_CHROME.useTabs) — ChromeTabs/ChromeRow2
 *  render it as a strip or, when the row is too narrow, a dropdown. */
export function useCharTabs(): ToolChromeTab[] {
  const activeTab = useEditorStore((s) => s.charActiveTab);
  const setActiveTab = useEditorStore((s) => s.setCharActiveTab);
  return [
    { label: 'Profiles', active: activeTab === 'profiles', onSelect: () => setActiveTab('profiles') },
    { label: 'Relationships', active: activeTab === 'relationships', onSelect: () => setActiveTab('relationships') },
    // v4.52, Derek: renamed "From Script" -> "Script" (label only; the
    // 'setup' tab id persists in view state).
    { label: 'Script', active: activeTab === 'setup', onSelect: () => setActiveTab('setup') },
  ];
}

const CHAR_SORTS = [
  ['name', 'Name'],
  ['importance', 'Importance'],
  ['scenes', 'Scenes'],
  ['dialogues', 'Dialogues'],
  ['appearance', 'Appearance'],
] as const;

export function CharControls() {
  const activeTab = useEditorStore((s) => s.charActiveTab);
  const sortBy = useEditorStore((s) => s.characterSortBy);
  const setSortBy = useEditorStore((s) => s.setCharacterSortBy);
  const viewMode = useEditorStore((s) => s.charViewMode);
  const setViewMode = useEditorStore((s) => s.setCharViewMode);
  const relView = useEditorStore((s) => s.relViewMode);
  const setRelView = useEditorStore((s) => s.setRelViewMode);
  const search = useEditorStore((s) => s.charSearchQuery);
  const setSearch = useEditorStore((s) => s.setCharSearchQuery);
  // v6.12, Derek: Filter on Profiles AND Relationships; Sort + Search on
  // Relationships too. Same View / Filter / Sort / Search order as every
  // window (the v5.80 rule; ControlDropdown stamps data-ctl for the guard).
  const fInScript = useEditorStore((s) => s.charFilterInScript);
  const fHasImage = useEditorStore((s) => s.charFilterHasImage);
  const fHasDesc = useEditorStore((s) => s.charFilterHasDesc);
  const setCharFilter = useEditorStore((s) => s.setCharFilter);
  const relTypeFilter = useEditorStore((s) => s.relTypeFilter);
  const setRelTypeFilter = useEditorStore((s) => s.setRelTypeFilter);
  const relSort = useEditorStore((s) => s.relSort);
  const setRelSort = useEditorStore((s) => s.setRelSort);
  const relationships = useEditorStore((s) => s.characterRelationships);
  const relTypes = useMemo(
    () => [...new Set(relationships.map((r) => r.type).filter(Boolean))].sort(),
    [relationships],
  );
  if (activeTab === 'setup') return null; // From Script has no list to control
  if (activeTab === 'relationships') {
    return (
      <>
        <ControlDropdown
          title="View"
          icon={relView === 'map' ? <LuWaypoints /> : <LuList />}
          current={relView === 'map' ? 'Map' : 'List'}
          items={[
            { label: 'List', active: relView === 'list', onSelect: () => setRelView('list') },
            { label: 'Map', active: relView === 'map', onSelect: () => setRelView('map') },
          ]}
        />
        <ControlDropdown
          label="Filter"
          chip={relTypeFilter ? 1 : 0}
          items={[
            { label: 'All types', active: relTypeFilter === null, onSelect: () => setRelTypeFilter(null) },
            ...relTypes.map((t) => ({
              label: t,
              active: relTypeFilter === t,
              onSelect: () => setRelTypeFilter(relTypeFilter === t ? null : t),
            })),
          ]}
        />
        <ControlDropdown
          label="Sort"
          items={[
            { label: 'Character (A–Z)', active: relSort === 'character', onSelect: () => setRelSort('character') },
            { label: 'Type', active: relSort === 'type', onSelect: () => setRelSort('type') },
          ]}
        />
        <ControlSearch value={search} onChange={setSearch} placeholder="Search relationships..." />
      </>
    );
  }
  return (
    <>
      <ControlDropdown
        title="View"
        icon={viewMode === 'cards' ? <LuLayoutGrid /> : <LuList />}
        current={viewMode === 'cards' ? 'Cards' : 'List'}
        items={[
          // v6.13, Derek: List leads the menu (Cards stays the default VIEW
          // for existing writers — this is menu order only).
          { label: 'List', active: viewMode === 'list', onSelect: () => setViewMode('list') },
          { label: 'Cards', active: viewMode === 'cards', onSelect: () => setViewMode('cards') },
        ]}
      />
      <ControlDropdown
        label="Filter"
        chip={(fInScript ? 1 : 0) + (fHasImage ? 1 : 0) + (fHasDesc ? 1 : 0)}
        items={[
          { label: 'In script only', active: fInScript, keepOpen: true, onSelect: () => setCharFilter('inScript', !fInScript) },
          { label: 'With an image', active: fHasImage, keepOpen: true, onSelect: () => setCharFilter('hasImage', !fHasImage) },
          { label: 'With a description', active: fHasDesc, keepOpen: true, onSelect: () => setCharFilter('hasDesc', !fHasDesc) },
        ]}
      />
      <ControlDropdown
        label="Sort"
        items={CHAR_SORTS.map(([id, label]) => ({ label, active: sortBy === id, onSelect: () => setSortBy(id) }))}
      />
      <ControlSearch value={search} onChange={setSearch} placeholder="Search characters..." />
    </>
  );
}

const CharacterProfiles: React.FC<CharacterProfilesProps> = ({ editor, projectId, style, embedded = false }) => {
  const {
    characters,
    characterProfiles,
    upsertCharacterProfile,
    deleteCharacterProfile,
    characterRelationships,
    upsertCharacterRelationship,
    deleteCharacterRelationship,
    characterCustomFields,
    addCharacterCustomField,
    renameCharacterCustomField,
    removeCharacterCustomField,
    characterProfilesOpen,
    toggleCharacterProfiles,
    selectedCharacter,
    setSelectedCharacter,
    referredTags,
    setReferredTag,
    scanResults,
    setScanResults,
  } = useEditorStore();

  const currentScriptId = useProjectStore((s) => s.currentScriptId);
  const { assets, setAssets } = useAssetStore();

  /* v6.11: the list-view name column — same store + limits family as the
     Scenes/Locations grips (COL_LIMITS in SceneNavigator registers
     'charName'; this is that entry's handler, living where its column
     renders). */
  const charNameW = useEditorStore((s) => s.sceneColWidths.charName);
  const setSceneColWidth = useEditorStore((s) => s.setSceneColWidth);
  const listRootRef = React.useRef<HTMLDivElement>(null);
  const startCharColResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = charNameW;
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    let w = startW;
    const onMove = (ev: PointerEvent) => {
      w = Math.max(120, Math.min(620, startW + (ev.clientX - startX)));
      listRootRef.current?.style.setProperty('--char-col-name', `${w}px`);
    };
    const onUp = () => {
      grip.releasePointerCapture(e.pointerId);
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      setSceneColWidth('charName', w);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
  };

  // v4.27 window template: tab, view modes and search are STORE state now —
  // the window chrome (frame row 2, dock accordion, fullscreen header) drives
  // them from outside the panel body. One source; chrome and body can't drift.
  const activeTab = useEditorStore((s) => s.charActiveTab);
  const setActiveTab = useEditorStore((s) => s.setCharActiveTab);
  // v4.71, Derek: opening the window restores its last-used tab (or resets to
  // Profiles when the Settings toggle is off). Embedded tool hosts mount per
  // open; the floating overlay instance stays mounted and gates on
  // characterProfilesOpen — that flag is its open edge.
  useWindowTabMemory('characters', activeTab, setActiveTab, 'profiles',
    ['profiles', 'relationships', 'setup'] as const, embedded || characterProfilesOpen);
  // Tab data for the fullscreen header + the legacy overlay's tab row (the
  // dock/window get the same list via TOOL_CHROME.useTabs).
  const charTabs = useCharTabs();
  // v4.23, Derek: the relationship map is no longer its own tab — it's a
  // List/Map view choice inside Relationships, mirroring Profiles' Cards/List.
  const relViewMode = useEditorStore((s) => s.relViewMode);
  const [addRelFor, setAddRelFor] = useState<string | null>(null); // character name to add rel for
  const [expandedChar, setExpandedChar] = useState<string | null>(null);
  const searchQuery = useEditorStore((s) => s.charSearchQuery);
  const setSearchQuery = useEditorStore((s) => s.setCharSearchQuery);
  const sortBy = useEditorStore((s) => s.characterSortBy);
  const setSortBy = useEditorStore((s) => s.setCharacterSortBy);
  const [pendingRemoveChar, setPendingRemoveChar] = useState<string | null>(null);
  // v4.23, Derek: "From Script" tab — "Scan Script" is now a discovery step. It
  // fills this list with every character found in the script (speaking cues +
  // referred names), each carrying a description/age pulled from the action line
  // that introduces them. Nothing is created until the writer clicks Add on a
  // row. null = not scanned yet this session.
  // v4.35: the generic takeover renders this SAME embedded body — the panel
  // knows it's the fullscreen instance from the store. v4.41: purely for
  // BEHAVIOR (legacy overlay headers, swipe, style) — the per-shape styling
  // classes are gone, every shape renders the same body.
  const isFullscreen = useEditorStore((s) => embedded && s.fullscreenTool === 'characters');
  // v4.27: Cards/List applies EVERYWHERE now (window, dock, fullscreen) — it's
  // the cluster's View dropdown, persisted. Was fullscreen-only local state.
  const viewMode = useEditorStore((s) => s.charViewMode);
  // v4.18: portal target in the header for the Relationship Map's toolbar.
  const [modalChar, setModalChar] = useState<string | null>(null);
  // v4.26 batch-v4 #4: the full view's Relationships / Appears-in sections
  // open from buttons on the photo row; per-character so the modal and an
  // expanded list card can't fight over one flag.
  const [openRels, setOpenRels] = useState<Record<string, boolean>>({});
  const [openScenes, setOpenScenes] = useState<Record<string, boolean>>({});
  // v4.26 batch-v5 #4: Voice Profile is a photo-row toggle like the other two.
  const [openVoice, setOpenVoice] = useState<Record<string, boolean>>({});
  // v4.26 batch-v5 #3: the image/placeholder opens the source menu; with an
  // image present, removeAssetId enables its "Remove Image" item.
  const [imgMenu, setImgMenu] = useState<{
    charName: string; pos: { top: number; left: number }; removeAssetId?: string;
  } | null>(null);

  // Image picker state
  const [imagePickerFor, setImagePickerFor] = useState<string | null>(null);
  const [imagePickerFilter, setImagePickerFilter] = useState('');
  // v4.22, Derek: per-character slideshow position.
  const [imgIdx, setImgIdx] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Fetch project assets when image picker opens
  const fetchAssets = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await api.listAssets(projectId);
      setAssets(list);
    } catch (err) {
      console.warn('Failed to fetch assets:', err);
    }
  }, [projectId, setAssets]);

  useEffect(() => {
    if (imagePickerFor && projectId) fetchAssets();
  }, [imagePickerFor, projectId, fetchAssets]);

  // When a character is clicked in the editor, expand it in the panel
  useEffect(() => {
    if (selectedCharacter) {
      setExpandedChar(selectedCharacter);
      setSelectedCharacter(null);
      setTimeout(() => {
        const card = document.querySelector(`[data-char-name="${selectedCharacter}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }, [selectedCharacter, setSelectedCharacter]);

  // Character cues present in the script RIGHT NOW. Scanned straight from the
  // doc so we never depend on the store's `characters` timing (updateCharacters
  // only fires when the cursor leaves a character node, so that list goes stale
  // the moment a cue is deleted — which is exactly when Remove needs the truth).
  // This is the single source of "who is in the script" for this panel.
  const scriptCharacterNames = useMemo(() => {
    const names = new Set<string>();
    if (!editor) return names;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'character') {
        const base = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').toUpperCase();
        if (base) names.add(base);
      }
      return true;
    });
    return names;
  }, [editor, editor?.state.doc]);

  // Auto-sync: ensure every character CURRENTLY in the script has a profile
  // entry. Driven by scriptCharacterNames (not the stale `characters` store) so
  // a name the writer just removed can't resurrect its profile after Remove.
  useEffect(() => {
    for (const name of scriptCharacterNames) {
      if (!characterProfiles.find((p) => p.name === name)) {
        const colorIdx = characterProfiles.length % DEFAULT_HIGHLIGHT_COLORS.length;
        upsertCharacterProfile(name, { color: DEFAULT_HIGHLIGHT_COLORS[colorIdx] });
      }
    }
  }, [scriptCharacterNames, characterProfiles, upsertCharacterProfile]);

  // "Scan Script" (handleScanScript) and applyScanResult live further down, next
  // to the "referred in script" detection they now fold into one list.

  // Compute stats per character: dialogue count, scene appearances, order of appearance
  interface CharStats { dialogueCount: number; sceneCount: number; scenes: string[]; appearanceOrder: number }
  const charStats = useMemo((): Map<string, CharStats> => {
    if (!editor) return new Map();
    const stats = new Map<string, { dialogueCount: number; scenes: Set<string>; appearanceOrder: number }>();

    let currentScene = '';
    let currentChar = '';
    let orderCounter = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'sceneHeading') {
        currentScene = node.textContent.trim();
      }
      if (node.type.name === 'character') {
        currentChar = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').toUpperCase();
        if (!stats.has(currentChar)) {
          stats.set(currentChar, { dialogueCount: 0, scenes: new Set(), appearanceOrder: orderCounter++ });
        }
        const s = stats.get(currentChar)!;
        if (currentScene) s.scenes.add(currentScene);
      }
      if (node.type.name === 'dialogue' && currentChar) {
        const s = stats.get(currentChar);
        if (s) s.dialogueCount++;
      }
      return true;
    });

    const result = new Map<string, CharStats>();
    for (const [name, s] of stats) {
      result.set(name, { dialogueCount: s.dialogueCount, sceneCount: s.scenes.size, scenes: Array.from(s.scenes), appearanceOrder: s.appearanceOrder });
    }
    return result;
  }, [editor, editor?.state.doc]);

  /** Navigate to first appearance of a character in the script */
  const handleNavigateToCharacter = useCallback(
    (name: string) => {
      if (!editor) return;
      const upper = name.toUpperCase();
      let targetPos: number | null = null;

      editor.state.doc.descendants((node, pos) => {
        if (targetPos !== null) return false;
        if (node.type.name === 'character') {
          const base = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').toUpperCase();
          if (base === upper) {
            targetPos = pos + 1; // inside the node
            return false;
          }
        }
        return true;
      });

      if (targetPos !== null) {
        editor.chain().focus().setTextSelection(targetPos).run();
        const coords = editor.view.coordsAtPos(targetPos);
        const editorMain = document.querySelector('.editor-main');
        if (editorMain && coords) {
          const rect = editorMain.getBoundingClientRect();
          const scrollTo = editorMain.scrollTop + (coords.top - rect.top) - rect.height / 3;
          editorMain.scrollTo({ top: scrollTo, behavior: 'auto' });
        }
      }
    },
    [editor],
  );

  /** Navigate to a scene heading in the script */
  const handleNavigateToScene = useCallback(
    (sceneText: string) => {
      if (!editor) return;
      let targetPos: number | null = null;

      editor.state.doc.descendants((node, pos) => {
        if (targetPos !== null) return false;
        if (node.type.name === 'sceneHeading') {
          if (node.textContent.trim() === sceneText) {
            targetPos = pos + 1;
            return false;
          }
        }
        return true;
      });

      if (targetPos !== null) {
        editor.chain().focus().setTextSelection(targetPos).run();
        const coords = editor.view.coordsAtPos(targetPos);
        const editorMain = document.querySelector('.editor-main');
        if (editorMain && coords) {
          const rect = editorMain.getBoundingClientRect();
          const scrollTo = editorMain.scrollTop + (coords.top - rect.top) - rect.height / 3;
          editorMain.scrollTo({ top: scrollTo, behavior: 'auto' });
        }
      }
    },
    [editor],
  );

  // Detect potential characters mentioned in action lines (ALL-CAPS words 2+ chars)
  // that are not yet in the character list — these may be non-speaking characters
  const unmatchedNames = useMemo(() => {
    if (!editor) return [];
    const known = new Set<string>();
    for (const c of characters) known.add(c.toUpperCase());
    for (const p of characterProfiles) known.add(p.name);

    // Common ALL-CAPS words to exclude (not character names)
    const EXCLUDE = new Set([
      'INT', 'EXT', 'DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'MORNING',
      'EVENING', 'DAWN', 'DUSK', 'NOON', 'AFTERNOON', 'FADE', 'CUT',
      'DISSOLVE', 'SMASH', 'TO', 'IN', 'OUT', 'THE', 'AND', 'BUT',
      'FOR', 'NOT', 'ALL', 'HER', 'HIS', 'SHE', 'HIM', 'THEY', 'ARE',
      'WAS', 'HAS', 'WITH', 'FROM', 'THAT', 'THIS', 'THEN', 'THAN',
      'BACK', 'OVER', 'CONT', "CONT'D", 'MORE', 'END', 'ACT', 'ANGLE',
      'CLOSE', 'WIDE', 'POV', 'FLASHBACK', 'INTERCUT', 'SUPER', 'TITLE',
      'SERIES', 'SHOTS', 'MONTAGE', 'BEGIN', 'RESUME', 'SAME', 'TIME',
      'MATCH', 'JUMP', 'FREEZE', 'FRAME', 'STOCK', 'SHOT', 'INSERT',
    ]);

    const found = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (node.type.name !== 'action') return true;
      const text = node.textContent;
      // Match sequences of 2+ uppercase words (character names are often multi-word)
      const regex = /\b([A-Z][A-Z.'\- ]{1,30}[A-Z])\b/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const candidate = match[1].trim();
        // Must be 2+ chars and not be an excluded common word
        if (candidate.length < 2) continue;
        const words = candidate.split(/\s+/);
        if (words.every((w) => EXCLUDE.has(w.replace(/[.']/g, '')))) continue;
        // Must not already be known
        if (known.has(candidate)) continue;
        // v4.19: skip names the writer has classified (location / other /
        // connected to an existing character) — they drop off this list.
        if (referredTags[candidate]) continue;
        found.add(candidate);
      }
      return true;
    });

    return Array.from(found).sort();
  }, [editor, editor?.state.doc, characters, characterProfiles, referredTags]);

  // v4.19: existing character names to offer under "Connect to character".
  const existingCharNames = useMemo(() => {
    const set = new Set<string>();
    for (const p of characterProfiles) if (p.name) set.add(p.name);
    for (const c of characters) set.add(c.toUpperCase());
    return Array.from(set).sort();
  }, [characterProfiles, characters]);

  // v4.19: classify a referred name so it drops off the list — as a location,
  // as "other", or connected to an existing character.
  const handleClassifyReferred = useCallback((name: string, val: string) => {
    if (!val) return;
    if (val === '__location') setReferredTag(name, { kind: 'location' });
    else if (val === '__other') setReferredTag(name, { kind: 'other' });
    else if (val.startsWith('__char:')) {
      const target = val.slice('__char:'.length);
      setReferredTag(name, { kind: 'character', character: target });
      // v4.21: the referred name is almost always the full name (SAM VEDU → SAM),
      // so fill it into the linked character's Full Name (unless one is set).
      const existing = characterProfiles.find((pr) => pr.name === target);
      if (!existing?.fullName) upsertCharacterProfile(target, { fullName: name });
    }
  }, [setReferredTag, characterProfiles, upsertCharacterProfile]);

  /**
   * "Scan Script" — the "From Script" tab's discovery step (replaces the old
   * "Build from Script", which silently created and deleted profiles). Scans the
   * script for every character — speaking cues plus the referred ALL-CAPS names
   * that used to sit in their own "Referred in Script" section — and pulls a
   * description + age from the action line that introduces each. It only builds a
   * reviewable list (scanResults); nothing is created until the writer clicks Add.
   */
  const handleScanScript = useCallback(() => {
    if (!editor) return;
    const actionTexts: string[] = [];
    const cueNames: string[] = [];
    const seenCue = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'action') {
        actionTexts.push(node.textContent);
      } else if (node.type.name === 'character') {
        const base = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').toUpperCase();
        if (base && !seenCue.has(base)) { seenCue.add(base); cueNames.push(base); }
      }
      return true;
    });
    setScanResults(buildScanList(actionTexts, cueNames, unmatchedNames));
  }, [editor, unmatchedNames]);

  // Add one scanned character: create its profile if needed and fill in the
  // detected description/age — but only into fields the writer hasn't set, so
  // re-adding never clobbers an edit. New names get a color like any other.
  const applyScanResult = useCallback((r: ScannedCharacter) => {
    const existing = characterProfiles.find((p) => p.name === r.name);
    const updates: Partial<Omit<CharacterProfile, 'name'>> = {};
    if (!existing) {
      const colorIdx = characterProfiles.length % DEFAULT_HIGHLIGHT_COLORS.length;
      updates.color = DEFAULT_HIGHLIGHT_COLORS[colorIdx];
    }
    if (r.description && !existing?.description) updates.description = r.description;
    if (r.age && !existing?.age) updates.age = r.age;
    upsertCharacterProfile(r.name, updates);
  }, [characterProfiles, upsertCharacterProfile]);

  // The scan is a snapshot, but a referred name the writer classifies afterwards
  // (location / other / connected) should still drop off — mirror the old list's
  // live behavior by filtering the snapshot against referredTags at render time.
  // v4.24 (Derek): entering the tab scans automatically.
  // v4.28 batch-v6 #5 (Derek): no button at all — while the tab is open the
  // list also FOLLOWS the script: doc changes re-scan after a quiet second,
  // so typing doesn't churn the list mid-keystroke but it's never stale.
  const scanRef = useRef(handleScanScript);
  scanRef.current = handleScanScript;
  useEffect(() => {
    if (activeTab !== 'setup' || !editor) return;
    scanRef.current();
    let t: ReturnType<typeof setTimeout> | undefined;
    const onDocChange = () => {
      clearTimeout(t);
      t = setTimeout(() => scanRef.current(), 1000);
    };
    editor.on('update', onDocChange);
    return () => { clearTimeout(t); editor.off('update', onDocChange); };
  }, [activeTab, editor]);

  const visibleScanResults = useMemo(() => {
    const profileNames = new Set(characterProfiles.map((p) => p.name));
    return filterScanList(scanResults, referredTags, profileNames);
  }, [scanResults, referredTags, characterProfiles]);

  // v6.12: the Profiles header's Filter dimensions (read by allCharacters).
  const filterInScript = useEditorStore((s) => s.charFilterInScript);
  const filterHasImage = useEditorStore((s) => s.charFilterHasImage);
  const filterHasDesc = useEditorStore((s) => s.charFilterHasDesc);

  /* v6.12, Derek: the Relationships header's Filter / Sort / Search shape
     what the tab shows — list AND map read this one processed array.
     Creation still writes through the unfiltered store. */
  const relTypeFilter = useEditorStore((s) => s.relTypeFilter);
  const relSort = useEditorStore((s) => s.relSort);
  const visibleRelationships = useMemo(() => {
    let list = characterRelationships;
    if (relTypeFilter) list = list.filter((r) => r.type === relTypeFilter);
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      list = list.filter((r) =>
        r.characterA.toUpperCase().includes(q) || r.characterB.toUpperCase().includes(q));
    }
    return [...list].sort((a, b) => relSort === 'type'
      ? (a.type || '').localeCompare(b.type || '') || a.characterA.localeCompare(b.characterA)
      : a.characterA.localeCompare(b.characterA) || a.characterB.localeCompare(b.characterB));
  }, [characterRelationships, relTypeFilter, searchQuery, relSort]);

  // Characters that have a profile but are no longer detected in the script.
  const orphanedNames = useMemo(() => {
    return new Set(
      characterProfiles
        .filter((p) => !scriptCharacterNames.has(p.name))
        .map((p) => p.name),
    );
  }, [characterProfiles, scriptCharacterNames]);

  // All characters (from profiles + auto-detected), sorted by selected criteria
  /* v7.45: the list itself moved to utils/characterList — it is a pure
     function of these eight inputs, and the union-of-two-sources decision in
     it is now held by tests rather than a comment alone. */
  const allCharacters = useMemo(
    () => selectCharacterList({
      characterProfiles, scriptCharacterNames, searchQuery, sortBy, charStats,
      filterInScript, filterHasImage, filterHasDesc,
    }),
    [characterProfiles, scriptCharacterNames, searchQuery, sortBy, charStats,
      filterInScript, filterHasImage, filterHasDesc],
  );

  // v4.24 batch-v2 #6: publish the count the panel shows so the window
  // chrome's title (CharTitleExtra) displays the same number.
  useEffect(() => {
    useEditorStore.getState().setCharListCount(allCharacters.length);
  }, [allCharacters.length]);

  const getProfile = useCallback(
    (name: string): CharacterProfile => {
      const existing = characterProfiles.find((p) => p.name === name);
      if (existing) return existing;
      return { name, description: '', color: '', highlighted: false, gender: '', age: '', role: '', backstory: '', arc: '', speechPattern: '', vocabulary: '', verbalTics: '', sampleDialogue: '', images: [] };
    },
    [characterProfiles],
  );

  // ── Names: First / Last, and pushing edits back into the script (v4.22) ──
  // Screenplay names are ALL CAPS; the tool shows Title Case. A first-name edit
  // rewrites the bare name everywhere (cue + full name); a last-name edit
  // rewrites only the full-name phrase, leaving the cue.

  /** Replace every whole-word, case-sensitive occurrence of `phrase` with
   *  `replacement` across the script. Returns how many were changed. */
  const replaceInScript = useCallback((phrase: string, replacement: string): number => {
    if (!editor || !phrase || phrase === replacement) return 0;
    const re = new RegExp('\\b' + escapeRegExp(phrase) + '\\b', 'g'); // case-sensitive: only the CAPS forms
    const edits: { from: number; to: number }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      const text = node.textContent;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const from = pos + 1 + m.index;
        edits.push({ from, to: from + m[0].length });
        if (m[0].length === 0) re.lastIndex++;
      }
      return false; // handled this block's text; don't descend into inline nodes
    });
    if (!edits.length) return 0;
    edits.sort((a, b) => b.from - a.from); // apply back-to-front so positions stay valid
    let tr = editor.state.tr;
    for (const e of edits) tr = tr.insertText(replacement, e.from, e.to);
    editor.view.dispatch(tr);
    return edits.length;
  }, [editor]);

  /** Whether the First / Last name fields differ from the script (drives the
   *  "Update name in script" button). */
  const nameChanged = useCallback((prof: CharacterProfile) => {
    const oldName = prof.name;
    const oldLastCaps = lastNameOf(prof.fullName || '');
    const newFirstCaps = (prof.firstName ?? toTitleCaseName(oldName)).trim().toUpperCase();
    const newLastCaps = (prof.lastName ?? toTitleCaseName(oldLastCaps)).trim().toUpperCase();
    return { firstChanged: !!newFirstCaps && newFirstCaps !== oldName, lastChanged: newLastCaps !== oldLastCaps };
  }, []);

  /** Push First / Last name edits back into the script. Last name rewrites the
   *  full-name phrase ("SAM VEDU" → "SAM PRUSA"); first name rewrites the bare
   *  name everywhere ("SAM" → "SAMUEL"), including cues and inside the full name.
   *  Doing last-then-first keeps both correct when they change together. */
  const applyNameToScript = useCallback((charName: string) => {
    const prof = getProfile(charName);
    const oldName = prof.name;                                   // SAM
    const oldLastCaps = lastNameOf(prof.fullName || '');         // VEDU
    const newFirstCaps = (prof.firstName ?? toTitleCaseName(oldName)).trim().toUpperCase();  // SAMUEL / SAM
    const newLastCaps = (prof.lastName ?? toTitleCaseName(oldLastCaps)).trim().toUpperCase(); // PRUSA / VEDU
    const firstChanged = !!newFirstCaps && newFirstCaps !== oldName;
    const lastChanged = newLastCaps !== oldLastCaps;
    if (!firstChanged && !lastChanged) return;

    let n = 0;
    // 1) Last name: rewrite the full-name phrase, still under the OLD first name.
    if (lastChanged && oldLastCaps) {
      n += replaceInScript(joinName(oldName, oldLastCaps), joinName(oldName, newLastCaps));
    }
    // 2) First name: rewrite the bare name everywhere (also fixes the phrase's
    //    first token that step 1 left under the old first name).
    if (firstChanged) n += replaceInScript(oldName, newFirstCaps);

    const newFull = newLastCaps ? joinName(newFirstCaps, newLastCaps) : undefined;
    if (firstChanged) {
      const { name: _drop, ...rest } = prof;
      void _drop;
      deleteCharacterProfile(oldName);
      upsertCharacterProfile(newFirstCaps, {
        ...rest, fullName: newFull,
        firstName: toTitleCaseName(newFirstCaps), lastName: toTitleCaseName(newLastCaps),
      });
      if (expandedChar === oldName) setExpandedChar(newFirstCaps);
      if (modalChar === oldName) setModalChar(newFirstCaps);
    } else {
      upsertCharacterProfile(oldName, { fullName: newFull, lastName: toTitleCaseName(newLastCaps) });
    }
    showToast(n ? `Updated ${n} name${n > 1 ? 's' : ''} in the script.` : 'Name saved.', 'success');
  }, [getProfile, replaceInScript, upsertCharacterProfile, deleteCharacterProfile, expandedChar, modalChar]);

  // Auto-detect a character's full name: the intro "SAM VEDU" in an action line
  // (cue name followed by another all-caps word). Fills the Last Name field.
  const detectedFullNames = useMemo(() => {
    const map = new Map<string, string>();
    if (!editor) return map;
    const parts: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'action' || node.type.name === 'general') parts.push(node.textContent);
      return true;
    });
    const blob = parts.join('\n');
    for (const cue of scriptCharacterNames) {
      const m = blob.match(new RegExp('\\b' + escapeRegExp(cue) + "\\s+([A-Z][A-Z'’-]+)\\b"));
      if (m) map.set(cue, `${cue} ${m[1]}`);
    }
    return map;
  }, [editor, editor?.state.doc, scriptCharacterNames]);

  useEffect(() => {
    for (const [cue, full] of detectedFullNames) {
      const prof = characterProfiles.find((p) => p.name === cue);
      // Only auto-fill when the user hasn't set a full/last name themselves.
      if (prof && !prof.fullName && !prof.lastName) upsertCharacterProfile(cue, { fullName: full });
    }
  }, [detectedFullNames, characterProfiles, upsertCharacterProfile]);

  // v4.22, Derek: characters that share a last name are auto-linked as family.
  // Each pair is handled once per session (the ref), so deleting an auto link
  // during the session doesn't make it spring back.
  const autoFamilyRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const byLast = new Map<string, string[]>();
    for (const p of characterProfiles) {
      const last = (p.lastName ?? toTitleCaseName(lastNameOf(p.fullName || ''))).trim().toUpperCase();
      if (!last) continue;
      (byLast.get(last) ?? byLast.set(last, []).get(last)!).push(p.name);
    }
    for (const names of byLast.values()) {
      if (names.length < 2) continue;
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const key = [names[i], names[j]].sort().join('|');
          if (autoFamilyRef.current.has(key)) continue;
          autoFamilyRef.current.add(key);
          const a = names[i], b = names[j];
          const exists = characterRelationships.some(
            (r) => (r.characterA === a && r.characterB === b) || (r.characterA === b && r.characterB === a),
          );
          if (!exists) {
            upsertCharacterRelationship({
              id: `rel-fam-${key}-${Date.now()}`,
              characterA: a, characterB: b,
              type: 'family', description: 'Shares a last name', dynamic: REL_DYNAMICS[0],
            });
          }
        }
      }
    }
  }, [characterProfiles, characterRelationships, upsertCharacterRelationship]);

  /** Calculate profile completeness as percentage + field breakdown */
  const getProfileCompleteness = useCallback((profile: CharacterProfile) => {
    const fields: { label: string; filled: boolean }[] = [
      { label: 'Description', filled: !!stripHtml(profile.description || '').trim() },
      { label: 'Gender', filled: !!profile.gender },
      { label: 'Age', filled: !!profile.age },
      { label: 'Role', filled: !!profile.role },
      { label: 'Backstory', filled: !!stripHtml(profile.backstory || '').trim() },
      { label: 'Character Arc', filled: !!stripHtml(profile.arc || '').trim() },
      { label: 'Speech Pattern', filled: !!stripHtml(profile.speechPattern || '').trim() },
      { label: 'Vocabulary', filled: !!stripHtml(profile.vocabulary || '').trim() },
      { label: 'Verbal Tics', filled: !!stripHtml(profile.verbalTics || '').trim() },
      { label: 'Image', filled: (profile.images?.length || 0) > 0 },
    ];
    const filled = fields.filter((f) => f.filled).length;
    const pct = Math.round((filled / fields.length) * 100);
    return { pct, filled, total: fields.length, fields };
  }, []);

  // Image helpers

  const imageAssets = useMemo(() => {
    return assets.filter((a) => a.mime_type.startsWith('image/'));
  }, [assets]);

  const handleUploadImage = useCallback(async (charName: string, file: File) => {
    if (!projectId) return;
    setUploading(true);
    try {
      const data = await api.uploadAsset(projectId, file, [`character:${charName}`]);
      const assetId = data.id || data.asset?.id;
      if (assetId) {
        const profile = characterProfiles.find((p) => p.name === charName);
        const currentImages = profile?.images || [];
        upsertCharacterProfile(charName, { images: [...currentImages, assetId] });
      }
      await fetchAssets();
      showToast('Image uploaded', 'success');
    } catch (err) {
      showToast(`Image upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setUploading(false);
    }
  }, [projectId, characterProfiles, upsertCharacterProfile, fetchAssets]);

  const handleAssociateAsset = useCallback((charName: string, assetId: string) => {
    const profile = characterProfiles.find((p) => p.name === charName);
    const currentImages = profile?.images || [];
    if (!currentImages.includes(assetId)) {
      upsertCharacterProfile(charName, { images: [...currentImages, assetId] });
    }
    setImagePickerFor(null);
    setImagePickerFilter('');
  }, [characterProfiles, upsertCharacterProfile]);

  const handleRemoveImage = useCallback((charName: string, assetId: string) => {
    const profile = characterProfiles.find((p) => p.name === charName);
    const currentImages = profile?.images || [];
    upsertCharacterProfile(charName, { images: currentImages.filter((id) => id !== assetId) });
  }, [characterProfiles, upsertCharacterProfile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const charName = uploadTargetRef.current;
    if (file && charName) {
      handleUploadImage(charName, file);
    }
    e.target.value = '';
  }, [handleUploadImage]);

  const triggerUpload = useCallback((charName: string) => {
    uploadTargetRef.current = charName;
    fileInputRef.current?.click();
  }, []);

  /** v4.22, Derek: First / Last name fields. Shown Title Case (the script is all
   *  caps); editing either surfaces an "Update name in script" button that pushes
   *  the change back. ONE renderer, used by both the card expansion and the modal
   *  so the two never drift. */
  const renderNameFields = (charName: string) => {
    const prof = getProfile(charName);
    const scriptLastCaps = lastNameOf(prof.fullName || '');
    const dispFirst = prof.firstName ?? toTitleCaseName(prof.name);
    const dispLast = prof.lastName ?? toTitleCaseName(scriptLastCaps);
    const { firstChanged, lastChanged } = nameChanged(prof);
    const changed = firstChanged || lastChanged;
    // v4.22, Derek: fields + button fill the whole row; the button is always
    // shown, greyed out until a name actually changes.
    return (
      <div className="char-profile-name-row">
        <div className="char-profile-meta-field char-profile-name-cell">
          <label className="char-profile-label">First Name</label>
          <input
            className="char-profile-input char-profile-name-input"
            value={dispFirst}
            onChange={(e) => upsertCharacterProfile(charName, { firstName: e.target.value })}
          />
        </div>
        <div className="char-profile-meta-field char-profile-name-cell">
          <label className="char-profile-label">Last Name</label>
          <input
            className="char-profile-input char-profile-name-input"
            value={dispLast}
            onChange={(e) => upsertCharacterProfile(charName, { lastName: e.target.value })}
          />
        </div>
        <button
          className="char-profile-name-update"
          disabled={!changed}
          title={changed ? "Rewrite this character's name throughout the script" : 'Edit a name to enable'}
          onClick={() => applyNameToScript(charName)}
        >Update in Script</button>
      </div>
    );
  };

  /** Gender / Age / Sexuality — one row, shared by card + modal (v4.22, Derek:
   *  Role removed; Sexuality added; no placeholder hints). v4.24 batch 3: the
   *  card shows only the essentials (gender + age); the modal keeps all three. */
  /** v4.26 batch-v4 #2, Derek: one meta row everywhere — Age, Gender,
   *  Sexuality, in that order (the essentials/full split is gone). */
  const renderMetaRow = (charName: string) => {
    const prof = getProfile(charName);
    return (
      <div className="char-profile-meta-row char-profile-meta-row-3">
        <div className="char-profile-meta-field">
          <label className="char-profile-label">Age</label>
          <input
            type="text"
            className="char-profile-input"
            value={prof.age}
            onChange={(e) => upsertCharacterProfile(charName, { age: e.target.value })}
          />
        </div>
        <div className="char-profile-meta-field">
          <label className="char-profile-label">Gender</label>
          <input
            type="text"
            className="char-profile-input"
            value={prof.gender}
            onChange={(e) => upsertCharacterProfile(charName, { gender: e.target.value })}
          />
        </div>
        <div className="char-profile-meta-field">
          <label className="char-profile-label">Sexuality</label>
          <input
            type="text"
            className="char-profile-input"
            value={prof.sexuality ?? ''}
            onChange={(e) => upsertCharacterProfile(charName, { sexuality: e.target.value })}
          />
        </div>
      </div>
    );
  };

  /** Full-width character image with slideshow arrows and a delete button that
   *  works even for the only image. (v4.22, Derek.) v4.24 batch 5: in Cards
   *  view, a card with no image keeps the same image-field footprint via a
   *  placeholder box, so the grid stays uniform. */
  /** v4.26 batch-v5 #3, Derek: the image AND its empty placeholder are the
   *  upload control — clicking either opens the source menu (local device /
   *  Asset Manager, plus Remove Image when a photo is showing). The old
   *  "Upload Image ▾" row button and the corner × are gone (one control, one
   *  menu); image-click no longer opens the zoom lightbox. */
  const openImgMenu = (e: React.MouseEvent, charName: string, removeAssetId?: string) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setImgMenu({ charName, pos: { top: r.top + Math.min(r.height, 48), left: r.left + 12 }, removeAssetId });
  };
  const renderImageDisplay = (charName: string, reserveWhenEmpty = false) => {
    const prof = getProfile(charName);
    const imgs = prof.images ?? [];
    const n = imgs.length;
    if (!n || !projectId) {
      return reserveWhenEmpty ? (
        <div
          className={`char-profile-image-placeholder${projectId ? ' char-img-clickable' : ''}`}
          role={projectId ? 'button' : undefined}
          aria-label={projectId ? 'Add a character image' : undefined}
          title={projectId ? 'Add a character image' : undefined}
          onClick={projectId ? (e) => openImgMenu(e, charName) : undefined}
        >
          {uploading ? <span className="char-profile-image-uploading">Uploading…</span> : (
            <>
              <FaRegUser />
              {/* v4.28 batch-v6 #3, Derek: say what clicking does. */}
              {projectId && <span className="char-profile-image-add-label">+ Add Image</span>}
            </>
          )}
        </div>
      ) : null;
    }
    const idx = Math.min(imgIdx[charName] ?? 0, n - 1);
    const step = (d: number) => setImgIdx((m) => ({ ...m, [charName]: ((idx + d) % n + n) % n }));
    return (
      <div className="char-profile-image-display">
        <AssetImage
          projectId={projectId}
          assetId={imgs[idx]}
          className="char-profile-image-main char-img-clickable"
          alt={charName}
          onClick={(e) => openImgMenu(e, charName, imgs[idx])}
        />
        {n > 1 && (
          <>
            <button className="char-profile-image-nav prev" title="Previous image" onClick={() => step(-1)}>&#8249;</button>
            <button className="char-profile-image-nav next" title="Next image" onClick={() => step(1)}>&#8250;</button>
            <span className="char-profile-image-count">{idx + 1} / {n}</span>
          </>
        )}
      </div>
    );
  };

  /** Image display + actions row. A divider sets this media block off from
   *  the fields above. v4.26 batch-v4 #4/#5: the voice-clip control moved
   *  into the Voice Profile section; in the FULL view (withSections) the row
   *  instead carries Relationships / Appears-in toggles whose content opens
   *  right below the photo. */
  const renderImageSection = (charName: string, reserveWhenEmpty = false, withSections = false) => {
    const st = charStats.get(charName);
    const nameUpper = charName.toUpperCase();
    const relCount = characterRelationships.filter(
      (r) => r.characterA === nameUpper || r.characterB === nameUpper
    ).length;
    return (
    <>
      <div className="char-profile-section-divider" aria-hidden />
      <div className="char-profile-photo-row">
        {renderImageDisplay(charName, reserveWhenEmpty)}
        <div className="char-profile-image-actions">
          {withSections && (
            <>
              <button
                className={`char-profile-voice-btn${openRels[charName] ? ' active' : ''}`}
                title="Show this character's relationships"
                onClick={() => setOpenRels((m) => ({ ...m, [charName]: !m[charName] }))}
              >
                Relationships{relCount > 0 ? ` (${relCount})` : ''}
              </button>
              {st && st.scenes.length > 0 && (
                <button
                  className={`char-profile-voice-btn${openScenes[charName] ? ' active' : ''}`}
                  title="Show the scenes this character appears in"
                  onClick={() => setOpenScenes((m) => ({ ...m, [charName]: !m[charName] }))}
                >
                  Appears in ({st.scenes.length})
                </button>
              )}
              {/* v4.26 batch-v5 #4: Voice Profile joins the row */}
              <button
                className={`char-profile-voice-btn${openVoice[charName] ? ' active' : ''}`}
                title="Show this character's voice profile"
                onClick={() => setOpenVoice((m) => ({ ...m, [charName]: !m[charName] }))}
              >
                Voice Profile
              </button>
            </>
          )}
        </div>
      </div>
    </>
    );
  };

  /** User-defined custom fields (shared definitions, per-character values) plus
   *  an "+ Add field" control. Shown on every character. (v4.22, Derek.) */
  const renderCustomFields = (charName: string) => {
    const prof = getProfile(charName);
    // v4.88: a field with no owner belongs to every character (how they all
    // worked before); an owned one shows only on the character it was made on.
    const mine = characterFieldsFor(characterCustomFields, charName);
    return (
      <div className="char-profile-custom-fields">
        {mine.map((f) => (
          <div className="char-profile-custom-field" key={f.id}>
            <div className="char-profile-custom-label-row">
              <input
                className="char-profile-label char-profile-custom-label"
                value={f.label}
                title={f.owner ? `Rename this field (only on ${f.owner})` : 'Rename this field (applies to every character)'}
                onChange={(e) => renameCharacterCustomField(f.id, e.target.value)}
              />
              <button
                className="char-profile-custom-remove"
                title={f.owner ? 'Remove this field from this character' : 'Remove this field from every character'}
                onClick={() => removeCharacterCustomField(f.id)}
              ><FaRegTrashAlt /></button>
            </div>
            {/* v4.87, Derek: a custom field is the SAME control as the built-in
                profile fields above it — full width, two rows, resizable — not
                the short one-line .char-profile-input it used to be. Sharing
                .char-profile-textarea means it also tracks their styling and
                Design knobs instead of drifting away from them. */}
            <textarea
              className="char-profile-textarea"
              rows={2}
              value={prof.customFields?.[f.id] ?? ''}
              onChange={(e) => upsertCharacterProfile(charName, {
                customFields: { ...(prof.customFields ?? {}), [f.id]: e.target.value },
              })}
            />
          </div>
        ))}
        <button
          className="char-profile-add-field"
          onClick={async () => {
            // v4.26 batch-v5 #5: window.prompt returns null in Tauri's
            // WKWebView (the documented ConfirmDialog hazard) — the button
            // silently did nothing in the app. promptDialog is the in-app
            // replacement every other prompt already uses.
            // v4.88, Derek: the name and the scope are ONE question, so they
            // are one dialog — unchecked means the field belongs to this
            // character alone.
            const res = await promptWithCheckbox('New field name:', '', {
              title: 'New Custom Field',
              confirmLabel: 'Add',
              checkboxLabel: 'Apply to all characters?',
            });
            if (res && res.value.trim()) {
              addCharacterCustomField(res.value.trim(), res.checked ? undefined : charName);
            }
          }}
        >+ Custom Field</button>
      </div>
    );
  };

  /** Render character detail fields — used in both card expansion and modal */
  /** Relationships block — opened from the photo row's toggle (batch-v4 #4). */
  const renderRelationshipsBlock = (charName: string) => {
    const nameUpper = charName.toUpperCase();
    const rels = characterRelationships.filter(
      (r) => r.characterA === nameUpper || r.characterB === nameUpper
    );
    const isAdding = addRelFor === nameUpper;
    return (
      <div className="char-profile-relationships">
        <div className="char-profile-rel-header-row">
          <label className="char-profile-label" style={{ marginBottom: 0 }}>Relationships</label>
          {!isAdding && (
            <button className="char-profile-rel-add-btn" onClick={() => setAddRelFor(nameUpper)}>+ Add</button>
          )}
        </div>
        {rels.map((r) => {
          const other = r.characterA === nameUpper ? r.characterB : r.characterA;
          return (
            <div key={r.id} className="char-profile-rel-item">
              <div className="char-profile-rel-header">
                <span className="char-profile-rel-other">{other}</span>
                <span className="char-profile-rel-type">{r.type}</span>
                {r.dynamic && <span className="char-profile-rel-dynamic">{r.dynamic}</span>}
                <button
                  className="char-profile-rel-remove"
                  onClick={() => deleteCharacterRelationship(r.id)}
                  title="Remove relationship"
                ><FaRegTrashAlt /></button>
              </div>
              {r.description && <div className="char-profile-rel-desc">{r.description}</div>}
            </div>
          );
        })}
        {rels.length === 0 && !isAdding && (
          <div className="char-profile-rel-empty">No relationships defined yet</div>
        )}
        {isAdding && (
          <InlineRelForm
            characterName={nameUpper}
            allCharacters={allCharacters}
            onSave={(rel) => {
              upsertCharacterRelationship(rel);
              setAddRelFor(null);
            }}
            onCancel={() => setAddRelFor(null)}
          />
        )}
      </div>
    );
  };

  /** Scene appearances — opened from the photo row's toggle (batch-v4 #4). */
  const renderScenesBlock = (charName: string) => {
    const st = charStats.get(charName);
    if (!st || st.scenes.length === 0) return null;
    return (
      <div className="char-profile-scene-chips">
        {st.scenes.map((s, i) => (
          <span key={i} className="char-profile-scene-chip" onClick={() => handleNavigateToScene(s)} title={`Go to: ${s}`}>{s}</span>
        ))}
      </div>
    );
  };

  const renderCharacterFields = (charName: string, isModal: boolean) => {
    const prof = getProfile(charName);
    return (
      <>
        {renderNameFields(charName)}

        {/* Photo row — reserved placeholder (batch-v4 #6) + the
            Relationships / Appears-in toggles (batch-v4 #4) */}
        {renderImageSection(charName, true, true)}
        {openRels[charName] && renderRelationshipsBlock(charName)}
        {openScenes[charName] && renderScenesBlock(charName)}
        {openVoice[charName] && (
          <div className="char-profile-voice-fields">
            {/* v6.45, Derek: the Upload Voice Clip tool is GONE — the section
                keeps its writing fields. (voiceProfile stays in saved data,
                unread.) */}
            <label className="char-profile-label">Speech Pattern</label>
            <MiniRichText
              value={prof.speechPattern || ''}
              onChange={(html) => upsertCharacterProfile(charName, { speechPattern: html })}
              minHeight={40}
            />
            <label className="char-profile-label">Vocabulary</label>
            <MiniRichText
              value={prof.vocabulary || ''}
              onChange={(html) => upsertCharacterProfile(charName, { vocabulary: html })}
              placeholder="Educated, uses legal terms, street slang..."
              minHeight={40}
            />
            <label className="char-profile-label">Verbal Tics</label>
            <MiniRichText
              value={prof.verbalTics || ''}
              onChange={(html) => upsertCharacterProfile(charName, { verbalTics: html })}
              minHeight={40}
            />
            <label className="char-profile-label">Sample Dialogue</label>
            <MiniRichText
              value={prof.sampleDialogue || ''}
              onChange={(html) => upsertCharacterProfile(charName, { sampleDialogue: html })}
              minHeight={40}
            />
          </div>
        )}

        {/* Age / Gender / Sexuality — above Description (batch-v4 #2) */}
        {renderMetaRow(charName)}

        {/* Description — full width */}
        <label className="char-profile-label">Description</label>
        <MiniRichText
          value={prof.description}
          onChange={(html) => upsertCharacterProfile(charName, { description: html })}
          minHeight={isModal ? 80 : 50}
        />

        {/* Backstory */}
        <label className="char-profile-label">Backstory</label>
        <MiniRichText
          value={prof.backstory}
          onChange={(html) => upsertCharacterProfile(charName, { backstory: html })}
          minHeight={isModal ? 100 : 60}
        />

        {/* Character Arc */}
        <label className="char-profile-label">Character Arc</label>
        <MiniRichText
          value={prof.arc || ''}
          onChange={(html) => upsertCharacterProfile(charName, { arc: html })}
          minHeight={isModal ? 80 : 50}
        />

        {/* User-defined fields — below Character Arc (batch-v4 #3) */}
        {renderCustomFields(charName)}

        {/* Voice Profile moved to a photo-row toggle (batch-v5 #4); its
            fields render under the photo with the other section blocks. */}

        {/* v4.88, Derek: the swatch row is GONE. A character's color had TWO
            controls — the picker beside the name and this row of circles at
            the foot of the record — which is one colour with two places to set
            it, and the second was the one you never saw. The picker by the
            name stays as the single source. */}
        <div className="char-profile-color-highlight">
          <div className="char-profile-highlight-inline">
            <label className="char-profile-label" style={{ marginBottom: 0 }}>Highlight</label>
            <button
              className={`char-profile-highlight-btn${prof.highlighted ? ' active' : ''}`}
              onClick={() => upsertCharacterProfile(charName, { highlighted: !prof.highlighted })}
              style={prof.highlighted ? { background: prof.color || '#999', borderColor: prof.color || '#999' } : undefined}
            >
              {prof.highlighted ? 'On' : 'Off'}
            </button>
          </div>
        </div>

      </>
    );
  };

  const { shouldRender: gateRender, animationState } = useDelayedUnmount(characterProfilesOpen, 250);
  const shouldRender = embedded || gateRender;
  const panelRef = useRef<HTMLDivElement>(null);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: toggleCharacterProfiles, enabled: !embedded && shouldRender && !isFullscreen });

  if (!shouldRender) return null;

  const panelClass = embedded
    ? 'panel-open'
    : (!isFullscreen && animationState === 'entered'
      ? 'panel-open' : animationState === 'exiting' ? 'panel-closing' : '');

  return (
    // v4.41, Derek: NO per-shape restyling — the char-profiles-fullscreen /
    // char-fs-list-mode classes (a bespoke flat borderless look the takeover
    // wore) are gone, so docked, popped-out, and fullscreen all render the
    // SAME body. isFullscreen still gates behavior (headers, swipe, style).
    <div ref={panelRef} className={`char-profiles-panel${embedded ? ' char-profiles-embedded' : ''} ${panelClass}`} style={isFullscreen ? undefined : style}>
      {/* Hidden file input for image uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      {/* (v4.35: the fullscreen header rows are gone — the generic
          ToolFullscreenTakeover provides row 1 and row 2 for every tool.) */}
      {/* Legacy slide-in overlay (context menu → Character Profile...): no
          window frame, so it keeps its own header + tabs (+ toolbar below). */}
      {!isFullscreen && !embedded && (
        <>
          <div className="char-profiles-header">
            <span className="char-profiles-title">Characters</span>
            <span className="char-profiles-count">{allCharacters.length}</span>
            <button
              className="char-profiles-fullscreen-btn"
              onClick={() => useEditorStore.getState().enterToolFullscreen('characters')}
              title="Fullscreen"
            >
              <FullscreenIcon />
            </button>
            <button className="char-profiles-close" onClick={() => { toggleCharacterProfiles(); }} title="Close">
              &times;
            </button>
          </div>
          <div className="char-profiles-tabs">
            <ChromeTabs tabs={charTabs} />
          </div>
        </>
      )}

      {/* v4.20: Relationships tab — an editable list of every relationship.
          v4.23: List/Map toggle folds the old "Relationship Map" tab in here. */}
      {/* v4.24 batch 4: every tab's body sits on a shared "surface" layer —
          the same color as the active tab, so the tab connects to it. The
          panel behind uses the workspace color; cards are a third layer. */}
      {activeTab === 'relationships' && (
        <div className="char-tab-surface">
        <CharacterRelationshipsTab
          relViewMode={relViewMode}
          currentScriptId={currentScriptId}
          characterRelationships={visibleRelationships}
          upsertCharacterRelationship={upsertCharacterRelationship}
          deleteCharacterRelationship={deleteCharacterRelationship}
          existingCharNames={existingCharNames}
          onSelectCharacter={(name) => {
            setActiveTab('profiles');
            setSelectedCharacter(name);
            setExpandedChar(name);
            setModalChar(name);
          }}
        />
        </div>
      )}

      {/* Profiles tab content */}
      {activeTab === 'profiles' && <div className="char-tab-surface">

      {/* v4.27: search/sort/view live in the row-2 cluster now (frame or
          fullscreen header) — this toolbar remains only for the frameless
          legacy overlay. */}
      {!embedded && !isFullscreen && (
      <div className="char-profiles-toolbar">
        <input
          type="text"
          placeholder="Search characters..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="char-profiles-search-input"
        />
        <div className="char-profiles-sort">
          <span className="char-sort-label">Sort</span>
          <select
            className="char-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="name">Name</option>
            <option value="importance">Importance</option>
            <option value="scenes">Scenes</option>
            <option value="dialogues">Dialogues</option>
            <option value="appearance">Appearance</option>
          </select>
        </div>
      </div>
      )}

      {/* Character list — v4.41: the view mode rides the container so ONE
          stylesheet serves every shape: cards = a responsive auto-fill grid
          (one column in a 300px panel — the familiar docked look — more
          columns as the window or fullscreen widens); list = stacked rows.
          v6.11, Derek: the LIST view is the same table the Scenes and
          Locations lists use — shared .location-header grid, the name
          column drag-resized through the shared sceneColWidths store. */}
      <div
        ref={listRootRef}
        className={`char-profiles-list char-view-${viewMode}`}
        style={{ ['--char-col-name' as string]: `${charNameW}px` }}
      >
        {viewMode === 'list' && allCharacters.length > 0 && (
          <div className="location-list-header location-header">
            <span className="location-chevron" />
            <span className="location-name">
              Character
              <span className="scene-col-grip" title="Drag to resize" onPointerDown={startCharColResize} />
            </span>
            <span className="location-desc-head">Description</span>
            <span className="location-times" />
          </div>
        )}
        {allCharacters.length === 0 ? (
          <div className="char-profiles-empty">
            {searchQuery
              ? 'No characters match your search.'
              : 'No characters detected. Add character elements to your script.'}
          </div>
        ) : (
          allCharacters.map((name) => {
            const profile = getProfile(name);
            const stats = charStats.get(name);
            // v4.18: in LIST view, cards start minimized (a bar with name +
            // key stats) and expand on click; Cards view stays expanded.
            // v4.27: the View choice applies everywhere, not just fullscreen.
            const isCardsView = viewMode === 'cards';
            const isExpanded = isCardsView || expandedChar === name;
            const isOrphaned = orphanedNames.has(name);
            const primaryImageId = profile.images?.[0];

            return (
              <div key={name} data-char-name={name} className={`char-profile-card${isOrphaned ? ' char-orphaned' : ''}${isExpanded ? ' char-profile-expanded' : ''}`}>
                {/* Orphaned banner */}
                {isOrphaned && (
                  <div className="char-orphaned-banner">
                    <span>Not in script</span>
                    <button
                      className="char-orphaned-remove"
                      onClick={() => setPendingRemoveChar(name)}
                    >
                      Remove
                    </button>
                  </div>
                )}
                {/* Header row — v6.11, Derek: the LIST view renders the SAME
                    table row the Scenes and Locations lists use (shared
                    .location-header grid); Cards view keeps the card bar. */}
                {!isCardsView ? (
                  <div className="location-header" onClick={() => setExpandedChar(isExpanded ? null : name)}>
                    <span className="location-chevron">{isExpanded ? <FaChevronDown /> : <FaChevronRight />}</span>
                    <span className="location-name" title={name}>{name}</span>
                    {/* One description per character, two doors: this writes
                        the same profile field the expanded editor does
                        (plain text — inline edits drop rich formatting). */}
                    <input
                      className="scene-synopsis-field location-desc-field"
                      placeholder="Description..."
                      value={stripHtml(profile.description || '')}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => upsertCharacterProfile(name, { description: e.target.value })}
                    />
                    <span className="location-times">
                      Times used:
                      <span className="location-scene-count">{stats?.sceneCount ?? 0}</span>
                    </span>
                  </div>
                ) : (
                <div
                  className="char-profile-row"
                  onClick={() => setExpandedChar(isExpanded ? null : name)}
                >
                  {/* v4.20: left caret makes it clear the row toggles open (not
                      in Cards mode, where cards are always expanded). */}
                  {!isCardsView && (
                    <span className="char-profile-caret" aria-hidden>{isExpanded ? <FaChevronDown /> : <FaChevronRight />}</span>
                  )}
                  {/* Avatar: show primary image or color swatch */}
                  {primaryImageId && projectId ? (
                    <span onClick={(e) => e.stopPropagation()}>
                      <AssetImage projectId={projectId} assetId={primaryImageId} alt={name} className="char-profile-avatar" />
                    </span>
                  ) : (
                    <input
                      type="color"
                      className="char-profile-color"
                      value={profile.color || '#999999'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => upsertCharacterProfile(name, { color: e.target.value })}
                      title="Highlight color"
                    />
                  )}
                  <div className="char-profile-name-col">
                    <span
                      className="char-profile-name"
                      onClick={(e) => { e.stopPropagation(); handleNavigateToCharacter(name); }}
                      title="Click to navigate to first appearance"
                    >
                      {name}
                    </span>
                    {/* v4.23, Derek: scene appearances live next to the name now,
                        not only in the right-hand stats cluster. */}
                    {stats && stats.sceneCount > 0 && (
                      <span className="char-profile-appears" title={`Appears in ${stats.sceneCount} scenes`}>
                        Appears in {stats.sceneCount} scene{stats.sceneCount === 1 ? '' : 's'}
                      </span>
                    )}
                    {profile.description && !isExpanded && (() => {
                      const plain = stripHtml(profile.description);
                      return plain ? (
                        <span className="char-profile-desc-preview">
                          {plain.slice(0, 50)}{plain.length > 50 ? '...' : ''}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  {/* v4.22, Derek: the header's right-side cluster — its inner
                      spacing is a Design-window knob (--dz-char-header-gap). */}
                  <div className="char-profile-header-right">
                  <div className="char-profile-stats">
                    {stats && (
                      <span title={`${stats.dialogueCount} dialogue lines`}>{stats.dialogueCount} lines</span>
                    )}
                  </div>
                  {/* Profile completeness indicator */}
                  {(() => {
                    const comp = getProfileCompleteness(profile);
                    const color = comp.pct === 0 ? 'var(--fd-text-muted, #666)'
                      : comp.pct < 40 ? '#f44336'
                      : comp.pct < 70 ? '#ff9800'
                      : comp.pct < 100 ? '#4caf50'
                      : '#2e7d32';
                    return (
                      <div className="char-profile-completeness">
                        <svg width="22" height="22" viewBox="0 0 22 22">
                          <circle cx="11" cy="11" r="9" fill="none" stroke="var(--fd-border, #333)" strokeWidth="2" />
                          <circle
                            cx="11" cy="11" r="9" fill="none"
                            stroke={color} strokeWidth="2"
                            strokeDasharray={`${comp.pct * 0.5655} 56.55`}
                            strokeLinecap="round"
                            transform="rotate(-90 11 11)"
                          />
                        </svg>
                        <span className="char-profile-completeness-label" style={{ color }}>
                          {comp.pct}%
                        </span>
                        <div className="char-completeness-tooltip">
                          <div className="char-completeness-tooltip-title">Profile: {comp.filled}/{comp.total}</div>
                          {comp.fields.map((f) => (
                            <div key={f.label} className={`char-completeness-tooltip-row${f.filled ? ' filled' : ''}`}>
                              <span>{f.filled ? '\u2713' : '\u2717'}</span> {f.label}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {/* v4.88, Derek: no enlarge button in the LIST view — the
                      caret already opens the full profile inline there, so it
                      was a second control for the same job. Cards view keeps
                      it: cards show the essentials only, and this is the only
                      way from a card to the whole record. */}
                  {isCardsView && (
                    <button
                      className="char-profile-enlarge-btn"
                      onClick={(e) => { e.stopPropagation(); setModalChar(name); }}
                      title="Expand this character into a larger window"
                    >
                      <ExpandIcon />
                    </button>
                  )}
                  </div>
                </div>
                )}

                {/* Expanded detail (v4.24 batch 3, reworked v4.25, Derek):
                    Cards view — always expanded — shows the ESSENTIALS only:
                    name, photo (footprint reserved), two-line description,
                    gender/age; the header's enlarge icon opens the full modal.
                    Toggling the caret in the list contexts (side panel and
                    fullscreen List) shows the FULL profile inline via
                    renderCharacterFields — the one shared renderer, also used
                    by the modal — so the two can never drift. No Full Info
                    button anywhere; the enlarge icon does that job. */}
                {isExpanded && (
                  <div className={`char-profile-detail${isCardsView ? ' char-profile-detail-fs' : ''}`}>
                    {isCardsView ? (
                      <div className="char-profile-detail-top char-profile-detail-stacked">
                        {renderNameFields(name)}
                        {renderImageSection(name, true)}
                        {/* v4.26 batch-v4 #2: meta row ABOVE Description */}
                        {renderMetaRow(name)}
                        <label className="char-profile-label">Description</label>
                        {/* minHeight 0 = no inline min-height, so the 2-line
                            clamp (CSS) sizes the box; focus restores editing
                            room via the :focus-within rule. A fixed 50px here
                            left a half-clipped third line painting under the
                            ellipsis. */}
                        <MiniRichText
                          value={profile.description}
                          onChange={(html) => upsertCharacterProfile(name, { description: html })}
                          minHeight={0}
                        />
                      </div>
                    ) : (
                      renderCharacterFields(name, false)
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

      </div>

      </div>}
      {/* End of profiles tab */}

      {/* v4.23, Derek: "From Script" tab — one "Scan Script" section. The scan
          lists every character it finds (speaking cues + the ALL-CAPS "referred"
          names that used to be a separate list) with a description/age pulled from
          the action line that introduces them; the writer adds the ones they want.
          It replaces the old auto-creating "Build from Script" and the separate
          "Referred in Script" section — both are folded in here. */}
      {activeTab === 'setup' && (
        <div className="char-tab-surface">
        <CharacterScanTab
          scanResults={scanResults}
          visibleScanResults={visibleScanResults}
          existingCharNames={existingCharNames}
          onApply={applyScanResult}
          onClassifyReferred={handleClassifyReferred}
        />
        </div>
      )}

      {/* Image Picker Overlay */}
      {imagePickerFor && (
        <CharacterImagePickerDialog
          forName={imagePickerFor}
          filter={imagePickerFilter}
          setFilter={setImagePickerFilter}
          imageAssets={imageAssets}
          linkedImageIds={characterProfiles.find((p) => p.name === imagePickerFor)?.images || []}
          projectId={projectId}
          onAssociate={(assetId) => handleAssociateAsset(imagePickerFor, assetId)}
          onClose={() => { setImagePickerFor(null); setImagePickerFilter(''); }}
        />
      )}

      {/* Image Lightbox */}
      {/* v4.26 batch-v5 #3: the image/placeholder opens this source menu
          (the zoom lightbox left with the old image-click behavior). */}
      {imgMenu && (
        <ImageSourceMenu
          pos={imgMenu.pos}
          onLocal={() => triggerUpload(imgMenu.charName)}
          onAssets={() => { setImagePickerFor(imgMenu.charName); setImagePickerFilter(''); }}
          onRemove={imgMenu.removeAssetId ? () => {
            handleRemoveImage(imgMenu.charName, imgMenu.removeAssetId!);
            setImgIdx((m) => ({ ...m, [imgMenu.charName]: 0 }));
          } : undefined}
          onClose={() => setImgMenu(null)}
        />
      )}

      {/* Per-character enlarge modal */}
      {modalChar && (
        <div className="char-modal-overlay" onClick={() => setModalChar(null)}>
          <div className="char-modal-detail" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              {modalChar}
              <button className="char-profiles-close" onClick={() => setModalChar(null)}>&times;</button>
            </div>
            <div className="char-modal-body">
              {renderCharacterFields(modalChar, true)}
            </div>
          </div>
        </div>
      )}

      {pendingRemoveChar && (
        <div className="dialog-overlay" onClick={() => setPendingRemoveChar(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Remove Character</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>Remove &ldquo;{pendingRemoveChar}&rdquo; from the character list?</p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingRemoveChar(null)}>Cancel</button>
              <button
                className="dialog-btn dialog-btn-primary"
                style={{ background: '#c0392b' }}
                onClick={() => {
                  deleteCharacterProfile(pendingRemoveChar);
                  setPendingRemoveChar(null);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CharacterProfiles;
