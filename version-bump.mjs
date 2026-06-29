const { readFileSync, writeFileSync } = require("fs");

const targetVersion = process.env.npm_package_version;

// read minAppVersion from manifest.json
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;

// update versions.json with target version and minAppVersion
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));

// update manifest.json with target version
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));
