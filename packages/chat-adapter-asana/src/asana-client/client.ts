import {
  attachmentSchema,
  storySchema,
  taskSchema,
  userSchema,
  userTaskListSchema,
  webhookSchema,
  type AnyObjectNode,
  type AsanaAttachmentSelect,
  type AsanaStorySelect,
  type AsanaTaskSelect,
  type AsanaUserSelect,
  type AsanaUserTaskListSelect,
  type AsanaWebhookSelect,
  type ExactSelection,
  type ResolveSelection,
  type SelectionFor,
} from "./schema";
import {
  getCollection,
  getResource,
  postResource,
  putResource,
} from "./select";
import { type AsanaPage, AsanaTransport } from "./transport";
import type { AsanaClientConfig } from "../types";

type ResourceRequestOptions<
  Schema extends AnyObjectNode,
  Selected extends SelectionFor<Schema> | undefined,
> = {
  select?: Selected extends SelectionFor<Schema>
    ? Selected & ExactSelection<Schema, Selected>
    : Selected;
  signal?: AbortSignal;
};

type ListRequestOptions<
  Schema extends AnyObjectNode,
  Selected extends SelectionFor<Schema> | undefined,
> = ResourceRequestOptions<Schema, Selected> & {
  completedSince?: string;
  limit?: number;
  offset?: string;
};

const defaultGetMeSelect = {
  name: true,
  email: true,
} satisfies AsanaUserSelect;

const defaultUserTaskListSelect = {
  name: true,
  owner: {
    name: true,
  },
  workspace: {
    name: true,
  },
} satisfies AsanaUserTaskListSelect;

const defaultTaskListSelect = {
  name: true,
  completed: true,
  assignee: {
    name: true,
  },
  due_on: true,
  permalink_url: true,
} satisfies AsanaTaskSelect;

const defaultTaskSelect = {
  name: true,
  notes: true,
  html_notes: true,
  completed: true,
  completed_at: true,
  created_at: true,
  permalink_url: true,
  assignee: {
    name: true,
    email: true,
  },
  created_by: {
    name: true,
    email: true,
  },
  workspace: {
    name: true,
  },
  memberships: {
    project: {
      name: true,
    },
  },
} satisfies AsanaTaskSelect;

const defaultStorySelect = {
  resource_subtype: true,
  type: true,
  text: true,
  html_text: true,
  created_at: true,
  created_by: {
    name: true,
    email: true,
  },
  is_edited: true,
  hearted: true,
  reaction_summary: {
    emoji_base: true,
    variant: true,
    count: true,
    reacted: true,
  },
} satisfies AsanaStorySelect;

const defaultAttachmentSelect = {
  name: true,
  download_url: true,
  permanent_url: true,
  size: true,
  host: true,
} satisfies AsanaAttachmentSelect;

const defaultWebhookSelect = {
  active: true,
  target: true,
} satisfies AsanaWebhookSelect;

const userTaskListGidSelect = {
  gid: true,
} satisfies AsanaUserTaskListSelect;

/**
 * Creates a typed Asana client whose `select` trees are validated twice:
 * TypeScript constrains the keys at compile time and the same schema validates
 * them again while serializing `opt_fields` for the real HTTP request.
 *
 * To add a new resource or endpoint, follow `docs/asana-client.md`.
 */
export const createAsanaClient = (config: AsanaClientConfig) => {
  const transport = new AsanaTransport(config);

  async function getMe<
    const Selected extends AsanaUserSelect | undefined = undefined,
  >(
    options: ResourceRequestOptions<typeof userSchema, Selected> = {},
  ): Promise<
    ResolveSelection<typeof userSchema, Selected, typeof defaultGetMeSelect>
  > {
    return getResource<
      ResolveSelection<typeof userSchema, Selected, typeof defaultGetMeSelect>
    >({
      transport,
      path: "/users/me",
      schema: userSchema,
      defaultSelect: defaultGetMeSelect,
      select: options.select,
      signal: options.signal,
    });
  }

  async function getUserTaskList<
    const Selected extends AsanaUserTaskListSelect | undefined = undefined,
  >(
    userTaskListGid: string,
    options: ResourceRequestOptions<typeof userTaskListSchema, Selected> = {},
  ): Promise<
    ResolveSelection<
      typeof userTaskListSchema,
      Selected,
      typeof defaultUserTaskListSelect
    >
  > {
    return getResource<
      ResolveSelection<
        typeof userTaskListSchema,
        Selected,
        typeof defaultUserTaskListSelect
      >
    >({
      transport,
      path: `/user_task_lists/${userTaskListGid}`,
      schema: userTaskListSchema,
      defaultSelect: defaultUserTaskListSelect,
      select: options.select,
      signal: options.signal,
    });
  }

  async function getUserTaskListForUser<
    const Selected extends AsanaUserTaskListSelect | undefined = undefined,
  >(
    userGid: string,
    options: ResourceRequestOptions<typeof userTaskListSchema, Selected> & {
      workspaceGid: string;
    },
  ): Promise<
    ResolveSelection<
      typeof userTaskListSchema,
      Selected,
      typeof defaultUserTaskListSelect
    >
  > {
    return getResource<
      ResolveSelection<
        typeof userTaskListSchema,
        Selected,
        typeof defaultUserTaskListSelect
      >
    >({
      transport,
      path: `/users/${userGid}/user_task_list`,
      schema: userTaskListSchema,
      defaultSelect: defaultUserTaskListSelect,
      query: {
        workspace: options.workspaceGid,
      },
      select: options.select,
      signal: options.signal,
    });
  }

  async function listTasksForUserTaskList<
    const Selected extends AsanaTaskSelect | undefined = undefined,
  >(
    userTaskListGid: string,
    options: ListRequestOptions<typeof taskSchema, Selected> = {},
  ): Promise<
    AsanaPage<
      ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskListSelect>
    >
  > {
    return getCollection<
      ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskListSelect>
    >({
      transport,
      path: `/user_task_lists/${userTaskListGid}/tasks`,
      schema: taskSchema,
      defaultSelect: defaultTaskListSelect,
      query: {
        completed_since: options.completedSince,
        limit: options.limit,
        offset: options.offset,
      },
      select: options.select,
      signal: options.signal,
    });
  }

  async function listMyTasks<
    const Selected extends AsanaTaskSelect | undefined = undefined,
  >(
    options: ListRequestOptions<typeof taskSchema, Selected> & {
      workspaceGid: string;
      userGid?: string;
    },
  ): Promise<
    AsanaPage<
      ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskListSelect>
    >
  > {
    const userTaskList = await getUserTaskListForUser(options.userGid ?? "me", {
      workspaceGid: options.workspaceGid,
      select: userTaskListGidSelect,
      signal: options.signal,
    });

    return getCollection<
      ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskListSelect>
    >({
      transport,
      path: `/user_task_lists/${userTaskList.gid}/tasks`,
      schema: taskSchema,
      defaultSelect: defaultTaskListSelect,
      query: {
        completed_since: options.completedSince,
        limit: options.limit,
        offset: options.offset,
      },
      select: options.select,
      signal: options.signal,
    });
  }

  async function getTask<
    const Selected extends AsanaTaskSelect | undefined = undefined,
  >(
    taskGid: string,
    options: ResourceRequestOptions<typeof taskSchema, Selected> = {},
  ): Promise<
    ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskSelect>
  > {
    return getResource<
      ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskSelect>
    >({
      transport,
      path: `/tasks/${taskGid}`,
      schema: taskSchema,
      defaultSelect: defaultTaskSelect,
      select: options.select,
      signal: options.signal,
    });
  }

  /** Creates a new task via `POST /tasks`. */
  async function createTask<
    const Selected extends AsanaTaskSelect | undefined = undefined,
  >(
    input: {
      name: string;
      notes?: string;
      html_notes?: string;
      workspace: string;
      assignee?: string;
      projects?: string[];
      due_on?: string;
    },
    options: ResourceRequestOptions<typeof taskSchema, Selected> = {},
  ): Promise<
    ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskSelect>
  > {
    return postResource<
      ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskSelect>
    >({
      transport,
      path: "/tasks",
      schema: taskSchema,
      defaultSelect: defaultTaskSelect,
      body: input as unknown as Record<string, unknown>,
      select: options.select,
      signal: options.signal,
    });
  }

  /** Marks a task complete or incomplete via `PUT /tasks/{gid}`. */
  async function updateTask<
    const Selected extends AsanaTaskSelect | undefined = undefined,
  >(
    taskGid: string,
    patch: Partial<{
      name: string;
      notes: string;
      html_notes: string;
      completed: boolean;
      assignee: string | null;
    }>,
    options: ResourceRequestOptions<typeof taskSchema, Selected> = {},
  ): Promise<
    ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskSelect>
  > {
    return putResource<
      ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskSelect>
    >({
      transport,
      path: `/tasks/${taskGid}`,
      schema: taskSchema,
      defaultSelect: defaultTaskSelect,
      body: patch as Record<string, unknown>,
      select: options.select,
      signal: options.signal,
    });
  }

  /** Deletes a task via `DELETE /tasks/{gid}`. */
  async function deleteTask(
    taskGid: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    await transport.delete(`/tasks/${taskGid}`, { signal: options.signal });
  }

  async function listStoriesForTask<
    const Selected extends AsanaStorySelect | undefined = undefined,
  >(
    taskGid: string,
    options: ListRequestOptions<typeof storySchema, Selected> = {},
  ): Promise<
    AsanaPage<
      ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>
    >
  > {
    return getCollection<
      ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>
    >({
      transport,
      path: `/tasks/${taskGid}/stories`,
      schema: storySchema,
      defaultSelect: defaultStorySelect,
      query: {
        limit: options.limit,
        offset: options.offset,
      },
      select: options.select,
      signal: options.signal,
    });
  }

  async function getStory<
    const Selected extends AsanaStorySelect | undefined = undefined,
  >(
    storyGid: string,
    options: ResourceRequestOptions<typeof storySchema, Selected> = {},
  ): Promise<
    ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>
  > {
    return getResource<
      ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>
    >({
      transport,
      path: `/stories/${storyGid}`,
      schema: storySchema,
      defaultSelect: defaultStorySelect,
      select: options.select,
      signal: options.signal,
    });
  }

  /** Adds a comment to a task via `POST /tasks/{gid}/stories`. */
  async function createStoryOnTask<
    const Selected extends AsanaStorySelect | undefined = undefined,
  >(
    taskGid: string,
    input: { text?: string; html_text?: string },
    options: ResourceRequestOptions<typeof storySchema, Selected> = {},
  ): Promise<
    ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>
  > {
    if (!input.text && !input.html_text) {
      throw new Error("createStoryOnTask requires either text or html_text.");
    }

    return postResource<
      ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>
    >({
      transport,
      path: `/tasks/${taskGid}/stories`,
      schema: storySchema,
      defaultSelect: defaultStorySelect,
      body: input as Record<string, unknown>,
      select: options.select,
      signal: options.signal,
    });
  }

  /** Edits an existing story via `PUT /stories/{gid}`. */
  async function updateStory<
    const Selected extends AsanaStorySelect | undefined = undefined,
  >(
    storyGid: string,
    patch: Partial<{ text: string; html_text: string }>,
    options: ResourceRequestOptions<typeof storySchema, Selected> = {},
  ): Promise<
    ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>
  > {
    return putResource<
      ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>
    >({
      transport,
      path: `/stories/${storyGid}`,
      schema: storySchema,
      defaultSelect: defaultStorySelect,
      body: patch as Record<string, unknown>,
      select: options.select,
      signal: options.signal,
    });
  }

  async function deleteStory(
    storyGid: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    await transport.delete(`/stories/${storyGid}`, { signal: options.signal });
  }

  /**
   * Adds or removes an emoji reaction on a story via `PUT /stories/{gid}`.
   *
   * Asana exposes reactions through the "update a story" endpoint using
   * a `reactions` array of `{ emoji, reacted }` objects. `reacted: true`
   * adds the reaction for the authenticated user, `reacted: false` removes
   * it. Toggling is idempotent per user/emoji pair.
   *
   * The `emoji` value must be a unicode character (e.g. `"👀"`, `"👍"`).
   */
  async function reactOnStory<
    const Selected extends AsanaStorySelect | undefined = undefined,
  >(
    storyGid: string,
    input: { emoji: string; reacted: boolean },
    options: ResourceRequestOptions<typeof storySchema, Selected> = {},
  ): Promise<
    ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>
  > {
    if (!input.emoji) {
      throw new Error("reactOnStory requires a non-empty emoji character.");
    }
    return putResource<
      ResolveSelection<typeof storySchema, Selected, typeof defaultStorySelect>
    >({
      transport,
      path: `/stories/${storyGid}`,
      schema: storySchema,
      defaultSelect: defaultStorySelect,
      body: {
        reactions: [{ emoji: input.emoji, reacted: input.reacted }],
      },
      select: options.select,
      signal: options.signal,
    });
  }

  /** Uploads a file attachment to a task via `POST /attachments` (multipart). */
  async function createAttachmentOnTask<
    const Selected extends AsanaAttachmentSelect | undefined = undefined,
  >(
    taskGid: string,
    input: {
      data: Blob | Buffer | Uint8Array | ArrayBuffer | ReadableStream;
      filename: string;
      mimeType?: string;
    },
    options: ResourceRequestOptions<typeof attachmentSchema, Selected> = {},
  ): Promise<
    ResolveSelection<
      typeof attachmentSchema,
      Selected,
      typeof defaultAttachmentSelect
    >
  > {
    const form = new FormData();
    form.set("parent", taskGid);
    const file = toBlob(input.data, input.mimeType);
    form.set("file", file, input.filename);

    return postResource<
      ResolveSelection<
        typeof attachmentSchema,
        Selected,
        typeof defaultAttachmentSelect
      >
    >({
      transport,
      path: "/attachments",
      schema: attachmentSchema,
      defaultSelect: defaultAttachmentSelect,
      body: { __multipart: form },
      select: options.select,
      signal: options.signal,
    });
  }

  async function listAttachmentsForTask<
    const Selected extends AsanaAttachmentSelect | undefined = undefined,
  >(
    taskGid: string,
    options: ListRequestOptions<typeof attachmentSchema, Selected> = {},
  ): Promise<
    AsanaPage<
      ResolveSelection<
        typeof attachmentSchema,
        Selected,
        typeof defaultAttachmentSelect
      >
    >
  > {
    return getCollection<
      ResolveSelection<
        typeof attachmentSchema,
        Selected,
        typeof defaultAttachmentSelect
      >
    >({
      transport,
      path: `/attachments`,
      schema: attachmentSchema,
      defaultSelect: defaultAttachmentSelect,
      query: {
        parent: taskGid,
        limit: options.limit,
        offset: options.offset,
      },
      select: options.select,
      signal: options.signal,
    });
  }

  /** Registers a webhook via `POST /webhooks`. */
  async function createWebhook<
    const Selected extends AsanaWebhookSelect | undefined = undefined,
  >(
    input: {
      resource: string;
      target: string;
      filters?: Array<{
        resource_type?: string;
        resource_subtype?: string;
        action?: string;
        fields?: string[];
      }>;
    },
    options: ResourceRequestOptions<typeof webhookSchema, Selected> = {},
  ): Promise<
    ResolveSelection<
      typeof webhookSchema,
      Selected,
      typeof defaultWebhookSelect
    >
  > {
    return postResource<
      ResolveSelection<
        typeof webhookSchema,
        Selected,
        typeof defaultWebhookSelect
      >
    >({
      transport,
      path: "/webhooks",
      schema: webhookSchema,
      defaultSelect: defaultWebhookSelect,
      body: input as unknown as Record<string, unknown>,
      select: options.select,
      signal: options.signal,
    });
  }

  async function listWebhooks<
    const Selected extends AsanaWebhookSelect | undefined = undefined,
  >(
    options: ListRequestOptions<typeof webhookSchema, Selected> & {
      workspaceGid: string;
      resourceGid?: string;
    },
  ): Promise<
    AsanaPage<
      ResolveSelection<
        typeof webhookSchema,
        Selected,
        typeof defaultWebhookSelect
      >
    >
  > {
    return getCollection<
      ResolveSelection<
        typeof webhookSchema,
        Selected,
        typeof defaultWebhookSelect
      >
    >({
      transport,
      path: `/webhooks`,
      schema: webhookSchema,
      defaultSelect: defaultWebhookSelect,
      query: {
        workspace: options.workspaceGid,
        resource: options.resourceGid,
        limit: options.limit,
        offset: options.offset,
      },
      select: options.select,
      signal: options.signal,
    });
  }

  async function deleteWebhook(
    webhookGid: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    await transport.delete(`/webhooks/${webhookGid}`, { signal: options.signal });
  }

  return {
    transport,
    users: {
      getMe,
    },
    userTaskLists: {
      get: getUserTaskList,
      getForUser: getUserTaskListForUser,
      listTasks: listTasksForUserTaskList,
    },
    myTasks: {
      list: listMyTasks,
    },
    tasks: {
      get: getTask,
      create: createTask,
      update: updateTask,
      delete: deleteTask,
    },
    stories: {
      get: getStory,
      listForTask: listStoriesForTask,
      createOnTask: createStoryOnTask,
      update: updateStory,
      delete: deleteStory,
      react: reactOnStory,
    },
    attachments: {
      createOnTask: createAttachmentOnTask,
      listForTask: listAttachmentsForTask,
    },
    webhooks: {
      create: createWebhook,
      list: listWebhooks,
      delete: deleteWebhook,
    },
  } as const;
};

export type AsanaClient = ReturnType<typeof createAsanaClient>;

const toBlob = (
  data: Blob | Buffer | Uint8Array | ArrayBuffer | ReadableStream,
  mimeType: string | undefined,
): Blob => {
  const type = mimeType ?? "application/octet-stream";
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data;
  }
  if (data instanceof Uint8Array) {
    return new Blob([new Uint8Array(data)], { type });
  }
  if (data instanceof ArrayBuffer) {
    return new Blob([data], { type });
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return new Blob([new Uint8Array(data)], { type });
  }
  if (typeof ReadableStream !== "undefined" && data instanceof ReadableStream) {
    throw new Error(
      "ReadableStream attachments are not yet supported in this runtime. Buffer the stream before calling createAttachmentOnTask.",
    );
  }
  throw new Error("Unsupported attachment data type.");
};
