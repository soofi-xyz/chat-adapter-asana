import {
  taskSchema,
  type AsanaTaskSelect,
  type AsanaUserSelect,
  type AsanaUserTaskListSelect,
  type AnyObjectNode,
  type ExactSelection,
  type ResolveSelection,
  type SelectionFor,
  userSchema,
  userTaskListSchema,
} from "./schema";
import { getCollection, getResource } from "./select";
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

  /** Reads the current authenticated user via `GET /users/me`. */
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

  /** Reads a user task list via `GET /user_task_lists/{user_task_list_gid}`. */
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

  /** Reads a user's task list via `GET /users/{user_gid}/user_task_list`. */
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

  /** Lists tasks in a user task list via `GET /user_task_lists/{user_task_list_gid}/tasks`. */
  async function listTasksForUserTaskList<
    const Selected extends AsanaTaskSelect | undefined = undefined,
  >(
    userTaskListGid: string,
    options: ListRequestOptions<typeof taskSchema, Selected> = {},
  ): Promise<
    AsanaPage<ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskListSelect>>
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

  /**
   * Convenience flow for "My Tasks": resolve the user's task list in a
   * workspace, then list tasks from that task list.
   */
  async function listMyTasks<
    const Selected extends AsanaTaskSelect | undefined = undefined,
  >(
    options: ListRequestOptions<typeof taskSchema, Selected> & {
      workspaceGid: string;
      userGid?: string;
    },
  ): Promise<
    AsanaPage<ResolveSelection<typeof taskSchema, Selected, typeof defaultTaskListSelect>>
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

  return {
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
  } as const;
};

export type AsanaClient = ReturnType<typeof createAsanaClient>;
