const BASE_URL = "https://app.asana.com/api/1.0";

const asanaRequest = async (
  path: string,
  patToken: string,
  queryArgs: Record<string, string> = {},
) => {
  const queryString = new URLSearchParams(queryArgs).toString();
  const response = await fetch(`${BASE_URL}${path}?${queryString}`, {
    headers: {
      Authorization: `Bearer ${patToken}`,
    },
  });
  return response;
};

export const getMe = async (patToken: string, workspaceGid: string) => {
  const response = await asanaRequest(
    `/workspaces/${workspaceGid}/users/me`,
    patToken,
    {
      opt_fields: "gid",
    },
  );
  if (!response.ok) {
    const cause = await response.json();
    throw new Error(`Failed to get user. Cause: ${JSON.stringify(cause)}`);
  }
  const data = (await response.json()).data;
  return data.gid as string;
};

export const getMyTasks = async (
  userGid: string,
  workspaceGid: string,
  patToken: string,
) => {
  const response = await asanaRequest(
    `/users/${userGid}/user_task_list`,
    patToken,
    {
      workspace: workspaceGid,
    },
  );
  if (!response.ok) {
    const cause = await response.json();
    throw new Error(`Failed to get tasks. Cause: ${JSON.stringify(cause)}`);
  }
  const data = await response.json();
  return data;
};
