const { resolver, serverContext, installContext } = require("./helpers/server-resolver");
const fs = require("node:fs");
const path = require("node:path");
const { createProject, removeProject } = require("./helpers/project");

describe("ide-luals adapter and installation", () => {
  let main, server, adapter, fixture, registration;
  beforeEach(async () => {
    const pkg = await lumine.packages.activatePackage("ide-luals");
    main = pkg.mainModule;
    server = require("../lib/server");
    fixture = createProject();
    registration = { dispose: jasmine.createSpy("dispose provider edge") };
    main.consumeIdeClient({
      registerAdapter(value) {
        adapter = value;
        return registration;
      },
    });
  });
  afterEach(async () => {
    for (const key of ["serverPath", "runtimeVersion", "libraryPaths", "globals"])
      lumine.config.unset(`ide-luals.${key}`);
    await lumine.packages.deactivatePackage("ide-luals");
    await removeProject(fixture.rootPath);
  });

  it("returns the provider edge and identifies the Lua grammar and managed tool", () => {
    expect(
      main.consumeIdeClient({
        registerAdapter() {
          return registration;
        },
      }),
    ).toBe(registration);
    expect(adapter.grammarScopes).toEqual(["source.lua"]);
    expect(adapter.languageId).toBe("lua");
    expect(adapter.sessionScope).toBe("project-root");
    expect(adapter.installServer).toEqual(jasmine.any(Function));
    expect(adapter.latestServerVersion).toEqual(jasmine.any(Function));
  });
  it("exposes native settings sections and preserves unset runtime defaults", () => {
    expect(adapter.getSettings().Lua.runtime).toBeUndefined();
    expect(adapter.getSettings().Lua.hint).toEqual({ enable: true });
    expect(adapter.getSettings().files.associations).toEqual({
      "*.rockspec": "lua",
    });
    expect(adapter.getWorkspaceConfiguration).toBeUndefined();
    lumine.config.set("ide-luals.runtimeVersion", "LuaJIT");
    lumine.config.set("ide-luals.globals", ["application"]);
    lumine.config.set("ide-luals.libraryPaths", [fixture.rootPath]);
    expect(adapter.getSettings().Lua.runtime).toEqual({ version: "LuaJIT" });
    expect(adapter.getSettings().Lua.diagnostics.globals).toEqual(["application"]);
    expect(adapter.getSettings().Lua.workspace.library).toEqual([fixture.rootPath]);
  });
  it("keeps logs and generated metadata outside a user-selected distribution", async () => {
    lumine.config.set("ide-luals.serverPath", process.execPath);
    const launch = await adapter.resolveServer(
      serverContext({
        rootPath: fixture.rootPath,
        configDirPath: path.join(fixture.rootPath, "config"),
      }),
    );
    expect(launch.command).toBe(process.execPath);
    expect(launch.cwd).toBe(fixture.rootPath);
    expect(launch.transport).toBe("stdio");
    for (const argument of launch.args) {
      const directory = argument.slice(argument.indexOf("=") + 1);
      expect(directory.startsWith(path.join(fixture.rootPath, "config"))).toBe(true);
      expect(fs.statSync(directory).isDirectory()).toBe(true);
    }
  });
  it("prefers explicit paths over a managed executable and rejects directories", async () => {
    const context = {
      rootPath: fixture.rootPath,
      configDirPath: fixture.rootPath,
      managedServer: { binaryPath: "ignored", version: "3.19.1" },
    };
    expect((await server.resolveServer(serverContext(context), process.execPath)).command).toBe(
      process.execPath,
    );
    await expectAsync(
      server.resolveServer(serverContext(context), fixture.rootPath),
    ).toBeRejectedWithError(/must name a file/);
  });
  it("reports a missing executable through the shared client", async () => {
    spyOn(resolver, "select").and.resolveTo(null);
    const missing = jasmine.createSpy("missing server");
    main.consumeIdeClient({
      registerAdapter(value) {
        adapter = value;
        return registration;
      },
      reportMissingServer: missing,
    });
    expect(await adapter.resolveServer(serverContext({ rootPath: fixture.rootPath }))).toBeNull();
    expect(missing.calls.count()).toBe(1);
    const [id, details] = missing.calls.mostRecent().args;
    expect(id).toBe("ide-luals");
    expect(details.description).toContain("complete distribution");
  });
  it("selects only real release targets and refuses invalid version paths", () => {
    for (const [platform, arch] of [
      ["win32", "x64"],
      ["win32", "ia32"],
      ["linux", "x64"],
      ["linux", "arm64"],
      ["darwin", "x64"],
      ["darwin", "arm64"],
    ])
      expect(server.assetFor({ platform, arch, version: "3.19.1" })).toContain(
        `${platform}-${arch}`,
      );
    expect(server.assetFor({ platform: "win32", arch: "arm64", version: "3.19.1" })).toBeNull();
    expect(server.assetFor({ platform: "linux", arch: "x64", version: "../main" })).toBeNull();
  });
  it("requires a published digest before downloading a managed release", async () => {
    const asset = server.assetFor({
      platform: process.platform,
      arch: process.arch,
      version: "3.19.1",
    });
    const api = {
      githubReleaseByTag: async () => ({
        version: "3.19.1",
        assets: [{ name: asset, url: "unused" }],
      }),
      downloadFile: jasmine.createSpy("download"),
    };
    await expectAsync(
      server.installServer(
        installContext({ storagePath: fixture.rootPath, version: "3.19.1", api }),
      ),
    ).toBeRejectedWithError(/SHA256/);
    expect(api.downloadFile).not.toHaveBeenCalled();
  });
  it("rejects an incomplete distribution even when its executable was downloaded", async () => {
    const asset = server.assetFor({
      platform: process.platform,
      arch: process.arch,
      version: "3.19.1",
    });
    const api = {
      githubReleaseByTag: async () => ({
        version: "3.19.1",
        assets: [{ name: asset, url: "unused", digest: "sha256:" + "a".repeat(64) }],
      }),
      downloadFile: async () => {},
      setServerInstallationStatus() {},
    };
    await expectAsync(
      server.installServer(
        installContext({ storagePath: fixture.rootPath, version: "3.19.1", api }),
      ),
    ).toBeRejected();
  });
  it("publishes one manifest-named background tip", () => {
    const tips = main.provideBackgroundTips();
    expect(tips.packageName).toBe("ide-luals");
    expect(tips.tips.length).toBe(1);
    expect(tips.tips[0]).toContain(".luarc.json");
  });
});
