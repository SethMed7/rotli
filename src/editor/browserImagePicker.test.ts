import { afterAll, expect, test } from "bun:test";

import { pickBrowserImages } from "./browserImagePicker";

const original = globalThis.document;
let input: {
  type: string;
  accept: string;
  multiple: boolean;
  files: File[];
  click(): void;
  remove(): void;
  addEventListener(type: string, listener: () => void): void;
};
let appended = false;
let removed = false;
let choose = true;
const selected = new File(["synthetic"], "example.png", { type: "image/png" });
Object.assign(globalThis, {
  document: {
    createElement: () => {
      const listeners = new Map<string, () => void>();
      input = {
        type: "",
        accept: "",
        multiple: false,
        files: [selected],
        addEventListener: (type, listener) => {
          listeners.set(type, listener);
        },
        remove: () => {
          removed = true;
        },
        click: () => {
          expect(appended).toBe(true);
          listeners.get(choose ? "change" : "cancel")?.();
        },
      };
      return input;
    },
    body: {
      append: () => {
        appended = true;
      },
    },
  },
});
afterAll(() => {
  Object.assign(globalThis, { document: original });
});
test("browser attachment picks image Files and removes the temporary input", async () => {
  const files = await pickBrowserImages();
  expect(files).toEqual([selected]);
  expect(input.type).toBe("file");
  expect(input.accept).toBe("image/*");
  expect(input.multiple).toBe(true);
  expect(removed).toBe(true);
});
test("cancelling attachment returns no files and removes the input", async () => {
  choose = false;
  removed = false;
  expect(await pickBrowserImages()).toEqual([]);
  expect(removed).toBe(true);
});
