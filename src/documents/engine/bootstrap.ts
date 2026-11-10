// A document uses the core model and command ports, not FUniver: the sheets
// facade globally extends FUniver with initializers requiring sheet services.
// Constructing that facade for a docs-only injector throws after a sheet opens.
import {
  IResourceManagerService,
  LogLevel,
  Univer,
  UniverInstanceType,
  type DocumentDataModel,
  type IDocumentData,
  type IUniverConfig,
  type Plugin,
  type PluginCtor,
} from "@univerjs/presets";

type Preset = {
  plugins: Array<PluginCtor<Plugin> | [PluginCtor<Plugin>, ConstructorParameters<PluginCtor<Plugin>>[0]]>;
};

export function createDocumentEngine(config: Partial<IUniverConfig> & { presets: Preset[] }) {
  const { presets, ...options } = config;
  const univer = new Univer({ logLevel: LogLevel.WARN, ...options });
  // Match createUniver's preset ordering: a later preset replaces a shared
  // plugin and moves it to that preset's position in the registration sequence.
  const plugins = new Map<string, Preset["plugins"][number]>();
  for (const preset of presets) {
    for (const entry of preset.plugins) {
      const plugin = Array.isArray(entry) ? entry[0] : entry;
      plugins.delete(plugin.pluginName);
      plugins.set(plugin.pluginName, entry);
    }
  }
  for (const entry of plugins.values()) {
    if (Array.isArray(entry)) univer.registerPlugin(entry[0], entry[1]);
    else univer.registerPlugin(entry);
  }
  return univer;
}

export function createDocumentModel(univer: Univer, snapshot: IDocumentData) {
  const model = univer.createUnit<IDocumentData, DocumentDataModel>(UniverInstanceType.UNIVER_DOC, snapshot);
  const resources = univer.__getInjector().get(IResourceManagerService);
  return {
    getSnapshot: () => {
      // FDocument.getSnapshot also collects plugin resources. Keep hyperlinks
      // and drawings in the saved snapshot when bypassing the facade.
      const saved = model.getSnapshot();
      saved.resources = resources.getResourcesByType(model.getUnitId(), UniverInstanceType.UNIVER_DOC);
      return saved;
    },
  };
}
