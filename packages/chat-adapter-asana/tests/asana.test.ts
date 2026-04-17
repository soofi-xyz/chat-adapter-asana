import { expect, test, vi } from "vitest";

import { AsanaApiError, createAsanaClient } from "../src/asana-client";

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

test("serializes nested select trees into opt_fields and projects the return type", async () => {
  const fetchMock = vi.fn(async (input: URL | RequestInfo | string) => {
    const url = String(input);
    expect(url).toContain("/user_task_lists/utl_123/tasks");
    expect(url).toContain(
      "opt_fields=name%2Cassignee.gid%2Cmemberships.project.name",
    );

    return jsonResponse({
      data: [
        {
          gid: "task_1",
          name: "Write docs",
          assignee: {
            gid: "user_1",
            name: "Ada",
          },
          memberships: [
            {
              project: {
                gid: "project_1",
                name: "SDK",
              },
            },
          ],
        },
      ],
      next_page: null,
    });
  });

  const client = createAsanaClient({
    accessToken: "token",
    fetch: fetchMock as typeof fetch,
  });

  const page = await client.userTaskLists.listTasks("utl_123", {
    select: {
      name: true,
      assignee: {
        gid: true,
      },
      memberships: {
        project: {
          name: true,
        },
      },
    },
  });

  expect(page.data[0]?.memberships[0]?.project.name).toBe("SDK");
});

test("composes my tasks flow and requests only gid for the intermediate user task list", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      jsonResponse({
        data: {
          gid: "utl_999",
        },
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            gid: "task_1",
            name: "Inbox triage",
            completed: false,
            permalink_url: "https://app.asana.com/0/1/1",
            due_on: null,
            assignee: null,
          },
        ],
        next_page: {
          offset: "next",
          path: "/user_task_lists/utl_999/tasks?offset=next",
          uri: "https://app.asana.com/api/1.0/user_task_lists/utl_999/tasks?offset=next",
        },
      }),
    );

  const client = createAsanaClient({
    accessToken: "token",
    fetch: fetchMock,
  });

  const page = await client.myTasks.list({
    workspaceGid: "workspace_1",
  });

  const firstCallUrl = String(fetchMock.mock.calls[0]?.[0]);
  const secondCallUrl = String(fetchMock.mock.calls[1]?.[0]);

  expect(firstCallUrl).toContain("/users/me/user_task_list");
  expect(firstCallUrl).toContain("workspace=workspace_1");
  expect(firstCallUrl).toContain("opt_fields=gid");
  expect(secondCallUrl).toContain("/user_task_lists/utl_999/tasks");
  expect(page.nextPage?.offset).toBe("next");
});

test("rejects invalid runtime select keys before making a request", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    jsonResponse({
      data: {
        gid: "user_1",
        name: "Ada",
      },
    }),
  );

  const client = createAsanaClient({
    accessToken: "token",
    fetch: fetchMock,
  });

  await expect(
    client.users.getMe({
      select: {
        unknown: true,
      } as never,
    }),
  ).rejects.toThrow('Unknown Asana select key "unknown".');

  expect(fetchMock).not.toHaveBeenCalled();
});

test("turns Asana error payloads into AsanaApiError", async () => {
  const client = createAsanaClient({
    accessToken: "token",
    fetch: vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          errors: [
            {
              message: "Not Authorized",
            },
          ],
        },
        {
          status: 401,
        },
      ),
    ),
  });

  await expect(client.users.getMe()).rejects.toBeInstanceOf(AsanaApiError);
});
