# vite-plugin-bundle

Create plugins to improve bundeling external chunks.

### Install

```sh
npm i --save-dev vite-plugin-bundle # yarn add -D vite-plugin-comlink
```

## What is this plugin?
> This plugin is more like a "meta-plugin" that can be used by other plugins. Directly using this Plugin is not possible.

This plugin exports a few things:
1. `bundleHelper` This returns a SINGLE instance of a plugin that has to be in the vite config EXACTLY once.
2. `bundle` This is the main function used by other plugins it returns a Promise of a string wich is a filename for a new bundle. This bundle can be inlined (build only); bundled as a iife or module and might have a static filename (use case for that is a serviceWorker). Also the build can be watched (only relevant for iife build).
3. `setPluginContext` can set the context in wich specific plugins can / should run.
4. `inlineURLRevoke` A helper to revoke inline URLs after usage.

## API
```ts
function bundle(
  pluginContext: PluginContext, 
  entry: string, 
  ctx: string, 
  result_type?: "iife" | "module", 
  inline?: boolean, 
  watch_files?: boolean, 
  static_file?: string | false
): Promise<string>;
```

## Specify used plugins
You can set Plugins to run in specific context. Use

```ts
setPluginContext(plugin: Plugin, ctx: string[], overwrite = true)
```

to set the context for a plugin.

ctx is a Array of context-strings. If overwrrite is `false` the array is appended if there is a config set.


If a plugin doesn't have any `setPluginContext` applied to it, it is used in all contexts.

## HMR
This plugin has not any kind of HMR build into it. I use this plugin for 2 other plugins so that might change if something is needed.