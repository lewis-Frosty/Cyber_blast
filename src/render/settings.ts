/** Renderer-level toggles (accessibility etc). Persisted per browser when possible. */
const KEY = 'cyber-blast.settings';

export interface RenderSettings {
  glyphMode: boolean;
  soundOn: boolean;
}

function load(): RenderSettings {
  const defaults: RenderSettings = { glyphMode: false, soundOn: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<RenderSettings>) };
  } catch {
    return defaults;
  }
}

export const renderSettings: RenderSettings = load();

export function saveRenderSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(renderSettings));
  } catch {
    /* storage unavailable — fine, settings just don't persist */
  }
}
