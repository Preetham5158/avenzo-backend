# Realtime Architecture Plan

## Decision
Use SSE (Server-Sent Events) first for real-time order updates and kitchen board.
WebSocket only when delivery/location tracking requires bidirectional streaming.

## Planned Module
apps/api/src/modules/realtime/
  realtime.routes.ts
  realtime.service.ts
  order-events.service.ts
  kitchen-events.service.ts

## SSE Events Planned
- order:status_changed — customer tracking page
- order:new — restaurant kitchen board
- order:payment_confirmed — kitchen/cashier

## Client Usage
Customer mobile/web: EventSource /api/v1/customer/orders/:token/events
Restaurant mobile/web: EventSource /api/v1/restaurant/events?restaurantId=xxx

## Status
Not yet implemented. Build when Next.js/Expo apps are active.
