# Asana Client Extension Guide

The public entrypoint in [src/asana.ts](file:///home/movsiienko/Projects/elephant/asana-chat-sdk-adapter/src/asana.ts) is intentionally tiny now. The real implementation is split across:

1. [src/asana-client/schema.ts](file:///home/movsiienko/Projects/elephant/asana-chat-sdk-adapter/src/asana-client/schema.ts) for the schema DSL, resource schemas, and type projection.
2. [src/asana-client/transport.ts](file:///home/movsiienko/Projects/elephant/asana-chat-sdk-adapter/src/asana-client/transport.ts) for HTTP, retries, and Asana error parsing.
3. [src/asana-client/select.ts](file:///home/movsiienko/Projects/elephant/asana-chat-sdk-adapter/src/asana-client/select.ts) for runtime `select -> opt_fields` serialization.
4. [src/asana-client/client.ts](file:///home/movsiienko/Projects/elephant/asana-chat-sdk-adapter/src/asana-client/client.ts) for endpoint methods and workflow helpers.

The system is built around one rule: the same schema drives both compile-time types and runtime `opt_fields` generation.

## Core Rules

1. Every resource starts with a schema built from `scalar`, `object`, `arrayOf`, and `nullable`.
2. Every endpoint must define an explicit default selection in [src/asana-client/client.ts](file:///home/movsiienko/Projects/elephant/asana-chat-sdk-adapter/src/asana-client/client.ts).
3. Never rely on Asana's undocumented default field set for typing. If the method returns a certain shape in TypeScript, request that exact shape at runtime with `opt_fields`.
4. Use `getResource` for single-object endpoints and `getCollection` for paginated array endpoints.
5. Keep multi-step workflows, such as `myTasks.list`, as thin composition helpers on top of endpoint-shaped methods.

## Adding A New Resource Type

1. Add a schema near the other schema declarations in [src/asana-client/schema.ts](file:///home/movsiienko/Projects/elephant/asana-chat-sdk-adapter/src/asana-client/schema.ts).

```ts
const storySchema = object({
  gid: scalar<string>(),
  resource_type: scalar<"story">(),
  text: scalar<string>(),
  created_at: scalar<string>(),
  created_by: userSchema,
});
```

2. Export the inferred value and select types.

```ts
export type AsanaStory = InferNode<typeof storySchema>;
export type AsanaStorySelect = SelectionFor<typeof storySchema>;
```

3. Define the default selection as a plain object next to the endpoint. The endpoint method signatures are what callers rely on for request and response typing.

```ts
const defaultStorySelect = {
  text: true,
  created_at: true,
  created_by: { name: true },
} satisfies AsanaStorySelect;
```

## Adding A New Endpoint

For a single-object endpoint:

```ts
async function getStory<Selected extends AsanaStorySelect | undefined = undefined>(
  storyGid: string,
  options: ResourceRequestOptions<typeof storySchema, Selected> = {},
): Promise<ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>> {
  return getResource({
    transport,
    path: `/stories/${storyGid}`,
    schema: storySchema,
    defaultSelect: defaultStorySelect,
    select: options.select,
    signal: options.signal,
  });
}
```

For a collection endpoint:

```ts
async function listStories<Selected extends AsanaStorySelect | undefined = undefined>(
  taskGid: string,
  options: ResourceRequestOptions<typeof storySchema, Selected> = {},
): Promise<AsanaPage<ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>>> {
  return getCollection({
    transport,
    path: `/tasks/${taskGid}/stories`,
    schema: storySchema,
    defaultSelect: defaultStorySelect,
    select: options.select,
    signal: options.signal,
  });
}
```

Add those methods in [src/asana-client/client.ts](file:///home/movsiienko/Projects/elephant/asana-chat-sdk-adapter/src/asana-client/client.ts), not in the public barrel.

## How To Keep Inference Nice

Inline object literals infer well:

```ts
client.userTaskLists.listTasks("utl_123", {
  select: {
    name: true,
    assignee: { name: true },
  },
});
```

For normal usage, rely on inline request objects at the call site:

```ts
client.userTaskLists.listTasks("utl_123", {
  select: {
    name: true,
    assignee: { name: true },
    due_on: true,
  },
});
```

That gives the caller request validation and response inference without any helper function.

## Testing Checklist

When adding a new endpoint, add at least one test in [src/asana.test.ts](file:///home/movsiienko/Projects/elephant/asana-chat-sdk-adapter/src/asana.test.ts) that covers:

1. The generated `opt_fields` query string.
2. The projected return type using `expectTypeOf`.
3. One failure path if the endpoint has unusual behavior.
