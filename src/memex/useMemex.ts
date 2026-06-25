// TanStack Query hooks over the memex service — components consume these, never
// the service directly (the same law as services/hooks.ts for notes).

import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../services/query";
import type { MemexInstance, Perms } from "./config";
import * as svc from "./service";
import type { ChatMsg } from "./contract";

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

/** Read-only Memory browser: one directory listing of the active instance's spine. */
export function useSpineDir(instance: MemexInstance | null, rel: string) {
  return useQuery({
    queryKey: ["memex", "dir", instance?.id ?? "none", rel],
    queryFn: () => (instance ? svc.listDir(instance, rel) : Promise.resolve([])),
    enabled: !!instance,
  });
}

export function useConnectMemex() {
  return useMutation({
    mutationFn: ({ path, label }: { path: string; label: string }) => svc.connect(path, label),
    onSuccess: () => invalidateMemex(),
  });
}

export function useInitMemex() {
  return useMutation({
    mutationFn: ({ path, label }: { path: string; label: string }) => svc.init(path, label),
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
      attachedTo?: string;
      messages: ChatMsg[];
      existingSlug?: string;
    }) => svc.writeChat(input),
    onSuccess: (_res, vars) =>
      queryClient.invalidateQueries({ queryKey: memexKeys.chats(vars.instance.id) }),
  });
}

export function useWriteNote() {
  return useMutation({
    mutationFn: (input: { instance: MemexInstance; body: string; shelf?: string[]; reach?: string[] }) =>
      svc.writeNote(input),
    onSuccess: (_res, vars) => {
      // refresh the read-only spine browser so the new staging note shows up.
      queryClient.invalidateQueries({ queryKey: ["memex", "dir", vars.instance.id] });
    },
  });
}

export function useRunValidate() {
  return useMutation({
    mutationFn: (instance: MemexInstance) => svc.runValidate(instance),
  });
}
