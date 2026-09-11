---
name: nestjs-rabbitmq
description: "Use when project uses NestJS with RabbitMQ microservices. Covers transport config, message/event patterns, manual ACK, CQRS, hybrid apps, dead letters, health checks, and testing. Detection: check package.json for @nestjs/microservices + amqplib or amqp-connection-manager."
---

# NestJS + RabbitMQ Microservices Standards

These standards apply when the project uses NestJS with RabbitMQ as a message transport. **Detection:** check `package.json` for `@nestjs/microservices` AND (`amqplib` OR `amqp-connection-manager`). If neither is present, this skill does not apply.

**Also read the `nestjs` stack skill** for core NestJS conventions (modules, services, controllers, DI, testing). This skill covers RabbitMQ-specific microservice patterns only.

## Transport Configuration

### Microservice Bootstrap

```typescript
// main.ts — pure microservice (no HTTP)
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
        transport: Transport.RMQ,
        options: {
            urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
            queue: 'orders_queue',
            queueOptions: {
                durable: true,         // survive broker restart
            },
            noAck: false,              // manual acknowledgment — ALWAYS
            prefetchCount: 1,          // process one message at a time
            persistent: true,          // messages survive broker restart
        },
    });

    await app.listen();
}
bootstrap();
```

### Hybrid Application (HTTP + Microservice)

When the same app serves both HTTP endpoints AND processes messages:

```typescript
// main.ts — hybrid app
async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.RMQ,
        options: {
            urls: [process.env.RABBITMQ_URL],
            queue: 'orders_queue',
            queueOptions: { durable: true },
            noAck: false,
            prefetchCount: 1,
        },
    });

    await app.startAllMicroservices();
    await app.listen(3000);
}
```

### Critical Configuration Rules

- **`noAck: false` ALWAYS.** Manual acknowledgment prevents message loss on crashes. Never use `noAck: true` in production.
- **`durable: true` on queues.** Queues survive broker restarts. Messages in durable queues are recovered.
- **`persistent: true` on messages.** Messages survive broker restarts when in durable queues.
- **`prefetchCount: 1`** for ordered processing. Increase for throughput when order doesn't matter.

## Connection Management

### Automatic reconnection

Use `amqp-connection-manager` for production deployments — it handles reconnection automatically:

```typescript
// In microservice bootstrap
const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL],
    queue: 'orders_queue',
    queueOptions: { durable: true },
    // Connection manager handles reconnection internally
    socketOptions: {
      heartbeatIntervalInSeconds: 30,
      reconnectTimeInSeconds: 5,
    },
  },
});
```

### Connection error handling

```typescript
// In main.ts after app creation
app.listen().then(() => {
  console.log('Microservice connected to RabbitMQ');
}).catch((err) => {
  console.error('Failed to connect to RabbitMQ:', err);
  process.exit(1);
});
```

### RPC Timeout handling

`send()` calls can hang indefinitely if the consumer is down. Always set a timeout:

```typescript
// In client module
ClientsModule.register([{
  name: 'ORDERS_SERVICE',
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL],
    queue: 'orders_queue',
    queueOptions: { durable: true },
  },
}]),

// In service — add timeout with rxjs
import { timeout, catchError } from 'rxjs';

@Injectable()
export class OrdersClientService {
  constructor(@Inject('ORDERS_SERVICE') private client: ClientProxy) {}

  getOrder(id: string): Observable<Order> {
    return this.client.send({ cmd: 'get_order' }, { id }).pipe(
      timeout(10_000), // 10 second timeout
      catchError(err => {
        if (err.name === 'TimeoutError') {
          throw new RequestTimeoutException('Order service did not respond within 10s');
        }
        throw err;
      }),
    );
  }
}
```

### Competing consumers (scaling)

To scale consumer throughput, run multiple instances of the same microservice. RabbitMQ distributes messages across consumers automatically (round-robin).

- Set `prefetchCount` to control how many unacknowledged messages each consumer holds
- Use `prefetchCount: 1` for fair dispatch (slow consumers don't get overloaded)
- Use `prefetchCount: 10-50` for throughput when processing is fast and order doesn't matter
- All instances connect to the same queue — no configuration change needed for horizontal scaling

## Message Patterns

### Request-Response (`@MessagePattern`)

Synchronous-style RPC where the sender waits for a response:

```typescript
// Consumer — handles the message and returns a response
@Controller()
export class OrdersController {
    constructor(private readonly orderService: OrderService) {}

    @MessagePattern('order.create')
    async createOrder(@Payload() data: CreateOrderDto, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();

        try {
            const order = await this.orderService.create(data);
            channel.ack(originalMsg);
            return order; // response sent back to producer
        } catch (error) {
            channel.nack(originalMsg, false, false); // reject, don't requeue
            throw new RpcException(error.message);
        }
    }

    @MessagePattern('order.get')
    async getOrder(@Payload() data: { id: string }, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();

        const order = await this.orderService.findById(data.id);
        channel.ack(originalMsg);
        return order;
    }
}
```

```typescript
// Producer — sends message and waits for response
@Injectable()
export class OrderClient {
    constructor(@Inject('ORDERS_SERVICE') private readonly client: ClientProxy) {}

    createOrder(dto: CreateOrderDto): Observable<Order> {
        return this.client.send<Order>('order.create', dto);
    }

    getOrder(id: string): Observable<Order> {
        return this.client.send<Order>('order.get', { id });
    }
}
```

### Event-Based (`@EventPattern`)

Fire-and-forget — producer emits, one or more consumers process:

```typescript
// Consumer — handles the event, no response returned
@Controller()
export class NotificationsController {
    @EventPattern('order.created')
    async handleOrderCreated(@Payload() data: OrderCreatedEvent, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();

        try {
            await this.notificationService.sendOrderConfirmation(data);
            channel.ack(originalMsg);
        } catch (error) {
            // Nack with requeue for retryable errors
            channel.nack(originalMsg, false, true);
        }
    }
}
```

```typescript
// Producer — emits event, does not wait for response
@Injectable()
export class OrderService {
    constructor(@Inject('NOTIFICATIONS_SERVICE') private readonly client: ClientProxy) {}

    async create(dto: CreateOrderDto): Promise<Order> {
        const order = await this.orderRepository.save(dto);
        this.client.emit('order.created', new OrderCreatedEvent(order));
        return order;
    }
}
```

### When to Use Which

| Pattern | Use When | Returns |
|---------|----------|---------|
| `@MessagePattern` + `send()` | Need a response (RPC style) — query data, create and return | Response value |
| `@EventPattern` + `emit()` | Fire-and-forget — notifications, audit, async processing | Nothing |

## Client Registration

### Module-Level Registration

```typescript
@Module({
    imports: [
        ClientsModule.register([
            {
                name: 'ORDERS_SERVICE',
                transport: Transport.RMQ,
                options: {
                    urls: [process.env.RABBITMQ_URL],
                    queue: 'orders_queue',
                    queueOptions: { durable: true },
                },
            },
            {
                name: 'NOTIFICATIONS_SERVICE',
                transport: Transport.RMQ,
                options: {
                    urls: [process.env.RABBITMQ_URL],
                    queue: 'notifications_queue',
                    queueOptions: { durable: true },
                },
            },
        ]),
    ],
})
export class AppModule {}
```

### Async Registration (for env-based config)

```typescript
ClientsModule.registerAsync([
    {
        name: 'ORDERS_SERVICE',
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
            transport: Transport.RMQ,
            options: {
                urls: [config.get<string>('RABBITMQ_URL')],
                queue: config.get<string>('ORDERS_QUEUE', 'orders_queue'),
                queueOptions: { durable: true },
            },
        }),
    },
]),
```

## Acknowledgment Patterns

### Manual ACK (Always Use)

```typescript
@MessagePattern('process.order')
async processOrder(@Payload() data: OrderDto, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
        await this.processor.process(data);
        channel.ack(originalMsg);          // success — remove from queue
    } catch (error) {
        if (error instanceof RetryableError) {
            channel.nack(originalMsg, false, true);   // requeue for retry
        } else {
            channel.nack(originalMsg, false, false);  // reject — goes to DLQ if configured
        }
    }
}
```

### ACK Rules

- **`ack(msg)`** — message processed successfully. Remove from queue.
- **`nack(msg, false, true)`** — temporary failure, requeue for retry. Use for transient errors (network timeout, DB connection lost).
- **`nack(msg, false, false)`** — permanent failure, don't requeue. Message goes to dead letter queue (DLQ) if configured. Use for validation errors, business rule violations.
- **NEVER** let an unhandled exception bubble up without ACK/NACK — the message stays in "unacked" state, invisible to other consumers, until the connection drops and it's requeued.

## Dead Letter Queue (DLQ)

### Configuration

```typescript
// Main queue with DLQ binding
const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
        urls: [process.env.RABBITMQ_URL],
        queue: 'orders_queue',
        queueOptions: {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': '',                    // default exchange
                'x-dead-letter-routing-key': 'orders_dlq',      // DLQ queue name
                'x-message-ttl': 30000,                          // optional: TTL before DLQ
            },
        },
        noAck: false,
    },
});
```

### DLQ Consumer

```typescript
// Separate microservice or hybrid app listening on DLQ
@Controller()
export class DlqController {
    @EventPattern('orders_dlq')
    async handleDeadLetter(@Payload() data: any, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        const headers = originalMsg.properties.headers;

        // Log the failure for investigation
        this.logger.error('Dead letter received', {
            pattern: context.getPattern(),
            data,
            deathReason: headers?.['x-death']?.[0]?.reason,
            deathCount: headers?.['x-death']?.[0]?.count,
            originalQueue: headers?.['x-death']?.[0]?.queue,
        });

        // Store in DB for manual review/retry
        await this.deadLetterService.store(data, headers);
        channel.ack(originalMsg);
    }
}
```

## Retry Strategy

### Exponential Backoff with DLQ

```typescript
@MessagePattern('order.process')
async processOrder(@Payload() data: OrderDto, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    const retryCount = (originalMsg.properties.headers?.['x-retry-count'] ?? 0) as number;
    const maxRetries = 3;

    try {
        await this.processor.process(data);
        channel.ack(originalMsg);
    } catch (error) {
        channel.ack(originalMsg); // ack original to prevent immediate requeue

        if (retryCount < maxRetries) {
            // Re-publish with incremented retry count and delay
            const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
            setTimeout(() => {
                channel.publish('', 'orders_queue', Buffer.from(JSON.stringify(data)), {
                    headers: { 'x-retry-count': retryCount + 1 },
                    persistent: true,
                });
            }, delay);
        } else {
            // Max retries exceeded — send to DLQ manually
            channel.publish('', 'orders_dlq', Buffer.from(JSON.stringify({
                originalData: data,
                error: error.message,
                retryCount,
                timestamp: new Date().toISOString(),
            })), { persistent: true });
        }
    }
}
```

## CQRS with RabbitMQ

### Commands via Message Patterns

```typescript
// Command
export class CreateOrderCommand {
    constructor(
        public readonly customerId: string,
        public readonly items: OrderItem[],
    ) {}
}

// Handler
@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
    constructor(
        private readonly repository: OrderRepository,
        private readonly eventBus: EventBus,
    ) {}

    async execute(command: CreateOrderCommand): Promise<Order> {
        const order = await this.repository.create(command);
        this.eventBus.publish(new OrderCreatedEvent(order.id, order.customerId));
        return order;
    }
}

// Saga — cross-service orchestration
@Injectable()
export class OrderSaga {
    @Saga()
    orderCreated = (events$: Observable<any>): Observable<ICommand> => {
        return events$.pipe(
            ofType(OrderCreatedEvent),
            map(event => new NotifyWarehouseCommand(event.orderId)),
        );
    };
}
```

### Event Publishing Across Services

```typescript
// Service A publishes domain event to RabbitMQ
@Injectable()
export class OrderEventPublisher {
    constructor(@Inject('EVENTS_SERVICE') private readonly client: ClientProxy) {}

    publishOrderCreated(order: Order) {
        this.client.emit('domain.order.created', {
            orderId: order.id,
            customerId: order.customerId,
            total: order.total,
            timestamp: new Date().toISOString(),
        });
    }
}

// Service B consumes domain event from RabbitMQ
@Controller()
export class WarehouseEventsController {
    @EventPattern('domain.order.created')
    async handleOrderCreated(@Payload() data: OrderCreatedEvent, @Ctx() ctx: RmqContext) {
        const channel = ctx.getChannelRef();
        const msg = ctx.getMessage();

        await this.warehouseService.reserveInventory(data.orderId, data.items);
        channel.ack(msg);
    }
}
```

## Exchange Patterns

### Topic Exchange (Wildcards)

```typescript
// Producer config with topic exchange
{
    transport: Transport.RMQ,
    options: {
        urls: [process.env.RABBITMQ_URL],
        queue: 'events_queue',
        queueOptions: { durable: true },
        exchange: 'domain_events',
        exchangeType: 'topic',
        wildcards: true,
    },
}

// Consumer — subscribe to patterns
@EventPattern('order.*')        // matches order.created, order.cancelled, etc.
async handleOrderEvents(@Payload() data: any) { ... }

@EventPattern('order.#')        // matches order.created, order.item.added, etc.
async handleAllOrderEvents(@Payload() data: any) { ... }

@EventPattern('*.created')      // matches order.created, user.created, etc.
async handleCreatedEvents(@Payload() data: any) { ... }
```

### Fanout Exchange

```typescript
// All consumers get every message — useful for broadcasting
{
    exchange: 'broadcast',
    exchangeType: 'fanout',
}
```

## Health Checks

```typescript
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MicroserviceHealthIndicator } from '@nestjs/terminus';
import { Transport } from '@nestjs/microservices';

@Controller('health')
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly microservice: MicroserviceHealthIndicator,
    ) {}

    @Get()
    @HealthCheck()
    check() {
        return this.health.check([
            () => this.microservice.pingCheck('rabbitmq', {
                transport: Transport.RMQ,
                options: {
                    urls: [process.env.RABBITMQ_URL],
                },
            }),
        ]);
    }
}
```

## Message Serialization

### DTOs with class-validator

```typescript
export class CreateOrderDto {
    @IsString()
    customerId: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OrderItemDto)
    items: OrderItemDto[];
}

// Validate incoming messages with a pipe
@MessagePattern('order.create')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
async createOrder(@Payload() data: CreateOrderDto) { ... }
```

### Event Envelope Pattern

```typescript
// Wrap all events in a standard envelope
interface EventEnvelope<T = any> {
    eventType: string;
    timestamp: string;
    correlationId: string;
    source: string;
    data: T;
}

// Producer
this.client.emit('order.created', {
    eventType: 'order.created',
    timestamp: new Date().toISOString(),
    correlationId: uuidv4(),
    source: 'order-service',
    data: { orderId: order.id, customerId: order.customerId },
} satisfies EventEnvelope<OrderCreatedPayload>);
```

## Testing

### Unit Testing Message Handlers

```typescript
describe('OrdersController', () => {
    let controller: OrdersController;
    let orderService: jest.Mocked<OrderService>;

    beforeEach(async () => {
        const module = await Test.createTestingModule({
            controllers: [OrdersController],
            providers: [
                { provide: OrderService, useValue: { create: jest.fn(), findById: jest.fn() } },
            ],
        }).compile();

        controller = module.get(OrdersController);
        orderService = module.get(OrderService);
    });

    it('should create order and ack message', async () => {
        const dto = { customerId: '1', items: [] };
        const mockOrder = { id: '123', ...dto };
        orderService.create.mockResolvedValue(mockOrder);

        const mockChannel = { ack: jest.fn(), nack: jest.fn() };
        const mockMsg = {};
        const context = { getChannelRef: () => mockChannel, getMessage: () => mockMsg } as any;

        const result = await controller.createOrder(dto, context);

        expect(result).toEqual(mockOrder);
        expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });

    it('should nack message on error', async () => {
        orderService.create.mockRejectedValue(new Error('DB error'));

        const mockChannel = { ack: jest.fn(), nack: jest.fn() };
        const mockMsg = {};
        const context = { getChannelRef: () => mockChannel, getMessage: () => mockMsg } as any;

        await expect(controller.createOrder({} as any, context)).rejects.toThrow();
        expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
    });
});
```

### E2E Testing with ClientProxy

```typescript
describe('Orders Microservice (e2e)', () => {
    let app: INestMicroservice;
    let client: ClientProxy;

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = module.createNestMicroservice({
            transport: Transport.RMQ,
            options: { urls: [process.env.RABBITMQ_URL], queue: 'test_orders_queue' },
        });
        await app.listen();

        client = ClientProxyFactory.create({
            transport: Transport.RMQ,
            options: { urls: [process.env.RABBITMQ_URL], queue: 'test_orders_queue' },
        });
        await client.connect();
    });

    afterAll(async () => {
        await client.close();
        await app.close();
    });

    it('should create order via message pattern', async () => {
        const result = await firstValueFrom(
            client.send('order.create', { customerId: '1', items: [{ productId: '1', qty: 2 }] }),
        );
        expect(result.id).toBeDefined();
    });
});
```

## Project Structure

```
src/
  modules/
    orders/
      orders.module.ts
      orders.controller.ts          ← @MessagePattern / @EventPattern handlers
      orders.service.ts             ← business logic
      orders.repository.ts          ← DB access
      dto/
        create-order.dto.ts
      events/
        order-created.event.ts
      commands/                     ← CQRS (if used)
        create-order.command.ts
        create-order.handler.ts
      sagas/                        ← CQRS sagas (if used)
        order.saga.ts
    notifications/
      notifications.module.ts
      notifications.controller.ts   ← event consumers
  common/
    interfaces/
      event-envelope.interface.ts
    pipes/
      validation.pipe.ts
    health/
      health.controller.ts
  config/
    rabbitmq.config.ts
  main.ts
```

## Common Pitfalls -- NEVER Rules

- **NEVER** use `noAck: true` in production — messages are lost on crash. Always use manual ACK.
- **NEVER** forget to ACK or NACK a message — it stays invisible in "unacked" state, blocking the prefetch slot.
- **NEVER** throw unhandled exceptions without NACK — the message hangs until connection drops and is requeued, causing infinite retry loops.
- **NEVER** use `nack(msg, false, true)` for permanent failures — it creates an infinite retry loop. Use `false` (don't requeue) and let DLQ handle it.
- **NEVER** hardcode RabbitMQ URLs — use `ConfigService` with environment variables.
- **NEVER** skip queue `durable: true` in production — messages lost on broker restart.
- **NEVER** use `send()` when you don't need a response — use `emit()` for fire-and-forget events.
- **NEVER** process messages without validation — use `ValidationPipe` on `@MessagePattern` handlers.
- **NEVER** mix `@MessagePattern` and `@EventPattern` for the same queue pattern — they have different delivery semantics.

## Must-Haves

- **Manual ACK on every handler.** Every `@MessagePattern` and `@EventPattern` handler calls `channel.ack()` or `channel.nack()`.
- **DLQ configured for every production queue.** Dead letters go somewhere observable, not silently dropped.
- **Durable queues + persistent messages.** Both required for message durability across broker restarts.
- **Typed DTOs with validation.** Every message payload has a DTO class with `class-validator` decorators.
- **Health check endpoint.** `/health` checks RabbitMQ connectivity via `@nestjs/terminus`.
- **Correlation IDs on cross-service events.** Every event envelope includes `correlationId` for distributed tracing.
- **Error handling with explicit NACK strategy.** Distinguish retryable (requeue) vs permanent (DLQ) failures.

## Good Practices

- **Prefetch 1 for ordered processing.** Ensures messages are processed sequentially per consumer.
- **Event envelope pattern.** Standardize event structure: `{ eventType, timestamp, correlationId, source, data }`.
- **Separate queues per concern.** `orders_queue`, `notifications_queue`, `audit_queue` — not one shared queue.
- **Async config registration.** Use `ClientsModule.registerAsync()` with `ConfigService` for env-based URLs.
- **Topic exchanges for event routing.** Use wildcards (`order.*`, `*.created`) for flexible event subscription.
- **Idempotent message handlers.** The same message delivered twice should produce the same result. Use deduplication by message ID or correlationId.
- **Retry with exponential backoff.** Don't retry immediately — use increasing delays (1s, 2s, 4s) before sending to DLQ.
- **Hybrid apps for gradual migration.** Start with HTTP + microservice in one app, split later when stable.

## Common Bugs

- **Forgetting to ACK.** Handler completes but never calls `channel.ack()`. Message stays unacked, prefetch slot is consumed, consumer stops receiving after `prefetchCount` messages.
- **Requeue loop.** `nack(msg, false, true)` on permanent failure → message requeued → same handler fails → infinite loop. Use DLQ.
- **ClientProxy not connected.** Calling `send()` or `emit()` before `client.connect()` resolves — add `onApplicationBootstrap()` with `await this.client.connect()`.
- **Serialization mismatch.** Producer sends JSON string, consumer expects parsed object (or vice versa). Use consistent serialization.
- **Missing AMQP assertions.** Queue configured differently between producer and consumer (durable vs non-durable) — RabbitMQ rejects with PRECONDITION_FAILED. Ensure both sides agree.
- **Swallowed errors in event handlers.** `@EventPattern` doesn't propagate errors to the producer. Errors must be caught and handled (logged, DLQ'd) inside the handler.

## Anti-Patterns

- **Giant handlers.** Message handlers with business logic, DB access, and side effects. Extract to services.
- **Synchronous processing for async work.** Using `@MessagePattern` (request-response) when `@EventPattern` (fire-and-forget) is appropriate.
- **No DLQ.** Messages that fail are silently dropped or infinitely retried. Always configure dead letter routing.
- **Shared queues.** Multiple unrelated consumers on the same queue. Use separate queues per concern.
- **Inline connection strings.** RabbitMQ URL hardcoded in source. Use `ConfigService`.
- **Missing idempotency.** Handler creates a duplicate record when the same message is delivered twice (at-least-once delivery is guaranteed, not exactly-once).

## Context7 Instructions

When looking up documentation, use these Context7 library identifiers:

- **NestJS Microservices:** `/websites/nestjs` — RabbitMQ transport, ClientProxy, message patterns, event patterns
- **NestJS Core:** `/nestjs/docs.nestjs.com` — modules, DI, guards, interceptors, pipes
- **NestJS CQRS:** `/websites/nestjs` (search "cqrs") — commands, events, sagas, event sourcing

Always check Context7 for latest NestJS microservice API — transport options and patterns evolve between major versions.
