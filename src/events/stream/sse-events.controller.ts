import { Controller, MessageEvent, Query, Sse } from '@nestjs/common';
import { Observable, interval, merge, Subject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { TenantEventStreamService } from './tenant-event-stream.service';

@Controller('api/v1/events')
export class SseEventsController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly tenantEventStream: TenantEventStreamService,
  ) {}

  /**
   * SSE stream of DOMAIN_EVENT, STATE_TRANSITION, and WEBHOOK_EVENT for the active tenant.
   * Optional `correlationId` narrows events to that case id (still tenant-scoped in storage).
   */
  @Sse('stream')
  eventStream(@Query('correlationId') correlationId?: string): Observable<MessageEvent> {
    const tenantId = this.tenantContext.getRequired().trim();
    const c = correlationId?.trim();
    const stop$ = new Subject<void>();
    const bus$ = new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.tenantEventStream.subscribe(tenantId, (payload) => {
        if (c) {
          const pc = payload.correlationId?.trim();
          if (pc && pc !== c) {
            return;
          }
        }
        subscriber.next(this.tenantEventStream.toMessageEvent(payload));
      });
      return () => {
        unsubscribe();
        stop$.next();
        stop$.complete();
      };
    });
    const ping$ = interval(25_000).pipe(
      map(
        () =>
          ({
            type: 'ping',
            data: JSON.stringify({ envelope: 'HEARTBEAT', tenantId }),
          }) as MessageEvent,
      ),
      takeUntil(stop$),
    );
    return merge(bus$, ping$);
  }
}
