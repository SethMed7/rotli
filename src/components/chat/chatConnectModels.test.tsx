import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { PLATFORM } from "../../lib/featurePolicy";
import {
  ChatFirstVisit,
  ConnectModelsDialog,
  ConnectModelsSheet,
  firstVisitShows,
} from "./chatConnectModels";

test("the chooser comes first only on a vault's first chat, until Start chatting", () => {
  const desktop = PLATFORM === "desktop";
  expect(firstVisitShows({ pristine: true, chatCount: 0, done: false })).toBe(desktop);
  // chats already exist, the list is still loading, a saved chat, or dismissed: straight to chat
  expect(firstVisitShows({ pristine: true, chatCount: 3, done: false })).toBe(false);
  expect(firstVisitShows({ pristine: true, chatCount: undefined, done: false })).toBe(false);
  expect(firstVisitShows({ pristine: false, chatCount: 0, done: false })).toBe(false);
  expect(firstVisitShows({ pristine: true, chatCount: 0, done: true })).toBe(false);
});

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

test("the first visit offers every way in, then a way to start with the model it has", () => {
  const html = render(<ChatFirstVisit modelLabel="gemma-3-12b" />);
  expect(html).toContain('aria-label="Choose how Chat answers"');
  expect(html).toContain(">Start chatting with gemma-3-12b<");
  expect(render(<ChatFirstVisit modelLabel={null} />)).not.toContain("Start chatting");
});

test("the picker's Connect a model opens the chooser in a dialog", () => {
  expect(render(<ConnectModelsDialog />)).toBe("");
  const html = render(<ConnectModelsSheet onClose={() => {}} />);
  expect(html).toContain("Connect a model");
  expect(html).toContain(">Done<");
});
