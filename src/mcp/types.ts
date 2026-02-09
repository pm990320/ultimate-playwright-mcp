/**
 * Shared types for MCP tool registration
 */

/** JSON Schema object for tool input validation */
export interface ToolInputSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

/**
 * Function signature for registering an MCP tool.
 * Handler uses generic args since each tool defines its own typed parameters.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool handlers have diverse typed args that are validated by JSON schema at runtime
export type ToolHandler = (args: any) => Promise<unknown>;

export type RegisterToolFn = (
  name: string,
  description: string,
  schema: ToolInputSchema,
  handler: ToolHandler,
) => void;
