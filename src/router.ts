export function toolIdFromUrl(url: URL): string | null {
  return url.searchParams.get('tool');
}

export function toolUrl(id: string, current = new URL(window.location.href)): URL {
  const url = new URL(current);
  url.searchParams.set('tool', id);
  return url;
}

export function homeUrl(current = new URL(window.location.href)): URL {
  const url = new URL(current);
  url.searchParams.delete('tool');
  return url;
}

export function startRouter(onNavigate: (id: string | null, focus: boolean) => void): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-tool-id], a[data-home]') : null;
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname) return;
    event.preventDefault();
    const id = toolIdFromUrl(url);
    if (id !== toolIdFromUrl(new URL(location.href))) history.pushState(null, '', url);
    onNavigate(id, true);
  };
  const onPopState = () => onNavigate(toolIdFromUrl(new URL(location.href)), true);
  document.addEventListener('click', onClick);
  window.addEventListener('popstate', onPopState);
  onNavigate(toolIdFromUrl(new URL(location.href)), false);
  return () => {
    document.removeEventListener('click', onClick);
    window.removeEventListener('popstate', onPopState);
  };
}
