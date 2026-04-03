import { AsanaAdapterConfig } from "./types";
import { getMe, getMyTasks } from "./asana";

const setUpWebhook = async (config: AsanaAdapterConfig) => {
  const { patToken, workspaceGid } = config;
  const userGid = await getMe(patToken, workspaceGid);
  console.log(`User GID: ${JSON.stringify(userGid)}`);
  const myTasks = await getMyTasks(userGid, workspaceGid, patToken);
  console.log(JSON.stringify(myTasks, null, 2));
};

setUpWebhook({
  patToken: process.env.ASANA_PAT_TOKEN!,
  workspaceGid: "1212479696690818",
});
