import type { AsanaClient } from "../src/asana";

declare const client: AsanaClient;

const basicTasks = client.userTaskLists.listTasks("utl_123", {
  select: {
    name: true,
    assignee: {
      name: true,
    },
  },
});

type BasicTask = Awaited<typeof basicTasks>["data"][number];

declare const basicTask: BasicTask;

basicTask.name;
basicTask.assignee?.name;

// @ts-expect-error Email was not selected.
basicTask.assignee?.email;

const membershipTasks = client.userTaskLists.listTasks("utl_123", {
  select: {
    memberships: {
      project: {
        name: true,
      },
    },
  },
});

type MembershipTask = Awaited<typeof membershipTasks>["data"][number];

declare const membershipTask: MembershipTask;

membershipTask.memberships[0]?.project.name;

// @ts-expect-error Section was not selected.
membershipTask.memberships[0]?.section;

client.userTaskLists.listTasks("utl_123", {
  select: {
    // @ts-expect-error Unknown top-level field.
    foo: true,
  },
});

client.userTaskLists.listTasks("utl_123", {
  select: {
    assignee: {
      // @ts-expect-error Unknown nested field.
      foo: true,
    },
  },
});

client.userTaskLists.listTasks("utl_123", {
  select: {
    // @ts-expect-error Scalar fields only accept true.
    name: {
      foo: true,
    },
  },
});
