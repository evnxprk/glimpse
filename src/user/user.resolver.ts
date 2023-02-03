import { Resolver, Query, Mutation, Args, Int, Context } from "@nestjs/graphql";
import { User } from "./user.entity";
import { CreateUserInput } from "./dto/create-user.input";
import { UpdateUserInput } from "./dto/update-user.input";
import { validate } from "class-validator";
import { plainToClass } from "class-transformer";
import { BadRequestException, Logger, Session } from "@nestjs/common";
import { Rules, RuleType } from "../casl/rules.decorator";
import { accessibleBy } from "@casl/prisma";
import { FilterUserInput } from "./dto/filter-user.input";
import { OrderUserInput } from "./dto/order-user.input";
import PaginationInput from "../generic/pagination.input";
import { Complexities } from "../gql-complexity.plugin";
import { Request } from "express";
import { AuthService } from "../auth/auth.service";

@Resolver(() => User)
export class UserResolver {
    private logger: Logger = new Logger("UserResolver");
    constructor(private readonly authService: AuthService) {}

    // -------------------- Generic Resolvers --------------------

    @Query(() => [User], { complexity: Complexities.FindMany })
    @Rules(RuleType.ReadMany, User)
    async findManyUser(
        @Context() ctx: { req: Request },
        @Args("filter", { type: () => FilterUserInput, nullable: true }) filter?: FilterUserInput,
        @Args("order", { type: () => [OrderUserInput], nullable: true }) order?: OrderUserInput[],
        @Args("pagination", { type: () => PaginationInput, nullable: true }) pagination?: PaginationInput
    ): Promise<User[]> {
        this.logger.verbose("findManyUser resolver called");
        // If filter is provided, combine it with the CASL accessibleBy filter.
        const where = filter
            ? {
                  AND: [accessibleBy(ctx.req.permissions).User, filter]
              }
            : accessibleBy(ctx.req.permissions).User;

        // If ordering args are provided, convert them to Prisma's orderBy format.
        const orderBy = order?.map((o) => ({ [o.field]: o.direction })) || undefined;

        return ctx.req.prismaTx.user.findMany({
            where,
            orderBy,
            skip: pagination?.skip,
            take: Math.max(0, pagination?.take ?? 20),
            cursor: pagination?.cursor ? { id: pagination.cursor } : undefined
        });
    }

    @Query(() => User, { nullable: true, complexity: Complexities.FindOne })
    @Rules(RuleType.ReadOne, User)
    async findOneUser(@Context() ctx: { req: Request }, @Args("id", { type: () => Int }) id: number): Promise<User> {
        this.logger.verbose("findOneUser resolver called");
        return ctx.req.prismaTx.user.findFirst({
            where: {
                AND: [{ id }, accessibleBy(ctx.req.permissions).User]
            }
        });
    }

    @Mutation(() => User)
    @Rules(RuleType.Create, User)
    async createUser(
        @Context() ctx: { req: Request },
        @Args("input", { type: () => CreateUserInput }) input: CreateUserInput
    ): Promise<User> {
        this.logger.verbose("createUser resolver called");
        input = plainToClass(CreateUserInput, input);
        const errors = await validate(input, { skipMissingProperties: true });
        if (errors.length > 0) {
            const firstErrorFirstConstraint = errors[0].constraints[Object.keys(errors[0].constraints)[0]];
            throw new BadRequestException(firstErrorFirstConstraint);
        }

        // Hash the password if it is provided.
        if (input.password) {
            input.password = await this.authService.hashPassword(input.password);
        }

        return ctx.req.prismaTx.user.create({
            data: input
        });
    }

    @Mutation(() => User)
    @Rules(RuleType.Update, User)
    async updateUser(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- FIXME
        @Args("id", { type: () => Int }) id: number,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- FIXME
        @Args("input", { type: () => UpdateUserInput }) input: UpdateUserInput
    ): Promise<User> {
        this.logger.verbose("updateUser resolver called");
        // TODO
        return new User();
    }

    @Mutation(() => User)
    @Rules(RuleType.Delete, User)
    async deleteUser(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- FIXME
        @Args("id", { type: () => Int }) id: number
    ): Promise<User> {
        this.logger.verbose("deleteUser resolver called");
        // TODO
        return new User();
    }

    @Query(() => Int)
    @Rules(RuleType.Count, User)
    async userCount(
        @Context() ctx: { req: Request },
        @Args("filter", { type: () => FilterUserInput, nullable: true }) filter?: FilterUserInput
    ): Promise<number> {
        return ctx.req.prismaTx.user.count({
            where: {
                AND: [accessibleBy(ctx.req.permissions).User, filter]
            }
        });
    }

    // -------------------- Unique Resolvers --------------------

    @Query(() => User, { nullable: true })
    @Rules(RuleType.ReadOne, User, { name: "Read one user (self)" })
    async self(@Session() session: Record<string, any>, @Context() ctx: any): Promise<User | null> {
        this.logger.verbose("self resolver called");
        return ctx.req.user || null;
    }
}
