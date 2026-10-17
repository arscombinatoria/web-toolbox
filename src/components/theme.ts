export type ThemePreference = 'system' | 'light' | 'dark';

export function setupTheme(select: HTMLSelectElement): () => void {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const initial = root.dataset.theme;
  let preference: ThemePreference = initial === 'light' || initial === 'dark' ? initial : 'system';
  select.value = preference;

  const apply = () => {
    root.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  };
  const change = () => {
    const value = select.value;
    if (value !== 'system' && value !== 'light' && value !== 'dark') return;
    preference = value;
    apply();
    try {
      if (preference === 'system') localStorage.removeItem('web-toolbox-theme');
      else localStorage.setItem('web-toolbox-theme', preference);
    } catch { /* 保存できなくても現在の選択は維持する。 */ }
  };
  media.addEventListener('change', apply);
  select.addEventListener('change', change);
  apply();
  return () => {
    media.removeEventListener('change', apply);
    select.removeEventListener('change', change);
  };
}
