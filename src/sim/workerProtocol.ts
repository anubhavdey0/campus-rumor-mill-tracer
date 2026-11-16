import type { Campus } from './campus';
import type { Point } from './layout';
import type { RerunResult, TippingPoint } from './rerun';
import type { RumorTemplate } from './rumor';
import type { Algorithm, FactChecker, SpreadParams } from './spread';

interface Scenario {
  campus: Campus;
  template: RumorTemplate;
  source: number;
  params: SpreadParams;
  checker: FactChecker | null;
}

export type WorkerRequest =
  | { id: number; type: 'layout'; campus: Campus; aspect: number }
  | ({ id: number; type: 'rerun'; runs: number } & Scenario)
  | ({ id: number; type: 'curve' } & Scenario)
  | { id: number; type: 'reach'; campus: Campus; template: RumorTemplate; algorithm: Algorithm; params: SpreadParams };

export type WorkerResult = Point[] | RerunResult | TippingPoint[] | number[];

export type WorkerResponse = { id: number; result: WorkerResult };
