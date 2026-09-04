#!/usr/bin/env node
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '..');
const sourceRoot = path.join(repositoryRoot, 'plugin-src');
const sharedSource = path.join(sourceRoot, 'shared');

const runtimeSources = {
  client: path.join(repositoryRoot, 'lib', 'nitrate-client.mjs'),
  cli: path.join(repositoryRoot, 'bin', 'nitrate.mjs'),
  mcp: path.join(repositoryRoot, 'mcp', 'server.mjs'),
  license: path.join(repositoryRoot, 'LICENSE')
};

const bundles = [
  {
    host: 'Codex',
    source: path.join(sourceRoot, 'codex'),
    output: path.join(repositoryRoot, 'plugins', 'nitrate'),
    manifest: path.join('.codex-plugin', 'plugin.json')
  },
  {
    host: 'Claude Code',
    source: path.join(sourceRoot, 'claude-code'),
    output: path.join(repositoryRoot, 'plugins', 'claude-code'),
    manifest: path.join('.claude-plugin', 'plugin.json')
  }
];

const expectedSkills = ['send-packet', 'pull-assignment', 'return-work', 'review-work', 'make-with-higgsfield', 'connect-supercomputer'];
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(message) {
  throw new Error(`Plugin bundle build failed: ${message}`);
}

async function assertFile(file) {
  let info;
  try {
    info = await stat(file);
  } catch {
    fail(`missing required file ${path.relative(repositoryRoot, file)}`);
  }
  if (!info.isFile()) fail(`${path.relative(repositoryRoot, file)} is not a file`);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    fail(`${path.relative(repositoryRoot, file)} is not valid JSON: ${error.message}`);
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function copyDirectoryContents(from, to) {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    await cp(path.join(from, entry.name), path.join(to, entry.name), {
      recursive: true,
      force: true,
      preserveTimestamps: true
    });
  }
}

function importSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

async function verifyRuntimeFile(bundleRoot, file) {
  const source = await readFile(file, 'utf8');
  for (const specifier of importSpecifiers(source)) {
    if (!specifier.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(file), specifier);
    const location = path.relative(bundleRoot, resolved);
    if (location === '..' || location.startsWith(`..${path.sep}`) || path.isAbsolute(location)) {
      fail(`${path.relative(repositoryRoot, file)} imports outside its plugin bundle: ${specifier}`);
    }
    await assertFile(resolved);
  }
  return source;
}

async function synchronizeVersion(bundle, version) {
  const manifestFile = path.join(bundle.output, bundle.manifest);
  const manifest = await readJson(manifestFile);
  if (manifest.name !== 'nitrate') fail(`${bundle.host} manifest name must be nitrate`);
  manifest.version = version;
  await writeJson(manifestFile, manifest);

  const packageFile = path.join(bundle.output, 'package.json');
  const packageManifest = await readJson(packageFile);
  packageManifest.version = version;
  await writeJson(packageFile, packageManifest);
}

async function verifyBundle(bundle, version) {
  const manifest = await readJson(path.join(bundle.output, bundle.manifest));
  if (manifest.name !== 'nitrate' || manifest.version !== version) {
    fail(`${bundle.host} manifest identity/version is out of sync`);
  }

  for (const skill of expectedSkills) {
    await assertFile(path.join(bundle.output, 'skills', skill, 'SKILL.md'));
  }

  const clientFile = path.join(bundle.output, 'lib', 'nitrate-client.mjs');
  const cliFile = path.join(bundle.output, 'bin', 'nitrate.mjs');
  const executableFile = path.join(bundle.output, 'bin', 'nitrate');
  const mcpFile = path.join(bundle.output, 'mcp', 'server.mjs');
  const cliSource = await verifyRuntimeFile(bundle.output, cliFile);
  const executableSource = await verifyRuntimeFile(bundle.output, executableFile);
  const mcpSource = await verifyRuntimeFile(bundle.output, mcpFile);
  await verifyRuntimeFile(bundle.output, clientFile);

  if (!importSpecifiers(cliSource).includes('../lib/nitrate-client.mjs')) {
    fail(`${bundle.host} bin/nitrate.mjs must import ../lib/nitrate-client.mjs`);
  }
  if (!importSpecifiers(executableSource).includes('../lib/nitrate-client.mjs')) {
    fail(`${bundle.host} bin/nitrate must import its bundled client`);
  }
  if (!importSpecifiers(mcpSource).includes('../lib/nitrate-client.mjs')) {
    fail(`${bundle.host} mcp/server.mjs must import ../lib/nitrate-client.mjs`);
  }

  const mcpConfig = await readJson(path.join(bundle.output, '.mcp.json'));
  const args = mcpConfig?.mcpServers?.nitrate?.args;
  if (!Array.isArray(args) || args.length !== 1) fail(`${bundle.host} .mcp.json must declare one server path`);
  if (bundle.host === 'Claude Code' && args[0] !== '${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs') {
    fail('Claude Code .mcp.json must resolve the server through ${CLAUDE_PLUGIN_ROOT}');
  }
  if (bundle.host === 'Codex' && args[0] !== '${PLUGIN_ROOT}/mcp/server.mjs') {
    fail('Codex .mcp.json must resolve the server through ${PLUGIN_ROOT}');
  }
}

async function verifyMarketplaces() {
  const codex = await readJson(path.join(repositoryRoot, '.agents', 'plugins', 'marketplace.json'));
  const claude = await readJson(path.join(repositoryRoot, '.claude-plugin', 'marketplace.json'));
  if (codex.name !== 'nitrate-local') fail('Codex marketplace must be named nitrate-local');
  if (claude.name !== 'nitrate-local') fail('Claude marketplace must be named nitrate-local');
  if (codex.plugins?.find(entry => entry.name === 'nitrate')?.source?.path !== './plugins/nitrate') {
    fail('Codex marketplace must point at ./plugins/nitrate');
  }
  if (claude.plugins?.find(entry => entry.name === 'nitrate')?.source !== './plugins/claude-code') {
    fail('Claude marketplace must point at ./plugins/claude-code');
  }
}

async function buildBundle(bundle, version) {
  await rm(bundle.output, { recursive: true, force: true });
  await mkdir(bundle.output, { recursive: true });
  await copyDirectoryContents(sharedSource, bundle.output);
  await copyDirectoryContents(bundle.source, bundle.output);

  await mkdir(path.join(bundle.output, 'lib'), { recursive: true });
  await mkdir(path.join(bundle.output, 'bin'), { recursive: true });
  await mkdir(path.join(bundle.output, 'mcp'), { recursive: true });
  await copyFile(runtimeSources.client, path.join(bundle.output, 'lib', 'nitrate-client.mjs'));
  await copyFile(runtimeSources.cli, path.join(bundle.output, 'bin', 'nitrate.mjs'));
  await copyFile(runtimeSources.cli, path.join(bundle.output, 'bin', 'nitrate'));
  await copyFile(runtimeSources.mcp, path.join(bundle.output, 'mcp', 'server.mjs'));
  await copyFile(runtimeSources.license, path.join(bundle.output, 'LICENSE'));
  await chmod(path.join(bundle.output, 'bin', 'nitrate'), 0o755);
  await chmod(path.join(bundle.output, 'bin', 'nitrate.mjs'), 0o755);
  await chmod(path.join(bundle.output, 'mcp', 'server.mjs'), 0o755);
  await synchronizeVersion(bundle, version);
  await verifyBundle(bundle, version);
}

async function main() {
  const requiredFiles = [
    ...Object.values(runtimeSources),
    path.join(repositoryRoot, 'package.json'),
    ...bundles.map(bundle => path.join(bundle.source, bundle.manifest)),
    ...expectedSkills.map(skill => path.join(sharedSource, 'skills', skill, 'SKILL.md'))
  ];
  for (const file of requiredFiles) await assertFile(file);

  const packageManifest = await readJson(path.join(repositoryRoot, 'package.json'));
  if (!semverPattern.test(packageManifest.version || '')) fail('package.json version must be semver');

  await verifyMarketplaces();
  for (const bundle of bundles) await buildBundle(bundle, packageManifest.version);

  for (const bundle of bundles) {
    console.log(`Built ${bundle.host} plugin: ${path.relative(repositoryRoot, bundle.output)}`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
