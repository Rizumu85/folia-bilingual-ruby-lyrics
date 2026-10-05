import { mountReading } from './renderer.mjs';

// Opt-in ("海报歌词" in the settings, off by default). Folia 0.7.12 has no registry for the
// lyrics drawn on the expanded poster card, so this adapter reaches into the host page: it adds
// one <style>, one child element and one marker attribute per poster, and watches the page for
// posters appearing. It is pinned to the host version through the manifest's "folia" range and
// removes everything it added when disposed.
// The public app.overlay context supplies the same lyric clock and theme as playback.
const SELECTOR = '.lattice-root .lattice-poster.is-current.is-expanded';
const MARKER = 'data-lyrics-display-split';
const CSS = `
  .lattice-root .lattice-poster[${MARKER}] > .lattice-lyrics { visibility:hidden; }
  .lattice-root .lattice-poster[${MARKER}] > .split-lyrics-poster { position:absolute; inset:128px 24px 110px; z-index:1; pointer-events:none; overflow:hidden; }
  .lattice-root .lattice-poster[${MARKER}] > .lattice-poster-copy { top:74px; bottom:auto; right:100px; }
  .lattice-root .lattice-poster[${MARKER}] > .lattice-poster-copy strong { max-width:100%; font-size:22px; line-height:1.2; -webkit-line-clamp:1; }
  .lattice-root .lattice-poster[${MARKER}] > .lattice-poster-copy small { font-size:13px; margin-top:2px; }
  @media (max-width:640px) {
    .lattice-root .lattice-poster[${MARKER}] > .split-lyrics-poster { top:160px; bottom:164px; }
    .lattice-root .lattice-poster[${MARKER}] > .lattice-poster-copy { top:112px; right:32px; }
  }
`;

export function mountPoster(_container, ctx, folium, params) {
  if (!ctx.lines.length || !ctx.song?.title) return () => {};
  const document = _container.ownerDocument;
  const style = document.createElement('style'); style.textContent = CSS;
  document.head.append(style);
  const mounted = new Map();
  let alive = true, queued = false;
  const remove = (poster, entry) => {
    entry.dispose(); entry.host.remove(); poster.removeAttribute(MARKER); mounted.delete(poster);
  };
  const reconcile = () => {
    queued = false;
    if (!alive) return;
    const candidates = new Set([...document.querySelectorAll(SELECTOR)].filter(poster =>
      // During a track transition the previous expanded card can still be in the DOM.
      poster.getAttribute('aria-label')?.startsWith(ctx.song.title + ' · ') &&
      poster.querySelector(':scope > .lattice-lyrics')
    ));
    for (const [poster, entry] of mounted) if (!candidates.has(poster)) remove(poster, entry);
    for (const poster of candidates) {
      if (mounted.has(poster) || poster.hasAttribute(MARKER)) continue;
      const host = document.createElement('div'); host.className = 'split-lyrics-poster';
      // Native sr-only text remains the card's accessible lyric; this is its visual rendition.
      host.setAttribute('aria-hidden', 'true'); poster.append(host);
      try {
        const dispose = mountReading(host.attachShadow({ mode:'open' }), ctx, folium, params, { poster:true });
        mounted.set(poster, { host, dispose }); poster.setAttribute(MARKER, '');
      } catch (error) { host.remove(); folium.log.error('poster lyrics: ' + (error?.message || error)); }
    }
  };
  const schedule = () => { if (alive && !queued) { queued = true; queueMicrotask(reconcile); } };
  const observer = new MutationObserver(records => {
    // Ignore our own painting (isolated in shadow DOM) and native canvas frame updates.
    if (records.some(record => record.type === 'childList' || record.target.matches?.('.lattice-poster, .lattice-root'))) schedule();
  });
  observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','aria-label'] });
  reconcile();
  return () => {
    alive = false; observer.disconnect();
    for (const [poster, entry] of mounted) remove(poster, entry);
    style.remove();
  };
}
