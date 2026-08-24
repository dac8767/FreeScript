// @vitest-environment jsdom
/**
 * v5.25: the Markups tool window rendered for real — the two worst bug
 * classes here are a filter that silently shows the wrong set and a card
 * that renders without its location line. Editor-less render (editor: null)
 * is also the orphan path: every markup shows, marked "location removed".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import MarkupsPanel from './MarkupsPanel';
import { useEditorStore } from '../stores/editorStore';
import { EMPTY_MARKUP_FILTERS, type ScriptMarkup } from '../stores/slices/markupsSlice';

const mk = (id: string, over: Partial<ScriptMarkup> = {}): ScriptMarkup => ({
  id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `text of ${id}` }] }] },
  icon: 'flag', color: '#e05555', highlight: null,
  anchor: 'point', done: false, createdAt: '2026-07-29T00:00:00.000Z', ...over,
});

let container: HTMLDivElement;
let root: Root;

const renderPanel = () => act(() => { root.render(<MarkupsPanel editor={null} />); });
const cardTexts = () =>
  [...container.querySelectorAll('.markup-card-text')].map((el) => el.textContent);

describe('MarkupsPanel', () => {
  beforeEach(() => {
    useEditorStore.setState({ markups: [], markupEditorId: null, markupFilters: EMPTY_MARKUP_FILTERS, markupSearch: '' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows only OPEN markups by default; All reveals completed ones', () => {
    useEditorStore.setState({ markups: [mk('a'), mk('b', { done: true })] });
    renderPanel();
    expect(cardTexts()).toEqual(['text of a']);

    act(() => { useEditorStore.setState({ markupFilters: { ...EMPTY_MARKUP_FILTERS, done: 'all' } }); });
    expect(cardTexts()).toEqual(['text of a', 'text of b']);
  });

  it('a type unchecked in the Filter grid (hiddenIcons) drops from the list', () => {
    useEditorStore.setState({
      markups: [mk('a'), mk('b', { icon: 'star' })],
      markupFilters: { ...EMPTY_MARKUP_FILTERS, hiddenIcons: ['flag'] },
    });
    renderPanel();
    expect(cardTexts()).toEqual(['text of b']);
  });

  it('search narrows by text (v5.26)', () => {
    useEditorStore.setState({ markups: [mk('a'), mk('b')], markupSearch: 'of b' });
    renderPanel();
    expect(cardTexts()).toEqual(['text of b']);
  });

  it('double-click on an orphan card opens its editor popover (v5.26 #13)', () => {
    useEditorStore.setState({ markups: [mk('a')] });
    renderPanel();
    const card = container.querySelector('.markup-card') as HTMLElement;
    act(() => { card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(useEditorStore.getState().markupEditorId).toBe('a');
  });

  it('cards carry a ⋮ menu and no pencil/trash buttons (v5.26 #11/#13)', () => {
    useEditorStore.setState({ markups: [mk('a')] });
    renderPanel();
    expect(container.querySelector('.markup-dots-btn')).toBeTruthy();
    expect(container.querySelector('.markup-card-btn')).toBeNull();
  });

  it('without an editor a markup is listed with its orphan location line', () => {
    useEditorStore.setState({ markups: [mk('a')] });
    renderPanel();
    expect(container.querySelector('.markup-card-meta')?.textContent).toBe('location removed from script');
  });

  /** v5.27, Derek: the card checkbox is GONE — status lives in the ⋮ menu.
   *  Completing (via the store the menu drives) still drops the card from
   *  the default open-only view. */
  it('no card checkbox; completing via status drops it from the open view', () => {
    useEditorStore.setState({ markups: [mk('a')] });
    renderPanel();
    expect(container.querySelector('.markup-card-check')).toBeNull();
    act(() => { useEditorStore.getState().updateMarkup('a', { done: true }); });
    expect(cardTexts()).toEqual([]);
  });

  it('the empty state is Derek\'s v7.81 wording, not the old how-to', () => {
    renderPanel();
    expect(container.querySelector('.markups-empty')?.textContent).toBe('No annotations yet.');
  });
});
