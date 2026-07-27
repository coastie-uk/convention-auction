#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const nodeModulesDir = path.resolve(process.argv[2] || "/app/node_modules");
const outputPath = path.resolve(process.argv[3] || "/tmp/npm-production-packages.tsv");
const applicationRoot = path.dirname(nodeModulesDir);
const licensePattern = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;
const packages = new Map();

function recordPackage(packageDir) {
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return;

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${packageJsonPath}: ${error.message}`);
  }

  if (metadata.name && metadata.version) {
    const license = typeof metadata.license === "string"
      ? metadata.license
      : metadata.licenses
        ? JSON.stringify(metadata.licenses)
        : "UNDECLARED";
    const retainedLicenses = fs.readdirSync(packageDir, { withFileTypes: true })
      .filter((candidate) => candidate.isFile() && licensePattern.test(candidate.name))
      .map((candidate) => path.relative(applicationRoot, path.join(packageDir, candidate.name)))
      .sort()
      .join(",");
    const key = `${metadata.name}@${metadata.version}`;
    packages.set(key, {
      name: metadata.name,
      version: metadata.version,
      license,
      retainedLicenses: retainedLicenses || "NONE"
    });
  }

  const nestedNodeModules = path.join(packageDir, "node_modules");
  if (fs.existsSync(nestedNodeModules)) {
    visitNodeModules(nestedNodeModules);
  }
}

function visitNodeModules(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;

    const fullPath = path.join(directory, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scopedEntry of fs.readdirSync(fullPath, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) {
          recordPackage(path.join(fullPath, scopedEntry.name));
        }
      }
    } else {
      recordPackage(fullPath);
    }
  }
}

if (!fs.existsSync(nodeModulesDir)) {
  throw new Error(`Node modules directory does not exist: ${nodeModulesDir}`);
}

visitNodeModules(nodeModulesDir);

const escapeField = (value) => String(value).replace(/[\t\r\n]+/g, " ").trim();
const rows = Array.from(packages.values()).sort((left, right) =>
  left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
);
const lines = [
  "package\tversion\tdeclared_license\tretained_license_files",
  ...rows.map((entry) => [
    entry.name,
    entry.version,
    entry.license,
    entry.retainedLicenses
  ].map(escapeField).join("\t"))
];

fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, { mode: 0o644 });
console.log(`Recorded ${rows.length} installed npm packages in ${outputPath}`);
