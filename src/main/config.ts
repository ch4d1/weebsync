import fs from "fs";
import { match, select } from "ts-pattern";
import chokidar from "chokidar";
import { frontend } from "./ui";
import { ApplicationState } from "../shared/types";
import { toggleAutoSync } from "./sync";

const CONFIG_NAME = "weebsync.config.json";
export const PATH_TO_EXECUTABLE: string = process.env.INIT_CWD
  ? process.env.INIT_CWD
  : process.env.PORTABLE_EXECUTABLE_DIR;
export const CONFIG_FILE_PATH = `${PATH_TO_EXECUTABLE}/${CONFIG_NAME}`;

export function watchConfigChanges(applicationState: ApplicationState): void {
  const configWatcher = chokidar.watch(CONFIG_FILE_PATH);
  configWatcher.on("change", async (oath) => {
    if (applicationState.configUpdateInProgress) {
      return;
    }

    frontend.log(`"${oath}" changed, trying to update configuration.`);
    applicationState.configUpdateInProgress = true;
    if (applicationState.syncInProgress) {
      frontend.log("Sync is in progress, won't update configuration now.");
      applicationState.configUpdateInProgress = false;
      return;
    }
    const tmpConfig = await loadConfig();
    if (tmpConfig) {
      applicationState.config = tmpConfig;
      frontend.log("Config successfully updated.");
      if (applicationState.autoSyncIntervalHandler) {
        toggleAutoSync(applicationState, true);
      }
    } else {
      frontend.log("Config was broken, will keep the old config for now.");
    }
    applicationState.configUpdateInProgress = false;
  });
}

export interface Config {
  syncOnStart?: boolean;
  autoSyncIntervalInMinutes?: number;
  debugFileNames?: boolean;
  startAsTray?: boolean;
  server: {
    host: string;
    port: number;
    user: string;
    password: string;
  };
  syncMaps: SyncMap[];
}

export interface SyncMap {
  id: string;
  originFolder: string;
  destinationFolder: string;
  fileRegex: string;
  fileRenameTemplate: string;
}

export function createDefaultConfig(): Config {
  return {
    syncOnStart: true,
    autoSyncIntervalInMinutes: 30,
    server: {
      host: "",
      password: "",
      port: 21,
      user: "",
    },
    syncMaps: [],
  };
}

export type GetConfigResult =
  | {
      type: "Ok";
      data: Config;
    }
  | { type: "WrongConfigError"; message: string }
  | { type: "UnknownError" };

export async function waitForCorrectConfig(): Promise<Config> {
  frontend.log("Loading configuration.");
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve) => {
    const tmpConfig = await loadConfig();
    if (tmpConfig) {
      resolve(tmpConfig);
    } else {
      const watcher = chokidar.watch(CONFIG_FILE_PATH);
      watcher.on("change", async () => {
        const tmpConfig = await loadConfig();
        if (tmpConfig) {
          await watcher.close();
          resolve(tmpConfig);
        }
      });
    }
  });
}

export async function loadConfig(): Promise<Config | undefined> {
  return await match(getConfig())
    .with({ type: "Ok", data: select() }, (res) => Promise.resolve(res))
    .with({ type: "UnknownError" }, async () => {
      frontend.log("Unknown error happened. :tehe:");
      return Promise.resolve(void 0);
    })
    .with({ type: "WrongConfigError", message: select() }, async (err) => {
      frontend.log(`Config malformed. "${err}"`);
      return Promise.resolve(void 0);
    })
    .exhaustive();
}

function getConfig(): GetConfigResult {
  try {
    const file = fs.readFileSync(CONFIG_FILE_PATH).toString("utf-8");
    return {
      type: "Ok",
      data: JSON.parse(file) as Config,
    };
  } catch (e) {
    if (e) {
      if (e instanceof Error) {
        if ("code" in (e as NodeJS.ErrnoException)) {
          const result = (e as NodeJS.ErrnoException).code;
          if (result === "ENOENT") {
            const config = createDefaultConfig();
            fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 4));
            return { type: "Ok", data: config };
          }
        } else {
          return { type: "WrongConfigError", message: e.message };
        }
      }
    }
  }
  return { type: "UnknownError" };
}