import { mountReading } from './renderer.mjs';
import { mountPoster } from './poster.mjs';
import { mountPanel } from './panel.mjs';
import { createIntegration } from './integration.mjs';

const label = (zh, en) => ({ 'zh-CN': zh, en: en || zh });

export default function activate(folium) {
  if (folium.host.folium.minor < 4) throw new Error('本模组需要 Folium 1.4 / Folia 0.7.12');

  const section = folium.registries.settingsSections.register({
    id: 'display',
    label: label('双语 · 注音歌词', 'Bilingual & ruby lyrics'),
    // Switches only: Folia draws a mod's "select" setting as a bare system dropdown, which does
    // not match the rest of its settings.
    settings: [
      { key: 'translationFirst', type: 'boolean', label: label('译文为主', 'Translation first'), description: label('大字显示译文，原文放在下面。关闭时大字显示原文。', 'Show the translation large, with the original below it. When off, the original is the large line.'), defaultValue: false },
      { key: 'bilingual', type: 'boolean', label: label('双语显示', 'Show both languages'), defaultValue: true },
      { key: 'ruby', type: 'boolean', label: label('显示注音', 'Show ruby annotations'), defaultValue: true },
      { key: 'caption', type: 'boolean', label: label('注音字幕条', 'Ruby caption'), description: label('使用 Folia 自带的显示模式时，在画面上加一条带注音的当前歌词。只对有内嵌注音的歌生效。', 'While one of the display modes built into Folia is in use, adds the line being sung with its readings as a caption. Only for songs with embedded readings.'), defaultValue: false },
      { key: 'captionTop', type: 'boolean', label: label('字幕条放在顶部', 'Caption at the top'), description: label('关闭时放在底部，Folia 自己的字幕上方。', 'When off, the caption sits at the bottom, above the subtitles of Folia.'), defaultValue: false },
      {
        key: 'poster',
        type: 'boolean',
        label: label('海报歌词（实验性）', 'Poster lyrics (experimental)'),
        description: label('在展开的海报卡片上也用本模组的歌词。Folia 没有为此提供接口，开启后模组会直接修改 Folia 页面里的海报卡片；Folia 更新后可能失效。', 'Also draw these lyrics on the expanded poster card. Folia has no interface for this, so the mod edits the poster card in the host page directly; it may stop working after a Folia update.'),
        defaultValue: false,
      },
    ],
  });
  const params = section.params;

  folium.registries.visualizers.register({
    id: 'reading',
    label: label('双语 · 注音歌词', 'Bilingual & ruby lyrics'),
    order: 510,
    hostLayers: { background: true, subtitles: false },
    mount: (container, ctx) => mountReading(container, ctx, folium, params),
  });

  if (folium.env.context !== 'main') return undefined;

  // Reads the Ruby lyrics embedded in the playing MP3 and hands them to the host's lyric state.
  const integration = createIntegration(folium);

  folium.registries.stageLayers.register({
    id: 'poster-lyrics',
    slot: 'app.overlay',
    interactive: false,
    // Mounted only while the setting is on; turning it off removes everything it added.
    mount: (container, ctx) => {
      let dispose = null;
      const sync = () => {
        const wanted = params.get().poster === true;
        if (wanted && !dispose) dispose = mountPoster(container, ctx, folium, params);
        else if (!wanted && dispose) { dispose(); dispose = null; }
      };
      sync();
      const unsubscribe = params.subscribe(sync);
      return () => { unsubscribe(); dispose?.(); dispose = null; };
    },
  });
  // The display modes built into Folia do not draw readings; this caption does, on top of them.
  const OWN_MODE = 'mod:bilingual-ruby-lyrics:reading';
  const modeStore = folium.internals.stores.visualizerSettings;
  const hasReadings = lines => lines.some(line => line.words?.some(word => word.syllables?.some(unit => unit.ruby?.length)));
  folium.registries.stageLayers.register({
    id: 'ruby-caption',
    slot: 'player.stage.front',
    interactive: false,
    mount: (container, ctx) => {
      if (!hasReadings(ctx.lines)) return () => {};
      let dispose = null, shown = null;
      const sync = () => {
        const values = params.get(), position = values.caption === true ? (values.captionTop === true ? 'top' : 'bottom') : null;
        const wanted = position && modeStore?.getState().visualizerMode !== OWN_MODE ? position : null;
        if (wanted === shown) return;
        dispose?.(); dispose = null; shown = wanted;
        if (wanted) dispose = mountReading(container, ctx, folium, params, { strip: wanted });
      };
      sync();
      const unsubscribe = params.subscribe(sync), unsubscribeMode = modeStore?.subscribe(sync);
      return () => { unsubscribe(); unsubscribeMode?.(); dispose?.(); dispose = null; };
    },
  });
  folium.registries.playerPanelTabs.register({
    id: 'lyrics',
    label: label('双语 · 注音歌词', 'Bilingual & ruby lyrics'),
    order: 510,
    mount: container => mountPanel(container, params),
  });
  const toggle = (key, id, zh, en, keywords, fallback) => folium.registries.commands.register({
    id,
    label: label('切换' + zh, 'Toggle ' + en),
    keywords,
    run: () => {
      const enabled = !(params.get()[key] ?? fallback);
      params.set({ [key]: enabled });
      return (enabled ? '已开启' : '已关闭') + zh;
    },
  });
  toggle('bilingual', 'toggle-bilingual', '双语显示', 'bilingual lyrics', ['bilingual', '双语', '译文'], true);
  toggle('ruby', 'toggle-ruby', '注音显示', 'ruby annotations', ['ruby', 'furigana', '假名', '注音'], true);

  return () => integration.dispose();
}
