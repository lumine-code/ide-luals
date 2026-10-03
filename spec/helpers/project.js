const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

exports.createProject = () => {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "ide-lua-"));
  const rootPath = path.join(directory, "project");
  fs.mkdirSync(rootPath);
  const texts = {
    greeter:
      'local M = {}\n\n---Build a greeting.\n---@param name string\n---@return string\nfunction M.greet(name)\n    return "Hello " .. name\nend\n\n---@param left number\n---@param right number\n---@return number\nfunction M.add(left, right)\n    return left + right\nend\n\nreturn M\n',
    main: 'local greeter = require("greeter")\nlocal message = "😀"; print(greeter.greet("Ada"))\nlocal total = greeter.add(4, 5)\nprint(message, total)\n',
    broken: "local result = imaginaryGlobal\nprint(result)\n",
    completion: 'local greeter = require("greeter")\ngreeter.gr\n',
    format: "local values={one=1,two=2}\nprint(values.one)\n",
    onType: "if   true   then\n\nend\n",
    actions: 'local name = "Ada"   \nprint(name)\n',
    types:
      '---@class Person\n---@field name string\nlocal Person = {}\n\n---@return Person\nfunction Person.new()\n    return { name = "Ada" }\nend\nreturn Person\n',
    typed:
      'local Person = require("types")\n---@type Person\nlocal person = Person.new()\nprint(person.name)\n',
  };
  fs.writeFileSync(
    path.join(rootPath, ".luarc.json"),
    JSON.stringify({
      "runtime.version": "Lua 5.4",
      "workspace.checkThirdParty": false,
      "diagnostics.workspaceDelay": 0,
      "diagnostics.workspaceRate": 100,
      "diagnostics.neededFileStatus": { "trailing-space": "Any" },
      "hint.enable": true,
      "hint.paramName": "All",
      "codeLens.enable": true,
    }),
  );
  const files = Object.fromEntries(
    Object.keys(texts).map((key) => [key, path.join(rootPath, `${key}.lua`)]),
  );
  for (const [key, file] of Object.entries(files)) fs.writeFileSync(file, texts[key]);
  return {
    directory,
    rootPath,
    texts,
    files,
    uris: Object.fromEntries(
      Object.entries(files).map(([key, file]) => [key, pathToFileURL(file).href]),
    ),
  };
};

exports.position = (text, fragment, inside = 0) => {
  const index = text.indexOf(fragment);
  if (index < 0) throw new Error(`No '${fragment}' in fixture`);
  const prefix = text.slice(0, index + inside),
    lines = prefix.split("\n");
  return { line: lines.length - 1, character: lines.at(-1).length };
};

exports.removeProject = async (rootPath) => {
  const parent = fs.realpathSync.native(os.tmpdir());
  const project = path.resolve(rootPath),
    resolved = path.dirname(project);
  if (
    path.basename(project) !== "project" ||
    path.dirname(resolved) !== parent ||
    !path.basename(resolved).startsWith("ide-lua-")
  )
    throw new Error("Refusing to remove a non-fixture directory");
  await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
};
