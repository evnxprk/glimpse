import { ObjectType, Field, ID, Int } from "@nestjs/graphql";
import {IsInt, Min} from "class-validator";
import { ProductionImage as PrismaProductionImage } from "@prisma/client";

@ObjectType()
export class ProductionImage implements PrismaProductionImage {
    /**
     * CASL "modelName" used for detecting subject type. Only necessary when the string "ProductionImage" is passed to CASL's
     *   can() method, and the passed ProductionImage object hasn't passed through the subject() helper function.
     * @see {@link https://casl.js.org/v6/en/advanced/typescript}
     */
    static readonly modelName = "ProductionImage" as const;

    /**
     * Unique ID for this ProductionImage. Automatically generated.
     */
    @IsInt()
    @Min(0)
    @Field(() => ID, { nullable: true })
    id: number | null;

    /**
     * ID of the person this ProductionImage is associated with.
     */
    @Min(0)
    @Field(() => Int, { nullable: true })
    productionId: number | null;

    /**
     * ID of the role this ProductionImage is associated with.
     */
    @Min(0)
    @Field(() => Int, { nullable: true })
    imageId: number | null;

    /**
     * The priority of this ProductionImage. Higher priority ProductionImages should appear before lower priority ones.
     */
    @IsInt()
    @Field(() => Int, { nullable: true })
    priority: number | null;
}
