import { Plugin, ResolvedConfig } from "vite";
import MagicString from "magic-string";
import {
  rollup,
  RollupOptions,
  PluginContext,
  watch,
  RollupWatcher,
} from "rollup";
import { posix as path } from "path";
const { join } = path;
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync } from "fs";

function getAssetHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

let isBuild: boolean;
let config: ResolvedConfig;

export const ENTRY_FILE_MARKER = "entry_file";

const plugins_config: WeakMap<Plugin, string[]> = new WeakMap();
const internal_plugin_config: Map<string, string[]> = new Map();

internal_plugin_config.set("vite:import-analysis", []);

const plugin: Plugin = {
  name: "bundle:helper",
  configResolved(resolvedConfig) {
    if (config) return;

    isBuild = resolvedConfig.command === "build";
    config = resolvedConfig;
  },
  transform(code, id) {
    if (!isBuild && id.endsWith(ENTRY_FILE_MARKER)) {
      const nCode = new MagicString(code).prepend(`import '/@vite/env'\n`);
      return {
        code: nCode.toString(),
        map: nCode.generateMap({ hires: false }),
      };
    }
  },
};

let removeString =
  'export function __vite_legacy_guard(){import("data:text/javascript,")}';

export default function bundleHelper(): Plugin {
  return plugin;
}

const watchers: RollupWatcher[] = [];

export async function bundle(
  pluginContext: PluginContext,
  entry: string,
  ctx: string,
  result_type: "iife" | "module" = "module",
  inline = false,
  watch_files = false,
  static_file: string | false = false
): Promise<string> {
  if (isBuild && watch_files) {
    throw new Error("At build you can not watch files!");
  }
  if (!isBuild && inline) {
    throw new Error("You only can inline files at build!");
  }
  if (inline && result_type === "module") {
    throw new Error(
      "You only can inline files at build that are of type iife not module!"
    );
  }

  if (entry.includes("?")) entry = entry + "&" + ENTRY_FILE_MARKER;
  else entry = entry + "?" + ENTRY_FILE_MARKER;

  if (result_type === "module") {
    if (isBuild) {
      const file = pluginContext.emitFile({
        type: "chunk",
        id: entry,
      });

      return `import.meta.ROLLUP_FILE_URL_${file}`;
    } else {
      return "'/@id/" + entry + "'";
    }
  }

  if (result_type === "iife") {
    const rollup_config: RollupOptions = {
      input: entry,
      plugins: [
        ...config.plugins.filter((v) => inContext(v, ctx)),
        // LAST PLUGIN IS CUSTOM!
        {
          name: "fix-legacy-plugin-iife",
          renderChunk(code, chunk) {
            if (chunk.isEntry) {
              const [before, after] = code.split(removeString);

              let startpos = before.length;

              if (after) {
                const nCode = new MagicString(code);

                nCode.overwrite(startpos, startpos + removeString.length, "");

                return {
                  code: nCode.toString(),
                  map: nCode.generateMap({ hires: false }),
                };
              }
            }
          },
        },
        {
          name: "extra-file-loader",
          load(id) {
            if (id.includes("?")) {
              return readFileSync(id.split("?")[0], "utf-8");
            }
          },
        },
      ],
    };

    if (watch_files) {
      const cacheDir = join(config.cacheDir!, ".bundle.iife");
      if (!existsSync(cacheDir)) mkdirSync(cacheDir);
      const fileName = static_file
        ? static_file
        : getAssetHash(Buffer.from(entry + ctx)) + ".iife.js";
      const outFile = join(cacheDir, fileName);

      const watcher = watch({ ...rollup_config, output: { file: outFile } });

      watchers.push(watcher);

      return new Promise<string>((res, req) => {
        let first = true;
        watcher.on("event", async (event) => {
          if (event.code === "ERROR" && first) {
            first = false;
            req(event.error);
          }
          if (event.code === "BUNDLE_END") {
            await event.result.generate({
              format: "iife",
              sourcemap: "inline",
            });

            if (first) {
              first = false;
              pluginContext.addWatchFile(outFile);
              res(JSON.stringify(outFile.slice(config.root.length)));
            }
          }
        });
      });
    } else {
      const bundle = await rollup(rollup_config);

      try {
        const { output } = await bundle.generate({
          format: "iife",
          sourcemap: config.build.sourcemap,
        });
        await bundle.close();
        const code = output[0].code;
        const content = Buffer.from(code);

        if (inline) {
          const base64 = content.toString("base64");
          const blob = `new Blob([atob("${base64}")], { type: 'text/javascript;charset=utf-8' })`;
          return `(window.URL || window.webkitURL).createObjectURL(${blob})`;
        }

        if (!static_file) {
          const pathSplit = entry.split("?")[0].split(/\/|\\/g);
          const fileSplit = pathSplit[pathSplit.length - 1].split(".");
          const basename = fileSplit.slice(0, fileSplit.length - 1).join(".");
          const contentHash = getAssetHash(content);
          const fileName = join(
            config.build.assetsDir,
            `${basename}.${contentHash}.js`
          );
          // get real URL variable
          return `'__VITE_ASSET__${pluginContext.emitFile({
            fileName,
            type: "asset",
            source: code,
          })}__'`;
        } else {
          return `'__VITE_ASSET__${pluginContext.emitFile({
            fileName: static_file,
            type: "asset",
            source: code,
          })}__'`;
        }
      } catch (ex) {
        await bundle.close();
        throw ex;
      }
    }
  }

  throw new Error("Non valid result_type!");
}

export function setPluginContext(
  plugin: Plugin,
  ctx: string[],
  overwrite = true
) {
  if (overwrite || !plugins_config.has(plugin)) {
    plugins_config.set(plugin, ctx);
  } else {
    plugins_config.set(plugin, plugins_config.get(plugin)!.concat(ctx));
  }
}

function inContext(plugin: Plugin, ctx: string) {
  if (!plugins_config.has(plugin) && !internal_plugin_config.has(plugin.name))
    return true;

  if (plugins_config.has(plugin)) {
    return plugins_config.get(plugin)!.includes(ctx);
  }

  if (internal_plugin_config.has(plugin.name)) {
    return (
      internal_plugin_config.get(plugin.name)!.includes(ctx) ||
      internal_plugin_config.get(plugin.name)!.includes("*")
    );
  }
}

export function inlineURLRevoke(varName: string) {
  return `(window.URL || window.webkitURL).revokeObjectURL(${varName});`;
}
