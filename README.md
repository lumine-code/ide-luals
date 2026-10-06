# ide-luals

Provide Lua language intelligence through LuaLS.

Registers the native Lua Language Server with ide for Lua files and LuaRocks specifications. The official distribution includes its own runtime and formatter, so no separate Lua installation is needed.

## Features

- **Code intelligence**: provides completion, hover documentation and function signatures.
- **Diagnostics**: reports syntax errors, undefined globals and annotation-based type problems.
- **Navigation**: finds definitions, implementations, annotated types, references and symbols across modules.
- **Refactoring**: renames project symbols and applies server-provided fixes.
- **Formatting**: formats complete documents, selected ranges and typed text.
- **Presentation**: supplies semantic tokens, parameter hints, folding ranges and reference-count labels.
- **Lua versions**: analyzes Lua 5.1 through 5.5 and LuaJIT.
- **Project configuration**: reads .luarc.json and annotated application libraries.
- **Managed installation**: downloads complete official releases and verifies their SHA-256 digests.

## Installation

To install `ide-luals` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/ide-luals`.

Install `ide`, `language-lua` and the frontends you want, such as `autocomplete`, `linter`, `hover`, `hyperclick`, `refactor`, `find-references` and `code-format`. Select an existing `lua-language-server` executable in Server Path or install LuaLS through `ide:manage-servers`.

Official managed releases support x64 Windows, Linux and macOS, arm64 Linux and macOS, and 32-bit Windows. Preserve the complete distribution when selecting an existing executable: its scripts, metadata templates and native formatter are required beside the executable.

## Usage

Open the folder containing your Lua modules as a project. LuaLS follows `require()` paths and uses annotations such as `---@param`, `---@return` and `---@class` to improve navigation and type checking. `.rockspec` files use the Lua grammar and receive the same features.

The adapter enables standard inlay hints and reference-count labels. These labels are informational; interactive reference lenses require an upstream client command. Use `find-references` to navigate to occurrences. LuaLS does not implement call or type hierarchy through the standard protocol.

The upstream extension's addon manager is disabled. Add application API definitions directly through Library Paths or the project's `.luarc.json` instead.

## Configuration

LuaLS reads `.luarc.json` or `.luarc.jsonc` in the project root. Project settings take precedence over editor fallbacks. For example:

```json
{
  "runtime.version": "LuaJIT",
  "diagnostics.globals": ["application"],
  "workspace.library": ["./definitions"],
  "hint.enable": true
}
```

Keys in `.luarc.json` omit the `Lua.` prefix. See the [upstream configuration reference](https://luals.github.io/wiki/configuration/) for runtime paths, diagnostics and formatting options.

## Services

- `ide`: consumed to register LuaLS and route its language features.
- `background-tips.provider`: provided to explain project configuration and annotations.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
