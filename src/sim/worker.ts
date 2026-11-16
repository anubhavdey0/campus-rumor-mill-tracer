/**
 * Background thread for the expensive jobs: laying out the map, rerunning the
 * spread with many different dice, sweeping a dial for the tipping-point
 * chart, and trying every student as the source. Keeping them here means
 * dragging a slider never freezes the page.
 */

import { layoutCampus } from './layout';
import { reachFromEach } from './network';
import { rerun, tippingCurve } from './rerun';
import type { WorkerRequest, WorkerResponse, WorkerResult } from './workerProtocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

function handle(request: WorkerRequest): WorkerResult {
  switch (request.type) {
    case 'layout':
      return layoutCampus(request.campus, request.aspect);
    case 'rerun':
      return rerun(request.campus, request.template, request.source, request.params, request.runs, request.checker);
    case 'curve':
      return tippingCurve(request.campus, request.template, request.source, request.params, request.checker);
    case 'reach':
      return reachFromEach(request.campus, request.template, request.algorithm, request.params);
  }
}

scope.onmessage = (event) => {
  scope.postMessage({ id: event.data.id, result: handle(event.data) });
};
