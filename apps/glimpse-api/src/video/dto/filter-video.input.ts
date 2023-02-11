import { InputType } from "@nestjs/graphql";
import { StringComparisonInput } from "../../generic/string-comparison.input";
import { NumberComparisonInput } from "../../generic/number-comparison.input";

/**
 * Input type for filtering Videos in ReadMany queries.
 */
@InputType()
export class FilterVideoInput {
    /**
     * Filter by ID
     */
    id?: NumberComparisonInput;
    /**
     * Filter by name
     */
    name?: StringComparisonInput;
    /**
     * Filter by format
     */
    format?: StringComparisonInput;

    AND?: FilterVideoInput[];
    OR?: FilterVideoInput[];
    NOT?: FilterVideoInput;
}
