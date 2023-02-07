import { ExecutionContext, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { RuleDef, RuleType } from "./rules.decorator";
import { AbilityAction, AbilitySubjects, GlimpseAbility } from "./casl-ability.factory";
import { subject } from "@casl/ability";
import { GqlContextType, GqlExecutionContext } from "@nestjs/graphql";
import { GraphQLResolveInfo } from "graphql/type";
import { EnumValueNode, IntValueNode, Kind, visit } from "graphql/language";
import PaginationInput from "../generic/pagination.input";
import { map, Observable, of } from "rxjs";
import { Request } from "express";

@Injectable()
export class CaslHelper {
    /**
     * Keywords which are used to filter the results of a query. These keywords cannot be properties of
     *  a filterable object type.
     */
    public readonly filterKeywords = [
        "AND",
        "OR",
        "NOT",
        "contains",
        "startsWith",
        "endsWith",
        "in",
        "notIn",
        "lt",
        "lte",
        "gt",
        "gte",
        "equals",
        "not",
        "mode"
    ] as const;
    private readonly logger: Logger = new Logger("CaslHelper");

    constructor() {
        // I don't know why this is necessary, but without it, "this" is undefined within these methods.
        this.handleCountRule = this.handleCountRule.bind(this);
        this.handleCustomRule = this.handleCustomRule.bind(this);
        this.handleReadManyRule = this.handleReadManyRule.bind(this);
        this.handleReadOneRule = this.handleReadOneRule.bind(this);
        this.handleCreateRule = this.handleCreateRule.bind(this);
        this.handleUpdateRule = this.handleUpdateRule.bind(this);
        this.handleDeleteRule = this.handleDeleteRule.bind(this);
    }

    /**
     * Retrieve the {@link Express.Request} object from the given execution context. Currently only supports GraphQL and
     *  HTTP execution contexts. If the execution context is set to something else, this will throw an Error.
     * @param context Execution context to retrieve the Request object from.
     * @throws Error if execution context type is not GraphQL or HTTP.
     */
    public getRequest(context: ExecutionContext): Request {
        if (context.getType<GqlContextType>() === "graphql") {
            this.logger.debug("Request currently in GraphQL context.");
            const gqlContext = GqlExecutionContext.create(context);
            return gqlContext.getContext().req;
        } else if (context.getType() === "http") {
            this.logger.debug("Request currently in HTTP context.");
            return context.switchToHttp().getRequest();
        } else {
            throw new Error(`CASL helper used on unsupported context type ${context.getType()}`);
        }
    }

    /**
     * Recursively get all keys used within an object, including keys used within objects in an array.
     *  This is used to determine which fields are used in a filter.
     *
     * @example
     *  <pre>{ a: 1, b: "two", c: [ { d: 3, e: "four" }, { e: 5, f: "six" } ] }</pre>
     *  will return a Set containing:
     *  <pre>"a", "b", "c", "d", "e", "f"</pre>.
     *
     * @param obj Object to get keys of.
     * @returns Set of keys used in the object.
     */
    public getKeysFromDeepObject(obj: Record<any, any>): Set<string> {
        const keys = new Set<string>();
        for (const key of Object.keys(obj)) {
            keys.add(key);
            if (Array.isArray(obj[key])) {
                for (const item of obj[key]) {
                    this.getKeysFromDeepObject(item).forEach((k) => keys.add(k));
                }
            } else if (typeof obj[key] === "object") {
                this.getKeysFromDeepObject(obj[key]).forEach((k) => keys.add(k));
            }
        }
        this.logger.debug('Keys from deep object: ' + JSON.stringify(keys));
        return keys;
    }

    /**
     * Get the {@link Express.Request} object and a {@link RuleDef}'s subject in string form. These are both frequently
     *  done at the start of a rule handler, so this method is used to reduce code duplication. Subjects have to be
     *  in string form because the Glimpse database stores them as strings. This method should only be called on
     *  rules which are not of type {@link RuleType.Custom}.
     * @param context NestJS execution context.
     * @param rule Rule to get the subject of.
     * @returns An object containing the request and subject string.
     * @throws Error if the user permissions are not initialized.
     * @throws Error if the rule is of type {@link RuleType.Custom}.
     * @private
     */
    private getReqAndSubject(context: ExecutionContext, rule: RuleDef): {
        req: Request,
        subjectStr: Extract<AbilitySubjects, string>
    } {
        if (rule[0] === RuleType.Custom) {
            throw new Error(`Cannot test rule of type "${rule[0]}" with non-custom rule handler.`);
        }

        const req = this.getRequest(context);
        if (!req.permissions) {
            throw new Error("User permissions not initialized.");
        }

        const subjectStr = this.getSubjectAsString(rule[1]);

        return { req, subjectStr };
    }

    /**
     * Get the fields which the user is selecting from the GraphQL query info object. Resolvers will typically return
     *  the entire object, but the user may only be interested in a subset of the fields, which the GraphQL driver
     *  filters out.
     *  TODO basic field selection is supported, but inline fragments and fragment spreads are not. It will most likely
     *   be easiest to implement this when doing UserPermissions and GroupPermissions, where unions are used.
     * @param context NestJS execution context.
     * @returns Set containing the field names which the user is selecting.
     */
    public getSelectedFields(context: ExecutionContext): Set<string> {
        if (context.getType<GqlContextType>() !== "graphql") {
            throw new Error("Cannot get GraphQL info from non-GraphQL context")
        }
        const info = GqlExecutionContext.create(context).getInfo<GraphQLResolveInfo>();

        const fields = new Set<string>();
        for (const fieldNode of info.fieldNodes) {

            for (const selection of fieldNode.selectionSet?.selections || []) {
                this.assertNodeKind(selection, [Kind.FIELD, Kind.INLINE_FRAGMENT, Kind.FRAGMENT_SPREAD]);
                if (selection.kind === Kind.FIELD) {
                    fields.add(selection.name.value);
                } else if (selection.kind === Kind.INLINE_FRAGMENT) {
                    // TODO
                    throw new Error('Unsupported selection Kind "INLINE_FRAGMENT"');
                } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
                    // TODO
                    throw new Error('Unsupported selection Kind "FRAGMENT_SPREAD"');
                }
            }
        }
        this.logger.debug(`User requested the following fields in their query: ${JSON.stringify(Array.from(fields))}`);
        return fields;
    }

    /**
     * Check that the user is allowed to filter a query by the given fields, assuming a filter has been supplied.
     * @param context NestJS execution context.
     * @param req Express request object. Should contain the user's permissions on <pre>req.permissions</pre>.
     * @param subjectStr The type of subject which the user is attempting to filter.
     * @param argName Name of the filter parameter in the case of GraphQL queries, or the filter property within the
     *  body for HTTP queries.
     * @todo Filtering currently only supports GraphQL queries.
     * @returns True if the user has permission to filter by all the fields they are filtering by, or false if not.
     */
    public canFilterByFields(
        context: ExecutionContext,
        req: Request,
        subjectStr: Extract<AbilitySubjects, string>,
        argName: string
    ): boolean {
        const contextType = context.getType<GqlContextType>();
        this.logger.verbose(`Filtering in ${contextType} context`);
        const filteringFields = new Set<string>();
        if (contextType === "graphql") {
            const info = GqlExecutionContext.create(context).getInfo<GraphQLResolveInfo>();

            // Each requested field...
            for (const fieldNode of info.fieldNodes) {

                // Find the argument which is the filter, if present.
                const filterArg = fieldNode.arguments.find((arg) => arg.name.value === argName);
                if (filterArg === undefined) {
                    continue;
                }

                this.assertNodeKind(filterArg.value, [Kind.OBJECT, Kind.VARIABLE]);

                // The filter is an object, i.e. it was passed directly in the query as an AST.
                if (filterArg.value.kind === Kind.OBJECT) {
                    this.logger.verbose("Filtering argument passed in as AST.");
                    const filterAst = filterArg.value;
                    visit(filterAst, {
                        ObjectField: {
                            enter: (node) => {
                                const name = node.name.value;
                                if (this.filterKeywords.includes(name as any)) {
                                    return;
                                }
                                filteringFields.add(name);
                            }
                        }
                    });
                } else { // The filter is a variable, we can just get the JSON object from the variables.
                    this.logger.verbose("Filtering argument passed in as variable.");
                    const argName = filterArg.name.value;
                    const filterObj = info.variableValues[argName];
                    this.getKeysFromDeepObject(filterObj).forEach((k) => {
                        if (!this.filterKeywords.includes(k as any)) {
                            filteringFields.add(k);
                        }
                    });
                }
            }
        } else if (contextType === "http") {
            // TODO
            throw new Error("HTTP filtering not yet implemented");
        } else {
            throw new Error("Unsupported execution context");
        }

        this.logger.debug(
            `User attempting to filter using the following fields in their query: ${
                JSON.stringify(Array.from(filteringFields))
            }`);

        for (const field of filteringFields) {
            // Filter actions cannot have conditions, and cannot be applied to subject values.
            // TODO make sure the user has no filter permissions that have conditions
            if (!req.permissions.can(AbilityAction.Filter, subjectStr, field)) {
                this.logger.debug(`User does not have permission to filter by field "${field}"`);
                return false;
            }
        }
        return true;
    }

    /**
     * Check that the user is allowed to sort a query by the given fields, assuming a sort order has been supplied.
     * @param context NestJS execution context.
     * @param req Express request object. Should contain the user's permissions on <pre>req.permissions</pre>.
     * @param subjectStr The type of subject which the user is attempting to sort.
     * @param argName Name of the sort parameter in the case of GraphQL queries, or the sort property within the body
     *  for HTTP queries.
     * @todo Sorting currently only supports GraphQL queries.
     * @returns True if the user has permission to sort by all the fields they are sorting by, or false if not.
     */
    public canSortByFields(
        context: ExecutionContext,
        req: Request,
        subjectStr: Extract<AbilitySubjects, string>,
        argName: string
    ): boolean {
        const contextType = context.getType<GqlContextType>();
        this.logger.verbose(`Sorting in ${contextType} context`);
        const sortingFields = new Set<string>();
        if (contextType === "graphql") {
            const info = GqlExecutionContext.create(context).getInfo<GraphQLResolveInfo>();
            for (const fieldNode of info.fieldNodes) {

                const sortArg = fieldNode.arguments.find((arg) => arg.name.value === argName);
                if (sortArg === undefined) {
                    continue;
                }

                this.assertNodeKind(sortArg.value, [Kind.LIST, Kind.VARIABLE]);

                if (sortArg.value.kind === Kind.LIST) {
                    this.logger.verbose("Sorting argument passed in as AST.");
                    const sortAst = sortArg.value;
                    visit(sortAst, {
                        ObjectField: {
                            enter: (node) => {
                                if (node.name.value === "field") {
                                    this.assertNodeKind(node.value, Kind.ENUM);
                                    sortingFields.add((node.value as EnumValueNode).value);
                                }
                            }
                        }
                    });
                } else {
                    this.logger.verbose("Sorting argument passed in as variable.");
                    const argName = sortArg.name.value;
                    const sortValue = info.variableValues[argName];
                    if (!Array.isArray(sortValue)) {
                        throw new Error("Ordering value must be an array");
                    }
                    sortValue.forEach((sortObj) => {
                        sortingFields.add(sortObj.field);
                    });
                }
            }
        } else if (contextType === "http") {
            // TODO
            throw new Error("Sorting via HTTP is not yet supported.");
        } else {
            throw new Error("Unsupported execution context");
        }

        this.logger.debug(
            `User attempting to sort using the following fields in their query: ${
                JSON.stringify(Array.from(sortingFields))
            }`
        );

        for (const field of sortingFields) {
            // Sort actions cannot have conditions, and cannot be applied to subject values.
            // TODO make sure the user has no sort permissions that have conditions
            if (!req.permissions.can(AbilityAction.Sort, subjectStr, field)) {
                this.logger.debug(`User does not have permission to sort by field "${field}"`);
                return false;
            }
        }
        return true;
    }

    /**
     * Check that the user has permission to paginate the supplied subject type. We need this because cursor-based
     *  pagination requires sorting by ID, and therefore to use it, the user needs to have permission to sort by ID.
     * @param context NestJS execution context.
     * @param ability GlimpseAbility instance.
     * @param subjectName Name of the subject to check permissions for.
     * @param argName Name of the pagination argument in the GraphQL query.
     * @todo Filtering currently only supports GraphQL queries.
     * @returns True if the user has permission to use the supplied pagination argument, false otherwise.
     */
    public canPaginate(
        context: ExecutionContext,
        ability: GlimpseAbility,
        subjectName: Extract<AbilitySubjects, string>,
        argName: string
    ): boolean {
        const contextType = context.getType<GqlContextType>();
        this.logger.verbose(`Paginating in ${contextType} context`);
        if (contextType === "graphql") {
            const info = GqlExecutionContext.create(context).getInfo<GraphQLResolveInfo>();

            for (const fieldNode of info.fieldNodes) {

                const paginationArg = fieldNode.arguments.find((arg) => arg.name.value === argName);
                if (paginationArg === undefined || paginationArg === null) {
                    continue;
                }

                this.assertNodeKind(paginationArg.value, [Kind.OBJECT, Kind.VARIABLE]);

                let paginationArgValue: PaginationInput | undefined;
                if (paginationArg.value.kind === Kind.OBJECT) {
                    this.logger.verbose("Pagination argument passed in as AST.");
                    const paginationAst = paginationArg.value;
                    const parsedPaginationValue: any = {};
                    visit(paginationAst, {
                        ObjectField: {
                            enter: (node) => {
                                // All pagination arguments are ints or null.
                                this.assertNodeKind(node.value, [Kind.INT, Kind.NULL]);
                                if (node.value.kind === Kind.INT) {
                                    parsedPaginationValue[node.name.value] = parseInt(
                                        (node.value as IntValueNode).value
                                    );
                                } else {
                                    parsedPaginationValue[node.name.value] = null;
                                }
                            }
                        }
                    });

                    if (parsedPaginationValue.take === undefined) {
                        throw new Error("Pagination requires a take argument.");
                    }
                    paginationArgValue = parsedPaginationValue;
                } else {
                    this.logger.verbose("Pagination argument passed in as variable.");
                    const argName = paginationArg.name.value;
                    if ((info.variableValues[argName] as any).take === undefined) {
                        throw new Error("Pagination requires a take argument.");
                    }
                    paginationArgValue = info.variableValues[argName] as PaginationInput;
                }

                if (paginationArgValue && typeof paginationArgValue.cursor === "number") {
                    if (!ability.can(AbilityAction.Sort, subjectName, "id")) {
                        return false;
                    }
                }
            }

            return true;
        } else if (contextType === "http") {
            // TODO
            throw new Error("Pagination via HTTP is not yet supported.");
        } else {
            throw new Error("Unsupported execution context");
        }
    }

    /**
     * Get the fields supplied in a Create/Update mutation. These fields are then used to make sure the user has
     *  permission to create/update an object based on those fields.
     * @param context NestJS execution context.
     * @param argName Name of the input data argument in the GraphQL query.
     * @todo Inputting data currently only supports GraphQL queries.
     * @returns Set of field names supplied in the input data.
     */
    public getInputFields(context: ExecutionContext, argName: string): Set<string> {
        const contextType = context.getType<GqlContextType>();
        this.logger.verbose(`Retrieving input fields in ${contextType} context`);
        if (contextType === "graphql") {
            const info = GqlExecutionContext.create(context).getInfo<GraphQLResolveInfo>();

            const inputFields = new Set<string>();
            for (const fieldNode of info.fieldNodes) {

                const inputArg = fieldNode.arguments.find((arg) => arg.name.value === argName);
                if (inputArg === undefined) {
                    continue;
                }

                this.assertNodeKind(inputArg.value, [Kind.OBJECT, Kind.VARIABLE]);

                if (inputArg.value.kind === Kind.OBJECT) {
                    this.logger.verbose("Input argument passed in as AST.");
                    const inputAst = inputArg.value;
                    visit(inputAst, {
                        ObjectField: {
                            enter: (node) => {
                                // Only single-deep fields are allowed in input data at the moment. I.e., you cannot
                                //  create relations in a single mutation.
                                this.assertNodeKind(node.value, [
                                    Kind.ENUM,
                                    Kind.STRING,
                                    Kind.INT,
                                    Kind.BOOLEAN,
                                    Kind.FLOAT,
                                    Kind.NULL
                                ]);
                                inputFields.add(node.name.value);
                            }
                        }
                    });
                } else {
                    this.logger.verbose("Input argument passed in as variable.");
                    const argName = inputArg.name.value;
                    for (const fieldName of Object.keys(info.variableValues[argName])) {
                        // Only single-deep fields are allowed in input data at the moment. I.e., you cannot
                        //  create relations in a single mutation.
                        if (typeof info.variableValues[argName][fieldName] === "object") {
                            throw new Error("Input data cannot contain nested objects.");
                        }
                        inputFields.add(fieldName);
                    }
                }
            }
            this.logger.debug(`User input the following fields in their mutation: ${JSON.stringify(Array.from(inputFields))}`);
            return inputFields;
        } else if (contextType === "http") {
            // TODO
            return new Set();
        } else {
            throw new Error("Unsupported execution context");
        }
    }

    /**
     * Assert that a GraphQL node is of the expected type or types. If it is not, throw an error.
     *  This is used in the AST traversal code to ensure that the AST is in the expected format.
     *  An error is never expected to be thrown, however we should use this method to ensure that
     *  the developer did not make a mistake in the AST traversal code or not account for another
     *  feature of GraphQL.
     * @param node GraphQL node to check.
     * @param expectedKind Expected kind of the node. Can also be an array of Kinds, in which case
     *  the node must be one of the expected kinds.
     * @throws Error if the node is not of the expected kind.
     * @private
     */
    private assertNodeKind(node: { kind: Kind } | undefined, expectedKind: Kind | Kind[]): void {
        if (Array.isArray(expectedKind)) {
            this.logger.verbose(`Asserting that node kind "${node?.kind}" is one of "${expectedKind.join('", "')}".`)
            if (!expectedKind.includes(node?.kind)) {
                // This should never happen.
                this.logger.error(
                    `Encountered unexpected Node Kind "${node?.kind || "undefined"}" \
                     when traversing AST. Expected Node to be one of the following: \
                     ${expectedKind.join(", ")}. Node definition: ${node}`
                );
                throw new InternalServerErrorException("Unexpected node type");
            }
        } else {
            this.logger.verbose(`Asserting that node kind "${node?.kind}" is "${expectedKind}".`)
            if (node?.kind !== expectedKind) {
                // This should never happen.
                this.logger.error(
                    `Encountered unexpected Node Kind "${node?.kind || "undefined"}" \
                     when traversing AST. Expected Node to be ${expectedKind}. \
                     Node definition: ${node}`
                );
                throw new InternalServerErrorException("Unexpected node type");
            }
        }
    }

    /**
     * Convert an AbilitySubject value into a string. Glimpse stores all subjects as strings within the database, so
     *  we must convert non-string AbilitySubject values into strings before passing them to CASL. This is
     *  accomplished by returning the static "modelName" property on classes if it exists, or the class name otherwise.
     * @param subj Subject to convert.
     * @returns String representation of the subject.
     */
    public getSubjectAsString(subj: AbilitySubjects): Extract<AbilitySubjects, string> {
        // Since Glimpse stores all subjects as strings within the DB, we must convert the ability subject
        //  to a string before testing. Typeof classes === function.
        if (typeof subj === "string") {
            this.logger.verbose('Getting subject as string but subject is already a string: ' + subj);
            return subj;
        } else if (typeof subj === "function") {
            this.logger.verbose('Getting subject as a string from a class.');
            const subjStr = (subj.modelName || subj.name) as Extract<AbilitySubjects, string>;
            this.logger.verbose('Subject string: ' + subjStr);
            return subjStr;
        } else {
            this.logger.verbose(
                'Attempted to get subject from a string but subject is not a string or class. Type: ' +
                typeof subj
            );
            throw new Error("Unknown subject type");
        }
    }

    /**
     * Test that the given ability has permission to perform the given rule. Rule is defined as a custom function
     *  set within the rule decorator. This function is almost as simple as just calling the rule's custom function,
     *  but it does perform a couple sanity checks before doing so.
     *
     * @typeParam T - The type of the value expected to be returned by the resolver/handler which this rule is being
     *  applied to.
     * @param context NestJS execution context.
     * @param rule Rule to test. If rule type is not Custom, or if the rule definition is not a RuleFn, an error will be
     *  thrown.
     * @param handler The handler that calls the request method/resolver, or the next interceptor in line if applicable.
     *  This is passed to the rule function, allowing the rule function to call the resolver at the appropriate time.
     * @returns The returned value from the rule function. Typically, this will be the value returned from the
     *  resolver/handler, but the rule function is allowed to mutate that value, or return a completely different value.
     *  Whatever is returned should be treated as the final value returned from the resolver/handler.
     * @throws Error if the rule type is not Custom, or if the rule definition is not a RuleFn.
     */
    public handleCustomRule<T = any>(
        context: ExecutionContext,
        rule: RuleDef,
        handler: () => Observable<T>
    ): Observable<T> {
        if (rule[0] !== RuleType.Custom) {
            throw new Error(`Cannot test rule of type "${rule[0]}" with testCustomRule.`);
        }

        return rule[1](context, rule, handler);
    }

    /**
     * Test that the current user has permission to perform the given {@link Rule} within their {@link GlimpseAbility},
     *  and then call and return the passed handler's value if so. Permissions are also tested against the specific
     *  value that is returned by the handler, so it is possible for the handler to be called and the request still to
     *  fail if the user didn't have permission to read the specific value in question. For this reason, the
     *  resolvers/handlers which this rule handler is applied to should not have any mutating effects.
     *
     *  The current user's permissions are determined by the {@link Request#permissions} property within the current
     *  NestJS execution context. The {@link CaslInterceptor} is expected to have already initialized this value.
     *
     *  If any rule checks fail, then this method sets {@link Request#passed} to false on the context's request object
     *  and returns null, potentially before calling the handler. From there, the {@link CaslInterceptor} will see that
     *  {@link Request#passed} is false and throw an error.
     *
     * @see {@link https://github.com/rpitv/glimpse-api/wiki/Authorization}
     *
     * @typeParam T - The type of the value expected to be returned by the resolver/handler which this rule is being
     *  applied to. Currently, this must be an instance of a valid {@link AbilitySubjects} type.
     * @param context - NestJS execution context.
     * @param rule - Rule to test. If rule type is not ReadOne, or if the rule definition is a RuleFn, an error will be
     *  thrown.
     * @param handler - The handler that calls the request method/resolver, or the next interceptor in line if
     *  applicable. This is called after the necessary rule checks pass, and then additional checks are applied to the
     *  return value.
     * @returns The value returned from the handler, or null if the rule checks fail. This rule handler does not ever
     *  mutate the return value from the next handler.
     * @throws Error if the rule type is not {@link RuleType.ReadOne}.
     * @throws Error if the current user's permissions are not initialized.
     */
    public handleReadOneRule<T extends Exclude<AbilitySubjects, string>>(
        context: ExecutionContext,
        rule: RuleDef,
        handler: () => Observable<T | null>
    ): Observable<T | null> {
        this.logger.debug("Handling ReadOne rule.");
        const { req, subjectStr } = this.getReqAndSubject(context, rule);

        // Basic test with the provided action and subject.
        if (!req.permissions.can(AbilityAction.Read, subjectStr)) {
            this.logger.verbose('Failed basic ReadOne rule test.');
            req.passed = false;
            return of(null);
        }

        const fields: Set<string> = new Set();
        // Field-based tests can only be done pre-resolver for GraphQL requests, since the request includes the
        //  fields to be returned. Non-GraphQL requests don't include this, as all fields are returned.
        if (context.getType<GqlContextType>() === "graphql") {
            this.getSelectedFields(context).forEach((v) => fields.add(v));

            // Remove any specifically excluded fields from the list of fields.
            if (rule[2]?.excludeFields) {
                rule[2].excludeFields.forEach((v) => fields.delete(v));
            }

            // Test the ability against each requested field
            for (const field of fields) {
                if (!req.permissions.can(AbilityAction.Read, subjectStr, field)) {
                    this.logger.verbose(`Failed field-based ReadOne rule test for field "${field}".`);
                    req.passed = false;
                    return of(null);
                }
            }
        }

        // Call next rule, or resolver/handler if no more rules.
        return handler().pipe(
            map((value) => {
                // Handler already marked the request as failed for some permission error.
                if (req.passed === false) {
                    this.logger.verbose("Failed ReadOne rule test. Handler already marked as failed.")
                    return null;
                }

                // If the value is nullish, there's no value to check, so just return null.
                if (value === null || value === undefined) {
                    req.passed = true;
                    return null;
                }

                // Repeat previous tests with the value as the subject.

                const subjectObj = subject(subjectStr, value);

                if (!req.permissions.can(AbilityAction.Read, subjectObj)) {
                    this.logger.verbose('Failed basic ReadOne rule test with value as subject.');
                    req.passed = false;
                    return null;
                }

                // In GQL contexts, fields were determined pre-resolver. In other contexts, we can only determine them
                //  post-resolver, which is done here.
                if (context.getType<GqlContextType>() !== "graphql") {
                    Object.keys(value).forEach((v) => fields.add(v));

                    // Remove any specifically excluded fields from the list of fields.
                    if (rule[2]?.excludeFields) {
                        rule[2].excludeFields.forEach((v) => fields.delete(v));
                    }
                }

                // Test the ability against each requested field with subject value.
                for (const field of fields) {
                    if (!req.permissions.can(AbilityAction.Read, subjectObj, field)) {
                        this.logger.verbose(`Failed field-based ReadOne rule test for field "${field}" with value as subject.`);
                        req.passed = false;
                        return null;
                    }
                }

                req.passed = true;
                return value;
            })
        );
    }

    /**
     * Test that the current user has permission to perform the given {@link Rule} within their {@link GlimpseAbility},
     *  and then call and return the passed handler's value if so. Permissions are also tested against the specific
     *  values that is returned by the handler, so it is possible for the handler to be called and the request still to
     *  fail if the user didn't have permission to read the specific values in question. For this reason, the
     *  resolvers/handlers which this rule handler is applied to should not have any mutating effects.
     *
     *  In addition to traditional subject/field permission checks, ReadMany rules also allow for the use of sorting,
     *  filtering, and pagination. These permissions are handled as such:
     *
     *  - <b>Sorting:</b> The user must have {@link AbilityAction.Sort} permission on the field being sorted by. The
     *    user's {@link GlimpseAbility} to read the field(s) being sorted is not currently taken into account. As such,
     *    it is possible for a user to infer some information about fields which they cannot read as long as they have
     *    permission to sort by them.
     *  - <b>Filtering:</b> The user must have {@link AbilityAction.Filter} permission on the field being filtered by.
     *    The user's {@link GlimpseAbility} to read the field(s) being filtered is not currently taken into account. As
     *    such, it is possible for a user to infer some information about fields which they cannot read as long as they
     *    have permission to filter by them.
     *  - <b>Pagination:</b> Generally, there are no permission checks against permission necessary. However, if the
     *    user is using cursor-based pagination, they must have permission to sort by the "ID" field. This is because
     *    cursor-based pagination requires sorting by some field by its very nature, and the "ID" field is the only
     *    field which Glimpse currently allows to be used for this. For skip-based pagination, there are no permission
     *    checks.
     *
     *  Currently, sorting and filtering permissions cannot have conditions applied to them. It is expected that any
     *  sorting or filtering permissions that the user has do not have conditions applied. If they do, the conditions
     *  will currently be ignored and the user will be able to sort or filter by the field regardless of the conditions.
     *
     *  The current user's permissions are determined by the {@link Request#permissions} property within the current
     *  NestJS execution context. The {@link CaslInterceptor} is expected to have already initialized this value.
     *
     *  If any rule checks fail, then this method sets {@link Request#passed} to false on the context's request object
     *  and returns null, potentially before calling the handler. From there, the {@link CaslInterceptor} will see that
     *  {@link Request#passed} is false and throw an error.
     *
     * @see {@link https://github.com/rpitv/glimpse-api/wiki/Authorization}
     *
     * @typeParam T - The type of the array of values expected to be returned by the resolver/handler which this rule
     *  is being applied to. E.g., if the resolver returns an array of {@link User| Users}, T would be {@link User}.
     *  Currently, this must be an instance of a valid {@link AbilitySubjects} type.
     * @param context - NestJS execution context.
     * @param rule - Rule to test. If rule type is not ReadMany, or if the rule definition is a RuleFn, an error will be
     *  thrown.
     * @param handler - The handler that calls the request method/resolver, or the next interceptor in line if
     *  applicable. This is called after the necessary rule checks pass, and then additional checks are applied to the
     *  return value.
     * @returns The value returned from the handler, or null if the rule checks fail. If the rule's strict mode is
     *  enabled, then this will return null if the user doesn't have permission to read one or more of the fields on
     *  any object within the array returned by handler. However, if the rule's strict mode is disabled, then those
     *  fields will be set to null on the relevant objects. Note that if the user doesn't have permission to read the
     *  field on <i>any</i> object of the given type, the same behavior as strict mode will occur. That is, null will
     *  be returned and {@link Request#passed} will be set to false. It is only when the user has permission to read the
     *  field on some objects of the given type that the strict mode behavior will differ.
     * @throws Error if the rule type is not {@link RuleType.ReadMany}.
     * @throws Error if the current user's permissions are not initialized.
     */
    public handleReadManyRule<T extends Exclude<AbilitySubjects, string>>(
        context: ExecutionContext,
        rule: RuleDef,
        handler: () => Observable<T[] | null>
    ): Observable<T[] | null> {
        this.logger.debug("Handling ReadMany rule.");
        const { req, subjectStr } = this.getReqAndSubject(context, rule);

        // Basic test with the provided action and subject.
        if (!req.permissions.can(AbilityAction.Read, subjectStr)) {
            this.logger.verbose("Failed basic ReadMany rule test.")
            req.passed = false;
            return of(null);
        }

        // Make sure user has permission to sort by the fields which they are sorting by.
        if(!this.canSortByFields(context, req, subjectStr, rule[2]?.orderInputName ?? "order")) {
            this.logger.verbose(
                "User doesn't have permission to sort by one or more of their supplied sorting arguments."
            );
            req.passed = false;
            return of(null);
        }

        // Make sure user has permission to filter by the fields which they are filtering by.
        if(!this.canFilterByFields(context, req, subjectStr, rule[2]?.filterInputName ?? "filter")) {
            this.logger.verbose(
                "User doesn't have permission to filter by one or more of their supplied filters."
            );
            req.passed = false;
            return of(null);
        }

        if (!this.canPaginate(context, req.permissions, subjectStr, rule[2]?.paginationInputName ?? "pagination")) {
            this.logger.verbose(
                `User supplied cursor-based pagination argument(s) but doesn't have permission to sort by ID on the 
                subject "${subjectStr}".`
            );
            req.passed = false;
            return of(null);
        }

        const fields: Set<string> = new Set();
        // Field-based tests can only be done pre-resolver for GraphQL requests, since the request includes the
        //  fields to be returned. Non-GraphQL requests don't include this, as all fields are returned.
        if (context.getType<GqlContextType>() === "graphql") {
            this.getSelectedFields(context).forEach((v) => fields.add(v));

            // Remove any specifically excluded fields from the list of fields.
            if (rule[2]?.excludeFields) {
                rule[2].excludeFields.forEach((v) => fields.delete(v));
            }

            // Test the ability against each requested field
            for (const field of fields) {
                if (!req.permissions.can(AbilityAction.Read, subjectStr, field)) {
                    this.logger.verbose(`Failed field-based ReadMany rule test for field "${field}".`);
                    req.passed = false;
                    return of(null);
                }
            }
        }

        // Call next rule, or resolver/handler if no more rules.
        return handler().pipe(
            map((values) => {
                // Handler already marked the request as failed for some permission error.
                if (req.passed === false) {
                    this.logger.verbose("Failed ReadMany rule test. Handler already marked as failed.")
                    return null;
                }

                // If the value is nullish, there's no value to check, so just return null.
                if (values === null || values === undefined) {
                    req.passed = true;
                    return null;
                }

                // Repeat previous tests with the values as the subject.

                for (const value of values) {
                    const subjectObj = subject(subjectStr, value);
                    if (!req.permissions.can(AbilityAction.Read, subjectObj)) {
                        this.logger.verbose("Failed basic ReadMany rule test on one or more values.");
                        req.passed = false;
                        return null;
                    }

                    // In GQL contexts, fields were determined pre-resolver. In other contexts, we can only determine them
                    //  post-resolver, which is done here.
                    if (context.getType<GqlContextType>() !== "graphql") {
                        Object.keys(value).forEach((v) => fields.add(v));

                        // Remove any specifically excluded fields from the list of fields.
                        if (rule[2]?.excludeFields) {
                            rule[2].excludeFields.forEach((v) => fields.delete(v));
                        }
                    }

                    // Test the ability against each requested field with subject value.
                    for (const field of fields) {
                        if (!req.permissions.can(AbilityAction.Read, subjectObj, field)) {
                            // Strict mode will cause the entire request to fail if any field fails. Otherwise, the field
                            //  will be set to null. The user won't necessarily know (as of now) whether the field is
                            //  actually null, or they just can't read it.
                            if (rule[2]?.strict ?? false) {
                                this.logger.verbose(`Failed field-based ReadMany rule test for field "${field}" on one or more values.`);
                                req.passed = false;
                                return null;
                            } else {
                                this.logger.verbose(`Failed field-based ReadMany rule test for field "${field}" on one value. More may come...`);
                                value[field] = null;
                            }
                        }
                    }
                }

                req.passed = true;
                return values;
            })
        );
    }

    /**
     * Test that the current user has permission to perform the given {@link Rule} with type {@link RuleType.Count}
     *  within their {@link GlimpseAbility}, and then call and return the passed handler's value if so. The user must
     *  have permission to read at least one field on the subject type which they're attempting to count. The user must
     *  also have permission to filter by any fields which they're trying to filter their count by.
     *
     *  Currently, filtering permissions cannot have conditions applied to them. It is expected that any filtering
     *  permissions that the user has do not have conditions applied. If they do, the conditions will currently be
     *  ignored and the user will be able to sort or filter by the field regardless of the conditions.
     *
     *  Counting is primarily used for pagination so the interface can show how many pages are remaining.
     *
     *  The current user's permissions are determined by the {@link Request#permissions} property within the current
     *  NestJS execution context. The {@link CaslInterceptor} is expected to have already initialized this value.
     *
     *  If any rule checks fail, then this method sets {@link Request#passed} to false on the context's request object
     *  and returns null, potentially before calling the handler. From there, the {@link CaslInterceptor} will see that
     *  {@link Request#passed} is false and throw an error.
     *
     * @see {@link handleReadManyRule} for where pagination is used.
     * @see {@link https://github.com/rpitv/glimpse-api/wiki/Authorization}
     *
     * @param context - NestJS execution context.
     * @param rule - Rule to test. If rule type is not Count, or if the rule definition is a RuleFn, an error will be
     *  thrown.
     * @param handler - The handler that calls the request method/resolver, or the next interceptor in line if
     *  applicable. This is called after the necessary rule checks pass.
     * @returns The value returned from the handler, or null if the rule checks fail. This rule handler does not ever
     *  mutate the return value from the next handler.
     * @throws Error if the rule type is not {@link RuleType.Count}.
     * @throws Error if the current user's permissions are not initialized.
     */
    public handleCountRule(
        context: ExecutionContext,
        rule: RuleDef,
        handler: () => Observable<number | null>
    ): Observable<number | null> {
        this.logger.debug("Handling Count rule.");
        const { req, subjectStr } = this.getReqAndSubject(context, rule);

        // Basic test with the provided action and subject.
        if (!req.permissions.can(AbilityAction.Read, subjectStr)) {
            this.logger.verbose("Failed basic Count rule test.");
            req.passed = false;
            return of(null);
        }

        // Make sure user has permission to filter by the fields which they are filtering by.
        if(!this.canFilterByFields(context, req, subjectStr, rule[2]?.filterInputName ?? "filter")) {
            this.logger.verbose(
                "User doesn't have permission to filter by one or more of their supplied filters."
            );
            req.passed = false;
            return of(null);
        }

        // No permission checks need to be applied to the returned value (it's just a number), so return it.
        req.passed = true;
        return handler();
    }

    /**
     * Test that the current user has permission to perform the given {@link Rule} with type {@link RuleType.Create}
     *  within their {@link GlimpseAbility}, and then call and return the passed handler's value if so. The user must
     *  have permission to create at least one field on the subject type which they're attempting to create. The user
     *  must also have permission to read the fields which they're attempting to read after creation. If they have
     *  permission to create the object but can't read the requested fields, the creation will be rolled back. The user
     *  must have permission not only to create an object with the fields they've supplied, but also any default
     *  values generated by the database.
     *
     *  The current user's permissions are determined by the {@link Request#permissions} property within the current
     *  NestJS execution context. The {@link CaslInterceptor} is expected to have already initialized this value.
     *
     *  If any rule checks fail, then this method sets {@link Request#passed} to false on the context's request object
     *  and returns null, potentially before calling the handler. From there, the {@link CaslInterceptor} will see that
     *  {@link Request#passed} is false and throw an error.
     *
     * @see {@link https://github.com/rpitv/glimpse-api/wiki/Authorization}
     *
     * @param context - NestJS execution context.
     * @param rule - Rule to test. If rule type is not Create, or if the rule definition is a RuleFn, an error will be
     *  thrown.
     * @param handler - The handler that calls the request method/resolver, or the next interceptor in line if
     *  applicable. This is called after the necessary rule checks pass.
     * @returns The value returned from the handler, or null if the rule checks fail. This rule handler does not ever
     *  mutate the return value from the next handler.
     * @throws Error if the rule type is not {@link RuleType.Create}.
     * @throws Error if the current user's permissions are not initialized.
     */
    public handleCreateRule<T extends Exclude<AbilitySubjects, string>>(
        context: ExecutionContext,
        rule: RuleDef,
        handler: () => Observable<T | null>
    ): Observable<T | null> {
        this.logger.debug("Handling Create rule.");
        const { req, subjectStr } = this.getReqAndSubject(context, rule);

        // Basic test with the provided action and subject.
        if (!req.permissions.can(AbilityAction.Create, subjectStr)) {
            this.logger.verbose("Failed basic Create rule test.");
            req.passed = false;
            return of(null);
        }

        const inputFields = this.getInputFields(context, rule[2]?.inputName ?? "input");

        // Make sure user can create an object with the fields they've supplied.
        for (const field of inputFields) {
            if (!req.permissions.can(AbilityAction.Create, subjectStr, field)) {
                this.logger.verbose(`Failed Create rule test for field ${field}.`);
                req.passed = false;
                return of(null);
            }
        }

        return handler()
            .pipe(
                map((newValue) => {
                    // Handler already marked the request as failed for some permission error.
                    if (req.passed === false) {
                        this.logger.verbose("Failed Create rule test. Handler already marked as failed.")
                        return null;
                    }

                    const subjectObj = subject(subjectStr, newValue);

                    // Check that the user has permission to create an object like this one. If not, prisma tx will roll back.
                    for (const field of Object.keys(newValue)) {
                        if (!req.permissions.can(AbilityAction.Create, subjectObj, field)) {
                            this.logger.verbose(`Failed Create rule test for field ${field} with value.`);
                            req.passed = false;
                            return null;
                        }
                    }

                    req.passed = true;
                    return newValue;
                })
            )
            .pipe((v) => {
                // Make sure user has permission to read the fields they're trying to read after the creation. Creation will
                //  be rolled back if not.
                return this.handleReadOneRule(context, rule, () => v);
            });
    }

    /**
     * Test that the current user has permission to perform the given {@link Rule} with type {@link RuleType.Update}
     *  within their {@link GlimpseAbility}, and then call and return the passed handler's value if so. The user must
     *  have permission to update at least one field on the subject type which they're attempting to update. The user
     *  must also have permission to read the fields which they're attempting to read after the update. If they have
     *  permission to update the object but can't read the requested fields, the update will be rolled back. The user
     *  must have permission not only to update an object with the fields they've supplied, but also any default
     *  values generated by the database.
     *
     *  The current user's permissions are determined by the {@link Request#permissions} property within the current
     *  NestJS execution context. The {@link CaslInterceptor} is expected to have already initialized this value.
     *
     *  If any rule checks fail, then this method sets {@link Request#passed} to false on the context's request object
     *  and returns null, potentially before calling the handler. From there, the {@link CaslInterceptor} will see that
     *  {@link Request#passed} is false and throw an error.
     *
     * @see {@link https://github.com/rpitv/glimpse-api/wiki/Authorization}
     *
     * @param context - NestJS execution context.
     * @param rule - Rule to test. If rule type is not Update, or if the rule definition is a RuleFn, an error will be
     *  thrown.
     * @param handler - The handler that calls the request method/resolver, or the next interceptor in line if
     *  applicable. This is called after the necessary rule checks pass.
     * @returns The value returned from the handler, or null if the rule checks fail. This rule handler does not ever
     *  mutate the return value from the next handler.
     * @throws Error if the rule type is not {@link RuleType.Update}.
     * @throws Error if the current user's permissions are not initialized.
     */
    public handleUpdateRule<T extends Exclude<AbilitySubjects, string>>(
        context: ExecutionContext,
        rule: RuleDef,
        handler: () => Observable<T | null>
    ): Observable<T | null> {
        this.logger.debug("Handling Update rule.");
        const { req, subjectStr } = this.getReqAndSubject(context, rule);

        // Basic test with the provided action and subject.
        if (!req.permissions.can(AbilityAction.Update, subjectStr)) {
            this.logger.verbose("Failed basic Update rule test.");
            req.passed = false;
            return of(null);
        }

        const inputFields = this.getInputFields(context, rule[2]?.inputName ?? "input");

        // Make sure user can update an object with the fields they've supplied.
        for (const field of inputFields) {
            if (!req.permissions.can(AbilityAction.Update, subjectStr, field)) {
                this.logger.verbose(`Failed Update rule test for field ${field}.`);
                req.passed = false;
                return of(null);
            }
        }

        // FIXME currently there is no way to check within the interceptor if the user has permission to update the
        //  object to update before it's been updated. This check needs to be done in the resolver. This can be solved
        //  in a future refactor.

        return handler()
            .pipe(
                map((newValue) => {
                    // Handler already marked the request as failed for some permission error.
                    if (req.passed === false) {
                        this.logger.verbose("Failed Update rule test. Handler already marked as failed.")
                        return null;
                    }

                    const subjectObj = subject(subjectStr, newValue);

                    // Check that the user has permission to update TO an object like this one. If not, prisma tx will roll
                    //  back.
                    for (const field of inputFields) {
                        if (!req.permissions.can(AbilityAction.Update, subjectObj, field)) {
                            this.logger.verbose(`Failed Update rule test for field ${field} with value.`);
                            req.passed = false;
                            return null;
                        }
                    }

                    req.passed = true;
                    return newValue;
                })
            )
            .pipe((v) => {
                // Make sure user has permission to read the fields they're trying to read after the update. Update will
                //  be rolled back if not.
                return this.handleReadOneRule(context, rule, () => v);
            });
    }

    /**
     * Test that the current user has permission to perform the given {@link Rule} with type {@link RuleType.Delete}
     *  within their {@link GlimpseAbility}, and then call and return the passed handler's value if so. The user must
     *  have permission to delete the object that they are trying to delete. Field-based permissions do not
     *  make sense in the context of delete actions, and as a result, are ignored. The user must also have permission to
     *  read the fields which they're attempting to read after the deletion. If they have permission to delete the
     *  object but can't read the requested fields, the deletion will be rolled back.
     *
     *  The current user's permissions are determined by the {@link Request#permissions} property within the current
     *  NestJS execution context. The {@link CaslInterceptor} is expected to have already initialized this value.
     *
     *  If any rule checks fail, then this method sets {@link Request#passed} to false on the context's request object
     *  and returns null, potentially before calling the handler. From there, the {@link CaslInterceptor} will see that
     *  {@link Request#passed} is false and throw an error.
     *
     * @see {@link https://github.com/rpitv/glimpse-api/wiki/Authorization}
     *
     * @param context - NestJS execution context.
     * @param rule - Rule to test. If rule type is not Delete, or if the rule definition is a RuleFn, an error will be
     *  thrown.
     * @param handler - The handler that calls the request method/resolver, or the next interceptor in line if
     *  applicable. This is called after the necessary rule checks pass.
     * @returns The value returned from the handler, or null if the rule checks fail. This rule handler does not ever
     *  mutate the return value from the next handler.
     * @throws Error if the rule type is not {@link RuleType.Delete}.
     * @throws Error if the current user's permissions are not initialized.
     */
    public handleDeleteRule<T extends Exclude<AbilitySubjects, string>>(
        context: ExecutionContext,
        rule: RuleDef,
        handler: () => Observable<T | null>
    ): Observable<T | null> {
        const { req, subjectStr } = this.getReqAndSubject(context, rule);

        // Basic test with the provided action and subject.
        if (!req.permissions.can(AbilityAction.Delete, subjectStr)) {
            this.logger.verbose("Failed basic Delete rule test.");
            req.passed = false;
            return of(null);
        }

        // FIXME currently there is no way to check within the interceptor if the user has permission to delete the
        //  object to delete before it's been deleted. This check needs to be done in the resolver. This can be solved
        //  in a future refactor. Technically not required, but it would improve efficiency.

        return handler()
            .pipe(
                map((newValue) => {
                    // Handler already marked the request as failed for some permission error.
                    if (req.passed === false) {
                        this.logger.verbose("Failed Delete rule test. Handler already marked as failed.")
                        return null;
                    }

                    // Check the user can actually delete the object. Note, the deletion has already happened within the
                    //  transaction at this point. However, if the user doesn't have permission, it'll be rolled back.
                    //  The resolver can also do this before executing the deletion query. See the FIX-ME above.
                    const subjectObj = subject(subjectStr, newValue);
                    if (!req.permissions.can(AbilityAction.Delete, subjectObj)) {
                        this.logger.verbose("Failed Delete rule test with value.");
                        req.passed = false;
                        return null;
                    }

                    req.passed = true;
                    return newValue;
                })
            )
            .pipe((v) => {
                // Make sure user has permission to read the fields they're trying to read after the deletion. Deletion will
                //  be rolled back if not.
                return this.handleReadOneRule(context, rule, () => v);
            });
    }
}
