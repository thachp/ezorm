import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { packProxyNodeArtifacts, rootDir } from "./proxy-packaging.mjs";

const outputDir = resolve(rootDir, ".artifacts/proxy-node");
mkdirSync(outputDir, { recursive: true });

const result = packProxyNodeArtifacts(outputDir);

process.stdout.write(
  `Packed ${result.binaryPackageName} and @sqlmodel/proxy-node into ${outputDir}\n`
);
