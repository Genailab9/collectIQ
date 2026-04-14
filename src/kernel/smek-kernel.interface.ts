import type { SmekLoopCommand, SmekLoopResult } from './smek-kernel.dto';

export interface SmekKernelPort {
  executeLoop(command: SmekLoopCommand): Promise<SmekLoopResult>;
}
