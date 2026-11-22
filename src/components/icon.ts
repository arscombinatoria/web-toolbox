import { createElement, type IconNode } from 'lucide';

export function createIcon(icon: IconNode): SVGElement {
  return createElement(icon, {
    class: 'icon',
    width: 16,
    height: 16,
    'aria-hidden': 'true',
    focusable: 'false',
  });
}

export function setIconMessage(element: Element, icon: IconNode, message: string): void {
  element.replaceChildren(createIcon(icon), message);
}
