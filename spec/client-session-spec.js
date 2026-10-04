const fs = require("node:fs");
const { Point } = require("lumine");
const { createProject, removeProject, position } = require("./helpers/project");
const { sameUri } = require("./helpers/exercise-server");
const serverPath =
  process.env.LUALS_PATH || require("../lib/server").findOnPath("lua-language-server");
const liveSuite = serverPath ? describe : () => {};
const until = async (check, label) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label} timed out`);
};

liveSuite("ide-luals actual editor routing", () => {
  let fixture, editors, service, paths, published, subscription, timeout;
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
    editors = {};
    paths = lumine.project.getPaths();
    published = [];
    lumine.config.set("ide-luals.serverPath", serverPath);
    for (const name of ["language-lua", "ide-client", "ide-luals"])
      await lumine.packages.activatePackage(name);
    service = lumine.packages.getActivePackage("ide-client").mainModule.provideIdeClient();
    subscription = service.onDidPublishDiagnostics((value) => published.push(value));
    lumine.project.setPaths([fixture.rootPath]);
    for (const name of Object.keys(fixture.texts)) {
      editors[name] = await lumine.workspace.open(fixture.files[name]);
      editors[name].setGrammar(lumine.grammars.grammarForScopeName("source.lua"));
    }
  });
  afterEach(async () => {
    subscription?.dispose();
    for (const editor of Object.values(editors)) if (!editor.isDestroyed()) editor.destroy();
    for (const editor of lumine.workspace.getTextEditors())
      if (editor.getPath()?.toLowerCase().startsWith(fixture.rootPath.toLowerCase()))
        editor.destroy();
    for (const name of ["ide-luals", "ide-client", "language-lua"])
      await lumine.packages.deactivatePackage(name);
    lumine.config.unset("ide-luals.serverPath");
    for (const name of Object.keys(require("../package.json").configSchema.features.properties))
      lumine.config.unset(`ide-luals.features.${name}`);
    lumine.project.setPaths(paths);
    await lumine.fileWatchClient.settlePendingTeardown();
    await removeProject(fixture.rootPath);
  });
  const main = () => lumine.packages.getActivePackage("ide-client").mainModule;
  const point = (name, fragment, inside = 2) => {
    const value = position(fixture.texts[name], fragment, inside);
    return new Point(value.line, value.character);
  };
  const ready = () =>
    until(async () => {
      const session = (await service.activeSessionsForEditor(editors.main)).find(
        ({ adapter, state }) => adapter.id === "ide-luals" && state === "running",
      );
      if (!session) return false;
      return (
        JSON.stringify(
          await main().provideContextHelp().getHelp(editors.main, point("main", "greet(")),
        ).includes("Build a greeting") && session
      );
    }, "Lua editor module analysis");

  it("routes completion, hover, signatures, definitions, references and symbols through real frontends", async () => {
    await ready();
    const m = main();
    const completion = await m.provideAutocomplete().getSuggestions({
      editor: editors.completion,
      bufferPosition: point("completion", "greeter.gr", 10),
      prefix: "gr",
      activatedManually: true,
    });
    expect(
      completion.some(({ text, snippet, displayText }) =>
        (text || snippet || displayText || "").includes("greet"),
      ),
    ).toBe(true);
    expect(
      JSON.stringify(await m.provideContextHelp().getHelp(editors.main, point("main", "greet("))),
    ).toContain("Build a greeting");
    expect(
      (await m.provideHoverSignature().getSignature(editors.main, point("main", 'greet("Ada"', 8)))
        .signatures[0].label,
    ).toContain("name: string");
    const reference = await m
      .provideFindReferences()
      .findReferences(editors.main, point("main", "greet("));
    for (const name of ["main", "greeter"])
      expect(
        reference.references.some(
          ({ path }) => path.toLowerCase() === fixture.files[name].toLowerCase(),
        ),
      ).toBe(true);
    const definitions = await m.provideSymbol().getSymbols({
      type: "declaration",
      editor: editors.main,
      range: { start: point("main", "greet(") },
    });
    expect(
      definitions.some(({ path }) => path.toLowerCase() === fixture.files.greeter.toLowerCase()),
    ).toBe(true);
    expect(
      (await m.provideSymbol().getSymbols({ type: "file", editor: editors.greeter })).some(
        ({ name }) => name === "M.greet",
      ),
    ).toBe(true);
    expect(
      (
        await m
          .provideSymbol()
          .getSymbols({ type: "project", editor: editors.main, query: "greet" })
      ).some(({ name }) => name === "greet"),
    ).toBe(true);
  });
  it("keeps UTF-16 rename edits correct and applies them to both an open buffer and closed module", async () => {
    const session = await ready();
    editors.greeter.destroy();
    const prepared = await main()
      .provideRefactor()
      .prepareRename(editors.main, point("main", "greet("));
    expect(Point.fromObject(prepared.range.start || prepared.range[0]).column).toBe(
      position(fixture.texts.main, "greet(").character,
    );
    const preview = await main()
      .provideRefactor()
      .rename(editors.main, point("main", "greet("), "welcome", { dryRun: true });
    expect(preview.outcome).toBe("edits");
    expect(preview.edits.size).toBe(2);
    const wire = await session.request("textDocument/rename", {
      textDocument: { uri: fixture.uris.main },
      position: position(fixture.texts.main, "greet(", 2),
      newName: "welcome",
    });
    expect(await service.applyWorkspaceEdit(wire, "Rename Lua function", session)).toBe(true);
    expect(editors.main.getText()).toContain('"😀"; print(greeter.welcome("Ada"))');
    const reopened = await lumine.workspace.open(fixture.files.greeter, { activateItem: false });
    expect(reopened.getText()).toContain("function M.welcome(name)");
    await reopened.save();
    expect(await fs.promises.readFile(fixture.files.greeter, "utf8")).toContain(
      "function M.welcome(name)",
    );
  });
  it("publishes and clears diagnostics, executes a real code action and returns readonly lenses", async () => {
    await ready();
    await until(
      () =>
        published.some(
          ({ uri, diagnostics }) =>
            sameUri(uri, fixture.uris.broken) &&
            diagnostics.some(({ code }) => code === "undefined-global"),
        ),
      "editor diagnostic",
    );
    const previous = published.length;
    editors.broken.setText("local result = 1\nprint(result)\n");
    await until(
      () =>
        published
          .slice(previous)
          .some(
            ({ uri, diagnostics }) => sameUri(uri, fixture.uris.broken) && diagnostics.length === 0,
          ),
      "editor diagnostic clear",
    );
    await until(
      () =>
        published.some(
          ({ uri, diagnostics }) =>
            sameUri(uri, fixture.uris.actions) &&
            diagnostics.some(({ code }) => code === "trailing-space"),
        ),
      "action diagnostic",
    );
    const intentions = await main()
      .provideIntentionsList()
      .getIntentions({ textEditor: editors.actions, bufferPosition: new Point(0, 19) });
    const clear = intentions.find(({ title }) => title.startsWith("Clear all"));
    expect(clear).toBeTruthy();
    await clear.selected();
    await until(
      () => !editors.actions.getText().split("\n")[0].endsWith(" "),
      "applied whitespace fix",
    );
    const lenses = await main().provideCodeLens().codeLenses(editors.greeter);
    expect(lenses.length).toBeGreaterThan(0);
    const resolved = await main().provideCodeLens().resolveCodeLens(lenses[0]);
    expect(resolved.title).toContain("references");
    expect(resolved.execute).toBeUndefined();
  });
  it("routes hints, semantic classifications and all three formatting modes with valid EOF ranges", async () => {
    await ready();
    const m = main();
    expect(
      (await m.provideInlayHints().inlayHints(editors.main, [0, 10000])).some(({ label }) =>
        label.includes("name:"),
      ),
    ).toBe(true);
    expect((await m.provideSemanticTokens().semanticTokens(editors.main)).length).toBeGreaterThan(
      0,
    );
    expect(
      (await m.provideSemanticTokens().semanticTokensInRange(editors.main, [0, 10000])).length,
    ).toBeGreaterThan(0);
    const file = await m.provideCodeFormatFile().formatEntireFile(editors.format);
    expect(file[0].newText).toContain("one = 1");
    expect(
      (
        await m.provideCodeFormatRange().formatCode(editors.format, [
          [0, 0],
          [1, 0],
        ])
      ).length,
    ).toBeGreaterThan(0);
    const typed = await m
      .provideCodeFormatOnType()
      .formatAtPosition(editors.onType, new Point(1, 0), "\n");
    expect(typed[0].newText).toBe("if true then\n");
  });
  it("honours every advertised feature switch without presenting unsupported hierarchies", async () => {
    const session = await ready();
    const methods = {
      diagnostics: "textDocument/publishDiagnostics",
      autocomplete: "textDocument/completion",
      hover: "textDocument/hover",
      signature: "textDocument/signatureHelp",
      definition: "textDocument/definition",
      references: "textDocument/references",
      symbols: "textDocument/documentSymbol",
      format: "textDocument/formatting",
      rename: "textDocument/rename",
      codeActions: "textDocument/codeAction",
      inlayHints: "textDocument/inlayHint",
      semanticTokens: "textDocument/semanticTokens/full",
      codeLens: "textDocument/codeLens",
    };
    for (const [feature, method] of Object.entries(methods)) {
      lumine.config.set(`ide-luals.features.${feature}`, false);
      expect(session.supports(method, editors.main, feature))
        .withContext(feature)
        .toBe(false);
      lumine.config.unset(`ide-luals.features.${feature}`);
    }
    expect(session.supports("textDocument/prepareCallHierarchy", editors.main)).toBe(false);
    expect(session.supports("textDocument/prepareTypeHierarchy", editors.main)).toBe(false);
    lumine.config.set("ide-luals.features.format", false);
    expect(await main().provideCodeFormatFile().formatEntireFile(editors.format)).toEqual([]);
    lumine.config.set("ide-luals.features.hover", false);
    expect(
      await main().provideContextHelp().getHelp(editors.main, point("main", "greet(")),
    ).toBeNull();
  });
  it("stops its server and reconnects existing editors after a package unload and reload", async () => {
    const old = await ready();
    await lumine.packages.deactivatePackage("ide-luals");
    await until(() => old.processExited || old.process?.exitCode != null, "Lua process exit");
    await lumine.packages.unloadPackage("ide-luals");
    await lumine.packages.activatePackage("ide-luals");
    const fresh = await ready();
    expect(fresh).not.toBe(old);
    expect(
      JSON.stringify(
        await main().provideContextHelp().getHelp(editors.main, point("main", "greet(")),
      ),
    ).toContain("Build a greeting");
  });
});
