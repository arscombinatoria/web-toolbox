import { createDiagram } from './diagram';
import type { DiagramRequest, DiagramResponse } from './protocol';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<DiagramRequest>) => void) | null;
  postMessage: (message: DiagramResponse) => void;
};
scope.onmessage = ({ data }) => {
  scope.postMessage({ id: data.id, ...createDiagram(data.pattern, data.flags) });
};
