interface ScalarNode<T> {
  kind: "scalar";
  __value?: T;
}

interface SchemaFields {
  [key: string]: SchemaNode;
}

interface ObjectNode<Fields extends SchemaFields = SchemaFields> {
  kind: "object";
  fields: Fields;
}

interface ArrayNode<Item extends SchemaNode = SchemaNode> {
  kind: "array";
  item: Item;
}

interface NullableNode<Inner extends SchemaNode = SchemaNode> {
  kind: "nullable";
  inner: Inner;
}

export type SchemaNode =
  | ScalarNode<unknown>
  | ObjectNode
  | ArrayNode
  | NullableNode;

export type AnyObjectNode = ObjectNode;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type NonEmpty<T extends object> = keyof T extends never
  ? never
  : {
      [K in keyof T]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>;
    }[keyof T];

export type InferNode<Node extends SchemaNode> =
  Node extends ScalarNode<infer Value>
    ? Value
    : Node extends NullableNode<infer Inner extends SchemaNode>
      ? InferNode<Inner> | null
      : Node extends ArrayNode<infer Item extends SchemaNode>
        ? InferNode<Item>[]
        : Node extends ObjectNode<
              infer Fields extends Record<string, SchemaNode>
            >
          ? Simplify<{ [Key in keyof Fields]: InferNode<Fields[Key]> }>
          : never;

type SelectionValue<Node extends SchemaNode> =
  Node extends ScalarNode<unknown>
    ? true
    : Node extends NullableNode<infer Inner extends SchemaNode>
      ? SelectionValue<Inner>
      : Node extends ArrayNode<infer Item extends SchemaNode>
        ? Item extends AnyObjectNode
          ? true | SelectionFor<Item>
          : true
        : Node extends AnyObjectNode
          ? true | SelectionFor<Node>
          : never;

type SelectionShape<Node extends AnyObjectNode> = {
  [Key in keyof Node["fields"]]?: SelectionValue<Node["fields"][Key]>;
};

export type SelectionFor<Node extends AnyObjectNode> = NonEmpty<
  SelectionShape<Node>
>;

type ExactSelectionValue<Node extends SchemaNode, Actual> =
  Node extends ScalarNode<unknown>
    ? Actual extends true
      ? true
      : never
    : Node extends NullableNode<infer Inner extends SchemaNode>
      ? ExactSelectionValue<Inner, Actual>
      : Node extends ArrayNode<infer Item extends SchemaNode>
        ? Item extends AnyObjectNode
          ? Actual extends true
            ? true
            : ExactSelection<Item, Actual>
          : Actual extends true
            ? true
            : never
        : Node extends AnyObjectNode
          ? Actual extends true
            ? true
            : ExactSelection<Node, Actual>
          : never;

export type ExactSelection<Node extends AnyObjectNode, Actual> =
  Actual extends Record<string, unknown>
    ? keyof Actual extends never
      ? never
      : Simplify<
          {
            [Key in keyof Actual]: Key extends keyof Node["fields"]
              ? ExactSelectionValue<Node["fields"][Key], Actual[Key]>
              : never;
          } & {
            [Key in Exclude<keyof Actual, keyof Node["fields"]>]: never;
          }
        >
    : never;

type AlwaysIncludedGid<Node extends AnyObjectNode> = Node["fields"] extends {
  gid: infer GidField extends SchemaNode;
}
  ? { gid: InferNode<GidField> }
  : {};

type ProjectSelected<Node extends SchemaNode, Selected> = Selected extends true
  ? InferNode<Node>
  : Node extends NullableNode<infer Inner extends SchemaNode>
    ? ProjectSelected<Inner, Selected> | null
    : Node extends ArrayNode<infer Item extends SchemaNode>
      ? ProjectSelected<Item, Selected>[]
      : Node extends AnyObjectNode
        ? Selected extends object
          ? Simplify<
              AlwaysIncludedGid<Node> & {
                [Key in Extract<
                  keyof Selected,
                  keyof Node["fields"]
                >]: Key extends "gid"
                  ? InferNode<Node["fields"][Key]>
                  : ProjectSelected<Node["fields"][Key], Selected[Key]>;
              }
            >
          : InferNode<Node>
        : InferNode<Node>;

export type ResolveSelection<
  Node extends AnyObjectNode,
  Selected extends SelectionFor<Node> | undefined,
  DefaultSelect extends SelectionFor<Node>,
> =
  Selected extends SelectionFor<Node>
    ? ProjectSelected<Node, Selected>
    : ProjectSelected<Node, DefaultSelect>;

export const scalar = <T>(): ScalarNode<T> => ({ kind: "scalar" });

export const object = <Fields extends Record<string, SchemaNode>>(
  fields: Fields,
): ObjectNode<Fields> => ({ kind: "object", fields });

export const arrayOf = <Item extends SchemaNode>(
  item: Item,
): ArrayNode<Item> => ({
  kind: "array",
  item,
});

export const nullable = <Inner extends SchemaNode>(
  inner: Inner,
): NullableNode<Inner> => ({ kind: "nullable", inner });

export const workspaceSchema = object({
  gid: scalar<string>(),
  resource_type: scalar<"workspace">(),
  name: scalar<string>(),
});

export const userSchema = object({
  gid: scalar<string>(),
  resource_type: scalar<"user">(),
  name: scalar<string>(),
  email: scalar<string>(),
});

export const projectSchema = object({
  gid: scalar<string>(),
  resource_type: scalar<"project">(),
  name: scalar<string>(),
});

export const sectionSchema = object({
  gid: scalar<string>(),
  resource_type: scalar<"section">(),
  name: scalar<string>(),
});

export const taskMembershipSchema = object({
  project: projectSchema,
  section: nullable(sectionSchema),
});

export const userTaskListSchema = object({
  gid: scalar<string>(),
  resource_type: scalar<"user_task_list">(),
  name: scalar<string>(),
  owner: userSchema,
  workspace: workspaceSchema,
});

export const taskSchema = object({
  gid: scalar<string>(),
  resource_type: scalar<"task">(),
  name: scalar<string>(),
  notes: scalar<string>(),
  html_notes: scalar<string>(),
  completed: scalar<boolean>(),
  completed_at: nullable(scalar<string>()),
  created_at: nullable(scalar<string>()),
  modified_at: nullable(scalar<string>()),
  due_at: nullable(scalar<string>()),
  due_on: nullable(scalar<string>()),
  start_at: nullable(scalar<string>()),
  start_on: nullable(scalar<string>()),
  permalink_url: nullable(scalar<string>()),
  assignee_status: nullable(scalar<string>()),
  assignee: nullable(userSchema),
  created_by: nullable(userSchema),
  workspace: workspaceSchema,
  memberships: arrayOf(taskMembershipSchema),
});

export const reactionSummaryItemSchema = object({
  emoji_base: scalar<string>(),
  variant: scalar<string>(),
  count: scalar<number>(),
  reacted: scalar<boolean>(),
});

export const storySchema = object({
  gid: scalar<string>(),
  resource_type: scalar<"story">(),
  resource_subtype: scalar<string>(),
  type: scalar<string>(),
  text: scalar<string>(),
  html_text: scalar<string>(),
  created_at: scalar<string>(),
  created_by: nullable(userSchema),
  is_edited: scalar<boolean>(),
  is_pinned: scalar<boolean>(),
  hearted: scalar<boolean>(),
  reaction_summary: arrayOf(reactionSummaryItemSchema),
});

export const attachmentSchema = object({
  gid: scalar<string>(),
  resource_type: scalar<"attachment">(),
  name: scalar<string>(),
  download_url: nullable(scalar<string>()),
  permanent_url: nullable(scalar<string>()),
  size: nullable(scalar<number>()),
  host: nullable(scalar<string>()),
});

export const webhookSchema = object({
  gid: scalar<string>(),
  resource_type: scalar<"webhook">(),
  active: scalar<boolean>(),
  target: scalar<string>(),
});

export type AsanaUser = InferNode<typeof userSchema>;
export type AsanaTask = InferNode<typeof taskSchema>;
export type AsanaStory = InferNode<typeof storySchema>;
export type AsanaReactionSummaryItem = InferNode<
  typeof reactionSummaryItemSchema
>;
export type AsanaAttachment = InferNode<typeof attachmentSchema>;
export type AsanaWebhook = InferNode<typeof webhookSchema>;
export type AsanaUserTaskList = InferNode<typeof userTaskListSchema>;
export type AsanaWorkspace = InferNode<typeof workspaceSchema>;
export type AsanaProject = InferNode<typeof projectSchema>;
export type AsanaSection = InferNode<typeof sectionSchema>;

export type AsanaUserSelect = SelectionFor<typeof userSchema>;
export type AsanaTaskSelect = SelectionFor<typeof taskSchema>;
export type AsanaStorySelect = SelectionFor<typeof storySchema>;
export type AsanaAttachmentSelect = SelectionFor<typeof attachmentSchema>;
export type AsanaWebhookSelect = SelectionFor<typeof webhookSchema>;
export type AsanaUserTaskListSelect = SelectionFor<typeof userTaskListSchema>;
