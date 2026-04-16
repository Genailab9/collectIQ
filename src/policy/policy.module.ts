import { Global, Module } from '@nestjs/common';
import { PolicyContextBuilderService } from './policy-context-builder.service';
import { PolicyDecisionAuditService } from './policy-decision-audit.service';
import { PolicyEnforcementService } from './policy-enforcement.service';
import { PolicyEvaluatorService } from './policy-evaluator.service';
import { PolicyModeService } from './policy-mode.service';

@Global()
@Module({
  providers: [
    PolicyEvaluatorService,
    PolicyContextBuilderService,
    PolicyDecisionAuditService,
    PolicyModeService,
    PolicyEnforcementService,
  ],
  exports: [
    PolicyEvaluatorService,
    PolicyContextBuilderService,
    PolicyDecisionAuditService,
    PolicyModeService,
    PolicyEnforcementService,
  ],
})
export class PolicyModule {}
