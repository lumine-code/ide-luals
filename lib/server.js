const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const REPOSITORY = "LuaLS/lua-language-server";
const TARGETS = new Set([
  "win32-x64",
  "win32-ia32",
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
]);

exports.findOnPath = (name, env = process.env) => {
  const suffixes = process.platform === "win32" ? ["", ".exe"] : [""];
  for (const directory of (env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(directory, name + suffix);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Keep searching beyond missing files or non-executable entries.
      }
    }
  }
  return null;
};

exports.assetFor = ({ platform, arch, version }) => {
  const normalized = String(version || "").replace(/^v/, "");
  if (!TARGETS.has(`${platform}-${arch}`) || !/^\d+\.\d+\.\d+$/.test(normalized)) return null;
  return `lua-language-server-${normalized}-${platform}-${arch}.${platform === "win32" ? "zip" : "tar.gz"}`;
};

exports.latestServerVersion = async (api) => (await api.latestGithubRelease(REPOSITORY)).version;

exports.installServer = async ({ storagePath, version, api }) => {
  const release = version
    ? await api.githubReleaseByTag(REPOSITORY, String(version).replace(/^v/, ""))
    : await api.latestGithubRelease(REPOSITORY);
  const assetName = exports.assetFor({
    platform: process.platform,
    arch: process.arch,
    version: release.version,
  });
  if (!assetName)
    throw new Error(`LuaLS publishes no supported build for ${process.platform}-${process.arch}.`);
  const asset = release.assets.find(({ name }) => name === assetName);
  if (!asset) throw new Error(`LuaLS ${release.version} does not publish '${assetName}'.`);
  if (!/^sha256:[0-9a-f]{64}$/i.test(asset.digest || ""))
    throw new Error(`LuaLS did not publish a SHA256 digest for '${assetName}'.`);
  api.setServerInstallationStatus("downloading");
  await api.downloadFile(asset.url, storagePath, {
    type: process.platform === "win32" ? "zip" : "gzip-tar",
    digest: asset.digest,
  });
  const binary = path.join(
    storagePath,
    "bin",
    process.platform === "win32" ? "lua-language-server.exe" : "lua-language-server",
  );
  // The runtime executable needs the rest of its distribution: scripts,
  // standard-library templates and the native formatter stay beside it.
  for (const relative of ["main.lua", "script", "meta", "locale", "LICENSE"])
    await fs.promises.access(path.join(storagePath, relative));
  if (!(await fs.promises.stat(binary)).isFile())
    throw new Error("The LuaLS archive is missing its executable.");
  await api.makeFileExecutable(binary);
  return {
    version: release.version,
    binary: path.relative(storagePath, binary),
    repository: REPOSITORY,
    asset: assetName,
    checksum: asset.digest,
  };
};

exports.resolveServer = async (configuredPath, context) => {
  const command =
    configuredPath ||
    context.managedServer?.binaryPath ||
    exports.findOnPath("lua-language-server");
  if (!command) return null;
  if (!(await fs.promises.stat(command)).isFile())
    throw new Error("The configured LuaLS path is not an executable file.");
  await fs.promises.access(command, fs.constants.X_OK);
  const key = crypto.createHash("sha256").update(context.rootPath).digest("hex").slice(0, 20);
  const directory = path.join(
    context.configDirPath || os.tmpdir(),
    "language-server-data",
    "ide-lua",
    String(process.pid),
    key,
  );
  const log = path.join(directory, "log"),
    meta = path.join(directory, "meta");
  await fs.promises.mkdir(log, { recursive: true });
  await fs.promises.mkdir(meta, { recursive: true });
  return {
    command,
    args: [`--logpath=${log}`, `--metapath=${meta}`],
    cwd: context.rootPath,
    transport: "stdio",
    ...(context.managedServer?.binaryPath === command
      ? { version: context.managedServer.version }
      : {}),
  };
};
