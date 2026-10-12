/** Browser file selection is an explicit user gesture. Selected bytes use
 * the same guarded asset importer as paste/drop; this adapter owns no vault. */
export function pickBrowserImages(): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.hidden = true;
    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish([...(input.files ?? [])]), { once: true });
    input.addEventListener("cancel", () => finish([]), { once: true });
    document.body.append(input);
    try {
      input.click();
    } catch (error) {
      input.remove();
      reject(error);
    }
  });
}
