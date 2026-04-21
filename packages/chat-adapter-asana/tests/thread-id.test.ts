import { describe, expect, test } from "vitest";
import { AsanaAdapter } from "../src/adapter";
import { TEST_BOT_USER } from "./test-utils";

const adapter = new AsanaAdapter({
  accessToken: "token",
  workspaceGid: "ws_1",
  botUser: TEST_BOT_USER,
  fetch: () => Promise.reject(new Error("fetch should not be called")) as never,
});

describe("thread ID encoding", () => {
  test("round-trips ordinary task GIDs", () => {
    const data = { taskGid: "task_42" };
    const encoded = adapter.encodeThreadId(data);

    expect(encoded).toMatch(/^asana:/);
    expect(adapter.decodeThreadId(encoded)).toEqual(data);
  });

  test("round-trips task GIDs containing URL-unsafe characters", () => {
    const data = { taskGid: "task/with+weird=chars?!" };
    const encoded = adapter.encodeThreadId(data);

    expect(encoded).toMatch(/^asana:/);
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("?");
    expect(adapter.decodeThreadId(encoded)).toEqual(data);
  });

  test("throws when the prefix is not the asana adapter name", () => {
    expect(() => adapter.decodeThreadId("slack:C123:ts")).toThrow(
      /Invalid Asana thread ID/,
    );
  });

  test("throws on missing segment", () => {
    expect(() => adapter.decodeThreadId("asana:")).toThrow(
      /Invalid Asana thread ID/,
    );
  });

  test("throws on completely unrelated strings", () => {
    expect(() => adapter.decodeThreadId("not-an-id")).toThrow(
      /Invalid Asana thread ID/,
    );
  });

  test("channelIdFromThreadId returns a workspace-scoped channel id", () => {
    expect(adapter.channelIdFromThreadId("asana:anything")).toBe("asana:ws_1");
  });
});
