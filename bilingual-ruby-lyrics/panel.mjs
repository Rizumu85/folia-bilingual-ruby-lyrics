import { PANEL_CSS } from './panel-style.mjs';

// The player tab mirrors this mod's own settings. Folia owns lyric sources, imports,
// timeline offsets and exports in its native UI.
export function mountPanel(container, params) {
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const root = document.createElement('div');
  root.className = 'lyrics-panel';
  root.innerHTML = `
    <h2>双语 · 注音歌词</h2>
    <section class="display" aria-label="双语和注音歌词设置">
      <div class="field">
        <span class="field-label" id="lyrics-primary-label">主要显示</span>
        <div class="choices" role="group" aria-labelledby="lyrics-primary-label">
          <button class="pill" type="button" data-language="original" aria-pressed="true">原文</button>
          <button class="pill" type="button" data-language="translation" aria-pressed="false">译文</button>
        </div>
      </div>
      <div class="row">
        <span id="lyrics-bilingual-label">双语显示</span>
        <button class="switch" type="button" role="switch" aria-labelledby="lyrics-bilingual-label" aria-checked="true" data-switch="bilingual"></button>
      </div>
      <div class="row">
        <span id="lyrics-ruby-label">显示注音</span>
        <button class="switch" type="button" role="switch" aria-labelledby="lyrics-ruby-label" aria-checked="true" data-switch="ruby"></button>
      </div>
      <div class="row">
        <span id="lyrics-romaji-label">显示罗马音</span>
        <button class="switch" type="button" role="switch" aria-labelledby="lyrics-romaji-label" aria-checked="false" data-switch="romaji"></button>
      </div>
      <div class="row">
        <span id="lyrics-poster-label">海报歌词（实验性）</span>
        <button class="switch" type="button" role="switch" aria-labelledby="lyrics-poster-label" aria-checked="false" data-switch="poster"></button>
      </div>
    </section>`;

  // bilingual and ruby are on unless turned off; romanization and the poster override are off unless turned on
  const isOn = (values, key) => key === 'poster' || key === 'romaji' ? values[key] === true : values[key] !== false;
  const refresh = () => {
    const values = params.get();
    const primary = values.primary || 'original';
    for (const button of root.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === primary));
    for (const button of root.querySelectorAll('[data-switch]')) button.setAttribute('aria-checked', String(isOn(values, button.dataset.switch)));
  };
  for (const button of root.querySelectorAll('[data-language]')) button.addEventListener('click', () => params.set({ primary: button.dataset.language }));
  for (const button of root.querySelectorAll('[data-switch]')) button.addEventListener('click', () => params.set({ [button.dataset.switch]: !isOn(params.get(), button.dataset.switch) }));
  container.append(style, root);
  refresh();
  const unsubscribe = params.subscribe(refresh);
  return () => { unsubscribe(); root.remove(); style.remove(); };
}
