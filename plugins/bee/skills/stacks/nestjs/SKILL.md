---
name: nestjs
description: NestJS backend conventions and patterns
---

# NestJS Standards

These standards apply when the project stack is `nestjs`. All agents and implementations must follow these conventions. This is a BACKEND-ONLY stack -- no frontend conventions.

**Library detection:** If the project uses RabbitMQ microservices (check `package.json` for `@nestjs/microservices` + `amqplib`), **also read `skills/libraries/nestjs-rabbitmq/SKILL.md`** for transport config, message patterns, ACK handling, DLQ, and CQRS patterns.

## Module Architecture

- **Modules** are the organizational unit of a NestJS application. Every feature gets its own module.
- Root `AppModule` imports all feature modules. Feature modules group related controllers, services, and providers.
- **Shared modules** encapsulate cross-cutting concerns (logging, config, database). Export providers that other modules need.
- `@Module()` decorator defines four arrays: `imports` (other modules), `controllers` (route handlers), `providers` (services/repositories), `exports` (providers available to importing modules).
- Use `forRoot()` / `forRootAsync()` for dynamic module configuration (database, config). Use `forFeature()` for per-module entity/repository registration.
- Keep modules cohesive -- one domain concern per module.
- **Global modules:** Use `@Global()` sparingly -- only for truly app-wide services (config, logging). Overuse hides dependencies and makes testing harder.

```typescript
// Pattern: feature module
@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
```

## Controllers

- `@Controller('resource')` sets the route prefix. Use plural nouns for REST resources.
- HTTP method decorators: `@Get()`, `@Post()`, `@Put()`, `@Patch()`, `@Delete()`.
- Parameter decorators: `@Body()`, `@Param()`, `@Query()`, `@Headers()`, `@Req()`.
- Return **DTOs**, not entities. Controllers transform service output into API-safe responses.
- Controllers are thin -- they accept a request, delegate to a service, and return a response.
- Use `@HttpCode()` to set non-default status codes (e.g., `@HttpCode(204)` for delete).
- Use `@SerializeOptions()` or custom interceptors for response serialization control.

```typescript
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateOrderDto): Promise<OrderResponseDto> {
    return this.ordersService.create(dto);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OrderResponseDto> {
    return this.ordersService.findOne(id);
  }
}
```

## Services

- `@Injectable()` marks classes for dependency injection. All business logic lives in services.
- **Constructor injection** for dependencies. Declare dependencies as `private readonly`.
- One service per domain concern (`OrdersService`, `PaymentsService`, `NotificationsService`).
- Services should be framework-independent -- testable without bootstrapping NestJS.
- Services throw domain exceptions (`NotFoundException`, `BadRequestException`) for error flows.
- Keep services focused: if a service grows beyond 300 lines, split by sub-concern.

```typescript
@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly paymentsService: PaymentsService,
  ) {}

  async create(dto: CreateOrderDto): Promise<OrderResponseDto> {
    const order = this.orderRepo.create(dto);
    const saved = await this.orderRepo.save(order);
    return OrderResponseDto.fromEntity(saved);
  }
}
```

## Custom Decorators

NestJS supports three decorator types: **param decorators** (extract data from requests), **method/class decorators** (attach metadata), and **composed decorators** (combine multiple decorators).

### Param Decorators

Use `createParamDecorator` to extract custom data from the request. The factory receives `(data, ctx)` where `data` is the argument passed to the decorator and `ctx` is the `ExecutionContext`.

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Extract the authenticated user from the request
export const CurrentUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

// Usage: @CurrentUser() user: User  or  @CurrentUser('email') email: string
```

### Metadata Decorators

Use `SetMetadata` to attach metadata to handlers, then read it in guards/interceptors via `Reflector`.

```typescript
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

// Usage: @Roles(Role.ADMIN, Role.MANAGER)
```

### Composed Decorators

Use `applyDecorators` to bundle multiple decorators into a single reusable decorator. This reduces repetition on route handlers that share auth, swagger, and guard requirements.

```typescript
import { applyDecorators } from '@nestjs/common';

export function Auth(...roles: Role[]) {
  return applyDecorators(
    SetMetadata('roles', roles),
    UseGuards(AuthGuard, RolesGuard),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ description: 'Unauthorized' }),
  );
}

// Usage: @Auth(Role.ADMIN) on a controller method replaces four separate decorators
```

## Validation

- **class-validator** + **class-transformer** for DTO validation. Install both as dependencies.
- Apply `ValidationPipe` globally in `main.ts` with `whitelist: true` and `transform: true`.
- DTOs use decorator constraints: `@IsString()`, `@IsEmail()`, `@IsOptional()`, `@MinLength()`, `@IsEnum()`, `@IsUUID()`.
- Nested DTOs use `@ValidateNested()` with `@Type(() => NestedDto)` for proper transformation.
- Separate DTOs for create, update, and response. Update DTOs extend create with `PartialType()`.
- Use `@ValidateIf()` for conditional validation. Use `@Matches()` for regex patterns.

```typescript
export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  customerName: string;

  @IsEmail()
  customerEmail: string;

  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus = OrderStatus.PENDING;

  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
```

## Guards -- Authentication and Authorization

- **Guards** handle authentication and authorization. Apply with `@UseGuards()`.
- `canActivate()` returns a boolean or throws `UnauthorizedException` / `ForbiddenException`.
- Implement `AuthGuard` for JWT/session validation, `RolesGuard` for role-based access.
- Apply guards globally, at controller level, or at route level as appropriate.

### RBAC with Roles Guard

```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}
```

### Policy-Based Authorization

For fine-grained access control beyond roles, use policy handlers that evaluate business rules.

```typescript
export const CHECK_POLICIES_KEY = 'check_policy';
export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);

// Policy handler interface
interface IPolicyHandler {
  handle(ability: AppAbility): boolean;
}
type PolicyHandlerCallback = (ability: AppAbility) => boolean;
type PolicyHandler = IPolicyHandler | PolicyHandlerCallback;

// Usage: @CheckPolicies((ability) => ability.can(Action.Update, Order))
```

## Interceptors

Interceptors handle cross-cutting concerns: response transformation, logging, caching, timing. They use RxJS operators to transform the response stream.

### Response Mapping

```typescript
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => ({ data, statusCode: context.switchToHttp().getResponse().statusCode, timestamp: new Date().toISOString() })),
    );
  }
}
```

### Logging Interceptor

```typescript
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const now = Date.now();
    return next.handle().pipe(
      tap(() => this.logger.log(`${req.method} ${req.url} - ${Date.now() - now}ms`)),
    );
  }
}
```

### Timeout Interceptor

```typescript
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      timeout(5000),
      catchError((err) =>
        err instanceof TimeoutError
          ? throwError(() => new RequestTimeoutException())
          : throwError(() => err),
      ),
    );
  }
}
```

## Exception Filters

Exception filters catch and format errors. Use `@Catch()` to handle specific exception types. Register globally for consistent error responses across the entire application.

```typescript
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    response.status(status).json({
      statusCode: status,
      message: typeof exceptionResponse === 'string' ? exceptionResponse : (exceptionResponse as any).message,
      timestamp: new Date().toISOString(),
      path: ctx.getRequest<Request>().url,
    });
  }
}

// Global filter catches everything including non-HTTP exceptions
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    this.logger.error(exception);
    response.status(status).json({ statusCode: status, message: 'Internal server error', timestamp: new Date().toISOString() });
  }
}
```

For **WebSocket** filters, use `host.switchToWs()` to access the WS context. For **RPC/microservice** filters, use `host.switchToRpc()`.

## Pipes

- **Built-in pipes:** `ValidationPipe`, `ParseIntPipe`, `ParseUUIDPipe`, `ParseBoolPipe`, `ParseArrayPipe`, `ParseEnumPipe`, `DefaultValuePipe`.
- **Custom pipes** implement `PipeTransform` for parameter-level transformation and validation.
- Chain pipes: `@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number`.

```typescript
@Injectable()
export class ParseDatePipe implements PipeTransform<string, Date> {
  transform(value: string, metadata: ArgumentMetadata): Date {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new BadRequestException(`"${value}" is not a valid date`);
    }
    return date;
  }
}
```

## Database Integration

**Detect what the project uses** -- check `package.json` for the installed ORM/database library and follow THAT library's patterns. Do NOT introduce a different ORM than what the project already uses.

Common ORMs: **Prisma**, **TypeORM**, **Mongoose** (MongoDB), **Knex** (query builder), **MikroORM**, **Drizzle**.

### TypeORM Deep Dive

- Entities use `@Entity()`, `@Column()`, `@PrimaryGeneratedColumn()` decorators.
- Use `TypeOrmModule.forFeature([Entity])` in feature modules to register repositories.
- Inject repositories with `@InjectRepository(Entity)`.

**Entity with relations:**

```typescript
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerName: string;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true, eager: false })
  items: OrderItem[];

  @ManyToOne(() => User, (user) => user.orders)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

**Relations -- eager vs. lazy:** Use `eager: true` sparingly (always loads the relation). Prefer explicit loading via `relations` option in `find*` methods or QueryBuilder joins. Lazy relations (returning `Promise`) work but have implicit query pitfalls.

**QueryBuilder for complex queries:**

```typescript
const orders = await this.orderRepo
  .createQueryBuilder('order')
  .leftJoinAndSelect('order.items', 'item')
  .where('order.status = :status', { status: OrderStatus.ACTIVE })
  .andWhere('order.createdAt > :date', { date: startDate })
  .orderBy('order.createdAt', 'DESC')
  .skip(offset)
  .take(limit)
  .getMany();
```

**Migrations:** Generate with `typeorm migration:generate -d src/data-source.ts src/migrations/MigrationName`. Run with `typeorm migration:run -d src/data-source.ts`. Never use `synchronize: true` in production.

**Transactions:**

```typescript
async transferOrder(orderId: string, newUserId: string): Promise<void> {
  await this.dataSource.transaction(async (manager) => {
    const order = await manager.findOneOrFail(Order, { where: { id: orderId } });
    order.userId = newUserId;
    await manager.save(order);
    await manager.save(AuditLog, { action: 'transfer', orderId, newUserId });
  });
}
```

### Prisma Deep Dive

- Define schema in `schema.prisma`. Generate client with `npx prisma generate`.
- Create `PrismaService` as an `@Injectable()` that extends `PrismaClient`.
- Register `PrismaService` in a shared `PrismaModule` and export it.
- Migrations via Prisma CLI: `npx prisma migrate dev`, `npx prisma migrate deploy`.

**PrismaService pattern:**

```typescript
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

**Transactions with Prisma:**

```typescript
async createOrderWithItems(dto: CreateOrderDto): Promise<Order> {
  return this.prisma.$transaction(async (tx) => {
    const order = await tx.order.create({ data: { customerName: dto.customerName } });
    await tx.orderItem.createMany({
      data: dto.items.map((item) => ({ ...item, orderId: order.id })),
    });
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  });
}
```

**Raw queries** (use only when the Prisma client API is insufficient):

```typescript
const result = await this.prisma.$queryRaw<Stats[]>`
  SELECT status, COUNT(*)::int as count FROM orders
  WHERE created_at > ${startDate}
  GROUP BY status
`;
```

**Prisma middleware** for soft deletes, logging, or audit trails:

```typescript
this.prisma.$use(async (params, next) => {
  if (params.action === 'delete') {
    params.action = 'update';
    params.args.data = { deletedAt: new Date() };
  }
  return next(params);
});
```

### Mongoose (MongoDB)

If the project uses Mongoose, follow `@nestjs/mongoose` patterns: `@Schema()` decorator on classes, `SchemaFactory.createForClass()`, inject `@InjectModel(Entity.name)` as `Model<EntityDocument>`.

## GraphQL -- Code-First Approach

When the project uses `@nestjs/graphql`, follow the code-first approach where TypeScript classes generate the schema.

**Object types:**

```typescript
@ObjectType()
export class Author {
  @Field(() => Int)
  id: number;

  @Field({ nullable: true })
  firstName?: string;

  @Field(() => [Post])
  posts: Post[];
}
```

**Input types:**

```typescript
@InputType()
export class CreateAuthorInput {
  @Field()
  @IsString()
  firstName: string;

  @Field({ nullable: true })
  lastName?: string;
}
```

**Resolvers with field resolvers:**

```typescript
@Resolver(() => Author)
export class AuthorsResolver {
  constructor(
    private authorsService: AuthorsService,
    private postsService: PostsService,
  ) {}

  @Query(() => Author)
  async author(@Args('id', { type: () => Int }) id: number) {
    return this.authorsService.findOneById(id);
  }

  @Mutation(() => Author)
  async createAuthor(@Args('input') input: CreateAuthorInput) {
    return this.authorsService.create(input);
  }

  @ResolveField(() => [Post])
  async posts(@Parent() author: Author) {
    return this.postsService.findAll({ authorId: author.id });
  }
}
```

**GraphQL module setup:** Register with `GraphQLModule.forRoot<ApolloDriverConfig>({ driver: ApolloDriver, autoSchemaFile: join(process.cwd(), 'src/schema.gql') })` for code-first.

## Swagger / OpenAPI

When `@nestjs/swagger` is installed, decorate controllers and DTOs to auto-generate API documentation.

- `@ApiTags('orders')` groups endpoints in Swagger UI.
- `@ApiOperation({ summary: 'Create order' })` describes individual endpoints.
- `@ApiResponse({ status: 201, type: OrderResponseDto })` documents response schemas.
- `@ApiBearerAuth()` marks endpoints requiring JWT authentication.
- DTOs with class-validator decorators automatically generate OpenAPI schemas when `SwaggerModule` plugin is enabled.

```typescript
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  @Post()
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, description: 'Order created', type: OrderResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  async create(@Body() dto: CreateOrderDto): Promise<OrderResponseDto> {
    return this.ordersService.create(dto);
  }
}
```

**Swagger setup in `main.ts`:**

```typescript
const config = new DocumentBuilder()
  .setTitle('Orders API')
  .setVersion('1.0')
  .addBearerAuth()
  .build();
const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api', app, document);
```

## Event-Driven Patterns

### EventEmitter2

Use `@nestjs/event-emitter` for in-process event-driven communication between modules. Decouples producers from consumers.

```typescript
// Emitting events from a service
this.eventEmitter.emit('order.created', new OrderCreatedEvent(order));

// Listening in another service
@OnEvent('order.created')
async handleOrderCreated(event: OrderCreatedEvent) {
  await this.notificationsService.sendConfirmation(event.order);
}
```

### CQRS Pattern

Use `@nestjs/cqrs` for complex domains. Separates read (queries) and write (commands) operations.

```typescript
// Command
export class CreateOrderCommand { constructor(public readonly dto: CreateOrderDto) {} }

// Handler
@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
  constructor(private readonly orderRepo: OrderRepository) {}
  async execute(command: CreateOrderCommand): Promise<Order> {
    return this.orderRepo.create(command.dto);
  }
}

// Dispatching
await this.commandBus.execute(new CreateOrderCommand(dto));
```

## Microservices

NestJS supports multiple transport layers for microservice communication: **TCP**, **Redis**, **NATS**, **MQTT**, **gRPC**, **Kafka**, **RabbitMQ**.

**Message patterns** use `@MessagePattern()` for request-response and `@EventPattern()` for event-based communication.

```typescript
// Microservice controller
@Controller()
export class OrdersMicroserviceController {
  @MessagePattern({ cmd: 'get_order' })
  async getOrder(@Payload() data: { id: string }) {
    return this.ordersService.findOne(data.id);
  }

  @EventPattern('order_paid')
  async handleOrderPaid(@Payload() data: OrderPaidEvent) {
    await this.ordersService.markPaid(data.orderId);
  }
}
```

**Hybrid applications** combine HTTP and microservice transports:

```typescript
const app = await NestFactory.create(AppModule);
app.connectMicroservice<MicroserviceOptions>({ transport: Transport.REDIS, options: { host: 'localhost', port: 6379 } });
await app.startAllMicroservices();
await app.listen(3000);
```

**Bind message patterns to specific transports** in hybrid apps using `Transport` enum as a second argument to `@MessagePattern()`.

## Testing

- **Jest** or **Vitest** with `@nestjs/testing` for all tests.
- `Test.createTestingModule()` bootstraps a testing module with controlled providers.
- **Unit tests:** Provide mock services via `{ provide: Service, useValue: mockService }`.
- **Integration tests:** Use `supertest` with `app.getHttpServer()` for HTTP-level testing.
- Test services independently from controllers. Test controllers independently from services.
- Mock external dependencies (database, third-party APIs) in unit tests.

### Unit Test with Mocked Dependencies

```typescript
describe('OrdersService', () => {
  let service: OrdersService;
  let repo: jest.Mocked<Repository<Order>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: { create: jest.fn(), save: jest.fn(), findOne: jest.fn() } },
      ],
    }).compile();

    service = module.get(OrdersService);
    repo = module.get(getRepositoryToken(Order));
  });

  it('creates an order and returns a response DTO', async () => {
    const dto = { customerName: 'Jane', customerEmail: 'jane@example.com', items: [] };
    repo.create.mockReturnValue(dto as any);
    repo.save.mockResolvedValue({ id: 'uuid-1', ...dto } as any);

    const result = await service.create(dto as CreateOrderDto);
    expect(result).toBeDefined();
    expect(repo.save).toHaveBeenCalled();
  });
});
```

### E2E Test with overrideProvider

```typescript
describe('OrdersController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OrdersService)
      .useValue({ findAll: () => [{ id: '1', customerName: 'Test' }], create: jest.fn() })
      .overrideProvider(PrismaService)
      .useValue({ order: { findMany: jest.fn(), create: jest.fn() } })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  it('GET /orders returns orders', () => {
    return request(app.getHttpServer())
      .get('/orders')
      .expect(200)
      .expect((res) => expect(res.body).toHaveLength(1));
  });

  afterAll(async () => {
    await app.close();
  });
});
```

### Testing Guards and Interceptors

Test guards by providing a mock `ExecutionContext`. Test interceptors by providing a mock `CallHandler` with `of()` from RxJS. Test exception filters by calling `catch()` directly with a mock `ArgumentsHost`.

## Configuration

- Use `@nestjs/config` with `ConfigModule.forRoot()` for environment-based configuration.
- Access values via `ConfigService.get<string>('DATABASE_URL')`.
- Validate environment variables with Joi or class-validator schemas in `ConfigModule.forRoot({ validationSchema })`.
- Use `registerAs()` for namespaced config: `registerAs('database', () => ({ host: process.env.DB_HOST }))`.

## Security Hardening

### Helmet + CORS

```typescript
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet()); // Security headers (XSS, CSP, HSTS, etc.)
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [],
    credentials: true,
  });
  await app.listen(3000);
}
```

### Rate Limiting

```typescript
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), // 100 req/min
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

Override per-route with `@Throttle({ default: { limit: 5, ttl: 60_000 } })` for sensitive endpoints (login, password reset).

### CSRF Protection

For session-based auth, use `csrf-csrf` or `lusca` middleware (the `csurf` package is deprecated). For JWT/Bearer auth, CSRF protection is not needed because tokens are not auto-sent by browsers.

### Structured Logging

```typescript
import { Logger } from '@nestjs/common';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  async createOrder(dto: CreateOrderDto) {
    this.logger.log(`Creating order for client ${dto.clientId}`);
    // ... logic
    this.logger.warn(`Order total exceeds threshold: ${total}`);
  }
}
```

For production, integrate with Pino (`nestjs-pino`) for JSON structured logging.

## Common Pitfalls -- NEVER Rules

- **NEVER** put business logic in controllers -- controllers delegate to services.
- **NEVER** import entities directly in controllers -- access data through services.
- **NEVER** skip validation pipes on POST/PUT/PATCH endpoints -- always validate input DTOs.
- **NEVER** use `synchronize: true` in production TypeORM config -- use migrations.
- **NEVER** forget to export providers from shared modules -- importing modules cannot access unexported providers.
- **NEVER** inject request-scoped providers into singleton services without understanding scope -- causes runtime errors.
- **NEVER** use synchronous file I/O in controllers or services -- use `fs/promises` for async operations.
- **NEVER** skip error handling -- use exception filters to catch and format errors consistently.
- **NEVER** expose entity/ORM objects in API responses -- always map to response DTOs.
- **NEVER** forget to register modules in `AppModule` imports -- unregistered modules are invisible to the app.
- **NEVER** use `@Res()` decorator unless you need full control of the response -- it disables NestJS interceptors and exception filters for that route.
- **NEVER** return plain objects from GraphQL resolvers without matching `@ObjectType()` definitions -- the schema will not include those fields.
- **NEVER** mix ORM libraries -- if the project uses Prisma, do not add TypeORM and vice versa.
- **NEVER** call `await app.listen()` before `await app.startAllMicroservices()` in hybrid apps -- microservices must start first.

## Must-Haves

- **`@Injectable()` on every service and provider.** All classes participating in dependency injection must be decorated with `@Injectable()`. Missing it causes a runtime DI error that is not caught at compile time.
- **`ValidationPipe` applied globally.** Register `ValidationPipe` with `whitelist: true` and `transform: true` in `main.ts` via `app.useGlobalPipes()`. Every POST/PUT/PATCH endpoint relies on this for input sanitization.
- **Response DTOs for all API responses.** Never return raw entities from controllers. Map entity data into dedicated response DTO classes to control the API surface and avoid leaking database internals.
- **Feature modules for every domain.** Each domain concern (users, orders, payments) gets its own module. The module groups its controller, service, and providers. Register all feature modules in `AppModule.imports`.
- **Constructor injection for all dependencies.** Declare dependencies as `private readonly` constructor parameters. Never use `ModuleRef.get()` or service locator patterns for standard dependencies.
- **`@Module()` exports array for shared providers.** If a module's service is consumed by other modules, it must appear in the `exports` array. Importing a module without the provider exported results in a silent injection failure.
- **Entity/model registration per feature module.** Use `TypeOrmModule.forFeature([Entity])` or Mongoose `MongooseModule.forFeature()` in each feature module that needs repository access. Forgetting this causes "No repository was found" errors.
- **Proper shutdown hooks.** Call `app.enableShutdownHooks()` in `main.ts` for graceful shutdown. Implement `OnModuleDestroy` in services that hold connections (Prisma, Redis, custom pools).
- **Exception filters for consistent error responses.** Register at least one global exception filter. Unhandled exceptions should never leak stack traces to the client in production.

## Good Practices

- **Separate DTOs for create, update, and response.** `CreateOrderDto`, `UpdateOrderDto` (via `PartialType(CreateOrderDto)`), and `OrderResponseDto` keep validation and serialization concerns isolated.
- **Use `PartialType()` and `PickType()` for update DTOs.** Inherit from the create DTO with `PartialType()` to make all fields optional. Use `PickType()` when only specific fields should be updatable.
- **Apply guards at the controller level.** Use `@UseGuards(AuthGuard)` on the controller class rather than individual routes when all routes require authentication. Route-level guards for fine-grained access (e.g., `@Roles('admin')`).
- **Compose decorators with `applyDecorators`.** Bundle `SetMetadata`, `UseGuards`, and Swagger decorators into a single `@Auth()` decorator to reduce repetition and enforce consistency.
- **Repository pattern for data access.** Abstract database operations behind repository classes or TypeORM's `Repository<Entity>`. Services call repository methods, not raw query builders or entity managers directly.
- **Custom pipes for parameter transformation.** Use `ParseUUIDPipe`, `ParseIntPipe`, or custom pipes for route parameters. This validates and transforms params before they reach the handler.
- **Health check endpoint.** Register `@nestjs/terminus` with a health controller at `/health` for container orchestration and monitoring readiness probes.
- **Use interceptors for cross-cutting concerns.** Response wrapping, logging, timing, and cache headers belong in interceptors, not scattered across controllers.
- **Validate config at startup.** Use `ConfigModule` with a Joi or class-validator schema so the app fails fast on missing environment variables instead of crashing at runtime.
- **Use transactions for multi-step writes.** Both TypeORM `dataSource.transaction()` and Prisma `$transaction()` ensure atomicity. Never rely on sequential `save()` calls without a transaction.

## Common Bugs

- **Forgetting to add providers to `exports` in shared modules.** A service registered in Module A but not exported cannot be injected in Module B, even if Module B imports Module A. The error message mentions the missing provider but does not point to the missing export.
- **Injecting a request-scoped provider into a singleton service.** Singleton services are instantiated once; request-scoped providers are created per request. Injecting a request-scoped provider into a singleton silently uses a stale instance or throws at runtime. Use `@Inject(INQUIRER)` or scope the consumer to `Scope.REQUEST` as well.
- **Async operations in interceptors without proper RxJS handling.** Interceptors must return an `Observable`. When performing async work (e.g., logging, caching), use `switchMap()`, `tap()`, or `from()` to wrap promises. Forgetting this causes the interceptor to swallow the response.
- **Missing `TypeOrmModule.forFeature()` import in feature modules.** Without registering the entity in the feature module, `@InjectRepository(Entity)` throws "Nest could not find Repository<Entity>". The fix is adding `TypeOrmModule.forFeature([Entity])` to the module's `imports`.
- **Unhandled promises in lifecycle hooks and event handlers.** `onModuleInit()`, `onApplicationBootstrap()`, and event listener methods that perform async work must be awaited or return the promise. Unhandled rejections crash the process silently in production.
- **Circular dependency between modules.** Two modules importing each other causes a runtime error. Resolve with `forwardRef(() => OtherModule)` in the `imports` array and `@Inject(forwardRef(() => OtherService))` for the provider.
- **Applying `@Body()` without a DTO class.** Using `@Body() body: any` bypasses the `ValidationPipe` entirely. Always type the body parameter with a DTO class decorated with class-validator decorators.
- **Using `@Res()` and expecting interceptors to work.** The `@Res()` decorator puts NestJS in library-specific mode, bypassing interceptors and exception filters. Use `@Res({ passthrough: true })` if you need both.
- **Prisma `$connect()` never called.** If `PrismaService` does not implement `OnModuleInit` with `$connect()`, the first query triggers a lazy connection which may timeout under load. Always connect explicitly.
- **GraphQL N+1 queries.** Field resolvers that query the database per parent item cause N+1 problems. Use DataLoader to batch and cache within a single request.
- **Missing `@Field()` on GraphQL object type properties.** Properties without `@Field()` are silently omitted from the generated schema. TypeScript types do not guarantee GraphQL field presence.

## Anti-Patterns

- **Business logic in controllers.** Controllers should only parse the request, call a service method, and return the response. Conditional logic, database queries, and data transformations belong in services. Violating this makes controllers untestable and couples HTTP concerns with domain logic.
- **God services.** A single service handling users, orders, payments, and notifications violates single responsibility. Split into focused services by domain concern. If a service exceeds 300 lines, it likely handles too many responsibilities.
- **Circular dependencies.** Two services or modules depending on each other is a design smell. Refactor shared logic into a third service, use events for loose coupling, or restructure module boundaries. `forwardRef` is a last resort, not a pattern to embrace.
- **Raw SQL queries instead of ORM methods.** Using `query()` or `createQueryRunner().query()` with hand-written SQL bypasses type safety, migration tracking, and relation handling. Use repository methods, query builder, or Prisma client. Reserve `$queryRaw` / raw SQL for complex aggregations only.
- **Exposing ORM entities directly in API responses.** Returning TypeORM entities or Prisma models from controllers leaks database columns, relations, and internal fields (passwords, soft-delete flags). Always map to response DTOs.
- **Synchronous file I/O in request handlers.** Using `fs.readFileSync()`, `fs.writeFileSync()`, or other sync I/O in controllers or services blocks the event loop and degrades throughput. Use `fs/promises` or streaming APIs.
- **Skipping validation on mutation endpoints.** POST, PUT, and PATCH handlers without `ValidationPipe` and DTO classes accept arbitrary payloads. This leads to data corruption and injection vulnerabilities.
- **God modules that import everything.** A single module importing all providers and controllers defeats the purpose of modular architecture. Split into focused feature modules with clear boundaries.
- **Hardcoding configuration values.** Database URLs, API keys, and feature flags embedded in code prevent environment-specific deployments. Use `@nestjs/config` with `.env` files and `ConfigService`.
- **Service locator pattern.** Using `ModuleRef.get()` to dynamically resolve providers hides dependencies and makes the code untestable. Prefer constructor injection. Use `ModuleRef` only for dynamic/optional resolution.
- **Catching exceptions in controllers.** Try/catch blocks in controller methods bypass exception filters. Let exceptions propagate naturally so filters handle them consistently. Catch only when you need to transform a specific error.
- **Mixing transport protocols without `Transport` binding.** In hybrid apps, failing to bind `@MessagePattern()` to a specific transport causes message handlers to fire on all transports.

## Standards

- **Plural route prefixes.** Controllers use plural nouns: `@Controller('orders')`, `@Controller('users')`, `@Controller('payments')`. Singular prefixes are inconsistent with REST conventions.
- **File naming: `*.module.ts`, `*.controller.ts`, `*.service.ts`.** Every NestJS building block follows the pattern `{feature}.{type}.ts`: `orders.module.ts`, `orders.controller.ts`, `orders.service.ts`, `orders.entity.ts`.
- **DTO directory per feature module.** DTOs live in a `dto/` subdirectory within the feature folder: `src/orders/dto/create-order.dto.ts`, `src/orders/dto/order-response.dto.ts`. DTO files follow `{action}-{entity}.dto.ts` naming.
- **E2E tests in the `test/` directory.** End-to-end tests using `supertest` live in the project root `test/` folder with `.e2e-spec.ts` suffix: `test/orders.e2e-spec.ts`. E2E tests bootstrap the full app module.
- **Unit tests colocated with source files.** Unit test files live next to the source file they test with `.spec.ts` suffix: `orders.service.spec.ts` sits alongside `orders.service.ts`.
- **Feature folder structure.** Each feature module is a directory: `src/orders/`, `src/users/`, `src/payments/`. The directory contains the module, controller, service, entity, DTOs, and guards specific to that feature.
- **Consistent naming for guards, pipes, interceptors, and filters.** Follow `{name}.guard.ts`, `{name}.pipe.ts`, `{name}.interceptor.ts`, `{name}.filter.ts` conventions. Class names use PascalCase: `RolesGuard`, `LoggingInterceptor`, `HttpExceptionFilter`.
- **Enum files in a `common/enums/` directory.** Shared enums used across modules live in `src/common/enums/`. Feature-specific enums live within the feature folder.
- **Interfaces in a `common/interfaces/` directory.** Shared interfaces for cross-cutting types (pagination, API responses, policy handlers) live in `src/common/interfaces/`.

```
src/
  common/
    decorators/       (custom decorators)
    enums/            (shared enums)
    filters/          (exception filters)
    guards/           (auth, roles guards)
    interceptors/     (logging, transform)
    interfaces/       (shared interfaces)
    pipes/            (custom pipes)
  config/             (config module, validation schema)
  prisma/             (PrismaModule, PrismaService)
  orders/
    dto/
      create-order.dto.ts
      update-order.dto.ts
      order-response.dto.ts
    entities/
      order.entity.ts
    orders.module.ts
    orders.controller.ts
    orders.service.ts
    orders.service.spec.ts
  users/
    ...
  app.module.ts
  main.ts
test/
  orders.e2e-spec.ts
```

## Context7 Instructions

When looking up framework documentation, use these Context7 library identifiers:

- **NestJS:** `/nestjs/docs.nestjs.com` -- modules, controllers, services, guards, interceptors, pipes, middleware, decorators, GraphQL, microservices, CQRS
- **TypeORM:** `/typeorm/typeorm` -- entities, repositories, migrations, relations, query builder
- **Prisma:** `/prisma/docs` -- schema, client, migrations, typed queries, transactions, middleware
- **class-validator:** `typestack/class-validator` -- validation decorators, custom validators
- **NestJS Swagger:** `/nestjs/docs.nestjs.com` (search for OpenAPI/Swagger topics)

Always check Context7 for the latest API when working with NestJS version-specific features. Training data may be outdated for recent NestJS releases.
