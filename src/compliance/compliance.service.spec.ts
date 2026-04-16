import { ExecutionLoopPhase } from '../contracts/execution-loop-phase';
import { MachineKind } from '../state-machine/types/machine-kind';
import { CallMachineState } from '../state-machine/definitions/call-machine.definition';
import { ComplianceBlockedError } from './compliance.errors';
import { ComplianceService } from './compliance.service';

describe('ComplianceService', () => {
  function makeService(overrides?: { count?: number }) {
    const tenantPolicies = {
      findOneBy: jest.fn().mockResolvedValue({
        tenantId: 't1',
        enabled: true,
        callWindowStartHourLocal: 9,
        callWindowEndHourLocal: 20,
        maxCallAttemptsFromInitiated: 2,
      }),
    };
    const transitions = {
      count: jest.fn().mockResolvedValue(overrides?.count ?? 0),
    };
    const executionFlags = {
      isJsonTruthy: jest.fn().mockResolvedValue(false),
    };
    return {
      svc: new ComplianceService(
        tenantPolicies as never,
        transitions as never,
        executionFlags as never,
      ),
      transitions,
    };
  }

  it('blocks opted-out borrower before retry-count reads', async () => {
    const { svc, transitions } = makeService();
    await expect(
      svc.assertCompliant({
        tenantId: 't1',
        correlationId: 'c1',
        executionPhase: ExecutionLoopPhase.CALL,
        proposedMachine: MachineKind.CALL,
        proposedFrom: CallMachineState.INITIATED,
        borrowerOptedOut: true,
      }),
    ).rejects.toBeInstanceOf(ComplianceBlockedError);
    expect(transitions.count).not.toHaveBeenCalled();
  });

  it('blocks when call retry limit is exceeded', async () => {
    const { svc } = makeService({ count: 2 });
    await expect(
      svc.assertCompliant({
        tenantId: 't1',
        correlationId: 'c1',
        executionPhase: ExecutionLoopPhase.CALL,
        proposedMachine: MachineKind.CALL,
        proposedFrom: CallMachineState.INITIATED,
        borrowerOptedOut: false,
      }),
    ).rejects.toBeInstanceOf(ComplianceBlockedError);
  });
});
