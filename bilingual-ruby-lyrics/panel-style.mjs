// Folia 0.7.12: UnifiedPanel owns p-5; SettingsToggle and VisualizerPresetGroup
// define 48x24 switches, themed pill choices and density. Styles stay in shadow DOM.
export const PANEL_CSS = `
  .lyrics-panel { color:var(--folium-primary); font:14px/1.5 var(--folium-font,sans-serif); display:flex; flex-direction:column; gap:24px; min-width:0; }
  .lyrics-panel * { box-sizing:border-box; }
  .lyrics-panel h2 { margin:0; font-size:14px; font-weight:600; }
  .lyrics-panel .display { display:flex; flex-direction:column; gap:16px; }
  .lyrics-panel .field { display:flex; flex-direction:column; gap:8px; min-width:0; }
  .lyrics-panel .row { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:28px; }
  .lyrics-panel .field-label { font-size:12px; font-weight:500; color:var(--folium-secondary); }
  .lyrics-panel .choices { display:flex; gap:8px; }
  .lyrics-panel button { appearance:none; cursor:pointer; font:inherit; color:inherit; }
  .lyrics-panel .pill { flex:1; border:1px solid color-mix(in srgb,var(--folium-secondary) 18%,transparent); border-radius:999px; padding:8px 12px; font-size:14px; line-height:1.4; background:color-mix(in srgb,var(--folium-bg) 30%,transparent); transition:background-color 150ms,border-color 150ms; }
  .lyrics-panel .pill:hover { background:color-mix(in srgb,var(--folium-primary) 8%,transparent); }
  .lyrics-panel .pill:active { background:color-mix(in srgb,var(--folium-primary) 12%,transparent); }
  .lyrics-panel .pill[aria-pressed=true] { background:color-mix(in srgb,var(--folium-accent) 12%,transparent); border-color:var(--folium-accent); box-shadow:inset 0 0 0 1px var(--folium-accent); }
  .lyrics-panel .switch { flex:none; width:48px; height:24px; padding:4px; border:0; border-radius:999px; background:color-mix(in srgb,var(--folium-primary) 10%,transparent); transition:background-color 150ms; }
  .lyrics-panel .switch::after { content:''; display:block; width:16px; height:16px; border-radius:50%; background:white; box-shadow:0 1px 2px #0002; transition:transform 150ms; }
  .lyrics-panel .switch[aria-checked=true] { background:var(--folium-secondary); }
  .lyrics-panel .switch[aria-checked=true]::after { transform:translateX(24px); }
  .lyrics-panel button:focus-visible { outline:2px solid var(--folium-accent); outline-offset:3px; }
  @media (prefers-reduced-motion:reduce) { .lyrics-panel button,.lyrics-panel .switch::after { transition:none; } }
`;
