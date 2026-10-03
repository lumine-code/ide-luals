const fs = require("node:fs");
const path = require("node:path");
const { LiveLspClient } = require("./helpers/live-lsp-client");
const { createProject, removeProject } = require("./helpers/project");
const exercise = require("./helpers/exercise-server");
const serverPath =
  process.env.LUALS_PATH || require("../lib/server").findOnPath("lua-language-server");
if (process.env.REQUIRE_LUALS && !serverPath)
  throw new Error("CI requires a real LuaLS executable");
const liveSuite = serverPath ? describe : () => {};

liveSuite("ide-lua real LuaLS protocol", () => {
  let fixture, client, adapter, timeout;
  beforeAll(() => {
    timeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
  });
  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = timeout;
  });
  beforeEach(async () => {
    jasmine.useRealClock();
    fixture = createProject();
    lumine.config.set("ide-lua.serverPath", serverPath);
    const main = (await lumine.packages.activatePackage("ide-lua")).mainModule;
    main.consumeIdeClient({
      registerAdapter(value) {
        adapter = value;
        client = new LiveLspClient(value, fixture.rootPath);
        return { dispose() {} };
      },
    });
  });
  afterEach(async () => {
    await client.stop();
    lumine.config.unset("ide-lua.serverPath");
    lumine.config.unset("ide-lua.runtimeVersion");
    await lumine.packages.deactivatePackage("ide-lua");
    await removeProject(fixture.rootPath);
  });
  const start = async () => {
    const result = await client.start();
    expect(result.serverInfo.version).toBe(process.env.LUALS_VERSION || "3.19.1");
    await exercise.openProject(client, fixture);
  };
  for (const [description, check] of [
    [
      "completes and resolves documented modules with UTF-16 hover and signature help",
      "intelligence",
    ],
    ["navigates definitions and types and renames both modules after emoji", "navigationAndRename"],
    ["publishes and clears real diagnostics after a document change", "diagnostics"],
    [
      "serves document and project symbols plus file, range and typed formatting",
      "symbolsAndFormat",
    ],
    ["executes real fixes and returns hints and semantic tokens", "actionsHintsAndTokens"],
    [
      "provides useful reference-count labels and folding without unsupported hierarchies",
      "lensesAndFolding",
    ],
  ])
    it(description, async () => {
      await start();
      await exercise[check](client, fixture);
    });
  it("preserves the project's Lua version ahead of an editor fallback", async () => {
    lumine.config.set("ide-lua.runtimeVersion", "Lua 5.1");
    await start();
    // LuaLS's custom command expects the same canonical URI it emits in its
    // own actions. Standard document requests accept native drive spellings.
    const declaration = await client.request("textDocument/definition", {
      textDocument: { uri: fixture.uris.main },
      position: require("./helpers/project").position(fixture.texts.main, "greet(", 2),
    });
    expect(
      await client.request("workspace/executeCommand", {
        command: "lua.getConfig",
        arguments: [{ uri: declaration[0].targetUri, key: "Lua.runtime.version" }],
      }),
    ).toBe("Lua 5.4");
  });
  it("installs the checksum-verified full distribution through the hub and runs its managed copy", async () => {
    const packagePath = (await lumine.packages.loadPackage("ide-client")).path;
    const ManagedServers = require(path.join(packagePath, "lib", "managed-servers"));
    const managed = new ManagedServers(
      {
        adapters: new Map([[adapter.id, adapter]]),
        allSessions: () => [],
        reattachAll: async () => {},
      },
      { storageRoot: path.join(fixture.directory, "managed") },
    );
    try {
      const record = await managed.install(adapter.id, {
        version: process.env.LUALS_VERSION || "3.19.1",
      });
      expect(record.version).toBe(process.env.LUALS_VERSION || "3.19.1");
      const installed = managed.installFor(adapter);
      for (const file of ["main.lua", "LICENSE"])
        expect(fs.statSync(path.join(installed.directory, file)).isFile()).toBe(true);
      lumine.config.set("ide-lua.serverPath", "");
      await client.start(installed);
      await exercise.openProject(client, fixture);
      await exercise.intelligence(client, fixture);
      await exercise.symbolsAndFormat(client, fixture);
    } finally {
      await client.stop();
      managed.emitter.dispose();
    }
  });
});
