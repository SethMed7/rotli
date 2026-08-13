// TanStack Query hooks over the memex service — components consume these, never
// the service directly (the same law as services/hooks.ts for notes).

import { useMutation, useQuery } from "@tanstack/react-query";

import { queryClient } from "../services/query";
import type { MemexInstance, Perms } from "./config";
import type { ChatMsg } from "./contract";
import * as svc from "./service";

export const memexKeys = {
  config: ["memex", "config"] as const,
  detect: ["memex", "detect"] as const,
  chats: (instanceId: string) => ["memex", "chats", instanceId] as const,
};

export async function invalidateMemex(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["memex"] });
}

export function useMemexConfig() {
  return useQuery({ queryKey: memexKeys.config, queryFn: () => svc.loadConfig() });
}

/** Probe likely locations for an existing memex (first-run "Merge" candidates). */
export function useDetectMemex(enabled = true) {
  return useQuery({ queryKey: memexKeys.detect, queryFn: () => svc.detect(), enabled });
}

export function useInstanceChats(instance: MemexInstance | null) {
  return useQuery({
    queryKey: memexKeys.chats(instance?.id ?? "none"),
    queryFn: () => (instance ? svc.listChats(instance) : Promise.resolve([])),
    enabled: !!instance,
  });
}

/** "Choose folder…" — the one smart picker for the corpus (relaunches on success). */
export function useChooseFolder() {
  return useMutation({
    mutationFn: (path?: string) => svc.chooseFolder(path),
    onSuccess: () => invalidateMemex(),
  });
}

/** Connect an existing memex as a brain (relaunches on success). */
export function useConnectBrain() {
  return useMutation({
    mutationFn: (path: string | undefined) => svc.connectBrain(path),
    onSuccess: () => invalidateMemex(),
  });
}

/** Forget a connected brain (binding only; files untouched). */
export function useForgetBrain() {
  return useMutation({
    mutationFn: (id: string) => svc.forget(id),
    onSuccess: () => invalidateMemex(),
  });
}

export function useSetActiveMemex() {
  return useMutation({
    mutationFn: (id: string) => svc.setActive(id),
    onSuccess: () => invalidateMemex(),
  });
}

export function useSetMemexPerms() {
  return useMutation({
    mutationFn: ({ id, perms }: { id: string; perms: Perms }) => svc.setPerms(id, perms),
    onSuccess: () => invalidateMemex(),
  });
}

export function useWriteChat() {
  return useMutation({
    mutationFn: (input: {
      instance: MemexInstance;
      title: string;
      slug?: string;
      attachedTo?: string;
      messages: ChatMsg[];
      existingSlug?: string;
      secureContext?: boolean;
    }) => svc.writeChat(input),
    onSuccess: (_res, vars) => queryClient.invalidateQueries({ queryKey: memexKeys.chats(vars.instance.id) }),
  });
}

/** Point an existing chat at its attached note (the header note-toggle link). */
export function useSetChatAttachedTo() {
  return useMutation({
    mutationFn: ({ instance, slug, stem }: { instance: MemexInstance; slug: string; stem: string }) =>
      svc.setChatAttachedTo(instance, slug, stem),
    onSuccess: (_res, vars) => queryClient.invalidateQueries({ queryKey: memexKeys.chats(vars.instance.id) }),
  });
}

export function useRunValidate() {
  return useMutation({
    mutationFn: (instance: MemexInstance) => svc.runValidate(instance),
  });
}
