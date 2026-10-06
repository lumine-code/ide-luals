const server = require("./server");
const setting = (key) => lumine.config.get(`ide-luals.${key}`);

const settings = () => {
  const Lua = {
    hint: { enable: true },
    codeLens: { enable: true },
    // The upstream addon manager belongs to its own VS Code extension. Users
    // can supply the same annotated libraries directly through project config.
    workspace: { checkThirdParty: false },
    addonManager: { enable: false },
  };
  const version = setting("runtimeVersion");
  if (version && version !== "server-default") Lua.runtime = { version };
  const libraries = setting("libraryPaths");
  if (libraries?.length) Lua.workspace.library = libraries;
  const globals = setting("globals");
  if (globals?.length) Lua.diagnostics = { globals };
  return { Lua, files: { associations: { "*.rockspec": "lua" } } };
};

module.exports = {
  consumeIdeClient(service) {
    return service.registerAdapter({
      id: "ide-luals",
      displayName: "Lua Language Server",
      grammarScopes: ["source.lua"],
      languageId: "lua",
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-luals"],
      restartKeyPaths: ["ide-luals.serverPath"],
      managedServerDisplayName: "LuaLS",
      latestServerVersion: server.latestServerVersion,
      installServer: server.installServer,
      async resolveServer(context) {
        const launch = await server.resolveServer(setting("serverPath"), context);
        if (!launch)
          service.reportMissingServer("ide-luals", {
            description:
              "Install [LuaLS](https://luals.github.io/), select its executable in Server Path, or let Manage Servers download the complete distribution.",
          });
        return launch;
      },
      getSettings: settings,
    });
  },
  provideBackgroundTips() {
    return {
      packageName: "ide-luals",
      tips: [
        "LuaLS reads .luarc.json to select your Lua version, application globals and annotated libraries; annotations improve completion, navigation and type diagnostics across modules.",
      ],
    };
  },
};
