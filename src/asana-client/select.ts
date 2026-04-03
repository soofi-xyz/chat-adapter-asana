import type { AnyObjectNode, SchemaNode } from "./schema";
import { AsanaTransport, type AsanaPage, type QueryValues } from "./transport";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unwrapNode = (node: SchemaNode): SchemaNode =>
  node.kind === "nullable" ? unwrapNode(node.inner) : node;

const getNestedObjectNode = (node: SchemaNode): AnyObjectNode | null => {
  const unwrapped = unwrapNode(node);
  if (unwrapped.kind === "object") {
    return unwrapped;
  }

  if (unwrapped.kind === "array") {
    const item = unwrapNode(unwrapped.item);
    return item.kind === "object" ? item : null;
  }

  return null;
};

const flattenSelect = (
  schema: AnyObjectNode,
  select: Record<string, unknown>,
  prefix = "",
): string[] => {
  const result: string[] = [];

  for (const [key, rawValue] of Object.entries(select)) {
    const fieldSchema = schema.fields[key];
    if (!fieldSchema) {
      throw new Error(`Unknown Asana select key \"${prefix}${key}\".`);
    }

    const path = prefix ? `${prefix}${key}` : key;
    if (rawValue === true) {
      result.push(path);
      continue;
    }

    if (!isPlainObject(rawValue)) {
      throw new Error(
        `Invalid select value for \"${path}\". Use true for scalar fields or a nested object for child fields.`,
      );
    }

    const nestedSchema = getNestedObjectNode(fieldSchema);
    if (!nestedSchema) {
      throw new Error(`Field \"${path}\" does not accept nested selections.`);
    }

    const nestedPaths = flattenSelect(nestedSchema, rawValue, `${path}.`);
    if (nestedPaths.length === 0) {
      throw new Error(`Nested selection for \"${path}\" cannot be empty.`);
    }

    result.push(...nestedPaths);
  }

  return [...new Set(result)];
};

const serializeSelect = (
  schema: AnyObjectNode,
  select: Record<string, unknown>,
): string => flattenSelect(schema, select).join(",");

export const getResource = async <Result>(options: {
  transport: AsanaTransport;
  path: string;
  schema: AnyObjectNode;
  defaultSelect: Record<string, unknown>;
  query?: QueryValues;
  select?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<Result> => {
  const effectiveSelect = options.select ?? options.defaultSelect;
  const data = await options.transport.get<Result>(options.path, {
    ...options.query,
    opt_fields: serializeSelect(options.schema, effectiveSelect),
  }, options.signal);

  return data.data;
};

export const getCollection = async <Result>(options: {
  transport: AsanaTransport;
  path: string;
  schema: AnyObjectNode;
  defaultSelect: Record<string, unknown>;
  query?: QueryValues;
  select?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<AsanaPage<Result>> => {
  const effectiveSelect = options.select ?? options.defaultSelect;
  const response = await options.transport.get<Result[]>(options.path, {
    ...options.query,
    opt_fields: serializeSelect(options.schema, effectiveSelect),
  }, options.signal);

  return {
    data: response.data,
    nextPage: response.next_page ?? null,
  };
};
