import { describe, expect, test } from "bun:test";

import { CLOUD_PROVIDER_POLICY_MESSAGE, refuseCloudProviderExecution } from "../scripts/provider-policy";
import { runModel } from "../scripts/run-model";

describe("cloud provider policy", () => {
  test("the shared refusal is unconditional", () => {
    expect(() => refuseCloudProviderExecution()).toThrow(CLOUD_PROVIDER_POLICY_MESSAGE);
  });

  test("the legacy model-spawn helper refuses before spawning", () => {
    expect(() => runModel(["/usr/bin/false"])).toThrow(CLOUD_PROVIDER_POLICY_MESSAGE);
  });
});
