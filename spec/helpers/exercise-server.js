const assert = require("node:assert/strict");
const { fileURLToPath } = require("node:url");
const { position } = require("./project");
const key = (uri) =>
  process.platform === "win32" ? fileURLToPath(uri).toLowerCase() : fileURLToPath(uri);
const sameUri = (left, right) => key(left) === key(right);
exports.sameUri = sameUri;
const params = (fixture, name, fragment, inside = 2) => ({
  textDocument: { uri: fixture.uris[name] },
  position: position(fixture.texts[name], fragment, inside),
});

exports.openProject = async (client, fixture) => {
  for (const name of Object.keys(fixture.texts))
    client.open(fixture.uris[name], "lua", fixture.texts[name]);
  await client.waitFor(
    async () =>
      JSON.stringify(
        await client.request("textDocument/hover", params(fixture, "main", "greet(")),
      ).includes("Build a greeting"),
    "Lua module indexing",
    30000,
  );
};
exports.intelligence = async (client, fixture) => {
  const hover = await client.request("textDocument/hover", params(fixture, "main", "greet("));
  assert.match(hover.contents.value, /Build a greeting/);
  assert.equal(hover.range.start.character, position(fixture.texts.main, "greet(").character);
  const signature = await client.request(
    "textDocument/signatureHelp",
    params(fixture, "main", 'greet("Ada"', 8),
  );
  assert.match(signature.signatures[0].label, /name: string/);
  const completion = await client.request(
    "textDocument/completion",
    params(fixture, "completion", "greeter.gr", 10),
  );
  const item = completion.items.find(({ label }) => label.startsWith("greet"));
  assert.ok(item);
  const resolved = await client.request("completionItem/resolve", item);
  assert.match(JSON.stringify(resolved.documentation), /Build a greeting/);
};
exports.navigationAndRename = async (client, fixture) => {
  for (const method of ["textDocument/definition", "textDocument/implementation"])
    assert.ok(
      (await client.request(method, params(fixture, "main", "greet("))).some(({ targetUri, uri }) =>
        sameUri(targetUri || uri, fixture.uris.greeter),
      ),
    );
  assert.ok(
    (
      await client.request("textDocument/typeDefinition", params(fixture, "typed", "person.name"))
    ).some(({ targetUri, uri }) => sameUri(targetUri || uri, fixture.uris.types)),
  );
  const refs = await client.request("textDocument/references", {
    ...params(fixture, "main", "greet("),
    context: { includeDeclaration: true },
  });
  for (const name of ["main", "greeter"])
    assert.ok(refs.some(({ uri }) => sameUri(uri, fixture.uris[name])));
  const prepared = await client.request(
    "textDocument/prepareRename",
    params(fixture, "main", "greet("),
  );
  assert.equal(prepared.range.start.character, position(fixture.texts.main, "greet(").character);
  const renamed = await client.request("textDocument/rename", {
    ...params(fixture, "main", "greet("),
    newName: "welcome",
  });
  for (const name of ["main", "greeter"]) {
    const edits = Object.entries(renamed.changes).find(([uri]) =>
      sameUri(uri, fixture.uris[name]),
    )?.[1];
    assert.ok(edits?.some(({ newText }) => newText === "welcome"));
  }
  assert.ok(
    (await client.request("textDocument/documentHighlight", params(fixture, "main", "greet(")))
      .length,
  );
};
exports.diagnostics = async (client, fixture) => {
  await client.waitFor(
    () =>
      client
        .messages("textDocument/publishDiagnostics")
        .some(
          ({ params }) =>
            sameUri(params.uri, fixture.uris.broken) &&
            params.diagnostics.some(({ code }) => code === "undefined-global"),
        ),
    "undefined global",
    30000,
  );
  const previous = client.messages("textDocument/publishDiagnostics").length;
  client.change(fixture.uris.broken, "local result = 1\nprint(result)\n", 2);
  await client.waitFor(
    () =>
      client
        .messages("textDocument/publishDiagnostics")
        .slice(previous)
        .some(
          ({ params }) =>
            sameUri(params.uri, fixture.uris.broken) &&
            (params.version == null || params.version === 2) &&
            params.diagnostics.length === 0,
        ),
    "cleared diagnostics",
    30000,
  );
};
exports.symbolsAndFormat = async (client, fixture) => {
  const symbols = await client.request("textDocument/documentSymbol", {
    textDocument: { uri: fixture.uris.greeter },
  });
  assert.ok(symbols.some(({ name }) => name === "M.greet"));
  const workspace = await client.request("workspace/symbol", { query: "greet" });
  assert.ok(
    workspace.some(
      ({ name, location }) => name === "greet" && sameUri(location.uri, fixture.uris.greeter),
    ),
  );
  const formatParams = {
    textDocument: { uri: fixture.uris.format },
    options: { tabSize: 4, insertSpaces: true },
  };
  assert.match(
    (await client.request("textDocument/formatting", formatParams))[0].newText,
    /one = 1/,
  );
  assert.ok(
    (
      await client.request("textDocument/rangeFormatting", {
        ...formatParams,
        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
      })
    ).length,
  );
  const typed = await client.request("textDocument/onTypeFormatting", {
    textDocument: { uri: fixture.uris.onType },
    position: { line: 1, character: 0 },
    ch: "\n",
    options: formatParams.options,
  });
  assert.ok(
    typed.some(({ newText, range }) => newText === "if true then\n" && range.end.line === 1),
  );
};
exports.actionsHintsAndTokens = async (client, fixture) => {
  const diagnostics = await client.waitFor(
    () =>
      client
        .messages("textDocument/publishDiagnostics")
        .find(
          ({ params }) =>
            sameUri(params.uri, fixture.uris.actions) &&
            params.diagnostics.some(({ code }) => code === "trailing-space"),
        )?.params.diagnostics,
    "trailing-space diagnostic",
    30000,
  );
  const actions = await client.request("textDocument/codeAction", {
    textDocument: { uri: fixture.uris.actions },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 21 } },
    context: { diagnostics },
  });
  const command = actions.find(({ command }) => command?.command === "lua.removeSpace")?.command;
  assert.ok(command && client.canExecuteCommand(command.command));
  await client.request("workspace/executeCommand", command);
  const edits = client.serverRequests.find(({ method }) => method === "workspace/applyEdit").params
    .edit.changes;
  assert.ok(
    Object.entries(edits).some(
      ([uri, changes]) =>
        sameUri(uri, fixture.uris.actions) && changes.some(({ newText }) => newText === ""),
    ),
  );
  const range = { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } };
  const hints = await client.request("textDocument/inlayHint", {
    textDocument: { uri: fixture.uris.main },
    range,
  });
  assert.ok(hints.some(({ label }) => JSON.stringify(label).includes("name:")));
  assert.ok(await client.request("inlayHint/resolve", hints[0]));
  const full = await client.request("textDocument/semanticTokens/full", {
    textDocument: { uri: fixture.uris.main },
  });
  assert.ok(full.data.length > 0 && full.data.length % 5 === 0);
  const selected = await client.request("textDocument/semanticTokens/range", {
    textDocument: { uri: fixture.uris.main },
    range,
  });
  assert.ok(selected.data.length > 0);
};
exports.lensesAndFolding = async (client, fixture) => {
  const lenses = await client.request("textDocument/codeLens", {
    textDocument: { uri: fixture.uris.greeter },
  });
  assert.ok(lenses.length > 0);
  const resolved = await client.request("codeLens/resolve", lenses[0]);
  assert.match(resolved.command.title, /references/);
  assert.equal(resolved.command.command, "");
  assert.ok(
    (
      await client.request("textDocument/foldingRange", {
        textDocument: { uri: fixture.uris.greeter },
      })
    ).some(({ startLine, endLine }) => endLine > startLine),
  );
  assert.ok(
    !client.capabilities.callHierarchyProvider && !client.capabilities.typeHierarchyProvider,
  );
};
