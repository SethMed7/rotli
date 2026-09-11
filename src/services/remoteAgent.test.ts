import { expect, test } from "bun:test";

import { queryClient } from "./query";
import { REMOTE_AGENT_STATUS_KEY, invalidateRemoteAgentStatus, remoteAgentsNative } from "./remoteAgent";

test("the browser twin never offers pairing, and the status refresh targets one stable cache key", async () => {
  expect(remoteAgentsNative()).toBe(false);
  queryClient.setQueryData(REMOTE_AGENT_STATUS_KEY, { active: false, paired: false });
  await invalidateRemoteAgentStatus();
  expect(queryClient.getQueryState(REMOTE_AGENT_STATUS_KEY)?.isInvalidated).toBe(true);
});
