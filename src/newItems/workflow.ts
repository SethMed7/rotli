import type { NewItemKind } from "./model";

export interface CreatedItem {
  id: string;
  kind: NewItemKind;
}

export interface NewItemCreator {
  create(kind: NewItemKind): Promise<CreatedItem>;
}

export interface NewItemPresenter {
  refresh(): Promise<void>;
  fileInMain(item: CreatedItem): void;
  open(item: CreatedItem, options: { newTab: boolean }): void;
}

export interface CreateNewItemDependencies {
  creator: NewItemCreator;
  presenter: NewItemPresenter;
}

/** Framework-free orchestration shared by buttons, menus, hotkeys, and tests. */
export async function createNewItem(
  dependencies: CreateNewItemDependencies,
  kind: NewItemKind,
  options: { newTab?: boolean; open?: boolean } = {},
): Promise<CreatedItem> {
  const item = await dependencies.creator.create(kind);
  await dependencies.presenter.refresh();
  dependencies.presenter.fileInMain(item);
  if (options.open !== false) {
    dependencies.presenter.open(item, { newTab: options.newTab ?? false });
  }
  return item;
}
